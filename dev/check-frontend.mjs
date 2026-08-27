/**
 * The frontend, checked end to end.
 *
 *  1. Every function api.js exports exists in BOTH backends. A page calling
 *     one the live adapter forgot is a blank screen in production and a green
 *     test suite against the demo.
 *  2. Every ShuleAPI.x a page calls is exported by api.js.
 *  3. Every <script src> and <link href> a page names is a file that exists.
 *  4. Every internal href points at a page that exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const read = (p) => fs.readFileSync(p, 'utf8');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const files = walk('.').map((p) => p.replace(/^\.\//, ''));
const pages = files.filter((f) => f.endsWith('.html'));
const problems = [];
const note = (kind, where, msg) => problems.push({ kind, where, msg });

// ── 1. api.js surface vs the two backends ─────────────────────────────────
const apiSrc  = read('assets/js/api.js');
const demoSrc = read('assets/js/demo-backend.js');
const liveSrc = read('assets/js/live-backend.js');

// Both shapes api.js uses: `name: name,` and `name: function () {...}`.
// Matching only the first missed every inline export and reported them as
// calls to something that does not exist.
const exported = [
  ...apiSrc.matchAll(/^\s{4}(\w+):\s*(?:\w+|function|async)\b/gm)
].map((m) => m[1]);
const uniqueExports = [...new Set(exported)];

const demoHas = (n) =>
  new RegExp(`\\b${n}\\s*:\\s*\\w|function\\s+${n}\\s*\\(`).test(demoSrc);
const liveHas = (n) =>
  new RegExp(`B\\.${n}\\s*=`).test(liveSrc);
// A stub that rejects with 501 is present but not implemented — that is a
// missing backend route, not a missing adapter function, and it is counted
// separately so the two are never confused.
const liveStub = (n) =>
  new RegExp(`B\\.${n}\\s*=\\s*notInBackend`).test(liveSrc);
// Constants are not functions and neither backend has to carry both.
// Constants are not functions, and neither is a helper api.js answers itself
// rather than passing to a backend.
const API_LOCAL = new Set(['mode']);
const isFn = (n) => !/^[A-Z0-9_]+$/.test(n) && !API_LOCAL.has(n);

const fns = uniqueExports.filter(isFn);
const missingLive = fns.filter((n) => !liveHas(n) && demoHas(n));
const missingDemo = fns.filter((n) => !demoHas(n) && liveHas(n));
const stubbed = fns.filter(liveStub);
missingLive.forEach((n) => note('backend gap', 'live-backend.js', `${n}() exists in the demo and not in the live adapter`));
missingDemo.forEach((n) => note('backend gap', 'demo-backend.js', `${n}() exists in the live adapter and not in the demo`));

// ── 2. what the pages call ────────────────────────────────────────────────
const jsFiles = files.filter((f) => f.endsWith('.js') && !f.includes('api.js')
  && !f.includes('demo-backend') && !f.includes('live-backend') && !f.includes('/data/'));
const called = new Map();
for (const f of [...jsFiles, ...pages]) {
  const src = read(f);
  for (const m of src.matchAll(/\bShuleAPI\.(\w+)\s*\(/g)) {
    if (!called.has(m[1])) called.set(m[1], new Set());
    called.get(m[1]).add(f);
  }
}
for (const [name, where] of called) {
  if (!uniqueExports.includes(name)) {
    note('undefined call', [...where][0], `ShuleAPI.${name}() is called but api.js does not export it`);
  }
}

// ── 3 & 4. assets and links a page names ──────────────────────────────────
const exists = (p) => fs.existsSync(p);
for (const page of pages) {
  const src = read(page);
  const dir = path.dirname(page);
  for (const m of src.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)=["']([^"']+)["']/g)) {
    const ref = m[1];
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:') || ref.startsWith('#')) continue;
    const target = path.normalize(path.join(dir, ref.split('?')[0]));
    if (!exists(target)) note('missing asset', page, `${ref} → ${target} does not exist`);
  }
  for (const m of src.matchAll(/<a[^>]*\shref=["']([^"']+)["']/g)) {
    const ref = m[1];
    if (/^(https?:|mailto:|tel:)/.test(ref) || ref.startsWith('#') || ref === '') continue;
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) continue;
    const target = path.normalize(path.join(dir, clean));
    if (!exists(target) && !exists(target + '.html') && !exists(path.join(target, 'index.html'))) {
      note('broken link', page, `${ref} → ${target} does not exist`);
    }
  }
}

// ── report ────────────────────────────────────────────────────────────────
console.log(`pages ${pages.length} · api.js exports ${uniqueExports.length} ` +
            `(${fns.length} functions) · ShuleAPI calls found ${called.size}`);
console.log(`live adapter: ${fns.length - stubbed.length} implemented, ` +
            `${stubbed.length} awaiting a backend route`);
if (stubbed.length) {
  console.log('\n  awaiting a route in school.py:');
  console.log('    ' + stubbed.join('\n    '));
}
if (!problems.length) { console.log('\nNothing dangling.'); process.exit(0); }

const byKind = {};
for (const p of problems) (byKind[p.kind] ||= []).push(p);
for (const kind of Object.keys(byKind)) {
  console.log(`\n${'═'.repeat(74)}\n${kind.toUpperCase()}  (${byKind[kind].length})\n${'═'.repeat(74)}`);
  for (const p of byKind[kind]) console.log(`  ${p.where}\n      ${p.msg}`);
}
console.log(`\n${problems.length} problem(s).`);
process.exit(1);
