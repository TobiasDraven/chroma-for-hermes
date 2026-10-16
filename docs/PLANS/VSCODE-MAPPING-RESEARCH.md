<!-- Research artifact, kept out of prunable scratch.
     Produced 2026-10-16 by a READ-ONLY subagent that downloaded and parsed 23 real published
     VS Code themes and cited the schema/loader sources rather than recalling them.
     Nothing in this repo was changed to produce it.
     Independently spot-verified here: its per-theme colour counts (nord = 303 colours, exact),
     the JSONC claim (nord.json fails a strict parse), and the two first-party themes it says we
     refuse (dark_plus.json, light_plus.json, quietlight.json, hc_light.json - all reproduced by
     running the parser on the real files). One wording defect it did not name: our refusal message
     for the `include` themes misdiagnoses them as syntax-only. See docs/TASKS.md. -->

# VS Code colour-theme JSON → palette mapping: grounded reference

Scope: the workbench colour keys the existing parser reads in
`C:\DEV\hermes-theme-picker\desktop\plugin.template.js`, function `vsCodeTheme(theme)`
(lines 593–636) plus the detection helpers `looksLikeVsCode` (655–664) and
`normHex` (442–451). Read-only; nothing in `C:\DEV\hermes-theme-picker` was modified.

**Keys read by the parser (exhaustive, from `vsCodeTheme`):**

| palette slot | key chain, in order |
|---|---|
| background | `editor.background` → `sideBar.background` → `panel.background` → `background` |
| foreground | `editor.foreground` → `foreground` |
| border | `panel.border` → `editorGroup.border` → `focusBorder` |
| muted | `descriptionForeground` → `statusBar.foreground` |
| primary | `button.background` → `activityBarBadge.background` |
| accent | `textLink.foreground` → `list.activeSelectionBackground` |
| cardForeground | `surface.foreground` → `titleBar.activeForeground` |
| destructive | `errorForeground` → `inputValidation.errorBackground` |
| (detection) | `theme.uiTheme`, `theme.type`, `theme.name`, `theme.tokenColors`, `theme.colors`, `theme.workbench.colorCustomizations` |

**Evidence base.** 23 real published theme files, downloaded and parsed (list + raw URLs in
Appendix A). Counts below are `present / 23`.

**Cited sources** (read, not remembered):

- **D1** — official colour reference: `https://code.visualstudio.com/api/references/theme-color`
  (served at `https://code.visualstudio.com/docs/getstarted/theme-color-reference`).
- **S1** — theme JSON schema: `colorThemeSchema.ts`, `microsoft/vscode` @ `main`,
  `src/vs/workbench/services/themes/common/colorThemeSchema.ts`, symbol `colorThemeSchema`
  (lines 232–265). URL: `https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/services/themes/common/colorThemeSchema.ts`
- **S2** — loader: `colorThemeData.ts`, symbols `ColorThemeData.fromExtensionTheme` (line ~745)
  and `_loadColorTheme` (lines 775–836).
  URL: `https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/services/themes/common/colorThemeData.ts`
- **S3** — theme contribution shape: `workbenchThemeService.ts`, interface `IThemeExtensionPoint`
  (lines 541–548; `uiTheme?: ThemeTypeSelector`).
- **S4** — enums: `theme.ts`, `enum ColorScheme` (9–14) and `enum ThemeTypeSelector` (16–21:
  `vs`, `vs-dark`, `hc-black`, `hc-light`).
  URL: `https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/theme/common/theme.ts`
- **S5** — settings: `themeConfiguration.ts`, `colorCustomizationsSchema` (93–101) and
  `ThemeSettings.COLOR_CUSTOMIZATIONS` registered at line 141; `ThemeSettings.COLOR_CUSTOMIZATIONS = 'workbench.colorCustomizations'`
  in `workbenchThemeService.ts` (line 28).
- **S6** — VS Code's own "Generate Color Theme" writer: `themes.contribution.ts` line 774 emits
  `type: theme.type` into the generated file.

---

## 1. Key table

`official meaning` = wording from **D1**. `frequency` = count of the 23 downloaded themes whose
`colors` block contains the key (measured, Appendix B). `observed format` = value shapes actually
seen in those 23 files.

| key | official meaning (D1) | present in real themes | observed value format |
|---|---|---|---|
| `editor.background` | "Editor background color." | **20/23** | `#rrggbb`; occasionally `#rrggbbaa` |
| `editor.foreground` | "Editor default foreground color." | **19/23** | `#rrggbb` |
| `sideBar.background` | "Side Bar background color." | **17/23** | `#rrggbb` |
| `list.activeSelectionBackground` | "List/Tree background color for the selected item when the list/tree is active." | **17/23** | `#rrggbb`, many `#rrggbbaa` |
| `focusBorder` | "Overall border color for focused elements. This color is only used if not overridden by a component." | **17/23** | `#rrggbb` |
| `button.background` | "Button background color." | **16/23** | `#rrggbb` **and `#rrggbbaa`** (e.g. `nord.json` = `#88c0d0ee`) |
| `editorGroup.border` | "Color to separate multiple editor groups from each other." | **15/23** | `#rrggbb` |
| `panel.border` | "Panel border color to separate the panel from the editor." | **13/23** | `#rrggbb` |
| `activityBarBadge.background` | "Activity notification badge background color." | **13/23** | `#rrggbb` |
| `inputValidation.errorBackground` | "Input validation background color for error severity." | **12/23** | `#rrggbb`, often `#rrggbbaa` |
| `statusBar.foreground` | "Status Bar foreground color." | **11/23** | `#rrggbb` |
| `errorForeground` | "Overall foreground color for error messages (this color is only used if not overridden by a component)." | **11/23** | `#rrggbb` |
| `panel.background` | "Panel background color." | **9/23** | `#rrggbb` |
| `descriptionForeground` | "Foreground color for description text providing additional information, for example for a label." | **8/23** | `#rrggbb` |
| `titleBar.activeForeground` | "Title Bar foreground when the window is active." | **8/23** | `#rrggbb` |
| `foreground` | "Overall foreground color. This color is only used if not overridden by a component." | **7/23** | `#rrggbb` |
| `textLink.foreground` | "Foreground color for links in text." | **7/23** | `#rrggbb` |
| `surface.foreground` | "Foreground color of framed container surfaces (\"cards\"), such as the floating workbench panels in the modern layout." | **0/23** | — (never observed) |
| `background` | **NOT a documented key** — D1 has no bare `background` entry (verified: zero matches for `` `background` `` as a top-level key). | **0/23** | — |

**Reading the numbers.** Frequency ≠ usefulness: the *last* link of a chain can be common yet never
fire, because the earlier links already resolved for every theme that has any colours at all.
Resolved-at-each-link counts (Appendix C):

| slot | link 1 | link 2 | link 3 / further | never resolves |
|---|---|---|---|---|
| background | `editor.background` **20** | `sideBar.background` 0 | `panel.background` 0, `background` 0 | 3 |
| foreground | `editor.foreground` **19** | `foreground` 0 | — | 4 |
| border | `panel.border` **13** | `editorGroup.border` **2** | `focusBorder` **2** | 6 → falls back to `foreground` |
| muted | `descriptionForeground` 8 | `statusBar.foreground` **3** | — | 12 → fallback |
| primary | `button.background` **16** | `activityBarBadge.background` **2** | — | 5 → fallback |
| accent | `textLink.foreground` 7 | `list.activeSelectionBackground` **10** | — | 6 → fallback |
| cardForeground | `surface.foreground` 0 | `titleBar.activeForeground` **8** | — | 15 → fallback |
| destructive | `errorForeground` **11** | `inputValidation.errorBackground` **3** | — | 9 → fallback |

---

## 2. Which keys are RARELY / NEVER present (load-bearing fallbacks)

- **Never present anywhere (0/23): `background`** — not a documented key at all (D1). It is not a
  "rare" key, it is a **phantom**: the `'background'` link in the parser's background chain (line 608)
  is dead code that can only ever be reached by a file the parser is about to reject anyway.
- **Never present (0/23): `surface.foreground`** — the whole "Modern UI colors" block is new (D1
  section *Modern UI colors*). Because `surface.foreground` never fires, the parser's `cardForeground`
  rests entirely on `titleBar.activeForeground` (8/23) and then the `foreground` fallback (15/23).
  The `surface.foreground` link is **not** load-bearing.
- **Rare and genuinely load-bearing** (these resolve themes that would otherwise fall through):
  `editorGroup.border` (2/23), `focusBorder` (2/23, as 3rd link), `statusBar.foreground` (3/23),
  `activityBarBadge.background` (2/23), `list.activeSelectionBackground` (10/23 — the *second* link of
  the accent chain does more work than the first), `titleBar.activeForeground` (8/23),
  `inputValidation.errorBackground` (3/23).
- **Dead fallbacks** (`sideBar.background`, `panel.background`, bare `background` for the background
  slot; bare `foreground` for the foreground slot): each resolves **0** themes among the 23. The 3
  themes missing `editor.background` (`dark_plus.json`, `light_plus.json`, `hc_light.json`) either
  have no `colors` block at all or none of the alternates. **Keep them — they are cheap and a
  hand-edited theme could still use them — but do not treat them as coverage.**

---

## 3. What the VALUES look like

Measured over **3 966** colour values across the 23 themes' `colors` blocks:

| form | count | share | real examples |
|---|---|---|---|
| `#rrggbb` | 3 149 | **79.4 %** | everywhere |
| `#rrggbbaa` | **787** | **19.8 %** | `nord.json` `button.background`=`#88c0d0ee`; `solarized-dark.json` (29×); `monokai.json` (11×); `onedark-pro.json` (27×) |
| `#rgb` | 13 | 0.3 % | `dark_vs.json`, `light_vs.json`, `red.json`, `onedark-pro*.json` |
| `#rgba` | 5 | 0.1 % | `dark_vs.json`, `light_vs.json`, `night-owl.json` |
| JSON `null` | **12** | 0.3 % | `night-owl.json` (see §EDGE CASES) |

- **Answer: no — values are NOT always `#RRGGBB`.** 8-digit `#RRGGBBAA` is *common*, present in
  **20 of 23** themes and ~20 % of all values. 4-digit `#RGBA` and 3-digit `#RGB` also occur.
- **Named colours, `transparent`, or variables: none observed.** Zero values across all 23 themes were
  strings that did not start with `#`; the only non-hex values were the 12 JSON `null`s. D1 does not
  document named colours: *"As format, the following hexadecimal notations are supported: `#RGB`,
  `#RGBA`, `#RRGGBB` and `#RRGGBBAA`."* So the parser's `normHex` correctly returns `null` for
  anything non-hex, and the `null`-value case is the realistic one to keep surviving.
- The parser's `normHex` **drops alpha** (`if (v.length === 8) return '#' + v.slice(0, 6)`). That is a
  real, frequent transformation: ~20 % of incoming values lose their alpha (e.g. `#88c0d0ee` →
  `#88c0d0`), which is *visibly wrong* for translucent overlays such as
  `list.activeSelectionBackground`. This is a known, deliberate trade-off (comment lines 438–441)
  because the backend `_hex` discards alpha — but it is the single largest value-distortion in the
  importer and should be documented in the fixture set.

---

## 4. Does `type` / `uiTheme` reliably indicate light vs dark?

**Presence in real files: `type` = 12/23 (52 %); `uiTheme` = 0/23; `include` = 2/23.**

- **`uiTheme` never appears inside a theme file.** It is a field of the *extension manifest*
  `contributes.themes[]` entry: S3 `interface IThemeExtensionPoint { id; label?; description?; path; uiTheme?: ThemeTypeSelector; _watch }`.
  Its enum is S4 `ThemeTypeSelector { VS='vs', VS_DARK='vs-dark', HC_BLACK='hc-black', HC_LIGHT='hc-light' }`.
  The loader defaults it: S2 `const baseTheme: string = theme.uiTheme || 'vs-dark';` (line ~745).
  So a theme whose manifest omits `uiTheme` is treated as **dark by default**.
- **`type` is not in the theme-file schema.** S1 `colorThemeSchema` declares exactly four properties —
  `colors`, `tokenColors`, `semanticHighlighting`, `semanticTokenColors` — and **not** `type`, `name`,
  `uiTheme` or `include`. The loader S2 `_loadColorTheme` reads only `include`, `settings` (legacy
  tmTheme-JSON), `semanticHighlighting`, `colors`, `tokenColors`, `semanticTokenColors` — it **never
  reads `type`**. VS Code's own generator does emit `type` (S6 line 774 `type: theme.type`), so it is a
  tolerated, round-tripped convention rather than a schema field, and **the file's `type` is not what
  VS Code uses to decide the variant.**
- **What real files show.** Every one of the **11** themes without `type` is a first-party theme —
  `dark_vs.json`, `dark_plus.json`, `light_vs.json`, `light_plus.json`, `hc_black.json`,
  `hc_light.json`, `solarized-light.json`, `solarized-dark.json`, `quietlight.json`, `red.json`,
  `abyss.json` — all shipped from `extensions/theme-*/themes/`. Their light/dark signal lives in
  `extensions/theme-*/package.json` (`contributes.themes[].uiTheme`), e.g.
  `theme-solarized-light/package.json` → `"uiTheme": "vs"`, `theme-defaults/package.json` →
  `hc_black.json: "hc-black"`, `dark_vs.json: "vs-dark"`. Confirmed by downloading those package.json
  files (Appendix A).
- **Where `type` IS present it was always correct** (10 `dark`, 2 `light`; no mislabels in 23 files).
  But absence at 48 % — including whole first-party theme families — means **`type` can never be the
  sole signal.**

**Conclusion for the parser.** The existing logic is right in shape and the priority is backwards
relative to the ecosystem: it tests `theme.uiTheme || theme.type` (line 613), but `uiTheme` is a
manifest field that will essentially never be inside a pasted theme file, and `type` is missing half
the time. The **luminance fallback is the load-bearing path for ~48 % of real themes** and must stay
(and should be the documented primary, with `type` as a hint). Note also that `type: "dark"` is a
*file* value, whereas the manifest uses `vs-dark` — the parser's `/dark|hc-black/i` regex happens to
match both spellings, so it is not broken, just underpinned by luck.

---

## 5. Can `workbench.colorCustomizations` appear inside a theme file?

**No. It is a user/folder/workspace *setting*, never a theme-file property.**

- S1 `colorThemeSchema` does **not** list `workbench.colorCustomizations` (properties are only
  `colors`, `tokenColors`, `semanticHighlighting`, `semanticTokenColors`). The theme-file schema has no
  `additionalProperties: false` at the top level, so an unknown key is *tolerated*, but S2
  `_loadColorTheme` only reads the six keys above — it never looks for `workbench.colorCustomizations`.
  **A file carrying it is silently ignored, not honoured.**
- It is defined as a configuration setting: S5 `const colorCustomizationsSchema: IConfigurationPropertySchema = { … description: "Overrides colors from the currently selected color theme." … }`,
  registered under `ThemeSettings.COLOR_CUSTOMIZATIONS`, whose id is
  `workbench.colorCustomizations` (S5 / `workbenchThemeService.ts` line 28). Settings live in
  `settings.json` (user / workspace / folder), i.e. **outside** any theme file.
- **Consequence for the parser.** The `looksLikeVsCode` branch
  `if (json.workbench && json.workbench.colorCustomizations) return true` (line 656) and the
  `vsCodeTheme` fallback `theme.workbench.colorCustomizations` (line 594) key off a shape that no real
  theme file uses: **0/23** of the downloaded themes contain it, and it is not in any theme schema.
  It is not wrong (a pasted *settings.json* fragment would hit it) but it should be relabelled as
  "settings-fragment" handling, not "theme-file" handling, or dropped from the theme path.

---

## 6. ANCHOR KEYS

Reliable anchors, by measured frequency among 23 real themes:

| role | anchor key | citation | why |
|---|---|---|---|
| **page background** | `editor.background` | D1: "Editor background color." | **20/23** — the single most present colour key; the only background key that actually resolves. Secondary: `sideBar.background` (17/23, D1: "Side Bar background color."). |
| **page foreground / text** | `editor.foreground` | D1: "Editor default foreground color." | **19/23**. Secondary: bare `foreground` (D1: "Overall foreground color. This color is only used if not overridden by a component.") — present 7/23 but **resolves 0/23** as a fallback because those themes also set `editor.foreground`. |
| **accent / brand** | `focusBorder` | D1: "Overall border color for focused elements…" | **17/23** — most present accent-ish key; it is the workbench's de-facto brand colour (e.g. `cat-latte.json` `#8839ef`, `cat-mocha.json` `#cba6f7`). Secondary brand *colour*: `button.background` (16/23, D1 "Button background color.") and `textLink.foreground` (7/23, D1 "Foreground color for links in text."). |
| **border** | `editorGroup.border` | D1: "Color to separate multiple editor groups from each other." | **15/23** across the border chain `panel.border` 13 → `editorGroup.border` +2 → `focusBorder` +2. Any single one alone covers ≤15/23, so **the border chain, not one key, is the anchor.** |

Practical anchors for a table-driven refactor:

- background → `editor.background` (20/23), fallback `sideBar.background` (17/23).
- text → `editor.foreground` (19/23), fallback bare `foreground`.
- accent → `focusBorder` (17/23) primary; `button.background` (16/23) and
  `list.activeSelectionBackground` (17/23) as alternates.
- border → `editorGroup.border` (15/23) ⟶ `panel.border` (13/23) ⟶ `focusBorder` (17/23).

---

## EDGE CASES FOR FIXTURES

Real inputs found in the downloaded files; each names the file it came from.

1. **JSONC noise — comments and trailing commas. 15/23 files fail strict `JSON.parse`.**
   All 15 contain `//` or `/* */` comments; **13** also contain trailing commas.
   Files: `dark_vs.json`, `dark_plus.json`, `light_vs.json`, `light_plus.json`, `abyss.json`,
   `kimbie-dark.json`, `monokai.json`, `night-owl-light.json`, `nord.json`, `quietlight.json`,
   `red.json`, `solarized-dark.json`, `solarized-light.json`, `tokyo-night.json`,
   `tomorrow-night-blue.json`.
   Concrete: `solarized-light.json` line 145 ends an array with `…"punctuation.separator.namespace.ruby",\n\t\t],`.
   → the parser's `stripJsonNoise`/`parseTolerantJson` (lines 461–498) is **load-bearing for ~65 % of
   real files** and must never be replaced by `JSON.parse`. Matches S1 `allowComments: true,
   allowTrailingCommas: true`.

2. **`include` inheritance — a theme with an empty `colors` block.**
   `dark_plus.json` (`"include": "./dark_vs.json"`, `"colors": {}`) and `light_plus.json`
   (`"include": "./light_vs.json"`, `"colors": {}`). VS Code merges the parent (S2 line ~784), the
   parser does not, so both throw *"no editor.background and editor.foreground"*. These are **the two
   default themes a huge number of users actually run** — a real, high-value gap.
   Also `include` = 2/23 in the sample.

3. **Literal JSON `null` colour values — 12 in `night-owl.json`.**
   e.g. `"editor.lineHighlightBorder": null`, `"merge.border": null`,
   `"titleBar.inactiveForeground": null`, `"editorWhitespace.foreground": null`,
   `"statusBar.debuggingForeground": null`. `normHex(null)` must return `null` so the chain advances.
   (S2 line ~800 shows VS Code skipping non-string values too.)

4. **8-digit `#RRGGBBAA` where the alpha is meaningful — 787 values, 20/23 themes.**
   `nord.json` `button.background = "#88c0d0ee"`; `solarized-dark.json` (29 such values);
   `onedark-pro.json` (27); `monokai.json` (11). The parser flattens every one to `#rrggbb`, changing
   the rendered colour. Fixture should assert the flattening *and* record the loss.

5. **4-digit `#RGBA` and 3-digit `#RGB`.**
   `#rgba`: `dark_vs.json`, `light_vs.json`, `night-owl.json`. `#rgb`: `dark_vs.json`, `light_vs.json`,
   `red.json`, `onedark-pro.json`, `onedark-pro-flat.json`. Both are documented (D1) and both must
   expand, not reject.

6. **A legitimate light theme the parser REJECTS: `quietlight.json`.**
   It has 75 workbench colours but **no `editor.foreground`** and no bare `foreground` → the parser
   throws. Same failure class for `hc_light.json` (only **6** workbench colours, no
   `editor.background`/`editor.foreground`). Fixtures should cover a *sparse but valid* workbench block,
   not just the empty one.

7. **Very small `colors` blocks.** `hc_light.json` = 6 keys, `hc_black.json` = 14,
   `dark_vs.json` = 42, `light_vs.json` = 48 — versus `cat-*.json` = 564 and `tokyo-night.json` = 353.
   The distribution is bimodal; a table-driven parser must be correct at both ends.

8. **High-contrast themes.** `hc_black.json` / `hc_light.json` are the `hc-black` / `hc-light`
   `uiTheme` values and carry `contrastBorder` / `contrastActiveBorder` (D1 *Contrast colors*, "typically
   only set for high contrast themes"). The parser maps `hc-black` → dark and `hc-light` → light,
   which is consistent with S4; but `hc_light.json` still fails on missing bg/fg (item 6).

9. **`type` absent on 11/23 — including all bundled defaults.** Any fixture set that always includes
   `"type"` misrepresents the ecosystem by ~half and would hide a broken luminance fallback.

10. **A `colors` block that is syntactically present but has no editor colours** — repo fixture
    `import-formats.test.mjs` line 174 (`{ name:'y', type:'dark', colors:{}, tokenColors:[] }`).
    No real downloaded theme is *strictly* tokenColors-only, but `dark_plus.json`/`light_plus.json`
    (0 colours) exercise the identical failure path, and the syntax-only shape is the common
    marketplace case the parser's `looksLikeVsCode` fallback exists to name.

---

## UNVERIFIED

- **The extension-manifest JSON Schema file for `contributes.themes` was not located.**
  The `uiTheme` field is confirmed at the TypeScript level (S3 `IThemeExtensionPoint`) and its enum at
  S4 (`ThemeTypeSelector`), but I could not find the file that registers the manifest JSON schema for
  `contributes.themes` to quote the schema text itself. `themeExtensionPoint.ts` 404s on `main`.
  *The field and enum are verified; the schema-registration file is not.*
- **Whether VS Code *ever* reads a `type` field from a pasted/opened theme JSON** — confirmed absent
  from `colorThemeSchema.ts` (S1) and from `_loadColorTheme` (S2) in the `main` tree I read. I did not
  exhaustively grep the whole repository, so *"never read"* is verified for those two files only; a
  third reader elsewhere is **UNVERIFIED**.
- **`Color.fromHex` named-colour support** — `Color.Format.CSS.parseHex` was not read to completion, so
  whether the *loader* would accept a named colour string is **UNVERIFIED**. Irrelevant to the
  importer in practice: 0 non-`#` strings were observed in 3 966 real values.
- **Marketplace-wide frequencies.** Frequencies above are measured over the 23 files downloaded here
  (10 first-party Microsoft themes + 13 third-party). This is a convenience sample, not a census of
  the VS Code Marketplace; treat the ratios as indicative, not population estimates.
- **Dracula, Gruvbox, Ayu, GitHub, Material, Catppuccin-`themes/`-dir** — attempted, could not be
  fetched at the guessed raw URLs (`dracula` builds its JSON from `src/dracula.yml` and does not commit
  it; `catppuccin/vscode` generates `themes/` at build time). Catppuccin **was** obtained via its
  published npm tarball on unpkg (Appendix A). Dracula/Gruvbox/Ayu/Material are **not covered**.

---

## Appendix A — files actually downloaded and inspected

First-party (`https://raw.githubusercontent.com/microsoft/vscode/main/extensions/…`):
`theme-defaults/themes/{dark_vs,dark_plus,light_vs,light_plus,hc_black,hc_light}.json`,
`theme-monokai/themes/monokai-color-theme.json`,
`theme-solarized-light/themes/solarized-light-color-theme.json`,
`theme-solarized-dark/themes/solarized-dark-color-theme.json`,
`theme-tomorrow-night-blue/themes/tomorrow-night-blue-color-theme.json`,
`theme-quietlight/themes/quietlight-color-theme.json`,
`theme-abyss/themes/abyss-color-theme.json`,
`theme-kimbie-dark/themes/kimbie-dark-color-theme.json`,
`theme-red/themes/Red-color-theme.json`;
plus `theme-defaults/package.json`, `theme-solarized-light/package.json`, `theme-monokai/package.json`
(for `contributes.themes[].uiTheme`).

Third-party:
- Night Owl — `https://raw.githubusercontent.com/sdras/night-owl-vscode-theme/main/themes/Night%20Owl-color-theme.json` and `…Night%20Owl-Light-color-theme.json`
- One Dark Pro — `https://raw.githubusercontent.com/Binaryify/OneDark-Pro/master/themes/OneDark-Pro.json`, `…/OneDark-Pro-flat.json`
- Nord — `https://raw.githubusercontent.com/arcticicestudio/nord-visual-studio-code/develop/themes/nord-color-theme.json`
- Tokyo Night — `https://raw.githubusercontent.com/enkia/tokyo-night-vscode-theme/master/themes/tokyo-night-color-theme.json`
- Catppuccin — `https://unpkg.com/@catppuccin/vscode@latest/themes/{mocha,latte,frappe}.json`

Source files read for citations: `colorThemeSchema.ts`, `colorThemeData.ts`, `workbenchThemeService.ts`,
`theme.ts`, `themeConfiguration.ts`, `colorRegistry.ts`, `themes.contribution.ts` (all
`microsoft/vscode@main`), plus the rendered D1 page.

## Appendix B — per-theme `colors` count and `type` (measured)

```
dark_plus.json        0 colors   type=None     light_plus.json       0  type=None
hc_light.json         6          type=None     hc_black.json        14  type=None
dark_vs.json         42          type=None     light_vs.json        48  type=None
kimbie-dark.json     59          type=dark     tomorrow-night-blue  65  type=dark
red.json             67          type=None     quietlight.json      75  type=None
solarized-light.json 96          type=None     abyss.json          103  type=None
monokai.json        104          type=dark     solarized-dark.json 104  type=None
night-owl-light     159          type=light    night-owl.json      206  type=dark
onedark-pro.json    223          type=dark     onedark-pro-flat    247  type=dark
nord.json           303          type=dark     tokyo-night.json    353  type=dark
cat-frappe.json     564          type=dark     cat-latte.json      564  type=light
cat-mocha.json      564          type=dark
```

## Appendix C — reproduction

All counts were produced by parsing every file with the same tolerant-JSONC algorithm as
`stripJsonNoise` (comments + trailing commas stripped) and counting key presence / value shapes.
The analysis is deterministic over the 23 files listed in Appendix A; re-running it requires only
those raw URLs.
