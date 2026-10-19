#!/usr/bin/env python3
"""Gate: the skin catalogue obeys its own contract.

Asserts the invariants the product depends on, and fails loudly:
  - every skin is a file with BOTH palettes
  - every skin has exactly one pack and exactly one category
  - packs partition the catalogue: core is exactly 30, every other pack 10-20
  - every skin carries a font choice
  - ids are unique and every category id exists in the taxonomy

Exits 1 on the first broken invariant, printing every failure it found.

Usage:
    python scripts/check-packs.py [--dir skins-v2]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CORE_TARGET = 30
PACK_RANGE = (10, 20)
ALL_PACKS = ("core", "earth", "cyberpunk", "zen", "retro", "noir", "studio")
ENERGIES = {"quiet", "balanced", "vivid"}
# The design spec a skin was authored against. v1 = the 43-key palette as found.
# v2 = ten surfaces plus fonts (docs/THEME-PACK-CREATION.md); the other keys
# derive, so a v2 skin is not finished if one of the ten is missing.
DESIGN_SPECS = {"v1", "v2"}
V2_SURFACES = (
    "background",    # canvas
    "status_bar_bg",  # panel surface
    "ui_text",        # primary ink
    "banner_dim",     # secondary ink
    "ui_accent",      # signature
    "ui_border",      # hairline
    "ui_ok",          # positive signal
    "ui_warn",        # caution signal
    "ui_error",       # failure signal
    "selection_bg",   # selection
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default=str(ROOT / "skins-v2"))
    args = parser.parse_args()

    taxonomy = json.loads((ROOT / "scripts" / "taxonomy.json").read_text(encoding="utf-8"))
    valid_categories = {f["id"] for f in taxonomy["families"]} | {taxonomy["neutral"]["id"]}
    packs = set(ALL_PACKS)

    failures: list[str] = []
    pack_counts: Counter = Counter()
    category_counts: Counter = Counter()
    seen: set[str] = set()
    labels: dict[str, str] = {}

    files = sorted(Path(args.dir).glob("*.yaml"))
    if not files:
        print("FAIL no skin files in", args.dir)
        return 1

    for path in files:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        name = data.get("name") or path.stem
        if name in seen:
            failures.append(f"{name}: duplicate id")
        seen.add(name)

        label = data.get("label") or ""
        if label:
            if label in labels:
                failures.append(f"{name}: label {label!r} is already used by {labels[label]}")
            labels[label] = name

        if path.stem != name:
            failures.append(f"{name}: file stem {path.stem} does not match id")

        for mode in ("light_colors", "dark_colors"):
            palette = data.get(mode)
            if not isinstance(palette, dict) or not palette:
                failures.append(f"{name}: missing {mode}")
            elif not palette.get("background"):
                failures.append(f"{name}: {mode} has no background")
            elif not palette.get("ui_accent"):
                failures.append(f"{name}: {mode} has no ui_accent")

        pack = data.get("pack")
        if pack not in packs:
            failures.append(f"{name}: pack {pack!r} is not one of {sorted(packs)}")
        else:
            pack_counts[pack] += 1

        category = data.get("category")
        if category not in valid_categories:
            failures.append(f"{name}: category {category!r} is not in the taxonomy")
        else:
            category_counts[category] += 1

        typo = data.get("typography") or {}
        if not typo.get("fontMono"):
            failures.append(f"{name}: no fontMono")
        if not typo.get("fontSans"):
            failures.append(f"{name}: no fontSans")

        if data.get("energy") not in ENERGIES:
            failures.append(f"{name}: energy {data.get('energy')!r} is not one of {sorted(ENERGIES)}")

        derived = (data.get("provenance") or {}).get("derived") or []
        for mode in derived:
            if mode not in ("light", "dark"):
                failures.append(f"{name}: provenance.derived holds {mode!r}")

        if data.get("schema_version") != 2:
            failures.append(f"{name}: schema_version is {data.get('schema_version')!r}, expected 2")

        spec = data.get("design_spec")
        if spec not in DESIGN_SPECS:
            failures.append(f"{name}: design_spec is {spec!r}, expected one of {sorted(DESIGN_SPECS)}")
        elif spec == "v2":
            for mode in ("light_colors", "dark_colors"):
                palette = data.get(mode) or {}
                missing = [key for key in V2_SURFACES if not palette.get(key)]
                if missing:
                    failures.append(f"{name}: v2 {mode} omits {missing}")
            # v2 is ten surfaces and fonts: both stacks are already required above.

    if pack_counts.get("core") != CORE_TARGET:
        failures.append(f"core holds {pack_counts.get('core')} skins, expected {CORE_TARGET}")
    # Iterate the declared packs, not the observed ones: a pack that lost every
    # member must fail, not vanish from the check.
    for pack in ALL_PACKS:
        if pack == "core":
            continue
        count = pack_counts.get(pack, 0)
        low, high = PACK_RANGE
        if not low <= count <= high:
            failures.append(f"pack {pack} holds {count} skins, outside {low}-{high}")

    empty = valid_categories - set(category_counts)
    if empty:
        failures.append(f"categories with no skins: {sorted(empty)}")

    print(f"skins: {len(seen)}")
    print("packs:", dict(sorted(pack_counts.items())))
    print("categories:", dict(sorted(category_counts.items(), key=lambda kv: -kv[1])))

    if failures:
        print(f"\nFAIL {len(failures)} invariant(s) broken:")
        for line in failures:
            print("  -", line)
        return 1

    print("\nOK: contract holds")
    return 0


if __name__ == "__main__":
    sys.exit(main())
