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

DEV = "A developer changes this through a pull request."

LOCKED_PATHS = [
    {
        "match": "guarantee",
        "what": "the purity guarantee",
        "why": "It promises a full refund plus the cost of the test within 90 days. "
               "It was reconciled against the returns policy on window, remedy and "
               "coverage, and the two contradicted each other until that was fixed.",
    },
    {
        "match": "policies",
        "what": "a policy page (terms, returns, shipping or privacy)",
        "why": "Regulatory text. The returns window, the remedy and the FSSAI "
               "registration line all live here.",
    },
    {
        "match": "products[].specs",
        "what": "a product specification row",
        "why": "These carry the crocin figure, the ISO category, the testing "
               "laboratory and its NABL accreditation number. They are claims "
               "about a measured result, not descriptions.",
    },
    {
        "match": "brand.fssaiNumber",
        "what": "the FSSAI registration number",
        "why": "It is printed in the footer of every page as an official "
               "registration. A wrong number is a regulatory problem, not a typo.",
    },
    {
        "match": "posts[health-claims].body",
        "what": "the 'Why We Do Not Make Health Claims' article",
        "why": "It quotes FSSAI regulation 10(1) and UAE.S/FDS 2333 clause 11.1.4 "
               "verbatim. Both quotations were checked against the source documents.",
    },
    {
        "match": "posts[read-lab-report].body",
        "what": "the 'How to Read a Saffron Lab Report' article",
        "why": "It states the 190 against 200 crocin disagreement and deliberately "
               "refuses to resolve it in our favour.",
    },
    {
        "match": "posts[origins-compared].body",
        "what": "the 'What Origin Actually Tells You' article",
        "why": "It cites two published studies and the Spanish PDO specification, "
               "each verified against the source.",
    },
    {
        "match": "posts[purity-tests].body",
        "what": "the 'How to Test Saffron Purity at Home' article",
        "why": "The purity checker's reasoning is anchored to sentences in this "
               "body. Editing it breaks those anchors and tools/check_checker.py "
               "will fail.",
    },
    {
        "match": "posts[purity-tests].checker",
        "what": "the purity checker question tree",
        "why": "Every option is anchored to a published sentence. The three "
               "outcomes are deliberately not a score.",
    },
]

LOCKED_TOKENS = [
    {
        "pattern": r"ISO\s*3632",
        "what": "an ISO 3632 claim",
        "why": "The approved wording is \"lab tested to ISO 3632 Category I\", "
               "never the bare grade and never \"certified\". Category I is a band, "
               "not a score, and the site says so in several places.",
        "instead": "Write the product copy without a testing claim and ask a "
                   "developer to add the approved phrasing. Do NOT reach for a "
                   "vaguer substitute such as \"internationally certified\" or "
                   "\"premium certified quality\": a vague claim we cannot "
                   "evidence is worse than a precise one, not safer.",
    },
    {
        "pattern": r"Category\s+I\b",
        "what": "an ISO grade claim",
        "why": "\"Category I\" is a laboratory result for a specific lot, not a "
               "marketing adjective.",
        "instead": "Ask a developer. The approved phrasing is \"lab tested to "
                   "ISO 3632 Category I\".",
    },
    {
        "pattern": r"\bNABL\b",
        "what": "a laboratory accreditation claim",
        "why": "NABL accreditation belongs to the testing laboratory, not to us. "
               "The accreditation number TC-9209 identifies a real body.",
        "instead": "Ask a developer.",
    },
    {
        "pattern": r"\bFSSAI\b",
        "what": "an FSSAI registration claim",
        "why": "FSSAI registration is a legal status with a number attached.",
        "instead": "Ask a developer.",
    },
    {
        "pattern": r"\bTC-?\s*\d{4}\b",
        "what": "a laboratory accreditation number",
        "why": "It identifies the accredited testing body and must match the "
               "certificate.",
        "instead": "Ask a developer.",
    },
]


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

    print("Nothing was published and the live site is unchanged.")
    print("Undo the changes listed above in the admin panel and publish again.")
    print("Everything else you edited is fine and will publish once these are")
    print("put back.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
