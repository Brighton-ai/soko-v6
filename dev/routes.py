#!/usr/bin/env python3
"""
Every route in the backend, with what it needs to be called.

Reads the decorators and the function signatures rather than guessing, so the
prober knows which path parameters and which *required* query parameters each
route has. A route missing a required query parameter answers 422, which would
otherwise read as a fault.

    python dev/routes.py                 # the Shule surface
    python dev/routes.py --all           # every router in the repo
    python dev/routes.py --json          # machine readable
"""
import argparse
import ast
import json
import os
import sys

BACKEND = os.environ.get(
    "SHULE_BACKEND_DIR", "/home/nova/Desktop/soko-V4.2-main/backend"
)

# The routers Shule actually uses. The rest are other SokoOS verticals that
# happen to live in the same repo — a different product, not this one's surface.
SHULE = [
    "school.py", "auth.py", "mpesa.py", "superadmin.py",
    "settings.py", "subscriptions.py", "tenants_users.py", "imports.py",
]

PREFIXES = {}
IMPORTS = {}


def imports_from_main():
    """
    (module, local router name) -> the alias main.py knows it by.

    Routers are imported as `from routers.auth import router as auth_router`,
    so the name a module uses internally and the name main.py mounts are
    different. Without this mapping every prefix comes out blank and a route
    that works looks like a 404.
    """
    out = {}
    path = os.path.join(BACKEND, "main.py")
    if not os.path.exists(path):
        return out
    tree = ast.parse(open(path, encoding="utf-8").read())
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom) or not node.module:
            continue
        if not node.module.startswith("routers."):
            continue
        mod = node.module.split(".", 1)[1] + ".py"
        for a in node.names:
            out[(mod, a.name)] = a.asname or a.name
    return out


def prefixes_from_main():
    """router prefixes, read from main.py's include_router calls."""
    out = {}
    path = os.path.join(BACKEND, "main.py")
    if not os.path.exists(path):
        return out
    tree = ast.parse(open(path, encoding="utf-8").read())
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if not (isinstance(fn, ast.Attribute) and fn.attr == "include_router"):
            continue
        name = None
        if node.args:
            a = node.args[0]
            if isinstance(a, ast.Attribute):
                name = a.attr
            elif isinstance(a, ast.Name):
                name = a.id
        pref = ""
        for kw in node.keywords:
            if kw.arg == "prefix" and isinstance(kw.value, ast.Constant):
                pref = kw.value.value
        if name:
            out[name] = pref
    return out


def router_prefix_in_file(tree):
    """APIRouter(prefix=...) assignments inside a router module."""
    out = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        v = node.value
        if not (isinstance(v, ast.Call) and getattr(v.func, "id", None) == "APIRouter"):
            continue
        pref = ""
        for kw in v.keywords:
            if kw.arg == "prefix" and isinstance(kw.value, ast.Constant):
                pref = kw.value.value
        for t in node.targets:
            if isinstance(t, ast.Name):
                out[t.id] = pref
    return out


def routes_in(filename):
    path = os.path.join(BACKEND, "routers", filename)
    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src)
    local = router_prefix_in_file(tree)
    found = []

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call):
                continue
            fn = dec.func
            if not isinstance(fn, ast.Attribute):
                continue
            method = fn.attr.upper()
            if method not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                continue
            router_name = getattr(fn.value, "id", "?")
            sub = dec.args[0].value if dec.args and isinstance(dec.args[0], ast.Constant) else ""

            required_q, optional_q, path_params, body = [], [], [], None
            for arg in list(node.args.args) + list(node.args.kwonlyargs):
                if arg.arg in ("request", "current_user", "self"):
                    continue
                ann = arg.annotation
                ann_src = ast.unparse(ann) if ann else ""
                if "BaseModel" in ann_src:
                    body = arg.arg
                # a default of Query(...) with Ellipsis is required
                idx = None
                defaults = list(node.args.defaults)
                names = [a.arg for a in node.args.args]
                if arg.arg in names:
                    pos = names.index(arg.arg)
                    off = len(names) - len(defaults)
                    if pos >= off:
                        idx = defaults[pos - off]
                for a2, d2 in zip(node.args.kwonlyargs, node.args.kw_defaults):
                    if a2.arg == arg.arg:
                        idx = d2
                d_src = ast.unparse(idx) if idx is not None else ""

                if "{" + arg.arg + "}" in sub:
                    path_params.append(arg.arg)
                elif d_src.startswith("Query("):
                    (required_q if "..." in d_src else optional_q).append(arg.arg)
                elif d_src.startswith("Depends("):
                    pass
                elif not d_src and ann_src and ann_src not in ("dict", "Request"):
                    # a bare annotated arg in a path is a path param
                    if "{" + arg.arg + "}" in sub:
                        path_params.append(arg.arg)
                    elif ann_src in ("UploadFile",):
                        pass
                    else:
                        body = body or arg.arg

            alias = IMPORTS.get((filename, router_name), router_name)
            prefix = PREFIXES.get(alias, local.get(router_name, ""))
            found.append({
                "file": filename,
                "func": node.name,
                "method": method,
                "path": (prefix + sub) or "/",
                "path_params": path_params,
                "required_query": required_q,
                "optional_query": optional_q,
                "body": body,
                "doc": (ast.get_docstring(node) or "").split("\n")[0][:90],
            })
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--only", help="one router filename")
    args = ap.parse_args()

    global PREFIXES, IMPORTS
    PREFIXES = prefixes_from_main()
    IMPORTS = imports_from_main()

    files = ([args.only] if args.only
             else sorted(os.listdir(os.path.join(BACKEND, "routers")))
             if args.all else SHULE)
    files = [f for f in files if f.endswith(".py") and not f.startswith("_")]

    all_routes = []
    for f in files:
        try:
            all_routes.extend(routes_in(f))
        except FileNotFoundError:
            print(f"missing router: {f}", file=sys.stderr)

    if args.json:
        print(json.dumps(all_routes, indent=2))
        return

    by_file = {}
    for r in all_routes:
        by_file.setdefault(r["file"], []).append(r)
    for f in sorted(by_file):
        rs = by_file[f]
        print(f"\n{'═' * 78}\n{f}  ({len(rs)} routes)\n{'═' * 78}")
        for r in sorted(rs, key=lambda x: (x["path"], x["method"])):
            need = ""
            if r["required_query"]:
                need = "  needs ?" + "&".join(r["required_query"])
            print(f"  {r['method']:6} {r['path']:52}{need}")
    print(f"\nTOTAL {len(all_routes)} routes across {len(by_file)} routers")


if __name__ == "__main__":
    main()
