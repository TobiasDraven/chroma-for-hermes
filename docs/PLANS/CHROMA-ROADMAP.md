# Chroma — Hard Fork + Roadmap

**Status:** **v2.5.2 shipped** — the picker, the twelve measured shelves, per-profile skins and the fix
rounds are DONE. Two campaigns are approved and not started: the **skin editor** (`CHROMA-EDITOR.md`,
next) and **theme packs** (`CHROMA-PACKS.md`, after it).
**Prepared:** 2026-10-16 · **last updated:** 2026-10-18 — see §0.

---

## 0. Where we actually are (2026-10-18)

- **Shipped: v2.5.2** (`e30f56c`). 109 scenes, every one a light/dark pair of six roles; twelve measured
  category shelves; 150 skin palettes; 218 gateway transports; per-profile skins; a 2 x 6 swatch matrix.
- **F1–F6 are done** — delete/rename, CLI badges, export, four import sources, per-profile skins, the
  square picker and its field corrections. **F7 landed differently and better than this file planned:**
  instead of hue buckets, a **twelve-category OKLCH classifier** (2.5.0), with pastels and muted
  measurable at last. The "group by hue" idea survives only as those shelves.
- **The adversarial round closed.** Three independent roasts of 2.4.1 all returned HOLD; every finding
  but two is now closed, with the dispositions and the exact rigour delta in
  `docs/REVIEWS/ROAST-TRIAGE-2026-10-17.md`. Still open: **no 2.x release tag**, and **ARIA**.
- **Next, in order:** the **skin editor** (E0–E6 — approved, prior-art and host-capability scouting in
  flight), then **theme packs** (P0–P6 — approved, all six decisions and the five single-word names
  confirmed: **Earth, Cyberpunk, Zen, Retro, Noir**).
- **Still open from this file:** F5 shipped as option (b), Desktop-side; **F8** (tint/value/brightness)
  and **F9** (accent-picker interop) are unstarted. Note for whoever starts F8: the SDK already exports
  `contrastRatio` plus `hexToOklch`/`oklchToHex`/`oklchToSrgb255`/`maxChroma`, so that work is now
  cheaper than this file assumed — see `CHROMA-EDITOR.md` §16.4.

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

### F6 — Picker UI rework: squares, not long rectangles — DONE, then corrected

**Why:** the cards were full-width rows. With 100+ entries they read as a list,
not a gallery, and comparison across the grid is poor.

**Shipped (`7637536`), then corrected twice from the field:**

- Fixed-aspect square cards in an auto-fill grid
  (`grid-template-columns: repeat(auto-fill, minmax(<n>, 1fr))`).
- Each square shows the palette as a **colour block**, the label, and the F2
  badges (Gateway / Desktop only).
- **Hover preview was wrong, and is gone.** `previewTheme` repaints the whole
  app, so arming it 140ms after the pointer entered a card meant that sweeping
  the pointer across a hundred cards repainted Hermes over and over — reported
  from the field as the gallery being "horribly slow". Replaced by a
  click-triggered pill that holds a preview for `PREVIEW_MS` and reverts. The
  revert timer is owned by the **picker**, not by the card, so it still fires if
  the previewing card leaves the tree; the pill's countdown is display-only.
- **The size was a layout bug, not a taste problem.** `columnsForWidth` capped
  the column count at four, and the card width was derived from the viewport
  divided by that count — so the squares GREW with the window (~330px each on a
  1400px window). The target is now the fixed `CARD_MIN` (104px, about a third
  of that) and auto-fill does the responsive work, so a wide window shows more
  cards instead of four enormous ones.
- A shape control (square / rectangle / circle), persisted under a plugin-owned
  `chroma-*` key and **global** rather than per profile: two profiles on one
  machine describe the same window.

**Still open.**
- The per-card **overflow menu** for Export / Rename / Delete. The actions row
  sits under the card today and cannot move into the square: a button inside a
  button is invalid HTML, and the card is itself a button.
- `CARD_MIN` is a judgement, not a measurement — it is the size that still fits a
  swatch, a truncated label and the pill. Roughly 90px is the floor.
- The circle gets looser padding on the same reasoning: its inscribed area is
  narrower than its bounding box, so text set to the box edge falls outside it.

**Risk:** readability at small sizes — the label must truncate, never wrap, and
the colour block must stay legible against the card chrome.
**Depends on:** F1, F2, F3 (they supply the badges and the menu actions).

### F7 — Sort and group by main hue

**Why:** 104 scenes are grouped only by mode (dynamic / dark-only / light-only),
so finding "something green" means reading every swatch. The palette is already
in the data; it is just not organising anything.

**Approach.**
- Derive each scene's main hue from its accent (`ui_accent`, falling back to
  `banner_accent`) — the same preference order the colour strip already uses.
- Group into named buckets (red / orange / yellow / green / cyan / blue / violet /
  pink / neutral) rather than a continuous sort, so the section headers stay
  stable while scrolling.
- Keep mode as one axis and hue as the other. The mode grouping carries a real
  capability difference (`dynamic` means two coordinated palettes); hue does not.
- **Neutral must be its own bucket**, not a leftover. A grey theme must not land
  in whichever hue its border happens to carry.

**Open:** does hue grouping belong in the picker UI, or only as a sort option?
**Depends on:** F6 (the grid it groups).

### F8 — Adjust a skin's tint, value and brightness

**Why:** the catalog is take-it-or-leave-it. "This one, but warmer" is the most
common reaction to a palette, and the only answer today is to export the YAML,
edit it by hand, and re-import.

**Approach.**
- **Reuse the SDK's OKLCH helpers** — `hexToOklch`, `oklchToHex`,
  `oklchToSrgb255`, `maxChroma`, `contrastRatio` — rather than hand-rolling
  colour maths. They are already a dependency, and the official accent-picker
  plugin proves the workflow (see F9).
- Work in OKLCH: hue rotation and lightness are separable there, where the same
  edit in sRGB muddies the colours.
- **`contrastRatio` is not optional.** Every adjustment re-checks the pairs that
  carry meaning (text on background, accent on chrome) and refuses or warns
  rather than shipping an unreadable palette.
- An adjustment either produces a NEW owned skin (exportable, renameable) or is
  non-destructive scratch state. It must never silently mutate a catalog skin.

**Open:** does an adjustment create a derived skin, or mutate the source in place?
**Depends on:** F3 (export is how an adjustment becomes permanent), F9 (shared
primitives and the same "scratch state, never persisted" rule).

### F9 — Interoperate with the official accent-picker plugin

**Why:** Nous Research's `accent-picker` (MIT, in
`NousResearch/hermes-official-plugins`; formerly `hermes-desktop-accent-picker`,
now archived) already retints live: an OKLCH wheel in the status bar, with the
palette re-deriving from the one colour you pick. It reads and writes
`$accentOverride` / `setAccentOverride` and registers a `PALETTE_AREA`. Two
plugins writing one appearance is exactly the bug class this project keeps
re-learning.

**What it is, from its own README at `abec9e8`:**
- an **authoring tool** — the colour is scratch state and is never persisted
- ships `Accent: reset to the theme default` and `Accent: copy the current color`
- installs from the catalog as `accent-picker`

**Approach.**
- Decide and DOCUMENT the precedence. A Chroma skin apply and an accent override
  are two writers of one appearance: whichever wins, the other must not be left
  holding stale state.
- Check whether an installed accent override survives `setTheme`. If it does not,
  the UI must say so rather than let the user discover it.
- Reuse rather than duplicate: the primitives it uses are the same ones F8 needs,
  so if F8 lands this entry shrinks to a precedence question and may never need a
  hard dependency on the other plugin.
- Do NOT drive another plugin's internals. Anything built here goes through the
  shared SDK surface.

**Open:** is interop wanted at all, or is a documented precedence rule enough?
**Depends on:** F8 (likely subsumes most of it).

### Explicitly out of scope

- A community theme marketplace — hosting, moderation and trust are a project of
  their own.
- Time-of-day automatic switching — cheap to fake, annoying in practice.
- Anything that reaches into the app's theming internals. Every difficult bug in
  this project came from the plugin trying to own state the ThemeProvider owns.

---

## 4. Suggested sequence

| Order | Work | State |
|:--|:--|:--|
| — | F1–F7 | **done.** F7 as the twelve measured shelves, not hue buckets. |
| 1 | **Skin editor**, E0–E6 (`CHROMA-EDITOR.md`) | **next.** Approved; prior-art + host-capability scouting in flight. |
| 2 | **Theme packs**, P0–P6 (`CHROMA-PACKS.md`) | **approved, waiting.** All six decisions and the five names confirmed. |
| 3 | Release tag 2.5.x, plus C9 accessibility | The last two things between us and the registry. |
| 4 | F8 tint/value/brightness | Cheaper now: the SDK exports `contrastRatio` and the OKLCH helpers. |
| 5 | F9 accent-picker interop | Settle the precedence question first; F8 may subsume it. |
