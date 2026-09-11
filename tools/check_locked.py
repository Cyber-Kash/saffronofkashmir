#!/usr/bin/env python3
"""Fail when a publish changed content only a developer should change.

Why this exists
---------------
The admin panel is the primary publishing tool and is being handed to a
non-technical team. Most of data/site-data.json is theirs to edit. A small part
of it is not: text that took weeks to get right, and text that carries
regulatory exposure. A wrong FSSAI number is not a typo, it is a false
statement on every page of the site.

The panel greys these fields out, but that is advisory. A field lock lives in
the browser and can be bypassed by anything that writes the JSON another way.
This check runs where the person publishing cannot skip it, between the push
and the site going live, which is the only place a lock actually holds.

Two kinds of lock
-----------------
PATHS   a location in the data file. Everything under it is locked.
TOKENS  a phrase, wherever it appears. Locked because the CLAIM is regulated,
        not the field that happens to hold it today.

Tokens are checked against the value BEFORE and AFTER the change. Deleting a
claim matters as much as adding one: blanking the FSSAI number leaves a value
containing no token at all, and a lock that only reads the new value would wave
it through.

Every refusal names what was touched, why it is locked, and who changes it.
A refusal that only says "no" teaches nothing. Someone blocked from writing
"ISO 3632 certified" who is not told the approved wording will write
"internationally certified quality" instead, which is a vaguer false claim
rather than a precise one. That outcome is worse than the one the lock
prevents, so the message carries the approved phrasing.

Usage
-----
  python tools/check_locked.py --before <git-ref>
  python tools/check_locked.py --before <file> --after <file>

--before defaults to nothing and is required: there is no safe guess.
--after defaults to the working tree copy of data/site-data.json.

Scope: this reports WHAT changed, not WHO changed it. The workflow decides
when to run it, on pushes to the branch the panel writes to. Keeping the
authorship decision in the workflow means this script stays testable from a
plain checkout.
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "site-data.json")

LOCKED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "locked.json")

# Syntax Python's re accepts and JavaScript's RegExp does not. The panel runs
# these same patterns in the browser, so a pattern that only compiles here would
# pass this check and then throw in the one place a person is actually editing.
# tools/check_figures.py carries the same list for the same reason.
PY_ONLY = [
    ("(?P<", "Python named group. JavaScript spells it (?<name>...)"),
    ("(?P=", r"Python named backreference. JavaScript spells it \k<name>"),
    ("(?#", "Python inline comment, not valid in JavaScript"),
    ("(?>", "atomic group, not valid in JavaScript"),
    (r"\A", "Python string-start anchor. Use ^"),
    (r"\Z", "Python string-end anchor. Use $"),
    (r"\z", "Python string-end anchor. Use $"),
    ("(?i)", "Python inline flag, not valid in JavaScript"),
    ("(?m)", "Python inline flag, not valid in JavaScript"),
    ("(?s)", "Python inline flag, not valid in JavaScript"),
    ("(?x)", "Python inline flag, not valid in JavaScript"),
    ("(?(", "Python conditional group, not valid in JavaScript"),
]


def load_locks():
    """Read tools/locked.json, or fail loudly.

    A missing or malformed lock file must never read as "nothing is locked".
    That is the failure mode hard rule 8 exists for: a check that examines
    nothing and a check that finds nothing would otherwise print the same
    thing.
    """
    try:
        with io.open(LOCKED, encoding="utf-8") as fh:
            spec = json.load(fh)
    except Exception as err:
        print("FAIL  could not read %s: %s" % (LOCKED, err))
        print("")
        print("Without it nothing is locked, so this refuses rather than")
        print("passing everything through.")
        sys.exit(1)

    paths = spec.get("paths") or []
    tokens = spec.get("tokens") or []
    if not paths and not tokens:
        print("FAIL  %s defines no locks at all" % LOCKED)
        print("")
        print("Nothing would be examined, so nothing could be refused.")
        sys.exit(1)

    bad = []
    for i, lock in enumerate(paths):
        for key in ("match", "what", "why"):
            if not lock.get(key):
                bad.append(("paths[%d]" % i, "no %s" % key))
    for i, lock in enumerate(tokens):
        for key in ("pattern", "what", "why", "instead"):
            if not lock.get(key):
                bad.append(("tokens[%d]" % i, "no %s" % key))
        pat = lock.get("pattern") or ""
        for frag, why in PY_ONLY:
            if frag in pat:
                bad.append(("tokens[%d]" % i,
                            "pattern uses %s: %s" % (frag, why)))
        try:
            re.compile(pat)
        except re.error as err:
            bad.append(("tokens[%d]" % i, "pattern does not compile: %s" % err))

    if bad:
        print("FAIL  %s is not usable" % LOCKED)
        print("")
        for where, why in bad:
            print("  %-12s %s" % (where, why))
        sys.exit(1)

    return spec, paths, tokens


SPEC, LOCKED_PATHS, LOCKED_TOKENS = load_locks()
DEV = SPEC.get("dev") or "A developer changes this through a pull request."
UNCHANGED = SPEC.get("unchanged") or "Nothing was published and the live site is unchanged."


def norm_path(p):
    """products[2].specs[0].value -> products[].specs[].value

    Post ids are kept, because a lock on posts[health-claims].body must not
    become a lock on every post body.
    """
    return re.sub(r"\[\d+\]", "[]", p)


def flatten(node, path, out):
    if isinstance(node, dict):
        for k, v in node.items():
            key = str(k)
            if isinstance(v, list) and key == "posts":
                for item in v:
                    ident = item.get("id", "?") if isinstance(item, dict) else "?"
                    flatten(item, "posts[" + ident + "]", out)
                continue
            flatten(v, path + "." + key if path else key, out)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            flatten(v, path + "[" + str(i) + "]", out)
    else:
        out[path] = node


def path_lock_for(path):
    n = norm_path(path)
    for lock in LOCKED_PATHS:
        m = lock["match"]
        if n == m or n.startswith(m + ".") or n.startswith(m + "["):
            return lock
    return None


def token_locks_for(*values):
    hits = []
    for lock in LOCKED_TOKENS:
        rx = re.compile(lock["pattern"])
        for v in values:
            if isinstance(v, str) and rx.search(v):
                hits.append(lock)
                break
    return hits


def read_side(spec, label):
    """A file path, or a git ref whose data/site-data.json is read."""
    if os.path.exists(spec):
        return io.open(spec, encoding="utf-8").read()
    try:
        out = subprocess.run(
            ["git", "show", "%s:data/site-data.json" % spec],
            capture_output=True, cwd=ROOT)
        if out.returncode != 0:
            raise RuntimeError(out.stderr.decode("utf-8", "replace").strip())
        return out.stdout.decode("utf-8")
    except Exception as err:
        print("FAIL  could not read the %s side (%s): %s" % (label, spec, err))
        print("")
        print("Pass a git ref that exists in this checkout, or a file path.")
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--before", required=True,
                    help="git ref or file to compare against")
    ap.add_argument("--after", default=DATA,
                    help="git ref or file holding the new state")
    args = ap.parse_args()

    before_raw = read_side(args.before, "before")
    after_raw = read_side(args.after, "after")

    b, a = {}, {}
    try:
        flatten(json.loads(before_raw), "", b)
    except ValueError as err:
        print("FAIL  the before side is not valid JSON: %s" % err)
        return 1
    try:
        flatten(json.loads(after_raw), "", a)
    except ValueError as err:
        print("FAIL  the after side is not valid JSON: %s" % err)
        return 1

    if not b or not a:
        print("FAIL  one side of the comparison is empty")
        print("")
        print("Nothing would be examined, so nothing could be refused.")
        return 1

    changed = []
    for key in sorted(set(b) | set(a)):
        if b.get(key) != a.get(key):
            changed.append(key)

    violations = []
    for key in changed:
        lock = path_lock_for(key)
        if lock:
            violations.append(("path", key, lock, b.get(key), a.get(key)))
            continue
        for tlock in token_locks_for(b.get(key), a.get(key)):
            violations.append(("token", key, tlock, b.get(key), a.get(key)))

    print("compared %d value(s) before against %d after, %d changed"
          % (len(b), len(a), len(changed)))

    if not violations:
        print("OK  nothing locked was changed")
        return 0

    print("")
    print("PUBLISH REFUSED  %d locked change(s)" % len(violations))
    print("")
    for kind, key, lock, old, new in violations:
        print("  %s" % key)
        if kind == "path":
            print("      you changed : %s" % lock["what"])
            print("      why locked  : %s" % lock["why"])
            print("      who changes : %s" % DEV)
        else:
            print("      you changed : text containing %s" % lock["what"])
            print("      why locked  : %s" % lock["why"])
            print("      what to do  : %s" % lock["instead"])
            print("      who changes : %s" % DEV)
        if isinstance(old, str) and isinstance(new, str):
            print("      was  : %s" % (old[:110] + ("..." if len(old) > 110 else "")))
            print("      now  : %s" % (new[:110] + ("..." if len(new) > 110 else "")))
        print("")

    print(UNCHANGED)
    print("Undo the changes listed above in the admin panel and publish again.")
    print("Everything else you edited is fine and will publish once these are")
    print("put back.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
