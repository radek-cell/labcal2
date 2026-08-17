/* ---------------------------------------------------------------------
   LabCal — vector (text) certificate generator
   ---------------------------------------------------------------------
   Draws the certificate as real text with jsPDF instead of screenshotting
   the page with html2canvas. Roughly 25 KB instead of ~400 KB, selectable,
   searchable, and sharp at any zoom.

   Coordinates are millimetres from the TOP-left of an A4 page, which is how
   jsPDF works. Every helper takes the box it draws into, so nothing is
   positioned by a hard-coded offset from the page edge.

   This covers the 19/24 Range worksheet only. The other four still use the
   image path; the setting on the home page chooses between them.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  // ---- page geometry ---------------------------------------------------
  var PW = 210, PH = 297;
  var MX = 12, MT = 11;          // margins
  var IN = PW - MX * 2;

  // ---- palette (matches the on-screen worksheet) -----------------------
  var INK = [17, 17, 17];
  var RULE = [185, 194, 203];
  var RULE_D = [139, 150, 161];
  var HDR_BG = [236, 239, 242];
  var GREEN_BG = [233, 245, 234];
  var AMBER_BG = [253, 243, 220];
  var GREY_TXT = [154, 163, 171];
  var GREY_BG = [241, 243, 245];
  var CHIP_BG = [242, 246, 250];
  var CHIP_BD = [211, 219, 227];
  var BLUE_MK = [47, 111, 208];
  var GREEN_MK = [30, 158, 82];
  var GREEN_BD = [158, 207, 168];
  var GREEN_TX = [32, 96, 58];
  var RED = [221, 51, 51];
  var SIGCOL = [26, 58, 107];
  var BADGE_BG = [228, 245, 230];
  var BADGE_TX = [30, 122, 60];
  var NOTE = [85, 85, 85];

  function val(id) {
    var el = document.getElementById(id);
    if (!el) return '';
    if (el.tagName === 'SELECT') {
      if (!el.value) return '';            // nothing chosen — not the placeholder text
      var o = el.options[el.selectedIndex];
      return o ? o.text.trim() : '';
    }
    return String(el.value || '').trim();
  }

  // Only meaningful for calculated <span>/<td> cells. A form control's
  // textContent is not its value — on a <select> it is every option's text
  // run together — so those return nothing and fall through to val().
  function txtOf(id) {
    var el = document.getElementById(id);
    if (!el) return '';
    if (el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return '';
    return String(el.textContent || '').trim();
  }

  function dash(v) { return v === '' || v == null ? '\u2013N/A\u2013' : String(v); }

  // =====================================================================
  // Drawing helpers
  // =====================================================================
  function Engine(doc) {
    this.d = doc;
    this.y = MT;
  }

  Engine.prototype.font = function (size, style) {
    this.d.setFontSize(size);
    this.d.setFont('helvetica', style || 'normal');
    return this;
  };

  Engine.prototype.fill = function (rgb) { this.d.setFillColor(rgb[0], rgb[1], rgb[2]); return this; };
  Engine.prototype.stroke = function (rgb) { this.d.setDrawColor(rgb[0], rgb[1], rgb[2]); return this; };
  Engine.prototype.colour = function (rgb) { this.d.setTextColor(rgb[0], rgb[1], rgb[2]); return this; };

  // Text with the baseline placed from the TOP of the given line.
  Engine.prototype.t = function (s, x, y, size, style, rgb, align) {
    this.font(size, style).colour(rgb || INK);
    this.d.text(String(s), x, y, align ? { align: align } : undefined);
    return this;
  };

  Engine.prototype.w = function (s, size, style) {
    this.font(size, style);
    return this.d.getTextWidth(String(s));
  };

  Engine.prototype.box = function (x, y, w, h, fillRgb, strokeRgb, lw) {
    if (fillRgb) this.fill(fillRgb);
    if (strokeRgb) { this.stroke(strokeRgb); this.d.setLineWidth(lw || 0.25); }
    this.d.rect(x, y, w, h, fillRgb && strokeRgb ? 'FD' : (fillRgb ? 'F' : 'S'));
    return this;
  };

  Engine.prototype.rbox = function (x, y, w, h, r, fillRgb, strokeRgb, lw) {
    if (fillRgb) this.fill(fillRgb);
    if (strokeRgb) { this.stroke(strokeRgb); this.d.setLineWidth(lw || 0.2); }
    this.d.roundedRect(x, y, w, h, r, r, fillRgb && strokeRgb ? 'FD' : (fillRgb ? 'F' : 'S'));
    return this;
  };

  Engine.prototype.line = function (x1, y1, x2, y2, rgb, lw) {
    this.stroke(rgb || RULE); this.d.setLineWidth(lw || 0.25);
    this.d.line(x1, y1, x2, y2);
    return this;
  };

  Engine.prototype.star = function (x, y) {
    this.t('*', x, y, 5.5, 'bold', RED);
    return this;
  };

  // Label with its red required marker, returns where the value should start.
  Engine.prototype.label = function (text, x, y, size, required) {
    this.t(text, x, y, size);
    var w = this.w(text, size);
    if (required) {
      this.star(x + w + 0.5, y - 1.2);
      this.t(':', x + w + 2, y, size);
      return x + w + 4;
    }
    return x + w + 1.5;
  };

  Engine.prototype.badge = function (text, x, y, w, h) {
    h = h || 4.4;
    this.rbox(x, y, w, h, 1.2, BADGE_BG, GREEN_BD, 0.2);
    this.t(text, x + w / 2, y + h - 1.4, 6, 'bold', BADGE_TX, 'center');
    return this;
  };

  Engine.prototype.pill = function (text, x, y, w, h, size) {
    h = h || 4.8;
    this.rbox(x, y, w, h, 2.2, [255, 255, 255], RULE_D, 0.25);
    this.t(text, x + w / 2, y + h - 1.5, size || 6.8, 'normal', INK, 'center');
    return this;
  };

  Engine.prototype.chip = function (text, x, y, w, h) {
    h = h || 4.2;
    this.rbox(x, y, w, h, 1, GREY_BG, null);
    this.t(text, x + w / 2, y + h - 1.3, 6.8, 'normal', GREY_TXT, 'center');
    return this;
  };

  // =====================================================================
  // Certificate — Standard 19 range / 24 range
  // =====================================================================
  function build19_24() {
    var jsPDFctor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!jsPDFctor) throw new Error('The PDF library did not load.');
    var doc = new jsPDFctor({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

    // signature font
    var haveScript = false;
    try {
      if (global.LabCalDancingFont) {
        doc.addFileToVFS('DancingScript.ttf', global.LabCalDancingFont);
        doc.addFont('DancingScript.ttf', 'DancingScript', 'normal');
        haveScript = true;
      }
    } catch (e) { haveScript = false; }

    var e = new Engine(doc);
    var y = MT;

    // ---------------- header ----------------
    e.t('Engineer Calibration Worksheet', MX, y + 5, 14, 'bold');
    e.t('Standard 19 range/24 range', MX, y + 9.6, 7.5, 'bold', [40, 70, 120]);
    e.t('LABCOLD', PW - MX, y + 6.5, 19, 'bold', INK, 'right');
    (function snowflake(cx, cy, r) {
      e.stroke([91, 155, 213]); doc.setLineWidth(0.45);
      for (var i = 0; i < 3; i++) {
        var a = (Math.PI / 3) * i;
        doc.line(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
    })(PW - MX - 41, y + 4.5, 2.6);
    var noX = PW - MX - 30;
    e.t('No', noX - 4, y + 12.5, 9, 'normal', INK, 'right');
    e.star(noX - 3.5, y + 11.3);
    e.t(':', noX - 1, y + 12.5, 9);
    e.t(val('certNo') || txtOf('certNo'), noX + 3, y + 12.5, 12.5, 'bold');
    e.line(noX + 1, y + 14, PW - MX, y + 14, INK, 0.4);
    y += 18;

    // ---------------- meta ----------------
    var META = [
      ['Job Reference No', val('jobRef'), 'Date', val('date') || val('dateNative')],
      ['Site', val('site'), 'Department', val('department')],
      ['Model', val('model'), 'Serial No', val('serial')],
      ['Manufacturer', val('manufacturer') === 'Other...' ? val('manufacturerOther') : val('manufacturer'),
        'Load', val('load')]
    ];
    var half = IN / 2;
    META.forEach(function (r, i) {
      var yy = y + i * 5.2;
      [[r[0], r[1], MX], [r[2], r[3], MX + half]].forEach(function (pair) {
        e.t(pair[0], pair[2], yy, 8);
        var w = e.w(pair[0], 8);
        e.star(pair[2] + w + 0.6, yy - 1.2);
        e.t(':', pair[2] + w + 2.4, yy, 8);
        e.t(pair[1], pair[2] + 34, yy, 8.5, 'bold');
        e.stroke(RULE_D); doc.setLineWidth(0.15);
        doc.setLineDashPattern([0.4, 0.6], 0);
        doc.line(pair[2] + 33, yy + 1.4, pair[2] + half - 6, yy + 1.4);
        doc.setLineDashPattern([], 0);
      });
    });
    y += META.length * 5.2 + 3;

    // ---------------- reference thermometer ----------------
    e.t('Digital Reference Thermometer Serial No', MX + 2, y + 3, 7.5);
    e.pill(val('drtSerial') || '\u2014', MX + 62, y, 34, 4.8, 7);
    e.t('Cal due date:', MX + 100, y + 3, 7.5);
    e.t(txtOf('drtDue') || val('drtDue') || '\u2014', MX + 122, y + 3, 8.5, 'bold');
    var drtStatus = txtOf('drtCalStatus');
    if (drtStatus) e.badge(drtStatus, MX + 140, y, IN - 140, 4.6);
    y += 8;

    // ---------------- room temp + controller ----------------
    var LAB_W = 32, RT_H = 8, CT_ROW = 6.4;
    var blockH = RT_H + CT_ROW * 2;
    e.box(MX, y, IN, blockH, null, RULE_D, 0.25);
    e.line(MX + LAB_W, y, MX + LAB_W, y + blockH, RULE_D, 0.25);
    e.line(MX, y + RT_H, MX + IN, y + RT_H, RULE_D, 0.18);
    e.line(MX + LAB_W, y + RT_H + CT_ROW, MX + IN, y + RT_H + CT_ROW, RULE_D, 0.18);

    e.t('Room Temperature (RT)', MX + 2, y + 5.2, 6.8, 'bold');
    var rtCols = [56, 28, 20, 20, IN - LAB_W - 124];
    var xs = [], acc = MX + LAB_W;
    rtCols.forEach(function (w) { xs.push([acc, w]); acc += w; });
    xs.slice(1).forEach(function (col) { e.line(col[0], y, col[0], y + RT_H, RULE_D, 0.18); });

    var rtMid = y + 5.2;
    var vx = e.label('RT Ref', xs[0][0] + 2, rtMid, 7, true);
    e.pill(val('rtRef') || '\u2014', xs[0][0] + 13, y + 1.6, 18, 4.8, 6.8);
    var rtv = txtOf('rtRefValidity');
    if (rtv) e.badge(rtv, xs[0][0] + 33, y + 1.8, xs[0][1] - 35, 4.4);

    [[xs[1], 'Cal due:', txtOf('rtDue') || val('rtDue'), false, null],
     [xs[2], 'Max', val('rtMax'), true, GREEN_BG],
     [xs[3], 'Min', val('rtMin'), true, GREEN_BG],
     [xs[4], 'Average:', txtOf('rtAvg') || val('rtAvg'), false, null]
    ].forEach(function (col) {
      var x = col[0][0], w = col[0][1];
      if (col[4]) e.box(x + 0.2, y + 0.2, w - 0.4, RT_H - 0.4, col[4], null);
      var vxx = e.label(col[1], x + 2, rtMid, 7, col[3]);
      e.t(col[2] || '\u2014', vxx + 1, rtMid, 8.5, 'bold');
    });

    e.t('Controller Settings', MX + 2, y + RT_H + CT_ROW - 1.6, 6.8, 'bold');
    var ctSplit = MX + LAB_W + 72;
    e.line(ctSplit, y + RT_H, ctSplit, y + blockH, RULE_D, 0.18);

    function ctLine(top, offLabel, v1, v2, spLabel, spVal, note, greyed) {
      var mid = top + CT_ROW - 2.2;
      var x = MX + LAB_W + 2;
      x = e.label(offLabel, x, mid, 6.8, true);
      [['Cal 1:', v1], ['Cal 2:', v2]].forEach(function (p, i) {
        var bx = x + i * 25;
        e.t(p[0], bx, mid, 6.8);
        if (greyed) e.chip(p[1], bx + 9, mid - 3.1, 13);
        else e.t(p[1] || '\u2014', bx + 10, mid, 7.8, 'bold');
      });
      var sx = e.label(spLabel, ctSplit + 2, mid, 6.8, true);
      if (greyed) e.chip(spVal, sx + 1, mid - 3.1, 14);
      else {
        e.t(spVal || '\u2014', sx + 1, mid, 8.5, 'bold');
        if (note) e.t(note, sx + 13, mid, 6.2, 'normal', [50, 90, 160]);
      }
    }

    var nearest = txtOf('initialNearestPoint');
    ctLine(y + RT_H, 'Initial offsets', val('initialOffsetsCal1'), val('initialOffsetsCal2'),
           'Initial set point', val('initialSetpoint'),
           nearest && nearest !== '\u2014' ? 'Nearest offset point used: ' + nearest : '', false);
    function alHasReadings() {
      var ids = ['al_air_display', 'al_load_display',
                 'al_air1_max', 'al_air2_max', 'al_load1_max', 'al_load2_max',
                 'al_air1_min', 'al_air2_min', 'al_load1_min', 'al_load2_min'];
      return ids.some(function (id) {
        var v = val(id);
        return v !== '' && !isNaN(parseFloat(v));
      });
    }
    var alDone = alHasReadings();
    ctLine(y + RT_H + CT_ROW, 'Final offsets',
           alDone ? val('finalOffsetsCal1') : 'N/A', alDone ? val('finalOffsetsCal2') : 'N/A',
           'Final set point', alDone ? val('finalSetpoint') : '\u2013N/A\u2013', '', !alDone);
    y += blockH + 2.5;

    // ---------------- status banner ----------------
    function banner(text, h, size) {
      e.box(MX, y, IN, h, GREEN_BG, GREEN_BD, 0.2);
      e.t(text, MX + 3, y + h - 2, size || 8, 'bold', GREEN_TX);
      y += h + 1.6;
    }
    var afStatus = txtOf('afStatus');
    banner(afStatus || 'As Found: within tolerance.', 6, 7.8);

    // ---------------- measurement tables ----------------
    var TLAB = 40, COL = (IN - TLAB) / 4;

    function tableHeader(title) {
      var hh = 5;
      e.box(MX, y, IN, hh, HDR_BG, RULE_D, 0.25);
      e.t(title, MX + 2, y + hh - 1.4, 7.5, 'bold');
      e.line(MX + TLAB, y, MX + TLAB, y + hh, RULE_D, 0.25);
      e.t('Air (T1)', MX + TLAB + COL, y + hh - 1.4, 7.5, 'bold', INK, 'center');
      e.line(MX + TLAB + 2 * COL, y, MX + TLAB + 2 * COL, y + hh, RULE_D, 0.25);
      e.t('Load (T2)', MX + TLAB + 3 * COL, y + hh - 1.4, 7.5, 'bold', INK, 'center');
      y += hh;
      var sh = 4.6;
      e.box(MX, y, IN, sh, HDR_BG, RULE_D, 0.25);
      e.line(MX + TLAB, y, MX + TLAB, y + sh, RULE_D, 0.25);
      ['Left', 'Right', 'Left', 'Right'].forEach(function (lab, i) {
        var cx = MX + TLAB + i * COL;
        if (i) e.line(cx, y, cx, y + sh, RULE_D, 0.18);
        var dot = lab === 'Left' ? [47, 111, 208] : [217, 131, 36];
        e.fill(dot); doc.circle(cx + COL / 2 - 7, y + sh / 2, 1.6, 'F');
        e.t(lab === 'Left' ? 'L' : 'R', cx + COL / 2 - 7, y + sh / 2 + 0.8, 5.5, 'bold', [255, 255, 255], 'center');
        e.t(lab, cx + COL / 2 - 4.6, y + sh - 1.4, 7);
      });
      y += sh;
    }

    function trow(label, vals, opt) {
      opt = opt || {};
      var h = opt.h || 4.95;
      var top = y;
      var lines = Array.isArray(label) ? label : [label];
      e.box(MX, top, IN, h, [255, 255, 255], null);
      // tints
      if (opt.tint) {
        if (opt.merged) {
          [[0, 2], [2, 2]].forEach(function (sp) {
            e.box(MX + TLAB + sp[0] * COL + 0.2, top + 0.2, sp[1] * COL - 0.4, h - 0.4, opt.tint, null);
          });
        } else {
          for (var i = 0; i < 4; i++) e.box(MX + TLAB + i * COL + 0.2, top + 0.2, COL - 0.4, h - 0.4, opt.tint, null);
        }
      }
      // label
      var lead = 2.2;
      var first = top + h / 2 - (lead * (lines.length - 1)) / 2 + 0.9;
      lines.forEach(function (ln, i) {
        e.t(ln, MX + 2, first + i * lead, lines.length > 1 ? 6 : 7,
            opt.bold ? 'bold' : 'normal', opt.grey ? GREY_TXT : INK);
      });
      if (opt.required) e.star(MX + 2 + e.w(lines[0], lines.length > 1 ? 6 : 7) + 0.6, first - 1.1);
      // values
      if (opt.merged) {
        [[0, 2], [2, 2]].forEach(function (sp, si) {
          var cx = MX + TLAB + sp[0] * COL;
          e.t(dash(vals[si]), cx + sp[1] * COL / 2, top + h / 2 + 1.2, 8.5, 'bold',
              opt.grey ? GREY_TXT : INK, 'center');
        });
      } else {
        vals.forEach(function (v, i) {
          var cx = MX + TLAB + i * COL;
          var greyThis = opt.grey || (opt.greyvals && opt.greyvals.indexOf(i) !== -1);
          if (opt.boxed) {
            var CH = 4.4, CW = COL - 10;
            var bx = cx + (COL - CW) / 2, by = top + (h - CH) / 2;
            e.rbox(bx, by, CW, CH, 0.8, greyThis ? GREY_BG : CHIP_BG, CHIP_BD, 0.2);
            e.t(String(v || '\u2014'), cx + COL / 2, by + CH - 1.4, 7.2,
                greyThis ? 'normal' : 'bold', greyThis ? GREY_TXT : INK, 'center');
            if (opt.strike) {
              var tw = e.w(String(v || ''), 7.2);
              e.line(cx + COL / 2 - tw / 2 - 0.6, by + CH / 2 + 0.2,
                     cx + COL / 2 + tw / 2 + 0.6, by + CH / 2 + 0.2, GREY_TXT, 0.2);
            }
          } else {
            e.t(dash(v), cx + COL / 2, top + h / 2 + 1.2, 8.5,
                opt.bold ? 'bold' : 'normal', greyThis ? GREY_TXT : INK, 'center');
          }
          if (opt.marks && opt.marks[i]) {
            e.line(cx + 3, top + h - 1, cx + COL - 3, top + h - 1,
                   opt.marks[i] === 'blue' ? BLUE_MK : GREEN_MK, 0.45);
          }
        });
      }
      // grid
      e.line(MX, top + h, MX + IN, top + h, RULE, 0.18);
      for (var g = 0; g <= 4; g++) {
        if (opt.merged && (g === 1 || g === 3)) continue;
        var gx = MX + TLAB + g * COL;
        e.line(gx, top, gx, top + h, RULE, 0.18);
      }
      e.line(MX, top, MX, top + h, RULE_D, 0.25);
      e.line(MX + IN, top, MX + IN, top + h, RULE_D, 0.25);
      y = top + h;
    }

    // which corrected max/min were used (the blue and green underlines)
    function markers(prefix, key) {
      var ids = [prefix + '_air1_' + key + '_calc', prefix + '_air2_' + key + '_calc',
                 prefix + '_load1_' + key + '_calc', prefix + '_load2_' + key + '_calc'];
      var nums = ids.map(function (id) {
        var t = txtOf(id) || val(id);
        var n = parseFloat(t);
        return isNaN(n) ? null : n;
      });
      var live = nums.filter(function (n) { return n !== null; });
      if (!live.length) return null;
      var target = key === 'max' ? Math.max.apply(null, live) : Math.min.apply(null, live);
      var out = {};
      nums.forEach(function (n, i) {
        if (n !== null && Math.abs(n - target) < 1e-9) out[i] = key === 'max' ? 'blue' : 'green';
      });
      return out;
    }

    function cellset(prefix, key) {
      return [prefix + '_air1_' + key, prefix + '_air2_' + key,
              prefix + '_load1_' + key, prefix + '_load2_' + key].map(function (id) {
        return txtOf(id) || val(id);
      });
    }

    function measurementTable(prefix, title, greyed) {
      tableHeader(title);
      trow(prefix === 'af' ? 'Probe Serial No' : ['Probe Serial No: (same', 'as As Found)'],
           cellset(prefix, 'probe'),
           { boxed: true, required: prefix === 'af', h: 5.6,
             greyvals: greyed ? [0, 1, 2, 3] : [], strike: greyed });
      trow('Display (from product)',
           [txtOf(prefix + '_air_display') || val(prefix + '_air_display'),
            txtOf(prefix + '_load_display') || val(prefix + '_load_display')],
           { merged: true, tint: greyed ? GREY_BG : GREEN_BG, bold: true, required: true, grey: greyed });
      trow('Reference Max', cellset(prefix, 'max'),
           { tint: greyed ? GREY_BG : GREEN_BG, required: true, grey: greyed, greyvals: greyed ? [] : [2, 3] });
      trow('Probe Correction value', cellset(prefix, 'max_corr'),
           { tint: greyed ? GREY_BG : AMBER_BG, grey: greyed });
      trow('Max + Correction', cellset(prefix, 'max_calc'),
           { bold: true, grey: greyed, marks: greyed ? null : markers(prefix, 'max') });
      trow('Reference Min', cellset(prefix, 'min'),
           { tint: greyed ? GREY_BG : GREEN_BG, required: true, grey: greyed, greyvals: greyed ? [] : [2, 3] });
      trow('Probe Correction Value', cellset(prefix, 'min_corr'),
           { tint: greyed ? GREY_BG : AMBER_BG, grey: greyed });
      trow('Min + Correction', cellset(prefix, 'min_calc'),
           { bold: true, grey: greyed, marks: greyed ? null : markers(prefix, 'min') });
      trow(['Average ref: Min & Max', '(after correction)'],
           [txtOf(prefix + '_air_avg') || val(prefix + '_air_avg'),
            txtOf(prefix + '_load_avg') || val(prefix + '_load_avg')],
           { merged: true, bold: true, h: 6.5, tint: greyed ? GREY_BG : null, grey: greyed });
      trow(['Difference of Average', 'Reference vs Display'],
           [txtOf(prefix + '_air_diff') || val(prefix + '_air_diff'),
            txtOf(prefix + '_load_diff') || val(prefix + '_load_diff')],
           { merged: true, bold: true, h: 6.5, tint: greyed ? GREY_BG : GREEN_BG, grey: greyed });
    }

    measurementTable('af', 'As Found (AF)', false);
    y += 1.6;

    var adjNeeded = alDone;
    banner(adjNeeded
      ? 'Adjustment carried out \u2014 see the As Left readings below.'
      : 'Adjustment not needed \u2014 Air and Load are within tolerance, so As Left and AL Display cycle are crossed out.',
      6, 7.6);

    measurementTable('al', 'As Left (AL)', !adjNeeded);
    y += 2;

    // ---------------- display cycle ----------------
    var DCW = [24, 22, 22, 26, 34, 38];
    var tot = DCW.reduce(function (a, b) { return a + b; }, 0);
    DCW = DCW.map(function (w) { return w * IN / tot; });
    var hh = 5;
    e.box(MX, y, IN, hh, HDR_BG, RULE_D, 0.25);
    var cx = MX;
    ['Display cycle', 'Max', 'Min', 'Average used', 'AF Probes in:', 'Cycle start:'].forEach(function (lab, i) {
      e.t(lab, cx + DCW[i] / 2, y + hh - 1.4, 7.3, 'bold', INK, 'center');
      if (i) e.line(cx, y, cx, y + hh, RULE_D, 0.25);
      cx += DCW[i];
    });
    y += hh;

    var rh = 5.4;
    var DC = [
      ['AF', 'Air (T1)', 'af_cycle_air_max', 'af_cycle_air_min', 'af_cycle_air_avg', false],
      ['AF', 'Load (T2)', 'af_cycle_load_max', 'af_cycle_load_min', 'af_cycle_load_avg', false],
      ['AL', 'Air (T1)', 'al_cycle_air_max', 'al_cycle_air_min', 'al_cycle_air_avg', !adjNeeded],
      ['AL', 'Load (T2)', 'al_cycle_load_max', 'al_cycle_load_min', 'al_cycle_load_avg', !adjNeeded]
    ];
    DC.forEach(function (r, idx) {
      var top = y, grey = r[5];
      var tint = grey ? GREY_BG : GREEN_BG;
      var cxx = MX + DCW[0];
      for (var i = 1; i <= 3; i++) {
        e.box(cxx + 0.2, top + 0.2, DCW[i] - 0.4, rh - 0.4, tint, null);
        cxx += DCW[i];
      }
      if (idx % 2 === 0) {
        e.box(MX + 0.2, top + 0.2, DCW[0] * 0.42, rh * 2 - 0.4, HDR_BG, null);
        e.t(r[0], MX + DCW[0] * 0.21, top + rh + 1, 7.5, 'bold', INK, 'center');
      }
      e.t(r[1], MX + DCW[0] * 0.46, top + rh - 1.8, 7, 'normal', grey ? GREY_TXT : INK);
      cxx = MX + DCW[0];
      [r[2], r[3], r[4]].forEach(function (id, i) {
        var v = txtOf(id) || val(id);
        e.t(dash(v), cxx + DCW[i + 1] / 2, top + rh - 1.8, 8.5, 'bold', grey ? GREY_TXT : INK, 'center');
        cxx += DCW[i + 1];
      });
      // right-hand pair of columns carries the timings
      var tx = MX + DCW[0] + DCW[1] + DCW[2] + DCW[3];
      if (idx === 0) {
        e.t(val('af_probes_in_h') || '\u2014', tx + 10, top + rh - 1.8, 8.5, 'bold', INK, 'center');
        e.t(':', tx + 17, top + rh - 1.8, 8, 'normal', INK, 'center');
        e.t(val('af_probes_in_m') || '\u2014', tx + 24, top + rh - 1.8, 8.5, 'bold', INK, 'center');
        var sx = tx + DCW[4];
        e.t(val('af_cycle_start_h') || '\u2014', sx + 10, top + rh - 1.8, 8.5, 'bold', INK, 'center');
        e.t(':', sx + 17, top + rh - 1.8, 8, 'normal', INK, 'center');
        e.t(val('af_cycle_start_m') || '\u2014', sx + 24, top + rh - 1.8, 8.5, 'bold', INK, 'center');
      } else if (idx === 1) {
        e.t('AL Adj made:', tx + 1.5, top + rh - 1.8, 6.8);
        var adjTxt = val('al_adj_made') || (adjNeeded ? 'Adjustment made' : 'Adjustment not needed');
        e.chip(adjTxt, tx + DCW[4] + 1, top + 1.2, DCW[5] - 2);
      } else if (idx === 2) {
        var lx = e.label('Cycle start', tx + 1.5, top + rh - 1.8, 6.8, true);
        if (adjNeeded) {
          e.t(val('al_cycle_start_h') || '\u2014', tx + DCW[4] + 8, top + rh - 1.8, 8.5, 'bold', INK, 'center');
          e.t(':', tx + DCW[4] + 15, top + rh - 1.8, 8, 'normal', INK, 'center');
          e.t(val('al_cycle_start_m') || '\u2014', tx + DCW[4] + 22, top + rh - 1.8, 8.5, 'bold', INK, 'center');
        } else {
          e.chip('N/A', tx + DCW[4] + 4, top + 1.2, 9);
          e.t(':', tx + DCW[4] + 15, top + rh - 1.8, 7, 'normal', GREY_TXT, 'center');
          e.chip('N/A', tx + DCW[4] + 18, top + 1.2, 9);
        }
      }
      e.line(MX, top + rh, MX + IN, top + rh, RULE, 0.18);
      var gx = MX;
      DCW.forEach(function (w) { gx += w; e.line(gx, top, gx, top + rh, RULE, 0.18); });
      e.line(MX, top, MX, top + rh, RULE_D, 0.25);
      e.line(MX + IN, top, MX + IN, top + rh, RULE_D, 0.25);
      y = top + rh;
    });
    y += 2.5;

    // ---------------- signatures ----------------
    var SIG_H = 9.1;
    [["Engineer's Name", val('engineer'), val('engineerSignature') || val('engineer'), val('engDate') || val('date'), true],
     ["Checker's Name:", val('checker'), val('checkerSignature'), val('checkDate'), false]
    ].forEach(function (r) {
      var top = y;
      e.box(MX, top, IN, SIG_H, null, RULE_D, 0.25);
      var a = MX + IN * 0.36, b = MX + IN * 0.68;
      e.line(a, top, a, top + SIG_H, RULE_D, 0.25);
      e.line(b, top, b, top + SIG_H, RULE_D, 0.25);
      e.t(r[0], MX + 2, top + 3.4, 7.3);
      if (r[4]) {
        var lw = e.w(r[0], 7.3);
        e.star(MX + 2 + lw + 0.6, top + 2.2);
        e.t(':', MX + 2 + lw + 2.4, top + 3.4, 7.3);
      }
      if (r[1]) e.t(r[1], MX + 5, top + 7.6, 8.5, 'bold');
      e.t('Signature:', a + 2, top + 3.4, 7.3);
      if (r[2]) {
        if (haveScript) {
          doc.setFont('DancingScript', 'normal');
          doc.setFontSize(13);
          doc.setTextColor(SIGCOL[0], SIGCOL[1], SIGCOL[2]);
          doc.text(String(r[2]), a + 5, top + 8);
          doc.setFont('helvetica', 'normal');
        } else {
          e.t(r[2], a + 5, top + 8, 11, 'italic', SIGCOL);
        }
      }
      e.t('Date:', b + 2, top + 3.4, 7.3);
      if (r[3]) e.t(r[3], b + 6, top + 7.6, 8.5, 'bold');
      y = top + SIG_H;
    });
    y += 2.5;

    // ---------------- comments ----------------
    var comH = 12;
    e.box(MX, y, IN, comH, null, RULE_D, 0.25);
    e.box(MX + 0.2, y + 0.2, IN - 0.4, 5.4, HDR_BG, null);
    e.t('Comments', MX + 2, y + 4, 8.5, 'bold');
    e.t('(calculations, deviations, customer requests)', MX + 20, y + 4, 7.3, 'normal', NOTE);
    var comments = val('comments');
    if (comments) {
      var lines = doc.splitTextToSize(comments, IN - 6);
      lines.slice(0, 4).forEach(function (ln, i) {
        e.t(ln, MX + 3, y + 8.6 + i * 3.4, 8);
      });
    }
    y += comH;

    // A layout that runs past the page edge is a bug, not a certificate.
    if (y > PH - 6) {
      console.warn('LabCal vector PDF: content ran to ' + y.toFixed(1) + ' mm (page is ' + PH + ' mm).');
    }

    return doc;
  }

  global.LabCalVectorPdf = {
    supports: function (sheet) { return sheet === 'ws19_24'; },
    build19_24: build19_24,
    blob19_24: function () { return build19_24().output('blob'); }
  };
})(typeof window !== 'undefined' ? window : this);
