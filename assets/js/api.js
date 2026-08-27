/**
 * Shule — data access layer.
 *
 * One function per backend route. Each takes arguments, hands them to the
 * backend adapter and returns what comes back. There is no arithmetic here, no
 * ledger, no business rules and no store: all of that lives in the adapter.
 *
 * That is the whole point of this file. In step 5 every body below becomes a
 * fetch() against the route named in the comment above it, assets/js/demo-backend.js
 * is deleted, and nothing else in the app has to move.
 *
 *     const BACKEND = window.SHULE_BACKEND || DemoBackend;
 *
 * Set window.SHULE_BACKEND before this script runs to point the whole app at a
 * different implementation — a live FastAPI client, or a stub in a test.
 */
(function (global) {
  'use strict';

  /*
   * Choosing the backend.
   *
   * This used to be `SHULE_BACKEND || DemoBackend`, which meant a page that
   * failed to load the live adapter quietly served demo data instead. That is
   * the worst failure this app can have: a bursar sees a school that does not
   * exist, with pupils who are not theirs and fees nobody owes, and nothing on
   * the screen says so. It looks like a working app.
   *
   * So the mode is decided once, in config.js, and honoured here without a
   * fallback in either direction. If the chosen backend is missing, the page
   * fails loudly rather than showing somebody else's school.
   */
  var CONFIG = global.SHULE_CONFIG || { mode: global.SHULE_BACKEND ? 'live' : 'demo' };
  var BACKEND;

  if (global.SHULE_BACKEND) {
    // An explicit override — the contract harness, or a test stub.
    BACKEND = global.SHULE_BACKEND;
  } else if (CONFIG.mode === 'demo') {
    BACKEND = global.DemoBackend;
    if (!BACKEND) {
      throw new Error('Shule is in demo mode but assets/js/demo-backend.js has not loaded. ' +
        'Load assets/js/data/demo-data.js and assets/js/demo-backend.js before assets/js/api.js.');
    }
  } else {
    BACKEND = global.ShuleLiveBackend;
    if (!BACKEND) {
      throw new Error('Shule cannot reach the school system: assets/js/live-backend.js has not ' +
        'loaded. The app will not fall back to demo data, because showing a school records ' +
        'that are not theirs is worse than showing nothing.');
    }
  }
  global.SHULE_MODE = CONFIG.mode;
  // ── integrations (M2) ─────────────────────────────────────────────────────
  // GET /api/tenant-integrations
  async function listIntegrations(schoolId) {
    return BACKEND.listIntegrations(schoolId);
  }
  // PUT /api/tenant-integrations/{provider}
  async function saveIntegration(schoolId, provider, config) {
    return BACKEND.saveIntegration(schoolId, provider, config);
  }
  // POST /api/tenant-integrations/{provider}/test
  async function testIntegration(schoolId, provider) {
    return BACKEND.testIntegration(schoolId, provider);
  }
  // DELETE /api/tenant-integrations/{provider}
  async function disconnectIntegration(schoolId, provider) {
    return BACKEND.disconnectIntegration(schoolId, provider);
  }
  // GET /api/billing/subscription
  async function getSubscription(schoolId) {
    return BACKEND.getSubscription(schoolId);
  }
  // GET /api/billing/plans
  async function listPlans(schoolId) {
    return BACKEND.listPlans(schoolId);
  }

  // ── session ───────────────────────────────────────────────────────────────
  // POST /api/auth/login
  // opts.role is a hint, honoured only by the demo, which has no accounts to
  // read a role from. The live backend takes the role off the account.
  async function login(identifier, password, opts) {
    return BACKEND.login(identifier, password, opts);
  }
  // GET /api/auth/me
  async function getMe() {
    return BACKEND.getMe();
  }
  // POST /api/auth/logout
  async function logout() {
    return BACKEND.logout();
  }
  // POST /api/auth/register
  async function register(payload) {
    return BACKEND.register(payload);
  }
  // POST /api/auth/verify-email
  async function verifyEmail(token) {
    return BACKEND.verifyEmail ? BACKEND.verifyEmail(token)
      : Promise.reject(Object.assign(new Error('Not available in this mode.'), { status: 501 }));
  }
  // POST /api/auth/resend-verification
  async function resendVerification(email) {
    return BACKEND.resendVerification ? BACKEND.resendVerification(email)
      : Promise.reject(Object.assign(new Error('Not available in this mode.'), { status: 501 }));
  }
  // Async like everything else here, even though both read local state. One
  // rule for the whole surface is worth more than saving a caller an await.
  async function hasSession() { return BACKEND.hasSession ? BACKEND.hasSession() : false; }
  async function currentUser() { return BACKEND.currentUser ? BACKEND.currentUser() : null; }

  // GET /api/school/{school_id}/students
  async function listStudents(schoolId, opts) {
    return BACKEND.listStudents(schoolId, opts);
  }
  // GET /api/school/students/{student_id}
  async function getStudent(schoolId, studentId) {
    return BACKEND.getStudent(schoolId, studentId);
  }
  // POST /api/school/students
  async function createStudent(schoolId, payload) {
    return BACKEND.createStudent(schoolId, payload);
  }
  // GET /api/school/{school_id}/classes
  async function listClasses(schoolId, opts) {
    return BACKEND.listClasses(schoolId, opts);
  }
  // GET /api/school/{school_id}/teachers
  async function listTeachers(schoolId, opts) {
    return BACKEND.listTeachers(schoolId, opts);
  }
  // GET /api/school/{school_id}/subjects
  async function listSubjects(schoolId, opts) {
    return BACKEND.listSubjects(schoolId, opts);
  }
  // GET /api/school/fee-structures?school_id=
  async function listFeeStructures(schoolId, opts) {
    return BACKEND.listFeeStructures(schoolId, opts);
  }
  // GET /api/school/fee-invoices?school_id=
  async function listFeeInvoices(schoolId, opts) {
    return BACKEND.listFeeInvoices(schoolId, opts);
  }
  // GET /api/school/defaulters?school_id=&threshold_days=
  async function listDefaulters(schoolId, opts) {
    return BACKEND.listDefaulters(schoolId, opts);
  }
  // GET /api/school/{school_id}/fee-invoices/arrears-by-class
  async function getArrearsByClass(schoolId, opts) {
    return BACKEND.getArrearsByClass(schoolId, opts);
  }
  // GET /api/school/{school_id}/payments
  async function listPayments(schoolId, opts) {
    return BACKEND.listPayments(schoolId, opts);
  }
  // GET /api/school/{school_id}/payments/daily
  async function getDailyCollections(schoolId, opts) {
    return BACKEND.getDailyCollections(schoolId, opts);
  }
  // POST /api/school/fee-invoices/{invoice_id}/pay-with-journal
  // NOT /pay: school.py:807 records the money and posts nothing to the ledger
  async function recordPayment(schoolId, invoiceId, payload) {
    return BACKEND.recordPayment(schoolId, invoiceId, payload);
  }
  // POST /api/school/notifications/fee-reminder
  async function sendFeeReminders(schoolId, opts) {
    return BACKEND.sendFeeReminders(schoolId, opts);
  }
  // POST /api/school/{school_id}/fee-invoices/bulk-generate
  async function generateInvoices(schoolId, payload) {
    return BACKEND.generateInvoices(schoolId, payload);
  }
  // GET /api/school/{school_id}/fee-waivers
  async function listWaivers(schoolId, opts) {
    return BACKEND.listWaivers(schoolId, opts);
  }
  // GET /api/school/attendance/report?school_id=
  async function listAttendance(schoolId, opts) {
    return BACKEND.listAttendance(schoolId, opts);
  }
  // GET /api/school/{school_id}/attendance/register-status
  async function getRegisterStatus(schoolId, opts) {
    return BACKEND.getRegisterStatus(schoolId, opts);
  }
  // POST /api/school/attendance/mark
  async function markAttendance(schoolId, classId, payload) {
    return BACKEND.markAttendance(schoolId, classId, payload);
  }
  // GET /api/school/exams?school_id=
  async function listExams(schoolId, opts) {
    return BACKEND.listExams(schoolId, opts);
  }
  // GET /api/school/exams/{exam_id}/results
  async function listExamResults(schoolId, examId, opts) {
    return BACKEND.listExamResults(schoolId, examId, opts);
  }
  // GET /api/school/{school_id}/report-cards
  async function listReportCards(schoolId, opts) {
    return BACKEND.listReportCards(schoolId, opts);
  }
  // POST /api/school/{school_id}/report-cards/publish
  async function publishReportCards(schoolId, payload) {
    return BACKEND.publishReportCards(schoolId, payload);
  }
  // GET /api/school/grading-scales?school_id=
  async function listGradingScales(schoolId) {
    return BACKEND.listGradingScales(schoolId);
  }
  // GET /api/school/announcements?school_id=
  async function listAnnouncements(schoolId, opts) {
    return BACKEND.listAnnouncements(schoolId, opts);
  }
  // GET /api/school/events?school_id=
  async function listEvents(schoolId, opts) {
    return BACKEND.listEvents(schoolId, opts);
  }
  // GET /api/school/{school_id}/dashboard/summary
  async function getDashboardSummary(schoolId, opts) {
    return BACKEND.getDashboardSummary(schoolId, opts);
  }
  // GET /api/school/{school_id}/dashboard/needs-attention
  async function getNeedsAttention(schoolId, opts) {
    return BACKEND.getNeedsAttention(schoolId, opts);
  }
  // GET /api/school/{school_id}/students?search=&class_id=&status=&sort=&page=
  async function searchStudents(schoolId, opts) {
    return BACKEND.searchStudents(schoolId, opts);
  }
  // PUT /api/school/students/{student_id}
  async function updateStudent(schoolId, studentId, payload) {
    return BACKEND.updateStudent(schoolId, studentId, payload);
  }
  // POST /api/school/students/{student_id}/promote
  async function promoteStudents(schoolId, payload) {
    return BACKEND.promoteStudents(schoolId, payload);
  }
  // POST /api/school/students/{student_id}/transfer-out
  async function transferStudent(schoolId, studentId, payload) {
    return BACKEND.transferStudent(schoolId, studentId, payload);
  }
  // POST /api/school/{school_id}/students/import  (multipart, school.py:2242)
  async function importStudentsCSV(schoolId, csvText, opts) {
    return BACKEND.importStudentsCSV(schoolId, csvText, opts);
  }
  // GET /api/school/{school_id}/students/export
  async function exportStudentsCSV(schoolId, opts) {
    return BACKEND.exportStudentsCSV(schoolId, opts);
  }
  // POST /api/school/{school_id}/messages
  async function sendMessage(schoolId, payload) {
    return BACKEND.sendMessage(schoolId, payload);
  }
  // GET /api/school/students/{student_id}/guardians
  async function listGuardians(schoolId, studentId) {
    return BACKEND.listGuardians(schoolId, studentId);
  }
  // POST /api/school/students/{student_id}/guardians
  async function addGuardian(schoolId, studentId, payload) {
    return BACKEND.addGuardian(schoolId, studentId, payload);
  }
  // PATCH /api/school/{school_id}/guardians/{guardian_id}
  async function updateGuardian(schoolId, guardianId, payload) {
    return BACKEND.updateGuardian(schoolId, guardianId, payload);
  }
  // PUT /api/school/{school_id}/students/{student_id}/guardians/{guardian_id}/primary
  async function setPrimaryGuardian(schoolId, studentId, guardianId) {
    return BACKEND.setPrimaryGuardian(schoolId, studentId, guardianId);
  }
  // DELETE /api/school/{school_id}/guardians/{guardian_id}
  async function removeGuardian(schoolId, guardianId) {
    return BACKEND.removeGuardian(schoolId, guardianId);
  }
  // GET /api/school/students/{student_id}/discipline
  async function listDiscipline(schoolId, opts) {
    return BACKEND.listDiscipline(schoolId, opts);
  }
  // POST /api/school/students/{student_id}/discipline
  async function addDiscipline(schoolId, studentId, payload) {
    return BACKEND.addDiscipline(schoolId, studentId, payload);
  }
  // POST /api/school/{school_id}/fee-structures
  async function createFeeStructure(schoolId, payload) {
    return BACKEND.createFeeStructure(schoolId, payload);
  }
  // PUT /api/school/{school_id}/fee-structures/{structure_id}
  async function updateFeeStructure(schoolId, structureId, payload) {
    return BACKEND.updateFeeStructure(schoolId, structureId, payload);
  }
  // DELETE /api/school/{school_id}/fee-structures/{structure_id}
  async function deleteFeeStructure(schoolId, structureId) {
    return BACKEND.deleteFeeStructure(schoolId, structureId);
  }
  // POST /api/school/{school_id}/fee-structures/clone
  async function cloneFeeStructure(schoolId, payload) {
    return BACKEND.cloneFeeStructure(schoolId, payload);
  }
  // GET /api/school/{school_id}/fee-invoices?class_id=&term_id=&status=
  async function listInvoiceRows(schoolId, opts) {
    return BACKEND.listInvoiceRows(schoolId, opts);
  }
  // POST /api/school/fee-invoices/bulk-generate
  async function bulkGenerateInvoices(schoolId, payload) {
    return BACKEND.bulkGenerateInvoices(schoolId, payload);
  }
  // GET /api/school/fee-invoices/{invoice_id}/receipt
  async function getReceipt(schoolId, paymentId) {
    return BACKEND.getReceipt(schoolId, paymentId);
  }
  // GET /api/school/{school_id}/payments?method=&from=&to=
  async function listPaymentLedger(schoolId, opts) {
    return BACKEND.listPaymentLedger(schoolId, opts);
  }
  // GET /api/school/{school_id}/payments/export
  async function exportPaymentsCSV(schoolId, opts) {
    return BACKEND.exportPaymentsCSV(schoolId, opts);
  }
  // GET /api/school/{school_id}/ledger/journal
  async function listJournalLines(schoolId, opts) {
    return BACKEND.listJournalLines(schoolId, opts);
  }
  // GET /api/school/{school_id}/fee-invoices/defaulters?aging=true
  async function listDefaulterRows(schoolId, opts) {
    return BACKEND.listDefaulterRows(schoolId, opts);
  }
  // POST /api/school/notifications/fee-reminder
  async function sendRemindersFor(schoolId, payload) {
    return BACKEND.sendRemindersFor(schoolId, payload);
  }
  // GET /api/school/{school_id}/fee-waivers
  async function listWaiverRows(schoolId, opts) {
    return BACKEND.listWaiverRows(schoolId, opts);
  }
  // POST /api/school/fee-waivers
  async function createWaiver(schoolId, payload) {
    return BACKEND.createWaiver(schoolId, payload);
  }
  // POST /api/school/{school_id}/fee-waivers/{waiver_id}/approve
  async function approveWaiver(schoolId, waiverId, payload) {
    return BACKEND.approveWaiver(schoolId, waiverId, payload);
  }
  // POST /api/school/{school_id}/fee-waivers/{waiver_id}/reject
  async function rejectWaiver(schoolId, waiverId, payload) {
    return BACKEND.rejectWaiver(schoolId, waiverId, payload);
  }
  // ════════════════════════════════════════════════════════════════════
  // GRADING SCALES
  // ════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/grading-scales
  async function listGradingScaleRows(schoolId, opts) {
    return BACKEND.listGradingScaleRows(schoolId, opts);
  }
  // POST /api/school/grading-scales  (+ /grading-scales/{id}/bands per band)
  async function createGradingScale(schoolId, payload) {
    return BACKEND.createGradingScale(schoolId, payload);
  }
  // PUT /api/school/{school_id}/grading-scales/{scale_id}
  async function updateGradingScale(schoolId, scaleId, payload) {
    return BACKEND.updateGradingScale(schoolId, scaleId, payload);
  }
  // DELETE /api/school/{school_id}/grading-scales/{scale_id}
  async function deleteGradingScale(schoolId, scaleId) {
    return BACKEND.deleteGradingScale(schoolId, scaleId);
  }
  // PUT /api/school/{school_id}/grading-scales/{scale_id}/default
  async function setDefaultGradingScale(schoolId, scaleId) {
    return BACKEND.setDefaultGradingScale(schoolId, scaleId);
  }

  // ════════════════════════════════════════════════════════════════════
  // ATTENDANCE
  // ════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/classes/{class_id}/register
  async function getClassRegister(schoolId, classId, opts) {
    return BACKEND.getClassRegister(schoolId, classId, opts);
  }
  // GET /api/school/attendance/report?school_id=
  async function getAttendanceReport(schoolId, opts) {
    return BACKEND.getAttendanceReport(schoolId, opts);
  }
  // GET /api/school/attendance/absentees?school_id=&date=
  async function getAbsentees(schoolId, opts) {
    return BACKEND.getAbsentees(schoolId, opts);
  }

  // ════════════════════════════════════════════════════════════════════
  // EXAMS AND RESULTS
  // ════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/exams
  async function listExamRows(schoolId, opts) {
    return BACKEND.listExamRows(schoolId, opts);
  }
  // POST /api/school/exams
  async function createExam(schoolId, payload) {
    return BACKEND.createExam(schoolId, payload);
  }
  // PATCH /api/school/{school_id}/exams/{exam_id}
  async function updateExam(schoolId, examId, payload) {
    return BACKEND.updateExam(schoolId, examId, payload);
  }
  // GET /api/school/exams/{exam_id}/results?class_id=&subject_id=
  async function getMarkSheet(schoolId, examId, opts) {
    return BACKEND.getMarkSheet(schoolId, examId, opts);
  }
  // POST /api/school/exams/{exam_id}/results
  async function saveExamResults(schoolId, examId, payload) {
    return BACKEND.saveExamResults(schoolId, examId, payload);
  }
  // POST /api/school/{school_id}/exams/{exam_id}/results/verify
  async function verifyExamResults(schoolId, examId, payload) {
    return BACKEND.verifyExamResults(schoolId, examId, payload);
  }
  // GET /api/school/exams/{exam_id}/class-analysis
  async function getClassAnalysis(schoolId, examId, opts) {
    return BACKEND.getClassAnalysis(schoolId, examId, opts);
  }
  // GET /api/school/exams/{exam_id}/merit-list
  async function getMeritList(schoolId, examId, opts) {
    return BACKEND.getMeritList(schoolId, examId, opts);
  }

  // ════════════════════════════════════════════════════════════════════
  // REPORT CARDS
  // ════════════════════════════════════════════════════════════════════

  // POST /api/school/report-cards
  async function generateReportCards(schoolId, payload) {
    return BACKEND.generateReportCards(schoolId, payload);
  }
  // GET /api/school/report-cards?school_id=
  async function listReportCardRows(schoolId, opts) {
    return BACKEND.listReportCardRows(schoolId, opts);
  }
  // GET /api/school/report-cards/{card_id}
  async function getReportCard(schoolId, cardId) {
    return BACKEND.getReportCard(schoolId, cardId);
  }
  // PATCH /api/school/{school_id}/report-cards/{card_id}
  async function updateReportCard(schoolId, cardId, payload) {
    return BACKEND.updateReportCard(schoolId, cardId, payload);
  }
  // POST /api/school/{school_id}/report-cards/publish
  async function publishReportCardsFor(schoolId, payload) {
    return BACKEND.publishReportCardsFor(schoolId, payload);
  }
  // POST /api/school/report-cards/bulk-withdraw
  async function withdrawReportCardsFor(schoolId, payload) {
    return BACKEND.withdrawReportCardsFor(schoolId, payload);
  }

  // ════════════════════════════════════════════════════════════════════
  // TEACHER SCOPE
  // ════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/teachers/{teacher_id}/classes
  async function listTeacherClasses(schoolId, teacherId) {
    return BACKEND.listTeacherClasses(schoolId, teacherId);
  }
  // GET /api/school/timetable?school_id=&teacher_id=
  async function getTeacherTimetable(schoolId, teacherId, opts) {
    return BACKEND.getTeacherTimetable(schoolId, teacherId, opts);
  }
  // GET /api/school/{school_id}/teachers/{teacher_id}/dashboard
  async function getTeacherDashboard(schoolId, teacherId, opts) {
    return BACKEND.getTeacherDashboard(schoolId, teacherId, opts);
  }
  // GET /api/school/{school_id}/teachers/{teacher_id}/classes/{class_id}/register
  async function getTeacherRegister(schoolId, teacherId, classId, opts) {
    return BACKEND.getTeacherRegister(schoolId, teacherId, classId, opts);
  }
  // POST /api/school/{school_id}/teachers/{teacher_id}/classes/{class_id}/attendance
  async function markTeacherAttendance(schoolId, teacherId, classId, payload) {
    return BACKEND.markTeacherAttendance(schoolId, teacherId, classId, payload);
  }
  // GET /api/school/{school_id}/teachers/{teacher_id}/exams/{exam_id}/mark-sheet
  async function getTeacherMarkSheet(schoolId, teacherId, examId, opts) {
    return BACKEND.getTeacherMarkSheet(schoolId, teacherId, examId, opts);
  }
  // PUT /api/school/{school_id}/teachers/{teacher_id}/exams/{exam_id}/results
  async function saveTeacherResults(schoolId, teacherId, examId, payload) {
    return BACKEND.saveTeacherResults(schoolId, teacherId, examId, payload);
  }

  // ════════════════════════════════════════════════════════════════════
  // PARENT SCOPE
  // ════════════════════════════════════════════════════════════════════

  // GET /api/school/{school_id}/guardians/{person_id}/children
  async function listMyChildren(schoolId, personId) {
    return BACKEND.listMyChildren(schoolId, personId);
  }
  // GET /api/school/{school_id}/guardians/{person_id}/children/{student_id}/fees
  async function getChildFees(schoolId, personId, studentId) {
    return BACKEND.getChildFees(schoolId, personId, studentId);
  }
  // GET /api/school/{school_id}/guardians/{person_id}/children/{student_id}/attendance
  async function getChildAttendance(schoolId, personId, studentId, opts) {
    return BACKEND.getChildAttendance(schoolId, personId, studentId, opts);
  }
  // GET /api/school/{school_id}/guardians/{person_id}/children/{student_id}/results
  async function getChildResults(schoolId, personId, studentId) {
    return BACKEND.getChildResults(schoolId, personId, studentId);
  }
  // GET /api/school/{school_id}/guardians/{person_id}/messages
  async function getGuardianMessages(schoolId, personId) {
    return BACKEND.getGuardianMessages(schoolId, personId);
  }

  // ════════════════════════════════════════════════════════════════════
  // GUARDIAN PORTAL
  // ════════════════════════════════════════════════════════════════════

  // POST /api/school/students/{student_id}/guardian-token
  async function issueGuardianToken(schoolId, studentId, payload) {
    return BACKEND.issueGuardianToken(schoolId, studentId, payload);
  }
  // GET /api/school/{school_id}/students/{student_id}/guardian-tokens
  async function listGuardianTokens(schoolId, studentId) {
    return BACKEND.listGuardianTokens(schoolId, studentId);
  }
  // POST /api/school/guardian-tokens/{id}/revoke
  async function revokeGuardianToken(schoolId, tokenId) {
    return BACKEND.revokeGuardianToken(schoolId, tokenId);
  }
  // GET /api/school/guardian-portal/{token}
  async function getGuardianPortal(token, opts) {
    return BACKEND.getGuardianPortal(token, opts);
  }

  // ════════════════════════════════════════════════════════════════════
  // ADAPTER PASS-THROUGHS
  // Not routes. These exist because the demo runs without a server: the
  // store has to be resettable and inspectable. In step 5 they go with
  // demo-backend.js.
  // ════════════════════════════════════════════════════════════════════
  global.ShuleAPI = {
    listIntegrations: listIntegrations,
    saveIntegration: saveIntegration,
    testIntegration: testIntegration,
    disconnectIntegration: disconnectIntegration,
    getSubscription: getSubscription,
    listPlans: listPlans,
    login: login,
    getMe: getMe,
    logout: logout,
    register: register,
    verifyEmail: verifyEmail,
    resendVerification: resendVerification,
    hasSession: hasSession,
    currentUser: currentUser,
    mode: async function () { return (global.SHULE_CONFIG && global.SHULE_CONFIG.mode) || 'demo'; },
    listStudents: listStudents,
    getStudent: getStudent,
    createStudent: createStudent,
    listClasses: listClasses,
    listTeachers: listTeachers,
    listSubjects: listSubjects,
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
    listAttendance: listAttendance,
    getRegisterStatus: getRegisterStatus,
    markAttendance: markAttendance,
    listExams: listExams,
    listExamResults: listExamResults,
    listReportCards: listReportCards,
    publishReportCards: publishReportCards,
    listGradingScales: listGradingScales,
    listAnnouncements: listAnnouncements,
    listEvents: listEvents,
    getDashboardSummary: getDashboardSummary,
    getNeedsAttention: getNeedsAttention,
    searchStudents: searchStudents,
    updateStudent: updateStudent,
    promoteStudents: promoteStudents,
    transferStudent: transferStudent,
    importStudentsCSV: importStudentsCSV,
    exportStudentsCSV: exportStudentsCSV,
    sendMessage: sendMessage,
    listGuardians: listGuardians,
    addGuardian: addGuardian,
    updateGuardian: updateGuardian,
    setPrimaryGuardian: setPrimaryGuardian,
    removeGuardian: removeGuardian,
    listDiscipline: listDiscipline,
    addDiscipline: addDiscipline,
    createFeeStructure: createFeeStructure,
    updateFeeStructure: updateFeeStructure,
    deleteFeeStructure: deleteFeeStructure,
    cloneFeeStructure: cloneFeeStructure,
    listInvoiceRows: listInvoiceRows,
    bulkGenerateInvoices: bulkGenerateInvoices,
    getReceipt: getReceipt,
    listPaymentLedger: listPaymentLedger,
    exportPaymentsCSV: exportPaymentsCSV,
    listJournalLines: listJournalLines,
    listDefaulterRows: listDefaulterRows,
    sendRemindersFor: sendRemindersFor,
    listWaiverRows: listWaiverRows,
    createWaiver: createWaiver,
    approveWaiver: approveWaiver,
    rejectWaiver: rejectWaiver,

    listGradingScaleRows: listGradingScaleRows,
    createGradingScale: createGradingScale,
    updateGradingScale: updateGradingScale,
    deleteGradingScale: deleteGradingScale,
    setDefaultGradingScale: setDefaultGradingScale,
    getClassRegister: getClassRegister,
    getAttendanceReport: getAttendanceReport,
    getAbsentees: getAbsentees,
    listExamRows: listExamRows,
    createExam: createExam,
    updateExam: updateExam,
    getMarkSheet: getMarkSheet,
    saveExamResults: saveExamResults,
    verifyExamResults: verifyExamResults,
    getClassAnalysis: getClassAnalysis,
    getMeritList: getMeritList,
    generateReportCards: generateReportCards,
    listReportCardRows: listReportCardRows,
    getReportCard: getReportCard,
    updateReportCard: updateReportCard,
    publishReportCardsFor: publishReportCardsFor,
    withdrawReportCardsFor: withdrawReportCardsFor,

    listTeacherClasses: listTeacherClasses,
    getTeacherTimetable: getTeacherTimetable,
    getTeacherDashboard: getTeacherDashboard,
    getTeacherRegister: getTeacherRegister,
    markTeacherAttendance: markTeacherAttendance,
    getTeacherMarkSheet: getTeacherMarkSheet,
    saveTeacherResults: saveTeacherResults,
    listMyChildren: listMyChildren,
    getChildFees: getChildFees,
    getChildAttendance: getChildAttendance,
    getChildResults: getChildResults,
    getGuardianMessages: getGuardianMessages,
    issueGuardianToken: issueGuardianToken,
    listGuardianTokens: listGuardianTokens,
    revokeGuardianToken: revokeGuardianToken,
    getGuardianPortal: getGuardianPortal,

    // constants the backend owns; re-exported so pages read one source
    CSV_COLUMNS: BACKEND.CSV_COLUMNS,
    MAX_REMINDERS: BACKEND.MAX_REMINDERS,
    EXAM_TYPES: BACKEND.EXAM_TYPES,
    validateBands: BACKEND.validateBands,
    PORTAL_STATES: BACKEND.PORTAL_STATES,
    STORE_KEY: BACKEND.STORE_KEY,

    // demo-only adapter hooks
    resetStore: function () { return BACKEND.resetStore(); },
    persist: function () { return BACKEND.persist(); },
    ledgerDrift: function () { return BACKEND.ledgerDrift(); },
    _store: function () { return BACKEND._store(); },
    _backend: BACKEND
  };
})(typeof window !== 'undefined' ? window : globalThis);
