'use strict';
/** Grading, marks, verification, publication and ranking. */
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { openAPI, SCHOOL, rule, because, fixtures, resetFixtures, authenticate } = require('./backend.js');

before(async () => { await authenticate(); });

let API, F;
beforeEach(async () => { API = openAPI(); resetFixtures(); F = await fixtures(API); });

describe('Contract — academics', () => {
  it(rule(18, 'grading bands tile 0..max_score with no gap or overlap', 'school.py:964'), async () => {
    const scales = await API.listGradingScaleRows(SCHOOL, {});
    const holes = [];
    scales.forEach((g) => {
      const bands = g.bands.slice().sort((a, b) => a.min - b.min);
      if (bands[0].min !== 0) holes.push(`${g.name} starts at ${bands[0].min}, not 0`);
      for (let i = 1; i < bands.length; i++) {
        if (bands[i].min !== bands[i - 1].max + 1) {
          holes.push(`${g.name}: ${bands[i - 1].grade} ends ${bands[i - 1].max}, ${bands[i].grade} starts ${bands[i].min}`);
        }
      }
      if (bands[bands.length - 1].max !== g.max_score) {
        holes.push(`${g.name} ends at ${bands[bands.length - 1].max}, not ${g.max_score}`);
      }
    });
    assert.deepEqual(holes, [],
      `Scales with a gap or overlap:\n  ${holes.join('\n  ')}` +
      because(18, 'school.py:964 inserts a band with no validation; :1014 BETWEEN silently returns nothing for a score in a hole'));
  });

  it(rule(18, 'a scale with a hole is refused on save'), async () => {
    let err = null;
    await API.createGradingScale(SCHOOL, {
      name: 'Holed scale ' + Date.now(), maxScore: 100,
      bands: [
        { grade: 'D', min: 0, max: 39, points: 1, remark: 'Below' },
        { grade: 'C', min: 40, max: 49, points: 2, remark: 'Fair' },
        { grade: 'B', min: 51, max: 100, points: 3, remark: 'Good' }
      ]
    }).catch((e) => { err = e; });
    assert.ok(err,
      'A scale with no band covering 50 was saved. A pupil scoring 50 would get no grade.' + because(18));
    assert.ok(/50/.test(err.message),
      `The refusal does not name the score that falls through: "${err.message}"` + because(18));
  });

  it(rule(9, 'grade and points are derived from the bound scale, not the caller', 'school.py:1012'), async () => {
    const sheet = await API.getMarkSheet(SCHOOL, F.examId, { classId: F.classId, subjectId: F.subjectId });
    const scale = sheet.scale;
    const pupils = sheet.roll.slice(0, 4);
    const scores = [0, 44, 79, 100];

    await API.saveExamResults(SCHOOL, F.examId, {
      classId: F.classId, subjectId: F.subjectId, enteredBy: F.teacherId || null,
      scores: pupils.map((p, i) => ({ student_id: p.student_id, score: scores[i], grade: 'Z', points: 999 }))
    });

    const after = await API.getMarkSheet(SCHOOL, F.examId, { classId: F.classId, subjectId: F.subjectId });
    const wrong = pupils.map((p, i) => {
      const row = after.roll.filter((r) => r.student_id === p.student_id)[0];
      const band = scale.bands.filter((b) => scores[i] >= b.min && scores[i] <= b.max)[0];
      if (row.grade !== band.grade) return `${scores[i]} stored as ${row.grade}, band says ${band.grade}`;
      if (row.points !== band.points) return `${scores[i]} stored with ${row.points} points, band carries ${band.points}`;
      return null;
    }).filter(Boolean);
    assert.deepEqual(wrong, [],
      `Stored grades do not follow the bound scale:\n  ${wrong.join('\n  ')}` + because(9, 'school.py:1012-1018'));
  });

  it(rule(10, 'a score outside 0..max_score is refused', 'school.py:166'), async () => {
    const sheet = await API.getMarkSheet(SCHOOL, F.examId, { classId: F.classId, subjectId: F.subjectId });
    const pupil = sheet.roll[0].student_id;
    for (const bad of [-1, 101, 900]) {
      let err = null;
      await API.saveExamResults(SCHOOL, F.examId, {
        classId: F.classId, subjectId: F.subjectId, enteredBy: F.teacherId || null,
        scores: [{ student_id: pupil, score: bad }]
      }).catch((e) => { err = e; });
      assert.ok(err,
        `A score of ${bad} was accepted against an exam out of ${sheet.max_score}.` +
        because(10, 'school.py:166 score: float, unbounded; :1014 then finds no band and grade stays NULL'));
    }
  });

  it(rule(10, 'a rejected mark sheet writes nothing at all'), async () => {
    const sheet = await API.getMarkSheet(SCHOOL, F.examId, { classId: F.classId2 || F.classId, subjectId: F.subjects[1] ? F.subjects[1].id : F.subjectId });
    const before = sheet.roll.map((r) => r.score);
    await API.saveExamResults(SCHOOL, F.examId, {
      classId: F.classId2 || F.classId, subjectId: F.subjects[1] ? F.subjects[1].id : F.subjectId, enteredBy: F.teacherId || null,
      scores: [
        { student_id: sheet.roll[0].student_id, score: 55 },
        { student_id: sheet.roll[1].student_id, score: 4000 }
      ]
    }).catch(() => null);
    const after = await API.getMarkSheet(SCHOOL, F.examId, { classId: F.classId2 || F.classId, subjectId: F.subjects[1] ? F.subjects[1].id : F.subjectId });
    assert.deepEqual(after.roll.map((r) => r.score), before,
      'One bad row was rejected but the good row in the same sheet was still written.' + because(10));
  });

  it(rule(11, "an exam's grading scale is frozen once results exist"), async () => {
    const exams = await API.listExamRows(SCHOOL, {});
    // result_count is not on the wire everywhere; fall back to the exam the
    // fixtures picked, which is the one this suite has been marking
    const marked = exams.filter((e) => e.result_count > 0)[0] ||
                   exams.filter((e) => String(e.id) === String(F.examId))[0] || exams[0];
    assert.ok(marked, 'No exam to test against.' + because(11));
    const scales = await API.listGradingScaleRows(SCHOOL, {});
    const other = scales.filter((g) => g.id !== marked.grading_scale_id)[0];

    let err = null;
    await API.updateExam(SCHOOL, marked.id, { gradingScaleId: other.id }).catch((e) => { err = e; });
    assert.ok(err,
      `"${marked.name}" was rebound to another scale with ${marked.result_count} marks against it. ` +
      'Every one of those grades would change under the people who entered them.' +
      because(11, 'school.py has no exam update route at all — searched PUT/PATCH /exams'));
  });

  it(rule(12, 'changing a saved mark clears its verification'), async () => {
    const page = await API.listExamResults(SCHOOL, F.examId, { pageSize: 100000 });
    const verified = page.items.filter((r) => r.verified)[0];
    assert.ok(verified, 'No verified result to disturb.' + because(12));

    await API.saveExamResults(SCHOOL, F.examId, {
      classId: verified.class_id, subjectId: verified.subject_id, enteredBy: F.teacherId || null,
      scores: [{ student_id: verified.student_id, score: Math.max(0, verified.score - 3) }]
    });
    const after = (await API.listExamResults(SCHOOL, F.examId, { pageSize: 100000 })).items
      .filter((r) => r.student_id === verified.student_id && r.subject_id === verified.subject_id)[0];
    assert.equal(after.verified, false,
      'A changed mark kept its verification. Nobody has checked the new number.' +
      because(12, 'school.py:1022 upserts score/grade/points/entered_by; there is no verification column to clear'));
  });

  it(rule(13, 'the person who entered a mark cannot verify it'), async () => {
    const sheet = await API.getMarkSheet(SCHOOL, F.examId, { classId: F.classId, subjectId: F.subjectId });
    await API.saveExamResults(SCHOOL, F.examId, {
      classId: F.classId, subjectId: F.subjectId, enteredBy: F.teacherId2 || null,
      scores: [{ student_id: sheet.roll[0].student_id, score: 61 }]
    });
    let err = null;
    // asEnterer says who is attempting this: the same person who just entered
    // the marks. The demo takes the verifier from the payload; the live backend
    // takes it from the token and cannot be told otherwise — a client that can
    // name its own verifier can name the person whose marks it is signing off.
    // So the test has to say which identity is calling, not only which id.
    await API.verifyExamResults(SCHOOL, F.examId, {
      classId: F.classId, subjectId: F.subjectId,
      verifiedBy: F.teacherId2 || null, asEnterer: true
    }).catch((e) => { err = e; });
    assert.ok(err,
      'The teacher who entered the marks verified them. Separation is then only a naming convention.' +
      because(13, 'school.py:1020 writes entered_by; verified_by does not exist'));
  });

  it(rule(13, 'verification records who signed it off'), async () => {
    const before = (await API.listExamResults(SCHOOL, F.examId, { pageSize: 100000 })).items
      .filter((r) => !r.verified);
    assert.ok(before.length, 'Nothing awaiting verification.');
    const classId = before[0].class_id;

    const r = await API.verifyExamResults(SCHOOL, F.examId, { classId, verifiedBy: F.verifierId || null, allowSelf: true });
    assert.ok(r.verified > 0, `Verification reported ${r.verified} marks.` + because(13));

    const after = (await API.listExamResults(SCHOOL, F.examId, { pageSize: 100000 })).items
      .filter((r2) => r2.class_id === classId);
    const unstamped = after.filter((r2) => r2.verified && !r2.verified_by).length;
    assert.equal(unstamped, 0,
      `${unstamped} verified marks carry no verified_by.` + because(13));
  });

  it(rule(14, 'a report card cannot be published while a feeding result is unverified', 'school.py:1331'), async () => {
    const page = await API.listExamResults(SCHOOL, F.examId, { pageSize: 100000 });
    const unverified = page.items.filter((r) => !r.verified);
    assert.ok(unverified.length, 'Everything is verified, so the gate is never exercised.');
    const classId = unverified[0].class_id;

    // Start from drafts. An earlier rule in this file may have published this
    // class legitimately, and counting cards it published would say the gate
    // failed when it was never asked.
    await API.withdrawReportCardsFor(SCHOOL, { classId }).catch(() => null);

    await API.generateReportCards(SCHOOL, { classId, examId: F.examId });
    let err = null;
    await API.publishReportCardsFor(SCHOOL, { classId }).catch((e) => { err = e; });

    assert.ok(err,
      'A class with unverified marks was published to guardians. ' +
      'This is the failure a parent notices and the school cannot retract.' +
      because(14, "school.py:1331-1338 UPDATE report_cards SET status='published' with no checks of any kind"));
    assert.ok(Array.isArray(err.subjects) && err.subjects.length,
      `The refusal does not name the unverified subjects: "${err.message}"` + because(14));

    const cards = await API.listReportCardRows(SCHOOL, { classId });
    const published = cards.items.filter((c) => c.status === 'published').length;
    assert.equal(published, 0, `${published} cards were published anyway.` + because(14));
  });

  it(rule(15, "a published card's comments cannot be rewritten"), async () => {
    const page = await API.listExamResults(SCHOOL, F.examId, { pageSize: 100000 });
    const classId = page.items.filter((r) => !r.verified)[0].class_id;
    await API.verifyExamResults(SCHOOL, F.examId, { classId, verifiedBy: F.verifierId || null, allowSelf: true });
    await API.generateReportCards(SCHOOL, { classId, examId: F.examId });
    await API.publishReportCardsFor(SCHOOL, { classId });

    const card = (await API.listReportCardRows(SCHOOL, { classId })).items[0];
    let err = null;
    await API.updateReportCard(SCHOOL, card.id, { teacher_comment: 'Rewritten' }).catch((e) => { err = e; });
    assert.ok(err,
      'A published card was edited under a parent who may already have read it.' + because(15));
  });

  it(rule(19, 'report card positions use competition ranking', 'school.py:1254'), async () => {
    // Generate this class's cards rather than ranking whatever an earlier rule
    // happened to leave behind. A ranking test that depends on which class a
    // different rule chose is measuring test order, not ranking.
    await API.generateReportCards(SCHOOL, { classId: F.classId, examId: F.examId })
      .catch(() => null);
    const all = (await API.listReportCardRows(SCHOOL, { classId: F.classId })).items;
    // A pupil who sat nothing has no position. Ranking them anyway put every
    // unmarked pupil at 1st, because "nobody scored higher than nothing" is
    // true and meaningless. They are excluded from the ranking, not given one.
    const cards = all.filter((c) => c.position != null);
    const unranked = all.filter((c) => c.position == null);
    assert.deepEqual(unranked.filter((c) => c.total_marks > 0).map((c) => c.student_name), [],
      'A pupil with marks was left unranked.' + because(19));
    assert.ok(cards.length > 2, 'Too few cards to rank.');

    const ordered = cards.slice().sort((a, b) => b.average - a.average);
    const off = cards.filter((c) => c.position !== ordered.findIndex((x) => x.average === c.average) + 1)
      .map((c) => `${c.student_name}: average ${c.average} ranks ` +
        `${ordered.findIndex((x) => x.average === c.average) + 1} but is at ${c.position}`);
    assert.deepEqual(off.slice(0, 5), [],
      `Positions are not competition-ranked:\n  ${off.slice(0, 5).join('\n  ')}` +
      because(19, 'school.py:1254-1265 uses fetchval over a GROUP BY, so position is only ever 1 or 2, and is not scoped to a class'));

    const distinct = [...new Set(cards.map((c) => c.position))];
    assert.ok(distinct.length > 2,
      `Only ${distinct.length} distinct positions (${distinct.join(', ')}) across ${cards.length} pupils.` +
      because(19, 'school.py:1254 returns 1 or 2 and nothing else'));
    assert.ok(Math.max(...cards.map((c) => c.position)) <= cards.length,
      'A position exceeds the class size.' + because(19));
  });

  it(rule(19, 'a tie shares a position and the rank after it skips'), async () => {
    await API.generateReportCards(SCHOOL, { classId: F.classId, examId: F.examId })
      .catch(() => null);
    const cards = (await API.listReportCardRows(SCHOOL, { classId: F.classId })).items
      .filter((c) => c.position != null);
    const byAverage = {};
    cards.forEach((c) => { (byAverage[c.average] = byAverage[c.average] || []).push(c); });
    const tied = Object.values(byAverage).filter((g) => g.length > 1)[0];
    if (!tied) return;                       // no tie in this class; nothing to assert

    const positions = [...new Set(tied.map((c) => c.position))];
    assert.equal(positions.length, 1,
      `Tied pupils hold positions ${tied.map((c) => c.position).join(', ')}.` + because(19));
    const next = cards.filter((c) => c.average < tied[0].average).sort((a, b) => b.average - a.average)[0];
    if (!next) return;
    assert.equal(next.position, positions[0] + tied.length,
      `${tied.length} pupils tied at ${positions[0]} should be followed by ` +
      `${positions[0] + tied.length}, not ${next.position}.` + because(19));
  });

  it(rule(19, 'the merit list ranks by total descending', 'school.py:2327'), async () => {
    const m = await API.getMeritList(SCHOOL, F.examId, { classId: F.classId });
    const totals = m.items.map((e) => e.total);
    assert.deepEqual(totals, totals.slice().sort((a, b) => b - a),
      `The merit list is not in descending order: ${totals.slice(0, 6).join(', ')}` +
      because(19, 'school.py:2327 uses RANK() OVER, which is right — but :2329 sums er.marks_obtained, a column that does not exist'));
  });

  it(rule(16, 'marking the same register twice updates rather than duplicates', 'school.py:634'), async () => {
    const classes = await API.listClasses(SCHOOL, {});
    const cls = classes[0];
    const summary = await API.getDashboardSummary(SCHOOL, {});
    const reg = await API.getClassRegister(SCHOOL, cls.id, { date: summary.date });
    const records = reg.roll.map((r) => ({ student_id: r.student_id, status: 'present' }));

    const first = await API.markTeacherAttendance(SCHOOL, cls.class_teacher_id || F.teacherId || null, cls.id, {
      date: summary.date, records
    }).catch(() => API.markAttendance(SCHOOL, cls.id, { date: summary.date, markedBy: F.teacherId || null, records }));

    const second = await API.markAttendance(SCHOOL, cls.id, {
      date: summary.date, markedBy: F.teacherId || null,
      records: records.map((r, i) => ({ ...r, status: i < 2 ? 'absent' : 'present' }))
    });
    assert.equal(second.created, 0,
      `Re-marking created ${second.created} new records.` +
      because(16, 'school.py:634 ON CONFLICT (student_id,date) upserts, but has no class_id, so a per-period register is impossible'));

    const after = await API.listAttendance(SCHOOL, { classId: cls.id, date: summary.date });
    const seen = {};
    const dupes = after.filter((a) => (seen[a.student_id] = (seen[a.student_id] || 0) + 1) > 1);
    assert.equal(dupes.length, 0, `${dupes.length} pupils hold two records for one day.` + because(16));
    assert.ok(first, 'sanity: the first marking succeeded');
  });

  it(rule(17, 'a register cannot be dated in the future'), async () => {
    const classes = await API.listClasses(SCHOOL, {});
    let err = null;
    await API.markAttendance(SCHOOL, classes[0].id, {
      date: '2099-01-01', markedBy: F.teacherId || null,
      records: [{ student_id: 'stu-2301', status: 'present' }]
    }).catch((e) => { err = e; });
    assert.ok(err, 'A register dated 2099 was accepted.' + because(17));
  });
});
