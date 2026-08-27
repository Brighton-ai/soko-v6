/**
 * Shule — school admin dashboard.
 *
 * Every figure on this page is fetched through assets/js/api.js and rendered
 * here. Nothing is hardcoded in dashboard.html: the markup carries skeletons,
 * empty states and container elements only. The tests recompute each KPI from
 * the dataset and compare it against what this file rendered, so a number
 * typed into the HTML would fail rather than pass quietly.
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var API = global.ShuleAPI;
  var SHELL = global.ShuleShell;
  var SCHOOL = SHELL ? SHELL.SCHOOL_ID : 'sch-riverside';

  // ── formatting ────────────────────────────────────────────────────────
  var nf = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });
  function num(n) { return nf.format(Math.round(n)); }
  function kes(n) { return 'KES ' + num(n); }
  /** Compact money for tight columns: 1.15M, 312k, 940. */
  function kesShort(n) {
    var v = Math.abs(n);
    if (v >= 1000000) return 'KES ' + (n / 1000000).toFixed(2) + 'M';
    if (v >= 1000) return 'KES ' + Math.round(n / 1000) + 'k';
    return 'KES ' + num(n);
  }
  function pct(n) { return n.toFixed(1) + '%'; }
  function signed(n, digits) {
    var v = digits ? Math.abs(n).toFixed(digits) : num(Math.abs(n));
    return (n > 0 ? '+' : n < 0 ? '−' : '') + v;
  }
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
  function longDate(isoDate) {
    var d = new Date(isoDate + 'T00:00:00Z');
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()] +
      ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
  }
  function clockOf(stampStr) { return stampStr ? stampStr.slice(11, 16) : '—'; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ── panel state ───────────────────────────────────────────────────────
  function panel(name) { return doc.querySelector('[data-panel="' + name + '"]'); }
  /** Swaps a panel between its loading, content and empty regions. */
  function show(name, region) {
    var p = panel(name);
    if (!p) return;
    ['loading', 'content', 'empty'].forEach(function (r) {
      var el = p.querySelector('[data-region="' + r + '"]');
      if (el) el.hidden = r !== region;
    });
    p.setAttribute('data-state', region);
  }
  function failed(name, message) {
    var p = panel(name);
    if (!p) return;
    var el = p.querySelector('[data-region="empty"]');
    if (el) {
      el.innerHTML = '<div class="empty empty--bad"><span class="empty__ico">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>' +
        '</span><b>Could not load this panel</b><p>' + esc(message) + '</p></div>';
    }
    show(name, 'empty');
  }
  function bind(key, value) {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-bind="' + key + '"]'), function (el) {
      el.textContent = value;
    });
  }

  var UP = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
  var DOWN = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  /**
   * @param good  which direction is good news: 'up' or 'down'.
   *              Outstanding falling is good; collection rate falling is not.
   */
  function setKpi(key, value, delta, opts) {
    opts = opts || {};
    var tile = doc.querySelector('[data-kpi="' + key + '"]');
    if (!tile) return;
    tile.querySelector('[data-kpi-value]').textContent = value;
    var d = tile.querySelector('[data-kpi-delta]');
    if (delta == null || !isFinite(delta)) {
      d.innerHTML = '<b class="flat">—</b> <span>' + esc(opts.note || 'no comparison available') + '</span>';
      return;
    }
    var rising = delta > 0;
    var goodWhenUp = opts.good !== 'down';
    var tone = delta === 0 ? 'flat' : (rising === goodWhenUp ? 'up' : 'down');
    var arrow = delta === 0 ? '' : (rising ? UP : DOWN);
    d.innerHTML = '<b class="' + tone + '">' + arrow + opts.format(delta) + '</b> <span>' + esc(opts.note) + '</span>';
  }

  // ══════════════════════════════════════════════════════════════════════
  // KPI row
  // ══════════════════════════════════════════════════════════════════════
  function renderSummary(s) {
    bind('term-long', s.term_name);
    bind('today-long', longDate(s.date));

    setKpi('enrolment', num(s.enrolment.value), s.enrolment.delta, {
      good: 'up', note: 'on last term', format: function (d) { return signed(d); }
    });

    setKpi('collection', pct(s.collection_rate.value), s.collection_rate.delta, {
      good: 'up', note: 'on last term', format: function (d) { return signed(d, 1) + ' pts'; }
    });

    setKpi('outstanding', kes(s.outstanding.value), s.outstanding.delta, {
      good: 'down',
      note: s.outstanding.pupils_owing + (s.outstanding.pupils_owing === 1 ? ' pupil owing' : ' pupils owing'),
      format: function (d) { return signed(d) + ' KES'; }
    });

    var att = s.attendance_today;
    if (att.value == null) {
      setKpi('attendance', '—', null, { note: 'no register marked yet' });
    } else {
      setKpi('attendance', pct(att.value), att.delta, {
        good: 'up',
        note: att.marked_classes + ' of ' + att.total_classes + ' registers in',
        format: function (d) { return signed(d, 1) + ' pts'; }
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Collections chart — 14 bars, peak day solid orange
  // ══════════════════════════════════════════════════════════════════════
  function renderChart(days) {
    var svg = doc.getElementById('collections-chart');
    if (!svg) return;
    var total = days.reduce(function (n, d) { return n + d.amount; }, 0);
    if (!days.length || total === 0) { show('collections', 'empty'); return; }

    var W = 720, H = 240, L = 58, R = 14, T = 18, B = 30;
    var plotW = W - L - R, plotH = H - T - B;
    var max = Math.max.apply(null, days.map(function (d) { return d.amount; }));
    var peak = days.reduce(function (best, d) { return d.amount > best.amount ? d : best; }, days[0]);
    var slot = plotW / days.length, barW = Math.min(30, slot * 0.56);

    var parts = [];
    // horizontal grid + money axis
    for (var g = 0; g <= 4; g++) {
      var y = T + plotH - (plotH * g / 4);
      parts.push('<line class="chart__grid" x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) + '"/>');
      parts.push('<text class="chart__lbl" x="' + (L - 8) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' +
        (g === 0 ? '0' : Math.round(max * g / 4 / 1000) + 'k') + '</text>');
    }

    days.forEach(function (d, i) {
      var h = max ? (d.amount / max) * plotH : 0;
      var x = L + slot * i + (slot - barW) / 2;
      var y = T + plotH - h;
      var isPeak = d.date === peak.date;
      parts.push('<rect class="chart__bar' + (isPeak ? ' is-peak' : '') + '"' +
        ' data-date="' + d.date + '" data-value="' + d.amount + '"' +
        ' x="' + x.toFixed(1) + '" y="' + y.toFixed(2) + '" width="' + barW.toFixed(1) +
        '" height="' + h.toFixed(2) + '" rx="3"><title>' + esc(longDate(d.date)) + ' · ' + kes(d.amount) + '</title></rect>');
      parts.push('<text class="chart__lbl" x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 10) +
        '" text-anchor="middle">' + DAYS[d.weekday] + '</text>');
      if (isPeak) {
        parts.push('<text class="chart__peak" x="' + (x + barW / 2).toFixed(1) + '" y="' + (y - 6).toFixed(1) +
          '" text-anchor="middle">' + kesShort(d.amount) + '</text>');
      }
    });
    parts.push('<line class="chart__axis" x1="' + L + '" y1="' + (T + plotH) + '" x2="' + (W - R) + '" y2="' + (T + plotH) + '"/>');

    svg.innerHTML = parts.join('');
    svg.setAttribute('aria-label', 'Daily fee collections for the last fourteen days. ' +
      kes(total) + ' collected in total, peaking at ' + kes(peak.amount) + ' on ' + longDate(peak.date) + '.');

    bind('chart-total', kes(total) + ' over 14 days');
    bind('chart-peak', 'Peak ' + kes(peak.amount) + ' · ' + longDate(peak.date));
    show('collections', 'content');
  }

  // ══════════════════════════════════════════════════════════════════════
  // Arrears by class
  // ══════════════════════════════════════════════════════════════════════
  function renderArrears(rows) {
    var body = doc.getElementById('arrears-rows');
    if (!body) return;
    if (!rows.length) { show('arrears', 'empty'); return; }

    var total = rows.reduce(function (n, r) { return n + r.outstanding; }, 0);
    body.innerHTML = rows.map(function (r) {
      var share = total ? r.outstanding / total * 100 : 0;
      return '<tr data-class="' + r.class_id + '">' +
        '<td class="strong">' + esc(r.class_name) + '</td>' +
        '<td class="r"><span data-cell="owing">' + r.pupils_owing + '</span><span class="sub"> / ' + r.pupils + '</span></td>' +
        '<td class="r owe" data-cell="outstanding">' + kes(r.outstanding) + '</td>' +
        '<td><span class="bar"><span class="bar__t"><i class="bar__f" style="width:' + share.toFixed(1) + '%"></i></span>' +
          '<span class="bar__v">' + share.toFixed(0) + '%</span></span></td>' +
        '<td class="r"><button type="button" class="btn btn--ghost btn--sm" data-remind="' + r.class_id +
          '" data-class-name="' + esc(r.class_name) + '">Send reminders</button></td>' +
        '</tr>';
    }).join('');

    bind('arrears-total', kes(total) + ' outstanding across ' + rows.length +
      (rows.length === 1 ? ' class' : ' classes'));

    Array.prototype.forEach.call(body.querySelectorAll('[data-remind]'), function (btn) {
      btn.addEventListener('click', function () { sendReminders(btn); });
    });
    show('arrears', 'content');
  }

  function sendReminders(btn) {
    var classId = btn.getAttribute('data-remind');
    var name = btn.getAttribute('data-class-name');
    btn.disabled = true;
    API.sendFeeReminders(SCHOOL, { classId: classId }).then(function (res) {
      btn.disabled = false;
      btn.textContent = 'Reminders sent';
      SHELL.toast('<b>' + res.reminders_sent + '</b> reminder' + (res.reminders_sent === 1 ? '' : 's') +
        ' queued for ' + esc(name) + '.', { html: true });
    }).catch(function (err) {
      btn.disabled = false;
      SHELL.toast('Could not send reminders: ' + esc(err.message), { tone: 'bad' });
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Register status today
  // ══════════════════════════════════════════════════════════════════════
  function renderRegister(rows) {
    var body = doc.getElementById('register-rows');
    if (!body) return;
    if (!rows.length) { show('register', 'empty'); return; }
    if (!rows.some(function (r) { return r.marked; })) { show('register', 'empty'); return; }

    body.innerHTML = rows.map(function (r) {
      var tag = r.marked
        ? '<span class="tag tag--ok"><i></i>Marked ' + clockOf(r.marked_at) + '</span>'
        : (r.overdue
            ? '<span class="tag tag--bad"><i></i>Not marked · past ' + r.due_by + '</span>'
            : '<span class="tag tag--mute"><i></i>Not marked yet</span>');
      return '<tr data-class="' + r.class_id + '" data-marked="' + r.marked + '">' +
        '<td class="strong">' + esc(r.class_name) + '<span class="sub"> · ' + r.roll + '</span></td>' +
        '<td>' + tag + '</td>' +
        '<td>' + (r.marked ? esc(r.marked_by_name) : '<span class="sub">' + esc(r.class_teacher_name || '—') + '</span>') + '</td>' +
        '<td class="r">' + (r.marked ? r.present + r.late : '<span class="sub">—</span>') + '</td>' +
        '<td class="r">' + (r.marked ? (r.absent + r.excused) : '<span class="sub">—</span>') + '</td>' +
        '</tr>';
    }).join('');

    var marked = rows.filter(function (r) { return r.marked; }).length;
    var late = rows.filter(function (r) { return !r.marked && r.overdue; });
    bind('register-summary', marked + ' of ' + rows.length + ' registers in' +
      (late.length ? ' · outstanding: ' + late.map(function (r) { return r.class_name; }).join(', ') : ''));
    show('register', 'content');
  }

  // ══════════════════════════════════════════════════════════════════════
  // Recent payments
  // ══════════════════════════════════════════════════════════════════════
  function renderPayments(rows) {
    var body = doc.getElementById('payment-rows');
    if (!body) return;
    if (!rows.length) { show('payments', 'empty'); return; }
    body.innerHTML = rows.map(function (p) {
      return '<tr>' +
        '<td class="strong">' + esc(p.mpesa_code || '—') + '<span class="sub"> · ' + esc(p.method) + '</span></td>' +
        '<td>' + esc(p.student_name) + '<span class="sub"> · ' + esc(p.admission_no) + '</span></td>' +
        '<td>' + esc(p.class_name) + '</td>' +
        '<td class="r strong">' + kes(p.amount) + '</td>' +
        '<td class="r sub">' + esc(longDate(p.paid_at.slice(0, 10)).slice(0, 3)) + ' ' + clockOf(p.paid_at) + '</td>' +
        '</tr>';
    }).join('');
    show('payments', 'content');
  }

  // ══════════════════════════════════════════════════════════════════════
  // Needs attention
  // ══════════════════════════════════════════════════════════════════════
  var CHEV = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

  function renderAttention(rows) {
    var host = doc.getElementById('attention-list');
    if (!host) return;
    var live = rows.filter(function (r) { return r.count > 0; });
    if (!live.length) { show('attention', 'empty'); return; }
    host.innerHTML = live.map(function (r) {
      var inner = '<span class="stack__n ' + r.severity + '">' + num(r.count) + '</span>' +
        '<span class="stack__x"><b>' + esc(r.label) + '</b><span>' + esc(r.detail) + '</span></span>' + CHEV;
      // built destinations are real links; the rest say which step brings them
      return r.step
        ? '<a class="stack__i" href="#" data-attention="' + r.key + '" data-step="' + r.step + '">' + inner + '</a>'
        : '<a class="stack__i" href="' + esc(r.href) + '" data-attention="' + r.key + '">' + inner + '</a>';
    }).join('');
    show('attention', 'content');
  }

  // ══════════════════════════════════════════════════════════════════════
  // Quick action modals
  // ══════════════════════════════════════════════════════════════════════
  function setErr(el, message) {
    var box = doc.getElementById(el.id + '-err');
    if (message) {
      el.setAttribute('aria-invalid', 'true');
      if (box) { box.textContent = message; box.classList.add('on'); }
    } else {
      el.setAttribute('aria-invalid', 'false');
      if (box) { box.textContent = ''; box.classList.remove('on'); }
    }
    return !message;
  }
  function clearErrs(form) {
    Array.prototype.forEach.call(form.querySelectorAll('.err'), function (e) {
      e.textContent = ''; e.classList.remove('on');
    });
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid="true"]'), function (e) {
      e.setAttribute('aria-invalid', 'false');
    });
  }
  function selected(sel) {
    return Array.prototype.filter.call(sel.options, function (o) { return o.selected; })
      .map(function (o) { return o.value; });
  }
  function fill(sel, rows, valueKey, labelKey, keepFirst) {
    if (!sel) return;
    var head = keepFirst && sel.options.length ? sel.options[0].outerHTML : '';
    sel.innerHTML = head + rows.map(function (r) {
      return '<option value="' + esc(r[valueKey]) + '">' + esc(r[labelKey]) + '</option>';
    }).join('');
  }

  function wireActions(ctx) {
    fill(doc.getElementById('gen-term'), ctx.terms, 'id', 'label', true);
    fill(doc.getElementById('gen-classes'), ctx.classes, 'id', 'full_name', false);
    fill(doc.getElementById('reg-class'), ctx.unmarked.length ? ctx.unmarked : ctx.classes, 'id', 'full_name', true);
    fill(doc.getElementById('reg-teacher'), ctx.teachers, 'id', 'name', true);
    fill(doc.getElementById('stu-class'), ctx.classes, 'id', 'full_name', true);
    fill(doc.getElementById('pub-class'), ctx.draftClasses, 'id', 'full_name', true);
    fill(doc.getElementById('pub-exam'), ctx.exams, 'id', 'name', true);

    var regDate = doc.getElementById('reg-date');
    if (regDate) { regDate.value = ctx.today; regDate.max = ctx.today; }

    // ── bulk-generate invoices ──
    on('modal-invoices-form', function (form) {
      var term = doc.getElementById('gen-term'),
          cls = doc.getElementById('gen-classes'),
          due = doc.getElementById('gen-due');
      var ok = [
        setErr(term, term.value ? '' : 'Choose the term these invoices belong to.'),
        setErr(cls, selected(cls).length ? '' : 'Select at least one class — nothing is generated otherwise.'),
        setErr(due, due.value ? '' : 'Set a due date so reminders know when to start.')
      ].every(Boolean);
      if (!ok) return null;
      return API.generateInvoices(SCHOOL, { termId: term.value, classIds: selected(cls), dueDate: due.value })
        .then(function (r) {
          return '<b>' + r.invoices_created + '</b> invoices generated across ' + r.class_ids.length +
            (r.class_ids.length === 1 ? ' class' : ' classes') + '.';
        });
    });

    // ── mark a register ──
    on('modal-register-form', function (form) {
      var cls = doc.getElementById('reg-class'),
          date = doc.getElementById('reg-date'),
          teacher = doc.getElementById('reg-teacher');
      var ok = [
        setErr(cls, cls.value ? '' : 'Choose the class whose register you are marking.'),
        setErr(date, date.value ? '' : 'A register needs a date.'),
        setErr(teacher, teacher.value ? '' : 'Say who is marking it — every mark is stamped with a name.')
      ].every(Boolean);
      if (!ok) return null;
      return API.listStudents(SCHOOL, { classId: cls.value, pageSize: 400 }).then(function (page) {
        return API.markAttendance(SCHOOL, cls.value, {
          date: date.value,
          markedBy: teacher.value,
          records: page.items.map(function (s) { return { student_id: s.id, status: 'present' }; })
        });
      }).then(function (r) {
        return 'Register opened for <b>' + r.marked + '</b> pupils on ' + r.date + '.';
      }).catch(function (err) {
        setErr(cls, err.message);
        throw err;
      });
    });

    // ── add a student ──
    on('modal-student-form', function (form) {
      var name = doc.getElementById('stu-name'),
          cls = doc.getElementById('stu-class'),
          guardian = doc.getElementById('stu-guardian'),
          ph = doc.getElementById('stu-phone');
      var digits = ph.value.replace(/[\s+()-]/g, '');
      var ok = [
        setErr(name, name.value.trim().length >= 2 ? '' : 'Enter the pupil’s full name.'),
        setErr(cls, cls.value ? '' : 'Every pupil is admitted into a class.'),
        setErr(guardian, guardian.value.trim().length >= 2 ? '' : 'Enter the primary guardian’s name.'),
        setErr(ph, (/^\d{9,13}$/.test(digits)) ? '' : 'Digits only, please — for example 0712 345 678.')
      ].every(Boolean);
      if (!ok) return null;
      return API.createStudent(SCHOOL, {
        name: name.value.trim(), class_id: cls.value,
        guardian_name: guardian.value.trim(), guardian_phone: ph.value.trim()
      }).then(function (s) {
        return '<b>' + esc(s.name) + '</b> admitted as ' + esc(s.admission_no) + '.';
      });
    });

    // ── publish report cards ──
    on('modal-publish-form', function (form) {
      var cls = doc.getElementById('pub-class'), exam = doc.getElementById('pub-exam');
      var ok = [
        setErr(cls, cls.value ? '' : 'Choose the class whose cards you are publishing.'),
        setErr(exam, exam.value ? '' : 'Choose which exam these cards report on.')
      ].every(Boolean);
      if (!ok) return null;
      return API.publishReportCards(SCHOOL, { classId: cls.value, examId: exam.value })
        .then(function (r) {
          return r.published
            ? '<b>' + r.published + '</b> report cards published to guardians.'
            : 'Nothing to publish — every card in that class is already out.';
        });
    });
  }

  /** Wires one modal form: validate, act, toast, close. Stays open when invalid. */
  function on(formId, handler) {
    var form = doc.getElementById(formId);
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = form.querySelector('button[type="submit"]');
      var result = handler(form);
      if (!result) return;                       // invalid: errors are already on screen
      if (submit) submit.disabled = true;
      result.then(function (message) {
        if (submit) submit.disabled = false;
        clearErrs(form);
        SHELL.closeModal();
        SHELL.toast(message);
        refresh();
      }).catch(function (err) {
        if (submit) submit.disabled = false;
        if (!form.querySelector('[aria-invalid="true"]')) {
          SHELL.toast('That did not go through: ' + esc(err.message), { tone: 'bad' });
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Load
  // ══════════════════════════════════════════════════════════════════════
  function refresh() {
    return Promise.all([
      API.getDashboardSummary(SCHOOL, {}),
      API.getArrearsByClass(SCHOOL, {})
    ]).then(function (r) {
      renderSummary(r[0]);
      renderArrears(r[1]);
    });
  }

  function load() {
    if (!API || !SHELL) return;

    API.getDashboardSummary(SCHOOL, {}).then(renderSummary)
      .catch(function (e) { global.console.error(e); });

    API.getDailyCollections(SCHOOL, { days: 14 }).then(renderChart)
      .catch(function (e) { failed('collections', e.message); });

    API.getArrearsByClass(SCHOOL, {}).then(renderArrears)
      .catch(function (e) { failed('arrears', e.message); });

    API.getRegisterStatus(SCHOOL, {}).then(renderRegister)
      .catch(function (e) { failed('register', e.message); });

    API.listPayments(SCHOOL, { limit: 10 }).then(renderPayments)
      .catch(function (e) { failed('payments', e.message); });

    API.getNeedsAttention(SCHOOL, {}).then(renderAttention)
      .catch(function (e) { failed('attention', e.message); });

    Promise.all([
      API.listClasses(SCHOOL, {}),
      API.listTeachers(SCHOOL, {}),
      API.listExams(SCHOOL, {}),
      API.getRegisterStatus(SCHOOL, {}),
      API.listReportCards(SCHOOL, { status: 'draft' }),
      API.getDashboardSummary(SCHOOL, {})
    ]).then(function (r) {
      var classes = r[0], teachers = r[1], exams = r[2], register = r[3], drafts = r[4], summary = r[5];
      var draftIds = drafts.map(function (c) { return c.class_id; });
      wireActions({
        classes: classes,
        teachers: teachers,
        exams: exams,
        today: summary.date,
        terms: [{ id: summary.term_id, label: summary.term_name }],
        unmarked: register.filter(function (x) { return !x.marked; })
          .map(function (x) { return { id: x.class_id, full_name: x.class_name }; }),
        draftClasses: classes.filter(function (c) { return draftIds.indexOf(c.id) !== -1; })
      });
      doc.body.setAttribute('data-ready', '1');
    }).catch(function (e) {
      global.console.error(e);
      doc.body.setAttribute('data-ready', 'error');
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', load);
  else load();
})(typeof window !== 'undefined' ? window : globalThis);
