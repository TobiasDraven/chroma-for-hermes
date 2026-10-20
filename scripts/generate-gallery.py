#!/usr/bin/env python3
"""Generate a self-contained visual gallery of every skin in skins-v2/.

The catalogue is the source of truth: each card's palettes, pack, category and
fonts are read from that skin's YAML. Pack order and titles come from
scripts/packs.json; categories are titled from scripts/taxonomy.json.

Run: python scripts/generate-gallery.py    (writes docs/gallery.html)
"""

from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SKINS_DIR = ROOT / "skins-v2"
PACKS_PATH = ROOT / "scripts" / "packs.json"
TAXONOMY_PATH = ROOT / "scripts" / "taxonomy.json"
OUTPUT = ROOT / "docs" / "gallery.html"

HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
GENERIC_FONTS = {
    "-apple-system",
    "blinkmacsystemfont",
    "cursive",
    "emoji",
    "fangsong",
    "fantasy",
    "math",
    "monospace",
    "sans-serif",
    "serif",
    "system-ui",
    "ui-monospace",
    "ui-rounded",
    "ui-sans-serif",
    "ui-serif",
}


def esc(value: object) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def category_titles() -> dict[str, str]:
    taxonomy = load_json(TAXONOMY_PATH)
    titles = {taxonomy.get("neutral", {}).get("id", "neutral"): taxonomy.get("neutral", {}).get("title", "Neutral")}
    for family in taxonomy.get("families", []):
        titles[family["id"]] = family.get("title") or family["id"]
    return titles


def pack_order() -> tuple[list[dict], dict[str, dict]]:
    data = load_json(PACKS_PATH)
    declared = list((data.get("packs") or {}).values())
    by_id = {pack["id"]: pack for pack in declared}
    return declared, by_id


def font_families(stack: object) -> list[str]:
    names: list[str] = []
    for part in str(stack or "").split(","):
        name = part.strip().strip('"').strip("'").strip()
        if not name:
            continue
        low = name.casefold()
        if low in GENERIC_FONTS or low.endswith(" emoji"):
            continue
        if name not in names:
            names.append(name)
    return names


def palette_bands(data: dict) -> list[tuple[str, dict]]:
    bands: list[tuple[str, dict]] = []
    for key, title in (("light_colors", "Light"), ("dark_colors", "Dark")):
        palette = data.get(key)
        if isinstance(palette, dict) and palette:
            bands.append((title, palette))
    if not bands:
        palette = data.get("colors")
        if isinstance(palette, dict) and palette:
            bands.append(("Palette", palette))
    return bands


def render_band(title: str, palette: dict) -> str:
    swatches = []
    for role, value in palette.items():
        text = str(value)
        if HEX_RE.fullmatch(text):
            style = ' style="background-color: ' + esc(text) + '"'
            swatches.append(
                '<span class="swatch"' + style
                + ' title="' + esc(role) + " \u00b7 " + esc(text) + '"'
                + ' aria-label="' + esc(role) + " " + esc(text) + '"></span>'
            )
        else:
            swatches.append(
                '<span class="swatch swatch-unknown" title="'
                + esc(role) + " \u00b7 " + esc(text) + '" aria-label="'
                + esc(role) + " " + esc(text) + '"></span>'
            )
    return (
        '<div class="band-row">'
        + '<span class="band-label">' + esc(title) + "</span>"
        + '<div class="band">' + "".join(swatches) + "</div>"
        + "</div>"
    )


def render_fonts(typography: dict) -> str:
    rows = []
    for key, label in (("fontSans", "Sans"), ("fontMono", "Mono")):
        families = font_families(typography.get(key))
        value = ", ".join(families) if families else "\u2014"
        rows.append(
            '<div class="font-row"><span class="font-label">' + esc(label)
            + '</span><span class="font-value">' + esc(value) + "</span></div>"
        )
    return '<div class="fonts">' + "".join(rows) + "</div>"


def render_card(skin: dict, category_titles_by_id: dict[str, str]) -> str:
    name = skin["name"]
    label = skin["label"]
    pack = skin["pack"]
    category = skin["category"]
    derived = skin["derived"]
    bands = skin["bands"]

    mode_text = " + ".join(title.lower() for title, _ in bands) if bands else "\u2014"
    tags = [
        '<span class="tag">' + esc(pack) + " pack</span>",
        '<span class="tag">' + esc(category_titles_by_id.get(category, category or "\u2014")) + "</span>",
        '<span class="tag">' + esc(mode_text) + "</span>",
    ]
    for mode in ("light", "dark"):
        if mode in derived:
            tags.append('<span class="tag tag-derived">' + esc(mode) + " ported</span>")

    palette_html = "".join(render_band(title, palette) for title, palette in bands)
    if not palette_html:
        palette_html = '<p class="missing">No palette in this file.</p>'

    description = skin["description"]
    description_html = (
        '<p class="description">' + esc(description) + "</p>"
        if description
        else '<p class="description missing">\u2014</p>'
    )

    return (
        '<article class="card" id="skin-' + esc(name) + '">'
        + '<header class="card-head">'
        + "<h3>" + esc(label) + "</h3>"
        + '<code class="id">' + esc(name) + "</code>"
        + "</header>"
        + '<p class="tags">' + "".join(tags) + "</p>"
        + description_html
        + '<div class="palette">' + palette_html + "</div>"
        + render_fonts(skin["typography"])
        + "</article>"
    )


def read_skins() -> list[dict]:
    skins = []
    seen: dict[str, str] = {}
    for path in sorted(SKINS_DIR.glob("*.yaml")):
        if not path.is_file() or path.is_symlink():
            continue
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as error:
            raise ValueError(path.name + ": not valid YAML (" + str(error) + ")") from error
        if not isinstance(data, dict):
            raise ValueError(path.name + ": a skin file must be a mapping")
        if data.get("schema_version") != 2:
            raise ValueError(path.name + ": schema_version is not 2")
        name = data.get("name")
        if not name:
            raise ValueError(path.name + ": no name")
        if name in seen:
            raise ValueError(path.name + ": duplicate skin id " + repr(name) + ", already in " + seen[name])
        seen[name] = path.name
        bands = palette_bands(data)
        if not bands:
            raise ValueError(path.name + ": no light_colors, dark_colors or colors")
        derived = set((data.get("provenance") or {}).get("derived") or [])
        skins.append(
            {
                "name": str(name),
                "label": str(data.get("label") or str(name).replace("-", " ").title()),
                "description": str(data.get("description") or ""),
                "category": str(data.get("category") or ""),
                "pack": str(data.get("pack") or "core"),
                "typography": data.get("typography") or {},
                "derived": derived,
                "bands": bands,
            }
        )
    return skins


def group_by_pack(skins: list[dict]) -> list[tuple[dict, list[dict]]]:
    declared, by_id = pack_order()
    grouped: dict[str, list[dict]] = {}
    for skin in skins:
        grouped.setdefault(skin["pack"], []).append(skin)

    ordered: list[tuple[dict, list[dict]]] = []
    for pack in declared:
        members = grouped.pop(pack["id"], [])
        if members:
            ordered.append((pack, members))
    for pack_id in sorted(grouped):
        pack = by_id.get(pack_id) or {
            "id": pack_id,
            "title": pack_id.replace("-", " ").title(),
            "description": "",
        }
        ordered.append((pack, grouped[pack_id]))
    return ordered


def render_page(groups: list[tuple[dict, list[dict]]], total: int, titles: dict[str, str]) -> str:
    pack_count = len(groups)
    sections = []
    for pack, members in groups:
        members = sorted(members, key=lambda item: (item["label"].casefold(), item["name"]))
        cards = "".join(render_card(skin, titles) for skin in members)
        description = pack.get("description") or ""
        sections.append(
            '<section class="pack" id="pack-' + esc(pack["id"]) + '">'
            + "<h2><span>" + esc(pack.get("title") or pack["id"]) + "</span>"
            + '<span class="count">' + str(len(members)) + " skins</span></h2>"
            + ('<p class="pack-description">' + esc(description) + "</p>" if description else "")
            + '<div class="grid">' + cards + "</div>"
            + "</section>"
        )

    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        "<title>Chroma skin gallery</title>\n"
        "<style>\n"
        ":root { color-scheme: light dark; }\n"
        "* { box-sizing: border-box; }\n"
        "body { margin: 0; padding: 24px; background: #f4f2ec; color: #1d1b17;"
        " font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui,"
        " sans-serif; }\n"
        "header.page { max-width: 1100px; margin: 0 auto 28px; }\n"
        "h1 { margin: 0 0 6px; font-size: 28px; line-height: 1.15; }\n"
        ".lede { margin: 0; max-width: 70ch; color: #575249; }\n"
        ".summary { margin: 10px 0 0; font-size: 13px; color: #575249; }\n"
        "main { max-width: 1100px; margin: 0 auto; }\n"
        ".pack { margin: 0 0 34px; }\n"
        ".pack h2 { display: flex; align-items: baseline; justify-content: space-between;"
        " gap: 12px; margin: 0 0 4px; padding-bottom: 6px; border-bottom: 1px solid #d5d0c5;"
        " font-size: 20px; }\n"
        ".pack .count { font-size: 12px; font-weight: 600; letter-spacing: .04em;"
        " text-transform: uppercase; color: #6c665b; }\n"
        ".pack-description { margin: 0 0 14px; max-width: 80ch; color: #575249; }\n"
        ".grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));"
        " gap: 14px; }\n"
        ".card { padding: 14px; background: #fffdf8; border: 1px solid #d5d0c5;"
        " border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,.05); min-width: 0; }\n"
        ".card-head { display: flex; align-items: baseline; justify-content: space-between;"
        " gap: 8px; }\n"
        ".card h3 { margin: 0; font-size: 16px; line-height: 1.25; }\n"
        ".card .id { color: #6c665b; font: 12px/1.3 ui-monospace, Consolas, monospace;"
        " overflow-wrap: anywhere; }\n"
        ".tags { display: flex; flex-wrap: wrap; gap: 5px; margin: 9px 0 8px; }\n"
        ".tag { padding: 2px 7px; background: #eee9df; border-radius: 999px;"
        " font-size: 11px; line-height: 1.5; color: #403c34; }\n"
        ".tag-derived { background: #e2ebf2; }\n"
        ".description { margin: 0 0 10px; color: #4d483f; font-size: 13px; }\n"
        ".missing { color: #8a8377; font-style: italic; }\n"
        ".palette { margin: 0 0 10px; }\n"
        ".band-row { display: flex; align-items: center; gap: 8px; margin: 0 0 5px; }\n"
        ".band-label { flex: 0 0 38px; font-size: 10px; font-weight: 700;"
        " letter-spacing: .06em; text-transform: uppercase; color: #6c665b; }\n"
        ".band { display: flex; flex: 1 1 auto; min-width: 0; height: 26px;"
        " border: 1px solid #cfc9bd; border-radius: 3px; overflow: hidden; }\n"
        ".swatch { flex: 1 1 0; min-width: 2px; }\n"
        ".swatch-unknown { background: repeating-linear-gradient(45deg,"
        " #ddd 0 4px, #bbb 4px 8px); }\n"
        ".fonts { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px;"
        " margin: 0; padding-top: 8px; border-top: 1px solid #eee9df; font-size: 12px; }\n"
        ".font-row { display: contents; }\n"
        ".font-label { color: #6c665b; font-weight: 600; }\n"
        ".font-value { min-width: 0; overflow-wrap: anywhere; }\n"
        "@media (prefers-color-scheme: dark) {\n"
        " body { background: #171613; color: #efece4; }\n"
        " .lede, .summary, .pack-description, .description { color: #b8b1a4; }\n"
        " .pack h2 { border-color: #3b372f; }\n"
        " .pack .count, .card .id, .band-label, .font-label { color: #a79f91; }\n"
        " .card { background: #211f1a; border-color: #3b372f; }\n"
        " .tag { background: #333028; color: #ded8cc; }\n"
        " .tag-derived { background: #2a3a45; }\n"
        " .fonts { border-color: #333028; }\n"
        " .band { border-color: #4a453b; }\n"
        "}\n"
        "</style>\n"
        "</head>\n"
        "<body>\n"
        '<header class="page">\n'
        "<h1>Chroma skin gallery</h1>\n"
        '<p class="lede">Every skin in the Chroma catalogue, grouped by pack. Each card reads its'
        " palettes, category and fonts from that skin&rsquo;s own file; nothing here is recoloured"
        " or guessed.</p>\n"
        '<p class="summary">' + str(total) + " skins &middot; " + str(pack_count)
        + " packs &middot; static, self-contained, and readable without JavaScript.</p>\n"
        "</header>\n"
        "<main>\n"
        + "\n".join(sections)
        + "\n</main>\n"
        "</body>\n"
        "</html>\n"
    )


def main() -> int:
    skins = read_skins()
    groups = group_by_pack(skins)
    page = render_page(groups, len(skins), category_titles())
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(page)
    counts = ", ".join(
        (pack.get("title") or pack["id"]) + "=" + str(len(members)) for pack, members in groups
    )
    print("wrote " + str(OUTPUT.relative_to(ROOT)) + ": " + str(len(skins)) + " cards; " + counts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
