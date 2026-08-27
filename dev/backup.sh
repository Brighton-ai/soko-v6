#!/usr/bin/env bash
#
# Take a backup, and prove it restores.
#
# A backup nobody has restored is not a backup. This does both in one go,
# because the restore is the half that gets skipped and the half that matters.
#
#   dev/backup.sh                 take one, restore it into a scratch database,
#                                 compare the row counts, drop the scratch
#   dev/backup.sh --keep          leave the scratch database for inspection
#   dev/backup.sh --dump-only     just take the backup
#
# DATABASE_URL points at the database to back up.
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/18/bin}
DB=${DATABASE_URL:-postgresql://shule@127.0.0.1:55432/sokoos}
OUT_DIR=${BACKUP_DIR:-$HOME/shule-backups}
STAMP=$(date +%Y-%m-%d-%H%M)
DUMP="$OUT_DIR/shule-$STAMP.dump"
KEEP=0; DUMP_ONLY=0
for a in "$@"; do
  [ "$a" = "--keep" ] && KEEP=1
  [ "$a" = "--dump-only" ] && DUMP_ONLY=1
done

mkdir -p "$OUT_DIR"

echo "── taking a backup ──"
START=$(date +%s)
"$PGBIN/pg_dump" "$DB" -Fc -f "$DUMP"
DUMP_SECS=$(( $(date +%s) - START ))
SIZE=$(du -h "$DUMP" | cut -f1)
echo "   $DUMP  ($SIZE, ${DUMP_SECS}s)"

[ "$DUMP_ONLY" = "1" ] && exit 0

# The tables a school would notice losing. Counted before and after, because
# "the restore finished" and "the restore is correct" are different claims.
TABLES="school_students school_fee_invoices school_fee_payments school_exam_results report_cards journal_lines school_guardians"

echo
echo "── counting what is in the original ──"
declare -A BEFORE
for t in $TABLES; do
  n=$("$PGBIN/psql" "$DB" -tAc "SELECT COUNT(*) FROM $t" 2>/dev/null || echo "-")
  BEFORE[$t]=$n
  printf "   %-26s %s\n" "$t" "$n"
done

SCRATCH="shule_restore_test_$$"
BASE=$(echo "$DB" | sed 's![^/]*$!!')
echo
echo "── restoring into $SCRATCH ──"
START=$(date +%s)
"$PGBIN/createdb" "${BASE}${SCRATCH}" 2>/dev/null || {
  "$PGBIN/psql" "${BASE}postgres" -c "CREATE DATABASE $SCRATCH" >/dev/null; }
"$PGBIN/pg_restore" -d "${BASE}${SCRATCH}" "$DUMP" >/dev/null 2>&1 || true
RESTORE_SECS=$(( $(date +%s) - START ))

echo "── comparing ──"
FAIL=0
for t in $TABLES; do
  n=$("$PGBIN/psql" "${BASE}${SCRATCH}" -tAc "SELECT COUNT(*) FROM $t" 2>/dev/null || echo "-")
  if [ "$n" = "${BEFORE[$t]}" ]; then
    printf "   ✔ %-26s %s\n" "$t" "$n"
  else
    printf "   ✘ %-26s original ${BEFORE[$t]}, restored %s\n" "$t" "$n"
    FAIL=1
  fi
done

# The ledger has to balance in the restore too. A row count can match while the
# money does not.
OUT_BY=$("$PGBIN/psql" "${BASE}${SCRATCH}" -tAc \
  "SELECT COALESCE(SUM(debit)-SUM(credit),0) FROM journal_lines" 2>/dev/null || echo "?")
echo "   ledger in the restored copy is out by: $OUT_BY"
# Numeric, not string: psql answers 0, 0.0 or 0.00 depending on the column type,
# and comparing those as text fails a restore that is perfectly correct.
if ! awk -v v="$OUT_BY" 'BEGIN{exit !(v+0==0)}' 2>/dev/null; then FAIL=1; fi

if [ "$KEEP" = "1" ]; then
  echo
  echo "   kept: ${BASE}${SCRATCH}"
else
  "$PGBIN/psql" "${BASE}postgres" -c "DROP DATABASE $SCRATCH" >/dev/null 2>&1 || true
fi

echo
if [ "$FAIL" = "0" ]; then
  echo "✔ restored clean. dump ${DUMP_SECS}s, restore ${RESTORE_SECS}s."
  echo "  That restore time is your answer when a head teacher asks how long"
  echo "  they would be down."
else
  echo "✘ THE RESTORE DOES NOT MATCH. Do not rely on this backup."
  exit 1
fi
