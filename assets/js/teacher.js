/**
 * app/teacher/* — one file, four pages, dispatched on body[data-page].
 *
 * Every call goes through the teacher-scoped routes. This file never filters a
 * class list itself: if it asked for a class the teacher does not teach it
 * would get a 404, the same answer as for a class that does not exist. The
 * scope is a control in the backend, and this is only the screen.
 */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, SHELL = global.ShuleShell, U = global.UI;
  var SCHOOL = SHELL.SCHOOL_ID;

  var ME = (SHELL.ROLE_USER.teacher || {}).id;
  var PAGE = doc.body.getAttribute('data-page');
  var TODAY = '2026-08-20';
  var myClasses = [];

  function stat(label, value) {
    return '<div class="qstat"><span>' + U.esc(label) + '</span><b>' + value + '</b></div>';
  }
  function kpi(key, value, note) {
    var tile = doc.querySelector('[data-kpi="' + key + '"]');
    if (!tile) return;
    tile.querySelector('[data-kpi-value]').textContent = value;
    tile.querySelector('[data-kpi-delta]').textContent = note || '';
  }

  // ══════════════════════════════════════════════════════════════════════
  // My day
  // ══════════════════════════════════════════════════════════════════════
  function loadDashboard() {
    return Promise.all([
      API.getTeacherDashboard(SCHOOL, ME, {}),
      API.listTeacherClasses(SCHOOL, ME)
    ]).then(function (r) {
      var d = r[0], classes = r[1];
      U.bind('teacher-name', d.teacher_name);
      U.bind('today-long', U.longDate(d.date));

      kpi('periods', U.num(d.periods.length), d.periods.length ? 'first at ' + d.periods[0].starts_at : 'nothing timetabled');
      kpi('registers', U.num(d.registers_outstanding),
        d.registers.length ? 'of ' + d.registers.length + ' you own' : 'you own none');
      kpi('marks', U.num(d.marks_outstanding.length),
        d.marks_outstanding.length ? 'earliest due ' + U.shortDate(d.marks_outstanding[0].deadline) : 'all in');
      kpi('classes', U.num(classes.length), classes.length + ' assigned this term');

      // today's periods
      if (!d.periods.length) U.show('periods', 'empty');
      else {
        doc.getElementById('period-rows').innerHTML = d.periods.map(function (p) {
          return '<tr data-period="' + p.period + '">' +
            '<td class="strong">' + p.period + '</td>' +
            '<td class="sub">' + p.starts_at + '–' + p.ends_at + '</td>' +
            '<td>' + U.esc(p.class_name) + '</td>' +
            '<td>' + U.esc(p.subject_name) + '</td>' +
            '<td class="sub">' + U.esc(p.room) + '</td></tr>';
        }).join('');
        U.show('periods', 'content');
      }

      // registers I own
      if (!d.registers.length) U.show('registers', 'empty');
      else {
        doc.getElementById('register-list').innerHTML = d.registers.map(function (rg) {
          return '<a class="stack__i" href="register.html?class=' + encodeURIComponent(rg.class_id) + '" ' +
            'data-register="' + rg.class_id + '" data-marked="' + rg.marked + '">' +
            '<span class="stack__n ' + (rg.marked ? 'medium' : 'high') + '">' + rg.roll + '</span>' +
            '<span class="stack__x"><b>' + U.esc(rg.class_name) + '</b><span>' +
              (rg.marked
                ? 'Marked ' + U.clock(rg.marked_at) + ' · ' + rg.present + ' in, ' + rg.absent + ' away'
                : 'Not marked yet — ' + rg.roll + ' on the roll') + '</span></span>' +
            (rg.marked ? '<span class="tag tag--ok"><i></i>In</span>'
                       : '<span class="tag tag--bad"><i></i>Due</span>') + '</a>';
        }).join('');
        U.show('registers', 'content');
      }

      // marks outstanding
      if (!d.marks_outstanding.length) U.show('marks', 'empty');
      else {
        doc.getElementById('mark-rows').innerHTML = d.marks_outstanding.map(function (m) {
          return '<tr data-outstanding="' + m.exam_id + '|' + m.class_id + '|' + m.subject_id + '">' +
            '<td class="strong">' + U.esc(m.exam_name) + '</td>' +
            '<td>' + U.esc(m.class_name) + '</td>' +
            '<td>' + U.esc(m.subject_name) + '</td>' +
            '<td class="r">' + m.entered + '<span class="sub"> / ' + m.roll + '</span></td>' +
            '<td class="sub">' + U.shortDate(m.deadline) + '</td>' +
            '<td class="r"><a class="btn btn--ghost btn--sm" href="marks.html?exam=' +
              encodeURIComponent(m.exam_id) + '&class=' + encodeURIComponent(m.class_id) +
              '&subject=' + encodeURIComponent(m.subject_id) + '">Enter</a></td></tr>';
        }).join('');
        U.show('marks', 'content');
      }

      // my classes
      if (!classes.length) U.show('classes', 'empty');
      else {
        doc.getElementById('class-rows').innerHTML = classes.map(function (c) {
          return '<tr data-class="' + c.id + '">' +
            '<td class="strong">' + U.esc(c.full_name) + '</td>' +
            '<td class="sub">' + (c.subjects.length
              ? U.esc(c.subjects.map(function (s) { return s.name; }).join(', '))
              : '—') + '</td>' +
            '<td class="r">' + c.roll + '</td>' +
            '<td>' + (c.is_class_teacher
              ? '<span class="tag tag--warn"><i></i>Class teacher</span>'
              : '<span class="tag tag--mute"><i></i>Subject</span>') + '</td></tr>';
        }).join('');
        U.show('classes', 'content');
      }

      // announcements
      if (!d.announcements.length) U.show('announcements', 'empty');
      else {
        doc.getElementById('announcement-list').innerHTML = d.announcements.map(function (a) {
          return '<div class="stack__i" data-announcement="' + a.id + '">' +
            '<span class="stack__x"><b>' + U.esc(a.title) + '</b><span>' + U.esc(a.body) + '</span></span></div>';
        }).join('');
        U.show('announcements', 'content');
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // My register
  // ══════════════════════════════════════════════════════════════════════
  var STATES = [['present', 'P'], ['absent', 'A'], ['late', 'L']];

  function rollRowHTML(r) {
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
      (r.status === 'absent' ? '' : ' disabled') + '></td></tr>';
  }

  function loadRegister() {
    var classId = doc.getElementById('r-class').value;
    var date = doc.getElementById('r-date').value;
    if (!classId || !date) { U.show('register', 'empty'); return Promise.resolve(); }
    return API.getTeacherRegister(SCHOOL, ME, classId, { date: date }).then(function (r) {
      if (!r.roll.length) { U.show('register', 'empty'); return; }
      doc.getElementById('roll').innerHTML = r.roll.map(rollRowHTML).join('');
      doc.getElementById('reg-state').innerHTML = r.already_marked
        ? 'Marked at ' + U.clock(r.marked_at) + ' by <b>' + U.esc(r.marked_by_name) + '</b>. ' +
          'Submitting again updates it rather than adding a second register.'
        : 'Not yet marked. ' + r.roll_size + ' on the roll.';
      doc.getElementById('submit-register').textContent = r.already_marked ? 'Update register' : 'Submit register';
      U.show('register', 'content');
      wireRoll();
      tally();
    }).catch(function (e) {
      // a class outside scope answers 404, exactly like one that does not exist
      U.failed('register', e.message);
    });
  }

  function wireRoll() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-mark]'), function (input) {
      input.addEventListener('change', function () {
        var note = doc.querySelector('[data-note="' + input.getAttribute('data-mark') + '"]');
        if (note) { note.disabled = input.value !== 'absent'; if (input.value !== 'absent') note.value = ''; }
        tally();
      });
    });
  }
  function readRoll() {
    return Array.prototype.map.call(doc.querySelectorAll('#roll tr'), function (tr) {
      var picked = tr.querySelector('[data-mark]:checked');
      var note = tr.querySelector('[data-note]');
      return { student_id: tr.getAttribute('data-student'),
               status: picked ? picked.value : null,
               note: note ? note.value.trim() || null : null };
    });
  }
  function tally() {
    var rows = readRoll();
    var count = function (st) { return rows.filter(function (r) { return r.status === st; }).length; };
    doc.getElementById('tally').innerHTML =
      '<div class="tally__i present"><span>Present</span><b data-tally="present">' + count('present') + '</b></div>' +
      '<div class="tally__i absent"><span>Absent</span><b data-tally="absent">' + count('absent') + '</b></div>' +
      '<div class="tally__i late"><span>Late</span><b data-tally="late">' + count('late') + '</b></div>' +
      '<div class="tally__i"><span>Unmarked</span><b data-tally="unmarked">' +
        rows.filter(function (r) { return !r.status; }).length + '</b></div>';
  }
  function submitRegister() {
    var rows = readRoll();
    var unmarked = rows.filter(function (r) { return !r.status; });
    if (unmarked.length) {
      SHELL.toast('<b>' + unmarked.length + '</b> pupil' + (unmarked.length === 1 ? ' is' : 's are') +
        ' still unmarked.', { tone: 'bad' });
      return;
    }
    var btn = doc.getElementById('submit-register');
    btn.disabled = true;
    API.markTeacherAttendance(SCHOOL, ME, doc.getElementById('r-class').value, {
      date: doc.getElementById('r-date').value, records: rows
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
  // Enter marks
  // ══════════════════════════════════════════════════════════════════════
  var sheet = null, scale = null;

  function bandFor(score) {
    if (!scale) return null;
    var n = Number(score);
    for (var i = 0; i < scale.bands.length; i++) {
      var b = scale.bands[i];
      if (n >= b.min && n <= b.max) return b;
    }
    return null;
  }

  function markRowHTML(r) {
    return '<tr data-student="' + r.student_id + '" data-verified="' + r.verified + '">' +
      '<td class="strong">' + U.esc(r.name) + '</td>' +
      '<td class="sub">' + U.esc(r.admission_no) + '</td>' +
      '<td><label class="vh" for="score-' + r.student_id + '">Score for ' + U.esc(r.name) + '</label>' +
        '<input type="number" class="scorein" id="score-' + r.student_id + '" data-score="' + r.student_id + '" ' +
        'value="' + (r.score == null ? '' : r.score) + '" min="0" max="' + sheet.max_score + '" step="1" ' +
        'inputmode="numeric" aria-describedby="scoreerr-' + r.student_id + '">' +
        '<span class="scoreerr" id="scoreerr-' + r.student_id + '" role="alert"></span></td>' +
      '<td class="gradecell" data-grade="' + r.student_id + '">' + (r.grade ? U.esc(r.grade) : '—') +
        '<span data-remark="' + r.student_id + '">' + U.esc(r.remark || '') + '</span></td>' +
      '<td class="r" data-points="' + r.student_id + '">' + (r.points == null ? '—' : r.points) + '</td>' +
      '<td><label class="vh" for="comment-' + r.student_id + '">Comment for ' + U.esc(r.name) + '</label>' +
        '<input type="text" class="commentin" id="comment-' + r.student_id + '" data-comment="' + r.student_id + '" ' +
        'value="' + U.esc(r.comment || '') + '" placeholder="Optional"></td>' +
      '<td>' + (r.score == null
        ? '<span class="tag tag--mute"><i></i>Not marked</span>'
        : r.verified
          ? '<span class="tag tag--ok"><i></i>Verified</span>'
          : '<span class="tag tag--warn"><i></i>Awaiting sign-off</span>') + '</td></tr>';
  }

  function loadSheet() {
    var examId = doc.getElementById('f-exam').value;
    var pick = doc.getElementById('f-assignment').value;
    if (!examId || !pick) { U.show('sheet', 'empty'); return Promise.resolve(); }
    var parts = pick.split('|');
    return API.getTeacherMarkSheet(SCHOOL, ME, examId, { classId: parts[0], subjectId: parts[1] })
      .then(function (r) {
        sheet = r; scale = r.scale;
        doc.getElementById('sheetbar').innerHTML =
          '<span><b>' + U.esc(r.exam.name) + '</b> · ' + U.esc(r.class_name) + ' · ' + U.esc(r.subject_name) + '</span>' +
          '<span>Out of <b>' + r.max_score + '</b>, graded on <b>' + U.esc(r.scale.name) + '</b></span>';
        doc.getElementById('rows').innerHTML = r.roll.map(markRowHTML).join('');
        doc.getElementById('sheet-note').innerHTML =
          '<b>' + r.entered + '</b> of ' + r.roll.length + ' marked' +
          (r.unverified ? ' · <b>' + r.unverified + '</b> waiting on a head of department' : '') + '.';
        U.bind('sheet-state', r.entered + '/' + r.roll.length + ' marked');
        U.show('sheet', 'content');
        Array.prototype.forEach.call(doc.querySelectorAll('[data-score]'), function (input) {
          input.addEventListener('input', function () { grade(input); });
        });
      }).catch(function (e) { U.failed('sheet', e.message); });
  }

  function grade(input) {
    var id = input.getAttribute('data-score');
    var cell = doc.querySelector('[data-grade="' + id + '"]');
    var remark = doc.querySelector('[data-remark="' + id + '"]');
    var points = doc.querySelector('[data-points="' + id + '"]');
    var err = doc.getElementById('scoreerr-' + id);
    var raw = input.value.trim();
    if (raw === '') {
      input.setAttribute('aria-invalid', 'false'); err.textContent = '';
      cell.childNodes[0].nodeValue = '—'; remark.textContent = ''; points.textContent = '—';
      return true;
    }
    var n = Number(raw);
    if (!isFinite(n) || n < 0 || n > sheet.max_score) {
      input.setAttribute('aria-invalid', 'true');
      err.textContent = 'This exam is out of ' + sheet.max_score + '.';
      cell.childNodes[0].nodeValue = '—'; remark.textContent = ''; points.textContent = '—';
      return false;
    }
    var band = bandFor(n);
    input.setAttribute('aria-invalid', 'false'); err.textContent = '';
    cell.childNodes[0].nodeValue = band ? band.grade : '—';
    remark.textContent = band ? band.remark : '';
    points.textContent = band ? band.points : '—';
    return true;
  }

  function saveMarks() {
    var inputs = Array.prototype.slice.call(doc.querySelectorAll('[data-score]'));
    var bad = inputs.filter(function (i) { return !grade(i); });
    if (bad.length) {
      SHELL.toast('<b>' + bad.length + '</b> mark' + (bad.length === 1 ? ' is' : 's are') +
        ' outside 0–' + sheet.max_score + '. Nothing was saved.', { tone: 'bad', ms: 6000 });
      bad[0].focus();
      return;
    }
    var parts = doc.getElementById('f-assignment').value.split('|');
    var btn = doc.getElementById('save-marks');
    btn.disabled = true;
    API.saveTeacherResults(SCHOOL, ME, doc.getElementById('f-exam').value, {
      classId: parts[0], subjectId: parts[1],
      scores: Array.prototype.map.call(doc.querySelectorAll('#rows tr'), function (tr) {
        var raw = tr.querySelector('[data-score]').value.trim();
        return { student_id: tr.getAttribute('data-student'),
                 score: raw === '' ? null : Number(raw),
                 comment: tr.querySelector('[data-comment]').value.trim() || null };
      })
    }).then(function (r) {
      btn.disabled = false;
      SHELL.toast('<b>' + r.saved + '</b> mark' + (r.saved === 1 ? '' : 's') +
        ' saved. A head of department signs them off.');
      loadSheet();
    }).catch(function (err) {
      btn.disabled = false;
      SHELL.toast(U.esc(err.message).replace(/\n/g, '<br>'), { tone: 'bad', ms: 9000 });
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // My timetable
  // ══════════════════════════════════════════════════════════════════════
  function loadTimetable() {
    return API.getTeacherTimetable(SCHOOL, ME, {}).then(function (t) {
      if (!t.items.length) { U.show('timetable', 'empty'); return; }
      U.bind('periods-week', t.periods_per_week);
      var teaching = t.periods.filter(function (p) {
        return t.items.some(function (i) { return i.period === p.period; });
      });
      doc.getElementById('week-head').innerHTML =
        '<th scope="col">Day</th>' + teaching.map(function (p) {
          return '<th scope="col" class="r">' + p.period + '<span class="sub" style="display:block">' +
            p.starts_at + '</span></th>';
        }).join('');
      doc.getElementById('week-rows').innerHTML = t.days.map(function (d) {
        return '<tr data-day="' + d.day + '"><td class="strong">' + U.esc(d.name) + '</td>' +
          teaching.map(function (p) {
            var slot = t.items.filter(function (i) { return i.day === d.day && i.period === p.period; })[0];
            return '<td data-slot="' + d.day + '-' + p.period + '">' + (slot
              ? '<b style="font-family:var(--f-display);font-size:12px">' + U.esc(slot.subject_name) + '</b>' +
                '<span class="sub" style="display:block">' + U.esc(slot.class_name) + '</span>'
              : '<span class="sub">—</span>') + '</td>';
          }).join('') + '</tr>';
      }).join('');
      U.show('timetable', 'content');
    }).catch(function (e) { U.failed('timetable', e.message); });
  }

  // ══════════════════════════════════════════════════════════════════════
  function boot() {
    if (!ME) { U.ready('error'); return; }
    Promise.all([API.listTeacherClasses(SCHOOL, ME), API.getDashboardSummary(SCHOOL, {})])
      .then(function (r) {
        myClasses = r[0];
        TODAY = r[1].date;

        if (PAGE === 'teacher-dashboard') return loadDashboard();

        if (PAGE === 'teacher-register') {
          var own = myClasses.filter(function (c) { return c.is_class_teacher; });
          U.fillSelect(doc.getElementById('r-class'), own.length ? own : myClasses, 'id', 'full_name', false);
          var wanted = U.query('class');
          if (wanted) doc.getElementById('r-class').value = wanted;
          var rDate = doc.getElementById('r-date');
          rDate.value = TODAY; rDate.max = TODAY;
          doc.getElementById('r-class').addEventListener('change', loadRegister);
          rDate.addEventListener('change', loadRegister);
          doc.getElementById('mark-all').addEventListener('click', function () {
            Array.prototype.forEach.call(doc.querySelectorAll('#roll tr'), function (tr) {
              var p = tr.querySelector('[data-mark][value="present"]');
              if (p) { p.checked = true; p.dispatchEvent(new global.Event('change', { bubbles: true })); }
            });
          });
          doc.getElementById('submit-register').addEventListener('click', submitRegister);
          return loadRegister();
        }

        if (PAGE === 'teacher-marks') {
          return API.listExamRows(SCHOOL, {}).then(function (exams) {
            U.fillSelect(doc.getElementById('f-exam'),
              exams.map(function (e) { return { id: e.id, label: e.name + ' — out of ' + e.max_score }; }),
              'id', 'label', false);
            var pairs = [];
            myClasses.forEach(function (c) {
              c.subjects.forEach(function (s) {
                pairs.push({ id: c.id + '|' + s.id, label: c.full_name + ' · ' + s.name });
              });
            });
            U.fillSelect(doc.getElementById('f-assignment'), pairs, 'id', 'label', false);

            var wantExam = U.query('exam'), wantClass = U.query('class'), wantSubject = U.query('subject');
            if (wantExam && exams.some(function (e) { return e.id === wantExam; })) {
              doc.getElementById('f-exam').value = wantExam;
            } else {
              var marked = exams.filter(function (e) { return e.result_count > 0; })[0] || exams[0];
              if (marked) doc.getElementById('f-exam').value = marked.id;
            }
            if (wantClass && wantSubject &&
                pairs.some(function (p) { return p.id === wantClass + '|' + wantSubject; })) {
              doc.getElementById('f-assignment').value = wantClass + '|' + wantSubject;
            }
            doc.getElementById('f-exam').addEventListener('change', loadSheet);
            doc.getElementById('f-assignment').addEventListener('change', loadSheet);
            doc.getElementById('save-marks').addEventListener('click', saveMarks);
            return loadSheet();
          });
        }

        if (PAGE === 'teacher-timetable') return loadTimetable();
        return null;
      }).then(function () { U.ready(); })
      .catch(function (e) { global.console.error(e); U.ready('error'); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
