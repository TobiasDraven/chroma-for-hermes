# E5 LANE 2 — TYPOGRAPHY, PANE HALF

Repo: C:\DEV\hermes-theme-picker   Branch: main

## Mission
Ship font editing in the Chroma editor: the user picks a stack for `fontSans`/`fontMono`,
it is saved as an override, and it reaches the Desktop theme \u2014 including after a restart.

## Files you own \u2014 and nothing else
- `desktop/plugin.template.js`   (the real edit target)
- `desktop/plugin.js`            (**generated \u2014 never hand-edit; regenerate it**)
- `tests/editor-typography.test.mjs`  (new)

Do NOT touch anything under `dashboard/`. Another lane owns those files.

## Read first \u2014 the exact seam, already traced
1. `SCENE_TYPOGRAPHY` (:122) \u2014 the AUTHORED per-scene default. It stays the authored value.
2. `sceneToDesktopTheme` (:316) \u2014 line **:327** hardcodes
   `typography: SCENE_TYPOGRAPHY[scene.name]`. **It ignores the scene's own `typography`, so an
   override cannot reach the theme object today. This is the first thing to fix.**
3. `applyOverride` (:2728) \u2014 merges colour overrides only. **It must also carry typography.**
4. `applyDesktopTheme` (:1588) \u2014 already merges `theme.typography` over the defaults (:1591-1594).
5. `register()` (:4498) \u2014 at boot maps **raw `SKINS`** through `sceneToDesktopTheme` and calls
   `persistThemesForBoot` (:1729) then `ctx.register`. Overrides are NOT read at boot here.
6. `applyScene` (:2293) \u2014 `persistThemesForBoot([theme])` where `theme = sceneToDesktopTheme(scene)`.
7. `saveEditor` (:3824) and `resetEditor` (:3884) \u2014 the write paths. Note neither currently
   calls `persistThemesForBoot`; the persistence rides `applyScene`.
8. `overridePayload` (:2805) \u2014 the body builder. It must learn the typography keys.

## The backend contract you code against (the other lane is building it)
- `PUT /overrides/{scene}` gains `typography: {"fontSans": "...", "fontMono": "..."}` \u2014 only the
  keys the user set. A typography-only override is valid.
- The override record carries `"typography": {...}`; `GET /overrides` returns it.
- `/schema` gains `typography: [{id, label}]` with ids `fontSans` and `fontMono`.
- Forbidden in a stack: `;` `{` `}` `<` `>` newline, and `url(` \u2014 the backend refuses them.
  The pane must refuse them before sending, so the user sees the error locally.

## What to build

### 1. The resolution chain \u2014 three edits, in order
- `applyOverride` must return a scene whose `typography` is the merged font set:
  authored default merged with the record's `typography`. A scene with no override keeps its
  authored typography untouched, and the authored scene object is never mutated.
- `sceneToDesktopTheme` (:327) must become
  `typography: Object.assign({}, SCENE_TYPOGRAPHY[scene.name], scene.typography || {})`
  \u2014 the scene's own value wins over the shipped default.
- Nothing else in the colour path changes.

### 2. The controls \u2014 in the editor modal
- Two controls, `fontSans` and `fontMono`, each a select of **curated stacks** plus a free-text
  escape hatch, plus a "Reset to shipped" choice that clears the key.
- **The emoji fallback is mandatory and non-negotiable:** every user stack must end with the
  pane's `EMOJI_FALLBACK` (:119). A stack the user typed without it gets it appended \u2014 the editor
  shows the appended result so what they see is what is stored. Say why in a comment: without the
  fallback a chosen font silently loses colour-emoji glyphs, and the bug reads as "the emoji broke".
- A **static preview strip** \u2014 the sample text rendered in the chosen stack, both modes \u2014 so the
  choice is visible before it is saved. v1 is static; no live typing.
- The controls follow the modal's existing conventions: `aria-invalid` on a rejected value, and
  never commit an unreadable value. Reuse the field/validation patterns already in the modal.

### 3. The boot path \u2014 the part that decides whether this feature is real
A font edit that vanishes on the next Desktop start has failed. `register()` (:4498) registers
themes from **raw `SKINS`**, so a registered theme carries the AUTHORED typography. Determine
empirically how an override survives a boot \u2014 trace the same path a COLOUR override takes \u2014 and
make typography ride it.

Do this in order, and do not hand-wave it:
1. Write a failing test first: a scene with a typography override, run through the boot
   registration path, must come out carrying the OVERRIDE font, not the shipped one. Show it fail.
2. Then fix the path so it passes. The fix belongs where the theme is built for registration \u2014
   `sceneToDesktopTheme` and/or the boot registration \u2014 not in the renderer.
3. **If the same code path also clobbers a COLOUR override at boot, fix it in the same change**
   \u2014 it is the same mechanism and the same bug \u2014 and say so plainly in your report. If colours DO
   survive boot today, say how, with the line numbers, so the next reader can trust it.

### 4. The schema-drift alarm
Extend the pane's existing schema-drift check to cover the typography keys, the same way it
covers the palette keys. A font key the pane renders but the backend refuses is the drift this
catches.

## Tests \u2014 `tests/editor-typography.test.mjs` (new)
- `applyOverride` merges a typography override onto a scene and leaves an un-overridden scene alone.
- `sceneToDesktopTheme` prefers the scene's typography over `SCENE_TYPOGRAPHY`.
- the emoji fallback is appended to a stack that lacks it, and NOT duplicated when present.
- a forbidden character is refused locally and never sent.
- the save handler posts `typography` in the `PUT /overrides/{scene}` body.
- reset clears the typography key.
- the boot-survival test from \u00a73 above \u2014 the failing-then-passing one.
- the schema-drift check fires on a typography-key mismatch.

## Gates
- `node --test tests/*.test.mjs` \u2014 report the count; it must not regress what is passing when you
  start (report that number).
- Then `python scripts/regenerate.py` and report the **sha256** of `plugin.js`.
- **NEVER hand-edit `plugin.js`.** Regenerate it.

## Constraints
- One writer per file. The two desktop files and your new test are yours.
- Do not change the colour resolution order or `sceneCategory()`'s measured rules.
- Follow the pane's existing conventions for fetch, error display and tests.

## Report back
Files changed; the node --test command and count; the sha256 of `plugin.js`; the boot path you
found and what you changed; whether colours shared the bug; and every decision the brief did not pin.
