# Chroma — Hard Fork + Roadmap

**Status:** fork prep DONE · features PLANNED, not started
**Prepared:** 2026-10-16

---

## 1. Fork decision

| | |
|:--|:--|
| Upstream | [jdtimothy/hermes-theme-picker](https://github.com/jdtimothy/hermes-theme-picker) (MIT, © 2026 Joshua Timothy) |
| Our fork | [`TobiasDraven/chroma-for-hermes`](https://github.com/TobiasDraven/chroma-for-hermes) |
| New name | **Chroma for Hermes** |
| Plugin id | `theme-picker` → **`chroma`** |
| Version | `1.5.1` → **`2.0.0`** |
| Relationship | **Hard fork.** Stop tracking upstream except for security fixes. |

### Why hard fork

Upstream has not moved in roughly two months. We have already replaced the apply
path, added the TweakCN importer, added a Python backend, and restructured the
package. Every remaining item on the roadmap widens that gap. Continuing to call
it a patch of someone else's plugin misdescribes what it is.

### Attribution duties (MIT, discharged)

- `LICENSE` — the original copyright and permission text is retained verbatim.
- `THIRD_PARTY_NOTICES.md` — retained; covers BChop's Hermes Skins Pack (50, MIT)
  and CliffWade's Hermes Desktop Theme Pack (100 v1.1.0, MIT).
- `README.md` — credits block added at the top: names Joshua Timothy, links the
  original, states which parts are his and which are ours, and states plainly
  that this is not endorsed by the original author or by Nous Research.
- `plugin.yaml` — `author` field names both the fork maintainer and the original.
- The upstream bug fix stays offered as PR #9. That offer outlives the fork.

### Renamed in code

`desktop/plugin.template.js` (id, page route, contribution ids, palette label),
`dashboard/manifest.json` (name, label, tab path), `dashboard/plugin_api.py`,
`install/*`, `README.md`, `docs/ARCHITECTURE.md`, `docs/V2.md`, `CHANGELOG.md`,
`VERSION`, plus the generator's default paths and closing hint.

**App-owned keys deliberately NOT renamed** — `hermes-desktop-user-themes-v1`,
`hermes-boot-background`, `hermes-boot-color-scheme`. The Desktop app owns these;
renaming them would silently orphan every theme the user already imported.

### Open decisions from the rename

1. **Gateway transport skin prefix.** The 114 transport skins are named
   `theme-picker-<scene>-<mode>`, and those names are baked into the generated
   catalog as `gatewayLightName` / `gatewayDarkName`. Renaming them to `chroma-*`
   touches `gateway-skins/`, the generated catalog, and the skins already
   installed on the gateway — a real change with a reinstall step, and no
   functional gain. *Recommendation: leave them.* They are skin names, not the
   plugin id, and they appear only in `hermes skin list`.
2. **Stale `desktop/plugin.v2.js` + `desktop/plugin.v2.template.js`.** Leftovers
   from the abandoned v2. Dead code that still carries the old id. *Recommendation:
   delete both; git history keeps them.*

---

## 2. Distribution: the Hermes plugin catalog

**Status: prepared, not submitted.** The admission gate is `hermes plugins
validate <dir>` — the same command the catalog CI runs. Current result:

```
✓ manifest · ✓ manifest fields · ✓ requires_hermes · ✓ config schema
✓ requires_env · ✓ loadable · ✓ python dependencies · ✓ built-in tool collisions
✓ security scan — safe · ✓ no core override · ✓ desktop surface
⚠ no __init__.py — capability probe skipped (manifest-only plugin)
◆ Isolation — portable plugin (no Python): runs anywhere
Validation passed.
```

### What was done to get there

1. **Added `plugin.yaml`** (agent-side manifest; the gate refuses a plugin
   directory without one). Required fields: `name`, `version`, `description`.
2. **Removed every private core import.** `plugin_api.py` had been importing
   `utils.atomic_yaml_write` and `hermes_yaml`, which the gate refuses under
   *rule 9 — public surfaces only*: they can break on any Hermes release. The
   skin shape is now serialised by a small local emitter and written with
   `os.replace`, standard library only.
3. **Cleared the security scan.** `inline_shell_exec` fired on a search-filter
   template literal (`` `${s.name} …` ``) — a false positive, but a warning on a
   submission is noise for a reviewer. Rewritten as plain concatenation. Scan now
   reports `safe`.

### Remaining for submission

- Decide the repository name and rename the GitHub repo (a catalog entry is keyed
  on `owner/repo`).
- Add a CI workflow running `hermes plugins validate . --install-deps --json` so
  admission is checked on every push.
- Contact the catalog maintainers for the submission route; the gate documents
  the checks but not the intake process.
- One real end-to-end install on a clean machine before submitting.

---

## 3. Feature roadmap

Ordered. Items 1–3 share one piece of work; 4–6 are independent.

### F1 — Delete and rename a skin

**Why:** we can create a skin and never remove one. A user who imports a bad
preset is stuck with it forever.

**Approach.** Two backend routes beside `POST /import`:
- `DELETE /api/plugins/chroma/skin/{name}`
- `POST /api/plugins/chroma/rename` `{from, to}`

Both must refuse: a built-in name, a skin that is not ours (no Chroma marker),
the currently active skin, and any name that escapes a slug. Deletion moves the
file to a sidecar trash folder rather than unlinking it.

**Risk:** a rename must also update `display.skin` if that skin is active.
**Depends on:** nothing.

### F2 — Mark which skins the CLI can use

**Why:** half the value of a real skin is that the TUI follows it. Right now the
picker cannot tell you which entries are Desktop-only and which are gateway-wide.

**Approach.** A skin is CLI-capable iff its YAML exists at the **top level** of
`<hermes home>/skins/` — `list_skins()` globs `*.yaml` and is **not recursive**,
so a skin in a subdirectory is invisible to the CLI. Surface that as a badge on
each card: *Gateway* vs *Desktop only*.

**Depends on:** nothing. This is the cheapest item and it teaches the user the
difference the whole architecture rests on.

### F3 — Export individual or all skins

**Why:** backup, and moving a look between machines.

**Approach.** `GET /api/plugins/chroma/export?name=<n>` returns one YAML;
without the parameter returns a zip of every Chroma-owned skin. The UI offers
*Export* on a card and *Export all* in the header. Import mirrors it: a dropped
`.yaml` or `.zip` is validated, then written through the same path as a TweakCN
import.

**Note:** exports round-trip through the same schema the importer writes, so an
export is also the format a user can hand-edit.
**Depends on:** nothing.

### F4 — Import from more sources

**Why:** the CSS paste path already accepts any Tailwind/shadcn `:root` block.
That is one format of many.

**Approach.** Add source adapters behind one interface — parse to colours, then
hand to the same skin writer:
- **VS Code themes** (`.json`, `colors` map) — closest to what we already do.
- **Windows Terminal schemes** (`.json`) — small, well-specified.
- **Base16 / Base24** — a fixed 16-colour contract, maps cleanly.
- **iTerm2 `.itermcolors`** — a plist with the standard 16 ANSI colours.

Each adapter is pure data-in/data-out and unit-testable in isolation, exactly
like `parseCssTheme` today.

**Risk:** token mapping is a judgement call per format; each needs a fixture.
**Depends on:** nothing, but pairs well with F3 (the same import pipeline).

### F5 — Per-profile skins

**Why:** the original motivation. Desktop themes are per-profile; gateway skins
are global (`display.skin`). Today one choice wins everywhere.

**Approach.** This is the hard one, and it needs a survey before a plan.
Two candidate designs:
- **(a) Profile-scoped skin files.** Write the skin into a per-profile skins root
  and have the gateway resolve it per active profile. Requires upstream support;
  `list_skins()` currently reads one directory.
- **(b) Desktop-side only.** Leave the gateway skin global and let the Desktop
  apply a per-profile *theme* (which it already supports) while the CLI keeps the
  global skin. Weaker, but it is achievable entirely within the plugin.

**Decision required from the Captain before any code.**
**Depends on:** a scoping spike; do not start before F1–F4 land.

### F6 — Picker UI rework: squares, not long rectangles

**Why:** the current cards are full-width rows. With 100+ entries they read as a
list, not a gallery, and comparison across the grid is poor.

**Approach.**
- Fixed-aspect **square** cards in a responsive auto-fill grid
  (`grid-template-columns: repeat(auto-fill, minmax(<n>, 1fr))`).
- Each square shows the palette as a **colour block**, the label, and the state
  badges from F2 (Gateway / Desktop only).
- Hover = preview (via `useTheme().previewTheme`), click = commit. Leave = revert.
- A density control, since squares trade off how many are visible at once.
- Actions (Export, Rename, Delete) move into a per-card overflow menu so the
  square stays clean.

**Risk:** readability at small sizes — the label must truncate, never wrap, and
the colour block must stay legible against the card chrome.
**Depends on:** F1, F2, F3 (they supply the badges and the menu actions).

### Explicitly out of scope

- A community theme marketplace — hosting, moderation and trust are a project of
  their own.
- Time-of-day automatic switching — cheap to fake, annoying in practice.
- Anything that reaches into the app's theming internals. Every difficult bug in
  this project came from the plugin trying to own state the ThemeProvider owns.

---

## 4. Suggested sequence

| Order | Work | Why first |
|:--|:--|:--|
| 1 | F2 badges | Cheapest, teaches the gateway/Desktop split |
| 2 | F1 delete/rename | Closes the "stuck with a bad import" hole |
| 3 | F3 export/import | Pairs with F1, same backend surface |
| 4 | F6 squares | Do it once F1–F3 supply the badges and actions |
| 5 | F4 more sources | Independent; a good follow-on to F3 |
| 6 | F5 per-profile | Needs a spike and a decision first |
