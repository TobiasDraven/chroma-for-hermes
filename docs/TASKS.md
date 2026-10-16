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
| `AST_COMPLEXITY` | **17 functions were over the max of 10, not one** — and the one named is not even the worst. The gate names the **first** over-budget function in SOURCE ORDER and truncates its list at five, so after this batch it names `cssColorToHex` (11) while the actual worst is `ThemeCard` (32).  so measure with a probe that reuses the gate's own parser and rule (`gates/ast-handlers/typescript.js`: start at 1, count if/case/default/loops/ternaries/`&&`/`||`, `??` does not count, nested functions excluded). Batch 1 fixed four - `skinToDesktopTheme` (24), `tweakcnColors` (27), `tweakcnToDesktopTheme` (15), `parseImportedTheme` (20) - by moving repeated ternaries into data tables. **13 remain**, led by `ThemeCard` (32), `vsCodeTheme` (23) and `perform` (20). Reduce real branching; do not put a `??` where a `||` was, and do not move branches into one large helper |
| `file-size` | `desktop/plugin.js` and `desktop/plugin.template.js` exceed 500 lines. The build is generated from the template; splitting the template is the only real fix |
| `hallucinated-imports` | Reported for `@hermes/plugin-sdk` and `react`, which the plugin deliberately does not declare as dependencies. Verified false positive: those are the only three specifiers Desktop resolves |
| `promise-safety` | Three sites, all adjudicated. (1) The plugin's `queued.then(ok, err)` chain: the rejection handler IS the second argument, so converting it would discard that control flow and break the queue it protects. (2) `tests/test_regenerate.py:219` parses the pinned hash manifest — a test SHOULD fail loudly when its fixture is malformed, and swallowing that error would hide a broken pin. This finding is also **pre-existing code relocated**, not new: the same line sat at 193 before this session's edits added lines above it, which is exactly the phantom-NEW trap a line-anchored diff reports. (3) The same shape in `tests/regenerate-scene-parity.mjs` was mine and was removed rather than guarded: the generator re-read the file it had just written, and an awaited write that fails already throws |
| `prototype-pollution` | A pre-existing `Object.assign` merge, not introduced by this work |
| `style-drift` | **Adjudicated false positive.** The hint asks `plugin_api.py` and `regenerate.py` to "use snake_case for function names" — and all 30 `def`s across those two files are already snake_case (`grep -E "^def [a-z]+[A-Z]"` finds none; 18 defs in one, 12 in the other). The detector's baseline was evidently built from a different file set, so it asks compliant code to comply. Evidence over churn: no code changed |
| `inconsistent-error-handling` | **Adjudicated.** The seven catches are deliberate: narrow types (`ValueError`, `OSError`, `RuntimeError`) where one error is expected, and broad ones exactly where an arbitrary file or a JSON load must not abort the build — one of which re-raises with context. The single silent broad catch, `_parse_skin_file`, is now documented in place, and the catalog's surviving-count reporting is what surfaces a skipped file. Uniformising these to satisfy the heuristic would make the error handling worse, not better |

## Reading rigour's own numbers (learned the hard way, 2026-10-16)

- **Read the live `rigour check --ci` output or its `--json`, not `.rigour/last-scan.json`.** On
  the same tree the live run reported 15 findings while `last-scan.json` held 16 with a different
  by-id mix (it still listed the third `style-drift`, and it lags the actual run). The live pair
  (console and `--json`) agreed with each other; the cached file did not.
- **The score is not monotone in the finding list, so never quote it as progress.** Measured
  across this session's runs on one tree: 17 findings → score 41, then 15 findings → score 39.
  A HIGH-severity `file-guard` finding disappeared and the headline score went DOWN by two. Report
  the finding list, which is deterministic and diffable; treat the score as a band.
- **`file-guard` flags UNCOMMITTED edits under `protected_paths` (`docs/**`, `rigour.yml`,
  `.github/**`).** It runs `git status --porcelain` and deliberately ignores untracked files, so
  creating docs passes and editing a committed doc trips it until the commit lands. Confirmed:
  the finding cleared on the next run after committing the doc change. It is a tripwire for
  "did you mean to touch this", not a defect to fix.
- **`AST_COMPLEXITY` names only the worst function and truncates its list at five.** The real
  worklist needs a probe reusing the gate's own parser — see the complexity section in
  `docs/PLANS/CHROMA-IMPLEMENTATION.md`.
- **Line-number relocation reads as a new finding.** The `promise-safety` entry on
  `tests/test_regenerate.py` is the same code at a new line after edits above it.

## Import fidelity — what the VS Code research makes visible (open, 2026-10-16)

A read-only scout parsed 23 real published themes and cited schema/loader sources, not memory. Its
report is kept at `docs/PLANS/VSCODE-MAPPING-RESEARCH.md` (moved out of prunable scratch). Its counts,
its JSONC claim and the themes it says we refuse were re-verified here against the live files.

None of this is a defect in the table refactor — the mapping is byte-identical to what it was. These
are decisions the data now makes visible:

| Finding | Evidence | Decision needed |
|:--|:--|:--|
| About a fifth of real colour values carry alpha and we flatten them | 787/3966 values across 20/23 themes; `nord.json` `button.background = #88c0d0ee` (verified) | Keep flattening — the backend `_hex` accepts only `#rrggbb` — or carry alpha through the backend and every palette consumer |
| Two first-party themes are refused, and the refusal MISDIAGNOSES them | `dark_plus.json` and `light_plus.json` inherit their palette through `include`: we answer "a syntax-only VS Code theme carries no palette to import" (verified by running the parser on the real files) | Reword to name the `include` target ("this theme inherits from ./dark_vs.json"), or resolve `include`, which needs a second file the renderer cannot fetch |
| Some fallback links can never fire in practice | bare `background` is not a documented key at all (0/23); `surface.foreground` 0/23; `sideBar.background` / `panel.background` / bare `foreground` resolve 0/23 *as background or foreground fallbacks* | Keep them (harmless, and they cover hand-written files) or drop the dead links |
| `workbench.colorCustomizations` is a user setting, never a theme property | 0/23 themes carry it; it is registered through `IConfigurationRegistry` (cited) | Keep the branch — it is what lets a pasted settings snippet import |

**Instrument note.** `stripJsonNoise` already survives `//` inside a QUOTED value
(`"vscode://schemas/color-theme"`), a trailing `//` comment, a block comment and a trailing comma. A
verification probe that stripped comments naively broke on exactly that file: the check was wrong, not
the parser.
