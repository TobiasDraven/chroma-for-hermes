# ARIA scout — the Chroma pane (C9)

Read-only audit of `desktop/plugin.template.js` (source of truth), the Hermes Desktop host
sources, and the JS test suites. No edits, no test runs, no web.

**Evidence conventions.** `T:NNN` = `desktop/plugin.template.js:NNN`. `H:NNN` = a host source
path written in full. "Name" means the accessible-name computation from the rendered element,
not what the JSX prop looks like. Where I could not verify something against a running Desktop
or a real screen reader, it says `UNVERIFIED`.

**Method note.** This is a static audit. Announcements below are derived from the rendered
element and its text/ARIA, not observed on NVDA/JAWS/VoiceOver. The host's exact AT exposure of
`title` is browser/AT dependent and is called out where it matters.

---

## 1. The interactive inventory

The pane is a single `ThemePicker` tree (T:4544-5820) rendered at `PAGE_PATH` (T:5919), plus a
second `ThemeChip` surface in the statusbar (T:5826-5876). Every control below is a native
`button`, `input`, `select`, `textarea`, or SDK primitive. There is no `tabIndex`, no
`autoFocus`, no `.focus()` call, and no `aria-live` anywhere in the template (verified by
search: zero hits for `aria-live`, `aria-describedby`, `aria-labelledby`, `aria-controls`,
`aria-current`, `tabIndex`, `autoFocus`).

### 1a. Page chrome / header (T:5517-5685)

| Where | Element | Attributes today (exact) | Missing |
|---|---|---|---|
| T:5547 | `button` "Export all" | `type='button'`, `disabled: exporting \|\| Object.keys(owned).length === 0`, `title: 'Save every skin Chroma owns as one hand-editable bundle'`, text child "Export all"/"Exporting…" | No action-specific issue. Name is good. |
| T:5560 | `SearchField` | SDK supplies `aria-label={ariaLabel ?? placeholder}` (host `search-field.tsx:72-73`); caller passes only `placeholder: 'Search skins…'` | Works, but the field is named by its placeholder; an explicit `aria-label` would be stabler than a translatable placeholder. |
| T:5571-5589 | `Select` (group lens) | `SelectTrigger` at T:5575 has `className`, inline `style`, and `title: 'Group the gallery by skin, or by colour family'` only | `aria-label='Group gallery by'` (the Radix trigger's name is the current value, e.g. "By skin", not what it controls). |
| T:5591 | `button` "Theme packs" | `type='button'`, `title: 'Choose which theme packs the gallery shows'`, text "Theme packs"/"Theme packs · N" | Fine; could add `aria-haspopup='dialog'`. |
| T:5598 | `button` "Categories" | `type='button'`, `title: 'Your own category shelves'`, text "Categories" | Fine; could add `aria-haspopup='dialog'`. |
| T:5605-5615 | `SegmentedControl` dark/light | Wrapper `div` has only `title: 'Preview in dark or light mode'`; options are `{id:'dark', label:'☾'}` and `{id:'light', label:'☀'}` (T:5608-5610). SDK renders buttons with `aria-pressed` and the glyph as children (`segmented-control.tsx:43-58`) | The wrapper is not `role='group'`/labelled, and each button's name is the glyph ("☾"/"☀"), not "Dark"/"Light". |
| T:5616-5627 | `SegmentedControl` card shape | Wrapper `title: 'Card shape: squares, rectangles or circles'`; labels `□`, `▭`, `○` (T:5620-5622) | Same: no group role/label; names are box-drawing glyphs. |
| T:5628-5639 | `SegmentedControl` card size | Wrapper `title: 'Card size: small, medium or large'`; labels `S`, `M`, `L` (T:5632-5634) | Same: "S"/"M"/"L" alone are ambiguous outside the visual row. |
| T:5640-5650 | `SegmentedControl` apply scope | No wrapper label at all; options "This profile" / "Everywhere" | Needs `role='group'` + `aria-label='Apply scope'`; option names are currently good words. |
| T:5656-5660 | `SegmentedControl` import mode | No label; options "URL"/"CSS" | Group label ("Import from") missing; names are words. |
| T:5662 | SDK `Input` (TweakCN ref) | `placeholder`, `value`, `onChange` only | `aria-label='TweakCN preset name or URL'`. |
| T:5663 | `textarea` (paste theme) | `placeholder: 'Paste shadcn CSS, …'`, `rows: 3`, `value`, `onChange` only | `aria-label` matching the placeholder. |
| T:5664 | SDK `Button` "Import" | `variant='secondary'`, `disabled`, `onClick`, text "Import"/"Importing…" | Good name. |
| T:5536-5545 | active-theme pill | `span` with a coloured `span` dot (T:5539-5542) and text label (T:5543) | The dot is decorative and has no `aria-hidden`; harmless to name, but should be `aria-hidden='true'`. |
| T:5530 | build stamp | `span title: 'Loaded build'` | Not interactive. |

### 1b. The gallery card (T:4233-4335)

The card is a `button` (T:4248) with the preview pill, star, Edit and Fork as DOM **siblings**
so buttons are never nested. For an owned skin a second row adds the manage controls (T:4328-4333).

| Where | Element | Attributes today (exact) | Missing |
|---|---|---|---|
| T:4248-4258 | the card itself — **applies the theme** | `type='button'`, `onClick`, `disabled: applying === scene.name`, `title: cardTitle(scene, mode)`, className. **No `aria-*`.** | No verb in the name (its name is its text content: skin label + "CLI"/"cli off"/"desktop" + mode or "ACTIVE" + "edited"). No `aria-current`/state for the active card. `title` is not a name. |
| T:4245 / T:2933 | `ACTIVE` state badge | SDK `Badge` with text child `'ACTIVE'` (T:2933) | Present as text for square/rectangle cards. **Absent for circle cards** (see below). |
| T:4317 | circle-card label | `ThemeCardLabel({ …, showState: false, … })`; at T:2955 `showState ? [bits, bit] : bits` | Circle cards have no ACTIVE text and no mode text. Active state is only the frame colour at T:4304-4306. |
| T:2939 | mode glyph in label | `span` with glyph "Dark"/"Light" or `''` for dynamic (T:2927, 2939); no `aria-hidden` | For single-mode scenes the glyph is a word and is fine; the empty case renders nothing. Not a name gap, but the label is duplicated text. |
| T:2941 / T:2789-2799 | `CliBadge` | `span title` = "Desktop only…" / "Gateway skin…" / "Gateway skin, but scope is…", text "CLI" / "cli off" / "desktop", colour via `className`/inline style | Only `title` carries the meaning. Screen readers hear "CLI" (or "cli off"), not the explanation. Add `aria-label` with the full sentence or a visually hidden sentence. |
| T:2946-2952 | `edited` marker | `span title: 'Edited: this card paints your override, not the shipped palette'`, text "edited" | Text is present; fine (title adds detail only). |
| T:4263 / T:2973-2983 | **preview pill** | `button type='button'`, `onClick`, `title` = "Preview this theme for 10 seconds, then revert" / "Stop the preview and go back to your theme", className plus `opacity-0` until `group-hover`/`focus-visible`. **No `aria-label`.** Text child is `'Preview 10s'` or the live countdown (`PreviewCountdown`, T:2816-2823). | Name when idle is "Preview 10s" (no skin name). Name while previewing becomes the bare seconds text only, e.g. "9s", and it changes four times a second. Needs a stable `aria-label` including the skin, and the countdown should not be the name. |
| T:3027-3038 | star | `type='button'`, `title`, `aria-label: (favorited ? 'Remove ' : 'Add ') + (scene.label \|\| scene.name) + ' favourites'`, `aria-pressed: favorited ? 'true' : 'false'`, glyph text `★`/`☆` | Good state and name, though the phrase reads "Add Ocean Skin favourites"; preferred "Add Ocean Skin to favourites". |
| T:3042-3053 | Edit (gear) | `type='button'`, `title`, `aria-label: 'Edit ' + (scene.label \|\| scene.name)`, text "Edit" | Good. |
| T:3066-3074 | Fork (duplicate) | `type='button'`, `title`, `aria-label: 'Duplicate ' + (scene.label \|\| scene.name)`, text "Fork" | Good. |
| T:3185 / T:3172-3185 | manage row container | `div` with no role; swaps among manage buttons / rename / delete confirm | No group label; keyboard focus is lost when the swapped-in content replaces the focused button (see §4/§5). |
| T:3085-3095 | rename input | `type='text'`, `value`, `onChange`, `onKeyDown` (Enter saves, Escape cancels), className. **No label/id/aria-label.** | `aria-label='New name for <skin>'`; focus should move here on open. |
| T:3096-3103 | Save (rename) | `type='button'`, `disabled: managing`, text "Save"/"Saving…" | Name is just "Save"; add the skin name. No live status for "Saving…". |
| T:3107-3127 | delete confirm | `span` question, `button` "Yes" (`disabled: managing`, inline error colour) and `button` "No" | The question is plain text in a row, not `role='alertdialog'`; "Yes" is ambiguous. Use `aria-label='Delete <skin>'`. Focus is lost when the Delete button is replaced. |
| T:3134-3146 | category `<select>` | `value`, `onChange`, `title`, `aria-label: 'Category for ' + (scene.label \|\| scene.name)`, options | Good. |
| T:3147-3168 | Export / Rename / Delete | `type='button'`, `onClick`, `title` (Export only), text "Export"/"Rename"/"Delete" | Names are the verbs only; each card repeats them. Add `aria-label='Export <skin>'`, etc. |
| T:4331 | pack badge (owned) | `span`, text pack id (`core`/pack id) | Text only, no colour-only problem. Not interactive. |

### 1c. Favourites rail (T:4183-4231)

| Where | Element | Attributes today (exact) | Missing |
|---|---|---|---|
| T:4217-4229 | `aside` rail | `className`, `data-favorites: String(rows.length)` | No `aria-label` / `aria-labelledby`; heading at T:4221 is a `div`, not a heading element. |
| T:4193-4205 | apply row button | `type='button'`, `onClick`, `title: 'Apply ' + (scene.label \|\| name)`, text = skin label; a coloured dot span at T:4199-4202 | Name is the skin label only (no "Apply"); dot should be `aria-hidden='true'`. |
| T:4206-4213 | remove favourite × | `type='button'`, `onClick`, `title: 'Remove from favourites'`, `aria-label: 'Remove ' + (scene.label \|\| name) + ' from favourites'`, text `×` | Good. |

### 1d. Editor dialog (T:3959-4177; overlay class T:3512)

| Where | Element | Attributes today (exact) | Missing |
|---|---|---|---|
| T:3959-3973 | editor dialog root | `role: 'dialog'`, `aria-modal: 'true'`, `aria-label: 'Edit ' + name`, `onClick` (backdrop), `onKeyDown` (Escape), inline scrim/scroll | No focus move on open, no trap, no return on close. The source itself says "There is no focus trap in E1" (T:3969-3971). `aria-modal` claims background inertness that is not enforced. Title/subtitle are not wired via `aria-labelledby`/`aria-describedby`. |
| T:3996-4004 | close ✕ | `type='button'`, `onClick`, `title: 'Close the editor (Escape)'`, `aria-label: 'Close the editor'`, text "✕" | Good name. |
| T:4017-4021 | draft palette preview | `ThemeCardPalette` with 12 empty colour spans (T:2885-2912) | No accessible representation of the palette (C9's core issue). |
| T:4043-4047 | column headers | text `'Role'`, `'☀ light'`, `'☾ dark'` | The glyphs are not `aria-hidden`; names are words, so acceptable. |
| T:3677-3682 / T:3433-3487 | `ColorField` per role per mode | Swatch `<label>` at T:3447-3469 wraps a native `input type='color'` with `aria-label: label` (T:3459), visually hidden by `opacity-0` (T:3458); hex `input type='text'` with `id`, `aria-label: label + ' hex'` (T:3476), `aria-invalid: invalid ? 'true' : 'false'` (T:3477), `title` (T:3478) | Native colour input has no visible focus indicator (label/swatch has no `focus-within` styling). Hex error is only the `aria-invalid` boolean + border colour + `title`; no `aria-describedby` to an error message. |
| T:3672-3676 | row mode glyph | `span` with `aria-hidden: 'true'`, text "☀"/"☾" | Good (decorative, name comes from the field labels). |
| T:3683-3687 | `ContrastChip` | `span` with `title` only (T:3498-3507); text is the ratio, e.g. "2.00:1"; below-target adds inline warn colour/fill | The "below target" state is colour + `title`; the number alone does not say which side of the advisory target it is. |
| T:3603-3622 | font `Select` | Radix `Select`; `SelectTrigger` has `aria-label: label + ' font'` (T:3611); a sample span is `aria-hidden='true'` (T:3626) | Good. |
| T:4101-4115 | fork name input | `type='text'`, `placeholder`, `aria-label: 'Name for the new skin'`, `aria-invalid: forkError ? 'true' : 'false'`, `title: forkError \|\| …`, `onKeyDown` (Enter/Escape) | No `aria-describedby` for the error; `title` is not an error announcement. |
| T:4116-4125 | Save copy | `type='button'`, `disabled: !!busy`, text "Save copy"/"Saving…" | Name is clear enough; busy state not announced. |
| T:4126-4133 | Cancel (fork) | `type='button'`, `disabled: !!busy`, text "Cancel" | Fine. |
| T:4137-4145 | Reset | `type='button'`, `disabled: !!busy`, `title: 'Delete your override and put the shipped palette back'`, text "Reset"/"Resetting…" | Fine; no confirmation, but not an ARIA defect. |
| T:4147-4156 | Save | `type='button'`, `disabled: saveDisabled(dirty, busy)` (T:3357-3359), `title` = owned/override sentence, text "Save"/"Saving…" | Fine name; no live announcement of successful save beyond host toast. |
| T:4161-4169 | Save as new | `type='button'`, `disabled: !!busy`, `title: 'Save these colours as a NEW skin you own…'`, text "Save as new" | Fine. |
| T:4158 | separator | `aria-hidden: 'true'`, text "|" | Good. |

### 1e. Packs and categories modals (T:3733-3879)

| Where | Element | Attributes today (exact) | Missing |
|---|---|---|---|
| T:3733-3764 | `ModalShell` root | `role: 'dialog'`, `aria-modal: 'true'`, `aria-label: title`, `onClick` backdrop, `onKeyDown` Escape | Same focus-management defect as the editor: no focus move/trap/return, `aria-modal` unenforced. Subtitle not `aria-describedby`. |
| T:3750-3758 | close ✕ | `type='button'`, `title: 'Close (Escape)'`, `aria-label: 'Close ' + title`, text "✕" | Good. |
| T:3789-3804 | pack on/off rows | `type='button'`, `onClick`, `aria-pressed: on ? 'true' : 'false'`, `title`, text mark `✓`/`·` + pack title + count | Good; no group/list semantics around the rows. |
| T:3815-3822 | "Manage packs…" / "Hide pack management" | `type='button'`, `onClick`, `aria-expanded: managing ? 'true' : 'false'`, text | Expanded state present. No `aria-controls` pointing at the managed panel. |
| T:3850-3858 | category id input | `type='text'`, `placeholder: 'category id'`, `title: 'A slug for the category (lowercase, dashes)'` | No `aria-label`/`<label>`; placeholder and `title` are not a name. |
| T:3859-3867 | category title input | `type='text'`, `placeholder: 'Display title'`, `title: 'The title shown on the shelf'` | Same. |
| T:3868-3875 | Create category | `type='button'`, `disabled`, text "Create category"/"Working…" | Good name. |
| T:4407-4415 | Delete (per category) | `type='button'`, `disabled: busy`, `title`, text "Delete"/"…" | Name is only "Delete", repeated per row; add the category title. |

### 1f. Pack manager and pack import (T:5417-5515)

| Where | Element | Attributes today (exact) | Missing |
|---|---|---|---|
| T:5424-5431 | pack name input | `type='text'`, `placeholder: 'pack name'`, `title: 'Name for the pack you save from the current filter (a slug)'` | No label/`aria-label`. |
| T:5432-5439 | Save filter as pack | `type='button'`, `disabled: packBusy`, `title`, text | Good name. |
| T:5440-5445 | Import pack toggle | `type='button'`, `onClick`, text "Import pack"/"Close import" | No `aria-expanded` even though it discloses the import block; no `aria-controls`. |
| T:5451-5457 | pack bundle textarea | `rows: 4`, `placeholder`, `value`, `onChange` | No label/`aria-label`. |
| T:5459-5466 | Preview import | `type='button'`, `disabled`, `title`, text | Good name. |
| T:5468-5475 | Confirm import | `type='button'`, `disabled`, text "Confirm import"/"Importing…" | Good name. |
| T:5478-5483 | Cancel import | `type='button'`, text "Cancel" | Fine. |
| T:5495-5502 | "and the skins it names" checkbox | Native `input type='checkbox'`, `checked`, `onChange`; wrapped by `<label>` containing the text | Name comes from the wrapping label; acceptable. |
| T:5503-5510 | confirm delete pack | `type='button'`, `disabled`, inline error colour, text from `packDeleteNotice(...).confirm` | Fine; the surrounding block is not `role='alertdialog'`, so its appearance is not announced. |
| T:5511 | Cancel delete pack | `type='button'`, text "Cancel" | Fine. |
| T:4442-4446 | collision rename input | `value`, `onChange`, className only | No `aria-label`; the row's skin name is a separate span, not associated. |
| T:4447-4452 | skip collision | `type='button'`, `onClick`, text "skip"/"skipped" | Name is only "skip", repeated; add the skin name. No `aria-pressed` for the skipped state. |

### 1g. Cards / lists / error boundary

| Where | Element | Attributes today (exact) | Missing |
|---|---|---|---|
| T:5713-5720 | group `section` | `section` with `div` title text (e.g. "Neon (12)") | No `aria-labelledby`/heading element; not a discoverable list of cards. |
| T:5721-5759 | card grid | `div` with inline `gridTemplateColumns` | No `role='list'`/`listitem` or group label. Host uses `role='list'` + `aria-label` for equivalent collections (`H:app/capabilities/connectors/tools-list.tsx:406-412`). |
| T:4233/4248 | each card | see 1b | see 1b |
| T:5701-5765 | `ScrollArea` gallery | SDK component; no label | A labelled scroll region would help SR navigation; host does this with `role='list'` + `tabIndex=0` (tools-list.tsx:406-412). |
| T:4531-4536 | SkinBoundary "Try again" | `type='button'`, `onClick`, text "Try again" | Fine. The failure message at T:4530 is plain text, not `role='alert'`. |

### 1h. Statusbar chip (T:5846-5875)

| Where | Element | Attributes today (exact) | Missing |
|---|---|---|---|
| T:5849-5864 | active-theme button | `type='button'`, `title: 'Active theme: … — open Chroma'`, text = theme label; coloured dot span at T:5858-5861 | Name is only the theme label; no `aria-label` saying what the button does. Dot should be `aria-hidden='true'`. |
| T:5865-5873 | mode toggle | `type='button'`, `title: 'Switch to dark/light mode'`, text "Dark"/"Light" | Name is the target mode only; acceptable, but "Switch to dark mode" would be clearer. |

**Inventory count.** About 39 distinct button shapes (the card verbs repeat once per visible
skin), 8 text-input shapes (the hex field repeats per role per mode), 2 textareas, 2 selects
(one native `<select>`, one Radix `Select`), 1 checkbox, 5 segmented groups, 2 dialogs, 2
rails/groups. Across the rendered gallery the card buttons repeat once per visible skin (30
core + enabled packs), so the tab-stop count is multiplied by the catalogue size (see §5).

---

## 2. What the host does (the conventions to match)

### 2a. Dialogs

- The host's dialogs are Radix: `import { Dialog as DialogPrimitive } from 'radix-ui'`
  (`H:apps/desktop/src/components/ui/dialog.tsx:2`), with the modal content rendered by
  `DialogPrimitive.Content` (`dialog.tsx:219`). The host does **not** hand-roll focus
  management; it delegates the modal behaviour to that primitive and only chooses autofocus
  policy (`dialog.tsx:60-66`, `dialog.tsx:166-180`, comment at `dialog.tsx:153`).
- Escape and the close button share one path: `DialogCloseButton` is a `DialogPrimitive.Close`
  and the comment states it "routes through the modal's `onOpenChange`, same path as Escape"
  (`dialog.tsx:73-75`).
- The close button is icon-only and carries **both** an `aria-label` and an `sr-only` text
  (`dialog.tsx:75-88`).
- Titles and descriptions are Radix `DialogTitle` / `DialogDescription`
  (`dialog.tsx:286-311`), i.e. the modal is labelled/described by real primitives, not a bare
  `aria-label`.
- `ConfirmDialog` relies on focus being inside the dialog: it explicitly prevents the default
  autofocus and focuses Confirm, because otherwise "it stays on whatever opened the dialog … and
  Enter re-triggers that instead" (`H:apps/desktop/src/components/ui/confirm-dialog.tsx:141-148`).
- Error text in `ConfirmDialog` is rendered inline as a bordered row with the alert icon
  (`confirm-dialog.tsx:157-163`).

The plugin's `ModalShell` (`T:3733-3764`) and `EditorModal` (`T:3959-4173`) reproduce the
visual shell but not the behaviour: `role='dialog'` + `aria-modal='true'` on a plain `div`, a
backdrop click and a local `onKeyDown` only. The plugin's own comment admits the missing focus
trap (`T:3969-3971`).

### 2b. Icon buttons

The host's icon-only buttons carry an `aria-label` and, where the glyph is ambiguous, an
`sr-only` word (`dialog.tsx:75-88`). The host's own theme picker does the same for swatches:
`AccentSwatch` renders a button with `aria-label={name}` and `aria-pressed={active}`
(`H:apps/desktop/src/components/ui/accent-swatch.tsx:46-49`), and the custom-colour well's
`<input type='color'>` is `aria-label={name}` inside a `<label>` (`accent-swatch.tsx:33-44`).
Decorative dots are `aria-hidden` (`H:apps/desktop/src/components/assistant-ui/theme-picker/theme-tool.tsx:81`).

The plugin matches this for close/star/Edit/Fork/remove, but not for the glyph segmented
controls or the repeated row verbs (see §1 and §4).

### 2c. Toggles

- `SegmentedControl` uses native buttons with `aria-pressed={active}` (`H:apps/desktop/src/components/ui/segmented-control.tsx:43-58`).
  It has **no** group label or per-option label prop: the props are `options, value, onChange,
  className, disabled` (`segmented-control.tsx:6-18`), and the option shape is
  `{ id, label, icon? }` (`segmented-control.tsx:4-9`). So the only host-sanctioned way to name
  an option is to pass words as `label`.
- The host's own first-run pickers put `role='group'` on the row of swatches
  (`H:apps/desktop/src/components/assistant-ui/theme-picker/accent-picker-card.tsx:30`) and on
  layout presets (`layout-picker-card.tsx:49`).
- `Switch` is Radix's `SwitchPrimitive.Root` (`H:apps/desktop/src/components/ui/switch.tsx:25-31`)
  and `Checkbox` is Radix's `CheckboxPrimitive.Root` (`H:apps/desktop/src/components/ui/checkbox.tsx:8-14`),
  so checked state and keyboard handling come from the primitive. The plugin uses no `Switch`; its
  one checkbox is a native input inside a `<label>` (T:5495-5502), which is correct.

### 2d. Lists and collections

The host marks a large scrollable collection as `role='list'` with `aria-label` and
`tabIndex={0}` (`H:apps/desktop/src/app/capabilities/connectors/tools-list.tsx:406-412`).
Tab strips receive `role='tablist'` (`H:apps/desktop/src/components/ui/pane-tab.tsx:276`) and
glyph buttons on the strip carry `aria-label` + `aria-pressed`
(`pane-tab.tsx:301-311`). The plugin's favourites rail and gallery groups use plain `aside` /
`section` with `div` headings (T:4217-4223, T:5713-5719).

### 2e. Live announcements

Host notifications are a real live region: `aria-live` is `'assertive'` for errors and
`'polite'` otherwise, with `role='alert'`/`role='status'`
(`H:apps/desktop/src/components/notifications.tsx:279-280`). Because the plugin reports save,
reset, delete, import and category outcomes through `host.notify` (e.g. T:5036-5041,
5065-5070, 5109-5114, 5257, 5301-5306), those outcomes **should** be announced by the host —
subject to the notification stack being mounted and active (`UNVERIFIED` in a live Desktop; the
host source is the evidence).

### 2f. What the plugin SDK exports that is relevant

From `H:apps/desktop/src/sdk/index.ts`:

- `Badge` (1810), `Button` (1811), `Checkbox` (1812), `ConfirmDialog` (1819)
- `Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger`
  (1834-1842) — the Radix dialog is available to plugins.
- `EmptyState` (1855), `Input` (1859), `RowButton` (1869), `ScrollArea` (1874),
  `SearchField` (1875), `SegmentedControl` (1876), `Select…` (1877), `Switch` (1880).

There is **no** dedicated a11y/visually-hidden helper export in the SDK (search for
`VisuallyHidden`/`a11y` found none). The host itself uses the Tailwind `sr-only` utility
(e.g. `H:apps/desktop/src/components/ui/search-field.tsx:87`), and that rule exists in the
compiled host stylesheet (`apps/desktop/dist/assets/index-B89n1Ils.css`), so the plugin can use
`sr-only` the same way without a new dependency.

---

## 3. What the tests already assert

Pinned (must not regress):

| Test | Property pinned |
|---|---|
| `tests/editor-modal.test.mjs:105` | the Edit gear's exact `aria-label`: `'Edit Ocean Skin'` |
| `tests/editor-modal.test.mjs:125` | the gear is found by `/^Edit /` on `aria-label` and invokes the editor |
| `tests/editor-modal.test.mjs:162` | the hex field's `aria-invalid === 'false'` when valid |
| `tests/editor-modal.test.mjs:206-208` | the editor root has `role='dialog'`, `aria-modal='true'`, `aria-label='Edit Ocean Skin'` |
| `tests/favorites.test.mjs:92,100` | star's `aria-pressed` is `'false'` / `'true'` |
| `tests/favorites.test.mjs:103` | star's `aria-label` includes "Remove" when starred |
| `tests/favorites.test.mjs:119` | the star in the card row carries `aria-pressed='false'` |
| `tests/pack-filter-gate.test.mjs:98,128-131` | pack rows are buttons with string `aria-pressed`; on/off values |
| `tests/pack-filter-gate.test.mjs:133` | an on pack carries a text mark (`✓`), not only colour |
| `tests/theme-card.test.mjs:170-174` | the card `title` still names the mode/single-mode support |
| `tests/theme-card.test.mjs:339-343` | `CliBadge` titles still carry the CLI/desktop distinction |
| `tests/preview-pill.test.mjs:94,108` | the pill's text child is `'Preview 10s'` when idle |

Untested / unprotected:

- **No test asserts `aria-live`** — none exists in the template, so there is nothing to pin.
- **No tabIndex, focus, Escape, focus-trap, focus-return, or autoFocus assertion anywhere** in
  `tests/` (search for `tabIndex`/`focus` returns no a11y test).
- `ModalShell` (packs/categories) has no test of `role`, `aria-modal` or `aria-label`; only
  `EditorModal` is pinned.
- The preview pill's accessible name is untested; only its text content is.
- The close-button `aria-label`s are untested.
- The category `<select>`'s `aria-label`, the colour inputs' `aria-label`s, and the hex
  `aria-invalid='true'` path are untested (only the valid `'false'` is pinned).
- `FavoritesRail`'s remove `aria-label` is untested (the rail test invokes the cross but only
  asserts the `×` text, `tests/favorites.test.mjs:154-156`).
- Every repeated row verb (`Export`, `Rename`, `Delete`, `Save`, `skip`) has no name assertion.
- ContrastChip's `title` text is asserted (`tests/editor-modal.test.mjs:186-199`) but not any
  accessible announcement of the below-target state.
- No test verifies the segmented controls' group label or option names.
- No test verifies that the palette matrix has a text alternative.

---

## 4. The gap list, ranked

Ranking follows the brief: a screen-reader user cannot tell what a control does, then a
keyboard user cannot operate/reach it, then state is conveyed by colour alone, then polish.
Each fix is plugin-side unless stated.

### G1 — Dialogs do not take, contain, or return focus; Escape only works after tabbing in
**Elements:** editor root T:3959-3973 (comment T:3969-3971); `ModalShell` T:3733-3740, used by
packs T:3770 and categories T:3833. Trigger buttons: gear T:3042, "Theme packs" T:5591,
"Categories" T:5598.

**Today:** `role='dialog'` / `aria-modal='true'` are set, but the dialog is a plain `div`
rendered after the gallery in the same tree. Opening it does not call `.focus()`; closing it
does not return focus. The `onKeyDown` handler lives on the overlay, so a keypress while focus
is still on the triggering gear does not reach it — Escape does nothing until the user tabs or
clicks into the dialog. `aria-modal='true'` tells the AT the background is inert while it is
still tabbable.

**Fix shape:** either use the SDK's Radix `Dialog`/`DialogContent`/`DialogTitle`/`DialogDescription`
(`sdk/index.ts:1834-1842`) or, staying hand-rolled, add: on mount focus the first field (or the
close button); a Tab/Shift-Tab trap inside the sheet; a document-level Escape listener; and on
close restore focus to the element that opened it (`document.activeElement` captured in
`openEditor`/`setPacksOpen`/`setCategoriesOpen`). Wire `aria-labelledby` to the visible title id
and `aria-describedby` to the subtitle (T:3993-3994, T:3747-3748). If `role='dialog'` +
`aria-modal` cannot be given real containment, drop `aria-modal` rather than lie to the AT.
**Plugin-side:** yes. **Host limitation:** none; the host primitive is exported.

### G2 — The palette (the pane's actual content) has no text alternative
**Elements:** `ThemeCardPalette` T:2885-2912 (twelve empty `span` swatches, T:2909); used on
the card at T:4247 and on the editor preview at T:4021; the card's accessible name is the label
row (T:2954), which contains no colour text.

**Today:** the strip is colour only. A screen reader gets no value for any of the twelve
swatches; the card says the skin's name and badges, never its palette. This is the exact C9
finding in `docs/REVIEWS/ROAST-TRIAGE-2026-10-17.md:45`.

**Fix shape:** give the matrix `role='img'` and an `aria-label` built from the six bands per
mode, e.g. `'Palette: light background #… surface #… accent #… text #… dim #… border #…;
dark background #… …'` (the six values already exist as `lightStrip`/`darkStrip`). In the
editor, an `aria-label` per role row already exists on the fields, so the decorative strip can
be `aria-hidden='true'` there and the fields carry the data. Do not use a template literal
(AGENTS §3.5) — concatenate.
**Plugin-side:** yes.

### G3 — Controls whose names do not say what they do
**Elements:** mode/shape/size `SegmentedControl`s T:5605-5639 (glyph and single-letter labels);
preview pill T:2973-2983 (idle "Preview 10s", live "9s"); repeated row verbs T:3147-3168
("Export"/"Rename"/"Delete"), T:3096 ("Save"), T:4407 ("Delete"), T:4447 ("skip"),
T:4367/T:4376 ("Export"/"Delete").

**Today:**
- `SegmentedControl` names each button from its `label` (`segmented-control.tsx:43-58`); the
  plugin passes `☾`, `☀`, `□`, `▭`, `○`, `S`, `M`, `L`. Names are glyphs or letters, and the
  wrapper's `title` (`T:5606`, `T:5617`, `T:5629`) is not the group's name.
- The pill's name changes to the countdown text while previewing (T:2980-2982), so a screen
  reader hears "9s" for an apply-adjacent control.
- Every card offers "Export", "Rename", "Delete", "Save" with no skin name; a screen reader's
  control list is a wall of identical verbs.

**Fix shape:** pass words as `SegmentedControl` labels ("Dark"/"Light", "Square"/"Rectangle"/
"Circle", "Small"/"Medium"/"Large") and wrap each group in `<div role='group'
aria-label='…'>`. Give the pill `aria-label={'Preview ' + (scene.label || scene.name) + ' for 10
seconds'}` (and `'Stop preview of …'` when live), keeping the visible countdown text for sighted
users. Add `aria-label={'Export ' + name}`, `'Rename ' + name`, `'Delete ' + name`,
`'Save rename of ' + name`, `'Delete category ' + (cat.title || cat.id)`,
`'Skip ' + r.name` on the repeated verbs.
**Plugin-side:** yes for all except the group/per-option label prop, which the SDK's
`SegmentedControl` does not offer (props at `segmented-control.tsx:6-18`). Passing word labels
is the available route; a host-side optional `aria-label` prop would be a genuine SDK improvement.

### G4 — Rename/delete transitions drop keyboard focus on the floor
**Elements:** `ThemeCardActions` T:3172-3185; `ThemeCardRename` T:3083-3105;
`ThemeCardDeleteConfirm` T:3107-3128.

**Today:** the Rename button (T:3155) and Delete button (T:3162) are unmounted when their
successor row renders (`renaming`/`confirming` state, T:3180-3184). The browser then has no
focused element; focus falls to `<body>`. A keyboard user who pressed Rename cannot type the
new name without tabbing from the top of the page; pressing Delete leaves them with no focused
Yes/No.

**Fix shape:** on `startRename`, focus the input (a `ref` + `useEffect`, or `autoFocus` on
T:3085); on `startConfirm`, focus the "No" (safe default) or the question container with
`role='alertdialog'`; on cancel, return focus to the Rename/Delete button. Add
`aria-label={'New name for ' + (scene.label || scene.name)}` to the input.
**Plugin-side:** yes.

### G5 — The native colour input is keyboard-reachable but invisible when focused
**Elements:** `ColorField` T:3447-3469; the native `input type='color'` is `opacity-0` at
T:3458 and has `aria-label` at T:3459; the visible swatch `span` is T:3461-3467.

**Today:** the input stays focusable by design (comment T:3456-3457), but neither the label nor
the swatch has `focus-within`/`focus-visible` styling, so a keyboard user tabs into an
invisible control with no focus ring. The host's own custom-colour well does exactly this
correctly: `className={cn(className, 'focus-within:outline-2 focus-within:outline-ring')}`
(`accent-swatch.tsx:33`).

**Fix shape:** add `focus-within:outline focus-within:outline-2 focus-within:outline-(--ui-accent)`
(or an inline equivalent) to the `<label>` at T:3448, or an explicit focus ring on the swatch.
**Plugin-side:** yes.

### G6 — Active state is colour-only on circle-shaped cards
**Elements:** circle label T:4317 (`showState: false`); `ThemeCardLabel` T:2955 (`showState ?
[bits, bit] : bits`); active frame T:4304-4306 (`border-(--ui-accent)`).

**Today:** every non-circle card gets the text badge "ACTIVE" (T:2933). A circle card
deliberately suppresses the state (`showState: false`) and marks the active theme only by the
accent border. A screen-reader user gets no "active"; a colour-blind user gets a border tint.

**Fix shape:** keep the state for circles for AT — either call `ThemeCardLabel` with
`showState: true` and hide the visual badge with a sized wrapper, or add `aria-current='true'`
to the card button when `isActive` (T:4248) and a visually hidden "Active" text. `aria-current`
also fixes the non-circle case as a state on the button rather than only a text child.
**Plugin-side:** yes.

### G7 — Errors are marked invalid but never described
**Elements:** hex field T:3470-3485 (`aria-invalid` T:3477, `title` T:3478); fork name
T:4101-4115 (`aria-invalid` T:4107, `title` T:4108); the inline text "Use lowercase letters,
digits and dashes" is only produced into `forkError` state (T:3939) and shown as `title`.

**Today:** the control announces "invalid" but not why, and `title` is not reliably exposed as
a description. The visible red border (T:3484, T:4114) is colour.

**Fix shape:** render an `id`-ed error text next to each field and point
`aria-describedby` at it, e.g. `aria-describedby='chroma-fork-error'` with the sentence in a
`<span id='chroma-fork-error' role='alert'>`. The hex field's message already exists as the
`title` string (T:3478); duplicate it visibly/invisibly with an id. Add `aria-errormessage`
where the AT supports it.
**Plugin-side:** yes.

### G8 — Collection/landmark structure is absent
**Elements:** favourites `aside` T:4217-4229 (heading `div` T:4221); gallery `section`s
T:5713-5719 (heading `div` T:5717); card grid T:5721; `ScrollArea` T:5701.

**Today:** the rail is an unnamed complementary landmark; the group titles are not headings,
so heading navigation cannot jump between "Neon", "Pastel", etc.; the card grid is a plain
`div`. The host marks an equivalent collection `role='list'` + `aria-label` + `tabIndex=0`
(`tools-list.tsx:406-412`).

**Fix shape:** `aria-label='Favourites'` (or `aria-labelledby` to an `<h2>`); make each group
title an `<h3>` (or `role='heading' aria-level='3'`) and give the `section`
`aria-labelledby='<heading id>'`; give the grid `role='list'` and each card wrapper
`role='listitem'`. Label the scroll region: `aria-label='Theme skins'`, `tabIndex=0`.
**Plugin-side:** yes.

### G9 — Inline state changes are silent; only host toasts speak
**Elements:** "Unsaved changes." T:4092-4097; preview pill countdown T:2973-2983; fork error
T:4101-4115; pack import preview appearing T:5467-5487; pack delete confirm T:5490-5514;
contrast chips T:3491-3509; category create/delete busy text T:3868-3875 / T:4407-4415.

**Today:** the template contains no `aria-live` region at all. Save/reset/delete/import
outcomes do go through `host.notify`, whose toast region is `aria-live`
(`notifications.tsx:279-280`) — so the *write outcomes* are covered by the host. But the
in-dialog state (dirty indicator, fork validation, preview start/auto-revert) has no
announcement; the countdown changes four times a second, so making the whole pill live would
be worse.

**Fix shape:** add one visually hidden `<div aria-live='polite'>` and set its text on discrete
events only ("Previewing <skin>, reverts in 10 seconds", "Preview ended", "Unsaved changes",
"Collision: <name> already exists"). For the countdown, keep the visible text out of the live
region and expose a stable `aria-label` on the button. Put the fork error in `role='alert'`.
**Plugin-side:** yes (the host toast region is not a substitute for in-dialog state).

### G10 — The palette's advisory state is colour-first
**Elements:** `ContrastChip` T:3491-3509; the below-target branch is T:3494-3507 (inline
`color`/`backgroundColor`), text is the ratio only (T:3508).

**Today:** the chip says "2.00:1"; whether that is below the 9:1/3:1/4.5:1 target is conveyed
by the warn colour and the `title` (T:3496). The targets are also only in the legend (T:4078-4082).

**Fix shape:** append a visually hidden sentence, e.g. `<span class='sr-only'> — below the 9:1
advisory target</span>`, or make the chip's `aria-label` the full `title` string (which already
contains it). Include the target in the visible row if space allows.
**Plugin-side:** yes.

### G11 — Tab order is dominated by card micro-controls
**Elements:** card button T:4248, pill T:2974/4263, star T:3027/4274, Edit T:3042/4271, Fork
T:3066/4272; for owned cards also category select T:3134, Export T:3147, Rename T:3155, Delete
T:3162 via T:4332.

**Today:** 5 tab stops per card × 30 core skins (more with packs enabled), plus 4 more per
owned card, before the next group or the footer. The pill is `opacity-0` until focused
(T:2971) but is still in the tab order. This is technically reachable, not unusable.

**Fix shape:** treat the card as one stop and the actions as a roving set: give the card
`tabIndex=0`, the siblings `tabIndex=-1`, and reveal/focus them from the card (or use a single
"Actions" menu). At minimum, make the preview pill `tabIndex=-1` unless the card is focused
and provide a keyboard path (e.g. `P`/Enter on the card or a visible "Preview" control in the
manage row). Pick one pattern and test it.
**Plugin-side:** yes.

### G12 — Smaller naming/decoration items
- Start/favourite `aria-label` grammar: `'Add Ocean Skin favourites'` (T:3033) should be
  "Add Ocean Skin to favourites".
- Decorative dots lack `aria-hidden`: header active dot T:5539-5542, rail dot T:4199-4202,
  chip dot T:5858-5861. They have no text, but marking them `aria-hidden='true'` matches the
  host (`theme-tool.tsx:81`).
- Statusbar chip's active-theme button (T:5849) is named only by the theme label; give it
  `aria-label={'Active theme: ' + activeLabel + ' — open Chroma'}`.
- The category `<select>` (T:3134) is good; the Radix font select (T:3611) is good; the group
  lens select (T:5575) is the one without a name.
- The `ModalShell`/`EditorModal` visible titles and subtitles could be `aria-labelledby`/
  `aria-describedby` targets rather than duplicating the text in `aria-label`
  (T:3736-3738, 3947-3948, 3966-3968, 3993-3994).
- Busy labels ("Saving…", "Deleting…", "Working…") are text substitutions; without a live
  region they are silent to an SR user unless they re-read the button (T:3096-3103,
  3868-3875, 4147-4156).

**Host limitations named explicitly (§4 requirement):**
1. `SegmentedControl` exposes no group-label or per-option accessible-name prop
   (`segmented-control.tsx:6-18`). The plugin can pass word labels, but cannot add an
   `aria-label` to an individual option through this API without changing the host component.
2. The SDK exports no `VisuallyHidden` helper (`sdk/index.ts`, no a11y helper). The `sr-only`
   utility is available in the compiled host CSS, so this is a convenience gap, not a blocker.
3. Whether `host.notify` is actually mounted/announced in the plugin page context is a runtime
   fact I could not verify statically (`UNVERIFIED`); the host source shows the live region at
   `notifications.tsx:279-280`.

Nothing in the list is blocked outright by the host: every fix is either a plugin attribute,
a focus-management routine, or an import of an already-exported SDK primitive.

---

## 5. Also examined

### Keyboard reach
- **Tab order.** Native `button`, `input`, `select`, `textarea` and Radix `Select` are all
  reachable. The DOM order is header controls (T:5517-5685) → gallery → modals at the end
  (T:5770-5817). Within a card: card (T:4248) → pill (T:4263) → star/Edit/Fork row
  (T:4274-4295) → the owned manage row (T:4332). The pill is `opacity-0` until
  `focus-visible` (T:2971), so it is invisible until focused but still tabbable. The tab stop
  count is therefore large (G11).
- **Editor dialog focus trap:** none. The code says so (T:3969-3971). Tab from the last
  control in the sheet continues into the pane behind the scrim; Shift-Tab from the first goes
  backward into the gallery.
- **Escape closes it:** only once focus is inside the overlay, because `onKeyDown` is on the
  overlay div (T:3973) and opening does not move focus. Immediately after clicking the gear,
  Escape reaches the gear, not the dialog. `ModalShell` has the same shape (T:3740).
- **Escape returns focus:** no. There is no focus restore; the dialog unmounts and the
  previously focused button stays where it was only if it was never blurred. If the user
  tabbed into the dialog, focus is lost to `body` on close.
- **Preview pill and card actions reachable/operable:** yes — they are native buttons
  (T:2974, 3027, 3042, 3066, 3147-3168) and the pill's `focus-visible:opacity-100`
  (T:2971) reveals it. The problems are naming and volume, not reachability. The pill's
  click/keyboard activation works (T:2976; pinned by `tests/preview-pill.test.mjs:97-115`).
- **Rename/delete transitions:** activating them unmounts the focused button and does not
  focus the replacement (G4), so a keyboard user loses their place.

### Live regions
- **No `aria-live` region exists in the pane** (zero occurrences in the template).
- **Save/override/reset/delete/import/category-create outcomes** are reported with
  `host.notify` (e.g. T:5036-5041, 5065-5070, 5109-5114, 5257, 5301-5306, 5333). The host's
  toast is a live region (`notifications.tsx:279-280`), so those specific outcomes are
  announced in the host — `UNVERIFIED` that the stack is active on the plugin page.
- **Not announced:** "Unsaved changes." (T:4096), the preview countdown and its auto-revert
  (T:2973-2983, timer T:4969), fork validation (T:4101-4115), the pack-import preview
  appearing (T:5467), the pack-delete confirmation appearing (T:5490), and busy label swaps
  on buttons. The `SkinBoundary` failure text (T:4530-4537) is not `role='alert'`; the host
  notification in `componentDidCatch` (T:4514-4519) is the only alert path.

### Colour-only signals
1. **The palette matrix** (T:2885-2912, used T:4021 and T:4247): the twelve swatches are the
   content, and there is no non-colour channel. Fix: `role='img'` + a role/hex `aria-label`
   per mode (G2).
2. **The active state on circle cards** (T:4317 + T:4304-4306): no text, no state attribute;
   only the border tint distinguishes it. Fix: `aria-current='true'` on the card button, and
   a visually hidden "Active" (G6).
3. **The contrast chip below target** (T:3494-3507): the warn colour is the only
   *non-numeric* signal; the number and `title` exist, so this is weaker than 1-2. Fix:
   `sr-only` "below the N:1 advisory target" or `aria-label` from the existing `title` (G10).

Not colour-only (checked and cleared): the CLI badge changes its **word** between "CLI",
"cli off" and "desktop" (T:2798) even though it also changes colour; the pack rows carry
`✓`/`·` plus `aria-pressed` (T:3799, T:3793); the star carries `★`/`☆` plus `aria-pressed`
(T:3037, T:3034); the `edited` marker and "Unsaved changes." are words (T:2951, T:4096); the
missing-pack warning is text ("N missing", T:4363).

### Names
Every icon-only control:
- Editor close `✕` — `aria-label`: yes (T:4001).
- Modal close `✕` — `aria-label`: yes (T:3755).
- Star — `aria-label`: yes (T:3033).
- Remove favourite `×` — `aria-label`: yes (T:4210).
- Edit / Fork — visible words plus `aria-label`: yes (T:3046, T:3070).
- Font sample "Aa" — `aria-hidden`, not a control (T:3626).
- Row mode glyphs `☀`/`☾` — `aria-hidden` (T:3674); the column headers at T:4045-4046 are
  text and not hidden (words follow the glyph).
- **Segmented mode/shape/size** — no meaningful name; the name is the glyph/letter
  (T:5608-5634; host `segmented-control.tsx:43-58`).
- **Preview pill** — named by its text, which is the countdown while live (T:2980-2982);
  no stable name, no skin name.
- **Repeated row verbs** — "Export", "Rename", "Delete", "Save", "skip", "Delete" have names
  but no item context (T:3147-3168, T:3096, T:4407, T:4447, T:4367-4383).
- **Category/pack/text inputs** — no name at all: T:3085, T:3850, T:3859, T:5424, T:5451,
  T:5662, T:5663, T:4442. Placeholders and `title` are not names.
- Statusbar active-theme button — named by the theme label only (T:5849-5864); mode toggle —
  named "Dark"/"Light" (T:5865-5873), acceptable but context-free.

---

## Verdict

The pane is **far from** a reasonable accessibility bar, but the distance is concentrated:
it has almost no *behavioural* a11y (no focus management, no live regions, no focus-visible
on the colour well) and a systematic *naming* problem (glyph-only segmented controls, a palette
with no text alternative, repeated "Delete"/"Export"/"Skip" verbs, unlabelled text inputs).
The three highest-impact fixes are: **(1) make the two dialog shells real modals** — move
focus in on open, trap Tab, listen for Escape at the document level, restore focus to the
trigger, and wire `aria-labelledby`/`aria-describedby` (T:3959-3973, T:3733-3740); **(2) give
the palette a text alternative** — `role='img'` with a six-role, six-hex `aria-label` per mode
on `ThemeCardPalette` (T:2885-2912), which is the C9 item itself; and **(3) fix the names and
state attributes** — word labels plus `role='group'` on the segmented controls
(T:5605-5639), a stable skin-scoped `aria-label` on the preview pill (T:2973-2983),
`aria-current` on the active card (T:4248/T:4317), and item-scoped names on the repeated row
verbs (T:3147-3168, T:4407, T:4447). All three are achievable from the plugin side; the only
host-side gap is `SegmentedControl`'s lack of a group/per-option label prop
(`segmented-control.tsx:6-18`), and the workaround (word labels) is sufficient. Fixing G1-G7
would move the pane from "a mouse-only colour gallery" to something a screen-reader and
keyboard user can actually operate; G8-G12 are the second pass.
