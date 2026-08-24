# Shule — rule reconciliation

**`backend/routers/school.py` was not available to me.** I searched this machine
(`/home/nova`, the whole filesystem for `school.py` under any `routers/` path,
and for any FastAPI project) and found nothing: this repo is the only Shule
source present. So I have **not read the backend**, and I have not guessed at
what is in it.

Where I can cite something you told me during the build, the evidence column
says so and the verdict is firm. Everywhere else the verdict is **unknown**, and
the row is a question for whoever opens `school.py` in step 6 — not a finding.

Verdicts use exactly the vocabulary you set, plus `unknown` for the rows I
cannot see:

| Verdict | Meaning |
|---|---|
| **backend has it** | Confirmed present in the FastAPI backend |
| **backend gap** | Confirmed absent — the rule lives only in the demo half |
| **frontend-only by design** | Correctly a client concern; the backend should not have it |
| **unknown** | `school.py` not read. Verify before step 6 removes the demo half. |

## Why this matters

`assets/js/demo-backend.js` is 130 KB and holds every business rule in the
product. Step 6 points `api.js` at the live backend and deletes that file. Any
rule that exists **only** in the demo half disappears at that moment — and not
one test fails, because the tests exercise the demo backend. The `unknown` rows
below are the ones that could vanish silently.

## The table

| # | Rule | Where it's enforced now | Evidence about `school.py` | Verdict |
|---|---|---|---|---|
| 1 | `balance === amount_due - amount_paid` on every invoice | `reconcileInvoice()` in demo-backend.js; asserted after every mutation by `checkInvariants()` in test/app.test.js | Not read | **unknown** |
| 2 | A payment cannot exceed the balance | `recordPayment()` rejects with 422 before touching the invoice | Not read | **unknown** |
| 3 | A part payment leaves the invoice `part_paid`; a clearing payment sets `cleared` | `reconcileInvoice()` derives status from the money, never from the caller | Not read | **unknown** |
| 4 | Every payment posts a balanced debit/credit pair | `postEntry()` in demo-backend.js; `ledgerDrift()` and the invariant checker enforce sum(debits) == sum(credits) | You said in step 2: *"Your backend's `test_school_fees.py` asserts the general ledger balances after a fee payment."* | **backend has it** |
| 5 | An approved waiver reduces `amount_due`, not `balance` | `approveWaiver()`; keeps rule 1 true by construction | Not read | **unknown** |
| 6 | `applied` makes re-approving a waiver a no-op | `approveWaiver()` returns `{ already: true }` and mutates nothing | Not read | **unknown** |
| 7 | Bulk generate excludes pupils already invoiced for that class and term | `bulkGenerateInvoices()` builds an `already` index and reports the skips | Not read | **unknown** |
| 8 | Exactly one primary guardian per student | `addGuardian()`, `updateGuardian()`, `setPrimaryGuardian()`, `removeGuardian()`; invariant-checked | Not read | **unknown** |
| 9 | Grade and points derived from the bound scale, never from the caller | `saveExamResults()` overwrites any supplied grade with `bandFor()` | Not read | **unknown** |
| 10 | Score constrained to `0..max_score` | `saveExamResults()` validates every row and saves nothing if any is out of range | Not read | **unknown** |
| 11 | An exam's grading scale is immutable once results exist | `updateExam()` refuses with 409 and the affected mark count | Not read | **unknown** |
| 12 | Changing a saved mark clears its verification | `saveExamResults()` resets `verified`, `verified_by`, `verified_at` on update | Not read | **unknown** |
| 13 | `entered_by` cannot equal `verified_by` | `verifyExamResults()` refuses with 409 unless `allowSelf` is passed (test-only; a static test forbids it in app code) | Step 1 marketing copy, which you wrote: *"Entry and verification are separate steps with separate names against them."* Separation is a backend concept; whether the **same-person check** exists is not stated. | **unknown** |
| 14 | Publish blocked while any feeding result is unverified | `publishReportCardsFor()` refuses with 409 and names the unverified subjects | Step 1 copy: *"Marks are verified before release… Report cards stay invisible to parents until the head signs them off."* Draft/publish exists; the **blocking check** is not stated. | **unknown** |
| 15 | A published card's comments cannot be rewritten | `updateReportCard()` refuses with 409 once `status === 'published'` | Not read | **unknown** |
| 16 | One attendance record per student, class and date — marking upserts | `markAttendance()` indexes on `(class_id, date)` and updates in place; invariant-checked | Not read | **unknown** |
| 17 | Registers cannot be dated in the future | `markAttendance()` rejects with 422 | Not read | **unknown** |
| 18 | Grading bands tile `0..max_score` with no gap or overlap | `validateBands()`; called on create and update, and mirrored in the editor's coverage strip | Step 1 copy: *"Define your own bands — grade, range, points and remark."* Configurable scales exist; **tiling validation** is not stated. | **unknown** |
| 19 | Competition ranking for report card positions and merit lists | `competitionRank()` in demo-backend.js; invariant-checked against a recount | Step 1 copy: *"Class position out of class size."* Positions exist; the **tie rule** is not stated. | **unknown** |
| 20 | Editing a grading scale regrades live marks but is blocked by published cards | `updateGradingScale()` → `regradeAgainst()`, with a 409 when published cards depend on the scale | Not read | **unknown** |
| 21 | A teacher sees only classes and subjects they are assigned to | `teaches()` / `teacherClassIds()` gate every `getTeacher*` and `saveTeacherResults` call; refusal is a 404, identical to a class that does not exist | Not read | **unknown** |
| 22 | A guardian sees only children they are a guardian of | `guards()` gates `getChildFees`, `getChildAttendance`, `getChildResults` | Not read | **unknown** |
| 23 | A guardian sees only published cards and verified results | `getChildResults()` and `getGuardianPortal()` filter on `status === 'published'` and `verified === true` | Not read | **unknown** |
| 24 | A portal token resolves to exactly one student | `getGuardianPortal()` reads `token.student_id` and never widens | You said in step 3 the endpoint exists: *"mirroring `GET /api/school/guardian-portal/{token}`"* — the endpoint is confirmed, its **scoping guarantees** are not. | **unknown** |
| 25 | An expired, revoked or unknown token returns a state and no data | `getGuardianPortal()` returns `{ state }` before reading any pupil record | Not read | **unknown** |
| 26 | Defaulter aging into 0–30 / 31–60 / 61–90 / 90+ buckets | `listDefaulterRows()` + `bucketFor()` | You said in step 3: *"the backend has a defaulters list but no aging"* | **backend gap** |
| 27 | CSV import column contract (`full_name`, `class_name`, `date_of_birth`, `gender`, `guardian_name`, `guardian_phone`) | `CSV_COLUMNS` + `importStudentsCSV()` | You said in step 3: *"CSV import matches the backend's columns exactly"* | **backend has it** |
| 28 | Per-row CSV validation: bad rows are reported with line numbers and skipped, good rows still import | `importStudentsCSV()` | Not read — the **columns** are confirmed, the **partial-import behaviour** is not | **unknown** |
| 29 | Three reminders maximum per invoice | `MAX_REMINDERS` + `sendRemindersFor()` | Step 1 copy: *"A nightly job… chases it up to three times, counting each attempt."* | **backend has it** |
| 30 | Deleting a fee structure with invoices against it is blocked | `deleteFeeStructure()` refuses with 409 | Not read | **unknown** |
| 31 | Session store, hydration and reset (`sessionStorage['shule.store']`) | `db()`, `persist()`, `resetStore()` | Exists only because there is no server. Nothing to reconcile. | **frontend-only by design** |
| 32 | Simulated latency, skeleton and empty states | `resolve()` in demo-backend.js; `UI.show()` per panel | Presentation. Belongs nowhere near a backend. | **frontend-only by design** |
| 33 | Live client-side grading as a mark is typed | `bandFor()` in assets/js/results.js, mirroring the server rule | A preview. Rule 9 is the control; this is convenience that must agree with it. | **frontend-only by design** |
| 34 | Band coverage strip in the scale editor | `recompute()` in assets/js/grading-scales.js | Visualises rule 18. The refusal is the control. | **frontend-only by design** |
| 35 | Role → navigation map | `ROLE_NAV` in shell.js and tools/shell.mjs | Which menu items a role sees. The **data** controls are rules 21–23. | **frontend-only by design** |
| 36 | Seeded demo dataset | assets/js/data/demo-data.js | Deleted in step 6. | **frontend-only by design** |

## What each unknown costs if it turns out to be a gap

Every row below is one where the demo half currently holds the line. If
`school.py` does not, the behaviour disappears the moment step 6 lands — and no
test will say so, because the tests run against the demo backend.

| # | If this rule is not in the backend |
|---|---|
| 1 | Invoice balances drift from their arithmetic; every fee total in the product becomes untrustworthy and nothing detects it. |
| 2 | A bursar's typo posts a KES 400,000 payment against a KES 40,000 invoice, creating a phantom credit the school owes back. |
| 3 | A part-paid invoice reads `cleared`; a parent who owes money stops being chased. |
| 5 | Waivers reduce `balance` directly, breaking rule 1, and the general ledger stops matching the fee book. |
| 6 | A double-clicked approval waives the bursary twice and writes off fees nobody authorised. |
| 7 | Running bulk generate twice doubles a term's invoices for a whole class; every parent is billed twice. |
| 8 | Two primary guardians receive conflicting fee statements, or none does and reminders reach nobody. |
| 9 | A caller can dictate the grade for a score, so an A can be sent for a mark of 12. |
| 10 | A mistyped mark of 850 is stored, distorting the mean, the position and the report card. |
| 11 | Rebinding a scale silently regrades a whole exam, changing grades already verified and printed. |
| 12 | An edited mark keeps its old verification, so an unchecked number reaches a report card through a gate that thinks it was checked. |
| 13 | A teacher enters and verifies their own marks; the separation is naming only. |
| 14 | Unverified marks reach guardians. This is the failure a parent notices and the school cannot retract. |
| 15 | A published card's comments change under a parent who has already read it. |
| 16 | Marking a register twice creates duplicate records; attendance percentages fall as a pupil is counted twice. |
| 17 | Registers are marked for days that have not happened. |
| 18 | A pupil scoring in a gap between bands gets no grade at all, and the report card renders a blank where a grade belongs. |
| 19 | Positions read as dense ranks: a card says "2 of 44" with two pupils ahead. A head teacher spots this immediately. |
| 20 | Editing a scale rewrites grades on cards parents have already seen. |
| 21 | A teacher can read and mark any class in the school. |
| 22 | A guardian can read another family's fees, attendance and results by changing an id. |
| 23 | Draft cards and unverified marks reach parents — the same failure as row 14, on a surface with no staff between the data and the reader. |
| 24 | A token resolves to more than one pupil, or the wrong one; an SMS link shows a stranger's child. |
| 25 | An expired link keeps serving data indefinitely, so revocation means nothing. |
| 28 | One malformed row rejects an entire import, or bad rows import silently. |
| 30 | Deleting a structure orphans the invoices raised from it. |

## How to close this out in step 6

1. Open `backend/routers/school.py` and `test_school_fees.py`.
2. Replace every **unknown** with **backend has it** or **backend gap**, citing the function or test.
3. Every **backend gap** becomes a ticket, ordered by the cost column above.
   Rows 14, 21, 22, 23, 24 and 25 are data-leak or trust failures and go first.
4. Only then delete `assets/js/demo-backend.js`.
