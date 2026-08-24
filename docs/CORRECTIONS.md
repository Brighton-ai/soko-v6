# Corrections to earlier reports

Figures I stated that were wrong, corrected in writing rather than quietly
replaced. `npm run counts` is the authority for every number here.

## E27 · Test counts

| Where | I said | Actual | What went wrong |
|---|---|---|---|
| Step 7 report | `npm run test:app` — 628 tests, 109 suites | **correct** | — |
| "What it can do" summary | 93 static + 182 app + 44 contract = **319 tests** | **672 tests** (628 app + 44 contract) | I counted source `it(` calls with `grep -c`, then labelled them "tests". A single `it(` inside `for (const page of ALL_PAGES)` is one source line and 22 runtime tests. The two numbers measure different things and I presented the smaller one as the test count |

**Authoritative:** 672 runtime tests across 114 suites — 628 app, 44 contract.

## E27 · Rule counts

| Where | I said | Actual |
|---|---|---|
| Step 6 report | 7 have it · 15 gap · 5 modelled differently | superseded — that was the pre-live read |
| Step 6, after correcting rows 27–28 | 8 · 13 · 6 | header was hand-maintained and drifted |
| Step 7, after the live run | "22 rules that exist only in the demo backend" | close, but derived by `grep -c` over prose, not the table |
| `docs/RULES_RECONCILED.md` header | 8 · 13 · 6 · 6 | **5 · 21 · 7 · 6 across 39 rows** |

The header had not been updated after rows 32 and 39 were added and rows 12,
13, 14 and 16 were corrected. It is now parsed from the table by
`npm run counts` and cannot drift again.

**Authoritative:** 39 rule rows — 5 backend has it, 21 backend gap, 7 modelled
differently, 6 frontend-only. **28 rules are enforced by the demo alone** and
disappear at cutover unless the backend changes.

## Why this happened

Both errors are the same mistake: quoting a number I had derived with `grep`
in a report, next to numbers a tool had produced, without saying which was
which. `npm run counts` now prints both tables from the source of truth, and
any figure that disagrees with it is wrong.
