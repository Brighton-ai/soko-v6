# Shule — the `school.py` patch set

**Revised after a live run.** A SokoOS backend was stood up from
`soko-V4.2-main` against Postgres, seeded with a contract tenant through its own
API, and the contract suite was run against it. Where the running system
disagreed with the static read, the live result wins and the entry says so.

Line references are from `soko-V4.2-main/backend/routers/school.py` (2,584
lines), mounted at `/api/school` by `main.py:398`.

**These are not applied.** That repo is not in this workspace.

## What the live run showed

| Bucket | Count | Meaning |
|---|---|---|
| **RULE** | 16 | The route works and the backend does not enforce the rule |
| **ROUTE** | 14 | No such endpoint exists |
| **TRANSPORT** | 12 | Our adapter's request or response shape, or the seed — not a backend fault |

Six of the seven targeted expectations were **confirmed with live evidence**.
The seventh could not be reached because a bug the static read missed blocks it.
Two entries changed: **#5 is worse than written**, and a **new #15** was found.

### Confirmed live

| # | Expectation | Result |
|---|---|---|
| 1 | Portal 500s on a valid token | **CONFIRMED** — issued a token (200), then `GET /guardian-portal/{token}` → **500** |
| 2 | Merit list 500s | **CONFIRMED** — `GET /exams/{id}/merit-list` → **500** |
| 3 | Class position only 1 or 2 | **NOT REACHABLE** — `POST /report-cards` is itself a 500 (see #15) |
| 4 | `/pay` posts nothing to the GL | **CONFIRMED** — paid 1,000, HTTP 200, GL debits moved **0** |
| 5 | Over-payment accepted | **CONFIRMED, and worse** — see below |
| 6 | A payment wipes the waiver | **CONFIRMED** — 5,000 bursary, then paid **1 shilling**; balance rose 37,000 → 41,999 |
| 7 | Double approval applies twice | **CONFIRMED** — discount 7,000 → 9,000 on the second click of a 2,000 waiver |

### #5 is worse than the static read suggested

The first attempt returned **HTTP 500**, not 200 — but the money had already
moved. The invoice read `amount_due 42,000, amount_paid 50,000, balance 0,
status paid` while the caller saw a 500 saying *"Payment recorded, but failed to
post to the ledger."*

That is patch **#10 (non-atomicity) firing in production conditions**: the
invoice `UPDATE` at `:1983` committed, `post_journal` raised, and nothing rolled
back. With the chart of accounts seeded the same call returns a clean **200**
with `amount_paid 50,000` against `amount_due 42,000` — the school's books now
show **8,000 more received than was ever charged**.

So over-payment and non-atomicity are not two independent bugs. Either one alone
is bad; together, a failed GL posting hands the caller an error for a payment
that was kept.

---

## 1. Guardian portal returns 500 on every valid link — `school.py:2498`

**Rule 32.** The portal query selects `er.marks_obtained` and `er.max_marks`.
Neither column exists: results are written to `score` at `:1020` and read as
`er.score` at `:1241`. Every guardian who follows an SMS link gets a 500.

The same fault is in the merit list at `:2329-2333`, so the ranked list of a
whole exam is dead too.

This is first because it is the only entry where the feature does not work at
all, and because the person who hits it is a parent with no way to report it.

```diff
--- a/backend/routers/school.py
+++ b/backend/routers/school.py
@@ -2496,7 +2496,7 @@ async def guardian_portal(token: str, request: Request = None):
     exam_rows = await pool.fetch(
-        """SELECT e.name AS exam, sub.name AS subject, er.marks_obtained, er.max_marks
+        """SELECT e.name AS exam, sub.name AS subject, er.score, er.grade
            FROM school_exam_results er
            JOIN school_exams e ON e.id = er.exam_id
            LEFT JOIN school_subjects sub ON sub.id = er.subject_id
@@ -2327,9 +2327,9 @@ async def exam_merit_list(...):
-               COALESCE(SUM(er.marks_obtained), 0) AS total_marks,
-               COALESCE(AVG(er.marks_obtained), 0) AS average_marks,
+               COALESCE(SUM(er.score), 0) AS total_marks,
+               COALESCE(AVG(er.score), 0) AS average_marks,
                COUNT(er.id) AS subjects_sat,
-               RANK() OVER (ORDER BY COALESCE(SUM(er.marks_obtained),0) DESC) AS rank
+               RANK() OVER (ORDER BY COALESCE(SUM(er.score),0) DESC) AS rank
```

---

## 2. The portal serves unverified and unpublished marks — `school.py:2498`

**Rules 23, 14.** Once patch 1 makes the query run, it returns *every* result
for the pupil. There is no publication gate and no verification gate — the
columns for one do not exist yet (patch 8).

Until patch 8 lands, gate on publication alone. That is a smaller claim than
"verified", and it is the one the schema can already make.

```diff
@@ -2496,6 +2496,9 @@ async def guardian_portal(token: str, request: Request = None):
     exam_rows = await pool.fetch(
         """SELECT e.name AS exam, sub.name AS subject, er.score, er.grade
            FROM school_exam_results er
            JOIN school_exams e ON e.id = er.exam_id
+           JOIN report_cards rc ON rc.student_id = er.student_id
+                               AND rc.exam_id   = er.exam_id
+                               AND rc.status    = 'published'
            LEFT JOIN school_subjects sub ON sub.id = er.subject_id
            WHERE er.tenant_id=$1 AND er.student_id=$2
```

A parent reading a mark nobody has checked is the failure a school cannot
retract. It is worth shipping the weaker gate now and tightening it with
patch 8.

---

## 3. Class position is only ever 1 or 2 — `school.py:1254`

**Rule 19.** `fetchval` returns the first column of the *first row*. The query
groups by `er2.student_id`, so each group is one pupil and
`COUNT(DISTINCT er2.student_id) + 1` is always `2`. Every pupil who is not top
of the class is told they are second. It is also not scoped to a class — the
`HAVING` runs across the whole tenant for the term.

A head teacher spots this on the first report card they read.

```diff
@@ -1251,17 +1251,20 @@ async def generate_report_card(...):
     if body.term_id:
         class_position_row = await pool.fetchval(
-            """SELECT COUNT(DISTINCT er2.student_id) + 1 AS pos
-               FROM school_exam_results er2
-               JOIN school_exams e2 ON e2.id = er2.exam_id
-               WHERE er2.tenant_id=$1 AND e2.term_id=$2
-                 AND er2.student_id != $3
-               GROUP BY er2.student_id
-               HAVING AVG(er2.score) > $4""",
-            tid, body.term_id, body.student_id, mean_score,
+            """SELECT COUNT(*) + 1
+               FROM (
+                   SELECT er2.student_id, AVG(er2.score) AS avg_score
+                   FROM school_exam_results er2
+                   JOIN school_exams e2 ON e2.id = er2.exam_id
+                   JOIN school_students s2 ON s2.id = er2.student_id
+                   WHERE er2.tenant_id=$1 AND e2.term_id=$2
+                     AND s2.class_id=$3 AND er2.student_id != $4
+                   GROUP BY er2.student_id
+               ) peers
+               WHERE peers.avg_score > $5""",
+            tid, body.term_id, class_id, body.student_id, mean_score,
         )
```

`COUNT(peers with a higher average) + 1` is competition ranking: ties share a
position and the ranks they consume are skipped.

---

## 4. No teacher scoping anywhere — every route

**Rule 21.** `teacher_id` appears on the class and assignment models (`:43`,
`:63`, `:339`) and on nothing else. No route filters by it. Any authenticated
user in the tenant can read and write any class's registers and marks.

This is the largest entry and the one most likely to be discovered by accident
rather than reported.

Add a dependency and apply it to the register and mark-entry routes:

```diff
+async def scoped_class_ids(pool, tid: str, user: dict) -> set[str] | None:
+    """Class ids this user may touch. None means unrestricted (admin/head)."""
+    if user.get("role") in ("admin", "head", "bursar"):
+        return None
+    rows = await pool.fetch(
+        """SELECT DISTINCT class_id FROM school_subject_assignments
+           WHERE tenant_id=$1 AND teacher_id=$2
+           UNION
+           SELECT id FROM school_classes
+           WHERE tenant_id=$1 AND class_teacher_id=$2""",
+        tid, user["id"],
+    )
+    return {str(r["class_id"]) for r in rows}
+
+
+async def require_class(pool, tid, user, class_id):
+    allowed = await scoped_class_ids(pool, tid, user)
+    if allowed is not None and str(class_id) not in allowed:
+        # 404, not 403: a 403 confirms the class exists
+        raise HTTPException(404, "Class not found")

@@ -624,6 +624,7 @@ async def mark_attendance(body: BulkAttendanceIn, ...):
     tid  = current_user["tenant_id"]
     uid  = current_user["id"]
+    await require_class(pool, tid, current_user, body.class_id)
     count = 0

@@ -1000,6 +1001,7 @@ async def save_exam_results(id: UUID, body: BulkResultsIn, ...):
     tid = current_user["tenant_id"]
+    await require_class(pool, tid, current_user, body.class_id)
```

Return 404 rather than 403. A 403 that says "you do not teach Grade 6 East"
confirms Grade 6 East exists, which is information the caller had not earned.

---

## 5. No over-payment guard — `school.py:1976` and `:813`

**Rules 2, 1.** `amount = float(body.get("amount", inv["balance"]))` is used
unchecked. `:818` clamps `balance` to zero but `amount_paid` keeps the whole
figure, so the identity breaks and the GL is credited with money the school
never had to receive.

`:1978` also computes `amount_due − amount_paid` and ignores `discount_amount`,
so **the first payment after a waiver silently resurrects the waived amount**.

```diff
@@ -1974,9 +1974,15 @@ async def pay_fee_invoice_with_journal(...):
     if not inv: raise HTTPException(404, "Invoice not found")
-    amount   = float(body.get("amount", inv["balance"]))
+    amount   = float(body.get("amount", inv["balance"]))
+    if amount <= 0:
+        raise HTTPException(422, "Enter a payment amount greater than zero.")
+    if amount > float(inv["balance"]) + 0.01:
+        raise HTTPException(
+            422,
+            f"That is more than the outstanding balance of {inv['balance']}. "
+            "A payment cannot exceed what is owed.",
+        )
     new_paid = float(inv["amount_paid"]) + amount
-    new_bal  = float(inv["amount_due"]) - new_paid
+    new_bal  = float(inv["amount_due"]) - new_paid - float(inv["discount_amount"] or 0)
     status   = "paid" if new_bal <= 0.01 else "partial"
```

Apply the identical change to `pay_fee_invoice` at `:807-818`.

---

## 6. `approve_waiver` is not idempotent — `school.py:900`

**Rule 6.** `:908` sets `status='approved'` unconditionally and `:919` applies
the discount again. A double-clicked button waives the bursary twice, and there
is no record that it happened.

```diff
@@ -903,6 +903,11 @@ async def approve_waiver(id: UUID, ...):
     waiver = await pool.fetchrow("SELECT * FROM school_fee_waivers WHERE id=$1 AND tenant_id=$2", id, tid)
     if not waiver: raise HTTPException(404, "Waiver not found")
+    if waiver["status"] == "approved":
+        return success(None, "That waiver was already approved and applied; nothing changed.")
+    if waiver["status"] == "rejected":
+        raise HTTPException(409, "That waiver was rejected. Reopen it before approving.")
+
     await pool.execute(
```

Status is enough here only because `approve_waiver` is the sole writer. If a
second path ever applies a discount, add an `applied_at timestamptz` and key on
that instead — status alone cannot tell "approved" from "approved and applied".

---

## 7. Publish has no checks at all — `school.py:1331`

**Rules 14, 15.** `UPDATE report_cards SET status='published'` and nothing
else. No verification gate, no re-publication guard, no `published_at`.

```diff
@@ -1331,10 +1331,26 @@ async def publish_report_card(id: UUID, ...):
     pool = request.app.state.db
     tid  = current_user["tenant_id"]
+    card = await pool.fetchrow(
+        "SELECT * FROM report_cards WHERE id=$1 AND tenant_id=$2", id, tid)
+    if not card: raise HTTPException(404, "Report card not found")
+    if card["status"] == "published":
+        raise HTTPException(409, "That card is already published.")
+
+    # once patch 8 lands, this is the gate that keeps unchecked marks off a card
+    unverified = await pool.fetch(
+        """SELECT sub.name FROM school_exam_results er
+           LEFT JOIN school_subjects sub ON sub.id = er.subject_id
+           WHERE er.tenant_id=$1 AND er.student_id=$2 AND er.exam_id=$3
+             AND er.verified_at IS NULL""",
+        tid, card["student_id"], card["exam_id"])
+    if unverified:
+        names = ", ".join(r["name"] or "?" for r in unverified)
+        raise HTTPException(
+            409, f"Cannot publish: these subjects are not verified — {names}.")
+
     r = await pool.fetchrow(
-        "UPDATE report_cards SET status='published' WHERE id=$1 AND tenant_id=$2 RETURNING *",
+        "UPDATE report_cards SET status='published', published_at=NOW() "
+        "WHERE id=$1 AND tenant_id=$2 RETURNING *",
         id, tid,
     )
```

Name the subjects. "Publish is greyed out" is not something a class teacher can
act on.

---

## 8. Verification does not exist — feature, not a patch

**Rules 12, 13, 14.** `entered_by` is written at `:1020`. There is no
`verified`, no `verified_by`, no `verified_at`, and no verify route. Entry and
verification being separate steps is currently a naming convention.

Scope this separately. It is the largest of the fourteen and it gates patch 7's
full form.

```sql
ALTER TABLE school_exam_results
    ADD COLUMN verified_at  timestamptz,
    ADD COLUMN verified_by  uuid REFERENCES users(id);
```

```python
@school_router.post("/exams/{id}/results/verify")
async def verify_exam_results(
    id: UUID, request: Request, body: dict,
    current_user: dict = Depends(get_current_user),
):
    pool, tid, uid = request.app.state.db, current_user["tenant_id"], current_user["id"]
    rows = await pool.fetch(
        """SELECT id, entered_by FROM school_exam_results
           WHERE tenant_id=$1 AND exam_id=$2 AND class_id=$3
             AND ($4::uuid IS NULL OR subject_id=$4) AND verified_at IS NULL""",
        tid, id, body["class_id"], body.get("subject_id"))
    if not rows:
        raise HTTPException(422, "Nothing here is waiting on verification.")
    if any(str(r["entered_by"]) == str(uid) for r in rows):
        raise HTTPException(
            409, "Those marks were entered by the same person who is verifying them. "
                 "Ask a head of department to sign them off.")
    await pool.execute(
        "UPDATE school_exam_results SET verified_at=NOW(), verified_by=$1 WHERE id = ANY($2::uuid[])",
        uid, [r["id"] for r in rows])
    return success({"verified": len(rows)})
```

And in `save_exam_results` at `:1022`, a changed mark must lose its signature:

```diff
                ON CONFLICT (exam_id,student_id,subject_id) DO UPDATE
-               SET score=$6, grade=$7, points=$8, teacher_comment=$9, entered_by=$10""",
+               SET score=$6, grade=$7, points=$8, teacher_comment=$9, entered_by=$10,
+                   verified_at=NULL, verified_by=NULL""",
```

A new number has not been checked by anyone.

---

## 9. No score range validation — `school.py:166`

**Rule 10.** `score: float` is unbounded. A mistyped 900 stores, `:1014`
`BETWEEN min_score AND max_score` finds no band, and `grade` is silently
`NULL` — which then flows into a mean, a position and a report card.

```diff
@@ -163,7 +163,7 @@ class ResultIn(BaseModel):
     student_id: str
     subject_id: str
-    score: float
+    score: float = Field(..., ge=0)
     teacher_comment: Optional[str] = None
```

`ge=0` is what Pydantic can do alone; the upper bound depends on the exam, so
check it in the route where `exam["max_score"]` is in hand:

```diff
@@ -1008,6 +1008,12 @@ async def save_exam_results(id: UUID, body: BulkResultsIn, ...):
+    out_of = float(exam["max_score"] or 100)
+    bad = [r for r in body.results if not (0 <= r.score <= out_of)]
+    if bad:
+        raise HTTPException(
+            422,
+            f"{len(bad)} marks are outside 0–{out_of:g}. Nothing was saved.")
+
     for res in body.results:
```

Reject the whole sheet. Saving the good rows and dropping the bad ones leaves a
teacher believing they entered a full class.

---

## 10. Payment and ledger posting are not atomic — `school.py:1981`

**Rule 30.** `async with pool.acquire() as conn:` takes a connection but opens
no transaction, so asyncpg autocommits each statement. The invoice UPDATE at
`:1983` commits, `post_journal` fails, and `:1998` raises a 500 having already
moved the money. The fee book says paid; the ledger says nothing.

```diff
@@ -1981,7 +1981,7 @@ async def pay_fee_invoice_with_journal(...):
-    async with pool.acquire() as conn:
+    async with pool.acquire() as conn, conn.transaction():
         r = await conn.fetchrow(
```

One line. `test_school_fees.py:63` asserts the GL balances after a payment; it
does not assert that a failed posting rolls the payment back.

---

## 11. Waivers never reach the ledger — `school.py:900-921`

**Rule 31.** `approve_waiver` updates two tables and calls no journal. A waived
shilling leaves the fee book and appears nowhere in the accounts, so bursary
spend is invisible at year end.

```diff
@@ -919,6 +919,17 @@ async def approve_waiver(id: UUID, ...):
         await pool.execute(
             "UPDATE school_fee_invoices SET balance=$1,discount_amount=discount_amount+$2,status=$3 WHERE id=$4 AND tenant_id=$5",
             new_bal, waiver["amount"], status, waiver["invoice_id"], tid,
         )
+        from shared import post_journal
+        async with pool.acquire() as conn, conn.transaction():
+            await post_journal(
+                conn, tid, date.today(),
+                f"Fee waiver approved - {waiver['id']}",
+                [
+                    {"account_code": "5300", "debit": float(waiver["amount"]), "credit": 0,
+                     "description": "Bursaries and waivers"},
+                    {"account_code": "1200", "debit": 0, "credit": float(waiver["amount"]),
+                     "description": "Fees receivable"},
+                ],
+                source_type="school_fee_waiver", source_id=str(waiver["id"]),
+            )
```

---

## 12. No band tiling validation — `school.py:964`

**Rule 18.** Bands are inserted one at a time with no check that they cover the
range. A school that defines 0–39, 40–49, 51–59 has a hole at 50, and `:1014`
returns no band for a pupil who scores it — `grade` becomes `NULL` and the
report card renders a blank where a grade belongs.

Validate the whole set on write, not band by band:

```python
async def _assert_bands_tile(pool, scale_id, max_score: float):
    bands = await pool.fetch(
        "SELECT grade,min_score,max_score FROM school_grading_bands "
        "WHERE scale_id=$1 ORDER BY min_score", scale_id)
    if not bands:
        raise HTTPException(422, "A scale needs at least one band.")
    if float(bands[0]["min_score"]) != 0:
        raise HTTPException(422, f"Scores 0 to {bands[0]['min_score']} have no grade.")
    for prev, cur in zip(bands, bands[1:]):
        gap_from = float(prev["max_score"]) + 1
        if float(cur["min_score"]) > gap_from:
            raise HTTPException(
                422, f"Gap between {prev['grade']} and {cur['grade']}: "
                     f"scores {gap_from:g} to {float(cur['min_score']) - 1:g} have no grade.")
        if float(cur["min_score"]) < gap_from:
            raise HTTPException(
                422, f"Overlap between {prev['grade']} and {cur['grade']}.")
    if float(bands[-1]["max_score"]) != max_score:
        raise HTTPException(422, f"Scores above {bands[-1]['max_score']} have no grade.")
```

Call it at the end of band creation at `:964` and of the seed at `:2411`. Name
the score that falls through — "invalid bands" tells a head nothing.

---

## 13. `UNIQUE(student_id, date)` blocks per-period registers — schema change

**Rule 16.** `:634` upserts on `(student_id, date)`, and the insert at `:631`
does not carry `class_id` at all. A pupil can therefore have exactly one
attendance mark per day across the whole school.

That is fine for a primary school taking one morning register. A secondary
school marking attendance per period cannot use it: the second period of the
day overwrites the first, and the day's record becomes whichever teacher
marked last.

We kept our `(student, class, date)` key rather than degrading to match.

```sql
ALTER TABLE school_attendance
    ADD COLUMN class_id uuid REFERENCES school_classes(id);

UPDATE school_attendance a
   SET class_id = s.class_id
  FROM school_students s
 WHERE s.id = a.student_id AND a.class_id IS NULL;

ALTER TABLE school_attendance
    DROP CONSTRAINT school_attendance_student_id_date_key,
    ADD CONSTRAINT school_attendance_student_class_date_key
        UNIQUE (student_id, class_id, date);
```

```diff
@@ -631,8 +631,8 @@ async def mark_attendance(body: BulkAttendanceIn, ...):
             """INSERT INTO school_attendance
-               (tenant_id,school_id,student_id,date,status,notes,marked_by)
-               VALUES ($1,$2,$3,$4,$5,$6,$7)
-               ON CONFLICT (student_id,date) DO UPDATE
+               (tenant_id,school_id,student_id,class_id,date,status,notes,marked_by)
+               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
+               ON CONFLICT (student_id,class_id,date) DO UPDATE
```

Also add a future-date check (rule 17) while the route is open:

```diff
+    if body.date > date.today():
+        raise HTTPException(422, "A register cannot be marked ahead of the day.")
```

---

## 14. Tokens cannot be revoked — `school_guardian_tokens`

**Rule 26.** `:2467` checks `expires_at > NOW()` and nothing else. There is no
`revoked_at`, so a link sent to the wrong number stays live for its full 90
days (`:2447`) and the only remedy is to wait.

```sql
ALTER TABLE school_guardian_tokens
    ADD COLUMN revoked_at timestamptz;
```

```diff
@@ -2465,7 +2465,7 @@ async def guardian_portal(token: str, ...):
            FROM school_guardian_tokens gt
            JOIN school_students s ON s.id = gt.student_id
-           WHERE gt.token = $1 AND gt.expires_at > NOW()""",
+           WHERE gt.token = $1 AND gt.expires_at > NOW() AND gt.revoked_at IS NULL""",
```

```python
@school_router.post("/guardian-tokens/{token}/revoke")
async def revoke_guardian_token(token: str, request: Request,
                                current_user: dict = Depends(get_current_user)):
    pool, tid = request.app.state.db, current_user["tenant_id"]
    r = await pool.execute(
        "UPDATE school_guardian_tokens SET revoked_at=NOW() "
        "WHERE token=$1 AND tenant_id=$2 AND revoked_at IS NULL", token, tid)
    if r.endswith("0"):
        raise HTTPException(404, "Token not found or already revoked")
    return success(None, "Link withdrawn")
```

`:2470` currently answers 404 for both unknown and expired tokens, so the
client cannot distinguish them — our portal shows one combined message on live.
Splitting that is cosmetic and not worth a patch of its own; fold it in here if
the response shape is being touched anyway.

---

## What this does not cover

Three rules our demo enforces have **no backend route to patch**, and closing
them is new surface rather than a fix. They are listed here so the gap is not
mistaken for an oversight:

| Rule | What is missing | Note |
|---|---|---|
| 8 | One primary guardian per pupil, and a shared guardian identity across siblings | `is_primary` is a plain bool (`:107`). A `guardians` table with a person key and a join table is the real fix; until then a client can only match on phone number, which is what ours does |
| 22 | An authenticated guardian surface | Only the per-token portal exists. "My children" needs a guardian login and a children route |
| 27 | Defaulter aging buckets | `/defaulters` (`:861`) returns `days_overdue`; bucketing it into 0–30 / 31–60 / 61–90 / 90+ is a `CASE` in that query |

## Suggested order of work

| Wave | Patches | Why |
|---|---|---|
| Hotfix | 1, 3 | Both are wrong output a customer sees. One line and one query |
| Trust | 2, 4, 7 | Parents seeing data they should not, and staff reaching classes they should not |
| Money | 5, 10, 6, 11 | The identity, atomicity, idempotency, and the missing ledger leg |
| Correctness | 9, 12 | Bad data at the point of entry |
| Schema | 8, 13, 14 | Migrations; schedule with a release |

---

## 15. Report card creation is a 500 — `school.py:1274` — NEW, found live

**Rule 19, and everything downstream of it.** The static read did not catch
this. `create_report_card` inserts three columns that do not exist:

| Inserted | Actual column |
|---|---|
| `school_id` | *(no such column on `report_cards`)* |
| `mean_score` | `average_marks` |
| `teacher_remarks` | `teacher_comment` |

```
asyncpg.exceptions.UndefinedColumnError:
    column "school_id" of relation "report_cards" does not exist
    at school.py:1274, in create_report_card
```

**Every report card generation is a 500.** No card can be created, so none can
be published, and the class-position bug at `:1254` cannot even be reached to
observe. This ranks with #1: a whole feature that has never run.

```diff
@@ -1274,10 +1274,10 @@ async def create_report_card(...):
     r = await pool.fetchrow(
         """INSERT INTO report_cards
-           (tenant_id, student_id, school_id, term_id, academic_year, term_number,
-            total_marks, mean_score, class_position, teacher_remarks, status)
-           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft') RETURNING *""",
-        tid, body.student_id, str(school_id),
+           (tenant_id, student_id, class_id, term_id, academic_year, term_number,
+            total_marks, average_marks, class_position, teacher_comment, status)
+           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft') RETURNING *""",
+        tid, body.student_id, body.class_id,
```

`report_cards` already carries `class_size` and `published_at` — both unwritten.
Patches #3 and #7 should fill them while this INSERT is open.

---

## Corrections to the static read

| Entry | Static read said | Live run showed |
|---|---|---|
| #5 | Over-payment accepted (200) | Accepted — but the **first** call 500s while keeping the money, because #10 fires first. The two are one failure in practice |
| #8 | `verified` / `verified_by` do not exist | **They exist in the schema** and are never written or read by any route. The migration in #8 is smaller than written: add `verified_at` only, then wire up the columns already there |
| #13 | Add `class_id` to `school_attendance` | **`class_id` already exists.** Only the `UNIQUE(student_id, date)` constraint and the INSERT at `:631` need changing |
| #7 | Add `published_at` | **Already exists**, along with `class_position` and `class_size`. Only the writes are missing |
| — | — | **New #15**: report card creation has never worked |

## Waves, by what a customer sees

### Wave 1 — visible to a parent or a head teacher in week one

| # | Entry | Why it is first |
|---|---|---|
| 1 | Guardian portal 500 | Every SMS link a parent follows is a 500. They cannot report it and nobody sees it |
| 15 | Report card creation 500 | The whole report-card feature has never run |
| 2 | Portal serves unpublished marks | Once #1 lands, unchecked marks reach parents unless this lands with it |
| 3 | Class position only 1 or 2 | A head teacher reads "Position 2 of 44" with two pupils ahead on their first card |
| 7 | Publish has no checks | Draft cards go out; published ones can be silently rewritten |

`#1` and `#15` are column-name fixes: two queries and one INSERT.

### Wave 2 — silent money errors

| # | Entry | Why it is silent |
|---|---|---|
| 5 | No over-payment guard | The books show more received than charged. Nothing warns |
| 10 | Payment and GL not atomic | Money moves, the ledger does not, the caller sees a 500. **Confirmed live** |
| 6 | Waiver not idempotent | A double-click waives twice. **Confirmed live** |
| 4 | No teacher scoping | Any tenant user reads and writes any class |
| 11 | Waivers never reach the GL | Bursary spend is invisible at year end |
| — | **Waiver wiped by the next payment** (`:1978`) | **Confirmed live** — a 5,000 bursary vanished when 1 shilling was paid. Folded into #5's diff |

Wave 2 is where a school loses money quietly. #5 and #10 travel together: the
diff for #5 also fixes the `new_bal` that discards `discount_amount`.

### Wave 3 — missing features

| # | Entry | Shape of work |
|---|---|---|
| 8 | Verification | Columns exist, unused. One migration (`verified_at`), one route, one clause in the upsert |
| 13 | Per-period attendance | `class_id` exists; the constraint and INSERT need changing |
| 14 | Token revocation | New column, new route |
| 9 | Score range validation | Two small changes |
| 12 | Band tiling validation | One helper, two call sites |

Wave 3 is scheduled with a release. None of it is on fire; all of it is a
promise the product currently makes and does not keep.
