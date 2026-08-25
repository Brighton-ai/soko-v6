#!/usr/bin/env bash
# Run the contract suite against the live backend and bucket the failures.
# One command, so a gate's evidence is always produced the same way.
set -u
cd "$(dirname "$0")/.."
OUT=${1:-/tmp/live-run.txt}
export SHULE_BACKEND=live
export SHULE_API_URL=${SHULE_API_URL:-http://localhost:8000/api}
export SHULE_GL_URL=${SHULE_GL_URL:-http://localhost:8090/gl}
export SHULE_SCHOOL_ID=${SHULE_SCHOOL_ID:-$(node -e "console.log(require('./dev/seed-live.json').school_id)")}
timeout 400 node --test "test/contract/**/*.test.js" > "$OUT" 2>&1
grep -E '^ℹ (tests|pass|fail) ' "$OUT"
node dev/classify.mjs "$OUT" | tail -1
