/** defaulters.html — outstanding balances aged into buckets, with bulk reminders. */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, SHELL = global.ShuleShell, U = global.UI;
  var SCHOOL = SHELL.SCHOOL_ID;
  var state = { search: '', classId: '', bucket: '', page: 1 };
  var pick = null, MAX = 3;

  function rowHTML(r) {
    return '<tr data-invoice="' + r.invoice_id + '" data-bucket="' + r.bucket + '"' +
      ' data-exhausted="' + r.exhausted + '">' +
      '<td class="pick">' + (r.exhausted
        ? '<input type="checkbox" disabled aria-label="' + U.esc(r.student_name) +
          ' has already had ' + MAX + ' reminders">'
        : '<input type="checkbox" data-pick="' + r.invoice_id + '" aria-label="Select ' + U.esc(r.student_name) + '">') + '</td>' +
      '<td><a class="who-cell" href="student.html?id=' + encodeURIComponent(r.student_id) + '">' +
        '<span class="av">' + U.esc(U.initials(r.student_name)) + '</span>' +
        '<span><b>' + U.esc(r.student_name) + '</b><span>' + U.esc(r.admission_no) + '</span></span></a></td>' +
      '<td>' + U.esc(r.class_name) + '</td>' +
      '<td>' + U.esc(r.guardian_name) + '<span class="sub"> · ' + U.esc(r.guardian_phone) + '</span></td>' +
      '<td class="r owe" data-cell="balance">' + U.kes(r.balance) + '</td>' +
      '<td class="sub">' + U.shortDate(r.due_date) + '</td>' +
      '<td class="r">' + (r.days_past_due > 0 ? r.days_past_due : '<span class="sub">not yet due</span>') + '</td>' +
      '<td><span class="tag tag--' + (r.bucket === '90+' ? 'bad' : r.bucket === '0-30' ? 'mute' : 'warn') +
        '"><i></i>' + U.esc(r.bucket) + '</span></td>' +
      '<td class="r" data-cell="reminders">' + r.reminders_sent +
        (r.exhausted ? '<span class="sub"> / ' + MAX + '</span>' : '') + '</td>' +
      '</tr>';
  }

  function load() {
    return API.listDefaulterRows(SCHOOL, { bucket: state.bucket, classId: state.classId }).then(function (data) {
      MAX = data.max_reminders;
      renderBuckets(data);

      var rows = data.items;
      if (state.search) {
        var q = state.search.toLowerCase();
        rows = rows.filter(function (r) {
          return r.student_name.toLowerCase().indexOf(q) !== -1 ||
                 r.guardian_name.toLowerCase().indexOf(q) !== -1 ||
                 r.admission_no.toLowerCase().indexOf(q) !== -1;
        });
      }
      if (!rows.length) {
        U.bind('result-count', 'nobody owing');
        doc.getElementById('pager').hidden = true;
        U.show('defaulters', 'empty');
        return;
      }
      var size = 25, pages = Math.max(1, Math.ceil(rows.length / size));
      if (state.page > pages) state.page = pages;
      var slice = rows.slice((state.page - 1) * size, state.page * size);

      doc.getElementById('rows').innerHTML = slice.map(rowHTML).join('');
      U.bind('result-count', U.num(rows.length) + ' owing · ' +
        U.kes(rows.reduce(function (n, r) { return n + r.balance; }, 0)));
      U.pager(doc.getElementById('pager'),
        { total: rows.length, page_size: size, page: state.page, pages: pages },
        function (n) { state.page = n; load(); });
      U.show('defaulters', 'content');
      pick.wire();
    }).catch(function (e) { U.failed('defaulters', e.message); });
  }

  function renderBuckets(data) {
    data.buckets.forEach(function (b) {
      var host = doc.querySelector('[data-bucket="' + b.key + '"]');
      if (!host) return;
      host.querySelector('[data-bucket-total]').textContent = U.kes(b.total);
      host.querySelector('[data-bucket-count]').textContent =
        b.count + (b.count === 1 ? ' invoice' : ' invoices');
      host.setAttribute('aria-pressed', String(state.bucket === b.key));
    });
  }

  function boot() {
    pick = U.selection({ barId: 'bulk', allId: 'pick-all', noun: 'invoice', nounPlural: 'invoices' });

    Array.prototype.forEach.call(doc.querySelectorAll('[data-bucket]'), function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-bucket');
        state.bucket = state.bucket === key ? '' : key;
        state.page = 1;
        pick.clear();
        load();
      });
    });
    doc.getElementById('clear-bucket').addEventListener('click', function () {
      state.bucket = ''; state.page = 1; pick.clear(); load();
    });

    var search = doc.getElementById('f-search');
    search.addEventListener('input', U.debounce(function () {
      state.search = search.value.trim(); state.page = 1; load();
    }, 160));
    doc.getElementById('f-class').addEventListener('change', function () {
      state.classId = doc.getElementById('f-class').value; state.page = 1; load();
    });
    doc.getElementById('clear-filters').addEventListener('click', function () {
      search.value = ''; doc.getElementById('f-class').value = '';
      state.search = ''; state.classId = ''; state.page = 1;
      load();
    });

    doc.getElementById('bulk-remind').addEventListener('click', function () {
      var ids = pick.ids();
      if (!ids.length) return;
      API.sendRemindersFor(SCHOOL, { invoiceIds: ids }).then(function (r) {
        pick.clear();
        load();
        SHELL.toast('<b>' + r.sent + '</b> reminder' + (r.sent === 1 ? '' : 's') + ' sent' +
          (r.skipped ? ', ' + r.skipped + ' skipped — already at ' + r.max_reminders : '') + '.', { html: true });
      }).catch(function (err) {
        SHELL.toast('Could not send: ' + U.esc(err.message), { tone: 'bad' });
      });
    });

    API.listClasses(SCHOOL, {}).then(function (classes) {
      U.fillSelect(doc.getElementById('f-class'), classes, 'id', 'full_name', true);
      return load();
    }).then(function () { U.ready(); })
      .catch(function (e) { global.console.error(e); U.ready('error'); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
