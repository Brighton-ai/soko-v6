/**
 * students.html — the roll: search, filter, sort, paginate, bulk act, CSV.
 * Everything here goes through assets/js/api.js.
 */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, SHELL = global.ShuleShell, U = global.UI;
  var SCHOOL = SHELL.SCHOOL_ID;

  var state = { search: '', classId: '', status: 'active', sort: 'name', dir: 'asc', page: 1 };
  var classes = [];
  var pick = null;

  function rowHTML(s) {
    return '<tr data-student="' + s.id + '">' +
      '<td class="pick"><input type="checkbox" data-pick="' + s.id + '" aria-label="Select ' + U.esc(s.name) + '"></td>' +
      '<td><a class="who-cell" href="student.html?id=' + encodeURIComponent(s.id) + '">' +
        '<span class="av">' + U.esc(U.initials(s.name)) + '</span>' +
        '<span><b>' + U.esc(s.name) + '</b><span>' + U.esc(s.guardian_phone) + '</span></span></a></td>' +
      '<td class="sub">' + U.esc(s.admission_no) + '</td>' +
      '<td>' + U.esc(s.class_name) + '</td>' +
      '<td>' + U.esc(s.guardian_name) + '</td>' +
      '<td class="r ' + (s.balance > 0 ? 'owe' : 'sub') + '">' + (s.balance > 0 ? U.kes(s.balance) : '—') + '</td>' +
      '<td class="r">' + U.pct(s.attendance_pct) + '</td>' +
      '<td>' + U.tag(s.status) + '</td>' +
      '</tr>';
  }

  function load() {
    return API.searchStudents(SCHOOL, state).then(function (page) {
      var body = doc.getElementById('rows');
      if (!page.total) {
        U.bind('result-count', 'no pupils');
        U.show('students', 'empty');
        doc.getElementById('pager').hidden = true;
        return page;
      }
      body.innerHTML = page.items.map(rowHTML).join('');
      U.bind('result-count', U.num(page.total) + (page.total === 1 ? ' pupil' : ' pupils'));
      U.pager(doc.getElementById('pager'), page, function (n) { state.page = n; load(); });
      U.show('students', 'content');
      pick.wire();
      return page;
    }).catch(function (e) { U.failed('students', e.message); });
  }

  function refilter() { state.page = 1; load(); }

  // ── filters ───────────────────────────────────────────────────────────
  function wireFilters() {
    var search = doc.getElementById('f-search'),
        cls = doc.getElementById('f-class'),
        status = doc.getElementById('f-status');
    search.addEventListener('input', U.debounce(function () { state.search = search.value.trim(); refilter(); }, 160));
    cls.addEventListener('change', function () { state.classId = cls.value; refilter(); });
    status.addEventListener('change', function () { state.status = status.value; refilter(); });
    doc.getElementById('clear-filters').addEventListener('click', function () {
      search.value = ''; cls.value = ''; status.value = 'active';
      state.search = ''; state.classId = ''; state.status = 'active';
      refilter();
    });
    U.sortable(doc.querySelector('#rows').closest('table'), state, function () { state.page = 1; load(); });
  }

  // ── bulk actions ──────────────────────────────────────────────────────
  function wireBulk() {
    pick = U.selection({
      barId: 'bulk', allId: 'pick-all', noun: 'pupil', nounPlural: 'pupils',
      onChange: function (ids) {
        U.bind('promote-summary', ids.length
          ? ids.length + (ids.length === 1 ? ' pupil moves up one class.' : ' pupils move up one class.')
          : 'Nothing selected.');
      }
    });

    doc.getElementById('bulk-invoice').addEventListener('click', function () {
      var ids = pick.ids();
      if (!ids.length) return;
      // one invoice run per class represented in the selection
      var byClass = {};
      API.searchStudents(SCHOOL, { pageSize: 100000 }).then(function (all) {
        all.items.forEach(function (s) { if (ids.indexOf(s.id) !== -1) byClass[s.class_id] = true; });
        var runs = Object.keys(byClass).map(function (cid) {
          return API.bulkGenerateInvoices(SCHOOL, {
            classId: cid, termId: 't2-2026', dueDate: '2026-09-18'
          }).catch(function (err) { return { created: 0, skipped: 0, error: err.message }; });
        });
        return Promise.all(runs);
      }).then(function (results) {
        var made = results.reduce(function (n, r) { return n + (r.created || 0); }, 0);
        var skipped = results.reduce(function (n, r) { return n + (r.skipped || 0); }, 0);
        SHELL.toast('<b>' + made + '</b> invoice' + (made === 1 ? '' : 's') + ' generated' +
          (skipped ? ', ' + skipped + ' already invoiced and skipped' : '') + '.', { html: true });
        pick.clear();
        load();
      });
    });

    U.onSubmit('modal-message-form', function () {
      var body = doc.getElementById('msg-body');
      var ids = pick.ids();
      if (!ids.length) { U.setErr(body, 'Select at least one pupil first.'); return null; }
      if (!U.setErr(body, body.value.trim() ? '' : 'Write the message before sending it.')) return null;
      return API.sendMessage(SCHOOL, { studentIds: ids, body: body.value.trim() })
        .then(function (r) { pick.clear(); return '<b>' + r.sent + '</b> message' + (r.sent === 1 ? '' : 's') + ' queued.'; });
    });
    var msg = doc.getElementById('msg-body');
    msg.addEventListener('input', function () { U.bind('msg-count', msg.value.length); });

    U.onSubmit('modal-promote-form', function () {
      var confirm = doc.getElementById('promote-confirm');
      var ids = pick.ids();
      if (!ids.length) { U.setErr(confirm, 'Select at least one pupil first.'); return null; }
      if (!U.setErr(confirm, confirm.value.trim().toUpperCase() === 'PROMOTE'
          ? '' : 'Type PROMOTE in capitals to confirm — this moves pupils between classes.')) return null;
      return API.promoteStudents(SCHOOL, { studentIds: ids }).then(function (r) {
        pick.clear();
        load();
        return '<b>' + r.promoted + '</b> promoted' + (r.graduated ? ', ' + r.graduated + ' graduated' : '') + '.';
      });
    });
  }

  // ── add ───────────────────────────────────────────────────────────────
  function wireAdd() {
    U.onSubmit('modal-student-form', function () {
      var name = doc.getElementById('stu-name'), cls = doc.getElementById('stu-class'),
          dob = doc.getElementById('stu-dob'), guardian = doc.getElementById('stu-guardian'),
          phone = doc.getElementById('stu-phone'), gender = doc.getElementById('stu-gender');
      var digits = phone.value.replace(/[\s+()-]/g, '');
      var ok = [
        U.setErr(name, name.value.trim().length >= 2 ? '' : 'Enter the pupil’s full name.'),
        U.setErr(cls, cls.value ? '' : 'Every pupil is admitted into a class.'),
        U.setErr(dob, dob.value ? '' : 'A date of birth is needed for the register.'),
        U.setErr(guardian, guardian.value.trim().length >= 2 ? '' : 'Enter the primary guardian’s name.'),
        U.setErr(phone, /^\d{9,13}$/.test(digits) ? '' : 'Digits only, please — for example 0712 345 678.')
      ].every(Boolean);
      if (!ok) return null;
      return API.createStudent(SCHOOL, {
        name: name.value.trim(), class_id: cls.value, gender: gender.value,
        date_of_birth: dob.value, guardian_name: guardian.value.trim(), guardian_phone: phone.value.trim()
      }).then(function (s) {
        load();
        return '<b>' + U.esc(s.name) + '</b> admitted as ' + U.esc(s.admission_no) + '.';
      });
    });
  }

  // ── CSV ───────────────────────────────────────────────────────────────
  var pendingCSV = null;

  function wireCSV() {
    var file = doc.getElementById('csv-file'),
        text = doc.getElementById('csv-text'),
        wrap = doc.getElementById('csv-paste-wrap'),
        submit = doc.getElementById('csv-submit');

    doc.getElementById('csv-sample').addEventListener('click', function () {
      wrap.hidden = false;
      text.value = API.CSV_COLUMNS.join(',') + '\n' +
        'Wanjiku Njoroge,Grade 6 East,2015-04-09,F,Peter Njoroge,0712345678\n' +
        'Brian Otieno,Grade 7 West,2013-11-02,M,Alice Otieno,0722113344\n';
      preview(text.value);
    });
    text.addEventListener('input', U.debounce(function () { preview(text.value); }, 200));
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var reader = new global.FileReader();
      reader.onload = function () { preview(String(reader.result)); };
      reader.readAsText(f);
    });

    function preview(csv) {
      if (!csv || !csv.trim()) { doc.getElementById('csv-preview').hidden = true; submit.disabled = true; return; }
      API.importStudentsCSV(SCHOOL, csv, { dryRun: true }).then(function (r) {
        pendingCSV = csv;
        renderPreview(r);
        submit.disabled = r.would_import === 0;
        U.setErr(doc.getElementById('csv-file'), '');
        U.setErr(text, '');
      }).catch(function (err) {
        pendingCSV = null;
        submit.disabled = true;
        doc.getElementById('csv-preview').hidden = true;
        U.setErr(text.value ? text : file, err.message);
      });
    }

    U.onSubmit('modal-import-form', function () {
      if (!pendingCSV) { U.setErr(file, 'Choose a file, or paste some rows, before importing.'); return null; }
      return API.importStudentsCSV(SCHOOL, pendingCSV, {}).then(function (r) {
        pendingCSV = null;
        doc.getElementById('csv-preview').hidden = true;
        submit.disabled = true;
        load();
        return '<b>' + r.imported + '</b> pupil' + (r.imported === 1 ? '' : 's') + ' imported' +
          (r.error_count ? ', ' + r.error_count + ' row' + (r.error_count === 1 ? '' : 's') + ' skipped' : '') + '.';
      });
    });
  }

  function renderPreview(r) {
    var host = doc.getElementById('csv-preview');
    host.hidden = false;
    doc.getElementById('csv-summary').innerHTML =
      '<b>' + r.would_import + '</b> of ' + r.total + ' row' + (r.total === 1 ? '' : 's') + ' will import' +
      (r.error_count ? '. <b>' + r.error_count + '</b> will be skipped — listed below with line numbers.' : '.');

    var cols = ['Line'].concat(API.CSV_COLUMNS);
    doc.getElementById('csv-head').innerHTML = cols.map(function (c) { return '<th>' + U.esc(c) + '</th>'; }).join('');

    var good = r.accepted.map(function (a) {
      return { line: a.line, ok: true, cells: [a.name, a.class_name, a.date_of_birth, a.gender, a.guardian_name, a.guardian_phone] };
    });
    var bad = r.errors.map(function (e) {
      return { line: e.line, ok: false, cells: [e.full_name, '—', '—', '—', '—', '—'], why: e.problems.join('; ') };
    });
    var all = good.concat(bad).sort(function (a, b) { return a.line - b.line; });
    doc.getElementById('csv-body').innerHTML = all.map(function (row) {
      return '<tr data-ok="' + row.ok + '" data-line="' + row.line + '"><td>' + row.line + '</td>' +
        row.cells.map(function (c) { return '<td>' + U.esc(c) + '</td>'; }).join('') + '</tr>';
    }).join('');

    var errBox = doc.getElementById('csv-errors');
    errBox.hidden = r.errors.length === 0;
    doc.getElementById('csv-error-list').innerHTML = r.errors.map(function (e) {
      return '<li data-error-line="' + e.line + '"><b>Line ' + e.line + '</b> (' + U.esc(e.full_name) + '): ' +
        U.esc(e.problems.join('; ')) + '</li>';
    }).join('');
  }

  function wireExport() {
    doc.getElementById('export-csv').addEventListener('click', function () {
      API.exportStudentsCSV(SCHOOL, { classId: state.classId, status: state.status }).then(function (r) {
        U.downloadCSV(r.filename, r.csv);
        SHELL.toast('<b>' + r.rows + '</b> pupils exported to ' + U.esc(r.filename) + '.', { html: true });
      });
    });
  }

  function boot() {
    API.listClasses(SCHOOL, {}).then(function (rows) {
      classes = rows;
      U.fillSelect(doc.getElementById('f-class'), rows, 'id', 'full_name', true);
      U.fillSelect(doc.getElementById('stu-class'), rows, 'id', 'full_name', true);
      wireFilters(); wireBulk(); wireAdd(); wireCSV(); wireExport();
      return load();
    }).then(function () { U.ready(); })
      .catch(function (e) { global.console.error(e); U.ready('error'); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
