#!/usr/bin/env bash
# Restart the live backend. The bracket in the pattern stops pkill matching
# its own command line, which otherwise kills the calling shell too.
set -u
BE=/home/nova/Desktop/soko-V4.2-main/backend
pkill -f "[p]ython run.py" >/dev/null 2>&1
for i in $(seq 1 10); do pgrep -f "[p]ython run.py" >/dev/null || break; sleep 1; done
cd "$BE" && setsid nohup .venv/bin/python run.py > /tmp/api.log 2>&1 < /dev/null &
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/school 2>/dev/null)
  [ "$code" = "401" ] && { echo "api up"; exit 0; }
  sleep 1
done
echo "api DID NOT COME UP"; tail -20 /tmp/api.log; exit 1
