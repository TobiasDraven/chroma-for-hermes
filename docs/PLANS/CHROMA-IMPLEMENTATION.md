# Chroma — Implementation Tracker

**Source of truth for F1–F6.** Updated in the SAME commit as each feature, never afterwards.

Legend: `[x]` done · `[~]` in progress · `[ ]` not started · `[!]` blocked · `[-]` decided against

| # | Work | State | Commit |
|:--|:--|:--|:--|
| F0 | Surfaces regression guard | done | `ab0b77f` |
| 0 | Remove stale v2 leftovers | done | `461336d` |
| N | Provenance index + `GET /skins` | done | `98a7ac5` |
| F2 | CLI-capable badges | done | `06e72d8` |
| F1 | Delete / rename a skin | backend + UI done | `08d639b`, `bf36a63` |
| F3 | Export | done | `7337536` + `8aff397` |
| F6 | Square-card picker UI | done, then corrected in the field | `7637536` + `39b592c`, `d48750e` |
| F4 | Import from more sources | done (3 of 4; iTerm2 deferred) | `see F4 section` |
| F5 | Per-profile skins (scoped apply) | done | `4d22198` |
| P0 | Missing react hooks (`useRef`/`useCallback`) | done | `see P0 section` |
| ✓ | Review | in progress | — |

---

## F0 — Surfaces regression guard

**Why this is first.** A previous restructure deleted the route, sidebar entry,
statusbar chip, palette command and gateway sync, and every suite stayed green —
because nothing asserted those surfaces existed. The tests all pointed at
behaviour, and the surfaces are not behaviour.

`tests/surfaces-regression.test.mjs` registers the plugin against a recording
`ctx` and asserts:

- [x] `plugin.id === 'chroma'`
- [x] exactly one `ROUTES_AREA` entry, path `/chroma`, with a render function
- [x] exactly one `SIDEBAR_NAV_AREA` entry
- [x] exactly one `STATUSBAR_AREAS.right` entry with a render function
- [x] exactly one `PALETTE_AREA` entry (`chroma.open`)
- [x] >50 `THEMES_AREA` registrations, each with a name and colours
- [x] `host.request('config.set'` still present in the shipped build
- [x] `syncDesktopState` still present (the ThemeProvider handoff = the revert fix)
- [x] app-owned keys present: `hermes-desktop-user-themes-v1`, `hermes-boot-*`

**A failure here is a product decision, not a test to fix.** If a session
removes a surface, that session surfaces it to the Captain.

---

## 0 — Stale leftovers

- [x] `desktop/plugin.v2.js` removed
- [x] `desktop/plugin.v2.template.js` removed
- [x] `docs/V2.md` removed (it documented the abandoned design and told the reader
      to build a file that no longer exists)
- [x] gateway transport names left alone, per the Captain (`theme-picker-*`)

---

## N — Provenance index (foundation for F1/F2/F3) — DONE

**The gap.** Nothing currently records that a skin is ours. The importer writes
`<name>.yaml` and nothing else, so "delete the ones we created" has no honest
implementation — filename heuristics would eventually delete a user's own
hand-written skin.

- [x] Sidecar index at `<hermes home>/skins/.chroma/index.json`:
      `{ name: { source, label, importedAt } }`
- [x] Written atomically (`os.replace`), same discipline as the skin writer
- [x] The `.chroma/` subdirectory is invisible to `list_skins()` (top-level
      `*.yaml` glob, non-recursive) — **asserted by a test**, not assumed
- [x] `GET /api/plugins/chroma/skins` → `[{name, label, source, owned, cliCapable, missing}]`
- [x] Corrupt index reads as empty rather than raising — the safe direction, since
      "nothing is ours" makes F1 refuse to delete
- [x] `missing` is reported, not hidden: the index remembers a skin whose file is
      gone, so a vanished skin is explainable
- [x] Pure functions unit-tested with a temp `HERMES_HOME` — 13/13 in the Hermes venv

**Evidence:** `tests/test_plugin_api.py`, 13 tests, run with the Hermes venv python
(the module imports fastapi at load time, so the system python cannot import it).

---

## F2 — CLI-capable badges — DONE

A skin is **CLI-capable** iff its YAML sits at the TOP LEVEL of
`<hermes home>/skins/` — `list_skins()` globs `*.yaml` and is NOT recursive, so
a skin in a subdirectory is invisible to the CLI. That distinction is the
architecture, and the picker did not teach it.

- [x] `isGatewayCapable(scene)` — a scene is gateway-wide iff it carries
      `gatewayLightName`/`gatewayDarkName`. Computed in the Desktop plugin from
      data already in the build; no backend, no restart
- [x] `CliBadge` on every card: `CLI` (accent) vs `desktop` (dim), with a title
      tooltip carrying the real explanation
- [x] Imported themes are gateway-capable by construction (the backend writes
      their YAML at the top level)
- [x] Three tests, including one that asserts the SHIPPED catalog really carries
      transports (>50), so the badge cannot silently become all-desktop

**Evidence:** `tests/tweakcn-import.test.mjs` 16/16 (was 13). Guard 9/9,
persistence 30/30. Verification needs only "Reload desktop plugins" — no
backend, because this is catalog data plus a render.

---

## F1 — Delete and rename a skin — DONE

**Status: both halves shipped.** The backend landed in `08d639b`, the
user-visible controls in `bf36a63`. What follows records *why* the design is
split the way it is, which is still load-bearing.

### Backend — done

- [x] `DELETE /api/plugins/chroma/skins/{name}`
- [x] `POST /api/plugins/chroma/skins/rename` `{source, target, active}`
- [x] Guards, all mandatory and all tested: built-in name refused (the UNION of
      the Desktop theme names and the skin-engine built-ins — guarding with only
      one half mints a skin the other half refuses); name must be in the
      provenance index; the active skin refused; slug validated hard, because the
      name becomes a path
- [x] Delete MOVES to `.chroma/_trash/<name>-<µs>.yaml` — never unlink.
      Microsecond resolution because two deletes in the same second would
      otherwise collide and `os.replace` would silently destroy the first copy,
      defeating the recoverability it exists for
- [x] Rename rewrites the file, the `name:` field, the `description` (it carries
      the import label) AND the index label — a test caught the description, and
      the same staleness in the index would have made `GET /skins` name a skin
      that no longer exists
- [x] Rename returns `wasActive` — see the open half below
- [x] Route-order comment on `/skins/rename`, so a future session does not add
      `POST /skins/{name}` and shadow it

**Evidence:** `tests/test_plugin_api.py` 27/27 in the Hermes venv.

### UI — DONE

- [x] Per-card **Rename** / **Delete** actions, shown only on skins Chroma owns
      (the catalog scenes are bundled; the backend refuses anything without a
      provenance record)
- [x] **`wasActive` is consumed.** Renaming the active skin re-broadcasts
      `config.set {key:'skin', value:<new name>}` after the backend confirms.
      Without it the gateway keeps the old name, resolution fails, and the CLI
      silently drops to the default skin
- [x] Delete confirms inline first — it sits one click from the card the user
      meant to apply — and the confirmation says the skin goes to the trash
- [x] The actions live **outside** the card button: a button inside a button is
      invalid HTML, and the card is itself a button
- [x] No `window.confirm` / `window.prompt`: both are unreliable in the renderer,
      and a confirm that silently returns true is worse than none
- [ ] Skins imported before the provenance index existed have no record and
      cannot be managed until re-imported once. **Still to say in the UI** — they
      currently just show no actions
- [ ] Backend change ⇒ **full Hermes restart**, not a rescan

**Evidence:** backend 27/27; guard 9/9, importer 16/16, persistence 30/30;
`hermes plugins validate .` → Validation passed.

---

## F3 — Export — DONE

The Captain's list says *"Export individual or all skins"*. Importing the exported
file is F4 territory (more sources), so this is deliberately export-only.

### Backend — done

- [x] `GET /api/plugins/chroma/export?name=<n>` → one skin's YAML
- [x] `GET /api/plugins/chroma/export` → every owned skin + the index
- [x] Refusals match F1: built-in, unowned, traversal name
- [x] **JSON envelope, not a zip, and that is a deliberate call.** The pane's only
      channel back from the backend is a JSON REST call, and a binary body is the
      one thing it is least likely to carry intact. The YAML text rides inside
      the JSON; the pane turns it into a file the user saves. A zip here would
      look more conventional and fail at the only place it matters
- [x] Round-trip proven: the tests parse the exported YAML back with a real YAML
      parser and assert the schema the importer writes
- [x] A vanished file is skipped in the bulk export rather than 500-ing the whole
      download
- [x] A deleted skin's content is still readable from the trash — deletion is
      recoverable, and this is how a user actually recovers it

**Evidence:** `tests/test_plugin_api.py` 34/34 (was 27).

### UI — done (`8aff397`)

- [x] `Export` on an owned card, and `Export all` in the header (disabled while an
      export runs, and disabled when Chroma owns nothing — an empty bulk export
      would otherwise fail at the artifact step instead of the click)
- [x] **Save path resolved, not assumed.** `host` exposes no file-save API —
      checked against the SDK source (`apps/desktop/src/sdk/index.ts`), where the
      surface ends at `navigate` / `request` / `notify`. The renderer therefore
      writes an anchor + blob, and that is the *supported* path rather than a
      fallback: Electron's `will-download` handler routes renderer anchor/blob
      downloads to the Downloads folder with a save dialog
      (`installDownloadHandling`, `apps/desktop/electron/main.ts`). The call site
      documents this so a future reader does not go hunting for a save API.
      **Still needs a real click on the G15** — the source says the path exists;
      only your machine proves it opens
- [x] Says what an export is, in the UI: `title` on both controls — hand-editable
      YAML you can edit and re-import; the header button names the bundle
- [x] `exportArtifact` is pure, so the envelope → file mapping is testable
      without a DOM. One skin saves as its own YAML byte for byte; a bulk save is
      the bundle under the backend's declared `chroma-skins.json`; an empty or
      malformed payload **throws** rather than writing a dead file
- [x] Export has its own `exporting` state. Reusing `busy` would make the Import
      button read `Importing…` while an export runs — a label that lies
- [x] Fault-injected: disabling the single-skin branch fails the byte-for-byte
      test (exit 1); restoring passes 4/4

**Evidence:** `tests/export.test.mjs` 4/4.

---

## F6 — Square-card picker UI — DONE

- [x] `grid` with `repeat(auto-fill, minmax(<n>px, 1fr))` replacing the
      `flex flex-wrap` + per-column-pixel-width layout. auto-fill adapts to a
      resized window with no second calculation — the aspect ratio carries the
      look, not the width, which is the whole point of squares
- [x] `aspect-ratio: 1` on the card, and the colour block changed from `h-5` to
      `flex-1` so it fills the square. A fixed-height strip wastes the middle of a
      square card, which is where the palette should be doing the talking
- [x] Label truncates (`truncate`, `min-w-0`) so a long name cannot break layout
- [x] F2's `CliBadge` rides on the card
- [x] Hover preview: `previewTheme(scene.name, mode)` after a 140 ms debounce —
      **shipped, then REMOVED.** It repainted the whole app on pointer travel and
      was reported from the field as "horribly slow". See *Revised in the field*
      below
- [x] Still `jsx()` / `jsxs()` calls throughout — no JSX syntax
- [x] **Proven a rendering-only change**: the surfaces guard passes all six
      registration assertions after the rework (route, sidebar, statusbar, palette,
      catalog, gateway sync). That guard exists because a previous restructure
      removed the surfaces and every test stayed green
- [x] `previewTheme`'s real signature verified against the Hermes source before
      wiring it — `(name: string, mode: 'light' | 'dark')`, not a theme object.
      An invented signature here would have failed silently at the only moment it
      is used
- [ ] Per-card overflow menu grouping Export / Rename / Delete (all three are now
      inline buttons in one row; folding them into a menu is a layout call, not a
      gap — the row currently fits three `0.625rem` buttons on the square card)

### Revised in the field (`39b592c`, `d48750e`)

Two reports from the Captain after installing the fork, plus one request.

- **"the preview over hover makes it horribly slow"** — correct, and the cause was
  structural rather than a missing debounce. `previewTheme` repaints the entire
  app, so the cost scaled with pointer travel instead of intent: sweeping across a
  hundred cards repainted Hermes a hundred times. The hover path is gone,
  replaced by a **pill inside each square** that previews on click and reverts
  after `PREVIEW_MS` (10 s). The picker owns the single revert timer, so the
  revert still fires if the previewing card is filtered away or scrolled out of
  the tree; the pill's countdown is display-only and re-renders only itself. The
  timer is also cleared when the picker unmounts and when a theme is committed —
  a revert firing against the theme the user just chose is the same bug class as a
  preview left armed. The pill is a DOM **sibling** of the card (a button inside a
  button is invalid HTML) in a positioned wrapper, and reveals on hover as a CSS
  opacity flip on one element, not an app repaint.
- **"the squares are very big, let's make them 1/3rd of the size"** — the size was
  a layout bug, not taste. `columnsForWidth` capped the column count at four and
  `cardMin` was derived from viewport ÷ count, so cards GREW with the window
  (~330 px at 1400 px wide). Replaced by a fixed `CARD_MIN` (104 px) plus
  auto-fill, so a wide window shows more cards. `columnsForWidth` and the
  `viewport` subscription that existed only to feed it are deleted — along with
  the test that asserted the old column count, which asserted the very mechanism
  that caused the bug.
- **Shape control** (square / rectangle / circle), requested at the same time: a
  `SegmentedControl` in the header, persisted under `chroma-card-shape-v1`.
  Global rather than per profile — two profiles on one machine describe the same
  window. Rectangles take a wider slot (`cardMinFor` ×1.6) so their height stays
  usable.
- **A circle holds only its palette.** `rounded-full` does not clip children, so a
  label row set at the bottom of a circle's bounding box paints outside the
  circle, over the page background. Circle mode therefore moves the label into a
  caption UNDER the card, and the preview pill is centred rather than
  bottom-anchored for the same reason — a bottom-anchored pill pokes out of the
  round edge.

**Not verified on this machine:** the rendered result. 104 px, the ×1.6 rectangle
slot and the circle padding are judgements reasoned from the arithmetic, not
measurements — the Captain's screen is the only thing that can settle them.

**Evidence:** guard 9/9, importer 16/16, persistence 35/35, render-smoke 3/3,
preview-pill 8/8, export 4/4; `node --check` clean; backend 34/34;
`hermes plugins validate .` → Validation passed.

---

## F4 — Import from more sources — DONE for 3 of 4 formats

**Research first.** A read-only scout fetched the specs and reference
implementations before any parser was written (evidence rule: cite the file, or
mark it unverified). Its adoption order is followed: Windows Terminal →
Base16/24 → VS Code, iTerm2 deferred.

**Design deviation from the original sketch.** The plan said one
`parseToColors(text, format)` interface, which asks the user to pick a format.
Shipped instead: `parseImportedTheme(text)` **sniffs** the format (plist → JSON
split by shape → TweakCN CSS → Base16 YAML). The user pastes text; making them
name the format is a question the parser can answer itself.

- [x] **Windows Terminal** — single scheme or a whole `settings.json`; when several
      schemes are present it selects `profiles.defaults.colorScheme` (the one the
      user is actually running) and otherwise falls back to the first
- [x] **Base16 / Base24** — both spec generations: legacy flat (bare hex, no `#`)
      and Tinted 0.11 nested `palette:` (explicit `variant:`). One line-regex, no
      YAML library — the plugin is plain ESM with **no `package.json`**, so no
      npm parser could be added (that constraint was confirmed, not assumed)
- [x] **VS Code** — workbench `colors`, tolerant of comments and trailing commas
      because `colorThemeSchema.ts` allows both, so `JSON.parse` alone would
      reject a file VS Code accepts. Syntax-only themes (no `colors` block) are
      **refused with the reason**, not imported as an empty palette
- [x] **iTerm2 — DEFERRED.** Three extra burdens for the least Windows-relevant
      format: XML plist parsing with no deps, the P3 colour-space matrix, and
      ANSI-only mapping. It is *recognised* by the sniffer and refused by name
      rather than silently treated as unrecognised text
- [x] `normHex` normalises every colour to `#rrggbb` and drops alpha **deliberately**
      — the backend's `_hex` discards alpha anyway, so flattening here is visible
      instead of silent at the API
- [x] Single-palette sources report `modeSupport` as `light` or `dark`, never
      `dynamic`: two identical palettes would offer a light/dark toggle that
      changes nothing. `'dark'` was already first-class (group "Dark Mode Only",
      ☾ badge, `nextMode`), so dark-only schemes land honestly
- [x] Provenance is per-source (`windows-terminal` / `base16` / `vscode`), gated
      by `IMPORT_SOURCES` so a stray localStorage entry cannot become a card
- [x] Mapping tables grounded in a spec (Base16 `baseNN` roles) vs. the guesses
      (ANSI roles for Windows Terminal, `baseNN` → design tokens) are labelled as
      guesses at the point of use, and the shaping MIT sources are credited in
      `THIRD_PARTY_NOTICES.md`

**Three real defects the tests caught before wiring — not staged injections:**

1. iTerm2 detection matched only the `<plist`/doctype prologue, but every real
   file opens with `<?xml ...?>`, so all of them fell through to the generic
   "could not recognise" error.
2. A syntax-only VS Code theme has no `colors` key at all, so it was not
   recognised as VS Code — the user was told the *format* was unknown instead of
   being told no workbench palette exists.
3. `assert.rejects` silently misses a synchronous throw; the assertions now use
   `async` arrows.

A fourth was mine and would have shipped: a second `function luminance()` that
shadowed the existing one module-wide. Naive scores `#808080` at `0.502` (light)
and WCAG at `0.216` (dark), so `renderedModeFor`'s `0.5` threshold would have
repainted mid-tone themes in the wrong mode. Deleted; the existing helper is
reused.

**Evidence:** `tests/import-formats.test.mjs` 11/11, export 4/4, render-smoke
3/3, surfaces 9/9, tweakcn-import 16/16, persistence 34/34, backend 34/34,
`hermes plugins validate .` → Validation passed. `rigour scan` FAIL 45 —
identical to F3 (same severity breakdown, zero new finding types).

---

## F5 — Per-profile skins — DONE (scoped apply), limitation recorded

**The correction that made this small.** Per-profile *Desktop* themes are the
Desktop's own native behaviour, not something to build: `ThemeProvider` persists
the active skin per profile (`profilePref` -> `skinPref` -> `PROFILE_SKINS_KEY`,
with the legacy global `SKIN_KEY` only as inheritance fallback), and
`setTheme()` does `skinPref.assign(liveProfile(), next)`. Chroma already inherits
that, because it applies through `setTheme()`.

So F5 was never "build per-profile skins". It was **"stop our own gateway
broadcast flattening the per-profile choice."**

### Delivered

- [x] `APPLY_SCOPE_KEY = 'chroma-apply-scope-v1'` — plugin-owned, stored per
      profile. Never an app-owned `hermes-desktop-*` key
- [x] Scope control in the picker toolbar: **This profile** vs **Everywhere**
- [x] `This profile` -> `setTheme` only; the app's per-profile persistence does
      the rest, and **no `config.set` is issued**
- [x] `Everywhere` -> unchanged: `setTheme` + `config.set`, keeping the
      write-then-activate ordering that imported skins depend on
- [x] All three gateway writes gated: `syncSceneToGateway`, the import path, and
      the rename `wasActive` re-broadcast
- [x] **The badge no longer lies.** With a local scope a gateway-capable scene
      does not reach the CLI, so `CliBadge` renders `cli off` instead of a `CLI`
      the scope suppresses — the tooltip says why
- [x] **Verified before wiring:** the plugin's `skin.changed` handler only
      DISCOVERS (feeds the `live` list); it never applies. So an inbound
      broadcast cannot be applied into a locally-scoped profile by us
- [x] Default is `Everywhere` — today's behaviour. Silently flipping what every
      existing pick does would repeat the gateway-sync removal

### The limitation, stated plainly

**Per-profile *CLI* skins are not achievable and are not attempted.**
`display.skin` is one global value and two profiles' CLIs can run at once, so the
CLI cannot show two skins simultaneously. One unavoidable consequence: under
`This profile` the CLI keeps whatever `display.skin` was last set to, so it can
**disagree** with the active Desktop profile. That is inherent to a single global
value — it is stated here rather than discovered later.

### Not done

- [ ] Option B — "pin this profile so an inbound broadcast cannot rewrite it".
      This means re-asserting via `setTheme` when a `skin.changed` arrives while
      pinned. A legitimate SDK call, not the old CSS-var band-aid — but still a
      race against the ThemeProvider, which is the exact failure this project came
      from. Deliberately not in the first cut
- [ ] **Verify on the G15.** This is renderer behaviour (a scope control plus a
      conditional badge); tests and source prove the logic, not the pixels

**Evidence:** persistence 34/34 (was 30 — 4 scope tests), guard 9/9, importer
16/16, backend 34/34; `hermes plugins validate .` -> Validation passed.
The load-bearing assertion is the NEGATIVE one:
`a profile-scoped pick repaints locally and sends NO gateway broadcast` proves
zero `config.set`, which a positive-only test could never do.

---

## P0 — The picker shipped dead (missing react hooks) — FIXED

`ThemeCard` called `useRef(null)` (F6, `7637536`) and `ThemePicker` called
`useCallback` (F1, `bf36a63`) while the react import still read
`{ useEffect, useMemo, useState }`. Neither name exists as a global — they can
only arrive through the import — so **the Chroma page threw
`ReferenceError: useRef is not defined` on first render.**

**Why every suite stayed green:** both harnesses hand-wrote a `useRef` and
`useCallback` stub into their VM context. The harness supplied exactly what the
import forgot, so the tests asserted a world the app does not have.

**Fixed:** import is now `{ useCallback, useEffect, useMemo, useRef, useState }`.

**The class of bug is closed, not the instance** — `tests/render-smoke.test.mjs`
reads the SHIPPED file's own import statements and injects only those names.
Any identifier the module uses but does not import is undefined there, exactly
as in the app. Three assertions:

- every hook the build uses is present in the react import
- `register()` runs and both render surfaces (`chroma-page`, `chroma-chip`) render
- `ThemeCard` / `ThemePicker` / `ThemeChip` component bodies execute

**Fault-injected to prove it bites:** removing both hooks from the shipped
build fails all 3 tests (exit 1); restoring passes 3/3.

**Serena blind spot worth knowing:** `get_diagnostics_for_file` on this file
returns only "cannot find module" entries — it does NOT report the undefined
hooks. `.js` without `checkJs` lets TypeScript treat unknown globals as legal,
so LSP diagnostics cannot catch this family here. The VM harness is the
instrument that can.

---

## Review

- [ ] Surfaces guard passes — nothing amputated
- [ ] `hermes plugins validate .` still prints `Validation passed`
- [ ] Every feature has named evidence (test output or endpoint result), not a claim
- [ ] F5's limitation is written down, not glossed
- [ ] A diff read asking one question: **what did I delete, and did I tell the Captain?**

---

## Verification commands

```bash
python scripts/regenerate.py                                    # ALWAYS after editing the template
node --test tests/render-smoke.test.mjs                         # the render guard (3) — proves the build resolves its own imports
node --test tests/export.test.mjs                               # F3 export mapping (4)
node --test tests/import-formats.test.mjs                       # F4 import formats (11)
node --test tests/surfaces-regression.test.mjs                  # the safety net (9)
node --test tests/tweakcn-import.test.mjs                       # importer (16)
node --test tests/theme-persistence.test.mjs                    # apply/paint/gateway (34)
/hermes/venv/Scripts/python -m unittest tests.test_plugin_api   # backend (34)
rigour scan                                                     # zero-config gate (no rigour.yml in this repo; `check` exits 2)
hermes plugins validate .                                       # catalog admission gate
```

**The tests load `desktop/plugin.js`, not the template** — an unregenerated
template is invisible to every suite. Regenerate or you are testing the past.

---

## Tooling enablement — Serena and Rigour

Both were used during this campaign, which is not the same as being enabled for the
project. Two gaps were closed.

**Serena.** The server was already running (port 9123) with this project in its single
shared active slot, but the project had NO memories at all. Onboarding is now complete:
`mem:core` as the entry point, plus `tech_stack`, `suggested_commands`, `conventions`
and `task_completion`, and per-module `mem:desktop/core` and `mem:backend/core`. They
record the invariants that are expensive to rediscover — the template-vs-generated-build
rule, the three resolvable specifiers, the missing-hook defect and why the harness must
derive its stubs from the build's own imports, `previewTheme` repainting the whole app,
`chroma-*` storage keys only, backend route order, and `normHex` dropping alpha on
purpose — and they point at `docs/SPEC.md`, `ARCH.md`, `DECISIONS.md` and `TASKS.md`
rather than duplicating them. `serena memories check` reports no referential integrity
issues.

**Rigour.** The repo had no `rigour.yml`, so `rigour check` and `check --ci` exited 2
(CONFIG_ERROR) with no output at all — which reads as a broken gate rather than a
missing config, and is why every earlier run in this repo used the zero-config `scan`.
The standard generated file is now adopted UNMODIFIED: its thresholds are the standard,
tuning them to pass would defeat the gate, and the file itself says not to modify it.

**The four required docs were 0-line stubs** that `rigour init` wrote to satisfy
`structure-check`. Files that exist only to satisfy a checker are not documentation, so
all four now carry real content: `docs/SPEC.md` (what it is, surfaces, route contract,
import rules, non-goals, acceptance), `docs/ARCH.md` (layout, build pipeline, runtime
constraints, transport, appearance and storage ownership, test architecture),
`docs/DECISIONS.md` (twelve decisions with their reasons and costs) and `docs/TASKS.md`
(open work with the trigger that brings each item back). `structure-check` passes because
the documents exist, not because placeholders do.

**Pruned** the editor integration `rigour init` also installed (`.claude`, `.cursor`,
`.gemini`, `.clinerules`, `.windsurf`, `.windsurfrules`, `CLAUDE.md`): this project's
agents are Hermes and Pi, and rigour is already an MCP server for them, so those files
wired editors we do not use into a public repo. Regenerable with `rigour init --ide all`.
Kept `AGENTS.md` and `docs/AGENT_INSTRUCTIONS.md`, which are tool-agnostic.

**Evidence:** `rigour check --ci` → exit 1, FAIL, 16 violations, 37/100 with
`structure-check` and `test-quality` PASS. The per-file probe unlocked by having a config,
`rigour check --no-cache desktop/plugin.template.js` → exit 1, 55/100 (a subset score, so
it is not comparable with the full-scan number). `hermes plugins validate .` → Validation
passed. 88 JS tests and 34 backend tests green.

**A real finding that `check` surfaced and `scan` could not:** `skinToDesktopTheme` has
cyclomatic complexity 24 against a max of 10. Logged in `docs/TASKS.md` with the note that
it must be reduced by removing actual branching, not by relocating it into helpers.

---

## Complexity reduction - batch 1 (four functions, parity-proven)

**The gate named one function. There were seventeen.** `rigour` reports only the
worst offender and truncates its list ("showing first 5 violations"), so the real
worklist had to be derived: a probe that loads the gate's OWN bundled TypeScript
(5.9.3) and reproduces its exact rule - `gates/ast-handlers/typescript.js:176`:
start at 1, count `if`/`case`/`default`/all loops/ternaries/`&&`/`||`, **`??` is not
counted**, and a nested function-like node is excluded because it has its own
budget. The probe reproduces rigour's own answer for the named function (24)
exactly, which is what makes the rest of the list trustworthy.

Over budget, before: `ThemeCard` 32, `tweakcnColors` 27, `skinToDesktopTheme` 24,
`vsCodeTheme` 23, `parseImportedTheme` 20, `perform` 20, `stripJsonNoise` 16,
`applyDesktopTheme` 16, `importTweakcn` 16, `tweakcnToDesktopTheme` 15,
`normalizeLiveSkin` 15, `ThemePicker` 15, `ThemeChip` 14, `base16Theme` 13,
`cssColorToHex` 11, `windowsTerminalTheme` 11, `migrateAppearanceAliases` 11.

**Fixed in this batch (17 to 13):**

| Function | Was | Now | How |
|:--|:--|:--|:--|
| `skinToDesktopTheme` | 24 | 1 | Nine `dark ? a : b` mix ratios became the `SKIN_RAMP` table; the eight `pick(...) || fallback` call sites became `pickColor(colors, keys, fallback)`. Palette assembly now branches not at all |
| `tweakcnColors` | 27 | 7 | 22 `at(key) || fallback` lines became a spec table of `[key, aliases, fallback]`; the builder is one loop with one `||` in it |
| `parseImportedTheme` | 20 | 7 | The dispatcher split into `parseImportedJson` and `windowsTerminalFromJson`, each small enough to read; the format checks stay ordered because the order is semantic |
| `tweakcnToDesktopTheme` | 15 | 8 | CSS-var resolution moved to `tweakcnVars`; the font fallbacks stopped being repeated `||` chains |

**Parity is the proof, not the test count.** Refactoring a numeric pipeline can
move a value while every test stays green, so the mapper was pinned first: a dump
of all 104 catalog scenes (light AND dark) plus seven hand-built edge skins -
no seeds, a black surface seed, a light text seed, junk values, 3-digit shorthand -
digested per scene. The refactor then produced a **byte-identical** dump. That
comparison is now a permanent guard: `tests/scene-parity.test.mjs` against
`tests/fixtures/scene-theme-parity.json`, regenerated only by
`tests/regenerate-scene-parity.mjs` when a palette change is intended.

The guard was fault-injected before it was trusted: moving one mix ratio
(`card: 0.04` to `0.05`) failed three of its four tests; restoring returned four
green and a byte-identical source file.

One real finding from writing it: a skin's own seed colours pass through with their
original case (`#F8FAFF`) while every derived colour is lowercase, so a
lowercase-only hex assertion was wrong about the contract, not the code.

**Evidence at this commit:** scene-parity 4, tweakcn-import 16, import-formats 11,
export 4, render-smoke 3, surfaces 9, preview-pill 10, persistence 35 = 92 JS
tests, backend 34/34, `hermes plugins validate .` passed, scene parity identical.

**Remaining 13, and why they are a staged job rather than one commit:**
`ThemeCard` 32, `vsCodeTheme` 23, `perform` 20, `stripJsonNoise` 16,
`applyDesktopTheme` 16, `importTweakcn` 16, `normalizeLiveSkin` 15, `ThemePicker` 15,
`ThemeChip` 14, `base16Theme` 13, `cssColorToHex` 11, `windowsTerminalTheme` 11,
`migrateAppearanceAliases` 11. The pure mappers and parsers (`vsCodeTheme`,
`stripJsonNoise`, `base16Theme`, `cssColorToHex`, `windowsTerminalTheme`,
`normalizeLiveSkin`) can be pinned the same way the mapper now is. The React
components (`ThemeCard`, `ThemePicker`, `ThemeChip`) are the harder half: their
branching is JSX structure, so the fix is extracting sub-components and `resolve*`
helpers, and the guard is the render harness rather than a palette digest.

---

## G15 field fixes - round one (shipped 2026-10-16/17)

The Captain installed the build on his G15. First real-Electron consumption of
the plugin since the fork. Three field findings, all fixed and shipped:

| Finding | Cause | Fix | Commit |
|:--|:--|:--|:--|
| Page failed on first open with "readStoredThemes is not iterable"; worked after clicking Reload | `readStoredThemes()` returns a keyed object (the seek-and-write format `persistTheme` needs); `ensureImportedSkinsLoaded` iterated it with `for…of` | Iterate `Object.values(...)`. The finder's return contract is unchanged | `1910920` |
| No swatches visible on any card | Card body is a flex column; a horizontal strip in a `flex-col` must be given `flex-col` AND the strips need a floor, or the bands collapse to zero height | Bands carry `min-h-4` | `1910920` |
| URL / CSS import pills truncated to "U…"/"C…" | The control shares a flex row with the (flex-1) text input; the control has no shrink lock | `shrink-0` wrapper around the control; first attempt (`min-w-[6rem]` wrapper) shipped reverted because its JSX close was one brace short — the syntax error surfaced only as a v24 `Unexpected token '==='` in every suite's `loadPlugin` | `46ce117` (size toggle etc.), pill wrapper completed in the release commit |

Also shipped in this round: size toggle (S/M/L, persisted via
`chroma-card-size-v1`), label-above-swatch layout, palette as horizontal bands,
FAQ, lightbulb + preview documentation, CI workflow (green on GitHub for both
pushes). The one-behind-a-commit tracker rule lapsed here — this section is the
correction, and the version bump (2.1.0) rides with it.

**Still owed to this round:** the Captain's re-verify on the G15 (acceptance
walk), then the two-reviewer convergence round to close the `✓ Review` row.

### Round two (2.1.1): the blank swatches, root cause

The Captain re-tested 2.1.0 on the G15: swatches still blank. The 2.1.0 fix
(`min-h-4` on each band) treated a symptom. The real cause was in 2.1.0's own
layout change: the palette container carried `flex-col` but had **lost
`display:flex`**. `flex-col` sets only `flex-direction`; without `display:flex`
the container is a block, the `<span>` bands stay inline, and `width` /
`min-height` / `flex` do not apply to inline elements — zero size, no paint.
Restored to `flex flex-col`.

Why the harness missed it: the card parity test digests structure and class
strings, so a class that no longer produces layout is invisible to it. Options
were a real browser (not in this harness) or a class-contract assertion. Chose
the assertion: `tests/theme-card.test.mjs` now finds the palette container and
requires the whole token `flex` and a `backgroundColor` per band. It was
fault-injected to prove it fails, and that exposed a bug in the guard itself —
`'flex-col'.includes('flex')` is true, so the first version passed a broken
build. It matches whole tokens now.

**Lesson to keep:** when a Tailwind class string changes, the digest cannot see
the visual result. Any class that carries layout must be asserted as a token.

### Round three (2.2.0): the G15 polish batch

The Captain, after 2.1.1 looked right on the G15: circle label position, bigger
base size, a grouping switch, and a compact settings row.

| Item | What shipped |
|:--|:--|
| Circle name | Moves above the circle (a rounded-full box never clipped the label, so "inside" was never possible) |
| Base size | 104 -> 132; S/M/L multipliers unchanged |
| Grouping | New "By theme" lens, 7 categories, switched by a dropdown that persists per profile |
| Settings row | Four stacked controls -> one wrapping line; the mode control keeps glyphs only |
| Category assignment | Derived from the palette, not hand-listed; distribution Cool 22 / Warm 17 / Nature 5 / Vibrant 8 / Minimal 5 / Light 8 / Dark 39 |

**Decisions worth remembering:**

1. **The classifier measures chroma, not HSL saturation.** HSL reports ~1.0
   saturation for a barely-tinted near-white, so the first classifier called
   every plain background "fully saturated" and collapsed the catalog. Absolute
   chroma (max channel minus min) does not move with lightness. Any future
   colour-character work in this repo must use chroma for the same reason.
2. **A shipped category must never be empty.** The test asserts it. "Pastels"
   was requested and measured out: zero qualifying scenes, since the only
   pale-accent candidates are three purple dark themes. It was dropped rather
   than shipped as a divider that renders nothing, and the finding is recorded
   here so nobody re-adds it by guessing.
3. **The nature/vibrant boundary is muted-vs-synthetic, not hue alone.** Greens
   below 0.45 chroma are forests and sages; louder greens are neon and derive
   to Vibrant, because "cyberpunk" filed under Nature is a visible lie.

**Still owed:** the Captain's G15 walk on 2.2.0 (dropdown switching, the new
category sections, the circle caption), then the convergence review round.
