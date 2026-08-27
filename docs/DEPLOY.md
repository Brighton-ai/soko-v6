# Deploying Shule on Railway

Two services on one project: the **API** (the `soko-V4.2-main/backend` repo) and
the **site** (this repo). Plus Postgres, and Redis if you want login rate
limiting to survive a restart.

The site proxies `/api` to the API over Railway's private network, so the two
share one origin. That is worth doing rather than exposing both publicly:

- no CORS to configure, and no CORS mistake to make
- one domain for a school to trust, and one certificate
- the API is never reachable from the internet except through the site
- `config.js` resolves the API as `location.origin + '/api'` with nothing stamped

---

## 1. Postgres

Add the Postgres plugin. Railway gives you `DATABASE_URL`. Nothing else to do —
`run.py` executes `db/schema.sql` on every start, and it is idempotent.

**Take a backup before the first deploy of any release that changes the schema.**
Railway's automatic backups are a starting point, not a plan: see
[Backups](#5-backups) below.

## 2. The API service

Root directory: the backend repo. It already carries `railway.json`,
`nixpacks.toml` and a `/health` endpoint.

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | from the Postgres plugin | |
| `JWT_SECRET` | 64 random characters | sessions. Changing it signs everyone out |
| `SHULE_SECRET_KEY` | 64 random characters | encrypts integration credentials. **Changing it makes every stored M-Pesa and Resend credential unreadable** — they have to be entered again. Back it up somewhere a lost Railway project cannot take with it |
| `ALLOWED_ORIGINS` | `https://your-site.up.railway.app` | only needed if you skip the proxy. With the proxy, requests are same-origin |
| `APP_URL` | `https://your-site.up.railway.app` | goes into confirmation and password-reset emails |
| `MPESA_CALLBACK_URL` | `https://your-site.up.railway.app/api/mpesa/callback` | where Daraja posts confirmations. Must be public HTTPS |
| `REDIS_URL` | from the Redis plugin, optional | login rate limiting. Without it, the limit resets when the service restarts |
| `PORT` | set by Railway | |

Generate the secrets with `openssl rand -hex 32`. Do not reuse one for both.

**Do not set `ALLOWED_ORIGINS=*`.** The API logs a warning if you do. With
`allow_credentials=True` a wildcard origin is how another site reads your
schools' data using a logged-in parent's browser.

## 3. The site service

Root directory: this repo.

| Variable | Value |
|---|---|
| `SHULE_API_ORIGIN` | `http://<api-service>.railway.internal:8000` — the private address |
| `NODE_ENV` | `production` — turns on HSTS |
| `PORT` | set by Railway |

Build and start come from `railway.json`: `node tools/build.mjs` then
`node server.mjs`.

If you would rather run the two on separate public domains, leave
`SHULE_API_ORIGIN` unset, build with `node tools/build.mjs --api https://your-api.up.railway.app/api`,
and set `ALLOWED_ORIGINS` on the API to the site's URL.

### What the build does

- stamps the API base into each page, when one is given
- **removes the demo backend** — 195 KB of a fictional school that a live
  deployment must never serve. `api.js` would refuse to use it anyway, but a
  school should not download another school's records to never look at them

`npm run build:demo` produces the opposite: a demo build that runs entirely in
the browser, for the marketing site or a sales call with no connection.

## 4. First run

```bash
# 1. the API comes up and applies the schema
curl https://your-site.up.railway.app/api/health

# 2. register the first school through the product, not by hand
curl -X POST https://your-site.up.railway.app/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"school_name":"Your School","full_name":"Your Name",
       "email":"you@yourschool.co.ke","password":"a-long-passphrase-1!",
       "plan_slug":"school-trial"}'

# 3. confirm the address from the email, then sign in on the site
```

Registration creates the tenant, the owner, the admin role, the subscription in
trial, the chart of accounts, and switches on every module the plan sells.

Then, in the app: **Settings → Integrations** for the M-Pesa paybill and the
Resend key. Nothing takes money until those are in, and the app says so rather
than pretending.

## 5. Backups

Railway's Postgres plugin snapshots on its own schedule. That is not enough on
its own, for one reason: **a backup nobody has restored is not a backup.**

Before you carry a real school:

```bash
# take one
pg_dump "$DATABASE_URL" -Fc -f shule-$(date +%F).dump

# restore it into a scratch database and check a figure you know by heart
createdb shule_restore_test
pg_restore -d shule_restore_test shule-$(date +%F).dump
psql shule_restore_test -c "select count(*) from school_students"
```

Do that once before the first school, and once a term after. Write down how
long it took — that number is your answer when a head teacher asks how long
they would be down.

## 6. What is still missing

Stated plainly, because a deployment guide that implies otherwise is worse than
none:

- **M-Pesa has never been tested against real Daraja.** The credential handling
  is per school and the code paths are exercised, but no real STK push has been
  sent. Until one has, "it takes fees" is a claim.
- **No monitoring.** Nothing tells you the M-Pesa callback stopped arriving, or
  that the nightly scheduler died. Railway will restart a crashed process; it
  will not notice a quiet one.
- **No load testing beyond twelve pupils.** Not 240, not 2,000.
- **Kenyan Data Protection Act 2019.** Holding pupils' records centrally makes
  you a data controller: ODPC registration, a retention policy, a breach
  procedure and a lawful basis for children's data are all required, and none
  of them is code.

See `docs/PRODUCTION-READINESS.md` for the full list and what has been done
about each.
