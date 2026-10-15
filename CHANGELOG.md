# Changelog

Notable changes to Hermes Theme Picker are documented here. This project uses
[Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

## [Unreleased]

### The data-first picker ships as the default

- `plugin/plugin.js` is now the v2 rewrite. Every catalog theme registers as
  pure `THEMES_AREA` data, and applying goes through
  `useTheme().setTheme` / `setMode` — so Desktop's own ThemeProvider owns the
  paint, the per-profile persistence, and the mode. The v1 revert bug cannot
  recur, because nothing writes theme state the app does not own.
- The installer and the README install path therefore ship v2. Previously they
  copied a v1 `plugin.js` while v2 sat unused beside it.
- The v1 build is kept as `plugin/plugin.v1.js` (source
  `plugin/plugin.v1.template.js`) as a swap-in fallback; its test suite
  (`tests/theme-persistence.test.mjs`) now targets that archived build.

### TweakCN import

- Imports a preset by name or URL from `tweakcn.com/r/themes/<name>.json`, or
  by pasting the theme's `:root` + `.dark` CSS. Both paths run through one
  token map, so a paste and a fetch produce the same theme.
- `oklch()`, `rgb()` and hex tokens are normalised to `#rrggbb` using the SDK's
  own `oklchToHex`.
- Imported themes register live and persist to
  `hermes-desktop-user-themes-v1`, the key Desktop reads on the next boot's
  first frame. A preset that would shadow a built-in theme name is refused.

## [1.5.1] - 2026-08-08

### Product-focused documentation

- Replaces the technical introduction with a concise product overview centered
  on Dynamic Themes, coordinated Light and Dark modes, and gateway-wide updates.
- Condenses installation, synchronization, customization, and maintenance
  guidance without removing the platform-specific setup details.
- Adds an updated Theme Picker screenshot showing the expanded Dynamic Scenes
  gallery and mode control.
- Clarifies the relationship between 104 scenes, 57 Dynamic Themes, and 140
  bundled skin palettes.

This patch updates documentation and presentation only; runtime behavior is
unchanged from v1.5.0.

## [1.5.0] - 2026-08-08

### Dynamic Scenes — the main event

Hermes Theme Picker now treats matching Light and Dark palettes as one cohesive
**Dynamic Scene**. Choose a scene once, switch its mode from the top of the
picker, and cycle through the catalog without leaving your current chat.

- **57 Dynamic Scenes** with dedicated Light and Dark palettes.
- **104 organized scene cards** across Dynamic, Dark-only, and Light-only groups.
- **140 bundled skins**, including all 100 themes from CliffWade's v1.1.0 pack.
- Responsive four-, three-, and two-column layouts for desktop and narrow panes.

### Instant, no-flash theme switching

- Repaints Hermes Desktop immediately and in place—no renderer reload, route
  change, closed picker, or lost chat state.
- Keeps Dark-to-Dark and Light-to-Light transitions in the selected mode without
  an opposite-color flash.
- Uses 114 unique, mode-locked gateway transports so synchronized Desktops render
  the intended concrete palette even when their internal mode state is stale.
- Successful theme changes are quiet; warnings remain for persistence or gateway
  failures.

### Cross-device synchronization

- Sends the selected concrete Light or Dark variant through the active Hermes
  gateway to connected Desktops and CLIs.
- Serializes rapid selections so gateway requests preserve click order.
- Protects newer selections from stale acknowledgements and failed requests.
- Persists scene and mode per Desktop profile and restores combined Dynamic Scene
  names after gateway synchronization.

### Safer installation and reproducible builds

- Adds a gateway-skin installer with modified-file collision protection,
  explicit `--force`, and symlink refusal.
- Pins backend palette inputs and the SHA-256 manifest for CliffWade's 100-theme
  v1.1.0 source pack.
- Generates `plugin/plugin.js` and all gateway transports deterministically.
- Refuses empty, malformed, palette-less, or symlink-only regeneration inputs
  before modifying the plugin or transport catalog.
- Removes runtime Google Fonts requests and keeps the plugin self-contained.

### Migration and reliability

- Safely upgrades exact legacy Theme Picker cache entries into combined Dynamic
  Scenes without overwriting unrelated user-imported themes.
- Preserves current Light selections and restores legacy dark-source selections
  to Dark mode where the complete canonical palette matches.
- Adds ordering, failure-recovery, profile-isolation, persistence, installer, and
  catalog regression coverage.

### Known limitation

If a gateway request starts under one profile, the user switches profiles before
its acknowledgement, and the newly active profile uses a custom/imported Desktop
theme absent from the embedded catalog, recovery may fall back to the default
catalog appearance. Embedded scenes and newer in-session selections recover
correctly.

[1.5.1]: https://github.com/jdtimothy/hermes-theme-picker/releases/tag/v1.5.1
[1.5.0]: https://github.com/jdtimothy/hermes-theme-picker/releases/tag/v1.5.0
