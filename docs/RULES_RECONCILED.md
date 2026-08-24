# Shule — rule reconciliation, answered

`backend/routers/school.py` (2,584 lines) and `backend/tests/test_school_fees.py`
were read from `soko-V4.2-main`. Every row below carries a line reference or an
explicit "absent — searched for X". No row is a guess.

> **Corrected again after a live run (step 7).** A backend was stood up and the
> schema loaded. Three rows below were wrong because they were grepped from
> `school.py` rather than read from the database: `school_exam_results` **has**
> `verified` and `verified_by`, `school_attendance` **has** `class_id`, and
> `report_cards` **has** `published_at`, `class_position` and `class_size`. In
> every case the columns exist and no route touches them — dead schema, not
> missing schema. Rows 12, 13, 16 and 14 are corrected accordingly, and a new
> row 39 records a bug the static read missed entirely.
>
> **Correction against my first pass.** I initially recorded rows 27 and 28 as
> gaps on a `grep` that missed them. `POST /{school_id}/students/import` exists
> at `:2242` with the same six columns and per-row error collection, and
> `/defaulters` at `:861` returns `days_overdue` without bucketing it. Both are
> corrected below. Counts in the summary reflect the corrected table.

| Verdict | Count | Meaning |
|---|---|---|
| **backend has it** | 5 | Enforced in `school.py`; our rule and theirs agree |
| **backend gap** | 21 | Not enforced anywhere; the rule lives only in our demo half |
| **modelled differently** | 7 | Both enforce something, by different mechanics |
| **frontend-only by design** | 6 | Correctly a client concern |
| | **39 rows** | **28 of them are enforced by the demo alone** |

> These counts are parsed from the table below by `npm run counts` (E27). They
> are not maintained by hand, and any figure quoted elsewhere that disagrees
> with `npm run counts` is wrong.

The arithmetic mostly holds. **Everything protecting a parent from bad data is
missing**, and the guardian portal is a 500 on every valid link.

## The table

| # | Rule | Ours | `school.py` | Verdict |
|---|---|---|---|---|
| 1 | `balance = amount_due − amount_paid` | `reconcileInvoice()` | `:815`, `:1978` compute `amount_due − amount_paid` and ignore `discount_amount`; `:919` writes a discount that the next payment silently undoes | **modelled differently** |
| 2 | Payment cannot exceed the balance | `recordPayment()` rejects 422 | `:813` / `:1976` take `body["amount"]` unchecked; `:818` clamps `balance` to 0 but `amount_paid` keeps the overage | **backend gap** |
| 3 | Part payment → `part_paid`, clearing → `cleared` | `reconcileInvoice()` | `:816` / `:1979` derive `"paid"` / `"partial"` from the money | **backend has it** (names differ) |
| 4 | Every payment posts a balanced double entry | `postEntry()` | `:1985-1996` posts DR 1020 / CR 4000; `test_school_fees.py:63` asserts it balances — **but only on `/pay-with-journal`. `/fee-invoices/{id}/pay` at `:807` posts nothing** | **modelled differently** |
| 5 | Waiver reduces the charge | we reduced `amount_due` | `:919` reduces `balance` and increments `discount_amount`, keeping `amount_due` as the face value | **modelled differently** — theirs is better; adopted in Phase 1 |
| 6 | Re-approving a waiver is a no-op | `applied` flag | `:908` sets `status='approved'` unconditionally, then `:919` applies the discount again | **backend gap** |
| 7 | Bulk generate skips pupils already invoiced | keyed `(student, class, term)` | `:793` `ON CONFLICT (student_id,term,year) DO NOTHING` | **modelled differently** — theirs is right; adopted in Phase 1 |
| 8 | Exactly one primary guardian | enforced on write | `:107` `is_primary` is a plain bool; `:449` only sorts by it. Nothing prevents two | **backend gap** |
| 9 | Grade and points derived server-side | `bandFor()` on save | `:1012-1018` looks up the band and writes `grade`/`points`; the caller cannot dictate them | **backend has it** |
| 10 | Score constrained to `0..max_score` | validated, saves nothing on failure | `:166` `score: float`, unbounded. A 900 stores; `:1014` finds no band and `grade` stays `NULL` | **backend gap** |
| 11 | Exam scale immutable once results exist | 409 with the mark count | No exam update route exists at all — searched `PUT/PATCH /exams` | **backend gap** |
| 12 | Changing a mark clears its verification | resets `verified` | `:1022` upserts `score`, `grade`, `points`, `entered_by`. The `verified` column **exists in the schema** and no route ever writes it | **backend gap** |
| 13 | `entered_by` ≠ `verified_by` | 409 unless `allowSelf` | `:1020` writes `entered_by`. `verified_by` **exists in the schema** and is never written or read by any route — dead column | **backend gap** |
| 14 | Publish blocked while any result is unverified | 409 naming the subjects | `:1331-1338` `UPDATE report_cards SET status='published'` — no checks of any kind, and `published_at` exists but is never set | **backend gap** |
| 15 | A published card's comments cannot be rewritten | 409 | No guard — searched `report_cards` updates | **backend gap** |
| 16 | One attendance record per pupil, class and date | `(student, class, date)`, upsert | `:634` `ON CONFLICT (student_id,date) DO UPDATE`. `class_id` **exists on the table** but is absent from the insert at `:631` and from the constraint | **modelled differently** — theirs cannot express a per-period register |
| 17 | Registers cannot be dated in the future | 422 | Absent — searched `body.date` comparisons | **backend gap** |
| 18 | Bands tile `0..max_score`, no gap or overlap | `validateBands()` | `:964` inserts a band with no validation. `:1014` `BETWEEN min_score AND max_score` silently returns no band for a score in a hole | **backend gap** |
| 19 | Competition ranking | `competitionRank()` | Merit list `:2327` uses `RANK() OVER (…)`, which is competition ranking. Report card position `:1254-1265` uses `fetchval` over a `GROUP BY`, returning only ever 1 or 2 | **modelled differently** — one right, one broken |
| 20 | Scale edit blocked by published cards | 409 naming the classes | Absent | **backend gap** |
| 21 | Teacher sees only assigned classes | 404, identical to nonexistent | `teacher_id` appears only on class and assignment models (`:43`, `:63`, `:339`). No route filters on it. Any authenticated tenant user reads and writes any class | **backend gap** |
| 22 | Guardian sees only their children | `guards()` on every route | Portal is per-token, so one child. No authenticated guardian surface exists — searched for a guardian login and a children route | **backend gap** |
| 23 | Guardian sees only published cards and verified marks | filtered in the backend | `:2498-2503` selects every result for the pupil, no publication or verification filter | **backend gap** |
| 24 | A token resolves to exactly one student | `token.student_id` | `:2465-2467` joins `school_guardian_tokens` to one `student_id` | **backend has it** |
| 25 | An expired token returns a state, not data | expiry state, no payload | `:2467` `AND gt.expires_at > NOW()`, 404 at `:2470` | **backend has it** |
| 26 | Token revocation | `revoked` flag | No `revoked_at` column — searched | **backend gap** |
| 27 | Defaulter aging buckets | `bucketFor()` into 0–30 / 31–60 / 61–90 / 90+ | `:861-875` returns a flat list with `days_overdue` and a `threshold_days` filter. The raw number is there; the buckets are not | **modelled differently** |
| 28 | CSV import column contract | `CSV_COLUMNS`, per-row errors with line numbers | `:2242-2264` exists and takes `full_name, date_of_birth, gender, class_name, guardian_name, guardian_phone` — the same six columns, different order. It collects `errors` per row from `start=2`, so partial import works too | **backend has it** |
| 29 | Three reminders maximum | `MAX_REMINDERS` | `:2033-2068` sends reminders; no per-invoice counter or cap | **backend gap** |
| 30 | Payment and GL posting are atomic | one operation | `:1981` `async with pool.acquire()` without `conn.transaction()`. The invoice UPDATE commits, then a GL failure raises 500 at `:1998` — money moved, ledger did not | **backend gap** |
| 31 | Waiver posts to the GL | DR bursary / CR receivable | `approve_waiver` `:900-921` posts nothing. A waived shilling leaves the fee book and never reaches the ledger | **backend gap** |
| 32 | Guardian portal returns a payload at all | works | `:2498-2499` selects `er.marks_obtained`, `er.max_marks`. The column is `score` (`:1020`, `:1241`). **Every valid link is a 500.** Same fault in the merit list at `:2329-2333` | **backend gap** |
| 33 | Session store, hydration, reset | `db()`, `resetStore()` | Exists because there is no server | **frontend-only by design** |
| 34 | Simulated latency, skeletons, empty states | `resolve()`, `UI.show()` | Presentation | **frontend-only by design** |
| 35 | Live grading preview as a mark is typed | `bandFor()` in `results.js` | A preview; rule 9 is the control | **frontend-only by design** |
| 36 | Band coverage strip | `grading-scales.js` | Visualises rule 18 | **frontend-only by design** |
| 37 | Role → navigation map | `ROLE_NAV` | Menu shape; rules 21–23 are the controls | **frontend-only by design** |
| 38 | Seeded demo dataset | `demo-data.js` | Deleted when the live backend is the only backend | **frontend-only by design** |

## What Phase 1 adopted

Rows 5 and 7: the backend's model is better and we moved to it. Row 16: the
backend's key is worse and we kept ours, recorded as schema change #13 in
`BACKEND-PATCHES.md`. Row 8: we dropped the synthesised `person_id` and match
guardians by normalised phone, because a shared guardian identity is a schema
change and not ours to invent.

| 39 | A report card can be created at all | `generateReportCards()` | `:1274` inserts `school_id`, `mean_score` and `teacher_remarks`; the table has none of those three. **Confirmed live: every `POST /report-cards` is a 500.** Missed by the static read | **backend gap** |

## Live verification, step 7

A backend was stood up from `soko-V4.2-main` (Postgres 18 on 55432, no Redis,
no SMTP/eTIMS/Anthropic keys) and seeded through its own API. The contract
suite ran against it: **16 RULE, 14 ROUTE, 12 TRANSPORT**. Six of the seven
targeted expectations were confirmed with evidence; the seventh was blocked by
row 39. See `docs/BACKEND-PATCHES.md` for the evidence and the wave order.
