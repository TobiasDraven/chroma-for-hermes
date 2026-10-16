# DECISIONS

Numbered, newest last. Each entry records what was decided, why, and what it
costs — so a future reader does not have to re-derive it from the diff.

## 1. Hard fork, renamed to Chroma for Hermes

The upstream plugin is a theme picker; this fork carries a skin catalog, a
backend, import/export and a gateway sync. Diverging that far inside a repo we do
not control would have made every upstream change a conflict. Plugin id stays
`chroma`; version resets to 2.0.0 as a hard fork. MIT attribution is discharged in
`THIRD_PARTY_NOTICES.md`.

The local directory keeps the old name (`hermes-theme-picker`) deliberately:
renaming it would break Serena's registered project path for no functional gain.

## 2. The repo root IS the plugin package

The Desktop installer resolves the manifest at the URL it is given, so
`plugin.yaml` has to sit at the root; the UI source was moved from `plugin/` to
`desktop/`. A nested package layout installs nothing.

## 3. No npm dependencies

The desktop loader resolves only `@hermes/plugin-sdk`, `react` and
`react/jsx-runtime`, and the plugin is loaded uncompiled. Any dependency would
have to be vendored and would still not resolve.

Cost: every format parser is hand-written — tolerant JSON with comments and
trailing commas, a ~15-line line-regex YAML reader, hex normalisation. Accepted
because each is small and testable, where a bundled library would be neither.

## 4. Export uses a renderer blob, not an SDK save call

The host SDK exposes no file-save or save-dialog API, and the only channel back to
the backend is JSON REST. So the backend returns the YAML as JSON and the renderer
builds a Blob and clicks an anchor; Electron's `will-download` handler routes it to
Downloads with a save dialog. This is the supported path rather than a workaround.

Unverified on the development host: only the user's own machine can prove the save
dialog appears.

## 5. The importer sniffs the format instead of asking for it

One paste box. The format is derived from the text's shape (plist → refused by
name; JSON → split by shape into Windows Terminal or VS Code; `:root {` → TweakCN
CSS; YAML keys → Base16). Asking the user to classify their own file transfers a
job the program can do, and four extra controls for a rare action.

Cost: the sniffer must be tested as a unit, and a genuinely ambiguous input needs
an error that names the accepted formats.

## 6. iTerm2 import refused by name, deferred

An XML plist needs a parser, carries a P3 colour matrix, and maps only ANSI slots
— the least Windows-relevant source of the four. Refused with its NAME rather
than a generic failure, so the user learns why and what is supported.

## 7. Hex values are normalised to `#rrggbb`, alpha dropped

The backend writer accepts only `#rrggbb` and `#rgb`. An 8-digit value would be
silently truncated at the boundary, so `normHex` flattens and drops alpha
visibly instead of losing colour where nobody looks.

## 8. Preview is triggered by a click, never by hover

`previewTheme` repaints the whole app. The first implementation armed it 140ms
after the pointer entered a card, so cost scaled with pointer travel: sweeping
across a hundred cards repainted Hermes a hundred times. A click-triggered pill
with a fixed window and a revert is the fix. The revert timer is owned by the
picker, so it survives the card leaving the tree.

## 9. The grid target width is a constant, not a column count

The first layout divided the viewport into a column count capped at four and
derived the card width from it, so cards GREW with the window (~330px each at
1400px wide). A fixed `CARD_MIN` (104px) plus the grid's own auto-fill makes a
wider window show more cards instead.

## 10. A circle card holds only its palette

`rounded-full` does not clip children, so a label row at the bottom of a circle's
bounding box paints outside the circle, over the page background. Circle mode
therefore moves the label into a caption UNDER the card, and centres the preview
pill rather than anchoring it to the bottom edge, for the same reason.

## 11. Plugin-owned storage keys only

`chroma-*`. The app owns `hermes-desktop-*` and would overwrite or misread
anything written there.

## 12. Adopted the standard `rigour.yml` unmodified

`rigour check` requires the file; without it the command exits 2 with no output,
which reads as a broken gate rather than a missing config. The generated file is
adopted as-is — its thresholds are the standard, and tuning them to pass would
defeat the gate. The editor-specific integration files that `rigour init` also
writes were removed: this project's agents are Hermes and Pi, and rigour is
already an MCP server for them.
