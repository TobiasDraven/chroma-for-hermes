#!/usr/bin/env python3
"""Generate docs/FONTS.md — the font register for every family a skin names.

Reads skins-v2/*.yaml, extracts the quoted and unquoted font-family names from
fontSans / fontMono / fontDisplay, counts how many skins name each, and writes
docs/FONTS.md. The family/usage data is derived from the catalogue; the licence
column comes from EVIDENCE below (licence pages fetched on 2026-10-20 with
curl). A family found in skins but missing from EVIDENCE prints UNVERIFIED
rather than a guess, so the register can never silently highlight a family
with an invented licence.

Deterministic: no timestamps, sorted output, EOL is LF. Run twice and the
bytes must match. Docs/FONTS.md must be regenerated whenever skins-v2 changes.
"""
from __future__ import annotations

import glob
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "FONTS.md"
SKIN_GLOB = str(ROOT / "skins-v2" / "*.yaml")

FONT_KEY_RE = re.compile(r"^\s+(fontSans|fontMono|fontDisplay):(.*)$")
CONTINUATION_RE = re.compile(r"^\s{4,}\S")
KEY_LINE_RE = re.compile(r"^\s{2}[A-Za-z_]+\s*:")

# Generic family keywords that name a class of font, not a family.
GENERICS = {
    "sans-serif",
    "serif",
    "monospace",
    "system-ui",
    "ui-monospace",
    "-apple-system",
}

# System emoji fallbacks. They exist on every machine that matters; they are
# not typography choices, so they go in a note, not the main table.
EMOJI_ALIASES = {"Apple Color Emoji", "Segoe UI Emoji", "emoji"}

# Licence evidence, fetched 2026-10-20 with curl (see DISCLOSURE-style notes in
# the generated file itself). Key = family name exactly as it appears in a
# stack. Anything absent renders UNVERIFIED.
EVIDENCE = {
    "Cascadia Mono": (
        "SIL Open Font License 1.1",
        "https://github.com/microsoft/cascadia-code "
        "(LICENSE declares the SIL OFL 1.1)",
    ),
    "Courier Prime": (
        "SIL Open Font License 1.1",
        "https://api.github.com/repos/quoteunquoteapps/CourierPrime (license: OFL-1.1)",
    ),
    "Courier New": (
        "Microsoft/Monotype, bundled with Windows",
        "https://learn.microsoft.com/en-us/typography/font-list/courier-new",
    ),
    "Consolas": (
        "Microsoft, bundled with Windows",
        "https://learn.microsoft.com/en-us/typography/font-list/consolas",
    ),
    "Fira Code": (
        "SIL Open Font License 1.1",
        "https://api.github.com/repos/tonsky/FiraCode (license: OFL-1.1)",
    ),
    "IBM Plex Mono": (
        "SIL Open Font License 1.1",
        "https://api.github.com/repos/IBM/plex (license: OFL-1.1)",
    ),
    "Inter": (
        "SIL Open Font License 1.1",
        "https://api.github.com/repos/rsms/inter (license: OFL-1.1)",
    ),
    "JetBrains Mono": (
        "SIL Open Font License 1.1",
        "https://api.github.com/repos/JetBrains/JetBrainsMono (license: OFL-1.1)",
    ),
    "Segoe UI": (
        "Microsoft, bundled with Windows 10/11",
        "https://learn.microsoft.com/en-us/typography/font-list/segoe-ui",
    ),
    "SF Mono": (
        "Apple San Francisco Font licence (not redistributable)",
        "https://developer.apple.com/fonts/",
    ),
    "Source Code Pro": (
        "SIL Open Font License 1.1",
        "https://api.github.com/repos/adobe-fonts/source-code-pro (license: OFL-1.1)",
    ),
    "Source Sans 3": (
        "SIL Open Font License 1.1",
        "https://api.github.com/repos/adobe-fonts/source-sans (license: OFL-1.1)",
    ),
    "Space Grotesk": (
        "SIL Open Font License 1.1",
        "https://api.github.com/repos/floriankarsten/space-grotesk (license: OFL-1.1)",
    ),
    "Segoe WPC": ("UNVERIFIED", "no public licence page found"),
    "Menlo": ("UNVERIFIED", "no public licence page found (Apple system font)"),
    "Monaco": ("UNVERIFIED", "no public licence page found (Apple system font)"),
    "Segoe UI Symbol": ("UNVERIFIED", "no public licence page found"),
}


def read_file(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def font_scalars(text: str) -> list[tuple[str, str]]:
    """Yield (key, value) for fontSans/fontMono/fontDisplay, following YAML
    wrapped-plain-scalar continuation lines."""
    out = []
    lines = text.splitlines()
    for index, line in enumerate(lines):
        match = FONT_KEY_RE.match(line)
        if not match:
            continue
        pieces = [match.group(2)]
        for follow in lines[index + 1 :]:
            if KEY_LINE_RE.match(follow) and not FONT_KEY_RE.match(follow):
                break
            if not CONTINUATION_RE.match(follow):
                break
            pieces.append(follow)
        out.append((match.group(1), " ".join(pieces)))
    return out


def families_in(value: str) -> list[str]:
    """Split a font stack into family names. Strips the YAML outer quotes and
    any quoting inside the stack; drops generics and empty tokens."""
    value = value.strip()
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        value = value[1:-1]
    out = []
    for raw in value.split(","):
        token = raw.strip()
        token = ''.join(ch for ch in token if ch not in "'\"").strip()
        token = re.sub(r"\s+", " ", token)
        if not token or token in GENERICS:
            continue
        out.append(token)
    return out


def register() -> dict[str, dict]:
    """Build {family: {count, hits, keys}} over every skin file."""
    files = sorted(glob.glob(SKIN_GLOB))
    if not files:
        print("font-register: no skin files under skins-v2/ — refusing", file=sys.stderr)
        sys.exit(1)
    reg: dict[str, dict] = {}
    for path in files:
        skin = os.path.splitext(os.path.basename(path))[0]
        for key, value in font_scalars(read_file(path)):
            for family in families_in(value):
                entry = reg.setdefault(
                    family, {"count": 0, "hits": [], "keys": Counter()}
                )
                if skin not in entry["hits"]:
                    entry["count"] += 1
                    entry["hits"].append(skin)
                entry["keys"][key] += 1
    return reg


def key_note(keys: Counter) -> str:
    parts = []
    label = {"fontSans": "sans", "fontMono": "mono", "fontDisplay": "display"}
    for name in ("fontSans", "fontMono", "fontDisplay"):
        if keys.get(name):
            parts.append(label[name] + " " + str(keys[name]))
    return ", ".join(parts)


def licence_for(family: str) -> tuple[str, str]:
    entry = EVIDENCE.get(family)
    if entry is None:
        return "UNVERIFIED", "UNVERIFIED"
    return entry


def main() -> None:
    reg = register()
    typography = sorted(
        (f for f in reg if f not in EMOJI_ALIASES),
        key=lambda name: (-reg[name]["count"], name),
    )
    fallbacks = sorted((f for f in reg if f in EMOJI_ALIASES), key=lambda name: name)
    lines = []
    lines.append("# Font register")
    lines.append("")
    lines.append("> Generated by `scripts/font-register.py` from `skins-v2/*.yaml` —")
    lines.append("> do not edit by hand; re-run the script after any skin change.")
    lines.append("> Chroma ships no font binaries: a skin only names families, and")
    lines.append("> rendering resolves through whatever the operating system provides.")
    lines.append("")
    lines.append("Used by = the number of skins naming the family in any of")
    lines.append("`fontSans` / `fontMono` / `fontDisplay`, out of every skin in the")
    lines.append("catalogue. Every licence statement was fetched from the cited page")
    lines.append("with curl on 2026-10-20; `UNVERIFIED` means the licence could not")
    lines.append("be confirmed from a public page and is never a guess.")
    lines.append("")
    lines.append("| Family | Used by | Licence | Source |")
    lines.append("|--------|---------|---------|--------|")
    for family in typography:
        entry = reg[family]
        licence, source = licence_for(family)
        lines.append(
            "| {} | {} ({}) | {} | {} |".format(
                family, entry["count"], key_note(entry["keys"]), licence, source
            )
        )
    lines.append("")
    lines.append("## Emoji fallbacks, not typography")
    lines.append("")
    lines.append("These names appear at the end of skin stacks as system emoji")
    lines.append("fallbacks — a terminal or surface substitutes whatever the")
    lines.append(f"machine provides ({', '.join('`{}`'.format(f) for f in fallbacks)}).")
    lines.append("They are listed here for completeness, with the same skin counts:")
    lines.append("")
    for family in fallbacks:
        entry = reg[family]
        lines.append(
            "- `{}` — named by {} skin(s){} — licence UNVERIFIED".format(
                family,
                entry["count"],
                " (" + key_note(entry["keys"]) + ")" if key_note(entry["keys"]) else "",
            )
        )
    lines.append("")
    lines.append("No portability claim is made for any family in this register: a")
    lines.append("machine without, say, Cascadia Mono ends on a generic and the skin")
    lines.append("still renders. Nothing here is about installing or fetching fonts.")
    lines.append("")
    os.makedirs(OUT.parent, exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines))
    untabled = sum(1 for f in typography if EVIDENCE.get(f) is None)
    print("font-register: {} skins scanned; {} families; {}".format(
        len(glob.glob(SKIN_GLOB)), len(reg),
        ("{} untabled (licence UNVERIFIED)".format(untabled)) if untabled
        else "licences all evidenced",
    ))


if __name__ == "__main__":
    main()
