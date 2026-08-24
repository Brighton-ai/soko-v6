'use strict';
/**
 * Access control. Every test here is a data-leak test, and every one of them
 * is a rule the backend does not currently enforce.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { openAPI, SCHOOL, rule, because } = require('./backend.js');

let API;
beforeEach(() => { API = openAPI(); });

const TEACHER = 'tch-04';
const GUARDIAN = '0722 418 067';

describe('Contract — teacher scope', () => {
  it(rule(21, 'a teacher is handed only the classes they are assigned to'), async () => {
    const mine = await API.listTeacherClasses(SCHOOL, TEACHER);
    const all = await API.listClasses(SCHOOL, {});
    assert.ok(mine.length > 0, 'The teacher was handed no classes at all.' + because(21));
    assert.ok(mine.length < all.length,
      `The teacher was handed all ${all.length} classes, so nothing is scoped.` +
      because(21, 'teacher_id appears only on class and assignment models (school.py:43, :63, :339); no route filters on it'));
  });

  it(rule(21, 'a class the teacher does not teach is refused'), async () => {
    const mine = (await API.listTeacherClasses(SCHOOL, TEACHER)).map((c) => c.id);
    const all = await API.listClasses(SCHOOL, {});
    const notMine = all.filter((c) => !mine.includes(c.id));
    assert.ok(notMine.length, 'The teacher teaches every class; scoping cannot be tested.');

    for (const cls of notMine) {
      let err = null;
      await API.getTeacherRegister(SCHOOL, TEACHER, cls.id, {}).catch((e) => { err = e; });
      assert.ok(err,
        `The teacher opened the register for ${cls.full_name}, which they do not teach. ` +
        'Any authenticated tenant user can read and write any class.' +
        because(21, 'school.py has no teacher scoping on any route'));
      assert.equal(err.status, 404,
        `The refusal came back as ${err.status}. A 403 would confirm the class exists.` + because(21));
    }
  });

  it(rule(21, 'a teacher cannot write marks outside their assignment'), async () => {
    const mine = (await API.listTeacherClasses(SCHOOL, TEACHER)).map((c) => c.id);
    const all = await API.listClasses(SCHOOL, {});
    const foreign = all.filter((c) => !mine.includes(c.id))[0];
    const page = await API.listStudents(SCHOOL, { classId: foreign.id, pageSize: 5 });

    let err = null;
    await API.saveTeacherResults(SCHOOL, TEACHER, 'exm-t2-mid', {
      classId: foreign.id, subjectId: 'sub-mat',
      scores: [{ student_id: page.items[0].id, score: 99 }]
    }).catch((e) => { err = e; });
    assert.ok(err,
      `The teacher wrote a mark into ${foreign.full_name}, which they do not teach.` + because(21));
  });

  it(rule(21, "a teacher's dashboard counts only their own work"), async () => {
    const d = await API.getTeacherDashboard(SCHOOL, TEACHER, {});
    const mine = (await API.listTeacherClasses(SCHOOL, TEACHER)).map((c) => c.id);
    const stray = d.periods.filter((p) => !mine.includes(p.class_id)).map((p) => p.class_name);
    assert.deepEqual(stray, [],
      `Periods for classes the teacher does not teach: ${stray.join(', ')}` + because(21));
  });
});

describe('Contract — parent scope', () => {
  it(rule(22, 'a guardian is handed only their own children'), async () => {
    const kids = await API.listMyChildren(SCHOOL, GUARDIAN);
    const all = await API.searchStudents(SCHOOL, { pageSize: 1 });
    assert.ok(kids.length > 0, 'The guardian was handed no children.' + because(22));
    assert.ok(kids.length < all.total,
      `The guardian was handed ${kids.length} of ${all.total} pupils.` +
      because(22, 'no authenticated guardian surface exists in school.py'));
  });

  it(rule(22, "another family's child is refused on every child route"), async () => {
    const mine = (await API.listMyChildren(SCHOOL, GUARDIAN)).map((c) => c.student_id);
    const page = await API.searchStudents(SCHOOL, { pageSize: 100000 });
    const stranger = page.items.filter((s) => !mine.includes(s.id))[0];

    for (const [name, call] of [
      ['getChildFees', () => API.getChildFees(SCHOOL, GUARDIAN, stranger.id)],
      ['getChildAttendance', () => API.getChildAttendance(SCHOOL, GUARDIAN, stranger.id, {})],
      ['getChildResults', () => API.getChildResults(SCHOOL, GUARDIAN, stranger.id)]
    ]) {
      let err = null;
      await call().catch((e) => { err = e; });
      assert.ok(err,
        `${name} handed over ${stranger.name}, who is not this guardian's child.` + because(22));
      assert.equal(err.status, 404, `${name} refused with ${err.status}, expected 404.` + because(22));
    }
  });

  it(rule(23, 'a guardian sees only published report cards'), async () => {
    const kids = await API.listMyChildren(SCHOOL, GUARDIAN);
    for (const kid of kids) {
      const r = await API.getChildResults(SCHOOL, GUARDIAN, kid.student_id);
      const unpublished = r.cards.filter((c) => !c.published_at).map((c) => c.card_id);
      assert.deepEqual(unpublished, [],
        `Cards with no published_at reached a parent: ${unpublished.join(', ')}` +
        because(23, 'school.py:2498-2503 selects every result for the pupil, with no publication or verification filter'));
    }
  });

  it(rule(23, 'a guardian sees only verified marks'), async () => {
    const kids = await API.listMyChildren(SCHOOL, GUARDIAN);
    const problems = [];
    for (const kid of kids) {
      const shown = await API.getChildResults(SCHOOL, GUARDIAN, kid.student_id);
      for (const card of shown.cards) {
        const stored = await API.listExamResults(SCHOOL, card.exam_id, { pageSize: 100000 });
        card.results.forEach((s) => {
          const row = stored.items.filter((r) =>
            r.student_id === kid.student_id && r.subject_id === s.subject_id)[0];
          if (row && !row.verified) {
            problems.push(`${kid.name}: ${s.subject_name} on ${card.exam_name} is unverified but was shown`);
          }
        });
      }
    }
    assert.deepEqual(problems, [],
      `Unverified marks reached a parent:\n  ${problems.join('\n  ')}` + because(23));
  });

  it(rule(23, 'a card put back into draft stops being visible'), async () => {
    const kids = await API.listMyChildren(SCHOOL, GUARDIAN);
    const kid = kids.filter((k) => k.published_cards > 0)[0];
    if (!kid) return;                        // nothing published; nothing to withdraw

    const before = await API.getChildResults(SCHOOL, GUARDIAN, kid.student_id);
    assert.ok(before.cards.length, 'The child has no visible cards.');

    // regenerating puts a published card back to draft
    await API.generateReportCards(SCHOOL, { classId: kid.class_id, examId: before.cards[0].exam_id });
    const after = await API.getChildResults(SCHOOL, GUARDIAN, kid.student_id);
    const still = after.cards.filter((c) => c.card_id === before.cards[0].card_id).length;
    assert.equal(still, 0,
      'A card returned to draft is still visible to the parent.' + because(23));
  });
});

describe('Contract — guardian portal', () => {
  const LIVE = process.env.SHULE_PORTAL_TOKEN || 'gp-live-4f21c8a9';
  const EXPIRED = process.env.SHULE_PORTAL_EXPIRED || 'gp-expired-91aa20d4';

  it(rule(32, 'a live token returns a payload rather than an error', 'school.py:2498'), async () => {
    const v = await API.getGuardianPortal(LIVE, {});
    assert.equal(v.state, 'ok',
      `A valid guardian link resolved to "${v.state}" instead of a payload.` +
      because(32, 'school.py:2498-2499 selects er.marks_obtained and er.max_marks; the column is score (:1020, :1241), so every valid link is a 500'));
    assert.ok(v.student && v.student.name, 'The payload carries no student.' + because(32));
    assert.ok(v.fees && v.attendance && v.results !== undefined,
      'The payload is missing fees, attendance or results.' + because(32));
  });

  it(rule(24, 'a token resolves to exactly one student', 'school.py:2465'), async () => {
    const v = await API.getGuardianPortal(LIVE, {});
    assert.equal(v.state, 'ok', 'The token did not resolve.' + because(32));
    assert.ok(v.student && v.student.id, 'No single student on the payload.' + because(24));
    assert.equal(v.students, undefined,
      'The payload carries a students collection; a token is for one child.' + because(24));
  });

  it(rule(23, 'the portal shows only published cards and verified marks', 'school.py:2498'), async () => {
    const v = await API.getGuardianPortal(LIVE, {});
    if (v.state !== 'ok') return;            // rule 32 already reports this
    const unpublished = v.results.filter((c) => !c.published_at).map((c) => c.exam_name);
    assert.deepEqual(unpublished, [],
      `Unpublished results on the guardian portal: ${unpublished.join(', ')}. ` +
      'This surface has no member of staff between the data and the reader.' +
      because(23, 'school.py:2498-2503 has no publication or verification gate'));
  });

  it(rule(25, 'an expired token returns a state and no data', 'school.py:2467'), async () => {
    const v = await API.getGuardianPortal(EXPIRED, {});
    assert.notEqual(v.state, 'ok', `An expired token resolved to "${v.state}".` + because(25));
    for (const key of ['student', 'fees', 'attendance', 'results']) {
      assert.equal(v[key], undefined,
        `The expired response carries "${key}". An expired link must return a state and nothing else.` + because(25));
    }
  });

  it(rule(25, 'an unknown token returns a state and no data'), async () => {
    const v = await API.getGuardianPortal('definitely-not-a-token', {});
    assert.notEqual(v.state, 'ok', `An invented token resolved to "${v.state}".` + because(25));
    assert.equal(v.student, undefined, 'The unknown response carries a student.' + because(25));
  });

  it(rule(26, 'a revoked token stops working'), async () => {
    const v = await API.getGuardianPortal('gp-revoked-3c8f7e62', {});
    assert.notEqual(v.state, 'ok',
      'A withdrawn link still serves data. Revocation means nothing without it.' +
      because(26, 'school_guardian_tokens has no revoked_at column — searched'));
  });

  it(rule(8, 'a link cannot be issued to a guardian on another pupil’s record'), async () => {
    const page = await API.searchStudents(SCHOOL, { pageSize: 20 });
    const student = page.items[3];
    const other = page.items[7];
    const foreign = await API.listGuardians(SCHOOL, other.id);
    if (!foreign.length) return;

    let err = null;
    await API.issueGuardianToken(SCHOOL, student.id, { guardianId: foreign[0].id }).catch((e) => { err = e; });
    assert.ok(err,
      `A portal link for ${student.name} was issued to a guardian of ${other.name}.` + because(8));
  });
});
