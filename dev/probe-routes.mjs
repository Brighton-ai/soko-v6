/**
 * Call every GET route in the Shule surface and report what comes back.
 *
 * GET only, by default. A GET that 500s is a fault with no ambiguity: nothing
 * was asked to change, so there is no valid reason for the server to fail.
 * POST/PUT/DELETE need real bodies and have side effects, so they are exercised
 * by the contract suite and the gate probes instead of swept blindly.
 *
 *   node dev/probe-routes.mjs                 # GET sweep
 *   node dev/probe-routes.mjs --json          # machine readable
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run from anywhere: these tools are called from both repos.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const API   = process.env.SHULE_API_URL || 'http://localhost:8000/api';
const seed  = JSON.parse(fs.readFileSync('dev/seed-live.json', 'utf8'));
const PW    = process.env.SEED_PASSWORD || 'ContractTest!2026-local-only';
const JSON_OUT = process.argv.includes('--json');

const routes = JSON.parse(execFileSync('python3', ['dev/routes.py', '--json'], {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
}));

async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW })
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.access_token || j.data?.access_token || null;
}

const TOKEN = await login(seed.email);
if (!TOKEN) { console.error('could not log in; run node dev/seed-live.mjs'); process.exit(2); }
const H = { authorization: `Bearer ${TOKEN}`, accept: 'application/json' };

// Real ids, so a route is exercised rather than 404'd on a made-up one.
async function discover() {
  const get = async (p) => {
    try {
      const r = await fetch(API + p, { headers: H });
      if (!r.ok) return null;
      const j = await r.json();
      return j?.items || j?.data || j;
    } catch { return null; }
  };
  const S = seed.school_id;
  const [students, classes, subjects, invoices, exams, cards, waivers, terms] = await Promise.all([
    get(`/school/${S}/students?per_page=5`), get(`/school/${S}/classes`),
    get(`/school/${S}/subjects`), get(`/school/fee-invoices?school_id=${S}&per_page=5`),
    get(`/school/exams?school_id=${S}`), get(`/school/report-cards?school_id=${S}`),
    get(`/school/fee-waivers?school_id=${S}`), get(`/school/terms?school_id=${S}`)
  ]);
  const one = (v) => (Array.isArray(v) ? v[0] : v?.items?.[0]) || null;
  return {
    school_id: S, id: one(students)?.id, student_id: one(students)?.id,
    class_id: one(classes)?.id, subject_id: one(subjects)?.id,
    invoice_id: one(invoices)?.id, exam_id: seed.exam_id || one(exams)?.id,
    term_id: seed.term_id || one(terms)?.id,
    scale_id: seed.scale_id, waiver_id: one(waivers)?.id,
    token: seed.portal_token, user_id: seed.hod_id,
    tenant_id: seed.tenant_id, report_card_id: one(cards)?.id,
    branch_id: null, role_id: null, notification_id: null, provider: 'mpesa',
    key_id: null, module_slug: 'school', plan_id: null, date: '2026-06-22'
  };
}
const F = await discover();

/**
 * A bare `{id}` means something different on every route, so it is resolved by
 * what the handler is about rather than by its name. Passing a pupil's id where
 * a report card's is wanted gives a 404 that looks like a missing route.
 */
const BY_FUNC = {
  get_report_card: 'report_card_id', report_card_pdf_data: 'report_card_id',
  publish_report_card: 'report_card_id',
  check_grading_scale: 'scale_id', list_grading_bands: 'scale_id',
  add_grading_band: 'scale_id',
  get_transaction: 'mpesa_transaction_id',
  fee_receipt_html: 'invoice_id', pay_fee_invoice: 'invoice_id',
  get_student: 'student_id', list_exam_results: 'exam_id',
  get_class_analysis: 'exam_id', bulk_enter_results: 'exam_id',
  verify_exam_results: 'exam_id',
};

const fill = (path, params, func) => {
  let out = path, missing = [];
  for (const p of params) {
    const key = (p === 'id' && BY_FUNC[func]) || p;
    const v = F[key] ?? F[p] ?? F[p.replace(/_id$/, '')] ?? null;
    if (v == null) missing.push(key);
    out = out.replace(`{${p}}`, encodeURIComponent(v ?? '00000000-0000-0000-0000-000000000000'));
  }
  return { out, missing };
};

const results = [];
for (const r of routes.filter((x) => x.method === 'GET')) {
  const { out, missing } = fill(r.path, r.path_params, r.func);
  const q = new URLSearchParams();
  for (const k of [...r.required_query, ...r.optional_query]) {
    const v = F[k] ?? F[k.replace(/_id$/, '')];
    if (v != null) q.set(k, v);
  }
  const url = API.replace(/\/api$/, '') + out + (q.toString() ? `?${q}` : '');
  let status = 0, body = '';
  try {
    const res = await fetch(url, { headers: H });
    status = res.status;
    body = (await res.text()).slice(0, 200);
  } catch (e) {
    status = -1; body = String(e.message).slice(0, 120);
  }
  results.push({ ...r, url: out, status, missing, body });
}

if (JSON_OUT) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

const bucket = (r) => {
  // 501 is an answer, not a failure: the route exists and is telling you the
  // thing behind it is not configured. Counting it as a fault would mean the
  // audit could never reach zero on a deployment that does not use every
  // optional integration.
  if (r.status === 501) return 'NOT CONFIGURED';
  if (r.status >= 500 || r.status === -1) return 'FAULT';
  if (r.status === 404 && r.missing.length) return 'NO FIXTURE';
  if (r.status === 404) return 'NOT FOUND';
  if (r.status === 422) return 'BAD PARAMS';
  if (r.status === 402) return 'PAYWALLED';
  if (r.status === 403 || r.status === 401) return 'DENIED';
  if (r.status < 300) return 'OK';
  return 'OTHER ' + r.status;
};
const groups = {};
for (const r of results) (groups[bucket(r)] ||= []).push(r);

for (const k of ['FAULT', 'BAD PARAMS', 'NOT FOUND', 'NOT CONFIGURED', 'OTHER', 'PAYWALLED', 'DENIED', 'NO FIXTURE', 'OK']) {
  const g = Object.entries(groups).filter(([n]) => n.startsWith(k)).flatMap(([, v]) => v);
  if (!g.length) continue;
  console.log(`\n${'═'.repeat(78)}\n${k}  (${g.length})\n${'═'.repeat(78)}`);
  if (k === 'OK') { console.log('  ' + g.map((r) => r.url).join('\n  ')); continue; }
  for (const r of g) {
    console.log(`\n  ${r.status}  GET ${r.url}`);
    console.log(`       ${r.file}:${r.func}`);
    if (r.missing.length) console.log(`       no fixture for: ${r.missing.join(', ')}`);
    if (r.body) console.log(`       ${r.body.replace(/\s+/g, ' ').slice(0, 150)}`);
  }
}
const counts = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]));
console.log(`\n\n${JSON.stringify(counts)}`);
console.log(`GET routes probed: ${results.length}`);
