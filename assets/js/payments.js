/** payments.html — the receipts ledger, filterable and exportable. */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, SHELL = global.ShuleShell, U = global.UI;
  var SCHOOL = SHELL.SCHOOL_ID;
  var state = { search: '', method: '', from: '', to: '', page: 1 };

  function rowHTML(p) {
    return '<tr data-payment="' + p.id + '" data-method="' + p.method + '">' +
      '<td class="sub">' + U.shortDate(p.paid_at.slice(0, 10)) + ' ' + U.clock(p.paid_at) + '</td>' +
      '<td><a class="who-cell" href="student.html?id=' + encodeURIComponent(p.student_id) + '">' +
        '<span class="av">' + U.esc(U.initials(p.student_name)) + '</span>' +
        '<span><b>' + U.esc(p.student_name) + '</b><span>' + U.esc(p.admission_no) + '</span></span></a></td>' +
      '<td>' + U.esc(p.class_name) + '</td>' +
      '<td class="r strong" data-cell="amount">' + U.kes(p.amount) + '</td>' +
      '<td>' + U.esc(U.METHOD_LABEL[p.method] || p.method) + '</td>' +
      '<td class="sub">' + U.esc(p.reference || '—') + '</td>' +
      '<td class="sub">' + U.esc(p.mpesa_code || '—') + '</td>' +
      '<td>' + (p.matched === 'auto'
        ? '<span class="tag tag--ok"><i></i>Auto-matched</span>'
        : '<span class="tag tag--mute"><i></i>Posted manually</span>') + '</td>' +
      '</tr>';
  }

  function load() {
    return API.listPaymentLedger(SCHOOL, state).then(function (page) {
      if (!page.total) {
        U.bind('result-count', 'no payments');
        doc.getElementById('pager').hidden = true;
        U.show('payments', 'empty');
        return;
      }
      doc.getElementById('rows').innerHTML = page.items.map(rowHTML).join('');
      U.bind('result-count', U.num(page.total) + (page.total === 1 ? ' receipt' : ' receipts'));
      U.pager(doc.getElementById('pager'), page, function (n) { state.page = n; load(); });
      U.show('payments', 'content');
      return API.listPaymentLedger(SCHOOL, Object.assign({}, state, { page: 1, pageSize: 100000 }));
    }).then(function (all) {
      if (!all) return;
      U.bind('total-value', U.kes(all.total_value));
      U.bind('total-count', U.num(all.total));
      U.bind('auto-count', U.num(all.items.filter(function (p) { return p.matched === 'auto'; }).length));
      U.bind('manual-count', U.num(all.items.filter(function (p) { return p.matched === 'manual'; }).length));
    }).catch(function (e) { U.failed('payments', e.message); });
  }

  function boot() {
    var search = doc.getElementById('f-search');
    search.addEventListener('input', U.debounce(function () {
      state.search = search.value.trim(); state.page = 1; load();
    }, 160));
    ['f-method', 'f-from', 'f-to'].forEach(function (id) {
      doc.getElementById(id).addEventListener('change', function () {
        state.method = doc.getElementById('f-method').value;
        state.from = doc.getElementById('f-from').value;
        state.to = doc.getElementById('f-to').value;
        state.page = 1; load();
      });
    });
    doc.getElementById('clear-filters').addEventListener('click', function () {
      ['f-search', 'f-method', 'f-from', 'f-to'].forEach(function (id) { doc.getElementById(id).value = ''; });
      state = { search: '', method: '', from: '', to: '', page: 1 };
      load();
    });
    doc.getElementById('export-csv').addEventListener('click', function () {
      API.exportPaymentsCSV(SCHOOL, state).then(function (r) {
        U.downloadCSV(r.filename, r.csv);
        SHELL.toast('<b>' + r.rows + '</b> payments exported to ' + r.filename + '.');
      });
    });
    load().then(function () { U.ready(); })
      .catch(function (e) { global.console.error(e); U.ready('error'); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
