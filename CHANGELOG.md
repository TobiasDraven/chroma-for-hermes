# Changelog

Notable changes to Chroma are documented here. This project uses
[Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

## [Unreleased]

## [2.9.1] - 2026-10-21

Chroma now declares that it owns no Python packages, so installing it never
reaches a package resolver - and the tree that installs is the tree CI proves
on three operating systems.

The README is the plugin's public catalogue page — a stranger reads it before
they install it. A review campaign (2026-10-20, recorded under
`docs/REVIEWS/review-2026-10-20/`) went through the tree looking for claims
the code cannot back, and this release is the corrections. Nothing here changes
what the plugin does to a theme; it changes what the project says about it, and
three package-level defects the same review found.

### Fixed - the install path no longer depends on a package resolver

- **The manifest now SAYS that it owns no Python packages.** Chroma has always
  imported nothing it did not ship, but the manifest never said so: it
  declared no `python_dependencies` and no `python_runtime` either, which left
  the host to infer the plugin's Python contract from silence. It now declares
  `python_runtime: external` and no dependencies, so the host's declaration
  reader reports `install_requirements` as EMPTY and Chroma is not a
  workspace member - no resolver, no dependency prompt, no uv lock, no frozen
  lockfile. The contract is a permanent gate
  (`tests/test_dependency_contract.py`), not a comment.
- **The dashboard half's `fastapi`/`pydantic` are the HOST's, and the manifest
  now says that too.** Both are Hermes core dependencies, and the bundled
  dashboard plugins (`kanban`, `hermes-achievements`) import them the same way
  while declaring nothing. Chroma now follows that pattern instead of implying
  it owns packages it never installs.
- **The `availableThemes` guard reached the shipped build.** `syncDesktopState`
  called `setTheme` with any name it was given; the host coerces an unknown
  name to the default and persists it, which corrupted the profile. It now
  checks the name against the host's `availableThemes` first.

### Fixed — the public page (README)

- **The README documented a status-bar lightbulb the plugin does not have.**
  The shipped build renders the **word** `Dark`/`Light` beside the theme name —
  a codicon that painted as an empty box wherever that font was not loaded was
  replaced by text in 2.6.0, and the README still described the icon. The
  section is rewritten around the button that is there, and the FAQ entry that
  sent a reader looking for a 💡 is gone.
- **"What it touches" named three of the fourteen localStorage keys the plugin
  reads or writes.** It now lists all fourteen — the seven `chroma-*` keys the
  plugin owns and the seven `hermes-desktop-*` / `hermes-boot-*` keys the app
  already owns — and says plainly that the Desktop half reads no skin
  directory; the backend does.
- **The network disclosure was wrong.** It said "one HTTPS `GET` to
  tweakcn.com". The reachable endpoint set is now named exactly, the request is
  described as user-initiated, and the disclosure says no credential, cookie or
  authorisation header travels with it. The same disclosure is in the PR draft,
  because the catalogue's rule 13 asks for it in both places.
- **"Two ways to browse" was two of three.** The gallery has three lenses — by
  skin, by colour family, and by theme pack — and the pack lens was invisible to
  a reader. The count is fixed and the pack lens is named.
- **The import formats were listed two different ways.** The Highlights bullet
  and the FAQ disagreed. One list now, and it matches what the importer sniffs.
- **A merged heading** — `#### Windows### Linux or manual installation` — rendered
  as one broken line on the plugin's own catalogue page. The Windows and macOS
  installer steps are documented again.
- **The apply scope's default was not disclosed.** It is *Everywhere*; the FAQ
  now says so.
- **`design_spec` was described as if v2 skins existed.** Every skin in the
  catalogue today is `design_spec: v1`; the text says that.

### Fixed — the disclosure register (`docs/DISCLOSURE.md`)

- **A false claim about the SDK is gone.** The document repeated "the public
  plugin SDK does not expose ThemeContext.setTheme/setMode". The SDK exports
  `useTheme`, and that context does expose both. What is true is now what the
  document says: Chroma writes the app's root theme attributes and custom
  properties — the same `data-hermes-theme` / `data-hermes-mode` / `--theme-*`
  protocol Desktop's own provider writes — because the SDK's `setTheme` only
  schedules a repaint on the provider's next render; and Chroma also hands the
  switch to the provider through `setTheme`/`setMode`, so React state and the
  painted root tokens stay in step.

### Fixed — the specification, the submission record and the roadmap

- `docs/SPEC.md` carried the wrong plugin version and counted **six**
  registrations where the build makes **five**. The storage-key list was
  missing one key; it now names all fourteen.
- The submission record quoted stale test counts and did not show the admission
  gate's own output. It now quotes the measured numbers and the gate's real
  output.
- The roadmap carried the maintainer's absolute home paths and a local install
  id. They are `<hermes home>` placeholders now.

### Fixed — the package

- **The admission gate's capability probe now runs.** The package root had no
  `__init__.py`, so the gate printed
  `⚠ no __init__.py — capability probe skipped (manifest-only plugin)` and
  checked *nothing* about the declared capabilities. There is one now, and the
  gate's `declared tools / hooks / middleware — matches registrations` lines
  are the check itself.
- **`plugin.yaml` declared two things the host does not read.** `kind: plugin`
  is not a Hermes plugin kind (the valid kinds are `standalone`, `backend`,
  `exclusive`, `platform`, `model-provider`), so the loader warned on every
  discovery pass; it is `standalone` now. `provides_middleware` is a catalogue
  field, not a manifest field, so the loader warned and ignored it - the "no
  middleware" claim lives in the catalogue entry's `capabilities` block, where
  the catalogue reads it. Neither field ever reached a release: they were
  introduced and corrected inside this unreleased cycle, so no installed
  Chroma ever carried them.
- **`docs/chroma-banner.png` is 402 KB instead of 1.4 MB.** The install scanner
  flags any single file over 1 MiB. The banner is re-encoded as a 256-colour
  palette PNG at the same 1536×693, visually unchanged.
- **The installers say Chroma.** Five files under `install/` still said "Theme
  Picker" in the strings a user reads.

### Changed - the retired v1 skin pack

- **The 150-file v1 single-palette pack under `skins/` is retired.** The build
  reads only `skins-v2/`; the v1 pair table is retired with no fallback to it.
  The published tree tracked 540 files, over the host's 400-file cap
  (`tools/plugin_guard.py`), which was a standing scan finding on every
  install. The pack stays recoverable from the published commit `9439f41`, and
  the pinned hash manifest still proves it: the retirement is a removal, not a
  loss.

### Added - the gates that keep the above true

- `tests/test_dependency_contract.py` - the zero-resolution contract: the
  manifest declares no dependencies, no dependency-bearing manifest sits at the
  plugin root, the agent entry point imports only the standard library, the
  dashboard imports only host-provided packages, and no shipped entry point
  names a package manager.
- `tests/test_crossplatform.py` - one tree, three operating systems: no
  symlinks, no case-insensitive path collisions, no Windows-reserved names, no
  trailing space or dot, no machine-specific absolute paths in shipped config,
  LF-only shell scripts, and a file count the host accepts.
- `tests/test_build_sync.py` - the shipped build must be byte-identical to what
  the generator produces. A template edit that was never regenerated used to
  pass every other gate while shipping the previous build.
- `tests/test_regenerate.py` - the two v1-pack tests now assert the RETIREMENT
  and the RECOVERABILITY of the pack, instead of asserting it ships.

## [2.9.0] - 2026-10-19

### Added

- **The pane is operable and announceable without a pointer or a screen (C9).** The
  last open roast item, closed by a scout, a plan, an adversarial review and an
  implementation — all four on the record under `docs/PLANS/` and `docs/REVIEWS/`.
  - **Real modals.** `useModalA11y` gives both dialogs focus-in on open, a Tab trap, a
    document-level Escape (the old handler only fired once focus was already inside
    the overlay, which is why Escape did nothing right after opening) and focus
    restore to whatever opened the dialog. `aria-modal` stops lying.
  - **Names.** Words instead of glyphs on the five segmented controls, each group
    labelled; a stable skin-scoped name on the preview pill; item-scoped names on every
    repeated verb (`Export <skin>`, `Rename <skin>`, `Delete <skin>`, `Skip <name>`,
    `Export <pack>`, `Delete <pack>`); `aria-label` on every unlabelled input;
    `aria-hidden` on the decorative dots; `aria-pressed` on the skip control.
  - **State and structure.** An explicit, concise accessible name on every card button —
    including circle cards, whose name was previously nothing but the palette inside
    them — plus `aria-current` on the active card, `aria-describedby` + `role='alert'`
    on field errors, `role='list'`/`listitem` on the gallery, headings labelling their
    sections, a labelled `aside` for the favourites rail, and a concise `role='img'`
    text alternative on the palette (a description, not a hex wall).
  - **One live region per surface.** A visually hidden `aria-live='polite'` region,
    written on discrete events only: preview start and end, "Unsaved changes",
    collision, and the busy outcomes. The countdown ticks four times a second and is
    never announced. The colour well shows the host's own focus ring when the platform
    picker is reached by keyboard.

### Changed

- **A card is one tab stop.** The preview pill, the action row and the manage row are a
  roving set reached with the arrow keys from the card; each row is a labelled
  `role='toolbar'` and every member is `tabIndex=-1` until the card is focused. A mouse
  user is unaffected — every control stays visible and clickable. This removes four to
  eight stops per card, times the whole catalogue, from the tab sequence.

### Accepted, not hidden

- **Focus behaviour is not unit-tested, and this entry does not claim it is.** The
  harness has no real `document`, no layout and stubs `useEffect`, so focus-in, the Tab
  trap, document Escape, focus restore and the roving keys are verified by a headless
  render and the Captain's walk — not by `tests/aria.test.mjs`, whose header says so in
  as many words. The suite covers the attribute surface (13 tests).
- **Rigour: 23 findings, none introduced by this pass.** All pre-existing — complexity
  16 in `stripJsonNoise`, the loader-provided-import CRITICALs, file-size debt. The five
  `style-drift` LOWs are Python naming drift in files this pass never touched; rigour's
  adaptive baseline is why they surface in one run and not another.

## [2.8.1] - 2026-10-19

### Fixed

- **The quiet tier of 44 skins now clears AA.** `banner_dim` failed the 4.5:1 floor
  against its own surface on 44 (skin, mode) pairs (11 light, 33 dark). Each now sits
  at the smallest lightness that reaches the floor, with hue and chroma held fixed.
  Because the quiet tier is one authored value copied across keys in these skins, the
  move carries `status_bar_dim`, `ui_thinking` and `syntax_comment` with it: 168 values
  in 44 files. 0 of 94 skins are below 4.5:1 in either mode, was 44 of 94.
- Eleven light-mode `status_bar_dim` values remain between 3.996:1 and 4.238:1 on
  `status_bar_bg`: every one improved (1.77-3.96 before) and none regressed. The bar
  surface is darker than `background`, so a lightness tuned for the banner stops just
  short. Accepted and recorded in `docs/THEME-PACK-CREATION.md` section 12.

### Added

- `scripts/check-package.py` - the package contract: every version locus, the manifest
  fields, both entry points, the committed build's stamp, and tracked junk. CI runs it.
- `scripts/check-host-classes.py` - fails on any class the pane uses that the HOST's
  compiled stylesheet never generates. The Desktop app builds Tailwind from its own
  sources, so a utility the host never used has no rule and the element silently takes
  the browser default. CI cannot run it (it needs the installed app's CSS).

### Fixed (pane)

- The editor dialog could not be scrolled. `max-h-[87vh]` and `w-[min(94vw,64rem)]`
  have no rule in the host's stylesheet, so the sheet grew to its full 36-row height
  and ran off the viewport with the Save button. The cap, the column, the scrim and the
  scroll container are inline styles now, pinned by a test.
- Twenty-five further classes in the same state (role colours, alpha fills, the card
  preview pill's centring, hairline rings) were replaced by inline styles, or deleted
  where the variant never had a rule. The gate reports 0.
- The card's action row (star, Edit, Fork) sat over the card's edge; the frame now owns
  the border, radius and aspect ratio, and the row is the frame's last in-flow child.

### Added (pane)

- Favourites: a star on every card, a scrollable rail on the left, removable from
  either. Stored under `chroma-favorites-v1`.

## [2.8.0] - 2026-10-19

Favourites, and a card frame that the actions cannot leave.

### Added
- **A favourites rail.** A column on the left of the gallery, scrolling on its own, with a
  star on every card. Starred skins are stored under `chroma-favorites-v1`; a name the
  catalogue no longer carries is dropped on read rather than rendered as a ghost row. The
  rail is the one place a favourite is removed from, and it is not rendered at all while
  the shelf is empty.
- `tests/favorites.test.mjs` (7 tests): the store survives corrupt JSON and junk entries, a
  toggle moves exactly one name, the star paints both of its states, the row keeps its
  order, and the rail resolves, applies and removes.

### Fixed
- **The card's action row can no longer leave the card.** The frame (border, radius,
  aspect ratio, `overflow-hidden`) belongs to the box, not to the button beneath the row,
  and the row is the frame's last child IN FLOW — so it is not positioned at all. Reported
  from the pane three times; the third fix moved the row, this one removes the class of
  defect. The card parity fixture is re-pinned with the row (27 cases).

## [2.7.0] - 2026-10-19

**The skin specification.** A skin is now written against a contract that can be
read, followed, and checked — not against a palette that happens to render.

### Added

- **`docs/THEME-PACK-CREATION.md`** — the guiding document. All 43 colour surfaces
  with what each one paints and whether the Desktop window reads it; the ten
  surfaces a v2 skin must decide; the derivation rules for the other 33; the colour
  science (OKLCH ramps, dark elevation, contrast, colour-vision-safe signals,
  typography); the build recipe and the acceptance gates.
- **`design_spec`** on every skin. `v1` is a hand-authored palette, grandfathered;
  `v2` is ten named surfaces plus both fonts. All 94 shipped skins are marked v1 so
  each can be reviewed and revised on its own.
- **The gate enforces v2.** `scripts/check-packs.py` rejects a v2 skin that omits any
  of the ten surfaces in either mode, and rejects an unknown spec outright.
  `tests/test_skin_contract.py` proves the rejection names the missing surface.

## [2.6.0] - 2026-10-19

The catalogue is rebuilt. This is the release prepared for the public directory.

### Changed

- **The card actions live inside the card.** Edit and Fork sit on the swatch, inset
  by the card's own corner, at 0.9 opacity so the colour under them still reads,
  full on hover. They no longer hang off the bottom edge.
- **The editor was rebuilt around one scroll.** A pinned header, one scrolling
  body, a pinned footer with Save — the palette is 36 rows, so scrolling the whole
  dialog used to take the Save button with it. Wider sheet (`min(94vw, 64rem)`),
  taller preview, section rules between groups, hairline row hover.
- **Fonts are chosen from a list, not typed.** Two pickers, Interface and Code,
  each offering a short set of real stacks plus the skin's own current choice. A
  font is a decision, not a sentence.

- **The editor edits the whole skin.** It showed six roles wrapping ten keys; a
  full skin carries **43** named colours and a ported half carries 27. All of
  them are rows now, grouped (Core, Menus, Text, State, Syntax, Diffs, Framing),
  in both modes. A colour this window does not paint carries a `CLI` mark in its
  row, because the Desktop's theme mapper reads a subset of the palette while the
  CLI reads all of it — an edit that does not repaint the editor must say so.
- **The editor sets fonts.** A skin carries two stacks, `fontSans` and `fontMono`,
  and there was no way to choose either. Both are fields now, with presets and
  free text, riding the same override record as the colours.
- **The *Both* badge is gone.** Most of the catalogue is dynamic, so the word
  repeated on every card to say what the card already shows. Only a single-mode
  skin carries a word now.

### Fixed

- **The card actions were white boxes.** `bg-black/45` was never in the host's
  stylesheet, so the button fell back to the host's default white paint while its
  label stayed white. The pill now carries its own background, text and edge as
  inline style, which no build can drop.

- **Every icon that failed in the field is a word now.** The card actions read
  *Edit* and *Fork*; the mode badge reads *Both* / *Dark* / *Light*; the status
  bar reads the mode it will switch to. Three icon strategies reached a real
  Desktop as an empty control — a codicon face the host did not paint, an inline
  SVG the app's JSX runtime did not paint, and a Unicode glyph the font did not
  carry. Text is the one path all of them share.
- **The pack manager moved behind a button.** It was a block in the manage panel
  that rendered "No packs yet" over an empty shelf. The Theme packs dialog owns
  it now, behind *Manage packs…*, and the gallery keeps the pane for skins.
- **The pane shows its build.** A small version stamp sits beside the title, so a
  field report names the build it came from instead of us inferring it.

### Fixed

- **The editor panel was black.** The opaque sheet resolved to its fallback
  because the CSS variable it read is not defined in the overlay's scope. The
  surface is now computed from the skin being edited — a real `#rrggbb`, wearing
  the skin it edits, and impossible to resolve to nothing.
- **A desktop-only install no longer reports a backend it does not have.** The
  first backend call came back "not found" and raised a schema notice; one 404
  now retires the transport for the session, and a missing schema is never news.

- **The pack chips and the category manager moved into modals.** Two buttons in
  the settings row — *Theme packs* and *Categories* — open them, so the gallery
  keeps its height for skins. The rule is unchanged: core is always on, a pack
  adds its own skins, nothing is deleted.
- **A third lens: By theme pack.** The gallery can now group by skin, by colour
  family, or by the six packs, core first.

### Fixed

- **The edit and fork buttons were white squares.** They shipped as `codicon-*`
  spans, and a Desktop that does not load the codicon face painted an empty box —
  an invisible control whatever its tooltip said. Both are inline SVG now, along
  with the status-bar lightbulb. No icon font is required anywhere.
- **The editor was see-through.** Its sheet sat on a token that resolves to
  nothing in the overlay's context, so the gallery read through the dialog. The
  sheet is opaque (`--card`), and the two new modals share it.

- **The editor's Text and Surface controls were cosmetic.** Both wrote a key the
  palette engine never read first, so the card preview and the saved override
  moved while the applied theme did not. Text now writes `ui_text`; the palette
  now uses a skin's authored `status_bar_bg` as its raised surface instead of a
  mix that only approximated it (84 of 94 skins sit a shade differently; no other
  role moved). Save is disabled until something changed, so opening a skin and
  pressing Save no longer pins the shipped palette as an override.

### Changed

- **One skin, one file.** `skins-v2/` holds 94 skin files. Each carries a light
  palette, a dark palette, a colour family, a pack, a measured energy and a font
  choice. The old pair table in `skins/` is retired; the build no longer reads it.
- **Twelve measured colour families** replace the old mixed-axis shelves:
  Persimmon, Apricot, Amber, Gold, Lemon, Fern, Teal, Cobalt, Indigo, Violet,
  Rose, Neutral. Each is cut on a real gap in the catalogue's own accent hues,
  and Neutral is the shelf below chroma 0.04.
- **Six theme packs.** Thirty core skins ship visible; Earth, Cyberpunk, Zen,
  Retro, Noir and Studio hold the other 64 behind a chip row. The choice is
  remembered on this machine.
- **A font per skin.** Every skin names its own sans and mono stack, ending in
  the previous default so an uninstalled face changes nothing.
- **The fifteen host built-in themes are gone.** They were Hermes' own themes and
  the only cards that failed the signature-role check.

### Fixed

- The generator refuses a damaged skin file instead of silently shipping a
  smaller catalogue, and it no longer falls back to the retired v1 bundle when
  `skins-v2/` is missing.
- `scripts/check-packs.py` now also rejects a missing pack, an unknown energy, a
  skin with no sans font and a duplicate display label; it runs in CI.
- Two skins were both called "Obsidian"; the core violet one is now
  "Obsidian Violet".
- The gateway installer no longer copies the 150 retired v1 skins.

### Verified

94 of 94 palettes byte-identical across the cutover; JS 224/224; backend 163/163;
generator 16 passed; `hermes plugins validate .` passes.

## [2.5.2] - 2026-10-18

### Fixed

- **Backend data loss, twice over.** Two concurrent imports lost a provenance
  entry *and* raised `PermissionError` on the shared `index.json.tmp`; the temp
  name is now unique per write (`mkstemp`) and the index read-modify-write is
  serialised by a module-level lock. Separately, a corrupt index was read as
  empty and the next write persisted that emptiness, wiping provenance: a
  present-but-unreadable index is now quarantined beside itself and raises,
  while a missing file still reads empty.
- **The import path no longer lies.** A failed mint used to be swallowed and the
  user told "Imported …". The notice is now chosen by a pure
  `importOutcomeNotice(label, minted, error)`: only a real mint reports a bare
  success, a missing backend is stated as local-only with the reason, and a
  backend error surfaces its cause. A `backendReady` notice names exactly what
  still works without the Python half instead of hiding the manage buttons.
- `_hex` now refuses a non-hex token with a 400 naming the value (it accepted
  `#zzzzzz`, `#12 456`, `#fffffe` and wrote a skin), a theme over 64 KiB or
  declaring over 512 colour tokens is refused with 413, Windows reserved device
  names (`con`, `nul`, `com1`) no longer pass the slug allowlist, and a failed
  index write rolls the skin back rather than orphaning it.

### Changed

- **The public claims now describe the shipped build.** The README, ARCH,
  ARCHITECTURE, THIRD_PARTY_NOTICES and SPEC said "140 palettes, 57 Dynamic
  themes plus dark-only and light-only scenes" and cited a `requestTheme()` call
  that appears nowhere; they now state 150 skin palettes, 109 two-mode scenes and
  the real twelve categories. `dashboard/manifest.json` and `SPEC.md` are
  unified on the shipped version, the install docs gained the opt-in enable step,
  and the read/write key rule was corrected to match the code rather than left
  aspirational.
- Removed the committed `.hermes-tmp.Qw7TB7` and gitignored the pattern.

### Verified

- Backend 34 → **58 tests**; JS 125 → **130 tests**; both green.
- Regeneration is idempotent and reproduces the build byte for byte.
- Driven over a real ASGI client: 400 names the bad value, 413 for both limits,
  reserved names refused, a valid import lands on disk and deletes into `_trash`
  without orphaning or wiping the index.

## [2.5.1] - 2026-10-18

### Fixed

- **The theme now sticks.** Three separate defects each produced the same
  symptom. The shared `desktopThemeApi` slot was nulled by *any* consumer's
  unmount, so leaving the picker disabled the provider handoff for the still
  mounted command-bar chip and the next Desktop render reverted the surface; it
  is now reference-counted and cleared only when the last consumer leaves. The
  stale pre-2.4.0 cache entry is now detected by **shape** (its two palette
  halves are identical, or it carries no `darkColors`) instead of by a label
  comparison that could never match, so the boot cache is repaired. And a single
  malformed skin can no longer white-screen the picker: the grid is wrapped in a
  boundary that draws an honest fallback and reports what it could not draw.
- Seven new tests, all of which fail on the previous build: two for the slot's
  unmount orderings, three for the card boundary, two for the stale cache shapes.
  Suite 125/125.
- No palette moved. The parity fixture, `docs/DERIVED-PALETTES.md` and all 218
  gateway transports are byte-identical.

## [2.5.0] - 2026-10-17

### Changed

- **Twelve category shelves, measured.** The picker grouped scenes into 7
  categories. It now has 12: Minimal, Pastels, Vibrant, Muted, Earth, Retro &
  Terminal, Nature, Warm, Orange, Gold, Cool, Violet. Five of the twelve are not
  hue bins at all - minimal, pastels, vibrant and earth/muted cut on chroma, and
  Retro & Terminal is a named family whose members span six different hues and
  could not sit together otherwise. Counts over the 109 scenes: 4 / 5 / 13 / 12 /
  11 / 7 / 8 / 5 / 10 / 10 / 19 / 5.

### Notes

- The name signal is used in one place only: the Retro & Terminal shelf
  (`retro-terminal`, `retro-amber`, `retro-blue`, `amber-terminal`,
  `green-screen`, `commodore-64`, `dark-lcars`). Everywhere else the measurement
  wins, so `vibrant-neon` files under Nature (its accent is green at C 0.114) and
  `rice-paper` files under Vibrant (its accent is vermilion at C 0.19). Both are
  honest measurements and both read oddly against the name - a tuning pass on
  name-based shelves is the next taxonomy step, not a hidden fix.
- No palette moved. `tests/fixtures/`, `docs/DERIVED-PALETTES.md` and all 218
  gateway transports are byte-identical after regeneration.

## [2.4.1] - 2026-10-17

### Fixed

- **The lightbulb now switches every scene.** The chip's mode toggle called the
  Desktop provider's `setMode` and nothing else, so the surface only changed if
  the provider happened to resolve the active scene; when it did not, the click
  repainted a different palette and the button read as dead or stuck. The toggle
  now re-applies the scene in the new mode, which paints our own root tokens and
  keeps the provider in step (`applyScene` already calls `setTheme` + `setMode`).
  Measured: on the previous build the failure set was exactly the 47 scenes that
  shipped in one mode before 2.4.0; now all 109 repaint. Pinned by
  `tests/theme-chip-mode.test.mjs` (3 tests, including a sweep over every
  dynamic scene).

## [2.4.0] - 2026-10-17

### Added

- **Every scene is now a light/dark pair.** The 47 skins that shipped in one
  mode only (39 dark, 8 light) had their missing half **ported**: the hues are
  kept, the lightness moves in Oklab, and each role is nudged until it clears a
  contrast target against its own shell (text 9:1, interface 3:1, signals 4.5:1).
  Worst measured result across all 47: 14.3:1 text, 5.3:1 accent. A real
  counterpart file always wins over a port, so adding one retires the derivation.
- **The swatch preview is a 2 x 6 matrix** — six roles per variant, the light
  variant above the dark one, so one card shows both halves of the pair it will
  apply. The six roles are the shell, the raised surface, the signature, the
  reading colour, the secondary text and the structure, in reading order.
- `docs/DERIVED-PALETTES.md` records every ported palette with its shell, text,
  accent and measured contrast. Generated by `scripts/regenerate.py`; a port is
  never invisible.

### Changed

- **The theme lens drops to seven categories.** Light and Dark were shelves for
  the mode-locked skins; with every scene shipping both modes those shelves can
  only render empty, and a category that always renders nothing is a lie in the
  UI. The classifier still returns `light`/`dark` for a single-mode scene, as a
  fallback for an import that arrives locked.
- Distribution across the seven: Cool 25, Warm 28, Nature 10, Pastels 5, Vibrant
  13, Muted 24, Minimal 4 (109 scenes).

### Notes

- Design decisions in the matrix, and why: the orientation is FIXED (light above
  dark) so the eye learns the layout once and reads every card the same way;
  neither row is dimmed for the current mode, because a preview exists to show
  the colours as they are and the label already says which mode is live; one
  hairline separates the rows, so the pair reads as a pair rather than as twelve
  loose swatches. The status signals are deliberately not among the six - every
  theme ships a green, an amber and a red, so they say nothing about the palette.
- A row is always exactly six swatches. A role the skin does not define is
  **mixed** from the shell (background toward text, at the weight the desktop
  ramp uses), not repeated from the accent. The first build repeated the accent,
  and the render showed the dark row of `nous` as four identical cream swatches -
  a preview of a theme nobody will ever see. Mixing is what the theme engine
  itself does to fill the roles a skin omits, so the swatch shows the anatomy the
  theme will actually have.
- Audit: the scene-parity fixture changed for exactly the 47 derived scenes and
  no others, proving the 62 authored palettes did not move.

## [2.3.0] - 2026-10-17

### Added

- **Five pastel skins, the first of their kind here.** Each is a real light/dark
  pair, so it behaves like every other dynamic scene: *Cotton Candy* (blush and
  lilac), *Mint Sorbet*, *Buttercup*, *Powder Blue*, *Peach Blossom*. The
  catalog goes from 104 to 109 scenes and 140 to 150 bundled skins.
- `scripts/make-pastel-skins.py` authors all ten files from one spec per scene,
  so the pair keeps the same hues in both modes. Run it to change them; do not
  hand-edit the YAML.
- Two categories join the theme lens: **Pastels** and **Muted**. Nine in total.

### Changed

- **The classifier measures colour in OKLCH (Oklab), not HSL and not RGB
  spreads.** Both earlier measures failed in different ways: HSL reports a
  barely-tinted near-white as fully saturated, and RGB max-minus-min is not
  perceptual (a deep navy and a pale grey-blue can score the same). Oklab
  separates lightness from colourfulness the way the eye does, which is the
  axis "pastel" is actually defined on.
- **Pastel is now high lightness with real but low chroma** (L ≥ 0.72, C 0.03 to
  0.14), judged on the accent. The shell test that seemed obvious - a pale,
  faintly tinted background - was measured and thrown out: nearly every light
  theme in the catalog has that shell, and it filed 18 scenes as pastels,
  including `dark-sage`.
- **The green band moved from 75-170 to 118-178 in OKLCH hue.** Oklab puts
  yellow near 90 and cream near 80, so the old band filed `dark-vanilla` and
  `dark-lemon` under Nature.
- **`KEEP_KEYS` now retains `input_rule` and `response_border`.** Without them a
  pastel skin's pale accent becomes the rule under the input at 1.4:1 on its own
  background - invisible. The skins now design a readable rule.
- Distribution after the change: Cool 16, Warm 13, Nature 6, Pastels 5, Vibrant
  7, Muted 11, Minimal 4, Light 8, Dark 39.

### Notes

- Measured contrast for the pastel light palettes: body text 9.6-10.6:1, the
  interface rule 3.2-4.2:1, the pastel accent itself 1.4-2.1:1. The accent is a
  signature, not a carrier - that split is deliberate and documented in the
  generator.
- The pastel accents are pale by definition, so they are used for fills and
  highlights where contrast does not gate legibility.

## [2.2.0] - 2026-10-17

### Added

- **A second lens for the gallery: "By theme".** A dropdown at the head of the
  settings row switches between the scene grouping that shipped first ("By
  scene": Dynamic Scenes / Dark Mode Only / Light Mode Only) and seven broad
  style categories. The choice persists per profile (`chroma-group-mode-v1`)
  and falls back to scenes on anything unrecognised.
- The categories are **derived from each palette**, not hand-listed. The
  catalog's own `category` field is provenance (`Built-in` / `Dynamic` /
  `Other`), not style, so 104 scenes cannot be labelled by hand and stay
  consistent. The rule: a mode-locked scene files by its mode; a dynamic scene
  is read from its light palette's accent - near-neutral to Minimal, loudly
  saturated to Vibrant, otherwise hue decides (Nature for muted greens, Warm
  for reds through yellows, Cool for the blues, indigos and purples that
  dominate developer themes).
- On the shipped catalog that yields: **Cool 22, Warm 17, Nature 5, Vibrant 8,
  Minimal 5, Light 8, Dark 39** - every category holds at least one scene, and
  a test enforces that a shipped category is never empty.

### Changed

- **The circle's name moved above it.** A rounded-full box does not clip its
  children, so a label set inside the circle would paint outside the arc; it
  sits above the circle now, which is where every other shape puts its name.
- **Base card size 104px to 132px.** 104 read as small on a wide pane. The S/M/L
  toggle still scales from the new base.
- **The settings row is one line.** Lens, mode, shape, size and scope share a
  single wrapping row instead of four stacked controls, so the gallery gets the
  vertical space back. Mode keeps its glyphs only (☾ / ☀) with the wording in a
  tooltip.

### Notes

- **"Pastels" was requested and does not ship.** Measured on the shipped
  catalog: no scene qualifies. The first attempt used HSL saturation, which
  reports ~1.0 for a barely-tinted near-white, so every scene matched a soft
  rule at once; measured on absolute chroma instead, the only pale-accent
  candidates are three purple dark themes. Rather than invent a bucket that
  mislabels them, the category is omitted - an empty section would promise a
  category and render nothing. The rule can be added back in one line for
  imported pastel palettes if wanted.

## [2.1.1] - 2026-10-17

### Fixed

- **Blank swatches, for real this time.** The palette container had lost
  `display: flex` — it carried `flex-col` alone, which sets only the flex
  direction. Without `display: flex` the container is a plain block and its
  `<span>` bands stay inline, where `width`, `min-height` and `flex` do not
  apply: zero size, so the theme colours never painted. The class is
  `flex flex-col` again. The 2.1.0 attempt (`min-h-4` on each band) treated a
  symptom — the bands were never the problem.
- Adds a **class-contract guard** to `tests/theme-card.test.mjs`: it walks the
  rendered tree, finds the palette container, and requires the whole class
  token `flex` plus a `backgroundColor` on every band. The digest cannot see
  layout, but it can hold the classes that layout depends on. The guard was
  fault-injected (class removed, test fails; restored, test passes) — and it
  caught its own first version, which used a substring check: `'flex-col'
  includes 'flex'`, so it passed a broken build. It matches whole tokens now.

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
