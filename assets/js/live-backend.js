/**
 * Shule — live FastAPI backend adapter.
 *
 * Implements the same surface as demo-backend.js over HTTP, so api.js does not
 * change and pages do not know the difference:
 *
 *     <script src="assets/js/live-backend.js"></script>
 *     <script>window.SHULE_BACKEND = window.ShuleLiveBackend;</script>
 *     <script src="assets/js/api.js"></script>
 *
 * Every path below is taken from backend/routers/school.py, which mounts at
 * /api/school (main.py:398). Where our route comment in api.js and the real
 * path disagree, the real path wins and the divergence is noted inline — the
 * route comment is the contract, and this file is where it is honoured.
 *
 * IMPORTANT: this adapter does not add guards the backend is missing. If the
 * backend accepts an over-payment, this passes it through and the contract test
 * fails. A client-side guard here would hide exactly the bug we are surfacing.
 */
(function (global) {
  'use strict';

  var CONFIG = {
    baseUrl: global.SHULE_API_BASE || '/api',
    timeoutMs: Number(global.SHULE_API_TIMEOUT) || 15000,
    tokenKey: 'shule.jwt',
    refreshKey: 'shule.refresh',
    loginPage: 'login.html'
  };

  // ── session ───────────────────────────────────────────────────────────
  function store() {
    try { return global.localStorage; } catch (e) { return null; }
  }
  function getToken() {
    if (global.SHULE_API_TOKEN) return global.SHULE_API_TOKEN;
    var s = store();
    try { return s ? s.getItem(CONFIG.tokenKey) : null; } catch (e) { return null; }
  }
  function setSession(access, refresh) {
    var s = store();
    if (!s) return;
    try {
      if (access) s.setItem(CONFIG.tokenKey, access);
      if (refresh) s.setItem(CONFIG.refreshKey, refresh);
    } catch (e) { /* private mode: the token lives for this page only */ }
  }
  function clearSession() {
    var s = store();
    if (!s) return;
    try { s.removeItem(CONFIG.tokenKey); s.removeItem(CONFIG.refreshKey); } catch (e) { /* nothing to clear */ }
  }
  function toLogin() {
    clearSession();
    if (global.location && global.location.assign) {
      var depth = (global.location.pathname.split('/app/')[1] || '').split('/').length - 1;
      global.location.assign('../'.repeat(depth + 1) + CONFIG.loginPage);
    }
  }

  // ── errors the pages already handle ───────────────────────────────────
  /**
   * Pages expect `err.status` and a message they can put in front of a person.
   * A 500 rendered as an empty table is the failure mode this exists to stop.
   */
  function apiError(status, message, body) {
    var e = new Error(message);
    e.status = status;
    if (body && body.detail) {
      if (Array.isArray(body.detail)) {
        // FastAPI validation errors: name the field, not the schema path
        e.message = body.detail.map(function (d) {
          return (d.loc || []).slice(-1)[0] + ': ' + d.msg;
        }).join('; ');
      } else if (typeof body.detail === 'string') {
        e.message = body.detail;
      }
    }
    e.body = body;
    return e;
  }
  var OFFLINE = 0;
  function offlineError() {
    var e = new Error('Cannot reach the school system. You appear to be offline — ' +
      'anything you have typed is still on screen. Try again when the connection is back.');
    e.status = OFFLINE;
    e.offline = true;
    return e;
  }
  function setOnline(on) {
    if (!global.document || !global.document.body) return;
    global.document.body.setAttribute('data-connection', on ? 'online' : 'offline');
  }

  // ── transport ─────────────────────────────────────────────────────────
  function url(path, query) {
    var full = CONFIG.baseUrl.replace(/\/$/, '') + '/school' + path;
    var parts = [];
    Object.keys(query || {}).forEach(function (k) {
      var v = query[k];
      if (v === undefined || v === null || v === '') return;
      if (Array.isArray(v)) v.forEach(function (x) { parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(x)); });
      else parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? full + '?' + parts.join('&') : full;
  }

  function once(method, path, opts) {
    opts = opts || {};
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller && global.setTimeout(function () { controller.abort(); }, CONFIG.timeoutMs);

    var headers = { 'Accept': 'application/json' };
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    var init = { method: method, headers: headers };
    if (controller) init.signal = controller.signal;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    if (opts.form) {
      delete headers['Content-Type'];
      init.body = opts.form;
    }

    return global.fetch(url(path, opts.query), init).then(function (res) {
      if (timer) global.clearTimeout(timer);
      setOnline(true);
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { body = { detail: text }; }
        return { res: res, body: body };
      });
    }, function (err) {
      if (timer) global.clearTimeout(timer);
      setOnline(false);
      if (err && err.name === 'AbortError') {
        var t = new Error('The school system did not answer within ' +
          Math.round(CONFIG.timeoutMs / 1000) + ' seconds. The connection may be slow.');
        t.status = 408;
        t.timeout = true;
        throw t;
      }
      throw offlineError();
    });
  }

  var refreshing = null;
  function refresh() {
    if (refreshing) return refreshing;
    var s = store();
    var token = null;
    try { token = s ? s.getItem(CONFIG.refreshKey) : null; } catch (e) { token = null; }
    if (!token) return Promise.reject(apiError(401, 'Your session has ended. Please sign in again.'));
    refreshing = global.fetch(CONFIG.baseUrl.replace(/\/$/, '') + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: token })
    }).then(function (res) {
      refreshing = null;
      if (!res.ok) throw apiError(401, 'Your session has ended. Please sign in again.');
      return res.json();
    }).then(function (body) {
      var next = body.access_token || (body.data && body.data.access_token);
      if (!next) throw apiError(401, 'Your session has ended. Please sign in again.');
      setSession(next, body.refresh_token || (body.data && body.data.refresh_token));
      return next;
    }, function (e) { refreshing = null; throw e; });
    return refreshing;
  }

  /** One retry on 401, then out. A second 401 means the refresh is dead too. */
  function request(method, path, opts) {
    return once(method, path, opts).then(function (r) {
      if (r.res.status !== 401) return unwrap(r, method, path);
      return refresh().then(function () {
        return once(method, path, opts).then(function (r2) {
          if (r2.res.status === 401) { toLogin(); throw apiError(401, 'Your session has ended. Please sign in again.'); }
          return unwrap(r2, method, path);
        });
      }, function (e) { toLogin(); throw e; });
    });
  }

  function unwrap(r, method, path) {
    var status = r.res.status, body = r.body;
    if (status >= 500) {
      throw apiError(status,
        'The school system failed on ' + method + ' ' + path + '. ' +
        'This is a fault at the server, not something you did. Please tell support.', body);
    }
    if (status === 404) throw apiError(404, 'Not found', body);
    if (status === 409) throw apiError(409, 'That conflicts with something already recorded.', body);
    if (status === 422 || status === 400) throw apiError(status, 'That was not accepted.', body);
    if (!r.res.ok) throw apiError(status, 'Request failed (' + status + ').', body);
    // school.py wraps most successes in {success, data, message}
    return body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
  }

  var GET = function (p, q) { return request('GET', p, { query: q }); };
  var POST = function (p, b, q) { return request('POST', p, { body: b, query: q }); };
  var PUT = function (p, b, q) { return request('PUT', p, { body: b, query: q }); };

  function notInBackend(name, row) {
    return function () {
      var e = new Error(name + ' has no route in school.py. ' +
        'See docs/RULES_RECONCILED.md row ' + row + ' and docs/BACKEND-PATCHES.md.');
      e.status = 501;
      e.missingRoute = name;
      return Promise.reject(e);
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // People
  // ══════════════════════════════════════════════════════════════════════
  var B = {};

  // GET /api/school/{school_id}/students        (school.py:2242 region)
  B.listStudents = function (schoolId, opts) {
    opts = opts || {};
    return GET('/' + schoolId + '/students',
      { class_id: opts.classId, search: opts.search, page: opts.page, per_page: opts.pageSize });
  };
  B.searchStudents = B.listStudents;
  // GET /api/school/students/{id}
  B.getStudent = function (schoolId, studentId) { return GET('/students/' + studentId); };
  // POST /api/school/students
  B.createStudent = function (schoolId, payload) { return POST('/students', payload); };
  // PUT /api/school/students/{id}
  B.updateStudent = function (schoolId, studentId, payload) { return PUT('/students/' + studentId, payload); };
  // POST /api/school/students/{id}/promote
  B.promoteStudents = function (schoolId, payload) {
    return Promise.all((payload.studentIds || []).map(function (id) {
      return POST('/students/' + id + '/promote', {});
    })).then(function (rows) { return { promoted: rows.length, moved: rows, graduated: 0, skipped: 0 }; });
  };
  // POST /api/school/students/{id}/transfer-out
  B.transferStudent = function (schoolId, studentId, payload) {
    return POST('/students/' + studentId + '/transfer-out', payload);
  };
  // POST /api/school/{school_id}/students/import   (school.py:2242 — multipart, not JSON)
  B.importStudentsCSV = function (schoolId, csvText, opts) {
    if (opts && opts.dryRun) {
      // the backend has no dry run; a preview would have to be client-side and
      // would then disagree with what the server accepts
      return notInBackend('importStudentsCSV(dryRun)', 28)();
    }
    var form = new global.FormData();
    form.append('file', new global.Blob([csvText], { type: 'text/csv' }), 'students.csv');
    return request('POST', '/' + schoolId + '/students/import', { form: form });
  };
  // GET /api/school/{school_id}/classes
  B.listClasses = function (schoolId, opts) { return GET('/' + schoolId + '/classes', opts); };
  // GET /api/school/{school_id}/teachers
  B.listTeachers = function (schoolId) { return GET('/' + schoolId + '/teachers'); };
  // GET /api/school/{school_id}/subjects
  B.listSubjects = function (schoolId) { return GET('/' + schoolId + '/subjects'); };
  // GET /api/school/students/{id}/guardians
  B.listGuardians = function (schoolId, studentId) { return GET('/students/' + studentId + '/guardians'); };
  // POST /api/school/students/{id}/guardians
  B.addGuardian = function (schoolId, studentId, payload) {
    return POST('/students/' + studentId + '/guardians', payload);
  };
  // GET /api/school/students/{id}/discipline
  B.listDiscipline = function (schoolId, opts) {
    return GET('/students/' + (opts && opts.studentId) + '/discipline');
  };
  B.addDiscipline = function (schoolId, studentId, payload) {
    return POST('/students/' + studentId + '/discipline', payload);
  };

  // ══════════════════════════════════════════════════════════════════════
  // Fees
  // ══════════════════════════════════════════════════════════════════════

  // GET /api/school/fee-structures?school_id=     (ours said /{school_id}/fee-structures)
  B.listFeeStructures = function (schoolId, opts) {
    return GET('/fee-structures', { school_id: schoolId, term: opts && opts.termId });
  };
  B.createFeeStructure = function (schoolId, payload) { return POST('/fee-structures', payload); };
  // GET /api/school/fee-invoices?school_id=       (ours said /{school_id}/fee-invoices)
  B.listFeeInvoices = function (schoolId, opts) {
    opts = opts || {};
    return GET('/fee-invoices',
      { school_id: schoolId, status: opts.status, page: opts.page, per_page: opts.pageSize });
  };
  B.listInvoiceRows = B.listFeeInvoices;
  // POST /api/school/fee-invoices/bulk-generate
  B.bulkGenerateInvoices = function (schoolId, payload) {
    return POST('/fee-invoices/bulk-generate', {
      school_id: schoolId, class_id: payload.classId, term: payload.termId,
      due_date: payload.dueDate, structure_id: payload.structureId
    });
  };
  /*
   * POST /api/school/fee-invoices/{id}/pay-with-journal — school.py:1968.
   * Deliberately NOT /pay (:807): that route records the money and posts
   * nothing to the ledger, which breaks RULES row 4 on every payment.
   */
  B.recordPayment = function (schoolId, invoiceId, payload) {
    return POST('/fee-invoices/' + invoiceId + '/pay-with-journal', {
      amount: payload.amount, method: payload.method, reference: payload.reference
    });
  };
  // GET /api/school/fee-invoices/{id}/receipt
  B.getReceipt = function (schoolId, paymentId) {
    return GET('/fee-invoices/' + paymentId + '/receipt');
  };
  // GET /api/school/defaulters?school_id=
  B.listDefaulters = function (schoolId, opts) {
    return GET('/defaulters', { school_id: schoolId, threshold_days: opts && opts.thresholdDays });
  };
  B.listDefaulterRows = B.listDefaulters;
  // POST /api/school/fee-waivers
  B.listWaiverRows = function (schoolId, opts) { return GET('/fee-waivers', { school_id: schoolId, status: opts && opts.status }); };
  // PUT /api/school/fee-waivers/{id}/approve
  B.approveWaiver = function (schoolId, waiverId, payload) {
    return PUT('/fee-waivers/' + waiverId + '/approve', payload || {});
  };
  // POST /api/school/notifications/fee-reminder
  B.sendRemindersFor = function (schoolId, payload) {
    return POST('/notifications/fee-reminder', { school_id: schoolId, invoice_ids: payload.invoiceIds });
  };
  B.sendFeeReminders = function (schoolId, opts) {
    return POST('/notifications/fee-reminder', { school_id: schoolId, class_id: opts && opts.classId });
  };

  // ══════════════════════════════════════════════════════════════════════
  // Academics
  // ══════════════════════════════════════════════════════════════════════

  // GET /api/school/grading-scales?school_id=
  B.listGradingScales = function (schoolId) { return GET('/grading-scales', { school_id: schoolId }); };
  B.listGradingScaleRows = B.listGradingScales;
  B.createGradingScale = function (schoolId, payload) {
    return POST('/grading-scales', { school_id: schoolId, name: payload.name, is_default: false })
      .then(function (scale) {
        return Promise.all((payload.bands || []).map(function (b) {
          return POST('/grading-scales/' + (scale.id || scale.data && scale.data.id) + '/bands', {
            grade: b.grade, min_score: b.min, max_score: b.max, points: b.points, remark: b.remark
          });
        })).then(function () { return scale; });
      });
  };
  // GET /api/school/exams?school_id=
  B.listExams = function (schoolId, opts) { return GET('/exams', { school_id: schoolId, term_id: opts && opts.termId }); };
  B.listExamRows = B.listExams;
  B.createExam = function (schoolId, payload) { return POST('/exams', payload); };
  // GET /api/school/exams/{id}/results
  B.listExamResults = function (schoolId, examId, opts) {
    return GET('/exams/' + examId + '/results', { class_id: opts && opts.classId });
  };
  B.getMarkSheet = function (schoolId, examId, opts) {
    return GET('/exams/' + examId + '/results', { class_id: opts.classId, subject_id: opts.subjectId });
  };
  // POST /api/school/exams/{id}/results
  B.saveExamResults = function (schoolId, examId, payload) {
    return POST('/exams/' + examId + '/results', {
      exam_id: examId, class_id: payload.classId,
      results: (payload.scores || []).filter(function (r) { return r.score !== null && r.score !== undefined; })
        .map(function (r) {
          return { student_id: r.student_id, subject_id: payload.subjectId, score: r.score, teacher_comment: r.comment };
        })
    });
  };
  B.saveTeacherResults = function (schoolId, teacherId, examId, payload) {
    return B.saveExamResults(schoolId, examId, payload);
  };
  // GET /api/school/exams/{id}/class-analysis
  B.getClassAnalysis = function (schoolId, examId, opts) {
    return GET('/exams/' + examId + '/class-analysis', { class_id: opts && opts.classId });
  };
  // GET /api/school/exams/{exam_id}/merit-list
  B.getMeritList = function (schoolId, examId, opts) {
    return GET('/exams/' + examId + '/merit-list', { class_id: opts && opts.classId });
  };
  // GET /api/school/report-cards
  B.listReportCardRows = function (schoolId, opts) {
    return GET('/report-cards', { school_id: schoolId, class_id: opts && opts.classId, status: opts && opts.status });
  };
  B.listReportCards = B.listReportCardRows;
  B.getReportCard = function (schoolId, cardId) { return GET('/report-cards/' + cardId); };
  // POST /api/school/report-cards
  B.generateReportCards = function (schoolId, payload) {
    return POST('/report-cards', { school_id: schoolId, class_id: payload.classId, exam_id: payload.examId, term_id: payload.termId });
  };
  // POST /api/school/report-cards/{id}/publish — one card at a time
  B.publishReportCardsFor = function (schoolId, payload) {
    return B.listReportCardRows(schoolId, { classId: payload.classId, status: 'draft' })
      .then(function (page) {
        var items = page.items || page || [];
        return Promise.all(items.map(function (c) { return POST('/report-cards/' + c.id + '/publish', {}); }))
          .then(function () { return { class_id: payload.classId, published: items.length }; });
      });
  };
  B.publishReportCards = B.publishReportCardsFor;

  // ══════════════════════════════════════════════════════════════════════
  // Attendance
  // ══════════════════════════════════════════════════════════════════════

  // POST /api/school/attendance/mark
  B.markAttendance = function (schoolId, classId, payload) {
    return POST('/attendance/mark', {
      school_id: schoolId, class_id: classId, date: payload.date,
      records: (payload.records || []).map(function (r) {
        return { student_id: r.student_id, status: r.status, notes: r.note };
      })
    });
  };
  B.markTeacherAttendance = function (schoolId, teacherId, classId, payload) {
    return B.markAttendance(schoolId, classId, payload);
  };
  // GET /api/school/attendance/report
  B.getAttendanceReport = function (schoolId, opts) {
    return GET('/attendance/report',
      { school_id: schoolId, class_id: opts && opts.classId, date_from: opts && opts.from, date_to: opts && opts.to });
  };
  B.listAttendance = B.getAttendanceReport;
  // GET /api/school/attendance/absentees
  B.getAbsentees = function (schoolId, opts) {
    return GET('/attendance/absentees', { school_id: schoolId, date: opts && opts.date, class_id: opts && opts.classId });
  };
  // GET /api/school/timetable
  B.getTeacherTimetable = function (schoolId, teacherId) {
    return GET('/timetable', { school_id: schoolId, teacher_id: teacherId });
  };

  // ══════════════════════════════════════════════════════════════════════
  // Guardian portal
  // ══════════════════════════════════════════════════════════════════════

  // POST /api/school/students/{student_id}/guardian-token
  B.issueGuardianToken = function (schoolId, studentId, payload) {
    return POST('/students/' + studentId + '/guardian-token', payload || {});
  };
  // GET /api/school/guardian-portal/{token} — public, no auth
  B.getGuardianPortal = function (token) {
    return request('GET', '/guardian-portal/' + encodeURIComponent(token || ''), {})
      .then(function (v) { return Object.assign({ state: 'ok' }, v); })
      .catch(function (err) {
        // school.py:2470 answers 404 for both unknown and expired; it cannot
        // tell them apart, so neither can we. RULES row 25/26.
        if (err.status === 404) {
          return { state: 'unknown', token: token,
                   message: 'This link is not one we issued, or it has expired. ' +
                            'Ask the school office for a new one.' };
        }
        throw err;
      });
  };

  // ══════════════════════════════════════════════════════════════════════
  // Communication
  // ══════════════════════════════════════════════════════════════════════
  B.listAnnouncements = function (schoolId, opts) {
    return GET('/announcements', { school_id: schoolId, limit: opts && opts.limit });
  };
  B.listEvents = function (schoolId, opts) { return GET('/events', { school_id: schoolId }); };
  B.getGuardianMessages = function (schoolId) {
    return B.listAnnouncements(schoolId, {}).then(function (items) {
      return { items: items.items || items, total: (items.items || items).length, events: [] };
    });
  };

  // ══════════════════════════════════════════════════════════════════════
  // No route in school.py. These reject with 501 and name the rule, rather
  // than being quietly reimplemented here — see docs/BACKEND-PATCHES.md.
  // ══════════════════════════════════════════════════════════════════════
  B.updateExam = notInBackend('updateExam', 11);
  B.verifyExamResults = notInBackend('verifyExamResults', 13);
  B.updateReportCard = notInBackend('updateReportCard', 15);
  B.updateGradingScale = notInBackend('updateGradingScale', 20);
  B.deleteGradingScale = notInBackend('deleteGradingScale', 20);
  B.setDefaultGradingScale = notInBackend('setDefaultGradingScale', 20);
  B.updateFeeStructure = notInBackend('updateFeeStructure', 30);
  B.deleteFeeStructure = notInBackend('deleteFeeStructure', 30);
  B.cloneFeeStructure = notInBackend('cloneFeeStructure', 30);
  B.rejectWaiver = notInBackend('rejectWaiver', 6);
  B.listTeacherClasses = notInBackend('listTeacherClasses', 21);
  B.getTeacherDashboard = notInBackend('getTeacherDashboard', 21);
  B.getTeacherRegister = notInBackend('getTeacherRegister', 21);
  B.getTeacherMarkSheet = notInBackend('getTeacherMarkSheet', 21);
  B.getClassRegister = notInBackend('getClassRegister', 16);
  B.listMyChildren = notInBackend('listMyChildren', 22);
  B.getChildFees = notInBackend('getChildFees', 22);
  B.getChildAttendance = notInBackend('getChildAttendance', 22);
  B.getChildResults = notInBackend('getChildResults', 23);
  B.listGuardianTokens = notInBackend('listGuardianTokens', 26);
  B.updateGuardian = notInBackend('updateGuardian', 8);
  B.setPrimaryGuardian = notInBackend('setPrimaryGuardian', 8);
  B.removeGuardian = notInBackend('removeGuardian', 8);
  B.getArrearsByClass = notInBackend('getArrearsByClass', 27);
  B.getRegisterStatus = notInBackend('getRegisterStatus', 16);
  B.getDailyCollections = notInBackend('getDailyCollections', 4);
  B.listPaymentLedger = notInBackend('listPaymentLedger', 4);
  B.listPayments = notInBackend('listPayments', 4);
  B.listJournalLines = notInBackend('listJournalLines', 4);
  B.exportPaymentsCSV = notInBackend('exportPaymentsCSV', 4);
  B.exportStudentsCSV = notInBackend('exportStudentsCSV', 28);
  B.sendMessage = notInBackend('sendMessage', 29);
  B.listWaivers = B.listWaiverRows;
  B.getNeedsAttention = notInBackend('getNeedsAttention', 14);
  B.getDashboardSummary = notInBackend('getDashboardSummary', 1);
  B.generateInvoices = B.bulkGenerateInvoices;

  // demo-only hooks the live backend cannot honour
  B.resetStore = function () { return null; };
  B.persist = function () { return null; };
  B.ledgerDrift = function () { return null; };
  B._store = function () {
    throw new Error('_store() is demo-only. A contract test must not reach into the store; ' +
      'if it needs to, it is a unit test and belongs in test/app.test.js.');
  };
  B.CSV_COLUMNS = ['full_name', 'date_of_birth', 'gender', 'class_name', 'guardian_name', 'guardian_phone'];
  B.MAX_REMINDERS = 3;
  B.AGING_BUCKETS = [];
  B.EXAM_TYPES = ['opener', 'cat', 'midterm', 'endterm', 'mock'];
  B.PORTAL_STATES = { OK: 'ok', UNKNOWN: 'unknown', EXPIRED: 'expired', REVOKED: 'revoked' };
  B.validateBands = function () { return null; };   // the backend does not validate; do not pretend here

  B.CONFIG = CONFIG;
  B.setSession = setSession;
  B.clearSession = clearSession;

  global.ShuleLiveBackend = B;
})(typeof window !== 'undefined' ? window : globalThis);
