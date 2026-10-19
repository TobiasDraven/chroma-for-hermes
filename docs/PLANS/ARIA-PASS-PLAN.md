# ARIA pass — plan v2 (C9)

**Status:** PLANNED · **Owner:** Faris · **Date:** 2026-10-19 · **Version target:** 2.9.0
**Review:** `docs/REVIEWS/ARIA-PLAN-REVIEW-2026-10-19.md` — REQUEST-CHANGES, 11
findings, **all accepted**. v2 carries every one of them.

Closes the last open roast item (C9) before the public release. Evidence:
`docs/REVIEWS/ARIA-SCOUT-2026-10-19.md` (12 ranked gaps, G1–G12, cited to
`file:line`); the scout's load-bearing claims and the reviewer's were both
re-verified against the code by the parent.

## Goal

A screen-reader user can tell what every control does and what state the pane is in.
A keyboard user can reach and operate every control without losing their place.
Nothing is conveyed by colour alone.

## Non-goals

- **No host changes.** `SegmentedControl` exposes no group/per-option label prop
  (`segmented-control.tsx:6-18`); word labels are the only route and are sufficient.
- **No visual redesign — with one named exception.** WS2 replaces the segmented
  controls' glyph/letter labels with words, and the host renders `label` **visibly**
  (`segmented-control.tsx:40-52`), so those controls grow. That is a visible change,
  acknowledged here rather than hidden behind the non-goal. Verify the settings row
  still lays out at the narrow breakpoint; shorten the words if it does not.
- No new dependency, no `${...}` template literals, no behaviour change beyond
  accessibility and focus management.

## Workstreams

### WS1 — The dialogs become real modals (G1) — highest impact

`ModalShell` (packs, categories) and `EditorModal` set `role='dialog'` and
`aria-modal='true'` and then do nothing: no focus in, no trap, no document-level
Escape, no focus restore. `aria-modal` currently lies — it tells the AT the
background is inert while it is still tabbable.

1. On open, move focus into the sheet: the first focusable element, else the close
   button. Capture `document.activeElement` at open time (the trigger buttons persist
   in the tree while a dialog is open, so this is viable).
2. Trap Tab and Shift+Tab inside the sheet.
3. Listen for Escape at the **document** level while open — the handler on the overlay
   only fires once focus is inside it, which is why Escape does nothing right after
   opening.
4. On close, restore focus to the captured element. The effect must be idempotent:
   `EditorModal` remounts on Reset via `key`/`editorEpoch` (T:5803), so it must not
   fight a restore.
5. Add `aria-labelledby` (title) and `aria-describedby` (subtitle) with **unique ids**.
   **Keep `aria-label` as well** — `tests/editor-modal.test.mjs:206-208` pins
   `aria-label='Edit Ocean Skin'`; `aria-labelledby` wins for naming and the
   duplicate text is harmless. Ids must be unique because `ModalShell` is
   instantiated twice (packs T:3770, categories T:3833) and `EditorModal` remounts:
   pass an id prefix in as a prop rather than hard-coding one.

If a real trap cannot be achieved, **drop `aria-modal`** rather than lie.

### WS1b — Rename and delete must not drop focus (G4)

`ThemeCardActions` swaps the three manage buttons for the rename/delete rows
(T:3172-3185) and neither replacement focuses anything, so focus falls to `<body>`.

- On `startRename`: focus the input (a ref + effect, or `autoFocus`).
- On `startConfirm`: focus **No** — the safe default.
- On cancel: return focus to the Rename/Delete button.
- Add `aria-label='New name for <skin>'` to the input (WS2 already names it).

### WS2 — Names (G3, G10, G12)

- Segmented controls: words, not glyphs — `Dark`/`Light`, `Square`/`Rectangle`/
  `Circle`, `Small`/`Medium`/`Large` — each group wrapped in
  `role='group' aria-label='…'`. **Visible change: see the non-goal above.**
- Preview pill: a stable skin-scoped `aria-label` (`Preview <skin> for 10 seconds` /
  `Stop previewing <skin>`); the visible countdown stays for sighted users and is
  never the accessible name.
- Item-scoped names on every repeated verb: `Export <skin>`, `Rename <skin>`,
  `Delete <skin>`, `Save rename of <skin>`, `Delete category <name>`,
  `Skip <colliding skin>`, and on the pack rows `Export <pack>` / `Delete <pack>`.
- `aria-label` on the unlabelled inputs: rename (T:3085), category create (T:3850,
  T:3859), pack import (T:5424, T:5451), the group lens (T:5575), the import
  textarea (T:5662, T:5663), the skip/rename input (T:4442).
- `aria-hidden='true'` on the decorative dots (header T:5539, rail T:4199, chip
  T:5858).
- Statusbar active-theme button: `aria-label='Active theme: <name> — open Chroma'`.
- Star grammar: `Add <skin> to favourites` / `Remove <skin> from favourites`.
- The skip control gains `aria-pressed` for its skipped state.

### WS3 — State and structure (G6, G7, G8)

- **The card button gets an explicit, concise accessible name** —
  `Apply <skin label>` (with its mode support). Today the name is computed from
  content, which is how a child's text leaks in (F4). This also gives circle cards a
  name: for them the palette is the button's only child, so today their name is
  nothing but the palette.
- `aria-current='true'` on the active card's button, every shape. Circle cards keep
  the visual badge suppressed; the state rides on the button as an attribute, so **no
  new child is added inside the button** (`theme-card.test.mjs:136` pins a circle
  card's button to exactly one child).
- Errors: an `id`-ed message per field with `aria-describedby` pointing at it, and
  `role='alert'` on the fork error. `aria-invalid` alone announces "invalid" and not
  why.
- Landmarks and headings: `aside` gets `aria-label='Favourites'`; each group title
  becomes a real heading with the owning `section` carrying `aria-labelledby`; the
  card grid becomes `role='list'` with `role='listitem'` wrappers; the scroll region
  is labelled and focusable.
- Contrast chip: set the chip's `aria-label` from its existing `title` (which already
  says "below the N:1 advisory target"). **Do not append a child span** —
  `tests/editor-modal.test.mjs:183` pins the chip's children to the string `'2.00:1'`.

### WS4 — Content, live regions, focus, tab order (G2, G5, G9, G11)

- **Palette:** `role='img'` with a **concise** `aria-label` (the skin's name plus
  the mode and the band count — not twelve hex values; a hex wall inside every card's
  name is the F4 defect). The detailed values stay visible as swatches. In the editor
  the strip is decorative: `aria-hidden='true'`, because the fields carry the data.
- **One visually hidden `aria-live='polite'` region, placed in the overlay as a
  sibling of the sheet** — not in the editor body, which
  `tests/editor-modal.test.mjs:218` pins to exactly five children. Written on
  **discrete** events only: preview start, preview end, "Unsaved changes", collision,
  and the busy outcomes (Saving…/Deleting…/Working…). The countdown updates four
  times a second and must never be live.
- **Colour well:** the host's exact focus pair, verified present in the compiled
  stylesheet — `focus-within:outline-2 focus-within:outline-ring` (as the host uses
  at `accent-swatch.tsx:33`). Plain `focus-within:outline` and
  `outline-(--ui-accent)` are **not** in the host CSS and would be flagged by
  `check-host-classes`.
- **Tab order — one stop per card, enumerated.** The roving sets are:
  1. the **card button** (apply) — always `tabIndex=0`;
  2. the **action toolbar**: preview pill + star + Edit + Fork, `role='toolbar'
     aria-label='<skin> actions'`, every member `tabIndex=-1` until the card is
     focused, when ArrowDown/ArrowRight enters the set and the first member becomes
     tabbable;
  3. the **manage toolbar** (owned cards only): category select + Export + Rename +
     Delete, same pattern, entered from the card with a second ArrowDown.
  Escape from a toolbar returns to the card. Result: **one tab stop per card**,
  whatever it owns. A mouse user loses nothing — every control stays visible and
  clickable; only the tab sequence changes.

## Test strategy — and its honest boundary

**Unit-testable in the VM harness** (attribute presence and value): every name in
WS2, `aria-current`, `aria-hidden` on dots, `role='img'` + the palette `aria-label`,
`aria-describedby` wiring, `role='list'`/`listitem`, heading roles, the chip's
`aria-label`, `tabIndex` values for the roving sets, `role='toolbar'`, and the live
region's **presence and `aria-live` value**.

New file: `tests/aria.test.mjs`. It must fail against the current build.

**NOT unit-testable, and the plan does not claim otherwise:**
- The live region's *text* after an event. The harness stubs `useState` to a no-op
  setter and `useEffect` to nothing (`tests/helpers/load-plugin.mjs:124-128`), and
  the events live in `ThemePicker` state. Only presence and the `aria-live` value are
  assertable. If an `announce(...)` helper is extracted, that helper gets a pure unit
  test.
- Focus in on open, the Tab trap, document-level Escape, focus restore, and the
  roving key handling. The harness has no `activeElement`, no `document` and no
  layout. A headless `--dump-dom` render can show initial focus and a dispatched
  Escape; it **cannot** show Tab traversal or focus restore. Those are verified by
  the Captain's G15 walk, and the changelog will say so.

## Files

- `desktop/plugin.template.js` — the only source file.
- `tests/aria.test.mjs` — new.
- `tests/fixtures/theme-card-parity.json` — regenerated by the repo's own generator
  (`tests/regenerate-theme-card-parity.mjs`). `digestElement` copies **all** props, not
  just className (`tests/helpers/card-cases.mjs:139-153`), so every `aria-*` and
  `tabIndex` addition moves this fixture. Never hand-edit it.
- `tests/fixtures/scene-theme-parity.json` — unaffected (it hashes palette values,
  not render).
- `VERSION`, `plugin.yaml`, `dashboard/manifest.json`, `BUILD_STAMP` — the lockstep
  2.9.0 bump. `check-package.py` requires all four to agree; `regenerate` can only
  reproduce a stamp the template already holds.
- `docs/PLANS/ARIA-PASS-PLAN.md` (this file), `CHANGELOG.md`, `AGENTS.md` (a11y rules
  for future lanes), `docs/REVIEWS/` (C9 closed with its evidence).

## Gates

`node --test tests/*.test.mjs` · `python -m pytest tests/ -q` · `check-packs` ·
`check-package` · `check-host-classes` (exit 0) · `regenerate` deterministic ·
`hermes plugins validate .` · **`rigour check --ci`** — new branches land in
`ThemeCard`, `EditorModal` and `ModalShell`; record the finding list (not the score
band) and adjudicate any new HIGH in `docs/TASKS.md`, as the repo does.

## Sequencing

WS1 → WS1b → WS2 → WS3 → WS4, each verified before the next. One implementer lane
with this plan as its brief; the parent verifies the diff, re-runs every gate, and
commits.
