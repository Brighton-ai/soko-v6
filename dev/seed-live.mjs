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

  // ── the school module, activated ───────────────────────────────────────────
  //
  // E22 — require_module('school') returns 402 until someone grants the module
  // by hand, and only is_super_admin bypasses it. So the seeded admin worked
  // (it is a super admin) while every ordinary user in the same tenant was
  // paywalled out of the product the school had just bought. Granting it here
  // is what registration will do for itself in gate 7.
  const [mod] = sql(`SELECT 1 FROM subscription_modules
                      WHERE tenant_id='${tenantId}' AND module_slug='school' AND is_active=TRUE`);
  if (!mod) {
    sql(`INSERT INTO subscription_modules (tenant_id, module_slug, is_active, expires_at)
         VALUES ('${tenantId}', 'school', TRUE, NOW() + INTERVAL '365 days')
         ON CONFLICT DO NOTHING`);
    log('school module activated');
  } else {
    log('school module already active');
  }

  // ── a second, ORDINARY user ────────────────────────────────────────────────
  //
  // The admin above is is_super_admin, which bypasses every check there is. A
  // suite that only ever calls as a super admin cannot tell an enforced rule
  // from an absent one, so the fixture carries a second person with no special
  // standing: a head of department who can verify marks the admin entered
  // (E13 — entry and verification must be different people) and who is the
  // caller the access-control rules are actually written about (E16-E19).
  const HOD_EMAIL = 'hod.' + EMAIL;
  let [hodRole] = sql(`SELECT id FROM roles WHERE tenant_id='${tenantId}' AND name='teacher'`);
  if (!hodRole) {
    [hodRole] = sql(`INSERT INTO roles (tenant_id, name, permissions)
                     VALUES ('${tenantId}', 'teacher', '["school:read","school:write"]'::jsonb)
                     RETURNING id`);
    log('teacher role created', hodRole[0]);
  }
  let [hod] = sql(`SELECT id FROM users WHERE email='${HOD_EMAIL}'`);
  const hodHash = bcryptHash(PASSWORD).replace(/'/g, "''");
  if (!hod) {
    [hod] = sql(`INSERT INTO users (tenant_id, role_id, email, password_hash, full_name,
                                    is_active, is_super_admin)
                 VALUES ('${tenantId}', '${hodRole[0]}', '${HOD_EMAIL}', '${hodHash}',
                         'Contract Head of Department', TRUE, FALSE)
                 RETURNING id`);
    log('hod created', hod[0]);
  } else {
    sql(`UPDATE users SET password_hash='${hodHash}', is_active=TRUE, is_super_admin=FALSE,
                          login_attempts=0, locked_until=NULL WHERE id='${hod[0]}'`);
    log('hod adopted and unlocked', hod[0]);
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
  // Twelve, not six. Each money rule spends part of an invoice, so a thin roll
  // starves the later rules and a run's result starts depending on test order.
  const roster = [
    ['Amina Ouma', 'ADM/C001', 0], ['Brian Kiptoo', 'ADM/C002', 0],
    ['Cynthia Wairimu', 'ADM/C003', 0], ['David Ochieng', 'ADM/C004', 1],
    ['Esther Nafula', 'ADM/C005', 1], ['Felix Mwangi', 'ADM/C006', 1],
    ['Grace Chebet', 'ADM/C007', 0], ['Hassan Abdi', 'ADM/C008', 0],
    ['Irene Wanjiku', 'ADM/C009', 0], ['Joseph Kimani', 'ADM/C010', 1],
    ['Khadija Yusuf', 'ADM/C011', 1], ['Lucy Atieno', 'ADM/C012', 1]
  ];
  for (const [full_name, admission_number, classIdx] of roster) {
    // school_students.admission_no is the column; admission_number exists only on StudentIn
    const found = studentRows.filter((s) => (s.admission_no || s.admission_number) === admission_number)[0];
    if (found) {
      // A pupil seeded before E30 has no class_id. Place them, so a re-seeded
      // tenant behaves the same as a fresh one.
      if (!found.class_id) {
        sql(`UPDATE school_students SET class_id='${cls.id}', class_name='${cls.name.replace(/'/g, "''")}'
              WHERE id='${found.id}'`);
        log('student placed', admission_number, cls.name);
      } else {
        log('student adopted', admission_number);
      }
      students.push(found);
      continue;
    }
    /*
     * school_students has no class_id — membership is the grade/stream text
     * pair (E30). Passing class_id would be silently dropped by the model.
     */
    const cls = classes[classIdx];
    const made = await POST('/school/students', {
      school_id: schoolId, admission_number, full_name,
      // E30 — place the pupil in a real class, not only in a grade and a stream
      class_id: cls.id, class_name: cls.name,
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

  // ── marks ──────────────────────────────────────────────────────────────────
  //
  // The suite used to rely on whatever marks earlier tests had left behind, so
  // ranking was different on every run and rule 19 passed or failed by
  // accident. These are fixed, spread across the range, and include a
  // deliberate three-way tie so competition ranking has something to prove:
  // the three tied pupils must share a place and the next must skip to 4th.
  console.log('\n── marks (API) ──');
  sql(`DELETE FROM school_exam_results WHERE tenant_id = '${tenantId}' AND exam_id = '${exam.id}'`);
  const SPREAD = [88, 76, 76, 76, 64, 58, 52, 47, 41, 35, 28, 19];
  const byClass = {};
  students.forEach((st, i) => {
    const cls = classes[i % classes.length];
    (byClass[cls.id] = byClass[cls.id] || []).push({ student: st, mark: SPREAD[i % SPREAD.length] });
  });
  for (const [classId, entries] of Object.entries(byClass)) {
    const results = [];
    for (const { student, mark } of entries) {
      for (const subj of subjects) {
        results.push({ student_id: student.id, subject_id: subj.id, score: mark });
      }
    }
    const saved = await POST(`/school/exams/${exam.id}/results`, {
      exam_id: exam.id, class_id: classId, results
    }).catch((e) => ({ error: e.message }));
    log('marks entered', classId, JSON.stringify(saved).slice(0, 90));
  }

  // ── a second grading scale ─────────────────────────────────────────────────
  //
  // Rule 11 is "an exam's scale is frozen once marks exist against it", and it
  // needs a second scale to attempt the rebinding with. One scale in the tenant
  // meant the rule could not be tested at all.
  const haveScales2 = await GET(`/school/grading-scales?school_id=${schoolId}`).catch(() => []);
  const scaleRows2 = Array.isArray(haveScales2) ? haveScales2 : haveScales2.items || [];
  let scale2 = scaleRows2.filter((x) => x.name === 'Contract CBC')[0];
  if (!scale2) {
    scale2 = await POST('/school/grading-scales', {
      school_id: schoolId, name: 'Contract CBC', is_default: false, max_score: 100,
      bands: [
        { grade: 'BE', min_score: 0,  max_score: 39,  points: 1, remark: 'Below expectation' },
        { grade: 'AE', min_score: 40, max_score: 59,  points: 2, remark: 'Approaching' },
        { grade: 'ME', min_score: 60, max_score: 79,  points: 3, remark: 'Meeting' },
        { grade: 'EE', min_score: 80, max_score: 100, points: 4, remark: 'Exceeding' }
      ]
    });
    log('second scale created', scale2.id);
  }

  // ── some marks verified ────────────────────────────────────────────────────
  //
  // Rules about verification need something verified to start from, and
  // verification is deliberately a second person's act — so it is done here,
  // as the head of department, rather than by a test signing off its own work.
  //
  // Half the marks, not all: rules on both sides of the line need an example.
  const someResults = sql(`SELECT id FROM school_exam_results
                            WHERE tenant_id='${tenantId}' AND exam_id='${exam.id}'
                            ORDER BY created_at LIMIT 6`).map((r) => r[0]);
  if (someResults.length) {
    sql(`UPDATE school_exam_results
            SET verified = TRUE, verified_by = '${hod[0]}', verified_at = NOW()
          WHERE id IN (${someResults.map((i) => `'${i}'`).join(',')})`);
    log('verified', someResults.length, 'of the marks (as the head of department)');
  }

  // ── guardian portal tokens ─────────────────────────────────────────────────
  //
  // The portal rules used hardcoded demo tokens, so against a live tenant they
  // all resolved to "unknown" and six rules failed for want of a fixture. One
  // live token, one already expired, and one that will be revoked — all three
  // states the portal has to tell apart.
  console.log('\n── guardian portal tokens (API + SQL) ──');
  sql(`DELETE FROM school_guardian_tokens WHERE tenant_id = '${tenantId}'`);
  const portal = await POST(`/school/students/${students[0].id}/guardian-token`, {});
  log('portal token', portal.token);

  const expiredTok = 'expired' + Math.random().toString(36).slice(2, 12).padEnd(10, '0');
  sql(`INSERT INTO school_guardian_tokens (tenant_id, student_id, token, expires_at)
       VALUES ('${tenantId}', '${students[1].id}', '${expiredTok}', NOW() - INTERVAL '1 day')`);
  log('expired token', expiredTok);

  const revokeMe = await POST(`/school/students/${students[2].id}/guardian-token`, {});
  log('token to revoke', revokeMe.token);

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

  // A second fee structure, for a term nobody has been billed for yet.
  //
  // Rule 7 is "bulk generate skips pupils already invoiced for that term", and
  // it needs a term where the first run has something to do. Against a tenant
  // where every pupil is already billed, the rule fails on its own setup.
  let structure3 = structureRows.filter((f) => f.name === 'Contract Term 3 fees')[0];
  if (!structure3) {
    structure3 = await POST('/school/fee-structures', {
      school_id: schoolId, name: 'Contract Term 3 fees',
      amount: 38000, term: 3, year: Number(YEAR)
    });
    log('term 3 fee structure created', structure3.id);
  }
  sql(`DELETE FROM school_fee_invoices
        WHERE tenant_id = '${tenantId}' AND fee_structure_id = '${structure3.id}'`);

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
  // The ledger resets as a pair. Deleting only the lines leaves the journal
  // headers behind, and posting is idempotent on (tenant, source_type,
  // source_id) — so a re-seeded run would dedupe against an orphaned header and
  // write no lines at all, leaving the books silently empty.
  sql(`DELETE FROM journal_lines WHERE tenant_id = '${tenantId}'`);
  sql(`DELETE FROM journals WHERE tenant_id = '${tenantId}'`);
  sql(`DELETE FROM school_fee_payments WHERE tenant_id = '${tenantId}'`);
  log('money reset to unpaid for a reproducible run');

  // ── teacher and guardian logins ────────────────────────────────────────────
  //
  // Nobody could *be* a teacher or a parent: school_teachers and
  // school_guardians had no link to a login, so there was nothing for an access
  // check to check against, and every access rule failed for want of a subject
  // rather than for want of a rule (E16, E17).
  //
  // Miss Wanjiru teaches ONE of the two classes. That is the point: a teacher
  // scoped to every class proves nothing, and the rule under test is that the
  // other class is invisible to her.
  console.log('\n── teacher and guardian logins (SQL — no routes exist) ──');
  const TEACHER_EMAIL  = 'teacher.' + EMAIL;
  const GUARDIAN_EMAIL = 'parent.' + EMAIL;
  const pw = () => bcryptHash(PASSWORD).replace(/'/g, "''");

  function upsertUser(email, name, roleId) {
    let [u] = sql(`SELECT id FROM users WHERE email='${email}'`);
    if (!u) {
      [u] = sql(`INSERT INTO users (tenant_id, role_id, email, password_hash, full_name,
                                    is_active, is_super_admin)
                 VALUES ('${tenantId}','${roleId}','${email}','${pw()}','${name}',TRUE,FALSE)
                 RETURNING id`);
    } else {
      sql(`UPDATE users SET password_hash='${pw()}', is_active=TRUE, is_super_admin=FALSE,
                            role_id='${roleId}', login_attempts=0, locked_until=NULL
            WHERE id='${u[0]}'`);
    }
    return u[0];
  }

  const teacherUserId  = upsertUser(TEACHER_EMAIL,  'Miss Wanjiru', hodRole[0]);
  const guardianUserId = upsertUser(GUARDIAN_EMAIL, 'Mercy Ouma',   hodRole[0]);
  log('teacher user', teacherUserId, '| guardian user', guardianUserId);

  let [teacherRow] = sql(`SELECT id FROM school_teachers
                           WHERE tenant_id='${tenantId}' AND user_id='${teacherUserId}'`);
  if (!teacherRow) {
    [teacherRow] = sql(`INSERT INTO school_teachers
                          (tenant_id, school_id, full_name, email, user_id, is_active)
                        VALUES ('${tenantId}','${schoolId}','Miss Wanjiru',
                                '${TEACHER_EMAIL}','${teacherUserId}',TRUE)
                        RETURNING id`);
  }
  const teacherId = teacherRow[0];

  // Assigned to the FIRST class only, for both subjects.
  const scopedClass = classes[0], unscopedClass = classes[1];
  sql(`DELETE FROM school_teacher_assignments
        WHERE tenant_id='${tenantId}' AND teacher_id='${teacherId}'`);
  for (const subj of subjects) {
    sql(`INSERT INTO school_teacher_assignments (tenant_id, teacher_id, class_id, subject_id)
         VALUES ('${tenantId}','${teacherId}','${scopedClass.id}','${subj.id}')
         ON CONFLICT DO NOTHING`);
  }
  sql(`UPDATE school_classes SET class_teacher_id='${teacherId}' WHERE id='${scopedClass.id}'`);
  log('teacher', teacherId, 'teaches', scopedClass.name, 'and NOT', unscopedClass.name);

  // The guardian has exactly one of the twelve pupils.
  const myChild = students[0];
  sql(`DELETE FROM school_guardians WHERE tenant_id='${tenantId}' AND user_id='${guardianUserId}'`);
  sql(`INSERT INTO school_guardians
         (tenant_id, student_id, full_name, relationship, phone, email, user_id, is_primary)
       VALUES ('${tenantId}','${myChild.id}','Mercy Ouma','mother','0722418067',
               '${GUARDIAN_EMAIL}','${guardianUserId}',TRUE)`);
  log('guardian', guardianUserId, 'has', myChild.full_name, 'and none of the other 11');

  // ── a SECOND school, permanently ───────────────────────────────────────────
  //
  // Isolation cannot be tested with one tenant. Every cross-tenant rule was
  // failing for want of a second school to be refused access to, and a fixture
  // built inside one test disappears with it — so the next test has nothing to
  // check against and the gap reopens quietly.
  //
  // St Monica's is a whole second school: its own tenant, admin, pupils,
  // classes, grading scale and invoices. Nothing in it shares a row with the
  // first, and every id it holds is a valid id that the first school's users
  // must not be able to touch.
  console.log('\n── second tenant: cross-tenant fixture (SQL) ──');
  const OTHER_NAME  = 'St Monica Contract School';
  const OTHER_EMAIL = 'other.' + EMAIL;

  let [other] = sql(`SELECT id FROM tenants WHERE name = '${OTHER_NAME}'`);
  if (!other) {
    [other] = sql(`INSERT INTO tenants (name, email)
                   VALUES ('${OTHER_NAME}', '${OTHER_EMAIL}') RETURNING id`);
  }
  const otherTenantId = other[0];

  let [otherRole] = sql(`SELECT id FROM roles WHERE tenant_id='${otherTenantId}' AND name='admin'`);
  if (!otherRole) {
    [otherRole] = sql(`INSERT INTO roles (tenant_id, name, permissions)
                       VALUES ('${otherTenantId}','admin','["*"]'::jsonb) RETURNING id`);
  }

  let [otherUser] = sql(`SELECT id FROM users WHERE email='${OTHER_EMAIL}'`);
  if (!otherUser) {
    [otherUser] = sql(`INSERT INTO users (tenant_id, role_id, email, password_hash, full_name,
                                          is_active, is_super_admin)
                       VALUES ('${otherTenantId}','${otherRole[0]}','${OTHER_EMAIL}','${pw()}',
                               'St Monica Admin', TRUE, FALSE) RETURNING id`);
  } else {
    sql(`UPDATE users SET password_hash='${pw()}', is_active=TRUE, is_super_admin=FALSE,
                          login_attempts=0, locked_until=NULL WHERE id='${otherUser[0]}'`);
  }

  sql(`INSERT INTO subscription_modules (tenant_id, module_slug, is_active, expires_at)
       VALUES ('${otherTenantId}','school',TRUE, NOW() + INTERVAL '365 days')
       ON CONFLICT (tenant_id, module_slug) DO UPDATE SET is_active=TRUE`);

  let [otherSchool] = sql(`SELECT id FROM schools WHERE tenant_id='${otherTenantId}' LIMIT 1`);
  if (!otherSchool) {
    [otherSchool] = sql(`INSERT INTO schools (tenant_id, name, is_active)
                         VALUES ('${otherTenantId}','St Monica Primary',TRUE) RETURNING id`);
  }
  const otherSchoolId = otherSchool[0];

  let [otherClass] = sql(`SELECT id FROM school_classes WHERE tenant_id='${otherTenantId}' LIMIT 1`);
  if (!otherClass) {
    [otherClass] = sql(`INSERT INTO school_classes (tenant_id, school_id, name, grade, stream, academic_year)
                        VALUES ('${otherTenantId}','${otherSchoolId}','Grade 5 North','5','North','${YEAR}')
                        RETURNING id`);
  }

  let [otherStudent] = sql(`SELECT id FROM school_students WHERE tenant_id='${otherTenantId}' LIMIT 1`);
  if (!otherStudent) {
    [otherStudent] = sql(`INSERT INTO school_students
                            (tenant_id, school_id, admission_no, full_name, class_id, class_name,
                             grade, stream, is_active)
                          VALUES ('${otherTenantId}','${otherSchoolId}','SM/001','Njeri Kamau',
                                  '${otherClass[0]}','Grade 5 North','5','North',TRUE)
                          RETURNING id`);
  }

  let [otherScale] = sql(`SELECT id FROM school_grading_scales WHERE tenant_id='${otherTenantId}' LIMIT 1`);
  if (!otherScale) {
    [otherScale] = sql(`INSERT INTO school_grading_scales (tenant_id, school_id, name, is_default)
                        VALUES ('${otherTenantId}','${otherSchoolId}','St Monica 8-4-4',TRUE) RETURNING id`);
    for (const [g, lo, hi, pt] of [['E',0,29,1],['D',30,44,2],['C',45,59,3],['B',60,74,4],['A',75,100,5]]) {
      sql(`INSERT INTO school_grading_bands (scale_id, grade, min_score, max_score, points, remark)
           VALUES ('${otherScale[0]}','${g}',${lo},${hi},${pt},'${g}')`);
    }
  }

  let [otherStructure] = sql(`SELECT id FROM school_fee_structures WHERE tenant_id='${otherTenantId}' LIMIT 1`);
  if (!otherStructure) {
    [otherStructure] = sql(`INSERT INTO school_fee_structures
                              (tenant_id, school_id, name, amount, term, year, is_active)
                            VALUES ('${otherTenantId}','${otherSchoolId}','St Monica Term 2',
                                    31000, ${TERM}, ${Number(YEAR)}, TRUE) RETURNING id`);
  }

  let [otherInvoice] = sql(`SELECT id FROM school_fee_invoices WHERE tenant_id='${otherTenantId}' LIMIT 1`);
  if (!otherInvoice) {
    [otherInvoice] = sql(`INSERT INTO school_fee_invoices
                            (tenant_id, school_id, student_id, fee_structure_id, term, year,
                             amount_due, balance, due_date, status)
                          VALUES ('${otherTenantId}','${otherSchoolId}','${otherStudent[0]}',
                                  '${otherStructure[0]}', ${TERM}, ${Number(YEAR)},
                                  31000, 31000, '2026-05-22', 'pending') RETURNING id`);
  }
  log('second tenant', otherTenantId, '· school', otherSchoolId, '· pupil', otherStudent[0]);

  const invoices = await GET(`/school/fee-invoices?school_id=${schoolId}&per_page=100`);
  const invoiceRows = invoices.items || invoices || [];
  log('invoices now:', invoiceRows.length);

  const out = {
    api: API,
    tenant_id: tenantId,
    email: EMAIL,
    password: PASSWORD,
    // the ordinary user: no super-admin bypass, so rules can be observed
    hod_email: HOD_EMAIL,
    hod_id: hod[0],
    token: TOKEN,
    school_id: schoolId,
    term_id: term.id,
    class_ids: classes.map((c) => c.id),
    subject_ids: subjects.map((s) => s.id),
    student_ids: students.map((s) => s.id),
    scale_id: scale.id,
    scale_id_2: scale2.id,
    // the cross-tenant fixture: every id here is real and must be untouchable
    other_email: OTHER_EMAIL,
    other_tenant_id: otherTenantId,
    other_school_id: otherSchoolId,
    other_class_id: otherClass[0],
    other_student_id: otherStudent[0],
    other_scale_id: otherScale[0],
    other_invoice_id: otherInvoice[0],
    teacher_email: TEACHER_EMAIL,
    teacher_id: teacherId,
    teacher_user_id: teacherUserId,
    teacher_class_id: scopedClass.id,
    teacher_not_class_id: unscopedClass.id,
    guardian_email: GUARDIAN_EMAIL,
    guardian_user_id: guardianUserId,
    guardian_child_id: myChild.id,
    portal_token: portal.token,
    portal_token_expired: expiredTok,
    portal_token_revocable: revokeMe.token,
    exam_id: exam.id,
    fee_structure_id: structure.id,
    fee_structure_id_unbilled: structure3.id,
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
