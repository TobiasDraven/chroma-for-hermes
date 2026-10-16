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

# Names Chroma must never mint, because a built-in already owns them.
#
# This is the UNION of the two sets that actually matter, and the union is the
# point. The Desktop plugin refuses to register anything in its own
# CORE_DESKTOP_THEMES (nous, midnight, ember, mono, cyberpunk, slate), while the
# skin engine ships built-ins of its own. Guarding with only one half mints a
# skin the other half refuses: a file the CLI can see and the Desktop silently
# ignores.
CORE_NAMES = frozenset(
    {
        # Desktop theme names the picker must not shadow.
        "nous", "midnight", "ember", "mono", "cyberpunk", "slate",
        # skin-engine built-ins.
        "default", "classic", "minimal", "nord", "dracula",
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


class RenameRequest(BaseModel):
    source: str
    target: str
    # The caller (the Desktop plugin) knows which skin is live. We cannot read
    # it here without importing Hermes internals, and this only decides whether
    # the caller must re-broadcast, so it is advisory rather than trusted.
    active: str = ""


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


# --- F1: delete and rename -------------------------------------------------
#
# Both operations act only on skins Chroma owns, and both refuse the same three
# things. The refusals are the feature: without them, a user-supplied name
# becomes a path, and "delete" becomes a way to destroy work the plugin never
# created.


def _guard_name(value: str, *, field: str) -> str:
    """Normalise and vet a user-supplied skin name. The name becomes a path."""
    clean = (value or "").strip().lower()
    if _is_unsafe_name(clean):
        raise HTTPException(400, f"{field} must be a slug (lower-case, hyphens)")
    if clean in CORE_NAMES:
        raise HTTPException(409, f"'{clean}' is a built-in skin")
    return clean


def _owned_record(name: str) -> dict[str, Any]:
    """Return the provenance record, or refuse.

    An unknown name means we did not write it. That includes a skin the user
    hand-authored, which we must not delete or rename — we cannot know what it
    is for.
    """
    record = _read_index().get(name)
    if not isinstance(record, dict):
        raise HTTPException(404, f"'{name}' is not a skin Chroma manages")
    return record


def _rewrite_skin_name(path: Path, old_name: str, new_name: str) -> None:
    """Update the identity fields inside a renamed skin.

    Two fields, for two different reasons. `name:` is what the engine resolves,
    so leaving it stale gives the CLI one name for a file called another. The
    `description` normally carries the import label, which mentions the old name
    — leaving that stale shows the user a skin named one thing with a subtitle
    naming another.
    """
    text = path.read_text(encoding="utf-8")

    text, count = re.subn(r"^name:.*$", f"name: '{new_name}'", text, count=1, flags=re.M)
    if count == 0:
        text = f"name: '{new_name}'\n{text}"

    text, _ = re.subn(
        r"^description:.*$",
        lambda m: m.group(0).replace(old_name, new_name),
        text,
        count=1,
        flags=re.M,
    )

    _atomic_write_text(path, text)


@router.delete("/skins/{name}")
def delete_skin(name: str, active: str = "") -> dict[str, Any]:
    """Remove a skin Chroma imported.

    Deletion MOVES the file into the trash directory rather than unlinking it.
    A mistaken click is then recoverable without a backup, which matters because
    the button sits one hover away from the card the user meant to apply.
    """
    clean = _guard_name(name, field="skin name")
    record = _owned_record(clean)

    if (active or "").strip().lower() == clean:
        raise HTTPException(409, f"'{clean}' is the active skin; switch to another theme first")

    skins_dir = _skins_dir()
    target = skins_dir / f"{clean}.yaml"

    if not target.is_file():
        # The index remembers a skin whose file is gone. Drop the record so the
        # picker stops offering it, and say so rather than reporting a delete
        # that removed nothing.
        index = _read_index()
        index.pop(clean, None)
        _write_index(index)
        return {"ok": True, "name": clean, "deleted": False, "note": "the file was already gone; the record is removed"}

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    trashed = _trash_dir() / f"{clean}-{stamp}.yaml"
    os.replace(target, trashed)

    index = _read_index()
    index.pop(clean, None)
    _write_index(index)

    logger.info("trashed skin %s -> %s", target, trashed)
    return {"ok": True, "name": clean, "deleted": True, "trashed": str(trashed), "label": record.get("label") or clean}


# Keep this route ABOVE any future `POST /skins/{name}`: FastAPI matches in
# registration order, so a path-parameter route declared first would swallow
# "rename" as though it were a skin name.
@router.post("/skins/rename")
def rename_skin(req: RenameRequest) -> dict[str, Any]:
    """Rename a skin Chroma imported.

    Returns `wasActive` so the caller knows whether it must re-broadcast the
    skin name: the gateway holds the OLD name until something sets it again, and
    a rename that skips that leaves the CLI on a skin that no longer exists.
    """
    source = _guard_name(req.source, field="current name")
    target = _guard_name(req.target, field="new name")

    if source == target:
        raise HTTPException(400, "the new name is the same as the current name")

    record = _owned_record(source)

    skins_dir = _skins_dir()
    src = skins_dir / f"{source}.yaml"
    dst = skins_dir / f"{target}.yaml"

    if not src.is_file():
        raise HTTPException(404, f"'{source}' has no skin file")
    if dst.exists():
        raise HTTPException(409, f"'{target}' already exists")

    # Move first, then the index, then the identity fields: the skin file is what
    # the engine reads, so it must never point at a file that is not there.
    os.replace(src, dst)
    _rewrite_skin_name(dst, source, target)

    index = _read_index()
    index.pop(source, None)
    updated = dict(record) if isinstance(record, dict) else {}
    label = updated.get("label") or target
    # The label carries the import name, so it goes stale exactly as the file's
    # description does. `or` alone would keep the old truthy string, and then
    # GET /skins would name a skin that no longer exists.
    updated["label"] = label.replace(source, target)
    index[target] = updated
    _write_index(index)

    was_active = (req.active or "").strip().lower() == source
    logger.info("renamed skin %s -> %s (wasActive=%s)", source, target, was_active)
    return {"ok": True, "from": source, "to": target, "wasActive": was_active, "label": updated["label"]}