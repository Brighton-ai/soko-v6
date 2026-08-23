/** waivers.html — bursary and hardship requests, approved or rejected with a reason. */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, SHELL = global.ShuleShell, U = global.UI;
  var SCHOOL = SHELL.SCHOOL_ID;
  var state = { search: '', status: 'pending' };
  var current = null;

  function rowHTML(w) {
    var actions = w.status === 'pending'
      ? '<button type="button" class="btn btn--solid btn--sm" data-approve="' + w.id + '">Approve</button> ' +
        '<button type="button" class="btn btn--ghost btn--sm" data-reject="' + w.id + '">Reject</button>'
      : '<span class="sub">' + U.esc(w.decision_reason || (w.approved_on ? U.shortDate(w.approved_on) : '—')) + '</span>';
    return '<tr data-waiver="' + w.id + '" data-status="' + w.status + '" data-applied="' + !!w.applied + '">' +
      '<td><a class="who-cell" href="student.html?id=' + encodeURIComponent(w.student_id) + '">' +
        '<span class="av">' + U.esc(U.initials(w.student_name)) + '</span>' +
        '<span><b>' + U.esc(w.student_name) + '</b><span>' + U.esc(w.admission_no) + '</span></span></a></td>' +
      '<td>' + U.esc(w.class_name) + '</td>' +
      '<td>' + U.esc(w.reason) + '</td>' +
      '<td class="r strong" data-cell="amount">' + U.kes(w.amount) + '</td>' +
      '<td>' + U.esc(w.requested_by_name) + '</td>' +
      '<td class="sub">' + U.shortDate(w.requested_on) + '</td>' +
      '<td>' + U.tag(w.status) + '</td>' +
      '<td class="r">' + actions + '</td>' +
      '</tr>';
  }

  function load() {
    return API.listWaiverRows(SCHOOL, {}).then(function (data) {
      var all = data.items;
      U.bind('pending-count', U.num(all.filter(function (w) { return w.status === 'pending'; }).length));
      U.bind('pending-value', U.kes(all.filter(function (w) { return w.status === 'pending'; })
        .reduce(function (n, w) { return n + w.amount; }, 0)));
      var approved = all.filter(function (w) { return w.status === 'approved'; });
      U.bind('approved-count', U.num(approved.length));
      U.bind('approved-value', U.kes(approved.reduce(function (n, w) { return n + w.amount; }, 0)));

      var rows = all;
      if (state.status) rows = rows.filter(function (w) { return w.status === state.status; });
      if (state.search) {
        var q = state.search.toLowerCase();
        rows = rows.filter(function (w) { return w.student_name.toLowerCase().indexOf(q) !== -1; });
      }
      if (!rows.length) {
        U.bind('result-count', 'no requests');
        U.show('waivers', 'empty');
        return;
      }
      doc.getElementById('rows').innerHTML = rows.map(rowHTML).join('');
      U.bind('result-count', U.num(rows.length) + (rows.length === 1 ? ' request' : ' requests'));
      U.show('waivers', 'content');
      wireRows(all);
    }).catch(function (e) { U.failed('waivers', e.message); });
  }

  function wireRows(all) {
    function find(id) { return all.filter(function (w) { return w.id === id; })[0]; }
    Array.prototype.forEach.call(doc.querySelectorAll('[data-approve]'), function (b) {
      b.addEventListener('click', function () {
        current = find(b.getAttribute('data-approve'));
        doc.getElementById('approve-context').innerHTML =
          '<b>' + U.esc(current.student_name) + '</b> · ' + U.esc(current.class_name) +
          '<br>' + U.esc(current.reason) + ' · <b>' + U.kes(current.amount) + '</b>';
        SHELL.showModal('modal-approve');
      });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-reject]'), function (b) {
      b.addEventListener('click', function () {
        current = find(b.getAttribute('data-reject'));
        doc.getElementById('reject-context').innerHTML =
          '<b>' + U.esc(current.student_name) + '</b> · ' + U.kes(current.amount) +
          ' · requested by ' + U.esc(current.requested_by_name);
        SHELL.showModal('modal-reject');
      });
    });
  }

  U.onSubmit('modal-approve-form', function () {
    if (!current) return null;
    return API.approveWaiver(SCHOOL, current.id, {
      reason: doc.getElementById('approve-reason').value.trim() || null
    }).then(function (r) {
      load();
      return r.already
        ? 'That waiver was already applied; nothing changed.'
        : 'Waiver applied. <b>' + U.esc(r.waiver.student_name || current.student_name) + '</b> now owes ' +
          U.kes(r.invoice.balance) + '.';
    });
  });

  U.onSubmit('modal-reject-form', function () {
    if (!current) return null;
    var reason = doc.getElementById('reject-reason');
    if (!U.setErr(reason, reason.value.trim().length >= 5
        ? '' : 'Give a reason — the person who asked will be shown it.')) return null;
    return API.rejectWaiver(SCHOOL, current.id, { reason: reason.value.trim() }).then(function () {
      load();
      return 'Request rejected, with the reason on file.';
    });
  });

  function boot() {
    var search = doc.getElementById('f-search');
    search.addEventListener('input', U.debounce(function () { state.search = search.value.trim(); load(); }, 160));
    doc.getElementById('f-status').addEventListener('change', function () {
      state.status = doc.getElementById('f-status').value; load();
    });
    load().then(function () { U.ready(); })
      .catch(function (e) { global.console.error(e); U.ready('error'); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
