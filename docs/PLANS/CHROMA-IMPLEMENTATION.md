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
| F6 | Square-card picker UI | done | `7637536` |
| F4 | Import from more sources | **NOT STARTED** | — |
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

## F1 — Delete and rename a skin — BACKEND DONE, UI OPEN

**Status is deliberately split.** The backend is complete and tested; the
user-visible part is not built yet, and calling this "done" on the strength of a
green test count is the exact failure this session has been recovering from.

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
- [x] Hover preview: `previewTheme(scene.name, mode)` after a 140 ms debounce,
      `clearThemePreview()` on leave, and the timer cleared on unmount. Debounced
      because a preview repaints the whole app and a 100+ card grid would thrash
      on mousemove; cleaned up because a preview left armed when the card
      unmounts strands the user on a theme they never chose — the exact bug class
      this plugin exists to remove
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

**Evidence:** guard 9/9, importer 16/16, persistence 34/34, render-smoke 3/3;
`node --check` clean; `hermes plugins validate .` → Validation passed.

---

## F4 — Import from more sources

Parsers live in JS beside `parseCssTheme`, behind one `parseToColors(text, format)`
interface, reusing the backend writer so every source mints a REAL gateway skin.

- [ ] VS Code theme (`.json`, `colors` map)
- [ ] Windows Terminal scheme (`.json`)
- [ ] Base16 / Base24 (fixed 16-colour contract)
- [ ] iTerm2 (`.itermcolors`, XML plist — `DOMParser` is available)
- [ ] One fixture + one test per format; token mapping is a judgement call and
      lossy, so the mapping table is written down
- [ ] Each needs a mocked `fetch` in the harness if it fetches

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
node --test tests/surfaces-regression.test.mjs                  # the safety net (9)
node --test tests/tweakcn-import.test.mjs                       # importer (16)
node --test tests/theme-persistence.test.mjs                    # apply/paint/gateway (34)
/hermes/venv/Scripts/python -m unittest tests.test_plugin_api   # backend (34)
rigour scan                                                     # zero-config gate (no rigour.yml in this repo; `check` exits 2)
hermes plugins validate .                                       # catalog admission gate
```

**The tests load `desktop/plugin.js`, not the template** — an unregenerated
template is invisible to every suite. Regenerate or you are testing the past.
