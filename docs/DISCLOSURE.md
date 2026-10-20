# Disclosure — what Chroma actually touches

> Written from the code, not from memory. Every claim carries a `file:line`
> citation or the command whose output backs it. Anything the code cannot prove
> is marked `UNVERIFIED` rather than asserted.

## 1. What this plugin is

Chroma is a Hermes **theme/skin picker**: a Desktop pane that browses, imports
and manages skins, applies them to this Desktop immediately, and — when its
optional Python backend is installed — mints real gateway skins so the change
follows every connected Desktop and the CLI. It is a hard fork of
`jdtimothy/hermes-theme-picker` (MIT); the fork added the TweakCN importer,
the skin backend and the skin-management card actions
(`plugin.yaml:6-8`, `README.md:7-15`).

## 2. Surfaces it touches

**The Desktop pane.** The renderer registers theme objects with the SDK, by
area, from `register(ctx)` (`desktop/plugin.template.js:6200-6262`):

| Area | What | Citation |
|------|------|----------|
| `THEMES_AREA` | one Desktop theme per catalogued skin | `desktop/plugin.template.js:6224-6230` |
| `ROUTES_AREA` | the `/chroma` page | `desktop/plugin.template.js:6233-6238` |
| `SIDEBAR_NAV_AREA` | its sidebar entry | `desktop/plugin.template.js:6239-6243` |
| `PALETTE_AREA` | the `chroma.open` command | `desktop/plugin.template.js:6244-6253` |
| `STATUSBAR_AREAS.right` | the current-theme chip | `desktop/plugin.template.js:6256-6261` |

That is the complete registration surface — five `ctx.register` calls, which is
every `ctx.` the build contains aside from one `ctx.rest` assignment
(`desktop/plugin.template.js:6204`; enumeration command in §6).

**Host stylesheets, via CSS custom properties.** Theme application repaints
`document.documentElement` with Desktop's own token names — the `--theme-*`
seed/mix set and the `--dt-*` palette set — plus `color-scheme` and the
`data-hermes-theme`/`data-hermes-mode` attributes on the root element
(`desktop/plugin.template.js:1857-1923`, setProperty loop at `1905-1907`).
The values come from the theme object the plugin contributes; the
**variable names are Desktop's**, not ours. It also repaints native chrome
through the optional `window.hermesDesktop` hooks and writes the
`hermes-boot-*` localStorage hints Desktop reads before plugins register
(`desktop/plugin.template.js:1909-1921`).

**An optional Python backend.** `dashboard/plugin_api.py` declares a FastAPI
router mounted by the dashboard at `/api/plugins/chroma/` (module docstring,
`dashboard/plugin_api.py:3`; `router = APIRouter()` at `:245`). Its routes:

```
dashboard/plugin_api.py:248   GET    /skins
dashboard/plugin_api.py:443   POST   /import
dashboard/plugin_api.py:654   DELETE /skins/{name}
dashboard/plugin_api.py:704   POST   /skins/rename
dashboard/plugin_api.py:786   GET    /export
dashboard/plugin_api.py:1325  GET    /schema
dashboard/plugin_api.py:1391  GET    /skins/{name}
dashboard/plugin_api.py:1419  PUT    /skins/{name}
dashboard/plugin_api.py:1550  GET    /overrides
dashboard/plugin_api.py:1560  PUT    /overrides/{scene}
dashboard/plugin_api.py:1650  DELETE /overrides/{scene}
dashboard/plugin_api.py:1728  GET    /categories
dashboard/plugin_api.py:1746  POST   /categories
dashboard/plugin_api.py:1783  DELETE /categories/{cat_id}
dashboard/plugin_api.py:1851  POST   /skins/duplicate
dashboard/plugin_api.py:1988  GET    /packs
dashboard/plugin_api.py:2055  POST   /packs/export
dashboard/plugin_api.py:2272  POST   /packs/import
dashboard/plugin_api.py:2436  DELETE /packs/{slug}
```

The pane works **with no backend at all**: the Desktop half applies and
previews themes locally, and a missing backend raises a known message the UI
renders as "this Desktop only" instead of implying a sync
(`desktop/plugin.template.js:60-64`; behaviour covered by `tests/`).
Install/import/rename/export/delete/duplicate need the backend
(`desktop/plugin.template.js:60-64`, `933-993`).

**Storage it owns.**

- `<hermes home>/skins/<name>.yaml` — every backend skin write
  (`dashboard/plugin_api.py:135-136`; writer at `:1400`, `:1465`, `:1873`),
  plus the `.chroma` sidecar and its `_trash` subdirectory holding the
  provenance index
  (`dashboard/plugin_api.py:95-97`, `:140-142`, `:236`).
- Plugin-owned localStorage keys, all prefix `chroma-`: the overrides mirror
  (`desktop/plugin.template.js:80`), apply scope (`:89`), card shape (`:93`),
  card size (`:94`), group mode (`:99`), favourites (`:2149`), packs
  (`:2442`).
- **App-owned keys Chroma already reads and writes** under §4 of AGENTS.md,
  not invented ones: the `hermes-desktop-*` theme/mode/profile keys
  (`desktop/plugin.template.js:72`, `81-84`) and the `hermes-boot-*` boot
  hints (`desktop/plugin.template.js:1916-1918`). The boot mirror write is
  load-bearing: Desktop reads its theme cache before plugins register, so a
  contributed theme not mirrored there is unresolvable at next startup
  (`desktop/plugin.template.js:70-72`, `916-927`).

## 3. Network behaviour

Three kinds of traffic, and exactly one of them leaves the machine:

1. **`config.set { key: "skin" }` through the host** — the gateway broadcast
   that carries the selected skin to connected Desktops and the CLI. The
   request goes through the host SDK, not through any socket we open
   (`desktop/plugin.template.js:2676`, `5077`, `5194`). The renderer also
   listens for the resulting `skin.changed` event
   (`desktop/plugin.template.js:2595`).
2. **Backend calls via `ctx.rest`** — only when the dashboard is mounted;
   localhost, routed to the `/api/plugins/chroma/` router in §2
   (`desktop/plugin.template.js:933-993`; `dashboard/plugin_api.py:3`).
3. **External HTTPS: the TweakCN import.** `fetch` appears exactly once in the
   build, fetching `https://tweakcn.com/r/themes/<name>.json` — built from
   `TWEAKCN_BASE` (`desktop/plugin.template.js:380`, `848-859`) — and only
   when the user pastes a TweakCN preset name or URL in the import form
   (`desktop/plugin.template.js:872-887`; network `rg -n "fetch\(" desktop/plugin.template.js`
   → the single match at `:875`). The repo's own submission notes agree:
   "the only network call is the TweakCN import" (`docs/CATALOG-SUBMISSION.md:78`).

No other external request exists. There is no update check and no analytics:
`rg -n "(telemetry|analytics|updates)" desktop/plugin.template.js` matches only
three comments about the localStorage mirror
(`desktop/plugin.template.js:77`, `1854`, `6211`) — nothing network-related.

## 4. Data access

Both halves touch only the paths in §2 — the skin tree under `HERMES_HOME`
(`dashboard/plugin_api.py:29-34` resolves it; `:135-136` and `:142` are the
only filesystem bases the module builds on) and the `chroma-*`,
`hermes-desktop-*` and `hermes-boot-*` localStorage keys cited above.

The negative claim, from an audit of every host-API call the build makes: the
only `ctx.` surface is `register` and `rest`; the only `host.` methods are
`request('config.set')`, `onEvent('skin.changed')`, `navigate` and `notify`
(`rg -o 'ctx\\.(\\w+)'` → `register: 5, rest: 1`;
`rg -o 'host\\.(request|onEvent|notify)\\("[^"]*'` → `config.set: 3`,
`skin.changed: 1`, plus `navigate` and `notify`). Neither half calls a chat,
config-read or telemetry API. What the SDK injects into the render context at
runtime — and what `host.notify`/`host.navigate` do — is host-side code this
repo does not compile, so exposure to data the plugin never asks for is:

UNVERIFIED: at runtime, that the SDK itself grants Chromium nothing beyond the
handlers named above. The audit covers our code's calls; it cannot cover the
host's own memory.

## 5. Host-markup coupling, and the documented fallback

**The pane does not style its own chrome.** The SDK exposes no decoration slot
— no `setTheme`/`setMode` on the renderer's ThemeContext is reachable from the
public plugin surface — so `applyDesktopTheme()` is "a source-faithful port of
Desktop's applyTheme()" that writes the same root tokens and native hooks
Desktop's own code writes (`desktop/plugin.template.js:1852-1923`). The class
list Chroma emits assumes the HOST's compiled Tailwind build still contains
every utility we name; a plugin class the host's own sources never use has no
rule and silently falls back to the browser default
(`scripts/check-host-classes.py:1-16`).

**What breaks if Desktop renames its markup or tokens.** A renamed `--theme-*`
or `--dt-*` variable, or a dropped utility class, stops the repaint (or leaves
an unstyled element) silently — this shipped three times before the gate
existed (`scripts/check-host-classes.py:8-13`). The watcher that catches it is
`scripts/check-host-classes.py`, which checks every class in `desktop/plugin.js`
against the Desktop app's compiled stylesheet, auto-discovered under
`apps/desktop/dist/assets/*.css` (`scripts/check-host-classes.py:42-51`,
`CSS_CANDIDATES` at `:53-58`). Exit 1 = ship-stopper; anything constraining
layout must be an inline style, which no host rebuild can drop
(`scripts/check-host-classes.py:15-16`).

## 6. What it does NOT do

- **No agent tools, hooks or middleware.** The build contains no
  `register_tool`/`registerTool`, no `register_hook`/`registerHook`, no
  `register_middleware`/`registerMiddleware` call in either half
  (`rg -n "registerTool|register_tool|register_hook|registerHook|register_middleware|registerMiddleware"` → no matches in
  `desktop/plugin.template.js` or `dashboard/plugin_api.py`). Its whole
  registration surface is the five areas in §2 (`desktop/plugin.template.js:6225-6261`)
  plus HTTP routes (`dashboard/plugin_api.py`, route list in §2).
- **No background processes** beyond the optional in-process FastAPI router —
  `dashboard/plugin_api.py` declares an `APIRouter` (`:245`), never a
  daemon/thread of its own; the skin writes it performs are synchronous on
  request (`:1400`, `:1465`, `:1873`).
- **No telemetry, no analytics**: neither half posts anywhere except §3.
- **No auto-update**: nothing in the repo fetches a newer version of itself
  (rule 3 in `docs/CATALOG-SUBMISSION.md:73`: "no fetcher, no remote
  `plugin.js`, no update check").

## 7. Compatibility

`requires_hermes: ">=0.22.0"` (`plugin.yaml:3`) — the floor the plugin has
actually proven, walked by hand on Windows 11 against Desktop 0.22.2
(`docs/CATALOG-SUBMISSION.md:59`).

| Platform | Coverage | Evidence |
|----------|----------|----------|
| Windows | CI tests + hand-walked (0.22.2, Windows 11) | `.github/workflows/ci.yml:18-19`; `docs/CATALOG-SUBMISSION.md:59` |
| macOS | CI tests only | `.github/workflows/ci.yml:18-19` |
| Linux | CI tests only | `.github/workflows/ci.yml:18-19` |

`UNVERIFIED: macOS/Linux Desktop rendering has no hand-walk here — only the
test matrix covers it.`
