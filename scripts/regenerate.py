#!/usr/bin/env python3
"""Regenerate the Theme Picker plugin after installing new skins.

Drop new skin YAML files into the Hermes skins folder, then run this script.
It rebuilds plugin.js with the full, current skin catalog embedded, so every
installed skin appears in the picker as a browseable card.

Usage:
    python3 regenerate.py [skins_dir] [out_plugin_js]

Defaults:
    skins_dir   = <hermes home>/skins  (HERMES_HOME, else ~/.hermes)
    out_plugin  = <hermes home>/desktop/plugin.js

Then copy the output plugin.js to the machine running the desktop app
(Windows: %LOCALAPPDATA%\\hermes\\desktop-plugins\\theme-picker\\plugin.js)
and run "Reload desktop plugins" from the Command Palette (Ctrl+K).
"""

from __future__ import annotations

from collections.abc import Mapping
import json
import math
import os
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - hermes ships pyyaml
    yaml = None

CATEGORY_PREFIXES = [
    ("dark-", "Dark"),
    ("light-", "Light"),
    ("vibrant-", "Vibrant"),
    ("nature-", "Nature"),
    ("minimal-", "Minimal"),
    ("retro-", "Retro"),
]

# Color keys the desktop converter + preview actually use.
KEEP_KEYS = {
    "background", "status_bar_bg", "ui_text", "banner_text", "status_bar_text",
    "ui_accent", "banner_accent", "banner_title", "ui_border", "banner_border",
    "banner_dim", "session_border", "ui_error", "ui_ok", "ui_warn", "ui_tool",
    "completion_menu_bg", "prompt", "shell_dollar",
    # The two roles that carry the interface rather than decorate it. Without
    # them a pastel skin's pale accent would be the rule under the input, at
    # 1.4:1 on its own background: invisible. The skins design a readable rule
    # and keep the pastel for the signature.
    "input_rule", "response_border",
}

# Canonical light/dark matches from CliffWade/hermes-desktop-theme-pack v1.1.0.
# Each pair becomes one Desktop theme whose light/dark toggle swaps real palettes.
THEME_PAIRS = [
    ("dark-aubergine", "light-lavender"),
    ("dark-ayu", "light-ayu"),
    ("dark-bone", "minimal-bone"),
    ("dark-catppuccin", "light-catppuccin"),
    ("dark-charcoal", "light-cloud"),
    ("dark-cozy-paper", "light-cozy-paper"),
    ("dark-crimson", "light-rose"),
    ("dark-dracula", "light-dracula"),
    ("dark-everforest", "light-everforest"),
    ("dark-github", "light-github"),
    ("dark-gruvbox", "light-gruvbox"),
    ("dark-kanagawa", "light-kanagawa"),
    ("dark-lcars", "light-lcars"),
    ("dark-lemon", "light-lemon"),
    ("dark-mac", "retro-mac"),
    ("dark-material", "light-material"),
    ("dark-navy", "light-sky"),
    ("dark-nord", "light-nord"),
    ("dark-obsidian", "light-porcelain"),
    ("dark-one", "light-one"),
    ("dark-plum", "light-grape"),
    ("dark-rosepine", "light-rosepine"),
    ("dark-sage", "light-sage"),
    ("dark-solarized", "light-solarized"),
    ("dark-tokyo-night", "light-tokyo-day"),
    ("dark-vanilla", "light-vanilla"),
    ("dark-vscode", "light-vscode"),
    ("minimal-graphite", "minimal-pearl"),
    ("nature-autumn", "light-melon"),
    ("nature-desert", "light-sand"),
    ("nature-forest", "light-fern"),
    ("nature-nordic", "light-frost"),
    ("nature-ocean", "light-tide"),
    ("newsprint-noir", "light-paper"),
    ("peach-fuzz", "light-peach"),
    ("redwood", "light-cream"),
    ("retro-amber", "light-honey"),
    ("retro-blue", "light-denim"),
    ("retro-terminal", "light-mint"),
    ("shadow-thief", "light-lilac"),
    ("slate-mist", "light-mist"),
    ("stained-glass", "light-stained-glass"),
    ("steel-thread", "light-ash"),
    ("vaporwave-mall", "light-aqua"),
    ("vibrant-neon", "light-neon"),
    ("vibrant-pacific", "light-pacific"),
    ("vibrant-sunset", "light-blush"),
    ("vibrant-synthwave", "light-synthwave"),
    ("void-sunset", "light-sunset"),
    ("warm-ash", "light-oat"),
    # Pastel set one, authored in scripts/make-pastel-skins.py.
    ("dark-pastel-cotton-candy", "light-pastel-cotton-candy"),
    ("dark-pastel-mint-sorbet", "light-pastel-mint-sorbet"),
    ("dark-pastel-buttercup", "light-pastel-buttercup"),
    ("dark-pastel-powder-blue", "light-pastel-powder-blue"),
    ("dark-pastel-peach-blossom", "light-pastel-peach-blossom"),
]

HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$")


def resolve_hermes_home(
    environ: Mapping[str, str] | None = None,
    home: Path | None = None,
    platform_name: str | None = None,
) -> Path:
    """Return Hermes home using the desktop app's Windows location when needed."""
    env = os.environ if environ is None else environ
    configured = env.get("HERMES_HOME")
    if configured:
        return Path(configured)

    if (platform_name or sys.platform).startswith("win") and (local_app_data := env.get("LOCALAPPDATA")):
        return Path(local_app_data) / "hermes"

    return (home or Path.home()) / ".hermes"


def _luminance(hex_color: str) -> float | None:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return None
    try:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except ValueError:
        return None
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255


def _parse_skin_file(path: Path) -> dict | None:
    # Deliberately broad, and deliberately silent: this runs over EVERY bundled
    # skin, and one unreadable or malformed file must not abort the build. The
    # caller reports the surviving count, so a file skipped here shows up as a
    # smaller catalog rather than as a crash.
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) if yaml else None
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    name = str(data.get("name", "")).strip() or path.stem
    colors = data.get("colors") or {}
    category = "Other"
    for prefix, label in CATEGORY_PREFIXES:
        if name.startswith(prefix):
            category = label
            break
    bg = colors.get("background") or colors.get("status_bar_bg") or ""
    text = colors.get("banner_text") or colors.get("ui_text") or ""
    lum = _luminance(bg) if bg else (_luminance(text) if text else None)
    return {
        "name": name,
        "description": str(data.get("description", "")),
        "category": category,
        "isDark": lum is None or lum < 0.5,
        "source": "user",
        "colors": {
            k: v for k, v in colors.items()
            if isinstance(v, str) and HEX_RE.match(v) and k in KEEP_KEYS
        },
    }


def _preview(background: str, text: str, accent: str, border: str, tool: str | None = None) -> dict:
    """Build the compact skin-shaped palette consumed by the picker preview."""
    return {
        "background": background,
        "ui_text": text,
        "banner_text": text,
        "ui_accent": accent,
        "banner_accent": accent,
        "ui_tool": tool or accent,
        "ui_border": border,
        "banner_border": border,
    }


def _dynamic_scene(
    name: str,
    label: str,
    description: str,
    light: dict,
    dark: dict,
    *,
    light_name: str | None = None,
    dark_name: str | None = None,
    source: str = "builtin-desktop",
) -> dict:
    return {
        "name": name,
        "label": label,
        "description": description,
        "category": "Built-in" if source == "builtin-desktop" else "Dynamic",
        "modeSupport": "dynamic",
        "source": source,
        "colors": light,
        "lightColors": light,
        "darkColors": dark,
        "lightName": light_name or name,
        "darkName": dark_name or name,
        # Dynamic variants always travel under dedicated aliases. Backend skins
        # are single-mode Desktop themes; a unique alias prevents a loaded
        # combined user theme of the same name from winning resolution and
        # briefly painting its opposite palette through stale React mode state.
        "gatewayLightName": f"theme-picker-{name}-light",
        "gatewayDarkName": f"theme-picker-{name}-dark",
    }


def _desktop_builtin_scenes() -> list[dict]:
    """The canonical Desktop scenes, with swatches matching Hermes presets."""
    scenes = [
        _dynamic_scene(
            "nous", "Nous", "Glass neutrals with Nous blue accents",
            _preview("#F8FAFF", "#17171A", "#0053FD", "#C7D7FA"),
            _preview("#0D2F86", "#FFE6CB", "#FFE6CB", "#3158AD", "#0053FD"),
            dark_name="default",
        ),
        _dynamic_scene(
            "midnight", "Midnight", "Deep blue-violet with cool accents",
            _preview("#FFFFFF", "#161616", "#8B80E8", "#DEDDF5"),
            _preview("#08081C", "#DDD6FF", "#8B80E8", "#1E1E52"),
        ),
        _dynamic_scene(
            "ember", "Ember", "Warm crimson and bronze — forge vibes",
            _preview("#FFFFFF", "#161616", "#D97316", "#F1D9C4"),
            _preview("#160800", "#FFD8B0", "#D97316", "#3A1C08"),
        ),
        _dynamic_scene(
            "mono", "Mono", "Clean grayscale — minimal and focused",
            _preview("#FFFFFF", "#161616", "#707070", "#DEDEDE"),
            _preview("#0E0E0E", "#EAEAEA", "#9A9A9A", "#2A2A2A"),
        ),
        _dynamic_scene(
            "cyberpunk", "Cyberpunk", "Neon green on black — matrix terminal",
            _preview("#FFFFFF", "#161616", "#008F28", "#C9E8D2"),
            _preview("#000A00", "#00FF41", "#00FF41", "#003000"),
        ),
        _dynamic_scene(
            "rose", "Rose", "Soft pink and warm ivory — easy on the eyes",
            _preview("#FFF8FB", "#24171D", "#B64F78", "#E8CAD6"),
            _preview("#1A0F15", "#FFD4E1", "#F9A8D4", "#54283B"),
        ),
        _dynamic_scene(
            "shadow-thief", "Shadow Thief", "Rogue's night — matte black, muted plum, and silver-steel with a glint of cyan",
            _preview("#F7F1FA", "#3A2645", "#8B5CA8", "#D8C8E0", "#7A4F94"),
            _preview("#101014", "#B0B0C0", "#50A8A8", "#4A4060"),
            light_name="light-lilac",
            dark_name="shadow-thief",
        ),
        _dynamic_scene(
            "hermes-teal", "Hermes Teal", "Classic teal — the canonical Hermes dashboard look",
            _preview("#F4FCFC", "#132B2B", "#087F7A", "#B9DBD8"),
            _preview("#041C1C", "#FFE6CB", "#33C4BA", "#205654"),
        ),
    ]
    return scenes


def _mode_support(name: str, is_dark: bool) -> str:
    if name in {"daylight", "warm-lightmode"}:
        return "light"
    return "dark" if is_dark else "light"


# --- Mode port: one palette, both modes ----------------------------------------
#
# Every scene ships a light and a dark palette. When the vendored pack carries
# only one mode, the other is PORTED: keep the hue, move the lightness. Oklab is
# the space for that operation - HSL's lightness slides across hues, and RGB
# arithmetic cannot express "same colour, different lightness" at all.
#
# The port is measured, not eyeballed. Every derived role is nudged until it
# clears a contrast target against its own shell: body text 9:1, interface
# colours 3:1, status signals 4.5:1. A derived theme nobody can read is not a
# theme, it is a rectangle.

TEXT_CONTRAST = 9.0
INTERFACE_CONTRAST = 3.0
SIGNAL_CONTRAST = 4.5

# (source role, lightness in light mode, lightness in dark mode, min chroma,
#  max chroma, contrast target against the shell)
_PORT_ROLES = [
    ("ui_accent", 0.50, 0.72, 0.06, 0.16, INTERFACE_CONTRAST),
    ("ui_tool", 0.44, 0.76, 0.05, 0.16, INTERFACE_CONTRAST),
    ("ui_ok", 0.48, 0.72, 0.06, 0.18, SIGNAL_CONTRAST),
    ("ui_warn", 0.52, 0.76, 0.06, 0.18, SIGNAL_CONTRAST),
    ("ui_error", 0.48, 0.70, 0.06, 0.20, SIGNAL_CONTRAST),
]

# shell lightness, shell chroma, surface, surface chroma, menu, menu chroma,
# text, dim, border - per target mode.
_PORT_SHELL = {
    "light": (0.975, 0.006, 0.945, 0.012, 0.915, 0.014, 0.26, 0.50, 0.86),
    "dark": (0.170, 0.014, 0.225, 0.020, 0.255, 0.022, 0.94, 0.70, 0.33),
}


def _hex_channels(value: str):
    h = str(value or "").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return None
    try:
        return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return None


def _rgb_to_hex(rgb) -> str:
    return "#" + "".join(f"{max(0, min(255, round(c * 255))):02X}" for c in rgb)


def _linearise(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _delinearise(c: float) -> float:
    return c * 12.92 if c <= 0.0031308 else 1.055 * (max(c, 0.0) ** (1 / 2.4)) - 0.055


def _rgb_to_oklab(rgb):
    r, g, b = (_linearise(c) for c in rgb)
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def _oklab_to_rgb(lab):
    L, a, b = lab
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (_delinearise(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
            _delinearise(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
            _delinearise(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s))


def _oklch(value: str):
    """(lightness, chroma, hue) of a hex colour, or None when unparseable."""
    rgb = _hex_channels(value)
    if rgb is None:
        return None
    L, a, b = _rgb_to_oklab(rgb)
    return L, math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360


def _oklch_hex(lightness: float, chroma: float, hue: float) -> str:
    """OKLCH -> hex, shedding chroma until the colour fits inside sRGB."""
    rad = math.radians(hue)
    for _ in range(48):
        rgb = _oklab_to_rgb((lightness, chroma * math.cos(rad), chroma * math.sin(rad)))
        if all(-0.0005 <= c <= 1.0005 for c in rgb):
            return _rgb_to_hex(rgb)
        chroma *= 0.94
    return _rgb_to_hex(_oklab_to_rgb((lightness, 0.0, 0.0)))


def _wcag_luminance(value: str) -> float:
    rgb = _hex_channels(value) or (0.0, 0.0, 0.0)
    r, g, b = (_linearise(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a: str, b: str) -> float:
    la, lb = _wcag_luminance(a), _wcag_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def _nudge_contrast(value: str, background: str, target: float, lighten: bool) -> str:
    """Walk a colour's lightness until it clears `target` against `background`."""
    if _contrast(value, background) >= target:
        return value
    found = _oklch(value)
    if found is None:
        return value
    L, C, h = found
    step = 0.008 if lighten else -0.008
    best = value
    for _ in range(140):
        L += step
        if L <= 0.0 or L >= 1.0:
            break
        best = _oklch_hex(L, C, h)
        if _contrast(best, background) >= target:
            return best
    return best


def _port_palette(colors: dict, target: str) -> dict:
    """Port a single-mode palette into `target` mode, keeping every hue."""
    light = target == "light"
    bg_src = colors.get("background") or colors.get("status_bar_bg") or "#101014"
    text_src = (colors.get("ui_text") or colors.get("banner_text")
                or colors.get("status_bar_text") or "#EDEDED")
    bg_hue = (_oklch(bg_src) or (0.0, 0.0, 260.0))[2]
    text_hue = (_oklch(text_src) or (0.0, 0.0, bg_hue))[2]
    (bg_L, bg_C, surface_L, surface_C, menu_L, menu_C,
     text_L, dim_L, border_L) = _PORT_SHELL[target]

    background = _oklch_hex(bg_L, bg_C, bg_hue)
    surface = _oklch_hex(surface_L, surface_C, bg_hue)
    menu = _oklch_hex(menu_L, menu_C, bg_hue)
    text = _nudge_contrast(_oklch_hex(text_L, 0.012, text_hue), background, TEXT_CONTRAST, not light)
    dim = _nudge_contrast(_oklch_hex(dim_L, 0.012, text_hue), background, SIGNAL_CONTRAST, not light)
    border = _oklch_hex(border_L, 0.014, bg_hue)

    ports = {}
    for key, L_light, L_dark, c_min, c_max, ratio in _PORT_ROLES:
        found = _oklch(colors.get(key)) if colors.get(key) else None
        if found is None:
            continue
        _, C, h = found
        L = L_light if light else L_dark
        ports[key] = _nudge_contrast(_oklch_hex(L, max(c_min, min(c_max, C)), h),
                                     background, ratio, not light)

    accent = ports.get("ui_accent") or _nudge_contrast(
        _oklch_hex(0.50 if light else 0.72, 0.10, bg_hue), background, INTERFACE_CONTRAST, not light)
    tool = ports.get("ui_tool") or accent
    ok = ports.get("ui_ok") or _oklch_hex(0.48 if light else 0.72, 0.10, 145.0)
    warn = ports.get("ui_warn") or _oklch_hex(0.55 if light else 0.78, 0.12, 75.0)
    error = ports.get("ui_error") or _oklch_hex(0.50 if light else 0.70, 0.16, 25.0)

    return {
        "background": background,
        "status_bar_bg": surface,
        "completion_menu_bg": menu,
        "completion_menu_current_bg": _oklch_hex(menu_L - 0.02 if light else menu_L + 0.03, menu_C + 0.006, bg_hue),
        "completion_menu_meta_bg": menu,
        "ui_text": text,
        "banner_text": text,
        "status_bar_text": text,
        "banner_title": text,
        "prompt": text,
        "banner_dim": dim,
        "ui_accent": accent,
        "banner_accent": accent,
        "input_rule": accent,
        "response_border": accent,
        "ui_border": border,
        "banner_border": border,
        "session_border": border,
        "ui_tool": tool,
        "session_label": tool,
        "shell_dollar": tool,
        "ui_ok": ok,
        "status_bar_good": ok,
        "ui_warn": warn,
        "status_bar_warn": warn,
        "ui_error": error,
        "status_bar_critical": error,
    }


def _make_dynamic(scene: dict) -> dict:
    """Give a single-mode scene the palette it is missing.

    A real counterpart file always wins: this only fills a gap, and it marks what
    it filled, so a derived palette is never mistaken for an authored one.
    """
    mode = scene.get("modeSupport")
    if mode not in {"dark", "light"}:
        return scene
    other = "dark" if mode == "light" else "light"
    source = scene.get(f"{mode}Colors") or scene.get("colors") or {}
    if not source:
        return scene
    scene[f"{other}Colors"] = _port_palette(source, other)
    scene[f"derived{other.title()}"] = True
    scene["modeSupport"] = "dynamic"
    scene["colors"] = scene.get("lightColors") or scene.get("darkColors") or source
    scene["gatewayLightName"] = f"theme-picker-{scene['name']}-light"
    scene["gatewayDarkName"] = f"theme-picker-{scene['name']}-dark"
    return scene


def _single_scene(skin: dict) -> dict:
    mode = _mode_support(skin["name"], skin.get("isDark", True))
    colors = skin.get("colors", {})
    return {
        **skin,
        "label": skin.get("label") or skin["name"].replace("-", " ").title(),
        "modeSupport": mode,
        "lightColors": colors if mode == "light" else None,
        "darkColors": colors if mode == "dark" else None,
        "lightName": skin["name"] if mode == "light" else None,
        "darkName": skin["name"] if mode == "dark" else None,
    }


def _load_v2_skins(skins_dir: Path) -> list[dict]:
    """Read dual-mode skin files: one file, one skin, both palettes authored.

    A ported half was written once at migration and is emitted whole; an
    authored half is compacted to KEEP_KEYS exactly as before. Compacting both
    would break every ported skin, so the file records which half was ported.
    """
    skins: list[dict] = []
    seen: dict[str, str] = {}
    for path in sorted(skins_dir.glob("*.yaml")):
        if not path.is_file() or path.is_symlink():
            continue
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as exc:
            raise ValueError(f"{path.name}: not valid YAML ({exc})") from exc
        if not isinstance(data, dict):
            raise ValueError(f"{path.name}: a skin file must be a mapping")
        if data.get("schema_version") != 2:
            raise ValueError(
                f"{path.name}: schema_version is {data.get('schema_version')!r}, expected 2"
            )
        light = data.get("light_colors") or {}
        dark = data.get("dark_colors") or {}
        if not light or not dark:
            raise ValueError(f"{path.name}: both light_colors and dark_colors are required")
        if not data.get("name"):
            raise ValueError(f"{path.name}: no name")
        derived = set((data.get("provenance") or {}).get("derived") or [])
        light_out = light if "light" in derived else {
            k: v for k, v in light.items() if k in KEEP_KEYS
        }
        dark_out = dark if "dark" in derived else {
            k: v for k, v in dark.items() if k in KEEP_KEYS
        }

        name = data["name"]
        if name in seen:
            raise ValueError(f"{path.name}: duplicate skin id {name!r}, already in {seen[name]}")
        seen[name] = path.name
        entry = {
            "name": name,
            "label": data.get("label") or name.replace("-", " ").title(),
            "description": data.get("description", ""),
            "category": data.get("category", ""),
            "pack": data.get("pack", "core"),
            "energy": data.get("energy", ""),
            "typography": data.get("typography") or {},
            "source": "user",
            "modeSupport": "dynamic",
            "colors": light_out,
            "lightColors": light_out,
            "darkColors": dark_out,
            "lightName": (data.get("provenance") or {}).get("light_file"),
            "darkName": (data.get("provenance") or {}).get("dark_file"),
            "gatewayLightName": f"theme-picker-{name}-light",
            "gatewayDarkName": f"theme-picker-{name}-dark",
        }
        if "light" in derived:
            entry["derivedLight"] = True
        if "dark" in derived:
            entry["derivedDark"] = True
        skins.append(entry)
    return skins


def _build_catalog(
    user_skins: list[dict],
    backend_builtins: list[dict],
    *,
    pairs: list[tuple[str, str]] | None = None,
    desktop_builtins: list[dict] | None = None,
) -> list[dict]:
    """Collapse matched palettes into scenes, then retain every unpaired skin."""
    pair_list = THEME_PAIRS if pairs is None else pairs
    desktop = _desktop_builtin_scenes() if desktop_builtins is None else desktop_builtins
    by_name = {skin["name"]: skin for skin in user_skins}
    consumed = set()
    scenes = []
    for builtin in desktop:
        scene = dict(builtin)
        light = by_name.get(scene.get("lightName"))
        dark = by_name.get(scene.get("darkName"))
        # Shadow Thief is both a canonical Desktop scene and part of the
        # vendored pack. Preserve the complete source palettes so migration can
        # recognize the exact legacy single-palette cache without broad rules.
        if light:
            scene["colors"] = light.get("colors", {})
            scene["lightColors"] = light.get("colors", {})
        if dark:
            scene["darkColors"] = dark.get("colors", {})
        scenes.append(scene)

    reserved = {scene["name"] for scene in desktop}
    for scene in desktop:
        reserved.update(name for name in (scene.get("lightName"), scene.get("darkName")) if name)

    for dark_name, light_name in pair_list:
        if dark_name in reserved or light_name in reserved:
            consumed.update({dark_name, light_name})
            continue
        dark = by_name.get(dark_name)
        light = by_name.get(light_name)
        if not dark or not light:
            continue
        consumed.update({dark_name, light_name})
        scenes.append(_dynamic_scene(
            dark_name,
            dark_name.removeprefix("dark-").replace("-", " ").title(),
            dark.get("description", "") or light.get("description", ""),
            light.get("colors", {}),
            dark.get("colors", {}),
            light_name=light_name,
            dark_name=dark_name,
            source="user",
        ))

    for skin in user_skins:
        if skin["name"] not in consumed and skin["name"] not in reserved:
            scenes.append(_single_scene(skin))

    desktop_names = {scene["name"] for scene in desktop}
    for skin in backend_builtins:
        # Backend `default` is the retired gold skin; Desktop's default is Nous.
        if skin["name"] != "default" and skin["name"] not in desktop_names:
            scenes.append(_single_scene(skin))

    # Every scene ships both modes. A single-mode scene gets its missing palette
    # ported, so no dead "dark only" shelf survives in the gallery and the mode
    # toggle works on every card.
    return [_make_dynamic(scene) for scene in scenes]


def _write_derivation_report(catalog: list[dict], path: Path) -> int:
    """Record every derived palette, so a port is never invisible."""
    rows = []
    for scene in catalog:
        for mode in ("light", "dark"):
            if not scene.get(f"derived{mode.title()}"):
                continue
            colors = scene.get(f"{mode}Colors") or {}
            bg = colors.get("background", "#FFFFFF")
            text = colors.get("ui_text", "#000000")
            accent = colors.get("ui_accent", "#000000")
            rows.append((scene.get("label") or scene["name"], mode, bg, text, accent,
                         _contrast(text, bg), _contrast(accent, bg)))
    lines = [
        "# Derived palettes",
        "",
        "Generated by `scripts/regenerate.py`. Do not edit by hand.",
        "",
        "A scene whose skin file carries only one mode gets the other ported: the",
        "hues are kept, the lightness moves in Oklab, and each role is nudged until",
        "it clears a contrast target against its own shell. A real counterpart file",
        "always wins over a port, so adding one retires the row below.",
        "",
        f"Derived palettes: {len(rows)}.",
        "",
        "| scene | derived | shell | text | accent | text/shell | accent/shell |",
        "|---|---|---|---|---|---|---|",
    ]
    for label, mode, bg, text, accent, text_ratio, accent_ratio in rows:
        lines.append(
            f"| {label} | {mode} | `{bg}` | `{text}` | `{accent}` | "
            f"{text_ratio:.1f}:1 | {accent_ratio:.1f}:1 |"
        )
    lines.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return len(rows)


def _backend_builtins() -> list[dict]:
    """Load the pinned backend built-ins used by deterministic generation."""
    source = Path(__file__).resolve().with_name("backend-builtins.json")
    try:
        builtins = json.loads(source.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"could not load pinned backend built-ins from {source}: {exc}") from exc
    expected = ["default", "ares", "mono", "slate", "daylight", "warm-lightmode", "poseidon", "sisyphus", "charizard"]
    if not isinstance(builtins, list) or [skin.get("name") for skin in builtins] != expected:
        raise RuntimeError(f"pinned backend built-ins in {source} do not match the expected catalog")
    return builtins


def _write_gateway_transport_skins(catalog: list[dict], destination: Path) -> int:
    """Generate one mode-locked gateway skin for every dynamic variant."""
    assert yaml is not None
    destination.mkdir(parents=True, exist_ok=True)
    expected = set()
    for scene in catalog:
        if scene.get("modeSupport") != "dynamic":
            continue
        for mode in ("light", "dark"):
            name = scene[f"gateway{mode.title()}Name"]
            expected.add(f"{name}.yaml")
            payload = {
                "name": name,
                "description": f"Theme Picker transport for {scene.get('label', scene['name'])} ({mode})",
                "colors": scene[f"{mode}Colors"],
            }
            text = yaml.safe_dump(payload, sort_keys=False, allow_unicode=True)
            (destination / f"{name}.yaml").write_text(text, encoding="utf-8", newline="\n")

    for path in destination.glob("*.yaml"):
        if path.name not in expected:
            path.unlink()
    return len(expected)


def main() -> int:
    home = resolve_hermes_home()

    if yaml is None:
        print('ERROR: PyYAML is required to read skin files; refusing to replace plugin.js.', file=sys.stderr)
        return 1

    # Pull flags out first, so `--template <path>` never lands in a positional
    # slot. Positional order stays [skins_dir] [out_plugin_js].
    argv = list(sys.argv[1:])
    template_override = None
    out_override = None
    for flag in ("--template", "--out"):
        if flag in argv:
            idx = argv.index(flag)
            if idx + 1 < len(argv):
                value = Path(argv[idx + 1])
                if flag == "--template":
                    template_override = value
                else:
                    out_override = value
            del argv[idx:idx + 2]

    # Default skins dir: the repo's own skins/ folder when running from a
    # checkout (self-contained), else the Hermes home's skins folder.
    script_dir = Path(__file__).resolve().parent
    repo_skins = script_dir.parent / "skins"
    default_skins = repo_skins if repo_skins.is_dir() else home / "skins"
    skins_dir = Path(argv[0]) if len(argv) > 0 else default_skins

    # Default output: the repo's desktop/plugin.js when running from a checkout (the package layout).
    # else the in-place desktop-plugins location.
    repo_out = script_dir.parent / "desktop" / "plugin.js"
    default_out = repo_out if (script_dir.parent / "desktop").is_dir() else home / "desktop-plugins" / "theme-picker" / "plugin.js"
    out_path = Path(argv[1]) if len(argv) > 1 else (out_override or default_out)

    # The catalogue is skins-v2: one file per skin, both palettes. The v1 pair
    # table is retired and there is no fallback to it - rebuilding 109 singles
    # from it looked like a successful build and quietly downgraded the plugin.
    v2_dir = script_dir.parent / "skins-v2"
    catalogue_dir = Path(argv[0]) if argv else v2_dir
    if not catalogue_dir.is_dir():
        print(f"ERROR: {catalogue_dir} is missing; refusing to build.", file=sys.stderr)
        return 1
    try:
        user_skins = _load_v2_skins(catalogue_dir)
    except ValueError as exc:
        print(f"ERROR: {exc}; refusing to replace {out_path}.", file=sys.stderr)
        return 1
    catalog = user_skins
    builtins: list[dict] = []

    # Backend built-ins are supplemental. Never let them turn an empty,
    # malformed, or non-regular supplied bundle into a destructive partial
    # regeneration: transport generation also prunes files not in the catalog.
    if not user_skins:
        print(f"ERROR: no valid bundled skins found in {skins_dir}; refusing to replace {out_path}.", file=sys.stderr)
        return 1

    derived_count = _write_derivation_report(catalog, Path(__file__).resolve().parent.parent / "docs" / "DERIVED-PALETTES.md")
    repo_gateway_skins = script_dir.parent / "gateway-skins"
    transport_count = _write_gateway_transport_skins(catalog, repo_gateway_skins)
    # sort_keys=True keeps output byte-stable across runs (matches the shipped
    # plugin.js), so a rebuild with unchanged skins produces an identical file.
    data = json.dumps(catalog, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    # Template lives in the project's plugin/ dir (repo layout) or next to the
    # plugin folder root (in-place layout: ../plugin.template.js).
    script_dir = Path(__file__).resolve().parent
    template = template_override or (
        script_dir.parent / "desktop" / "plugin.template.js"  # repo layout
        if (script_dir.parent / "desktop" / "plugin.template.js").exists()
        else script_dir.parent / "plugin.template.js"          # in-place layout
    )
    if not template.exists():
        print(f"ERROR: template not found at {template}", file=sys.stderr)
        return 1

    # Normalise newlines before substitution: read_text() applies universal-newline
    # decoding, and a CR-CR-LF template (Windows write_text translation) would turn
    # into a blank line after every line of the generated plugin.
    template_text = template.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    plugin = template_text.replace("__SKINS_DATA__", data)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(plugin, encoding="utf-8", newline="\n")

    print(f"Rebuilt {out_path} with {len(catalog)} scenes from "
          f"{len(user_skins)} bundled skins + {len(builtins)} backend built-ins, "
          f"{derived_count} derived palettes and {transport_count} gateway transports.")
    print("Next: this repo root IS the plugin package. Install it from Hermes "
          "Desktop -> Capabilities -> Plugins -> Install, by pasting the repo "
          "URL (https://github.com/TobiasDraven/chroma-for-hermes). The dialog "
          "enables the plugin and its Desktop half in one step.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
