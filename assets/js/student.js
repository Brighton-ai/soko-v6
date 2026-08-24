/**
 * student.html — one pupil, six tabs. The id comes off the query string; a bad
 * or missing one renders the not-found panel rather than throwing.
 */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, SHELL = global.ShuleShell, U = global.UI;
  var SCHOOL = SHELL.SCHOOL_ID;

  var studentId = U.query('id');
  var student = null, classes = [], subjects = [], TODAY = '2026-08-20';
  var editingGuardian = null, payingInvoice = null;

  function stat(label, value) {
    return '<div class="qstat"><span>' + U.esc(label) + '</span><b>' + value + '</b></div>';
  }
  function dterm(label, value) {
    return '<div><dt>' + U.esc(label) + '</dt><dd>' + value + '</dd></div>';
  }

  // ── tabs ──────────────────────────────────────────────────────────────
  function wireTabs() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-tab]'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-tab');
        Array.prototype.forEach.call(doc.querySelectorAll('[data-tab]'), function (b) {
          b.setAttribute('aria-selected', String(b === btn));
        });
        Array.prototype.forEach.call(doc.querySelectorAll('.tabpanel'), function (p) {
          p.hidden = p.id !== 'panel-' + key;
        });
      });
    });
  }

  // ── overview ──────────────────────────────────────────────────────────
  function renderOverview(s, invoices, attendance) {
    U.bind('name', s.name);
    U.bind('crumb', s.name);
    U.bind('initials', U.initials(s.name));
    U.bind('admission', s.admission_no);
    U.bind('class', s.class_name || '—');
    doc.querySelector('[data-bind="status-tag"]').innerHTML = U.tag(s.status);

    var balance = invoices.reduce(function (n, i) { return n + i.balance; }, 0);
    var here = attendance.filter(function (a) { return a.status === 'present' || a.status === 'late'; }).length;

    doc.getElementById('profile').innerHTML = [
      dterm('Admission number', U.esc(s.admission_no)),
      dterm('Class', U.esc(s.class_name || '—')),
      dterm('Gender', s.gender === 'F' ? 'Female' : 'Male'),
      dterm('Date of birth', U.longDate(s.date_of_birth)),
      dterm('Admitted', U.longDate(s.admitted_on)),
      dterm('Status', U.tag(s.status)),
      dterm('Scholarship on record', s.scholarship_amount ? U.kes(s.scholarship_amount) : '<span class="sub">None</span>'),
      dterm('Transport route', s.transport_route_id ? U.esc(U.titleCase(s.transport_route_id.replace('rt-', ''))) : '<span class="sub">Not on transport</span>'),
      dterm('Primary guardian', U.esc(s.guardian_name || '—') + '<br><span class="sub">' + U.esc(s.guardian_phone || '') + '</span>')
    ].join('');

    doc.getElementById('quickstats').innerHTML =
      stat('Fee balance', balance > 0 ? U.kes(balance) : 'Cleared') +
      stat('Invoices', U.num(invoices.length)) +
      stat('Attendance', attendance.length ? U.pct(here / attendance.length * 100) : '—') +
      stat('Days recorded', U.num(attendance.length));
  }

  // ── guardians ─────────────────────────────────────────────────────────
  function renderGuardians(rows) {
    doc.querySelector('[data-tab-count="guardians"]').textContent = ' ' + rows.length;
    doc.getElementById('guardian-cards').innerHTML = rows.map(function (g) {
      return '<div class="gcard" data-guardian="' + g.id + '" data-primary="' + g.is_primary + '">' +
        '<div class="gcard__h"><div><b>' + U.esc(g.name) + '</b>' +
          '<span>' + U.esc(g.relationship) + '</span></div>' +
          (g.is_primary ? '<span class="tag tag--warn"><i></i>Primary</span>'
                        : (g.is_emergency ? '<span class="tag tag--mute"><i></i>Emergency</span>' : '')) +
        '</div>' +
        '<dl><div><dt>Phone</dt><dd>' + U.esc(g.phone) + '</dd></div>' +
          (g.email ? '<div><dt>Email</dt><dd>' + U.esc(g.email) + '</dd></div>' : '') +
          (g.occupation ? '<div><dt>Work</dt><dd>' + U.esc(g.occupation) + '</dd></div>' : '') + '</dl>' +
        '<div class="gcard__f">' +
          (g.is_primary ? '' : '<button type="button" class="btn btn--ghost btn--sm" data-primary-set="' + g.id + '">Make primary</button>') +
          '<button type="button" class="btn btn--ghost btn--sm" data-guardian-edit="' + g.id + '">Edit</button>' +
          (rows.length > 1 ? '<button type="button" class="btn btn--ghost btn--sm" data-guardian-remove="' + g.id + '">Remove</button>' : '') +
        '</div></div>';
    }).join('');

    Array.prototype.forEach.call(doc.querySelectorAll('[data-primary-set]'), function (b) {
      b.addEventListener('click', function () {
        API.setPrimaryGuardian(SCHOOL, studentId, b.getAttribute('data-primary-set'))
          .then(function () { SHELL.toast('Primary guardian updated.'); return reload(); });
      });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-guardian-edit]'), function (b) {
      b.addEventListener('click', function () {
        editingGuardian = rows.filter(function (g) { return g.id === b.getAttribute('data-guardian-edit'); })[0];
        openGuardianModal(editingGuardian);
      });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-guardian-remove]'), function (b) {
      b.addEventListener('click', function () {
        API.removeGuardian(SCHOOL, b.getAttribute('data-guardian-remove'))
          .then(function () { SHELL.toast('Guardian removed.'); return reload(); })
          .catch(function (err) { SHELL.toast(U.esc(err.message), { tone: 'bad', ms: 6000 }); });
      });
    });
  }

  // ── guardian portal links ─────────────────────────────────────────────
  function renderTokens(rows) {
    var host = doc.getElementById('token-list');
    if (!host) return;
    host.innerHTML = rows.length
      ? rows.map(function (t) {
          return '<div class="token" data-token="' + U.esc(t.token) + '" data-active="' + t.active + '">' +
            '<span class="token__x"><b>' + U.esc(t.url) + '</b>' +
            '<span>' + U.esc(t.guardian_name) + ' · ' + U.esc(t.issued_to) + ' · ' +
              (t.revoked ? 'withdrawn'
                : t.active ? 'expires ' + U.shortDate(t.expires_at)
                : 'expired ' + U.shortDate(t.expires_at)) +
              ' · ' + t.uses + (t.uses === 1 ? ' visit' : ' visits') + '</span></span>' +
            (t.active
              ? '<span class="tag tag--ok"><i></i>Live</span>'
              : '<span class="tag tag--mute"><i></i>' + (t.revoked ? 'Withdrawn' : 'Expired') + '</span>') +
            '<a class="btn btn--ghost btn--sm" href="../' + U.esc(t.url) + '" target="_blank" rel="noopener">Open</a>' +
            '</div>';
        }).join('')
      : '<p class="sub" style="font-size:12.4px">No portal link has been issued for this pupil yet.</p>';
  }

  U.onSubmit('modal-token-form', function () {
    var guardian = doc.getElementById('tk-guardian'), days = doc.getElementById('tk-days');
    if (!U.setErr(guardian, guardian.value ? '' : 'Choose which guardian the link is for.')) return null;
    return API.issueGuardianToken(SCHOOL, studentId, {
      guardianId: guardian.value, days: Number(days.value)
    }).then(function (t) {
      reload();
      return 'Link issued for <b>' + U.esc(t.guardian_name) + '</b>, good until ' +
        U.shortDate(t.expires_at) + '.';
    });
  });

  function openGuardianModal(g) {
    editingGuardian = g || null;
    doc.getElementById('modal-guardian-t').textContent = g ? 'Edit guardian' : 'Add a guardian';
    doc.getElementById('gd-name').value = g ? g.name : '';
    doc.getElementById('gd-relationship').value = g ? g.relationship : 'Mother';
    doc.getElementById('gd-phone').value = g ? g.phone : '';
    doc.getElementById('gd-email').value = g && g.email ? g.email : '';
    doc.getElementById('gd-primary').checked = g ? !!g.is_primary : false;
    doc.getElementById('gd-emergency').checked = g ? !!g.is_emergency : false;
    U.clearErrs(doc.getElementById('modal-guardian-form'));
    SHELL.showModal('modal-guardian');
  }

  U.onSubmit('modal-guardian-form', function () {
    var name = doc.getElementById('gd-name'), rel = doc.getElementById('gd-relationship'),
        phone = doc.getElementById('gd-phone'), email = doc.getElementById('gd-email');
    var digits = phone.value.replace(/[\s+()-]/g, '');
    var ok = [
      U.setErr(name, name.value.trim().length >= 2 ? '' : 'Enter the guardian’s full name.'),
      U.setErr(phone, /^\d{9,13}$/.test(digits) ? '' : 'Digits only, please — for example 0712 345 678.'),
      U.setErr(email, !email.value.trim() || /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.value.trim())
        ? '' : 'That does not look like an email address.')
    ].every(Boolean);
    if (!ok) return null;
    var payload = {
      name: name.value.trim(), relationship: rel.value, phone: phone.value.trim(),
      email: email.value.trim() || null,
      is_primary: doc.getElementById('gd-primary').checked,
      is_emergency: doc.getElementById('gd-emergency').checked
    };
    var call = editingGuardian
      ? API.updateGuardian(SCHOOL, editingGuardian.id, payload)
      : API.addGuardian(SCHOOL, studentId, payload);
    return call.then(function () { reload(); return 'Guardian saved.'; });
  });

  // ── fees ──────────────────────────────────────────────────────────────
  function renderFees(invoices, payments) {
    doc.querySelector('[data-tab-count="fees"]').textContent = ' ' + invoices.length;
    var invoiced = invoices.reduce(function (n, i) { return n + i.amount_due; }, 0);
    var paid = invoices.reduce(function (n, i) { return n + i.amount_paid; }, 0);
    doc.getElementById('fee-stats').innerHTML =
      stat('Invoiced', U.kes(invoiced)) + stat('Paid', U.kes(paid)) +
      stat('Balance', U.kes(invoiced - paid)) + stat('Receipts', U.num(payments.length));

    doc.getElementById('fee-rows').innerHTML = invoices.map(function (i) {
      return '<tr data-invoice="' + i.id + '">' +
        '<td class="strong">' + U.esc(i.term_name) + '</td>' +
        '<td class="r">' + U.kes(i.amount_due) + '</td>' +
        '<td class="r">' + U.kes(i.amount_paid) + '</td>' +
        '<td class="r ' + (i.balance > 0 ? 'owe' : 'sub') + '" data-cell="balance">' +
          (i.balance > 0 ? U.kes(i.balance) : '—') + '</td>' +
        '<td class="sub">' + U.shortDate(i.due_date) + '</td>' +
        '<td>' + U.tag(i.status) + '</td>' +
        '<td class="r">' + i.reminders_sent + '</td>' +
        '<td class="r">' + (i.balance > 0
          ? '<button type="button" class="btn btn--ghost btn--sm" data-pay="' + i.id + '">Record payment</button>'
          : '<span class="sub">—</span>') + '</td></tr>';
    }).join('');

    doc.getElementById('payment-rows').innerHTML = payments.length
      ? payments.map(function (p) {
          return '<tr data-payment="' + p.id + '">' +
            '<td class="sub">' + U.shortDate(p.paid_at.slice(0, 10)) + '</td>' +
            '<td class="r strong">' + U.kes(p.amount) + '</td>' +
            '<td>' + U.esc(U.METHOD_LABEL[p.method] || p.method) + '</td>' +
            '<td class="sub">' + U.esc(p.reference || p.mpesa_code || '—') + '</td>' +
            '<td class="r"><button type="button" class="btn btn--ghost btn--sm" data-view-receipt="' + p.id + '">Receipt</button></td>' +
            '</tr>';
        }).join('')
      : '<tr><td colspan="5" class="sub" style="padding:16px">No payments recorded yet.</td></tr>';

    Array.prototype.forEach.call(doc.querySelectorAll('[data-pay]'), function (b) {
      b.addEventListener('click', function () {
        payingInvoice = invoices.filter(function (i) { return i.id === b.getAttribute('data-pay'); })[0];
        doc.getElementById('pay-context').innerHTML =
          '<b>' + U.esc(student.name) + '</b> · ' + U.esc(payingInvoice.term_name) +
          ' · outstanding <b>' + U.kes(payingInvoice.balance) + '</b>';
        var amount = doc.getElementById('pay-amount');
        amount.value = payingInvoice.balance;
        amount.max = payingInvoice.balance;
        doc.getElementById('pay-date').value = TODAY;
        U.clearErrs(doc.getElementById('modal-pay-form'));
        SHELL.showModal('modal-pay');
      });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-view-receipt]'), function (b) {
      b.addEventListener('click', function () {
        API.getReceipt(SCHOOL, b.getAttribute('data-view-receipt')).then(function (r) {
          doc.getElementById('receipt-body').innerHTML = receiptHTML(r);
          SHELL.showModal('modal-receipt');
        });
      });
    });
  }

  function receiptHTML(r) {
    return '<div class="receipt" id="receipt-print">' +
      '<div class="receipt__h"><div><h3>' + U.esc(r.school.name) + '</h3>' +
        '<p>' + U.esc(r.school.address) + '<br>' + U.esc(r.school.phone) + '<br>Paybill ' + U.esc(r.school.paybill) + '</p></div>' +
        '<div class="receipt__no"><b>Receipt ' + U.esc(r.receipt_no) + '</b>' +
        '<span>' + U.longDate(r.payment.paid_at.slice(0, 10)) + '</span></div></div>' +
      '<dl><dt>Student</dt><dd>' + U.esc(r.student ? r.student.name : '—') + '</dd>' +
        '<dt>Admission no</dt><dd>' + U.esc(r.student ? r.student.admission_no : '—') + '</dd>' +
        '<dt>Class</dt><dd>' + U.esc(r.class_name) + '</dd>' +
        '<dt>Term</dt><dd>' + U.esc(r.term_name) + '</dd>' +
        '<dt>Method</dt><dd>' + U.esc(U.METHOD_LABEL[r.payment.method] || r.payment.method) + '</dd>' +
        '<dt>Reference</dt><dd>' + U.esc(r.payment.reference || r.payment.mpesa_code || '—') + '</dd></dl>' +
      '<table><thead><tr><th>Fee item</th><th class="r">Amount</th></tr></thead><tbody>' +
        r.items.map(function (i) { return '<tr><td>' + U.esc(i.name) + '</td><td class="r">' + U.kes(i.amount) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td>Invoiced this term</td><td class="r">' + U.kes(r.amount_due) + '</td></tr>' +
      '<tr><td>Balance after</td><td class="r">' + U.kes(r.balance_after) + '</td></tr></tfoot></table>' +
      '<div class="receipt__paid"><span>Received with thanks</span><b>' + U.kes(r.payment.amount) + '</b></div>' +
      '<p class="receipt__foot">Computer-generated receipt. No signature required.</p></div>';
  }

  U.onSubmit('modal-pay-form', function () {
    if (!payingInvoice) return null;
    var amount = doc.getElementById('pay-amount'), method = doc.getElementById('pay-method'),
        reference = doc.getElementById('pay-reference'), date = doc.getElementById('pay-date');
    var v = Number(amount.value);
    var ok = [
      U.setErr(amount, !isFinite(v) || v <= 0
        ? 'Enter an amount greater than zero.'
        : (v > payingInvoice.balance
            ? 'That is more than the ' + U.kes(payingInvoice.balance) + ' outstanding.'
            : '')),
      U.setErr(date, date.value ? '' : 'When was it received?')
    ].every(Boolean);
    if (!ok) return null;
    return API.recordPayment(SCHOOL, payingInvoice.id, {
      amount: v, method: method.value, reference: reference.value.trim() || null, paidAt: date.value
    }).then(function (r) {
      reload();
      return 'Payment of <b>' + U.kes(r.payment.amount) + '</b> recorded.';
    });
  });

  // ── attendance ────────────────────────────────────────────────────────
  function renderAttendance(rows) {
    doc.querySelector('[data-tab-count="attendance"]').textContent = ' ' + rows.length;
    var sorted = rows.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var count = function (st) { return sorted.filter(function (a) { return a.status === st; }).length; };
    var here = count('present') + count('late');
    doc.getElementById('att-stats').innerHTML =
      stat('Term attendance', sorted.length ? U.pct(here / sorted.length * 100) : '—') +
      stat('Present', U.num(count('present'))) + stat('Late', U.num(count('late'))) +
      stat('Absent', U.num(count('absent'))) + stat('Excused', U.num(count('excused')));

    doc.getElementById('calendar').innerHTML = sorted.map(function (a) {
      var t = new Date(a.date + 'T00:00:00Z');
      return '<span class="cal__d" data-status="' + a.status + '" data-date="' + a.date + '" ' +
        'title="' + U.esc(U.longDate(a.date) + ' — ' + U.titleCase(a.status) + (a.note ? ': ' + a.note : '')) + '">' +
        t.getUTCDate() + '</span>';
    }).join('');
  }

  // ── results ───────────────────────────────────────────────────────────
  function renderResults(exams, results, subjects) {
    doc.querySelector('[data-tab-count="results"]').textContent = ' ' + results.length;
    var subjectName = {};
    subjects.forEach(function (s) { subjectName[s.id] = s.name; });

    var host = doc.getElementById('results-by-exam');
    var withResults = exams.filter(function (e) {
      return results.some(function (r) { return r.exam_id === e.id; });
    });
    if (!withResults.length) {
      host.innerHTML = '<div class="empty"><b>No results yet</b>' +
        '<p>Nothing has been marked for this pupil this term.</p></div>';
      return;
    }
    host.innerHTML = withResults.map(function (e) {
      var mine = results.filter(function (r) { return r.exam_id === e.id; });
      var mean = mine.reduce(function (n, r) { return n + r.score; }, 0) / mine.length;
      var points = mine.reduce(function (n, r) { return n + r.points; }, 0);
      return '<div data-exam="' + e.id + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:13px 16px;border-bottom:1px solid var(--line);background:var(--paper)">' +
          '<b style="font-family:var(--f-display);font-size:13px">' + U.esc(e.name) + '<span class="sub"> · ' + U.shortDate(e.sat_on) + '</span></b>' +
          '<span style="font-size:12px">Mean <b style="font-family:var(--f-display)">' + mean.toFixed(1) + '</b> · ' +
            points + ' points · ' +
            (mine.every(function (r) { return r.verified; })
              ? '<span class="tag tag--ok"><i></i>Verified</span>'
              : '<span class="tag tag--warn"><i></i>Awaiting verification</span>') + '</span>' +
        '</div>' +
        '<div class="tbl-scroll"><table class="tbl">' +
        '<caption class="vh">Results for ' + U.esc(e.name) + '</caption>' +
        '<thead><tr><th scope="col">Subject</th><th scope="col" class="r">Score</th>' +
        '<th scope="col">Grade</th><th scope="col" class="r">Points</th><th scope="col">Remark</th></tr></thead><tbody>' +
        mine.map(function (r) {
          return '<tr data-result="' + r.id + '"><td>' + U.esc(subjectName[r.subject_id] || r.subject_id) + '</td>' +
            '<td class="r strong">' + r.score + '</td>' +
            '<td><b style="font-family:var(--f-display);color:var(--orange-600)">' + U.esc(r.grade) + '</b></td>' +
            '<td class="r">' + r.points + '</td>' +
            '<td class="sub">' + U.esc(r.remark) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }).join('');
  }

  // ── discipline ────────────────────────────────────────────────────────
  function renderDiscipline(rows) {
    doc.querySelector('[data-tab-count="discipline"]').textContent = ' ' + rows.length;
    doc.getElementById('discipline-rows').innerHTML = rows.length
      ? rows.map(function (r) {
          return '<tr data-incident="' + r.id + '">' +
            '<td class="sub">' + U.shortDate(r.date) + '</td>' +
            '<td><span class="tag tag--' + (r.severity === 'high' ? 'bad' : r.severity === 'medium' ? 'warn' : 'mute') +
              '"><i></i>' + U.esc(U.titleCase(r.category)) + '</span></td>' +
            '<td>' + U.esc(r.note) + '</td>' +
            '<td class="sub">' + U.esc(r.action_taken) + '</td>' +
            '<td class="sub">' + U.esc(r.recorded_by_name) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="5" class="sub" style="padding:16px">Nothing on file. That is the good outcome.</td></tr>';
  }

  U.onSubmit('modal-incident-form', function () {
    var date = doc.getElementById('in-date'), note = doc.getElementById('in-note');
    var ok = [
      U.setErr(date, date.value ? '' : 'An incident needs a date.'),
      U.setErr(note, note.value.trim().length >= 5 ? '' : 'Describe what happened, briefly.')
    ].every(Boolean);
    if (!ok) return null;
    return API.addDiscipline(SCHOOL, studentId, {
      date: date.value, category: doc.getElementById('in-category').value,
      note: note.value.trim(), action: doc.getElementById('in-action').value,
      severity: doc.getElementById('in-severity').value
    }).then(function () { reload(); return 'Incident recorded.'; });
  });

  // ── header actions ────────────────────────────────────────────────────
  function wireHeader() {
    doc.getElementById('promote-one').addEventListener('click', function () {
      API.promoteStudents(SCHOOL, { studentIds: [studentId] }).then(function (r) {
        reload();
        SHELL.toast(r.promoted ? 'Moved to ' + U.esc(r.moved[0].to) + '.' : 'Marked as graduated.');
      });
    });
    U.onSubmit('modal-edit-form', function () {
      var name = doc.getElementById('ed-name'), cls = doc.getElementById('ed-class');
      var ok = [
        U.setErr(name, name.value.trim().length >= 2 ? '' : 'A pupil needs a name.'),
        U.setErr(cls, cls.value ? '' : 'Choose a class.')
      ].every(Boolean);
      if (!ok) return null;
      return API.updateStudent(SCHOOL, studentId, {
        name: name.value.trim(), class_id: cls.value,
        date_of_birth: doc.getElementById('ed-dob').value,
        scholarship_amount: doc.getElementById('ed-scholarship').value
      }).then(function () { reload(); return 'Record updated.'; });
    });
    U.onSubmit('modal-transfer-form', function () {
      var dest = doc.getElementById('tr-destination'), date = doc.getElementById('tr-date');
      var ok = [
        U.setErr(dest, dest.value.trim().length >= 3 ? '' : 'Name the school the pupil is moving to.'),
        U.setErr(date, date.value ? '' : 'When does the transfer take effect?')
      ].every(Boolean);
      if (!ok) return null;
      return API.transferStudent(SCHOOL, studentId, { destination: dest.value.trim(), date: date.value })
        .then(function () { reload(); return 'Transfer recorded. The record stays on file in full.'; });
    });
    doc.getElementById('print-receipt').addEventListener('click', function () { global.print(); });
    doc.getElementById('add-guardian').addEventListener('click', function () { openGuardianModal(null); });
  }

  // ── load ──────────────────────────────────────────────────────────────
  function notFound() {
    doc.getElementById('loading').hidden = true;
    doc.getElementById('record').hidden = true;
    doc.getElementById('notfound').hidden = false;
    U.bind('crumb', 'Not found');
    U.ready('notfound');
  }

  function reload() { return loadRecord(); }

  function loadRecord() {
    return API.getStudent(SCHOOL, studentId).then(function (s) {
      student = s;
      return Promise.all([
        API.listGuardians(SCHOOL, studentId),
        API.listInvoiceRows(SCHOOL, { studentId: studentId, pageSize: 200 }),
        API.listPaymentLedger(SCHOOL, { pageSize: 100000 }),
        API.listAttendance(SCHOOL, { studentId: studentId }),
        API.listExams(SCHOOL, {}),
        API.listExamResults(SCHOOL, 'exm-t2-mid', { pageSize: 100000 }),
        API.listDiscipline(SCHOOL, { studentId: studentId }),
        API.listGuardianTokens(SCHOOL, studentId)
      ]).then(function (r) {
        var invoices = r[1].items;
        var payments = r[2].items.filter(function (p) { return p.student_id === studentId; });
        var results = r[5].items.filter(function (x) { return x.student_id === studentId; });

        renderOverview(s, invoices, r[3]);
        renderGuardians(r[0]);
        renderFees(invoices, payments);
        renderAttendance(r[3]);
        renderResults(r[4], results, subjects);
        renderDiscipline(r[6]);
        renderTokens(r[7]);
        U.fillSelect(doc.getElementById('tk-guardian'), r[0], 'id', 'name', false);

        doc.getElementById('loading').hidden = true;
        doc.getElementById('notfound').hidden = true;
        doc.getElementById('record').hidden = false;

        doc.getElementById('ed-name').value = s.name;
        doc.getElementById('ed-class').value = s.class_id;
        doc.getElementById('ed-dob').value = s.date_of_birth || '';
        doc.getElementById('ed-scholarship').value = s.scholarship_amount || 0;
      });
    });
  }

  function boot() {
    if (!studentId) { notFound(); return; }
    Promise.all([API.listClasses(SCHOOL, {}), API.getDashboardSummary(SCHOOL, {}), API.listSubjects(SCHOOL, {})])
      .then(function (r) {
        classes = r[0];
        TODAY = r[1].date;
        subjects = r[2];
        U.fillSelect(doc.getElementById('ed-class'), classes, 'id', 'full_name', false);
        doc.getElementById('in-date').value = TODAY;
        doc.getElementById('in-date').max = TODAY;
        doc.getElementById('tr-date').value = TODAY;
        wireTabs();
        wireHeader();
        return loadRecord();
      })
      .then(function () { U.ready(); })
      .catch(function (err) {
        // a bad id is an expected outcome here, not a crash
        if (err && err.status === 404) { notFound(); return; }
        global.console.error(err);
        U.ready('error');
      });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
