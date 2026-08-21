/* ---------------------------------------------------------------------
   LabCal — the day's certificates
   ---------------------------------------------------------------------
   Every PDF a worksheet generates is also kept here, so the calibration
   page can show what has been produced today: view it again, share it, or
   staple the whole day into one PDF.

   Storage: IndexedDB (localStorage cannot hold files). Records are pruned
   automatically after KEEP_DAYS so the database never grows without bound.

   IMPORTANT: this is a convenience buffer, NOT an archive. Browser storage
   is cleared by iPadOS after roughly a week of not visiting the site, and
   by anything that clears site data. Certificates must still be saved out
   properly the same day — the panel says so on screen.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var DB_NAME = 'labcal-certs';
  var DB_VERSION = 1;
  var STORE = 'certs';
  var KEEP_DAYS = 14;
  var CHANGE_EVENT = 'labcal-certs-changed';

  var doc = global.document;
  var lastError = null;   // why the last filing attempt failed, if it did

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function supported() {
    try { return !!global.indexedDB; } catch (e) { return false; }
  }

  var dbPromise = null;
  function open() {
    if (!supported()) return Promise.reject(new Error('This browser has no space to keep the day\'s certificates.'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          os.createIndex('day', 'day', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Could not open the certificate store.')); };
    });
    return dbPromise;
  }

  function tx(mode) {
    return open().then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  // ---- writing ----------------------------------------------------------
  // meta: { filename, certRef, serial, model, site, jobRef, sheet }
  function add(blob, meta) {
    meta = meta || {};
    var rec = {
      day: todayIso(),
      savedAt: new Date().toISOString(),
      filename: meta.filename || 'certificate.pdf',
      certRef: meta.certRef || '',
      serial: meta.serial || '',
      model: meta.model || '',
      site: meta.site || '',
      jobRef: meta.jobRef || '',
      sheet: meta.sheet || '',
      size: blob && blob.size ? blob.size : 0,
      blob: blob
    };
    // Generating again for the same job + serial + worksheet is an amendment.
    // The earlier certificate is NOT deleted — it was a real document that may
    // already have been sent — it is marked superseded so the panel can show
    // which one is current.
    return supersedeEarlier(rec)
      .then(function () { return tx('readwrite'); })
      .then(function (os) { return wrap(os.add(rec)); })
      .then(function (id) { announce(); return id; })
      .catch(function (e) {
        // Never let a storage problem lose the engineer their certificate —
        // the file has already been saved/shared by this point. But do not
        // hide it either: a certificate that was never filed will not appear
        // on its job, and silence made that look like a display bug.
        lastError = (e && e.message) ? e.message : String(e);
        console.warn('Could not file this certificate in the day list:', e);
        return null;
      });
  }

  function sameUnit(a, b) {
    return (a.sheet || '') === (b.sheet || '')
        && (a.jobRef || '') === (b.jobRef || '')
        && (a.serial || '') !== ''
        && (a.serial || '') === (b.serial || '');
  }

  function supersedeEarlier(rec) {
    return all().then(function (list) {
      var earlier = list.filter(function (r) { return !r.superseded && sameUnit(r, rec); });
      if (!earlier.length) return;
      return tx('readwrite').then(function (os) {
        return Promise.all(earlier.map(function (r) {
          r.superseded = true;
          r.supersededAt = new Date().toISOString();
          return wrap(os.put(r));
        }));
      });
    }).catch(function () { /* never block a certificate over bookkeeping */ });
  }

  // Put a certificate back from a backup, keeping its original day and time.
  // Deliberately skips the supersede pass: the backup already records which
  // ones were superseded, and re-running it would rewrite that history.
  function addRestored(blob, meta) {
    meta = meta || {};
    var rec = {
      day: meta.day || todayIso(),
      savedAt: meta.savedAt || new Date().toISOString(),
      filename: meta.filename || 'certificate.pdf',
      certRef: meta.certRef || '', serial: meta.serial || '', model: meta.model || '',
      site: meta.site || '', jobRef: meta.jobRef || '', sheet: meta.sheet || '',
      size: blob && blob.size ? blob.size : (meta.size || 0),
      superseded: !!meta.superseded,
      restored: true,
      blob: blob
    };
    return tx('readwrite')
      .then(function (os) { return wrap(os.add(rec)); })
      .then(function (id) { announce(); return id; });
  }

  function remove(id) {
    return tx('readwrite')
      .then(function (os) { return wrap(os.delete(id)); })
      .then(function () { announce(); });
  }

  function clearDay(day) {
    return listDay(day).then(function (list) {
      return Promise.all(list.map(function (r) { return remove(r.id); }));
    });
  }

  // ---- reading ----------------------------------------------------------
  function all() {
    return tx('readonly').then(function (os) { return wrap(os.getAll()); });
  }

  // jobRef narrows to a single job. More than one job in a day is normal, and
  // the certificates for each must stay separable.
  function listDay(day, jobRef) {
    var want = day || todayIso();
    return all().then(function (list) {
      return list
        .filter(function (r) { return r.day === want; })
        .filter(function (r) { return jobRef === undefined || (r.jobRef || '') === jobRef; })
        .sort(function (a, b) { return a.savedAt < b.savedAt ? -1 : 1; });
    });
  }

  // The jobs worked on a given day, in the order they were first certified.
  function jobsOnDay(day) {
    return listDay(day).then(function (list) {
      var order = [], byRef = {};
      list.forEach(function (r) {
        var ref = r.jobRef || '';
        if (!byRef[ref]) {
          byRef[ref] = { jobRef: ref, site: r.site || '', count: 0, bytes: 0 };
          order.push(ref);
        }
        byRef[ref].count += 1;
        byRef[ref].bytes += r.size || 0;
        if (!byRef[ref].site && r.site) byRef[ref].site = r.site;
      });
      return order.map(function (ref) { return byRef[ref]; });
    });
  }

  function days() {
    return all().then(function (list) {
      var seen = {};
      list.forEach(function (r) { seen[r.day] = (seen[r.day] || 0) + 1; });
      return Object.keys(seen).sort().reverse().map(function (d) {
        return { day: d, count: seen[d] };
      });
    });
  }

  function get(id) {
    return tx('readonly').then(function (os) { return wrap(os.get(id)); });
  }

  // ---- housekeeping -----------------------------------------------------
  function prune(keepDays) {
    var keep = keepDays || KEEP_DAYS;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keep);
    var cutIso = cutoff.getFullYear() + '-' + String(cutoff.getMonth() + 1).padStart(2, '0') + '-' + String(cutoff.getDate()).padStart(2, '0');
    return all().then(function (list) {
      var old = list.filter(function (r) { return r.day < cutIso; });
      return Promise.all(old.map(function (r) { return remove(r.id); })).then(function () { return old.length; });
    }).catch(function () { return 0; });
  }

  // ---- merging ----------------------------------------------------------
  // pdf-lib is ~500 KB, so it is only fetched when a merge is actually asked
  // for rather than on every page load. It is served from this site (not a
  // CDN) so it works with no signal.
  function loadPdfLib() {
    if (global.PDFLib) return Promise.resolve(global.PDFLib);
    return new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = 'pdf-lib.min.js';
      s.onload = function () {
        if (global.PDFLib) resolve(global.PDFLib);
        else reject(new Error('The PDF merge library did not load correctly.'));
      };
      s.onerror = function () {
        reject(new Error('Could not load the PDF merge library. If you are offline, open the home page once while online and tap "Refresh offline copy".'));
      };
      doc.head.appendChild(s);
    });
  }

  // Blob.arrayBuffer() is missing on older Safari (pre-14), which is exactly
  // the sort of iPad that might still be in a van. Fall back to FileReader.
  function blobToArrayBuffer(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new global.FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('Could not read the stored certificate.')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  // Staple every certificate from a day into one PDF, in the order produced.
  // cover: an optional Blob placed in front of the certificates — used for the
  // job summary, so a merged job opens on the list of what was done.
  function mergeDay(day, onProgress, jobRef, cover) {
    var want = day || todayIso();
    return Promise.all([listDay(want, jobRef), loadPdfLib()]).then(function (res) {
      var list = res[0], PDFLib = res[1];
      if (!list.length) throw new Error('There are no certificates to merge for that job.');
      return PDFLib.PDFDocument.create().then(function (out) {
        function addCover() {
          if (!cover) return Promise.resolve();
          return blobToArrayBuffer(cover)
            .then(function (buf) { return PDFLib.PDFDocument.load(buf); })
            .then(function (src) { return out.copyPages(src, src.getPageIndices()); })
            .then(function (pages) { pages.forEach(function (p) { out.addPage(p); }); })
            .catch(function (e) { console.warn('Summary cover skipped:', e); });
        }
        var i = 0;
        function next() {
          if (i >= list.length) return out.save();
          var rec = list[i];
          if (onProgress) onProgress(i + 1, list.length);
          return blobToArrayBuffer(rec.blob)
            .then(function (buf) { return PDFLib.PDFDocument.load(buf); })
            .then(function (src) { return out.copyPages(src, src.getPageIndices()); })
            .then(function (pages) {
              pages.forEach(function (p) { out.addPage(p); });
              i++;
              return next();
            })
            .catch(function (e) {
              // One unreadable certificate must not sink the whole merge.
              console.warn('Skipped ' + rec.filename + ' while merging:', e);
              i++;
              return next();
            });
        }
        return addCover().then(next);
      }).then(function (bytes) {
        return { blob: new Blob([bytes], { type: 'application/pdf' }), count: list.length, cover: !!cover };
      });
    });
  }

  // IndexedDB fires no cross-tab event, so a certificate generated on a
  // worksheet would not reach a calibration page open in another tab. A
  // localStorage ping does travel between tabs, so use it as the signal.
  var PING = 'labcal.certs.ping';
  function announce() {
    try { global.dispatchEvent(new CustomEvent(CHANGE_EVENT)); } catch (e) {}
    try { global.localStorage.setItem(PING, String(Date.now())); } catch (e) {}
  }
  function onChange(fn) {
    if (typeof fn !== 'function') return;
    global.addEventListener(CHANGE_EVENT, fn);
    global.addEventListener('storage', function (e) {
      if (!e || e.key === PING) fn();
    });
  }

  // The merged file is named after the job so two jobs on the same day can
  // never be confused for each other.
  function mergedFileName(day, jobRef) {
    var d = day || todayIso();
    var ref = String(jobRef || '').trim().replace(/[^A-Za-z0-9_-]/g, '');
    return (ref ? ref + '_' : 'LabCal_') + 'certificates_' + d + '.pdf';
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  global.LabCalCerts = {
    KEEP_DAYS: KEEP_DAYS,
    CHANGE_EVENT: CHANGE_EVENT,
    supported: supported,
    lastError: function () { return lastError; },
    todayIso: todayIso,
    add: add,
    addRestored: addRestored,
    get: get,
    remove: remove,
    clearDay: clearDay,
    listDay: listDay,
    jobsOnDay: jobsOnDay,
    mergedFileName: mergedFileName,
    days: days,
    prune: prune,
    mergeDay: mergeDay,
    onChange: onChange,
    formatSize: formatSize
  };
})(typeof window !== 'undefined' ? window : this);
