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
import shutil
import tempfile
import threading
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
    never observes a half-written YAML (and never a partial palette).

    The temp name is **unique per write** (`mkstemp`), not a fixed `<name>.tmp`.
    A fixed name is a shared resource: two writers — two concurrent imports, or
    the index rewrite racing a skin write — collide on it and the second gets
    ``PermissionError`` from ``os.replace`` on Windows. The temp sits in the
    target's own directory so the replace stays a same-volume atomic rename.
    """
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


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

# Concurrency model, established from the host source, not assumed:
#   * `hermes_cli/web_server_dashboard.py::_mount_one_plugin_api` mounts this
#     router with `app.include_router(...)` — in-process, on the single
#     `hermes_cli.web_server.app`.
#   * `web_server.py` drives one `uvicorn.Server` with no `workers=`, so there is
#     exactly ONE process; the host itself serialises with `threading.Lock`
#     (`_plugin_api_mount_lock`).
#   * every endpoint here is a sync `def`, so Starlette runs it via
#     `run_in_threadpool` — concurrent requests are THREADS in that one process.
# A `threading.Lock` is therefore the correct primitive (a file lock or an
# asyncio lock would be wrong: separate processes / not our event loop).
# It guards the whole read-modify-write of the index, because the loss happens
# between the read and the write, not inside either one.
_INDEX_LOCK = threading.Lock()


class IndexUnreadableError(RuntimeError):
    """The provenance index exists but cannot be read as a JSON object.

    Raised by every path that is about to WRITE the index: an unread index means
    we cannot know what we own, and persisting that ignorance would delete the
    user's provenance. `backup` is where a copy of the bad file was put (or None
    if even the copy failed)."""

    def __init__(self, path: Path, backup: Path | None, reason: object) -> None:
        self.path = path
        self.backup = backup
        self.reason = reason
        where = f"a copy was kept at {backup}" if backup else "a copy could not be kept"
        super().__init__(
            f"the skin provenance index at {path} is unreadable ({reason}); "
            f"refusing to overwrite it and lose every record it holds — {where}. "
            f"Repair or remove the file, then retry."
        )


def _skins_dir() -> Path:
    d = Path(HERMES_HOME) / "skins"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _index_path() -> Path:
    d = _skins_dir() / SIDECAR_DIRNAME
    d.mkdir(parents=True, exist_ok=True)
    return d / INDEX_FILENAME


def _quarantine_index(path: Path) -> Path | None:
    """Copy an unreadable index beside itself (timestamped). COPY, not move: the
    original stays where the user expects it for manual repair, and the response
    can point at a file that holds the exact bytes we could not parse."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = path.with_name(f"{path.name}.unreadable-{stamp}")
    try:
        shutil.copy2(path, backup)
    except OSError:
        return None
    return backup


def _unlink_quietly(path: Path) -> None:
    """Best-effort removal for a rollback: the caller is already reporting a
    failure, and a second exception here would replace the useful one."""
    try:
        path.unlink()
    except OSError:
        pass


def _read_index() -> dict[str, Any]:
    """Return the provenance index for READ-ONLY use, or an empty one if it is
    missing or corrupt.

    A corrupt index must never take the picker down: an unreadable file means we
    have lost the record of what we own, and the safe reading of that is "nothing
    is ours" — F1 then refuses to delete, which is the recoverable direction.

    This lenient reading is for *showing*, never for *writing*. Anything that may
    write the index must go through `_read_index_for_update`, because persisting
    this `{}` is precisely how a corrupt index becomes data loss.
    """
    p = _index_path()
    if not p.is_file():
        return {}
    try:
        parsed = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning("chroma index unreadable at %s; treating as empty for read-only views", p)
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _read_index_for_update() -> dict[str, Any]:
    """Read the index for a path that is about to write it.

    Identical to `_read_index` for a missing or valid file, but a file that is
    PRESENT and unreadable is fatal rather than `{}`: the caller must not write an
    index derived from a failed read. The bad file is copied aside first, so the
    provenance survives even when a truncated write or an interloper left it
    broken. Callers hold `_INDEX_LOCK`.
    """
    p = _index_path()
    if not p.is_file():
        return {}
    try:
        parsed = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise IndexUnreadableError(p, _quarantine_index(p), exc) from exc
    if not isinstance(parsed, dict):
        raise IndexUnreadableError(p, _quarantine_index(p), "the file is not a JSON object")
    return parsed


def _index_error(err: IndexUnreadableError) -> HTTPException:
    """Turn an unreadable-index failure into an actionable 5xx for the caller."""
    return HTTPException(500, str(err))


def _write_index(index: dict[str, Any]) -> None:
    _atomic_write_text(_index_path(), json.dumps(index, indent=2, sort_keys=True) + "\n")


def _write_index_or_500(index: dict[str, Any]) -> None:
    """Write the index, turning a filesystem failure into an actionable 5xx
    rather than a bare traceback (B6)."""
    try:
        _write_index(index)
    except OSError as exc:
        raise HTTPException(
            500,
            f"could not update the skin provenance index ({_index_path()}): {exc}. "
            f"Fix free space or permissions and retry.",
        ) from exc


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
                # Optional and additive: an entry written before categories
                # existed simply has none, and reads back as "" rather than
                # failing to load (E0).
                "category": record.get("category") or "",
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

# Windows reserves these as device names, with or without an extension: a file
# called `con.yaml` is not a file at all, it is the console device — the write
# silently goes nowhere and the gateway never sees a skin, or the create fails
# outright. They are legal by `_SLUG_RE`, so they need an explicit refusal; the
# allowlist shape is right, this is a hole in it.
WINDOWS_RESERVED_NAMES = frozenset(
    {"con", "prn", "aux", "nul"}
    | {f"com{i}" for i in range(1, 10)}
    | {f"lpt{i}" for i in range(1, 10)}
)

# Colour tokens: `#rgb` or `#rrggbb`, case-insensitive. Nothing else is a colour.
_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


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


# A theme is a small map of colour tokens. Anything larger is a mistake or an
# attempt to make the server allocate megabytes; the picker never sends one.
MAX_THEME_COLORS = 512
MAX_THEME_BYTES = 64 * 1024


def _theme_too_large(theme: Any) -> str | None:
    """Return a human reason when ``theme`` exceeds the request budget, else None.

    Two bounds, because either alone is escapable: a count of colour entries
    catches a wide map of tiny values, and a serialised byte cap catches one
    enormous value behind a single key.
    """
    if not isinstance(theme, dict):
        return None
    colors = 0
    for bucket in ("colors", "darkColors", "lightColors"):
        value = theme.get(bucket)
        if isinstance(value, dict):
            colors += len(value)
    if colors > MAX_THEME_COLORS:
        return f"theme declares {colors} colour tokens (limit {MAX_THEME_COLORS})"
    try:
        size = len(json.dumps(theme, separators=(",", ":"), default=str))
    except (TypeError, ValueError):
        return "theme is not JSON-serialisable"
    if size > MAX_THEME_BYTES:
        return f"theme serialises to {size} bytes (limit {MAX_THEME_BYTES})"
    return None


class RenameRequest(BaseModel):
    source: str
    target: str
    # The caller (the Desktop plugin) knows which skin is live. We cannot read
    # it here without importing Hermes internals, and this only decides whether
    # the caller must re-broadcast, so it is advisory rather than trusted.
    active: str = ""


def _hex(v: Any) -> str | None:
    """Coerce a candidate colour to '#rrggbb'.

    `None` for a value the caller did not supply (a missing token falls back to
    a default). A value that IS supplied but is not a hex colour is an error, not
    a fallback: silently substituting a default would hand the gateway a skin
    whose palette contradicts what the user imported. Raised as ValueError so the
    endpoint can turn it into a 400 naming the offending token.
    """
    if v is None or not isinstance(v, str):
        return None
    s = v.strip()
    if not _HEX_RE.match(s):
        raise ValueError(f"{v!r} is not a hex colour (#rgb or #rrggbb)")
    s = s.lower()
    if len(s) == 4:
        return "#" + "".join(c * 2 for c in s[1:])
    return s


def _validate_colors(*maps: Any) -> None:
    """Refuse any supplied colour that is not `#rgb`/`#rrggbb`.

    A missing token is fine (it falls back); a supplied-but-broken one is a 400
    naming the token, so the user sees which value was rejected instead of
    discovering a wrong palette after the skin is live.
    """
    for mapping in maps:
        if not isinstance(mapping, dict):
            continue
        for key, value in mapping.items():
            if value is None or not isinstance(value, str):
                continue
            try:
                _hex(value)
            except ValueError as exc:
                raise HTTPException(400, f"invalid colour for '{key}': {exc}") from exc


def _is_unsafe_name(name: str) -> bool:
    # Only strict slugs reach the filesystem; anything else is path-traversal
    # or a weird identifier which we simply refuse. A reserved device name is a
    # legal slug that is still not writable on Windows.
    return not bool(_SLUG_RE.match(name)) or name in WINDOWS_RESERVED_NAMES


@router.post("/import")
def import_skin(req: ImportRequest) -> dict[str, Any]:
    name = (req.name or "").strip().lower()
    if _is_unsafe_name(name):
        raise HTTPException(
            400,
            "skin name must be a slug (lower-case, hyphens) and must not be a "
            "Windows reserved device name (con, nul, com1…)",
        )
    if name in CORE_NAMES:
        raise HTTPException(409, f"'{name}' collides with a built-in skin")

    # Bound the request before it is parsed any further: `theme` is an open dict,
    # and an unbounded one lets a single request make the server allocate.
    theme = req.theme or {}
    oversized = _theme_too_large(theme)
    if oversized:
        raise HTTPException(413, f"theme is too large: {oversized}")

    skins_dir = Path(HERMES_HOME) / "skins"
    skins_dir.mkdir(parents=True, exist_ok=True)
    target = skins_dir / f"{name}.yaml"

    # Build the token map from the incoming theme dict. The UI sends a DesktopTheme
    # whose colours live under 'colors' (+ optional 'darkColors'/'lightColors').
    colors = theme.get("colors") or {}
    darks = theme.get("darkColors") or {}
    lights = theme.get("lightColors") or colors

    # Every colour the caller supplied must actually be a colour. Rejecting a bad
    # token here is the boundary: the alternative is a skin whose palette
    # silently disagrees with what the user imported reaching the gateway.
    _validate_colors(colors, darks, lights)

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

    # Everything from the index read to the index write happens under one lock:
    # the entry is lost BETWEEN the read and the write, so locking either half
    # alone fixes nothing (B1). Two concurrent imports each read the same base and
    # the second overwrites the first's entry with no error at all.
    with _INDEX_LOCK:
        try:
            index = _read_index_for_update()
        except IndexUnreadableError as exc:
            # Refuse before writing anything: a skin whose provenance we cannot
            # record is a skin the user cannot manage, and the index it would
            # overwrite holds every other skin we own (B2, B6).
            raise _index_error(exc) from exc

        # Refuse to clobber an existing skin file — the importer is additive.
        # Checked inside the lock so two imports of one name cannot both pass.
        if target.exists():
            raise HTTPException(409, f"skin '{name}' already exists")

        try:
            _atomic_write_text(target, _dump_skin_yaml(data))
        except OSError as exc:
            raise HTTPException(500, f"could not write the skin file {target}: {exc}") from exc

        # Record provenance in the same breath as the write. Order matters: the
        # skin file is the thing the engine reads, so it lands first; if we die
        # between the two, the index is merely short an entry (a skin we then
        # refuse to manage) rather than claiming a skin that is not there.
        index[name] = {
            "source": "chroma",
            "label": data["description"],
            "category": "",
            "importedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        try:
            _write_index(index)
        except OSError as exc:
            # The file is on disk but has no provenance, so the picker can never
            # offer to delete it again. Take it back out rather than leave an
            # orphan the user cannot manage (B6).
            _unlink_quietly(target)
            raise HTTPException(
                500,
                f"the skin file was written but the provenance index could not be "
                f"updated ({exc}); the file was rolled back, so nothing is orphaned. "
                f"Fix free space or permissions and retry.",
            ) from exc

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


def _owned_record(name: str, index: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return the provenance record, or refuse.

    An unknown name means we did not write it. That includes a skin the user
    hand-authored, which we must not delete or rename — we cannot know what it
    is for.

    Callers that may WRITE pass the index they already read under the lock, so
    the record and the base they will write back are the same read.
    """
    if index is None:
        index = _read_index()
    record = index.get(name)
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

    skins_dir = _skins_dir()
    target = skins_dir / f"{clean}.yaml"

    # One lock across the read and the write: the record we pop must come from the
    # same index we write back, or a concurrent import's entry vanishes (B1).
    with _INDEX_LOCK:
        try:
            index = _read_index_for_update()
        except IndexUnreadableError as exc:
            raise _index_error(exc) from exc
        record = _owned_record(clean, index)

        if (active or "").strip().lower() == clean:
            raise HTTPException(409, f"'{clean}' is the active skin; switch to another theme first")

        if not target.is_file():
            # The index remembers a skin whose file is gone. Drop the record so the
            # picker stops offering it, and say so rather than reporting a delete
            # that removed nothing.
            index.pop(clean, None)
            _write_index_or_500(index)
            return {"ok": True, "name": clean, "deleted": False, "note": "the file was already gone; the record is removed"}

        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
        trashed = _trash_dir() / f"{clean}-{stamp}.yaml"
        try:
            os.replace(target, trashed)
        except OSError as exc:
            raise HTTPException(500, f"could not move the skin to the trash ({trashed}): {exc}") from exc

        index.pop(clean, None)
        _write_index_or_500(index)

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

    skins_dir = _skins_dir()
    src = skins_dir / f"{source}.yaml"
    dst = skins_dir / f"{target}.yaml"

    # Whole read-modify-write under one lock, and a failed index write rolls the
    # rename back so the skin is never left under a name the index does not know
    # (B1, B6).
    with _INDEX_LOCK:
        try:
            index = _read_index_for_update()
        except IndexUnreadableError as exc:
            raise _index_error(exc) from exc
        record = _owned_record(source, index)

        if not src.is_file():
            raise HTTPException(404, f"'{source}' has no skin file")
        if dst.exists():
            raise HTTPException(409, f"'{target}' already exists")

        # Move first, then the identity fields, then the index: the skin file is
        # what the engine reads, so it must never point at a file that is not there.
        try:
            os.replace(src, dst)
        except OSError as exc:
            raise HTTPException(500, f"could not move the skin file to {dst}: {exc}") from exc

        try:
            _rewrite_skin_name(dst, source, target)
        except OSError as exc:
            # Roll back the move: a half-renamed skin is worse than no rename.
            try:
                os.replace(dst, src)
            except OSError:
                pass
            raise HTTPException(500, f"could not rewrite the renamed skin {dst}: {exc}") from exc

        index.pop(source, None)
        updated = dict(record) if isinstance(record, dict) else {}
        label = updated.get("label") or target
        # The label carries the import name, so it goes stale exactly as the file's
        # description does. `or` alone would keep the old truthy string, and then
        # GET /skins would name a skin that no longer exists.
        updated["label"] = label.replace(source, target)
        index[target] = updated
        try:
            _write_index(index)
        except OSError as exc:
            # Put the file back under its old name: a rename the index never
            # learned about is a skin the picker can neither show nor delete.
            try:
                os.replace(dst, src)
            except OSError:
                pass
            raise HTTPException(
                500,
                f"the skin was moved but the provenance index could not be updated "
                f"({exc}); the rename was rolled back. Fix free space or permissions "
                f"and retry.",
            ) from exc

    was_active = (req.active or "").strip().lower() == source
    logger.info("renamed skin %s -> %s (wasActive=%s)", source, target, was_active)
    return {"ok": True, "from": source, "to": target, "wasActive": was_active, "label": updated["label"]}


# --- F3: export ------------------------------------------------------------


@router.get("/export")
def export_skins(name: str = "") -> dict[str, Any]:
    """Export one owned skin, or every one, as hand-editable YAML.

    The YAML written here is byte-for-byte what the importer writes, so an export
    round-trips: a user can export, hand-edit the file, and bring it back.

    Returned as JSON rather than as a raw file/zip download because the plugin's
    only channel back to the pane is a JSON REST call. Wrapping the text keeps it
    working over that channel; the pane turns it into a file the user saves. A zip
    here would have to survive that same channel, and a binary body is the one
    thing it is least likely to carry intact.
    """
    skins_dir = _skins_dir()
    index = _read_index()

    def read_one(skin: str) -> str:
        path = skins_dir / f"{skin}.yaml"
        if not path.is_file():
            raise HTTPException(404, f"'{skin}' has no skin file")
        return path.read_text(encoding="utf-8")

    if name:
        clean = _guard_name(name, field="skin name")
        _owned_record(clean)
        return {
            "ok": True,
            "filename": f"{clean}.yaml",
            "count": 1,
            "files": [{"name": clean, "yaml": read_one(clean)}],
        }

    files = [
        {"name": skin, "yaml": read_one(skin)}
        for skin in sorted(index)
        if (skins_dir / f"{skin}.yaml").is_file()
    ]
    return {
        "ok": True,
        "filename": "chroma-skins.json",
        "count": len(files),
        "index": index,
        "files": files,
    }


# --- E0: the editor's shared shape -----------------------------------------
#
# The editor must never hardcode what it is allowed to edit; this is its only
# source of truth. Deliberately DATA, not code: the pane fetches it and renders
# rows from it, so adding or renaming a role is a backend change the UI cannot
# silently disagree with.

# The vocabulary of editable skin keys. An override and a user-skin rewrite speak
# these same nine keys, and both writers accept exactly these — an unknown role is
# refused BY NAME, never silently dropped (a dropped role is a palette that
# quietly disagrees with what the user set).
EDITABLE_SKIN_KEYS: tuple[str, ...] = (
    "background",
    "status_bar_bg",
    "ui_accent",
    "banner_accent",
    "ui_tool",
    "ui_border",
    "banner_border",
    "ui_text",
    "banner_text",
    "banner_dim",
)

# (role key, its group, that group's one-line purpose). The six groups are the
# editor's sections; the keys above are the rows inside them.
EDITABLE_ROLES: tuple[tuple[str, str, str], ...] = (
    ("background", "Shell", "the field everything else sits on"),
    ("status_bar_bg", "Shell", "the raised surface the status bar sits on"),
    ("ui_accent", "Signature", "the colour the theme is read by"),
    ("banner_accent", "Signature", "accent on banners and headers"),
    ("ui_tool", "Tool", "the tool-call accent"),
    ("ui_border", "Structure", "borders and framing"),
    ("banner_border", "Structure", "banner framing"),
    ("ui_text", "Reading", "primary interface text"),
    ("banner_text", "Reading", "text on banners and headers"),
    ("banner_dim", "Secondary text", "muted secondary text"),
)

EDITOR_MODES: tuple[str, ...] = ("light", "dark")

# Everything Chroma mints for a scene is named `theme-picker-<scene>-<mode>.yaml`
# at the top level of the skins dir — literally the file the CLI reads. That makes
# it both the proof a scene exists AND the authored palette a Reset restores.
TRANSPORT_PREFIX = "theme-picker-"

_OVERRIDES_FILENAME = "overrides.json"

# Same discipline as the index. The overrides file is USER DATA, and a write
# derived from a failed read is the exact data-loss defect 8a06221 closed. Reads
# that only SHOW it stay lenient (GET /overrides); anything that WRITES goes
# strict. Whole read-modify-write under one lock, for the same reason as the index.
_OVERRIDES_LOCK = threading.Lock()


def _overrides_path() -> Path:
    """<skins>/.chroma/overrides.json — beside the index, in the sidecar dir the
    skin engine never globs, created lazily. NOT a build input: the overrides live
    here as user intent, never inside the generated catalogue."""
    d = _skins_dir() / SIDECAR_DIRNAME
    d.mkdir(parents=True, exist_ok=True)
    return d / _OVERRIDES_FILENAME


def _read_overrides() -> dict[str, Any]:
    """Every override record, for READ-ONLY use, or {} if the file is missing or
    unreadable. Lenient by design: decorating the gallery must never take the
    picker down, and no write is ever derived from this reading."""
    p = _overrides_path()
    if not p.is_file():
        return {}
    try:
        parsed = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning("chroma overrides unreadable at %s; treating as empty for read-only views", p)
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _read_overrides_for_update() -> dict[str, Any]:
    """Read the overrides file for a path that is about to WRITE it.

    A present-but-unreadable file is fatal rather than {} for exactly the reason
    the index is: persisting that {} deletes every override the user made. The bad
    file is copied aside first so the records survive a manual repair. Callers
    hold `_OVERRIDES_LOCK`."""
    p = _overrides_path()
    if not p.is_file():
        return {}
    try:
        parsed = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise IndexUnreadableError(p, _quarantine_index(p), exc) from exc
    if not isinstance(parsed, dict):
        raise IndexUnreadableError(p, _quarantine_index(p), "the file is not a JSON object")
    return parsed


def _write_overrides(overrides: dict[str, Any]) -> None:
    _atomic_write_text(_overrides_path(), json.dumps(overrides, indent=2, sort_keys=True) + "\n")


def _unscalar(value: str) -> str:
    """Undo `_yaml_scalar`: strip one layer of single quotes, un-double any inside."""
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return value


def _read_skin_file(path: Path) -> dict[str, Any]:
    """Parse the flat skin shape `_dump_skin_yaml` writes: top-level `key: 'v'`
    scalars plus nested `key:` blocks of indented `inner: 'v'`.

    A tiny reader rather than a YAML dependency — the module imports nothing
    private from the Hermes core (rule 9), and this exact shape is all it writes
    or reads. **Not** a general YAML parser: anything it does not model is left
    out of the result rather than guessed at."""
    data: dict[str, Any] = {}
    current: dict[str, Any] | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw[:1] in (" ", "\t"):
            if current is not None:
                key, _, value = raw.strip().partition(":")
                current[key.strip()] = _unscalar(value.strip())
            continue
        key, _, value = raw.partition(":")
        key = key.strip()
        value = value.strip()
        if value == "":
            current = {}
            data[key] = current
        else:
            current = None
            data[key] = _unscalar(value)
    return data


def _transport_path(scene: str, mode: str) -> Path:
    return _skins_dir() / f"{TRANSPORT_PREFIX}{scene}-{mode}.yaml"


def _authored_scene(scene: str) -> dict[str, dict[str, str]]:
    """The authored (as-shipped) palettes for a built-in scene, read from its
    gateway transport skins — the files the CLI already follows.

    A scene "exists" for the editor exactly when one of those files does: the
    backend cannot re-mint a palette it cannot see, and this is also the honest
    refusal for a merely mistyped or unknown slug — a 404 that NAMES the scene."""
    authored: dict[str, dict[str, str]] = {}
    for mode in EDITOR_MODES:
        path = _transport_path(scene, mode)
        if path.is_file():
            try:
                parsed = _read_skin_file(path)
            except OSError:
                continue
            colors = parsed.get("colors")
            if isinstance(colors, dict):
                authored[mode] = {str(k): str(v) for k, v in colors.items()}
    if not authored:
        raise HTTPException(
            404,
            f"'{scene}' is not a built-in scene Chroma can override (no "
            f"{TRANSPORT_PREFIX}{scene}-light.yaml or -dark.yaml beside the owned skins)",
        )
    return authored


def _mint_transport(scene: str, mode: str, palette: dict[str, str]) -> None:
    """Rewrite one gateway transport skin from ``palette``.

    This is the file the CLI and every connected Desktop read, so re-minting it is
    what makes an edit — or a Reset — visible outside the picker (§17.3.3). It is a
    DERIVED artefact, rebuilt by `scripts/regenerate.py`; the authored catalogue
    itself is never touched."""
    path = _transport_path(scene, mode)
    data = {
        "name": path.stem,
        "description": f"Theme Picker transport for {scene} ({mode})",
        "colors": palette,
    }
    _atomic_write_text(path, _dump_skin_yaml(data))


def _normalise_palette(mapping: Any, *, what: str) -> dict[str, str]:
    """Validate and normalise one `{role: hex}` map.

    Three refusals, each naming the offence: a non-object, an unknown role (never
    silently dropped), and a value that is not a colour (named, so the user sees
    which swatch was rejected)."""
    if mapping is None:
        return {}
    if not isinstance(mapping, dict):
        raise HTTPException(400, f"{what} must be an object of role -> hex colour")
    unknown = [k for k in mapping if k not in EDITABLE_SKIN_KEYS]
    if unknown:
        raise HTTPException(
            400,
            f"unknown role {unknown[0]!r} in {what}: editable roles are "
            f"{', '.join(EDITABLE_SKIN_KEYS)}",
        )
    out: dict[str, str] = {}
    for key, value in mapping.items():
        try:
            cleaned = _hex(value)
        except ValueError as exc:
            raise HTTPException(400, f"invalid colour for '{key}': {exc}") from exc
        if cleaned is None:
            raise HTTPException(400, f"invalid colour for '{key}': {value!r} is not a hex colour")
        out[key] = cleaned
    return out


def _effective_roles(authored: dict[str, str], change: dict[str, str]) -> dict[str, str]:
    """override ?? authored, restricted to the editable keys, so the response is
    the palette the pane should render rather than the whole transport map."""
    merged: dict[str, str] = {}
    for key in EDITABLE_SKIN_KEYS:
        if key in change:
            merged[key] = change[key]
        elif key in authored:
            merged[key] = authored[key]
    return merged


def _editor_name(value: str, *, field: str, builtin_hint: bool) -> str:
    """Normalise and vet a user-supplied name that becomes a filename.

    When a built-in is the problem, the refusal NAMES the override route: a
    built-in is never rewritten in place, so `PUT /skins/{name}` is simply the
    wrong door and the message has to say which one is right."""
    clean = (value or "").strip().lower()
    if _is_unsafe_name(clean):
        raise HTTPException(400, f"{field} must be a slug (lower-case, hyphens)")
    if clean in CORE_NAMES:
        if builtin_hint:
            raise HTTPException(
                409,
                f"'{clean}' is a built-in scene; a built-in is never rewritten in "
                f"place — edit it through PUT /overrides/{clean}, and reset it with "
                f"DELETE /overrides/{clean}",
            )
        raise HTTPException(409, f"'{clean}' is a built-in skin")
    return clean


@router.get("/schema")
def get_schema() -> dict[str, Any]:
    """The editor's only source of truth for what it may edit.

    The six role groups, the ten palette keys they cover, the mode pair, and the
    caps the writer enforces — so the pane renders its rows from the backend's own
    vocabulary instead of a copy that can drift from it."""
    groups: list[dict[str, Any]] = []
    seen: dict[str, int] = {}
    for key, group, purpose in EDITABLE_ROLES:
        if group not in seen:
            seen[group] = len(groups)
            groups.append({"id": group, "purpose": purpose, "keys": []})
        groups[seen[group]]["keys"].append(key)
    return {
        "ok": True,
        "modes": list(EDITOR_MODES),
        "roles": [
            {"id": key, "label": key.replace("_", " "), "group": group, "purpose": purpose}
            for key, group, purpose in EDITABLE_ROLES
        ],
        "groups": groups,
        "paletteKeys": list(EDITABLE_SKIN_KEYS),
        "typography": [],  # reserved: the plan's type fields are not editable yet
        "caps": {"maxColors": MAX_THEME_COLORS, "maxBytes": MAX_THEME_BYTES},
    }


# --- E1: read a skin, write a user skin, override a built-in, reset ----------


class ScenePaletteRequest(BaseModel):
    """A skin-keyed palette the editor sends: the nine roles per mode, plus the
    identity fields the same save may update."""

    light: dict[str, str] = {}
    dark: dict[str, str] = {}
    label: str = ""
    description: str = ""


class OverrideRequest(BaseModel):
    """One scene override: the roles that differ from the authored palette, per
    mode. A mode may be omitted; the untouched roles keep their authored values."""

    light: dict[str, str] = {}
    dark: dict[str, str] = {}


# Declared above the DELETE/PUT `/skins/{name}` pair only for readability — the
# methods differ, so neither shadows the other. `/skins/rename` (POST) stays
# where it is, above every path-parameter route.
@router.get("/skins/{name}")
def get_skin(name: str) -> dict[str, Any]:
    """One owned skin's palette, both modes.

    `GET /skins` lists owned skins but not their colours, so without this the pane
    cannot open one. Only OWNED skins answer: a skin Chroma never wrote is not
    ours to describe, and a hand-authored file has no provenance to trust."""
    clean = _editor_name(name, field="skin name", builtin_hint=False)
    record = _owned_record(clean)
    path = _skins_dir() / f"{clean}.yaml"
    if not path.is_file():
        raise HTTPException(404, f"'{clean}' has no skin file")
    data = _read_skin_file(path)
    colors = data.get("colors") if isinstance(data.get("colors"), dict) else {}
    light = data.get("light_colors") if isinstance(data.get("light_colors"), dict) else colors
    dark = data.get("dark_colors") if isinstance(data.get("dark_colors"), dict) else colors
    return {
        "ok": True,
        "name": clean,
        "label": record.get("label") or clean,
        "category": record.get("category") or "",
        "description": data.get("description") or "",
        "light": light,
        "dark": dark,
        "colors": colors,
    }


@router.put("/skins/{name}")
def put_skin(name: str, req: ScenePaletteRequest) -> dict[str, Any]:
    """Rewrite a USER skin from a skin-keyed palette.

    A SEPARATE writer from `import_skin`, deliberately. That one maps TweakCN
    tokens (`foreground`, `primary`, `cardForeground`), so handing it a scene
    palette would read `ui_accent` as absent and mint `#ffffff` — a silent
    corruption. This writer speaks the nine skin roles and nothing else.

    The index is read through the STRICT path under the write lock: a corrupt
    index aborts the write rather than being persisted as {} (the 8a06221 defect).
    A failed index write rolls the file back to its exact prior bytes."""
    clean = _editor_name(name, field="skin name", builtin_hint=True)

    oversized = _theme_too_large({"colors": req.light, "darkColors": req.dark})
    if oversized:
        raise HTTPException(413, f"palette is too large: {oversized}")
    light = _normalise_palette(req.light, what="light")
    dark = _normalise_palette(req.dark, what="dark")
    if not light and not dark and not req.description and not req.label:
        raise HTTPException(400, "nothing to write: send at least one role, a label or a description")

    target = _skins_dir() / f"{clean}.yaml"

    with _INDEX_LOCK:
        try:
            index = _read_index_for_update()
        except IndexUnreadableError as exc:
            raise _index_error(exc) from exc
        record = _owned_record(clean, index)

        if not target.is_file():
            raise HTTPException(404, f"'{clean}' has no skin file")

        original_text = target.read_text(encoding="utf-8")
        existing = _read_skin_file(target)
        base_light = existing.get("colors") if isinstance(existing.get("colors"), dict) else {}
        base_dark = existing.get("dark_colors") if isinstance(existing.get("dark_colors"), dict) else {}
        merged_light = {**base_light, **light}
        merged_dark = {**base_dark, **dark}

        data: dict[str, Any] = {
            "name": clean,
            "description": req.description or existing.get("description") or record.get("label") or clean,
            "colors": merged_light,
        }
        if merged_light:
            data["light_colors"] = merged_light
        if merged_dark:
            data["dark_colors"] = merged_dark

        try:
            _atomic_write_text(target, _dump_skin_yaml(data))
        except OSError as exc:
            raise HTTPException(500, f"could not write the skin file {target}: {exc}") from exc

        updated = dict(record)
        if req.label:
            updated["label"] = req.label
        updated["editedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        index[clean] = updated
        try:
            _write_index(index)
        except OSError as exc:
            # A rewrite whose provenance we could not record is a palette the pane
            # cannot explain. Put the file back exactly as it was; the edit is one
            # click from being redone, the lost provenance is not.
            try:
                _atomic_write_text(target, original_text)
            except OSError:
                pass
            raise HTTPException(
                500,
                f"the skin file was rewritten but the provenance index could not be "
                f"updated ({exc}); the file was rolled back. Fix free space or "
                f"permissions and retry.",
            ) from exc

    logger.info("rewrote skin %s", clean)
    return {
        "ok": True,
        "name": clean,
        "label": updated.get("label") or clean,
        "description": data["description"],
        "light": merged_light,
        "dark": merged_dark,
        "colors": merged_light,
    }


@router.get("/overrides")
def list_overrides() -> dict[str, Any]:
    """Every override record, so the pane can mark edited scenes on load.

    The authored catalogue is unchanged by an override; this file is the only
    place user intent lives, and it is not part of any build."""
    overrides = _read_overrides()
    return {"ok": True, "count": len(overrides), "overrides": overrides}


@router.put("/overrides/{scene}")
def put_override(scene: str, req: OverrideRequest) -> dict[str, Any]:
    """Write one override for a BUILT-IN scene and return the effective palette.

    An override is a RECORD, not a mutation: the authored skin files and the
    generated catalogue are never rewritten. The scene's gateway transport skins
    are re-minted from the effective palette, because an edit the CLI cannot see is
    the bug this product exists to fix. The authored palette is captured in the
    record so that Reset is self-contained and a reset can never depend on state
    the CLI has since moved."""
    clean = (scene or "").strip().lower()
    if _is_unsafe_name(clean):
        raise HTTPException(400, "scene name must be a slug (lower-case, hyphens)")

    oversized = _theme_too_large({"colors": req.light, "darkColors": req.dark})
    if oversized:
        raise HTTPException(413, f"override is too large: {oversized}")
    light = _normalise_palette(req.light, what="light")
    dark = _normalise_palette(req.dark, what="dark")
    if not light and not dark:
        raise HTTPException(400, "an override must change at least one role")

    with _OVERRIDES_LOCK:
        try:
            overrides = _read_overrides_for_update()
        except IndexUnreadableError as exc:
            raise _index_error(exc) from exc
        prior = dict(overrides)

        authored = _authored_scene(clean)  # 404 by name when the scene is unknown

        full: dict[str, dict[str, str]] = {}
        effective: dict[str, dict[str, str]] = {}
        for mode, change in (("light", light), ("dark", dark)):
            base = authored.get(mode, {})
            full[mode] = {**base, **change}
            effective[mode] = _effective_roles(base, change)

        record = {
            "light": light,
            "dark": dark,
            "authored": {mode: authored.get(mode, {}) for mode in EDITOR_MODES},
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        overrides[clean] = record
        try:
            _write_overrides(overrides)
        except OSError as exc:
            raise HTTPException(
                500, f"could not write the overrides file ({_overrides_path()}): {exc}"
            ) from exc

        try:
            for mode in EDITOR_MODES:
                if full[mode]:
                    _mint_transport(clean, mode, full[mode])
        except OSError as exc:
            # The record claims an edit whose CLI skin we could not mint. Undo the
            # record so the pane and the CLI cannot disagree about what is live;
            # the previously stored override (if any) is left exactly as it was.
            try:
                _write_overrides(prior)
            except OSError:
                pass
            raise HTTPException(
                500, f"could not re-mint the transport skins for '{clean}' ({exc}); the override was rolled back"
            ) from exc

    logger.info("wrote override for %s", clean)
    return {
        "ok": True,
        "scene": clean,
        "light": effective["light"],
        "dark": effective["dark"],
        "at": record["at"],
    }


@router.delete("/overrides/{scene}")
def delete_override(scene: str) -> dict[str, Any]:
    """Reset one scene: drop its override record and restore its authored
    transport skins.

    Per-skin by construction — no other scene's record is read or written, so a
    reset can never disturb a neighbour. Reset is the affordance that makes an
    edit safe, which is why it ships with the editor rather than after it."""
    clean = (scene or "").strip().lower()
    if _is_unsafe_name(clean):
        raise HTTPException(400, "scene name must be a slug (lower-case, hyphens)")

    with _OVERRIDES_LOCK:
        try:
            overrides = _read_overrides_for_update()
        except IndexUnreadableError as exc:
            raise _index_error(exc) from exc
        record = overrides.get(clean)
        if not isinstance(record, dict):
            raise HTTPException(404, f"'{clean}' has no override to reset")

        authored = record.get("authored") if isinstance(record.get("authored"), dict) else {}
        restored: dict[str, dict[str, str]] = {}
        for mode in EDITOR_MODES:
            palette = authored.get(mode)
            if isinstance(palette, dict) and palette:
                try:
                    _mint_transport(clean, mode, {str(k): str(v) for k, v in palette.items()})
                except OSError as exc:
                    raise HTTPException(
                        500, f"could not restore the authored transport for '{clean}' ({exc})"
                    ) from exc
                restored[mode] = palette

        overrides.pop(clean, None)
        try:
            _write_overrides(overrides)
        except OSError as exc:
            raise HTTPException(
                500, f"could not write the overrides file ({_overrides_path()}): {exc}"
            ) from exc

    logger.info("reset override for %s", clean)
    return {"ok": True, "scene": clean, "reset": True, "restored": restored}