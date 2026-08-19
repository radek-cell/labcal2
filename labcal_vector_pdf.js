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

  // The worksheet already decides pass/fail and paints the cell. Read that
  // rather than recomputing the tolerance here, so the certificate can never
  // disagree with what is on screen.
  function stateOf(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    if (el.classList.contains('bad')) return 'bad';
    if (el.classList.contains('ok')) return 'ok';
    return null;
  }

  var RED_BG = [255, 226, 226];
  var RED_BD = [214, 150, 150];
  var RED_TX = [140, 30, 30];
  function tintFor(state) {
    return state === 'bad' ? RED_BG : (state === 'ok' ? GREEN_BG : null);
  }

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
  // Shared page header
  // =====================================================================
  // Title and subtitle on the left, LABCOLD wordmark on the right with the
  // certificate number beneath it. Every worksheet uses this, so they cannot
  // drift apart.
  // Both worksheets retitle themselves as a VERIFICATION worksheet when the
  // sheet number is the all-zero code. The title lives in #titleText, so read
  // it rather than hard-coding "Calibration".
  function headingFor(fallbackTitle, fallbackSubtitle) {
    var live = ascii(txtOf('titleText'));
    if (!live) return { title: fallbackTitle, subtitle: fallbackSubtitle };
    if (/verification/i.test(live)) {
      return { title: 'Engineer Verification Worksheet', subtitle: fallbackSubtitle };
    }
    return { title: fallbackTitle, subtitle: fallbackSubtitle };
  }

  function drawHeader(e, doc, opts) {
    var y = MT;
    e.t(opts.title, MX, y + 5, 14, 'bold');
    e.t(opts.subtitle, MX, y + 9.6, 7.5, 'bold', [40, 70, 120]);

    e.t('LABCOLD', PW - MX, y + 6.5, 19, 'bold', INK, 'right');
    var markW = e.w('LABCOLD', 19, 'bold');
    (function snowflake(cx, cy, r) {
      e.stroke([91, 155, 213]); doc.setLineWidth(0.45);
      for (var i = 0; i < 3; i++) {
        var a = (Math.PI / 3) * i;
        doc.line(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
    })(PW - MX - markW - 5, y + 4.5, 2.6);

    var noX = PW - MX - 30;
    e.t('No', noX - 4, y + 12.5, 9, 'normal', INK, 'right');
    e.star(noX - 3.5, y + 11.3);
    e.t(':', noX - 1, y + 12.5, 9);
    e.t(opts.number || '', noX + 3, y + 12.5, 12.5, 'bold');
    e.line(noX + 1, y + 14, PW - MX, y + 14, INK, 0.4);
    return y + 18;
  }

  // A status line can be long ("...Load and Chart Recorder are not applicable
  // on this worksheet"), so wrap it and grow the box rather than letting it
  // run off the right-hand edge.
  function drawBanner(e, doc, y, text, bad, size) {
    size = size || 7.8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(size);
    var lines = doc.splitTextToSize(ascii(text), IN - 6);
    var h = Math.max(6, 2.2 + lines.length * 3.2);
    e.box(MX, y, IN, h, bad ? RED_BG : GREEN_BG, bad ? RED_BD : GREEN_BD, 0.2);
    lines.forEach(function (ln, i) {
      e.t(ln, MX + 3, y + 4 + i * 3.2, size, 'bold', bad ? RED_TX : GREEN_TX);
    });
    return y + h + 1.6;
  }

  // =====================================================================
  // Comments box, then signatures
  // =====================================================================
  // Comments sit above the signatures so they read as part of the record.
  // The box grows to fit; anything that will not fit continues on page 2.
  function drawCommentsAndSignatures(e, doc, y, haveScript, ctx) {
    var comments = val('comments');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    var comLines = comments ? doc.splitTextToSize(comments, IN - 6) : [];
    var HEAD_H = 5.0, LINE_H = 3.3, PAD_TOP = 2.6, PAD_BOT = 1.8, SIG_H = 9.1;
    var availH = (PH - 8 - SIG_H * 2 - 2.5) - y;
    var maxLines = Math.max(0, Math.floor((availH - HEAD_H - PAD_TOP - PAD_BOT) / LINE_H));
    var overflow = comLines.length > maxLines ? comLines : [];
    var shown = overflow.length ? [] : comLines;
    var comH = overflow.length ? 7 : Math.max(12, HEAD_H + PAD_TOP + shown.length * LINE_H + PAD_BOT);

    e.box(MX, y, IN, comH, null, RULE_D, 0.25);
    e.box(MX + 0.2, y + 0.2, IN - 0.4, HEAD_H, HDR_BG, null);
    e.t('Comments', MX + 2, y + 4, 8.5, 'bold');
    if (overflow.length) e.t('\u2014 continued on page 2', MX + 22, y + 4, 7.3, 'italic', NOTE);
    else e.t('(calculations, deviations, customer requests)', MX + 20, y + 4, 7.3, 'normal', NOTE);
    shown.forEach(function (ln, i) { e.t(ln, MX + 3, y + HEAD_H + PAD_TOP + i * LINE_H, 8); });
    y += comH + 2.5;

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

    if (overflow.length) {
      e.t('Page 1 of 2', PW - MX, y + 3.6, 6.2, 'normal', NOTE, 'right');
      doc.addPage();
      var y2 = MT;
      e.t((ctx && ctx.subtitle ? 'Engineer Calibration Worksheet' : 'Worksheet') + ' \u2014 continuation', MX, y2 + 5, 12, 'bold');
      e.t('No: ' + ((ctx && ctx.certNo) || ''), PW - MX, y2 + 5, 11, 'bold', INK, 'right');
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
      e.t('Page 2 of 2', PW - MX, PH - 8, 6.2, 'normal', NOTE, 'right');
    }
    return y;
  }

  // =====================================================================
  // Measurement table
  // =====================================================================
  // Shared by every worksheet. `groups` describes the column bands:
  //   [{title:'Air (T1)', span:2}, {title:'Load (T2)', span:2}]
  //   [{title:'Air', span:2}, {title:'Load', span:1}, {title:'Chart Recorder', span:1}]
  // A span of 2 gets the Left/Right sub-header with its coloured dots.
  function makeTable(e, doc, groups, labelW) {
    var cols = groups.reduce(function (n, g) { return n + g.span; }, 0);
    var COL = (IN - labelW) / cols;
    var bands = [];
    (function () { var at = 0; groups.forEach(function (g) { bands.push([at, g.span]); at += g.span; }); })();

    // inlineLR: no Left/Right sub-header row — the dots go in the probe cells
    // instead, which saves a full row per table.
    function header(title, y, inlineLR) {
      var hh = 5;
      e.box(MX, y, IN, hh, HDR_BG, RULE_D, 0.25);
      e.t(title, MX + 2, y + hh - 1.4, 7.5, 'bold');
      e.line(MX + labelW, y, MX + labelW, y + hh, RULE_D, 0.25);
      var x = MX + labelW;
      groups.forEach(function (g, gi) {
        if (gi) e.line(x, y, x, y + hh, RULE_D, 0.25);
        e.t(g.title, x + g.span * COL / 2, y + hh - 1.4, 7.5, 'bold', INK, 'center');
        x += g.span * COL;
      });
      y += hh;
      if (inlineLR) return y;

      var sh = 4.6;
      e.box(MX, y, IN, sh, HDR_BG, RULE_D, 0.25);
      e.line(MX + labelW, y, MX + labelW, y + sh, RULE_D, 0.25);
      x = MX + labelW;
      groups.forEach(function (g, gi) {
        if (gi) e.line(x, y, x, y + sh, RULE_D, 0.18);
        if (g.span === 2) {
          ['Left', 'Right'].forEach(function (lab, i) {
            var cx = x + i * COL;
            if (i) e.line(cx, y, cx, y + sh, RULE_D, 0.18);
            var dot = i === 0 ? [47, 111, 208] : [217, 131, 36];
            e.fill(dot); doc.circle(cx + COL / 2 - 7, y + sh / 2, 1.6, 'F');
            e.t(i === 0 ? 'L' : 'R', cx + COL / 2 - 7, y + sh / 2 + 0.8, 5.5, 'bold', [255, 255, 255], 'center');
            e.t(lab, cx + COL / 2 - 4.6, y + sh - 1.4, 7);
          });
        }
        x += g.span * COL;
      });
      return y + sh;
    }

    function row(label, vals, y, opt) {
      opt = opt || {};
      var h = opt.h || 4.7;
      var top = y;
      var lines = Array.isArray(label) ? label : [label];
      e.box(MX, top, IN, h, [255, 255, 255], null);

      if (opt.tint || opt.tints) {
        if (opt.merged) {
          bands.forEach(function (b, bi) {
            var t = opt.tints ? opt.tints[bi] : opt.tint;
            if (t) e.box(MX + labelW + b[0] * COL + 0.2, top + 0.2, b[1] * COL - 0.4, h - 0.4, t, null);
          });
        } else {
          for (var i = 0; i < cols; i++) {
            var t = opt.tints ? opt.tints[i] : opt.tint;
            if (t) e.box(MX + labelW + i * COL + 0.2, top + 0.2, COL - 0.4, h - 0.4, t, null);
          }
        }
      }

      var lead = 2.2;
      var first = top + h / 2 - (lead * (lines.length - 1)) / 2 + 0.9;
      lines.forEach(function (ln, i) {
        e.t(ln, MX + 2, first + i * lead, lines.length > 1 ? 6 : 7,
            opt.bold ? 'bold' : 'normal', opt.grey ? GREY_TXT : INK);
      });
      if (opt.required) e.star(MX + 2 + e.w(lines[0], lines.length > 1 ? 6 : 7) + 0.6, first - 1.1);

      if (opt.merged) {
        bands.forEach(function (b, bi) {
          var cx = MX + labelW + b[0] * COL;
          e.t(dash(vals[bi]), cx + b[1] * COL / 2, top + h / 2 + 1.2, 8.5, 'bold',
              opt.grey ? GREY_TXT : INK, 'center');
        });
      } else {
        vals.forEach(function (v, i) {
          var cx = MX + labelW + i * COL;
          var greyThis = opt.grey || (opt.greyvals && opt.greyvals.indexOf(i) !== -1);
          if (opt.boxed) {
            var CH = 4.4, CW = COL - 10;
            var bxx = cx + (COL - CW) / 2, by = top + (h - CH) / 2;
            if (opt.inlineLR) {
              // which side of the pair this column is, shown as the same
              // coloured dot the worksheet uses
              var band = null, at = 0;
              groups.forEach(function (g) {
                if (i >= at && i < at + g.span) band = g;
                at += g.span;
              });
              if (band && band.span === 2) {
                var side = (i % 2 === 0) ? 'L' : 'R';
                var dotC = side === 'L' ? [47, 111, 208] : [217, 131, 36];
                e.fill(dotC); doc.circle(bxx - 3.4, top + h / 2, 1.5, 'F');
                e.t(side, bxx - 3.4, top + h / 2 + 0.8, 5.2, 'bold', [255, 255, 255], 'center');
                bxx += 1.4; CW -= 2.8;
                e.rbox(bxx, by, CW, CH, 0.8, greyThis ? GREY_BG : CHIP_BG, CHIP_BD, 0.2);
                e.t(String(v || '\u2014'), bxx + CW / 2, by + CH - 1.4, 7,
                    greyThis ? 'normal' : 'bold', greyThis ? GREY_TXT : INK, 'center');
                if (opt.strike && String(v || '').trim()) {
                  var tw2 = e.w(String(v || ''), 7);
                  e.line(bxx + CW / 2 - tw2 / 2 - 0.6, by + CH / 2 + 0.2,
                         bxx + CW / 2 + tw2 / 2 + 0.6, by + CH / 2 + 0.2, GREY_TXT, 0.2);
                }
                return;
              }
            }
            e.rbox(bxx, by, CW, CH, 0.8, greyThis ? GREY_BG : CHIP_BG, CHIP_BD, 0.2);
            e.t(String(v || '\u2014'), cx + COL / 2, by + CH - 1.4, 7.2,
                greyThis ? 'normal' : 'bold', greyThis ? GREY_TXT : INK, 'center');
            if (opt.strike && String(v || '').trim()) {
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

      e.line(MX, top + h, MX + IN, top + h, RULE, 0.18);
      var keep = { 0: true }; keep[cols] = true;
      if (opt.merged) bands.forEach(function (b) { keep[b[0]] = true; });
      else for (var g = 0; g <= cols; g++) keep[g] = true;
      Object.keys(keep).forEach(function (g) {
        e.line(MX + labelW + Number(g) * COL, top, MX + labelW + Number(g) * COL, top + h, RULE, 0.18);
      });
      e.line(MX, top, MX, top + h, RULE_D, 0.25);
      e.line(MX + IN, top, MX + IN, top + h, RULE_D, 0.25);
      return top + h;
    }

    return { header: header, row: row, cols: cols, colWidth: COL };
  }

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
    var head1924 = headingFor('Engineer Calibration Worksheet', 'Standard 19 range/24 range');
    y = drawHeader(e, doc, {
      title: head1924.title,
      subtitle: head1924.subtitle,
      number: val('certNo') || txtOf('certNo')
    });

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

    // ---------------- instrument + controller block ----------------
    // One bordered block: reference thermometer, room temperature, then the
    // two controller rows. Same shape as the Barkey sheet.
    var LAB_W = 40, ROW_H = 8, CT_ROW = 6.4;
    var blockTop = y, blockH = ROW_H * 2 + CT_ROW * 2;
    e.box(MX, blockTop, IN, blockH, null, RULE_D, 0.25);
    e.line(MX + LAB_W, blockTop, MX + LAB_W, blockTop + blockH, RULE_D, 0.25);
    e.line(MX, blockTop + ROW_H, MX + IN, blockTop + ROW_H, RULE_D, 0.18);
    e.line(MX, blockTop + ROW_H * 2, MX + IN, blockTop + ROW_H * 2, RULE_D, 0.18);
    e.line(MX + LAB_W, blockTop + ROW_H * 2 + CT_ROW, MX + IN, blockTop + ROW_H * 2 + CT_ROW, RULE_D, 0.18);

    // --- row 1: digital reference thermometer ---
    var r1 = blockTop + 5.2;
    e.t('Digital Reference Thermometer', MX + 2, r1, 6.8, 'bold');
    var dCols = [56, 34, IN - LAB_W - 90];
    var dxs = [], dacc = MX + LAB_W;
    dCols.forEach(function (w) { dxs.push([dacc, w]); dacc += w; });
    dxs.slice(1).forEach(function (c) { e.line(c[0], blockTop, c[0], blockTop + ROW_H, RULE_D, 0.18); });
    e.label('Serial no', dxs[0][0] + 2, r1, 7, true);
    e.pill(serialOnly(val('drtSerial')) || '\u2014', dxs[0][0] + 19, blockTop + 1.6, 34, 4.8, 7);
    var dVal = e.label('Cal due', dxs[1][0] + 2, r1, 7, false);
    e.t(txtOf('drtDue') || val('drtDue') || '\u2014', dVal + 1, r1, 8.5, 'bold');
    var drtStatus = ascii(txtOf('drtCalStatus'));
    if (drtStatus) e.badge(drtStatus, dxs[2][0] + 2, blockTop + 1.8, dxs[2][1] - 4, 4.4);

    // --- row 2: room temperature ---
    var rtTop = blockTop + ROW_H, r2 = rtTop + 5.2;
    e.t('Room Temperature (RT)', MX + 2, r2, 6.8, 'bold');
    var rtCols = [56, 29, 20, 20, IN - LAB_W - 125];
    var xs = [], acc = MX + LAB_W;
    rtCols.forEach(function (w) { xs.push([acc, w]); acc += w; });
    xs.slice(1).forEach(function (c) { e.line(c[0], rtTop, c[0], rtTop + ROW_H, RULE_D, 0.18); });
    e.label('RT Ref', xs[0][0] + 2, r2, 7, true);
    e.pill(serialOnly(val('rtRef')) || '\u2014', xs[0][0] + 13, rtTop + 1.6, 19, 4.8, 6.8);
    var rtv = ascii(txtOf('rtRefValidity'));
    if (rtv) e.badge(rtv, xs[0][0] + 34, rtTop + 1.8, xs[0][1] - 36, 4.4);
    [[xs[1], 'Cal due:', txtOf('rtDue') || val('rtDue') || monthYear(rtv), false],
     [xs[2], 'Max', val('rtMax'), true],
     [xs[3], 'Min', val('rtMin'), true],
     [xs[4], 'Average:', txtOf('rtAvg') || val('rtAvg'), false]
    ].forEach(function (col) {
      var vxx = e.label(col[1], col[0][0] + 2, r2, 7, col[3]);
      e.t(col[2] || '\u2014', vxx + 1, r2, 8.5, 'bold');
    });

    // --- rows 3 and 4: controller settings ---
    var ctTop = blockTop + ROW_H * 2;
    e.t('Controller Settings', MX + 2, ctTop + CT_ROW - 1.6, 6.8, 'bold');
    var ctSplit = MX + LAB_W + 66;
    e.line(ctSplit, ctTop, ctSplit, blockTop + blockH, RULE_D, 0.18);

    function ctLine(top, offLabel, v1, v2, spLabel, spVal, note, greyed) {
      var mid = top + CT_ROW - 2.2;
      var x = MX + LAB_W + 2;
      x = e.label(offLabel, x, mid, 6.8, true);
      [['Cal 1:', v1], ['Cal 2:', v2]].forEach(function (p, i) {
        var bx = x + i * 24;
        e.t(p[0], bx, mid, 6.8);
        if (greyed) e.chip(p[1], bx + 9, mid - 3.1, 12);
        else e.t(p[1] || '\u2014', bx + 10, mid, 7.8, 'bold');
      });
      var sx = e.label(spLabel, ctSplit + 2, mid, 6.8, true);
      if (greyed) e.chip(spVal, sx + 1, mid - 3.1, 14);
      else e.t(spVal || '\u2014', sx + 1, mid, 8.5, 'bold');
      // which offset point the corrections were taken from
      if (note) e.t('Nearest offset point used: ' + note, sx + 17, mid, 6.2, 'normal', [50, 90, 160]);
    }

    // The worksheet marks the As Left table 'notNeeded' when no adjustment is
    // required; that single flag drives the controller row, the banner and
    // whether the As Left table prints crossed out.
    var alNotNeededYet = (function () {
      var t = document.getElementById('alTable');
      if (t) return t.classList.contains('notNeeded');
      var ids = ['al_air_display', 'al_load_display', 'al_air1_max', 'al_load1_max'];
      return !ids.some(function (id) {
        var v = val(id);
        return v !== '' && v !== '-N/A-' && !isNaN(parseFloat(v));
      });
    })();
    var alDone = !alNotNeededYet;
    ctLine(ctTop, 'Initial offsets', val('initialOffsetsCal1'), val('initialOffsetsCal2'),
           'Initial set point', val('initialSetpoint'),
           (txtOf('initialNearestPoint') || '').replace('\u2014', ''), false);
    ctLine(ctTop + CT_ROW, 'Final offsets',
           alNotNeededYet ? 'N/A' : val('finalOffsetsCal1'),
           alNotNeededYet ? 'N/A' : val('finalOffsetsCal2'),
           'Final set point',
           alNotNeededYet ? '\u2013N/A\u2013' : val('finalSetpoint'),
           alNotNeededYet ? '' : (txtOf('finalNearestPoint') || '').replace('\u2014', ''),
           alNotNeededYet);
    y = blockTop + blockH + 2.5;

    // ---------------- status banner ----------------
    function banner(text, h, size, bad) { y = drawBanner(e, doc, y, text, bad, size); }
    var afStatus = txtOf('afStatus');
    var afBad = stateOf('afStatus') === 'bad';
    banner(afStatus || 'As Found: within tolerance.', 6, 7.8, afBad);

    // ---------------- measurement tables ----------------
    var T = makeTable(e, doc, [{ title: 'Air (T1)', span: 2 }, { title: 'Load (T2)', span: 2 }], 40);
    function tableHeader(title) { y = T.header(title, y, true); }   // L/R in the probe cells
    function trow(label, vals, opt) { y = T.row(label, vals, y, opt); }

    // which corrected max/min were used (the blue and green underlines)
    function markers(prefix, key) {
      // The worksheet tags the corrected values it actually used.
      var flagged = {};
      ['air1', 'air2', 'load1', 'load2'].forEach(function (col, i) {
        var el = document.getElementById(prefix + '_' + col + '_' + key + '_calc');
        if (!el) return;
        if (el.classList.contains('selectedHigh')) flagged[i] = 'blue';
        if (el.classList.contains('selectedLow')) flagged[i] = 'green';
      });
      if (Object.keys(flagged).length) return flagged;
      // fall back to working it out, for a sheet that has not been recalculated
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
      trow(prefix === 'af' ? 'Probe Serial No' : 'Probe Serial No (as As Found)',
           cellset(prefix, 'probe'),
           { boxed: true, inlineLR: true, required: prefix === 'af', h: 5.4,
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
           { merged: true, bold: true, h: 6.2, grey: greyed,
             tints: greyed ? [GREY_BG, GREY_BG]
                           : [tintFor(stateOf(prefix + '_air_diff')),
                              tintFor(stateOf(prefix + '_load_diff'))] });
    }

    measurementTable('af', 'As Found (AF)', false);
    y += 1.6;

    var adjNeeded = alDone;
    // The worksheet's own wording where it fits on a line, otherwise a
    // concise equivalent — it distinguishes "adjustment carried out" from
    // "As Found not yet complete", which a generic line would lose.
    var alScreen1924 = ascii(txtOf('alStatus'));
    var alShort1924 = adjNeeded
      ? 'Adjustment carried out \u2014 see the As Left readings below.'
      : 'Adjustment not needed \u2014 As Found within tolerance \u00b10.5 \u00b0C. As Left not applicable.';
    banner(alScreen1924 && alScreen1924.length <= 110 ? alScreen1924 : alShort1924,
           6, 7.6, stateOf('alStatus') === 'bad');

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

    // ---------------- comments, then signatures ----------------
    y = drawCommentsAndSignatures(e, doc, y, haveScript, {
      certNo: val('certNo') || txtOf('certNo'),
      subtitle: head1924.subtitle
    });

    if (y > PH - 6) {
      console.warn('LabCal vector PDF: content ran to ' + y.toFixed(1) + ' mm (page is ' + PH + ' mm).');
    }

    return doc;
  }

  // =====================================================================
  // Certificate — Standard Non-Medical Device
  // =====================================================================
  // Same furniture as the 19/24 sheet. The differences: the tolerance depends
  // on the device type, the columns are Air L/R, Load and Chart Recorder, and
  // Load and Chart Recorder can be marked not applicable for a given unit.
  // Standard Medical and Standard Non-Medical share a layout. The differences
  // are declared here rather than duplicated as two near-identical builders.
  var SHEET_SPECS = {
    snmd: {
      subtitle: function () {
        var tol = ascii(txtOf('deviceToleranceHint'));
        return 'Standard Non-Medical Device \u2014 ' + (val('deviceType') || 'Fridge') + (tol ? '  \u00b7  ' + tol : '');
      },
      tolerance: function () {
        var m = ascii(txtOf('deviceToleranceHint')).match(/[\u00b1][^\s]*\s*\u00b0C/);
        return m ? m[0] : '';
      },
      extraMeta: null,
      variations: true,
      dualOffsets: false
    },
    smd: {
      subtitle: function () {
        return 'Standard Medical Device \u2014 ' + (val('deviceType') || '') + '  \u00b7  Tolerance: \u00b10.300 \u00b0C';
      },
      tolerance: function () { return '\u00b10.300 \u00b0C'; },
      extraMeta: function () { return ['Calibration System', val('calSystem')]; },
      variations: false,
      dualOffsets: true
    }
  };

  function buildSNMD(specKey) {
    var spec = SHEET_SPECS[specKey || 'snmd'];
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
    var head = headingFor('Engineer Calibration Worksheet', spec.subtitle());
    var y = drawHeader(e, doc, { title: head.title, subtitle: head.subtitle, number: val('certNo') });

    // ---------------- meta ----------------
    var META = [
      ['Job Reference No', val('jobRef'), 'Date', val('date') || val('dateNative')],
      ['Site', val('site'), 'Department', val('department')],
      ['Model', val('model'), 'Serial No', val('serial')],
      ['Manufacturer', val('manufacturer') === 'Other...' ? val('manufacturerOther') : val('manufacturer'),
        'Load', val('load')]
    ];
    if (spec.extraMeta) {
      var extra = spec.extraMeta();
      META.push([extra[0], extra[1], '', '']);
    }
    var half = IN / 2;
    META.forEach(function (r, i) {
      var yy = y + i * 5.2;
      [[r[0], r[1], MX], [r[2], r[3], MX + half]].forEach(function (pair) {
        if (!pair[0]) return;
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
    y += META.length * 5.2 - 0.5;

    var variation = spec.variations ? val('variationNote') : '';
    if (variation) {
      e.t('Non-Standard Variations', MX, y + 3, 8);
      var vw = e.w('Non-Standard Variations', 8);
      e.star(MX + vw + 0.6, y + 1.8);
      e.t(':', MX + vw + 2.4, y + 3, 8);
      e.t(variation, MX + 34, y + 3, 8.5, 'bold');
      y += 4.6;
    }
    y += 1;

    // ---------------- instrument + controller block ----------------
    var LAB_W = 40, ROW_H = 8, CT_ROW = 6.4;
    var blockTop = y, blockH = ROW_H * 2 + CT_ROW * 2;
    e.box(MX, blockTop, IN, blockH, null, RULE_D, 0.25);
    e.line(MX + LAB_W, blockTop, MX + LAB_W, blockTop + blockH, RULE_D, 0.25);
    e.line(MX, blockTop + ROW_H, MX + IN, blockTop + ROW_H, RULE_D, 0.18);
    e.line(MX, blockTop + ROW_H * 2, MX + IN, blockTop + ROW_H * 2, RULE_D, 0.18);
    e.line(MX + LAB_W, blockTop + ROW_H * 2 + CT_ROW, MX + IN, blockTop + ROW_H * 2 + CT_ROW, RULE_D, 0.18);

    var r1 = blockTop + 5.2;
    e.t('Digital Reference Thermometer', MX + 2, r1, 6.8, 'bold');
    var dCols = [56, 34, IN - LAB_W - 90];
    var dxs = [], dacc = MX + LAB_W;
    dCols.forEach(function (w) { dxs.push([dacc, w]); dacc += w; });
    dxs.slice(1).forEach(function (c) { e.line(c[0], blockTop, c[0], blockTop + ROW_H, RULE_D, 0.18); });
    e.label('Serial no', dxs[0][0] + 2, r1, 7, true);
    e.pill(serialOnly(val('drtSerial')) || '\u2014', dxs[0][0] + 19, blockTop + 1.6, 34, 4.8, 7);
    var dVal = e.label('Cal due', dxs[1][0] + 2, r1, 7, false);
    e.t(txtOf('drtDue') || val('drtDue') || '\u2014', dVal + 1, r1, 8.5, 'bold');
    var drtStatus = ascii(txtOf('drtCalStatus'));
    if (drtStatus) e.badge(drtStatus, dxs[2][0] + 2, blockTop + 1.8, dxs[2][1] - 4, 4.4);

    var rtTop = blockTop + ROW_H, r2 = rtTop + 5.2;
    e.t('Room Temperature (RT)', MX + 2, r2, 6.8, 'bold');
    var rtCols = [56, 29, 20, 20, IN - LAB_W - 125];
    var xs = [], acc = MX + LAB_W;
    rtCols.forEach(function (w) { xs.push([acc, w]); acc += w; });
    xs.slice(1).forEach(function (c) { e.line(c[0], rtTop, c[0], rtTop + ROW_H, RULE_D, 0.18); });
    e.label('RT Ref', xs[0][0] + 2, r2, 7, true);
    e.pill(serialOnly(val('rtRef')) || '\u2014', xs[0][0] + 13, rtTop + 1.6, 19, 4.8, 6.8);
    var rtv = ascii(txtOf('rtRefValidity'));
    if (rtv) e.badge(rtv, xs[0][0] + 34, rtTop + 1.8, xs[0][1] - 36, 4.4);
    [[xs[1], 'Cal due:', txtOf('rtDue') || val('rtDue') || monthYear(rtv), false],
     [xs[2], 'Max', val('rtMax'), true],
     [xs[3], 'Min', val('rtMin'), true],
     [xs[4], 'Average:', txtOf('rtAvg') || val('rtAvg'), false]
    ].forEach(function (col) {
      var vxx = e.label(col[1], col[0][0] + 2, r2, 7, col[3]);
      e.t(col[2] || '\u2014', vxx + 1, r2, 8.5, 'bold');
    });

    var ctTop = blockTop + ROW_H * 2;
    e.t('Controller Settings', MX + 2, ctTop + CT_ROW - 1.6, 6.8, 'bold');
    var ctSplit = MX + LAB_W + 66;
    e.line(ctSplit, ctTop, ctSplit, blockTop + blockH, RULE_D, 0.18);

    var alNotNeededYet = (function () {
      var t = document.getElementById('alTable');
      return t ? t.classList.contains('notNeeded') : true;
    })();

    // Non-Medical has one offsets field per row; Medical has Cal 1 and Cal 2.
    function ctLine(top, offLabel, offVal, spLabel, spVal, note, greyed) {
      var mid = top + CT_ROW - 2.2;
      var x = e.label(offLabel, MX + LAB_W + 2, mid, 6.8, true);
      if (spec.dualOffsets) {
        [['Cal 1:', offVal[0]], ['Cal 2:', offVal[1]]].forEach(function (pair, i) {
          var bx = x + i * 24;
          e.t(pair[0], bx, mid, 6.8);
          if (greyed) e.chip(pair[1], bx + 9, mid - 3.1, 12);
          else e.t(pair[1] || '\u2014', bx + 10, mid, 7.8, 'bold');
        });
      } else if (greyed) e.chip(offVal, x + 1, mid - 3.1, 16);
      else e.t(offVal || '\u2014', x + 1, mid, 7.8, 'bold');
      var sx = e.label(spLabel, ctSplit + 2, mid, 6.8, true);
      if (greyed) e.chip(spVal, sx + 1, mid - 3.1, 14);
      else e.t(spVal || '\u2014', sx + 1, mid, 8.5, 'bold');
      if (note) e.t('Nearest offset point used: ' + note, sx + 17, mid, 6.2, 'normal', [50, 90, 160]);
    }
    var initOff = spec.dualOffsets ? [val('initialOffsetsCal1'), val('initialOffsetsCal2')] : val('initialOffsets');
    var finalOff = spec.dualOffsets
      ? (alNotNeededYet ? ['N/A', 'N/A'] : [val('finalOffsetsCal1'), val('finalOffsetsCal2')])
      : (alNotNeededYet ? 'N/A' : val('finalOffsets'));
    ctLine(ctTop, 'Initial offsets', initOff, 'Initial set point', val('initialSetpoint'),
           (txtOf('initialNearestPoint') || '').replace('\u2014', ''), false);
    ctLine(ctTop + CT_ROW, 'Final offsets', finalOff,
           'Final set point', alNotNeededYet ? '\u2013N/A\u2013' : val('finalSetpoint'),
           alNotNeededYet ? '' : (txtOf('finalNearestPoint') || '').replace('\u2014', ''), alNotNeededYet);
    y = blockTop + blockH + 2.5;

    // ---------------- banners ----------------
    function banner(text, h, size, bad) { y = drawBanner(e, doc, y, text, bad, size); }
    banner(txtOf('afStatus') || 'As Found: readings recorded.', 6, 7.8, stateOf('afStatus') === 'bad');

    // ---------------- measurement tables ----------------
    var T = makeTable(e, doc, [{ title: 'Air', span: 2 },
                               { title: 'Load', span: 1 },
                               { title: 'Chart Recorder', span: 1 }], 44);

    function cells(prefix, key) {
      return [prefix + '_air1_' + key, prefix + '_air2_' + key,
              prefix + '_load_' + key, prefix + '_chart_' + key].map(function (id) {
        return txtOf(id) || val(id);
      });
    }
    function marks(prefix, key) {
      var out = {};
      ['air1', 'air2', 'load', 'chart'].forEach(function (col, i) {
        var el = document.getElementById(prefix + '_' + col + '_' + key + '_calc');
        if (!el) return;
        if (el.classList.contains('selectedHigh')) out[i] = 'blue';
        if (el.classList.contains('selectedLow')) out[i] = 'green';
      });
      return Object.keys(out).length ? out : null;
    }

    function table(prefix, title, greyed) {
      y = T.header(title, y, true);          // L/R shown in the probe cells
      var g = greyed;
      y = T.row(prefix === 'af' ? 'Probe Serial No' : 'Probe Serial No (as As Found)',
                cells(prefix, 'probe'), y,
                { boxed: true, inlineLR: true, required: prefix === 'af', h: 5.4,
                  greyvals: g ? [0, 1, 2, 3] : [], strike: g });
      y = T.row('Display (from product)',
                [txtOf(prefix + '_air_display') || val(prefix + '_air_display'),
                 txtOf(prefix + '_load_display') || val(prefix + '_load_display'),
                 txtOf(prefix + '_chart_display') || val(prefix + '_chart_display')], y,
                { merged: true, tint: g ? GREY_BG : GREEN_BG, bold: true, required: true, grey: g });
      y = T.row('Reference Max', cells(prefix, 'max'), y,
                { tint: g ? GREY_BG : GREEN_BG, required: true, grey: g });
      y = T.row('Probe Correction value', cells(prefix, 'max_corr'), y,
                { tint: g ? GREY_BG : AMBER_BG, grey: g });
      y = T.row('Max + Correction', cells(prefix, 'max_calc'), y,
                { bold: true, grey: g, marks: g ? null : marks(prefix, 'max') });
      y = T.row('Reference Min', cells(prefix, 'min'), y,
                { tint: g ? GREY_BG : GREEN_BG, required: true, grey: g });
      y = T.row('Probe Correction Value', cells(prefix, 'min_corr'), y,
                { tint: g ? GREY_BG : AMBER_BG, grey: g });
      y = T.row('Min + Correction', cells(prefix, 'min_calc'), y,
                { bold: true, grey: g, marks: g ? null : marks(prefix, 'min') });
      y = T.row(['Average ref: Min & Max', '(after correction)'],
                [txtOf(prefix + '_air_avg') || val(prefix + '_air_avg'),
                 txtOf(prefix + '_load_avg') || val(prefix + '_load_avg'),
                 txtOf(prefix + '_chart_avg') || val(prefix + '_chart_avg')], y,
                { merged: true, bold: true, h: 6.2, tint: g ? GREY_BG : null, grey: g });
      y = T.row(['Difference of Average', 'Reference vs Display'],
                [txtOf(prefix + '_air_diff') || val(prefix + '_air_diff'),
                 txtOf(prefix + '_load_diff') || val(prefix + '_load_diff'),
                 txtOf(prefix + '_chart_diff') || val(prefix + '_chart_diff')], y,
                { merged: true, bold: true, h: 6.2, grey: g,
                  tints: g ? [GREY_BG, GREY_BG, GREY_BG]
                           : [tintFor(stateOf(prefix + '_air_diff')),
                              tintFor(stateOf(prefix + '_load_diff')),
                              tintFor(stateOf(prefix + '_chart_diff'))] });
    }

    table('af', 'As Found (AF)', false);
    y += 1.6;
    // The on-screen wording is deliberately fuller; on paper a single line
    // reads better and buys a row of space.
    var tolTxt = spec.tolerance();
    var alScreen = ascii(txtOf('alStatus'));
    var alShort = alNotNeededYet
      ? ('Adjustment not needed \u2014 As Found within tolerance' + (tolTxt ? ' ' + tolTxt : '') + '. As Left not applicable.')
      : 'Adjustment carried out \u2014 see the As Left readings below.';
    banner(alScreen && alScreen.length <= 110 ? alScreen : alShort, 6, 7.6, stateOf('alStatus') === 'bad');
    table('al', 'As Left (AL)', alNotNeededYet);
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
    [['AF', 'Air', 'af_cycle_air_max', 'af_cycle_air_min', 'af_cycle_air_avg', false],
     ['AF', 'Load', 'af_cycle_load_max', 'af_cycle_load_min', 'af_cycle_load_avg', false],
     ['AL', 'Air', 'al_cycle_air_max', 'al_cycle_air_min', 'al_cycle_air_avg', alNotNeededYet],
     ['AL', 'Load', 'al_cycle_load_max', 'al_cycle_load_min', 'al_cycle_load_avg', alNotNeededYet]
    ].forEach(function (r, idx) {
      var top = y, grey = r[5];
      var tint = grey ? GREY_BG : GREEN_BG;
      var cxx = MX + DCW[0];
      for (var i = 1; i <= 3; i++) { e.box(cxx + 0.2, top + 0.2, DCW[i] - 0.4, rh - 0.4, tint, null); cxx += DCW[i]; }
      if (idx % 2 === 0) {
        e.box(MX + 0.2, top + 0.2, DCW[0] * 0.42, rh * 2 - 0.4, HDR_BG, null);
        e.t(r[0], MX + DCW[0] * 0.21, top + rh + 1, 7.5, 'bold', INK, 'center');
      }
      e.t(r[1], MX + DCW[0] * 0.46, top + rh - 1.8, 7, 'normal', grey ? GREY_TXT : INK);
      cxx = MX + DCW[0];
      [r[2], r[3], r[4]].forEach(function (id, i) {
        e.t(dash(txtOf(id) || val(id)), cxx + DCW[i + 1] / 2, top + rh - 1.8, 8.5, 'bold', grey ? GREY_TXT : INK, 'center');
        cxx += DCW[i + 1];
      });
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
        e.chip(val('al_adj_made') || (alNotNeededYet ? 'Adjustment not needed' : 'Adjustment made'),
               tx + DCW[4] + 1, top + 1.2, DCW[5] - 2);
      } else if (idx === 2) {
        e.label('Cycle start', tx + 1.5, top + rh - 1.8, 6.8, true);
        if (!alNotNeededYet) {
          e.t(val('al_cycle_start_h') || '\u2014', tx + DCW[4] + 8, top + rh - 1.8, 8.5, 'bold', INK, 'center');
          e.t(':', tx + DCW[4] + 15, top + rh - 1.8, 8, 'normal', INK, 'center');
          e.t(val('al_cycle_start_m') || '\u2014', tx + DCW[4] + 22, top + rh - 1.8, 8.5, 'bold', INK, 'center');
        } else {
          e.chip('N/A', tx + DCW[4] + 4, top + 1.2, 9);
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

    // ---------------- comments, then signatures ----------------
    y = drawCommentsAndSignatures(e, doc, y, haveScript, { certNo: val('certNo'), subtitle: head.subtitle });
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
    var headBk = headingFor('Engineer Calibration Worksheet', 'Barkey');
    y = drawHeader(e, doc, {
      title: headBk.title,
      subtitle: headBk.subtitle,
      number: val('sheetNo')
    });

    // ---------------- meta ----------------
    // Engineer appears in the signature block and the reference thermometer
    // has its own row below, so neither needs repeating here.
    var META = [
      ['Job reference', val('jobRef'), 'Date', val('date') || val('dateNative')],
      ['Site', val('site'), 'Department', val('dept')],
      ['Model', val('model'), 'Serial number', val('serial')]
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

    // ---------------- reference thermometer + room temperature ----------------
    // One bordered block, two labelled rows, the same shape as the room
    // temperature row on the 19/24 sheet.
    var LAB_W = 40, ROW_H = 8;
    var blockTop = y, blockH = ROW_H * 2;
    e.box(MX, blockTop, IN, blockH, null, RULE_D, 0.25);
    e.line(MX + LAB_W, blockTop, MX + LAB_W, blockTop + blockH, RULE_D, 0.25);
    e.line(MX, blockTop + ROW_H, MX + IN, blockTop + ROW_H, RULE_D, 0.18);

    // --- row 1: digital reference thermometer ---
    var r1 = blockTop + 5.2;
    e.t('Digital Reference Thermometer', MX + 2, r1, 6.8, 'bold');
    var dCols = [56, 34, IN - LAB_W - 90];
    var dxs = [], dacc = MX + LAB_W;
    dCols.forEach(function (w) { dxs.push([dacc, w]); dacc += w; });
    dxs.slice(1).forEach(function (c) { e.line(c[0], blockTop, c[0], blockTop + ROW_H, RULE_D, 0.18); });

    e.label('Serial no', dxs[0][0] + 2, r1, 7, true);
    e.pill(serialOnly(val('refTherm')) || '\u2014', dxs[0][0] + 19, blockTop + 1.6, 34, 4.8, 7);
    var dVal = e.label('Cal due', dxs[1][0] + 2, r1, 7, false);
    e.t(monthYear(txtOf('refThermCalDue')) || '\u2014', dVal + 1, r1, 8.5, 'bold');
    var drtBadge = ascii(txtOf('refThermCalDue'));
    if (/valid/i.test(drtBadge)) {
      e.badge(drtBadge.replace(/^[^A-Za-z]*/, ''), dxs[2][0] + 2, blockTop + 1.8, dxs[2][1] - 4, 4.4);
    }

    // --- row 2: room temperature ---
    var rtTop = blockTop + ROW_H, r2 = rtTop + 5.2;
    e.t('Room Temperature (RT)', MX + 2, r2, 6.8, 'bold');
    var rtCols = [56, 29, 20, 20, IN - LAB_W - 125];
    var xs = [], acc = MX + LAB_W;
    rtCols.forEach(function (w) { xs.push([acc, w]); acc += w; });
    xs.slice(1).forEach(function (c) { e.line(c[0], rtTop, c[0], rtTop + ROW_H, RULE_D, 0.18); });

    e.label('RT Ref', xs[0][0] + 2, r2, 7, true);
    e.pill(serialOnly(val('rtRef')) || '\u2014', xs[0][0] + 13, rtTop + 1.6, 19, 4.8, 6.8);
    var rtv = ascii(txtOf('rtRefValidity'));
    if (rtv) e.badge(rtv, xs[0][0] + 34, rtTop + 1.8, xs[0][1] - 36, 4.4);

    [[xs[1], 'Cal due:', monthYear(txtOf('rtRefValidity')), false],
     [xs[2], 'Max', val('rtMax'), true],
     [xs[3], 'Min', val('rtMin'), true],
     [xs[4], 'Average:', txtOf('rtAvg'), false]
    ].forEach(function (col) {
      var vxx = e.label(col[1], col[0][0] + 2, r2, 7, col[3]);
      e.t(col[2] || '\u2014', vxx + 1, r2, 8.5, 'bold');
    });
    y = blockTop + blockH + 2.5;

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

    function banner(text, good) { y = drawBanner(e, doc, y, text, !good); }

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

  // =====================================================================
  // Job summary
  // =====================================================================
  // An end-of-day sheet for the whole job: every unit, where it was, which
  // worksheet it took, what happened to it and its certificate number.
  // Takes the job straight from the worklist, so it cannot disagree with the
  // panel on screen.
  function buildJobSummary(job, progress) {
    var jsPDFctor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!jsPDFctor) throw new Error('The PDF library did not load.');
    if (!job || !job.devices || !job.devices.length) throw new Error('There are no units on this job yet.');
    var doc = new jsPDFctor({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    var e = new Engine(doc);

    var SHEETS = (global.LabCalJobsheet && global.LabCalJobsheet.SHEETS) || {};
    var COLS = [8, 28, 32, 38, 24, 28, 28];
    var HEADS = ['#', 'Model', 'Serial number', 'Location', 'Worksheet', 'Status', 'Certificate'];
    var ROW_H = 5.4;

    function pageHead(first) {
      var y = MT;
      e.t(first ? 'Job Summary' : 'Job Summary (continued)', MX, y + 5, 14, 'bold');
      e.t([job.callNumber || '(no job reference)', job.customer || ''].filter(Boolean).join('  \u00b7  '),
          MX, y + 9.6, 8, 'bold', [40, 70, 120]);
      e.t('LABCOLD', PW - MX, y + 6.5, 15, 'bold', INK, 'right');
      var d = new Date();
      var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      e.t(String(d.getDate()).padStart(2, '0') + '/' + MONTHS[d.getMonth()] + '/' + d.getFullYear(),
          PW - MX, y + 11, 8, 'normal', NOTE, 'right');
      y += 15;

      if (first) {
        var p = progress || {};
        var bits = [
          p.total + ' unit' + (p.total === 1 ? '' : 's'),
          p.done + ' certified',
          (p.notRequired || 0) + ' not required',
          (p.outstanding || 0) + ' outstanding'
        ];
        e.box(MX, y, IN, 7, (p.outstanding ? [253, 243, 220] : GREEN_BG),
              (p.outstanding ? [227, 196, 150] : GREEN_BD), 0.2);
        e.t(bits.join('   \u00b7   '), MX + 3, y + 4.8, 8.5, 'bold',
            p.outstanding ? [122, 76, 6] : GREEN_TX);
        y += 9.5;
      }

      var hh = 5.6;
      e.box(MX, y, IN, hh, HDR_BG, RULE_D, 0.25);
      var x = MX;
      HEADS.forEach(function (h, i) {
        if (i) e.line(x, y, x, y + hh, RULE_D, 0.25);
        e.t(h, x + 1.8, y + hh - 1.7, 7.2, 'bold');
        x += COLS[i];
      });
      return y + hh;
    }

    function statusOf(d) {
      if (d.done) return { text: 'Certified', tint: GREEN_BG, col: GREEN_TX };
      if (d.notRequired) return { text: 'Not required', tint: GREY_BG, col: GREY_TXT };
      if (global.LabCalJobsheet && global.LabCalJobsheet.isStarted &&
          global.LabCalJobsheet.isStarted(job.callNumber, d)) {
        return { text: 'Started', tint: [253, 243, 220], col: [122, 76, 6] };
      }
      return { text: 'To do', tint: null, col: INK };
    }

    var y = pageHead(true);
    job.devices.forEach(function (d, i) {
      if (y + ROW_H > PH - 18) { doc.addPage(); y = pageHead(false); }
      var st = statusOf(d);
      if (st.tint) e.box(MX, y, IN, ROW_H, st.tint, null);
      var sheetName = d.sheet && SHEETS[d.sheet] ? SHEETS[d.sheet].name : '\u2014';
      var serial = d.serial || '\u2014';
      var cells = [String(i + 1), d.model || d.equipment || '\u2014', serial,
                   d.location || '\u2014', sheetName, st.text, d.certRef || '\u2014'];
      var x = MX;
      cells.forEach(function (c, ci) {
        if (ci) e.line(x, y, x, y + ROW_H, RULE, 0.18);
        var size = 7.4;
        while (size > 5 && e.w(c, size) > COLS[ci] - 3) size -= 0.2;
        e.t(c, x + 1.8, y + ROW_H - 1.7, size,
            (ci === 5 || ci === 6) ? 'bold' : 'normal',
            (ci === 5) ? st.col : (d.notRequired && !d.done ? GREY_TXT : INK));
        x += COLS[ci];
      });
      e.line(MX, y + ROW_H, MX + IN, y + ROW_H, RULE, 0.18);
      e.line(MX, y, MX, y + ROW_H, RULE_D, 0.25);
      e.line(MX + IN, y, MX + IN, y + ROW_H, RULE_D, 0.25);
      // a corrected serial is worth showing alongside what the sheet said
      if (d.sheetSerial && serialDiffers(d.sheetSerial, d.serial)) {
        e.t('jobsheet read ' + d.sheetSerial, MX + COLS[0] + COLS[1] + 1.8, y + ROW_H + 2.6, 5.6, 'italic', NOTE);
        y += 3;
      }
      y += ROW_H;
    });

    y += 4;
    e.t('Not required units are shown for completeness and were not calibrated. '
      + 'Certificates are issued separately per unit.', MX, y, 6.6, 'normal', NOTE);

    var n = doc.getNumberOfPages();
    for (var pg = 1; pg <= n; pg++) {
      doc.setPage(pg);
      e.t('Page ' + pg + ' of ' + n, PW - MX, PH - 8, 6.2, 'normal', NOTE, 'right');
      e.t((job.callNumber || '') + (job.customer ? '  \u00b7  ' + job.customer : ''),
          MX, PH - 8, 6.2, 'normal', NOTE);
    }
    return doc;
  }

  function serialDiffers(a, b) {
    return String(a || '').replace(/[^a-z0-9]/gi, '').toUpperCase()
        !== String(b || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  }

  global.LabCalVectorPdf = {
    supports: function (sheet) {
      return sheet === 'ws19_24' || sheet === 'barkey' || sheet === 'snmd' || sheet === 'smd';
    },
    buildSNMD: function () { return buildSNMD('snmd'); },
    blobSNMD: function () { return buildSNMD('snmd').output('blob'); },
    buildSMD: function () { return buildSNMD('smd'); },
    buildJobSummary: buildJobSummary,
    blobJobSummary: function (job, progress) { return buildJobSummary(job, progress).output('blob'); },
    blobSMD: function () { return buildSNMD('smd').output('blob'); },
    build19_24: build19_24,
    blob19_24: function () { return build19_24().output('blob'); },
    buildBarkey: buildBarkey,
    blobBarkey: function () { return buildBarkey().output('blob'); }
  };
})(typeof window !== 'undefined' ? window : this);
