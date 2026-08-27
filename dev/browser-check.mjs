/**
 * The real browser path: load a page in jsdom in LIVE mode, sign in through
 * the login form, and see whether the app renders a school's actual data.
 *
 * This has never been tested. The contract suite proves the rules; it uses the
 * adapter directly and never loads a page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = process.env.SHULE_CHECK_DIR || process.cwd();
const seed = JSON.parse(fs.readFileSync('dev/seed-live.json', 'utf8'));
// Point at whatever is being checked: the API directly, or a deployed site
// serving the same origin through its proxy — which is what production is.
const API  = process.env.SHULE_CHECK_API || 'http://localhost:8000/api';
const SITE = process.env.SHULE_CHECK_SITE || null;

function open(relPath, extra = {}) {
  const file = path.join(ROOT, relPath);
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => console.log('   [page error]', String(e.message).slice(0, 160)));
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), {
    url: (SITE || 'https://school.example') + '/' + relPath,
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc
  });
  const win = dom.window;
  // Node's fetch throws "Illegal invocation" if it is called as a property of
  // something other than its own global, which is exactly how the adapter
  // calls it (global.fetch(...)). Bound, so the page behaves as in a browser.
  win.fetch = (...a) => fetch(...a).catch((e) => {
    console.log('   [fetch failed]', e.message, e.cause ? '· ' + e.cause.message : '');
    throw e;
  });
  win.Headers = Headers; win.Request = Request; win.Response = Response;
  // jsdom's AbortController produces a signal Node's fetch will not accept, and
  // the adapter aborts every request on a timeout. Without this, every call
  // fails with "Expected signal to be an instance of AbortSignal" — which the
  // adapter reports as being offline, and which reads as a passing test when
  // the assertion is only that something was refused.
  win.AbortController = AbortController;
  win.AbortSignal = AbortSignal;
  // jsdom does not implement matchMedia, and site.js asks about reduced motion.
  if (!win.matchMedia) {
    win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {},
                              addListener() {}, removeListener() {} });
  }
  win.SHULE_API_BASE = API;          // the deployment would stamp this
  Object.assign(win, extra);
  const dir = path.dirname(file);
  for (const s of [...win.document.querySelectorAll('script[src]')].map((x) => x.getAttribute('src'))) {
    const f = path.resolve(dir, s);
    if (!fs.existsSync(f)) throw new Error(`${relPath} references ${s}, missing at ${f}`);
    win.eval(fs.readFileSync(f, 'utf8'));
  }
  win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
  return win;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('═══ the login page, in live mode ═══');
const login = open('login.html');
console.log('   mode:', login.SHULE_CONFIG.mode, '| api:', login.SHULE_CONFIG.apiBase);
if (login.SHULE_CONFIG.mode !== 'live') { console.log('   ✘ page did not resolve to live'); process.exit(1); }

console.log('\n── a wrong password must be refused ──');
let err = null;
await login.ShuleAPI.login(seed.email, 'not-the-password').catch((e) => { err = e; });
console.log(err ? `   ✔ refused: ${err.status} ${err.message}` : '   ✘ A WRONG PASSWORD SIGNED IN');

console.log('\n── the real password ──');
const res = await login.ShuleAPI.login(seed.email, process.env.SEED_PASSWORD || 'ContractTest!2026-local-only');
console.log(`   ✔ signed in as ${res.user.full_name} (${res.user.email})`);
const jwt = login.localStorage.getItem('shule.jwt');
console.log(`   ✔ session stored: ${jwt ? jwt.slice(0, 22) + '…' : 'NOTHING'}`);

console.log('\n═══ the dashboard, with that session ═══');
const w = open('app/dashboard.html');
w.localStorage.setItem('shule.jwt', jwt);
w.localStorage.setItem('shule.refresh', login.localStorage.getItem('shule.refresh') || '');
w.localStorage.setItem('shule.role', 'admin');

const me = await w.ShuleAPI.getMe().catch((e) => ({ error: e.message }));
console.log('   getMe →', me.error ? '✘ ' + me.error : `✔ ${me.full_name || me.email} · tenant ${String(me.tenant_id).slice(0,8)}`);
const students = await w.ShuleAPI.listStudents(seed.school_id, { pageSize: 5 }).catch((e) => ({ error: e.message }));
console.log('   listStudents →', students.error ? '✘ ' + students.error
  : `✔ ${(students.items || []).length} pupils: ${(students.items||[]).slice(0,3).map(s=>s.full_name).join(', ')}`);
const summary = await w.ShuleAPI.getDashboardSummary(seed.school_id, {}).catch((e) => ({ error: e.message }));
console.log('   dashboard →', summary.error ? '✘ ' + summary.error
  : `✔ ${summary.enrolment?.value} enrolled · ${summary.outstanding?.value} outstanding`);
