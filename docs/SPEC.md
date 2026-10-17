# SPEC — Chroma for Hermes

## What this is

A Hermes Desktop plugin that browses, imports and manages Hermes skins, and can
mint real gateway skins so the CLI and every connected Desktop follow a change.
A hard fork of "Hermes Theme Picker" by Joshua Timothy (`jdtimothy/hermes-theme-picker`,
MIT) — see `THIRD_PARTY_NOTICES.md`.

`plugin.yaml`: name `chroma`, version `2.5.2` (matching `VERSION`). The repo root IS the plugin package.

## Surfaces it registers

Six registrations. All six are asserted by `tests/surfaces-regression.test.mjs`,
because a past restructure removed several of them while every other test stayed
green:

| Surface | Registration | Data |
|:--|:--|:--|
| Full-page picker | `ROUTES_AREA` | path `/chroma` |
| Sidebar entry | `SIDEBAR_NAV_AREA` | path `/chroma` |
| Status-bar chip | `STATUSBAR_AREAS` | renders the active skin |
| Command palette | — | command id `chroma.open` |
| Theme catalog | `THEMES_AREA` | one Desktop theme per scene (100+) |
| Gateway sync | — | pushes a picked skin to the gateway |

## Features

| Id | Feature | State |
|:--|:--|:--|
| N | Provenance index + `GET /skins` | shipped |
| F1 | Delete and rename an owned skin | shipped (backend + UI) |
| F2 | Badge marking which skins the CLI can use | shipped |
| F3 | Export one skin, or all as a bundle | shipped |
| F4 | Import TweakCN, Windows Terminal, Base16/24, VS Code | shipped (iTerm2 refused; deferred) |
| F5 | Per-profile apply scope (local vs everywhere) | shipped, one limitation recorded |
| F6 | Square-card picker gallery | shipped, revised in the field |
| F7 | Sort and group by main hue | open — see `docs/PLANS/CHROMA-ROADMAP.md` |
| F8 | Adjust a skin's tint, value and brightness | open |
| F9 | Interoperate with the official accent-picker plugin | open |
| P0 | Picker shipped dead (missing React hook imports) | fixed |

## Backend contract

`dashboard/plugin_api.py` exposes an `APIRouter` mounted by the host at
`/api/plugins/chroma/`. All responses are JSON, because JSON REST is the only
channel the pane has back to the backend.

| Route | Semantics |
|:--|:--|
| `GET /skins` | the owned catalog, each with its provenance record |
| `POST /import` | writes a skin; refuses to clobber an existing one (409), refuses a name that collides with a core Desktop theme (409), accepts slug-only names |
| `DELETE /skins/{name}` | moves the skin to a trash dir; refuses while the named skin is active |
| `POST /skins/rename` | rewrites the skin file and its index entry; the UI repairs the gateway skin only under scope `everywhere` |
| `GET /export?name=` | one skin → its own YAML file; no name → a bundle. YAML is byte-for-byte what the importer writes, so a round trip holds |

Route order is load-bearing: `POST /skins/rename` is declared above any
path-parameter route, because FastAPI matches in registration order and
`/skins/{name}` would otherwise swallow it.

## Import

One paste box, and the format is sniffed from the text — the user does not pick a
format. Accepted: TweakCN page URL or CSS, Windows Terminal scheme or whole
`settings.json`, Base16/Base24 YAML (legacy flat and Tinted 0.11 nested), VS Code
colour theme JSON (comments and trailing commas tolerated). An XML plist is
refused BY NAME as iTerm2, rather than failing with a generic parse error.

## Storage keys

The plugin writes two classes of localStorage key, and nothing else:

- Its own `chroma-*` keys (apply scope, card shape, card size, group mode).
- The app's own appearance keys it mirrors so a contributed theme survives a
  restart: `hermes-desktop-user-themes-v1`, `hermes-desktop-theme-v2`,
  `hermes-desktop-mode-v1`, `hermes-desktop-profile-themes-v1`,
  `hermes-desktop-profile-modes-v1`, and the `hermes-boot-background` /
  `hermes-boot-color-scheme` boot hints (`desktop/plugin.template.js:69-73`).
  Desktop reads this cache before plugins register, so the write cannot be
  omitted.

It never invents a new app-owned key — only keys the app itself already uses.

## Non-goals

- A community theme marketplace — hosting, moderation and trust are a project of
  their own.
- Time-of-day automatic switching.
- Reaching into the app's theming internals. Every difficult bug in this project
  came from the plugin trying to own state the ThemeProvider owns.

## Acceptance

A change is done when all of these are green:

```bash
python scripts/regenerate.py                     # after any template edit
node --test tests/                               # node suites
<venv>/python.exe -m unittest tests.test_plugin_api
hermes plugins validate .                        # plugin admission gate
rigour check --ci                                # quality gates
```
