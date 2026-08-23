/**
 * Shule — demo backend.
 *
 * The store, the general ledger, every mutation and every business rule the
 * app relies on while there is no server. It is a stand-in for school.py, and
 * it is deliberately the only file that knows any of this.
 *
 * STEP 5 DELETES THIS FILE. assets/js/api.js keeps its shape and its route
 * comments; only the bodies change, from BACKEND.x(...) to fetch(...).
 *
 * Nothing outside this file may read window.DEMO_DATA or touch the store — a
 * test enforces that, including against api.js itself.
 */
(function (global) {
  'use strict';

  var LATENCY = 90;   // ms — enough that skeleton states are real, not theatre
  var STORE_KEY = 'shule.store';

  var store = null;

  function session() {
    try { return global.sessionStorage; } catch (e) { return null; }
  }

  function seed() {
    var d = global.DEMO_DATA;
    if (!d) throw new Error('Shule API: the dataset has not loaded. Include assets/js/data/demo-data.js before assets/js/api.js.');
    return clone(d);
  }

  /** The live store: whatever survived the last navigation, or a fresh seed. */
  function db() {
    if (store) return store;
    var ss = session();
    if (ss) {
      var raw = null;
      try { raw = ss.getItem(STORE_KEY); } catch (e) { raw = null; }
      if (raw) {
        try {
          store = JSON.parse(raw);
          return store;
        } catch (e) {
          // a corrupt key is not worth dying over; fall through and reseed
        }
      }
    }
    store = seed();
    persist();
    return store;
  }

  /** Writes the store back so the next page load sees this change. */
  function persist() {
    var ss = session();
    if (!ss || !store) return;
    try { ss.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* quota or private mode: memory still holds */ }
  }

  /** Drops everything the demo has done and goes back to the seed. */
  function resetStore() {
    var ss = session();
    if (ss) { try { ss.removeItem(STORE_KEY); } catch (e) { /* nothing to clear */ } }
    store = null;
    return db();
  }

  // ── the ledger ────────────────────────────────────────────────────────
  function accounts() { return db().accounts; }

  /**
   * Posts one balanced entry. Called for every operation that moves money, so
   * that sum(debits) === sum(credits) holds after each one.
   */
  function postEntry(opts) {
    var d = db();
    var n = d.journal_lines.length;
    function line(side, account) {
      return {
        id: 'jnl-' + String(++n).padStart(6, '0'),
        school_id: opts.schoolId, term_id: opts.termId,
        entry_id: opts.entryId, date: opts.date,
        source: opts.source, source_id: opts.sourceId, memo: opts.memo,
        side: side, account: account.name, account_code: account.code,
        amount: opts.amount
      };
    }
    d.journal_lines.push(line('debit', opts.debit));
    d.journal_lines.push(line('credit', opts.credit));
    return opts.entryId;
  }

  /** Debits minus credits. Zero, or something has gone wrong. */
  function ledgerDrift() {
    var lines = db().journal_lines;
    var dr = 0, cr = 0;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].side === 'debit') dr += lines[i].amount; else cr += lines[i].amount;
    }
    return Math.round((dr - cr) * 100) / 100;
  }

  /** Keeps an invoice's derived fields honest after any change to the money. */
  function reconcileInvoice(inv) {
    inv.balance = inv.amount_due - inv.amount_paid;
    inv.status = inv.amount_paid === 0
      ? (inv.balance === 0 ? 'cleared' : 'unpaid')
      : (inv.balance <= 0 ? 'cleared' : 'part_paid');
    return inv;
  }

  /** Resolves after a short delay, so callers must handle a loading state. */
  function resolve(value) {
    return new Promise(function (done) {
      var ms = typeof global.SHULE_API_LATENCY === 'number' ? global.SHULE_API_LATENCY : LATENCY;
      if (ms <= 0) { done(clone(value)); return; }
      global.setTimeout(function () { done(clone(value)); }, ms);
    });
  }
  /** Callers get their own copy; nothing they do can corrupt the store. */
  function clone(v) {
    return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
  }
  function reject(status, message) {
    var e = new Error(message); e.status = status;
    return Promise.reject(e);
  }
  function paginate(rows, page, pageSize) {
    var p = page || 1, size = pageSize || 50, start = (p - 1) * size;
    return { items: rows.slice(start, start + size), total: rows.length, page: p, page_size: size,
             pages: Math.max(1, Math.ceil(rows.length / size)) };
  }
  function termOf(opts) { return (opts && opts.termId) || db().current_term_id; }
  function byId(rows, id) { return rows.filter(function (r) { return r.id === id; })[0] || null; }

  function previousSchoolDay(dateStr) {
    var t = new Date(dateStr + 'T00:00:00Z');
    do { t.setUTCDate(t.getUTCDate() - 1); } while (t.getUTCDay() === 0 || t.getUTCDay() === 6);
    return t.toISOString().slice(0, 10);
  }
  function attendanceRate(records) {
    if (!records.length) return null;
    var here = records.filter(function (a) { return a.status === 'present' || a.status === 'late'; }).length;
    return here / records.length * 100;
  }

  // ══════════════════════════════════════════════════════════════════════
  // People
  // ══════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/students
  function listStudents(schoolId, opts) {
    opts = opts || {};
    var rows = db().students.filter(function (s) { return s.school_id === schoolId; });
    if (opts.classId) rows = rows.filter(function (s) { return s.class_id === opts.classId; });
    if (opts.status) rows = rows.filter(function (s) { return s.status === opts.status; });
    if (opts.search) {
      var q = String(opts.search).toLowerCase();
      rows = rows.filter(function (s) {
        return s.name.toLowerCase().indexOf(q) !== -1 ||
               s.admission_no.toLowerCase().indexOf(q) !== -1 ||
               s.guardian_phone.replace(/\s/g, '').indexOf(q.replace(/\s/g, '')) !== -1;
      });
    }
    return resolve(paginate(rows, opts.page, opts.pageSize));
  }

  // GET /api/school/{school_id}/students/{student_id}
  function getStudent(schoolId, studentId) {
    var s = db().students.filter(function (x) {
      return x.school_id === schoolId && x.id === studentId;
    })[0];
    if (!s) return reject(404, 'No student ' + studentId + ' at ' + schoolId);
    var cls = byId(db().classes, s.class_id);
    return resolve(Object.assign({}, s, {
      class_name: cls ? cls.full_name : null,
      invoices: db().invoices.filter(function (i) { return i.student_id === s.id; })
    }));
  }

  // POST /api/school/{school_id}/students
  function createStudent(schoolId, payload) {
    var required = ['name', 'class_id', 'guardian_name', 'guardian_phone'];
    for (var i = 0; i < required.length; i++) {
      if (!payload || !String(payload[required[i]] || '').trim()) {
        return reject(422, 'Missing required field: ' + required[i]);
      }
    }
    var d = db();
    var seq = d.students.length + 2301;
    var student = {
      id: 'stu-' + seq, school_id: schoolId, admission_no: 'ADM/' + seq,
      name: payload.name.trim(), gender: payload.gender || 'F',
      class_id: payload.class_id, date_of_birth: payload.date_of_birth || null,
      guardian_name: payload.guardian_name.trim(), guardian_phone: payload.guardian_phone.trim(),
      guardian_relation: payload.guardian_relation || 'Guardian',
      scholarship_amount: Number(payload.scholarship_amount) || 0,
      boarding: false, transport_route_id: null, status: 'active',
      admitted_on: d.today
    };
    d.students.push(student);
    if (payload.guardian_name) {
      d.guardians.push({
        id: 'gdn-' + String(d.guardians.length + 1).padStart(5, '0'),
        school_id: schoolId, student_id: student.id,
        name: payload.guardian_name.trim(),
        relationship: payload.guardian_relation || 'Guardian',
        phone: payload.guardian_phone.trim(),
        email: payload.guardian_email || null,
        is_primary: true, is_emergency: true, occupation: null
      });
    }
    persist();
    return resolve(student);
  }

  // GET /api/school/{school_id}/classes
  function listClasses(schoolId, opts) {
    opts = opts || {};
    var termId = termOf(opts);
    var rows = db().classes.filter(function (c) { return c.school_id === schoolId; });
    if (opts.level) rows = rows.filter(function (c) { return c.level === opts.level; });
    var teachers = db().teachers;
    var students = db().students;
    return resolve(rows.map(function (c) {
      var t = byId(teachers, c.class_teacher_id);
      return Object.assign({}, c, {
        term_id: termId,
        student_count: students.filter(function (s) { return s.class_id === c.id && s.status === 'active'; }).length,
        class_teacher_name: t ? t.name : null
      });
    }));
  }

  // GET /api/school/{school_id}/subjects
  function listSubjects(schoolId, opts) {
    opts = opts || {};
    var rows = db().subjects.filter(function (s) { return s.school_id === schoolId; });
    if (opts.level) rows = rows.filter(function (s) { return s.levels.indexOf(opts.level) !== -1; });
    return resolve(rows);
  }

  // GET /api/school/{school_id}/teachers
  function listTeachers(schoolId, opts) {
    opts = opts || {};
    var rows = db().teachers.filter(function (t) { return t.school_id === schoolId; });
    if (opts.classTeachersOnly) rows = rows.filter(function (t) { return t.is_class_teacher; });
    if (opts.subjectId) {
      var ids = db().assignments
        .filter(function (a) { return a.subject_id === opts.subjectId; })
        .map(function (a) { return a.teacher_id; });
      rows = rows.filter(function (t) { return ids.indexOf(t.id) !== -1; });
    }
    return resolve(rows);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Fees
  // ══════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/fee-structures
  function listFeeStructures(schoolId, opts) {
    opts = opts || {};
    var termId = termOf(opts);
    var rows = db().fee_structures.filter(function (f) {
      return f.school_id === schoolId && f.term_id === termId;
    });
    if (opts.classId) rows = rows.filter(function (f) { return f.class_id === opts.classId; });
    return resolve(rows);
  }

  // GET /api/school/{school_id}/fee-invoices
  function listFeeInvoices(schoolId, opts) {
    opts = opts || {};
    var termId = termOf(opts);
    var rows = db().invoices.filter(function (i) {
      return i.school_id === schoolId && i.term_id === termId;
    });
    if (opts.classId) rows = rows.filter(function (i) { return i.class_id === opts.classId; });
    if (opts.status) rows = rows.filter(function (i) { return i.status === opts.status; });
    if (opts.outstandingOnly) rows = rows.filter(function (i) { return i.balance > 0; });
    return resolve(paginate(rows, opts.page, opts.pageSize || 500));
  }

  // GET /api/school/{school_id}/fee-invoices/defaulters
  function listDefaulters(schoolId, opts) {
    opts = opts || {};
    var termId = termOf(opts);
    var minReminders = opts.minReminders != null ? opts.minReminders : 0;
    var students = db().students;
    var classes = db().classes;
    var rows = db().invoices.filter(function (i) {
      return i.school_id === schoolId && i.term_id === termId &&
             i.balance > 0 && i.reminders_sent >= minReminders;
    }).map(function (i) {
      var s = byId(students, i.student_id), c = byId(classes, i.class_id);
      return {
        invoice_id: i.id, student_id: i.student_id,
        student_name: s ? s.name : '—', admission_no: s ? s.admission_no : '—',
        guardian_name: s ? s.guardian_name : '—', guardian_phone: s ? s.guardian_phone : '—',
        class_id: i.class_id, class_name: c ? c.full_name : '—',
        amount_due: i.amount_due, amount_paid: i.amount_paid, balance: i.balance,
        due_date: i.due_date, reminders_sent: i.reminders_sent, status: i.status
      };
    });
    rows.sort(function (a, b) { return b.balance - a.balance; });
    return resolve(opts.limit ? rows.slice(0, opts.limit) : rows);
  }

  // GET /api/school/{school_id}/fee-invoices/arrears-by-class
  function getArrearsByClass(schoolId, opts) {
    var termId = termOf(opts);
    var invoices = db().invoices.filter(function (i) {
      return i.school_id === schoolId && i.term_id === termId;
    });
    var rows = db().classes.filter(function (c) { return c.school_id === schoolId; }).map(function (c) {
      var mine = invoices.filter(function (i) { return i.class_id === c.id; });
      var owing = mine.filter(function (i) { return i.balance > 0; });
      return {
        class_id: c.id, class_name: c.full_name, level: c.level,
        pupils: mine.length,
        pupils_owing: owing.length,
        outstanding: owing.reduce(function (n, i) { return n + i.balance; }, 0),
        invoiced: mine.reduce(function (n, i) { return n + i.amount_due; }, 0),
        collected: mine.reduce(function (n, i) { return n + i.amount_paid; }, 0)
      };
    }).filter(function (r) { return r.outstanding > 0; });
    rows.sort(function (a, b) { return b.outstanding - a.outstanding; });
    return resolve(rows);
  }

  // GET /api/school/{school_id}/payments
  function listPayments(schoolId, opts) {
    opts = opts || {};
    var termId = termOf(opts);
    var students = db().students, classes = db().classes;
    var rows = db().payments.filter(function (p) {
      return p.school_id === schoolId && p.term_id === termId;
    });
    if (opts.since) rows = rows.filter(function (p) { return p.paid_at.slice(0, 10) >= opts.since; });
    rows = rows.slice().sort(function (a, b) { return a.paid_at < b.paid_at ? 1 : -1; });
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return resolve(rows.map(function (p) {
      var s = byId(students, p.student_id), c = byId(classes, p.class_id);
      return Object.assign({}, p, {
        student_name: s ? s.name : '—', admission_no: s ? s.admission_no : '—',
        class_name: c ? c.full_name : '—'
      });
    }));
  }

  // GET /api/school/{school_id}/payments/daily
  function getDailyCollections(schoolId, opts) {
    opts = opts || {};
    var days = opts.days || 14;
    var end = opts.until || db().today;
    var list = [], cur = end;
    for (var i = 0; i < days; i++) { list.unshift(cur); cur = shiftDay(cur, -1); }
    var payments = db().payments.filter(function (p) { return p.school_id === schoolId; });
    return resolve(list.map(function (day) {
      var mine = payments.filter(function (p) { return p.paid_at.slice(0, 10) === day; });
      return {
        date: day,
        weekday: new Date(day + 'T00:00:00Z').getUTCDay(),
        amount: mine.reduce(function (n, p) { return n + p.amount; }, 0),
        count: mine.length
      };
    }));
  }
  function shiftDay(dateStr, n) {
    var t = new Date(dateStr + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  }

  // POST /api/school/{school_id}/fee-invoices/{invoice_id}/payments
  function recordPayment(schoolId, invoiceId, payload) {
    var d = db();
    var inv = d.invoices.filter(function (i) {
      return i.school_id === schoolId && i.id === invoiceId;
    })[0];
    if (!inv) return reject(404, 'No invoice ' + invoiceId);

    var amount = Number(payload && payload.amount);
    if (!isFinite(amount) || amount <= 0) {
      return reject(422, 'Enter a payment amount greater than zero.');
    }
    if (Math.round(amount * 100) > Math.round(inv.balance * 100)) {
      return reject(422, 'That is more than the outstanding balance of KES ' +
        inv.balance.toLocaleString('en-KE') + '. A payment cannot exceed what is owed.');
    }
    var method = (payload && payload.method) || 'mpesa';
    if (['mpesa', 'cash', 'bank'].indexOf(method) === -1) {
      return reject(422, 'Payment method must be M-Pesa, cash or a bank transfer.');
    }

    inv.amount_paid += amount;
    reconcileInvoice(inv);

    var payment = {
      id: 'pay-' + String(d.payments.length + 1).padStart(5, '0'),
      school_id: schoolId, term_id: inv.term_id,
      invoice_id: inv.id, student_id: inv.student_id, class_id: inv.class_id,
      amount: amount,
      method: method,
      reference: (payload && payload.reference) || null,
      mpesa_code: method === 'mpesa' ? ((payload && payload.reference) || null) : null,
      paid_at: ((payload && payload.paidAt) || d.today) + 'T09:00:00+03:00',
      reconciled: true,
      matched: 'manual'          // posted from the office, not auto-matched by Daraja
    };
    d.payments.push(payment);

    postEntry({
      schoolId: schoolId, termId: inv.term_id, entryId: 'ent-' + payment.id,
      date: payment.paid_at.slice(0, 10), source: 'payment', sourceId: payment.id,
      memo: 'Fee payment ' + (payment.reference || payment.id),
      debit: method === 'mpesa' ? accounts().cash_mpesa : accounts().cash_bank,
      credit: accounts().fees_receivable,
      amount: amount
    });

    persist();
    return resolve({ payment: payment, invoice: inv });
  }

  // GET /api/school/{school_id}/payments/{payment_id}/receipt
  function getReceipt(schoolId, paymentId) {
    var d = db();
    var p = byId(d.payments, paymentId);
    if (!p) return reject(404, 'No payment ' + paymentId);
    var inv = byId(d.invoices, p.invoice_id);
    var student = byId(d.students, p.student_id);
    var cls = byId(d.classes, p.class_id);
    var term = byId(d.terms, p.term_id);
    var priorPaid = d.payments
      .filter(function (x) { return x.invoice_id === p.invoice_id && x.paid_at <= p.paid_at && x.id !== p.id; })
      .reduce(function (n, x) { return n + x.amount; }, 0);
    return resolve({
      receipt_no: 'RCT/' + p.id.replace('pay-', ''),
      school: d.school,
      payment: p,
      invoice: inv,
      student: student,
      class_name: cls ? cls.full_name : '—',
      term_name: term ? term.name + ' ' + term.year : '—',
      items: inv ? inv.items : [],
      amount_due: inv ? inv.amount_due : 0,
      paid_before: priorPaid,
      balance_after: inv ? inv.amount_due - (priorPaid + p.amount) : 0
    });
  }

  // POST /api/school/{school_id}/fee-invoices/reminders
  function sendFeeReminders(schoolId, opts) {
    opts = opts || {};
    var termId = termOf(opts);
    var rows = db().invoices.filter(function (i) {
      return i.school_id === schoolId && i.term_id === termId && i.balance > 0 &&
             (!opts.classId || i.class_id === opts.classId);
    });
    rows.forEach(function (i) { i.reminders_sent += 1; });
    persist();
    return resolve({
      class_id: opts.classId || null,
      reminders_sent: rows.length,
      channel: 'sms',
      sent_at: db().today + 'T09:05:00+03:00'
    });
  }

  // POST /api/school/{school_id}/fee-invoices/bulk-generate
  function generateInvoices(schoolId, payload) {
    if (!payload || !payload.termId) return reject(422, 'A term is required to generate invoices.');
    if (!payload.classIds || !payload.classIds.length) return reject(422, 'Select at least one class.');
    var count = db().students.filter(function (s) {
      return s.school_id === schoolId && payload.classIds.indexOf(s.class_id) !== -1 && s.status === 'active';
    }).length;
    return resolve({ term_id: payload.termId, class_ids: payload.classIds, invoices_created: count });
  }

  // GET /api/school/{school_id}/fee-waivers
  function listWaivers(schoolId, opts) {
    opts = opts || {};
    var termId = termOf(opts);
    var students = db().students;
    var rows = db().waivers.filter(function (w) {
      return w.school_id === schoolId && w.term_id === termId &&
             (!opts.status || w.status === opts.status);
    });
    return resolve(rows.map(function (w) {
      var s = byId(students, w.student_id);
      return Object.assign({}, w, { student_name: s ? s.name : '—' });
    }));
  }

  // ══════════════════════════════════════════════════════════════════════
  // Daily
  // ══════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/attendance
  function listAttendance(schoolId, opts) {
    opts = opts || {};
    var termId = termOf(opts);
    var rows = db().attendance.filter(function (a) {
      return a.school_id === schoolId && a.term_id === termId;
    });
    if (opts.date) rows = rows.filter(function (a) { return a.date === opts.date; });
    if (opts.from) rows = rows.filter(function (a) { return a.date >= opts.from; });
    if (opts.to) rows = rows.filter(function (a) { return a.date <= opts.to; });
    if (opts.classId) rows = rows.filter(function (a) { return a.class_id === opts.classId; });
    if (opts.studentId) rows = rows.filter(function (a) { return a.student_id === opts.studentId; });
    return resolve(rows);
  }

  /**
   * Registers are expected in before 09:00. The reference clock is fixed
   * rather than read from Date.now(), so "overdue" means the same thing on
   * every load and the tests can assert on it.
   */
  var REGISTER_DUE_BY = '09:00';
  var AS_OF = '09:40';

  // GET /api/school/{school_id}/attendance/register-status
  function getRegisterStatus(schoolId, opts) {
    opts = opts || {};
    var date = opts.date || db().today;
    var asOf = opts.asOf || AS_OF;
    var overdue = asOf > REGISTER_DUE_BY;
    var records = db().attendance.filter(function (a) {
      return a.school_id === schoolId && a.date === date;
    });
    var teachers = db().teachers, students = db().students;
    return resolve(db().classes.filter(function (c) { return c.school_id === schoolId; }).map(function (c) {
      var mine = records.filter(function (a) { return a.class_id === c.id; });
      var roll = students.filter(function (s) { return s.class_id === c.id && s.status === 'active'; }).length;
      if (!mine.length) {
        var ct = byId(teachers, c.class_teacher_id);
        return {
          class_id: c.id, class_name: c.full_name, roll: roll, marked: false,
          marked_by: null, marked_by_name: null, marked_at: null,
          present: 0, absent: 0, late: 0, excused: 0,
          overdue: overdue, due_by: REGISTER_DUE_BY, as_of: asOf,
          class_teacher_name: ct ? ct.name : null
        };
      }
      var t = byId(teachers, mine[0].marked_by);
      var count = function (st) { return mine.filter(function (a) { return a.status === st; }).length; };
      return {
        class_id: c.id, class_name: c.full_name, roll: roll, marked: true,
        marked_by: mine[0].marked_by, marked_by_name: t ? t.name : '—',
        marked_at: mine[0].marked_at,
        present: count('present'), absent: count('absent'),
        late: count('late'), excused: count('excused'),
        overdue: false, due_by: REGISTER_DUE_BY, as_of: asOf,
        class_teacher_name: t ? t.name : null
      };
    }));
  }

  // POST /api/school/{school_id}/classes/{class_id}/attendance
  function markAttendance(schoolId, classId, payload) {
    if (!payload || !payload.date) return reject(422, 'A date is required to mark a register.');
    if (!payload.records || !payload.records.length) return reject(422, 'No attendance records supplied.');
    var d = db();
    var existing = d.attendance.filter(function (a) {
      return a.class_id === classId && a.date === payload.date;
    });
    if (existing.length) {
      return reject(409, 'The register for this class was already marked on ' + payload.date + '.');
    }
    var seq = d.attendance.length;
    payload.records.forEach(function (r) {
      d.attendance.push({
        id: 'att-' + String(++seq).padStart(6, '0'),
        school_id: schoolId, term_id: d.current_term_id,
        student_id: r.student_id, class_id: classId,
        date: payload.date, status: r.status, note: r.note || null,
        marked_by: payload.markedBy || null,
        marked_at: payload.date + 'T08:20:00+03:00'
      });
    });
    persist();
    return resolve({ class_id: classId, date: payload.date, marked: payload.records.length });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Academics
  // ══════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/exams
  function listExams(schoolId, opts) {
    opts = opts || {};
    var termId = termOf(opts);
    return resolve(db().exams.filter(function (e) {
      return e.school_id === schoolId && e.term_id === termId;
    }));
  }

  // GET /api/school/{school_id}/exams/{exam_id}/results
  function listExamResults(schoolId, examId, opts) {
    opts = opts || {};
    var rows = db().exam_results.filter(function (r) {
      return r.school_id === schoolId && r.exam_id === examId;
    });
    if (opts.classId) rows = rows.filter(function (r) { return r.class_id === opts.classId; });
    if (opts.subjectId) rows = rows.filter(function (r) { return r.subject_id === opts.subjectId; });
    if (opts.verified != null) rows = rows.filter(function (r) { return r.verified === opts.verified; });
    return resolve(paginate(rows, opts.page, opts.pageSize || 2000));
  }

  // GET /api/school/{school_id}/report-cards
  function listReportCards(schoolId, opts) {
    opts = opts || {};
    var termId = termOf(opts);
    var rows = db().report_cards.filter(function (r) {
      return r.school_id === schoolId && r.term_id === termId &&
             (!opts.status || r.status === opts.status) &&
             (!opts.classId || r.class_id === opts.classId);
    });
    return resolve(rows);
  }

  // POST /api/school/{school_id}/report-cards/publish
  function publishReportCards(schoolId, payload) {
    if (!payload || !payload.classId) return reject(422, 'Select a class to publish.');
    if (!payload.examId) return reject(422, 'Select an exam to publish results for.');
    var rows = db().report_cards.filter(function (r) {
      return r.school_id === schoolId && r.class_id === payload.classId && r.status === 'draft';
    });
    rows.forEach(function (r) { r.status = 'published'; r.published_on = db().today; });
    persist();
    return resolve({ class_id: payload.classId, exam_id: payload.examId, published: rows.length });
  }

  // GET /api/school/{school_id}/grading-scales
  function listGradingScales(schoolId) {
    return resolve([db().grading_scale].filter(function (g) { return g.school_id === schoolId; }));
  }

  // ══════════════════════════════════════════════════════════════════════
  // Communication
  // ══════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/announcements
  function listAnnouncements(schoolId, opts) {
    opts = opts || {};
    var rows = db().announcements.filter(function (a) {
      return a.school_id === schoolId && (!opts.audience || a.audience === opts.audience || a.audience === 'all');
    }).slice().sort(function (a, b) { return a.posted_at < b.posted_at ? 1 : -1; });
    return resolve(opts.limit ? rows.slice(0, opts.limit) : rows);
  }

  // GET /api/school/{school_id}/events
  function listEvents(schoolId, opts) {
    opts = opts || {};
    var rows = db().events.filter(function (e) { return e.school_id === schoolId; });
    if (opts.from) rows = rows.filter(function (e) { return e.ends_on >= opts.from; });
    return resolve(opts.limit ? rows.slice(0, opts.limit) : rows);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Dashboard
  // ══════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/dashboard/summary
  function getDashboardSummary(schoolId, opts) {
    opts = opts || {};
    var d = db();
    var termId = termOf(opts);
    var today = opts.date || d.today;
    var yesterday = previousSchoolDay(today);

    var term = byId(d.terms, termId);
    var prior = d.terms.filter(function (t) { return t.index === (term ? term.index - 1 : 0) && t.year === term.year; })[0];

    var students = d.students.filter(function (s) { return s.school_id === schoolId && s.status === 'active'; });
    var invoices = d.invoices.filter(function (i) { return i.school_id === schoolId && i.term_id === termId; });
    var invoiced = invoices.reduce(function (n, i) { return n + i.amount_due; }, 0);
    var collected = invoices.reduce(function (n, i) { return n + i.amount_paid; }, 0);
    var outstanding = invoiced - collected;
    var rate = invoiced ? collected / invoiced * 100 : 0;

    var priorRate = prior && prior.amount_invoiced ? prior.amount_collected / prior.amount_invoiced * 100 : null;

    var att = d.attendance.filter(function (a) { return a.school_id === schoolId; });
    var todayRecords = att.filter(function (a) { return a.date === today; });
    var yesterdayRecords = att.filter(function (a) { return a.date === yesterday; });
    var todayRate = attendanceRate(todayRecords);
    var yesterdayRate = attendanceRate(yesterdayRecords);

    return resolve({
      school_id: schoolId,
      school_name: d.school.name,
      term_id: termId,
      term_name: term ? term.name + ' ' + term.year : null,
      date: today,
      compared_to: { term_id: prior ? prior.id : null, date: yesterday },
      enrolment: {
        value: students.length,
        previous: prior ? prior.enrolment : null,
        delta: prior && prior.enrolment != null ? students.length - prior.enrolment : null
      },
      collection_rate: {
        value: rate,
        previous: priorRate,
        delta: priorRate != null ? rate - priorRate : null,
        invoiced: invoiced,
        collected: collected
      },
      outstanding: {
        value: outstanding,
        previous: prior ? prior.outstanding : null,
        delta: prior && prior.outstanding != null ? outstanding - prior.outstanding : null,
        pupils_owing: invoices.filter(function (i) { return i.balance > 0; }).length
      },
      attendance_today: {
        value: todayRate,
        previous: yesterdayRate,
        delta: (todayRate != null && yesterdayRate != null) ? todayRate - yesterdayRate : null,
        marked_classes: [].concat.apply([], todayRecords.map(function (a) { return [a.class_id]; }))
          .filter(function (v, i, arr) { return arr.indexOf(v) === i; }).length,
        total_classes: d.classes.filter(function (c) { return c.school_id === schoolId; }).length,
        records: todayRecords.length
      }
    });
  }

  // GET /api/school/{school_id}/dashboard/needs-attention
  function getNeedsAttention(schoolId, opts) {
    opts = opts || {};
    var d = db();
    var termId = termOf(opts);

    var unverified = d.exam_results.filter(function (r) {
      return r.school_id === schoolId && r.term_id === termId && !r.verified;
    });
    var unverifiedClasses = unverified.map(function (r) { return r.class_id; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; });

    var drafts = d.report_cards.filter(function (r) {
      return r.school_id === schoolId && r.term_id === termId && r.status === 'draft';
    });
    var pendingWaivers = d.waivers.filter(function (w) {
      return w.school_id === schoolId && w.term_id === termId && w.status === 'pending';
    });
    var chased = d.invoices.filter(function (i) {
      return i.school_id === schoolId && i.term_id === termId && i.balance > 0 && i.reminders_sent >= 3;
    });

    return resolve([
      { key: 'unverified_results', label: 'Exam results entered but not verified',
        count: unverified.length,
        detail: unverifiedClasses.length + (unverifiedClasses.length === 1 ? ' class' : ' classes') + ' awaiting a head of department',
        severity: 'high', href: '#', step: '4' },
      { key: 'draft_report_cards', label: 'Report cards still in draft',
        count: drafts.length,
        detail: 'Invisible to guardians until the head signs them off',
        severity: 'high', href: '#', step: '4' },
      { key: 'pending_waivers', label: 'Fee waivers awaiting approval',
        count: pendingWaivers.length,
        detail: 'KES ' + pendingWaivers.reduce(function (n, w) { return n + w.amount; }, 0).toLocaleString('en-KE') + ' requested',
        severity: 'medium', href: 'waivers.html', step: null },
      { key: 'chased_unpaid', label: 'Chased three times and still unpaid',
        count: chased.length,
        detail: 'KES ' + chased.reduce(function (n, i) { return n + i.balance; }, 0).toLocaleString('en-KE') + ' outstanding',
        severity: 'high', href: 'defaulters.html', step: null }
    ]);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Students — search, sort, bulk operations, CSV
  // ══════════════════════════════════════════════════════════════════════

  /** The one place that decides what a student row looks like in a list. */
  function decorateStudent(s, d) {
    var cls = byId(d.classes, s.class_id);
    var inv = d.invoices.filter(function (i) {
      return i.student_id === s.id && i.term_id === d.current_term_id;
    });
    var att = d.attendance.filter(function (a) { return a.student_id === s.id; });
    var here = att.filter(function (a) { return a.status === 'present' || a.status === 'late'; }).length;
    var primary = d.guardians.filter(function (g) { return g.student_id === s.id && g.is_primary; })[0];
    return {
      id: s.id, admission_no: s.admission_no, name: s.name, gender: s.gender,
      class_id: s.class_id, class_name: cls ? cls.full_name : '—',
      class_sort: cls ? cls.sort_order : 99,
      status: s.status,
      guardian_name: primary ? primary.name : '—',
      guardian_phone: primary ? primary.phone : '—',
      scholarship_amount: s.scholarship_amount,
      balance: inv.reduce(function (n, i) { return n + i.balance; }, 0),
      invoiced: inv.reduce(function (n, i) { return n + i.amount_due; }, 0),
      attendance_pct: att.length ? here / att.length * 100 : null,
      admitted_on: s.admitted_on
    };
  }

  var STUDENT_SORTS = {
    name: function (a, b) { return a.name.localeCompare(b.name); },
    admission_no: function (a, b) { return a.admission_no.localeCompare(b.admission_no); },
    class: function (a, b) { return a.class_sort - b.class_sort || a.name.localeCompare(b.name); },
    guardian: function (a, b) { return a.guardian_name.localeCompare(b.guardian_name); },
    balance: function (a, b) { return a.balance - b.balance; },
    attendance: function (a, b) { return (a.attendance_pct || 0) - (b.attendance_pct || 0); },
    status: function (a, b) { return a.status.localeCompare(b.status); }
  };

  // GET /api/school/{school_id}/students?search=&class_id=&status=&sort=&page=
  function searchStudents(schoolId, opts) {
    opts = opts || {};
    var d = db();
    var rows = d.students
      .filter(function (s) { return s.school_id === schoolId; })
      .map(function (s) { return decorateStudent(s, d); });

    if (opts.classId) rows = rows.filter(function (s) { return s.class_id === opts.classId; });
    if (opts.status) rows = rows.filter(function (s) { return s.status === opts.status; });
    if (opts.search) {
      var q = String(opts.search).trim().toLowerCase();
      rows = rows.filter(function (s) {
        return s.name.toLowerCase().indexOf(q) !== -1 ||
               s.admission_no.toLowerCase().indexOf(q) !== -1;
      });
    }
    var cmp = STUDENT_SORTS[opts.sort || 'name'] || STUDENT_SORTS.name;
    rows.sort(cmp);
    if (opts.dir === 'desc') rows.reverse();

    return resolve(paginate(rows, opts.page, opts.pageSize || 25));
  }

  // POST /api/school/{school_id}/students/promote
  function promoteStudents(schoolId, payload) {
    var ids = (payload && payload.studentIds) || [];
    if (!ids.length) return reject(422, 'Select at least one pupil to promote.');
    var d = db();
    var ordered = d.classes.slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
    var moved = [], graduated = [], skipped = [];
    ids.forEach(function (id) {
      var s = byId(d.students, id);
      if (!s) { skipped.push({ student_id: id, reason: 'no such pupil' }); return; }
      if (s.status !== 'active') { skipped.push({ student_id: id, student_name: s.name, reason: 'not active' }); return; }
      var at = ordered.map(function (c) { return c.id; }).indexOf(s.class_id);
      var next = ordered[at + 1];
      if (!next) {
        s.status = 'graduated';
        graduated.push({ student_id: s.id, student_name: s.name });
        return;
      }
      var from = byId(d.classes, s.class_id);
      s.class_id = next.id;
      moved.push({ student_id: s.id, student_name: s.name, from: from ? from.full_name : '—', to: next.full_name });
    });
    persist();
    return resolve({ promoted: moved.length, graduated: graduated.length, skipped: skipped.length,
                     moved: moved, graduated_students: graduated, skipped_students: skipped });
  }

  // POST /api/school/{school_id}/students/{student_id}/transfer
  function transferStudent(schoolId, studentId, payload) {
    if (!payload || !String(payload.destination || '').trim()) {
      return reject(422, 'Name the school the pupil is transferring to.');
    }
    var d = db();
    var s = byId(d.students, studentId);
    if (!s) return reject(404, 'No student ' + studentId);
    s.status = 'transferred';
    s.transferred_on = payload.date || d.today;
    s.transferred_to = payload.destination.trim();
    persist();
    return resolve(s);
  }

  // PATCH /api/school/{school_id}/students/{student_id}
  function updateStudent(schoolId, studentId, payload) {
    var d = db();
    var s = byId(d.students, studentId);
    if (!s) return reject(404, 'No student ' + studentId);
    if (payload.name != null && !String(payload.name).trim()) return reject(422, 'A pupil needs a name.');
    ['name', 'gender', 'class_id', 'date_of_birth', 'status'].forEach(function (k) {
      if (payload[k] != null) s[k] = payload[k];
    });
    if (payload.scholarship_amount != null) s.scholarship_amount = Number(payload.scholarship_amount) || 0;
    persist();
    return resolve(s);
  }

  /** The exact column order the FastAPI importer expects. */
  var CSV_COLUMNS = ['full_name', 'class_name', 'date_of_birth', 'gender', 'guardian_name', 'guardian_phone'];

  // POST /api/school/{school_id}/students/import
  /**
   * Validates row by row. A bad row is reported with its line number and
   * skipped; the rest still import. The whole file is never thrown away for
   * the sake of one typo.
   */
  function importStudentsCSV(schoolId, csvText, opts) {
    opts = opts || {};
    var d = db();
    var parsed = parseCSV(csvText || '');
    if (!parsed.rows.length) {
      return reject(422, 'That file has a header but no rows in it.');
    }
    var missingCols = CSV_COLUMNS.filter(function (c) { return parsed.header.indexOf(c) === -1; });
    if (missingCols.length) {
      return reject(422, 'The file is missing these columns: ' + missingCols.join(', ') +
        '. Expected exactly: ' + CSV_COLUMNS.join(', ') + '.');
    }

    var classByName = {};
    d.classes.forEach(function (c) { classByName[c.full_name.toLowerCase()] = c; });

    var accepted = [], errors = [];
    parsed.rows.forEach(function (row) {
      var problems = [];
      var name = (row.full_name || '').trim();
      var className = (row.class_name || '').trim();
      var dob = (row.date_of_birth || '').trim();
      var gender = (row.gender || '').trim().toUpperCase();
      var gname = (row.guardian_name || '').trim();
      var gphone = (row.guardian_phone || '').trim();

      if (name.length < 2) problems.push('full_name is missing or too short');
      if (!className) problems.push('class_name is missing');
      else if (!classByName[className.toLowerCase()]) problems.push('class_name "' + className + '" is not a class at this school');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) problems.push('date_of_birth must look like 2015-04-09');
      if (['M', 'F'].indexOf(gender) === -1) problems.push('gender must be M or F');
      if (gname.length < 2) problems.push('guardian_name is missing');
      if (!/^\d{9,13}$/.test(gphone.replace(/[\s+()-]/g, ''))) problems.push('guardian_phone must be digits, 9 to 13 of them');

      if (problems.length) {
        errors.push({ line: row.__line, full_name: name || '(blank)', problems: problems });
      } else {
        accepted.push({ line: row.__line, name: name, class_id: classByName[className.toLowerCase()].id,
                        class_name: className, date_of_birth: dob, gender: gender,
                        guardian_name: gname, guardian_phone: gphone });
      }
    });

    if (opts.dryRun) {
      return resolve({ dry_run: true, total: parsed.rows.length, would_import: accepted.length,
                       imported: 0, accepted: accepted, errors: errors, error_count: errors.length });
    }

    var seq = d.students.length + 2301;
    var created = accepted.map(function (r) {
      var student = {
        id: 'stu-' + seq, school_id: schoolId, admission_no: 'ADM/' + seq,
        name: r.name, gender: r.gender, class_id: r.class_id,
        date_of_birth: r.date_of_birth, scholarship_amount: 0,
        boarding: false, transport_route_id: null, status: 'active', admitted_on: d.today,
        guardian_name: r.guardian_name, guardian_phone: r.guardian_phone, guardian_relation: 'Guardian'
      };
      seq++;
      d.students.push(student);
      d.guardians.push({
        id: 'gdn-' + String(d.guardians.length + 1).padStart(5, '0'),
        school_id: schoolId, student_id: student.id, name: r.guardian_name,
        relationship: 'Guardian', phone: r.guardian_phone, email: null,
        is_primary: true, is_emergency: true, occupation: null
      });
      return student;
    });
    persist();
    return resolve({ dry_run: false, total: parsed.rows.length, imported: created.length,
                     would_import: created.length, students: created,
                     errors: errors, error_count: errors.length });
  }

  /** Small CSV reader: quoted fields, embedded commas, CRLF. */
  function parseCSV(text) {
    var rows = [], field = '', row = [], inQuotes = false;
    var src = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (var i = 0; i < src.length; i++) {
      var c = src[i];
      if (inQuotes) {
        if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ''; }); });
    if (!rows.length) return { header: [], rows: [] };

    var header = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var out = rows.slice(1).map(function (r, idx) {
      var o = { __line: idx + 2 };          // line 1 is the header
      header.forEach(function (h, i) { o[h] = r[i] != null ? r[i] : ''; });
      return o;
    });
    return { header: header, rows: out };
  }

  // GET /api/school/{school_id}/students/export
  function exportStudentsCSV(schoolId, opts) {
    opts = opts || {};
    var d = db();
    var rows = d.students.filter(function (s) { return s.school_id === schoolId; })
      .filter(function (s) { return !opts.classId || s.class_id === opts.classId; })
      .filter(function (s) { return !opts.status || s.status === opts.status; })
      .map(function (s) { return decorateStudent(s, d); });
    var head = ['admission_no', 'full_name', 'class_name', 'gender', 'guardian_name', 'guardian_phone', 'balance', 'status'];
    var lines = [head.join(',')].concat(rows.map(function (r) {
      return [r.admission_no, r.name, r.class_name, r.gender, r.guardian_name, r.guardian_phone, r.balance, r.status]
        .map(csvCell).join(',');
    }));
    return resolve({ filename: 'riverside-students.csv', rows: rows.length, csv: lines.join('\n') });
  }
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // POST /api/school/{school_id}/messages
  function sendMessage(schoolId, payload) {
    var ids = (payload && payload.studentIds) || [];
    if (!ids.length) return reject(422, 'Select at least one pupil to message.');
    if (!payload.body || !payload.body.trim()) return reject(422, 'Write the message before sending it.');
    if (payload.body.length > 480) return reject(422, 'An SMS caps at 480 characters; that one is ' + payload.body.length + '.');
    var d = db();
    var recipients = ids.map(function (id) {
      var g = d.guardians.filter(function (x) { return x.student_id === id && x.is_primary; })[0];
      return g ? g.phone : null;
    }).filter(Boolean);
    return resolve({ sent: recipients.length, channel: payload.channel || 'sms', recipients: recipients });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Guardians
  // ══════════════════════════════════════════════════════════════════════

  /** Keeps the denormalised copy on the student in step with the primary. */
  function mirrorPrimary(studentId) {
    var d = db();
    var s = byId(d.students, studentId);
    var p = d.guardians.filter(function (g) { return g.student_id === studentId && g.is_primary; })[0];
    if (s && p) { s.guardian_name = p.name; s.guardian_phone = p.phone; s.guardian_relation = p.relationship; }
  }

  // GET /api/school/{school_id}/students/{student_id}/guardians
  function listGuardians(schoolId, studentId) {
    var rows = db().guardians.filter(function (g) {
      return g.school_id === schoolId && g.student_id === studentId;
    });
    rows.sort(function (a, b) { return (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0); });
    return resolve(rows);
  }

  function validateGuardian(payload) {
    if (!payload || !String(payload.name || '').trim()) return 'A guardian needs a name.';
    if (String(payload.name).trim().length < 2) return 'That name is too short.';
    if (!String(payload.relationship || '').trim()) return 'Say how this guardian is related to the pupil.';
    var digits = String(payload.phone || '').replace(/[\s+()-]/g, '');
    if (!/^\d{9,13}$/.test(digits)) return 'Digits only, please — for example 0712 345 678.';
    if (payload.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(payload.email)) return 'That does not look like an email address.';
    return null;
  }

  // POST /api/school/{school_id}/students/{student_id}/guardians
  function addGuardian(schoolId, studentId, payload) {
    var problem = validateGuardian(payload);
    if (problem) return reject(422, problem);
    var d = db();
    if (!byId(d.students, studentId)) return reject(404, 'No student ' + studentId);
    var existing = d.guardians.filter(function (g) { return g.student_id === studentId; });
    var wantsPrimary = !!payload.is_primary || existing.length === 0;
    if (wantsPrimary) existing.forEach(function (g) { g.is_primary = false; });
    var guardian = {
      id: 'gdn-' + String(d.guardians.length + 1).padStart(5, '0'),
      school_id: schoolId, student_id: studentId,
      name: String(payload.name).trim(),
      relationship: String(payload.relationship).trim(),
      phone: String(payload.phone).trim(),
      email: payload.email || null,
      is_primary: wantsPrimary,
      is_emergency: !!payload.is_emergency,
      occupation: payload.occupation || null
    };
    d.guardians.push(guardian);
    mirrorPrimary(studentId);
    persist();
    return resolve(guardian);
  }

  // PATCH /api/school/{school_id}/guardians/{guardian_id}
  function updateGuardian(schoolId, guardianId, payload) {
    var problem = validateGuardian(payload);
    if (problem) return reject(422, problem);
    var d = db();
    var g = byId(d.guardians, guardianId);
    if (!g) return reject(404, 'No guardian ' + guardianId);
    g.name = String(payload.name).trim();
    g.relationship = String(payload.relationship).trim();
    g.phone = String(payload.phone).trim();
    g.email = payload.email || null;
    g.is_emergency = !!payload.is_emergency;
    if (payload.is_primary) {
      db().guardians.forEach(function (x) { if (x.student_id === g.student_id) x.is_primary = false; });
      g.is_primary = true;
    }
    mirrorPrimary(g.student_id);
    persist();
    return resolve(g);
  }

  // PUT /api/school/{school_id}/students/{student_id}/guardians/{guardian_id}/primary
  /** Exactly one primary per pupil: setting a new one clears the old. */
  function setPrimaryGuardian(schoolId, studentId, guardianId) {
    var d = db();
    var mine = d.guardians.filter(function (g) { return g.student_id === studentId; });
    if (!mine.length) return reject(404, 'That pupil has no guardians on file.');
    if (!mine.some(function (g) { return g.id === guardianId; })) {
      return reject(404, 'Guardian ' + guardianId + ' is not on that pupil’s record.');
    }
    mine.forEach(function (g) { g.is_primary = g.id === guardianId; });
    mirrorPrimary(studentId);
    persist();
    return resolve(mine);
  }

  // DELETE /api/school/{school_id}/guardians/{guardian_id}
  function removeGuardian(schoolId, guardianId) {
    var d = db();
    var g = byId(d.guardians, guardianId);
    if (!g) return reject(404, 'No guardian ' + guardianId);
    var siblings = d.guardians.filter(function (x) { return x.student_id === g.student_id; });
    if (siblings.length === 1) {
      return reject(422, 'Every pupil keeps at least one guardian on file. Add a replacement before removing this one.');
    }
    var wasPrimary = g.is_primary;
    d.guardians = d.guardians.filter(function (x) { return x.id !== guardianId; });
    if (wasPrimary) {
      var next = d.guardians.filter(function (x) { return x.student_id === g.student_id; })[0];
      if (next) next.is_primary = true;
    }
    mirrorPrimary(g.student_id);
    persist();
    return resolve({ removed: guardianId, student_id: g.student_id });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Discipline
  // ══════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/students/{student_id}/discipline
  function listDiscipline(schoolId, opts) {
    opts = opts || {};
    var rows = db().discipline.filter(function (r) {
      return r.school_id === schoolId &&
             (!opts.studentId || r.student_id === opts.studentId) &&
             (!opts.classId || r.class_id === opts.classId);
    });
    rows.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return resolve(rows);
  }

  // POST /api/school/{school_id}/students/{student_id}/discipline
  function addDiscipline(schoolId, studentId, payload) {
    if (!payload || !String(payload.category || '').trim()) return reject(422, 'Choose a category for the incident.');
    if (!String(payload.note || '').trim()) return reject(422, 'Describe what happened.');
    if (!payload.date) return reject(422, 'An incident needs a date.');
    var d = db();
    var s = byId(d.students, studentId);
    if (!s) return reject(404, 'No student ' + studentId);
    var teacher = byId(d.teachers, payload.recordedBy) || d.teachers[0];
    var row = {
      id: 'dis-' + String(d.discipline.length + 1).padStart(4, '0'),
      school_id: schoolId, term_id: d.current_term_id,
      student_id: studentId, class_id: s.class_id,
      date: payload.date, category: payload.category,
      note: String(payload.note).trim(),
      action_taken: payload.action || 'Verbal warning',
      severity: payload.severity || 'low',
      recorded_by: teacher ? teacher.id : null,
      recorded_by_name: teacher ? teacher.name : '—'
    };
    d.discipline.push(row);
    persist();
    return resolve(row);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Fee structures
  // ══════════════════════════════════════════════════════════════════════

  function structureTotals(items) {
    return {
      total_mandatory: items.filter(function (i) { return i.mandatory; }).reduce(function (n, i) { return n + Number(i.amount || 0); }, 0),
      optional_total: items.filter(function (i) { return !i.mandatory; }).reduce(function (n, i) { return n + Number(i.amount || 0); }, 0)
    };
  }
  function validateStructure(payload) {
    if (!payload) return 'Nothing to save.';
    if (!payload.classId) return 'Choose the class this structure belongs to.';
    if (!payload.termId) return 'Choose the term this structure belongs to.';
    if (!payload.items || !payload.items.length) return 'A fee structure needs at least one line.';
    for (var i = 0; i < payload.items.length; i++) {
      var it = payload.items[i];
      if (!String(it.name || '').trim()) return 'Line ' + (i + 1) + ' has no name.';
      if (!(Number(it.amount) >= 0)) return 'Line ' + (i + 1) + ' ("' + it.name + '") needs an amount of zero or more.';
    }
    return null;
  }

  // POST /api/school/{school_id}/fee-structures
  function createFeeStructure(schoolId, payload) {
    var problem = validateStructure(payload);
    if (problem) return reject(422, problem);
    var d = db();
    var dupe = d.fee_structures.filter(function (f) {
      return f.class_id === payload.classId && f.term_id === payload.termId;
    })[0];
    if (dupe) {
      var cls = byId(d.classes, payload.classId);
      return reject(409, (cls ? cls.full_name : payload.classId) + ' already has a fee structure for that term. Edit that one instead.');
    }
    var items = payload.items.map(function (i) {
      return { name: String(i.name).trim(), amount: Number(i.amount), mandatory: i.mandatory !== false };
    });
    var totals = structureTotals(items);
    var row = {
      id: 'fee-' + payload.classId + '-' + payload.termId,
      school_id: schoolId, class_id: payload.classId, term_id: payload.termId,
      items: items, total_mandatory: totals.total_mandatory, optional_total: totals.optional_total
    };
    d.fee_structures.push(row);
    persist();
    return resolve(row);
  }

  // PUT /api/school/{school_id}/fee-structures/{structure_id}
  function updateFeeStructure(schoolId, structureId, payload) {
    var d = db();
    var row = byId(d.fee_structures, structureId);
    if (!row) return reject(404, 'No fee structure ' + structureId);
    var problem = validateStructure({ classId: row.class_id, termId: row.term_id, items: payload && payload.items });
    if (problem) return reject(422, problem);
    row.items = payload.items.map(function (i) {
      return { name: String(i.name).trim(), amount: Number(i.amount), mandatory: i.mandatory !== false };
    });
    var totals = structureTotals(row.items);
    row.total_mandatory = totals.total_mandatory;
    row.optional_total = totals.optional_total;
    persist();
    return resolve(row);
  }

  // DELETE /api/school/{school_id}/fee-structures/{structure_id}
  /** Blocked once invoices exist against it — deleting would orphan them. */
  function deleteFeeStructure(schoolId, structureId) {
    var d = db();
    var row = byId(d.fee_structures, structureId);
    if (!row) return reject(404, 'No fee structure ' + structureId);
    var against = d.invoices.filter(function (i) {
      return i.class_id === row.class_id && i.term_id === row.term_id;
    });
    if (against.length) {
      var cls = byId(d.classes, row.class_id);
      return reject(409, 'Cannot delete this structure: ' + against.length + ' invoice' +
        (against.length === 1 ? '' : 's') + ' for ' + (cls ? cls.full_name : row.class_id) +
        ' were raised from it. Void those invoices first, or edit the structure instead.');
    }
    d.fee_structures = d.fee_structures.filter(function (f) { return f.id !== structureId; });
    persist();
    return resolve({ deleted: structureId });
  }

  // POST /api/school/{school_id}/fee-structures/clone
  function cloneFeeStructure(schoolId, payload) {
    if (!payload || !payload.sourceId) return reject(422, 'Choose a structure to clone from.');
    if (!payload.classId || !payload.termId) return reject(422, 'Choose the class and term to clone into.');
    var d = db();
    var src = byId(d.fee_structures, payload.sourceId);
    if (!src) return reject(404, 'No fee structure ' + payload.sourceId);
    return createFeeStructure(schoolId, {
      classId: payload.classId, termId: payload.termId,
      items: src.items.map(function (i) { return { name: i.name, amount: i.amount, mandatory: i.mandatory }; })
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Invoices
  // ══════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/fee-invoices?class_id=&term_id=&status=
  function listInvoiceRows(schoolId, opts) {
    opts = opts || {};
    var d = db();
    var rows = d.invoices.filter(function (i) { return i.school_id === schoolId; });
    if (opts.termId) rows = rows.filter(function (i) { return i.term_id === opts.termId; });
    if (opts.classId) rows = rows.filter(function (i) { return i.class_id === opts.classId; });
    if (opts.status) rows = rows.filter(function (i) { return i.status === opts.status; });
    if (opts.studentId) rows = rows.filter(function (i) { return i.student_id === opts.studentId; });
    if (opts.search) {
      var q = String(opts.search).toLowerCase();
      rows = rows.filter(function (i) {
        var s = byId(d.students, i.student_id);
        return s && (s.name.toLowerCase().indexOf(q) !== -1 || s.admission_no.toLowerCase().indexOf(q) !== -1);
      });
    }
    var decorated = rows.map(function (i) {
      var s = byId(d.students, i.student_id), c = byId(d.classes, i.class_id), t = byId(d.terms, i.term_id);
      return Object.assign({}, i, {
        student_name: s ? s.name : '—', admission_no: s ? s.admission_no : '—',
        class_name: c ? c.full_name : '—', term_name: t ? t.name + ' ' + t.year : '—',
        class_sort: c ? c.sort_order : 99
      });
    });
    decorated.sort(function (a, b) { return b.balance - a.balance || a.student_name.localeCompare(b.student_name); });
    return resolve(paginate(decorated, opts.page, opts.pageSize || 25));
  }

  // POST /api/school/{school_id}/fee-invoices/bulk-generate?dry_run=true
  /**
   * Pupils who already hold an invoice for that class and term are excluded
   * and reported, never duplicated. Run it twice and the second run creates
   * nothing.
   */
  function bulkGenerateInvoices(schoolId, payload) {
    if (!payload || !payload.classId) return reject(422, 'Choose a class to invoice.');
    if (!payload.termId) return reject(422, 'Choose the term these invoices belong to.');
    if (!payload.dueDate) return reject(422, 'Set a due date so reminders know when to start.');

    var d = db();
    var structure = d.fee_structures.filter(function (f) {
      return f.class_id === payload.classId && f.term_id === payload.termId;
    })[0];
    if (payload.structureId) structure = byId(d.fee_structures, payload.structureId) || structure;
    if (!structure) {
      var cls0 = byId(d.classes, payload.classId);
      return reject(422, 'There is no fee structure for ' + (cls0 ? cls0.full_name : payload.classId) +
        ' this term. Build one on the fee structures page first.');
    }

    var roll = d.students.filter(function (s) {
      return s.school_id === schoolId && s.class_id === payload.classId && s.status === 'active';
    });
    var already = {};
    d.invoices.forEach(function (i) {
      if (i.class_id === payload.classId && i.term_id === payload.termId) already[i.student_id] = i.id;
    });

    var toCreate = roll.filter(function (s) { return !already[s.id]; });
    var skipped = roll.filter(function (s) { return already[s.id]; })
      .map(function (s) { return { student_id: s.id, student_name: s.name, admission_no: s.admission_no, invoice_id: already[s.id] }; });

    var approvedWaiver = {};
    d.waivers.forEach(function (w) {
      if (w.status === 'approved' && w.term_id === payload.termId) approvedWaiver[w.student_id] = w.amount;
    });
    function dueFor(s) {
      var extra = s.transport_route_id
        ? (structure.items.filter(function (i) { return /transport/i.test(i.name); })[0] || { amount: 0 }).amount
        : 0;
      return structure.total_mandatory + extra - (approvedWaiver[s.id] || 0);
    }

    if (payload.dryRun) {
      return resolve({
        dry_run: true, class_id: payload.classId, term_id: payload.termId,
        structure_id: structure.id,
        would_create: toCreate.length, skipped: skipped.length, skipped_students: skipped,
        total_value: toCreate.reduce(function (n, s) { return n + dueFor(s); }, 0),
        roll: roll.length
      });
    }

    var created = toCreate.map(function (s) {
      var due = dueFor(s);
      var inv = {
        id: 'inv-' + s.id + '-' + payload.termId,
        school_id: schoolId, term_id: payload.termId,
        student_id: s.id, class_id: payload.classId,
        items: structure.items.filter(function (i) { return i.mandatory || s.transport_route_id; }),
        amount_due: due, amount_paid: 0, balance: due,
        due_date: payload.dueDate, status: 'unpaid', reminders_sent: 0,
        mpesa_code: null, issued_on: d.today
      };
      d.invoices.push(inv);
      return inv;
    });
    persist();
    return resolve({
      dry_run: false, class_id: payload.classId, term_id: payload.termId,
      structure_id: structure.id,
      created: created.length, would_create: created.length,
      skipped: skipped.length, skipped_students: skipped,
      total_value: created.reduce(function (n, i) { return n + i.amount_due; }, 0),
      roll: roll.length, invoices: created
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Payments ledger
  // ══════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/payments?method=&from=&to=
  function listPaymentLedger(schoolId, opts) {
    opts = opts || {};
    var d = db();
    var rows = d.payments.filter(function (p) { return p.school_id === schoolId; });
    if (opts.termId) rows = rows.filter(function (p) { return p.term_id === opts.termId; });
    if (opts.method) rows = rows.filter(function (p) { return p.method === opts.method; });
    if (opts.matched) rows = rows.filter(function (p) { return (p.matched || 'auto') === opts.matched; });
    if (opts.from) rows = rows.filter(function (p) { return p.paid_at.slice(0, 10) >= opts.from; });
    if (opts.to) rows = rows.filter(function (p) { return p.paid_at.slice(0, 10) <= opts.to; });
    if (opts.search) {
      var q = String(opts.search).toLowerCase();
      rows = rows.filter(function (p) {
        var s = byId(d.students, p.student_id);
        return (p.mpesa_code || '').toLowerCase().indexOf(q) !== -1 ||
               (p.reference || '').toLowerCase().indexOf(q) !== -1 ||
               (s && s.name.toLowerCase().indexOf(q) !== -1);
      });
    }
    var decorated = rows.map(function (p) {
      var s = byId(d.students, p.student_id), c = byId(d.classes, p.class_id);
      return Object.assign({}, p, {
        matched: p.matched || 'auto',
        student_name: s ? s.name : '—', admission_no: s ? s.admission_no : '—',
        class_name: c ? c.full_name : '—'
      });
    });
    decorated.sort(function (a, b) { return a.paid_at < b.paid_at ? 1 : -1; });
    return resolve(Object.assign(paginate(decorated, opts.page, opts.pageSize || 25), {
      total_value: decorated.reduce(function (n, p) { return n + p.amount; }, 0)
    }));
  }

  // GET /api/school/{school_id}/payments/export
  function exportPaymentsCSV(schoolId, opts) {
    return listPaymentLedger(schoolId, Object.assign({}, opts, { page: 1, pageSize: 100000 })).then(function (page) {
      var head = ['date', 'student', 'admission_no', 'class', 'amount', 'method', 'reference', 'mpesa_code', 'matched'];
      var lines = [head.join(',')].concat(page.items.map(function (p) {
        return [p.paid_at.slice(0, 10), p.student_name, p.admission_no, p.class_name,
                p.amount, p.method, p.reference || '', p.mpesa_code || '', p.matched].map(csvCell).join(',');
      }));
      return { filename: 'riverside-payments.csv', rows: page.items.length, csv: lines.join('\n') };
    });
  }

  // GET /api/school/{school_id}/ledger/journal
  function listJournalLines(schoolId, opts) {
    opts = opts || {};
    var rows = db().journal_lines.filter(function (l) { return l.school_id === schoolId; });
    if (opts.source) rows = rows.filter(function (l) { return l.source === opts.source; });
    var dr = rows.filter(function (l) { return l.side === 'debit'; }).reduce(function (n, l) { return n + l.amount; }, 0);
    var cr = rows.filter(function (l) { return l.side === 'credit'; }).reduce(function (n, l) { return n + l.amount; }, 0);
    return resolve({ lines: rows, debits: dr, credits: cr, balanced: Math.round((dr - cr) * 100) === 0 });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Defaulters and aging
  // ══════════════════════════════════════════════════════════════════════

  var MAX_REMINDERS = 3;
  var BUCKETS = [
    { key: '0-30',  label: '0–30 days',   min: 0,  max: 30 },
    { key: '31-60', label: '31–60 days',  min: 31, max: 60 },
    { key: '61-90', label: '61–90 days',  min: 61, max: 90 },
    { key: '90+',   label: '90+ days',    min: 91, max: Infinity }
  ];

  function daysBetween(fromIso, toIso) {
    var a = new Date(fromIso + 'T00:00:00Z').getTime();
    var b = new Date(toIso + 'T00:00:00Z').getTime();
    return Math.floor((b - a) / 86400000);
  }
  /**
   * Buckets partition the defaulters completely: every invoice with a balance
   * lands in exactly one, and nothing that is owed falls between them. An
   * invoice not yet due sits in the 0–30 bucket.
   */
  function bucketFor(daysPastDue) {
    var n = Math.max(0, daysPastDue);
    for (var i = 0; i < BUCKETS.length; i++) {
      if (n >= BUCKETS[i].min && n <= BUCKETS[i].max) return BUCKETS[i].key;
    }
    return BUCKETS[BUCKETS.length - 1].key;
  }

  // GET /api/school/{school_id}/fee-invoices/defaulters?aging=true
  function listDefaulterRows(schoolId, opts) {
    opts = opts || {};
    var d = db();
    var today = opts.asOf || d.today;
    var termId = opts.termId || d.current_term_id;

    var rows = d.invoices.filter(function (i) {
      return i.school_id === schoolId && i.term_id === termId && i.balance > 0;
    }).map(function (i) {
      var s = byId(d.students, i.student_id), c = byId(d.classes, i.class_id);
      var g = d.guardians.filter(function (x) { return x.student_id === i.student_id && x.is_primary; })[0];
      var past = daysBetween(i.due_date, today);
      return {
        invoice_id: i.id, student_id: i.student_id,
        student_name: s ? s.name : '—', admission_no: s ? s.admission_no : '—',
        class_id: i.class_id, class_name: c ? c.full_name : '—',
        guardian_name: g ? g.name : '—', guardian_phone: g ? g.phone : '—',
        amount_due: i.amount_due, amount_paid: i.amount_paid, balance: i.balance,
        due_date: i.due_date, days_past_due: past, bucket: bucketFor(past),
        reminders_sent: i.reminders_sent,
        exhausted: i.reminders_sent >= MAX_REMINDERS,
        status: i.status
      };
    });

    if (opts.bucket) rows = rows.filter(function (r) { return r.bucket === opts.bucket; });
    if (opts.classId) rows = rows.filter(function (r) { return r.class_id === opts.classId; });
    rows.sort(function (a, b) { return b.balance - a.balance; });

    var summary = BUCKETS.map(function (b) {
      var mine = rows.filter(function (r) { return r.bucket === b.key; });
      return { key: b.key, label: b.label, count: mine.length,
               total: mine.reduce(function (n, r) { return n + r.balance; }, 0) };
    });

    return resolve({
      as_of: today, max_reminders: MAX_REMINDERS,
      items: rows, total: rows.length,
      total_outstanding: rows.reduce(function (n, r) { return n + r.balance; }, 0),
      buckets: summary
    });
  }

  // POST /api/school/{school_id}/fee-invoices/reminders (by invoice)
  /** Never pushes an invoice past three reminders, and never chases a clear one. */
  function sendRemindersFor(schoolId, payload) {
    var ids = (payload && payload.invoiceIds) || [];
    if (!ids.length) return reject(422, 'Select at least one invoice to chase.');
    var d = db();
    var sent = [], skipped = [];
    ids.forEach(function (id) {
      var inv = byId(d.invoices, id);
      if (!inv) { skipped.push({ invoice_id: id, reason: 'no such invoice' }); return; }
      if (inv.balance <= 0) { skipped.push({ invoice_id: id, reason: 'already cleared' }); return; }
      if (inv.reminders_sent >= MAX_REMINDERS) {
        skipped.push({ invoice_id: id, reason: 'already had ' + MAX_REMINDERS + ' reminders' });
        return;
      }
      inv.reminders_sent += 1;
      sent.push(inv.id);
    });
    persist();
    return resolve({ sent: sent.length, skipped: skipped.length, sent_invoices: sent,
                     skipped_invoices: skipped, channel: 'sms', max_reminders: MAX_REMINDERS });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Waivers
  // ══════════════════════════════════════════════════════════════════════

  function decorateWaiver(w, d) {
    var s = byId(d.students, w.student_id), c = byId(d.classes, w.class_id);
    var t = byId(d.teachers, w.requested_by);
    return Object.assign({}, w, {
      student_name: s ? s.name : '—', admission_no: s ? s.admission_no : '—',
      class_name: c ? c.full_name : '—',
      requested_by_name: t ? t.name : '—'
    });
  }

  // GET /api/school/{school_id}/fee-waivers
  function listWaiverRows(schoolId, opts) {
    opts = opts || {};
    var d = db();
    var rows = d.waivers.filter(function (w) {
      return w.school_id === schoolId &&
             (!opts.termId || w.term_id === opts.termId) &&
             (!opts.status || w.status === opts.status);
    }).map(function (w) { return decorateWaiver(w, d); });
    rows.sort(function (a, b) {
      var order = { pending: 0, approved: 1, rejected: 2 };
      return order[a.status] - order[b.status] || b.amount - a.amount;
    });
    return resolve({
      items: rows, total: rows.length,
      pending_value: rows.filter(function (w) { return w.status === 'pending'; })
        .reduce(function (n, w) { return n + w.amount; }, 0)
    });
  }

  // POST /api/school/{school_id}/fee-waivers/{waiver_id}/approve
  /**
   * Idempotent. The `applied` flag is what stops a second approval deducting a
   * second time — status alone would not, because an already-approved waiver
   * still answers "approved" to a repeat click.
   */
  function approveWaiver(schoolId, waiverId, payload) {
    var d = db();
    var w = byId(d.waivers, waiverId);
    if (!w) return reject(404, 'No waiver ' + waiverId);
    if (w.status === 'rejected') return reject(409, 'That waiver was rejected. Reopen it before approving.');
    if (w.applied) {
      return resolve({ waiver: w, applied: false, already: true,
                       message: 'That waiver was already approved and applied; nothing changed.' });
    }

    var inv = d.invoices.filter(function (i) {
      return i.student_id === w.student_id && i.term_id === w.term_id;
    })[0];
    if (!inv) return reject(422, 'That pupil has no invoice this term for the waiver to reduce.');
    if (w.amount > inv.amount_due - inv.amount_paid) {
      return reject(422, 'The waiver of KES ' + w.amount.toLocaleString('en-KE') +
        ' is larger than the KES ' + (inv.amount_due - inv.amount_paid).toLocaleString('en-KE') + ' still owed.');
    }

    inv.amount_due -= w.amount;
    reconcileInvoice(inv);

    w.status = 'approved';
    w.applied = true;
    w.approved_by = (payload && payload.approvedBy) || 'tch-06';
    w.approved_on = (payload && payload.date) || d.today;
    w.decision_reason = (payload && payload.reason) || null;

    postEntry({
      schoolId: schoolId, termId: w.term_id, entryId: 'ent-' + w.id,
      date: w.approved_on, source: 'waiver', sourceId: w.id,
      memo: 'Waiver approved — ' + w.reason,
      debit: accounts().bursary_expense, credit: accounts().fees_receivable,
      amount: w.amount
    });

    persist();
    return resolve({ waiver: w, invoice: inv, applied: true, already: false });
  }

  // POST /api/school/{school_id}/fee-waivers/{waiver_id}/reject
  function rejectWaiver(schoolId, waiverId, payload) {
    if (!payload || !String(payload.reason || '').trim()) {
      return reject(422, 'A rejection needs a reason — the person who asked will be told what it was.');
    }
    var d = db();
    var w = byId(d.waivers, waiverId);
    if (!w) return reject(404, 'No waiver ' + waiverId);
    if (w.applied) return reject(409, 'That waiver was already approved and applied. It cannot be rejected now.');
    w.status = 'rejected';
    w.decision_reason = String(payload.reason).trim();
    w.approved_by = (payload && payload.approvedBy) || 'tch-06';
    w.approved_on = (payload && payload.date) || d.today;
    persist();
    return resolve(w);
  }

  global.DemoBackend = {
    // people
    listStudents: listStudents,
    getStudent: getStudent,
    createStudent: createStudent,
    listClasses: listClasses,
    listTeachers: listTeachers,
    listSubjects: listSubjects,
    // fees
    listFeeStructures: listFeeStructures,
    listFeeInvoices: listFeeInvoices,
    listDefaulters: listDefaulters,
    getArrearsByClass: getArrearsByClass,
    listPayments: listPayments,
    getDailyCollections: getDailyCollections,
    recordPayment: recordPayment,
    sendFeeReminders: sendFeeReminders,
    generateInvoices: generateInvoices,
    listWaivers: listWaivers,
    // daily
    listAttendance: listAttendance,
    getRegisterStatus: getRegisterStatus,
    markAttendance: markAttendance,
    // academics
    listExams: listExams,
    listExamResults: listExamResults,
    listReportCards: listReportCards,
    publishReportCards: publishReportCards,
    listGradingScales: listGradingScales,
    // communication
    listAnnouncements: listAnnouncements,
    listEvents: listEvents,
    // dashboard
    getDashboardSummary: getDashboardSummary,
    getNeedsAttention: getNeedsAttention,
    // students
    searchStudents: searchStudents,
    updateStudent: updateStudent,
    promoteStudents: promoteStudents,
    transferStudent: transferStudent,
    importStudentsCSV: importStudentsCSV,
    exportStudentsCSV: exportStudentsCSV,
    sendMessage: sendMessage,
    CSV_COLUMNS: CSV_COLUMNS,
    // guardians
    listGuardians: listGuardians,
    addGuardian: addGuardian,
    updateGuardian: updateGuardian,
    setPrimaryGuardian: setPrimaryGuardian,
    removeGuardian: removeGuardian,
    // discipline
    listDiscipline: listDiscipline,
    addDiscipline: addDiscipline,
    // fee structures
    createFeeStructure: createFeeStructure,
    updateFeeStructure: updateFeeStructure,
    deleteFeeStructure: deleteFeeStructure,
    cloneFeeStructure: cloneFeeStructure,
    // invoices, payments, ledger
    listInvoiceRows: listInvoiceRows,
    bulkGenerateInvoices: bulkGenerateInvoices,
    getReceipt: getReceipt,
    listPaymentLedger: listPaymentLedger,
    exportPaymentsCSV: exportPaymentsCSV,
    listJournalLines: listJournalLines,
    ledgerDrift: ledgerDrift,
    // defaulters
    listDefaulterRows: listDefaulterRows,
    sendRemindersFor: sendRemindersFor,
    AGING_BUCKETS: BUCKETS.map(function (b) { return { key: b.key, label: b.label }; }),
    MAX_REMINDERS: MAX_REMINDERS,
    // waivers
    listWaiverRows: listWaiverRows,
    approveWaiver: approveWaiver,
    rejectWaiver: rejectWaiver,
    // store
    STORE_KEY: STORE_KEY,
    resetStore: resetStore,
    persist: persist,
    _store: db
  };
})(typeof window !== 'undefined' ? window : globalThis);
