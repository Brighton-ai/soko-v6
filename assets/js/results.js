/**
 * results.html — mark entry, verification, class analysis and the merit list.
 *
 * Grade and points are derived live from the exam's bound scale as a mark is
 * typed, and derived again in the backend when it saves. Nothing here decides a
 * grade on its own.
 */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, SHELL = global.ShuleShell, U = global.UI;
  var SCHOOL = SHELL.SCHOOL_ID;

  var sheet = null, exams = [], classes = [], subjects = [], teachers = [], scale = null;
  var state = { examId: U.query('exam') || '', classId: '', subjectId: '' };

  /** The band a score falls in — the same rule the backend applies on save. */
  function bandFor(score) {
    if (!scale) return null;
    var n = Number(score);
    for (var i = 0; i < scale.bands.length; i++) {
      var b = scale.bands[i];
      if (n >= b.min && n <= b.max) return b;
    }
    return null;
  }

  function rowHTML(r) {
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
          : '<span class="tag tag--warn"><i></i>Unverified</span>') + '</td>' +
      '</tr>';
  }

  function loadSheet() {
    state.examId = doc.getElementById('f-exam').value;
    state.classId = doc.getElementById('f-class').value;
    state.subjectId = doc.getElementById('f-subject').value;
    if (!state.examId || !state.classId || !state.subjectId) { U.show('sheet', 'empty'); return Promise.resolve(); }

    return API.getMarkSheet(SCHOOL, state.examId, { classId: state.classId, subjectId: state.subjectId })
      .then(function (r) {
        sheet = r; scale = r.scale;
        doc.getElementById('sheetbar').innerHTML =
          '<span><b>' + U.esc(r.exam.name) + '</b> · ' + U.esc(r.class_name) + ' · ' + U.esc(r.subject_name) + '</span>' +
          '<span>Out of <b>' + r.max_score + '</b>, graded on <b>' + U.esc(r.scale.name) + '</b></span>' +
          '<span class="sheetbar__end">' + (r.teacher_name ? 'Taught by ' + U.esc(r.teacher_name) : '') + '</span>';
        doc.getElementById('rows').innerHTML = r.roll.map(rowHTML).join('');
        doc.getElementById('sheet-note').innerHTML =
          '<b>' + r.entered + '</b> of ' + r.roll.length + ' marked' +
          (r.unverified ? ' · <b>' + r.unverified + '</b> awaiting verification' : '') + '.';
        U.bind('sheet-state', r.entered + '/' + r.roll.length + ' marked');
        U.show('sheet', 'content');
        wireScores();
        return Promise.all([loadAnalysis(), loadMerit()]);
      }).catch(function (e) { U.failed('sheet', e.message); });
  }

  function wireScores() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-score]'), function (input) {
      input.addEventListener('input', function () { grade(input); });
      input.addEventListener('blur', function () { grade(input); });
    });
  }

  /** Live grading, and the inline rejection for anything outside 0..max. */
  function grade(input) {
    var id = input.getAttribute('data-score');
    var gradeCell = doc.querySelector('[data-grade="' + id + '"]');
    var remark = doc.querySelector('[data-remark="' + id + '"]');
    var points = doc.querySelector('[data-points="' + id + '"]');
    var err = doc.getElementById('scoreerr-' + id);
    var raw = input.value.trim();

    if (raw === '') {
      input.setAttribute('aria-invalid', 'false');
      err.textContent = '';
      gradeCell.childNodes[0].nodeValue = '—';
      remark.textContent = '';
      points.textContent = '—';
      return true;
    }
    var n = Number(raw);
    if (!isFinite(n)) {
      input.setAttribute('aria-invalid', 'true');
      err.textContent = 'Numbers only.';
      return false;
    }
    if (n < 0 || n > sheet.max_score) {
      input.setAttribute('aria-invalid', 'true');
      err.textContent = 'This exam is out of ' + sheet.max_score + '.';
      gradeCell.childNodes[0].nodeValue = '—';
      remark.textContent = '';
      points.textContent = '—';
      return false;
    }
    var band = bandFor(n);
    input.setAttribute('aria-invalid', 'false');
    err.textContent = '';
    gradeCell.childNodes[0].nodeValue = band ? band.grade : '—';
    remark.textContent = band ? band.remark : '';
    points.textContent = band ? band.points : '—';
    return true;
  }

  function readSheet() {
    return Array.prototype.map.call(doc.querySelectorAll('#rows tr'), function (tr) {
      var id = tr.getAttribute('data-student');
      var raw = tr.querySelector('[data-score]').value.trim();
      return {
        student_id: id,
        score: raw === '' ? null : Number(raw),
        comment: tr.querySelector('[data-comment]').value.trim() || null
      };
    });
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
    var btn = doc.getElementById('save-marks');
    btn.disabled = true;
    API.saveExamResults(SCHOOL, state.examId, {
      classId: state.classId, subjectId: state.subjectId,
      enteredBy: sheet.teacher_id, scores: readSheet()
    }).then(function (r) {
      btn.disabled = false;
      SHELL.toast('<b>' + r.saved + '</b> mark' + (r.saved === 1 ? '' : 's') + ' saved' +
        (r.cleared ? ', ' + r.cleared + ' cleared' : '') +
        (r.updated ? ' · changed marks go back to unverified' : '') + '.');
      loadSheet();
    }).catch(function (err) {
      btn.disabled = false;
      SHELL.toast(U.esc(err.message).replace(/\n/g, '<br>'), { tone: 'bad', ms: 9000 });
    });
  }

  // ── verification ──────────────────────────────────────────────────────
  U.onSubmit('modal-verify-form', function () {
    var by = doc.getElementById('vf-by'), scope = doc.getElementById('vf-scope');
    if (!U.setErr(by, by.value ? '' : 'Verification has to be signed — choose who is verifying.')) return null;
    return API.verifyExamResults(SCHOOL, state.examId, {
      classId: state.classId,
      subjectId: scope.value === 'subject' ? state.subjectId : undefined,
      verifiedBy: by.value
    }).then(function (r) {
      loadSheet();
      return '<b>' + r.verified + '</b> mark' + (r.verified === 1 ? '' : 's') + ' verified.';
    });
  });

  function openVerify() {
    if (!sheet) return;
    doc.getElementById('verify-context').innerHTML =
      '<b>' + U.esc(sheet.exam.name) + '</b> · ' + U.esc(sheet.class_name) + ' · ' + U.esc(sheet.subject_name) +
      '<br>' + sheet.unverified + ' mark' + (sheet.unverified === 1 ? '' : 's') + ' awaiting a signature' +
      (sheet.teacher_name ? ', entered by ' + U.esc(sheet.teacher_name) : '') + '.';
    U.clearErrs(doc.getElementById('modal-verify-form'));
  }

  // ── analysis and merit ────────────────────────────────────────────────
  function stat(label, value) {
    return '<div class="qstat"><span>' + U.esc(label) + '</span><b>' + value + '</b></div>';
  }

  function loadAnalysis() {
    return API.getClassAnalysis(SCHOOL, state.examId, { classId: state.classId }).then(function (a) {
      if (!a.entries) { U.show('analysis', 'empty'); return; }
      doc.getElementById('an-stats').innerHTML =
        stat('Mean', a.mean.toFixed(1)) + stat('Highest', a.highest) +
        stat('Lowest', a.lowest) + stat('Entries', U.num(a.entries));
      doc.getElementById('an-rows').innerHTML = a.subjects.map(function (s) {
        return '<tr data-subject="' + s.subject_id + '">' +
          '<td class="strong">' + U.esc(s.subject_name) + '</td>' +
          '<td class="r">' + s.entries + '</td>' +
          '<td class="r strong" data-cell="mean">' + s.mean.toFixed(1) + '</td>' +
          '<td class="r">' + s.highest + '</td>' +
          '<td class="r">' + s.lowest + '</td>' +
          '<td class="r">' + (s.unverified
            ? '<span class="tag tag--warn"><i></i>' + s.unverified + '</span>'
            : '<span class="sub">—</span>') + '</td></tr>';
      }).join('');
      U.show('analysis', 'content');
    }).catch(function (e) { U.failed('analysis', e.message); });
  }

  function loadMerit() {
    return API.getMeritList(SCHOOL, state.examId, { classId: state.classId }).then(function (m) {
      if (!m.total) { U.show('merit', 'empty'); return; }
      doc.getElementById('merit-rows').innerHTML = m.items.map(function (e) {
        return '<tr data-student="' + e.student_id + '" data-position="' + e.position + '">' +
          '<td class="r strong" data-cell="position">' + e.position + '</td>' +
          '<td><a class="who-cell" href="student.html?id=' + encodeURIComponent(e.student_id) + '">' +
            '<span class="av">' + U.esc(U.initials(e.name)) + '</span>' +
            '<span><b>' + U.esc(e.name) + '</b><span>' + U.esc(e.admission_no) + '</span></span></a></td>' +
          '<td>' + U.esc(e.class_name) + '</td>' +
          '<td class="r">' + e.subjects + '</td>' +
          '<td class="r strong" data-cell="total">' + U.num(e.total) + '</td>' +
          '<td class="r">' + e.average.toFixed(1) + '</td>' +
          '<td class="r">' + e.points + '</td>' +
          '<td>' + (e.unverified
            ? '<span class="tag tag--warn"><i></i>' + e.unverified + ' unverified</span>'
            : '<span class="tag tag--ok"><i></i>Verified</span>') + '</td></tr>';
      }).join('');
      U.show('merit', 'content');
    }).catch(function (e) { U.failed('merit', e.message); });
  }

  // ── boot ──────────────────────────────────────────────────────────────
  function subjectsFor(classId) {
    var cls = classes.filter(function (c) { return c.id === classId; })[0];
    if (!cls) return subjects;
    return subjects.filter(function (s) { return s.levels.indexOf(cls.level) !== -1; });
  }

  function boot() {
    Promise.all([
      API.listExamRows(SCHOOL, {}), API.listClasses(SCHOOL, {}),
      API.listSubjects(SCHOOL, {}), API.listTeachers(SCHOOL, {})
    ]).then(function (r) {
      exams = r[0]; classes = r[1]; subjects = r[2]; teachers = r[3];

      U.fillSelect(doc.getElementById('f-exam'),
        exams.map(function (e) { return { id: e.id, label: e.name + ' — out of ' + e.max_score }; }),
        'id', 'label', false);
      // land on an exam that has marks, so the page opens on something to look at
      var preferred = state.examId && exams.some(function (e) { return e.id === state.examId; })
        ? state.examId
        : (exams.filter(function (e) { return e.result_count > 0; })[0] || exams[0] || {}).id;
      if (preferred) doc.getElementById('f-exam').value = preferred;
      U.fillSelect(doc.getElementById('f-class'), classes, 'id', 'full_name', false);
      U.fillSelect(doc.getElementById('vf-by'), teachers, 'id', 'name', true);

      function refreshSubjects() {
        U.fillSelect(doc.getElementById('f-subject'),
          subjectsFor(doc.getElementById('f-class').value), 'id', 'name', false);
      }
      refreshSubjects();

      doc.getElementById('f-exam').addEventListener('change', loadSheet);
      doc.getElementById('f-class').addEventListener('change', function () { refreshSubjects(); loadSheet(); });
      doc.getElementById('f-subject').addEventListener('change', loadSheet);
      doc.getElementById('save-marks').addEventListener('click', saveMarks);
      doc.querySelector('[data-modal-open="modal-verify"]').addEventListener('click', openVerify);

      return loadSheet();
    }).then(function () { U.ready(); })
      .catch(function (e) { global.console.error(e); U.ready('error'); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
