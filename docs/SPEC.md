# SPEC — Chroma for Hermes

## What this is

A Hermes Desktop plugin that browses, imports and manages Hermes skins, and can
mint real gateway skins so the CLI and every connected Desktop follow a change.
A hard fork of "Hermes Theme Picker" by Joshua Timothy (`jdtimothy/hermes-theme-picker`,
MIT) — see `THIRD_PARTY_NOTICES.md`.

`plugin.yaml`: name `chroma`, version `2.8.0` (matching `VERSION`). The repo root IS the plugin package.

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
| Theme catalog | `THEMES_AREA` | one Desktop theme per skin (94); 188 gateway transports |
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

## Skin specification

A skin is one file in `skins-v2/`. `schema_version` describes the file format;
`design_spec` describes how much of the skin was decided.

- `design_spec: v1` — a hand-authored 43-key palette, grandfathered. Every skin
  shipped before 2.7.0 carries this.
- `design_spec: v2` — **ten named surfaces plus two fonts**. The remaining 33 keys
  derive by the rules in `docs/THEME-PACK-CREATION.md` §5, or are overridden with a
  written reason.

The contract, the 43-key surface map, the colour science and the build recipe live in
**`docs/THEME-PACK-CREATION.md`**. `python scripts/check-packs.py` enforces it;
`tests/test_skin_contract.py` proves the gate rejects a v2 skin that omits a surface.

## Import

One paste box, and the format is sniffed from the text — the user does not pick a
format. Accepted: TweakCN page URL or CSS, Windows Terminal scheme or whole
`settings.json`, Base16/Base24 YAML (legacy flat and Tinted 0.11 nested), VS Code
colour theme JSON (comments and trailing commas tolerated). An XML plist is
refused BY NAME as iTerm2, rather than failing with a generic parse error.

## Storage keys

The plugin writes two classes of localStorage key, and nothing else:

- Its own `chroma-*` keys: apply scope, card shape, card size, group mode,
  `chroma-overrides-v1` (per-skin overrides) and `chroma-packs-v1` (the
  enabled theme packs).
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

A change is done when all of these are green. `rigour check --ci` is *not* in
this list: it is red on accepted, documented debt (see `docs/RELEASE-2.6.0.md`),
and a gate that everyone knows is red stops being a gate.

```bash
python scripts/regenerate.py                     # after any template edit
node --test tests/*.test.mjs                    # node suites
<venv>/python.exe -m unittest tests.test_plugin_api
<venv>/python.exe -m unittest tests.test_skin_contract
hermes plugins validate .                        # plugin admission gate (local only)
python scripts/check-package.py                  # package contract (CI runs this too)
python scripts/check-packs.py                    # catalogue contract
```
