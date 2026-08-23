/**
 * attendance.html — take the register, or look back over the term.
 *
 * Submitting a register that already exists updates it in place. One record per
 * pupil per class per date, always; the backend upserts and the page says which
 * it did.
 */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, SHELL = global.ShuleShell, U = global.UI;
  var SCHOOL = SHELL.SCHOOL_ID;

  var TODAY = '2026-08-20';
  var register = null, classes = [], teachers = [];
  var report = { classId: '', from: '', to: '' };

  // ── mode switch ───────────────────────────────────────────────────────
  function wireModes() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-mode]'), function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.getAttribute('data-mode');
        Array.prototype.forEach.call(doc.querySelectorAll('[data-mode]'), function (b) {
          b.setAttribute('aria-selected', String(b === btn));
        });
        doc.getElementById('panel-register').hidden = mode !== 'register';
        doc.getElementById('panel-report').hidden = mode !== 'report';
        if (mode === 'report' && !doc.getElementById('grid-rows').children.length) loadReport();
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Register
  // ══════════════════════════════════════════════════════════════════════
  var STATES = [['present', 'P'], ['absent', 'A'], ['late', 'L']];

  function rollRowHTML(r, i) {
    var marks = STATES.map(function (st) {
      var id = 'm-' + r.student_id + '-' + st[0];
      return '<td><span class="mark mark--' + st[0] + '">' +
        '<input type="radio" id="' + id + '" name="mark-' + r.student_id + '" value="' + st[0] + '"' +
        (r.status === st[0] ? ' checked' : '') + ' data-mark="' + r.student_id + '">' +
        '<label for="' + id + '" title="' + U.titleCase(st[0]) + '">' + st[1] +
        '<span class="vh">' + U.titleCase(st[0]) + ' — ' + U.esc(r.name) + '</span></label></span></td>';
    }).join('');
    return '<tr data-student="' + r.student_id + '">' +
      '<td class="strong">' + U.esc(r.name) + '</td>' +
      '<td class="sub">' + U.esc(r.admission_no) + '</td>' + marks +
      '<td><label class="vh" for="note-' + r.student_id + '">Note for ' + U.esc(r.name) + '</label>' +
      '<input type="text" class="notein" id="note-' + r.student_id + '" data-note="' + r.student_id + '" ' +
      'value="' + U.esc(r.note || '') + '" placeholder="Reason, if absent"' +
      (r.status === 'absent' || r.status === 'excused' ? '' : ' disabled') + '></td></tr>';
  }

  function loadRegister() {
    var classId = doc.getElementById('r-class').value;
    var date = doc.getElementById('r-date').value;
    if (!classId || !date) return Promise.resolve();
    return API.getClassRegister(SCHOOL, classId, { date: date }).then(function (r) {
      register = r;
      if (!r.roll.length) { U.show('register', 'empty'); return; }
      doc.getElementById('roll').innerHTML = r.roll.map(rollRowHTML).join('');
      if (r.marked_by) doc.getElementById('r-teacher').value = r.marked_by;
      else if (r.class_teacher_id) doc.getElementById('r-teacher').value = r.class_teacher_id;
      doc.getElementById('reg-state').innerHTML = r.already_marked
        ? 'Marked at ' + U.clock(r.marked_at) + ' by <b>' + U.esc(r.marked_by_name) + '</b>. ' +
          'Submitting again updates this register rather than adding a second one.'
        : 'Not yet marked. ' + r.roll_size + ' on the roll.';
      doc.getElementById('submit-register').textContent = r.already_marked ? 'Update register' : 'Submit register';
      U.show('register', 'content');
      wireRoll();
      tally();
    }).catch(function (e) { U.failed('register', e.message); });
  }

  function wireRoll() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-mark]'), function (input) {
      input.addEventListener('change', function () {
        var note = doc.querySelector('[data-note="' + input.getAttribute('data-mark') + '"]');
        if (note) {
          note.disabled = input.value !== 'absent';
          if (input.value !== 'absent') note.value = '';
        }
        tally();
      });
    });
  }

  function readRoll() {
    return Array.prototype.map.call(doc.querySelectorAll('#roll tr'), function (tr) {
      var id = tr.getAttribute('data-student');
      var picked = tr.querySelector('[data-mark]:checked');
      var note = tr.querySelector('[data-note]');
      return { student_id: id, status: picked ? picked.value : null, note: note ? note.value.trim() || null : null };
    });
  }

  function tally() {
    var rows = readRoll();
    var count = function (st) { return rows.filter(function (r) { return r.status === st; }).length; };
    var unmarked = rows.filter(function (r) { return !r.status; }).length;
    doc.getElementById('tally').innerHTML =
      '<div class="tally__i present"><span>Present</span><b data-tally="present">' + count('present') + '</b></div>' +
      '<div class="tally__i absent"><span>Absent</span><b data-tally="absent">' + count('absent') + '</b></div>' +
      '<div class="tally__i late"><span>Late</span><b data-tally="late">' + count('late') + '</b></div>' +
      '<div class="tally__i"><span>Unmarked</span><b data-tally="unmarked">' + unmarked + '</b></div>';
  }

  function submitRegister() {
    var rows = readRoll();
    var unmarked = rows.filter(function (r) { return !r.status; });
    if (unmarked.length) {
      SHELL.toast('<b>' + unmarked.length + '</b> pupil' + (unmarked.length === 1 ? ' is' : 's are') +
        ' still unmarked. Every pupil needs a mark before the register goes in.', { tone: 'bad', ms: 6000 });
      return;
    }
    var teacher = doc.getElementById('r-teacher').value;
    if (!teacher) {
      SHELL.toast('Say who is marking this register — every mark is stamped with a name.', { tone: 'bad' });
      return;
    }
    var btn = doc.getElementById('submit-register');
    btn.disabled = true;
    API.markAttendance(SCHOOL, doc.getElementById('r-class').value, {
      date: doc.getElementById('r-date').value, markedBy: teacher, records: rows
    }).then(function (r) {
      btn.disabled = false;
      SHELL.toast(r.was_update
        ? 'Register updated — <b>' + r.updated + '</b> marks changed, no duplicate created.'
        : '<b>' + r.created + '</b> marks recorded.');
      loadRegister();
    }).catch(function (err) {
      btn.disabled = false;
      SHELL.toast(U.esc(err.message), { tone: 'bad', ms: 6000 });
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Report
  // ══════════════════════════════════════════════════════════════════════
  function loadReport() {
    report.classId = doc.getElementById('p-class').value;
    report.from = doc.getElementById('p-from').value;
    report.to = doc.getElementById('p-to').value;

    return API.getAttendanceReport(SCHOOL, {
      classId: report.classId || undefined, from: report.from || undefined, to: report.to || undefined
    }).then(function (r) {
      if (!r.rows.length || !r.dates.length) { U.show('report', 'empty'); return; }

      doc.getElementById('rep-stats').innerHTML =
        stat('Days covered', r.dates.length) +
        stat('Records', U.num(r.records)) +
        stat('Attendance', U.pct(r.percentage)) +
        stat('Pupils', U.num(r.rows.length));

      doc.getElementById('grid-head').innerHTML =
        '<th scope="col">Pupil</th><th scope="col">Class</th>' +
        r.dates.map(function (d) {
          return '<th scope="col" class="day"><span class="vh">' + U.longDate(d) + '</span>' +
            '<span aria-hidden="true">' + Number(d.slice(8, 10)) + '</span></th>';
        }).join('') +
        '<th scope="col" class="r">Marked</th><th scope="col" class="r">Attendance</th>';

      doc.getElementById('grid-rows').innerHTML = r.rows.map(function (row) {
        return '<tr data-student="' + row.student_id + '">' +
          '<td class="strong">' + U.esc(row.name) + '</td>' +
          '<td class="sub">' + U.esc(row.class_name) + '</td>' +
          row.days.map(function (d) {
            return '<td class="day"><i data-s="' + (d.status || 'none') + '" title="' +
              U.esc(U.longDate(d.date) + ' — ' + (d.status ? U.titleCase(d.status) : 'not marked')) + '"></i></td>';
          }).join('') +
          '<td class="r">' + row.marked + '</td>' +
          '<td class="r ' + (row.percentage != null && row.percentage < 85 ? 'owe' : 'strong') + '" data-cell="pct">' +
            U.pct(row.percentage) + '</td></tr>';
      }).join('');

      U.bind('report-count', r.rows.length + ' pupils · ' + r.dates.length + ' days');
      U.show('report', 'content');
      return loadAbsentees();
    }).catch(function (e) { U.failed('report', e.message); });
  }

  function stat(label, value) {
    return '<div class="qstat"><span>' + U.esc(label) + '</span><b>' + value + '</b></div>';
  }

  function loadAbsentees() {
    var date = doc.getElementById('a-date').value || TODAY;
    return API.getAbsentees(SCHOOL, { date: date, classId: report.classId || undefined }).then(function (r) {
      doc.getElementById('absentee-rows').innerHTML = r.items.length
        ? r.items.map(function (a) {
            return '<tr data-student="' + a.student_id + '">' +
              '<td class="strong">' + U.esc(a.name) + '<span class="sub"> · ' + U.esc(a.admission_no) + '</span></td>' +
              '<td>' + U.esc(a.class_name) + '</td>' +
              '<td>' + U.tag(a.status === 'excused' ? 'approved' : 'unpaid').replace(/Approved|Unpaid/,
                a.status === 'excused' ? 'Excused' : 'Absent') + '</td>' +
              '<td class="sub">' + U.esc(a.note || '—') + '</td>' +
              '<td class="sub">' + U.esc(a.guardian_name) + ' · ' + U.esc(a.guardian_phone) + '</td></tr>';
          }).join('')
        : '<tr><td colspan="5" class="sub" style="padding:16px">Nobody was away on ' +
          U.longDate(date) + '. A full house.</td></tr>';
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  function boot() {
    Promise.all([API.listClasses(SCHOOL, {}), API.listTeachers(SCHOOL, {}), API.getDashboardSummary(SCHOOL, {})])
      .then(function (r) {
        classes = r[0]; teachers = r[1]; TODAY = r[2].date;

        U.fillSelect(doc.getElementById('r-class'), classes, 'id', 'full_name', false);
        U.fillSelect(doc.getElementById('p-class'), classes, 'id', 'full_name', true);
        U.fillSelect(doc.getElementById('r-teacher'), teachers, 'id', 'name', false);

        var rDate = doc.getElementById('r-date');
        rDate.value = TODAY; rDate.max = TODAY;
        doc.getElementById('a-date').value = TODAY;
        doc.getElementById('a-date').max = TODAY;
        doc.getElementById('p-to').value = TODAY;
        doc.getElementById('p-to').max = TODAY;
        doc.getElementById('p-from').value = shift(TODAY, -27);

        wireModes();
        doc.getElementById('r-class').addEventListener('change', loadRegister);
        rDate.addEventListener('change', loadRegister);
        doc.getElementById('mark-all').addEventListener('click', function () {
          Array.prototype.forEach.call(doc.querySelectorAll('#roll tr'), function (tr) {
            var p = tr.querySelector('[data-mark][value="present"]');
            if (p) { p.checked = true; p.dispatchEvent(new global.Event('change', { bubbles: true })); }
          });
        });
        doc.getElementById('submit-register').addEventListener('click', submitRegister);
        ['p-class', 'p-from', 'p-to'].forEach(function (id) {
          doc.getElementById(id).addEventListener('change', loadReport);
        });
        doc.getElementById('a-date').addEventListener('change', loadAbsentees);

        // both panels resolve on boot: a hidden tab must not sit in a skeleton
        return Promise.all([loadRegister(), loadReport()]);
      }).then(function () { U.ready(); })
      .catch(function (e) { global.console.error(e); U.ready('error'); });
  }

  function shift(iso, n) {
    var t = new Date(iso + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
