# TASKS — open work

Nothing here is in flight; each item records what it is and the trigger that
brings it back. `docs/PLANS/CHROMA-ROADMAP.md` holds the product roadmap;
`docs/PLANS/CHROMA-IMPLEMENTATION.md` holds the campaign record.

## Features

| Item | Trigger / reason |
|:--|:--|
| F7 — group and sort by main hue | Skins are grouped by colour family (fixed in 2.6.0), so finding "something green" means reading every swatch |
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
| A fresh screenshot | `docs/chroma-banner.png` still shows the pre-fork UI |

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
## Doc hygiene (open, 2026-10-16)

- **Two architecture docs.** `docs/ARCHITECTURE.md` came in with the hard fork (`3444cf2`) and describes
  UPSTREAM's layout and Desktop's three-layer theme system; `docs/ARCH.md` (`46945f1`) describes this
  plugin. Both are accurate about different things, which is worse than one being wrong. Decide: archive
  the upstream one under `docs/PLANS/` as background, or merge the parts that still apply into `ARCH.md`
  and drop it. Delete nothing until that call is made.
- `rigour-fix-packet.json` / `rigour-report.json` sit in the repo root as run artifacts. They are
  gitignored, but confirm that before any bulk `git add`.

## What the card guard proves, and what it does not (verified 2026-10-16)

Two independent reviewers went at the ThemeCard refactor. Their verdict: the DOM is unchanged and the
guard is a real net — but its scope was overstated, and the record needed correcting.

**Corrected figures.** The commit messages say `ThemeCard 32 -> 8` and `vsCodeTheme 23 -> 4`. Measured
against the gate's own counting rule, they are **9 and 5**. The direction and the "no extracted piece
reaches 10" claim hold; the exact post-values were never measured before being written down. Measure
first, then write the number.

**The real hole, and its fix.** `digestElement` records a handler as the string `'[fn]'` - presence, not
behaviour. Before this pass the entire suite invoked **three** handlers (the preview pill twice, the card
once), so a silently broken manage row digested identically and shipped green. `tests/theme-card.test.mjs`
now invokes the rest and watches what leaves the component: the card's apply, the export/rename/delete
wiring, the rename row's Enter/Save/Escape/onChange, the delete confirmation's Yes/No, and the CLI badge's
scope claim. Fault-injected: dropping the delete, dropping the rename, dropping the scene name from
export, and inverting the badge's scope branches each fail a NAMED test (the badge inversion also trips
the digest). Restoring the template leaves it byte-identical.

**Axes that were inert, now real.** `'owned + localScope'` passed the string `'profile'` on a scene with
no gateway names, so it exercised nothing - the CLI badge keys off `gatewayLightName`/`gatewayDarkName`
and production passes a BOOLEAN (`scope === APPLY_SCOPE_LOCAL`). Replaced by gateway cases at both scope
values. `'managing owned'` and an `applying` case were provably identical to the idle card and were
removed. A third-alias title band and a second-alias border band were added, plus colours-only (the
`|| scene.colors` fallback) and active-plus-previewing. All five produce digests distinct from their
nearest neighbour.

**Benign divergence, recorded not fixed.** The old mode regex is case-insensitive but ASCII-only;
the new lower-case compare maps U+212A KELVIN SIGN to `k`, so an input like `'dar\u212a k'` now reads as
dark where it previously fell through to luminance. Unreachable with real theme data; the new behaviour
is the more permissive one.

**Hygiene.** The working-tree `desktop/plugin.template.js` carries CRLF on most lines while its git blob
is LF (`text=auto eol=lf`), so `git diff` cannot show it. `scripts/regenerate.py` normalises, so the
build stays LF and it is harmless - but a reviewer who edits that file through git may be surprised.

