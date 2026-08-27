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

  /**
   * Keeps an invoice's derived fields honest after any change to the money.
   *
   * The identity is school.py's, not the one we started with:
   *
   *     balance = amount_due − amount_paid − discount_amount
   *
   * amount_due stays the face value of the charge and an approved waiver shows
   * as its own line rather than quietly shrinking the invoice. That is better
   * bookkeeping — a bursary is a thing the school granted, not a smaller bill.
   * See docs/RULES_RECONCILED.md row 5 (school.py:919).
   */
  function reconcileInvoice(inv) {
    if (typeof inv.discount_amount !== 'number') inv.discount_amount = 0;
    inv.balance = inv.amount_due - inv.amount_paid - inv.discount_amount;
    // A bursary is not a payment. A family that has paid nothing is "unpaid"
    // even with a discount on the invoice; only a zero balance is "cleared",
    // which is also what school.py:917 does when a waiver closes an invoice.
    inv.status = inv.balance <= 0
      ? 'cleared'
      : (inv.amount_paid === 0 ? 'unpaid' : 'part_paid');
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

    // E31 — a transaction code identifies one movement of money. Receipting it
    // twice credits a parent for a payment the school only ever received once,
    // and it is an easy mistake: the bursar reads the same SMS twice, or a
    // request is retried after a timeout. Cash has no reference and many cash
    // payments legitimately coexist, so the rule applies only where there is
    // a code to collide.
    var reference = (payload && payload.reference) || null;
    if (reference) {
      var seen = d.payments.filter(function (p) {
        return p.school_id === schoolId && p.method === method && p.reference === reference;
      })[0];
      if (seen) {
        return reject(409, 'Reference ' + reference + ' has already been receipted on ' +
          seen.paid_at.slice(0, 10) + '. A transaction code can only be banked once.');
      }
    }

    inv.amount_paid += amount;
    reconcileInvoice(inv);

    var payment = {
      id: 'pay-' + String(d.payments.length + 1).padStart(5, '0'),
      school_id: schoolId, term_id: inv.term_id,
      invoice_id: inv.id, student_id: inv.student_id, class_id: inv.class_id,
      amount: amount,
      method: method,
      reference: reference,
      mpesa_code: method === 'mpesa' ? reference : null,
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
  /**
   * UPSERT, not insert. Submitting a register that already exists updates the
   * marks in place — one record per pupil per class per date, always. Marking
   * the same register twice must leave the record count unchanged.
   */
  function markAttendance(schoolId, classId, payload) {
    if (!payload || !payload.date) return reject(422, 'A register needs a date.');
    if (!payload.records || !payload.records.length) return reject(422, 'No attendance records supplied.');
    var d = db();
    if (!byId(d.classes, classId)) return reject(404, 'No class ' + classId);
    if (payload.date > d.today) return reject(422, 'That date is in the future — a register cannot be marked ahead of the day.');

    var VALID = ['present', 'absent', 'late', 'excused'];
    var bad = payload.records.filter(function (r) { return VALID.indexOf(r.status) === -1; });
    if (bad.length) {
      return reject(422, 'Every pupil needs a mark of present, absent, late or excused — ' +
        bad.length + ' ' + (bad.length === 1 ? 'is' : 'are') + ' unmarked.');
    }

    var index = {};
    d.attendance.forEach(function (a) {
      if (a.class_id === classId && a.date === payload.date) index[a.student_id] = a;
    });

    var markedAt = payload.date + 'T' + (payload.time || '08:20') + ':00+03:00';
    var created = 0, updated = 0;
    payload.records.forEach(function (r) {
      var existing = index[r.student_id];
      if (existing) {
        existing.status = r.status;
        existing.note = r.note || null;
        existing.marked_by = payload.markedBy || existing.marked_by;
        existing.marked_at = markedAt;
        updated++;
      } else {
        d.attendance.push({
          id: 'att-' + String(d.attendance.length + 1).padStart(6, '0'),
          school_id: schoolId, term_id: d.current_term_id,
          student_id: r.student_id, class_id: classId,
          date: payload.date, status: r.status, note: r.note || null,
          marked_by: payload.markedBy || null,
          marked_at: markedAt
        });
        created++;
      }
    });
    persist();
    return resolve({ class_id: classId, date: payload.date,
                     marked: payload.records.length, created: created, updated: updated,
                     was_update: updated > 0 && created === 0 });
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
    return resolve(db().grading_scales.filter(function (g) { return g.school_id === schoolId; }));
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
    var discounted = invoices.reduce(function (n, i) { return n + (i.discount_amount || 0); }, 0);
    // what is still owed, not what was billed: a waived shilling is not outstanding
    var outstanding = invoices.reduce(function (n, i) { return n + i.balance; }, 0);
    var collectable = invoiced - discounted;
    var rate = collectable ? collected / collectable * 100 : 0;

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
        collected: collected,
        discounted: discounted,
        collectable: collectable
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
    /*
     * One invoice per pupil per TERM, regardless of stream — school.py:793,
     * ON CONFLICT (student_id,term,year) DO NOTHING. Keying on class as we
     * first did would raise a second invoice for a pupil who changed stream
     * mid-term, which is exactly the pupil least able to absorb it.
     */
    var already = {};
    d.invoices.forEach(function (i) {
      if (i.term_id === payload.termId) already[i.student_id] = i.id;
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

  // POST /api/school/fee-waivers
  function createWaiver(schoolId, payload) {
    if (!payload || !payload.invoiceId) return reject(422, 'A waiver needs an invoice.');
    if (!(Number(payload.amount) > 0)) return reject(422, 'A waiver needs an amount greater than zero.');
    if (!String(payload.reason || '').trim()) return reject(422, 'Say why the waiver is being requested.');
    var d = db();
    var inv = byId(d.invoices, payload.invoiceId);
    if (!inv) return reject(404, 'No invoice ' + payload.invoiceId);
    var w = {
      id: 'wvr-' + String(d.waivers.length + 1).padStart(3, '0'),
      school_id: schoolId, term_id: inv.term_id,
      student_id: inv.student_id, class_id: inv.class_id,
      invoice_id: inv.id,
      amount: Number(payload.amount), reason: String(payload.reason).trim(),
      status: 'pending', requested_by: payload.requestedBy || 'tch-06',
      requested_on: d.today, approved_by: null, approved_on: null, applied: false
    };
    d.waivers.push(w);
    persist();
    return resolve(w);
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
    if (w.amount > inv.balance) {
      return reject(422, 'The waiver of KES ' + w.amount.toLocaleString('en-KE') +
        ' is larger than the KES ' + inv.balance.toLocaleString('en-KE') + ' still owed.');
    }

    // the charge stands; the bursary is a visible discount against it
    inv.discount_amount = (inv.discount_amount || 0) + w.amount;
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

  // ══════════════════════════════════════════════════════════════════════
  // Grading scales
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Bands must tile 0..max_score exactly: no gap, no overlap, nothing outside.
   * A school that writes 0–39, 40–49, 51–59 has a hole at 50, and a pupil who
   * scores 50 gets no grade at all. This is the check that stops that shipping,
   * and it names the exact score that falls through.
   */
  function validateBands(bands, maxScore) {
    if (!bands || !bands.length) return 'A scale needs at least one band.';
    var max = Number(maxScore);
    if (!(max > 0)) return 'The maximum score must be greater than zero.';

    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      var where = 'Band ' + (i + 1) + (b.grade ? ' (' + b.grade + ')' : '');
      if (!String(b.grade || '').trim()) return where + ' has no grade.';
      if (!isFinite(Number(b.min)) || !isFinite(Number(b.max))) return where + ' needs a numeric range.';
      if (Number(b.min) > Number(b.max)) {
        return where + ' runs backwards: min ' + b.min + ' is above max ' + b.max + '.';
      }
      if (Number(b.min) < 0) return where + ' starts below zero.';
      if (Number(b.max) > max) return where + ' ends at ' + b.max + ', above the maximum score of ' + max + '.';
      if (!isFinite(Number(b.points))) return where + ' has no points value.';
      if (!String(b.remark || '').trim()) return where + ' has no remark.';
    }

    var seen = {};
    for (var g = 0; g < bands.length; g++) {
      var grade = String(bands[g].grade).trim().toUpperCase();
      if (seen[grade]) return 'The grade "' + bands[g].grade + '" appears twice. Each band needs its own grade.';
      seen[grade] = true;
    }

    var sorted = bands.slice().sort(function (a, b2) { return Number(a.min) - Number(b2.min); });
    if (Number(sorted[0].min) !== 0) {
      return 'The lowest band starts at ' + sorted[0].min + ', so scores 0 to ' +
        (Number(sorted[0].min) - 1) + ' fall through with no grade. The lowest band must start at 0.';
    }
    for (var j = 1; j < sorted.length; j++) {
      var prev = sorted[j - 1], cur = sorted[j];
      var expected = Number(prev.max) + 1;
      if (Number(cur.min) > expected) {
        var lo = expected, hi = Number(cur.min) - 1;
        return 'Gap between ' + prev.grade + ' (ends ' + prev.max + ') and ' + cur.grade +
          ' (starts ' + cur.min + '): ' + (lo === hi ? 'a score of ' + lo + ' gets' : 'scores ' + lo + ' to ' + hi + ' get') +
          ' no grade at all.';
      }
      if (Number(cur.min) < expected) {
        return 'Overlap between ' + prev.grade + ' (' + prev.min + '–' + prev.max + ') and ' +
          cur.grade + ' (' + cur.min + '–' + cur.max + '): ' +
          'scores ' + cur.min + ' to ' + Math.min(Number(prev.max), Number(cur.max)) + ' match both bands.';
      }
    }
    var top = sorted[sorted.length - 1];
    if (Number(top.max) !== max) {
      return 'The highest band ends at ' + top.max + ' but the scale runs to ' + max +
        ', so scores ' + (Number(top.max) + 1) + ' to ' + max + ' get no grade.';
    }
    return null;
  }

  /** The band a score falls in. Nothing else may decide a grade. */
  function bandFor(scale, score) {
    var n = Number(score);
    for (var i = 0; i < scale.bands.length; i++) {
      var b = scale.bands[i];
      if (n >= Number(b.min) && n <= Number(b.max)) return b;
    }
    return null;
  }

  function scaleById(scaleId) {
    return db().grading_scales.filter(function (g) { return g.id === scaleId; })[0] || null;
  }

  // GET /api/school/{school_id}/grading-scales
  function listGradingScaleRows(schoolId, opts) {
    opts = opts || {};
    var d = db();
    var rows = d.grading_scales.filter(function (g) { return g.school_id === schoolId; });
    return resolve(rows.map(function (g) {
      var bound = d.exams.filter(function (e) { return e.grading_scale_id === g.id; });
      var resultCount = d.exam_results.filter(function (r) {
        return bound.some(function (e) { return e.id === r.exam_id; });
      }).length;
      return Object.assign({}, g, {
        exam_count: bound.length,
        exam_names: bound.map(function (e) { return e.name; }),
        result_count: resultCount,
        band_count: g.bands.length,
        tiles: validateBands(g.bands, g.max_score) === null
      });
    }));
  }

  // POST /api/school/{school_id}/grading-scales
  function createGradingScale(schoolId, payload) {
    if (!payload || !String(payload.name || '').trim()) return reject(422, 'Give the scale a name.');
    var problem = validateBands(payload.bands, payload.maxScore);
    if (problem) return reject(422, problem);
    var d = db();
    var dupe = d.grading_scales.filter(function (g) {
      return g.school_id === schoolId && g.name.toLowerCase() === String(payload.name).trim().toLowerCase();
    })[0];
    if (dupe) return reject(409, 'There is already a scale called "' + payload.name.trim() + '".');

    var scale = {
      id: 'grd-' + String(d.grading_scales.length + 1).padStart(3, '0'),
      school_id: schoolId,
      name: String(payload.name).trim(),
      description: payload.description || null,
      max_score: Number(payload.maxScore),
      is_default: false,
      effective_from: payload.effectiveFrom || d.today,
      bands: normaliseBands(payload.bands)
    };
    d.grading_scales.push(scale);
    persist();
    return resolve(scale);
  }
  function normaliseBands(bands) {
    return bands.map(function (b) {
      return {
        grade: String(b.grade).trim(), min: Number(b.min), max: Number(b.max),
        points: Number(b.points), remark: String(b.remark).trim()
      };
    }).sort(function (a, b) { return a.min - b.min; });
  }

  // PUT /api/school/{school_id}/grading-scales/{scale_id}
  function updateGradingScale(schoolId, scaleId, payload) {
    var d = db();
    var scale = byId(d.grading_scales, scaleId);
    if (!scale) return reject(404, 'No grading scale ' + scaleId);
    if (!payload || !String(payload.name || '').trim()) return reject(422, 'Give the scale a name.');
    var max = payload.maxScore != null ? Number(payload.maxScore) : scale.max_score;
    var problem = validateBands(payload.bands, max);
    if (problem) return reject(422, problem);

    /*
     * Regrading live marks is right — a stored grade that disagrees with its
     * scale is a bug. Regrading a mark that already sits on a PUBLISHED report
     * card is not: a parent has read that document, and changing the grade
     * under them is worse than leaving the scale alone. So the edit stops, names
     * the classes, and asks for the cards to be regenerated first.
     */
    var examIds = d.exams.filter(function (e) { return e.grading_scale_id === scale.id; })
      .map(function (e) { return e.id; });
    var publishedCards = d.report_cards.filter(function (c) {
      return c.status === 'published' && examIds.indexOf(c.exam_id) !== -1;
    });
    if (publishedCards.length) {
      var classNames = publishedCards.map(function (c) {
        var cls = byId(d.classes, c.class_id);
        return cls ? cls.full_name : c.class_id;
      }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
      var e = new Error('Cannot edit "' + scale.name + '": ' + publishedCards.length +
        ' published report card' + (publishedCards.length === 1 ? '' : 's') +
        ' were graded on these bands, in ' + classNames.join(', ') + '. ' +
        'Changing the scale would rewrite a grade a guardian has already read. ' +
        'Regenerate those cards back to draft first, then edit the scale.');
      e.status = 409;
      e.published_cards = publishedCards.length;
      e.classes = classNames;
      return Promise.reject(e);
    }

    scale.name = String(payload.name).trim();
    if (payload.description !== undefined) scale.description = payload.description || null;
    scale.max_score = max;
    scale.bands = normaliseBands(payload.bands);

    // an edited scale regrades everything still in draft
    var regraded = regradeAgainst(schoolId, scale);
    persist();
    return resolve({ scale: scale, regraded: regraded });
  }

  /** Re-derives grade and points for every result whose exam binds to this scale. */
  function regradeAgainst(schoolId, scale) {
    var d = db();
    var examIds = d.exams.filter(function (e) { return e.grading_scale_id === scale.id; })
      .map(function (e) { return e.id; });
    var n = 0;
    d.exam_results.forEach(function (r) {
      if (examIds.indexOf(r.exam_id) === -1) return;
      var band = bandFor(scale, r.score);
      if (!band) return;
      if (r.grade !== band.grade || r.points !== band.points) n++;
      r.grade = band.grade; r.points = band.points; r.remark = band.remark;
    });
    return n;
  }

  // DELETE /api/school/{school_id}/grading-scales/{scale_id}
  function deleteGradingScale(schoolId, scaleId) {
    var d = db();
    var scale = byId(d.grading_scales, scaleId);
    if (!scale) return reject(404, 'No grading scale ' + scaleId);
    if (scale.is_default) {
      return reject(409, 'That is the default scale. Make another scale the default before deleting this one.');
    }
    var bound = d.exams.filter(function (e) { return e.grading_scale_id === scaleId; });
    if (bound.length) {
      return reject(409, 'Cannot delete this scale: ' + bound.length + ' exam' + (bound.length === 1 ? '' : 's') +
        ' grade against it (' + bound.map(function (e) { return e.name; }).join(', ') +
        '). Point those exams at another scale first.');
    }
    d.grading_scales = d.grading_scales.filter(function (g) { return g.id !== scaleId; });
    persist();
    return resolve({ deleted: scaleId });
  }

  // PUT /api/school/{school_id}/grading-scales/{scale_id}/default
  function setDefaultGradingScale(schoolId, scaleId) {
    var d = db();
    if (!byId(d.grading_scales, scaleId)) return reject(404, 'No grading scale ' + scaleId);
    d.grading_scales.forEach(function (g) { g.is_default = g.id === scaleId; });
    d.grading_scale = byId(d.grading_scales, scaleId);
    persist();
    return resolve(d.grading_scales);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Attendance — register and report
  // ══════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/classes/{class_id}/register?date=
  function getClassRegister(schoolId, classId, opts) {
    opts = opts || {};
    var d = db();
    var date = opts.date || d.today;
    var cls = byId(d.classes, classId);
    if (!cls) return reject(404, 'No class ' + classId);

    var marks = {};
    d.attendance.forEach(function (a) {
      if (a.class_id === classId && a.date === date) marks[a.student_id] = a;
    });
    var teacher = byId(d.teachers, cls.class_teacher_id);
    var roll = d.students
      .filter(function (s) { return s.class_id === classId && s.status === 'active'; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .map(function (s) {
        var m = marks[s.id];
        return {
          student_id: s.id, name: s.name, admission_no: s.admission_no, gender: s.gender,
          status: m ? m.status : null, note: m ? m.note : null, record_id: m ? m.id : null
        };
      });
    var first = roll.filter(function (r) { return r.record_id; })[0];
    var existing = first ? d.attendance.filter(function (a) { return a.id === first.record_id; })[0] : null;
    return resolve({
      class_id: classId, class_name: cls.full_name, date: date,
      roll: roll, roll_size: roll.length,
      already_marked: !!first,
      marked_by: existing ? existing.marked_by : null,
      marked_by_name: existing ? (byId(d.teachers, existing.marked_by) || {}).name || '—' : null,
      marked_at: existing ? existing.marked_at : null,
      class_teacher_id: cls.class_teacher_id,
      class_teacher_name: teacher ? teacher.name : null
    });
  }

  // GET /api/school/{school_id}/attendance/report?class_id=&from=&to=
  function getAttendanceReport(schoolId, opts) {
    opts = opts || {};
    var d = db();
    var to = opts.to || d.today;
    var from = opts.from || shiftDay(to, -27);
    var rows = d.attendance.filter(function (a) {
      return a.school_id === schoolId && a.date >= from && a.date <= to &&
             (!opts.classId || a.class_id === opts.classId);
    });
    var dates = rows.map(function (a) { return a.date; })
      .filter(function (v, i, arr) { return arr.indexOf(v) === i; }).sort();

    var students = d.students.filter(function (s) {
      return s.school_id === schoolId && (!opts.classId || s.class_id === opts.classId) && s.status === 'active';
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    var byStudent = {};
    rows.forEach(function (a) {
      (byStudent[a.student_id] = byStudent[a.student_id] || {})[a.date] = a.status;
    });

    var grid = students.map(function (s) {
      var mine = byStudent[s.id] || {};
      var marked = dates.filter(function (day) { return mine[day]; });
      var here = marked.filter(function (day) { return mine[day] === 'present' || mine[day] === 'late'; }).length;
      var cls = byId(d.classes, s.class_id);
      return {
        student_id: s.id, name: s.name, admission_no: s.admission_no,
        class_id: s.class_id, class_name: cls ? cls.full_name : '—',
        days: dates.map(function (day) { return { date: day, status: mine[day] || null }; }),
        marked: marked.length,
        present: marked.filter(function (day) { return mine[day] === 'present'; }).length,
        late: marked.filter(function (day) { return mine[day] === 'late'; }).length,
        absent: marked.filter(function (day) { return mine[day] === 'absent'; }).length,
        excused: marked.filter(function (day) { return mine[day] === 'excused'; }).length,
        percentage: marked.length ? here / marked.length * 100 : null
      };
    });

    var totalMarked = rows.length;
    var totalHere = rows.filter(function (a) { return a.status === 'present' || a.status === 'late'; }).length;
    return resolve({
      from: from, to: to, dates: dates, rows: grid,
      records: totalMarked,
      percentage: totalMarked ? totalHere / totalMarked * 100 : null,
      class_id: opts.classId || null
    });
  }

  // GET /api/school/{school_id}/attendance/absentees?date=
  function getAbsentees(schoolId, opts) {
    opts = opts || {};
    var d = db();
    var date = opts.date || d.today;
    var rows = d.attendance.filter(function (a) {
      return a.school_id === schoolId && a.date === date &&
             (a.status === 'absent' || a.status === 'excused') &&
             (!opts.classId || a.class_id === opts.classId);
    }).map(function (a) {
      var s = byId(d.students, a.student_id), c = byId(d.classes, a.class_id);
      var g = d.guardians.filter(function (x) { return x.student_id === a.student_id && x.is_primary; })[0];
      return {
        student_id: a.student_id, name: s ? s.name : '—', admission_no: s ? s.admission_no : '—',
        class_id: a.class_id, class_name: c ? c.full_name : '—',
        status: a.status, note: a.note,
        guardian_name: g ? g.name : '—', guardian_phone: g ? g.phone : '—'
      };
    });
    rows.sort(function (a, b) { return a.class_name.localeCompare(b.class_name) || a.name.localeCompare(b.name); });
    return resolve({ date: date, items: rows, total: rows.length });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Exams
  // ══════════════════════════════════════════════════════════════════════

  var EXAM_TYPES = ['opener', 'cat', 'midterm', 'endterm', 'mock'];

  // GET /api/school/{school_id}/exams (with counts)
  function listExamRows(schoolId, opts) {
    opts = opts || {};
    var d = db();
    var rows = d.exams.filter(function (e) {
      return e.school_id === schoolId && (!opts.termId || e.term_id === opts.termId);
    }).map(function (e) {
      var results = d.exam_results.filter(function (r) { return r.exam_id === e.id; });
      var scale = scaleById(e.grading_scale_id);
      var t = byId(d.terms, e.term_id);
      return Object.assign({}, e, {
        scale_name: scale ? scale.name : '—',
        term_name: t ? t.name + ' ' + t.year : '—',
        result_count: results.length,
        unverified_count: results.filter(function (r) { return !r.verified; }).length,
        class_count: e.class_ids.length,
        locked: results.length > 0
      });
    });
    rows.sort(function (a, b) { return a.starts_on < b.starts_on ? 1 : -1; });
    return resolve(rows);
  }

  function validateExam(payload, d) {
    if (!payload) return 'Nothing to save.';
    if (!String(payload.name || '').trim()) return 'Give the exam a name.';
    if (EXAM_TYPES.indexOf(payload.type) === -1) return 'Choose what kind of exam this is.';
    if (!payload.termId) return 'Choose the term this exam belongs to.';
    if (!payload.startsOn) return 'When does it start?';
    if (!payload.endsOn) return 'When does it end?';
    if (payload.endsOn < payload.startsOn) return 'The exam ends before it starts.';
    if (!(Number(payload.maxScore) > 0)) return 'The maximum score must be greater than zero.';
    if (!payload.gradingScaleId) return 'Bind the exam to a grading scale — that is what turns a mark into a grade.';
    var scale = d.grading_scales.filter(function (g) { return g.id === payload.gradingScaleId; })[0];
    if (!scale) return 'That grading scale does not exist.';
    if (Number(payload.maxScore) > scale.max_score) {
      return 'This exam is out of ' + payload.maxScore + ' but "' + scale.name +
        '" only grades up to ' + scale.max_score + '. A top mark would fall outside every band.';
    }
    if (!payload.classIds || !payload.classIds.length) return 'Choose at least one class to sit it.';
    return null;
  }

  // POST /api/school/{school_id}/exams
  function createExam(schoolId, payload) {
    var d = db();
    var problem = validateExam(payload, d);
    if (problem) return reject(422, problem);
    var exam = {
      id: 'exm-' + String(d.exams.length + 1).padStart(3, '0') + '-' + payload.type,
      school_id: schoolId, term_id: payload.termId,
      name: String(payload.name).trim(), type: payload.type,
      starts_on: payload.startsOn, ends_on: payload.endsOn, sat_on: payload.startsOn,
      max_score: Number(payload.maxScore),
      grading_scale_id: payload.gradingScaleId,
      class_ids: payload.classIds.slice(),
      status: 'scheduled', results_entered: false
    };
    d.exams.push(exam);
    persist();
    return resolve(exam);
  }

  // PATCH /api/school/{school_id}/exams/{exam_id}
  /**
   * The grading scale is frozen once anything is marked. Changing it would
   * silently regrade every result already entered and verified against the old
   * bands — so it is blocked, with the count that makes the reason obvious.
   */
  function updateExam(schoolId, examId, payload) {
    var d = db();
    var exam = byId(d.exams, examId);
    if (!exam) return reject(404, 'No exam ' + examId);
    var merged = {
      name: payload.name != null ? payload.name : exam.name,
      type: payload.type != null ? payload.type : exam.type,
      termId: payload.termId || exam.term_id,
      startsOn: payload.startsOn || exam.starts_on,
      endsOn: payload.endsOn || exam.ends_on,
      maxScore: payload.maxScore != null ? payload.maxScore : exam.max_score,
      gradingScaleId: payload.gradingScaleId || exam.grading_scale_id,
      classIds: payload.classIds || exam.class_ids
    };
    var problem = validateExam(merged, d);
    if (problem) return reject(422, problem);

    var results = d.exam_results.filter(function (r) { return r.exam_id === examId; });
    if (results.length && merged.gradingScaleId !== exam.grading_scale_id) {
      var from = scaleById(exam.grading_scale_id), to = scaleById(merged.gradingScaleId);
      return reject(409, 'Cannot move "' + exam.name + '" from "' + (from ? from.name : '?') +
        '" to "' + (to ? to.name : '?') + '": ' + results.length + ' result' + (results.length === 1 ? '' : 's') +
        ' are already marked against the old bands. Every grade on this exam would change under you. ' +
        'Delete the results first, or create a new exam on the other scale.');
    }
    if (results.length && Number(merged.maxScore) !== exam.max_score) {
      return reject(409, 'Cannot change the maximum score: ' + results.length + ' result' +
        (results.length === 1 ? ' is' : 's are') + ' already marked out of ' + exam.max_score + '.');
    }

    exam.name = String(merged.name).trim();
    exam.type = merged.type;
    exam.term_id = merged.termId;
    exam.starts_on = merged.startsOn;
    exam.ends_on = merged.endsOn;
    exam.sat_on = merged.startsOn;
    exam.max_score = Number(merged.maxScore);
    exam.grading_scale_id = merged.gradingScaleId;
    exam.class_ids = merged.classIds.slice();
    persist();
    return resolve(exam);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Results — entry, verification, analysis
  // ══════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/exams/{exam_id}/mark-sheet?class_id=&subject_id=
  function getMarkSheet(schoolId, examId, opts) {
    opts = opts || {};
    var d = db();
    var exam = byId(d.exams, examId);
    if (!exam) return reject(404, 'No exam ' + examId);
    if (!opts.classId) return reject(422, 'Choose a class.');
    if (!opts.subjectId) return reject(422, 'Choose a subject.');
    var scale = scaleById(exam.grading_scale_id);
    if (!scale) return reject(422, 'This exam is bound to a grading scale that no longer exists.');

    var existing = {};
    d.exam_results.forEach(function (r) {
      if (r.exam_id === examId && r.class_id === opts.classId && r.subject_id === opts.subjectId) {
        existing[r.student_id] = r;
      }
    });
    var roll = d.students
      .filter(function (s) { return s.class_id === opts.classId && s.status === 'active'; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .map(function (s) {
        var r = existing[s.id];
        var teacher = r ? byId(d.teachers, r.entered_by) : null;
        var verifier = r && r.verified_by ? byId(d.teachers, r.verified_by) : null;
        return {
          student_id: s.id, name: s.name, admission_no: s.admission_no,
          result_id: r ? r.id : null,
          score: r ? r.score : null, grade: r ? r.grade : null, points: r ? r.points : null,
          remark: r ? r.remark : null, comment: r ? r.comment : null,
          verified: r ? !!r.verified : false,
          entered_by: r ? r.entered_by : null,
          entered_by_name: teacher ? teacher.name : null,
          verified_by_name: verifier ? verifier.name : null
        };
      });
    var cls = byId(d.classes, opts.classId);
    var subject = byId(d.subjects, opts.subjectId);
    var assignment = d.assignments.filter(function (a) {
      return a.class_id === opts.classId && a.subject_id === opts.subjectId;
    })[0];
    var teacher = assignment ? byId(d.teachers, assignment.teacher_id) : null;
    return resolve({
      exam: exam, scale: scale,
      class_id: opts.classId, class_name: cls ? cls.full_name : '—',
      subject_id: opts.subjectId, subject_name: subject ? subject.name : '—',
      teacher_id: teacher ? teacher.id : null,
      teacher_name: teacher ? teacher.name : null,
      max_score: exam.max_score,
      roll: roll,
      entered: roll.filter(function (r) { return r.score != null; }).length,
      unverified: roll.filter(function (r) { return r.score != null && !r.verified; }).length
    });
  }

  // PUT /api/school/{school_id}/exams/{exam_id}/results
  /**
   * Upserts a mark sheet. Grade and points are always derived here from the
   * exam's bound scale — a caller cannot supply them, which is what keeps every
   * stored grade honest against its score.
   */
  function saveExamResults(schoolId, examId, payload) {
    var d = db();
    var exam = byId(d.exams, examId);
    if (!exam) return reject(404, 'No exam ' + examId);
    if (!payload || !payload.classId || !payload.subjectId) {
      return reject(422, 'A mark sheet needs a class and a subject.');
    }
    if (!payload.scores || !payload.scores.length) return reject(422, 'No marks to save.');
    var scale = scaleById(exam.grading_scale_id);
    if (!scale) return reject(422, 'This exam is bound to a grading scale that no longer exists.');

    var bad = [];
    payload.scores.forEach(function (row) {
      if (row.score === null || row.score === '' || row.score === undefined) return;
      var n = Number(row.score);
      var s = byId(d.students, row.student_id);
      var who = s ? s.name : row.student_id;
      if (!isFinite(n)) { bad.push(who + ': "' + row.score + '" is not a number'); return; }
      if (n < 0 || n > exam.max_score) {
        bad.push(who + ': ' + n + ' is outside 0–' + exam.max_score);
      }
    });
    if (bad.length) {
      return reject(422, 'These marks are out of range and nothing was saved:\n' + bad.slice(0, 6).join('\n') +
        (bad.length > 6 ? '\nand ' + (bad.length - 6) + ' more' : ''));
    }

    var created = 0, updated = 0, cleared = 0;
    payload.scores.forEach(function (row) {
      var existing = d.exam_results.filter(function (r) {
        return r.exam_id === examId && r.class_id === payload.classId &&
               r.subject_id === payload.subjectId && r.student_id === row.student_id;
      })[0];

      var blank = row.score === null || row.score === '' || row.score === undefined;
      if (blank) {
        if (existing) {
          d.exam_results = d.exam_results.filter(function (r) { return r.id !== existing.id; });
          cleared++;
        }
        return;
      }
      var score = Number(row.score);
      var band = bandFor(scale, score);
      if (!band) return;                    // validateBands guarantees this cannot happen

      if (existing) {
        existing.score = score;
        existing.grade = band.grade;
        existing.points = band.points;
        existing.remark = band.remark;
        existing.comment = row.comment != null ? row.comment : existing.comment;
        existing.entered_by = payload.enteredBy || existing.entered_by;
        // a changed mark is an unverified mark again
        existing.verified = false;
        existing.verified_by = null;
        existing.verified_at = null;
        updated++;
      } else {
        d.exam_results.push({
          id: 'res-' + String(d.exam_results.length + 1 + created).padStart(6, '0') + '-' + row.student_id.slice(-4),
          school_id: schoolId, term_id: exam.term_id, exam_id: examId,
          student_id: row.student_id, class_id: payload.classId, subject_id: payload.subjectId,
          score: score, grade: band.grade, points: band.points, remark: band.remark,
          max_score: exam.max_score,
          comment: row.comment || null,
          entered_by: payload.enteredBy || null,
          verified: false, verified_by: null, verified_at: null
        });
        created++;
      }
    });

    exam.results_entered = d.exam_results.some(function (r) { return r.exam_id === examId; });
    if (exam.results_entered && exam.status === 'scheduled') exam.status = 'marks_entered';
    persist();
    return resolve({ exam_id: examId, class_id: payload.classId, subject_id: payload.subjectId,
                     created: created, updated: updated, cleared: cleared,
                     saved: created + updated });
  }

  // POST /api/school/{school_id}/exams/{exam_id}/results/verify
  /**
   * Verification is a separate action under a different name: whoever entered a
   * mark cannot be the one who signs it off, and the record says who did both.
   */
  function verifyExamResults(schoolId, examId, payload) {
    payload = payload || {};
    if (!payload.verifiedBy) return reject(422, 'Verification has to be signed — choose who is verifying.');
    var d = db();
    var exam = byId(d.exams, examId);
    if (!exam) return reject(404, 'No exam ' + examId);

    var rows = d.exam_results.filter(function (r) {
      return r.exam_id === examId && !r.verified &&
             (!payload.classId || r.class_id === payload.classId) &&
             (!payload.subjectId || r.subject_id === payload.subjectId);
    });
    if (!rows.length) return reject(422, 'Nothing here is waiting on verification.');

    var ownMarks = rows.filter(function (r) { return r.entered_by === payload.verifiedBy; });
    if (ownMarks.length && !payload.allowSelf) {
      return reject(409, 'Those marks were entered by the same person who is verifying them. ' +
        'Entry and verification are separate steps with separate names against them — ' +
        'ask a head of department to sign these off.');
    }

    rows.forEach(function (r) {
      r.verified = true;
      r.verified_by = payload.verifiedBy;
      r.verified_at = payload.date || d.today;
    });
    persist();
    return resolve({ exam_id: examId, verified: rows.length, verified_by: payload.verifiedBy });
  }

  // GET /api/school/{school_id}/exams/{exam_id}/analysis?class_id=
  function getClassAnalysis(schoolId, examId, opts) {
    opts = opts || {};
    var d = db();
    var exam = byId(d.exams, examId);
    if (!exam) return reject(404, 'No exam ' + examId);
    var rows = d.exam_results.filter(function (r) {
      return r.exam_id === examId && (!opts.classId || r.class_id === opts.classId);
    });
    if (!rows.length) {
      return resolve({ exam_id: examId, class_id: opts.classId || null, entries: 0,
                       mean: null, highest: null, lowest: null, subjects: [], unverified: 0 });
    }
    var scores = rows.map(function (r) { return r.score; });
    var subjectIds = rows.map(function (r) { return r.subject_id; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; });

    var subjects = subjectIds.map(function (id) {
      var mine = rows.filter(function (r) { return r.subject_id === id; });
      var sub = byId(d.subjects, id);
      var vals = mine.map(function (r) { return r.score; });
      var grades = {};
      mine.forEach(function (r) { grades[r.grade] = (grades[r.grade] || 0) + 1; });
      return {
        subject_id: id, subject_name: sub ? sub.name : id,
        entries: mine.length,
        mean: vals.reduce(function (n, v) { return n + v; }, 0) / vals.length,
        highest: Math.max.apply(null, vals),
        lowest: Math.min.apply(null, vals),
        unverified: mine.filter(function (r) { return !r.verified; }).length,
        grades: grades
      };
    }).sort(function (a, b) { return b.mean - a.mean; });

    var cls = byId(d.classes, opts.classId);
    return resolve({
      exam_id: examId, exam_name: exam.name,
      class_id: opts.classId || null, class_name: cls ? cls.full_name : 'All classes',
      entries: rows.length,
      mean: scores.reduce(function (n, v) { return n + v; }, 0) / scores.length,
      highest: Math.max.apply(null, scores),
      lowest: Math.min.apply(null, scores),
      unverified: rows.filter(function (r) { return !r.verified; }).length,
      subjects: subjects
    });
  }

  /**
   * COMPETITION ranking, the way a school actually reads a position.
   *
   * Ties share a rank and the ranks they consumed are skipped: two pupils tied
   * at the top are 1, 1, and the next is 3. Dense ranking would call that pupil
   * 2, which puts "Position 2 of 44" on a card with two pupils ahead of them —
   * something a head teacher spots immediately.
   */
  function competitionRank(rows, valueOf) {
    var ordered = rows.slice().sort(function (a, b) { return valueOf(b) - valueOf(a); });
    var rank = 0, previous = null, seen = 0;
    ordered.forEach(function (row) {
      var v = valueOf(row);
      seen += 1;
      if (previous === null || v !== previous) { rank = seen; previous = v; }
      row.position = rank;
    });
    return ordered;
  }

  // GET /api/school/{school_id}/exams/{exam_id}/merit-list?class_id=
  function getMeritList(schoolId, examId, opts) {
    opts = opts || {};
    var d = db();
    var exam = byId(d.exams, examId);
    if (!exam) return reject(404, 'No exam ' + examId);
    var rows = d.exam_results.filter(function (r) {
      return r.exam_id === examId && (!opts.classId || r.class_id === opts.classId);
    });
    var byStudent = {};
    rows.forEach(function (r) {
      var e = byStudent[r.student_id] = byStudent[r.student_id] ||
        { student_id: r.student_id, class_id: r.class_id, total: 0, points: 0, subjects: 0, unverified: 0 };
      e.total += r.score;
      e.points += r.points;
      e.subjects += 1;
      if (!r.verified) e.unverified += 1;
    });
    var list = Object.keys(byStudent).map(function (id) {
      var e = byStudent[id];
      var s = byId(d.students, id), c = byId(d.classes, e.class_id);
      e.name = s ? s.name : '—';
      e.admission_no = s ? s.admission_no : '—';
      e.class_name = c ? c.full_name : '—';
      e.average = e.subjects ? e.total / e.subjects : 0;
      return e;
    });
    var ranked = competitionRank(list, function (e) { return e.total; });
    var cls = byId(d.classes, opts.classId);
    return resolve({
      exam_id: examId, exam_name: exam.name,
      class_id: opts.classId || null, class_name: cls ? cls.full_name : 'All classes',
      items: ranked, total: ranked.length,
      unverified: ranked.reduce(function (n, e) { return n + e.unverified; }, 0)
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Report cards
  // ══════════════════════════════════════════════════════════════════════

  // POST /api/school/{school_id}/report-cards/generate
  function generateReportCards(schoolId, payload) {
    if (!payload || !payload.classId) return reject(422, 'Choose a class to generate for.');
    if (!payload.examId) return reject(422, 'Choose the exam these cards report on.');
    var d = db();
    var termId = payload.termId || d.current_term_id;
    var exam = byId(d.exams, payload.examId);
    if (!exam) return reject(404, 'No exam ' + payload.examId);

    var roll = d.students.filter(function (s) {
      return s.class_id === payload.classId && s.status === 'active';
    });
    if (!roll.length) return reject(422, 'That class has nobody on the roll.');

    var results = d.exam_results.filter(function (r) {
      return r.exam_id === payload.examId && r.class_id === payload.classId;
    });
    if (!results.length) {
      return reject(422, 'No marks have been entered for ' + exam.name + ' in that class, so there is nothing to report.');
    }

    var cards = roll.map(function (s) {
      var mine = results.filter(function (r) { return r.student_id === s.id; });
      var total = mine.reduce(function (n, r) { return n + r.score; }, 0);
      var average = mine.length ? total / mine.length : 0;
      var existing = d.report_cards.filter(function (c) {
        return c.student_id === s.id && c.term_id === termId && c.exam_id === payload.examId;
      })[0];
      var card = existing || {
        id: 'rpt-' + s.id + '-' + termId,
        school_id: schoolId, term_id: termId, exam_id: payload.examId,
        student_id: s.id, class_id: payload.classId,
        teacher_comment: '', principal_comment: '',
        published_at: null, published_by: null
      };
      card.subject_count = mine.length;
      card.total_marks = total;
      card.average = Math.round(average * 10) / 10;
      card.mean_score = card.average;
      card.points = mine.reduce(function (n, r) { return n + r.points; }, 0);
      var scale = scaleById(exam.grading_scale_id) || d.grading_scale;
      var band = bandFor(scale, Math.round(average));
      card.grade = band ? band.grade : '—';
      card.class_size = roll.length;
      // regenerating a published card puts it back in draft — the numbers moved
      card.status = 'draft';
      card.published_at = null;
      card.published_by = null;
      if (!existing) d.report_cards.push(card);
      return card;
    });

    competitionRank(cards, function (c) { return c.average; });
    persist();
    return resolve({ class_id: payload.classId, exam_id: payload.examId, term_id: termId,
                     generated: cards.length, cards: cards });
  }

  // GET /api/school/{school_id}/report-cards?class_id=&status=
  function listReportCardRows(schoolId, opts) {
    opts = opts || {};
    var d = db();
    var termId = opts.termId || d.current_term_id;
    var rows = d.report_cards.filter(function (c) {
      return c.school_id === schoolId && c.term_id === termId &&
             (!opts.classId || c.class_id === opts.classId) &&
             (!opts.status || c.status === opts.status);
    }).map(function (c) {
      var s = byId(d.students, c.student_id), cls = byId(d.classes, c.class_id);
      var unverified = d.exam_results.filter(function (r) {
        return r.exam_id === c.exam_id && r.student_id === c.student_id && !r.verified;
      }).length;
      return Object.assign({}, c, {
        student_name: s ? s.name : '—', admission_no: s ? s.admission_no : '—',
        class_name: cls ? cls.full_name : '—',
        unverified_subjects: unverified,
        publishable: unverified === 0
      });
    });
    rows.sort(function (a, b) { return (a.position || 99) - (b.position || 99) || a.student_name.localeCompare(b.student_name); });
    return resolve({ items: rows, total: rows.length, term_id: termId });
  }

  // GET /api/school/{school_id}/report-cards/{card_id}
  function getReportCard(schoolId, cardId) {
    var d = db();
    var card = byId(d.report_cards, cardId);
    if (!card) return reject(404, 'No report card ' + cardId);
    var s = byId(d.students, card.student_id);
    var cls = byId(d.classes, card.class_id);
    var term = byId(d.terms, card.term_id);
    var exam = byId(d.exams, card.exam_id);
    var teacher = cls ? byId(d.teachers, cls.class_teacher_id) : null;

    var results = d.exam_results.filter(function (r) {
      return r.exam_id === card.exam_id && r.student_id === card.student_id;
    }).map(function (r) {
      var sub = byId(d.subjects, r.subject_id);
      return Object.assign({}, r, { subject_name: sub ? sub.name : r.subject_id });
    }).sort(function (a, b) { return a.subject_name.localeCompare(b.subject_name); });

    var attendance = d.attendance.filter(function (a) {
      return a.student_id === card.student_id && a.term_id === card.term_id;
    });
    var here = attendance.filter(function (a) { return a.status === 'present' || a.status === 'late'; }).length;

    return resolve({
      card: card, school: d.school, student: s,
      class_name: cls ? cls.full_name : '—',
      term_name: term ? term.name + ' ' + term.year : '—',
      exam_name: exam ? exam.name : '—',
      class_teacher_name: teacher ? teacher.name : '—',
      results: results,
      unverified_subjects: results.filter(function (r) { return !r.verified; })
        .map(function (r) { return r.subject_name; }),
      attendance_days: attendance.length,
      attendance_percentage: attendance.length ? here / attendance.length * 100 : null
    });
  }

  // PATCH /api/school/{school_id}/report-cards/{card_id}
  function updateReportCard(schoolId, cardId, payload) {
    var d = db();
    var card = byId(d.report_cards, cardId);
    if (!card) return reject(404, 'No report card ' + cardId);
    if (card.status === 'published') {
      return reject(409, 'That card is published. Comments cannot change under a guardian who has already read it.');
    }
    if (payload.teacher_comment !== undefined) card.teacher_comment = String(payload.teacher_comment).trim();
    if (payload.principal_comment !== undefined) card.principal_comment = String(payload.principal_comment).trim();
    persist();
    return resolve(card);
  }

  // POST /api/school/{school_id}/report-cards/publish
  /**
   * A card cannot go out while any result feeding it is unverified. The refusal
   * names the subjects, because "publish is greyed out" is not an explanation
   * anyone can act on.
   */
  /**
   * Take a whole class's cards back.
   *
   * Publishing is deliberately hard to undo — a published card is what a family
   * has already read. But "cannot be undone" is not the same as "must never be
   * undone": a mark goes out wrong, a class is published a week early, a
   * dispute is opened. A school with no way back publishes nothing, or
   * publishes and lies about it. So the way back is explicit and separate from
   * the ordinary edit path: you have to mean it.
   */
  function withdrawReportCardsFor(schoolId, payload) {
    if (!payload || !payload.classId) return reject(422, 'Choose a class to withdraw.');
    var d = db();
    var termId = payload.termId || d.current_term_id;
    var cards = d.report_cards.filter(function (c) {
      return c.school_id === schoolId && c.class_id === payload.classId &&
             c.term_id === termId && c.status === 'published';
    });
    cards.forEach(function (c) { c.status = 'draft'; c.published_at = null; });
    persist();
    return resolve({ class_id: payload.classId, term_id: termId, withdrawn: cards.length });
  }

  function publishReportCardsFor(schoolId, payload) {
    if (!payload || !payload.classId) return reject(422, 'Choose a class to publish.');
    var d = db();
    var termId = payload.termId || d.current_term_id;
    var cards = d.report_cards.filter(function (c) {
      return c.school_id === schoolId && c.class_id === payload.classId &&
             c.term_id === termId && c.status === 'draft';
    });
    if (!cards.length) return reject(422, 'There are no draft cards for that class this term.');

    var blocked = [];
    cards.forEach(function (c) {
      var unverified = d.exam_results.filter(function (r) {
        return r.exam_id === c.exam_id && r.student_id === c.student_id && !r.verified;
      });
      if (unverified.length) {
        var s = byId(d.students, c.student_id);
        blocked.push({
          card_id: c.id, student_id: c.student_id,
          student_name: s ? s.name : c.student_id,
          subjects: unverified.map(function (r) {
            var sub = byId(d.subjects, r.subject_id);
            return sub ? sub.name : r.subject_id;
          })
        });
      }
    });

    if (blocked.length) {
      var subjects = {};
      blocked.forEach(function (b) { b.subjects.forEach(function (n) { subjects[n] = (subjects[n] || 0) + 1; }); });
      var named = Object.keys(subjects).sort();
      var e = new Error(blocked.length + ' of ' + cards.length + ' cards have results that nobody has verified. ' +
        'Unverified subjects: ' + named.join(', ') + '. ' +
        'Verify those marks on the results page, then publish.');
      e.status = 409;
      e.blocked = blocked;
      e.subjects = named;
      return Promise.reject(e);
    }

    var stamp = (payload.date || d.today) + 'T16:00:00+03:00';
    cards.forEach(function (c) {
      c.status = 'published';
      c.published_at = stamp;
      c.published_by = payload.publishedBy || 'tch-06';
    });
    persist();
    return resolve({ class_id: payload.classId, term_id: termId,
                     published: cards.length, published_at: stamp });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Teacher scope
  //
  // A teacher sees only the classes and subjects they are assigned to. This is
  // enforced HERE, not in the page: a page-level filter is a UI convenience,
  // and anything that opens a console can step around it. Asking for a class
  // you do not teach returns exactly what asking for a class that does not
  // exist returns — a 404 — so the refusal leaks nothing either.
  // ══════════════════════════════════════════════════════════════════════

  function assignmentsOf(teacherId) {
    return db().assignments.filter(function (a) { return a.teacher_id === teacherId; });
  }
  function teacherClassIds(teacherId) {
    var d = db();
    var ids = assignmentsOf(teacherId).map(function (a) { return a.class_id; });
    // a class teacher owns their register whether or not they teach the class
    d.classes.forEach(function (c) { if (c.class_teacher_id === teacherId) ids.push(c.id); });
    return ids.filter(function (v, i, arr) { return arr.indexOf(v) === i; });
  }
  function teaches(teacherId, classId, subjectId) {
    var d = db();
    if (subjectId) {
      return assignmentsOf(teacherId).some(function (a) {
        return a.class_id === classId && a.subject_id === subjectId;
      });
    }
    return teacherClassIds(teacherId).indexOf(classId) !== -1;
  }
  /** The refusal a teacher gets for anything outside their scope. */
  function outOfScope(what, id) {
    return reject(404, 'No ' + what + ' ' + id);
  }
  function requireTeacher(teacherId) {
    var t = byId(db().teachers, teacherId);
    return t ? null : reject(404, 'No teacher ' + teacherId);
  }

  // GET /api/school/{school_id}/teachers/{teacher_id}/classes
  function listTeacherClasses(schoolId, teacherId) {
    var missing = requireTeacher(teacherId);
    if (missing) return missing;
    var d = db();
    var ids = teacherClassIds(teacherId);
    return resolve(d.classes.filter(function (c) { return ids.indexOf(c.id) !== -1; })
      .map(function (c) {
        var mine = assignmentsOf(teacherId).filter(function (a) { return a.class_id === c.id; });
        return {
          id: c.id, full_name: c.full_name, level: c.level, sort_order: c.sort_order, room: c.room,
          roll: d.students.filter(function (s) { return s.class_id === c.id && s.status === 'active'; }).length,
          is_class_teacher: c.class_teacher_id === teacherId,
          subjects: mine.map(function (a) {
            var sub = byId(d.subjects, a.subject_id);
            return { id: a.subject_id, name: sub ? sub.name : a.subject_id };
          })
        };
      }).sort(function (a, b) { return a.sort_order - b.sort_order; }));
  }

  // GET /api/school/{school_id}/teachers/{teacher_id}/timetable
  function getTeacherTimetable(schoolId, teacherId, opts) {
    opts = opts || {};
    var missing = requireTeacher(teacherId);
    if (missing) return missing;
    var d = db();
    var rows = d.timetable.filter(function (t) {
      return t.school_id === schoolId && t.teacher_id === teacherId &&
             (!opts.day || t.day === opts.day);
    }).map(function (t) {
      var c = byId(d.classes, t.class_id), sub = byId(d.subjects, t.subject_id);
      return Object.assign({}, t, {
        class_name: c ? c.full_name : t.class_id,
        subject_name: sub ? sub.name : t.subject_id
      });
    });
    rows.sort(function (a, b) { return a.day - b.day || a.period - b.period; });
    return resolve({
      teacher_id: teacherId, days: d.days_of_week, periods: d.periods,
      items: rows, total: rows.length,
      periods_per_week: rows.length
    });
  }

  // GET /api/school/{school_id}/teachers/{teacher_id}/dashboard
  function getTeacherDashboard(schoolId, teacherId, opts) {
    opts = opts || {};
    var missing = requireTeacher(teacherId);
    if (missing) return missing;
    var d = db();
    var today = opts.date || d.today;
    var weekday = new Date(today + 'T00:00:00Z').getUTCDay();
    var teacher = byId(d.teachers, teacherId);
    var ids = teacherClassIds(teacherId);

    var periods = d.timetable.filter(function (t) {
      return t.teacher_id === teacherId && t.day === weekday;
    }).map(function (t) {
      var c = byId(d.classes, t.class_id), sub = byId(d.subjects, t.subject_id);
      return Object.assign({}, t, {
        class_name: c ? c.full_name : t.class_id,
        subject_name: sub ? sub.name : t.subject_id
      });
    }).sort(function (a, b) { return a.period - b.period; });

    // registers this teacher is responsible for, and whether they are in
    var registers = d.classes.filter(function (c) { return c.class_teacher_id === teacherId; })
      .map(function (c) {
        var marked = d.attendance.filter(function (a) { return a.class_id === c.id && a.date === today; });
        return {
          class_id: c.id, class_name: c.full_name,
          roll: d.students.filter(function (s) { return s.class_id === c.id && s.status === 'active'; }).length,
          marked: marked.length > 0,
          present: marked.filter(function (a) { return a.status === 'present' || a.status === 'late'; }).length,
          absent: marked.filter(function (a) { return a.status === 'absent' || a.status === 'excused'; }).length,
          marked_at: marked.length ? marked[0].marked_at : null
        };
      });

    // marks still owed, per assignment, for every exam that is open
    var openExams = d.exams.filter(function (e) { return e.term_id === d.current_term_id; });
    var outstanding = [];
    assignmentsOf(teacherId).forEach(function (a) {
      openExams.forEach(function (e) {
        if (e.class_ids.indexOf(a.class_id) === -1) return;
        var roll = d.students.filter(function (s) { return s.class_id === a.class_id && s.status === 'active'; }).length;
        var entered = d.exam_results.filter(function (r) {
          return r.exam_id === e.id && r.class_id === a.class_id && r.subject_id === a.subject_id;
        });
        if (entered.length >= roll) return;
        var c = byId(d.classes, a.class_id), sub = byId(d.subjects, a.subject_id);
        outstanding.push({
          exam_id: e.id, exam_name: e.name, deadline: e.ends_on,
          class_id: a.class_id, class_name: c ? c.full_name : a.class_id,
          subject_id: a.subject_id, subject_name: sub ? sub.name : a.subject_id,
          entered: entered.length, roll: roll, missing: roll - entered.length
        });
      });
    });
    outstanding.sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; });

    return resolve({
      teacher_id: teacherId,
      teacher_name: teacher ? teacher.name : '—',
      date: today,
      periods: periods,
      registers: registers,
      registers_outstanding: registers.filter(function (r) { return !r.marked; }).length,
      marks_outstanding: outstanding,
      class_count: ids.length,
      announcements: d.announcements.filter(function (a) {
        return a.audience === 'all' || a.audience === 'staff';
      }).slice(0, 4)
    });
  }

  // GET /api/school/{school_id}/teachers/{teacher_id}/classes/{class_id}/register
  function getTeacherRegister(schoolId, teacherId, classId, opts) {
    var missing = requireTeacher(teacherId);
    if (missing) return missing;
    if (!teaches(teacherId, classId)) return outOfScope('class', classId);
    return getClassRegister(schoolId, classId, opts);
  }

  // POST /api/school/{school_id}/teachers/{teacher_id}/classes/{class_id}/attendance
  function markTeacherAttendance(schoolId, teacherId, classId, payload) {
    var missing = requireTeacher(teacherId);
    if (missing) return missing;
    if (!teaches(teacherId, classId)) return outOfScope('class', classId);
    return markAttendance(schoolId, classId, Object.assign({}, payload, { markedBy: teacherId }));
  }

  // GET /api/school/{school_id}/teachers/{teacher_id}/exams/{exam_id}/mark-sheet
  function getTeacherMarkSheet(schoolId, teacherId, examId, opts) {
    opts = opts || {};
    var missing = requireTeacher(teacherId);
    if (missing) return missing;
    if (!teaches(teacherId, opts.classId, opts.subjectId)) return outOfScope('class', opts.classId);
    return getMarkSheet(schoolId, examId, opts);
  }

  // PUT /api/school/{school_id}/teachers/{teacher_id}/exams/{exam_id}/results
  function saveTeacherResults(schoolId, teacherId, examId, payload) {
    payload = payload || {};
    var missing = requireTeacher(teacherId);
    if (missing) return missing;
    if (!teaches(teacherId, payload.classId, payload.subjectId)) return outOfScope('class', payload.classId);
    return saveExamResults(schoolId, examId, Object.assign({}, payload, { enteredBy: teacherId }));
  }

  // ══════════════════════════════════════════════════════════════════════
  // Parent scope
  //
  // A guardian sees only children they are a guardian of, only PUBLISHED report
  // cards and only VERIFIED results. The same reasoning as the teacher scope:
  // the page is not the control.
  // ══════════════════════════════════════════════════════════════════════

  /**
   * The backend has one guardian row per (guardian, student) and no shared
   * identity between them — school.py:107, :449. So "the same human across
   * several children" is matched on a normalised phone number rather than on
   * an id we invented. It is weaker than a join and we know it: a proper
   * guardians table with a person key is schema change #15 in
   * docs/BACKEND-PATCHES.md, not something the client should paper over.
   */
  function normalisePhone(v) {
    var digits = String(v || '').replace(/\D/g, '');
    if (digits.indexOf('254') === 0) digits = '0' + digits.slice(3);
    return digits.slice(-9);
  }
  function guardianRows(personId) {
    var key = normalisePhone(personId);
    if (!key) return [];
    return db().guardians.filter(function (g) { return normalisePhone(g.phone) === key; });
  }
  function childIds(personId) {
    return guardianRows(personId).map(function (g) { return g.student_id; });
  }
  function guards(personId, studentId) {
    return childIds(personId).indexOf(studentId) !== -1;
  }

  // GET /api/school/{school_id}/guardians/{person_id}/children
  function listMyChildren(schoolId, personId) {
    var d = db();
    var rows = guardianRows(personId);
    if (!rows.length) return reject(404, 'No guardian ' + personId);
    return resolve(rows.map(function (g) {
      var s = byId(d.students, g.student_id);
      var c = s ? byId(d.classes, s.class_id) : null;
      var invoices = d.invoices.filter(function (i) {
        return i.student_id === g.student_id && i.term_id === d.current_term_id;
      });
      var att = d.attendance.filter(function (a) { return a.student_id === g.student_id; });
      var here = att.filter(function (a) { return a.status === 'present' || a.status === 'late'; }).length;
      var published = d.report_cards.filter(function (r) {
        return r.student_id === g.student_id && r.status === 'published';
      });
      return {
        student_id: g.student_id,
        name: s ? s.name : '—', admission_no: s ? s.admission_no : '—',
        gender: s ? s.gender : null,
        class_id: s ? s.class_id : null, class_name: c ? c.full_name : '—',
        relationship: g.relationship, is_primary: g.is_primary,
        balance: invoices.reduce(function (n, i) { return n + i.balance; }, 0),
        invoiced: invoices.reduce(function (n, i) { return n + i.amount_due; }, 0),
        attendance_percentage: att.length ? here / att.length * 100 : null,
        published_cards: published.length
      };
    }));
  }

  // GET /api/school/{school_id}/guardians/{person_id}/children/{student_id}/fees
  function getChildFees(schoolId, personId, studentId) {
    if (!guards(personId, studentId)) return outOfScope('student', studentId);
    var d = db();
    var s = byId(d.students, studentId);
    var invoices = d.invoices.filter(function (i) { return i.student_id === studentId; })
      .map(function (i) {
        var t = byId(d.terms, i.term_id);
        return Object.assign({}, i, { term_name: t ? t.name + ' ' + t.year : i.term_id });
      });
    var payments = d.payments.filter(function (p) { return p.student_id === studentId; })
      .slice().sort(function (a, b) { return a.paid_at < b.paid_at ? 1 : -1; });
    return resolve({
      student_id: studentId, student_name: s ? s.name : '—',
      paybill: d.school.paybill, account_ref: s ? s.admission_no : '—',
      invoices: invoices, payments: payments,
      balance: invoices.reduce(function (n, i) { return n + i.balance; }, 0),
      invoiced: invoices.reduce(function (n, i) { return n + i.amount_due; }, 0),
      paid: invoices.reduce(function (n, i) { return n + i.amount_paid; }, 0)
    });
  }

  // GET /api/school/{school_id}/guardians/{person_id}/children/{student_id}/attendance
  function getChildAttendance(schoolId, personId, studentId, opts) {
    if (!guards(personId, studentId)) return outOfScope('student', studentId);
    opts = opts || {};
    var d = db();
    var rows = d.attendance.filter(function (a) { return a.student_id === studentId; })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var here = rows.filter(function (a) { return a.status === 'present' || a.status === 'late'; }).length;
    var count = function (st) { return rows.filter(function (a) { return a.status === st; }).length; };
    return resolve({
      student_id: studentId, items: rows, days: rows.length,
      present: count('present'), absent: count('absent'),
      late: count('late'), excused: count('excused'),
      percentage: rows.length ? here / rows.length * 100 : null
    });
  }

  /**
   * PUBLISHED cards and VERIFIED results only. An unverified mark is one nobody
   * has checked; a draft card is one the head has not signed. Neither belongs in
   * front of a parent, and neither is filtered out on the page.
   */
  // GET /api/school/{school_id}/guardians/{person_id}/children/{student_id}/results
  function getChildResults(schoolId, personId, studentId) {
    if (!guards(personId, studentId)) return outOfScope('student', studentId);
    var d = db();
    var cards = d.report_cards.filter(function (c) {
      return c.student_id === studentId && c.status === 'published';
    });
    var out = cards.map(function (c) {
      var exam = byId(d.exams, c.exam_id);
      var results = d.exam_results.filter(function (r) {
        return r.student_id === studentId && r.exam_id === c.exam_id && r.verified;
      }).map(function (r) {
        var sub = byId(d.subjects, r.subject_id);
        return {
          subject_id: r.subject_id, subject_name: sub ? sub.name : r.subject_id,
          score: r.score, grade: r.grade, points: r.points, remark: r.remark,
          comment: r.comment, max_score: r.max_score
        };
      }).sort(function (a, b) { return a.subject_name.localeCompare(b.subject_name); });
      return {
        card_id: c.id, exam_id: c.exam_id, exam_name: exam ? exam.name : c.exam_id,
        term_id: c.term_id,
        total_marks: c.total_marks, average: c.average, grade: c.grade,
        position: c.position, class_size: c.class_size,
        teacher_comment: c.teacher_comment, principal_comment: c.principal_comment,
        published_at: c.published_at,
        results: results
      };
    });
    var s = byId(d.students, studentId);
    return resolve({ student_id: studentId, student_name: s ? s.name : '—', cards: out, total: out.length });
  }

  // GET /api/school/{school_id}/guardians/{person_id}/messages
  function getGuardianMessages(schoolId, personId) {
    var d = db();
    if (!guardianRows(personId).length) return reject(404, 'No guardian ' + personId);
    var rows = d.announcements.filter(function (a) {
      return a.school_id === schoolId && (a.audience === 'all' || a.audience === 'guardians');
    }).slice().sort(function (a, b) { return a.posted_at < b.posted_at ? 1 : -1; });
    var events = d.events.filter(function (e) { return e.school_id === schoolId; });
    return resolve({ items: rows, total: rows.length, events: events });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Guardian portal — the tokenised public surface
  // ══════════════════════════════════════════════════════════════════════

  var GUARDIAN_KEY_IS_PHONE = true;

  var PORTAL_STATES = { OK: 'ok', UNKNOWN: 'unknown', EXPIRED: 'expired', REVOKED: 'revoked' };

  // POST /api/school/{school_id}/students/{student_id}/guardian-token
  function issueGuardianToken(schoolId, studentId, payload) {
    payload = payload || {};
    var d = db();
    var s = byId(d.students, studentId);
    if (!s) return reject(404, 'No student ' + studentId);
    var guardian = payload.guardianId
      ? byId(d.guardians, payload.guardianId)
      : d.guardians.filter(function (g) { return g.student_id === studentId && g.is_primary; })[0];
    if (!guardian) return reject(422, 'That pupil has no guardian to send a link to.');
    if (guardian.student_id !== studentId) {
      return reject(422, 'That guardian is not on this pupil’s record.');
    }
    var days = Number(payload.days) || 30;
    if (days < 1 || days > 180) return reject(422, 'A portal link lasts between 1 and 180 days.');

    var token = 'gp-' + hash32(studentId + '|' + guardian.id + '|' + d.guardian_tokens.length + '|' + d.today);
    var row = {
      // A link needs an identity separate from the secret. Without one, the
      // only handle a caller has on a link is the link itself, so revoking one
      // means sending the working credential back over the wire to say which
      // to kill.
      id: 'gtk-' + String(d.guardian_tokens.length + 1).padStart(5, '0'),
      token: token, school_id: schoolId,
      student_id: studentId, guardian_id: guardian.id,
      issued_to: guardian.phone, issued_by: payload.issuedBy || 'tch-06',
      created_at: d.today + 'T09:00:00+03:00',
      expires_at: shiftDay(d.today, days),
      revoked: false, uses: 0, last_used_at: null
    };
    d.guardian_tokens.push(row);
    persist();
    return resolve(Object.assign({}, row, {
      guardian_name: guardian.name,
      student_name: s.name,
      url: 'portal.html?token=' + token
    }));
  }
  /** Small deterministic hash, so a demo token looks like a token. */
  function hash32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // GET /api/school/guardian-portal/{token}
  /**
   * Resolves to exactly one child. An unknown, revoked or expired token returns
   * a state and nothing else — never a partial record, never another pupil.
   */
  function getGuardianPortal(token, opts) {
    opts = opts || {};
    var d = db();
    var row = d.guardian_tokens.filter(function (t) { return t.token === token; })[0];
    if (!row) {
      return resolve({ state: PORTAL_STATES.UNKNOWN, token: token || null,
                       message: 'This link is not one we issued. Ask the school office for a new one.' });
    }
    if (row.revoked) {
      return resolve({ state: PORTAL_STATES.REVOKED, token: token,
                       message: 'This link has been withdrawn by the school. Ask the office for a new one.' });
    }
    var today = opts.asOf || d.today;
    if (row.expires_at < today) {
      return resolve({ state: PORTAL_STATES.EXPIRED, token: token, expired_on: row.expires_at,
                       message: 'This link expired on ' + row.expires_at +
                                '. Reply to the school SMS or call the office for a fresh one.' });
    }

    var s = byId(d.students, row.student_id);
    if (!s) {
      return resolve({ state: PORTAL_STATES.UNKNOWN, token: token,
                       message: 'This link points at a record that is no longer on the roll.' });
    }
    var cls = byId(d.classes, s.class_id);
    var guardian = byId(d.guardians, row.guardian_id);
    var term = byId(d.terms, d.current_term_id);

    var invoices = d.invoices.filter(function (i) { return i.student_id === s.id; })
      .map(function (i) {
        var t = byId(d.terms, i.term_id);
        return {
          id: i.id, term_name: t ? t.name + ' ' + t.year : i.term_id,
          items: i.items, amount_due: i.amount_due, amount_paid: i.amount_paid,
          balance: i.balance, due_date: i.due_date, status: i.status
        };
      });
    var payments = d.payments.filter(function (p) { return p.student_id === s.id; })
      .slice().sort(function (a, b) { return a.paid_at < b.paid_at ? 1 : -1; })
      .slice(0, 6)
      .map(function (p) {
        return { amount: p.amount, method: p.method, reference: p.reference || p.mpesa_code, paid_at: p.paid_at };
      });

    var attendance = d.attendance.filter(function (a) { return a.student_id === s.id; })
      .slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var recent = attendance.slice(0, 20).reverse()
      .map(function (a) { return { date: a.date, status: a.status }; });
    var here = attendance.filter(function (a) { return a.status === 'present' || a.status === 'late'; }).length;

    var cards = d.report_cards.filter(function (c) {
      return c.student_id === s.id && c.status === 'published';
    }).map(function (c) {
      var exam = byId(d.exams, c.exam_id);
      return {
        exam_name: exam ? exam.name : c.exam_id,
        total_marks: c.total_marks, average: c.average, grade: c.grade,
        position: c.position, class_size: c.class_size,
        teacher_comment: c.teacher_comment,
        published_at: c.published_at,
        subjects: d.exam_results.filter(function (r) {
          return r.student_id === s.id && r.exam_id === c.exam_id && r.verified;
        }).map(function (r) {
          var sub = byId(d.subjects, r.subject_id);
          return { subject_name: sub ? sub.name : r.subject_id, score: r.score, grade: r.grade, remark: r.remark };
        }).sort(function (a, b) { return a.subject_name.localeCompare(b.subject_name); })
      };
    });

    row.uses += 1;
    row.last_used_at = today + 'T00:00:00+03:00';
    persist();

    return resolve({
      state: PORTAL_STATES.OK,
      token: token,
      expires_at: row.expires_at,
      school: { name: d.school.name, phone: d.school.phone, email: d.school.email,
                paybill: d.school.paybill, address: d.school.address, motto: d.school.motto },
      term_name: term ? term.name + ' ' + term.year : '—',
      guardian: guardian ? { name: guardian.name, relationship: guardian.relationship } : null,
      student: {
        id: s.id, name: s.name, admission_no: s.admission_no,
        class_name: cls ? cls.full_name : '—'
      },
      fees: {
        invoices: invoices, payments: payments,
        balance: invoices.reduce(function (n, i) { return n + i.balance; }, 0),
        invoiced: invoices.reduce(function (n, i) { return n + i.amount_due; }, 0),
        paid: invoices.reduce(function (n, i) { return n + i.amount_paid; }, 0)
      },
      attendance: {
        recent: recent, days: attendance.length,
        percentage: attendance.length ? here / attendance.length * 100 : null
      },
      results: cards
    });
  }

  // GET /api/school/{school_id}/students/{student_id}/guardian-tokens
  function listGuardianTokens(schoolId, studentId) {
    var d = db();
    var rows = d.guardian_tokens.filter(function (t) {
      return t.school_id === schoolId && t.student_id === studentId;
    }).map(function (t) {
      var g = byId(d.guardians, t.guardian_id);
      return Object.assign({}, t, {
        guardian_name: g ? g.name : '—',
        active: !t.revoked && t.expires_at >= d.today,
        url: 'portal.html?token=' + t.token
      });
    });
    return resolve(rows);
  }

  /**
   * E24 — stop a link now.
   *
   * A guardian link is a bearer credential with no password behind it: whoever
   * holds the URL is the parent. Forwarded to a WhatsApp group it stayed valid
   * for the rest of its ninety days, and there was nothing anybody could do.
   *
   * Revoking twice is a no-op that says so, not an error: the second click
   * comes from someone who wanted the link dead, and it is.
   */
  function revokeGuardianToken(schoolId, tokenId) {
    var d = db();
    if (!tokenId) return reject(422, 'Name the link to revoke.');
    var t = d.guardian_tokens.filter(function (x) {
      return x.school_id === schoolId && (x.id === tokenId || x.token === tokenId);
    })[0];
    if (!t) return reject(404, 'No link ' + tokenId);
    if (t.revoked) {
      return resolve({ id: t.id, state: 'revoked', already: true,
                       message: 'That link was already revoked. Nothing changed.' });
    }
    t.revoked = true;
    t.revoked_at = d.today;
    persist();
    return resolve({ id: t.id, state: 'revoked', already: false });
  }

  // ── session, for the demo ──────────────────────────────────────────────────
  //
  // The demo has no accounts and no passwords: it is a fixed school anyone can
  // look at. Signing in picks which of the three surfaces to show, and says so
  // plainly rather than pretending to check a credential.
  function login(identifier, password, opts) {
    var who = String(identifier || '').trim();
    if (!who) return reject(422, 'Enter your email address.');
    // The demo has no accounts, so the surface the visitor asked for is the
    // only thing that can decide which one they get. The live backend ignores
    // this and reads the role off the account — a parent choosing the admin
    // tab must not be handed a bursar's screens.
    var asked = opts && opts.role;
    var role = ['admin', 'teacher', 'parent'].indexOf(asked) !== -1 ? asked
             : /parent|guardian|^0[17]/.test(who.toLowerCase()) ? 'parent'
             : /teacher|tch/.test(who.toLowerCase()) ? 'teacher' : 'admin';
    var user = {
      id: 'demo-' + role, email: who, full_name: 'Demo ' + role,
      role_name: role, tenant_id: 'demo-tenant', is_super_admin: false,
      demo: true
    };
    try {
      global.localStorage.setItem('shule.user', JSON.stringify(user));
      global.localStorage.setItem('shule.role', role);
    } catch (e) { /* private mode: the shell falls back to admin */ }
    return resolve({ user: user, requires_2fa: false, demo: true });
  }

  function getMe() {
    try {
      var u = JSON.parse(global.localStorage.getItem('shule.user') || 'null');
      if (u) return resolve(u);
    } catch (e) { /* fall through */ }
    return resolve({ id: 'demo-admin', full_name: 'Demo admin', role_name: 'admin', demo: true });
  }

  function logout() {
    try {
      global.localStorage.removeItem('shule.user');
      global.localStorage.removeItem('shule.role');
    } catch (e) { /* nothing to clear */ }
    return resolve({ ok: true });
  }

  function hasSession() {
    try { return !!global.localStorage.getItem('shule.user'); } catch (e) { return false; }
  }

  function currentUser() {
    try { return JSON.parse(global.localStorage.getItem('shule.user') || 'null'); }
    catch (e) { return null; }
  }

  function register() {
    return reject(501, 'This is the demo. Registering a school needs the real system.');
  }
  function verifyEmail() {
    return reject(501, 'This is the demo. There is no address to confirm.');
  }
  function resendVerification() {
    return reject(501, 'This is the demo. There is no address to confirm.');
  }

  // ── integrations, in the demo ──────────────────────────────────────────────
  //
  // Nothing is connected and nothing can be: the demo has no server to hold a
  // credential and no Daraja to test one against. It says so, rather than
  // offering a form that appears to work.
  var DEMO_PROVIDERS = [
    { provider: 'mpesa',  label: 'M-Pesa (Daraja)',
      purpose: 'Take school fees by STK push and receive paybill confirmations.',
      required: ['consumer_key', 'consumer_secret', 'shortcode', 'passkey'] },
    { provider: 'resend', label: 'Resend (email)',
      purpose: 'Send report cards, invoices, receipts and password resets by email.',
      required: ['api_key', 'from_email'] },
    { provider: 'sms',    label: 'SMS',
      purpose: 'Fee reminders and absence alerts by SMS.',
      required: ['api_key', 'sender_id'] },
    { provider: 'etims',  label: 'eTIMS (KRA)',
      purpose: 'Electronic tax invoices for fee receipts.',
      required: ['pin', 'branch_id', 'device_serial'] }
  ];

  function listIntegrations() {
    return resolve({
      items: DEMO_PROVIDERS.map(function (p) {
        return Object.assign({}, p, {
          status: 'not_connected', missing: p.required, config: {},
          where_to_find: 'Connecting a provider needs the real system.',
          demo: true
        });
      }),
      encryption: 'off',
      demo: true
    });
  }
  function saveIntegration() {
    return reject(501, 'This is the demo. Connecting M-Pesa or email needs the real system.');
  }
  function testIntegration() {
    return reject(501, 'This is the demo. There is nothing to test a credential against.');
  }
  function disconnectIntegration() {
    return reject(501, 'This is the demo. Nothing is connected.');
  }
  function getSubscription() {
    return resolve({ plan_name: 'Demo', plan_slug: 'demo', status: 'trial',
                     price_kes: 0, active_modules: ['school'], demo: true });
  }
  function listPlans() { return resolve([]); }

  global.DemoBackend = {
    listIntegrations: listIntegrations,
    saveIntegration: saveIntegration,
    testIntegration: testIntegration,
    disconnectIntegration: disconnectIntegration,
    getSubscription: getSubscription,
    listPlans: listPlans,
    login: login,
    getMe: getMe,
    logout: logout,
    hasSession: hasSession,
    currentUser: currentUser,
    register: register,
    verifyEmail: verifyEmail,
    resendVerification: resendVerification,
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
    // grading scales
    listGradingScaleRows: listGradingScaleRows,
    createGradingScale: createGradingScale,
    updateGradingScale: updateGradingScale,
    deleteGradingScale: deleteGradingScale,
    setDefaultGradingScale: setDefaultGradingScale,
    validateBands: validateBands,
    // attendance
    getClassRegister: getClassRegister,
    getAttendanceReport: getAttendanceReport,
    getAbsentees: getAbsentees,
    // exams and results
    listExamRows: listExamRows,
    createExam: createExam,
    updateExam: updateExam,
    getMarkSheet: getMarkSheet,
    saveExamResults: saveExamResults,
    verifyExamResults: verifyExamResults,
    getClassAnalysis: getClassAnalysis,
    getMeritList: getMeritList,
    EXAM_TYPES: EXAM_TYPES,
    // report cards
    generateReportCards: generateReportCards,
    listReportCardRows: listReportCardRows,
    getReportCard: getReportCard,
    updateReportCard: updateReportCard,
    publishReportCardsFor: publishReportCardsFor,
    withdrawReportCardsFor: withdrawReportCardsFor,
    // teacher scope
    listTeacherClasses: listTeacherClasses,
    getTeacherTimetable: getTeacherTimetable,
    getTeacherDashboard: getTeacherDashboard,
    getTeacherRegister: getTeacherRegister,
    markTeacherAttendance: markTeacherAttendance,
    getTeacherMarkSheet: getTeacherMarkSheet,
    saveTeacherResults: saveTeacherResults,
    // parent scope
    listMyChildren: listMyChildren,
    getChildFees: getChildFees,
    getChildAttendance: getChildAttendance,
    getChildResults: getChildResults,
    getGuardianMessages: getGuardianMessages,
    // guardian portal
    issueGuardianToken: issueGuardianToken,
    listGuardianTokens: listGuardianTokens,
    revokeGuardianToken: revokeGuardianToken,
    getGuardianPortal: getGuardianPortal,
    PORTAL_STATES: PORTAL_STATES,
    normalisePhone: normalisePhone,
    GUARDIAN_KEY_IS_PHONE: GUARDIAN_KEY_IS_PHONE,
    // waivers
    listWaiverRows: listWaiverRows,
    createWaiver: createWaiver,
    approveWaiver: approveWaiver,
    rejectWaiver: rejectWaiver,
    // store
    STORE_KEY: STORE_KEY,
    resetStore: resetStore,
    persist: persist,
    _store: db
  };
})(typeof window !== 'undefined' ? window : globalThis);
