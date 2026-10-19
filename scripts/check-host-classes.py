#!/usr/bin/env python3
"""Which classes we use that the HOST's stylesheet never generates.

The Desktop app ships one compiled Tailwind build, generated from ITS OWN sources.
A plugin's class names are injected at runtime, so any utility the host's own code
never uses has no rule: the element silently falls back to the browser default.
This has bitten us three times — a white card pill on a white label, a role colour
that painted nothing, and an editor sheet whose `max-h-[87vh]` never applied, so the
36-row palette ran off the viewport and could not be scrolled.

Arbitrary-value utilities (`max-h-[87vh]`, `w-[min(94vw,64rem)]`, `bg-(--x)/15`) are
the worst offenders: the host cannot have used the same literal, so they are almost
always missing. Anything that constrains layout or carries meaning must therefore be
an INLINE STYLE, which no build can drop.

Usage (on a machine that carries the Desktop app):
    python scripts/check-host-classes.py                       # auto-discovers the app
    python scripts/check-host-classes.py --css '<glob>'        # explicit stylesheets
    python scripts/check-host-classes.py --list                # print the worklist, always exit 0

Exit 0 = every class we use has a rule, or is on the allowlist below.
Exit 1 = at least one class we use has NO rule: fix it before shipping.
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "desktop" / "plugin.js"

# Classes that are fine to be absent: they are not utilities at all, they are
# third-party hooks, or the host does not need to style them.
ALLOW = {
    # codicon / icon-font hooks the host may or may not define; icons never ship alone
    "codicon",
    # our own marker attributes rather than classes
    "group",
    "peer",
    # prose tokens that appear inside strings (font stacks), not class attributes
    "sans-serif",
    "system-ui,",
    "ui-monospace,",
    "-apple-system,",
    # not a class: a value string the cn() extractor catches from
    # `shape === 'circle' ? ... : ...` inside a className call
    "circle",
}

CSS_CANDIDATES = (
    r"C:/Users/*/AppData/Local/hermes/hermes-agent/apps/desktop/dist/assets/*.css",
    r"C:/Users/*/AppData/Roaming/Hermes/**/assets/*.css",
    "/Applications/Hermes.app/Contents/Resources/**/assets/*.css",
    "~/.config/Hermes/**/assets/*.css",
)

TOKEN_RE = re.compile(r"[A-Za-z0-9:_\-\[\]\(\)\/.,%#!&*]+")
ESCAPE_CHARS = "[]()/%.,:!#&*"


def escape_class(token: str) -> str:
    out = token
    for char in ESCAPE_CHARS:
        out = out.replace(char, "\\" + char)
    return out


def class_tokens(build: str) -> dict[str, int]:
    """Every class token the build actually puts in a className or a *_CLASS constant.

    Deliberately narrow: an extraction that also picks up ids, prose and string
    values produces a worklist nobody can act on, and a gate nobody reads is a gate
    that gets ignored.
    """
    counts: dict[str, int] = {}

    def add(value: str) -> None:
        for token in value.split():
            if TOKEN_RE.fullmatch(token):
                counts[token] = counts.get(token, 0) + 1

    patterns = (
        r"className:\s*'([^']*)'",                      # className: '...'
        r"className:\s*cn\(((?:[^()]|\([^()]*\))*)\)",  # className: cn('a', 'b', x ? 'c' : 'd')
        r"const\s+[A-Z][A-Z0-9_]*CLASS[A-Z0-9_]*\s*=\s*'([^']*)'",  # the *_CLASS constants
    )
    for pattern in patterns:
        for match in re.finditer(pattern, build, re.S):
            body = match.group(1)
            if pattern.endswith(r"\)"):
                # cn(...): every quoted literal inside the call
                for literal in re.finditer(r"'([^']*)'", body):
                    add(literal.group(1))
            else:
                add(body)
    return counts


def find_stylesheets(explicit: str | None) -> list[str]:
    if explicit:
        return sorted(glob.glob(os.path.expanduser(explicit), recursive=True))
    found: list[str] = []
    for pattern in CSS_CANDIDATES:
        found.extend(sorted(glob.glob(os.path.expanduser(pattern), recursive=True)))
    return found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--css", default=None, help="glob for the host stylesheets")
    parser.add_argument("--list", action="store_true", help="print the worklist and always exit 0")
    parser.add_argument("--min-uses", type=int, default=1, help="only report classes used at least N times")
    args = parser.parse_args()

    if not BUILD.exists():
        print(f"FAIL: {BUILD} is missing. Run scripts/regenerate.py first.")
        return 1
    sheets = find_stylesheets(args.css)
    if not sheets:
        print("UNVERIFIED: no host stylesheet found. Pass --css '<glob>' pointing at the")
        print("Desktop app's built assets (apps/desktop/dist/assets/*.css).")
        return 2 if not args.list else 0

    css = "".join(Path(sheet).read_text(encoding="utf-8", errors="replace") for sheet in sheets)
    tokens = class_tokens(BUILD.read_text(encoding="utf-8"))
    missing = []
    for token, uses in sorted(tokens.items()):
        if uses < args.min_uses or token in ALLOW or token.startswith(("data-", "aria-")):
            continue
        if f".{escape_class(token)}" in css or f".{token}" in css:
            continue
        missing.append((uses, token))

    arbitrary = [item for item in missing if "[" in item[1] or "(--" in item[1]]
    print(f"host sheets: {len(sheets)} ({len(css)} chars) · classes used: {len(tokens)} · with no rule: {len(missing)}")
    if missing:
        print("\nused by us, generated by nobody (the host defaults win):")
        for uses, token in sorted(missing, reverse=True):
            tag = "  <-- arbitrary value: use an inline style" if (uses, token) in arbitrary else ""
            print(f"  {uses:3d}x  {token}{tag}")
    if not missing:
        print("OK: every class we use has a rule in the host stylesheet.")
        return 0
    return 0 if args.list else 1


if __name__ == "__main__":
    sys.exit(main())
