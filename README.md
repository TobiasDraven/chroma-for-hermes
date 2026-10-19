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
- **A visual gallery** — browse real color swatches, search 94 skins by name,
  and preview them in light or dark mode.
- **Every skin is one file** — one skin carries its light and its dark palette
  and a font choice of its own. The swatch preview shows both at once as a 2 x 6
  matrix: the light variant over the dark one. There are no single-mode skins.
- **Thirty core skins, six packs** — the picker opens on thirty core skins.
  Turn on Earth, Cyberpunk, Zen, Retro, Noir or Studio to see the rest; the
  choice is remembered on this machine.
- **Two ways to browse** — group by skin, or switch the dropdown to group by
  color family: Persimmon, Apricot, Amber, Gold, Lemon, Fern, Teal, Cobalt,
  Indigo, Violet, Rose and Neutral. The family is measured from the accent in
  OKLCH, so it follows the color rather than a raw saturation number.
- **Built for comparison** — change themes without leaving the picker, closing
  your chat, or reloading Hermes.
- **Works offline** — the catalog is embedded in the plugin, and themes are also
  available in **Settings → Appearance** when the gateway is unavailable.
- **Made to stick** — each profile remembers its theme and mode across restarts.
- **Bring your own theme** — paste a TweakCN preset, a Windows Terminal scheme,
  a Base16/Base24 palette, or a VS Code color theme and it applies to this
  Desktop right away. With the Python backend installed it also becomes a real
  gateway skin that syncs to every device; without it the theme stays local, and
  the picker says so rather than implying a sync that did not happen. Rename,
  export as hand-editable YAML, or delete from the card (backend required).
- **Preview before you commit** — hover any card and click "Preview 10s" to
  apply the theme temporarily. A countdown shows the remaining time, and the
  theme reverts automatically when it reaches zero. Click again to stop early.

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

The plugin is a package: the Desktop half (the UI) plus a Python half (the
backend that mints gateway skins). Both land in your Hermes home's
`plugins/chroma/` directory, and Desktop copies the UI half out to
`desktop-plugins/chroma/` itself. **The Desktop half is opt-in, so installing
the files is not enough — you must enable the plugin before it appears.**

The easiest route is to install straight from this repository. In Hermes
Desktop's plugin page, give it this URL:

```text
https://github.com/TobiasDraven/chroma-for-hermes
```

Or from a terminal:

```bash
hermes plugins install TobiasDraven/chroma-for-hermes
```

Then enable it: open **Capabilities → Plugins**, find **Chroma** and enable it
(this adds `chroma` to `plugins.enabled` in `config.yaml`), and run **Rescan** if
the row is not listed. A backend that is enabled but still not mounted needs a
full Hermes **restart**, not just a plugin reload — the Python half is mounted at
startup. Until the backend is enabled and Hermes restarted, the picker's themes
still apply and preview, but an import cannot mint a gateway skin and the rename,
export and delete actions are unavailable.

Prefer doing it by hand? Clone or download this repository, then follow your
platform below.

### Windows

Double-click `install\install-windows.cmd`, or run:

```powershell
.\install\install-windows.cmd
```

The installer places the whole package at `<hermes home>\plugins\chroma` (a
junction to this checkout by default, or a copy with `-Copy`), and Desktop then
copies the UI half into `desktop-plugins\chroma`. It uses `%HERMES_HOME%` when
set, otherwise an existing `%LOCALAPPDATA%\hermes` Desktop home, and falls back
to `%USERPROFILE%\.hermes`. The exact destination is printed when installation
finishes. **Restart Hermes Desktop once so the Python backend mounts**, then
enable the plugin if you have not already (see above).

### macOS

Double-click `install/install-macos.command`, or run:

```bash
./install/install-macos.command
```

If macOS blocks the downloaded script, right-click it and choose **Open**, or
run `sh install/install-macos.command`. The installer uses `$HERMES_HOME` when
set and otherwise installs under `~/.hermes`, with the same package layout as
the Windows script.

> The Windows installer has been walked end to end on Windows 11: both modes
> install a directory that passes `hermes plugins validate`. The macOS script is
> written against the same layout and checked for shell syntax, but it has not
> been run on a Mac. If it fails, the manual layout below is the fallback.

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
./install/install-gateway-skins.sh
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

## The statusbar lightbulb

The statusbar chip shows the active theme with a color dot. When the active
theme supports both light and dark modes, a **lightbulb icon** (💡) appears
next to it. Click the lightbulb to toggle between light and dark mode without
opening the picker. The choice persists per profile.

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

Hermes skins are YAML files containing a name, description, and colors.

- **Try one immediately:** place it in the gateway's `~/.hermes/skins/`
  directory and apply it once. Live discovery adds it to the current picker
  session.
- **Make it part of the catalog:** add a file to this repository's `skins-v2/`
  directory (one file, both palettes), regenerate `plugin.js`, reinstall the
  plugin, and reload Desktop plugins. The retired `skins/` pair table is not
  read by the build.

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

If needed, install PyYAML with `py -m pip install --user PyYAML`. The generator
refuses to replace `plugin.js` when no valid skins are found.

For UI changes, edit `desktop/plugin.template.js`, run the generator, then copy
the rebuilt `desktop/plugin.js` into Hermes Desktop and reload plugins.

## What it touches

Chroma is a Desktop plugin. This is everything it does outside its own pane.

- **Network:** one HTTPS `GET` to `https://tweakcn.com/r/themes/<name>` when you
  import a TweakCN preset. Nothing else leaves the machine: no telemetry, no
  analytics, no update check, no remote code. The catalogue ships inside
  `plugin.js`.
- **Writes:** the theme choice through `config.set('skin', …)`, and its own
  keys in the Desktop's local storage (`chroma-packs-v1` for the pack chips,
  `chroma-overrides-v1` and its mirror for palette edits, plus the user-theme
  key). The backend half writes skin YAML and a small `skins/.chroma/` index
  under your Hermes home when you create or edit a skin.
- **Reads:** the Hermes skin directory and its own keys. No credential store,
  no browser profile, no shell. The plugin has no `requires_env` and no tools.

## Project layout

```text
desktop/                      Desktop plugin and source template
skins-v2/                      The catalogue: one file per skin, both palettes
skins/                         Retired v1 pair table (migration record only)
gateway-skins/                 Mode-locked gateway transport palettes
scripts/regenerate.py          Catalog generator
install/                       Desktop and gateway installers
docs/ARCH.md                   Implementation details
THIRD_PARTY_NOTICES.md         Licenses for bundled palettes
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

**Q: The lightbulb icon does not appear in the statusbar.**
A: Every bundled skin supports both modes, so the lightbulb appears for all of
them. It is absent only for a hand-made theme that carries one mode.

**Q: I imported a theme but it does not show up.**
A: Check the import format. Supported formats: TweakCN preset name or URL,
shadcn CSS, Windows Terminal scheme, Base16/Base24 scheme, or VS Code color
theme JSON. The import box shows a hint for the expected format. If it appears
but did not sync to your gateway, the Python backend is not installed — see
[Enable gateway-wide themes](#enable-gateway-wide-themes).

**Q: How do I delete a theme I imported?**
A: Hover the card and click the manage buttons (Export, Rename, Delete). Delete
moves the skin to the Chroma trash — it is recoverable.

**Q: What does "This profile" vs "Everywhere" mean?**
A: "This profile" applies the theme only to the current Hermes profile.
"Everywhere" broadcasts the theme to every connected Desktop and CLI via the
gateway. Use "Everywhere" when you want all your devices to follow.

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