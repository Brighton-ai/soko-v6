# Found behind the dead endpoints

E1, E2 and E3 returned 500 on every call, so nothing downstream of them had
ever executed. Each fault below became visible only once the endpoint in front
of it stopped crashing. They are numbered F1.. and are additions to the
register, not restatements of it.

| # | Behind | Fault | How it showed |
|---|--------|-------|---------------|
| F1 | E1 | `school_fee_invoices` has no `invoice_number`. The portal's *second* query selected it, so the portal would still have 500'd after the results query was fixed. | `UndefinedColumnError: column "invoice_number" does not exist` at `school.py:2557` |
| F2 | E1, E2 | `school_students.admission_number` does not exist; the column is `admission_no`. Three references across the portal and the merit list. | `UndefinedColumnError` on the join, before any row was read |
| F3 | E2 | `school_students` has **no `class_id` column at all** — membership is `class_name`/`grade`/`stream` text. The merit list's class filter and its `LEFT JOIN school_classes c ON c.id = s.class_id` could never have run. Logged as **E30**. | `UndefinedColumnError: column s.class_id does not exist` |
| F4 | E3 | `GET /report-cards` filtered on `rc.school_id`, which is not a column. The **list** route was dead too, not just generation. | 500 before the fix; `200 []` after |
| F5 | E3 | `report_cards.class_id` is `NOT NULL` and the insert never supplied it. Correcting only the three names the register lists would still have failed. | `NotNullViolationError` on `class_id` |
| F6 | E3 | `school_academic_terms.academic_year` is **TEXT**; `report_cards.academic_year` is **INTEGER**. Two tables model the same fact in two types. Also true of `school_classes` and `school_timetable`. | `DataError: invalid input for query argument $5: '2026' ('str' object cannot be interpreted as an integer)` |
| F7 | E3 | `report_cards.term_number` is `NOT NULL`; the insert passed `term_info["term"]` or `None`. | would violate NOT NULL for any card generated without a term |
| F8 | E3 | `SELECT rc.*, ss.grade` puts the pupil's class grade *after* `rc.*`, so it silently overwrote the report card's grade letter. Present in both single-card routes and the list route. | create returned `"grade":"C"`, reading the same card back returned `"grade":null` |
| F9 | E2 | **E11 confirmed live with a real number.** With the merit list finally running, one pupil totals **4,044 marks on a 100-mark paper** — mean 2,022. The marks were accepted by `POST /exam-results` with no range check. | `{"rank":1,...,"total_marks":4044.0,"average_marks":2022.0,"subjects_sat":2}` |
| F10 | E1 | **E4 reaching a parent's screen.** The portal now renders `"amount_paid":42001, "amount_due":42000.0, "balance":-1.0, "status":"paid"` — a family is shown a negative balance produced by an over-payment the backend accepted. | live `GET /guardian-portal/{token}` |
| F11 | — | `school_fee_invoices` carries **duplicate money columns**: `amount` alongside `amount_due`, and `paid_amount` alongside `amount_paid`. `paid_amount` is dead — `0.00` on all six rows, never written — and `school.py:843` aliases `amount_paid AS paid_amount` in a projection, so the dead column is *shadowed* rather than removed. Any query that reads it directly gets zero. | `select count(paid_amount)` → 6 rows, all `0.00`, against `amount_paid` values of 42001, 47000, 42000, 1500 |
| F12 | E3 | There is no `GET /school/students` list route — only `POST /students`, `GET /students/{id}` and `GET /{school_id}/students`. A plausible call 405s rather than 404s, which reads as "wrong method" instead of "wrong path". | `GET /school/students?school_id=… → 405 Method Not Allowed` |

## E30 — a pupil has no class

`school_students` has `class_name`, `grade` and `stream`, all text, and no
foreign key to `school_classes`. Every place that needs a roll — mark sheets,
class positions, class size, per-class attendance — either joins a column that
does not exist or matches on a string.

The merit list and the report card are both fixed here by reading the class off
`school_exam_results.class_id`, which *is* a real foreign key and is arguably
the better source anyway: it records the class a pupil sat the paper in, which
is what a position is relative to. That is enough for exams. It is not enough
for a register, which needs a roll before any marks exist.

A migration adding `class_id` to `school_students`, backfilled from
`class_name`, is the real fix. It is scheduled with the other migrations.
