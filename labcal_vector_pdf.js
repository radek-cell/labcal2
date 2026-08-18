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

  // A "Generated <date time>" line was useful for telling a regenerated
  // certificate from the one it replaced, but on a UKAS document a timestamp
  // later than the calibration date invites awkward questions. Off unless
  // this is turned back on deliberately.
  var SHOW_GENERATED_STAMP = false;
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

  // The built-in PDF fonts cover Latin-1 only; anything else (ticks, arrows)
  // comes out as a stray glyph. Drop it rather than print rubbish.
  // jsPDF's standard fonts use WinAnsi, which DOES include en/em dashes and
  // curly quotes but NOT ticks, snowflakes or arrows. Strip only what it
  // genuinely cannot draw — an earlier version of this took the em dash out of
  // "Adjustment not needed — Air and Load..." as collateral damage.
  var UNSUPPORTED = /[\u2713\u2714\u2716\u2717\u2718\u2744\u2190-\u21FF\u2600-\u27BF]/g;
  var KEEP = '\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u20AC';
  function ascii(v) {
    return String(v == null ? '' : v)
      .replace(UNSUPPORTED, '')
      .replace(new RegExp('[^\\x20-\\xFF' + KEEP + ']', 'g'), '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // A room thermometer reads "UKAS107 (valid until Aug/2026)" on screen. The
  // validity is already shown in its own badge, so only the serial is needed.
  // Pull "Jan/2027" out of a cell that may also carry a validity badge.
  function monthYear(v) {
    var m = ascii(v).match(/([A-Za-z]{3}\/\d{4}|\d{4}-\d{2})/);
    return m ? m[1] : '';
  }

  function serialOnly(v) {
    return ascii(v).split(' (')[0].trim();
  }

  function mmss(mins, secs) {
    if (!mins && !secs) return '\u2014';
    var m = String(mins || '0'), sc = String(secs || '0');
    return m + ' min ' + (sc.length < 2 ? '0' + sc : sc) + ' sec';
  }

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
    this.d.text(ascii(s), x, y, align ? { align: align } : undefined);
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
    var label = ascii(text);
    var size = 6;
    while (size > 4.4 && this.w(label, size, 'bold') > w - 7) size -= 0.2;
    this.rbox(x, y, w, h, 1.2, BADGE_BG, GREEN_BD, 0.2);
    // a drawn tick, since the character is not in the standard font
    var tx = x + 2, ty = y + h / 2;
    this.stroke(BADGE_TX); this.d.setLineWidth(0.35);
    this.d.line(tx - 0.6, ty, tx + 0.1, ty + 0.8);
    this.d.line(tx + 0.1, ty + 0.8, tx + 1.3, ty - 0.9);
    this.t(label, x + 4.4 + (w - 6) / 2, y + h - 1.4, size, 'bold', BADGE_TX, 'center');
    return this;
  };

  Engine.prototype.pill = function (text, x, y, w, h, size) {
    h = h || 4.8;
    var label = ascii(text);
    var sz = size || 6.8;
    while (sz > 4.6 && this.w(label, sz) > w - 2.5) sz -= 0.2;
    this.rbox(x, y, w, h, 2.2, [255, 255, 255], RULE_D, 0.25);
    this.t(label, x + w / 2, y + h - 1.5, sz, 'normal', INK, 'center');
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
    var drtStatus = ascii(txtOf('drtCalStatus'));
    if (drtStatus) e.badge(drtStatus, MX + 140, y, IN - 142, 4.6);
    y += 8;

    // ---------------- room temp + controller ----------------
    var LAB_W = 32, RT_H = 8, CT_ROW = 6.4;
    var blockH = RT_H + CT_ROW * 2;
    e.box(MX, y, IN, blockH, null, RULE_D, 0.25);
    e.line(MX + LAB_W, y, MX + LAB_W, y + blockH, RULE_D, 0.25);
    e.line(MX, y + RT_H, MX + IN, y + RT_H, RULE_D, 0.18);
    e.line(MX + LAB_W, y + RT_H + CT_ROW, MX + IN, y + RT_H + CT_ROW, RULE_D, 0.18);

    e.t('Room Temperature (RT)', MX + 2, y + 5.2, 6.8, 'bold');
    var rtCols = [56, 29, 20, 20, IN - LAB_W - 125];
    var xs = [], acc = MX + LAB_W;
    rtCols.forEach(function (w) { xs.push([acc, w]); acc += w; });
    xs.slice(1).forEach(function (col) { e.line(col[0], y, col[0], y + RT_H, RULE_D, 0.18); });

    var rtMid = y + 5.2;
    var vx = e.label('RT Ref', xs[0][0] + 2, rtMid, 7, true);
    e.pill(serialOnly(val('rtRef')) || '\u2014', xs[0][0] + 13, y + 1.6, 19, 4.8, 6.8);
    var rtv = ascii(txtOf('rtRefValidity'));
    if (rtv) e.badge(rtv, xs[0][0] + 34, y + 1.8, xs[0][1] - 36, 4.4);

    [[xs[1], 'Cal due:', txtOf('rtDue') || val('rtDue'), false, null],
     [xs[2], 'Max', val('rtMax'), true, null],
     [xs[3], 'Min', val('rtMin'), true, null],
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
      var h = opt.h || 4.7;
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
           { boxed: true, required: prefix === 'af', h: 5.4,
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
           { merged: true, bold: true, h: 6.2, tint: greyed ? GREY_BG : null, grey: greyed });
      trow(['Difference of Average', 'Reference vs Display'],
           [txtOf(prefix + '_air_diff') || val(prefix + '_air_diff'),
            txtOf(prefix + '_load_diff') || val(prefix + '_load_diff')],
           { merged: true, bold: true, h: 6.2, tint: greyed ? GREY_BG : GREEN_BG, grey: greyed });
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
    // The box grows to fit whatever is written, and anything that still will
    // not fit continues on a second page. An earlier version capped this at
    // four lines and threw the rest away silently.
    var comments = val('comments');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    var comLines = comments ? doc.splitTextToSize(comments, IN - 6) : [];
    var HEAD_H = 5.0, LINE_H = 3.3, PAD_TOP = 2.6, PAD_BOT = 1.8, FOOT_H = 4.4;
    var availH = (PH - 6 - FOOT_H) - y;
    var maxLines = Math.max(0, Math.floor((availH - HEAD_H - PAD_TOP - PAD_BOT) / LINE_H));
    var shown = comLines.slice(0, maxLines);
    var overflow = comLines.slice(maxLines);
    var comH = Math.max(12, HEAD_H + PAD_TOP + shown.length * LINE_H + PAD_BOT);

    function commentsHeader(top, suffix) {
      e.box(MX, top, IN, HEAD_H, HDR_BG, null);
      e.t('Comments' + (suffix || ''), MX + 2, top + 4, 8.5, 'bold');
      if (!suffix) e.t('(calculations, deviations, customer requests)', MX + 20, top + 4, 7.3, 'normal', NOTE);
    }

    // Three cases: it all fits, there is nothing to say, or it needs page 2.
    // When it needs page 2, page 1 gets a one-line pointer rather than an
    // empty box that pushes the layout past the page edge.
    var goesOverleaf = overflow.length > 0;
    if (!goesOverleaf) {
      e.box(MX, y, IN, comH, null, RULE_D, 0.25);
      commentsHeader(y + 0.2);
      shown.forEach(function (ln, i) {
        e.t(ln, MX + 3, y + HEAD_H + PAD_TOP + i * LINE_H, 8);
      });
      y += comH;
    } else {
      var noteH = 7;
      e.box(MX, y, IN, noteH, null, RULE_D, 0.25);
      e.box(MX + 0.2, y + 0.2, IN - 0.4, noteH - 0.4, HDR_BG, null);
      e.t('Comments', MX + 2, y + 4.6, 8.5, 'bold');
      e.t('\u2014 continued on page 2', MX + 22, y + 4.6, 7.3, 'italic', NOTE);
      y += noteH;
      overflow = comLines;   // put the whole comment on page 2, not a fragment
    }

    // A line saying when this copy was produced, so a regenerated certificate
    // can be told apart from the one it replaced.
    var stamp = new Date();
    function two(n) { return String(n).padStart(2, '0'); }
    var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var stampTxt = 'Generated ' + two(stamp.getDate()) + '/' + MONTHS[stamp.getMonth()] + '/' + stamp.getFullYear()
                 + ' ' + two(stamp.getHours()) + ':' + two(stamp.getMinutes());
    if (SHOW_GENERATED_STAMP) e.t(stampTxt, MX, y + 3.4, 6.2, 'normal', NOTE);
    if (goesOverleaf) e.t('Page 1 of 2', PW - MX, y + 3.4, 6.2, 'normal', NOTE, 'right');
    y += FOOT_H;

    // ---------------- page 2, only if the comments need it ----------------
    if (overflow.length) {
      doc.addPage();
      var y2 = MT;
      e.t('Engineer Calibration Worksheet', MX, y2 + 5, 12, 'bold');
      e.t('Standard 19 range/24 range \u2014 continuation', MX, y2 + 9.2, 7.5, 'bold', [40, 70, 120]);
      e.t('No: ' + (val('certNo') || ''), PW - MX, y2 + 5, 11, 'bold', INK, 'right');
      e.t([val('site'), val('serial'), val('jobRef')].filter(Boolean).join('  \u00b7  '),
          PW - MX, y2 + 9.2, 7, 'normal', NOTE, 'right');
      e.line(MX, y2 + 11.5, PW - MX, y2 + 11.5, RULE_D, 0.3);
      y2 += 15;
      var perPage = Math.floor((PH - 16 - y2 - HEAD_H - PAD_TOP - PAD_BOT) / LINE_H);
      var rest = overflow.slice(0, perPage);
      var boxH = HEAD_H + PAD_TOP + rest.length * LINE_H + PAD_BOT;
      e.box(MX, y2, IN, boxH, null, RULE_D, 0.25);
      commentsHeader(y2 + 0.2, ' (continued)');
      rest.forEach(function (ln, i) {
        e.t(ln, MX + 3, y2 + HEAD_H + PAD_TOP + i * LINE_H, 8);
      });
      y2 += boxH;
      if (overflow.length > perPage) {
        e.t('\u2026 ' + (overflow.length - perPage) + ' further line(s) not shown \u2014 shorten the comments.',
            MX, y2 + 4, 6.5, 'italic', RED);
      }
      if (SHOW_GENERATED_STAMP) e.t(stampTxt, MX, PH - 8, 6.2, 'normal', NOTE);
      e.t('Page 2 of 2', PW - MX, PH - 8, 6.2, 'normal', NOTE, 'right');
    }

    // A layout that runs past the page edge is a bug, not a certificate.
    if (y > PH - 6) {
      console.warn('LabCal vector PDF: content ran to ' + y.toFixed(1) + ' mm (page is ' + PH + ' mm).');
    }

    return doc;
  }

  // =====================================================================
  // Certificate — Barkey
  // =====================================================================
  // Same page furniture as the 19/24 sheet, but the Barkey worksheet is a
  // single column of readings with a specification and a pass/fail tick per
  // row, plus a stopwatch check.
  function buildBarkey() {
    var jsPDFctor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!jsPDFctor) throw new Error('The PDF library did not load.');
    var doc = new jsPDFctor({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

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
    e.t('LABCOLD', MX, y + 6.5, 19, 'bold');
    (function snowflake(cx, cy, r) {
      e.stroke([91, 155, 213]); doc.setLineWidth(0.45);
      for (var i = 0; i < 3; i++) {
        var a = (Math.PI / 3) * i;
        doc.line(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
    })(MX + e.w('LABCOLD', 19, 'bold') + 4, y + 4.5, 2.6);
    e.t('medical & scientific refrigeration', MX, y + 10.4, 6, 'bold', NOTE);
    e.t(txtOf('titleText') || 'BARKEY CALIBRATION WORKSHEET', PW - MX, y + 5, 13, 'bold', INK, 'right');
    var noX = PW - MX - 34;
    e.t('No', noX - 4, y + 12.5, 9, 'normal', INK, 'right');
    e.star(noX - 3.5, y + 11.3);
    e.t(':', noX - 1, y + 12.5, 9);
    e.t(val('sheetNo'), noX + 4, y + 12.5, 12.5, 'bold');
    e.line(noX + 1, y + 14, PW - MX, y + 14, INK, 0.4);
    y += 18;

    // ---------------- meta ----------------
    var META = [
      ['Job reference', val('jobRef'), 'Date', val('date') || val('dateNative')],
      ['Site', val('site'), 'Department', val('dept')],
      ['Model', val('model'), 'Serial number', val('serial')],
      ['Engineer', val('eng'), 'Reference thermometer', val('refTherm')]
    ];
    var half = IN / 2;
    META.forEach(function (r, i) {
      var yy = y + i * 5.2;
      [[r[0], r[1], MX], [r[2], r[3], MX + half]].forEach(function (pair) {
        e.t(pair[0], pair[2], yy, 8);
        var w = e.w(pair[0], 8);
        e.star(pair[2] + w + 0.6, yy - 1.2);
        e.t(':', pair[2] + w + 2.4, yy, 8);
        e.t(pair[1], pair[2] + 38, yy, 8.5, 'bold');
        e.stroke(RULE_D); doc.setLineWidth(0.15);
        doc.setLineDashPattern([0.4, 0.6], 0);
        doc.line(pair[2] + 37, yy + 1.4, pair[2] + half - 6, yy + 1.4);
        doc.setLineDashPattern([], 0);
      });
    });
    y += META.length * 5.2 + 3;

    // ---------------- reference thermometer ----------------
    // Laid out like the 19/24 sheet: serial in a pill, cal due date, and the
    // validity badge beside it.
    e.t('Digital Reference Thermometer Serial No', MX + 2, y + 3, 7.5);
    e.pill(serialOnly(val('refTherm')) || '\u2014', MX + 62, y, 34, 4.8, 7);
    e.t('Cal due date:', MX + 100, y + 3, 7.5);
    e.t(monthYear(txtOf('refThermCalDue')) || '\u2014', MX + 122, y + 3, 8.5, 'bold');
    var drtBadge = ascii(txtOf('refThermCalDue'));
    if (/valid/i.test(drtBadge)) {
      e.badge(drtBadge.replace(/^[^A-Za-z]*/, ''), MX + 140, y, IN - 142, 4.6);
    }
    y += 8;

    // ---------------- room temperature ----------------
    var LAB_W = 32, RT_H = 8;
    e.box(MX, y, IN, RT_H, null, RULE_D, 0.25);
    e.line(MX + LAB_W, y, MX + LAB_W, y + RT_H, RULE_D, 0.25);
    e.t('Room Temperature (RT)', MX + 2, y + 5.2, 6.8, 'bold');

    var rtCols = [56, 29, 20, 20, IN - LAB_W - 125];
    var xs = [], acc = MX + LAB_W;
    rtCols.forEach(function (w) { xs.push([acc, w]); acc += w; });
    xs.slice(1).forEach(function (c) { e.line(c[0], y, c[0], y + RT_H, RULE_D, 0.18); });

    var rtMid = y + 5.2;
    e.label('RT Ref', xs[0][0] + 2, rtMid, 7, true);
    e.pill(serialOnly(val('rtRef')) || '\u2014', xs[0][0] + 13, y + 1.6, 19, 4.8, 6.8);
    var rtv = ascii(txtOf('rtRefValidity'));
    if (rtv) e.badge(rtv, xs[0][0] + 34, y + 1.8, xs[0][1] - 36, 4.4);

    [[xs[1], 'Cal due:', monthYear(txtOf('rtRefValidity')), false],
     [xs[2], 'Max', val('rtMax'), true],
     [xs[3], 'Min', val('rtMin'), true],
     [xs[4], 'Average:', txtOf('rtAvg'), false]
    ].forEach(function (col) {
      var vxx = e.label(col[1], col[0][0] + 2, rtMid, 7, col[3]);
      e.t(col[2] || '\u2014', vxx + 1, rtMid, 8.5, 'bold');
    });
    y += RT_H + 2.5;

    // ---------------- measurement sections ----------------
    var LBL_W = 62, TICK_W = 9;
    var VAL_W = 34;
    var SPEC_W = IN - LBL_W - VAL_W - TICK_W;

    function sectionBar(text) {
      var h = 5.2;
      e.box(MX, y, IN, h, [51, 51, 51], null);
      e.t(text, PW / 2, y + h - 1.5, 8.2, 'bold', [255, 255, 255], 'center');
      y += h;
    }

    function readingRow(label, value, spec, tick, opt) {
      opt = opt || {};
      var h = opt.h || 5.6;
      var top = y;
      var tint = opt.greyed ? GREY_BG
               : (tick === 'pass' ? GREEN_BG : (tick === 'fail' ? [255, 222, 222] : null));
      if (tint) e.box(MX, top, IN, h, tint, null);
      var col = opt.greyed ? GREY_TXT : INK;
      var baseline = top + h / 2 + 1.1;
      var stem = String(label).replace(/:\s*$/, '');
      if (opt.required) {
        // "... heating *:" — marker between the text and the colon
        e.t(':', MX + LBL_W - 2, baseline, 7.6, opt.bold ? 'bold' : 'normal', col, 'right');
        e.star(MX + LBL_W - 4.6, baseline - 1.3);
        e.t(stem, MX + LBL_W - 5.2, baseline, 7.6, opt.bold ? 'bold' : 'normal', col, 'right');
      } else {
        e.t(label, MX + LBL_W - 2, baseline, 7.6, opt.bold ? 'bold' : 'normal', col, 'right');
      }
      e.t(dash(value), MX + LBL_W + VAL_W / 2, top + h / 2 + 1.2, 8.6,
          opt.bold || opt.calc ? 'bold' : 'normal', col, 'center');
      if (spec) e.t(spec, MX + LBL_W + VAL_W + 2, top + h / 2 + 1, 6.6, 'normal', opt.greyed ? GREY_TXT : NOTE);
      if (tick === 'pass' || tick === 'fail') {
        var tx = MX + LBL_W + VAL_W + SPEC_W + TICK_W / 2;
        var ty = top + h / 2;
        e.stroke(tick === 'pass' ? [30, 120, 60] : [190, 40, 40]); doc.setLineWidth(0.6);
        if (tick === 'pass') {
          doc.line(tx - 1.6, ty, tx - 0.4, ty + 1.4);
          doc.line(tx - 0.4, ty + 1.4, tx + 1.8, ty - 1.8);
        } else {
          doc.line(tx - 1.6, ty - 1.6, tx + 1.6, ty + 1.6);
          doc.line(tx - 1.6, ty + 1.6, tx + 1.6, ty - 1.6);
        }
      }
      e.line(MX, top + h, MX + IN, top + h, RULE, 0.18);
      [LBL_W, LBL_W + VAL_W, LBL_W + VAL_W + SPEC_W].forEach(function (o) {
        e.line(MX + o, top, MX + o, top + h, RULE, 0.18);
      });
      e.line(MX, top, MX, top + h, RULE_D, 0.25);
      e.line(MX + IN, top, MX + IN, top + h, RULE_D, 0.25);
      y = top + h;
    }

    function tickOf(id) {
      var el = document.getElementById(id);
      if (!el) return null;
      if (el.classList.contains('pass')) return 'pass';
      if (el.classList.contains('fail')) return 'fail';
      var t = (el.textContent || '').trim();
      if (t === '\u2713') return 'pass';
      if (t === '\u2717') return 'fail';
      // fall back to the row's own class, which is where the colour lives
      var row = el.closest ? el.closest('.row') : null;
      if (row) {
        if (row.classList.contains('pass')) return 'pass';
        if (row.classList.contains('fail')) return 'fail';
      }
      return null;
    }

    function section(prefix, title, greyed) {
      sectionBar(title);
      var o = { greyed: greyed };
      readingRow('Probe:', greyed ? 'N/A' : (val(prefix + '_probe') || '\u2014'), '', null,
                 { greyed: greyed, required: !greyed });
      readingRow('Reference temperature (\u00b0C):', greyed ? 'N/A' : val(prefix + '_ref'),
                 greyed ? '' : txtOf(prefix + '_nearest'), null, { greyed: greyed, required: !greyed });
      readingRow('Probe Correction value (\u00b0C):', greyed ? 'N/A' : txtOf(prefix + '_corr'),
                 'auto, 3 d.p.', null, { greyed: greyed, calc: true });
      readingRow('Reference + correction (\u00b0C):', greyed ? 'N/A' : txtOf(prefix + '_refcorr'),
                 greyed ? '' : txtOf(prefix + '_window'), greyed ? null : tickOf(prefix + '_tickRef'),
                 { greyed: greyed, bold: true });
      readingRow('Calibration temperature (\u00b0C):', greyed ? 'N/A' : val(prefix + '_cal'),
                 'Spec: Ref. + corr. \u00b1 0.50 \u00b0C', greyed ? null : tickOf(prefix + '_tickCal'),
                 { greyed: greyed, bold: true, required: !greyed });
      readingRow('Temperature display in the device, heating:', greyed ? 'N/A' : val(prefix + '_heat'),
                 'Spec: Ref. + corr. \u00b1 0.50 \u00b0C', greyed ? null : tickOf(prefix + '_tickHeat'),
                 { greyed: greyed, required: !greyed });
      readingRow('Temperature display in the device, inlet:', greyed ? 'N/A' : val(prefix + '_inlet'),
                 'Spec: Ref. + corr. \u00b1 0.50 \u00b0C', greyed ? null : tickOf(prefix + '_tickInlet'),
                 { greyed: greyed, required: !greyed });
      readingRow('SW inlet operating temperature:', greyed ? 'N/A' : val(prefix + '_sw'),
                 'Spec: Cal. temp + 1.00 \u00b1 0.50 \u00b0C', greyed ? null : tickOf(prefix + '_tickSw'),
                 { greyed: greyed, required: !greyed });
      readingRow('HW inlet overtemperature triggering:', greyed ? 'N/A' : val(prefix + '_hw'),
                 'Spec: 48.00 \u00b1 1.00 \u00b0C', greyed ? null : tickOf(prefix + '_tickHw'),
                 { greyed: greyed, required: !greyed });
    }

    // Did every As Found check pass? The worksheet colours each row, so read
    // the result from there rather than recomputing the tolerances here.
    function sectionResult(prefix) {
      var keys = ['tickCal', 'tickHeat', 'tickInlet', 'tickSw', 'tickHw'];
      var marks = keys.map(function (k) { return tickOf(prefix + '_' + k); });
      return {
        complete: marks.every(function (m) { return m !== null; }),
        anyFail: marks.some(function (m) { return m === 'fail'; }),
        allPass: marks.every(function (m) { return m === 'pass'; })
      };
    }

    function banner(text, good) {
      var h = 6;
      e.box(MX, y, IN, h, good ? GREEN_BG : [255, 231, 231],
            good ? GREEN_BD : [214, 150, 150], 0.2);
      e.t(text, MX + 3, y + h - 2, 7.8, 'bold', good ? GREEN_TX : [140, 30, 30]);
      y += h + 1.6;
    }

    var afResult = sectionResult('found');
    banner(afResult.allPass
      ? 'As Found: every check within specification.'
      : (afResult.anyFail
          ? 'As Found: one or more checks outside specification \u2014 adjustment required.'
          : 'As Found: readings recorded.'),
      !afResult.anyFail);

    section('found', 'Temperature Check \u2013 As found', false);
    y += 2;

    // As Left is locked off whenever no adjustment was required
    var leftSec = document.getElementById('leftSec');
    var leftOff = leftSec ? leftSec.classList.contains('leftOff') : true;
    banner(leftOff
      ? 'Adjustment not needed \u2014 all As Found checks were within specification, so the As Left section is not applicable.'
      : 'Adjustment carried out \u2014 see the As Left readings below.',
      leftOff);
    section('left', txtOf('leftBar') || 'Temperature Check \u2013 As left after adjustment', leftOff);
    y += 2.5;

    // ---------------- stopwatch ----------------
    sectionBar('Stopwatch Check');
    var swH = 9;
    e.box(MX, y, IN, swH, null, RULE_D, 0.25);
    var swCells = [
      ['Stopwatch serial no', serialOnly(val('swSerial')) || '\u2014'],
      ['Unit time', mmss(val('unitMin'), val('unitSec'))],
      ['Stopwatch time', mmss(val('swMin'), val('swSec'))]
    ];
    var sw = IN / swCells.length;
    swCells.forEach(function (c, i) {
      var x = MX + i * sw;
      if (i) e.line(x, y, x, y + swH, RULE_D, 0.18);
      e.t(c[0], x + 1.6, y + 3, 6.3, 'normal', NOTE);
      e.t(c[1], x + 1.6, y + 6.4, 8.2, 'bold');
    });
    y += swH + 2.5;

    // ---------------- comments, footer, signatures ----------------
    var comments = val('comments');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    var comLines = comments ? doc.splitTextToSize(comments, IN - 6) : [];
    var HEAD_H = 5.0, LINE_H = 3.3, PAD_TOP = 2.6, PAD_BOT = 1.8, FOOT_H = 4.4, SIG_H = 9.1;
    var availH = (PH - 6 - FOOT_H - SIG_H * 2 - 2.5) - y;
    var maxLines = Math.max(0, Math.floor((availH - HEAD_H - PAD_TOP - PAD_BOT) / LINE_H));
    var overflow = comLines.length > maxLines ? comLines : [];
    var shown = overflow.length ? [] : comLines;
    var comH = overflow.length ? 7 : Math.max(12, HEAD_H + PAD_TOP + shown.length * LINE_H + PAD_BOT);

    e.box(MX, y, IN, comH, null, RULE_D, 0.25);
    e.box(MX + 0.2, y + 0.2, IN - 0.4, HEAD_H, HDR_BG, null);
    e.t('Comments', MX + 2, y + 4, 8.5, 'bold');
    if (overflow.length) e.t('\u2014 continued on page 2', MX + 22, y + 4, 7.3, 'italic', NOTE);
    else e.t('(calculations, deviations, customer requests)', MX + 20, y + 4, 7.3, 'normal', NOTE);
    shown.forEach(function (ln, i) {
      e.t(ln, MX + 3, y + HEAD_H + PAD_TOP + i * LINE_H, 8);
    });
    y += comH + 2.5;

    [['Engineer', val('eng'), val('engineerSignature') || val('eng'), val('engDate') || val('date'), true],
     ['Checked by', val('checker'), val('checkerSignature'), val('checkDate'), false]
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
          doc.setFont('DancingScript', 'normal'); doc.setFontSize(13);
          doc.setTextColor(SIGCOL[0], SIGCOL[1], SIGCOL[2]);
          doc.text(ascii(r[2]), a + 5, top + 8);
          doc.setFont('helvetica', 'normal');
        } else {
          e.t(r[2], a + 5, top + 8, 11, 'italic', SIGCOL);
        }
      }
      e.t('Date:', b + 2, top + 3.4, 7.3);
      if (r[3]) e.t(r[3], b + 6, top + 7.6, 8.5, 'bold');
      y = top + SIG_H;
    });

    var stamp = new Date();
    function two(n) { return String(n).padStart(2, '0'); }
    var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var stampTxt = 'Generated ' + two(stamp.getDate()) + '/' + MONTHS[stamp.getMonth()] + '/' + stamp.getFullYear()
                 + ' ' + two(stamp.getHours()) + ':' + two(stamp.getMinutes());
    if (SHOW_GENERATED_STAMP) e.t(stampTxt, MX, y + 3.6, 6.2, 'normal', NOTE);
    if (overflow.length) e.t('Page 1 of 2', PW - MX, y + 3.6, 6.2, 'normal', NOTE, 'right');
    y += FOOT_H;

    if (overflow.length) {
      doc.addPage();
      var y2 = MT;
      e.t('Barkey Calibration Worksheet \u2014 continuation', MX, y2 + 5, 12, 'bold');
      e.t('No: ' + val('sheetNo'), PW - MX, y2 + 5, 11, 'bold', INK, 'right');
      e.t([val('site'), val('serial'), val('jobRef')].filter(Boolean).join('  \u00b7  '),
          PW - MX, y2 + 9.2, 7, 'normal', NOTE, 'right');
      e.line(MX, y2 + 11.5, PW - MX, y2 + 11.5, RULE_D, 0.3);
      y2 += 15;
      var perPage = Math.floor((PH - 16 - y2 - HEAD_H - PAD_TOP - PAD_BOT) / LINE_H);
      var rest = overflow.slice(0, perPage);
      var boxH = HEAD_H + PAD_TOP + rest.length * LINE_H + PAD_BOT;
      e.box(MX, y2, IN, boxH, null, RULE_D, 0.25);
      e.box(MX + 0.2, y2 + 0.2, IN - 0.4, HEAD_H, HDR_BG, null);
      e.t('Comments (continued)', MX + 2, y2 + 4, 8.5, 'bold');
      rest.forEach(function (ln, i) { e.t(ln, MX + 3, y2 + HEAD_H + PAD_TOP + i * LINE_H, 8); });
      y2 += boxH;
      if (overflow.length > perPage) {
        e.t('\u2026 ' + (overflow.length - perPage) + ' further line(s) not shown \u2014 shorten the comments.',
            MX, y2 + 4, 6.5, 'italic', RED);
      }
      if (SHOW_GENERATED_STAMP) e.t(stampTxt, MX, PH - 8, 6.2, 'normal', NOTE);
      e.t('Page 2 of 2', PW - MX, PH - 8, 6.2, 'normal', NOTE, 'right');
    }

    if (y > PH - 6) {
      console.warn('LabCal vector PDF (Barkey): content ran to ' + y.toFixed(1) + ' mm (page is ' + PH + ' mm).');
    }
    return doc;
  }

  global.LabCalVectorPdf = {
    supports: function (sheet) { return sheet === 'ws19_24' || sheet === 'barkey'; },
    build19_24: build19_24,
    blob19_24: function () { return build19_24().output('blob'); },
    buildBarkey: buildBarkey,
    blobBarkey: function () { return buildBarkey().output('blob'); }
  };
})(typeof window !== 'undefined' ? window : this);
