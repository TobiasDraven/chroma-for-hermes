#!/usr/bin/env python3
"""Assign one category and one pack to every skin, and choose the 30 core skins.

Category is MEASURED from the accent hue (scripts/taxonomy.json).
Pack is CURATED but scored: each pack is a region in colour space, so a future
skin can be recommended a pack without a human vote, and a proposed pack can be
tested for coherence before it ships.
Core is the 30 most typical skins, taken proportionally from every category.

Writes category/pack into the skin files in skins-v2/. Idempotent.

Usage:
    python scripts/classify-skins.py [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))


def _load_analyser():
    """The analyser is a script, not a module: its name has a hyphen."""
    import importlib.util

    path = ROOT / "scripts" / "analyse-palettes.py"
    spec = importlib.util.spec_from_file_location("analyse_palettes", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_analyser = _load_analyser()
hex_to_linear = _analyser.hex_to_linear
linear_to_oklab = _analyser.linear_to_oklab
hex_to_oklch = _analyser.hex_to_oklch

SKINS = ROOT / "skins-v2"
TAXONOMY = json.loads((ROOT / "scripts" / "taxonomy.json").read_text(encoding="utf-8"))
CORE_TARGET = 30

PACKS = ("earth", "cyberpunk", "zen", "retro", "noir")


def load() -> dict[str, dict]:
    out = {}
    for path in sorted(SKINS.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        out[data["name"]] = data
    return out


def accent(skin: dict) -> dict | None:
    for mode in ("dark", "light"):
        palette = skin.get(f"{mode}_colors") or {}
        value = palette.get("ui_accent")
        if value:
            return hex_to_oklch(value) or None
    return None


def shell_l(skin: dict, mode: str) -> float | None:
    value = (skin.get(f"{mode}_colors") or {}).get("background")
    if not value:
        return None
    o = hex_to_oklch(value)
    return o["L"] if o else None


def categorise(oklch: dict | None) -> str:
    if oklch is None:
        return "neutral"
    if oklch["C"] < 0.04:
        return "neutral"
    h = oklch["h"] % 360
    for fam in TAXONOMY["families"]:
        if fam["from"] <= h < fam["to"]:
            return fam["id"]
    # the wheel wraps: everything below the first cut belongs to the last family
    return TAXONOMY["wrapper"]["family"]


def features(skin: dict) -> dict:
    a = accent(skin) or {"h": 0.0, "C": 0.0, "L": 0.0}
    return {
        "h": a["h"] % 360,
        "C": a["C"],
        "darkL": shell_l(skin, "dark") or 0.5,
        "lightL": shell_l(skin, "light") or 0.5,
        "name": skin["name"],
        "energy": energy_of(a["C"]),
    }


def energy_of(chroma: float) -> str:
    """How loud the accent is. This is the muted/vibrant axis, measured."""
    if chroma < 0.06:
        return "quiet"
    if chroma < 0.14:
        return "balanced"
    return "vivid"


NAME_SEMANTICS = {
    "vivid": ("cyber", "neon", "synth", "punk", "glitch", "vapor", "laser", "chrome",
              "vibrant", "neon", "alert", "flash", "flare", "neon"),
    "quiet": ("minimal", "paper", "linen", "rice", "sage", "mist", "calm", "muted",
              "typewriter", "cream", "ash", "stone", "alabaster", "parchment"),
}


def implied_energy(name: str) -> str | None:
    """What the NAME promises, before measuring anything."""
    for energy, keys in NAME_SEMANTICS.items():
        if any(k in name for k in keys):
            return energy
    return None


def semantics_conflicts(skins: dict, feats: dict, cats: dict) -> list[dict]:
    """A name that promises a different character than the palette delivers.

    Reported, never silently overridden: the measurement wins the category, and
    the disagreement is surfaced so the skin can be renamed or re-cut.
    """
    out = []
    for name, f in feats.items():
        claim = implied_energy(name)
        if not claim or claim == f["energy"]:
            continue
        out.append({
            "skin": name,
            "name_implies": claim,
            "measured": f["energy"],
            "accent_chroma": round(f["C"], 3),
            "category": cats[name],
        })
    return out


def _warm(h: float) -> bool:
    return h < 118 or h >= 322


def score_packs(f: dict) -> dict[str, float]:
    """Score a skin against each pack's region. Higher is a better fit."""
    h, C, darkL, lightL, name = f["h"], f["C"], f["darkL"], f["lightL"], f["name"]
    scores = {p: 0.0 for p in PACKS}

    # retro: phosphor accents on a near-black shell, or an obvious machine name
    if _warm(h) and darkL < 0.32:
        scores["retro"] += 1.0
    if 60 <= h < 118 and C >= 0.06 and darkL < 0.40:
        scores["retro"] += 0.8
    if any(k in name for k in ("retro", "terminal", "commodore", "lcars", "amber",
                               "screen", "typewriter", "vhs", "console", "dos")):
        scores["retro"] += 2.0

    # cyberpunk: vivid accent, night shell, synthetic hues
    if C >= 0.14:
        scores["cyberpunk"] += 1.2
    if C >= 0.14 and darkL < 0.35:
        scores["cyberpunk"] += 0.8
    if any(k in name for k in ("neon", "synth", "cyber", "glitch", "vapor", "punk",
                               "matrix", "netrunner", "chrome", "laser")):
        scores["cyberpunk"] += 2.2

    # zen: quiet chroma, paper-light shell
    if C < 0.075:
        scores["zen"] += 1.2
    if C < 0.075 and lightL > 0.82:
        scores["zen"] += 0.9
    if any(k in name for k in ("paper", "linen", "rice", "sage", "mist", "calm",
                               "stone", "alabaster", "parchment", "vanilla")):
        scores["zen"] += 1.6

    # noir: deep shell, restrained accent, high reading contrast
    if darkL < 0.22:
        scores["noir"] += 1.4
    if darkL < 0.22 and C < 0.12:
        scores["noir"] += 0.8
    if any(k in name for k in ("noir", "obsidian", "void", "black", "ghost",
                               "shadow", "midnight", "eclipse", "deep")):
        scores["noir"] += 1.8

    # earth: warm, moderate chroma, material names
    if _warm(h) and 0.05 <= C < 0.20:
        scores["earth"] += 1.1
    if any(k in name for k in ("earth", "forest", "moss", "desert", "wood", "sand",
                               "autumn", "clay", "redwood", "malt", "mushroom")):
        scores["earth"] += 2.0

    return scores


def pick_pack(f: dict) -> str:
    scores = score_packs(f)
    best = max(PACKS, key=lambda p: (scores[p], -PACKS.index(p)))
    if scores[best] <= 0:
        # no region claims it: send it to the pack whose accent hue band is nearest
        centroids = {"earth": 70, "cyberpunk": 315, "zen": 90, "retro": 80, "noir": 250}
        return min(PACKS, key=lambda p: min(abs(f["h"] - centroids[p]), 360 - abs(f["h"] - centroids[p])))
    return best


def max_role_distance(one: dict, two: dict, role: str = "ui_accent") -> float:
    a = (one.get("dark_colors") or {}).get(role) or (one.get("light_colors") or {}).get(role)
    b = (two.get("dark_colors") or {}).get(role) or (two.get("light_colors") or {}).get(role)
    if not a or not b:
        return 1.0
    la, lb = hex_to_linear(a), hex_to_linear(b)
    if la is None or lb is None:
        return 1.0
    return math.dist(linear_to_oklab(la), linear_to_oklab(lb))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    skins = load()
    feats = {n: features(s) for n, s in skins.items()}
    cats = {n: categorise(accent(s)) for n, s in skins.items()}

    counts = Counter(cats.values())
    print("categories:", dict(sorted(counts.items(), key=lambda kv: -kv[1])))
    print("sum:", sum(counts.values()), "| families declared:", len(TAXONOMY["families"]) + 1)

    # core: proportional to category size, then the most typical within each
    total = len(skins)
    quota = {}
    remainders = []
    for cat, n in counts.items():
        exact = CORE_TARGET * n / total
        quota[cat] = int(exact)
        remainders.append((exact - int(exact), cat))
    for _frac, cat in sorted(remainders, reverse=True):
        if sum(quota.values()) >= CORE_TARGET:
            break
        quota[cat] += 1
    while sum(quota.values()) > CORE_TARGET:
        biggest = max(quota, key=lambda c: quota[c])
        quota[biggest] -= 1

    core = []
    for cat, k in quota.items():
        members = [n for n in skins if cats[n] == cat]
        if not members:
            continue
        centroid = {
            "h": sum(feats[n]["h"] for n in members) / len(members),
            "C": sum(feats[n]["C"] for n in members) / len(members),
        }
        def typicality(n):
            dh = abs(feats[n]["h"] - centroid["h"])
            dh = min(dh, 360 - dh) / 180
            return dh + abs(feats[n]["C"] - centroid["C"]) * 2
        core.extend(sorted(members, key=typicality)[:k])

    energies = Counter(feats[n]["energy"] for n in skins)
    print("energy:", dict(energies))
    conflicts = semantics_conflicts(skins, feats, cats)
    print("name/colour conflicts:", len(conflicts))
    for c in conflicts[:12]:
        print("   ", c["skin"], "| name says", c["name_implies"], "| measured", c["measured"])

    core_set = set(core)
    non_core = [n for n in skins if n not in core_set]
    scored = {n: score_packs(feats[n]) for n in non_core}

    # Capacity-bound assignment: the most confident skins pick first, but no pack
    # may exceed its share and none may starve. Score decides order and choice;
    # capacity keeps every pack inside the 10-20 contract.
    share, extra = divmod(len(non_core), len(PACKS))
    capacity = {p: share + (1 if i < extra else 0) for i, p in enumerate(PACKS)}
    confidence = {
        n: sorted(scored[n].values())[-1] - sorted(scored[n].values())[-2]
        for n in non_core
    }
    packs = {n: "core" for n in core_set}
    for n in sorted(non_core, key=lambda k: -confidence[k]):
        for p in sorted(PACKS, key=lambda k: -scored[n][k]):
            if capacity[p] > 0:
                packs[n] = p
                capacity[p] -= 1
                break
        else:
            packs[n] = max(PACKS, key=lambda k: scored[n][k])

    pack_counts = Counter(packs.values())
    print("packs:", dict(pack_counts))
    if pack_counts.get("core") != CORE_TARGET:
        print("CORE TARGET MISSED:", pack_counts.get("core"))
    thin = {p: c for p, c in pack_counts.items() if p != "core" and (c < 10 or c > 20)}
    if thin:
        print("PACK SIZE OUT OF RANGE (10-20):", thin)

    for name, skin in sorted(skins.items()):
        skin["category"] = cats[name]
        skin["pack"] = packs[name]
        skin["energy"] = feats[name]["energy"]
    if not args.dry_run:
        for name, skin in skins.items():
            (SKINS / (name + ".yaml")).write_text(
                yaml.safe_dump(skin, sort_keys=False, allow_unicode=True, width=100),
                encoding="utf-8",
            )
        print("wrote", len(skins), "files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
