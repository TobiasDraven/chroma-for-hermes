# Chroma for Hermes

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
  then every connected Desktop and CLI receives the same palette.
- **A visual gallery** — browse real color swatches, search 104 scenes by name,
  and preview them in light or dark mode.
- **Built for comparison** — change themes without leaving the picker, closing
  your chat, or reloading Hermes.
- **Works offline** — the catalog is embedded in the plugin, and themes are also
  available in **Settings → Appearance** when the gateway is unavailable.
- **Made to stick** — each profile remembers its theme and mode across restarts.
- **Bring your own theme** — paste a TweakCN preset, a Windows Terminal scheme,
  a Base16/Base24 palette, or a VS Code color theme and it becomes a real
  gateway skin. Rename, export as hand-editable YAML, or delete from the card.
- **Preview before you commit** — hover any card and click "Preview 10s" to
  apply the theme temporarily. A countdown shows the remaining time, and the
  theme reverts automatically when it reaches zero. Click again to stop early.

The plugin includes **140 skin palettes**, organized into 57 Dynamic Themes plus
dark-only and light-only scenes. See [Third-Party Notices](THIRD_PARTY_NOTICES.md)
for palette credits.

## Install

### Requirements

- A recent version of **Hermes Desktop**.
- A Hermes **gateway** for synchronization across devices. Without one, the
  current Desktop still applies and saves themes locally.
- **Python 3.8+** and `PyYAML` only if you want to regenerate the catalog. They
  are not required to use the picker.

The easiest route is to install straight from this repository. In Hermes
Desktop's plugin page, give it this URL:

```text
https://github.com/TobiasDraven/chroma-for-hermes
```

Or from a terminal:

```bash
hermes plugins install TobiasDraven/chroma-for-hermes
```

Both routes put the plugin in your Desktop home's `desktop-plugins/chroma/`
directory. Prefer doing it by hand? Clone or download this repository, then
follow your platform below.

### Windows

Double-click `install\install-windows.cmd`, or run:

```powershell
.\install\install-windows.cmd
```

The installer uses `%HERMES_HOME%` when set. Otherwise, it selects an existing
`%LOCALAPPDATA%\hermes` Desktop home and falls back to
`%USERPROFILE%\.hermes`. The exact destination is printed when installation
finishes.

### macOS

Double-click `install/install-macos.command`, or run:

```bash
./install/install-macos.command
```

If macOS blocks the downloaded script, right-click it and choose **Open**, or
run `sh install/install-macos.command`. The installer uses `$HERMES_HOME` when
set and otherwise installs under `~/.hermes`.

### Linux or manual installation

Copy `desktop/plugin.js` to the exact destination for your platform:

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
- **Make it part of the catalog:** add it to this repository's `skins/`
  directory, regenerate `plugin.js`, reinstall the plugin, and reload Desktop
  plugins.

### Regenerate the catalog

```bash
# Bundled skins/ → desktop/plugin.js
python3 scripts/regenerate.py

# Read another skin directory
python3 scripts/regenerate.py ~/.hermes/skins

# Choose an output file
python3 scripts/regenerate.py ~/.hermes/skins /tmp/plugin.js
```

On Windows, the included runner combines bundled themes with skins installed in
`%LOCALAPPDATA%\hermes\skins\` and updates the installed plugin:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install\regenerate-windows.ps1
```

If needed, install PyYAML with `py -m pip install --user PyYAML`. The generator
refuses to replace `plugin.js` when no valid skins are found.

For UI changes, edit `desktop/plugin.template.js`, run the generator, then copy
the rebuilt `desktop/plugin.js` into Hermes Desktop and reload plugins.

## Project layout

```text
desktop/                      Desktop plugin and source template
skins/                         Bundled source palettes
gateway-skins/                 Mode-locked gateway transport palettes
scripts/regenerate.py          Catalog generator
install/                       Desktop and gateway installers
docs/ARCHITECTURE.md           Implementation details
THIRD_PARTY_NOTICES.md         Licenses for bundled palettes
```

## Uninstall

Delete the `chroma` directory from the local `desktop-plugins` folder,
then reload Desktop plugins or restart Hermes. Your skin files are not removed.

## FAQ

**Q: The plugin does not appear in Hermes Desktop.**
A: Install it, then reload desktop plugins. Open the Command Palette and run
**Reload desktop plugins**, or restart the app. The plugin loads from
`desktop-plugins/chroma/plugin.js` — confirm that file exists.

**Q: The theme reverts after a few seconds.**
A: An older version wrote CSS variables directly to `:root`, which ThemeProvider
overwrote on re-render. Update to the latest version. The current plugin uses
`requestTheme()`, which is the supported code path.

**Q: The lightbulb icon does not appear in the statusbar.**
A: The lightbulb only appears when the active theme supports both light and
dark modes. Single-mode themes (dark-only or light-only) do not show it.

**Q: I imported a theme but it does not show up.**
A: Check the import format. Supported formats: TweakCN preset name or URL,
shadcn CSS, Windows Terminal scheme, Base16/Base24 scheme, or VS Code color
theme JSON. The import box shows a hint for the expected format.

**Q: How do I delete a theme I imported?**
A: Hover the card and click the manage buttons (Export, Rename, Delete). Delete
moves the skin to the Chroma trash — it is recoverable.

**Q: What does "This profile" vs "Everywhere" mean?**
A: "This profile" applies the theme only to the current Hermes profile.
"Everywhere" broadcasts the theme to every connected Desktop and CLI via the
gateway. Use "Everywhere" when you want all your devices to follow.

**Q: Can I use Chromeskin without a gateway?**
A: Yes. The local catalog works offline. The current Desktop applies and saves
themes locally. Gateway sync is optional.

**Q: How do I create my own skin?**
A: Place a YAML file in `~/.hermes/skins/`. It appears in the picker after a
reload. See [Add your own skins](#add-your-own-skins) above.

## Credits

The picker is an original implementation and bundles MIT-licensed palettes
from:

- [BChop's Hermes Skins Pack](https://github.com/bchop-studio/hermes-skins-pack)
- [CliffWade's Hermes Desktop Theme Pack](https://github.com/CliffWade/hermes-desktop-theme-pack),
  whose theme-switcher concept also inspired this project

Full copyright and license text is available in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT — see [LICENSE](LICENSE).