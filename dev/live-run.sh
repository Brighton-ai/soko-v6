#!/usr/bin/env bash
# Run the contract suite against the live backend and bucket the failures.
# One command, so a gate's evidence is always produced the same way.
set -u
cd "$(dirname "$0")/.."
OUT=${1:-/tmp/live-run.txt}
BACKEND_DIR=${BACKEND_DIR:-/home/nova/Desktop/soko-V4.2-main/backend}
DB_URL=${DATABASE_URL:-postgresql://shule@127.0.0.1:55432/sokoos}
# Reseed FIRST, before anything reads dev/seed-live.json.
#
# The exports below take fixture ids out of that file, and the seed rewrites
# it. Reading it first handed the suite the previous run's ids — a portal
# token that no longer existed came back as "unknown", which reads as the
# portal being broken.
#
# The suite mutates the tenant it runs against — it verifies marks, publishes
# cards, bills terms and takes payments. Running it twice without a reset means
# the second run starts from the first run's conclusions, and rules fail with
# "everything is verified, so the gate is never exercised". A run that is not
# reproducible cannot be evidence of anything.
if [ "${SKIP_SEED:-}" != "1" ]; then
  node dev/seed-live.mjs > /tmp/seed-live.log 2>&1 || {
    echo "seed failed — see /tmp/seed-live.log"; tail -5 /tmp/seed-live.log; exit 1; }
  ( cd "$BACKEND_DIR" && DATABASE_URL="$DB_URL" .venv/bin/python scripts/backfill_fee_gl.py --commit \
      > /tmp/backfill.log 2>&1 ) || true
fi

export SHULE_BACKEND=live
export SHULE_API_URL=${SHULE_API_URL:-http://localhost:8000/api}
export SHULE_GL_URL=${SHULE_GL_URL:-http://localhost:8090/gl}
export SHULE_SCHOOL_ID=${SHULE_SCHOOL_ID:-$(node -e "console.log(require('./dev/seed-live.json').school_id)")}
# Fixtures the suite needs by name. Without these the portal rules run against
# demo tokens that a live tenant has never heard of, and six rules fail for want
# of a fixture rather than for want of a rule.
seedval() { node -e "try{console.log(require('./dev/seed-live.json')['$1']||'')}catch(e){console.log('')}"; }
export SHULE_PORTAL_TOKEN=${SHULE_PORTAL_TOKEN:-$(seedval portal_token)}
export SHULE_PORTAL_EXPIRED=${SHULE_PORTAL_EXPIRED:-$(seedval portal_token_expired)}
export SHULE_PORTAL_REVOCABLE=${SHULE_PORTAL_REVOCABLE:-$(seedval portal_token_revocable)}
# The access rules are about people, and the demo's people are not the live
# tenant's people. Without these the whole access file fails on "not a valid
# UUID" — which reads as a rule failure and is a missing fixture.
export SHULE_TEACHER_ID=${SHULE_TEACHER_ID:-$(seedval teacher_id)}
export SHULE_TEACHER_CLASS=${SHULE_TEACHER_CLASS:-$(seedval teacher_class_id)}
export SHULE_TEACHER_NOT_CLASS=${SHULE_TEACHER_NOT_CLASS:-$(seedval teacher_not_class_id)}
export SHULE_GUARDIAN=${SHULE_GUARDIAN:-$(seedval guardian_user_id)}
export SHULE_GUARDIAN_CHILD=${SHULE_GUARDIAN_CHILD:-$(seedval guardian_child_id)}
export SHULE_OTHER_TENANT_EMAIL=${SHULE_OTHER_TENANT_EMAIL:-$(seedval other_email)}
export SHULE_OTHER_SCHOOL_ID=${SHULE_OTHER_SCHOOL_ID:-$(seedval other_school_id)}
export SHULE_OTHER_STUDENT_ID=${SHULE_OTHER_STUDENT_ID:-$(seedval other_student_id)}
export SHULE_OTHER_SCALE_ID=${SHULE_OTHER_SCALE_ID:-$(seedval other_scale_id)}
export SHULE_UNBILLED_STRUCTURE=${SHULE_UNBILLED_STRUCTURE:-$(seedval fee_structure_id_unbilled)}

timeout 400 node --test "test/contract/**/*.test.js" > "$OUT" 2>&1
grep -E '^ℹ (tests|pass|fail) ' "$OUT"
node dev/classify.mjs "$OUT" | tail -1
