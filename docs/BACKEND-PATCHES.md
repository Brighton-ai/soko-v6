# Shule — the `school.py` patch set

Fourteen entries, ordered by what a customer sees first. Every line reference is
from `soko-V4.2-main/backend/routers/school.py` (2,584 lines), mounted at
`/api/school` by `main.py:398`.

**These are not applied.** That repo is not in this workspace. Each entry gives
the location, what breaks in production, and the minimal diff.

The contract suite in `test/contract/` is the acceptance criteria. Each patch
names the rows it closes; run `SHULE_BACKEND=live npm run test:contract` after
each one and the tagged failures should go green.

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
