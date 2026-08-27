#!/usr/bin/env bash
# Restart the live backend. The bracket in the pattern stops pkill matching
# its own command line, which otherwise kills the calling shell too.
set -u
BE=/home/nova/Desktop/soko-V4.2-main/backend
PGBIN=/usr/lib/postgresql/18/bin
PGDATA="$HOME/.local/share/shule-pg/data"

# Postgres lived under /tmp, which the machine clears without warning. It is
# started here if it is not running, so a cleared /tmp costs a restart rather
# than a rebuild.
if ! "$PGBIN/pg_isready" -h 127.0.0.1 -p 55432 -q 2>/dev/null; then
  "$PGBIN/pg_ctl" -D "$PGDATA" \
    -o "-p 55432 -k $HOME/.local/share/shule-pg/run -c listen_addresses=127.0.0.1" \
    -l "$HOME/.local/share/shule-pg/log" start >/dev/null 2>&1
  for i in $(seq 1 15); do "$PGBIN/pg_isready" -h 127.0.0.1 -p 55432 -q && break; sleep 1; done
fi
pkill -f "[p]ython run.py" >/dev/null 2>&1
for i in $(seq 1 10); do pgrep -f "[p]ython run.py" >/dev/null || break; sleep 1; done
# The read-only ledger window, so rule 4 has something to read. It lived only
# in a shell that /tmp being cleared took with it, and its absence reads as
# three rule failures rather than one missing process.
start_gl() {
  curl -s -o /dev/null "http://localhost:8090/gl?school_id=x" 2>/dev/null && return
  (cd /home/nova/Desktop/soko-v6 && setsid nohup node dev/gl-server.mjs > /tmp/gl.log 2>&1 < /dev/null &)
  for i in $(seq 1 10); do
    curl -s -o /dev/null "http://localhost:8090/gl?school_id=x" 2>/dev/null && return
    sleep 1
  done
}

cd "$BE" && setsid nohup .venv/bin/python run.py > /tmp/api.log 2>&1 < /dev/null &
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/school 2>/dev/null)
  [ "$code" = "401" ] && { echo "api up"; start_gl; exit 0; }
  sleep 1
done
echo "api DID NOT COME UP"; tail -20 /tmp/api.log; exit 1
