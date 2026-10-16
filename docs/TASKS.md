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
| `AST_COMPLEXITY` | `skinToDesktopTheme` has cyclomatic complexity 24 against a max of 10. Reduce actual branching (Map lookups, early returns), not by moving branches into helpers |
| `file-size` | `desktop/plugin.js` and `desktop/plugin.template.js` exceed 500 lines. The build is generated from the template; splitting the template is the only real fix |
| `hallucinated-imports` | Reported for `@hermes/plugin-sdk` and `react`, which the plugin deliberately does not declare as dependencies. Verified false positive: those are the only three specifiers Desktop resolves |
| `promise-safety` | One `.then(onFulfilled, onRejected)` chain whose rejection handler IS the second argument. Converting it would discard that control flow and break the queue it protects |
| `prototype-pollution` | A pre-existing `Object.assign` merge, not introduced by this work |
