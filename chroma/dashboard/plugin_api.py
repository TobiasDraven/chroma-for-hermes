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

HERMES_HOME: Path | None = None
"""An explicit override for <hermes home>.

`None` means "resolve it per request" (see `_home`). A `Path` pins it — which
is how a test run, or an explicit deployment, stays away from the real Hermes
home. The value is read at CALL time, so assigning to it redirects every path
helper at once."""


def _home() -> Path:
    """Resolve <hermes home> for THIS request.

    The host's home is CONTEXT-LOCAL: `hermes_constants.get_hermes_home()`
    reads a ContextVar that the plugin router's per-profile dependency sets for
    the request. This module is imported ONCE, so a home frozen at import time
    sends every profile's request to the LAUNCH profile's directory — an import
    scoped to profile B lands in profile A's `skins/`. Resolving per call is
    what makes `?profile=` mean anything.

    The static override wins when it is set: it is how a test run stays out of
    the real <hermes home>."""
    if HERMES_HOME is not None:
        return Path(HERMES_HOME)
    try:
        from hermes_constants import get_hermes_home  # documented way to resolve <hermes home>
        return Path(get_hermes_home())
    except Exception:  # pragma: no cover - fallback for direct import
        return Path(os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes")))


# This module deliberately imports NOTHING private from the Hermes core.
# The catalog admission lint refuses `utils.*` / `hermes_yaml` (rule 9: public
# surfaces only, since they can break on any release), so the small skin shape
# below is serialised here and written atomically with the standard library.


def _refuse_control_characters(text: str, field: str) -> None:
    """Refuse a control character in a string that becomes skin file content.

    A control character has no legitimate use in a skin label or description,
    and some of them are FATAL to the file: inside a single-quoted scalar a
    newline is legal YAML but FOLDS into the value, so a label can inject lines
    of its own (including a `---` document marker), and a NUL makes the Hermes
    engine's parser reject the file outright — the skin then vanishes from the
    CLI while the import reports success.

    The policy is REFUSE, not sanitise: a label is human text, so a control
    character in one is a mistake or an attack, never intent — and silently
    rewriting a user's label would hide the very thing the user needs to see.
    A refusal cannot lose real intent; a sanitiser can."""
    for ch in text:
        code = ord(ch)
        if code < 0x20 or code == 0x7F:
            raise HTTPException(
                400,
                f"the {field} may not contain the control character U+{code:04X}; "
                f"a skin label is single-line text",
            )


def _yaml_scalar(value: Any, field: str = "value") -> str:
    """Emit one YAML scalar. Only plain strings reach here (hex colours, names,
    descriptions), so single-quoting with doubled quotes is sufficient.

    A control character is refused rather than escaped: see
    `_refuse_control_characters` for why a refusal is the honest answer."""
    text = str(value)
    _refuse_control_characters(text, field)
    return "'" + text.replace("'", "''") + "'"


def _dump_skin_yaml(data: dict[str, Any]) -> str:
    """Serialise the known skin shape: top-level scalars plus string->string maps."""
    lines: list[str] = []
    for key, value in data.items():
        if isinstance(value, dict):
            lines.append(f"{key}:")
            for inner_key, inner_value in value.items():
                lines.append(f"  {inner_key}: {_yaml_scalar(inner_value, inner_key)}")
        else:
            lines.append(f"{key}: {_yaml_scalar(value, key)}")
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
    d = _home() / "skins"
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
# The twelve measured shelves, in the pane's display order.
#
# These are THEME_CATEGORIES' ids in desktop/plugin.template.js, copied here so the
# backend can refuse a user category that would collide with one. The PANE is the
# source of truth — a test reads its list back out of the template and pins the two
# together, so this copy cannot drift silently.
BUILTIN_CATEGORY_IDS: tuple[str, ...] = (
    "persimmon", "apricot", "amber", "gold", "lemon", "fern",
    "teal", "cobalt", "indigo", "violet", "rose", "neutral",
)

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

# The slug's LENGTH is bounded too, and separately: `_SLUG_RE` bounds the
# alphabet, not the size. A 300-character slug passes every other guard and
# then fails in the filesystem itself (`ENAMETOOLONG`), which is a 500 for what
# is really a bad input. Sixty-four characters is far more than any real skin
# name needs and far less than any filesystem allows.
MAX_SKIN_NAME_CHARS = 64

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

    A supplied value that is not even a STRING is broken in the same way, and
    `_hex`'s own contract says so: it returns None for an absent token, so a
    non-string used to be skipped here and silently became a default palette
    with a 200 OK."""
    for mapping in maps:
        if not isinstance(mapping, dict):
            continue
        for key, value in mapping.items():
            if value is None:
                continue  # not supplied: the token falls back
            if not isinstance(value, str):
                raise HTTPException(
                    400, f"invalid colour for '{key}': {value!r} is not a hex colour"
                )
            try:
                _hex(value)
            except ValueError as exc:
                raise HTTPException(400, f"invalid colour for '{key}': {exc}") from exc


def _check_name_length(name: str, field: str) -> None:
    """Refuse a name too long to be a filename, naming the limit.

    A name this backend mints becomes a file, and the filesystem's own limit
    (255 bytes on ext4/NTFS) is not a validation rule the user can act on."""
    if len(name) > MAX_SKIN_NAME_CHARS:
        raise HTTPException(
            400, f"{field} is too long (max {MAX_SKIN_NAME_CHARS} characters)"
        )


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
    _check_name_length(name, "skin name")
    if name in CORE_NAMES:
        raise HTTPException(409, f"'{name}' collides with a built-in skin")

    # Bound the request before it is parsed any further: `theme` is an open dict,
    # and an unbounded one lets a single request make the server allocate.
    theme = req.theme or {}
    oversized = _theme_too_large(theme)
    if oversized:
        raise HTTPException(413, f"theme is too large: {oversized}")

    # `_skins_dir()` and not `Path(HERMES_HOME)`: the home is resolved per
    # request, and the override may be None.
    skins_dir = _skins_dir()
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
    _check_name_length(clean, field)
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


def _rollback_rename(src: Path, dst: Path, original_text: str) -> str:
    """Undo a rename: the original BYTES at the original PATH.

    Both halves, because the engine needs both: `list_skins` keys a skin by the
    `name:` field INSIDE the file, while `load_skin` opens `<skins>/<name>.yaml`.
    A file left at the old path with the new name inside it is listed under a
    name it cannot be loaded by — the CLI then paints the default palette
    instead of the user's theme, and says nothing about it.

    Two orders, chosen by what is actually on disk:

    * `dst` still holds the ORIGINAL bytes (the identity rewrite failed, and it
      is atomic): move it back. One step, and it needs no free space.
    * `dst` holds the RENAMED bytes (the index write failed): write the
      original bytes back at `src` FIRST, and only then drop the renamed copy.
      If that write fails there is no room for it, and `dst` is left alone —
      a self-consistent skin whose `name:` matches its filename, which is the
      best state a full disk can leave behind. Deleting `dst` there would be
      the one thing that loses the user's theme.

    Returns a note describing what is actually on disk; "" means the rollback
    was complete."""
    try:
        current: str | None = dst.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        current = None

    if current is not None and current == original_text:
        # Still the original bytes: one move restores the path AND the content.
        try:
            os.replace(dst, src)
            return ""
        except OSError as exc:
            return f"the skin could not be put back ({exc}); it is still at {dst}"

    try:
        _atomic_write_text(src, original_text)
    except OSError as exc:
        return (
            f"the skin could not be restored to {src} ({exc}); it is still at {dst} "
            f"under its new name '{dst.stem}'"
        )
    # `src` now holds a full copy of the skin, so the renamed copy may go.
    # `dst` did not exist before this call (a 409 refuses that), so this
    # removes a file this call created — never one the user had.
    _unlink_quietly(dst)
    return ""


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

        # The ORIGINAL bytes, read before anything moves. A rollback has to put
        # back BOTH halves of the rename: the path AND the content. Restoring
        # the path alone leaves the file at `old-name.yaml` holding
        # `name: 'new-name'` — and the engine lists a skin by the `name:` field
        # INSIDE the file while it LOADS it by filename, so the CLI lists a
        # theme it cannot load and silently paints the default palette instead.
        # Read it through the guarded reader: a file that is not UTF-8 is named
        # here, before anything moves, rather than crashing the endpoint.
        original_text = _read_skin_text(src)

        # Move first, then the identity fields, then the index: the skin file is
        # what the engine reads, so it must never point at a file that is not there.
        try:
            os.replace(src, dst)
        except OSError as exc:
            raise HTTPException(500, f"could not move the skin file to {dst}: {exc}") from exc

        try:
            _rewrite_skin_name(dst, source, target)
        except (OSError, UnicodeDecodeError) as exc:
            # A half-renamed skin is worse than no rename. The rewrite is atomic,
            # so `dst` still holds the ORIGINAL bytes here: the rollback puts
            # both halves back.
            note = _rollback_rename(src, dst, original_text)
            raise HTTPException(
                500,
                f"could not rewrite the renamed skin {dst}: {exc}; "
                f"{note or 'the rename was rolled back'}.",
            ) from exc

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
            # Put the file back under its old name AND with its old bytes: a
            # rename the index never learned about is a skin the picker can
            # neither show nor delete, and a skin whose `name:` no longer
            # matches its filename is one the CLI cannot load.
            note = _rollback_rename(src, dst, original_text)
            rolled = (
                "the rename was rolled back"
                if not note
                else f"the rename could NOT be rolled back completely: {note}"
            )
            raise HTTPException(
                500,
                f"the skin was moved but the provenance index could not be updated "
                f"({exc}); {rolled}. Fix free space or permissions and retry.",
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
        return _read_skin_text(path)

    if name:
        clean = _guard_name(name, field="skin name")
        _owned_record(clean)
        return {
            "ok": True,
            "filename": f"{clean}.yaml",
            "count": 1,
            "files": [{"name": clean, "yaml": read_one(clean)}],
        }

    # One mis-encoded file must not block the export of every other skin: the
    # failures are collected and reported alongside the files that did export.
    files: list[dict[str, Any]] = []
    unreadable: list[dict[str, str]] = []
    for skin in sorted(index):
        path = skins_dir / f"{skin}.yaml"
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            unreadable.append({"name": skin, "error": str(exc)})
            continue
        files.append({"name": skin, "yaml": text})
    return {
        "ok": True,
        "filename": "chroma-skins.json",
        "count": len(files),
        "index": index,
        "files": files,
        "unreadable": unreadable,
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
# The WHOLE palette a skin may carry: 43 named colours. The editor used to
# expose ten of them through six roles, which made the other thirty-three
# unreachable from the only interface built to reach them.
EDITABLE_SKIN_KEYS: tuple[str, ...] = (
    "background",
    "status_bar_bg",
    "completion_menu_bg",
    "ui_accent",
    "banner_accent",
    "banner_title",
    "ui_text",
    "banner_text",
    "status_bar_text",
    "banner_dim",
    "ui_border",
    "banner_border",
    "session_border",
    "completion_menu_current_bg",
    "completion_menu_meta_bg",
    "completion_menu_meta_current_bg",
    "selection_bg",
    "voice_status_bg",
    "ui_label",
    "status_bar_dim",
    "status_bar_strong",
    "session_label",
    "prompt",
    "shell_dollar",
    "ui_ok",
    "ui_warn",
    "ui_error",
    "ui_thinking",
    "ui_tool",
    "status_bar_good",
    "status_bar_warn",
    "status_bar_bad",
    "status_bar_critical",
    "syntax_comment",
    "syntax_keyword",
    "syntax_number",
    "syntax_string",
    "diff_added",
    "diff_added_word",
    "diff_removed",
    "diff_removed_word",
    "response_border",
    "input_rule",
)

# (key, its group, that group's one-line purpose). The groups are the editor's
# sections; the keys above are the rows inside them.
EDITABLE_ROLES: tuple[tuple[str, str, str], ...] = (
    ("background", "Core", "Shell"),
    ("status_bar_bg", "Core", "Shell"),
    ("completion_menu_bg", "Core", "Shell"),
    ("ui_accent", "Core", "Signature"),
    ("banner_accent", "Core", "Signature"),
    ("banner_title", "Core", "Signature"),
    ("ui_text", "Core", "Reading"),
    ("banner_text", "Core", "Reading"),
    ("status_bar_text", "Core", "Reading"),
    ("banner_dim", "Core", "Secondary text"),
    ("ui_border", "Core", "Structure"),
    ("banner_border", "Core", "Structure"),
    ("session_border", "Core", "Structure"),
    ("completion_menu_current_bg", "Menus", "Menu selection"),
    ("completion_menu_meta_bg", "Menus", "Menu meta"),
    ("completion_menu_meta_current_bg", "Menus", "Menu meta selection"),
    ("selection_bg", "Menus", "Text selection"),
    ("voice_status_bg", "Menus", "Voice bar"),
    ("ui_label", "Text", "Labels"),
    ("status_bar_dim", "Text", "Status dim"),
    ("status_bar_strong", "Text", "Status strong"),
    ("session_label", "Text", "Session label"),
    ("prompt", "Text", "Prompt"),
    ("shell_dollar", "Text", "Shell mark"),
    ("ui_ok", "State", "OK"),
    ("ui_warn", "State", "Warning"),
    ("ui_error", "State", "Error"),
    ("ui_thinking", "State", "Thinking"),
    ("ui_tool", "State", "Tool"),
    ("status_bar_good", "State", "Status good"),
    ("status_bar_warn", "State", "Status warn"),
    ("status_bar_bad", "State", "Status bad"),
    ("status_bar_critical", "State", "Status critical"),
    ("syntax_comment", "Syntax", "Comment"),
    ("syntax_keyword", "Syntax", "Keyword"),
    ("syntax_number", "Syntax", "Number"),
    ("syntax_string", "Syntax", "String"),
    ("diff_added", "Diffs", "Added line"),
    ("diff_added_word", "Diffs", "Added word"),
    ("diff_removed", "Diffs", "Removed line"),
    ("diff_removed_word", "Diffs", "Removed word"),
    ("response_border", "Framing", "Response frame"),
    ("input_rule", "Framing", "Input rule"),
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


_CATEGORIES_FILENAME = "categories.json"

# Same discipline as the index and the overrides: this file is USER DATA. A write
# derived from a failed read is the exact data-loss defect 8a06221 closed. Reads
# that only SHOW it stay lenient (GET /categories); anything that WRITES goes
# strict. Whole read-modify-write under one lock, for the same reason.
_CATEGORIES_LOCK = threading.Lock()


def _categories_path() -> Path:
    """<skins>/.chroma/categories.json — beside the index and the overrides, in the
    sidecar dir the skin engine never globs. NOT a build input: a user category is
    user intent, never baked into the generated catalogue."""
    d = _skins_dir() / SIDECAR_DIRNAME
    d.mkdir(parents=True, exist_ok=True)
    return d / _CATEGORIES_FILENAME


def _read_categories() -> list[dict[str, Any]]:
    """The user's categories for READ-ONLY use, or [] if the file is missing or
    unreadable. Lenient by design: decorating the pane must never take the picker
    down, and no write is ever derived from this reading."""
    p = _categories_path()
    if not p.is_file():
        return []
    try:
        parsed = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning("chroma categories unreadable at %s; treating as empty for read-only views", p)
        return []
    if not isinstance(parsed, dict):
        return []
    cats = parsed.get("categories")
    if not isinstance(cats, list):
        return []
    return [c for c in cats if isinstance(c, dict) and isinstance(c.get("id"), str) and c["id"].strip()]


def _read_categories_for_update() -> list[dict[str, Any]]:
    """Read the categories file for a path that is about to WRITE it.

    A present-but-unreadable file is fatal rather than [] for exactly the reason the
    index is: persisting that [] deletes every category the user made. The bad file
    is copied aside first so the records survive a manual repair. Callers hold
    `_CATEGORIES_LOCK`."""
    p = _categories_path()
    if not p.is_file():
        return []
    try:
        parsed = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise IndexUnreadableError(p, _quarantine_index(p), exc) from exc
    if not isinstance(parsed, dict):
        raise IndexUnreadableError(p, _quarantine_index(p), "the file is not a JSON object")
    cats = parsed.get("categories")
    if cats is None:
        return []
    if not isinstance(cats, list):
        raise IndexUnreadableError(p, _quarantine_index(p), "'categories' is not an array")
    return [c for c in cats if isinstance(c, dict)]


def _write_categories(categories: list[dict[str, Any]]) -> None:
    _atomic_write_text(
        _categories_path(),
        json.dumps({"categories": categories}, indent=2, sort_keys=True) + "\n",
    )


def _write_categories_or_500(categories: list[dict[str, Any]]) -> None:
    """Write the categories file, turning a filesystem failure into an actionable
    5xx rather than a bare traceback. The atomic replace means a failure leaves the
    prior file intact — there is no half-file to repair."""
    try:
        _write_categories(categories)
    except OSError as exc:
        raise HTTPException(
            500,
            f"could not update the category store ({_categories_path()}): {exc}. "
            f"Fix free space or permissions and retry.",
        ) from exc


def _category_error(exc: IndexUnreadableError) -> HTTPException:
    """Turn an unreadable-categories failure into an actionable 5xx for the caller."""
    return HTTPException(500, str(exc))


def _sorted_categories(categories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deterministic order for display: `(order, id)`, with a stable fallback for a
    record whose order is missing or not an int (an older hand-written file)."""
    def key(record: dict[str, Any]) -> tuple[int, str]:
        order = record.get("order")
        return (order if isinstance(order, int) else 1_000_000, str(record.get("id") or ""))

    return sorted(categories, key=key)


def _known_category_ids(categories: list[dict[str, Any]]) -> set[str]:
    return {str(c.get("id")) for c in categories if isinstance(c.get("id"), str)}


def _unscalar(value: str) -> str:
    """Undo `_yaml_scalar`: strip one layer of single quotes, un-double any inside."""
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return value


def _read_skin_text(path: Path) -> str:
    """Read a skin file as UTF-8 text, turning an unreadable file into an
    actionable error instead of an unhandled exception.

    `UnicodeDecodeError` is a `ValueError`, NOT an `OSError`, so the
    `except OSError` guards around this code never caught it: one mis-encoded
    skin file 500'd the export of EVERY skin, and `GET /skins/{name}` died with
    a bare traceback. A file that cannot be read is named, not crashed on."""
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            500, f"the skin file {path.name} is not readable UTF-8 ({exc})"
        ) from exc
    except OSError as exc:
        raise HTTPException(
            500, f"the skin file {path.name} could not be read ({exc})"
        ) from exc


def _read_skin_file(path: Path) -> dict[str, Any]:
    """Parse the flat skin shape `_dump_skin_yaml` writes: top-level `key: 'v'`
    scalars plus nested `key:` blocks of indented `inner: 'v'`.

    A tiny reader rather than a YAML dependency — the module imports nothing
    private from the Hermes core (rule 9), and this exact shape is all it writes
    or reads. **Not** a general YAML parser: anything it does not model is left
    out of the result rather than guessed at."""
    data: dict[str, Any] = {}
    current: dict[str, Any] | None = None
    for raw in _read_skin_text(path).splitlines():
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


def _is_transport_scene(scene: str) -> bool:
    """True when a scene exists only as a gateway transport file.

    Those files are the proof a built-in scene exists, and the wrong door for
    ``PUT /skins/{name}``: a built-in is never rewritten in place, so the honest
    answer is a 409 that names the override route, not an unknown-name 404.
    """
    return any(_transport_path(scene, mode).is_file() for mode in EDITOR_MODES)


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
            except (OSError, HTTPException):
                # An unreadable transport file is skipped, not fatal: one bad
                # file must not take the whole scene down.
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


# --- E5: typography ----------------------------------------------------------
#
# A font choice rides the EXISTING overrides store. A typography edit is an override
# exactly like a colour edit (§17), so there is no new store and no new file. The
# authored fonts are NOT captured in the record the way authored colours are: the
# authored stack lives in the pane's SCENE_TYPOGRAPHY, which the pane already holds,
# so Reset needs nothing from here.
TYPOGRAPHY_KEYS: tuple[str, ...] = ("fontSans", "fontMono")

# A CSS font stack the pane will paste into a custom property. Generous for a real
# stack (`"Segoe WPC", "Segoe UI", -apple-system, ... , emoji`), but short enough
# that nothing pathological fits.
MAX_FONT_STACK_CHARS = 200

# Characters that would let a stack escape the declaration it is pasted into, plus
# `url(` — a stack has no business opening a URL. Everything a real stack uses
# (letters, digits, spaces, commas, quotes, hyphens, underscores, dots, parens) is
# allowed; this list is the whole refusal set.
_FONT_STACK_FORBIDDEN = (";", "{", "}", "<", ">", "\n", "\r", "url(")


def _validate_font_stack(value: Any, key: str) -> str:
    """Vet one font stack. Returns the stripped value or raises a named 400.

    Hostile by default: this string becomes a CSS value, so anything that could
    close the declaration or open a URL is refused rather than escaped — a font name
    has no legitimate use for those, so a rejection cannot lose real intent."""
    if not isinstance(value, str):
        raise HTTPException(400, f"'{key}' must be a string")
    stack = value.strip()
    if not stack:
        raise HTTPException(400, f"'{key}' must not be empty")
    if len(stack) > MAX_FONT_STACK_CHARS:
        raise HTTPException(
            400,
            f"'{key}' is {len(stack)} characters; a font stack is capped at {MAX_FONT_STACK_CHARS}",
        )
    lowered = stack.lower()
    for token in _FONT_STACK_FORBIDDEN:
        if token in lowered:
            shown = token.replace("\n", "\\n").replace("\r", "\\r")
            raise HTTPException(400, f"'{key}' contains {shown!r}, which a font stack may not contain")
    return stack


def _normalise_typography(mapping: Any) -> dict[str, str]:
    """Validate a request's `typography` map. An unknown key is a 400 naming it and
    the valid keys — never a silent drop."""
    if mapping is None:
        return {}
    if not isinstance(mapping, dict):
        raise HTTPException(400, "'typography' must be an object")
    out: dict[str, str] = {}
    for key, value in mapping.items():
        if key not in TYPOGRAPHY_KEYS:
            raise HTTPException(
                400,
                f"'{key}' is not an editable typography key; valid keys are "
                f"{', '.join(TYPOGRAPHY_KEYS)}",
            )
        out[key] = _validate_font_stack(value, key)
    return out


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
    _check_name_length(clean, field)
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
        "typography": [
            {"id": key, "label": "Sans" if key == "fontSans" else "Mono"}
            for key in TYPOGRAPHY_KEYS
        ],
        # The twelve measured shelves, in display order. The pane renders its own copy;
        # this is here so the two cannot drift without a test noticing.
        "categories": list(BUILTIN_CATEGORY_IDS),
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
    # The per-skin category assignment. "" clears it — the skin then falls back to
    # its measured shelf in the pane. A category lives on the index record, never in
    # the skin YAML: the CLI does not read one, and a key it ignores is a key that
    # would be silently dropped on the next regeneration.
    category: str = ""


class OverrideRequest(BaseModel):
    """One scene override: the roles that differ from the authored palette, per
    mode, plus the fonts that differ from the authored stack. A mode may be omitted;
    the untouched roles keep their authored values. `typography` holds only the keys
    the user set — an absent key means "keep the authored font"."""

    light: dict[str, str] = {}
    dark: dict[str, str] = {}
    typography: dict[str, str] = {}


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
    # A category assignment IS an edit, so it counts as content here. Pydantic's
    # `model_fields_set` separates "category omitted" from "category explicitly
    # cleared" -- both are falsy, but only the first means "nothing to write".
    if (
        not light
        and not dark
        and not req.description
        and not req.label
        and "category" not in req.model_fields_set
    ):
        raise HTTPException(
            400,
            "nothing to write: send at least one role, a label, a description or a category",
        )

    # A category assignment IS an edit, so it counts as content above. Validate it
    # before anything is written: a bad value must not leave a half-applied save.
    category = (req.category or "").strip()
    if category:
        known = set(BUILTIN_CATEGORY_IDS) | _known_category_ids(_read_categories())
        if category not in known:
            raise HTTPException(
                400,
                f"'{category}' is not a category Chroma knows; valid values are "
                f"{', '.join(sorted(known))}",
            )

    target = _skins_dir() / f"{clean}.yaml"

    with _INDEX_LOCK:
        try:
            index = _read_index_for_update()
        except IndexUnreadableError as exc:
            raise _index_error(exc) from exc
        record = index.get(clean)
        if not isinstance(record, dict):
            # Not a skin Chroma owns. If it is a scene the gateway already
            # follows, the user reached the wrong door: a built-in is never
            # rewritten in place, and its colours live on the override route.
            # Say so (409), rather than the bare unknown-name 404 the transport
            # case used to fall through to (§19.2 item 3).
            if _is_transport_scene(clean):
                raise HTTPException(
                    409,
                    f"'{clean}' is a built-in scene; a built-in is never rewritten in "
                    f"place — edit it through PUT /overrides/{clean}, and reset it with "
                    f"DELETE /overrides/{clean}",
                )
            raise HTTPException(404, f"'{clean}' is not a skin Chroma manages")

        if not target.is_file():
            raise HTTPException(404, f"'{clean}' has no skin file")

        original_text = _read_skin_text(target)
        existing = _read_skin_file(target)
        base_colors = existing.get("colors") if isinstance(existing.get("colors"), dict) else {}
        # The editor DISPLAYS `light_colors` (see `get_skin`), and the pane
        # sends only the roles the user actually edited. Merging those edits
        # over `colors` therefore replaced a divergent light palette with the
        # shared one on the first save — the palette the user was looking at
        # vanished. The merge base must be the palette that was DISPLAYED.
        base_light = (
            existing.get("light_colors")
            if isinstance(existing.get("light_colors"), dict)
            else base_colors
        )
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
        # "" is a real value here, not an omission: it clears the assignment.
        updated["category"] = category
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
        "category": updated.get("category") or "",
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
    typography = _normalise_typography(req.typography)
    # An override that sets ONLY a font is a valid edit — the guard widens to admit it.
    if not light and not dark and not typography:
        raise HTTPException(400, "an override must change at least one role or font")

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
        # Only the keys the user set — the same "record what they set, not what they
        # cleared" rule the colour half follows. An absent/empty map means "no font
        # override", and is omitted so an older record keeps its exact old shape.
        if typography:
            record["typography"] = typography
        overrides[clean] = record
        try:
            _write_overrides(overrides)
        except OSError as exc:
            raise HTTPException(
                500, f"could not write the overrides file ({_overrides_path()}): {exc}"
            ) from exc

        try:
            # A typography-only change does NOT mint a transport skin: a skin YAML
            # carries colours, not fonts, so minting would be a lie about what the
            # CLI received. Mint only when a colour actually changed.
            if light or dark:
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
        "typography": record.get("typography") or {},
        "at": record["at"],
    }


@router.delete("/overrides/{scene}")
def delete_override(scene: str) -> dict[str, Any]:
    """Reset one scene: drop its override record and restore its authored
    transport skins.

    Per-skin by construction — no other scene's record is read or written, so a
    reset can never disturb a neighbour. Reset is the affordance that makes an
    edit safe, which is why it ships with the editor rather than after it.

    Dropping the record drops the typography with it. There is nothing to restore
    from here: the authored font lives in the pane's `SCENE_TYPOGRAPHY`, which the
    pane already holds — there is no authored typography snapshot in this file."""
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


# --- E2: duplicate a scene's palette into a new owned skin -----------------
#
# The escape hatch the built-in rule needs: a user may not rewrite a built-in in
# place (§7), so they fork its palette into a skin we own. Both palettes arrive
# from the pane already resolved to the ten editable skin keys — the server
# RESOLVES NOTHING and INVENTS NOTHING. Reading the source scene to "fill in" an
# absent role would claim the user chose a colour they never saw; an absent role
# stays absent in the YAML (§6, line 123).


# --- E4: categories ----------------------------------------------------------
#
# A category is a named container for skins. The twelve BUILTIN_CATEGORY_IDS are the
# measured shelves the pane renders; this store holds only the user's OWN categories,
# which sit beside them as a second, additive axis. A skin joins one through the
# per-skin assignment on the index record (`PUT /skins/{name}`), never by moving a
# file — so this whole feature is index-and-sidecar only, and no skin file is ever
# rewritten or removed by it.


class CategoryCreateRequest(BaseModel):
    """A user's new category. `id` is optional: an empty id is slugified from the
    title, so the pane can offer a one-field form."""

    id: str = ""
    title: str = ""


@router.get("/categories")
def list_categories() -> dict[str, Any]:
    """The user's OWN categories — the twelve built-ins are the pane's to render.

    Lenient read: an unreadable store shows as empty rather than taking the picker
    down. Nothing is ever written from this reading."""
    categories = _sorted_categories(_read_categories())
    return {
        "ok": True,
        "count": len(categories),
        "categories": [
            {"id": c.get("id"), "title": c.get("title") or c.get("id"), "order": c.get("order")}
            for c in categories
        ],
        "builtins": list(BUILTIN_CATEGORY_IDS),
    }


@router.post("/categories")
def create_category(req: CategoryCreateRequest) -> dict[str, Any]:
    """Create a user category.

    Refusals are explicit and named: an unsafe id, an empty title, a built-in id and
    a duplicate id each get their own status and message. A failed write is a 500 —
    the atomic replace leaves the prior file intact, so there is no half-file."""
    title = (req.title or "").strip()
    if not title:
        raise HTTPException(400, "a category needs a title")

    raw_id = (req.id or "").strip()
    cat_id = _slugify(raw_id) if raw_id else _slugify(title)
    if not cat_id or _is_unsafe_name(cat_id):
        raise HTTPException(
            400,
            f"'{raw_id or title}' does not reduce to a usable category id — "
            f"use letters, digits and hyphens",
        )
    if cat_id in BUILTIN_CATEGORY_IDS:
        raise HTTPException(409, f"'{cat_id}' is a built-in category")

    with _CATEGORIES_LOCK:
        try:
            categories = _read_categories_for_update()
        except IndexUnreadableError as exc:
            raise _category_error(exc) from exc
        if cat_id in _known_category_ids(categories):
            raise HTTPException(409, f"'{cat_id}' already exists")
        order = len(BUILTIN_CATEGORY_IDS) + len(categories)
        categories.append({"id": cat_id, "title": title, "order": order})
        _write_categories_or_500(categories)

    logger.info("created category %s", cat_id)
    return {"ok": True, "id": cat_id, "title": title, "order": order}


@router.delete("/categories/{cat_id}")
def delete_category(cat_id: str) -> dict[str, Any]:
    """Remove a user category.

    SAFE BY CONSTRUCTION: it deletes a record in the sidecar store and nothing else.
    No skin file and no index entry is touched — the skins that pointed at this
    category keep their colours and simply fall back to their measured shelf in the
    pane. That is why this route needs no rollback path."""
    key = _slugify(cat_id)
    if key in BUILTIN_CATEGORY_IDS:
        raise HTTPException(409, f"'{key}' is a built-in category and cannot be deleted")

    with _CATEGORIES_LOCK:
        try:
            categories = _read_categories_for_update()
        except IndexUnreadableError as exc:
            raise _category_error(exc) from exc
        kept = [c for c in categories if str(c.get("id")) != key]
        if len(kept) == len(categories):
            raise HTTPException(404, f"'{key}' is not a category Chroma manages")
        _write_categories_or_500(kept)

    logger.info("deleted category %s", key)
    return {"ok": True, "id": key, "removed": True}


class DuplicateRequest(BaseModel):
    """Fork a palette into a brand-new owned skin.

    `light`/`dark` are CONCRETE skin-keyed maps (the same vocabulary
    `PUT /skins/{name}` accepts), never the pane's logical role ids."""

    to: str
    label: str | None = None
    light: dict[str, str] = {}
    dark: dict[str, str] = {}


def _owned_record_template(index: dict[str, Any]) -> dict[str, Any]:
    """A new record's SHAPE, copied from a record the index already holds.

    The index is the schema: whatever keys an owned record carries, a new one
    carries too — no field is invented here. Falls back to the key set
    `import_skin` writes when the index holds no owned record yet."""
    for meta in index.values():
        if isinstance(meta, dict) and meta.get("source") in ("user", "chroma"):
            return {key: None for key in meta}
    return {key: None for key in ("source", "label", "category", "importedAt")}


def _new_owned_record(
    index: dict[str, Any], *, label: str, pack: str | None, ts: str
) -> dict[str, Any]:
    """Build an owned-skin record carrying the keys the index already tolerates.

    `source`, `pack` and `importedAt` are always set (§5, line 96). `label` and
    `category` are only present when the copied shape has them, so a duplicate
    never mints a field the schema does not carry."""
    record = _owned_record_template(index)
    record["source"] = "user"
    record["pack"] = pack
    record["importedAt"] = ts
    record["label"] = label
    if "category" in record:
        record["category"] = ""
    return record


@router.post("/skins/duplicate")
def duplicate_skin(req: DuplicateRequest) -> dict[str, Any]:
    """Fork a scene's effective palette into a brand-new owned skin.

    The result is a first-class skin: CLI-visible at the top level, individually
    deletable, exportable — written through the same `_dump_skin_yaml` path the
    importer uses."""
    to = _guard_name(req.to, field="new name")

    oversized = _theme_too_large({"colors": req.light, "darkColors": req.dark})
    if oversized:
        raise HTTPException(413, f"palette is too large: {oversized}")
    # `_normalise_palette` is the skin-keyed validator: unknown roles are refused
    # BY NAME (never silently dropped) and a non-#rrggbb value is named too.
    light = _normalise_palette(req.light, what="light")
    dark = _normalise_palette(req.dark, what="dark")
    if not light and not dark:
        raise HTTPException(
            400, "a duplicate must carry at least one colour in the light or dark palette"
        )

    label = (req.label or "").strip()
    target = _skins_dir() / f"{to}.yaml"

    # Only the blocks the pane actually sent: an absent role stays absent, and a
    # whole absent mode stays absent (no empty `dark_colors:` key).
    data: dict[str, Any] = {"name": to, "description": label or to}
    if light:
        data["colors"] = light
        data["light_colors"] = light
    if dark:
        data["dark_colors"] = dark

    with _INDEX_LOCK:
        try:
            index = _read_index_for_update()
        except IndexUnreadableError as exc:
            raise _index_error(exc) from exc

        # Checked inside the lock so two duplicates of one name cannot both pass.
        if target.exists():
            raise HTTPException(409, f"skin '{to}' already exists; choose another name")

        try:
            _atomic_write_text(target, _dump_skin_yaml(data))
        except OSError as exc:
            raise HTTPException(500, f"could not write the skin file {target}: {exc}") from exc

        index[to] = _new_owned_record(
            index,
            label=label or to,
            pack=None,
            ts=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
        try:
            _write_index(index)
        except OSError as exc:
            # A file with no provenance is a skin the picker can never manage.
            _unlink_quietly(target)
            raise HTTPException(
                500,
                f"the skin file was written but the provenance index could not be "
                f"updated ({exc}); the file was rolled back, so nothing is orphaned. "
                f"Fix free space or permissions and retry.",
            ) from exc

    logger.info("duplicated a palette into skin %s", target)
    return {"ok": True, "name": to, "path": str(target)}


# --- E3: packs -------------------------------------------------------------
#
# A pack is METADATA, not a container (plan §4, §7): the member skins stay
# ordinary top-level files, so every one remains CLI-visible and individually
# deletable. The record lives at `<skins>/.chroma/packs/<slug>.json`.

PACKS_DIRNAME = "packs"
PACK_FORMAT_VERSION = 1
MAX_PACK_SKINS = 512
MAX_TOTAL_SKINS = 2048
TRASH_RETENTION_DAYS = 30


def _packs_dir() -> Path:
    d = _skins_dir() / SIDECAR_DIRNAME / PACKS_DIRNAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def _pack_path(slug: str) -> Path:
    return _packs_dir() / f"{slug}.json"


def _slugify(value: str) -> str:
    """Turn a human pack name into a slug suitable for a filename."""
    return re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")


def _skin_palettes(path: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Read a skin file's (light, dark) palettes, restricted to the editable keys.

    The same fallback `GET /skins/{name}` applies — dark/light fall back to the
    shared `colors` — then the map is narrowed to the ten skin keys so a bundle
    carries the writer's vocabulary, not an importer's fourteen tokens."""
    data = _read_skin_file(path)
    colors = data.get("colors") if isinstance(data.get("colors"), dict) else {}
    light = data.get("light_colors") if isinstance(data.get("light_colors"), dict) else colors
    dark = data.get("dark_colors") if isinstance(data.get("dark_colors"), dict) else colors
    keep = set(EDITABLE_SKIN_KEYS)
    return (
        {str(k): str(v) for k, v in light.items() if k in keep},
        {str(k): str(v) for k, v in dark.items() if k in keep},
    )


def _free_slug(base: str, skins_dir: Path) -> str:
    """The first free `<base>-N` name, for a preview's rename-to-suffix."""
    n = 2
    for _ in range(MAX_TOTAL_SKINS):
        candidate = f"{base}-{n}"
        if not (skins_dir / f"{candidate}.yaml").exists():
            return candidate
        n += 1
    raise RuntimeError(f"could not find a free slug for {base!r}")


def _pack_record(
    slug: str, name: str, author: str, members: list[str], *, created: str | None = None
) -> dict[str, Any]:
    return {
        "chroma_pack": PACK_FORMAT_VERSION,
        "slug": slug,
        "name": (name or "").strip() or slug,
        "author": (author or "").strip(),
        "created": created or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "members": [str(m) for m in members],
        "categories": [],  # v1 carried empty; E4 owns real categories
    }


@router.get("/packs")
def list_packs() -> dict[str, Any]:
    """Every pack record, with its member count and which members are missing.

    A pack whose skins were individually deleted says so rather than lying: the
    members it names are checked against the files that should carry them."""
    skins_dir = _skins_dir()
    packs: list[dict[str, Any]] = []
    for path in sorted(_packs_dir().glob("*.json")):
        slug = path.stem
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            # One malformed pack must not 500 the whole list — report and move on.
            logger.warning("chroma pack unreadable at %s: %s", path, exc)
            packs.append(
                {
                    "slug": slug,
                    "name": slug,
                    "author": "",
                    "created": "",
                    "count": 0,
                    "members": [],
                    "missing": [],
                    "unreadable": True,
                    "error": "pack record could not be read",
                }
            )
            continue
        if not isinstance(record, dict):
            packs.append(
                {
                    "slug": slug,
                    "name": slug,
                    "author": "",
                    "created": "",
                    "count": 0,
                    "members": [],
                    "missing": [],
                    "unreadable": True,
                    "error": "pack record is not a JSON object",
                }
            )
            continue
        members = record.get("members") if isinstance(record.get("members"), list) else []
        members = [str(m) for m in members]
        missing = [m for m in members if not (skins_dir / f"{m}.yaml").is_file()]
        packs.append(
            {
                "slug": record.get("slug") or slug,
                "name": record.get("name") or slug,
                "author": record.get("author") or "",
                "created": record.get("created") or "",
                "count": len(members),
                "members": members,
                "missing": missing,
            }
        )
    return {"ok": True, "count": len(packs), "packs": packs}


class PackExportRequest(BaseModel):
    name: str
    members: list[str] = []
    author: str = ""


@router.post("/packs/export")
def export_pack(req: PackExportRequest) -> dict[str, Any]:
    """Gather member skins' CURRENT palettes into one versioned bundle document.

    Also writes the pack record, so an exported pack appears in `GET /packs`.
    Returned as JSON rather than a raw download because the plugin's only channel
    to the pane is a JSON REST call (see `export_skins`); the pane turns the
    document into a file.

    A member whose file is missing is a 400 that NAMES it — a silently short pack
    would claim to carry a skin it does not."""
    name = (req.name or "").strip()
    slug = _slugify(name)
    if _is_unsafe_name(slug):
        raise HTTPException(400, "pack name must produce a slug (letters, digits, hyphens)")

    skins_dir = _skins_dir()
    index = _read_index()
    bundle_skins: list[dict[str, Any]] = []
    for member in req.members:
        clean = _guard_name(member, field="member name")
        path = skins_dir / f"{clean}.yaml"
        if not path.is_file():
            raise HTTPException(400, f"pack member '{clean}' has no skin file")
        _owned_record(clean, index)  # 404 when the skin is not one Chroma manages
        light, dark = _skin_palettes(path)
        bundle_skins.append(
            {
                "name": clean,
                "label": index.get(clean, {}).get("label") or clean,
                "light": light,
                "dark": dark,
            }
        )

    created = datetime.now(timezone.utc).isoformat(timespec="seconds")
    bundle = {
        "chroma_pack": PACK_FORMAT_VERSION,
        "name": name,
        "author": (req.author or "").strip(),
        "created": created,
        "categories": [],  # v1 export carries none; E4 owns category creation
        "skins": bundle_skins,
    }

    try:
        _atomic_write_text(
            _pack_path(slug),
            json.dumps(
                _pack_record(
                    slug, name, req.author, [s["name"] for s in bundle_skins], created=created
                ),
                indent=2,
                sort_keys=True,
            )
            + "\n",
        )
    except OSError as exc:
        raise HTTPException(500, f"could not write the pack record ({_pack_path(slug)}): {exc}") from exc

    logger.info("exported pack %s (%d skins)", slug, len(bundle_skins))
    return bundle


class PackImportRequest(BaseModel):
    """A pack bundle document plus the preview/confirm switch."""

    chroma_pack: int | None = None
    name: str = ""
    author: str = ""
    created: str = ""
    categories: list[Any] = []
    skins: list[Any] = []
    dryRun: bool = False


def _validate_bundle_skins(req: PackImportRequest) -> list[dict[str, Any]]:
    """Hostile validation of a bundle's skins. Raises, naming the offence.

    Every rule is a refusal: a wrong format version, a non-slug (or path) name, an
    unknown role, a non-#rrggbb colour. Nothing is dropped silently."""
    if req.chroma_pack != PACK_FORMAT_VERSION:
        raise HTTPException(
            400,
            f"unsupported pack format: expected chroma_pack {PACK_FORMAT_VERSION}, "
            f"got {req.chroma_pack!r}",
        )
    if not isinstance(req.skins, list):
        raise HTTPException(400, "a pack bundle must carry a 'skins' array")
    if len(req.skins) > MAX_PACK_SKINS:
        raise HTTPException(413, f"pack declares {len(req.skins)} skins (limit {MAX_PACK_SKINS})")

    parsed: list[dict[str, Any]] = []
    for entry in req.skins:
        if not isinstance(entry, dict):
            raise HTTPException(400, "every pack skin must be an object")
        raw_name = entry.get("name")
        if not isinstance(raw_name, str):
            raise HTTPException(400, "every pack skin needs a string 'name'")
        # A name is a slug, never a path fragment: `_editor_name` refuses '../x',
        # 'a/b', a reserved device name and a built-in.
        clean = _editor_name(raw_name, field="skin name", builtin_hint=False)
        light = _normalise_palette(entry.get("light") or {}, what=f"light palette of '{clean}'")
        dark = _normalise_palette(entry.get("dark") or {}, what=f"dark palette of '{clean}'")
        label = entry.get("label")
        label_text = label.strip() if isinstance(label, str) and label.strip() else clean
        # The label becomes the skin file's `description:` — and the writer
        # refuses a control character there. Refuse it HERE too, so the preview
        # (which writes nothing) is where the user learns the bundle is broken.
        _refuse_control_characters(label_text, "label")
        parsed.append(
            {
                "name": clean,
                "label": label_text,
                "light": light,
                "dark": dark,
            }
        )
    return parsed


def _validate_bundle_categories(req: PackImportRequest) -> None:
    """Hostile validation of a bundle's `categories` array. Raises, naming the offence.

    Every rule is a refusal — a malformed entry, an id that is not a usable slug, or
    an id colliding with a built-in. Nothing is dropped silently: a bundle that would
    shadow a measured shelf is a broken bundle, not one to import partially."""
    cats = req.categories
    if cats is None:
        return
    if not isinstance(cats, list):
        raise HTTPException(400, "'categories' must be an array")
    for entry in cats:
        if not isinstance(entry, dict):
            raise HTTPException(400, "every category must be an object")
        raw_id = entry.get("id")
        if not isinstance(raw_id, str) or not raw_id.strip():
            raise HTTPException(400, "every category needs a non-empty string 'id'")
        cid = _slugify(raw_id)
        if not cid or _is_unsafe_name(cid):
            raise HTTPException(
                400, f"category id '{raw_id}' is not a usable slug — use letters, digits and hyphens"
            )
        if cid in BUILTIN_CATEGORY_IDS:
            raise HTTPException(
                400, f"category id '{cid}' collides with a built-in category and cannot be imported"
            )


def _bundle_category_records(req: PackImportRequest) -> list[dict[str, str]]:
    """The bundle's categories, normalised to `{id, title}` pairs. Assumes the array
    already passed `_validate_bundle_categories`."""
    records: list[dict[str, str]] = []
    for entry in req.categories or []:
        if not isinstance(entry, dict):
            continue
        cid = _slugify(str(entry.get("id") or ""))
        if not cid:
            continue
        title = entry.get("title")
        title = title.strip() if isinstance(title, str) and title.strip() else cid
        records.append({"id": cid, "title": title})
    return records


def _import_bundle_categories(bundle_cats: list[dict[str, str]], changes: list[str]) -> None:
    """Create or retitle the bundle's categories, in ONE locked read-modify-write.

    Called INSIDE the pack-import transaction, before the skins are written, so a
    later failure unwinds these bytes with `_restore_categories`. Idempotent: an id
    already present with the same title is a no-op; a different title updates it. An
    id colliding with a built-in never reaches here — the validator refuses it. The
    file is not touched when the merged store is unchanged."""
    if not bundle_cats:
        return
    with _CATEGORIES_LOCK:
        try:
            categories = _read_categories_for_update()
        except IndexUnreadableError as exc:
            raise _category_error(exc) from exc
        known = _known_category_ids(categories)
        dirty = False
        for cat in bundle_cats:
            cid, ctitle = cat["id"], cat["title"]
            if cid in known:
                for record in categories:
                    if str(record.get("id")) == cid and (record.get("title") or cid) != ctitle:
                        record["title"] = ctitle
                        dirty = True
                        changes.append(cid)
                continue
            order = len(BUILTIN_CATEGORY_IDS) + len(categories)
            categories.append({"id": cid, "title": ctitle, "order": order})
            known.add(cid)
            dirty = True
            changes.append(cid)
        if dirty:
            _write_categories_or_500(categories)


def _restore_categories(original_text: str | None) -> None:
    """Best-effort restore of the categories store to its prior bytes (or absence)."""
    try:
        if original_text is None:
            _unlink_quietly(_categories_path())
        else:
            _atomic_write_text(_categories_path(), original_text)
    except OSError as exc:
        logger.warning("chroma restore categories failed: %s", exc)


def _restore_index(original_text: str | None) -> None:
    """Best-effort restore of the index to its prior bytes (or absence)."""
    try:
        if original_text is None:
            _unlink_quietly(_index_path())
        else:
            _atomic_write_text(_index_path(), original_text)
    except OSError as exc:
        logger.warning("chroma restore index failed: %s", exc)


@router.post("/packs/import")
def import_pack(req: PackImportRequest) -> dict[str, Any]:
    """Preview a bundle, then import it as ONE transaction against the index.

    `dryRun` writes nothing and returns, per skin, `new` / `identical` / `collides`
    with the resolved target name. On confirm, the whole import is one
    transaction: every file and the index; a failure part-way rolls back what it
    wrote, because a half-imported pack is the failure this rule exists to stop.
    The lock is held for the whole transaction, not per file."""
    oversized = _theme_too_large({"skins": req.skins, "categories": req.categories})
    if oversized:
        raise HTTPException(413, f"pack is too large: {oversized}")

    parsed = _validate_bundle_skins(req)
    _validate_bundle_categories(req)
    bundle_cats = _bundle_category_records(req)

    name = (req.name or "").strip()
    slug = _slugify(name)
    pack_slug = slug if slug and not _is_unsafe_name(slug) else ""
    skins_dir = _skins_dir()

    if req.dryRun:
        entries: list[dict[str, Any]] = []
        for skin in parsed:
            target = skins_dir / f"{skin['name']}.yaml"
            if not target.is_file():
                status, resolved = "new", skin["name"]
            else:
                existing_light, existing_dark = _skin_palettes(target)
                if existing_light == skin["light"] and existing_dark == skin["dark"]:
                    status, resolved = "identical", skin["name"]
                else:
                    status, resolved = "collides", _free_slug(skin["name"], skins_dir)
            entries.append({"name": skin["name"], "status": status, "resolved": resolved})
        known_cats = set(BUILTIN_CATEGORY_IDS) | _known_category_ids(_read_categories())
        cat_plan = [
            {
                "id": cat["id"],
                "title": cat["title"],
                "status": "existing" if cat["id"] in known_cats else "new",
            }
            for cat in bundle_cats
        ]
        return {
            "ok": True,
            "dryRun": True,
            "pack": pack_slug,
            "skins": entries,
            "categories": cat_plan,
        }

    # ---- confirm: one transaction against the index -----------------------
    with _INDEX_LOCK:
        try:
            index = _read_index_for_update()
        except IndexUnreadableError as exc:
            raise _index_error(exc) from exc

        index_path = _index_path()
        original_index = index_path.read_text(encoding="utf-8") if index_path.is_file() else None

        created: list[Path] = []
        imported: list[str] = []
        skipped: list[str] = []
        cats_path = _categories_path()
        original_categories = cats_path.read_text(encoding="utf-8") if cats_path.is_file() else None
        category_changes: list[str] = []
        try:
            # Categories are created first so the skins' records reference an id that
            # already exists. A failure below unwinds this too, in the same rollback.
            _import_bundle_categories(bundle_cats, category_changes)
            for skin in parsed:
                target = skins_dir / f"{skin['name']}.yaml"
                if target.exists():
                    existing_light, existing_dark = _skin_palettes(target)
                    if existing_light == skin["light"] and existing_dark == skin["dark"]:
                        skipped.append(skin["name"])  # byte-identical: skip, do not rewrite
                        continue
                    # A different skin already holds this name. Refuse rather than
                    # overwrite: the preview resolved it to a new name, and the
                    # pane must import the renamed bundle.
                    raise HTTPException(
                        409,
                        f"'{skin['name']}' already exists with a different palette; the "
                        f"preview resolves this to a new name — import the renamed bundle",
                    )

                data: dict[str, Any] = {"name": skin["name"], "description": skin["label"]}
                if skin["light"]:
                    data["colors"] = skin["light"]
                    data["light_colors"] = skin["light"]
                if skin["dark"]:
                    data["dark_colors"] = skin["dark"]
                _atomic_write_text(target, _dump_skin_yaml(data))
                created.append(target)
                index[skin["name"]] = _new_owned_record(
                    index,
                    label=skin["label"],
                    pack=pack_slug or None,
                    ts=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                )
                imported.append(skin["name"])

            if imported:
                _write_index(index)

            if pack_slug and imported:
                prior: list[str] = []
                record_path = _pack_path(pack_slug)
                if record_path.is_file():
                    try:
                        existing = json.loads(record_path.read_text(encoding="utf-8"))
                        if isinstance(existing, dict) and isinstance(existing.get("members"), list):
                            prior = [str(m) for m in existing["members"]]
                    except (OSError, ValueError):
                        prior = []
                merged = list(dict.fromkeys(prior + imported))
                existing_created = None
                if record_path.is_file():
                    try:
                        parsed_record = json.loads(record_path.read_text(encoding="utf-8"))
                        if isinstance(parsed_record, dict):
                            existing_created = parsed_record.get("created")
                    except (OSError, ValueError):
                        existing_created = None
                _atomic_write_text(
                    record_path,
                    json.dumps(
                        _pack_record(pack_slug, name, req.author, merged, created=existing_created),
                        indent=2,
                        sort_keys=True,
                    )
                    + "\n",
                )
        except HTTPException:
            for path in created:
                _unlink_quietly(path)
            _restore_index(original_index)
            _restore_categories(original_categories)
            raise
        except OSError as exc:
            for path in created:
                _unlink_quietly(path)
            _restore_index(original_index)
            _restore_categories(original_categories)
            raise HTTPException(
                500,
                f"the pack import failed part-way ({exc}); everything it wrote was rolled back",
            ) from exc

    logger.info(
        "imported pack %s: %d new, %d skipped", pack_slug or name, len(imported), len(skipped)
    )
    return {
        "ok": True,
        "dryRun": False,
        "pack": pack_slug,
        "imported": imported,
        "skipped": skipped,
        "categories": category_changes,
    }


def _restore_trashed_members(trashed_members: list[tuple[Path, Path]]) -> list[str]:
    """Put trashed pack members back where they were. Returns the names that
    could not be restored — those are still in the trash, so they are
    recoverable by hand."""
    unrestored: list[str] = []
    for target, trashed in trashed_members:
        try:
            os.replace(trashed, target)
        except OSError as exc:
            logger.warning("chroma restore trashed member failed at %s: %s", target, exc)
            unrestored.append(target.stem)
    return unrestored


@router.delete("/packs/{slug}")
def delete_pack(slug: str, withSkins: bool = False) -> dict[str, Any]:
    """Drop a pack record.

    Default removes the RECORD ONLY — members are untouched. `withSkins=true` also
    deletes the member skins through the trash path (never an unlink), so a
    mistaken click is recoverable."""
    clean = (slug or "").strip().lower()
    if _is_unsafe_name(clean):
        raise HTTPException(400, "pack slug must be a slug (lower-case, hyphens)")

    path = _pack_path(clean)
    if not path.is_file():
        raise HTTPException(404, f"'{clean}' is not a pack Chroma manages")

    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise HTTPException(500, f"the pack record at {path} is unreadable ({exc})") from exc
    members = record.get("members") if isinstance(record, dict) else []
    if not isinstance(members, list):
        members = []

    removed: list[str] = []
    if withSkins:
        with _INDEX_LOCK:
            try:
                index = _read_index_for_update()
            except IndexUnreadableError as exc:
                raise _index_error(exc) from exc
            # (original path, trash path) for every member moved, so a failed
            # index write can put them back where they were.
            trashed_members: list[tuple[Path, Path]] = []
            for member in members:
                member_name = str(member)
                if _is_unsafe_name(member_name):
                    continue
                # ONLY skins Chroma owns. `delete_skin` refuses anything without
                # a provenance record ("both operations act only on skins Chroma
                # owns"), but this path used to take the pack record's member
                # list on trust and moved ANY matching skin to the trash — a
                # skin the user wrote by hand included.
                if not isinstance(index.get(member_name), dict):
                    continue
                target = _skins_dir() / f"{member_name}.yaml"
                if not target.is_file():
                    index.pop(member_name, None)  # a vanished member: drop the stale record
                    continue
                stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
                trashed = _trash_dir() / f"{member_name}-{stamp}.yaml"
                try:
                    os.replace(target, trashed)
                except OSError as exc:
                    raise HTTPException(
                        500,
                        f"could not move the pack member '{member_name}' to the trash "
                        f"({trashed}): {exc}",
                    ) from exc
                trashed_members.append((target, trashed))
                index.pop(member_name, None)
                removed.append(member_name)
            try:
                _write_index(index)
            except OSError as exc:
                # The members are already in the trash but the index still names
                # them, so the skins would be gone from the CLI while the error
                # blamed the index alone. Put them back: a failed index write
                # must not take the user's skins away.
                unrestored = _restore_trashed_members(trashed_members)
                note = (
                    ""
                    if not unrestored
                    else f"; {len(unrestored)} member(s) could not be put back and are "
                    f"in the trash: {', '.join(unrestored)}"
                )
                raise HTTPException(
                    500,
                    f"could not update the skin provenance index ({_index_path()}): {exc}. "
                    f"Fix free space or permissions and retry{note}.",
                ) from exc

    try:
        path.unlink()
    except OSError as exc:
        raise HTTPException(500, f"could not remove the pack record {path}: {exc}") from exc

    logger.info("deleted pack %s (withSkins=%s, removed %d)", clean, withSkins, len(removed))
    return {"ok": True, "slug": clean, "removedSkins": removed}

@router.post("/trash/purge")
def purge_trash(retention_days: int = TRASH_RETENTION_DAYS) -> dict[str, Any]:
    trash = _trash_dir()
    cutoff = datetime.now(timezone.utc).timestamp() - retention_days * 86400
    removed = 0
    for path in trash.iterdir():
        if not path.is_file():
            continue
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except OSError as exc:
            logger.warning("chroma trash purge failed at %s: %s", path, exc)
    return {"ok": True, "removed": removed}
