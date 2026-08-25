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
    // SHULE_API_TOKEN is read before storage by getToken(), so a token injected
    // that way shadows everything written here. Leaving it in place after a
    // refresh meant the stale token kept being sent, the refresh succeeded, and
    // the next call failed again — a session that could never recover.
    if (access && global.SHULE_API_TOKEN) global.SHULE_API_TOKEN = access;
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
      } else if (body.detail && typeof body.detail === 'object') {
        // A refusal that names what is wrong carries it as data as well as
        // prose — the publish gate names the unverified subjects so a page can
        // highlight those rows instead of parsing them out of a sentence.
        e.message = body.detail.message || e.message;
        Object.keys(body.detail).forEach(function (k) {
          if (k !== 'message' && e[k] === undefined) e[k] = body.detail[k];
        });
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
    // opts.asToken lets one call go out as somebody else. Verification is the
    // only user of it: the backend takes the verifier from the token, so a
    // client verifying marks must be authenticated as the person verifying.
    var token = opts.asToken || getToken();
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
  var POST_AS = function (tok, p, b, q) {
    return request('POST', p, { body: b, query: q, asToken: tok });
  };

  function notInBackendLater(name, row) { return notInBackend(name, row); }

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
  // E26 — shape normalisation.
  //
  // The adapter's job is to present the same shape demo-backend does, so a
  // contract test and a page behave identically against either. This is
  // renaming and assembling, never guarding: nothing below rejects anything
  // the backend accepted, because that would hide the rule failure the
  // contract suite exists to surface.
  // ══════════════════════════════════════════════════════════════════════

  /** school.py returns bare arrays where the demo returns {items, total}. */
  function asList(v) {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.items)) return v.items;
    return v ? [v] : [];
  }
  function asPage(v, opts) {
    var items = asList(v);
    var size = (opts && opts.pageSize) || 25;
    return { items: items, total: (v && v.total) || items.length,
             page: (v && v.page) || 1, page_size: size,
             pages: Math.max(1, Math.ceil(items.length / size)) };
  }

  /** Bands are min_score/max_score on the wire, min/max in the app. */
  function normaliseBand(b) {
    return {
      id: b.id, grade: b.grade,
      min: Number(b.min_score), max: Number(b.max_score),
      min_score: Number(b.min_score), max_score: Number(b.max_score),
      points: Number(b.points), remark: b.remark || b.grade
    };
  }
  /**
   * A scale carries no maximum of its own — GradingScaleIn (school.py:173) is
   * school_id, name, is_default and nothing else. The top band's ceiling is
   * the only maximum that exists, so that is what max_score means here.
   */
  function normaliseScale(sc) {
    var bands = asList(sc.bands).map(normaliseBand).sort(function (a, b) { return a.min - b.min; });
    var top = bands.length ? bands[bands.length - 1].max : 100;
    return Object.assign({}, sc, {
      bands: bands, max_score: top, band_count: bands.length,
      tiles: bandsTile(bands, top),
      exam_count: sc.exam_count || 0, result_count: sc.result_count || 0
    });
  }
  /** Reports whether bands tile 0..max. Does not enforce it — that is the backend's job. */
  function bandsTile(bands, max) {
    if (!bands.length) return false;
    if (bands[0].min !== 0) return false;
    for (var i = 1; i < bands.length; i++) {
      if (bands[i].min !== bands[i - 1].max + 1) return false;
    }
    return bands[bands.length - 1].max === max;
  }

  function normaliseResult(r) {
    return Object.assign({}, r, {
      score: r.score === null || r.score === undefined ? null : Number(r.score),
      points: r.points === null || r.points === undefined ? null : Number(r.points),
      verified: !!r.verified,
      comment: r.comment !== undefined ? r.comment : r.teacher_comment
    });
  }
  function normaliseInvoice(i) {
    return Object.assign({}, i, {
      amount_due: Number(i.amount_due || 0),
      amount_paid: Number(i.amount_paid || 0),
      discount_amount: Number(i.discount_amount || 0),
      balance: Number(i.balance || 0),
      reminders_sent: Number(i.reminders_sent || 0),
      term_id: i.term_id || (i.term !== undefined ? String(i.term) + '-' + i.year : null),
      term_name: i.term_name || (i.term !== undefined ? 'Term ' + i.term + ' ' + i.year : null),
      status: i.status === 'paid' ? 'cleared' : i.status === 'partial' ? 'part_paid'
            : i.status === 'pending' ? 'unpaid' : i.status
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // People
  // ══════════════════════════════════════════════════════════════════════
  var B = {};

  // GET /api/school/{school_id}/students        (school.py:2242 region)
  /** school.py caps per_page at 100 (le=100); asking for more is a 422. */
  function pageSize(n) { return n ? Math.min(Number(n), 100) : undefined; }

  B.listStudents = function (schoolId, opts) {
    opts = opts || {};
    return GET('/' + schoolId + '/students',
      { class_id: opts.classId, search: opts.search, page: opts.page, per_page: pageSize(opts.pageSize) });
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
  B.listClasses = function (schoolId, opts) {
    return GET('/' + schoolId + '/classes', opts).then(function (v) {
      return asList(v).map(function (c) {
        return Object.assign({}, c, {
          full_name: c.name,
          roll: Number(c.student_count != null ? c.student_count : c.roll || 0)
        });
      });
    });
  };
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
      { school_id: schoolId, status: opts.status, page: opts.page, per_page: pageSize(opts.pageSize) })
      .then(function (v) {
        var page = asPage(v, opts);
        page.items = page.items.map(normaliseInvoice)
          .filter(function (i) { return !opts.studentId || i.student_id === opts.studentId; });
        return page;
      });
  };
  B.listInvoiceRows = B.listFeeInvoices;
  // POST /api/school/fee-invoices/bulk-generate
  B.bulkGenerateInvoices = function (schoolId, payload) {
    // BulkFeeGenerateIn (school.py:141): fee_structure_id, not structure_id
    return POST('/fee-invoices/bulk-generate', {
      school_id: schoolId, fee_structure_id: payload.structureId,
      class_id: payload.classId, grade: payload.grade, due_date: payload.dueDate
    }).then(function (v) {
      var d = (v && v.data) || v || {};
      // "nothing happened" and "42 pupils were already billed" are different
      // answers, and a bursar re-running this needs to be told which.
      return { created: Number(d.created || 0), skipped: Number(d.skipped || 0),
               considered: Number(d.considered || 0) };
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
    }).then(function (v) {
      // the route returns the updated invoice row, not {payment, invoice}
      var inv = normaliseInvoice(v || {});
      return {
        invoice: inv,
        payment: {
          id: null, invoice_id: invoiceId, amount: Number(payload.amount),
          method: payload.method || 'mpesa', reference: payload.reference || null,
          paid_at: new Date().toISOString()
        }
      };
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
  // The pages read a page, not a bare array, and they read how many times a
  // family has already been chased — the cap is three (rule 29).
  B.listDefaulterRows = function (schoolId, opts) {
    return B.listDefaulters(schoolId, opts).then(function (v) {
      var items = asList(v).map(function (r) {
        return Object.assign({}, r, {
          invoice_id: r.invoice_id || r.id,
          balance: Number(r.balance || 0),
          reminders_sent: Number(r.reminders_sent || 0),
          exhausted: r.exhausted === true || Number(r.reminders_sent || 0) >= 3
        });
      });
      return { items: items, total: items.length };
    });
  };
  /*
   * school.py has POST /fee-waivers but NO list route — searched. Waivers can
   * be created and approved and never read back, so the demo's list has no
   * counterpart. RULES row 6.
   */
  B.listWaiverRows = notInBackendLater('listWaiverRows', 6);
  // POST /api/school/fee-waivers — FeeWaiverIn (school.py:148)
  B.createWaiver = function (schoolId, payload) {
    return POST('/fee-waivers', {
      invoice_id: payload.invoiceId, amount: payload.amount, reason: payload.reason
    });
  };
  // PUT /api/school/fee-waivers/{id}/approve
  // The route answers {waiver, invoice}. Normalising the invoice through the
  // same function every other invoice goes through, so a waiver's view of a
  // status agrees with the fees list's view of it.
  B.approveWaiver = function (schoolId, waiverId, payload) {
    return PUT('/fee-waivers/' + waiverId + '/approve', payload || {})
      .then(function (v) {
        var d = (v && v.data) || v || {};
        // request() unwraps to body.data, so the message never reaches here.
        // The flag has to be in the data, and the backend puts it there.
        var already = d.already === true;
        return {
          waiver: d.waiver || d,
          invoice: d.invoice ? normaliseInvoice(d.invoice) : null,
          // a repeat approval is a no-op that has to say so, or a page cannot
          // tell "we applied it" from "it was already applied"
          already: already,
          applied: !already
        };
      });
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
  B.listGradingScales = function (schoolId) {
    return GET('/grading-scales', { school_id: schoolId }).then(function (v) {
      return asList(v).map(normaliseScale);
    });
  };
  B.listGradingScaleRows = B.listGradingScales;
  // The scale and its bands go in one call. Creating the scale and then adding
  // bands one at a time is how a scale with a hole in it got persisted: each
  // individual band was valid, and nothing ever looked at the set (E12).
  B.createGradingScale = function (schoolId, payload) {
    return POST('/grading-scales', {
      school_id: schoolId,
      name: payload.name,
      is_default: !!payload.isDefault,
      max_score: payload.maxScore != null ? Number(payload.maxScore) : 100,
      bands: (payload.bands || []).map(function (b) {
        return { grade: b.grade, min_score: b.min, max_score: b.max,
                 points: b.points, remark: b.remark };
      })
    });
  };
  // GET /api/school/exams?school_id=
  B.listExams = function (schoolId, opts) {
    return GET('/exams', { school_id: schoolId, term_id: opts && opts.termId }).then(function (v) {
      return asList(v).map(function (e) {
        return Object.assign({}, e, {
          max_score: Number(e.max_score || 100),
          starts_on: e.date_from || e.starts_on, ends_on: e.date_to || e.ends_on,
          type: e.exam_type || e.type,
          result_count: Number(e.result_count || 0),
          class_ids: e.class_ids || [],
          grading_scale_id: e.grading_scale_id || null
        });
      });
    });
  };
  B.listExamRows = B.listExams;
  B.createExam = function (schoolId, payload) { return POST('/exams', payload); };
  // GET /api/school/exams/{id}/results
  B.listExamResults = function (schoolId, examId, opts) {
    opts = opts || {};
    // Asking for the results of no exam is an empty list, not a bad request.
    // Without this a caller iterating cards hits a card with no marks behind it
    // and gets "not a valid UUID" for a question that has a fine answer.
    if (!examId) return Promise.resolve({ items: [], total: 0 });
    return GET('/exams/' + examId + '/results', { class_id: opts.classId }).then(function (v) {
      var page = asPage(v, opts);
      page.items = page.items.map(normaliseResult)
        .filter(function (r) { return !opts.subjectId || r.subject_id === opts.subjectId; })
        .filter(function (r) { return opts.verified == null || r.verified === opts.verified; });
      return page;
    });
  };

  /**
   * There is no mark-sheet route: school.py returns marks that exist, never the
   * roll they belong to. The sheet is assembled here from four calls — the
   * exam, its scale, the class roll and the marks — so an unmarked pupil has a
   * row to type into. Nothing is validated on the way through.
   */
  B.getMarkSheet = function (schoolId, examId, opts) {
    opts = opts || {};
    return Promise.all([
      B.listExams(schoolId, {}),
      B.listGradingScales(schoolId),
      B.listStudents(schoolId, { classId: opts.classId, pageSize: 100 }),
      GET('/exams/' + examId + '/results', { class_id: opts.classId }),
      B.listClasses(schoolId, {}),
      B.listSubjects(schoolId, {})
    ]).then(function (r) {
      var exam = asList(r[0]).filter(function (e) { return String(e.id) === String(examId); })[0] || {};
      var scale = asList(r[1]).filter(function (s2) {
        return String(s2.id) === String(exam.grading_scale_id);
      })[0] || asList(r[1])[0] || { bands: [], max_score: 100 };
      var roll = asList(r[2]);
      var marks = {};
      asList(r[3]).map(normaliseResult).forEach(function (m) {
        if (!opts.subjectId || m.subject_id === opts.subjectId) marks[m.student_id] = m;
      });
      var cls = asList(r[4]).filter(function (c) { return String(c.id) === String(opts.classId); })[0] || {};
      var sub = asList(r[5]).filter(function (x) { return String(x.id) === String(opts.subjectId); })[0] || {};

      var rows2 = roll.map(function (s2) {
        var m = marks[s2.id] || {};
        return {
          student_id: s2.id, name: s2.full_name || s2.name,
          admission_no: s2.admission_number || s2.admission_no,
          result_id: m.id || null, score: m.score != null ? m.score : null,
          grade: m.grade || null, points: m.points != null ? m.points : null,
          remark: m.remark || null, comment: m.comment || null,
          verified: !!m.verified, entered_by: m.entered_by || null,
          entered_by_name: null, verified_by_name: null
        };
      });
      return {
        exam: exam, scale: scale,
        class_id: opts.classId, class_name: cls.name || cls.full_name || '—',
        subject_id: opts.subjectId, subject_name: sub.name || '—',
        teacher_id: null, teacher_name: null,
        max_score: Number(exam.max_score || scale.max_score || 100),
        roll: rows2,
        entered: rows2.filter(function (x) { return x.score != null; }).length,
        unverified: rows2.filter(function (x) { return x.score != null && !x.verified; }).length
      };
    });
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
  // PUT /api/school/{school_id}/teachers/{teacher_id}/exams/{exam_id}/results
  //
  // Not the same route as saveExamResults. Sending a teacher's marks through
  // the unscoped route is how a teacher writes into a class they do not teach:
  // the check lives on the scoped route, and skipping it here would mean the
  // whole scope is a naming convention.
  B.saveTeacherResults = function (schoolId, teacherId, examId, payload) {
    payload = payload || {};
    if (!teacherId) return B.saveExamResults(schoolId, examId, payload);
    return PUT('/' + schoolId + '/teachers/' + teacherId + '/exams/' + examId + '/results', {
      exam_id: String(examId),
      class_id: payload.classId,
      results: (payload.scores || []).map(function (r) {
        return { student_id: r.student_id, subject_id: r.subject_id || payload.subjectId,
                 score: Number(r.score), teacher_comment: r.comment || null };
      })
    });
  };
  // GET /api/school/exams/{id}/class-analysis
  B.getClassAnalysis = function (schoolId, examId, opts) {
    return GET('/exams/' + examId + '/class-analysis', { class_id: opts && opts.classId });
  };
  // GET /api/school/exams/{exam_id}/merit-list
  // The route answers {exam_id, merit_list:[...]} with per-row total_marks and
  // average_marks; the app reads {items:[{total, average, position}]}. Renaming
  // only — the order and the ranks are the backend's, untouched, because rule
  // 19 is about what it returned.
  B.getMeritList = function (schoolId, examId, opts) {
    return GET('/exams/' + examId + '/merit-list', { class_id: opts && opts.classId })
      .then(function (v) {
        var raw = (v && v.merit_list) || (v && v.data && v.data.merit_list) || asList(v);
        var items = raw.map(function (e) {
          return Object.assign({}, e, {
            position: e.rank != null ? Number(e.rank) : null,
            total: Number(e.total_marks != null ? e.total_marks : e.total || 0),
            average: Number(e.average_marks != null ? e.average_marks : e.average || 0),
            subjects_sat: Number(e.subjects_sat || 0),
            student_name: e.full_name || e.student_name
          });
        });
        return { items: items, total: items.length };
      });
  };
  // GET /api/school/report-cards
  B.listReportCardRows = function (schoolId, opts) {
    opts = opts || {};
    return GET('/report-cards', { school_id: schoolId, class_id: opts.classId, status: opts.status })
      .then(function (v) {
        var items = asList(v).map(function (c) {
          return Object.assign({}, c, {
            average: Number(c.average_marks != null ? c.average_marks : c.average || 0),
            total_marks: Number(c.total_marks || 0),
            position: c.class_position != null ? Number(c.class_position) : null,
            class_size: c.class_size != null ? Number(c.class_size) : 0,
            teacher_comment: c.teacher_comment, principal_comment: c.principal_comment,
            unverified_subjects: 0, publishable: true
          });
        });
        return { items: items, total: items.length, term_id: opts.termId };
      });
  };
  B.listReportCards = B.listReportCardRows;
  B.getReportCard = function (schoolId, cardId) { return GET('/report-cards/' + cardId); };
  // POST /api/school/report-cards
  /*
   * school.py's ReportCardIn is per-STUDENT, not per-class: there is no bulk
   * generate. One call per pupil, which is also E28's problem in reverse.
   */
  B.generateReportCards = function (schoolId, payload) {
    if (payload.studentId) {
      return POST('/report-cards', { student_id: payload.studentId, term_id: payload.termId });
    }
    // POST /api/school/report-cards/bulk-generate — one call for a class (E28)
    return POST('/report-cards/bulk-generate',
                { class_id: payload.classId, term_id: payload.termId || null })
      .then(function (v) {
        var d = (v && v.data) || v || {};
        return { class_id: payload.classId, generated: Number(d.generated || 0),
                 skipped: d.skipped || [], roll: Number(d.roll || 0) };
      });
  };
  // POST /api/school/report-cards/{id}/publish — one card at a time
  // POST /api/school/report-cards/bulk-publish
  // One call, one transaction (E28). Publishing card by card meant a dropped
  // connection could leave half a class published — half the families having
  // seen a mark and the other half not, with no way back for the half that had.
  B.publishReportCardsFor = function (schoolId, payload) {
    return POST('/report-cards/bulk-publish',
                { class_id: payload.classId, term_id: payload.termId || null })
      .then(function (v) {
        var d = (v && v.data) || v || {};
        return { class_id: payload.classId, published: Number(d.published || 0),
                 already_published: Number(d.already_published || 0) };
      });
  };
  B.publishReportCards = B.publishReportCardsFor;

  // POST /api/school/report-cards/bulk-withdraw
  B.withdrawReportCardsFor = function (schoolId, payload) {
    return POST('/report-cards/bulk-withdraw',
                { class_id: payload.classId, term_id: payload.termId || null })
      .then(function (v) {
        var d = (v && v.data) || v || {};
        return { class_id: payload.classId, withdrawn: Number(d.withdrawn || 0) };
      });
  };

  // ══════════════════════════════════════════════════════════════════════
  // Attendance
  // ══════════════════════════════════════════════════════════════════════

  // POST /api/school/attendance/mark
  B.markAttendance = function (schoolId, classId, payload) {
    return POST('/attendance/mark', {
      school_id: schoolId, class_id: classId, date: payload.date,
      records: (payload.records || []).map(function (r) {
        return { student_id: r.student_id, status: r.status, notes: r.note || r.reason };
      })
    }).then(function (v) {
      var d = (v && v.data) || v || {};
      // created vs updated matters: re-marking a register must not report
      // forty new records every morning.
      return Object.assign({}, d, {
        created: Number(d.created || 0),
        updated: Number(d.updated || 0),
        marked: Number(d.marked || 0)
      });
    });
  };
  // POST /api/school/{school_id}/teachers/{teacher_id}/classes/{class_id}/attendance
  B.markTeacherAttendance = function (schoolId, teacherId, classId, payload) {
    if (!teacherId) return B.markAttendance(schoolId, classId, payload);
    return POST('/' + schoolId + '/teachers/' + teacherId + '/classes/' + classId + '/attendance', {
      date: payload.date,
      records: (payload.records || []).map(function (r) {
        return { student_id: r.student_id, status: r.status, reason: r.note || r.reason };
      })
    }).then(function (v) {
      var d = (v && v.data) || v || {};
      return Object.assign({}, d, { created: Number(d.created || 0), marked: Number(d.marked || 0) });
    });
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
  // PUT /api/school/exams/{id}
  B.updateExam = function (schoolId, examId, payload) {
    return PUT('/exams/' + examId, {
      name: payload.name, exam_type: payload.examType,
      date_from: payload.dateFrom, date_to: payload.dateTo,
      max_score: payload.maxScore,
      grading_scale_id: payload.gradingScaleId
    });
  };
  // POST /api/school/exams/{exam_id}/results/verify
  //
  // Who verified is the caller, taken from the token by the backend and never
  // from the body — a client that can name its own verifier can name the person
  // whose marks it is signing off, which is the one thing this control exists
  // to prevent. So verifying as somebody else means authenticating as them.
  B.verifyExamResults = function (schoolId, examId, payload) {
    payload = payload || {};
    var body = { class_id: payload.classId || null, subject_id: payload.subjectId || null };
    // asEnterer means "attempt this as whoever entered the marks", which live
    // expresses as the default identity rather than the separate verifier.
    var as = payload.asEnterer ? null
           : (payload.asToken || global.SHULE_VERIFIER_TOKEN || null);
    var call = as ? POST_AS(as, '/exams/' + examId + '/results/verify', body)
                  : POST('/exams/' + examId + '/results/verify', body);
    return call.then(function (v) {
      var d = (v && v.data) || v || {};
      return { exam_id: String(examId), verified: Number(d.verified || 0),
               verified_by: d.verified_by || null };
    });
  };
  B.updateReportCard = notInBackend('updateReportCard', 15);
  B.updateGradingScale = notInBackend('updateGradingScale', 20);
  B.deleteGradingScale = notInBackend('deleteGradingScale', 20);
  B.setDefaultGradingScale = notInBackend('setDefaultGradingScale', 20);
  B.updateFeeStructure = notInBackend('updateFeeStructure', 30);
  B.deleteFeeStructure = notInBackend('deleteFeeStructure', 30);
  B.cloneFeeStructure = notInBackend('cloneFeeStructure', 30);
  B.rejectWaiver = notInBackend('rejectWaiver', 6);
  // ══════════════════════════════════════════════════════════════════════
  // Teacher and parent surfaces — E16, E17
  //
  // These were stubs until school.py grew the routes. Every one of them is
  // scoped by the backend from the caller's token, not by anything here: a
  // filter in the client is a convenience, not a control, and the whole point
  // of these rules is that a teacher asking for a class they do not teach gets
  // the same answer as one asking for a class that does not exist.
  // ══════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/teachers/{teacher_id}/classes
  B.listTeacherClasses = function (schoolId, teacherId) {
    return GET('/' + schoolId + '/teachers/' + teacherId + '/classes').then(function (v) {
      return asList(v).map(function (c) {
        return Object.assign({}, c, {
          full_name: c.name, roll: Number(c.roll || 0),
          subjects: typeof c.subjects === 'string' ? JSON.parse(c.subjects) : (c.subjects || [])
        });
      });
    });
  };

  // GET /api/school/{school_id}/teachers/{teacher_id}/dashboard
  B.getTeacherDashboard = function (schoolId, teacherId, opts) {
    opts = opts || {};
    return GET('/' + schoolId + '/teachers/' + teacherId + '/dashboard', { date: opts.date });
  };

  // GET /api/school/{school_id}/teachers/{teacher_id}/classes/{class_id}/register
  B.getTeacherRegister = function (schoolId, teacherId, classId, opts) {
    opts = opts || {};
    return GET('/' + schoolId + '/teachers/' + teacherId + '/classes/' + classId + '/register',
               { date: opts.date }).then(normaliseRegister);
  };

  function normaliseRegister(v) {
    var d = (v && v.data) || v || {};
    return Object.assign({}, d, {
      roll: asList(d.roll).map(function (r) {
        return Object.assign({}, r, {
          name: r.full_name || r.name,
          note: r.reason != null ? r.reason : r.note,
          record_id: r.attendance_id || null
        });
      })
    });
  }

  // GET /api/school/{school_id}/classes/{class_id}/register
  // The register without naming a teacher — a head walking into a classroom is
  // not that class's teacher. Scope still applies at the backend.
  B.getClassRegister = function (schoolId, classId, opts) {
    opts = opts || {};
    return GET('/' + schoolId + '/classes/' + classId + '/register', { date: opts.date })
      .then(normaliseRegister);
  };

  // GET /api/school/{school_id}/teachers/{teacher_id}/exams/{exam_id}/marksheet
  B.getTeacherMarkSheet = function (schoolId, teacherId, examId, opts) {
    opts = opts || {};
    return GET('/' + schoolId + '/teachers/' + teacherId + '/exams/' + examId + '/mark-sheet',
               { class_id: opts.classId, subject_id: opts.subjectId })
      .then(function (v) {
        var d = (v && v.data) || v || {};
        var scale = d.scale ? normaliseScale(Object.assign({}, d.scale,
          { bands: d.scale.bands, max_score: d.max_score })) : null;
        return Object.assign({}, d, {
          scale: scale,
          roll: asList(d.roll).map(function (r) {
            return Object.assign({}, r, { name: r.full_name || r.name, verified: !!r.verified });
          })
        });
      });
  };

  // GET /api/school/{school_id}/guardians/{person_id}/children
  B.listMyChildren = function (schoolId, personId) {
    return GET('/' + schoolId + '/guardians/' + personId + '/children').then(function (v) {
      return asList(v).map(function (k) {
        return Object.assign({}, k, {
          id: k.student_id,
          balance: Number(k.balance || 0),
          attendance_rate: k.marked_30 ? Math.round(Number(k.present_30) / Number(k.marked_30) * 100) : null
        });
      });
    });
  };

  // GET /api/school/{school_id}/guardians/{person_id}/children/{student_id}/fees
  B.getChildFees = function (schoolId, personId, studentId) {
    return GET('/' + schoolId + '/guardians/' + personId + '/children/' + studentId + '/fees')
      .then(function (v) {
        var d = (v && v.data) || v || {};
        return Object.assign({}, d, { invoices: asList(d.invoices).map(normaliseInvoice) });
      });
  };
  // GET /api/school/{school_id}/guardians/{person_id}/children/{student_id}/attendance
  B.getChildAttendance = function (schoolId, personId, studentId, opts) {
    opts = opts || {};
    return GET('/' + schoolId + '/guardians/' + personId + '/children/' + studentId + '/attendance',
               { days: opts.days });
  };
  // GET /api/school/{school_id}/guardians/{person_id}/children/{student_id}/results
  B.getChildResults = function (schoolId, personId, studentId) {
    return GET('/' + schoolId + '/guardians/' + personId + '/children/' + studentId + '/results');
  };

  // GET /api/school/students/{student_id}/guardian-tokens
  // The token itself never comes back — only its last four characters and its
  // state, because a list route that returns working links turns one leaked
  // screenshot into every family's records.
  B.listGuardianTokens = function (schoolId, studentId) {
    return GET('/students/' + studentId + '/guardian-tokens').then(function (v) {
      return asList(v).map(function (t) {
        return Object.assign({}, t, { token: '\u2026' + (t.token_tail || ''), active: t.state === 'active' });
      });
    });
  };

  // POST /api/school/guardian-tokens/{id}/revoke
  B.revokeGuardianToken = function (schoolId, tokenId) {
    return POST('/guardian-tokens/' + tokenId + '/revoke', {});
  };

  B.updateGuardian = notInBackend('updateGuardian', 8);
  B.setPrimaryGuardian = notInBackend('setPrimaryGuardian', 8);
  B.removeGuardian = notInBackend('removeGuardian', 8);
  B.getArrearsByClass = notInBackend('getArrearsByClass', 27);
  B.getRegisterStatus = notInBackend('getRegisterStatus', 16);
  B.getDailyCollections = notInBackend('getDailyCollections', 4);
  B.listPaymentLedger = notInBackend('listPaymentLedger', 4);
  B.listPayments = notInBackend('listPayments', 4);
  /*
   * There is no journal route in school.py — searched. The GL is written by
   * shared.post_journal and never exposed. A contract test that needs to see
   * the ledger has to be told where it is; SHULE_GL_URL points at a read-only
   * endpoint if one is ever added, and until then this reports the gap.
   */
  B.listJournalLines = global.SHULE_GL_URL
    ? function () {
        return global.fetch(global.SHULE_GL_URL).then(function (r) { return r.json(); })
          .then(function (v) {
            var lines = asList(v);
            var dr = lines.filter(function (l) { return l.side === 'debit' || Number(l.debit) > 0; })
              .reduce(function (n, l) { return n + Number(l.amount || l.debit || 0); }, 0);
            var cr = lines.filter(function (l) { return l.side === 'credit' || Number(l.credit) > 0; })
              .reduce(function (n, l) { return n + Number(l.amount || l.credit || 0); }, 0);
            return { lines: lines, debits: dr, credits: cr, balanced: Math.round((dr - cr) * 100) === 0 };
          });
      }
    : notInBackend('listJournalLines', 4);
  B.exportPaymentsCSV = notInBackend('exportPaymentsCSV', 4);
  B.exportStudentsCSV = notInBackend('exportStudentsCSV', 28);
  B.sendMessage = notInBackend('sendMessage', 29);
  B.listWaivers = B.listWaiverRows;
  B.getNeedsAttention = notInBackend('getNeedsAttention', 14);
  // GET /api/school/{school_id}/dashboard
  // Every figure carries what it was, because a number with nothing to compare
  // it to is not information: 72% collected means one thing after 68% and
  // another after 81%.
  B.getDashboardSummary = function (schoolId, opts) {
    opts = opts || {};
    return GET('/' + schoolId + '/dashboard/summary', { term_id: opts.termId, date: opts.date })
      .then(function (v) { return (v && v.data) || v || {}; });
  };
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
