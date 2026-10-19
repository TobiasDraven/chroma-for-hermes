# Review — ARIA pass plan (C9)

**Verdict: REQUEST-CHANGES**

Reviewed 2026-10-19 against the tree at `C:/DEV/hermes-theme-picker`
(`desktop/plugin.template.js`, the JS suites, and the installed host sources under
`C:/Users/malan/AppData/Local/hermes/hermes-agent/apps/desktop/src`). Read-only:
no edits, no regenerate, no gates that write artifacts. Every load-bearing claim
below was opened and checked. Citations `T:NNN` = `desktop/plugin.template.js:NNN`.

The plan is close and its diagnosis is sound, but it drops one ranked gap (G4),
claims two verifications it cannot perform, breaks a pinned test without saying so,
and its headline tab-order fix does not actually reach one stop per card. Those are
correctable; hence request-changes rather than reject.

---

## Findings, ranked

### F1 (high) — G4 is silently dropped: rename/delete focus transitions are in no workstream
The scout ranks G4 (`docs/REVIEWS/ARIA-SCOUT-2026-10-19.md:356-370`): opening
`ThemeCardRename`/`ThemeCardDeleteConfirm` unmounts the focused button and does not
move focus to the replacement, so focus falls to `<body>`. The plan's workstreams
cover G1,2,3,5,6,7,8,9,10,11,12 (lines 32, 52, 69, 83) and never mention
`startRename`, focusing the rename input, focusing "No" on the delete confirm, or
returning focus on cancel. The mechanism is confirmed live: `ThemeCardActions`
swaps the three manage buttons for the rename/delete rows via `renaming`/
`confirming` (T:3172-3185), and the rename input has no `autoFocus`/ref
(T:3083-3105).

**Recommended change:** add an explicit workstream item (or fold into WS4) that
mirrors G4's fix shape: focus the input on `startRename`, focus "No" (safe default)
on `startConfirm`, return focus to the Rename/Delete button on cancel; add the
`aria-label='New name for <skin>'` that WS2 already names. Add these to the
`NOT unit-testable` boundary and the file list.

### F2 (high) — WS1 step 5 breaks a pinned contract with no plan for it
The plan says to wire `aria-labelledby`/`aria-describedby` "instead of duplicating
the text in `aria-label`" (plan lines 46-47). `tests/editor-modal.test.mjs:206-208`
asserts the editor root's exact `role='dialog'`, `aria-modal='true'`, and
`aria-label='Edit Ocean Skin'`, and the scout lists it as pinned
(`ARIA-SCOUT-2026-10-19.md:255`). Removing `aria-label` fails that test; the plan's
Files section (lines 116-124) names no test update, and doing it by weakening the
assertion is exactly the "assertion weakened" outcome the brief asks about.

**Recommended change:** either keep `aria-label` alongside `aria-labelledby`
(`aria-labelledby` wins; the duplicate text is harmless and keeps the pinned name)
or, if it is genuinely removed, say so and update the assertion deliberately with
`ModalShell` gaining the equivalent test it currently lacks. Also pin unique ids:
`ModalShell` is instantiated twice (packs T:3770, categories T:3833) and both could
exist at once, and `EditorModal` is remounted by `editorEpoch` (T:5803), so a
hard-coded title id is a collision/regression risk. No `useId` is imported today.

### F3 (high) — WS4's roving set does not reach "one stop per card"
WS4 says "the card is one stop and the action row is a roving set" (plan lines
93-97). Two controls G11 explicitly names are not in that set:
- the preview pill is a **sibling** of the card and the in-card row, at T:4263
  (button T:2974); it is not in `rowChildren` (T:4273-4295), so it keeps its
  default `tabIndex` and stays a stop;
- the owned **manage row** (category select, Export, Rename, Delete) is a
  different container below the card frame at T:4330-4333, with no toolbar/roving
  treatment.

So the plan's rationale ("5–9 stops per card × 30+ cards", lines 96-97) is not
delivered: an unowned card is still card + pill, and an owned card is card + pill
+ four manage controls. `ARIA-SCOUT-2026-10-19.md:460-474` explicitly requires at
minimum the pill be `tabIndex=-1` with a keyboard path, and the scout lists the
manage controls in the stop count.

**Recommended change:** enumerate the controls the roving set owns. Include the
pill (either in the set, or give the card a keyboard path to preview and set the
pill `-1`), and decide explicitly for the manage row (separate labelled toolbar,
or documented residual stops). State the resulting stop count honestly.

### F4 (high) — The palette's `role='img'` name contaminates the card's accessible name; circle cards still have no name
`ThemeCardPalette` is a child of the card button for both shapes (T:4264-ish /
T:4313-4318), and the card button has no `aria-label` (T:4248-4258), so its name is
computed from content. Giving the palette `role='img'` plus a six-band × two-mode
`aria-label` (WS4, plan lines 85-87) makes every card's name include the full hex
list, and for a **circle** card the palette is the card button's only child, so the
name is *only* the palette text — the skin name lives in the caption outside the
button (T:4313-4318). The scout asserts the card's name is the label row
(`ARIA-SCOUT-2026-10-19.md:53`), which is false for circles.

**Recommended change:** give the card an explicit, concise accessible name
(e.g. `Assign/Apply <skin label>, <mode support>` plus `aria-current`) so descendant
text cannot leak into it, and give the circle card that name too. Expose the palette
via `aria-describedby` or a concise sr-only summary rather than a `role='img'`
name swallowed by the button. Keep the editor strip `aria-hidden` (that part is
correct).

### F5 (medium) — "No visual redesign" is contradicted by the SegmentedControl workaround
The non-goal says every change is an attribute, a role, a focus routine, or
visually-hidden text (plan lines 25-27), but WS2 passes words ("Dark"/"Light",
"Square"/"Rectangle"/"Circle", "Small"/"Medium"/"Large") as `label`. Verified in the
installed host: `segmented-control.tsx:40-52` renders `<span>{label}</span>` as the
visible button content, so this enlarges the controls and the settings row. The plan
is right that the SDK has no group/per-option label prop (`segmented-control.tsx:6-18`,
verified), and that the host-side prop is out of scope — but the word change is
visible, so the no-redesign claim is false as written.

**Recommended change:** keep the word labels (they are the only route) but
acknowledge the visible change in the plan and verify layout at the narrow breakpoint,
or pick shorter words. Do not advertise this workstream as "attributes only".

### F6 (medium) — Two claims of verification the plan cannot deliver
(a) `tests/aria.test.mjs` will assert "the live region's ... text after a discrete
event" (plan lines 104-105). The harness stubs `useState` to a no-op setter and
`useEffect` to nothing (`tests/helpers/load-plugin.mjs:124-128`), and the live
region's events (preview start/end, unsaved, collision) all live in `ThemePicker`
state (T:4947, T:4962-4984, T:4087-4097). No component-walk test can move that text.
(b) The plan says the Tab trap, document Escape, and focus restore are verified by
a headless `--dump-dom` render (plan lines 109-114). A DOM dump verifies initial
focus and (with a dispatched event) Escape; it cannot verify Tab/Shift+Tab
traversal or focus restore, which need real focus movement.

**Recommended change:** split the live-region test into what the harness can see
(presence, `aria-live` value, initial text) plus a pure `announcement(...)` helper
unit test if one is added; and state plainly that trap/restore are verified only by
the Captain's walk (or add a scripted driver). The boundary is otherwise honestly
stated — this is the part that overreaches.

### F7 (medium) — Regression list is incomplete and mis-stated
- The plan names only `tests/fixtures/theme-card-parity.json` and conditions
  regeneration on "if a card's rendered className changes" (lines 120-121).
  `digestElement` copies **all** props, not just className
  (`tests/helpers/card-cases.mjs:139-153`), so every card `aria-*`/`tabIndex`
  addition moves the fixture with no className change. Regeneration is intended and
  fine; the trigger described is wrong.
- Suites that pin structure the plan does not mention: `editor-modal.test.mjs:183`
  asserts `ContrastChip`'s children **is** the string `'2.00:1'`; if WS3 appends an
  sr-only span (plan line 81) rather than using the `aria-label` alternative, this
  fails. `editor-modal.test.mjs:218` asserts the editor body has exactly 5 children,
  so putting the live region in the body (WS4) fails it.
  `theme-card.test.mjs:136` asserts a circle card's button has exactly 1 child, so
  adding a hidden "Active" text **inside** the button (WS3, line 72) fails it.
- `scene-theme-parity.json` is unaffected (it hashes palette values, not render),
  so leaving it out is correct.

**Recommended change:** enumerate these and say for each whether structure is
preserved (preferred) or the test is updated deliberately; correct the fixture
trigger wording.

### F8 (medium) — The version target has no version-locus work, and `check-package` will fail
The plan sets `Version target: 2.9.0` (line 3) but its Files list (lines 116-124)
omits `VERSION`, `plugin.yaml`, `dashboard/manifest.json`, and the template's
`BUILD_STAMP` (T:58). `scripts/check-package.py:57-104` requires all four to agree;
today they are `2.8.1` (`VERSION`, `plugin.yaml:2`, `dashboard/manifest.json`). The
`regenerate` can only reproduce a stamp the template already holds, so the plan as
written leaves the release gate red.

**Recommended change:** add the version loci to Files and state the lockstep bump,
or drop the 2.9.0 target from this pass.

### F9 (medium) — Gates omit `rigour check --ci`
The Gates block (lines 126-130) runs node/pytest/check-packs/check-package/
check-host-classes/regenerate/validate but not rigour, which AGENTS §5 and §10 make
a standing verification and which this change feeds: new branches in `ThemeCard`
(key handling), `EditorModal`, and `ModalShell` (focus routines). AGENTS warns
complexity gates name the first over-budget function and that debt is tracked, not
hidden.

**Recommended change:** add `rigour check --ci` and record the finding list (not
the score band), adjudicating any new HIGH in `docs/TASKS.md` as the repo does.

### F10 (low) — WS2 is incomplete and mislabels "Skip"
- `PackRow`'s Export/Delete (T:4367, T:4376) are repeated per pack with no
  item-scoped name; the scout lists them in G3 (`ARIA-SCOUT-2026-10-19.md:334`) and
  WS2 omits them.
- "`Skip <pack>`" (plan line 61) is the wrong noun: skip is on a **colliding skin**
  in the pack-import preview (T:4447), and the neighbouring rename input is the one
  at T:4442 that needs a label — the plan cites T:4442 as "the skip input".
- The skip control also has no `aria-pressed` for its skipped state
  (`ARIA-SCOUT-2026-10-19.md:127`), and G12's busy-label announcement
  ("Saving…"/"Deleting…"/"Working…", `ARIA-SCOUT-2026-10-19.md:489-491`) is not in
  the WS4 live-region event list.

**Recommended change:** add `Export <pack>`/`Delete <pack>`, fix the skip label to
the colliding skin name, add `aria-pressed` to skip, and note the busy-label
decision.

### F11 (low) — Pin the focus-ring classes; the scout's suggested pair is not all in the host CSS
WS4/WS3 says the colour well gets a `focus-within` ring "the host does exactly this"
(plan line 91-92). Verified in the compiled host stylesheet
(`apps/desktop/dist/assets/index-B89n1Ils.css`): `sr-only`,
`.focus-within\:outline-2:focus-within`, and `.focus-within\:outline-ring:focus-within`
exist, but **plain `focus-within:outline` and `outline-(--ui-accent)` do not**
(scout G5 at `ARIA-SCOUT-2026-10-19.md:382` suggests both). `check-host-classes`
will flag them unless they are inline.

**Recommended change:** specify the host's exact pair
`focus-within:outline-2 focus-within:outline-ring` (as used at
`accent-swatch.tsx:33`) or an inline style; do not copy the scout's class string
verbatim.

---

## What I verified as correct

- **The scout's plugin-side diagnosis holds.** Zero occurrences of `aria-live`,
  `tabIndex`, `autoFocus`, `aria-describedby`, `aria-labelledby`, `aria-current`,
  or `.focus(` in the template (grep). Dialog shells set `role='dialog'` +
  `aria-modal='true'` with no focus-in/trap/restore and a local `onKeyDown`
  (`ModalShell` T:3733-3740; `EditorModal` T:3959-3973; the comment at T:3969-3971
  admits the missing trap). Rename/delete unmount the focused button (T:3172-3185).
  Circle cards pass `showState: false` (T:4317). The colour well has no focus ring
  (label T:3447-3462). The pill is a card sibling with a live countdown (T:2974,
  T:2980-2982; 250 ms tick T:2819).
- **The primitives WS1 needs exist.** `useRef`/`useEffect`/`useState` are imported
  (T:53), so a ref+effect trap is implementable; no portal or context is required
  because the dialogs are in-pane overlays. Trigger buttons persist in the tree
  while a dialog is open (header packs/categories T:5591/T:5598; the card gear at
  T:4271-4272 via `openEditor` T:5004), so capturing `document.activeElement` and
  restoring is viable — the brief's "unmounts its trigger" worry does not apply.
  Caveat: `EditorModal` remounts on Reset via `key`/`editorEpoch` (T:5803, T:5107),
  so the focus effect must be idempotent and must not fight a restore.
- **The host API constraints are real.** In the installed host source:
  `SegmentedControl` exposes only `options/value/onChange/className/disabled` and
  renders `label` visibly (`segmented-control.tsx:6-18,40-52`), so the host-side
  label prop is genuinely absent and only out of scope by remit. `SelectTrigger`
  and `ScrollArea` spread `...props` (`select.tsx:20-40`, `scroll-area.tsx:7-13`),
  so the WS2 lens `aria-label` and WS3 scroll-region `aria-label`/`tabIndex` reach
  the DOM. `sr-only` and the host's focus-within ring classes exist in
  `index-B89n1Ils.css`.
- **The generated-file discipline is right.** WS1's `aria-modal`-or-drop stance
  matches the scout, and the plan correctly names the repo generator for the card
  fixture rather than hand-editing.

## What I could not verify

- **Real AT behaviour.** No NVDA/JAWS/VoiceOver run; the accessible-name
  contamination in F4 is reasoned from ARIA name-from-content rules and the rendered
  tree, not observed. The scout itself marks such claims `UNVERIFIED`.
- **`host.notify` runtime announcement** in the plugin page context (host source
  shows the live region at `notifications.tsx`; not exercised).
- **The headless Edge recipe.** No such recipe exists in the repo; I cannot confirm
  what a `--dump-dom` run actually measures, which is part of F6.
- **Real focus traversal / focus restore.** The VM harness has no `activeElement`,
  `getElementById`, or `querySelector` and stubs effects
  (`tests/helpers/load-plugin.mjs:124-128`), and I did not run a browser driver.
- **Host dialog/notification source claims** beyond the three files I opened
  (`dialog.tsx`, `confirm-dialog.tsx`, `notifications.tsx` were not read; they are
  not load-bearing for the plugin-side changes).
- **Rigour's live finding list.** Not run, to avoid writing `.rigour/` artifacts
  under the read-only brief.
