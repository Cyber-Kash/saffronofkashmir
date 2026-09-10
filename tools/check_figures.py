#!/usr/bin/env python3
"""Fail when a tracked figure is stated with conflicting values.

Why this scans SOURCE and not generated output
----------------------------------------------
tools/check_product_ids.py deliberately reads generated HTML, so it cannot
drift from the slug logic in templates.js. This check does the opposite on
purpose.

Figures live in data/site-data.json, and the file contains unpublished drafts.
The harvest-diary draft already carries the same hectare and yield figures as
four live posts. A generated-output scan would not see it at all, because a
draft emits no page, so a contradiction introduced in a draft would sit
undetected until the day it was published. Scanning source catches it while it
is still cheap to fix.

The inconsistency between the two checks is intended. Each reads whichever
representation makes it hardest to miss the class of defect it exists for.

Why an explicit list and not number detection
---------------------------------------------
Generic number scanning would fire on prices, tin weights, dates, crocin
values, servings and delivery times, all of which legitimately differ between
posts. A check that fires on correct data gets switched off, so only figures
that are supposed to agree everywhere are tracked.

Where the list lives
--------------------
tools/figures.json, not this file. The admin panel runs the same check in the
browser before a publish, and a second copy of the list written in JavaScript
would drift from this one. Hard rule 9: one source, two readers.

That JSON carries the instructions for adding a figure, and the constraint that
matters most: every pattern must be valid in BOTH Python re and JavaScript
RegExp, because both run it. This script compiles every pattern on startup and
fails if one is invalid, so a pattern that only Python accepts is caught here
rather than silently doing nothing in the panel.

Usage:  python tools/check_figures.py          (exit 1 on any conflict)
"""
import io
import json
import os
import re
import sys

try:  # page copy contains emoji; a cp1252 console would crash mid-report
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "site-data.json")

FIGURES = os.path.join(ROOT, "tools", "figures.json")

# Syntax that Python's re accepts and JavaScript's RegExp does not. Compiling a
# pattern here proves only that PYTHON can run it; the admin panel runs the same
# pattern in the browser, where a Python-only construct throws and the check
# silently stops matching. Rejecting these is what makes "both readers agree"
# true rather than assumed.
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


def load_tracked():
    """Read tools/figures.json and compile every pattern.

    Fails loudly rather than returning an empty list. Per hard rule 8 a check
    that verifies presence must assert a non-zero corpus: "found no conflicts"
    and "found nothing to examine" must not print the same thing. A missing or
    empty figures.json means the guard is dead, not that the site is clean.
    """
    try:
        with io.open(FIGURES, encoding="utf-8") as fh:
            doc = json.load(fh)
    except IOError:
        print("FAIL  tools/figures.json is missing")
        print("")
        print("The tracked-figure list lives there, not in this script, because")
        print("the admin panel reads the same file in the browser. Without it")
        print("this check would examine nothing and report success.")
        sys.exit(1)
    except ValueError as err:
        print("FAIL  tools/figures.json is not valid JSON: %s" % err)
        sys.exit(1)

    figures = doc.get("figures")
    if not figures:
        print("FAIL  tools/figures.json defines no figures")
        print("")
        print("Nothing would be examined. If tracking was dropped on purpose,")
        print("remove this check and its build-check.yml step in the same commit.")
        sys.exit(1)

    bad = []
    for i, fig in enumerate(figures):
        where = fig.get("name") or ("figures[%d]" % i)
        if not fig.get("name"):
            bad.append((where, "no name"))
        if not fig.get("accepted"):
            bad.append((where, "no accepted values"))
        pats = fig.get("patterns") or []
        if not pats:
            bad.append((where, "no patterns, so it can never match"))
        for pat in pats:
            try:
                rx = re.compile(pat)
            except re.error as err:
                bad.append((where, "pattern is not valid regex (%s): %s" % (err, pat)))
                continue
            if rx.groups == 0:
                bad.append((where, "pattern captures nothing: %s" % pat))
            for token, why in PY_ONLY:
                if token in pat:
                    bad.append((where, "%s is Python-only, so the browser check "
                                       "would fail on it: %s (%s)" % (token, pat, why)))
    if bad:
        print("FAIL  %d problem(s) in tools/figures.json" % len(bad))
        print("")
        for where, why in bad:
            print("  %s" % where)
            print("      %s" % why)
            print("")
        return sys.exit(1)

    return figures

def walk(node, path, out):
    """Collect every string value with a dotted path to it."""
    if isinstance(node, dict):
        for k, v in node.items():
            key = str(k)
            # name posts by their id rather than their array index
            if isinstance(v, list) and key == "posts":
                for item in v:
                    ident = item.get("id", "?") if isinstance(item, dict) else "?"
                    walk(item, "posts[" + ident + "]", out)
                continue
            walk(v, path + "." + key, out)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            walk(v, path + "[" + str(i) + "]", out)
    elif isinstance(node, str):
        out.append((path.lstrip("."), node))


def line_of(raw, needle):
    i = raw.find(needle)
    return raw.count("\n", 0, i) + 1 if i != -1 else 0


def main():
    tracked = load_tracked()
    raw = open(DATA, encoding="utf-8").read()
    strings = []
    walk(json.loads(raw), "", strings)

    problems = []
    seen = set()
    for fig in tracked:
        for path, text in strings:
            for pat in fig["patterns"]:
                for m in re.finditer(pat, text):
                    for value in m.groups():
                        if value in fig["accepted"]:
                            continue
                        # more than one pattern can legitimately match the same
                        # wrong number; report each distinct conflict once
                        key = (fig["name"], path, value)
                        if key in seen:
                            continue
                        seen.add(key)
                        snippet = text[max(0, m.start() - 45):m.end() + 25]
                        snippet = re.sub(r"\s+", " ", snippet).strip()
                        problems.append({
                            "figure": fig["name"],
                            "accepted": " or ".join(sorted(fig["accepted"])),
                            "found": value,
                            "path": path,
                            "line": line_of(raw, m.group(0)),
                            "snippet": snippet,
                        })

    print("checked %d tracked figures across %d strings in data/site-data.json"
          % (len(tracked), len(strings)))
    if not problems:
        print("OK  every tracked figure agrees everywhere it is stated")
        return 0

    print("")
    print("FAIL  %d conflicting value(s)" % len(problems))
    print("")
    for p in problems:
        print("  %s  (line %d)" % (p["path"], p["line"]))
        print("      figure:   %s" % p["figure"])
        print("      accepted: %s" % p["accepted"])
        print("      found:    %s" % p["found"])
        print("      ...%s..." % p["snippet"])
        print("")
    print("Two posts stating different values for the same figure is the defect")
    print("this exists to catch. Decide which value is right and correct the")
    print("other, rather than widening the accepted set to cover both.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
