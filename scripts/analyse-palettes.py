#!/usr/bin/env python3
"""Measure the shipped catalogue in OKLCH. No network, no side effects.

Reads the catalogue from the generated build (the shipped truth) and writes a
machine-readable dump plus a human report. The six signature roles are the ones
a user actually perceives; distance is the MAXIMUM per-role OKLab distance, not
the mean, because two skins that differ only in their accent still read as the
same skin.

Usage:
    python scripts/analyse-palettes.py [--json PATH] [--md PATH] [--stdout]
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "desktop" / "plugin.js"

# role id -> palette key. "raised" is the chrome surface above the shell.
SIGNATURE = (
    ("shell", "background"),
    ("raised", "status_bar_bg"),
    ("signature", "ui_accent"),
    ("reading", "banner_text"),
    ("secondary", "banner_dim"),
    ("structure", "ui_border"),
)


def _srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(hex_value: str):
    h = hex_value.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    if len(h) != 6:
        return None
    try:
        return tuple(_srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))
    except ValueError:
        return None


def linear_to_oklab(rgb):
    r, g, b = rgb
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


def hex_to_oklch(hex_value: str):
    rgb = hex_to_linear(hex_value)
    if rgb is None:
        return None
    L, a, b = linear_to_oklab(rgb)
    C = math.hypot(a, b)
    h = math.degrees(math.atan2(b, a)) % 360.0
    return {"L": round(L, 6), "C": round(C, 6), "h": round(h, 2)}


def luminance(hex_value: str):
    rgb = hex_to_linear(hex_value)
    if rgb is None:
        return None
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def contrast(one: str, two: str):
    a, b = luminance(one), luminance(two)
    if a is None or b is None:
        return None
    hi, lo = max(a, b), min(a, b)
    return round((hi + 0.05) / (lo + 0.05), 2)


def load_catalog() -> list[dict]:
    text = BUILD.read_text(encoding="utf-8")
    match = re.search(r"const SKINS = (\[.*?\])\n", text, re.S)
    if not match:
        raise SystemExit("catalogue literal not found in " + str(BUILD))
    return json.loads(match.group(1))


def distance(one: dict, two: dict):
    """Maximum per-role OKLab distance across the six roles, both modes."""
    worst = 0.0
    for mode in ("light", "dark"):
        palette_a = one.get(mode + "Colors") or {}
        palette_b = two.get(mode + "Colors") or {}
        for _role, key in SIGNATURE:
            a, b = palette_a.get(key), palette_b.get(key)
            if not a or not b:
                continue
            la, lb = hex_to_linear(a), hex_to_linear(b)
            if la is None or lb is None:
                continue
            d = math.dist(linear_to_oklab(la), linear_to_oklab(lb))
            worst = max(worst, d)
    return round(worst, 5)


def nearest_neighbours(skins: list[dict]) -> dict[str, tuple[str, float]]:
    out = {}
    for i, skin in enumerate(skins):
        best_name, best = None, float("inf")
        for j, other in enumerate(skins):
            if i == j:
                continue
            d = distance(skin, other)
            if d < best:
                best_name, best = other["name"], d
        out[skin["name"]] = (best_name, best)
    return out


def hue_band(h: float) -> str:
    bands = (
        (15, "red"), (45, "orange"), (70, "gold"), (105, "yellow-green"),
        (150, "green"), (185, "teal"), (215, "cyan"), (255, "blue"),
        (290, "violet"), (330, "magenta"), (360, "red"),
    )
    for edge, label in bands:
        if h < edge:
            return label
    return "red"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", default=str(ROOT / "docs" / "PALETTE-ANALYSIS.json"))
    parser.add_argument("--md", default=str(ROOT / "docs" / "PALETTE-ANALYSIS.md"))
    parser.add_argument("--stdout", action="store_true")
    args = parser.parse_args()

    skins = load_catalog()
    rows = []
    for skin in skins:
        row = {
            "name": skin["name"],
            "label": skin.get("label") or skin["name"],
            "category": skin.get("category") or "",
            "source": skin.get("source", ""),
            "pack": skin.get("pack") or "",
            "derived": bool(skin.get("derivedLight") or skin.get("derivedDark")),
            "roles": {},
        }
        for mode in ("light", "dark"):
            palette = skin.get(mode + "Colors") or {}
            roles = {}
            for role, key in SIGNATURE:
                value = palette.get(key)
                if not value:
                    continue
                roles[role] = {"hex": value, "oklch": hex_to_oklch(value)}
            row[mode] = roles
            row[mode + "Contrast"] = {
                "reading": contrast(palette.get("banner_text", ""), palette.get("background", "")),
                "signature": contrast(palette.get("ui_accent", ""), palette.get("background", "")),
            }
            row[mode + "Missing"] = [k for _r, k in SIGNATURE if not palette.get(k)]
        rows.append(row)

    neighbours = nearest_neighbours(skins)
    for row in rows:
        near, dist = neighbours[row["name"]]
        row["nearest"] = {"name": near, "distance": dist}

    accents = [r["dark"]["signature"]["oklch"] for r in rows if r.get("dark", {}).get("signature")]
    hue_hist = Counter(hue_band(a["h"]) for a in accents)
    chroma_bins = Counter(round(a["C"] * 20) / 20 for a in accents)
    lightness_bins = Counter(round(a["L"] * 10) / 10 for a in accents)

    closest = sorted(
        ({"a": r["name"], "b": r["nearest"]["name"], "distance": r["nearest"]["distance"]} for r in rows),
        key=lambda p: p["distance"],
    )[:20]

    payload = {
        "generated_from": "desktop/plugin.js",
        "skins": len(rows),
        "signature_roles": [{"role": r, "key": k} for r, k in SIGNATURE],
        "hue_histogram": dict(sorted(hue_hist.items())),
        "chroma_histogram": {str(k): v for k, v in sorted(chroma_bins.items())},
        "lightness_histogram": {str(k): v for k, v in sorted(lightness_bins.items())},
        "closest_pairs": closest,
        "cards": rows,
    }

    Path(args.json).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    missing = [r["name"] for r in rows if r["darkMissing"] or r["lightMissing"]]
    derived = [r["name"] for r in rows if r["derived"]]
    near_dup = [p for p in closest if p["distance"] < 0.02]
    close = [p for p in closest if 0.02 <= p["distance"] < 0.05]

    lines = [
        "# Palette analysis",
        "",
        "Generated by `scripts/analyse-palettes.py` from `desktop/plugin.js`.",
        "Six signature roles, OKLab distance, maximum per role (not the mean).",
        "",
        "## Totals",
        "",
        "| measure | value |",
        "|---|---|",
        f"| skins | {len(rows)} |",
        f"| with a derived mode | {len(derived)} |",
        f"| missing a signature role | {len(missing)} |",
        f"| pairs below 0.02 (near-duplicate) | {len(near_dup)} |",
        f"| pairs 0.02-0.05 (close) | {len(close)} |",
        "",
        "## Accent hue coverage (dark mode, 109 accents)",
        "",
        "| band | skins |",
        "|---|---|",
    ]
    for band, count in sorted(hue_hist.items(), key=lambda kv: -kv[1]):
        lines.append(f"| {band} | {count} |")
    lines += ["", "## Closest pairs", "", "| a | b | max OKLab distance |", "|---|---|---|"]
    for pair in closest[:15]:
        lines.append(f"| {pair['a']} | {pair['b']} | {pair['distance']} |")
    if missing:
        lines += ["", "## Missing a signature role", "", ", ".join(f"`{n}`" for n in missing)]
    Path(args.md).write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"skins={len(rows)} derived={len(derived)} missing_role={len(missing)}")
    print(f"near_duplicate={len(near_dup)} close={len(close)}")
    print("hue:", dict(sorted(hue_hist.items(), key=lambda kv: -kv[1])))
    print("closest:", closest[0] if closest else None)
    if args.stdout:
        print(json.dumps(payload["cards"][:2], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
