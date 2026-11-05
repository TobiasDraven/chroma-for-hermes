#!/usr/bin/env python3
"""Render docs/palette-strip.svg from the shipped transport data.

The previous strip drew a light row and a dark row that were byte-identical,
because it was not generated from the transports at all. Every one of the 94
skins really does carry two distinct palettes, but a strip that shows the same
row twice proves nothing, so this strip shows the dark palette of each skin
once.

Source of truth: chroma/install/gateway-skins.json (188 transports, 94 skins).
Run:  python scripts/make-palette-strip.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "chroma" / "install" / "gateway-skins.json"
TARGET = ROOT / "docs" / "palette-strip.svg"
MODE = "dark"

# Swatch order, chosen so the row reads as a UI rather than a colour list:
# page, chrome, rule, text, signature, and the three status colours.
ROLES = [
    ("background", "bg"),
    ("status_bar_bg", "bar"),
    ("ui_border", "rule"),
    ("ui_text", "text"),
    ("ui_accent", "accent"),
    ("ui_ok", "ok"),
    ("ui_error", "err"),
    ("ui_warn", "warn"),
]

SHOWCASE = [
    "alabaster",
    "bone-white",
    "dark-catppuccin",
    "dark-gruvbox",
    "dark-nord",
    "dark-pastel-powder-blue",
    "dark-vscode",
    "enchanted-forest",
    "linen-sage",
    "nature-forest",
    "peach-fuzz",
    "sandstone",
]

ROW_H = 40
LABEL_W = 184
SWATCH_W = 78
SWATCH_GAP = 10
PAD = 12
HEADER_H = 34
WIDTH = PAD + LABEL_W + len(ROLES) * (SWATCH_W + SWATCH_GAP) + PAD


def load_transports() -> dict[str, dict[str, dict[str, str]]]:
    """Return {skin: {mode: {role: hex}}} from the shipped transport file."""
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    skins: dict[str, dict[str, dict[str, str]]] = {}
    for transport in data["transports"]:
        base, mode = transport["name"].rsplit("-", 1)
        skin = base.removeprefix("theme-picker-")
        skins.setdefault(skin, {})[mode] = transport["colors"]
    return skins


def title(name: str) -> str:
    return " ".join(part.capitalize() for part in name.split("-"))


def render(skins: dict[str, dict[str, dict[str, str]]]) -> str:
    rows = []
    for index, skin in enumerate(SHOWCASE):
        colours = skins[skin][MODE]
        y = HEADER_H + index * ROW_H
        rows.append(f'<text x="{PAD}" y="{y + 24}" fill="#d7dae3">{title(skin)}</text>')
        for slot, (role, _) in enumerate(ROLES):
            x = PAD + LABEL_W + slot * (SWATCH_W + SWATCH_GAP)
            fill = colours[role]
            rows.append(
                f'<rect x="{x}" y="{y + 8}" width="{SWATCH_W}" height="{ROW_H - 14}" '
                f'rx="3" fill="{fill}" stroke="#ffffff" stroke-opacity="0.22" '
                f'stroke-width="1"><title>{title(skin)} — {role} {fill}</title></rect>'
            )

    legend = "  ".join(label for _, label in ROLES)
    height = HEADER_H + len(SHOWCASE) * ROW_H + PAD
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{height}" viewBox="0 0 {WIDTH} {height}" role="img" aria-label="Twelve bundled skins, dark palettes">
<rect width="{WIDTH}" height="{height}" fill="#0b0c10"/>
<g font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="13">
<text x="{PAD}" y="20" fill="#8b90a0" font-size="11" letter-spacing="0.08em">{legend.upper()}</text>
{chr(10).join(rows)}
</g>
</svg>
"""


def main() -> None:
    skins = load_transports()
    missing = [skin for skin in SHOWCASE if skin not in skins]
    if missing:
        raise SystemExit(f"missing skins: {missing}")
    TARGET.write_text(render(skins), encoding="utf-8")
    print(f"wrote {TARGET.relative_to(ROOT)} ({len(SHOWCASE)} skins, {MODE} palettes)")


if __name__ == "__main__":
    main()
