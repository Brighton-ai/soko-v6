/** invoices.html — the term's invoices, bulk generation, payments and receipts. */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, SHELL = global.ShuleShell, U = global.UI;
  var SCHOOL = SHELL.SCHOOL_ID;
  var state = { search: '', classId: '', termId: '', status: '', page: 1 };
  var TODAY = '2026-08-20';
  var current = null;   // the invoice a modal is acting on

  function rowHTML(i) {
    return '<tr data-invoice="' + i.id + '" data-status="' + i.status + '">' +
      '<td><a class="who-cell" href="student.html?id=' + encodeURIComponent(i.student_id) + '">' +
        '<span class="av">' + U.esc(U.initials(i.student_name)) + '</span>' +
        '<span><b>' + U.esc(i.student_name) + '</b><span>' + U.esc(i.admission_no) + '</span></span></a></td>' +
      '<td>' + U.esc(i.class_name) + '</td>' +
      '<td class="sub">' + U.esc(i.term_name) + '</td>' +
      '<td class="r">' + U.kes(i.amount_due) + '</td>' +
      '<td class="r">' + U.kes(i.amount_paid) + '</td>' +
      '<td class="r ' + (i.balance > 0 ? 'owe' : 'sub') + '" data-cell="balance">' +
        (i.balance > 0 ? U.kes(i.balance) : '—') + '</td>' +
      '<td class="sub">' + U.shortDate(i.due_date) + '</td>' +
      '<td>' + U.tag(i.status) + '</td>' +
      '<td class="r">' + i.reminders_sent + '</td>' +
      '<td class="r">' + (i.balance > 0
        ? '<button type="button" class="btn btn--ghost btn--sm" data-pay="' + i.id + '">Record payment</button>'
        : '<button type="button" class="btn btn--ghost btn--sm" data-receipt="' + i.id + '">Receipt</button>') + '</td>' +
      '</tr>';
  }

  function load() {
    return API.listInvoiceRows(SCHOOL, state).then(function (page) {
      if (!page.total) {
        U.bind('result-count', 'no invoices');
        doc.getElementById('pager').hidden = true;
        U.show('invoices', 'empty');
        return;
      }
      doc.getElementById('rows').innerHTML = page.items.map(rowHTML).join('');
      U.bind('result-count', U.num(page.total) + (page.total === 1 ? ' invoice' : ' invoices'));
      U.pager(doc.getElementById('pager'), page, function (n) { state.page = n; load(); });
      U.show('invoices', 'content');
      wireRowButtons();
    }).catch(function (e) { U.failed('invoices', e.message); });
  }

  function wireRowButtons() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-pay]'), function (b) {
      b.addEventListener('click', function () { openPayment(b.getAttribute('data-pay')); });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-receipt]'), function (b) {
      b.addEventListener('click', function () { openLatestReceipt(b.getAttribute('data-receipt')); });
    });
  }

  // ── record a payment ──────────────────────────────────────────────────
  function openPayment(invoiceId) {
    API.listInvoiceRows(SCHOOL, { pageSize: 100000 }).then(function (page) {
      current = page.items.filter(function (i) { return i.id === invoiceId; })[0];
      if (!current) return;
      doc.getElementById('pay-context').innerHTML =
        '<b>' + U.esc(current.student_name) + '</b> · ' + U.esc(current.class_name) +
        ' · outstanding <b>' + U.kes(current.balance) + '</b> of ' + U.kes(current.amount_due);
      var amount = doc.getElementById('pay-amount');
      amount.value = current.balance;
      amount.max = current.balance;
      doc.getElementById('pay-date').value = TODAY;
      SHELL.showModal('modal-pay');
    });
  }

  U.onSubmit('modal-pay-form', function () {
    var amount = doc.getElementById('pay-amount'),
        method = doc.getElementById('pay-method'),
        reference = doc.getElementById('pay-reference'),
        date = doc.getElementById('pay-date');
    if (!current) return null;
    var v = Number(amount.value);
    var ok = [
      U.setErr(amount, !isFinite(v) || v <= 0
        ? 'Enter an amount greater than zero.'
        : (v > current.balance
            ? 'That is more than the ' + U.kes(current.balance) + ' outstanding. A payment cannot exceed the balance.'
            : '')),
      U.setErr(reference, reference.value.trim() || method.value !== 'mpesa'
        ? '' : 'An M-Pesa payment needs its transaction code.'),
      U.setErr(date, date.value ? '' : 'When was it received?')
    ].every(Boolean);
    if (!ok) return null;
    return API.recordPayment(SCHOOL, current.id, {
      amount: v, method: method.value, reference: reference.value.trim() || null, paidAt: date.value
    }).then(function (r) {
      load();
      return 'Payment of <b>' + U.kes(r.payment.amount) + '</b> recorded. ' +
        (r.invoice.balance > 0 ? U.kes(r.invoice.balance) + ' still owing.' : 'Invoice cleared.');
    });
  });

  // ── receipts ──────────────────────────────────────────────────────────
  function openLatestReceipt(invoiceId) {
    API.listPaymentLedger(SCHOOL, { pageSize: 100000 }).then(function (page) {
      var mine = page.items.filter(function (p) { return p.invoice_id === invoiceId; });
      if (!mine.length) { SHELL.toast('Nothing has been paid against that invoice yet.', { tone: 'bad' }); return; }
      return API.getReceipt(SCHOOL, mine[0].id).then(renderReceipt);
    });
  }

  function renderReceipt(r) {
    doc.getElementById('receipt-body').innerHTML = receiptHTML(r);
    SHELL.showModal('modal-receipt');
  }

  function receiptHTML(r) {
    return '<div class="receipt" id="receipt-print">' +
      '<div class="receipt__h"><div><h3>' + U.esc(r.school.name) + '</h3>' +
        '<p>' + U.esc(r.school.address) + '<br>' + U.esc(r.school.phone) + ' · ' + U.esc(r.school.email) + '<br>' +
        'Paybill ' + U.esc(r.school.paybill) + '</p></div>' +
        '<div class="receipt__no"><b>Receipt ' + U.esc(r.receipt_no) + '</b>' +
        '<span>' + U.longDate(r.payment.paid_at.slice(0, 10)) + '</span></div></div>' +
      '<dl><dt>Student</dt><dd>' + U.esc(r.student ? r.student.name : '—') + '</dd>' +
        '<dt>Admission no</dt><dd>' + U.esc(r.student ? r.student.admission_no : '—') + '</dd>' +
        '<dt>Class</dt><dd>' + U.esc(r.class_name) + '</dd>' +
        '<dt>Term</dt><dd>' + U.esc(r.term_name) + '</dd>' +
        '<dt>Method</dt><dd>' + U.esc(U.METHOD_LABEL[r.payment.method] || r.payment.method) + '</dd>' +
        '<dt>Reference</dt><dd>' + U.esc(r.payment.reference || r.payment.mpesa_code || '—') + '</dd></dl>' +
      '<table><thead><tr><th>Fee item</th><th class="r">Amount</th></tr></thead><tbody>' +
        r.items.map(function (i) {
          return '<tr><td>' + U.esc(i.name) + '</td><td class="r">' + U.kes(i.amount) + '</td></tr>';
        }).join('') +
      '</tbody><tfoot><tr><td>Invoiced this term</td><td class="r">' + U.kes(r.amount_due) + '</td></tr>' +
        '<tr><td>Paid before this receipt</td><td class="r">' + U.kes(r.paid_before) + '</td></tr>' +
        '<tr><td>Balance after</td><td class="r">' + U.kes(r.balance_after) + '</td></tr></tfoot></table>' +
      '<div class="receipt__paid"><span>Received with thanks</span><b>' + U.kes(r.payment.amount) + '</b></div>' +
      '<p class="receipt__foot">Computer-generated receipt. No signature required. ' +
        'Queries: ' + U.esc(r.school.email) + '</p></div>';
  }

  // ── bulk generate ─────────────────────────────────────────────────────
  function refreshPreview() {
    var cls = doc.getElementById('gen-class'), term = doc.getElementById('gen-term'),
        due = doc.getElementById('gen-due'), box = doc.getElementById('gen-preview');
    if (!cls.value || !term.value) {
      box.innerHTML = 'Choose a class and term to see how many invoices this raises.';
      return;
    }
    API.bulkGenerateInvoices(SCHOOL, {
      classId: cls.value, termId: term.value, dueDate: due.value || TODAY,
      structureId: doc.getElementById('gen-structure').value || null, dryRun: true
    }).then(function (p) {
      box.innerHTML =
        '<b data-preview-count>' + p.would_create + '</b> invoice' + (p.would_create === 1 ? '' : 's') +
        ' will be created, worth <b data-preview-value>' + U.kes(p.total_value) + '</b>.' +
        (p.skipped
          ? '<br><span data-preview-skipped>' + p.skipped + ' pupil' + (p.skipped === 1 ? '' : 's') +
            ' already invoiced for this class and term and will be skipped: ' +
            U.esc(p.skipped_students.slice(0, 4).map(function (s) { return s.student_name; }).join(', ')) +
            (p.skipped > 4 ? ' and ' + (p.skipped - 4) + ' more' : '') + '.</span>'
          : '<br><span data-preview-skipped>Nobody on the roll of ' + p.roll + ' is already invoiced.</span>');
    }).catch(function (err) {
      box.innerHTML = '<span style="color:var(--red-ink)">' + U.esc(err.message) + '</span>';
    });
  }

  U.onSubmit('modal-generate-form', function () {
    var cls = doc.getElementById('gen-class'), term = doc.getElementById('gen-term'),
        due = doc.getElementById('gen-due');
    var ok = [
      U.setErr(cls, cls.value ? '' : 'Choose a class to invoice.'),
      U.setErr(term, term.value ? '' : 'Choose the term these invoices belong to.'),
      U.setErr(due, due.value ? '' : 'Set a due date so reminders know when to start.')
    ].every(Boolean);
    if (!ok) return null;
    return API.bulkGenerateInvoices(SCHOOL, {
      classId: cls.value, termId: term.value, dueDate: due.value,
      structureId: doc.getElementById('gen-structure').value || null
    }).then(function (r) {
      load();
      return '<b>' + r.created + '</b> invoice' + (r.created === 1 ? '' : 's') + ' generated' +
        (r.skipped ? ', ' + r.skipped + ' skipped as already invoiced' : '') + '.';
    });
  });

  // ── boot ──────────────────────────────────────────────────────────────
  function boot() {
    Promise.all([
      API.listClasses(SCHOOL, {}),
      API.getDashboardSummary(SCHOOL, {}),
      API.listFeeStructures(SCHOOL, {})
    ]).then(function (r) {
      var classes = r[0], summary = r[1], structures = r[2];
      var terms = [{ id: summary.term_id, label: summary.term_name }];
      state.termId = summary.term_id;
      TODAY = summary.date;

      U.fillSelect(doc.getElementById('f-class'), classes, 'id', 'full_name', true);
      U.fillSelect(doc.getElementById('f-term'), terms, 'id', 'label', false);
      U.fillSelect(doc.getElementById('gen-class'), classes, 'id', 'full_name', true);
      U.fillSelect(doc.getElementById('gen-term'), terms, 'id', 'label', true);
      U.fillSelect(doc.getElementById('gen-structure'),
        structures.map(function (f) {
          var c = classes.filter(function (x) { return x.id === f.class_id; })[0];
          return { id: f.id, label: (c ? c.full_name : f.class_id) + ' — ' + U.kes(f.total_mandatory) };
        }), 'id', 'label', true);

      ['gen-class', 'gen-term', 'gen-due', 'gen-structure'].forEach(function (id) {
        doc.getElementById(id).addEventListener('change', refreshPreview);
      });

      var search = doc.getElementById('f-search');
      search.addEventListener('input', U.debounce(function () {
        state.search = search.value.trim(); state.page = 1; load();
      }, 160));
      ['f-class', 'f-term', 'f-status'].forEach(function (id) {
        doc.getElementById(id).addEventListener('change', function () {
          state.classId = doc.getElementById('f-class').value;
          state.termId = doc.getElementById('f-term').value;
          state.status = doc.getElementById('f-status').value;
          state.page = 1; load();
        });
      });
      doc.getElementById('clear-filters').addEventListener('click', function () {
        search.value = ''; doc.getElementById('f-class').value = '';
        doc.getElementById('f-status').value = '';
        state.search = ''; state.classId = ''; state.status = ''; state.page = 1;
        load();
      });
      doc.getElementById('print-receipt').addEventListener('click', function () { global.print(); });

      return load();
    }).then(function () { U.ready(); })
      .catch(function (e) { global.console.error(e); U.ready('error'); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
