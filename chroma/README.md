# Chroma for Hermes

![Chroma for Hermes — banner art](docs/chroma-banner.png)

**A hard fork of [Hermes Theme Picker](https://github.com/jdtimothy/hermes-theme-picker), originally by Joshua Timothy.** · [See what changed](CHANGELOG.md)

> **Credits and provenance.** Chroma is a fork. The original plugin — its theme
> catalog, its bundled skin packs, and the apply path that hands theme switches
> to Hermes' own ThemeProvider — is the work of Joshua Timothy, and it is
> licensed MIT. Chroma adds the TweakCN importer, the skin backend that mints
> real gateway skins, and the skin-management features described below.
> The original copyright notice and the bundled skin licences are retained in
> [`LICENSE`](LICENSE) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
> This project is not endorsed by, and is not affiliated with, the original
> author or Nous Research.

Give Hermes a look that feels like yours. **Chroma** turns the entire app into a
gallery of beautiful, one-click themes, led by Dynamic Themes that include both
light and dark modes. Pick a style and watch it appear instantly across every
device connected to your gateway — including the CLI.

![Chroma for Hermes showing Dynamic Themes in dark mode](docs/hermes-chroma.png)

## Highlights

- **Dynamic Themes** — switch one theme between coordinated light and dark
  palettes instead of managing separate skins.
- **Instant, gateway-wide updates** — the current Desktop repaints immediately,
  then every connected Desktop and CLI receives the same palette. Pushing to the
  gateway needs the Python backend (see below); without it the repaint stays on
  this Desktop.
- **A visual gallery** — browse real color swatches, search all 94 skins by
  name, label or description, and preview them in light or dark mode.
- **Favourites** — star a skin from its card and it joins a scrollable rail on
  the left of the gallery, one click from the styles you actually use.
  Unstar it from the card or from the rail.
- **Every skin is one file** — one skin carries its light and its dark palette
  and a font choice of its own. The swatch preview shows both at once as a 2 x 6
  matrix: the light variant over the dark one. There are no single-mode skins.
- **Thirty core skins, six packs** — the picker opens on thirty core skins.
  Turn on Earth, Cyberpunk, Zen, Retro, Noir or Studio to see the rest; the
  choice is remembered on this machine.
- **Three ways to browse** — group by skin, by color family, or by theme pack.
  The color family is measured from the accent in OKLCH, so it follows the color
  rather than a raw saturation number: Persimmon, Apricot, Amber, Gold, Lemon,
  Fern, Teal, Cobalt, Indigo, Violet, Rose and Neutral.
- **Built for comparison** — change themes without leaving the picker, closing
  your chat, or reloading Hermes.
- **Works offline** — the catalog is embedded in the plugin, and themes are also
  available in **Settings → Appearance** when the gateway is unavailable.
- **Made to stick** — each profile remembers its theme and mode across restarts.
- **Bring your own theme** — paste a TweakCN preset (a name or a URL), shadcn or
  TweakCN CSS, a Windows Terminal scheme, a Base16/Base24 palette, or a VS Code
  color theme and it applies to this Desktop right away. With the Python backend
  installed it also becomes a real gateway skin that syncs to every device;
  without it the theme stays local, and the picker says so rather than implying
  a sync that did not happen. Rename, export as hand-editable YAML, or delete
  from the card (backend required).
- **Preview before you commit** — open the "Preview 10s" button on any card
  (hover it with a mouse, arrow to it with the keyboard, or tap it on a touch
  screen) to apply the theme temporarily. A countdown shows the remaining time,
  and the theme reverts automatically when it reaches zero. Click again to stop
  early.

The plugin ships **94 skins**. Each one is a single file carrying a coordinated
light palette, a dark palette and its font choice, so there are no single-mode
skins. A skin belongs to exactly one pack and exactly one color family. See
[Third-Party Notices](THIRD_PARTY_NOTICES.md) for palette credits.

## Install

### Requirements

- A recent version of **Hermes Desktop**.
- A Hermes **gateway** for synchronization across devices. Without one, the
  current Desktop still applies and saves themes locally.
- **Python 3.9+** and `PyYAML` only if you want to regenerate the catalog (the
  generator calls `str.removeprefix`). They are not required to use the picker.
- **`fastapi` and `pydantic`** if you want the Python half at all. The backend is
  a FastAPI router and imports both (`dashboard/plugin_api.py:240-241`). Hermes
  ships them in its own dependency set, so a stock Hermes install already has
  them; a custom or slimmed install may need them present for the gateway-skin
  features (import, rename, export, delete) to work. The Desktop half does not
  need them.

The plugin is a package: the Desktop half (the UI) plus a Python half (the
backend that mints gateway skins). The package lives in `chroma/` of the repo,
and Desktop copies the UI half out to `desktop-plugins/chroma/` by itself.

Open Hermes Desktop, go to **Capabilities -> Plugins -> Install**, and give it
this URL:

```text
https://github.com/TobiasDraven/chroma-for-hermes/tree/main/chroma
```

That is the whole install. The dialog installs the package with the plugin
enabled and switches on its Desktop half in the same step, so **Chroma appears as
an enabled row on the Plugins page and its pane joins the sidebar when the
install finishes**: no manual file copying, no script, no second toggle. The
dialog offers **Force reinstall** for replacing an install you already have.

From a terminal, the install is two steps, install and enable, then a Desktop
reload:

```bash
hermes plugins install TobiasDraven/chroma-for-hermes/chroma
hermes plugins enable chroma
```

The second line is needed on this route only: a non-interactive install cannot
answer the "enable now?" prompt, so it installs the plugin disabled. The Desktop
dialog answers it for you. The CLI also does not materialise the Desktop half in
`desktop-plugins/chroma/`; the Desktop app does that on reload, so reload or
restart it to see the pane.

A backend that is enabled but not yet mounted needs a full Hermes **restart** (the
Python half mounts at startup). Until then the picker's themes still apply and
preview, but an import cannot mint a gateway skin and rename, export and delete
are unavailable.

### Fallbacks: an offline copy, or the Desktop half alone

Nothing below is needed for the install above. It exists for a machine that
cannot reach GitHub, or that wants only the UI.

#### Windows

Double-click `chroma/install\install-windows.cmd` in Explorer. It runs
`chroma/install\install-windows.ps1`, which places the whole package — `plugin.yaml`,
`desktop/`, `dashboard/`, `LICENSE`, `THIRD_PARTY_NOTICES.md` and this README —
at `<hermes home>\plugins\chroma\`. By default it links that folder to this
checkout, so editing the checkout and saving hot-reloads the pane; pass `-Copy`
for a stable copy instead. Restart Hermes Desktop once so the backend mounts.

#### macOS

Double-click `chroma/install/install-macos.command` in Finder. It copies the same
package into `<hermes home>/plugins/chroma/`, honouring `$HERMES_HOME` and
falling back to `~/.hermes`, then asks you to restart Hermes Desktop once so
the pane and the backend mount.

The destination table and the manual copy route below also apply on both
platforms.

### Linux or manual installation (Desktop half only)

This drops only the UI half — no gateway-skin backend. Copy `desktop/plugin.js`
to the exact destination for your platform:

| Platform | Destination |
|---|---|
| Windows | `%LOCALAPPDATA%\hermes\desktop-plugins\chroma\plugin.js` |
| macOS / Linux | `~/.hermes/desktop-plugins/chroma/plugin.js` |

If `HERMES_HOME` is set, use it in place of `%LOCALAPPDATA%\hermes` or
`~/.hermes`.

```bash
hermes_home="${HERMES_HOME:-$HOME/.hermes}"
mkdir -p "$hermes_home/desktop-plugins/chroma"
cp desktop/plugin.js "$hermes_home/desktop-plugins/chroma/plugin.js"
```

Then enable the plugin (see above) and reload desktop plugins. Themes apply and
preview, but imports will not mint a gateway skin.

### Enable gateway-wide themes

On the machine running your gateway, install the bundled skins and Dynamic
Theme transport variants:

```bash
chroma/install/install-gateway-skins.sh
```

The installer honors `$HERMES_HOME` and otherwise uses `~/.hermes/skins/`. It
does not require a gateway restart and will not overwrite modified skins unless
you deliberately rerun it with `--force`; destination symlinks are always
refused.

Finally, in Hermes Desktop:

1. Open the Command Palette and run **Reload desktop plugins** (or restart the
   app).
2. Click the current theme in the status bar, select **Chroma** in the
   sidebar, or run **Open Chroma** from the Command Palette.
3. Pick a theme and choose **Light mode** or **Dark mode**.

## The statusbar mode button

The statusbar chip shows the active theme with a color dot. When the active
theme supports both light and dark modes, a **Dark** or **Light** button appears
next to it — it reads the mode it will switch to, so a dark theme offers
**Light** and a light theme offers **Dark**. Click it to toggle between light
and dark mode without opening the picker. The choice persists per profile.

There is no icon to look for: the control is a word, because an icon font that
the Desktop does not load paints as an empty box.

## How synchronization works

A selection is applied in two coordinated steps:

1. The plugin repaints the current Desktop in place and saves the selected
   theme and mode for the active profile.
2. It sends the matching light or dark skin to the active gateway, which
   broadcasts the palette to every connected Desktop and CLI.

The local catalog remains available if the gateway is offline. A warning tells
you when only the local Desktop was updated.

You can also set an installed gateway skin directly:

```bash
hermes config set display.skin <theme-name>
```

## Add your own skins

Start with **`docs/THEME-PACK-CREATION.md`** — it maps all 43 colour surfaces, states
which ten a new skin must decide (`design_spec: v2`), gives the derivation rules for
the other 33, and covers the colour science (OKLCH ramps, contrast, signals) and
typography. Every skin in the catalogue today is marked `design_spec: v1` and stays
valid as-is.


Hermes skins are YAML files containing a name, description, and colors.

- **Try one immediately:** place it in the gateway's `~/.hermes/skins/`
  directory and apply it once. Live discovery adds it to the current picker
  session.
- **Make it part of the catalog:** add a file to this repository's `skins-v2/`
  directory (one file, both palettes), regenerate `plugin.js`, reinstall the
  plugin, and reload Desktop plugins. The retired v1 `skins/` pair table has
  been archived out of the repository; it was never read by the build.

### Regenerate the catalog

```bash
# skins-v2/ -> desktop/plugin.js (+ gateway-skins/)
python3 scripts/regenerate.py

# Read another catalogue directory (must hold schema v2 skins)
python3 scripts/regenerate.py path/to/skins-v2

# Choose an output file
python3 scripts/regenerate.py path/to/skins-v2 /tmp/plugin.js
```

The generator reads **schema v2** skins only: one YAML per skin carrying both
`light_colors` and `dark_colors`. It refuses anything else by name and leaves
the existing `plugin.js` untouched, so the `~/.hermes/skins/` directory (which
holds mode-locked gateway transports, not catalogue skins) is never valid input.

On Windows, the included runner rebuilds the installed plugin from this
checkout's `skins-v2/` catalogue:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install\regenerate-windows.ps1
```

If needed, install PyYAML with `py -m pip install --user PyYAML==6.0.3`. The generator
refuses to replace `plugin.js` when no valid skins are found.

For UI changes, edit `desktop/plugin.template.js`, run the generator, then copy
the rebuilt `desktop/plugin.js` into Hermes Desktop and reload plugins.

## What it touches

Chroma is a Desktop plugin. This is everything it does outside its own pane.

- **Network:** one `GET`, and only when you paste a TweakCN preset name or URL
  into the import box. The reachable endpoint set is
  `https://tweakcn.com/r/themes/<name>.json`: a bare preset name is expanded to
  that URL, a `tweakcn.com` page URL is rewritten to it, and a URL on any other
  host, or on any scheme other than `https://`, is refused rather than fetched.
  No credential, cookie or authorisation header is sent with it, and the
  response is parsed as JSON and never evaluated as code. Nothing else leaves
  the machine: no telemetry, no analytics, no update check, no remote code. The
  catalogue ships inside `plugin.js`.
- **Writes:** the theme choice through `config.set('skin', …)`, and fourteen
  localStorage keys in the Desktop's own storage. Seven are the plugin's own:

  | Key | What it holds |
  |---|---|
  | `chroma-packs-v1` | which theme packs are enabled |
  | `chroma-overrides-v1` | the mirror of the per-skin palette edits |
  | `chroma-favorites-v1` | the starred skins |
  | `chroma-apply-scope-v1` | the apply scope, per profile |
  | `chroma-card-shape-v1` | the card shape |
  | `chroma-card-size-v1` | the card size |
  | `chroma-group-mode-v1` | the gallery's grouping lens |

  and seven are the app's own keys, which the plugin reads and writes so a
  contributed theme survives a restart — the plugin never invents a new
  app-owned key:

  | Key | What it holds |
  |---|---|
  | `hermes-desktop-user-themes-v1` | the themes the user imported |
  | `hermes-desktop-theme-v2` | the global active theme |
  | `hermes-desktop-mode-v1` | the global active mode |
  | `hermes-desktop-profile-themes-v1` | the active theme, per profile |
  | `hermes-desktop-profile-modes-v1` | the active mode, per profile |
  | `hermes-boot-background` | the boot hint for the title bar |
  | `hermes-boot-color-scheme` | the boot hint for the colour scheme |

  The backend half writes skin YAML and a small `skins/.chroma/` index under
  your Hermes home when you create or edit a skin.
- **Reads:** the Hermes skin directory — the backend reads it, the Desktop half
  does not — and the localStorage keys listed above. No credential store, no
  browser profile, no shell. The plugin has no `requires_env` and no tools.

## Project layout

```text
chroma/                          the shipped package; the catalog installs this subdir
  __init__.py                    the agent-plugin entry point (register(ctx))
  plugin.yaml                    the manifest (name: chroma)
  README.md                      this file
  LICENSE
  THIRD_PARTY_NOTICES.md         licenses for bundled palettes
  desktop/                       the Desktop half and its source template
  dashboard/                     the FastAPI backend
  install/                       the Desktop and the gateway installers
docs/                            repo documentation; never shipped
  SPEC.md                        surfaces, features, backend contract, acceptance commands
  TASKS.md                       open work, adjudicated gate findings, quality-gate debt
  ARCH.md                        layout, build pipeline, load-time constraints, test strategy
  DECISIONS.md                   numbered decisions and WHY
  THEME-PACK-CREATION.md         the skin spec: 43 surfaces, ten for v2, colour science
  PLANS/  RESEARCH/  REVIEWS/    campaign plans, research notes and review documents
skins-v2/                        the catalogue: one file per skin, both palettes
                                 (a build input; never shipped)
gateway-skins/                   the mode-locked transports, generated from the
                                 catalogue by scripts/regenerate.py (never shipped)
scripts/                         build, regeneration and gate scripts (never shipped)
tests/                           the Node and Python suites (never shipped)
.github/workflows/ci.yml         the gates
VERSION                          the version, mirrored into plugin.yaml
rigour.yml                       quality gates; committed; NEVER tuned to make a check pass
CHANGELOG.md                     project-wide change log
```

## Uninstall

Remove the plugin from both halves: delete the `chroma` directory from the
local `desktop-plugins` folder, and remove `chroma` from `plugins.enabled` (or
delete `plugins/chroma`) so the Python half stops loading. Then reload Desktop
plugins or restart Hermes.

The gateway half leaves two kinds of file behind, and neither is removed for
you: the 188 `theme-picker-*.yaml` transports in `~/.hermes/skins/` (written by
`install/install-gateway-skins.sh`), and the `skins/.chroma/` sidecar that holds
the skin index, overrides and trash. Delete those yourself if you want a clean
gateway. Your own skins are never removed.

## FAQ

**Q: The plugin does not appear in Hermes Desktop.**
A: Install it, then reload desktop plugins. Open the Command Palette and run
**Reload desktop plugins**, or restart the app. The plugin loads from
`desktop-plugins/chroma/plugin.js` — confirm that file exists.

**Q: The theme reverts after a few seconds.**
A: An older version wrote CSS variables directly to `:root`, which ThemeProvider
overwrote on re-render. Update to the latest version. The current plugin applies
through Desktop's own theme API and keeps Desktop's React state in step, so it
does not fight the provider.

**Q: There is no icon next to the theme name in the statusbar.**
A: There is no icon to miss. Next to the theme name is a **Dark** or **Light**
button that reads the mode it will switch to. Every bundled skin supports both
modes, so the button is always there; it is absent only for a hand-made theme
that carries one mode.

**Q: I imported a theme but it does not show up.**
A: Check the import format. Supported formats: TweakCN preset name or URL,
shadcn or TweakCN CSS, Windows Terminal scheme (or a whole `settings.json`),
Base16/Base24 scheme, or VS Code color theme JSON. An iTerm2 `.itermcolors`
file is refused by name. The import box shows a hint for the expected format.
If it appears but did not sync to your gateway, the Python backend is not
installed — see [Enable gateway-wide themes](#enable-gateway-wide-themes).

**Q: How do I delete a theme I imported?**
A: Hover the card and click the manage buttons (Export, Rename, Delete). Delete
moves the skin to the Chroma trash — it is recoverable.

**Q: What does "This profile" vs "Everywhere" mean?**
A: "This profile" applies the theme only to the current Hermes profile.
"Everywhere" broadcasts the theme to every connected Desktop and CLI via the
gateway. **The default is "Everywhere"**, so a pick reaches your other devices
until you say otherwise; switch the scope control to "This profile" to keep a
pick local.

**Q: Can I use Chroma without a gateway?**
A: Yes. The local catalog works offline. The current Desktop applies and saves
themes locally. Gateway sync is optional.

**Q: How do I create my own skin?**
A: Place a YAML file in `~/.hermes/skins/` and apply it once. It appears in the
picker after that, not before. See [Add your own skins](#add-your-own-skins) above.

## Credits

Chroma is a hard fork of [Hermes Theme Picker](https://github.com/jdtimothy/hermes-theme-picker)
by Joshua Timothy, used under the MIT License. The skin editor, the theme packs,
the colour taxonomy and the skin format are this fork's work; the palettes
below are the upstream authors' work. It bundles MIT-licensed palettes from:

- [BChop's Hermes Skins Pack](https://github.com/bchop-studio/hermes-skins-pack)
- [CliffWade's Hermes Desktop Theme Pack](https://github.com/CliffWade/hermes-desktop-theme-pack),
  whose theme-switcher concept also inspired this project

Full copyright and license text is available in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT — see [LICENSE](LICENSE).