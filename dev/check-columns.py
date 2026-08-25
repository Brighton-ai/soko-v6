#!/usr/bin/env python3
"""
Every column named in SQL, checked against the columns that exist.

This one bug has now appeared nine times in school.py alone: marks_obtained,
max_marks, admission_number (three places), invoice_number, school_id on
report_cards (three places), mean_score, teacher_remarks, route_name,
payment_date, date_of_birth, price_monthly, subscription_id. Each was a route
that returned 500 on every call, and each was invisible until something asked
for it — some of them for as long as the code has existed.

Nothing in Python can catch it: the SQL is a string. So it is checked here,
against the live database's information_schema.

    python dev/check-columns.py                    # the Shule surface
    python dev/check-columns.py --all              # every router
"""
import argparse
import os
import re
import subprocess
import sys

BACKEND = os.environ.get("SHULE_BACKEND_DIR", "/home/nova/Desktop/soko-V4.2-main/backend")
DB      = os.environ.get("DATABASE_URL", "postgresql://shule@127.0.0.1:55432/sokoos")
PSQL    = os.environ.get("PSQL", "/usr/lib/postgresql/18/bin/psql")

SHULE = ["school.py", "auth.py", "mpesa.py", "superadmin.py",
         "settings.py", "subscriptions.py", "tenants_users.py", "imports.py"]

# Names that look like columns in a projection but are not: SQL keywords,
# functions, and the aliases a query invents for itself.
NOISE = {
    "count", "sum", "avg", "min", "max", "coalesce", "distinct", "case", "when",
    "then", "else", "end", "as", "and", "or", "not", "null", "true", "false",
    "select", "from", "where", "join", "left", "right", "inner", "outer", "on",
    "group", "by", "order", "having", "limit", "offset", "insert", "into",
    "values", "update", "set", "delete", "returning", "conflict", "do",
    "nothing", "rank", "over", "partition", "filter", "now", "current_date",
    "interval", "cast", "asc", "desc", "is", "in", "exists", "with", "union",
}


def db_columns():
    out = subprocess.run(
        [PSQL, DB, "-tAF", "\t", "-c",
         "SELECT table_name, column_name FROM information_schema.columns "
         "WHERE table_schema='public'"],
        capture_output=True, text=True, check=True,
    ).stdout
    cols = {}
    for line in out.strip().split("\n"):
        if "\t" not in line:
            continue
        t, c = line.split("\t", 1)
        cols.setdefault(t, set()).add(c)
    return cols


def sql_strings(src):
    """Every triple-quoted or plain string that looks like SQL."""
    found = []
    for m in re.finditer(r'"""(.*?)"""|\'\'\'(.*?)\'\'\'', src, re.S):
        found.append((src[:m.start()].count("\n") + 1, m.group(1) or m.group(2)))
    for m in re.finditer(r'"((?:[^"\\\n]|\\.){12,})"|\'((?:[^\'\\\n]|\\.){12,})\'', src):
        found.append((src[:m.start()].count("\n") + 1, m.group(1) or m.group(2)))
    return [(ln, s) for ln, s in found
            if re.search(r"\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b", s, re.I)]


def check_inserts(sql, cols):
    """INSERT INTO t (a, b, c) — every name must be a column of t."""
    bad = []
    for m in re.finditer(r"INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)", sql, re.I | re.S):
        table, names = m.group(1), m.group(2)
        if table not in cols:
            bad.append((table, None, "table does not exist"))
            continue
        for raw in names.split(","):
            name = raw.strip().strip('"').lower()
            if not name or not re.fullmatch(r"\w+", name):
                continue
            if name not in cols[table]:
                bad.append((table, name, "not a column"))
    return bad


def aliases(sql, cols):
    """alias -> table, from FROM and JOIN clauses."""
    out = {}
    for m in re.finditer(r"\b(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?", sql, re.I):
        table, alias = m.group(1), m.group(2)
        if table.lower() in NOISE or table not in cols:
            continue
        out[table] = table
        if alias and alias.lower() not in NOISE:
            out[alias] = table
    return out


def check_refs(sql, cols):
    """alias.column — the column must exist on whatever the alias points to."""
    amap = aliases(sql, cols)
    bad = []
    for m in re.finditer(r"\b(\w+)\.(\w+)\b", sql):
        alias, col = m.group(1), m.group(2)
        if alias not in amap or col == "*":
            continue
        table = amap[alias]
        if col.lower() in NOISE:
            continue
        if col not in cols.get(table, set()):
            bad.append((table, col, f"referenced as {alias}.{col}"))
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()

    cols = db_columns()
    if not cols:
        print("could not read the schema; is the database up?", file=sys.stderr)
        return 2

    d = os.path.join(BACKEND, "routers")
    files = sorted(f for f in os.listdir(d) if f.endswith(".py")) if args.all else SHULE

    problems = 0
    for f in files:
        path = os.path.join(d, f)
        if not os.path.exists(path):
            continue
        src = open(path, encoding="utf-8").read()
        hits = []
        for line, sql in sql_strings(src):
            for t, c, why in check_inserts(sql, cols) + check_refs(sql, cols):
                hits.append((line, t, c, why))
        # one line can hold one fault reported twice by both checks
        seen, uniq = set(), []
        for h in hits:
            k = (h[0], h[1], h[2])
            if k in seen:
                continue
            seen.add(k)
            uniq.append(h)
        if uniq:
            print(f"\n{'═' * 74}\n{f}  ({len(uniq)})\n{'═' * 74}")
            for line, t, c, why in sorted(uniq):
                print(f"  {f}:{line}  {t}.{c or '?'}  — {why}")
            problems += len(uniq)

    print(f"\n{problems} column reference(s) name something that does not exist."
          if problems else "\nEvery column named in SQL exists.")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
