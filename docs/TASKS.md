# TASKS — open work

Nothing here is in flight; each item records what it is and the trigger that
brings it back. `docs/PLANS/CHROMA-ROADMAP.md` holds the product roadmap;
`docs/PLANS/CHROMA-IMPLEMENTATION.md` holds the campaign record.

## Features

| Item | Trigger / reason |
|:--|:--|
| F7 — group and sort by main hue | 104 scenes are grouped only by mode, so finding "something green" means reading every swatch |
| F8 — adjust tint, value and brightness | "This one, but warmer" is the common reaction to a palette; today the answer is export, edit, re-import. Build on the SDK's OKLCH helpers (`hexToOklch`, `oklchToHex`, `maxChroma`, `contrastRatio`) rather than a hand-rolled colour model |
| F9 — accent-picker interoperability | Decide precedence first: a skin apply and an accent override are two writers of one appearance. F8 likely shrinks this to that question alone |
| Per-card overflow menu | Export / Rename / Delete sit in a row under the card. They cannot move inside it: a button inside a button is invalid HTML |
| iTerm2 import | Deferred from F4. Needs a plist parser with no dependencies and a P3 colour matrix |

## Verification the development host cannot perform

| Item | Why |
|:--|:--|
| Export save dialog | The renderer-blob plus Electron `will-download` path is only provable on the user's own machine |
| Paste-import each of the four formats | Same: needs the running Desktop |
| The gallery's rendered look at 104px, and rectangle/circle shapes | The sizes were reasoned from arithmetic, not measured |

## Submission to the plugin catalog

| Item | Note |
|:--|:--|
| CI workflow | The catalog expects a repository that builds and checks itself |
| A fresh screenshot | `docs/hermes-chroma.png` still shows the pre-fork UI |

## Quality-gate debt

`rigour check --ci` currently reports FAIL. Real findings worth their own change,
not workarounds:

| Finding | Detail |
|:--|:--|
| `AST_COMPLEXITY` | **17 functions were over the max of 10, not one.** `rigour` names only the worst and truncates its list at five, so measure with a probe that reuses the gate's own parser and rule (`gates/ast-handlers/typescript.js`: start at 1, count if/case/default/loops/ternaries/`&&`/`||`, `??` does not count, nested functions excluded). Batch 1 fixed four - `skinToDesktopTheme` (24), `tweakcnColors` (27), `tweakcnToDesktopTheme` (15), `parseImportedTheme` (20) - by moving repeated ternaries into data tables. **13 remain**, led by `ThemeCard` (32), `vsCodeTheme` (23) and `perform` (20). Reduce real branching; do not put a `??` where a `||` was, and do not move branches into one large helper |
| `file-size` | `desktop/plugin.js` and `desktop/plugin.template.js` exceed 500 lines. The build is generated from the template; splitting the template is the only real fix |
| `hallucinated-imports` | Reported for `@hermes/plugin-sdk` and `react`, which the plugin deliberately does not declare as dependencies. Verified false positive: those are the only three specifiers Desktop resolves |
| `promise-safety` | Three sites, all adjudicated. (1) The plugin's `queued.then(ok, err)` chain: the rejection handler IS the second argument, so converting it would discard that control flow and break the queue it protects. (2) `tests/test_regenerate.py:219` parses the pinned hash manifest — a test SHOULD fail loudly when its fixture is malformed, and swallowing that error would hide a broken pin. This finding is also **pre-existing code relocated**, not new: the same line sat at 193 before this session's edits added lines above it, which is exactly the phantom-NEW trap a line-anchored diff reports. (3) The same shape in `tests/regenerate-scene-parity.mjs` was mine and was removed rather than guarded: the generator re-read the file it had just written, and an awaited write that fails already throws |
| `prototype-pollution` | A pre-existing `Object.assign` merge, not introduced by this work |
| `style-drift` | **Adjudicated false positive.** The hint asks `plugin_api.py` and `regenerate.py` to "use snake_case for function names" — and all 30 `def`s across those two files are already snake_case (`grep -E "^def [a-z]+[A-Z]"` finds none; 18 defs in one, 12 in the other). The detector's baseline was evidently built from a different file set, so it asks compliant code to comply. Evidence over churn: no code changed |
| `inconsistent-error-handling` | **Adjudicated.** The seven catches are deliberate: narrow types (`ValueError`, `OSError`, `RuntimeError`) where one error is expected, and broad ones exactly where an arbitrary file or a JSON load must not abort the build — one of which re-raises with context. The single silent broad catch, `_parse_skin_file`, is now documented in place, and the catalog's surviving-count reporting is what surfaces a skipped file. Uniformising these to satisfy the heuristic would make the error handling worse, not better |
