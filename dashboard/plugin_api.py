"""Chroma plugin — backend API (unified package).

Mounted at /api/plugins/chroma/ by the dashboard plugin system.

The single endpoint writes an imported TweakCN theme as a real Hermes skin
YAML (top-level <hermes home>/skins/<slug>.yaml) so the gateway's skin
watcher broadcasts it and every live surface follows. The desktop plugin then
activates the new skin via 'config.set' (display.skin), which fires
skin.changed to every connected Desktop and CLI.

The colour mapping below is the source of truth shared with the UI's
cssColorToHex / tweakcnColors pipeline, so both produce the same palette.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import os

HERMES_HOME = None
try:
    from hermes_constants import get_hermes_home  # documented way to resolve <hermes home>
    HERMES_HOME = Path(get_hermes_home())
except Exception:  # pragma: no cover - fallback for direct import
    HERMES_HOME = Path(os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes")))


# This module deliberately imports NOTHING private from the Hermes core.
# The catalog admission lint refuses `utils.*` / `hermes_yaml` (rule 9: public
# surfaces only, since they can break on any release), so the small skin shape
# below is serialised here and written atomically with the standard library.


def _yaml_scalar(value: Any) -> str:
    """Emit one YAML scalar. Only plain strings reach here (hex colours, names,
    descriptions), so single-quoting with doubled quotes is sufficient."""
    return "'" + str(value).replace("'", "''") + "'"


def _dump_skin_yaml(data: dict[str, Any]) -> str:
    """Serialise the known skin shape: top-level scalars plus string->string maps."""
    lines: list[str] = []
    for key, value in data.items():
        if isinstance(value, dict):
            lines.append(f"{key}:")
            for inner_key, inner_value in value.items():
                lines.append(f"  {inner_key}: {_yaml_scalar(inner_value)}")
        else:
            lines.append(f"{key}: {_yaml_scalar(value)}")
    return "\n".join(lines) + "\n"


def _atomic_write_text(path: Path, text: str) -> None:
    """Write via a sibling temp file then os.replace, so the gateway's skin watcher
    never observes a half-written YAML (and never a partial palette)."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, path)


# --- provenance -----------------------------------------------------------
#
# Nothing in a skin YAML says who wrote it, so "delete the skins we imported"
# has no honest implementation from the files alone — a filename heuristic would
# eventually delete a skin the user wrote by hand. A sidecar index records it.
#
# It lives in a SUBDIRECTORY, which matters: the skin engine globs top-level
# *.yaml only (non-recursive), so this file can never appear as a skin in the CLI.

SIDECAR_DIRNAME = ".chroma"
INDEX_FILENAME = "index.json"
TRASH_DIRNAME = "_trash"


def _skins_dir() -> Path:
    d = Path(HERMES_HOME) / "skins"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _index_path() -> Path:
    d = _skins_dir() / SIDECAR_DIRNAME
    d.mkdir(parents=True, exist_ok=True)
    return d / INDEX_FILENAME


def _read_index() -> dict[str, Any]:
    """Return the provenance index, or an empty one if it is missing or corrupt.

    A corrupt index must never take the picker down: an unreadable file means we
    have lost the record of what we own, and the safe reading of that is "nothing
    is ours" — F1 then refuses to delete, which is the recoverable direction.
    """
    p = _index_path()
    if not p.is_file():
        return {}
    try:
        parsed = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning("chroma index unreadable at %s; treating as empty", p)
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _write_index(index: dict[str, Any]) -> None:
    _atomic_write_text(_index_path(), json.dumps(index, indent=2, sort_keys=True) + "\n")


def _trash_dir() -> Path:
    d = _skins_dir() / SIDECAR_DIRNAME / TRASH_DIRNAME
    d.mkdir(parents=True, exist_ok=True)
    return d

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/skins")
def list_chroma_skins() -> dict[str, Any]:
    """Every skin Chroma owns, with the two facts the picker cannot infer.

    `cliCapable` -- the engine reads top-level *.yaml only, so a skin is visible
    to the CLI exactly while its file sits there.

    `missing` -- the index remembers a skin whose file is gone (a manual delete,
    or a crash between the two writes). Reported rather than hidden, because a
    silently dropped entry is a skin the user cannot explain the absence of.
    """
    skins_dir = _skins_dir()
    index = _read_index()
    skins = []
    for name, meta in sorted(index.items()):
        record = meta if isinstance(meta, dict) else {}
        present = (skins_dir / f"{name}.yaml").is_file()
        skins.append(
            {
                "name": name,
                "label": record.get("label") or name,
                "source": record.get("source") or "chroma",
                "ref": record.get("ref") or "",
                "importedAt": record.get("importedAt") or "",
                "owned": True,
                "cliCapable": present,
                "missing": not present,
            }
        )
    return {"ok": True, "count": len(skins), "skins": skins}

CORE_NAMES = frozenset(
    {
        "default", "classic", "minimal", "slate", "nord", "dracula",
        "monokai", "solarized-light", "solarized-dark", "ansi",
    }
)

# A slug is a single word-like token: safe for a flat filename and for config keys.
_SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


class TweakcnColorMap(BaseModel):
    background: str
    ui_text: str
    banner_text: str
    ui_accent: str
    banner_accent: str
    ui_tool: str
    ui_border: str
    banner_border: str
    banner_title: str
    banner_dim: str
    ui_label: str
    ui_ok: str
    ui_error: str
    ui_warn: str
    light_colors: dict[str, str] = {}
    dark_colors: dict[str, str] = {}
    description: str = ""
    description_extra: str = ""


class ImportRequest(BaseModel):
    name: str
    theme: dict[str, Any]
    description: str = ""


def _hex(v: Any) -> str | None:
    """Coerce a candidate colour to '#rrggbb' or None."""
    if not isinstance(v, str):
        return None
    s = v.strip()
    if len(s) == 7 and s.startswith("#"):
        return s.lower()
    if len(s) == 4 and s.startswith("#"):
        return "#" + "".join(c * 2 for c in s[1:])
    return None


def _is_unsafe_name(name: str) -> bool:
    # Only strict slugs reach the filesystem; anything else is path-traversal
    # or a weird identifier which we simply refuse.
    return not bool(_SLUG_RE.match(name))


@router.post("/import")
def import_skin(req: ImportRequest) -> dict[str, Any]:
    name = (req.name or "").strip().lower()
    if _is_unsafe_name(name):
        raise HTTPException(400, "skin name must be a slug (lower-case, hyphens)")
    if name in CORE_NAMES:
        raise HTTPException(409, f"'{name}' collides with a built-in skin")

    skins_dir = Path(HERMES_HOME) / "skins"
    skins_dir.mkdir(parents=True, exist_ok=True)
    target = skins_dir / f"{name}.yaml"

    # Refuse to clobber an existing skin file — the importer is additive.
    if target.exists():
        raise HTTPException(409, f"skin '{name}' already exists")

    # Build the token map from the incoming theme dict. The UI sends a DesktopTheme
    # whose colours live under 'colors' (+ optional 'darkColors'/'lightColors').
    theme = req.theme or {}
    colors = theme.get("colors") or {}
    darks = theme.get("darkColors") or {}
    lights = theme.get("lightColors") or colors

    def pick(mapping: dict, fallback: str) -> str:
        v = mapping.get(fallback) if isinstance(mapping, dict) else None
        # try foreground/background/primary etc; fall back to provided
        return _hex(v) or fallback

    # Map colour tokens → shadcn sources. Adapt to the incoming shape:
    # incoming theme.colors is {background, foreground, primary, accent, border, ...}
    raw_bg = colors.get("background")
    raw_fg = colors.get("foreground")
    raw_primary = colors.get("primary")
    raw_accent = colors.get("accent") or colors.get("primary")
    raw_border = colors.get("border")
    raw_muted = colors.get("muted")
    raw_card = colors.get("cardForeground") or colors.get("foreground")
    raw_destructive = colors.get("destructive")

    def hex_or(v, default):
        return _hex(v) or default

    token_map = {
        "background": hex_or(raw_bg, "#000000"),
        "ui_text": hex_or(raw_fg, "#ffffff"),
        "banner_text": hex_or(raw_card, raw_fg) or hex_or(raw_fg, "#ffffff"),
        "ui_accent": hex_or(raw_primary, "#ffffff"),
        "banner_accent": hex_or(raw_primary, "#ffffff"),
        "ui_tool": hex_or(raw_accent, "#ffffff"),
        "ui_border": hex_or(raw_border, "#555555"),
        "banner_border": hex_or(raw_border, "#555555"),
        "banner_title": hex_or(raw_fg, "#ffffff"),
        "banner_dim": hex_or(raw_muted, "#aaaaaa"),
        "ui_label": hex_or(raw_card, raw_fg) or hex_or(raw_fg, "#ffffff"),
        "ui_ok": hex_or(raw_primary, "#4caf50"),
        "ui_error": hex_or(raw_destructive, "#ef5350"),
        "ui_warn": hex_or(raw_accent, "#ffa726"),
    }

    data: dict[str, Any] = {
        "name": name,
        "description": (req.description or f"TweakCN {name}").strip(),
        "colors": token_map,
    }
    if lights:
        data["light_colors"] = token_map  # TweakCN presets ship one palette
    if darks:
        # Produce a dark variant token map from the dark palette
        d = darks
        dark_map = {
            "background": hex_or(d.get("background"), token_map["background"]),
            "ui_text": hex_or(d.get("foreground"), token_map["ui_text"]),
            "banner_text": hex_or(d.get("primaryForeground"), hex_or(d.get("foreground"), token_map["ui_text"])),
            "ui_accent": hex_or(d.get("primary"), token_map["ui_accent"]),
            "banner_accent": hex_or(d.get("primary"), token_map["ui_accent"]),
            "ui_tool": hex_or(d.get("accent") or d.get("primary"), token_map["ui_tool"]),
            "ui_border": hex_or(d.get("border"), token_map["ui_border"]),
            "banner_border": hex_or(d.get("border"), token_map["ui_border"]),
            "banner_title": hex_or(d.get("foreground"), token_map["ui_text"]),
            "banner_dim": hex_or(d.get("mutedForeground"), token_map["ui_border"]),
            "ui_label": hex_or(d.get("cardForeground") or d.get("foreground"), token_map["ui_label"]),
            "ui_ok": hex_or(d.get("primary"), token_map["ui_ok"]),
            "ui_error": hex_or(d.get("destructive"), token_map["ui_error"]),
            "ui_warn": hex_or(d.get("accent") or d.get("secondary"), token_map["ui_warn"]),
        }
        data["dark_colors"] = dark_map

    _atomic_write_text(target, _dump_skin_yaml(data))

    # Record provenance in the same breath as the write. Order matters: the skin
    # file is the thing the engine reads, so it lands first; if we die between
    # the two, the index is merely short an entry (a skin we then refuse to
    # manage) rather than claiming a skin that is not there.
    index = _read_index()
    index[name] = {
        "source": "chroma",
        "label": data["description"],
        "importedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    _write_index(index)

    logger.info("wrote skin %s", target)
    return {"ok": True, "name": name, "path": str(target)}