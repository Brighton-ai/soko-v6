/**
 * E27 — the authoritative count of every suite, from the runner itself.
 *
 *     node tools/counts.mjs
 *
 * Source `it(` calls and runtime tests are different numbers: a single `it(`
 * inside `for (const page of PAGES)` becomes one test per page. Earlier reports
 * mixed the two. The runner's own tally is the only figure that means anything,
 * and this is the one command that prints it.
 */
import { execFileSync } from 'node:child_process';

const SUITES = [
  ['app',      ['--test', 'test/static.test.js', 'test/app.test.js'], {}],
  ['contract', ['--test', 'test/contract/fees.contract.test.js',
                'test/contract/academics.contract.test.js',
                'test/contract/access.contract.test.js'], { SHULE_BACKEND: 'demo' }]
];

const rows = [];
for (const [name, args, env] of SUITES) {
  let out = '';
  try {
    out = execFileSync('node', args, {
      encoding: 'utf8', env: { ...process.env, ...env },
      maxBuffer: 64 * 1024 * 1024, timeout: 600000
    });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const g = (k) => Number((out.match(new RegExp(`^ℹ ${k} (\\d+)$`, 'm')) || [, '0'])[1]);
  rows.push({ suite: name, tests: g('tests'), suites: g('suites'), pass: g('pass'), fail: g('fail') });
}

const w = (s, n) => String(s).padEnd(n);
console.log('\n┌─────────────────────────────────────────────────────┐');
console.log('│  Shule — authoritative test counts (E27)             │');
console.log('├──────────────┬────────┬────────┬────────┬───────────┤');
console.log('│ suite        │  tests │ suites │   pass │      fail │');
console.log('├──────────────┼────────┼────────┼────────┼───────────┤');
for (const r of rows) {
  console.log(`│ ${w(r.suite, 12)} │ ${String(r.tests).padStart(6)} │ ${String(r.suites).padStart(6)} │ ` +
              `${String(r.pass).padStart(6)} │ ${String(r.fail).padStart(9)} │`);
}
const t = rows.reduce((a, r) => ({ tests: a.tests + r.tests, suites: a.suites + r.suites,
                                   pass: a.pass + r.pass, fail: a.fail + r.fail }),
                      { tests: 0, suites: 0, pass: 0, fail: 0 });
console.log('├──────────────┼────────┼────────┼────────┼───────────┤');
console.log(`│ ${w('TOTAL', 12)} │ ${String(t.tests).padStart(6)} │ ${String(t.suites).padStart(6)} │ ` +
            `${String(t.pass).padStart(6)} │ ${String(t.fail).padStart(9)} │`);
console.log('└──────────────┴────────┴────────┴────────┴───────────┘');
console.log('\nRuntime tests, as counted by node:test. Not source `it(` calls —');
console.log('a loop over N pages turns one `it(` into N tests.');

// ── rule verdicts, parsed from the table in RULES_RECONCILED.md ───────────
import fs from 'node:fs';
const md = fs.readFileSync('docs/RULES_RECONCILED.md', 'utf8');
const ruleRows = md.split('\n').filter((l) => /^\| \d+ \|/.test(l));
const verdicts = {};
for (const l of ruleRows) {
  const m = [...l.matchAll(/\*\*(backend has it|backend gap|modelled differently|frontend-only by design|unknown)\*\*/g)];
  const v = m.length ? m[m.length - 1][1] : 'UNPARSED';
  verdicts[v] = (verdicts[v] || 0) + 1;
}
console.log('\n┌─────────────────────────────────────────────────────┐');
console.log('│  Rule verdicts (docs/RULES_RECONCILED.md)            │');
console.log('├───────────────────────────────┬─────────────────────┤');
for (const [k, v] of Object.entries(verdicts).sort((a, b) => b[1] - a[1])) {
  console.log(`│ ${w(k, 29)} │ ${String(v).padStart(19)} │`);
}
console.log('├───────────────────────────────┼─────────────────────┤');
console.log(`│ ${w('rule rows', 29)} │ ${String(ruleRows.length).padStart(19)} │`);
const demoOnly = (verdicts['backend gap'] || 0) + (verdicts['modelled differently'] || 0);
console.log(`│ ${w('enforced by the demo alone', 29)} │ ${String(demoOnly).padStart(19)} │`);
console.log('└───────────────────────────────┴─────────────────────┘');
console.log('\n"Backend gap" = no counterpart at all. "Modelled differently" = both');
console.log('enforce something, by different mechanics. Both mean a rule that');
console.log('disappears at cutover unless the backend is changed.\n');

process.exit(t.fail > 0 ? 1 : 0);
