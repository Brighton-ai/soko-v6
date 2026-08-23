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

  var BACKEND = global.SHULE_BACKEND || global.DemoBackend;
  if (!BACKEND) {
    throw new Error('Shule API: no backend. Load assets/js/demo-backend.js before assets/js/api.js, ' +
      'or set window.SHULE_BACKEND to your own implementation.');
  }
  // GET /api/school/{school_id}/students
  async function listStudents(schoolId, opts) {
    return BACKEND.listStudents(schoolId, opts);
  }
  // GET /api/school/{school_id}/students/{student_id}
  async function getStudent(schoolId, studentId) {
    return BACKEND.getStudent(schoolId, studentId);
  }
  // POST /api/school/{school_id}/students
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
  // GET /api/school/{school_id}/fee-structures
  async function listFeeStructures(schoolId, opts) {
    return BACKEND.listFeeStructures(schoolId, opts);
  }
  // GET /api/school/{school_id}/fee-invoices
  async function listFeeInvoices(schoolId, opts) {
    return BACKEND.listFeeInvoices(schoolId, opts);
  }
  // GET /api/school/{school_id}/fee-invoices/defaulters
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
  // POST /api/school/{school_id}/fee-invoices/{invoice_id}/payments
  async function recordPayment(schoolId, invoiceId, payload) {
    return BACKEND.recordPayment(schoolId, invoiceId, payload);
  }
  // POST /api/school/{school_id}/fee-invoices/reminders
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
  // GET /api/school/{school_id}/attendance
  async function listAttendance(schoolId, opts) {
    return BACKEND.listAttendance(schoolId, opts);
  }
  // GET /api/school/{school_id}/attendance/register-status
  async function getRegisterStatus(schoolId, opts) {
    return BACKEND.getRegisterStatus(schoolId, opts);
  }
  // POST /api/school/{school_id}/classes/{class_id}/attendance
  async function markAttendance(schoolId, classId, payload) {
    return BACKEND.markAttendance(schoolId, classId, payload);
  }
  // GET /api/school/{school_id}/exams
  async function listExams(schoolId, opts) {
    return BACKEND.listExams(schoolId, opts);
  }
  // GET /api/school/{school_id}/exams/{exam_id}/results
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
  // GET /api/school/{school_id}/grading-scales
  async function listGradingScales(schoolId) {
    return BACKEND.listGradingScales(schoolId);
  }
  // GET /api/school/{school_id}/announcements
  async function listAnnouncements(schoolId, opts) {
    return BACKEND.listAnnouncements(schoolId, opts);
  }
  // GET /api/school/{school_id}/events
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
  // PATCH /api/school/{school_id}/students/{student_id}
  async function updateStudent(schoolId, studentId, payload) {
    return BACKEND.updateStudent(schoolId, studentId, payload);
  }
  // POST /api/school/{school_id}/students/promote
  async function promoteStudents(schoolId, payload) {
    return BACKEND.promoteStudents(schoolId, payload);
  }
  // POST /api/school/{school_id}/students/{student_id}/transfer
  async function transferStudent(schoolId, studentId, payload) {
    return BACKEND.transferStudent(schoolId, studentId, payload);
  }
  // POST /api/school/{school_id}/students/import
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
  // GET /api/school/{school_id}/students/{student_id}/guardians
  async function listGuardians(schoolId, studentId) {
    return BACKEND.listGuardians(schoolId, studentId);
  }
  // POST /api/school/{school_id}/students/{student_id}/guardians
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
  // GET /api/school/{school_id}/students/{student_id}/discipline
  async function listDiscipline(schoolId, opts) {
    return BACKEND.listDiscipline(schoolId, opts);
  }
  // POST /api/school/{school_id}/students/{student_id}/discipline
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
  // POST /api/school/{school_id}/fee-invoices/bulk-generate?dry_run=true
  async function bulkGenerateInvoices(schoolId, payload) {
    return BACKEND.bulkGenerateInvoices(schoolId, payload);
  }
  // GET /api/school/{school_id}/payments/{payment_id}/receipt
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
  // POST /api/school/{school_id}/fee-invoices/reminders
  async function sendRemindersFor(schoolId, payload) {
    return BACKEND.sendRemindersFor(schoolId, payload);
  }
  // GET /api/school/{school_id}/fee-waivers
  async function listWaiverRows(schoolId, opts) {
    return BACKEND.listWaiverRows(schoolId, opts);
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
  // ADAPTER PASS-THROUGHS
  // Not routes. These exist because the demo runs without a server: the
  // store has to be resettable and inspectable. In step 5 they go with
  // demo-backend.js.
  // ════════════════════════════════════════════════════════════════════
  global.ShuleAPI = {
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
    approveWaiver: approveWaiver,
    rejectWaiver: rejectWaiver,

    // constants the backend owns; re-exported so pages read one source
    CSV_COLUMNS: BACKEND.CSV_COLUMNS,
    MAX_REMINDERS: BACKEND.MAX_REMINDERS,
    STORE_KEY: BACKEND.STORE_KEY,

    // demo-only adapter hooks
    resetStore: function () { return BACKEND.resetStore(); },
    persist: function () { return BACKEND.persist(); },
    ledgerDrift: function () { return BACKEND.ledgerDrift(); },
    _store: function () { return BACKEND._store(); },
    _backend: BACKEND
  };
})(typeof window !== 'undefined' ? window : globalThis);
