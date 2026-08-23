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

  it('balance equals amount_due minus amount_paid on every invoice', () => {
    const bad = D.invoices
      .filter((i) => i.balance !== i.amount_due - i.amount_paid)
      .map((i) => `${i.id}: due ${i.amount_due} − paid ${i.amount_paid} = ${i.amount_due - i.amount_paid}, but balance says ${i.balance}`);
    deepEqual(bad, [], `Invoice arithmetic does not hold:\n  ${bad.slice(0, 10).join('\n  ')}`);
  });

  it('invoice status agrees with the money, and paid invoices carry an M-Pesa code', () => {
    const bad = [];
    for (const i of D.invoices) {
      const expected = i.amount_paid === 0 ? 'unpaid' : i.balance === 0 ? 'cleared' : 'part_paid';
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

  it('two exams exist, one with results, some rows unverified', () => {
    const exams = D.exams.filter((e) => e.term_id === D.current_term_id);
    assert.equal(exams.length, 2, `There are ${exams.length} exams this term, expected 2.`);
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
    const today = D.attendance.filter((a) => a.date === D.today);
    const here = today.filter((a) => a.status === 'present' || a.status === 'late').length;
    return {
      enrolment: D.students.filter((s) => s.status === 'active').length,
      rate: invoiced ? collected / invoiced * 100 : 0,
      outstanding: invoiced - collected,
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

  D.invoices.forEach((i) => {
    if (i.balance !== i.amount_due - i.amount_paid) {
      problems.push(`invoice ${i.id}: due ${i.amount_due} − paid ${i.amount_paid} = ${i.amount_due - i.amount_paid}, but balance says ${i.balance}`);
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
    const before = { due: invBefore.amount_due, balance: invBefore.balance };
    const journalBefore = storeOf(win).journal_lines.length;

    const first = await API.approveWaiver('sch-riverside', waiver.id, {});
    checkInvariants(win, 'approving a waiver');

    assert.equal(first.applied, true, 'The first approval reported applied: false.');
    assert.equal(first.invoice.amount_due, before.due - waiver.amount,
      `amount_due went from ${before.due} to ${first.invoice.amount_due}; a waiver of ${waiver.amount} should leave ${before.due - waiver.amount}.`);
    assert.equal(first.invoice.balance, before.balance - waiver.amount,
      `The balance went from ${before.balance} to ${first.invoice.balance}, expected ${before.balance - waiver.amount}.`);
    assert.equal(storeOf(win).journal_lines.length, journalBefore + 2,
      'Approving a waiver did not post a balanced pair of journal lines.');

    const afterFirst = {
      due: first.invoice.amount_due, balance: first.invoice.balance,
      journal: storeOf(win).journal_lines.length
    };

    const second = await API.approveWaiver('sch-riverside', waiver.id, {});
    checkInvariants(win, 'approving the same waiver twice');
    const invNow = storeOf(win).invoices.filter((i) => i.id === invBefore.id)[0];
    dom.window.close();

    assert.equal(second.already, true, 'The second approval did not report the waiver as already applied.');
    assert.equal(second.applied, false, 'The second approval claimed to apply the waiver again.');
    assert.equal(invNow.amount_due, afterFirst.due,
      `Approving twice deducted twice: amount_due is ${invNow.amount_due}, expected ${afterFirst.due}.`);
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
