# ARIA pass — plan (C9)

**Status:** PLANNED · **Owner:** Faris · **Date:** 2026-10-19 · **Version target:** 2.9.0

Closes the last open roast item (C9, accessibility) before the public release. Input:
`docs/REVIEWS/ARIA-SCOUT-2026-10-19.md` (12 ranked gaps, G1–G12, every claim cited
to `file:line`). The scout's load-bearing claims were re-verified against the code
by the parent before this plan was written: the dialog shells have no focus
management at all, the palette swatches carry no text alternative, the rename and
delete transitions unmount the focused button with no replacement focus, circle cards
suppress the state badge, and the colour well has no focus ring.

## Goal

A screen-reader user can tell what every control does and what state the pane is in.
A keyboard user can reach and operate every control without losing their place.
Nothing is conveyed by colour alone.

## Non-goals

- No host changes. `SegmentedControl` exposes no group/per-option label prop
  (`segmented-control.tsx:6-18`); the workaround is word labels, which is sufficient.
  A host-side optional `aria-label` prop is a genuine SDK improvement but is NOT part
  of this pass.
- No visual redesign. Every change is an attribute, a role, a focus routine, or
  visually-hidden text.
- No new dependency, no `${...}` template literals, no behaviour change beyond
  accessibility.

## Workstreams

### WS1 — The dialogs become real modals (G1) — highest impact

`ModalShell` (packs, categories) and `EditorModal` today set `role='dialog'` and
`aria-modal='true'` and then do nothing: no focus in, no trap, no document-level
Escape, no focus restore. `aria-modal` currently lies — it tells the AT the
background is inert while it is still tabbable.

1. On open, move focus into the sheet: the first focusable element, else the close
   button. Capture `document.activeElement` at open time.
2. Trap Tab and Shift+Tab inside the sheet.
3. Listen for Escape at the **document** level while open (the handler on the overlay
   only fires once focus is inside it — that is the reported "Escape does nothing
   right after opening").
4. On close, restore focus to the captured element.
5. Wire `aria-labelledby` to the visible title's `id` and `aria-describedby` to the
   subtitle's `id`, instead of duplicating the text in `aria-label`.

If a real trap cannot be achieved, **drop `aria-modal`** rather than lie. The trap is
achievable: the sheet is a bounded subtree.

### WS2 — Names (G3, G12)

- Segmented controls: pass words, not glyphs — `Dark`/`Light`, `Square`/`Rectangle`/
  `Circle`, `Small`/`Medium`/`Large` — and wrap each group in
  `role='group' aria-label='…'`.
- Preview pill: a stable, skin-scoped `aria-label` (`Preview <skin> for 10 seconds`
  / `Stop previewing <skin>`); the visible countdown stays for sighted users and is
  NOT the accessible name.
- Repeated row verbs: item-scoped names — `Export <skin>`, `Rename <skin>`,
  `Delete <skin>`, `Save rename of <skin>`, `Delete category <name>`, `Skip <pack>`.
- The unlabelled text inputs get `aria-label`: rename (T:3085), category create
  (T:3850, T:3859), pack import (T:5424, T:5451), the group lens (T:5575), the
  import textarea (T:5662, T:5663), the skip input (T:4442).
- Decorative dots get `aria-hidden='true'` (header T:5539, rail T:4199, chip T:5858).
- Statusbar active-theme button: `aria-label='Active theme: <name> — open Chroma'`.
- Star grammar: `Add <skin> to favourites` / `Remove <skin> from favourites`.

### WS3 — State and structure (G6, G7, G8, G10)

- `aria-current='true'` on the active card's button, for every shape; circle cards
  keep the visual badge suppressed but gain a visually hidden `Active` text.
- Errors: an `id`-ed message per field with `aria-describedby` pointing at it, and
  `role='alert'` on the fork error. `aria-invalid` alone announces "invalid" and not
  why.
- Landmarks and headings: `aside` gets `aria-label='Favourites'`; each group title
  becomes a real heading (`role='heading' aria-level='3'` or an `<h3>`) with the
  owning `section` carrying `aria-labelledby`; the card grid becomes `role='list'`
  with `role='listitem'` wrappers; the scroll region is labelled and focusable.
- Contrast chip: append a visually hidden ` — below the N:1 advisory target` (or set
  the chip's `aria-label` from its existing `title`, which already says it).

### WS4 — Content, live regions, focus, tab order (G2, G9, G5, G11)

- Palette: `role='img'` with an `aria-label` naming the six bands and their hex per
  mode, built by concatenation (no template literals). In the editor the strip is
  decorative — `aria-hidden='true'` — because the fields carry the data.
- One visually hidden `aria-live='polite'` region, written on **discrete** events
  only: preview start, preview end, "Unsaved changes", collision. The countdown
  updates four times a second and must never be live.
- Colour well: a `focus-within` ring on the `<label>` (the host does exactly this at
  `accent-swatch.tsx:33`), so the keyboard path to the platform picker is visible.
- Tab order: the card is one stop and the action row is a roving set — card
  `tabIndex=0`, actions `tabIndex=-1`, ArrowRight/ArrowDown from the card enters the
  row and makes the first action tabbable, Escape returns to the card. The row gets
  `role='toolbar' aria-label='<skin> actions'`. Rationale: 5–9 stops per card × 30+
  cards is a wall of micro-controls before the next group.

## Test strategy — and its honest boundary

**Unit-testable in the VM harness** (attribute presence and value): every name in
WS2, `aria-current`, `aria-hidden` on decorative dots, `role='img'` + the palette
`aria-label`, the live region's existence and its text after a discrete event,
`aria-describedby` wiring, `role='list'`/`listitem`, heading roles, the chip's
sr-only sentence, `tabIndex` values for the roving set, `role='toolbar'`.

New file: `tests/aria.test.mjs`. It must fail against the current build.

**NOT unit-testable** — the harness executes components against a fake tree with no
real focus, no `document`, no layout: focus-in on open, the Tab trap, document-level
Escape, focus restore, and the roving-tabindex key handling. These are verified by
(a) a headless render on the desktop box (the parent's recipe: headless Edge +
`--dump-dom` with measurements written into an attribute) and (b) the Captain's G15
walk. The plan does not claim a test for them, and the changelog will not either.

## Files

- `desktop/plugin.template.js` — the only source file.
- `tests/aria.test.mjs` — new.
- `tests/fixtures/theme-card-parity.json` — regenerated by the repo's own generator
  if a card's rendered className changes (never hand-edited).
- `docs/PLANS/ARIA-PASS-PLAN.md` — this file.
- `CHANGELOG.md`, `AGENTS.md` (a11y rules for future lanes), `docs/REVIEWS/` (C9
  closed with its evidence).

## Gates

`node --test tests/*.test.mjs` · `python -m pytest tests/ -q` · `check-packs` ·
`check-package` · `check-host-classes` (exit 0 — any new class must be one the host
generates, or inline) · `regenerate` deterministic · `hermes plugins validate .`.

## Sequencing

WS1 → WS2 → WS3 → WS4, each verified before the next. One implementer lane with this
plan as its brief; the parent verifies the diff, re-runs every gate, and commits.
