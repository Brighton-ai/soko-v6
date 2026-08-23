/** exams.html — what is being sat, and what each mark will mean. */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, SHELL = global.ShuleShell, U = global.UI;
  var SCHOOL = SHELL.SCHOOL_ID;
  var state = { termId: '', type: '' };
  var exams = [], classes = [], scales = [], terms = [], editing = null;

  var TYPE_LABEL = { opener: 'Opener', cat: 'CAT', midterm: 'Mid-term', endterm: 'End-term', mock: 'Mock' };

  function rowHTML(e) {
    return '<tr data-exam="' + e.id + '" data-locked="' + e.locked + '">' +
      '<td class="strong">' + U.esc(e.name) + '</td>' +
      '<td>' + U.esc(TYPE_LABEL[e.type] || U.titleCase(e.type)) + '</td>' +
      '<td class="sub">' + U.shortDate(e.starts_on) + ' – ' + U.shortDate(e.ends_on) + '</td>' +
      '<td class="r" data-cell="max">' + e.max_score + '</td>' +
      '<td>' + U.esc(e.scale_name) +
        (e.locked ? '<span class="sub" style="display:block">locked — marks entered</span>' : '') + '</td>' +
      '<td class="r">' + e.class_count + '</td>' +
      '<td class="r" data-cell="results">' + U.num(e.result_count) + '</td>' +
      '<td>' + (e.unverified_count
        ? '<span class="tag tag--warn"><i></i>' + U.num(e.unverified_count) + ' unverified</span>'
        : e.result_count
          ? '<span class="tag tag--ok"><i></i>Verified</span>'
          : '<span class="tag tag--mute"><i></i>Not marked</span>') + '</td>' +
      '<td class="r">' +
        '<a class="btn btn--ghost btn--sm" href="results.html?exam=' + encodeURIComponent(e.id) + '">Marks</a> ' +
        '<button type="button" class="btn btn--ghost btn--sm" data-edit="' + e.id + '">Edit</button>' +
      '</td></tr>';
  }

  function load() {
    return API.listExamRows(SCHOOL, { termId: state.termId || undefined }).then(function (rows) {
      exams = rows;
      var shown = state.type ? rows.filter(function (e) { return e.type === state.type; }) : rows;
      if (!shown.length) { U.bind('result-count', 'no exams'); U.show('exams', 'empty'); return; }
      doc.getElementById('rows').innerHTML = shown.map(rowHTML).join('');
      U.bind('result-count', shown.length + (shown.length === 1 ? ' exam' : ' exams'));
      U.show('exams', 'content');
      Array.prototype.forEach.call(doc.querySelectorAll('[data-edit]'), function (b) {
        b.addEventListener('click', function () {
          openEditor(exams.filter(function (e) { return e.id === b.getAttribute('data-edit'); })[0]);
        });
      });
    }).catch(function (e) { U.failed('exams', e.message); });
  }

  function openEditor(exam) {
    editing = exam || null;
    doc.getElementById('modal-exam-t').textContent = exam ? 'Edit exam' : 'Set an exam';
    doc.getElementById('ex-name').value = exam ? exam.name : '';
    doc.getElementById('ex-type').value = exam ? exam.type : 'midterm';
    doc.getElementById('ex-term').value = exam ? exam.term_id : (state.termId || terms[0].id);
    doc.getElementById('ex-starts').value = exam ? exam.starts_on : '';
    doc.getElementById('ex-ends').value = exam ? exam.ends_on : '';
    doc.getElementById('ex-max').value = exam ? exam.max_score : 100;
    doc.getElementById('ex-scale').value = exam ? exam.grading_scale_id : (scales.filter(function (s) { return s.is_default; })[0] || scales[0]).id;

    var picker = doc.getElementById('ex-classes');
    Array.prototype.forEach.call(picker.options, function (o) {
      o.selected = exam ? exam.class_ids.indexOf(o.value) !== -1 : false;
    });

    // the scale and the maximum freeze once anything is marked against the exam
    var locked = !!(exam && exam.locked);
    doc.getElementById('ex-scale').disabled = locked;
    doc.getElementById('ex-max').readOnly = locked;
    var note = doc.getElementById('ex-lock');
    note.hidden = !locked;
    if (locked) {
      note.innerHTML = '<b>' + U.num(exam.result_count) + '</b> marks are already entered against "' +
        U.esc(exam.scale_name) + '". The scale and the maximum are frozen — changing either would ' +
        'regrade every one of them under the people who entered and verified them.';
    }
    U.clearErrs(doc.getElementById('modal-exam-form'));
    SHELL.showModal('modal-exam');
  }

  function picked(sel) {
    return Array.prototype.filter.call(sel.options, function (o) { return o.selected; })
      .map(function (o) { return o.value; });
  }

  U.onSubmit('modal-exam-form', function () {
    var name = doc.getElementById('ex-name'), starts = doc.getElementById('ex-starts'),
        ends = doc.getElementById('ex-ends'), max = doc.getElementById('ex-max'),
        scale = doc.getElementById('ex-scale'), cls = doc.getElementById('ex-classes');
    var ok = [
      U.setErr(name, name.value.trim().length >= 3 ? '' : 'Give the exam a name.'),
      U.setErr(starts, starts.value ? '' : 'When does it start?'),
      U.setErr(ends, !ends.value ? 'When does it end?'
        : (ends.value < starts.value ? 'It ends before it starts.' : '')),
      U.setErr(max, Number(max.value) > 0 ? '' : 'The maximum score must be greater than zero.'),
      U.setErr(scale, scale.value ? '' : 'Bind the exam to a grading scale — that is what turns a mark into a grade.'),
      U.setErr(cls, picked(cls).length ? '' : 'Choose at least one class to sit it.')
    ].every(Boolean);
    if (!ok) return null;

    var payload = {
      name: name.value.trim(), type: doc.getElementById('ex-type').value,
      termId: doc.getElementById('ex-term').value,
      startsOn: starts.value, endsOn: ends.value,
      maxScore: Number(max.value), gradingScaleId: scale.value,
      classIds: picked(cls)
    };
    var call = editing ? API.updateExam(SCHOOL, editing.id, payload) : API.createExam(SCHOOL, payload);
    return call.then(function (e) { load(); return '<b>' + U.esc(e.name) + '</b> saved.'; });
  });

  function boot() {
    Promise.all([
      API.listClasses(SCHOOL, {}), API.listGradingScaleRows(SCHOOL, {}), API.getDashboardSummary(SCHOOL, {})
    ]).then(function (r) {
      classes = r[0]; scales = r[1];
      terms = [{ id: r[2].term_id, label: r[2].term_name }];
      state.termId = r[2].term_id;

      U.fillSelect(doc.getElementById('f-term'), terms, 'id', 'label', false);
      U.fillSelect(doc.getElementById('f-type'),
        Object.keys(TYPE_LABEL).map(function (k) { return { id: k, label: TYPE_LABEL[k] }; }), 'id', 'label', true);
      U.fillSelect(doc.getElementById('ex-term'), terms, 'id', 'label', false);
      U.fillSelect(doc.getElementById('ex-scale'), scales.map(function (sc) {
        return { id: sc.id, label: sc.name + ' — 0 to ' + sc.max_score + (sc.is_default ? ' (default)' : '') };
      }), 'id', 'label', false);
      U.fillSelect(doc.getElementById('ex-classes'), classes, 'id', 'full_name', false);

      doc.getElementById('f-term').addEventListener('change', function () {
        state.termId = doc.getElementById('f-term').value; load();
      });
      doc.getElementById('f-type').addEventListener('change', function () {
        state.type = doc.getElementById('f-type').value; load();
      });
      doc.getElementById('new-exam').addEventListener('click', function () { openEditor(null); });
      return load();
    }).then(function () { U.ready(); })
      .catch(function (e) { global.console.error(e); U.ready('error'); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
