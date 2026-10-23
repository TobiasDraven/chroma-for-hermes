# Third-Party Notices

This project bundles skin palettes from two MIT-licensed upstream projects.
Chroma is a hard fork of Hermes Theme Picker by Joshua Timothy
(https://github.com/jdtimothy/hermes-theme-picker), used under the MIT License
(see `LICENSE`); the editor, theme packs, taxonomy and catalogue are this
fork's work. The bundled `skins-v2/*.yaml` palettes are the work of their
respective authors and are redistributed here under the terms of their MIT
licenses, reproduced below.

## Bundled skins

| Source | Skins included | License |
|---|---|---|
| [BChop's Hermes Skins Pack](https://github.com/bchop-studio/hermes-skins-pack) | 50 designs | MIT |
| [CliffWade's Hermes Desktop Theme Pack](https://github.com/CliffWade/hermes-desktop-theme-pack) | 100 skins from v1.1.0 | MIT |

The two sources do not overlap, so the retired v1 table held 150 unique YAML
files: 50 BChop designs plus all 100 of CliffWade's v1.1.0 themes. They ship as
94 skins in `skins-v2/`, and every palette in the catalogue is that upstream work.
Their byte identity is enforced by `scripts/cliffwade-v1.1.0-sha256.json` and
the generator test suite.

The Hermes Desktop Theme Pack also served as the initial inspiration for this
project's theme-switcher concept; no code from it is included.

## F4 import parsers (Windows Terminal, Base16/24, VS Code)

The import parsers in `desktop/plugin.template.js` (`normHex`, `luminance`,
`stripJsonNoise`, `windowsTerminalTheme`, `base16Theme`, `vsCodeTheme`) are
original, dependency-free implementations — the plugin is plain ESM with no
`package.json`, so no parser library could be added. No code was copied
verbatim. What *was* taken from the following MIT projects, and is credited
here because it shaped the implementation:

| Source | What was taken |
|---|---|
| [mbadolato/iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes) (MIT) | The Windows Terminal scheme field inventory (`tools/templates/windowsterminal.json`): `background`, `foreground`, the 16 ANSI names, and the optional `cursorColor` / `selectionBackground` |
| [tinted-theming/base16-builder-node](https://github.com/tinted-theming/base16-builder-node) (MIT) | The `baseNN` key filter and the tolerant `#`-stripping (`lib/systems/basex/scheme.js`), needed because the legacy spec forbids `#` while the Tinted 0.11 spec allows it |
| [chriskempson/base16](https://github.com/chriskempson/base16) (MIT) | The `base00`–`base0F` role semantics (`styling.md`) behind the Base16 colour mapping |
| [microsoft/vscode](https://github.com/microsoft/vscode) (MIT) | Workbench colour identifiers and their meanings, and the fact that theme JSON permits comments and trailing commas (`src/vs/workbench/services/themes/common/colorThemeSchema.ts`), which `stripJsonNoise` exists to honour |

Mapping tables that have no basis in an upstream spec — the ANSI-role guesses
for Windows Terminal and the `baseNN` → design-token guesses for Base16 — are
marked as guesses in the source at the point of use.

## MIT License — Copyright (c) 2026 BChop

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## MIT License — Copyright (c) 2026 Cliff Wade

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
