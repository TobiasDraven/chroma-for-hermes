# Changelog

Notable changes to Chroma are documented here. This project uses
[Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

## [2.1.0] - 2026-10-17

### Features

- Adds a **card size control** — S, M, L — next to the card shape control. The
  choice persists (`chroma-card-size-v1`), the same way the shape does.
- Skin names now sit **above the swatch strip**, and swatches render as
  **horizontal bands** filling the card body. Long names no longer truncate
  into invisibility at the bottom edge.

### Fixed

- Fixes a **first-open crash** — `readStoredThemes` returned a plain object
  while the imported-skin loader iterates with `for…of`; the loader now walks
  `Object.values(readStoredThemes())`. The page failed with
  "readStoredThemes is not iterable" until a reload cleared it.
- Fixes **invisible swatches** — the horizontal palette collapsed to zero
  height in the card's flex column; every band carries `min-h-4` now.
- Fixes the **truncated import pills** — URL / CSS segmented control is
  shrink-locked, so the text input can no longer squeeze it to "U…"/"C…".

### Documentation and infrastructure

- Adds an **FAQ** (first-open errors, the lightbulb, import formats, deleting
  and renaming, "This profile" vs "Everywhere", gateway-less use, authoring).
- Documents the **statusbar lightbulb** and the **10-second preview**.
- Adds **GitHub Actions CI** — the Node test suite and the backend unit tests
  run on every push to `main`. Free for a public repository. First two runs:
  green.

## [2.0.0] - 2026-10-16

### Chroma — hard fork

- Renames the plugin from *Hermes Theme Picker* to **Chroma for Hermes** and the
  plugin id from `theme-picker` to `chroma` (page route, contribution ids,
  dashboard manifest and install paths follow).
- Renames the repository from `hermes-theme-picker` to `chroma-for-hermes`;
  GitHub redirects the old URL, but existing clones should update their
  `origin` remote.
- Credits the original: Joshua Timothy's MIT-licensed *Hermes Theme Picker*. The
  upstream copyright still governs `LICENSE`, and `THIRD_PARTY_NOTICES.md` still
  covers the bundled BChop and CliffWade skin packs. The fork is not endorsed by
  the original author or by Nous Research.
- Adds `plugin.yaml`, the agent-side manifest the Hermes catalog admission gate
  requires. `hermes plugins validate .` now passes every check, with the security
  scan reporting `safe`.
- Removes the last private Hermes-core imports (`utils.atomic_yaml_write`,
  `hermes_yaml`) from the plugin backend. The skin YAML is serialised locally and
  written with `os.replace`, standard library only — catalog rule 9 refuses
  private surfaces because they can break on any release.
- Adds the TweakCN page-URL rewrite and a real error for an HTML answer, so a
  theme page URL or an unknown preset no longer surfaces a JSON parse error.
- Restores the generator's line-ending guarantee: a CRLF template can no longer
  double every line of the built plugin.
- Fixes the package layout: `plugin/` is now `desktop/`, so the repository root
  is the plugin package and Hermes Desktop installs it natively.

Roadmap for the next features: [`docs/PLANS/CHROMA-ROADMAP.md`](docs/PLANS/CHROMA-ROADMAP.md).

## [1.5.1] - 2026-08-08

### Product-focused documentation

- Replaces the technical introduction with a concise product overview centered
  on Dynamic Themes, coordinated Light and Dark modes, and gateway-wide updates.
- Condenses installation, synchronization, customization, and maintenance
  guidance without removing the platform-specific setup details.
- Adds an updated Chroma screenshot showing the expanded Dynamic Scenes
  gallery and mode control.
- Clarifies the relationship between 104 scenes, 57 Dynamic Themes, and 140
  bundled skin palettes.

This patch updates documentation and presentation only; runtime behavior is
unchanged from v1.5.0.

## [1.5.0] - 2026-08-08

### Dynamic Scenes — the main event

Chroma now treats matching Light and Dark palettes as one cohesive
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

- Safely upgrades exact legacy Chroma cache entries into combined Dynamic
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
