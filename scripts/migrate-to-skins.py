#!/usr/bin/env python3
"""P2 — materialise the catalogue as one file per skin.

Reads the 150 v1 palette files, joins the pairs, ports the 47 missing halves
ONCE, and writes 94 dual-mode skin files. Then it projects those files back to
today's catalogue shape and diffs every palette against the shipped build.

Nothing is written to skins/ until the projection is clean; output goes to
skins-v2/ and the two orphan files are reported, never deleted.

Usage:
    python scripts/migrate-to-skins.py [--out DIR]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from regenerate import KEEP_KEYS, HEX_RE, _port_palette  # noqa: E402

SKINS = ROOT / "skins"
BUILD = ROOT / "desktop" / "plugin.js"


def load_catalog() -> list[dict]:
    text = BUILD.read_text(encoding="utf-8")
    return json.loads(re.search(r"const SKINS = (\[.*?\])\n", text, re.S).group(1))


def load_palette(stem: str) -> dict:
    path = SKINS / (stem + ".yaml")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    colors = data.get("colors") or {}
    return {k: v for k, v in colors.items() if isinstance(v, str) and HEX_RE.match(v)}


def compact(palette: dict) -> dict:
    return {k: v for k, v in palette.items() if k in KEEP_KEYS}


def build_skins(cards: list[dict]) -> tuple[list[dict], list[str]]:
    """Return (v2 skin records, names of cards that could not be built)."""
    out, failed = [], []
    for card in cards:
        name = card["name"]
        light_stem, dark_stem = card.get("lightName"), card.get("darkName")
        try:
            if light_stem and dark_stem:
                light = load_palette(light_stem)
                dark = load_palette(dark_stem)
                derived = {}
            elif dark_stem:
                dark = load_palette(dark_stem)
                # Port from the COMPACTED source, exactly as the build does today:
                # _port_palette synthesises extra roles, and starting from the full
                # 43-role file would change the shipped bytes.
                light = _port_palette(compact(dark), "light")
                derived = {"light": True}
            elif light_stem:
                light = load_palette(light_stem)
                dark = _port_palette(compact(light), "dark")
                derived = {"dark": True}
            else:
                failed.append(name)
                continue
        except FileNotFoundError as error:
            failed.append(f"{name}: {error.filename}")
            continue

        if not light or not dark:
            failed.append(f"{name}: empty palette")
            continue

        record = {
            "schema_version": 2,
            "name": name,
            "label": card.get("label") or name,
            "description": card.get("description", ""),
            "category": card.get("category", ""),
            "pack": card.get("pack") or "core",
            "source": "user",
            "provenance": {
                "light_file": light_stem,
                "dark_file": dark_stem,
                "derived": sorted(derived),
            },
            "light_colors": light,
            "dark_colors": dark,
        }
        out.append(record)
    return out, failed


def project(record: dict) -> dict:
    """Project a v2 record back to the shape the current build emits.

    Authored palettes are compacted to KEEP_KEYS on load; a ported palette is
    emitted whole, because _port_palette synthesises the extra roles itself.
    """
    derived = set(record["provenance"]["derived"])
    return {
        "name": record["name"],
        "lightColors": record["light_colors"] if "light" in derived else compact(record["light_colors"]),
        "darkColors": record["dark_colors"] if "dark" in derived else compact(record["dark_colors"]),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(ROOT / "skins-v2"))
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    catalog = load_catalog()
    user_cards = [c for c in catalog if c.get("source") == "user"]
    shipped = {c["name"]: c for c in user_cards}

    records, failed = build_skins(user_cards)
    if failed:
        print("COULD NOT BUILD:", failed)

    mismatched, checked = [], 0
    for record in records:
        want = shipped.get(record["name"])
        if not want:
            mismatched.append((record["name"], "no shipped card"))
            continue
        got = project(record)
        for mode in ("lightColors", "darkColors"):
            if got[mode] != (want.get(mode) or {}):
                only_got = {k: v for k, v in got[mode].items() if want.get(mode, {}).get(k) != v}
                only_want = {k: v for k, v in (want.get(mode) or {}).items() if got[mode].get(k) != v}
                mismatched.append((record["name"], mode, only_got, only_want))
        checked += 1

    print(f"records={len(records)} checked={checked} mismatched={len(mismatched)}")
    for row in mismatched[:10]:
        print("  MISMATCH", row[0], row[1] if len(row) > 1 else "", str(row)[:220])

    if args.write and not mismatched:
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        for record in records:
            for key in ("provenance",):
                pass
            body = {k: v for k, v in record.items() if k != "provenance"}
            body["provenance"] = record["provenance"]
            (out / (record["name"] + ".yaml")).write_text(
                yaml.safe_dump(body, sort_keys=False, allow_unicode=True, width=100),
                encoding="utf-8",
            )
        print("wrote", len(records), "files to", out)
    elif args.write:
        print("REFUSED to write: projection does not match the shipped build")
        return 1

    claimed = set()
    for card in user_cards:
        for key in ("lightName", "darkName"):
            if card.get(key):
                claimed.add(card[key])
    on_disk = {p.stem for p in SKINS.glob("*.yaml")}
    print("orphan files (no card):", sorted(on_disk - claimed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
