/**
 * report-cards.html — generate, review, publish.
 *
 * A card cannot be published while any result feeding it is unverified. The
 * refusal names the subjects: "publish is greyed out" is not something anyone
 * can act on.
 */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, SHELL = global.ShuleShell, U = global.UI;
  var SCHOOL = SHELL.SCHOOL_ID;

  var state = { classId: '', examId: '', status: '' };
  var classes = [], exams = [], cards = [], openCard = null;

  function rowHTML(c) {
    return '<tr data-card="' + c.id + '" data-status="' + c.status + '" data-publishable="' + c.publishable + '">' +
      '<td class="r strong" data-cell="position">' + (c.position || '—') +
        '<span class="sub"> / ' + c.class_size + '</span></td>' +
      '<td><a class="who-cell" href="student.html?id=' + encodeURIComponent(c.student_id) + '">' +
        '<span class="av">' + U.esc(U.initials(c.student_name)) + '</span>' +
        '<span><b>' + U.esc(c.student_name) + '</b><span>' + U.esc(c.admission_no) + '</span></span></a></td>' +
      '<td class="r">' + c.subject_count + '</td>' +
      '<td class="r" data-cell="total">' + U.num(c.total_marks) + '</td>' +
      '<td class="r strong" data-cell="average">' + Number(c.average).toFixed(1) + '</td>' +
      '<td><b style="font-family:var(--f-display);color:var(--orange-600)">' + U.esc(c.grade) + '</b></td>' +
      '<td>' + (c.status === 'published'
        ? '<span class="tag tag--ok"><i></i>Published</span>'
        : c.publishable
          ? '<span class="tag tag--mute"><i></i>Draft</span>'
          : '<span class="tag tag--warn"><i></i>' + c.unverified_subjects + ' unverified</span>') + '</td>' +
      '<td class="r"><button type="button" class="btn btn--ghost btn--sm" data-open="' + c.id + '">Open</button></td>' +
      '</tr>';
  }

  function load() {
    state.classId = doc.getElementById('f-class').value;
    state.examId = doc.getElementById('f-exam').value;
    state.status = doc.getElementById('f-status').value;

    return API.listReportCardRows(SCHOOL, {
      classId: state.classId || undefined, status: state.status || undefined
    }).then(function (r) {
      cards = r.items.filter(function (c) { return !state.examId || c.exam_id === state.examId; });
      renderBlocker(cards);
      if (!cards.length) { U.bind('result-count', 'no cards'); U.show('cards', 'empty'); return; }
      doc.getElementById('rows').innerHTML = cards.map(rowHTML).join('');
      var drafts = cards.filter(function (c) { return c.status === 'draft'; }).length;
      U.bind('result-count', cards.length + ' cards · ' + drafts + ' in draft');
      U.show('cards', 'content');
      Array.prototype.forEach.call(doc.querySelectorAll('[data-open]'), function (b) {
        b.addEventListener('click', function () { openOne(b.getAttribute('data-open')); });
      });
    }).catch(function (e) { U.failed('cards', e.message); });
  }

  /** Says up front which subjects are holding the class back. */
  function renderBlocker(rows) {
    var host = doc.getElementById('blocker');
    var blocked = rows.filter(function (c) { return c.status === 'draft' && !c.publishable; });
    if (!blocked.length) { host.hidden = true; host.innerHTML = ''; return; }

    var subjects = {};
    blocked.forEach(function (c) { subjects['x'] = true; });
    // the per-card subject names come from the card view; the count is enough here
    host.hidden = false;
    host.innerHTML =
      '<b>' + blocked.length + ' card' + (blocked.length === 1 ? '' : 's') + ' cannot be published yet</b>' +
      '<p>Every result feeding a card has to be verified before it goes to a guardian. ' +
      'These are waiting on a head of department:</p>' +
      '<ul>' + blocked.slice(0, 8).map(function (c) {
        return '<li>' + U.esc(c.student_name) + ' — ' + c.unverified_subjects + ' unverified</li>';
      }).join('') +
      (blocked.length > 8 ? '<li>and ' + (blocked.length - 8) + ' more</li>' : '') + '</ul>';
  }

  // ── one card ──────────────────────────────────────────────────────────
  function openOne(cardId) {
    return API.getReportCard(SCHOOL, cardId).then(function (v) {
      openCard = v;
      doc.getElementById('card-body').innerHTML = cardHTML(v);
      doc.getElementById('save-comments').disabled = v.card.status === 'published';
      SHELL.showModal('modal-card');
    });
  }

  function cardHTML(v) {
    var c = v.card;
    return '<div class="card-sheet" id="card-print">' +
      '<div class="card-sheet__h">' +
        '<div><h3>' + U.esc(v.school.name) + '</h3>' +
        '<p>' + U.esc(v.school.address) + '<br>' + U.esc(v.school.phone) + ' · ' + U.esc(v.school.email) + '</p>' +
        '<em>' + U.esc(v.exam_name) + ' · ' + U.esc(v.term_name) + '</em></div>' +
        '<div class="card-sheet__who"><b>' + U.esc(v.student.name) + '</b>' +
        '<span>' + U.esc(v.student.admission_no) + '<br>' + U.esc(v.class_name) + '</span></div>' +
      '</div>' +

      (c.status === 'draft'
        ? '<p class="card-sheet__draft">DRAFT — not visible to guardians' +
          (v.unverified_subjects.length
            ? '. Waiting on verification for: ' + U.esc(v.unverified_subjects.join(', ')) + '.'
            : '. Every mark is verified; this card is ready to publish.') + '</p>'
        : '') +

      '<table><thead><tr><th>Subject</th><th class="r">Score</th><th>Grade</th>' +
      '<th class="r">Points</th><th>Remark</th></tr></thead><tbody>' +
      v.results.map(function (r) {
        return '<tr><td>' + U.esc(r.subject_name) + (r.verified ? '' : ' *') + '</td>' +
          '<td class="r">' + r.score + '</td>' +
          '<td>' + U.esc(r.grade) + '</td>' +
          '<td class="r">' + r.points + '</td>' +
          '<td>' + U.esc(r.remark) + '</td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><td>Total</td><td class="r">' + U.num(c.total_marks) + '</td>' +
      '<td colspan="3">out of ' + U.num(v.results.length * (v.results[0] ? (v.results[0].max_score || 100) : 100)) + '</td></tr>' +
      '</tfoot></table>' +

      (v.unverified_subjects.length
        ? '<p class="sub" style="margin-top:8px;font-size:11px">* mark not yet verified</p>' : '') +

      '<div class="card-sheet__stats">' +
        '<div class="card-sheet__stat"><span>Average</span><b>' + Number(c.average).toFixed(1) + '</b></div>' +
        '<div class="card-sheet__stat"><span>Grade</span><b>' + U.esc(c.grade) + '</b></div>' +
        '<div class="card-sheet__stat"><span>Position</span><b>' + c.position + ' / ' + c.class_size + '</b></div>' +
        '<div class="card-sheet__stat"><span>Attendance</span><b>' + U.pct(v.attendance_percentage, 0) + '</b></div>' +
      '</div>' +

      '<div class="card-sheet__comments">' +
        '<div class="field"><label for="cc-teacher">Class teacher — ' + U.esc(v.class_teacher_name) + '</label>' +
        '<textarea id="cc-teacher" rows="2"' + (c.status === 'published' ? ' readonly' : '') + '>' +
        U.esc(c.teacher_comment || '') + '</textarea></div>' +
        '<div class="field"><label for="cc-head">Principal</label>' +
        '<textarea id="cc-head" rows="2"' + (c.status === 'published' ? ' readonly' : '') + '>' +
        U.esc(c.principal_comment || '') + '</textarea></div>' +
      '</div>' +

      '<div class="card-sheet__sign">' +
        '<span>Class teacher ______________________</span>' +
        '<span>Principal ______________________</span>' +
        '<span>' + (c.published_at ? 'Published ' + U.longDate(c.published_at.slice(0, 10)) : 'Not yet published') + '</span>' +
      '</div></div>';
  }

  function saveComments() {
    if (!openCard) return;
    API.updateReportCard(SCHOOL, openCard.card.id, {
      teacher_comment: doc.getElementById('cc-teacher').value,
      principal_comment: doc.getElementById('cc-head').value
    }).then(function () {
      SHELL.toast('Comments saved.');
      load();
    }).catch(function (err) { SHELL.toast(U.esc(err.message), { tone: 'bad', ms: 6000 }); });
  }

  // ── generate and publish ──────────────────────────────────────────────
  function generate() {
    var classId = doc.getElementById('f-class').value;
    var examId = doc.getElementById('f-exam').value;
    if (!classId || !examId) {
      SHELL.toast('Choose a class and an exam to generate for.', { tone: 'bad' });
      return;
    }
    API.generateReportCards(SCHOOL, { classId: classId, examId: examId }).then(function (r) {
      load();
      SHELL.toast('<b>' + r.generated + '</b> cards generated and ranked.', { html: true });
    }).catch(function (err) { SHELL.toast(U.esc(err.message), { tone: 'bad', ms: 7000 }); });
  }

  function publish() {
    var classId = doc.getElementById('f-class').value;
    if (!classId) { SHELL.toast('Choose a class to publish.', { tone: 'bad' }); return; }
    API.publishReportCardsFor(SCHOOL, { classId: classId }).then(function (r) {
      load();
      SHELL.toast('<b>' + r.published + '</b> report cards published to guardians.', { html: true });
    }).catch(function (err) {
      SHELL.toast(U.esc(err.message), { tone: 'bad', ms: 10000 });
      load();
    });
  }

  function boot() {
    Promise.all([API.listClasses(SCHOOL, {}), API.listExamRows(SCHOOL, {})]).then(function (r) {
      classes = r[0];
      exams = r[1].filter(function (e) { return e.result_count > 0; });
      if (!exams.length) exams = r[1];

      U.fillSelect(doc.getElementById('f-class'), classes, 'id', 'full_name', false);
      U.fillSelect(doc.getElementById('f-exam'), exams, 'id', 'name', false);

      ['f-class', 'f-exam', 'f-status'].forEach(function (id) {
        doc.getElementById(id).addEventListener('change', load);
      });
      doc.getElementById('generate').addEventListener('click', generate);
      doc.getElementById('publish').addEventListener('click', publish);
      doc.getElementById('save-comments').addEventListener('click', saveComments);
      doc.getElementById('print-card').addEventListener('click', function () { global.print(); });

      return load();
    }).then(function () { U.ready(); })
      .catch(function (e) { global.console.error(e); U.ready('error'); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
