/**
 * Shule — seed a contract-test tenant into a running SokoOS backend.
 *
 *     node dev/seed-live.mjs
 *
 * Two rules:
 *   1. Anything with an API route is created through the API. Direct SQL only
 *      for what has none — the tenant, the role and the user. Seeding by SQL
 *      what the API could have created would test our SQL, not their endpoints.
 *   2. Idempotent. Everything hangs off one tenant named `shule-contract-test`
 *      and re-running adopts what is already there rather than duplicating.
 *
 * Prints a JSON block at the end with the ids and the JWT the contract suite
 * needs.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.SHULE_API_URL || 'http://localhost:8000/api';
const DB = process.env.DATABASE_URL || 'postgresql://shule@127.0.0.1:55432/sokoos';
const PSQL = process.env.PSQL || '/usr/lib/postgresql/18/bin/psql';

const TENANT = 'shule-contract-test';
const EMAIL = process.env.SEED_EMAIL || 'contract@shule.test';
/*
 * Overridable, and it should be overridden anywhere the backend is reachable
 * from outside the machine. The default exists so the script runs out of the
 * box against a throwaway local database; it creates an is_super_admin user,
 * so a known default password on a reachable host is a real account.
 */
const PASSWORD = process.env.SEED_PASSWORD || 'ContractTest!2026-local-only';
const YEAR = '2026';
const TERM = 2;

const log = (...a) => console.log('  ', ...a);

// ── SQL, only where no route exists ───────────────────────────────────────
function sql(query) {
  const out = execFileSync(PSQL, [DB, '-t', '-A', '-F', '\t', '-c', query], { encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
}

/**
 * Hashed by the backend's OWN hash_password (shared.py:32), run in its venv.
 * Anything else risks a hash their verify_password will not accept — passlib
 * and bcrypt 5.x disagree, and the backend uses bcrypt directly.
 */
const BACKEND_DIR = process.env.BACKEND_DIR || '/home/nova/Desktop/soko-V4.2-main/backend';
function bcryptHash(plain) {
  return execFileSync(path.join(BACKEND_DIR, '.venv/bin/python'), ['-c',
    `import sys; sys.path.insert(0, ${JSON.stringify(BACKEND_DIR)});` +
    `from shared import hash_password; print(hash_password(${JSON.stringify(plain)}))`
  ], { encoding: 'utf8', cwd: BACKEND_DIR }).trim();
}

// ── API ───────────────────────────────────────────────────────────────────
let TOKEN = null;
const seen = [];

async function call(method, route, body) {
  const res = await fetch(API + route, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' },
      TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }
  seen.push({ method, route, status: res.status });
  if (!res.ok) {
    const err = new Error(`${method} ${route} → ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json && Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json;
}
const GET = (r) => call('GET', r);
const POST = (r, b) => call('POST', r, b);

// ══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n── tenant, role and user (SQL — no routes exist for these) ──');

  let [tenant] = sql(`SELECT id FROM tenants WHERE name = '${TENANT}'`);
  if (!tenant) {
    [tenant] = sql(`INSERT INTO tenants (name, email) VALUES ('${TENANT}', '${EMAIL}') RETURNING id`);
    log('tenant created', tenant[0]);
  } else {
    log('tenant adopted', tenant[0]);
  }
  const tenantId = tenant[0];

  let [role] = sql(`SELECT id FROM roles WHERE tenant_id='${tenantId}' AND name='admin'`);
  if (!role) {
    [role] = sql(`INSERT INTO roles (tenant_id, name, permissions)
                  VALUES ('${tenantId}', 'admin', '["*"]'::jsonb) RETURNING id`);
    log('role created', role[0]);
  } else {
    log('role adopted', role[0]);
  }

  let [user] = sql(`SELECT id FROM users WHERE email='${EMAIL}'`);
  if (!user) {
    const hash = bcryptHash(PASSWORD).replace(/'/g, "''");
    [user] = sql(`INSERT INTO users (tenant_id, role_id, email, password_hash, full_name,
                                     is_active, is_super_admin)
                  VALUES ('${tenantId}', '${role[0]}', '${EMAIL}', '${hash}',
                          'Contract Test Admin', TRUE, TRUE)
                  RETURNING id`);
    log('user created', user[0]);
  } else {
    // keep it usable across re-runs: unlock, reactivate, refresh the hash
    const hash = bcryptHash(PASSWORD).replace(/'/g, "''");
    sql(`UPDATE users SET password_hash='${hash}', is_active=TRUE, is_super_admin=TRUE,
                          login_attempts=0, locked_until=NULL WHERE id='${user[0]}'`);
    log('user adopted and unlocked', user[0]);
  }
  /*
   * is_super_admin bypasses require_module (shared.py:265-269). The alternative
   * is seeding a subscription and its module rows, which tests the billing
   * tables rather than the school routes we came for.
   */

  console.log('\n── log in through the real route ──');
  const auth = await POST('/auth/login', { email: EMAIL, password: PASSWORD });
  TOKEN = auth.access_token || auth.token || (auth.tokens && auth.tokens.access_token);
  if (!TOKEN) throw new Error('Login succeeded but returned no access token: ' + JSON.stringify(auth).slice(0, 300));
  log('JWT acquired,', TOKEN.length, 'chars');

  console.log('\n── school, classes, term (API) ──');
  // the school collection is the router root: @school_router.post("") at school.py:239
  const schools = await GET('/school').catch(() => null);
  let school = (Array.isArray(schools) ? schools : (schools && schools.items) || [])
    .filter((s) => s.name === 'Riverside Contract Academy')[0];
  if (!school) {
    school = await POST('/school', {
      name: 'Riverside Contract Academy',
      address: 'Riverside Drive, Nairobi', phone: '+254700000000'
    });
    log('school created', school.id);
  } else {
    log('school adopted', school.id);
  }
  const schoolId = school.id;

  const existingClasses = await GET(`/school/${schoolId}/classes`).catch(() => []);
  const haveClasses = (Array.isArray(existingClasses) ? existingClasses : existingClasses.items || []);
  const wantClasses = [
    { name: 'Grade 4 East', grade: '4', stream: 'East' },
    { name: 'Grade 7 East', grade: '7', stream: 'East' }
  ];
  const classes = [];
  for (const c of wantClasses) {
    const found = haveClasses.filter((x) => x.name === c.name)[0];
    if (found) { classes.push(found); log('class adopted', c.name); continue; }
    const made = await POST('/school/classes', Object.assign({ school_id: schoolId, academic_year: YEAR, capacity: 40 }, c));
    classes.push(made);
    log('class created', c.name, made.id);
  }

  const terms = await GET(`/school/${schoolId}/terms`).catch(() => []);
  const haveTerms = Array.isArray(terms) ? terms : terms.items || [];
  let term = haveTerms.filter((t) => String(t.term) === String(TERM) && String(t.academic_year) === YEAR)[0];
  if (!term) {
    term = await POST('/school/terms', {
      school_id: schoolId, academic_year: YEAR, term: TERM,
      start_date: '2026-05-04', end_date: '2026-08-07', is_current: true
    });
    log('term created', term.id);
  } else {
    log('term adopted', term.id);
  }

  console.log('\n── subjects and students (API) ──');
  const haveSubjects = await GET(`/school/${schoolId}/subjects`).catch(() => []);
  const subjectRows = Array.isArray(haveSubjects) ? haveSubjects : haveSubjects.items || [];
  const subjects = [];
  for (const name of ['Mathematics', 'English']) {
    const found = subjectRows.filter((s) => s.name === name)[0];
    if (found) { subjects.push(found); log('subject adopted', name); continue; }
    const made = await POST('/school/subjects', { school_id: schoolId, name, code: name.slice(0, 3).toUpperCase() });
    subjects.push(made);
    log('subject created', name, made.id);
  }

  const haveStudents = await GET(`/school/${schoolId}/students`).catch(() => []);
  const studentRows = (haveStudents.items || haveStudents || []);
  const students = [];
  const roster = [
    ['Amina Ouma', 'ADM/C001', 0], ['Brian Kiptoo', 'ADM/C002', 0],
    ['Cynthia Wairimu', 'ADM/C003', 0], ['David Ochieng', 'ADM/C004', 1],
    ['Esther Nafula', 'ADM/C005', 1], ['Felix Mwangi', 'ADM/C006', 1]
  ];
  for (const [full_name, admission_number, classIdx] of roster) {
    // school_students.admission_no is the column; admission_number exists only on StudentIn
    const found = studentRows.filter((s) => (s.admission_no || s.admission_number) === admission_number)[0];
    if (found) { students.push(found); log('student adopted', admission_number); continue; }
    /*
     * school_students has no class_id — membership is the grade/stream text
     * pair (E30). Passing class_id would be silently dropped by the model.
     */
    const cls = classes[classIdx];
    const made = await POST('/school/students', {
      school_id: schoolId, admission_number, full_name,
      grade: cls.grade, stream: cls.stream, gender: 'F',
      parent_name: 'Mercy Ouma', parent_phone: '0722418067',
      date_of_birth: '2015-04-09'
    });
    students.push(made);
    log('student created', admission_number, made.id);
  }

  console.log('\n── grading scale, bands, exam (API) ──');
  const haveScales = await GET(`/school/grading-scales?school_id=${schoolId}`).catch(() => []);
  const scaleRows = Array.isArray(haveScales) ? haveScales : haveScales.items || [];
  let scale = scaleRows.filter((s) => s.name === 'Contract 8-4-4')[0];
  if (!scale) {
    scale = await POST('/school/grading-scales', { school_id: schoolId, name: 'Contract 8-4-4', is_default: true });
    const bands = [
      ['E', 0, 29, 1], ['D', 30, 44, 2], ['C', 45, 59, 3],
      ['B', 60, 74, 4], ['A', 75, 100, 5]
    ];
    for (const [grade, min_score, max_score, points] of bands) {
      await POST(`/school/grading-scales/${scale.id}/bands`,
        { grade, min_score, max_score, points, remark: grade });
    }
    log('scale created with', bands.length, 'bands', scale.id);
  } else {
    log('scale adopted', scale.id);
  }

  const haveExams = await GET(`/school/exams?school_id=${schoolId}`).catch(() => []);
  const examRows = Array.isArray(haveExams) ? haveExams : haveExams.items || [];
  let exam = examRows.filter((e) => e.name === 'Contract Mid-term')[0];
  if (!exam) {
    exam = await POST('/school/exams', {
      school_id: schoolId, name: 'Contract Mid-term', term_id: term.id,
      exam_type: 'internal', date_from: '2026-06-22', date_to: '2026-06-25',
      max_score: 100, grading_scale_id: scale.id
    });
    log('exam created', exam.id);
  } else {
    log('exam adopted', exam.id);
  }

  console.log('\n── fee structure and invoices (API) ──');
  const haveStructures = await GET(`/school/fee-structures?school_id=${schoolId}`).catch(() => []);
  const structureRows = Array.isArray(haveStructures) ? haveStructures : haveStructures.items || [];
  let structure = structureRows.filter((f) => f.name === 'Contract Term 2 fees')[0];
  if (!structure) {
    structure = await POST('/school/fee-structures', {
      school_id: schoolId, name: 'Contract Term 2 fees',
      amount: 42000, term: TERM, year: Number(YEAR)
    });
    log('fee structure created', structure.id);
  } else {
    log('fee structure adopted', structure.id);
  }

  const gen = await POST('/school/fee-invoices/bulk-generate', {
    school_id: schoolId, fee_structure_id: structure.id, due_date: '2026-05-22'
  }).catch((e) => ({ error: e.message }));
  log('bulk generate:', JSON.stringify(gen).slice(0, 160));

  /*
   * Reset the money on this tenant to a known state.
   *
   * Contract runs record payments and approve waivers, so a second run would
   * otherwise find every invoice already cleared and have nothing to test
   * against. This is SQL because no route un-pays an invoice, and it is safe
   * only because the tenant is `shule-contract-test` and nothing else.
   */
  sql(`UPDATE school_fee_invoices
         SET amount_paid = 0, discount_amount = 0, balance = amount_due, status = 'pending'
       WHERE tenant_id = '${tenantId}'`);
  sql(`DELETE FROM school_fee_waivers WHERE tenant_id = '${tenantId}'`);
  sql(`DELETE FROM journal_lines WHERE tenant_id = '${tenantId}'`);
  log('money reset to unpaid for a reproducible run');

  const invoices = await GET(`/school/fee-invoices?school_id=${schoolId}&per_page=100`);
  const invoiceRows = invoices.items || invoices || [];
  log('invoices now:', invoiceRows.length);

  const out = {
    api: API,
    tenant_id: tenantId,
    email: EMAIL,
    password: PASSWORD,
    token: TOKEN,
    school_id: schoolId,
    term_id: term.id,
    class_ids: classes.map((c) => c.id),
    subject_ids: subjects.map((s) => s.id),
    student_ids: students.map((s) => s.id),
    scale_id: scale.id,
    exam_id: exam.id,
    fee_structure_id: structure.id,
    invoice_ids: invoiceRows.map((i) => i.id)
  };
  fs.writeFileSync(path.join(process.cwd(), 'dev', 'seed-live.json'), JSON.stringify(out, null, 2));

  console.log('\n── routes exercised ──');
  seen.forEach((s) => console.log('  ', String(s.status).padEnd(4), s.method.padEnd(5), s.route));
  console.log('\n── written to dev/seed-live.json ──');
  console.log(JSON.stringify(Object.assign({}, out, { token: out.token.slice(0, 24) + '…' }), null, 2));
}

main().catch((e) => {
  console.error('\nSEED FAILED:', e.message);
  if (e.body) console.error('body:', JSON.stringify(e.body).slice(0, 500));
  console.error('\nroutes attempted:');
  seen.forEach((s) => console.error('  ', String(s.status).padEnd(4), s.method.padEnd(5), s.route));
  process.exit(1);
});
