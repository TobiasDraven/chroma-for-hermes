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