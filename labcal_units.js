/* ---------------------------------------------------------------------
   LabCal — per-unit worksheet snapshots
   ---------------------------------------------------------------------
   The worksheets have always autosaved, but into a single slot per
   worksheet: start the next unit and the previous one's readings are gone.
   This keeps a snapshot per UNIT (worksheet + job reference + serial), so a
   unit can be reopened later with everything still in it and amended.

   Storage: localStorage, one key per unit —
            labcal.unit.<sheet>.<jobRef>.<serial>
   Pruned automatically after KEEP_DAYS.

   Same caveat as everywhere else: browser storage is a working buffer, not
   an archive. The certificate PDF is the record.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var PREFIX = 'labcal.unit.';
  var KEEP_DAYS = 30;
  var CHANGE_EVENT = 'labcal-units-changed';

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function clean(v) {
    return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  }

  // A unit is identified by worksheet + job + serial. Serial alone is not
  // enough: the same fridge can be calibrated on two different visits, and
  // those must not overwrite each other.
  function keyFor(sheet, jobRef, serial) {
    var s = clean(serial);
    if (!s) return '';
    return PREFIX + clean(sheet) + '.' + (clean(jobRef) || 'NOJOB') + '.' + s;
  }

  function store() {
    try { return global.localStorage; } catch (e) { return null; }
  }

  function save(sheet, jobRef, serial, state, meta) {
    var key = keyFor(sheet, jobRef, serial);
    var s = store();
    if (!key || !s) return false;
    var rec = {
      sheet: sheet, jobRef: jobRef || '', serial: serial || '',
      day: todayIso(),
      savedAt: new Date().toISOString(),
      meta: meta || {},
      state: state
    };
    try { s.setItem(key, JSON.stringify(rec)); }
    catch (e) { return false; }   // quota — the certificate is unaffected
    announce();
    return true;
  }

  function load(sheet, jobRef, serial) {
    var key = keyFor(sheet, jobRef, serial);
    var s = store();
    if (!key || !s) return null;
    try {
      var txt = s.getItem(key);
      return txt ? JSON.parse(txt) : null;
    } catch (e) { return null; }
  }

  function has(sheet, jobRef, serial) { return !!load(sheet, jobRef, serial); }

  function remove(sheet, jobRef, serial) {
    var key = keyFor(sheet, jobRef, serial);
    var s = store();
    if (!key || !s) return;
    try { s.removeItem(key); } catch (e) {}
    announce();
  }

  function list() {
    var s = store();
    if (!s) return [];
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var k = s.key(i);
      if (!k || k.indexOf(PREFIX) !== 0) continue;
      try {
        var rec = JSON.parse(s.getItem(k));
        if (rec) { rec.key = k; out.push(rec); }
      } catch (e) { /* skip anything unreadable */ }
    }
    return out.sort(function (a, b) { return a.savedAt < b.savedAt ? 1 : -1; });
  }

  function prune(keepDays) {
    var keep = keepDays || KEEP_DAYS;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keep);
    var cutIso = cutoff.getFullYear() + '-' + String(cutoff.getMonth() + 1).padStart(2, '0') + '-' + String(cutoff.getDate()).padStart(2, '0');
    var s = store();
    if (!s) return 0;
    var removed = 0;
    list().forEach(function (rec) {
      if ((rec.day || '') < cutIso) {
        try { s.removeItem(rec.key); removed++; } catch (e) {}
      }
    });
    return removed;
  }

  // ---- generic form capture -------------------------------------------
  // Every input/select/textarea carrying an id, which is how the worksheets
  // already define their own state.
  function captureForm(doc) {
    var out = {};
    var els = (doc || global.document).querySelectorAll('input,select,textarea');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.id) continue;
      if (el.type === 'file') continue;         // never restorable
      if (el.type === 'checkbox' || el.type === 'radio') { out[el.id] = el.checked ? '1' : ''; continue; }
      out[el.id] = el.value;
    }
    return out;
  }

  function applyForm(fields, doc) {
    if (!fields) return 0;
    var d = doc || global.document;
    var applied = 0;
    Object.keys(fields).forEach(function (id) {
      var el = d.getElementById(id);
      if (!el) return;
      if (el.type === 'file') return;
      if (el.type === 'checkbox' || el.type === 'radio') { el.checked = !!fields[id]; applied++; return; }
      el.value = fields[id];
      applied++;
    });
    return applied;
  }

  function announce() {
    try { global.dispatchEvent(new CustomEvent(CHANGE_EVENT)); } catch (e) {}
  }

  global.LabCalUnits = {
    KEEP_DAYS: KEEP_DAYS,
    CHANGE_EVENT: CHANGE_EVENT,
    keyFor: keyFor,
    save: save,
    load: load,
    has: has,
    remove: remove,
    list: list,
    prune: prune,
    captureForm: captureForm,
    applyForm: applyForm
  };
})(typeof window !== 'undefined' ? window : this);
