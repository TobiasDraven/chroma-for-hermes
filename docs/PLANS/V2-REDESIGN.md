# V2 Redesign — Plan

**Date:** 2026-10-15
**Status:** DRAFT — awaiting review
**Branch:** `main` (currently = v1 + CSS-paste work, commit `9fa6d7f`)

---

## 1. Locked decisions

| # | Decision | Source |
|:--|:--|:--|
| 1 | Gateway sync **restored** | Captain |
| 2 | Lightbulb **conditional** — render only when the active theme ships `darkColors` | Captain |
| 3 | TweakCN importer lives in the **picker page only** (the plugin's own page, not Hermes Settings → Appearance) | Captain |
| 4 | **Real skins** — an import writes a skin YAML file on disk, not just a DesktopTheme | Captain ("real skins, Reading A") |
| 5 | Test suite **fixed** — repointed at the shipped artifact | Captain |

---

## 2. Target architecture

```
<hermes home>/plugins/theme-picker/
  desktop/
    plugin.js            ← the UI (v1's shell + importer + lightbulb)
  dashboard/
    manifest.json        ← dashboard manifest
    plugin_api.py        ← Python backend: writes skin YAMLs
```

The plugin becomes a **unified package**. The desktop half moves from
`desktop-plugins/theme-picker/plugin.js` to `plugins/theme-picker/desktop/plugin.js`.

**Verified contract** (source: `runtime-loader.ts:16-19`, `web_server_dashboard.py:559`):
the two on-disk doors are `<hermes home>/desktop-plugins/<name>/plugin.js` and
`<hermes home>/plugins/<name>/desktop/plugin.js`. Both work; the unified layout is
what we want because it carries the backend.

---

## 3. The skin contract (exact, verified)

**Location:** `<hermes home>/skins/<name>.yaml` — **TOP LEVEL ONLY.**
`list_skins()` (`skin_engine.py:411`) globs `skins_path.glob("*.yaml")` — **not
recursive**. A skin in a subdirectory is invisible to `load_skin()` and
`hermes skin list`. The existing `theme-picker-gateway/` transport skins are
therefore already latent dead weight; we do not follow that pattern.

**Schema** (`_build_skin_config`, `skin_engine.py:382`):

```yaml
name: <slug>              # REQUIRED — a YAML without "name" is ignored outright
description: <text>
colors:                   # merged over the default skin's blocks
  background: '#rrggbb'
  ui_text: '#rrggbb'
  banner_text: '#rrggbb'
  ui_accent: '#rrggbb'
  banner_accent: '#rrggbb'
  ui_tool: '#rrggbb'
  ui_border: '#rrggbb'
  banner_border: '#rrggbb'
  banner_title: '#rrggbb'
  banner_dim: '#rrggbb'
  ui_label: '#rrggbb'
  ui_ok: '#rrggbb'
  ui_error: '#rrggbb'
  ui_warn: '#rrggbb'
light_colors: {}          # NOT merged — an explicit per-polarity palette
dark_colors:  {}           # NOT merged
spinner: {}
branding: {}
tool_prefix: '┊'
tool_emojis: {}
banner_logo: ''
banner_hero: ''
customCSS: ''
```

**Full colour token set** (from the built-in palettes, `skin_engine.py:68-302`):
`background`, `ui_text`, `banner_text`, `ui_accent`, `banner_accent`, `ui_tool`,
`ui_border`, `banner_border`, `banner_title`, `banner_dim`, `ui_label`, `ui_ok`,
`ui_error`, `ui_warn`, `status_bar_bg`, `status_bar_dim`, `status_bar_strong`,
`prompt`.

**Mode handling — the decisive fact:** `light_colors` and `dark_colors` are real
fields (`SkinPayload`, `contracts/events.py:42-43`; `HermesSkin`,
`skin_engine.py:22-23`). **One skin file can carry both polarities.** The
scout's find: a single TweakCN import with a dark group becomes ONE skin with
`colors` + `light_colors` + `dark_colors`. No pair of transport skins needed.

**Activation + broadcast:** `config.set {key:'skin', value:name}` writes
`display.skin` and broadcasts `skin.changed` to every surface
(`methods_config_set.py:470`). The gateway watcher fires on an active-skin
name/mtime change (`change_watcher.py:36`) and repaints within ~1s.

**Write-then-activate ordering is mandatory:** `_set_skin` broadcasts
`resolve_skin()` for the *named* skin. If the file does not exist, `load_skin`
falls back to the default and every surface receives the **default** palette.
So: write the file first, then `config.set`.

---

## 4. The backend contract (exact, verified)

**Layout** — `_discover_dashboard_plugins` (`web_server_dashboard.py:559`)
scans `<plugins root>/*/dashboard/manifest.json`.

**`manifest.json`** (`_dashboard_plugin_entry`, `web_server_dashboard.py:517`):

```json
{
  "name": "theme-picker",
  "label": "Theme Picker",
  "description": "Browse and apply Hermes skins.",
  "version": "2.0.0",
  "icon": "Paintbrush",
  "api": "plugin_api.py",
  "tab": { "path": "/theme-picker", "position": "end", "hidden": true },
  "entry": "dist/index.js"
}
```

Fields: `name`, `label`, `description`, `icon` (default `Puzzle`), `version`
(default `0.0.0`), `tab` {`path`, `position`, `override`, `hidden`}, `slots`
(list[str]), `api`, `entry` (default `dist/index.js`), `css`.

**`api` is validated** (`_safe_plugin_api_relpath`, `:449`): must be a **relative
path that stays inside `dashboard/`**. Absolute paths and `..` are rejected and
the routes are silently not mounted. `plugin_api.py` satisfies this.

**`plugin_api.py` must expose `router`** — a FastAPI `APIRouter`. Mounted at
`/api/plugins/<name>/` (`_mount_plugin_api_routes`, `:869`; `_mount_hosted_plugin_api`,
`:852`).

**Working example on this host:**
`C:\Users\malan\AppData\Local\hermes\plugins\session-dashboard\dashboard\plugin_api.py:29`
— `router = APIRouter()` with `@router.get(...)` handlers. Nine such plugins
exist; `session-dashboard`, `cdp-manager`, `handflow`, `hermes-memory-ui`, etc.

**Gating** (`_plugin_api_mount_skip_reason`, `:794`; `_plugin_api_runtime_gate`,
`web_server.py:650`):

- `source == "user"` and not in `plugins.enabled` → **refused**
- `source in ("user","bundled")` and in `plugins.disabled` → refused
- `source == "project"` (`.hermes/plugins/`) → **Python never imported**

So `theme-picker` must be listed in `plugins.enabled` in config.yaml.

**Restart:** the startup sweep (`_mount_plugin_api_routes`) is the primary
mount. `_try_hot_mount_plugin_api` (`:905`) exists for unknown-subpath 404s, but
the documented behaviour (and field experience) is that a **Hermes restart is
required**. We will state that in the install instructions.

---

## 5. The changes

### 5.1 — New: `dashboard/manifest.json`
As in §4.

### 5.2 — New: `dashboard/plugin_api.py`
One endpoint:

```
POST /api/plugins/theme-picker/import
  body: { "name": "<slug>", "theme": <DesktopTheme> }
  → writes <hermes home>/skins/<slug>.yaml   (atomic, via utils.atomic_yaml_write)
  → returns { "ok": true, "path": "..." }
```

The backend does the file write. The UI does the activation (`config.set`).

**Colour mapping** (TweakCN/shadcn → skin tokens). Every value is normalised
to `#rrggbb` by the existing `cssColorToHex` (SDK `oklchToHex`):

| skin token | TweakCN source |
|:--|:--|
| `background` | `--background` |
| `ui_text` | `--foreground` |
| `banner_text` | `--primary-foreground` |
| `ui_accent` | `--primary` |
| `banner_accent` | `--primary` |
| `ui_tool` | `--accent` |
| `ui_border` | `--border` |
| `banner_border` | `--border` |
| `banner_title` | `--foreground` |
| `banner_dim` | `--muted-foreground` |
| `ui_label` | `--card-foreground` |
| `ui_ok` | `--primary` |
| `ui_error` | `--destructive` |
| `ui_warn` | `--accent` |

Plus `light_colors` / `dark_colors` from the same mapping when both polarities
exist.

**Naming:** slug from the theme label; refuse on collision with a catalog scene
name OR a `CORE_DESKTOP_THEMES` name OR an existing skin file.

### 5.3 — Move the desktop half
`plugin/plugin.js` → `plugins/theme-picker/desktop/plugin.js` at install time
(the install script does the copy). The repo keeps `plugin/plugin.js` as the
canonical source; the install script stages the unified layout.

### 5.4 — Graft the importer into `plugin/plugin.template.js`

**Imports** (`:27-43`): add `oklchToHex`, `Input`, `Button` to the
`@hermes/plugin-sdk` import.

**Importer core** (~170 lines, from `plugin/plugin.v2.template.js:188-353`):
`cssColorToHex`, `tweakcnColors`, `slug`, `tweakcnToDesktopTheme`, `tweakcnUrl`,
`fetchTweakcnTheme`, `parseCssTheme`, `readStoredThemes`, `persistTheme`,
`registerTheme`. Every dependency (`readableOn`, `mix`, `rgbToHex`,
`CORE_DESKTOP_THEMES`, `USER_THEMES_KEY`, `DEFAULT_FONT_*`) already exists in v1.

**Import row** in `ThemePicker` (`:758-892`), after the mode `SegmentedControl`
(`:848-855`): the `URL | CSS` toggle, the field/textarea, the Import button.
State: `importMode`, `importRef`, `busy`.

**On import:** POST the theme to `/api/plugins/theme-picker/import` → on
success, `config.set {key:'skin', value: slug}` (the gateway broadcast) →
`setTheme(slug)` for the Desktop provider handoff.

### 5.5 — Lightbulb on the statusbar chip
`ThemeChip` (`:898-918`) becomes two controls in one row:

```
[ ● Theme Name ]  [ 💡 ]
```

- The dot + label keep their current behaviour (navigate to the picker page).
- The lightbulb renders **only** when the active theme ships `darkColors`.
- Action: `setMode(mode === 'light' ? 'dark' : 'light')`.
- The condition resolves the active theme from the live skin list (not `SKINS`,
  which cannot contain imports).

### 5.6 — Test suite
`tests/tweakcn-import.test.mjs` currently targets `plugin/plugin.v2.js`.
Repoint at `plugin/plugin.js` so the **shipped** artifact is tested.
Extend with: importer registration, CSS parse, name-collision refusal, and the
lightbulb condition.

---

## 6. Edge cases

| # | Risk | Handling |
|:--|:--|:--|
| A | **Shape mismatch** — the page's `ThemeCard` reads `scene.lightColors` / `scene.darkColors` / `modeSupport`; a skin theme is `DesktopTheme`-shaped | An adapter converts the skin theme to the card shape. Reuse v1's `sceneToDesktopTheme` output shape. |
| B | **Name collision** — `persistThemesForBoot:376` overwrites any stored entry flagged `themePickerManaged: true` | Refuse a slug that collides with a catalog scene, a `CORE_DESKTOP_THEMES` name, or an existing skin file. |
| C | **Write-then-activate** | The backend writes the file; only then does the UI call `config.set`. |
| D | **Unknown skin name** | `load_skin` falls back to default and warns. The backend must refuse unknown names rather than silently creating a default-backed skin. |
| E | **`api` path validation** | Use `plugin_api.py` (relative, inside `dashboard/`). |
| F | **`plugins.enabled`** | Add `theme-picker` to the allow-list in the install instructions. |
| G | **Restart** | Document the Hermes restart on the G15. |

---

## 7. Verification

1. `node --test tests/tweakcn-import.test.mjs` → 12+ pass
2. `node --test tests/theme-persistence.test.mjs` → 30 pass
3. `python3 -m unittest discover -s tests -p "test_regenerate.py"` → 18 tests, 4
   pre-existing Windows-only errors
4. `npx @rigour-labs/cli scan` — no new findings from our code
5. **Manual, on the G15:** install, restart, import a TweakCN preset, confirm
   the skin appears in `hermes skin list`, the picker page grid, and the CLI
   follows within ~1s

---

## 8. Deployment

```
install\install-windows.ps1   → stages plugins/theme-picker/{desktop,dashboard}
hermes config set plugins.enabled [...]
Hermes restart on the G15
```
