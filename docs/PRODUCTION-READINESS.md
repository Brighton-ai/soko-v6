# Production readiness

What is safe to run for a real school, what is not, and what has been done
about each. Written to be checked rather than believed: every "done" below
names the command that proves it.

Last reviewed: 27 August 2026.

---

## Ready

| | Evidence |
|---|---|
| **The money is correct** | `dev/live-run.sh` — 47/47 against the real API. Over-payment refused, bursaries survive payments, both payment routes post to the ledger, payments atomic, ledger balanced at every check |
| **Access control is enforced server-side** | A teacher sees 1 class of 2 and 6 pupils of 12; a parent sees 1 child of 12; cross-tenant reads and writes 404. Proven with a second school that exists permanently in the fixture |
| **A school can sign itself up** | `POST /api/auth/register` creates tenant, owner, role, subscription, chart of accounts and trial in one transaction. Rate limited by IP. Email confirmation required before sign-in |
| **Each school has its own paybill** | Two schools registered, connected 400200 and 555777, neither able to see the other's |
| **Credentials encrypted at rest** | `secrets_box.py`. A GET returns the last four characters. Never the value, never the ciphertext |
| **The frontend talks to the backend** | `npm run browser:check` — a real page, in live mode, through the login form, against the running API |
| **A wrong password is refused** | Same check. It used to let anyone in |
| **No silent demo fallback** | `api.js` fails loudly if the live backend is missing rather than serving a fictional school |
| **The server refuses an unsafe start** | `shared.check_production_config()` — no JWT_SECRET, no SHULE_SECRET_KEY, wildcard CORS, or missing M-Pesa callback stops a production boot |
| **Backups restore** | `dev/backup.sh` — takes one, restores it into a scratch database, compares every table and checks the ledger still balances. 19 seconds on the current dataset |
| **Every column named in SQL exists** | `npm run db:columns`. This bug appeared 15 times |
| **No unreachable routes** | `npm run routes:shadow` |
| **Every GET route answers** | `npm run routes:probe` — 71 OK, 0 faults |

Run all of it: `npm test && npm run audit && npm run browser:check`

---

## Not ready

### 1. M-Pesa has never touched real Daraja

The credential handling is per school, the sandbox defaults are gone, the code
paths are exercised. **No real STK push has been sent.** Until one has, "it
takes fees" is a claim.

What is needed: one school, real Daraja credentials in sandbox first, a live
STK push to a real phone, and a confirmed callback landing on
`/api/mpesa/callback` and reaching the ledger. A day's work, and it cannot be
done from here — it needs Safaricom credentials and a public HTTPS callback.

### 2. Nothing watches it

Railway restarts a crashed process. It will not notice:

- the M-Pesa callback silently no longer arriving
- the nightly scheduler dying
- the ledger going out of balance
- a school's invoices failing to generate at the start of term

**Minimum before a real school:** an uptime check on `/api/health` and a daily
job that asserts `SUM(debit) = SUM(credit)` and emails if not. Neither exists.

### 3. Load is untested past a handful of pupils

The largest dataset tested is 21 pupils. A secondary school is 800 to 2,000,
with a register per lesson — that is roughly 12,000 attendance rows a week
against a `UNIQUE(student_id, class_id, date)` index.

Nothing suggests it will not hold. Nothing has demonstrated it either.

### 4. The nightly scheduler has never run live

`scheduler.py` is started by `run.py`. In this environment it has started, and
its jobs have never been observed doing anything.

### 5. Kenyan Data Protection Act 2019

Holding pupils' records centrally makes you a **data controller**, not a
processor. Required and not done:

- registration with the Office of the Data Protection Commissioner
- a lawful basis for processing children's personal data
- a retention policy — how long a pupil's record is kept after they leave
- a breach notification procedure, with the 72-hour clock
- a privacy notice parents can actually read
- a data processing agreement with Railway, who host it

None of this is code, and none of it can be skipped by shipping.

### 6. Screens that do not exist

- **M1** platform console — `superadmin.py` has 13 routes behind no interface
- **M3** API keys — `api_keys` table unused
- **M4** school settings — profile, users, integrations, billing. The
  integrations *API* is built (M2); there is no page to use it from, so
  credentials go in by curl today

### 7. Smaller, but real

- **`SHULE_SECRET_KEY` has no recovery path.** Lose it and every stored M-Pesa
  and Resend credential is unreadable; each school re-enters theirs. It needs
  to live somewhere outside Railway.
- **No staging environment.** Schema changes would be applied first in
  production.
- **`report_cards.class_id` has no tenant_id**, so isolation there rests on the
  join rather than the row. Correct today, fragile to a future query.
- **The other SokoOS verticals** (clinic, sacco, property, commerce…) ship in
  the same image and are not part of this product. They are gated by
  subscription modules, so a school cannot reach them, but they are attack
  surface that earns nothing.

---

## The honest summary

The **logic** is production quality: money, marks, access control and isolation
are correct and enforced by the server, with tests that fail when they are not.

The **operations** are not. Nothing has been run against real payment
infrastructure, nothing is watching it, and the legal groundwork for holding
children's data has not started.

**A pilot with one school you know well, on real Daraja, for one term, watched
closely** is the right next step. Not a launch.
