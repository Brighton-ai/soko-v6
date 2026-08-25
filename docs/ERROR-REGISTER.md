# Shule — the Step 8 error register

Verbatim from the step 8 brief, kept in the repo so every commit can cite an ID
and the final report can be checked against the original wording.

# THE ERROR REGISTER

## Group 1 — Endpoints that have never executed

Confirmed live. Each returns 500 on every call.

**E1 · Guardian portal 500** — `school.py:2498`
Selects `er.marks_obtained, er.max_marks`. Neither column exists anywhere in the schema; the column is `score`, and the maximum lives on `school_exams.max_score`.
*Fixed when:* `GET /guardian-portal/{token}` with a valid token returns 200 with results.

**E2 · Merit list 500** — `school.py:2329`
Same two columns, three occurrences in one query.
*Fixed when:* `GET /exams/{id}/merit-list` returns 200 with ranked rows.

**E3 · Report card generation 500** — `school.py:1274`
`INSERT` names `school_id`, `mean_score` and `teacher_remarks`. `report_cards` has none of the three. Read the table in `schema.sql` and map to columns that exist.
*Fixed when:* `POST /report-cards` returns 201 and a row is readable back.

> After E1–E3, call each endpoint once and **report what fails next**. These paths have never run, so they have never been debugged. E10 is known to sit behind E3. Assume it is not alone.

## Group 2 — Money

**E4 · Over-payment accepted** — `school.py:1976` and `:813`
Neither payment route checks `amount` against the balance or against zero. Live proof: balance 40,999, sent 48,999, got 200, `amount_paid` 50,000 against `amount_due` 42,000 — 8,000 more received than was ever charged.
*Fixed when:* `amount <= 0` and `amount > balance` are both rejected on both routes.

**E5 · A payment destroys a bursary** — `school.py:1978` and `:815`
`new_bal = amount_due - new_paid` discards `discount_amount`. Live proof: due 42,000, waiver 5,000 → balance 37,000. Paid **one shilling** → balance 41,999. The bursary was wiped.
*Fixed when:* balance is `amount_due - amount_paid - discount_amount`, and the sequence above leaves 36,999.

**E6 · A payment route that skips the ledger** — `school.py:806`
`POST /fee-invoices/{id}/pay` is `/pay-with-journal` with the `post_journal` call absent. Live proof: paid 1,000, GL debits moved 0. Two routes exist and the shorter name silently breaks the books.
*Fixed when:* the route either delegates to the journal path or is deleted.

**E7 · Payment and ledger are not atomic** — `school.py:1981`
`pool.acquire()` with no transaction. Live proof: E4's first attempt returned 500 *after* the money moved.
*Fixed when:* both statements are inside `async with conn.transaction():` and a forced `post_journal` failure leaves the invoice untouched.

**E8 · Waiver applies twice** — `school.py:900`
No status check before applying. Live proof: approve once → discount 7,000; approve again → 9,000.
*Fixed when:* the second call is a no-op and says so.

**E9 · Waivers never reach the ledger**
The payment path posts to the GL. The waiver path does not. Bursaries are invisible in the accounts.
*Fixed when:* approval posts DR bursary expense / CR fees receivable.

## Group 3 — Academics

**E10 · Class position is only ever 1 or 2** — `school.py:1254`
`GROUP BY er2.student_id` under `fetchval` returns the first group, where `COUNT(DISTINCT student_id)` is always 1. Also unscoped by class — it compares against every pupil in the tenant.
*Fixed when:* positions in a class of 44 span the class, ties share a rank, and the next rank skips.

**E11 · No score validation** — `school.py:166`
`ResultIn.score` is a bare `float`. 5,000 and −20 both save.
*Fixed when:* out-of-range scores are rejected against that exam's `max_score`.

**E12 · Holed grading scales save silently**
No tiling validation. A scale with a gap stores `NULL` grade for a score that falls through, with no error.
*Fixed when:* a scale not covering `0..max_score` is refused, naming the gap.

**E13 · Verification does not exist**
`grep -c verified routers/school.py` returns **0**. `verified` and `verified_by` are in `school_exam_results` and nothing reads or writes them.
*Fixed when:* a verify route exists, `entered_by != verified_by` is enforced server-side, and `verified_at` is stamped.

**E14 · Publish has no checks** — `school.py:1331`
A bare `UPDATE report_cards SET status='published'`. No unverified gate, no `published_at`, no immutability after.
*Fixed when:* publishing is refused while any feeding result is unverified, and the response names the subjects.

**E15 · Editing a mark keeps its verification** — `school.py:1022`
The upsert sets score, grade, points, comment and `entered_by`, and leaves `verified` alone.
*Fixed when:* changing a score clears verification.

## Group 4 — Access control

**E16 · No teacher scoping anywhere**
Zero role checks in the entire router. Any authenticated user in the tenant can read and write any class's registers and marks.
*Fixed when:* a teacher is refused on a class they don't teach, with **404 — not 403**, since a 403 confirms the class exists.

**E17 · No parent-scoped routes**
The only parent surface is the token portal. Nothing scopes a logged-in guardian to their own children.
*Fixed when:* routes exist and return only that guardian's children.

**E18 · Cross-tenant write on grading bands**
`POST /grading-scales/{id}/bands` has no tenant check, and `school_grading_bands` has no `tenant_id` column. Any authenticated user can add a band to any school's scale — changing how another school's pupils are graded.
*Fixed when:* the parent scale's tenant is verified before insert, proven by a cross-tenant test.

**E19 · Unverified parent resource on two writes**
`/students/{id}/guardians` and `/students/{id}/discipline` stamp the caller's tenant onto a student they may not own.
*Fixed when:* both verify the student's tenant first.

## Group 5 — Multi-tenancy blockers

These prevent a second school existing. They outrank everything above.

**E20 · One M-Pesa paybill for the whole platform** — `mpesa.py:35-43`
Credentials are read once at import from environment variables. Every school's fees land in the same shortcode with nothing to separate them. The defaults are Safaricom's public sandbox values — shortcode `174379` and the well-known test passkey — so an unconfigured production deploy runs against sandbox and appears to work.
*Fixed when:* credentials resolve per tenant per request from the `integrations` table, sandbox defaults are gone, and missing credentials fail loudly.

**E21 · No registration route**
`auth.py` has login, refresh, forgot, reset, 2FA and Google OAuth. There is no signup. Nobody can create an account.
*Fixed when:* `POST /api/auth/register` creates tenant, owner and role in one transaction, with email verification and IP rate limiting.

**E22 · A new tenant is paywalled out** — `shared.py:271`
`require_module("school")` returns 402 until someone grants the module by hand. A school that signs up hits a paywall for the product it just bought.
*Fixed when:* registration activates the school module in a trial state with an end date.

## Group 6 — Schema and data

**E23 · Per-period attendance is impossible** — `schema.sql`
`UNIQUE(student_id, date)` allows one record per pupil per day, and `class_id` is not on the insert. A secondary school marking a register each lesson cannot.
*Fixed when:* the key is `(student_id, class_id, date)` via migration.

**E24 · No token revocation**
`school_guardian_tokens` is `(id, tenant_id, student_id, token, expires_at, created_at)`. A leaked link works until it expires.
*Fixed when:* `revoked_at` exists, a revoke route exists, and the portal honours it.

**E25 · Portal balance ignores discounts** — `school.py:2477`
Computes `amount_due - amount_paid` instead of reading `balance`, so a waived invoice shows a parent a balance the bursary already cleared.
*Fixed when:* the portal shows the same figure as the invoice.

## Group 7 — Test integrity

**E26 · 12 TRANSPORT failures**
Adapter shape mismatches: `getMarkSheet` returns a raw result list rather than `{roll, scale}`; bands are read as `min`/`max` against the backend's `min_score`/`max_score`. Those contract tests currently prove nothing about production.
*Fixed when:* all 12 pass or fail as RULE, not TRANSPORT.

**Fix E26 first.** Until it is fixed, a green live run means less than its test count suggests.

**E27 · The numbers disagree between reports**
Step 7 reported `npm run test:app` at **628 tests, 109 suites**. The latest summary reports **182 app tests**, 93 static, 44 contract — 319 total. Separately, the backend gap count has been reported as 15, as 13-plus-6-modelled-differently, and as 22 rules that exist only in the demo backend.
These are the numbers the whole review loop runs on. One of the counts is wrong, or they are counting different things.
*Fixed when:* a single command prints the authoritative figure for each suite, the summary matches it, and any earlier figure is corrected in writing rather than quietly replaced.

## Group 8 — Things that work but don't scale

**E28 · Report cards publish one HTTP call at a time**
No bulk publish endpoint exists, so a class of 44 is 44 requests. A whole school at end of term is thousands, with no transaction around them — a partial failure leaves half a class published.
*Fixed when:* a bulk route publishes a class in one call, atomically, and the page uses it.

**E29 · CSV import preview is client-side only**
The dry-run runs in the browser. The server has no dry-run route, so the preview can accept rows the server will reject — the bursar sees "412 rows OK" and gets errors on submit.
*Fixed when:* a server-side dry-run route exists and the preview calls it.

---

# MISSING SURFACES

Not errors — things that were never built.

**M1 · Platform console** — `app/platform/`, gated on `is_super_admin`. `superadmin.py` already backs it with 13 routes: `/check`, `/stats`, `/tenants`, suspend, activate, `/users`, user status, promote, `/activity`, `/system-health`, per-tenant `/modules`, `/apply-vertical`.
Screens: overview; every registered school with plan, pupils, users and last activity; **integration status across all schools on one page**; user search across tenants; the audit feed; revenue by tenant. Read plans from `subscriptions.py` — `subscription_plans` is not in the schema — and say so rather than inventing figures.
Two rules: every destructive action confirmed and audited, and nothing on this console writes to a school's academic or financial records.

**M2 · Tenant integrations** — the `integrations` table already exists as `(tenant_id, provider, status, config, last_sync)` and only `growth.py` uses it. Connect, test, disconnect per provider: M-Pesa, SMS, SMTP, eTIMS. `config` encrypted at rest, secrets never returned — masked prefix and status only. A test button that reports the real Daraja error, not "something went wrong."

**M3 · API keys** — `api_keys` exists as `(tenant_id, name, key_hash, key_prefix, scopes, is_active, last_used_at, expires_at)` and is unused. Issue, list, revoke. Show the key once, store only the hash.

**M4 · School settings** — `app/settings/`: profile, users (on `settings/users/invite`), integrations, API keys, billing (`/subscription`, `/plans`, `/upgrade`, `/addons/activate`), notification preferences. For the M-Pesa connection, write the four Daraja values and where to find them inline on the page — a bursar will not open a help doc.

**M5 · Ten modules marked `data-step="later"`**
Classes & streams, teachers, timetable editing, boarding, transport, library, announcements, events, reports, settings. Marking them honestly in the nav was right. But three of them — **boarding, transport and library** — are sold on `pricing.html` as priced add-ons at KES 40, 30 and 20 per term.

Do not build them in this step. Instead, do the five-minute version now: **remove boarding, transport and library from the pricing page and the features page, or label them clearly as roadmap with no price attached.** A price on a product that does not exist is the one defect here that is a commercial problem rather than a technical one.

Then list the ten in `docs/ROADMAP.md` with a rough size for each, so the build order is a decision rather than a surprise.

---

# ORDER

Each is a commit gate. Stop and report at the end of each.

0. **E27** — pin down the real test and rule counts before anything else. Every gate below is judged on them.
1. **E26** — so the suite can be trusted
2. **M5's pricing fix** — five minutes, and it stops you selling three things that don't exist
3. **E1, E2, E3** — plus whatever is behind them
4. **E4–E9** — money
5. **E10–E15** — academics
6. **E16–E19** — access control, with a permanent cross-tenant fixture
7. **E20–E22** — multi-tenancy. Gate: two tenants created through signup, each with its own paybill, and a payment against one invisible from the other. Prove it.
8. **E23–E25, E28, E29** — migrations and the two scale defects
9. **M1–M4** — surfaces, then `docs/ROADMAP.md` for M5

---

# MUTATION CHECKS

Same discipline as the previous steps. Break each, confirm a legible failure, restore:

- Teacher scoping returns every class
- Tenant check dropped from grading bands
- Over-payment guard removed
- Publish skips the unverified check
- Registration skips email verification
- Credential lookup falls back to the environment instead of the tenant

---

# REPORT

Fill in every row.

| ID | Status | Evidence |
|----|--------|----------|
| E1 … E29 | fixed / not fixed / not reachable | the command run and what came back |

Then two sections:

**Found behind the dead endpoints** — every fault that only became visible once E1, E2 and E3 stopped crashing.

**Still not sellable because** — M-Pesa untested against Daraja sandbox, the nightly scheduler never run live, no load testing beyond 240 pupils, backup restore never rehearsed, no monitoring, Kenyan data protection unresolved. Add whatever you hit that is not on that list.



