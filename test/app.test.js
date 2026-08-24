'use strict';
/**
 * Shule app — behaviour under jsdom.
 *
 * static.test.js reads the served HTML; this file runs it. Each page is loaded
 * with scripts enabled, given time to resolve its API calls, and then asserted
 * against the RENDERED DOM.
 *
 * The KPI tests deliberately recompute every figure from window.DEMO_DATA and
 * compare it against what the page printed. A number typed into the markup
 * would pass a "does it say something" check and fail this one.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SCHOOL = 'sch-riverside';

// ── page harness ───────────────────────────────────────────────────────────

/**
 * Loads a page with its real scripts, in a jsdom that can reach the sibling
 * files on disk. Resolves once the page has finished its first render.
 */
async function openPage(relPath, opts = {}) {
  // An http origin, not file://. jsdom only grants localStorage to a real
  // origin, and the shell reads the signed-in role out of it.
  const url = 'https://shule.test/' + relPath;
  const filePath = path.join(ROOT, relPath.split('?')[0]);
  const dom = new JSDOM(fs.readFileSync(filePath, 'utf8'), {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.SHULE_API_LATENCY = 0;
      // every test starts from the seed, never from what a previous test wrote
      try {
        if (opts.seedStore) win.sessionStorage.setItem('shule.store', opts.seedStore);
        else win.sessionStorage.removeItem('shule.store');
      } catch (e) { /* jsdom always has it */ }
      if (opts.onConsoleError) {
        var realError = win.console.error.bind(win.console);
        win.console.error = function () {
          opts.onConsoleError(Array.prototype.map.call(arguments, String).join(' '));
          realError.apply(null, arguments);
        };
      }
      if (opts.role) {
        try { win.localStorage.setItem('shule.role', opts.role); } catch (e) { /* jsdom always has it */ }
      }
      win.matchMedia = win.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    }
  });
  await loadScriptsManually(dom, relPath.split('?')[0]);
  await settle(dom.window, opts.readySelector || 'body[data-ready="1"]', relPath);
  return dom;
}

/**
 * jsdom will not fetch file:// scripts, so the page's own <script src> tags are
 * read off disk and evaluated in order — the same order the browser would use.
 */
async function loadScriptsManually(dom, relPath) {
  const win = dom.window;
  const dir = path.dirname(path.join(ROOT, relPath));
  const srcs = Array.from(win.document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src'));
  for (const src of srcs) {
    const file = path.resolve(dir, src);
    if (!fs.existsSync(file)) throw new Error(`${relPath} references ${src}, which is not on disk at ${file}`);
    win.eval(fs.readFileSync(file, 'utf8'));
  }
  // scripts that were parsed before DOMContentLoaded fired still expect the event
  win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
}

/** Polls until the page says it is ready, or explains what it was waiting for. */
function settle(win, selector, relPath, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function poll() {
      if (win.document.querySelector(selector)) return resolve();
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(
          `${relPath} never reached "${selector}" within ${timeoutMs}ms. ` +
          `body[data-ready] is "${win.document.body.getAttribute('data-ready')}" and ` +
          `body[data-shell] is "${win.document.body.getAttribute('data-shell')}".`));
      }
      win.setTimeout(poll, 5);
    })();
  });
}

/**
 * Values pulled out of a jsdom window carry that realm's prototypes, so a
 * plain assert.deepEqual fails on Array-vs-Array. Everything is normalised
 * into this realm before comparison.
 */
const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const deepEqual = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);

/**
 * The LIVE store — what api.js actually reads and writes. window.DEMO_DATA is
 * only the seed it was hydrated from, so anything asserting on a mutation has
 * to look here or it will be reading a snapshot that never changes.
 */
const storeOf = (win) => win.ShuleAPI._store();

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const $ = (win, sel) => win.document.querySelector(sel);
const $$ = (win, sel) => Array.from(win.document.querySelectorAll(sel));

// ── shared formatting, mirrored from assets/js/dashboard.js ────────────────
const nf = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });
const num = (n) => nf.format(Math.round(n));
const kes = (n) => 'KES ' + num(n);
const pct = (n) => n.toFixed(1) + '%';

// ── suites ────────────────────────────────────────────────────────────────

describe('Data integrity', () => {
  let D;
  before(async () => {
    const dom = await openPage('app/dashboard.html');
    D = dom.window.DEMO_DATA;
    dom.window.close();
  });

  it('the dataset loads and carries every collection', () => {
    const need = ['school', 'terms', 'classes', 'subjects', 'teachers', 'assignments', 'students',
      'fee_structures', 'invoices', 'payments', 'attendance', 'exams', 'exam_results',
      'grading_scale', 'announcements', 'events'];
    const missing = need.filter((k) => D[k] == null);
    deepEqual(missing, [], `window.DEMO_DATA is missing: ${missing.join(', ')}`);
  });

  it('has the shape the brief asked for', () => {
    assert.equal(D.school.name, 'Riverside Academy', `The school is "${D.school.name}", expected "Riverside Academy".`);
    assert.equal(D.school.terms_per_year, 3, `terms_per_year is ${D.school.terms_per_year}, expected 3.`);
    assert.equal(D.current_term_id, 't2-2026', `The current term is ${D.current_term_id}, expected t2-2026.`);
    assert.equal(D.students.length, 240, `There are ${D.students.length} students, expected 240.`);
    assert.equal(D.classes.length, 8, `There are ${D.classes.length} classes, expected 8.`);
    assert.equal(D.teachers.length, 12, `There are ${D.teachers.length} teachers, expected 12.`);
    assert.equal(D.subjects.length, 9, `There are ${D.subjects.length} subjects, expected 9.`);
    assert.equal(D.announcements.length, 6, `There are ${D.announcements.length} announcements, expected 6.`);
    assert.equal(D.events.length, 4, `There are ${D.events.length} events, expected 4.`);
    assert.ok(D.grading_scale.bands.length >= 5, `The grading scale has ${D.grading_scale.bands.length} bands; a usable scale needs more.`);
    for (const b of D.grading_scale.bands) {
      for (const key of ['grade', 'min', 'max', 'points', 'remark']) {
        assert.ok(b[key] != null, `Grading band ${b.grade} has no ${key}.`);
      }
    }
  });

  it('every class has streams and both school levels are represented', () => {
    const noStream = D.classes.filter((c) => !c.stream).map((c) => c.name);
    deepEqual(noStream, [], `Classes with no stream: ${noStream.join(', ')}`);
    const levels = [...new Set(D.classes.map((c) => c.level))].sort();
    deepEqual(levels, ['junior_secondary', 'primary'],
      `Expected primary and junior secondary classes, found: ${levels.join(', ')}`);
  });

  it('every student has a guardian, a class and a scholarship figure', () => {
    const classIds = new Set(D.classes.map((c) => c.id));
    const bad = [];
    for (const s of D.students) {
      if (!classIds.has(s.class_id)) bad.push(`${s.admission_no} sits in unknown class ${s.class_id}`);
      if (!s.guardian_name) bad.push(`${s.admission_no} has no guardian name`);
      if (!/^\d[\d\s]{8,}$/.test(s.guardian_phone)) bad.push(`${s.admission_no} has an unusable guardian phone "${s.guardian_phone}"`);
      if (typeof s.scholarship_amount !== 'number') bad.push(`${s.admission_no} has no scholarship_amount`);
    }
    deepEqual(bad.slice(0, 8), [], `Student records are malformed:\n  ${bad.slice(0, 8).join('\n  ')}`);
    const scholars = D.students.filter((s) => s.scholarship_amount > 0).length;
    assert.ok(scholars > 0 && scholars < D.students.length * 0.25,
      `${scholars} of ${D.students.length} pupils carry a scholarship; the brief asked for most zero and a handful non-zero.`);
  });

  it('every subject assignment binds a real teacher, subject and class', () => {
    const t = new Set(D.teachers.map((x) => x.id));
    const s = new Set(D.subjects.map((x) => x.id));
    const c = new Set(D.classes.map((x) => x.id));
    const bad = D.assignments.filter((a) => !t.has(a.teacher_id) || !s.has(a.subject_id) || !c.has(a.class_id))
      .map((a) => `${a.id} -> teacher ${a.teacher_id}, subject ${a.subject_id}, class ${a.class_id}`);
    deepEqual(bad, [], `Assignments referencing records that do not exist:\n  ${bad.join('\n  ')}`);
    assert.ok(D.assignments.length >= D.classes.length, `Only ${D.assignments.length} assignments for ${D.classes.length} classes.`);
  });

  it('every class has an itemised fee structure for the current term', () => {
    const bad = [];
    for (const c of D.classes) {
      const fs = D.fee_structures.find((f) => f.class_id === c.id && f.term_id === D.current_term_id);
      if (!fs) { bad.push(`${c.full_name} has no fee structure for ${D.current_term_id}`); continue; }
      if (!fs.items || fs.items.length < 3) bad.push(`${c.full_name} fee structure has ${fs.items ? fs.items.length : 0} items; it should be itemised`);
      const mandatory = fs.items.filter((i) => i.mandatory).reduce((n, i) => n + i.amount, 0);
      if (mandatory !== fs.total_mandatory) bad.push(`${c.full_name} total_mandatory is ${fs.total_mandatory} but its items sum to ${mandatory}`);
      if (!fs.items.some((i) => /transport/i.test(i.name))) bad.push(`${c.full_name} fee structure has no transport line`);
    }
    deepEqual(bad, [], `Fee structures are wrong:\n  ${bad.join('\n  ')}`);
  });

  it('every invoice references a real student', () => {
    const ids = new Set(D.students.map((s) => s.id));
    const orphans = D.invoices.filter((i) => !ids.has(i.student_id))
      .map((i) => `${i.id} points at student ${i.student_id}, which does not exist`);
    deepEqual(orphans, [], `Orphaned invoices:\n  ${orphans.join('\n  ')}`);
    assert.equal(D.invoices.length, D.students.length,
      `There are ${D.invoices.length} invoices for ${D.students.length} students; every pupil should have one.`);
  });

  it('balance equals amount_due minus amount_paid minus discount on every invoice', () => {
    const bad = D.invoices
      .filter((i) => i.balance !== i.amount_due - i.amount_paid - (i.discount_amount || 0))
      .map((i) => `${i.id}: due ${i.amount_due} − paid ${i.amount_paid} − discount ${i.discount_amount || 0} = ` +
        `${i.amount_due - i.amount_paid - (i.discount_amount || 0)}, but balance says ${i.balance}`);
    deepEqual(bad, [], `Invoice arithmetic does not hold:\n  ${bad.slice(0, 10).join('\n  ')}`);
  });

  it('invoice status agrees with the money, and paid invoices carry an M-Pesa code', () => {
    const bad = [];
    for (const i of D.invoices) {
      // a discount is not a payment: only money paid moves an invoice off "unpaid"
      const expected = i.balance === 0 ? 'cleared' : (i.amount_paid === 0 ? 'unpaid' : 'part_paid');
      if (i.status !== expected) bad.push(`${i.id} is "${i.status}" but paid ${i.amount_paid} of ${i.amount_due}, which is "${expected}"`);
      if (i.amount_paid > 0 && !i.mpesa_code) bad.push(`${i.id} was paid but has no mpesa_code`);
      if (i.amount_paid === 0 && i.mpesa_code) bad.push(`${i.id} was never paid but carries mpesa_code ${i.mpesa_code}`);
      if (typeof i.reminders_sent !== 'number') bad.push(`${i.id} has no reminders_sent count`);
      if (!i.due_date) bad.push(`${i.id} has no due_date`);
    }
    deepEqual(bad.slice(0, 10), [], `Invoice status is inconsistent with the amounts:\n  ${bad.slice(0, 10).join('\n  ')}`);
  });

  it('the paid / part-paid / unpaid mix is roughly 78 / 14 / 8 percent', () => {
    const share = (s) => D.invoices.filter((i) => i.status === s).length / D.invoices.length * 100;
    const cleared = share('cleared'), part = share('part_paid'), unpaid = share('unpaid');
    assert.ok(Math.abs(cleared - 78) <= 3, `${cleared.toFixed(1)}% of invoices are cleared; the brief asked for roughly 78%.`);
    assert.ok(Math.abs(part - 14) <= 3, `${part.toFixed(1)}% of invoices are part paid; the brief asked for roughly 14%.`);
    assert.ok(Math.abs(unpaid - 8) <= 3, `${unpaid.toFixed(1)}% of invoices are untouched; the brief asked for roughly 8%.`);
  });

  it('every payment references a real invoice and student', () => {
    const inv = new Set(D.invoices.map((i) => i.id));
    const stu = new Set(D.students.map((s) => s.id));
    const bad = D.payments.filter((p) => !inv.has(p.invoice_id) || !stu.has(p.student_id))
      .map((p) => `${p.id} -> invoice ${p.invoice_id}, student ${p.student_id}`);
    deepEqual(bad, [], `Payments referencing records that do not exist:\n  ${bad.join('\n  ')}`);
  });

  it('every attendance record references a real student and class', () => {
    const stu = new Set(D.students.map((s) => s.id));
    const cls = new Set(D.classes.map((c) => c.id));
    const bad = [];
    for (const a of D.attendance) {
      if (!stu.has(a.student_id)) bad.push(`${a.id} points at student ${a.student_id}`);
      else if (!cls.has(a.class_id)) bad.push(`${a.id} points at class ${a.class_id}`);
      if (bad.length >= 10) break;
    }
    deepEqual(bad, [], `Orphaned attendance records:\n  ${bad.join('\n  ')}`);
  });

  it('attendance covers 60 school days at roughly 94% present', () => {
    const days = [...new Set(D.attendance.map((a) => a.date))];
    assert.equal(days.length, 60, `Attendance spans ${days.length} distinct days, expected 60.`);
    const weekend = days.filter((d) => [0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()));
    deepEqual(weekend, [], `Attendance was recorded on non-school days: ${weekend.join(', ')}`);
    const present = D.attendance.filter((a) => a.status === 'present').length / D.attendance.length * 100;
    assert.ok(Math.abs(present - 94) <= 3, `${present.toFixed(1)}% of marks are "present"; the brief asked for roughly 94%.`);
    const absent = D.attendance.filter((a) => a.status === 'absent');
    assert.ok(absent.length > 0, 'No absences at all — the register is not worth looking at.');
    const noMarker = D.attendance.filter((a) => !a.marked_by).length;
    assert.equal(noMarker, 0, `${noMarker} attendance records have no marked_by; every mark needs a name against it.`);
  });

  it('absence clusters rather than sprinkling evenly', () => {
    const byStudent = {};
    for (const a of D.attendance) {
      if (a.status !== 'absent') continue;
      (byStudent[a.student_id] = byStudent[a.student_id] || []).push(a.date);
    }
    let runs = 0, singles = 0;
    for (const dates of Object.values(byStudent)) {
      const sorted = dates.slice().sort();
      for (let i = 0; i < sorted.length; i++) {
        const next = new Date(sorted[i] + 'T00:00:00Z');
        next.setUTCDate(next.getUTCDate() + 1);
        if (sorted.includes(next.toISOString().slice(0, 10))) runs++; else singles++;
      }
    }
    assert.ok(runs > 0, 'Not one absence runs into the next day; the brief asked for realistic clustering, not evenly sprinkled noise.');
  });

  it('several exams exist, one with results, some rows unverified', () => {
    const exams = D.exams.filter((e) => e.term_id === D.current_term_id);
    assert.ok(exams.length >= 2, `There are ${exams.length} exams this term; at least 2 were expected.`);
    const scales = new Set(exams.map((e) => e.grading_scale_id));
    assert.ok(scales.size >= 2,
      `Every seeded exam binds to the same grading scale (${[...scales].join(', ')}); ` +
      'both seeded scales should be in use so they are visible side by side.');
    const withResults = exams.filter((e) => D.exam_results.some((r) => r.exam_id === e.id));
    assert.equal(withResults.length, 1, `${withResults.length} exams have results; the brief asked for exactly one.`);
    const unverified = D.exam_results.filter((r) => !r.verified);
    assert.ok(unverified.length > 0, 'Every result is verified; the brief asked for some rows left unverified.');
    assert.ok(unverified.length < D.exam_results.length, 'No result is verified at all; the mix should be partial.');
  });

  it('every exam result references a real exam, student and subject', () => {
    const exams = new Set(D.exams.map((e) => e.id));
    const stu = new Set(D.students.map((s) => s.id));
    const sub = new Set(D.subjects.map((s) => s.id));
    const bad = [];
    for (const r of D.exam_results) {
      if (!exams.has(r.exam_id)) bad.push(`${r.id} -> exam ${r.exam_id}`);
      else if (!stu.has(r.student_id)) bad.push(`${r.id} -> student ${r.student_id}`);
      else if (!sub.has(r.subject_id)) bad.push(`${r.id} -> subject ${r.subject_id}`);
      if (bad.length >= 10) break;
    }
    deepEqual(bad, [], `Exam results referencing records that do not exist:\n  ${bad.join('\n  ')}`);
  });

  it('every result grade matches the grading scale band for its score', () => {
    const bands = D.grading_scale.bands;
    const bad = D.exam_results.filter((r) => {
      const band = bands.find((b) => r.score >= b.min && r.score <= b.max);
      return !band || band.grade !== r.grade;
    }).map((r) => `${r.id} scored ${r.score} but is graded ${r.grade}`);
    deepEqual(bad.slice(0, 10), [], `Grades do not follow the scale:\n  ${bad.slice(0, 10).join('\n  ')}`);
  });

  it('the seeded generator produces identical output across two loads', async () => {
    const a = await openPage('app/dashboard.html');
    const b = await openPage('app/dashboard.html');
    const one = JSON.stringify(a.window.DEMO_DATA);
    const two = JSON.stringify(b.window.DEMO_DATA);
    a.window.close(); b.window.close();
    assert.equal(one.length, two.length,
      `Two loads produced datasets of different sizes (${one.length} vs ${two.length} bytes); the generator is not deterministic.`);
    assert.equal(one, two,
      'Two loads of demo-data.js produced different data. The dataset must be seeded so tests and the UI agree on every figure.');
  });
});

describe('Dashboard render', () => {
  let dom, win, D;
  before(async () => { dom = await openPage('app/dashboard.html'); win = dom.window; D = win.DEMO_DATA; });
  after(() => { if (dom) dom.window.close(); });

  // recomputed straight from the dataset, never read back off the page
  const expected = () => {
    const termId = D.current_term_id;
    const invoices = D.invoices.filter((i) => i.term_id === termId);
    const invoiced = invoices.reduce((n, i) => n + i.amount_due, 0);
    const collected = invoices.reduce((n, i) => n + i.amount_paid, 0);
    const discounted = invoices.reduce((n, i) => n + (i.discount_amount || 0), 0);
    const collectable = invoiced - discounted;
    const today = D.attendance.filter((a) => a.date === D.today);
    const here = today.filter((a) => a.status === 'present' || a.status === 'late').length;
    return {
      enrolment: D.students.filter((s) => s.status === 'active').length,
      rate: collectable ? collected / collectable * 100 : 0,
      outstanding: invoices.reduce((n, i) => n + i.balance, 0),
      attendance: today.length ? here / today.length * 100 : null
    };
  };

  it('every panel resolved out of its loading state', () => {
    const stuck = $$(win, '[data-panel]')
      .filter((p) => p.getAttribute('data-state') !== 'content' && p.getAttribute('data-state') !== 'empty')
      .map((p) => `${p.getAttribute('data-panel')} is "${p.getAttribute('data-state') ?? 'still loading'}"`);
    deepEqual(stuck, [], `Panels never finished loading:\n  ${stuck.join('\n  ')}`);
  });

  it('no skeleton is still on screen after load', () => {
    const visible = $$(win, '.sk').filter((el) => {
      let node = el;
      while (node && node !== win.document.body) {
        if (node.hidden) return false;
        node = node.parentElement;
      }
      return true;
    });
    assert.equal(visible.length, 0, `${visible.length} skeleton placeholders are still visible after the page settled.`);
  });

  it('KPI: pupils enrolled is computed from the dataset', () => {
    const got = text($(win, '[data-kpi="enrolment"] [data-kpi-value]'));
    assert.equal(got, num(expected().enrolment),
      `The enrolment tile reads "${got}" but the dataset holds ${expected().enrolment} active pupils. A hardcoded figure would look exactly like this.`);
  });

  it('KPI: collection rate is computed from the invoices', () => {
    const got = text($(win, '[data-kpi="collection"] [data-kpi-value]'));
    assert.equal(got, pct(expected().rate),
      `The collection-rate tile reads "${got}" but the invoices give ${pct(expected().rate)}.`);
  });

  it('KPI: outstanding balance is computed from the invoices', () => {
    const got = text($(win, '[data-kpi="outstanding"] [data-kpi-value]'));
    assert.equal(got, kes(expected().outstanding),
      `The outstanding tile reads "${got}" but the invoices give ${kes(expected().outstanding)}.`);
  });

  it("KPI: today's attendance is computed from today's register", () => {
    const got = text($(win, '[data-kpi="attendance"] [data-kpi-value]'));
    assert.equal(got, pct(expected().attendance),
      `The attendance tile reads "${got}" but today's marked registers give ${pct(expected().attendance)}.`);
  });

  it('every KPI shows a delta against the prior period', () => {
    const missing = ['enrolment', 'collection', 'outstanding', 'attendance']
      .filter((k) => {
        const d = text($(win, `[data-kpi="${k}"] [data-kpi-delta]`));
        return !d || d.length < 3;
      });
    deepEqual(missing, [], `These KPI tiles show no term-on-term or day-on-day delta: ${missing.join(', ')}`);
  });

  it('the enrolment delta matches last term', () => {
    const prior = D.terms.find((t) => t.id === 't1-2026');
    const delta = expected().enrolment - prior.enrolment;
    const got = text($(win, '[data-kpi="enrolment"] [data-kpi-delta]'));
    assert.ok(got.includes(String(Math.abs(delta))),
      `The enrolment delta reads "${got}" but ${expected().enrolment} now against ${prior.enrolment} last term is a change of ${delta}.`);
  });
});

describe('Collections chart', () => {
  let dom, win, D;
  before(async () => { dom = await openPage('app/dashboard.html'); win = dom.window; D = win.DEMO_DATA; });
  after(() => { if (dom) dom.window.close(); });

  const bars = () => $$(win, '#collections-chart .chart__bar');

  it('draws exactly 14 bars', () => {
    assert.equal(bars().length, 14, `The chart drew ${bars().length} bars; the panel says fourteen days.`);
  });

  it('highlights exactly one day', () => {
    const peaks = $$(win, '#collections-chart .chart__bar.is-peak');
    assert.equal(peaks.length, 1, `${peaks.length} bars carry the is-peak class; exactly one day should be solid orange.`);
  });

  it('highlights the day with the most collected', () => {
    const values = bars().map((b) => Number(b.getAttribute('data-value')));
    const max = Math.max(...values);
    const peak = $(win, '#collections-chart .chart__bar.is-peak');
    assert.equal(Number(peak.getAttribute('data-value')), max,
      `The highlighted bar holds ${peak.getAttribute('data-value')} but the tallest day collected ${max}.`);
  });

  it('bar heights are proportional to their values', () => {
    const drawn = bars()
      .map((b) => ({ v: Number(b.getAttribute('data-value')), h: Number(b.getAttribute('height')), d: b.getAttribute('data-date') }))
      .filter((b) => b.v > 0);
    assert.ok(drawn.length >= 5, `Only ${drawn.length} bars carry a value; the window should hold a fortnight of school days.`);
    const ratio = drawn[0].h / drawn[0].v;
    const off = drawn.filter((b) => Math.abs(b.h / b.v - ratio) > ratio * 0.02)
      .map((b) => `${b.d}: ${b.v} drawn at height ${b.h} (expected ${(b.v * ratio).toFixed(2)})`);
    deepEqual(off, [], `Bar heights are not proportional to their values:\n  ${off.join('\n  ')}`);
  });

  it('bar values match the payments in the dataset', () => {
    const off = bars().map((b) => {
      const date = b.getAttribute('data-date');
      const real = D.payments.filter((p) => p.paid_at.slice(0, 10) === date).reduce((n, p) => n + p.amount, 0);
      const drawn = Number(b.getAttribute('data-value'));
      return drawn === real ? null : `${date}: chart says ${drawn}, payments sum to ${real}`;
    }).filter(Boolean);
    deepEqual(off, [], `The chart is not drawn from the payment records:\n  ${off.join('\n  ')}`);
  });

  it('the chart has an accessible description', () => {
    const svg = $(win, '#collections-chart');
    assert.equal(svg.getAttribute('role'), 'img', 'The chart has no role="img".');
    const label = svg.getAttribute('aria-label') || '';
    assert.ok(label.length > 40, `The chart aria-label is "${label}"; it should describe the totals, not just name the chart.`);
  });
});

describe('Arrears by class', () => {
  let dom, win, D;
  before(async () => { dom = await openPage('app/dashboard.html'); win = dom.window; D = win.DEMO_DATA; });
  after(() => { if (dom) dom.window.close(); });

  const rows = () => $$(win, '#arrears-rows tr');
  const owing = () => {
    const m = {};
    for (const i of D.invoices.filter((x) => x.term_id === D.current_term_id && x.balance > 0)) {
      m[i.class_id] = (m[i.class_id] || 0) + i.balance;
    }
    return m;
  };

  it('has one row per class carrying an outstanding balance', () => {
    const expectedCount = Object.keys(owing()).length;
    assert.equal(rows().length, expectedCount,
      `The arrears table drew ${rows().length} rows but ${expectedCount} classes are carrying a balance.`);
  });

  it('is sorted by outstanding, descending', () => {
    const drawn = rows().map((r) => Number(text(r.querySelector('[data-cell="outstanding"]')).replace(/[^\d]/g, '')));
    const sorted = drawn.slice().sort((a, b) => b - a);
    deepEqual(drawn, sorted, `Arrears rows are not sorted by outstanding descending. Drawn order: ${drawn.join(', ')}`);
  });

  it('every row matches the invoices for that class', () => {
    const real = owing();
    const off = rows().map((r) => {
      const id = r.getAttribute('data-class');
      const drawn = Number(text(r.querySelector('[data-cell="outstanding"]')).replace(/[^\d]/g, ''));
      return drawn === Math.round(real[id]) ? null : `${id}: table says ${drawn}, invoices sum to ${real[id]}`;
    }).filter(Boolean);
    deepEqual(off, [], `Arrears rows do not match the invoices:\n  ${off.join('\n  ')}`);
  });

  it('the table total sums to the outstanding KPI', () => {
    const sum = rows().reduce((n, r) => n + Number(text(r.querySelector('[data-cell="outstanding"]')).replace(/[^\d]/g, '')), 0);
    const kpi = Number(text($(win, '[data-kpi="outstanding"] [data-kpi-value]')).replace(/[^\d]/g, ''));
    assert.equal(sum, kpi,
      `The arrears rows sum to ${num(sum)} but the outstanding KPI reads ${num(kpi)}. One of them is not reading the invoices.`);
  });

  it('every row carries a proportion bar and a Send reminders button', () => {
    const bad = rows().map((r) => {
      const id = r.getAttribute('data-class');
      if (!r.querySelector('.bar__f')) return `${id} has no proportion bar`;
      if (!r.querySelector('[data-remind]')) return `${id} has no Send reminders button`;
      return null;
    }).filter(Boolean);
    deepEqual(bad, [], `Arrears rows are incomplete:\n  ${bad.join('\n  ')}`);
  });
});

describe('Send reminders', () => {
  let dom, win, D;
  before(async () => { dom = await openPage('app/dashboard.html'); win = dom.window; D = win.DEMO_DATA; });
  after(() => { if (dom) dom.window.close(); });

  it('increments reminders_sent for that class and shows a toast', async () => {
    const btn = $(win, '#arrears-rows [data-remind]');
    assert.ok(btn, 'No Send reminders button was rendered, so there is nothing to click.');
    const classId = btn.getAttribute('data-remind');
    D = storeOf(win);

    const unpaid = () => D.invoices.filter((i) => i.class_id === classId && i.balance > 0);
    const before = unpaid().map((i) => ({ id: i.id, n: i.reminders_sent }));
    assert.ok(before.length > 0, `Class ${classId} appears in the arrears table but has no unpaid invoices.`);

    const otherBefore = D.invoices.filter((i) => i.class_id !== classId && i.balance > 0)
      .map((i) => ({ id: i.id, n: i.reminders_sent }));

    btn.click();
    await new Promise((r) => win.setTimeout(r, 60));

    const notBumped = before.filter((b) => D.invoices.find((i) => i.id === b.id).reminders_sent !== b.n + 1)
      .map((b) => `${b.id} went from ${b.n} to ${D.invoices.find((i) => i.id === b.id).reminders_sent}, expected ${b.n + 1}`);
    deepEqual(notBumped, [], `Send reminders did not increment reminders_sent:\n  ${notBumped.slice(0, 6).join('\n  ')}`);

    const bled = otherBefore.filter((b) => D.invoices.find((i) => i.id === b.id).reminders_sent !== b.n).length;
    assert.equal(bled, 0, `${bled} invoices outside ${classId} were also incremented; reminders should be scoped to the class you clicked.`);

    const toast = $(win, '#toasts [data-toast]');
    assert.ok(toast, 'Clicking Send reminders showed no toast, so nothing tells the user it worked.');
    assert.ok(/\d/.test(text(toast)), `The reminder toast reads "${text(toast)}" but should name the count sent.`);
  });
});

describe('Register status today', () => {
  let dom, win, D;
  before(async () => { dom = await openPage('app/dashboard.html'); win = dom.window; D = win.DEMO_DATA; });
  after(() => { if (dom) dom.window.close(); });

  it('shows every class', () => {
    const rows = $$(win, '#register-rows tr');
    assert.equal(rows.length, D.classes.length,
      `The register panel drew ${rows.length} rows for ${D.classes.length} classes.`);
  });

  it('marks the classes that have marked, and flags the ones that have not', () => {
    const markedInData = new Set(D.attendance.filter((a) => a.date === D.today).map((a) => a.class_id));
    const off = $$(win, '#register-rows tr').map((r) => {
      const id = r.getAttribute('data-class');
      const drawn = r.getAttribute('data-marked') === 'true';
      return drawn === markedInData.has(id) ? null
        : `${id}: table says marked=${drawn}, the register says ${markedInData.has(id)}`;
    }).filter(Boolean);
    deepEqual(off, [], `Register status does not match the attendance records:\n  ${off.join('\n  ')}`);
    assert.ok(markedInData.size < D.classes.length, 'Every class marked today, so the unmarked state is never exercised.');
  });

  it('names who marked each register that is in', () => {
    const nameless = $$(win, '#register-rows tr[data-marked="true"]')
      .filter((r) => !text(r.children[2]) || text(r.children[2]) === '—')
      .map((r) => r.getAttribute('data-class'));
    deepEqual(nameless, [], `These marked registers do not say who marked them: ${nameless.join(', ')}`);
  });

  it('gives unmarked classes an overdue state pill', () => {
    const unmarked = $$(win, '#register-rows tr[data-marked="false"]');
    assert.ok(unmarked.length > 0, 'No class is unmarked, so the overdue pill is never shown.');
    const bad = unmarked.filter((r) => !r.querySelector('.tag--bad')).map((r) => r.getAttribute('data-class'));
    deepEqual(bad, [], `Unmarked classes with no overdue pill (the register is past 09:00): ${bad.join(', ')}`);
  });

  it('present and absent counts match the register', () => {
    const off = $$(win, '#register-rows tr[data-marked="true"]').map((r) => {
      const id = r.getAttribute('data-class');
      const mine = D.attendance.filter((a) => a.date === D.today && a.class_id === id);
      const here = mine.filter((a) => a.status === 'present' || a.status === 'late').length;
      const away = mine.filter((a) => a.status === 'absent' || a.status === 'excused').length;
      const drawnHere = Number(text(r.children[3]));
      const drawnAway = Number(text(r.children[4]));
      if (drawnHere !== here) return `${id}: present column says ${drawnHere}, register says ${here}`;
      if (drawnAway !== away) return `${id}: absent column says ${drawnAway}, register says ${away}`;
      return null;
    }).filter(Boolean);
    deepEqual(off, [], `Register counts do not match the records:\n  ${off.join('\n  ')}`);
  });
});

describe('Recent payments', () => {
  let dom, win, D;
  before(async () => { dom = await openPage('app/dashboard.html'); win = dom.window; D = win.DEMO_DATA; });
  after(() => { if (dom) dom.window.close(); });

  it('shows the last ten receipts, newest first', () => {
    const rows = $$(win, '#payment-rows tr');
    assert.equal(rows.length, 10, `The payments panel drew ${rows.length} rows; the header says the last ten.`);
    const newest = D.payments.slice().sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1)).slice(0, 10);
    const off = rows.map((r, i) => {
      const code = text(r.children[0]).split(' ·')[0];
      return code === newest[i].mpesa_code ? null : `row ${i + 1} shows ${code}, expected ${newest[i].mpesa_code}`;
    }).filter(Boolean);
    deepEqual(off, [], `Recent payments are not the ten newest, in order:\n  ${off.join('\n  ')}`);
  });

  it('each row shows a code, a student, a class, an amount and a time', () => {
    const thin = $$(win, '#payment-rows tr')
      .filter((r) => Array.from(r.children).some((td) => !text(td)))
      .map((r) => text(r));
    deepEqual(thin, [], `Payment rows with an empty cell:\n  ${thin.join('\n  ')}`);
  });
});

describe('Needs attention', () => {
  let dom, win, D;
  before(async () => { dom = await openPage('app/dashboard.html'); win = dom.window; D = win.DEMO_DATA; });
  after(() => { if (dom) dom.window.close(); });

  const item = (key) => $(win, `[data-attention="${key}"] .stack__n`);

  it('counts unverified exam results', () => {
    const real = D.exam_results.filter((r) => !r.verified).length;
    assert.equal(text(item('unverified_results')), num(real),
      `The unverified-results row reads "${text(item('unverified_results'))}" but ${real} results are unverified.`);
  });

  it('counts report cards still in draft', () => {
    const real = D.report_cards.filter((r) => r.status === 'draft').length;
    assert.equal(text(item('draft_report_cards')), num(real),
      `The draft-report-cards row reads "${text(item('draft_report_cards'))}" but ${real} cards are in draft.`);
  });

  it('counts waivers awaiting approval', () => {
    const real = D.waivers.filter((w) => w.status === 'pending').length;
    assert.equal(text(item('pending_waivers')), num(real),
      `The pending-waivers row reads "${text(item('pending_waivers'))}" but ${real} waivers are pending.`);
  });

  it('counts pupils chased three times and still unpaid', () => {
    const real = D.invoices.filter((i) => i.balance > 0 && i.reminders_sent >= 3).length;
    assert.equal(text(item('chased_unpaid')), num(real),
      `The chased-and-unpaid row reads "${text(item('chased_unpaid'))}" but ${real} invoices have had three reminders and are still owing.`);
  });
});

describe('Quick actions', () => {
  const CASES = [
    { modal: 'modal-invoices', form: 'modal-invoices-form', firstErr: 'gen-term-err',
      fill: (win) => {
        $(win, '#gen-term').selectedIndex = 1;
        Array.from($(win, '#gen-classes').options).slice(0, 2).forEach((o) => { o.selected = true; });
        $(win, '#gen-due').value = '2026-09-18';
      } },
    { modal: 'modal-register', form: 'modal-register-form', firstErr: 'reg-class-err',
      fill: (win) => {
        $(win, '#reg-class').selectedIndex = 1;
        $(win, '#reg-date').value = '2026-08-20';
        $(win, '#reg-teacher').selectedIndex = 1;
      } },
    { modal: 'modal-student', form: 'modal-student-form', firstErr: 'stu-name-err',
      fill: (win) => {
        $(win, '#stu-name').value = 'Wanjiku Njoroge';
        $(win, '#stu-class').selectedIndex = 1;
        $(win, '#stu-guardian').value = 'Peter Njoroge';
        $(win, '#stu-phone').value = '0712 345 678';
      } },
    { modal: 'modal-publish', form: 'modal-publish-form', firstErr: 'pub-class-err',
      fill: (win) => {
        $(win, '#pub-class').selectedIndex = 1;
        $(win, '#pub-exam').selectedIndex = 1;
      } }
  ];

  for (const c of CASES) {
    describe(c.modal, () => {
      let dom, win;
      before(async () => { dom = await openPage('app/dashboard.html'); win = dom.window; });
      after(() => { if (dom) dom.window.close(); });

      it('opens from its quick action', () => {
        const trigger = $(win, `[data-modal-open="${c.modal}"]`);
        assert.ok(trigger, `No quick action opens ${c.modal}.`);
        trigger.click();
        const scrim = $(win, `#${c.modal}`);
        assert.ok(scrim.classList.contains('is-on'), `${c.modal} did not open when its quick action was clicked.`);
        assert.equal(scrim.getAttribute('role'), 'dialog', `${c.modal} is not marked role="dialog".`);
        assert.equal(scrim.getAttribute('aria-modal'), 'true', `${c.modal} is not marked aria-modal="true".`);
      });

      it('rejects an empty submit with a visible error and stays open', async () => {
        $(win, `[data-modal-open="${c.modal}"]`).click();
        const form = $(win, `#${c.form}`);
        form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise((r) => win.setTimeout(r, 40));

        const err = $(win, `#${c.firstErr}`);
        assert.ok(err.classList.contains('on'),
          `${c.modal} accepted an empty submit — #${c.firstErr} is not showing.`);
        assert.ok(text(err).length > 0,
          `${c.modal} shows an error box with no message in it.`);
        const invalid = $$(win, `#${c.form} [aria-invalid="true"]`);
        assert.ok(invalid.length > 0,
          `${c.modal} shows an error but marked nothing aria-invalid, so a screen reader hears nothing.`);
        assert.ok($(win, `#${c.modal}`).classList.contains('is-on'),
          `${c.modal} closed on an invalid submit; it should stay open with the errors on screen.`);
      });

      it('closes with a toast on a valid submit', async () => {
        $(win, `[data-modal-open="${c.modal}"]`).click();
        c.fill(win);
        $(win, `#${c.form}`).dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise((r) => win.setTimeout(r, 120));

        assert.ok(!$(win, `#${c.modal}`).classList.contains('is-on'),
          `${c.modal} stayed open after a valid submit.`);
        const toasts = $$(win, '#toasts [data-toast]');
        assert.ok(toasts.length > 0, `${c.modal} submitted without showing a toast, so nothing confirms it happened.`);
        assert.ok(text(toasts[toasts.length - 1]).length > 5,
          `${c.modal} showed an empty toast.`);
      });
    });
  }

  it('all four quick actions are present', async () => {
    const dom = await openPage('app/dashboard.html');
    const buttons = $$(dom.window, '.qa button[data-modal-open]').map((b) => b.getAttribute('data-modal-open'));
    dom.window.close();
    for (const c of CASES) {
      assert.ok(buttons.includes(c.modal), `The quick actions panel has no button for ${c.modal}. Found: ${buttons.join(', ')}`);
    }
    assert.equal(buttons.length, 4, `The quick actions panel has ${buttons.length} buttons; four were specified.`);
  });
});

describe('Role gating', () => {
  it('an admin sees every sidebar group', async () => {
    const dom = await openPage('app/dashboard.html', { role: 'admin' });
    const win = dom.window;
    const groups = $$(win, '.side .navg[data-group]').map((g) => g.getAttribute('data-group'));
    const allowed = win.ShuleShell.ROLE_NAV.admin.map((g) => g.group);
    dom.window.close();
    deepEqual(groups, allowed,
      `An admin sees [${groups.join(', ')}] but ROLE_NAV.admin says [${allowed.join(', ')}].`);
    for (const want of ['fees', 'admin', 'people', 'academics', 'daily', 'facilities', 'communication']) {
      assert.ok(groups.includes(want), `The admin sidebar is missing the "${want}" group.`);
    }
  });

  it('a teacher never sees the fees or admin groups', async () => {
    const dom = await openPage('app/dashboard.html', { role: 'teacher' });
    const win = dom.window;
    const groups = $$(win, '.side .navg[data-group]').map((g) => g.getAttribute('data-group'));
    const role = win.document.body.getAttribute('data-role');
    const allowed = win.ShuleShell.ROLE_NAV.teacher.map((g) => g.group);
    const leakedLinks = $$(win, '.side a').filter((a) => /invoice|defaulter|waiver|settings/i.test(a.textContent))
      .map((a) => a.textContent.replace(/step 3/i, '').trim());
    dom.window.close();

    assert.equal(role, 'teacher', `<body data-role> is "${role}" after signing in as a teacher.`);
    assert.ok(!groups.includes('fees'), `A teacher can see the fees group: [${groups.join(', ')}]`);
    assert.ok(!groups.includes('admin'), `A teacher can see the admin group: [${groups.join(', ')}]`);
    deepEqual(groups, allowed, `A teacher sees [${groups.join(', ')}] but ROLE_NAV.teacher says [${allowed.join(', ')}].`);
    deepEqual(leakedLinks, [], `Fee and admin destinations are still in a teacher's sidebar: ${leakedLinks.join(', ')}`);
  });

  it('a parent sees the narrowest sidebar of the three', async () => {
    const dom = await openPage('app/dashboard.html', { role: 'parent' });
    const win = dom.window;
    const groups = $$(win, '.side .navg[data-group]').map((g) => g.getAttribute('data-group'));
    const map = win.ShuleShell.ROLE_NAV;
    const parentGroups = map.parent.map((g) => g.group);
    dom.window.close();
    deepEqual(groups, parentGroups, `A parent sees [${groups.join(', ')}] but ROLE_NAV.parent says [${parentGroups.join(', ')}].`);
    assert.ok(map.parent.length < map.admin.length, 'A parent should see fewer groups than an admin.');
  });

  it('hidden groups are removed from the DOM, not merely hidden', async () => {
    const dom = await openPage('app/dashboard.html', { role: 'teacher' });
    const win = dom.window;
    const html = win.document.querySelector('.side').innerHTML;
    dom.window.close();
    assert.ok(!/data-group="fees"/.test(html),
      'The fees group is still in the sidebar markup for a teacher. Gated groups must be removed, not hidden, or they stay in the tab order.');
  });

  it('an unknown stored role falls back to admin rather than an empty sidebar', async () => {
    const dom = await openPage('app/dashboard.html', { role: 'headmaster-of-hogwarts' });
    const win = dom.window;
    const groups = $$(win, '.side .navg[data-group]').length;
    const role = win.document.body.getAttribute('data-role');
    dom.window.close();
    assert.equal(role, 'admin', `An unrecognised role resolved to "${role}"; it should fall back to admin.`);
    assert.ok(groups >= 8, `An unrecognised role produced a sidebar with ${groups} groups.`);
  });
});

describe('Login hands the role to the app', () => {
  it('writes shule.role and redirects to the app shell', async () => {
    const dom = await openPage('login.html', { readySelector: 'form#login-form' });
    const win = dom.window;

    win.document.getElementById('role-teacher').checked = true;
    win.document.getElementById('role-admin').checked = false;
    win.document.getElementById('role-teacher').dispatchEvent(new win.Event('change', { bubbles: true }));
    win.document.getElementById('login-id').value = 'samuel.kariuki@riverside.ac.ke';
    win.document.getElementById('login-pw').value = 'correct-horse';
    win.document.getElementById('login-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => win.setTimeout(r, 40));

    const stored = win.localStorage.getItem('shule.role');
    const target = win.document.getElementById('login-form').getAttribute('data-redirect');
    dom.window.close();

    assert.equal(stored, 'teacher',
      `login.html stored shule.role as "${stored}" after a teacher signed in; the app shell reads that key to gate the sidebar.`);
    assert.equal(target, 'app/dashboard.html',
      `login.html redirects to "${target}", expected app/dashboard.html.`);
  });

  it('rejects a bad sign-in without writing a role', async () => {
    const dom = await openPage('login.html', { readySelector: 'form#login-form' });
    const win = dom.window;
    win.localStorage.removeItem('shule.role');
    win.document.getElementById('login-id').value = 'not-an-email';
    win.document.getElementById('login-pw').value = 'short';
    win.document.getElementById('login-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => win.setTimeout(r, 40));
    const stored = win.localStorage.getItem('shule.role');
    const invalid = $$(win, '#login-form [aria-invalid="true"]').length;
    dom.window.close();
    assert.equal(stored, null, `An invalid sign-in still wrote shule.role="${stored}".`);
    assert.ok(invalid >= 1, 'An invalid sign-in marked nothing aria-invalid.');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Step 3 — students, fees, the store and the ledger
// ══════════════════════════════════════════════════════════════════════════

/** Every invariant that must hold after any mutating operation, in one place. */
function checkInvariants(win, after) {
  const D = storeOf(win);
  const problems = [];

  // school.py's identity: the charge stands and a waiver is a visible discount
  D.invoices.forEach((i) => {
    const discount = i.discount_amount || 0;
    if (i.balance !== i.amount_due - i.amount_paid - discount) {
      problems.push(`invoice ${i.id}: due ${i.amount_due} − paid ${i.amount_paid} − discount ${discount} = ${i.amount_due - i.amount_paid - discount}, but balance says ${i.balance}`);
    }
  });

  let dr = 0, cr = 0;
  D.journal_lines.forEach((l) => { if (l.side === 'debit') dr += l.amount; else cr += l.amount; });
  if (Math.round((dr - cr) * 100) !== 0) {
    problems.push(`ledger does not balance: debits ${dr}, credits ${cr}, drift ${dr - cr}`);
  }

  const primaries = {};
  D.guardians.forEach((g) => {
    primaries[g.student_id] = (primaries[g.student_id] || 0) + (g.is_primary ? 1 : 0);
  });
  D.students.forEach((s) => {
    const n = primaries[s.id];
    if (n === undefined) return;                     // a pupil with no guardians on file yet
    if (n !== 1) problems.push(`student ${s.admission_no} has ${n} primary guardians; exactly one is required`);
  });

  const seen = {};
  D.invoices.forEach((i) => {
    const key = `${i.student_id}|${i.class_id}|${i.term_id}`;
    if (seen[key]) problems.push(`student ${i.student_id} has two invoices for ${i.class_id} in ${i.term_id}: ${seen[key]} and ${i.id}`);
    seen[key] = i.id;
  });

  // ── academics ────────────────────────────────────────────────────────
  // one attendance record per pupil per class per date
  const marks = {};
  D.attendance.forEach((a) => {
    const key = `${a.student_id}|${a.class_id}|${a.date}`;
    if (marks[key]) problems.push(`${a.student_id} has two attendance records for ${a.class_id} on ${a.date}: ${marks[key]} and ${a.id}`);
    marks[key] = a.id;
    if (!a.marked_by) problems.push(`attendance ${a.id} has no marked_by`);
  });

  // every band set tiles its range
  D.grading_scales.forEach((g) => {
    const bands = g.bands.slice().sort((a, b) => a.min - b.min);
    if (bands[0].min !== 0) problems.push(`scale ${g.name} starts at ${bands[0].min}, not 0`);
    for (let i = 1; i < bands.length; i++) {
      if (bands[i].min !== bands[i - 1].max + 1) {
        problems.push(`scale ${g.name}: ${bands[i - 1].grade} ends ${bands[i - 1].max} but ${bands[i].grade} starts ${bands[i].min}`);
      }
    }
    if (bands[bands.length - 1].max !== g.max_score) {
      problems.push(`scale ${g.name} ends at ${bands[bands.length - 1].max}, not ${g.max_score}`);
    }
  });

  // every stored grade is the band its score falls in, for that exam's scale
  const scaleOf = {};
  D.exams.forEach((e) => { scaleOf[e.id] = D.grading_scales.filter((g) => g.id === e.grading_scale_id)[0]; });
  D.exam_results.forEach((r) => {
    const exam = D.exams.filter((e) => e.id === r.exam_id)[0];
    if (!exam) { problems.push(`result ${r.id} points at exam ${r.exam_id}, which does not exist`); return; }
    if (r.score < 0 || r.score > exam.max_score) {
      problems.push(`result ${r.id} scores ${r.score}, outside 0–${exam.max_score} for ${exam.name}`);
      return;
    }
    const scale = scaleOf[r.exam_id];
    if (!scale) { problems.push(`exam ${r.exam_id} binds to a scale that does not exist`); return; }
    const band = scale.bands.filter((b) => r.score >= b.min && r.score <= b.max)[0];
    if (!band) { problems.push(`result ${r.id} scores ${r.score}, which falls in no band of ${scale.name}`); return; }
    if (band.grade !== r.grade) problems.push(`result ${r.id} scores ${r.score} in band ${band.grade} but is stored as ${r.grade}`);
    if (band.points !== r.points) problems.push(`result ${r.id} grade ${r.grade} carries ${band.points} points but is stored as ${r.points}`);
  });

  // report card positions use COMPETITION ranking, and class_size is the roll
  const byClass = {};
  D.report_cards.forEach((c) => { (byClass[c.class_id] = byClass[c.class_id] || []).push(c); });
  Object.keys(byClass).forEach((classId) => {
    const cards = byClass[classId];
    cards.slice().sort((a, b) => b.average - a.average).forEach((card, i, ordered) => {
      // ties share the rank of the first of them; the ranks they consume are skipped
      const rank = ordered.findIndex((c) => c.average === card.average) + 1;
      if (card.position !== rank) {
        problems.push(`report card ${card.id}: average ${card.average} competition-ranks to ${rank} but is stored as position ${card.position}`);
      }
      if (card.class_size !== cards.length) {
        problems.push(`report card ${card.id} says class_size ${card.class_size}, but ${cards.length} cards are ranked in ${classId}`);
      }
    });
  });

  deepEqual(problems.slice(0, 8), [], `Invariants broken after ${after}:\n  ${problems.slice(0, 8).join('\n  ')}`);
}

describe('The persistent store', () => {
  it('seeds from DEMO_DATA when sessionStorage is empty', async () => {
    const dom = await openPage('app/students.html');
    const win = dom.window;
    const raw = win.sessionStorage.getItem('shule.store');
    const store = storeOf(win);
    const seedCount = win.DEMO_DATA.students.length;
    dom.window.close();
    assert.ok(raw, 'Nothing was written to sessionStorage["shule.store"], so the next navigation would lose every change.');
    assert.equal(store.students.length, seedCount,
      `The store holds ${store.students.length} students but the seed has ${seedCount}.`);
  });

  it('a write survives a navigation — persist, re-hydrate, read back', async () => {
    const dom = await openPage('app/students.html');
    const win = dom.window;
    const before = storeOf(win).students.length;

    await win.ShuleAPI.createStudent('sch-riverside', {
      name: 'Persisted Pupil', class_id: 'cls-g4e',
      guardian_name: 'Test Guardian', guardian_phone: '0712345678'
    });
    const persisted = JSON.parse(win.sessionStorage.getItem('shule.store'));
    const raw = win.sessionStorage.getItem('shule.store');
    dom.window.close();

    assert.equal(persisted.students.length, before + 1,
      `sessionStorage holds ${persisted.students.length} students right after the write; it should hold ${before + 1}.`);

    // a second page load, handed the same sessionStorage, must see the write
    const next = await openPage('app/students.html', { seedStore: raw });
    const after = storeOf(next.window);
    const found = after.students.filter((s) => s.name === 'Persisted Pupil');
    next.window.close();
    assert.equal(after.students.length, before + 1,
      `After navigating, the store holds ${after.students.length} students; the write did not survive.`);
    assert.equal(found.length, 1, 'The pupil created on the first page is not on the record after navigating.');
  });

  it('reset restores the seed exactly', async () => {
    const dom = await openPage('app/students.html');
    const win = dom.window;
    const seed = JSON.stringify(storeOf(win));

    await win.ShuleAPI.createStudent('sch-riverside', {
      name: 'Temporary Pupil', class_id: 'cls-g4e',
      guardian_name: 'Test Guardian', guardian_phone: '0712345678'
    });
    const dirty = JSON.stringify(storeOf(win));
    win.ShuleAPI.resetStore();
    const reset = JSON.stringify(storeOf(win));
    dom.window.close();

    assert.notEqual(seed, dirty, 'Creating a pupil did not change the store, so the reset test proves nothing.');
    assert.equal(reset.length, seed.length,
      `After reset the store is ${reset.length} bytes but the seed was ${seed.length}.`);
    assert.equal(reset, seed, 'Reset did not restore the seed exactly.');
  });

  it('two hydrations of the same seed are identical', async () => {
    const a = await openPage('app/students.html');
    const b = await openPage('app/students.html');
    const one = JSON.stringify(storeOf(a.window));
    const two = JSON.stringify(storeOf(b.window));
    a.window.close(); b.window.close();
    assert.equal(one, two, 'Two fresh hydrations produced different stores; the seed is not deterministic through the store layer.');
  });

  it('the seed satisfies every invariant before anything is done to it', async () => {
    const dom = await openPage('app/students.html');
    checkInvariants(dom.window, 'hydrating the seed');
    dom.window.close();
  });
});

describe('The ledger invariant', () => {
  it('a payment writes one debit and one matching credit', async () => {
    const dom = await openPage('app/invoices.html');
    const win = dom.window;
    const D = storeOf(win);
    const owing = D.invoices.filter((i) => i.balance > 0)[0];
    const before = D.journal_lines.length;

    await win.ShuleAPI.recordPayment('sch-riverside', owing.id, { amount: 1000, method: 'mpesa', reference: 'TEST12345' });

    const lines = storeOf(win).journal_lines;
    const added = lines.slice(before);
    checkInvariants(win, 'recording a payment');
    dom.window.close();

    assert.equal(added.length, 2, `A payment posted ${added.length} journal lines; a balanced entry is exactly two.`);
    assert.equal(added.filter((l) => l.side === 'debit').length, 1, 'The entry has no single debit line.');
    assert.equal(added.filter((l) => l.side === 'credit').length, 1, 'The entry has no single credit line.');
    assert.equal(added[0].amount, added[1].amount, `Debit ${added[0].amount} does not match credit ${added[1].amount}.`);
    assert.equal(added[0].amount, 1000, `The entry is for ${added[0].amount}, but the payment was 1000.`);
    assert.ok(added.some((l) => /receivable/i.test(l.account)),
      `Neither line touches fees receivable: ${added.map((l) => l.account).join(', ')}`);
  });

  it('stays balanced across a run of mixed operations', async () => {
    const dom = await openPage('app/invoices.html');
    const win = dom.window;
    const API = win.ShuleAPI;
    const D = storeOf(win);

    const owing = D.invoices.filter((i) => i.balance > 2000).slice(0, 3);
    await API.recordPayment('sch-riverside', owing[0].id, { amount: 500, method: 'mpesa', reference: 'A1' });
    checkInvariants(win, 'payment 1');
    await API.recordPayment('sch-riverside', owing[1].id, { amount: 1500, method: 'cash' });
    checkInvariants(win, 'payment 2');
    await API.recordPayment('sch-riverside', owing[2].id, { amount: 2000, method: 'bank', reference: 'SLIP-9' });
    checkInvariants(win, 'payment 3');

    const pending = storeOf(win).waivers.filter((w) => w.status === 'pending')[0];
    if (pending) {
      await API.approveWaiver('sch-riverside', pending.id, {}).catch(() => null);
      checkInvariants(win, 'approving a waiver');
    }
    await API.bulkGenerateInvoices('sch-riverside', {
      classId: 'cls-g4e', termId: 't3-2026', dueDate: '2026-10-02',
      structureId: 'fee-cls-g4e-t2-2026'
    });
    checkInvariants(win, 'bulk-generating a term');

    const report = await API.listJournalLines('sch-riverside', {});
    dom.window.close();
    assert.ok(report.balanced,
      `The ledger is out by ${report.debits - report.credits}: debits ${report.debits}, credits ${report.credits}.`);
  });
});

describe('Recording a payment', () => {
  let dom, win, API;
  before(async () => { dom = await openPage('app/invoices.html'); win = dom.window; API = win.ShuleAPI; });
  after(() => { if (dom) dom.window.close(); });

  it('a part payment sets part_paid and reduces the balance', async () => {
    const inv = storeOf(win).invoices.filter((i) => i.balance > 5000 && i.amount_paid === 0)[0];
    assert.ok(inv, 'No untouched invoice with a balance over 5000 to part-pay.');
    const before = { due: inv.amount_due, balance: inv.balance };

    const r = await API.recordPayment('sch-riverside', inv.id, { amount: 2000, method: 'cash' });
    checkInvariants(win, 'a part payment');

    assert.equal(r.invoice.status, 'part_paid',
      `Paying 2000 of ${before.balance} left the invoice "${r.invoice.status}"; it should be "part_paid".`);
    assert.equal(r.invoice.balance, before.balance - 2000,
      `The balance is ${r.invoice.balance} after a 2000 payment against ${before.balance}; it should be ${before.balance - 2000}.`);
    assert.equal(r.invoice.amount_due, before.due, 'A payment must not change amount_due.');
  });

  it('a payment clearing the balance sets cleared', async () => {
    const inv = storeOf(win).invoices.filter((i) => i.balance > 0)[0];
    const owed = inv.balance;
    const r = await API.recordPayment('sch-riverside', inv.id, { amount: owed, method: 'mpesa', reference: 'CLEAR1' });
    checkInvariants(win, 'a clearing payment');
    assert.equal(r.invoice.balance, 0, `The balance is ${r.invoice.balance} after paying the full ${owed}.`);
    assert.equal(r.invoice.status, 'cleared', `The invoice is "${r.invoice.status}" after being paid in full.`);
  });

  it('a payment exceeding the balance is rejected and mutates nothing', async () => {
    const D = storeOf(win);
    const inv = D.invoices.filter((i) => i.balance > 0)[0];
    const before = {
      paid: inv.amount_paid, balance: inv.balance, status: inv.status,
      payments: D.payments.length, journal: D.journal_lines.length
    };

    let err = null;
    await API.recordPayment('sch-riverside', inv.id, { amount: inv.balance + 1, method: 'cash' })
      .catch((e) => { err = e; });

    const after = storeOf(win);
    const now = after.invoices.filter((i) => i.id === inv.id)[0];
    assert.ok(err, `Paying ${inv.balance + 1} against a balance of ${inv.balance} was accepted; it must be rejected.`);
    assert.equal(err.status, 422, `The rejection came back as ${err.status}, expected 422.`);
    assert.ok(/exceed|more than/i.test(err.message),
      `The error says "${err.message}"; it should explain that a payment cannot exceed the balance.`);
    assert.equal(now.amount_paid, before.paid, 'The rejected payment still changed amount_paid.');
    assert.equal(now.balance, before.balance, 'The rejected payment still changed the balance.');
    assert.equal(now.status, before.status, 'The rejected payment still changed the status.');
    assert.equal(after.payments.length, before.payments, 'The rejected payment was still written to the ledger.');
    assert.equal(after.journal_lines.length, before.journal, 'The rejected payment still posted journal lines.');
    checkInvariants(win, 'a rejected payment');
  });

  it('a zero or negative payment is rejected', async () => {
    const inv = storeOf(win).invoices.filter((i) => i.balance > 0)[0];
    for (const amount of [0, -500]) {
      let err = null;
      await API.recordPayment('sch-riverside', inv.id, { amount: amount, method: 'cash' }).catch((e) => { err = e; });
      assert.ok(err, `A payment of ${amount} was accepted.`);
    }
    checkInvariants(win, 'rejected zero and negative payments');
  });

  it('shows a visible error in the modal rather than failing silently', async () => {
    const page = await openPage('app/invoices.html');
    const w = page.window;
    const payBtn = $(w, '#rows [data-pay]');
    assert.ok(payBtn, 'No invoice on the first page has a Record payment button.');
    payBtn.click();
    await new Promise((r) => w.setTimeout(r, 60));

    const amount = $(w, '#pay-amount');
    const balance = Number(amount.value);
    amount.value = String(balance + 10000);
    $(w, '#pay-date').value = '2026-08-20';
    $(w, '#modal-pay-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => w.setTimeout(r, 80));

    const err = $(w, '#pay-amount-err');
    const stillOpen = $(w, '#modal-pay').classList.contains('is-on');
    const invalid = amount.getAttribute('aria-invalid');
    w.close();

    assert.ok(err.classList.contains('on'), 'Overpaying showed no inline error under the amount field.');
    assert.ok(/more than|exceed/i.test(text(err)), `The inline error reads "${text(err)}".`);
    assert.equal(invalid, 'true', 'The amount field was not marked aria-invalid.');
    assert.ok(stillOpen, 'The modal closed on an invalid submit; it should stay open with the error showing.');
  });
});

describe('Bulk invoice generation', () => {
  it('creates one invoice per active pupil and skips those already invoiced', async () => {
    const dom = await openPage('app/invoices.html');
    const win = dom.window;
    const API = win.ShuleAPI;
    const D = storeOf(win);

    const classId = 'cls-g5w', termId = 't3-2026';
    const roll = D.students.filter((s) => s.class_id === classId && s.status === 'active').length;

    const first = await API.bulkGenerateInvoices('sch-riverside', {
      classId, termId, dueDate: '2026-10-02', structureId: 'fee-cls-g5w-t2-2026'
    });
    checkInvariants(win, 'a first bulk generate');

    assert.equal(first.created, roll,
      `The first run created ${first.created} invoices for a roll of ${roll} active pupils.`);
    assert.equal(first.skipped, 0, `The first run skipped ${first.skipped}; nobody was invoiced for that term yet.`);

    // running it again must create nothing and report everyone as skipped
    const second = await API.bulkGenerateInvoices('sch-riverside', {
      classId, termId, dueDate: '2026-10-02', structureId: 'fee-cls-g5w-t2-2026'
    });
    checkInvariants(win, 'a repeated bulk generate');

    assert.equal(second.created, 0,
      `Running bulk generate twice created ${second.created} more invoices. Pupils already invoiced must be excluded, not duplicated.`);
    assert.equal(second.skipped, roll,
      `The second run reported ${second.skipped} skipped; all ${roll} pupils already had an invoice.`);
    assert.equal(second.skipped_students.length, roll, 'The skipped pupils were not reported individually.');
    assert.ok(second.skipped_students[0].student_name, 'Skipped pupils are reported without a name.');

    const total = storeOf(win).invoices.filter((i) => i.class_id === classId && i.term_id === termId).length;
    dom.window.close();
    assert.equal(total, roll, `The class ended up with ${total} invoices for ${roll} pupils.`);
  });

  it('the dry run previews without writing anything', async () => {
    const dom = await openPage('app/invoices.html');
    const win = dom.window;
    const before = storeOf(win).invoices.length;
    const preview = await win.ShuleAPI.bulkGenerateInvoices('sch-riverside', {
      classId: 'cls-g6e', termId: 't3-2026', dueDate: '2026-10-02',
      structureId: 'fee-cls-g6e-t2-2026', dryRun: true
    });
    const after = storeOf(win).invoices.length;
    dom.window.close();
    assert.equal(after, before, `The dry run wrote ${after - before} invoices. A preview must not change anything.`);
    assert.ok(preview.would_create > 0, 'The dry run says it would create nothing.');
    assert.ok(preview.total_value > 0, 'The dry run reports no total value.');
  });

  it('refuses a class with no fee structure for that term', async () => {
    const dom = await openPage('app/invoices.html');
    let err = null;
    await dom.window.ShuleAPI.bulkGenerateInvoices('sch-riverside', {
      classId: 'cls-g9e', termId: 't1-2026', dueDate: '2026-02-01'
    }).catch((e) => { err = e; });
    dom.window.close();
    assert.ok(err, 'Generating invoices with no fee structure was accepted.');
    assert.ok(/fee structure/i.test(err.message), `The error reads "${err.message}"; it should name the missing fee structure.`);
  });
});

describe('Waiver approval', () => {
  it('reduces the balance once, and approving again changes nothing', async () => {
    const dom = await openPage('app/waivers.html');
    const win = dom.window;
    const API = win.ShuleAPI;

    const waiver = storeOf(win).waivers.filter((w) => w.status === 'pending')[0];
    assert.ok(waiver, 'No pending waiver in the seed to approve.');
    const invBefore = storeOf(win).invoices.filter((i) => i.student_id === waiver.student_id)[0];
    const before = { due: invBefore.amount_due, balance: invBefore.balance, discount: invBefore.discount_amount || 0 };
    const journalBefore = storeOf(win).journal_lines.length;

    const first = await API.approveWaiver('sch-riverside', waiver.id, {});
    checkInvariants(win, 'approving a waiver');

    assert.equal(first.applied, true, 'The first approval reported applied: false.');
    assert.equal(first.invoice.amount_due, before.due,
      `amount_due moved from ${before.due} to ${first.invoice.amount_due}. A waiver is a discount against the charge, not a smaller charge (school.py:919).`);
    assert.equal(first.invoice.discount_amount, waiver.amount,
      `discount_amount is ${first.invoice.discount_amount} after a waiver of ${waiver.amount}.`);
    assert.equal(first.invoice.balance, before.balance - waiver.amount,
      `The balance went from ${before.balance} to ${first.invoice.balance}, expected ${before.balance - waiver.amount}.`);
    assert.equal(storeOf(win).journal_lines.length, journalBefore + 2,
      'Approving a waiver did not post a balanced pair of journal lines.');

    const afterFirst = {
      due: first.invoice.amount_due, balance: first.invoice.balance,
      discount: first.invoice.discount_amount,
      journal: storeOf(win).journal_lines.length
    };

    const second = await API.approveWaiver('sch-riverside', waiver.id, {});
    checkInvariants(win, 'approving the same waiver twice');
    const invNow = storeOf(win).invoices.filter((i) => i.id === invBefore.id)[0];
    dom.window.close();

    assert.equal(second.already, true, 'The second approval did not report the waiver as already applied.');
    assert.equal(second.applied, false, 'The second approval claimed to apply the waiver again.');
    assert.equal(invNow.discount_amount, waiver.amount,
      `Approving twice discounted twice: discount_amount is ${invNow.discount_amount}, expected ${waiver.amount}.`);
    assert.equal(invNow.balance, afterFirst.balance,
      `Approving twice reduced the balance twice: ${invNow.balance}, expected ${afterFirst.balance}.`);
    assert.equal(storeOf(win).journal_lines.length, afterFirst.journal,
      'Approving twice posted a second set of journal lines.');
  });

  it('rejection needs a reason and never touches the invoice', async () => {
    const dom = await openPage('app/waivers.html');
    const win = dom.window;
    const waiver = storeOf(win).waivers.filter((w) => w.status === 'pending')[0];
    const inv = storeOf(win).invoices.filter((i) => i.student_id === waiver.student_id)[0];
    const before = inv.amount_due;
    const beforeDiscount = inv.discount_amount || 0;

    let err = null;
    await win.ShuleAPI.rejectWaiver('sch-riverside', waiver.id, { reason: '' }).catch((e) => { err = e; });
    assert.ok(err, 'A rejection with no reason was accepted.');

    await win.ShuleAPI.rejectWaiver('sch-riverside', waiver.id, { reason: 'Above the bursary threshold.' });
    const after = storeOf(win).invoices.filter((i) => i.id === inv.id)[0];
    const w = storeOf(win).waivers.filter((x) => x.id === waiver.id)[0];
    checkInvariants(win, 'rejecting a waiver');
    dom.window.close();

    assert.equal(w.status, 'rejected', `The waiver is "${w.status}" after being rejected.`);
    assert.equal(w.decision_reason, 'Above the bursary threshold.', 'The rejection reason was not kept.');
    assert.equal(after.amount_due, before, `Rejecting changed amount_due from ${before} to ${after.amount_due}.`);
    assert.equal(after.discount_amount || 0, beforeDiscount,
      `Rejecting changed discount_amount from ${beforeDiscount} to ${after.discount_amount}.`);
  });
});

describe('Defaulters and aging', () => {
  let dom, win, API;
  before(async () => { dom = await openPage('app/defaulters.html'); win = dom.window; API = win.ShuleAPI; });
  after(() => { if (dom) dom.window.close(); });

  it('the buckets partition the defaulters completely', async () => {
    const data = await API.listDefaulterRows('sch-riverside', {});
    const keys = data.buckets.map((b) => b.key);
    deepEqual(keys, ['0-30', '31-60', '61-90', '90+'],
      `The aging buckets are [${keys.join(', ')}]; 0-30, 31-60, 61-90 and 90+ were specified.`);

    const bucketTotal = data.buckets.reduce((n, b) => n + b.total, 0);
    assert.equal(bucketTotal, data.total_outstanding,
      `The buckets sum to ${bucketTotal} but total outstanding is ${data.total_outstanding}. The buckets are not a complete partition.`);

    const bucketCount = data.buckets.reduce((n, b) => n + b.count, 0);
    assert.equal(bucketCount, data.total,
      `The buckets hold ${bucketCount} invoices but there are ${data.total} defaulters.`);

    const orphans = data.items.filter((r) => keys.indexOf(r.bucket) === -1)
      .map((r) => `${r.student_name} is in bucket "${r.bucket}"`);
    deepEqual(orphans, [], `Defaulters in no bucket:\n  ${orphans.join('\n  ')}`);

    const doubled = data.items.filter((r) => data.buckets.filter((b) => b.key === r.bucket).length !== 1)
      .map((r) => r.student_name);
    deepEqual(doubled, [], `Defaulters matching more than one bucket: ${doubled.join(', ')}`);
  });

  it('every bucket has members, so the aging is not decorative', async () => {
    const data = await API.listDefaulterRows('sch-riverside', {});
    const empties = data.buckets.filter((b) => b.count === 0).map((b) => b.key);
    deepEqual(empties, [], `These aging buckets are empty: ${empties.join(', ')}. The seed should populate all four.`);
  });

  it('each invoice lands in the bucket its days-past-due says', async () => {
    const data = await API.listDefaulterRows('sch-riverside', {});
    const wrong = data.items.filter((r) => {
      const n = Math.max(0, r.days_past_due);
      const expected = n <= 30 ? '0-30' : n <= 60 ? '31-60' : n <= 90 ? '61-90' : '90+';
      return r.bucket !== expected;
    }).map((r) => `${r.student_name}: ${r.days_past_due} days past due but bucketed "${r.bucket}"`);
    deepEqual(wrong.slice(0, 6), [], `Invoices in the wrong bucket:\n  ${wrong.slice(0, 6).join('\n  ')}`);
  });

  it('the totals match a recount from the store', async () => {
    const data = await API.listDefaulterRows('sch-riverside', {});
    const D = storeOf(win);
    const owed = D.invoices.filter((i) => i.term_id === D.current_term_id && i.balance > 0);
    const recount = owed.reduce((n, i) => n + i.balance, 0);
    assert.equal(data.total, owed.length, `The page shows ${data.total} defaulters; the store holds ${owed.length}.`);
    assert.equal(data.total_outstanding, recount,
      `The page shows ${data.total_outstanding} outstanding; the store sums to ${recount}.`);
  });
});

describe('Sending reminders', () => {
  it('increments only the selected unpaid invoices and never past three', async () => {
    const dom = await openPage('app/defaulters.html');
    const win = dom.window;
    const API = win.ShuleAPI;
    const D = storeOf(win);

    const owing = D.invoices.filter((i) => i.balance > 0 && i.reminders_sent < 3);
    assert.ok(owing.length >= 3, `Only ${owing.length} chaseable invoices in the seed.`);
    const target = owing.slice(0, 3);
    const targetIds = target.map((i) => i.id);
    const before = {};
    D.invoices.forEach((i) => { before[i.id] = i.reminders_sent; });

    const r = await API.sendRemindersFor('sch-riverside', { invoiceIds: targetIds });
    checkInvariants(win, 'sending reminders');

    const after = storeOf(win);
    assert.equal(r.sent, 3, `The API reports ${r.sent} reminders sent for 3 selected invoices.`);

    const notBumped = targetIds.filter((id) => {
      const now = after.invoices.filter((i) => i.id === id)[0];
      return now.reminders_sent !== before[id] + 1;
    });
    deepEqual(notBumped, [], `These selected invoices were not incremented: ${notBumped.join(', ')}`);

    const bled = after.invoices.filter((i) => targetIds.indexOf(i.id) === -1 && i.reminders_sent !== before[i.id])
      .map((i) => i.id);
    deepEqual(bled.slice(0, 5), [], `Unselected invoices were also incremented: ${bled.slice(0, 5).join(', ')}`);

    // push one invoice to the cap and then past it
    const one = target[0].id;
    for (let n = 0; n < 5; n++) {
      await API.sendRemindersFor('sch-riverside', { invoiceIds: [one] });
    }
    const capped = storeOf(win).invoices.filter((i) => i.id === one)[0];
    dom.window.close();
    assert.equal(capped.reminders_sent, 3,
      `That invoice is at ${capped.reminders_sent} reminders after repeated sends; three is the cap.`);
  });

  it('skips invoices already at the cap and says so', async () => {
    const dom = await openPage('app/defaulters.html');
    const win = dom.window;
    const D = storeOf(win);
    const exhausted = D.invoices.filter((i) => i.balance > 0 && i.reminders_sent >= 3)[0];
    assert.ok(exhausted, 'No invoice in the seed has already had three reminders.');
    const before = exhausted.reminders_sent;

    const r = await win.ShuleAPI.sendRemindersFor('sch-riverside', { invoiceIds: [exhausted.id] });
    const now = storeOf(win).invoices.filter((i) => i.id === exhausted.id)[0];
    dom.window.close();

    assert.equal(r.sent, 0, `An invoice at the cap was chased again: ${r.sent} sent.`);
    assert.equal(r.skipped, 1, `The skip was not reported: ${r.skipped} skipped.`);
    assert.equal(now.reminders_sent, before, `reminders_sent went from ${before} to ${now.reminders_sent}.`);
    assert.ok(/reminder/i.test(r.skipped_invoices[0].reason),
      `The skip reason reads "${r.skipped_invoices[0].reason}".`);
  });

  it('marks capped rows as distinct and un-selectable in the table', async () => {
    const dom = await openPage('app/defaulters.html');
    const win = dom.window;
    const capped = $$(win, '#rows tr[data-exhausted="true"]');
    dom.window.close();
    assert.ok(capped.length > 0, 'No row is marked as having exhausted its reminders, so the state is never shown.');
    const selectable = capped.filter((tr) => tr.querySelector('[data-pick]'));
    assert.equal(selectable.length, 0,
      `${selectable.length} capped rows are still selectable; they must be excluded from further sends.`);
  });
});

describe('CSV import', () => {
  const HEAD = 'full_name,class_name,date_of_birth,gender,guardian_name,guardian_phone';
  const GOOD = [
    'Wanjiku Njoroge,Grade 6 East,2015-04-09,F,Peter Njoroge,0712345678',
    'Brian Otieno,Grade 7 West,2013-11-02,M,Alice Otieno,0722113344',
    'Fatuma Hassan,Grade 4 East,2017-01-20,F,Zainab Hassan,0733557788'
  ];

  it('accepts a good file and admits every row', async () => {
    const dom = await openPage('app/students.html');
    const win = dom.window;
    const before = storeOf(win).students.length;

    const r = await win.ShuleAPI.importStudentsCSV('sch-riverside', HEAD + '\n' + GOOD.join('\n'), {});
    checkInvariants(win, 'importing a good CSV');
    const after = storeOf(win).students.length;
    const created = storeOf(win).students.slice(-3);
    dom.window.close();

    assert.equal(r.imported, 3, `${r.imported} of 3 good rows imported.`);
    assert.equal(r.error_count, 0, `A clean file reported ${r.error_count} errors.`);
    assert.equal(after, before + 3, `The roll went from ${before} to ${after}; it should be ${before + 3}.`);
    assert.equal(created[0].name, 'Wanjiku Njoroge', `The first imported pupil is "${created[0].name}".`);
    assert.ok(created.every((s) => /^ADM\//.test(s.admission_no)), 'Imported pupils were not issued admission numbers.');
  });

  it('imports the good rows and reports exactly the three bad ones with line numbers', async () => {
    const dom = await openPage('app/students.html');
    const win = dom.window;
    const before = storeOf(win).students.length;

    // line 2 good, 3 bad class, 4 good, 5 bad date, 6 good, 7 bad phone
    const csv = [
      HEAD,
      GOOD[0],
      'Ghost Pupil,Grade 99 North,2015-04-09,F,Someone Else,0712345678',
      GOOD[1],
      'Bad Date,Grade 6 East,09/04/2015,M,Someone Else,0712345678',
      GOOD[2],
      'Bad Phone,Grade 4 East,2016-06-06,F,Someone Else,not-a-number'
    ].join('\n');

    const r = await win.ShuleAPI.importStudentsCSV('sch-riverside', csv, {});
    checkInvariants(win, 'importing a CSV with bad rows');
    const after = storeOf(win).students.length;
    dom.window.close();

    assert.equal(r.imported, 3, `${r.imported} of the 3 good rows imported; the bad rows must not stop the good ones.`);
    assert.equal(after, before + 3, `The roll went from ${before} to ${after}, expected ${before + 3}.`);
    assert.equal(r.error_count, 3, `${r.error_count} rows were reported bad; exactly 3 are malformed.`);

    const lines = r.errors.map((e) => e.line).sort((a, b) => a - b);
    deepEqual(lines, [3, 5, 7],
      `The bad rows were reported at lines [${lines.join(', ')}]; they are on lines 3, 5 and 7 of the file.`);

    const byLine = {};
    r.errors.forEach((e) => { byLine[e.line] = e.problems.join('; '); });
    assert.ok(/class_name/.test(byLine[3]), `Line 3 should fail on class_name, but says: ${byLine[3]}`);
    assert.ok(/date_of_birth/.test(byLine[5]), `Line 5 should fail on date_of_birth, but says: ${byLine[5]}`);
    assert.ok(/guardian_phone/.test(byLine[7]), `Line 7 should fail on guardian_phone, but says: ${byLine[7]}`);
  });

  it('the preview writes nothing and shows the failures in the modal', async () => {
    const dom = await openPage('app/students.html');
    const win = dom.window;
    const before = storeOf(win).students.length;

    $(win, '[data-modal-open="modal-import"]').click();
    const text = $(win, '#csv-text');
    $(win, '#csv-sample').click();
    text.value = [HEAD, GOOD[0], 'Ghost Pupil,Grade 99 North,2015-04-09,F,Someone,0712345678'].join('\n');
    text.dispatchEvent(new win.Event('input', { bubbles: true }));
    await new Promise((r) => win.setTimeout(r, 320));

    const rows = $$(win, '#csv-body tr');
    const bad = $$(win, '#csv-body tr[data-ok="false"]');
    const errs = $$(win, '#csv-error-list li');
    const after = storeOf(win).students.length;
    dom.window.close();

    assert.equal(after, before, `The preview wrote ${after - before} pupils. A preview must not commit anything.`);
    assert.equal(rows.length, 2, `The preview shows ${rows.length} rows for a 2-row file.`);
    assert.equal(bad.length, 1, `${bad.length} rows are flagged bad; one row has an unknown class.`);
    assert.equal(errs.length, 1, `${errs.length} per-row errors are listed.`);
    assert.ok(/line 3/i.test(text2(errs[0])), `The error reads "${text2(errs[0])}"; it should name the line number.`);
  });

  it('rejects a file whose columns do not match the backend', async () => {
    const dom = await openPage('app/students.html');
    let err = null;
    await dom.window.ShuleAPI.importStudentsCSV('sch-riverside', 'name,class\nA,B', {}).catch((e) => { err = e; });
    dom.window.close();
    assert.ok(err, 'A file with the wrong columns was accepted.');
    assert.ok(/missing these columns/i.test(err.message), `The error reads "${err.message}".`);
    assert.ok(/full_name/.test(err.message), 'The error does not name the columns that are expected.');
  });
});

function text2(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }

describe('Guardians', () => {
  it('exactly one primary, and setting a new one clears the old', async () => {
    const dom = await openPage('app/students.html');
    const win = dom.window;
    const API = win.ShuleAPI;
    const D = storeOf(win);

    const studentId = D.students[0].id;
    const before = D.guardians.filter((g) => g.student_id === studentId);
    assert.ok(before.length >= 1, 'The first pupil has no guardians in the seed.');

    const added = await API.addGuardian('sch-riverside', studentId, {
      name: 'New Guardian', relationship: 'Uncle', phone: '0798765432', is_primary: true
    });
    checkInvariants(win, 'adding a primary guardian');

    let mine = storeOf(win).guardians.filter((g) => g.student_id === studentId);
    let primaries = mine.filter((g) => g.is_primary);
    assert.equal(primaries.length, 1, `${primaries.length} guardians are primary after adding one as primary.`);
    assert.equal(primaries[0].id, added.id, 'The newly added guardian did not become primary.');

    // switch it back to the original
    await API.setPrimaryGuardian('sch-riverside', studentId, before[0].id);
    checkInvariants(win, 'switching the primary guardian');
    mine = storeOf(win).guardians.filter((g) => g.student_id === studentId);
    primaries = mine.filter((g) => g.is_primary);
    const student = storeOf(win).students.filter((s) => s.id === studentId)[0];
    dom.window.close();

    assert.equal(primaries.length, 1, `${primaries.length} guardians are primary after switching.`);
    assert.equal(primaries[0].id, before[0].id, 'The primary did not move to the guardian that was chosen.');
    assert.equal(student.guardian_name, primaries[0].name,
      `The student record still mirrors "${student.guardian_name}" but the primary is now "${primaries[0].name}".`);
  });

  it('refuses to remove the last guardian on a record', async () => {
    const dom = await openPage('app/students.html');
    const win = dom.window;
    const D = storeOf(win);
    const only = D.students.map((s) => D.guardians.filter((g) => g.student_id === s.id))
      .filter((g) => g.length === 1)[0];
    assert.ok(only, 'No pupil in the seed has exactly one guardian, so the guard is never exercised.');

    let err = null;
    await win.ShuleAPI.removeGuardian('sch-riverside', only[0].id).catch((e) => { err = e; });
    const still = storeOf(win).guardians.filter((g) => g.id === only[0].id);
    checkInvariants(win, 'trying to remove a sole guardian');
    dom.window.close();

    assert.ok(err, 'Removing a pupil’s only guardian was allowed.');
    assert.equal(still.length, 1, 'The sole guardian was removed despite the rejection.');
  });
});

describe('Fee structures', () => {
  it('blocks deleting a structure that has invoices against it', async () => {
    const dom = await openPage('app/fee-structures.html');
    const win = dom.window;
    const D = storeOf(win);
    const used = D.fee_structures.filter((f) =>
      D.invoices.some((i) => i.class_id === f.class_id && i.term_id === f.term_id))[0];
    assert.ok(used, 'No fee structure in the seed has invoices raised from it.');

    let err = null;
    await win.ShuleAPI.deleteFeeStructure('sch-riverside', used.id).catch((e) => { err = e; });
    const still = storeOf(win).fee_structures.filter((f) => f.id === used.id);
    dom.window.close();

    assert.ok(err, 'A fee structure with invoices against it was deleted.');
    assert.equal(err.status, 409, `The rejection came back as ${err.status}, expected 409.`);
    assert.ok(/invoice/i.test(err.message) && /delete/i.test(err.message),
      `The error reads "${err.message}"; it should explain that invoices were raised from it.`);
    assert.equal(still.length, 1, 'The structure was removed despite the rejection.');
  });

  it('deletes one that has no invoices, and totals recompute from the lines', async () => {
    const dom = await openPage('app/fee-structures.html');
    const win = dom.window;
    const API = win.ShuleAPI;

    const created = await API.createFeeStructure('sch-riverside', {
      classId: 'cls-g4e', termId: 't3-2026',
      items: [
        { name: 'Tuition', amount: 18000, mandatory: true },
        { name: 'Lunch', amount: 6500, mandatory: true },
        { name: 'Transport', amount: 5500, mandatory: false }
      ]
    });
    assert.equal(created.total_mandatory, 24500,
      `The mandatory total came out as ${created.total_mandatory}; 18000 + 6500 is 24500.`);
    assert.equal(created.optional_total, 5500, `The optional total came out as ${created.optional_total}.`);

    const gone = await API.deleteFeeStructure('sch-riverside', created.id);
    const left = storeOf(win).fee_structures.filter((f) => f.id === created.id);
    dom.window.close();
    assert.equal(gone.deleted, created.id, 'The delete did not report which structure went.');
    assert.equal(left.length, 0, 'The structure survived a delete that should have succeeded.');
  });

  it('refuses a duplicate structure for the same class and term', async () => {
    const dom = await openPage('app/fee-structures.html');
    let err = null;
    await dom.window.ShuleAPI.createFeeStructure('sch-riverside', {
      classId: 'cls-g4e', termId: 't2-2026', items: [{ name: 'Tuition', amount: 100, mandatory: true }]
    }).catch((e) => { err = e; });
    dom.window.close();
    assert.ok(err, 'A second fee structure for the same class and term was accepted.');
    assert.equal(err.status, 409, `The rejection came back as ${err.status}, expected 409.`);
  });
});

describe('Search, filter and pagination', () => {
  let dom, win, API;
  before(async () => { dom = await openPage('app/students.html'); win = dom.window; API = win.ShuleAPI; });
  after(() => { if (dom) dom.window.close(); });

  const active = () => storeOf(win).students.filter((s) => s.status === 'active');

  it('paginates at 25 per page', async () => {
    const page = await API.searchStudents('sch-riverside', { status: 'active', page: 1 });
    const total = active().length;
    assert.equal(page.page_size, 25, `The page size is ${page.page_size}; 25 was specified.`);
    assert.equal(page.items.length, 25, `Page one holds ${page.items.length} rows.`);
    assert.equal(page.total, total, `The page reports ${page.total} pupils; the store holds ${total} active.`);
    assert.equal(page.pages, Math.ceil(total / 25), `The page count is ${page.pages} for ${total} pupils.`);
  });

  it('renders exactly the rows the API returned', () => {
    const rows = $$(win, '#rows tr');
    assert.equal(rows.length, 25, `The table drew ${rows.length} rows for a 25-row page.`);
  });

  it('the last page holds the remainder', async () => {
    const total = active().length;
    const pages = Math.ceil(total / 25);
    const last = await API.searchStudents('sch-riverside', { status: 'active', page: pages });
    const expected = total - (pages - 1) * 25;
    assert.equal(last.items.length, expected,
      `The last page holds ${last.items.length} rows; ${total} pupils over ${pages} pages leaves ${expected}.`);
  });

  it('search matches a recount from the store', async () => {
    const target = active()[7];
    const term = target.name.split(' ')[0];
    const page = await API.searchStudents('sch-riverside', { search: term, status: 'active', pageSize: 1000 });
    const recount = active().filter((s) =>
      s.name.toLowerCase().includes(term.toLowerCase()) ||
      s.admission_no.toLowerCase().includes(term.toLowerCase())).length;
    assert.equal(page.total, recount,
      `Searching "${term}" returned ${page.total} pupils; a recount over the store gives ${recount}.`);
    assert.ok(page.items.some((s) => s.id === target.id), `Searching "${term}" did not return ${target.name}.`);
  });

  it('search by admission number finds exactly one pupil', async () => {
    const target = active()[3];
    const page = await API.searchStudents('sch-riverside', { search: target.admission_no, pageSize: 1000 });
    assert.equal(page.total, 1, `Searching "${target.admission_no}" returned ${page.total} pupils.`);
    assert.equal(page.items[0].id, target.id, 'The admission-number search returned the wrong pupil.');
  });

  it('the class filter matches a recount from the store', async () => {
    for (const classId of ['cls-g4e', 'cls-g7e', 'cls-g9e']) {
      const page = await API.searchStudents('sch-riverside', { classId, status: 'active', pageSize: 1000 });
      const recount = active().filter((s) => s.class_id === classId).length;
      assert.equal(page.total, recount,
        `The ${classId} filter returned ${page.total} pupils; the store holds ${recount}.`);
      const strays = page.items.filter((s) => s.class_id !== classId).map((s) => s.name);
      deepEqual(strays, [], `Pupils from another class leaked into the ${classId} filter: ${strays.join(', ')}`);
    }
  });

  it('search and class filter compose', async () => {
    const classId = 'cls-g6e';
    const inClass = active().filter((s) => s.class_id === classId);
    const term = inClass[0].name.split(' ')[1];
    const page = await API.searchStudents('sch-riverside', { classId, search: term, status: 'active', pageSize: 1000 });
    const recount = inClass.filter((s) =>
      s.name.toLowerCase().includes(term.toLowerCase()) ||
      s.admission_no.toLowerCase().includes(term.toLowerCase())).length;
    assert.equal(page.total, recount,
      `"${term}" within ${classId} returned ${page.total}; a recount gives ${recount}.`);
  });

  it('sorting reorders without losing anyone', async () => {
    const asc = await API.searchStudents('sch-riverside', { sort: 'balance', dir: 'asc', status: 'active', pageSize: 1000 });
    const desc = await API.searchStudents('sch-riverside', { sort: 'balance', dir: 'desc', status: 'active', pageSize: 1000 });
    assert.equal(asc.total, desc.total, 'Reversing the sort changed how many pupils came back.');
    const ascBalances = asc.items.map((s) => s.balance);
    const sorted = ascBalances.slice().sort((a, b) => a - b);
    deepEqual(ascBalances, sorted, 'Sorting by balance ascending did not produce an ascending order.');
    assert.equal(desc.items[0].balance, asc.items[asc.items.length - 1].balance,
      'The descending sort does not start where the ascending one ends.');
  });
});

describe('Student record', () => {
  it('renders all six tabs for a real pupil', async () => {
    const seed = await openPage('app/students.html');
    const id = storeOf(seed.window).students[0].id;
    seed.window.close();

    const dom = await openPage(`app/student.html?id=${id}`);
    const win = dom.window;
    const tabs = $$(win, '[data-tab]').map((b) => b.getAttribute('data-tab'));
    const shown = !$(win, '#record').hidden;
    const notFound = !$(win, '#notfound').hidden;
    const guardians = $$(win, '#guardian-cards .gcard').length;
    const days = $$(win, '#calendar .cal__d').length;
    dom.window.close();

    deepEqual(tabs, ['overview', 'guardians', 'fees', 'attendance', 'results', 'discipline'],
      `The record shows tabs [${tabs.join(', ')}]; six were specified.`);
    assert.ok(shown, 'The record panel is still hidden for a pupil that exists.');
    assert.ok(!notFound, 'The not-found panel is showing for a pupil that exists.');
    assert.ok(guardians >= 1, `The guardians tab drew ${guardians} cards.`);
    assert.equal(days, 60, `The attendance calendar drew ${days} days; the last 60 school days were specified.`);
  });

  it('exactly one guardian card is marked primary', async () => {
    const seed = await openPage('app/students.html');
    const id = storeOf(seed.window).students[0].id;
    seed.window.close();

    const dom = await openPage(`app/student.html?id=${id}`);
    const primary = $$(dom.window, '#guardian-cards .gcard[data-primary="true"]').length;
    dom.window.close();
    assert.equal(primary, 1, `${primary} guardian cards are marked primary; exactly one should be.`);
  });

  it('a nonsense id renders the not-found panel and logs no error', async () => {
    const errors = [];
    const dom = await openPage('app/student.html?id=nonsense', {
      readySelector: 'body[data-ready]',
      onConsoleError: (args) => errors.push(args)
    });
    const win = dom.window;
    const notFound = !$(win, '#notfound').hidden;
    const record = !$(win, '#record').hidden;
    const ready = win.document.body.getAttribute('data-ready');
    dom.window.close();

    assert.ok(notFound, 'student.html?id=nonsense did not render the not-found panel.');
    assert.ok(!record, 'The record panel is showing for an id that does not exist.');
    assert.equal(ready, 'notfound', `The page reported data-ready="${ready}", expected "notfound".`);
    deepEqual(errors, [], `A bad id logged to console.error, which means it threw rather than handling it:\n  ${errors.join('\n  ')}`);
  });

  it('a missing id renders the not-found panel too', async () => {
    const errors = [];
    const dom = await openPage('app/student.html', {
      readySelector: 'body[data-ready]',
      onConsoleError: (args) => errors.push(args)
    });
    const notFound = !$(dom.window, '#notfound').hidden;
    dom.window.close();
    assert.ok(notFound, 'student.html with no id at all did not render the not-found panel.');
    deepEqual(errors, [], `Opening student.html with no id logged an error:\n  ${errors.join('\n  ')}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Step 4 — academics
// ══════════════════════════════════════════════════════════════════════════

describe('Grading scales', () => {
  let dom, win, API;
  before(async () => { dom = await openPage('app/grading-scales.html'); win = dom.window; API = win.ShuleAPI; });
  after(() => { if (dom) dom.window.close(); });

  it('seeds two scales, side by side, both covering their whole range', async () => {
    const rows = await API.listGradingScaleRows('sch-riverside', {});
    assert.ok(rows.length >= 2, `Only ${rows.length} grading scales are seeded; two were asked for.`);
    const names = rows.map((g) => g.name).join(' | ');
    assert.ok(/cbc/i.test(names), `No CBC scale among: ${names}`);
    assert.ok(/8-4-4|letter/i.test(names), `No 8-4-4 scale among: ${names}`);
    const holes = rows.filter((g) => !g.tiles).map((g) => g.name);
    deepEqual(holes, [], `These seeded scales do not tile their range: ${holes.join(', ')}`);
    assert.equal(rows.filter((g) => g.is_default).length, 1,
      `${rows.filter((g) => g.is_default).length} scales are marked default; exactly one should be.`);
  });

  it('the CBC scale has the four performance levels', async () => {
    const rows = await API.listGradingScaleRows('sch-riverside', {});
    const cbc = rows.filter((g) => /cbc/i.test(g.name))[0];
    const grades = cbc.bands.map((b) => b.grade).sort();
    deepEqual(grades, ['AE', 'BE', 'EE', 'ME'],
      `The CBC scale has bands [${grades.join(', ')}]; BE, AE, ME and EE were specified.`);
  });

  it('refuses a gap and names the score that falls through', () => {
    const problem = API.validateBands([
      { grade: 'D', min: 0, max: 39, points: 1, remark: 'Below' },
      { grade: 'C', min: 40, max: 49, points: 2, remark: 'Fair' },
      { grade: 'B', min: 51, max: 100, points: 3, remark: 'Good' }
    ], 100);
    assert.ok(problem, 'A scale with a hole at 50 was accepted.');
    assert.ok(/gap/i.test(problem), `The message does not say "gap": ${problem}`);
    assert.ok(/\b50\b/.test(problem), `The message does not name the score that falls through: ${problem}`);
  });

  it('refuses an overlap and names the range that matches twice', () => {
    const problem = API.validateBands([
      { grade: 'D', min: 0, max: 50, points: 1, remark: 'Below' },
      { grade: 'C', min: 40, max: 100, points: 2, remark: 'Fair' }
    ], 100);
    assert.ok(problem, 'Two bands overlapping 40–50 were accepted.');
    assert.ok(/overlap/i.test(problem), `The message does not say "overlap": ${problem}`);
    assert.ok(/40/.test(problem) && /50/.test(problem), `The message does not name the overlapping range: ${problem}`);
  });

  it('refuses bands that do not start at 0 or reach the maximum', () => {
    const low = API.validateBands([{ grade: 'A', min: 10, max: 100, points: 1, remark: 'x' }], 100);
    assert.ok(low && /0 to 9|must start at 0/i.test(low), `Starting at 10 was accepted or misreported: ${low}`);
    const high = API.validateBands([{ grade: 'A', min: 0, max: 90, points: 1, remark: 'x' }], 100);
    assert.ok(high && /91/.test(high), `Ending at 90 out of 100 was accepted or misreported: ${high}`);
  });

  it('refuses a duplicate grade and a backwards band', () => {
    const dupe = API.validateBands([
      { grade: 'A', min: 0, max: 50, points: 1, remark: 'x' },
      { grade: 'A', min: 51, max: 100, points: 2, remark: 'x' }
    ], 100);
    assert.ok(dupe && /twice/i.test(dupe), `A duplicate grade was accepted: ${dupe}`);
    const back = API.validateBands([{ grade: 'A', min: 80, max: 20, points: 1, remark: 'x' }], 100);
    assert.ok(back && /backwards/i.test(back), `A band running 80 to 20 was accepted: ${back}`);
  });

  it('accepts a clean scale and saves it', async () => {
    const before = (await API.listGradingScaleRows('sch-riverside', {})).length;
    const scale = await API.createGradingScale('sch-riverside', {
      name: 'Junior formative (test)', maxScore: 40,
      bands: [
        { grade: 'BE', min: 0, max: 15, points: 1, remark: 'Below expectation' },
        { grade: 'AE', min: 16, max: 25, points: 2, remark: 'Approaching expectation' },
        { grade: 'ME', min: 26, max: 33, points: 3, remark: 'Meeting expectation' },
        { grade: 'EE', min: 34, max: 40, points: 4, remark: 'Exceeding expectation' }
      ]
    });
    const after = await API.listGradingScaleRows('sch-riverside', {});
    checkInvariants(win, 'creating a grading scale');
    assert.equal(after.length, before + 1, `The scale list went from ${before} to ${after.length}.`);
    assert.equal(scale.max_score, 40, `The saved scale is out of ${scale.max_score}, expected 40.`);
    assert.ok(after.filter((g) => g.id === scale.id)[0].tiles, 'The saved scale does not tile its range.');
    await API.deleteGradingScale('sch-riverside', scale.id);
  });

  it('will not delete a scale that exams grade against, or the default', async () => {
    const rows = await API.listGradingScaleRows('sch-riverside', {});
    const bound = rows.filter((g) => g.exam_count > 0 && !g.is_default)[0] ||
                  rows.filter((g) => g.exam_count > 0)[0];
    let err = null;
    await API.deleteGradingScale('sch-riverside', bound.id).catch((e) => { err = e; });
    assert.ok(err, `"${bound.name}" was deleted despite ${bound.exam_count} exams grading against it.`);
    assert.equal(err.status, 409, `The refusal came back as ${err.status}, expected 409.`);
    assert.ok(/exam|default/i.test(err.message), `The refusal does not explain itself: ${err.message}`);
    const still = await API.listGradingScaleRows('sch-riverside', {});
    assert.ok(still.some((g) => g.id === bound.id), 'The scale went anyway.');
  });

  it('refuses to edit a scale that published report cards were graded on', async () => {
    const page = await openPage('app/grading-scales.html');
    const w = page.window;
    const scale = (await w.ShuleAPI.listGradingScaleRows('sch-riverside', {}))
      .filter((g) => g.result_count > 0)[0];
    const published = storeOf(w).report_cards.filter((c) => c.status === 'published');
    assert.ok(published.length, 'No published cards in the seed, so the guard is never exercised.');

    const bands = scale.bands.map((b) => Object.assign({}, b));
    bands[bands.length - 2].max -= 2;
    bands[bands.length - 1].min -= 2;

    let err = null;
    await w.ShuleAPI.updateGradingScale('sch-riverside', scale.id, {
      name: scale.name, maxScore: scale.max_score, bands
    }).catch((e) => { err = e; });
    const after = storeOf(w).grading_scales.filter((g) => g.id === scale.id)[0];
    checkInvariants(w, 'a refused scale edit');
    page.window.close();

    assert.ok(err, 'A scale that published cards were graded on was edited.');
    assert.equal(err.status, 409, `The refusal came back as ${err.status}, expected 409.`);
    assert.ok(/published report card/i.test(err.message),
      `The refusal does not say what is blocking it: ${err.message}`);
    assert.ok(Array.isArray(err.classes) && err.classes.length,
      'The refusal does not name the classes whose cards are affected.');
    assert.ok(/regenerate/i.test(err.message),
      `The refusal does not say what to do about it: ${err.message}`);
    assert.equal(after.bands[after.bands.length - 1].min, scale.bands[scale.bands.length - 1].min,
      'The bands changed anyway.');
  });

  it('regrades live marks once no published card depends on the scale', async () => {
    const page = await openPage('app/grading-scales.html');
    const w = page.window;
    const API2 = w.ShuleAPI;
    const scale = (await API2.listGradingScaleRows('sch-riverside', {}))
      .filter((g) => g.result_count > 0)[0];

    // put every published card back to draft, the way the refusal asks
    const classes = [...new Set(storeOf(w).report_cards
      .filter((c) => c.status === 'published').map((c) => c.class_id))];
    for (const classId of classes) {
      await API2.generateReportCards('sch-riverside', { classId, examId: 'exm-t2-mid' });
    }
    assert.equal(storeOf(w).report_cards.filter((c) => c.status === 'published').length, 0,
      'Regenerating did not clear the published cards, so the edit would still be blocked.');

    const bands = scale.bands.map((b) => Object.assign({}, b));
    bands[bands.length - 2].max -= 2;
    bands[bands.length - 1].min -= 2;

    const r = await API2.updateGradingScale('sch-riverside', scale.id, {
      name: scale.name, maxScore: scale.max_score, bands
    });
    checkInvariants(w, 'editing a grading scale');
    page.window.close();
    assert.ok(r.regraded > 0,
      'Widening a band regraded nothing, so stored grades have drifted from the scale that produced them.');
  });
});

describe('Attendance', () => {
  let dom, win, API;
  before(async () => { dom = await openPage('app/attendance.html'); win = dom.window; API = win.ShuleAPI; });
  after(() => { if (dom) dom.window.close(); });

  const UNMARKED = 'cls-g6w';   // no register taken today in the seed

  it('the register opens on the roll for the chosen class and date', async () => {
    const r = await API.getClassRegister('sch-riverside', UNMARKED, { date: storeOf(win).today });
    const roll = storeOf(win).students.filter((s) => s.class_id === UNMARKED && s.status === 'active').length;
    assert.equal(r.roll.length, roll, `The register drew ${r.roll.length} pupils for a roll of ${roll}.`);
    assert.equal(r.already_marked, false, 'That class is marked today; the unmarked path is never exercised.');
    assert.ok(r.roll.every((x) => x.status === null), 'An unmarked register came back with marks on it.');
  });

  it('renders the roll with a mark control per pupil', () => {
    const rows = $$(win, '#roll tr');
    assert.ok(rows.length > 0, 'The register table drew no rows.');
    const missing = rows.filter((tr) => tr.querySelectorAll('[data-mark]').length !== 3)
      .map((tr) => tr.getAttribute('data-student'));
    deepEqual(missing.slice(0, 5), [],
      `These rows do not offer present, absent and late: ${missing.slice(0, 5).join(', ')}`);
  });

  it('submitting a register that already exists updates rather than duplicates', async () => {
    const page = await openPage('app/attendance.html');
    const w = page.window;
    const API2 = w.ShuleAPI;
    const D = storeOf(w);
    const date = D.today;
    const roll = D.students.filter((s) => s.class_id === UNMARKED && s.status === 'active');
    const before = D.attendance.length;

    const first = await API2.markAttendance('sch-riverside', UNMARKED, {
      date, markedBy: 'tch-04',
      records: roll.map((s) => ({ student_id: s.id, status: 'present' }))
    });
    checkInvariants(w, 'marking a register for the first time');
    const afterFirst = storeOf(w).attendance.length;

    assert.equal(first.created, roll.length, `The first submit created ${first.created} of ${roll.length}.`);
    assert.equal(first.updated, 0, `The first submit updated ${first.updated}; nothing existed to update.`);
    assert.equal(afterFirst, before + roll.length,
      `The record count went from ${before} to ${afterFirst}, expected ${before + roll.length}.`);

    // now mark the same register again, with different values
    const second = await API2.markAttendance('sch-riverside', UNMARKED, {
      date, markedBy: 'tch-04',
      records: roll.map((s, i) => ({ student_id: s.id, status: i < 3 ? 'absent' : 'present', note: i < 3 ? 'Sick' : null }))
    });
    checkInvariants(w, 'marking the same register twice');
    const afterSecond = storeOf(w).attendance.length;
    const today = storeOf(w).attendance.filter((a) => a.class_id === UNMARKED && a.date === date);

    assert.equal(afterSecond, afterFirst,
      `The second submit changed the record count from ${afterFirst} to ${afterSecond}. A repeat register must upsert, not insert.`);
    assert.equal(second.created, 0, `The second submit created ${second.created} new records.`);
    assert.equal(second.updated, roll.length, `The second submit updated ${second.updated} of ${roll.length}.`);
    assert.equal(second.was_update, true, 'The second submit did not report itself as an update.');
    assert.equal(today.length, roll.length,
      `${today.length} records exist for ${roll.length} pupils on ${date}; there must be exactly one each.`);

    const absent = today.filter((a) => a.status === 'absent');
    assert.equal(absent.length, 3, `${absent.length} pupils are marked absent after the update; 3 were.`);
    assert.ok(absent.every((a) => a.note === 'Sick'), 'The notes did not come through on the update.');
    assert.ok(today.every((a) => a.marked_by === 'tch-04'), 'marked_by was not stamped on every record.');
    page.window.close();
  });

  it('refuses a register with an unmarked pupil or a bad status', async () => {
    const page = await openPage('app/attendance.html');
    const w = page.window;
    const before = storeOf(w).attendance.length;
    let err = null;
    await w.ShuleAPI.markAttendance('sch-riverside', UNMARKED, {
      date: storeOf(w).today, markedBy: 'tch-04',
      records: [{ student_id: storeOf(w).students[0].id, status: 'maybe' }]
    }).catch((e) => { err = e; });
    const after = storeOf(w).attendance.length;
    page.window.close();
    assert.ok(err, 'A status of "maybe" was accepted.');
    assert.equal(after, before, 'The rejected register still wrote records.');
  });

  it('refuses a register dated in the future', async () => {
    let err = null;
    await API.markAttendance('sch-riverside', UNMARKED, {
      date: '2027-01-01', markedBy: 'tch-04',
      records: [{ student_id: storeOf(win).students[0].id, status: 'present' }]
    }).catch((e) => { err = e; });
    assert.ok(err, 'A register dated in 2027 was accepted.');
    assert.ok(/future/i.test(err.message), `The refusal reads "${err.message}".`);
  });

  it('the report percentages match a recount from the store', async () => {
    const r = await API.getAttendanceReport('sch-riverside', { classId: 'cls-g4e' });
    const D = storeOf(win);
    const off = r.rows.slice(0, 8).map((row) => {
      const mine = D.attendance.filter((a) => a.student_id === row.student_id &&
        a.date >= r.from && a.date <= r.to);
      const here = mine.filter((a) => a.status === 'present' || a.status === 'late').length;
      const expected = mine.length ? here / mine.length * 100 : null;
      if (expected === null && row.percentage === null) return null;
      return Math.abs(row.percentage - expected) < 0.001 ? null
        : `${row.name}: report says ${row.percentage}, recount gives ${expected}`;
    }).filter(Boolean);
    deepEqual(off, [], `Attendance percentages do not match the register:\n  ${off.join('\n  ')}`);
  });

  it('the report grid is one column per school day in the range', async () => {
    const r = await API.getAttendanceReport('sch-riverside', { classId: 'cls-g4e' });
    const weekend = r.dates.filter((d) => [0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()));
    deepEqual(weekend, [], `The report includes non-school days: ${weekend.join(', ')}`);
    const wrong = r.rows.filter((row) => row.days.length !== r.dates.length).map((row) => row.name);
    deepEqual(wrong.slice(0, 3), [], `These rows have the wrong number of day cells: ${wrong.slice(0, 3).join(', ')}`);
  });

  it('the absentee list is exactly who was away that day', async () => {
    const D = storeOf(win);
    const date = D.today;
    const r = await API.getAbsentees('sch-riverside', { date });
    const expected = D.attendance.filter((a) => a.date === date &&
      (a.status === 'absent' || a.status === 'excused')).length;
    assert.equal(r.total, expected, `The absentee list shows ${r.total}; the register has ${expected} away.`);
    assert.ok(r.items.every((a) => a.guardian_phone), 'An absentee has no guardian phone to call.');
  });
});

describe('Exams', () => {
  let dom, win, API;
  before(async () => { dom = await openPage('app/exams.html'); win = dom.window; API = win.ShuleAPI; });
  after(() => { if (dom) dom.window.close(); });

  it('lists the term exams with their scale and mark counts', async () => {
    const rows = await API.listExamRows('sch-riverside', {});
    assert.ok(rows.length >= 2, `Only ${rows.length} exams are seeded.`);
    const nameless = rows.filter((e) => !e.scale_name || e.scale_name === '—').map((e) => e.name);
    deepEqual(nameless, [], `These exams are not bound to a grading scale: ${nameless.join(', ')}`);
    const marked = rows.filter((e) => e.result_count > 0);
    assert.ok(marked.length >= 1, 'No exam has any marks, so nothing downstream can be tested.');
    assert.ok(marked[0].locked, 'An exam with marks is not reported as locked.');
  });

  it('creating an exam requires a bound scale it can actually grade against', async () => {
    const base = {
      name: 'Opener 2027', type: 'opener', termId: 't2-2026',
      startsOn: '2026-09-10', endsOn: '2026-09-12', maxScore: 100, classIds: ['cls-g4e']
    };
    let err = null;
    await API.createExam('sch-riverside', Object.assign({}, base, { gradingScaleId: null })).catch((e) => { err = e; });
    assert.ok(err, 'An exam with no grading scale was created.');
    assert.ok(/grading scale/i.test(err.message), `The refusal reads "${err.message}".`);

    // a 200-mark exam cannot grade on a scale that stops at 100
    err = null;
    await API.createExam('sch-riverside', Object.assign({}, base, { maxScore: 200, gradingScaleId: 'grd-844' }))
      .catch((e) => { err = e; });
    assert.ok(err, 'An exam out of 200 was bound to a scale that only reaches 100.');
    assert.ok(/only grades up to|outside every band/i.test(err.message),
      `The refusal does not explain the mismatch: ${err.message}`);
  });

  it('creates a valid exam and refuses one that ends before it starts', async () => {
    const before = (await API.listExamRows('sch-riverside', {})).length;
    const exam = await API.createExam('sch-riverside', {
      name: 'Opener Term 3', type: 'opener', termId: 't2-2026',
      startsOn: '2026-09-10', endsOn: '2026-09-12', maxScore: 100,
      gradingScaleId: 'grd-844', classIds: ['cls-g4e', 'cls-g5w']
    });
    const after = await API.listExamRows('sch-riverside', {});
    checkInvariants(win, 'creating an exam');
    assert.equal(after.length, before + 1, `The exam list went from ${before} to ${after.length}.`);
    assert.equal(exam.class_ids.length, 2, 'The classes sitting it were not saved.');

    let err = null;
    await API.createExam('sch-riverside', {
      name: 'Backwards', type: 'cat', termId: 't2-2026',
      startsOn: '2026-09-20', endsOn: '2026-09-10', maxScore: 40,
      gradingScaleId: 'grd-cbc', classIds: ['cls-g4e']
    }).catch((e) => { err = e; });
    assert.ok(err && /ends before it starts/i.test(err.message),
      `An exam ending before it starts was accepted, or misreported: ${err && err.message}`);
  });

  it("an exam's scale cannot change once results exist, and says why", async () => {
    const page = await openPage('app/exams.html');
    const w = page.window;
    const marked = (await w.ShuleAPI.listExamRows('sch-riverside', {}))
      .filter((e) => e.result_count > 0)[0];
    const wasScale = marked.grading_scale_id;
    const other = (await w.ShuleAPI.listGradingScaleRows('sch-riverside', {}))
      .filter((g) => g.id !== wasScale)[0];

    let err = null;
    await w.ShuleAPI.updateExam('sch-riverside', marked.id, { gradingScaleId: other.id }).catch((e) => { err = e; });
    const now = (await w.ShuleAPI.listExamRows('sch-riverside', {})).filter((e) => e.id === marked.id)[0];
    page.window.close();

    assert.ok(err, `"${marked.name}" moved scale despite ${marked.result_count} marks against it.`);
    assert.equal(err.status, 409, `The refusal came back as ${err.status}, expected 409.`);
    assert.ok(err.message.includes(String(marked.result_count)),
      `The refusal does not say how many marks are affected: ${err.message}`);
    assert.ok(/already marked|old bands/i.test(err.message),
      `The refusal does not explain the risk: ${err.message}`);
    assert.equal(now.grading_scale_id, wasScale, 'The scale changed anyway.');
  });

  it('an unmarked exam can still be re-bound', async () => {
    const page = await openPage('app/exams.html');
    const w = page.window;
    const clean = (await w.ShuleAPI.listExamRows('sch-riverside', {}))
      .filter((e) => e.result_count === 0 && e.max_score === 100)[0];
    assert.ok(clean, 'No unmarked exam to re-bind.');
    const updated = await w.ShuleAPI.updateExam('sch-riverside', clean.id, { gradingScaleId: 'grd-cbc' });
    checkInvariants(w, 'rebinding an unmarked exam');
    page.window.close();
    assert.equal(updated.grading_scale_id, 'grd-cbc',
      `The scale is ${updated.grading_scale_id} after re-binding an exam with no marks.`);
  });
});

describe('Results', () => {
  let dom, win, API;
  const EXAM = 'exm-t2-mid', CLASS = 'cls-g7w', SUBJECT = 'sub-mat';
  before(async () => { dom = await openPage('app/results.html'); win = dom.window; API = win.ShuleAPI; });
  after(() => { if (dom) dom.window.close(); });

  it('the mark sheet is one row per pupil, with the exam maximum on it', async () => {
    const sheet = await API.getMarkSheet('sch-riverside', EXAM, { classId: CLASS, subjectId: SUBJECT });
    const roll = storeOf(win).students.filter((s) => s.class_id === CLASS && s.status === 'active').length;
    assert.equal(sheet.roll.length, roll, `The sheet drew ${sheet.roll.length} rows for a roll of ${roll}.`);
    assert.equal(sheet.max_score, 100, `The sheet says out of ${sheet.max_score}.`);
    assert.ok(sheet.scale && sheet.scale.bands.length, 'The sheet came back with no grading scale.');
  });

  it('renders a score input bounded by the exam maximum', () => {
    const inputs = $$(win, '#rows [data-score]');
    assert.ok(inputs.length > 0, 'The mark sheet drew no score inputs.');
    const wrong = inputs.filter((i) => i.getAttribute('max') !== '100' || i.getAttribute('min') !== '0');
    assert.equal(wrong.length, 0, `${wrong.length} score inputs are not bounded to 0–100.`);
  });

  it('typing a mark derives its grade and points live', async () => {
    const page = await openPage('app/results.html');
    const w = page.window;
    const input = $(w, '#rows [data-score]');
    const id = input.getAttribute('data-score');
    input.value = '72';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));

    // the cell is "<grade>" followed by a <span> carrying the remark
    const grade = $(w, `[data-grade="${id}"]`).childNodes[0].nodeValue.trim();
    const points = text($(w, `[data-points="${id}"]`));
    const scale = storeOf(w).grading_scales.filter((g) => g.id === 'grd-844')[0];
    const band = scale.bands.filter((b) => 72 >= b.min && 72 <= b.max)[0];
    page.window.close();

    assert.equal(grade, band.grade, `Typing 72 showed grade "${grade}"; the scale puts it in ${band.grade}.`);
    assert.equal(points, String(band.points), `Typing 72 showed ${points} points; the band carries ${band.points}.`);
  });

  it('a mark outside 0..max is rejected inline and blocks the save', async () => {
    const page = await openPage('app/results.html');
    const w = page.window;
    const before = storeOf(w).exam_results.length;
    const input = $(w, '#rows [data-score]');
    const id = input.getAttribute('data-score');

    input.value = '140';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    const err = $(w, `#scoreerr-${id}`);
    assert.ok(text(err).length > 0, 'A mark of 140 out of 100 showed no inline error.');
    assert.ok(/out of 100/i.test(text(err)), `The inline error reads "${text(err)}".`);
    assert.equal(input.getAttribute('aria-invalid'), 'true', 'The out-of-range input is not marked aria-invalid.');

    $(w, '#save-marks').click();
    await new Promise((r) => w.setTimeout(r, 80));
    const after = storeOf(w).exam_results.length;
    const toast = $(w, '#toasts [data-toast]');
    page.window.close();

    assert.equal(after, before, `Saving with an out-of-range mark wrote ${after - before} results.`);
    assert.ok(toast && /outside/i.test(text(toast)), `The save produced no explanatory toast: ${toast && text(toast)}`);
  });

  it('the backend refuses an out-of-range mark even if the page is bypassed', async () => {
    const page = await openPage('app/results.html');
    const w = page.window;
    const before = storeOf(w).exam_results.length;
    const roll = storeOf(w).students.filter((s) => s.class_id === CLASS && s.status === 'active');

    for (const bad of [-1, 101, 999]) {
      let err = null;
      await w.ShuleAPI.saveExamResults('sch-riverside', EXAM, {
        classId: CLASS, subjectId: SUBJECT, enteredBy: 'tch-01',
        scores: [{ student_id: roll[0].id, score: bad }]
      }).catch((e) => { err = e; });
      assert.ok(err, `A score of ${bad} was accepted against an exam out of 100.`);
      assert.ok(/outside 0–100/.test(err.message), `The refusal reads "${err.message}".`);
    }
    const after = storeOf(w).exam_results.length;
    checkInvariants(w, 'rejected out-of-range marks');
    page.window.close();
    assert.equal(after, before, 'A rejected mark sheet still wrote results.');
  });

  it('saving derives grade and points from the bound scale, never from the caller', async () => {
    const page = await openPage('app/results.html');
    const w = page.window;
    const roll = storeOf(w).students.filter((s) => s.class_id === CLASS && s.status === 'active');
    const scale = storeOf(w).grading_scales.filter((g) => g.id === 'grd-844')[0];

    await w.ShuleAPI.saveExamResults('sch-riverside', EXAM, {
      classId: CLASS, subjectId: SUBJECT, enteredBy: 'tch-01',
      scores: roll.slice(0, 5).map((s, i) => ({
        student_id: s.id, score: [0, 44, 50, 79, 100][i],
        grade: 'Z', points: 999             // a caller trying to dictate the grade
      }))
    });
    checkInvariants(w, 'saving a mark sheet');

    const saved = storeOf(w).exam_results.filter((r) =>
      r.exam_id === EXAM && r.class_id === CLASS && r.subject_id === SUBJECT &&
      roll.slice(0, 5).some((s) => s.id === r.student_id));
    page.window.close();

    assert.equal(saved.length, 5, `${saved.length} of 5 marks were saved.`);
    const wrong = saved.map((r) => {
      const band = scale.bands.filter((b) => r.score >= b.min && r.score <= b.max)[0];
      if (r.grade !== band.grade) return `${r.score} stored as ${r.grade}, band says ${band.grade}`;
      if (r.points !== band.points) return `${r.score} stored with ${r.points} points, band carries ${band.points}`;
      return null;
    }).filter(Boolean);
    deepEqual(wrong, [], `Stored grades do not follow the bound scale:\n  ${wrong.join('\n  ')}`);
  });

  it('a changed mark goes back to unverified', async () => {
    const page = await openPage('app/results.html');
    const w = page.window;
    const verified = storeOf(w).exam_results.filter((r) => r.exam_id === EXAM && r.verified)[0];
    assert.ok(verified, 'No verified result in the seed to disturb.');

    await w.ShuleAPI.saveExamResults('sch-riverside', EXAM, {
      classId: verified.class_id, subjectId: verified.subject_id, enteredBy: 'tch-01',
      scores: [{ student_id: verified.student_id, score: Math.max(0, verified.score - 3) }]
    });
    const now = storeOf(w).exam_results.filter((r) => r.id === verified.id)[0];
    checkInvariants(w, 'changing a verified mark');
    page.window.close();
    assert.equal(now.verified, false,
      'Changing a verified mark left it verified. A new number has not been checked by anyone.');
    assert.equal(now.verified_by, null, 'The old verifier is still stamped on a changed mark.');
  });

  it('verification is a separate action that records who did it', async () => {
    const page = await openPage('app/results.html');
    const w = page.window;
    const unverified = storeOf(w).exam_results.filter((r) => r.exam_id === EXAM && !r.verified);
    assert.ok(unverified.length, 'Nothing in the seed is awaiting verification.');
    const classId = unverified[0].class_id;

    let err = null;
    await w.ShuleAPI.verifyExamResults('sch-riverside', EXAM, { classId }).catch((e) => { err = e; });
    assert.ok(err, 'Verification went through without a name against it.');
    assert.ok(/signed|choose who/i.test(err.message), `The refusal reads "${err.message}".`);

    const r = await w.ShuleAPI.verifyExamResults('sch-riverside', EXAM, { classId, verifiedBy: 'tch-06', allowSelf: true });
    checkInvariants(w, 'verifying results');
    const after = storeOf(w).exam_results.filter((x) => x.exam_id === EXAM && x.class_id === classId);
    page.window.close();

    assert.ok(r.verified > 0, `Verification reported ${r.verified} marks.`);
    const left = after.filter((x) => !x.verified);
    assert.equal(left.length, 0, `${left.length} marks in that class are still unverified.`);
    const unstamped = after.filter((x) => !x.verified_by).length;
    assert.equal(unstamped, 0, `${unstamped} verified marks carry no verified_by.`);
  });

  it('the person who entered a mark cannot verify it', async () => {
    const page = await openPage('app/results.html');
    const w = page.window;
    const roll = storeOf(w).students.filter((s) => s.class_id === CLASS && s.status === 'active');
    await w.ShuleAPI.saveExamResults('sch-riverside', EXAM, {
      classId: CLASS, subjectId: SUBJECT, enteredBy: 'tch-02',
      scores: [{ student_id: roll[0].id, score: 61 }]
    });
    let err = null;
    await w.ShuleAPI.verifyExamResults('sch-riverside', EXAM, {
      classId: CLASS, subjectId: SUBJECT, verifiedBy: 'tch-02'
    }).catch((e) => { err = e; });
    page.window.close();
    assert.ok(err, 'The teacher who entered the marks was allowed to verify them.');
    assert.ok(/separate steps|same person/i.test(err.message), `The refusal reads "${err.message}".`);
  });

  it('unverified results are visibly marked in the sheet', () => {
    const rows = $$(win, '#rows tr[data-verified="false"]');
    const unmarked = rows.filter((tr) => !tr.querySelector('.tag--warn') && !tr.querySelector('.tag--mute'));
    assert.equal(unmarked.length, 0,
      `${unmarked.length} unverified rows carry no state pill, so nothing tells the reader the mark is unchecked.`);
  });

  it('class analysis matches a recount from the store', async () => {
    const a = await API.getClassAnalysis('sch-riverside', EXAM, { classId: 'cls-g4e' });
    const rows = storeOf(win).exam_results.filter((r) => r.exam_id === EXAM && r.class_id === 'cls-g4e');
    const scores = rows.map((r) => r.score);
    assert.equal(a.entries, rows.length, `The analysis counts ${a.entries} entries; the store holds ${rows.length}.`);
    assert.ok(Math.abs(a.mean - scores.reduce((n, v) => n + v, 0) / scores.length) < 0.001,
      `The analysis mean is ${a.mean}; a recount gives ${scores.reduce((n, v) => n + v, 0) / scores.length}.`);
    assert.equal(a.highest, Math.max(...scores), `Highest is ${a.highest}, recount gives ${Math.max(...scores)}.`);
    assert.equal(a.lowest, Math.min(...scores), `Lowest is ${a.lowest}, recount gives ${Math.min(...scores)}.`);
    const subjects = [...new Set(rows.map((r) => r.subject_id))];
    assert.equal(a.subjects.length, subjects.length,
      `The breakdown has ${a.subjects.length} subjects; ${subjects.length} were marked.`);
  });

  it('the merit list ranks by total descending, with ties sharing a rank and the next skipping', async () => {
    const m = await API.getMeritList('sch-riverside', EXAM, { classId: 'cls-g4e' });
    assert.ok(m.total > 0, 'The merit list is empty.');

    const totals = m.items.map((e) => e.total);
    const sorted = totals.slice().sort((a, b) => b - a);
    deepEqual(totals, sorted, `The merit list is not in descending total order: ${totals.slice(0, 6).join(', ')}`);

    // recompute the ranking from the store and compare
    const rows = storeOf(win).exam_results.filter((r) => r.exam_id === EXAM && r.class_id === 'cls-g4e');
    const byStudent = {};
    rows.forEach((r) => { byStudent[r.student_id] = (byStudent[r.student_id] || 0) + r.score; });
    const expected = Object.keys(byStudent).map((id) => ({ id, total: byStudent[id] }))
      .sort((a, b) => b.total - a.total);
    const want = {};
    expected.forEach((e) => { want[e.id] = expected.findIndex((x) => x.total === e.total) + 1; });
    const off = m.items.filter((e) => e.position !== want[e.student_id])
      .map((e) => `${e.name}: total ${e.total} ranks ${want[e.student_id]} but is shown at ${e.position}`);
    deepEqual(off.slice(0, 5), [], `Merit positions do not match a recount:\n  ${off.slice(0, 5).join('\n  ')}`);
  });

  it('ties share a rank and the next distinct total follows immediately', async () => {
    const page = await openPage('app/results.html');
    const w = page.window;
    const roll = storeOf(w).students.filter((s) => s.class_id === CLASS && s.status === 'active').slice(0, 4);

    // wipe the class, then give two pupils identical marks
    const subjects = [...new Set(storeOf(w).exam_results
      .filter((r) => r.exam_id === EXAM && r.class_id === CLASS).map((r) => r.subject_id))];
    for (const sub of subjects) {
      await w.ShuleAPI.saveExamResults('sch-riverside', EXAM, {
        classId: CLASS, subjectId: sub, enteredBy: 'tch-01',
        scores: storeOf(w).students.filter((s) => s.class_id === CLASS)
          .map((s) => ({ student_id: s.id, score: null }))
      });
    }
    await w.ShuleAPI.saveExamResults('sch-riverside', EXAM, {
      classId: CLASS, subjectId: SUBJECT, enteredBy: 'tch-01',
      scores: [
        { student_id: roll[0].id, score: 80 },
        { student_id: roll[1].id, score: 80 },
        { student_id: roll[2].id, score: 70 },
        { student_id: roll[3].id, score: 60 }
      ]
    });
    const m = await w.ShuleAPI.getMeritList('sch-riverside', EXAM, { classId: CLASS });
    checkInvariants(w, 'a merit list with a tie');
    page.window.close();

    const positions = m.items.map((e) => e.position);
    deepEqual(positions, [1, 1, 3, 4],
      `Two pupils tied on 80, then 70 and 60, should rank 1, 1, 3, 4 under competition ranking — ` +
      `got ${positions.join(', ')}. Dense ranking would give 1, 1, 2, 3.`);
  });
});

describe('Report cards', () => {
  const CLASS = 'cls-g8e';   // unverified in the seed, so publish is blocked

  it('generates a card per pupil with recomputable totals', async () => {
    const dom = await openPage('app/report-cards.html');
    const win = dom.window;
    const r = await win.ShuleAPI.generateReportCards('sch-riverside', { classId: 'cls-g4e', examId: 'exm-t2-mid' });
    checkInvariants(win, 'generating report cards');

    const D = storeOf(win);
    const roll = D.students.filter((s) => s.class_id === 'cls-g4e' && s.status === 'active').length;
    assert.equal(r.generated, roll, `${r.generated} cards for a roll of ${roll}.`);

    const off = r.cards.map((c) => {
      const mine = D.exam_results.filter((x) => x.exam_id === c.exam_id && x.student_id === c.student_id);
      const total = mine.reduce((n, x) => n + x.score, 0);
      const average = Math.round((total / mine.length) * 10) / 10;
      if (c.total_marks !== total) return `${c.id}: total ${c.total_marks}, results sum to ${total}`;
      if (c.average !== average) return `${c.id}: average ${c.average}, recompute gives ${average}`;
      if (c.subject_count !== mine.length) return `${c.id}: ${c.subject_count} subjects, ${mine.length} results`;
      return null;
    }).filter(Boolean);
    dom.window.close();
    deepEqual(off.slice(0, 5), [], `Card totals are not recomputable from their results:\n  ${off.slice(0, 5).join('\n  ')}`);
  });

  it('positions use competition ranking on the average, and class_size is the roll', async () => {
    const dom = await openPage('app/report-cards.html');
    const win = dom.window;
    const r = await win.ShuleAPI.listReportCardRows('sch-riverside', { classId: 'cls-g4e' });
    const cards = r.items;

    const ordered = cards.slice().sort((a, b) => b.average - a.average);
    const want = {};
    ordered.forEach((c) => { want[c.id] = ordered.findIndex((x) => x.average === c.average) + 1; });
    const off = cards.filter((c) => c.position !== want[c.id])
      .map((c) => `${c.student_name}: average ${c.average} ranks ${want[c.id]} but is at ${c.position}`);
    const sizes = [...new Set(cards.map((c) => c.class_size))];
    dom.window.close();

    deepEqual(off.slice(0, 5), [], `Positions do not use competition ranking:\n  ${off.slice(0, 5).join('\n  ')}`);
    deepEqual(sizes, [cards.length], `class_size reads ${sizes.join(', ')} but ${cards.length} pupils are ranked.`);
    const top = cards.filter((c) => c.position === 1);
    assert.ok(top.length >= 1, 'Nobody is ranked first.');
    const highest = Math.max(...cards.map((c) => c.position));
    assert.ok(highest <= cards.length,
      `The lowest position is ${highest} in a class of ${cards.length}; a position cannot exceed the class size.`);
  });

  it('a tie shares a position and the rank after it skips', async () => {
    const dom = await openPage('app/report-cards.html');
    const win = dom.window;
    const r = await win.ShuleAPI.listReportCardRows('sch-riverside', { classId: 'cls-g4e' });
    const byAverage = {};
    r.items.forEach((c) => { (byAverage[c.average] = byAverage[c.average] || []).push(c); });
    const tied = Object.values(byAverage).filter((g) => g.length > 1)[0];
    dom.window.close();

    assert.ok(tied, 'No two pupils in Grade 4 East share an average, so the tie rule is never exercised.');
    const positions = [...new Set(tied.map((c) => c.position))];
    assert.equal(positions.length, 1,
      `Pupils tied on ${tied[0].average} hold positions ${tied.map((c) => c.position).join(', ')}; a tie shares one position.`);

    const shared = positions[0];
    const next = r.items
      .filter((c) => c.average < tied[0].average)
      .sort((a, b) => b.average - a.average)[0];
    assert.ok(next, 'Nobody scored below the tie, so the skip is not visible.');
    assert.equal(next.position, shared + tied.length,
      `Two pupils tied at ${shared} should be followed by position ${shared + tied.length}, ` +
      `not ${next.position}. Dense ranking would say ${shared + 1} — and a card reading ` +
      `"Position ${shared + 1} of ${next.class_size}" with ${tied.length} pupils ahead is what a head teacher spots.`);
  });

  it('refuses to publish while any result feeding a card is unverified, and names the subjects', async () => {
    const dom = await openPage('app/report-cards.html');
    const win = dom.window;
    const D = storeOf(win);

    const unverified = D.exam_results.filter((r) => r.class_id === CLASS && !r.verified);
    assert.ok(unverified.length, `Class ${CLASS} has no unverified results, so the block is never exercised.`);
    await win.ShuleAPI.generateReportCards('sch-riverside', { classId: CLASS, examId: 'exm-t2-mid' });

    let err = null;
    await win.ShuleAPI.publishReportCardsFor('sch-riverside', { classId: CLASS }).catch((e) => { err = e; });
    const after = storeOf(win).report_cards.filter((c) => c.class_id === CLASS);
    checkInvariants(win, 'a blocked publish');

    const expectedSubjects = [...new Set(unverified.map((r) => {
      const s = D.subjects.filter((x) => x.id === r.subject_id)[0];
      return s ? s.name : r.subject_id;
    }))].sort();
    dom.window.close();

    assert.ok(err, 'A class with unverified results was published.');
    assert.equal(err.status, 409, `The refusal came back as ${err.status}, expected 409.`);
    for (const name of expectedSubjects) {
      assert.ok(err.message.includes(name),
        `The refusal does not name "${name}". It says: ${err.message}`);
    }
    assert.ok(Array.isArray(err.blocked) && err.blocked.length,
      'The refusal does not say which pupils are blocked.');
    const published = after.filter((c) => c.status === 'published');
    assert.equal(published.length, 0, `${published.length} cards were published anyway.`);
  });

  it('publishes once every result is verified, and stamps published_at', async () => {
    const dom = await openPage('app/report-cards.html');
    const win = dom.window;
    const API = win.ShuleAPI;

    await API.verifyExamResults('sch-riverside', 'exm-t2-mid', {
      classId: CLASS, verifiedBy: 'tch-06', allowSelf: true
    });
    await API.generateReportCards('sch-riverside', { classId: CLASS, examId: 'exm-t2-mid' });
    const r = await API.publishReportCardsFor('sch-riverside', { classId: CLASS });
    checkInvariants(win, 'publishing report cards');

    const cards = storeOf(win).report_cards.filter((c) => c.class_id === CLASS);
    dom.window.close();

    assert.ok(r.published > 0, `Publishing reported ${r.published} cards.`);
    const drafts = cards.filter((c) => c.status === 'draft');
    assert.equal(drafts.length, 0, `${drafts.length} cards are still in draft after publishing.`);
    const unstamped = cards.filter((c) => !c.published_at);
    assert.equal(unstamped.length, 0, `${unstamped.length} published cards carry no published_at.`);
    assert.ok(cards.every((c) => c.published_by), 'A published card has no published_by.');
  });

  it('a published card cannot have its comments rewritten', async () => {
    const dom = await openPage('app/report-cards.html');
    const win = dom.window;
    const API = win.ShuleAPI;
    await API.verifyExamResults('sch-riverside', 'exm-t2-mid', { classId: CLASS, verifiedBy: 'tch-06', allowSelf: true });
    await API.generateReportCards('sch-riverside', { classId: CLASS, examId: 'exm-t2-mid' });
    await API.publishReportCardsFor('sch-riverside', { classId: CLASS });
    const card = storeOf(win).report_cards.filter((c) => c.class_id === CLASS)[0];

    let err = null;
    await API.updateReportCard('sch-riverside', card.id, { teacher_comment: 'Rewritten' }).catch((e) => { err = e; });
    const now = storeOf(win).report_cards.filter((c) => c.id === card.id)[0];
    dom.window.close();
    assert.ok(err, 'A published card was edited under a guardian who may already have read it.');
    assert.notEqual(now.teacher_comment, 'Rewritten', 'The comment changed anyway.');
  });

  it('regenerating a published card puts it back in draft', async () => {
    const dom = await openPage('app/report-cards.html');
    const win = dom.window;
    const API = win.ShuleAPI;
    await API.verifyExamResults('sch-riverside', 'exm-t2-mid', { classId: CLASS, verifiedBy: 'tch-06', allowSelf: true });
    await API.generateReportCards('sch-riverside', { classId: CLASS, examId: 'exm-t2-mid' });
    await API.publishReportCardsFor('sch-riverside', { classId: CLASS });
    const r = await API.generateReportCards('sch-riverside', { classId: CLASS, examId: 'exm-t2-mid' });
    checkInvariants(win, 'regenerating a published class');
    dom.window.close();
    const stillPublished = r.cards.filter((c) => c.status === 'published');
    assert.equal(stillPublished.length, 0,
      `${stillPublished.length} cards stayed published after regeneration, so a guardian could be reading stale numbers.`);
  });

  it('nothing in draft reaches a guardian-facing surface', async () => {
    const dom = await openPage('app/report-cards.html');
    const win = dom.window;
    const D = storeOf(win);
    const drafts = D.report_cards.filter((c) => c.status === 'draft');
    assert.ok(drafts.length, 'No draft cards exist, so the check proves nothing.');

    // the guardian surface is the published set; a draft must never appear in it
    const published = await win.ShuleAPI.listReportCardRows('sch-riverside', { status: 'published' });
    const leaked = published.items.filter((c) => c.status !== 'published').map((c) => c.id);
    const stamped = published.items.filter((c) => !c.published_at).map((c) => c.id);
    dom.window.close();
    deepEqual(leaked, [], `Draft cards came back from the published query: ${leaked.join(', ')}`);
    deepEqual(stamped, [], `Cards in the published set with no published_at: ${stamped.join(', ')}`);
  });

  it('the card view names every unverified subject on a draft', async () => {
    const dom = await openPage('app/report-cards.html');
    const win = dom.window;
    const D = storeOf(win);
    const draft = D.report_cards.filter((c) => c.status === 'draft' &&
      D.exam_results.some((r) => r.exam_id === c.exam_id && r.student_id === c.student_id && !r.verified))[0];
    assert.ok(draft, 'No draft card with unverified results.');
    const v = await win.ShuleAPI.getReportCard('sch-riverside', draft.id);
    dom.window.close();
    assert.ok(v.unverified_subjects.length > 0,
      'A card built on unverified marks reports no unverified subjects.');
    assert.equal(v.card.status, 'draft', 'That card is not in draft.');
  });

  it('the page carries a print stylesheet that hides the application chrome', () => {
    const css = fs.readFileSync(path.join(ROOT, 'assets/css/app.css'), 'utf8');
    const print = css.slice(css.lastIndexOf('@media print'));
    assert.ok(print.length > 200, 'There is no substantial @media print block in app.css.');
    for (const hidden of ['.side', '.top', '.toasts']) {
      assert.ok(print.includes(hidden), `The print stylesheet does not hide ${hidden}.`);
    }
    assert.ok(/page-break-after/.test(print), 'The print stylesheet does not break pages between cards.');
    assert.ok(/@page/.test(print), 'The print stylesheet sets no page size or margin.');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Step 5 — teacher scope, parent scope, guardian portal
//
// Every test below is about a data leak. A page that renders is not evidence
// that the data on it belongs to the person reading it.
// ══════════════════════════════════════════════════════════════════════════

const ME_TEACHER = 'tch-04';
const ME_PARENT = '0722 418 067';   // guardians are keyed on phone, not an invented id

describe('Teacher scope', () => {
  let dom, win, API, D;
  before(async () => {
    dom = await openPage('app/teacher/dashboard.html', { role: 'teacher' });
    win = dom.window; API = win.ShuleAPI; D = storeOf(win);
  });
  after(() => { if (dom) dom.window.close(); });

  const assigned = () => {
    const ids = D.assignments.filter((a) => a.teacher_id === ME_TEACHER).map((a) => a.class_id);
    D.classes.forEach((c) => { if (c.class_teacher_id === ME_TEACHER) ids.push(c.id); });
    return [...new Set(ids)];
  };

  it('returns only the classes this teacher is assigned to', async () => {
    const rows = await API.listTeacherClasses('sch-riverside', ME_TEACHER);
    const got = rows.map((c) => c.id).sort();
    const want = assigned().sort();
    deepEqual(got, want,
      `The teacher was handed [${got.join(', ')}] but is assigned to [${want.join(', ')}].`);
    assert.ok(got.length < D.classes.length,
      `The teacher was handed all ${D.classes.length} classes, so the scoping is doing nothing.`);
  });

  it('a class the teacher does not teach answers exactly as one that does not exist', async () => {
    const mine = assigned();
    const notMine = D.classes.filter((c) => !mine.includes(c.id)).map((c) => c.id);
    assert.ok(notMine.length, 'This teacher is assigned to every class, so scoping cannot be tested.');

    const refusals = [];
    for (const classId of notMine) {
      let err = null;
      await API.getTeacherRegister('sch-riverside', ME_TEACHER, classId, {}).catch((e) => { err = e; });
      assert.ok(err, `The teacher opened the register for ${classId}, which they do not teach.`);
      refusals.push({ status: err.status, message: err.message });
    }
    let ghost = null;
    await API.getTeacherRegister('sch-riverside', ME_TEACHER, 'cls-does-not-exist', {}).catch((e) => { ghost = e; });

    for (const r of refusals) {
      assert.equal(r.status, ghost.status,
        `A class outside scope answers ${r.status} but a nonexistent one answers ${ghost.status}. ` +
        'The difference tells an attacker which classes exist.');
      assert.equal(r.message.replace(/cls-[\w-]+/, 'X'), ghost.message.replace(/cls-[\w-]+/, 'X'),
        `The refusals read differently: "${r.message}" versus "${ghost.message}".`);
    }
  });

  it('a subject the teacher does not teach is refused even in a class they do', async () => {
    const mine = D.assignments.filter((a) => a.teacher_id === ME_TEACHER)[0];
    const foreign = D.assignments.filter((a) => a.class_id === mine.class_id && a.teacher_id !== ME_TEACHER)[0];
    assert.ok(foreign, 'Nobody else teaches in that class, so the subject check cannot be tested.');

    let err = null;
    await API.getTeacherMarkSheet('sch-riverside', ME_TEACHER, 'exm-t2-mid',
      { classId: foreign.class_id, subjectId: foreign.subject_id }).catch((e) => { err = e; });
    assert.ok(err, `The teacher opened ${foreign.subject_id} in ${foreign.class_id}, which is not their assignment.`);
    assert.equal(err.status, 404, `The refusal came back as ${err.status}.`);
  });

  it('marks cannot be written to a class or subject outside the assignment', async () => {
    const page = await openPage('app/teacher/marks.html', { role: 'teacher' });
    const w = page.window;
    const store = storeOf(w);
    const before = store.exam_results.length;
    const mine = store.assignments.filter((a) => a.teacher_id === ME_TEACHER)[0];
    const foreign = store.assignments.filter((a) => a.teacher_id !== ME_TEACHER &&
      !store.assignments.some((x) => x.teacher_id === ME_TEACHER && x.class_id === a.class_id && x.subject_id === a.subject_id))[0];
    const victim = store.students.filter((s) => s.class_id === foreign.class_id)[0];

    let err = null;
    await w.ShuleAPI.saveTeacherResults('sch-riverside', ME_TEACHER, 'exm-t2-mid', {
      classId: foreign.class_id, subjectId: foreign.subject_id,
      scores: [{ student_id: victim.id, score: 99 }]
    }).catch((e) => { err = e; });
    const after = storeOf(w).exam_results.length;
    checkInvariants(w, 'a refused out-of-scope mark');
    page.window.close();

    assert.ok(err, 'A teacher wrote marks for a subject they do not teach.');
    assert.equal(after, before, `The refused write still added ${after - before} results.`);
    assert.ok(mine, 'sanity: the teacher has at least one assignment');
  });

  it('attendance written through the teacher route is stamped with that teacher', async () => {
    const page = await openPage('app/teacher/register.html', { role: 'teacher' });
    const w = page.window;
    const store = storeOf(w);
    const own = store.classes.filter((c) => c.class_teacher_id === ME_TEACHER)[0];
    assert.ok(own, 'This teacher is class teacher of nothing.');
    const roll = store.students.filter((s) => s.class_id === own.id && s.status === 'active');

    // markedBy is ignored: the route stamps whoever is signed in
    await w.ShuleAPI.markTeacherAttendance('sch-riverside', ME_TEACHER, own.id, {
      date: store.today, markedBy: 'tch-01',
      records: roll.map((s) => ({ student_id: s.id, status: 'present' }))
    });
    const marks = storeOf(w).attendance.filter((a) => a.class_id === own.id && a.date === store.today);
    checkInvariants(w, 'a teacher marking their register');
    page.window.close();

    const wrong = marks.filter((a) => a.marked_by !== ME_TEACHER).length;
    assert.equal(wrong, 0,
      `${wrong} records were stamped with someone other than the teacher who submitted them. ` +
      'A caller must not be able to sign a register in another teacher’s name.');
  });

  it('the dashboard only counts work inside the teacher’s scope', async () => {
    const d = await API.getTeacherDashboard('sch-riverside', ME_TEACHER, {});
    const mine = assigned();
    const strayPeriods = d.periods.filter((p) => !mine.includes(p.class_id)).map((p) => p.class_name);
    deepEqual(strayPeriods, [], `Periods for classes the teacher does not teach: ${strayPeriods.join(', ')}`);
    const strayRegisters = d.registers.filter((r) => {
      const c = D.classes.filter((x) => x.id === r.class_id)[0];
      return !c || c.class_teacher_id !== ME_TEACHER;
    }).map((r) => r.class_name);
    deepEqual(strayRegisters, [], `Registers the teacher does not own: ${strayRegisters.join(', ')}`);
    const strayMarks = d.marks_outstanding.filter((m) =>
      !D.assignments.some((a) => a.teacher_id === ME_TEACHER &&
        a.class_id === m.class_id && a.subject_id === m.subject_id))
      .map((m) => `${m.class_name} ${m.subject_name}`);
    deepEqual(strayMarks, [], `Mark sheets outside the teacher's assignments: ${strayMarks.join(', ')}`);
  });

  it('the timetable holds only this teacher’s periods', async () => {
    const t = await API.getTeacherTimetable('sch-riverside', ME_TEACHER, {});
    const stray = t.items.filter((i) => i.teacher_id !== ME_TEACHER).length;
    assert.equal(stray, 0, `${stray} periods on the timetable belong to another teacher.`);
    assert.ok(t.items.length > 0, 'The timetable is empty, so nothing is being checked.');
  });

  it('the register page renders only classes this teacher can open', () => {
    const options = $$(win, '#r-class option').map((o) => o.value);
    if (!options.length) return;                       // dashboard page has no picker
    const mine = assigned();
    const stray = options.filter((v) => v && !mine.includes(v));
    deepEqual(stray, [], `The class picker offers classes outside scope: ${stray.join(', ')}`);
  });
});

describe('Parent scope', () => {
  let dom, win, API, D;
  before(async () => {
    dom = await openPage('app/parent/index.html', { role: 'parent' });
    win = dom.window; API = win.ShuleAPI; D = storeOf(win);
  });
  after(() => { if (dom) dom.window.close(); });

  const myChildren = () => D.guardians.filter((g) => g.phone === ME_PARENT).map((g) => g.student_id);

  it('returns only children this guardian is a guardian of', async () => {
    const rows = await API.listMyChildren('sch-riverside', ME_PARENT);
    const got = rows.map((c) => c.student_id).sort();
    const want = myChildren().sort();
    deepEqual(got, want, `The guardian was handed [${got.join(', ')}] but guards [${want.join(', ')}].`);
    assert.ok(got.length > 1, 'The demo guardian has one child, so the switcher is never exercised.');
    assert.ok(got.length < D.students.length,
      `The guardian was handed all ${D.students.length} pupils; the scoping is doing nothing.`);
  });

  it('another family’s child is refused on every child route', async () => {
    const mine = myChildren();
    const stranger = D.students.filter((s) => !mine.includes(s.id))[0];
    const routes = [
      ['getChildFees', (id) => API.getChildFees('sch-riverside', ME_PARENT, id)],
      ['getChildAttendance', (id) => API.getChildAttendance('sch-riverside', ME_PARENT, id, {})],
      ['getChildResults', (id) => API.getChildResults('sch-riverside', ME_PARENT, id)]
    ];
    for (const [name, call] of routes) {
      let err = null;
      await call(stranger.id).catch((e) => { err = e; });
      assert.ok(err, `${name} handed over ${stranger.name}, who is not this guardian's child.`);
      assert.equal(err.status, 404,
        `${name} refused with ${err.status}; it should be 404, the same as a pupil that does not exist.`);
    }
  });

  it('the fee statement contains only this child', async () => {
    const mine = myChildren();
    const f = await API.getChildFees('sch-riverside', ME_PARENT, mine[0]);
    const strayInvoices = f.invoices.filter((i) => i.student_id !== mine[0]).map((i) => i.id);
    deepEqual(strayInvoices, [], `Invoices for another pupil: ${strayInvoices.join(', ')}`);
    const strayPayments = f.payments.filter((p) => p.student_id !== mine[0]).map((p) => p.id);
    deepEqual(strayPayments, [], `Payments for another pupil: ${strayPayments.join(', ')}`);
  });

  it('only published report cards reach a parent', async () => {
    const mine = myChildren();
    for (const id of mine) {
      const r = await API.getChildResults('sch-riverside', ME_PARENT, id);
      const cardIds = r.cards.map((c) => c.card_id);
      const drafts = D.report_cards
        .filter((c) => cardIds.includes(c.id) && c.status !== 'published')
        .map((c) => c.id);
      deepEqual(drafts, [], `Draft cards reached the parent view: ${drafts.join(', ')}`);
      const unpublished = r.cards.filter((c) => !c.published_at).map((c) => c.card_id);
      deepEqual(unpublished, [], `Cards with no published_at reached the parent: ${unpublished.join(', ')}`);
    }
  });

  it('only verified marks reach a parent', async () => {
    const mine = myChildren();
    const problems = [];
    for (const id of mine) {
      const r = await API.getChildResults('sch-riverside', ME_PARENT, id);
      r.cards.forEach((c) => {
        c.results.forEach((s) => {
          const stored = D.exam_results.filter((x) =>
            x.student_id === id && x.exam_id === c.exam_id && x.subject_id === s.subject_id)[0];
          if (!stored) problems.push(`${s.subject_name} on ${c.exam_name} has no stored result`);
          else if (!stored.verified) problems.push(`${s.subject_name} on ${c.exam_name} is unverified but was shown`);
        });
      });
    }
    deepEqual(problems, [], `Unverified marks reached a parent:\n  ${problems.join('\n  ')}`);
  });

  it('a draft card that exists is proven to be withheld', async () => {
    // if nothing is in draft the previous test passes vacuously
    const mine = myChildren();
    const withDraft = mine.filter((id) =>
      D.report_cards.some((c) => c.student_id === id && c.status === 'draft'));
    if (!withDraft.length) {
      // force one into draft, then check the parent view still refuses it
      const page = await openPage('app/parent/results.html', { role: 'parent' });
      const w = page.window;
      const store = storeOf(w);
      const child = store.guardians.filter((g) => g.person_id === ME_PARENT)[0].student_id;
      const card = store.report_cards.filter((c) => c.student_id === child)[0];
      await w.ShuleAPI.generateReportCards('sch-riverside',
        { classId: card.class_id, examId: card.exam_id });
      const r = await w.ShuleAPI.getChildResults('sch-riverside', ME_PARENT, child);
      const leaked = r.cards.filter((c) => c.card_id === card.id).length;
      page.window.close();
      assert.equal(leaked, 0,
        'A card put back into draft by a regenerate is still visible to the parent.');
      return;
    }
    for (const id of withDraft) {
      const r = await API.getChildResults('sch-riverside', ME_PARENT, id);
      const drafts = D.report_cards.filter((c) => c.student_id === id && c.status === 'draft').map((c) => c.id);
      const leaked = r.cards.filter((c) => drafts.includes(c.card_id)).map((c) => c.card_id);
      deepEqual(leaked, [], `Draft cards reached the parent: ${leaked.join(', ')}`);
    }
  });

  it('the child switcher offers exactly the guardian’s children', () => {
    const offered = $$(win, '#childbar [data-child]').map((b) => b.getAttribute('data-child')).sort();
    deepEqual(offered, myChildren().sort(),
      `The switcher offers [${offered.join(', ')}] but the guardian guards [${myChildren().join(', ')}].`);
  });

  it('the rendered page carries no other pupil’s name', () => {
    const mine = myChildren();
    const mineNames = D.students.filter((s) => mine.includes(s.id)).map((s) => s.name);
    const text = win.document.body.textContent;
    const leaked = D.students
      .filter((s) => !mine.includes(s.id))
      .filter((s) => !mineNames.some((n) => n === s.name))   // a shared name is not a leak
      .filter((s) => text.includes(s.name))
      .map((s) => s.name);
    deepEqual(leaked.slice(0, 5), [],
      `These pupils are not this guardian's children but appear on the page: ${leaked.slice(0, 5).join(', ')}`);
  });
});

describe('The guardian portal', () => {
  const LIVE = 'gp-live-4f21c8a9';
  const EXPIRED = 'gp-expired-91aa20d4';
  const REVOKED = 'gp-revoked-3c8f7e62';

  it('a live token resolves to exactly one student', async () => {
    const dom = await openPage(`portal.html?token=${LIVE}`, { readySelector: 'body[data-ready]' });
    const win = dom.window;
    const D = storeOf(win);
    const row = D.guardian_tokens.filter((t) => t.token === LIVE)[0];
    const v = await win.ShuleAPI.getGuardianPortal(LIVE, {});
    dom.window.close();

    assert.equal(v.state, 'ok', `A live token resolved to state "${v.state}".`);
    assert.equal(v.student.id, row.student_id,
      `The token resolved to ${v.student.id} but points at ${row.student_id}.`);
    assert.equal(Object.keys(v).filter((k) => k === 'students').length, 0,
      'The portal response carries a "students" collection; it is for one child.');
  });

  it('the response contains no other student’s data at any nesting level', async () => {
    const dom = await openPage(`portal.html?token=${LIVE}`, { readySelector: 'body[data-ready]' });
    const win = dom.window;
    const D = storeOf(win);
    const v = await win.ShuleAPI.getGuardianPortal(LIVE, {});
    const mine = v.student.id;
    const blob = JSON.stringify(v);
    dom.window.close();

    const otherIds = D.students.filter((s) => s.id !== mine).map((s) => s.id);
    const leakedIds = otherIds.filter((id) => blob.includes(id));
    deepEqual(leakedIds.slice(0, 5), [],
      `Another pupil's id appears in the portal payload: ${leakedIds.slice(0, 5).join(', ')}`);

    const myName = D.students.filter((s) => s.id === mine)[0].name;
    const leakedNames = D.students
      .filter((s) => s.id !== mine && s.name !== myName)
      .filter((s) => blob.includes(s.name))
      .map((s) => s.name);
    deepEqual(leakedNames.slice(0, 5), [],
      `Another pupil's name appears in the portal payload: ${leakedNames.slice(0, 5).join(', ')}`);
  });

  it('the rendered page carries no other pupil’s name either', async () => {
    const dom = await openPage(`portal.html?token=${LIVE}`, { readySelector: 'body[data-ready]' });
    const win = dom.window;
    const D = storeOf(win);
    const mine = win.document.body.getAttribute('data-student');
    const myName = D.students.filter((s) => s.id === mine)[0].name;
    const text = win.document.body.textContent;
    dom.window.close();
    const leaked = D.students
      .filter((s) => s.id !== mine && s.name !== myName)
      .filter((s) => text.includes(s.name))
      .map((s) => s.name);
    deepEqual(leaked.slice(0, 5), [], `Other pupils named on the portal page: ${leaked.slice(0, 5).join(', ')}`);
  });

  it('only published cards and verified marks appear on the portal', async () => {
    const dom = await openPage(`portal.html?token=${LIVE}`, { readySelector: 'body[data-ready]' });
    const win = dom.window;
    const D = storeOf(win);
    const v = await win.ShuleAPI.getGuardianPortal(LIVE, {});
    const mine = v.student.id;
    dom.window.close();

    const publishedExams = D.report_cards
      .filter((c) => c.student_id === mine && c.status === 'published')
      .map((c) => c.exam_id);
    const shownExams = v.results.map((c) => c.exam_name);
    assert.equal(v.results.length, publishedExams.length,
      `The portal shows ${v.results.length} cards but ${publishedExams.length} are published. Shown: ${shownExams.join(', ')}`);

    const problems = [];
    v.results.forEach((c) => {
      c.subjects.forEach((s) => {
        const stored = D.exam_results.filter((r) => r.student_id === mine &&
          r.grade === s.grade && r.score === s.score)[0];
        if (stored && !stored.verified) problems.push(`${s.subject_name} is unverified but shown`);
      });
    });
    deepEqual(problems, [], `Unverified marks on the portal:\n  ${problems.join('\n  ')}`);
  });

  it('an expired token returns the expiry state and no data', async () => {
    const dom = await openPage(`portal.html?token=${EXPIRED}`, { readySelector: 'body[data-ready]' });
    const win = dom.window;
    const v = await win.ShuleAPI.getGuardianPortal(EXPIRED, {});
    const state = win.document.body.getAttribute('data-token-state');
    const shown = !$(win, '[data-region="content"]').hidden;
    const closed = !$(win, '[data-region="closed"]').hidden;
    const text = win.document.body.textContent;
    const D = storeOf(win);
    const row = D.guardian_tokens.filter((t) => t.token === EXPIRED)[0];
    const pupil = D.students.filter((s) => s.id === row.student_id)[0];
    dom.window.close();

    assert.equal(v.state, 'expired', `An expired token resolved to "${v.state}".`);
    for (const key of ['student', 'fees', 'attendance', 'results', 'school', 'guardian']) {
      assert.equal(v[key], undefined,
        `The expired response carries "${key}". An expired link must return a state and nothing else.`);
    }
    assert.equal(state, 'expired', `The page reported data-token-state="${state}".`);
    assert.ok(!shown, 'The open state is showing for an expired token.');
    assert.ok(closed, 'The closed state is not showing for an expired token.');
    assert.ok(!text.includes(pupil.name),
      `The expired page names the pupil (${pupil.name}). It must show no pupil information at all.`);
    assert.ok(/expired/i.test(text), 'The expired page does not tell the reader the link expired.');
  });

  it('a revoked token returns the revoked state and no data', async () => {
    const dom = await openPage(`portal.html?token=${REVOKED}`, { readySelector: 'body[data-ready]' });
    const win = dom.window;
    const v = await win.ShuleAPI.getGuardianPortal(REVOKED, {});
    const text = win.document.body.textContent;
    const D = storeOf(win);
    const pupil = D.students.filter((s) =>
      s.id === D.guardian_tokens.filter((t) => t.token === REVOKED)[0].student_id)[0];
    dom.window.close();
    assert.equal(v.state, 'revoked', `A revoked token resolved to "${v.state}".`);
    assert.equal(v.student, undefined, 'The revoked response carries a student.');
    assert.ok(!text.includes(pupil.name), `The revoked page names the pupil (${pupil.name}).`);
  });

  it('an unknown or missing token returns the unknown state and no data', async () => {
    for (const token of ['not-a-real-token', '']) {
      const url = token ? `portal.html?token=${token}` : 'portal.html';
      const dom = await openPage(url, { readySelector: 'body[data-ready]' });
      const win = dom.window;
      const v = await win.ShuleAPI.getGuardianPortal(token || null, {});
      const state = win.document.body.getAttribute('data-token-state');
      const closed = !$(win, '[data-region="closed"]').hidden;
      dom.window.close();
      assert.equal(v.state, 'unknown', `Token "${token}" resolved to "${v.state}".`);
      assert.equal(v.student, undefined, `The response for "${token}" carries a student.`);
      assert.equal(state, 'unknown', `The page reported "${state}" for token "${token}".`);
      assert.ok(closed, `The closed state is not showing for token "${token}".`);
    }
  });

  it('a token cannot be made to resolve to a different student', async () => {
    const dom = await openPage(`portal.html?token=${LIVE}`, { readySelector: 'body[data-ready]' });
    const win = dom.window;
    const D = storeOf(win);
    const tokens = D.guardian_tokens.filter((t) => !t.revoked && t.expires_at >= D.today);
    assert.ok(tokens.length >= 2, 'Fewer than two live tokens, so cross-resolution cannot be tested.');
    const seen = {};
    for (const t of tokens) {
      const v = await win.ShuleAPI.getGuardianPortal(t.token, {});
      assert.equal(v.state, 'ok', `Live token ${t.token} resolved to "${v.state}".`);
      assert.equal(v.student.id, t.student_id,
        `Token ${t.token} points at ${t.student_id} but resolved to ${v.student.id}.`);
      assert.ok(!seen[v.student.id] || seen[v.student.id] === t.token,
        `Two different tokens both resolved to ${v.student.id}.`);
      seen[v.student.id] = t.token;
    }
    dom.window.close();
  });

  it('issuing a link creates a token for that pupil and nobody else', async () => {
    const dom = await openPage('app/students.html');
    const win = dom.window;
    const D = storeOf(win);
    const student = D.students[5];
    const before = D.guardian_tokens.length;

    const t = await win.ShuleAPI.issueGuardianToken('sch-riverside', student.id, { days: 30 });
    const after = storeOf(win).guardian_tokens;
    const v = await win.ShuleAPI.getGuardianPortal(t.token, {});
    checkInvariants(win, 'issuing a guardian token');
    dom.window.close();

    assert.equal(after.length, before + 1, `Issuing created ${after.length - before} tokens.`);
    assert.equal(t.student_id, student.id, `The token was issued against ${t.student_id}, not ${student.id}.`);
    assert.equal(v.state, 'ok', `A freshly issued token resolved to "${v.state}".`);
    assert.equal(v.student.id, student.id, `The new token resolved to ${v.student.id}.`);
    assert.ok(t.expires_at > D.today, `The new token expires on ${t.expires_at}, which is not in the future.`);
  });

  it('a link cannot be issued to a guardian on another pupil’s record', async () => {
    const dom = await openPage('app/students.html');
    const win = dom.window;
    const D = storeOf(win);
    const student = D.students[7];
    const foreign = D.guardians.filter((g) => g.student_id !== student.id)[0];
    const before = D.guardian_tokens.length;

    let err = null;
    await win.ShuleAPI.issueGuardianToken('sch-riverside', student.id, { guardianId: foreign.id })
      .catch((e) => { err = e; });
    const after = storeOf(win).guardian_tokens.length;
    dom.window.close();
    assert.ok(err, 'A link was issued to a guardian who is not on that pupil’s record.');
    assert.equal(after, before, 'The refused issue still created a token.');
  });

  it('an expiry beyond 180 days is refused', async () => {
    const dom = await openPage('app/students.html');
    const win = dom.window;
    let err = null;
    await win.ShuleAPI.issueGuardianToken('sch-riverside', storeOf(win).students[9].id, { days: 3650 })
      .catch((e) => { err = e; });
    dom.window.close();
    assert.ok(err, 'A ten-year portal link was issued.');
    assert.ok(/1 and 180/.test(err.message), `The refusal reads "${err.message}".`);
  });
});

describe('Teacher and parent pages render inside their scope', () => {
  const TEACHER_PAGES = ['app/teacher/dashboard.html', 'app/teacher/register.html',
                         'app/teacher/marks.html', 'app/teacher/timetable.html'];
  const PARENT_PAGES = ['app/parent/index.html', 'app/parent/fees.html',
                        'app/parent/attendance.html', 'app/parent/results.html',
                        'app/parent/messages.html'];

  for (const page of TEACHER_PAGES) {
    it(`${page} loads and resolves every panel`, async () => {
      const errors = [];
      const dom = await openPage(page, { role: 'teacher', onConsoleError: (a) => errors.push(a) });
      const win = dom.window;
      const stuck = $$(win, '[data-panel]')
        .filter((p) => !['content', 'empty'].includes(p.getAttribute('data-state')))
        .map((p) => p.getAttribute('data-panel'));
      const role = win.document.body.getAttribute('data-role');
      const nav = $(win, '#sidenav').getAttribute('data-nav-role');
      dom.window.close();
      deepEqual(stuck, [], `${page} left these panels loading: ${stuck.join(', ')}`);
      assert.equal(role, 'teacher', `${page} rendered as role "${role}".`);
      assert.equal(nav, 'teacher', `${page} stamped the "${nav}" nav.`);
      deepEqual(errors, [], `${page} logged errors:\n  ${errors.join('\n  ')}`);
    });
  }

  for (const page of PARENT_PAGES) {
    it(`${page} loads and resolves every panel`, async () => {
      const errors = [];
      const dom = await openPage(page, { role: 'parent', onConsoleError: (a) => errors.push(a) });
      const win = dom.window;
      const stuck = $$(win, '[data-panel]')
        .filter((p) => !['content', 'empty'].includes(p.getAttribute('data-state')))
        .map((p) => p.getAttribute('data-panel'));
      const children = $$(win, '#childbar [data-child]').length;
      dom.window.close();
      deepEqual(stuck, [], `${page} left these panels loading: ${stuck.join(', ')}`);
      assert.ok(children > 0, `${page} rendered no child switcher.`);
    });
  }

  it('a teacher opening an admin page gets the teacher nav', async () => {
    const dom = await openPage('app/dashboard.html', { role: 'teacher' });
    const win = dom.window;
    const groups = $$(win, '.side .navg[data-group]').map((g) => g.getAttribute('data-group'));
    const expected = win.ShuleShell.ROLE_NAV.teacher.map((g) => g.group);
    dom.window.close();
    deepEqual(groups, expected,
      `A teacher on an admin page sees [${groups.join(', ')}]; navigation follows who you are, not which page you opened.`);
  });

  it('an admin opening a teacher page gets the admin nav', async () => {
    const dom = await openPage('app/teacher/dashboard.html', { role: 'admin' });
    const win = dom.window;
    const groups = $$(win, '.side .navg[data-group]').map((g) => g.getAttribute('data-group'));
    const expected = win.ShuleShell.ROLE_NAV.admin.map((g) => g.group);
    dom.window.close();
    deepEqual(groups, expected, `An admin on a teacher page sees [${groups.join(', ')}].`);
  });
});
