# Chroma — Hard Fork + Roadmap

**Status:** **v2.9.0 shipped** (`f338063`) — the picker, the twelve measured shelves, per-profile skins,
the **skin editor (E0–E6)**, **theme packs (94 skins, 7 packs)** and the **C9 accessibility pass** are
DONE. **Distribution:** prepared, not submitted — see §2. **Next:** the catalog submission; F8 and F9
remain unstarted. **Custom background/backdrop images** are deferred to v3 — see §5.
**Prepared:** 2026-10-16 · **last updated:** 2026-10-20 — see §0.

---

## 0. Where we actually are (2026-10-20)

- **Shipped: v2.9.0** (`f338063`; `VERSION` reads `2.9.0`). The catalogue is **94** files in
  `skins-v2/`, each carrying both palettes; **188** gateway transport files; **twelve** measured
  category shelves; and **seven** packs — core **30**, Earth 11, Cyberpunk 11, Zen 11, Retro 11, Noir
  10, Studio 10.
- **The skin editor is done — E0 through E6.** `d39c1af` (schema, overrides store, first surface),
  `e450eb0` (in-place edits on owned skins, drift alarm), `832e5d4` (duplicate, packs export/import),
  `a80c8c7` (E4 category shelves and assignment), `256d1a0` (E5 typography and boot survival),
  `1278139` (E6 polish, keyboard/touch reach). Both design questions the phases carried are closed:
  categories are measured and read-only, and fonts travel in the theme object.
- **Theme packs are done.** `ba0749f` built six packs and a gate; `05154e6` cut the catalogue to 94
  files; `829e3f5` made core the default shelf and gave every skin a home; `418f72b` reconciled the
  twelve measured families. Core is exactly 30; every other pack is 10–20 and every skin belongs to
  exactly one.
- **C9 is closed.** `43f8e1b` made the pane operable and announceable without a pointer; `f338063`
  fixed the roving-set regression it exposed. Focus behaviour is accepted as headless-and-walk
  verified, not unit-tested — the harness has no real `document` or layout, and `tests/aria.test.mjs`
  says so in its header.
- **CI defines four job instances.** `test` runs on `ubuntu-latest`, `macos-latest` and
  `windows-latest`; `build-is-current` rebuilds the plugin and refuses a stale committed build.
- **Gates run for this revision.** JS `266/266`; pytest `185 passed, 4 skipped, 9 subtests passed`;
  `scripts/check-package.py` holds at 2.9.0 with 94 skins and 533 tracked files;
  `scripts/check-packs.py` holds with 7 packs and 12 categories; `scripts/check-host-classes.py`
  reports 134 classes used and **0** with no rule in the host stylesheet.
- **Distribution: prepared, not submitted.** The repository name is decided
  ([`TobiasDraven/chroma-for-hermes`](https://github.com/TobiasDraven/chroma-for-hermes)); CI exists;
  the catalogue entry is drafted in `docs/CATALOG-SUBMISSION.md` at version 2.9.0. What is left is in
  §2.
- **Tags:** `v2.7.0` is the newest tag; `2.8.1` and `2.9.0` are untagged. The catalogue pins a full
  SHA, not a tag, so this is bookkeeping rather than a blocker.

### The decisions the code still reflects

- **F7 is twelve measured shelves, not hue buckets.** The original "group by main hue" idea did not
  survive contact with the data: a continuous hue sort put a grey theme in whichever bucket its border
  happened to carry. The catalogue is cut on measured gaps in its own accent hues instead — Persimmon,
  Apricot, Amber, Gold, Lemon, Fern, Teal, Cobalt, Indigo, Violet, Rose, and Neutral as its own bucket
  (`C < 0.04`). Hue now organises, but only through those measured families.
- **Hover preview was removed, not tuned.** `previewTheme` repaints the whole app; arming it 140 ms
  after pointer entry meant sweeping a hundred cards repainted Hermes a hundred times — reported from
  the field as "horribly slow". `39b592c` replaced it with a click-triggered pill whose revert timer
  is owned by the picker, so it still fires if the previewing card leaves the tree.
- **The square-card size was a layout bug, not a taste problem.** `columnsForWidth` capped the column
  count at four and derived card width from the viewport, so squares grew with the window. `d48750e`
  targets a fixed `CARD_MIN` (104 px) and lets auto-fill do the responsive work.
- **The quiet tier was a contrast decision, not a palette refresh.** `df327d8` moved 168 values across
  44 files so every `banner_dim` reached the 4.5:1 floor with hue and chroma held fixed; 0 of 94 skins
  are now below it in either mode. Eleven light-mode `status_bar_dim` values still sit just under the
  floor against the darker bar surface; that is recorded in `docs/THEME-PACK-CREATION.md` §12.

---

## 1. Fork decision

| | |
|:--|:--|
| Upstream | [jdtimothy/hermes-theme-picker](https://github.com/jdtimothy/hermes-theme-picker) (MIT, © 2026 Joshua Timothy) |
| Our fork | [`TobiasDraven/chroma-for-hermes`](https://github.com/TobiasDraven/chroma-for-hermes) |
| New name | **Chroma for Hermes** |
| Plugin id | `theme-picker` → **`chroma`** |
| Version | `1.5.1` → `2.0.0` at the fork; **2.9.0** today |
| Relationship | **Hard fork.** Upstream is lineage, not a branch to sync. |

### Why hard fork

This tree replaced the apply path, added the TweakCN importer and a Python backend, rebuilt the
catalogue around `skins-v2/`, and now carries an editor, packs and a specification of its own. Calling
that a patch of someone else's plugin would misdescribe what it is. Keep the MIT attribution and the
upstream bug-fix offer (PR #9); do not treat upstream's tree as a source of truth.

### Attribution duties (MIT, discharged)

- `LICENSE` — the original copyright and permission text is retained verbatim.
- `THIRD_PARTY_NOTICES.md` — retained; covers BChop's Hermes Skins Pack (50, MIT) and CliffWade's
  Hermes Desktop Theme Pack (100 v1.1.0, MIT).
- `README.md` — credits block names Joshua Timothy, links the original, states which parts are his and
  which are ours, and states plainly that this is not endorsed by the original author or Nous Research.
- `plugin.yaml` — `author` names both the fork maintainer and the original.
- The upstream bug fix stays offered as PR #9. That offer outlives the fork.

### Renamed in code

`desktop/plugin.template.js` (id, page route, contribution ids, palette label),
`dashboard/manifest.json` (name, label, tab path), `dashboard/plugin_api.py`, `install/*`,
`README.md`, `docs/ARCHITECTURE.md`, `docs/V2.md`, `CHANGELOG.md`, `VERSION`, plus the generator's
default paths and closing hint.

**App-owned keys deliberately NOT renamed** — `hermes-desktop-user-themes-v1`,
`hermes-boot-background`, `hermes-boot-color-scheme`. Desktop owns these; renaming would silently
orphan every theme the user already imported.

### Decisions from the rename

1. **Gateway transport skin prefix.** The 188 transports are named
   `theme-picker-<scene>-<mode>`, and those names are baked into the generated catalogue as
   `gatewayLightName` / `gatewayDarkName`. Renaming them to `chroma-*` touches `gateway-skins/`, the
   generated catalogue and the skins already installed on the gateway — a real change with a reinstall
   step and no functional gain. *Decision: leave them.* They are skin names, not the plugin id, and
   they appear only in `hermes skin list`.
2. **Stale `desktop/plugin.v2.js` + `desktop/plugin.v2.template.js`.** *Closed:* `461336d` removed the
   abandoned v2 builds and their design doc. Git history keeps them.

---

## 2. Distribution: the Hermes plugin catalog

**Status: prepared, not submitted.** The submission record is `docs/CATALOG-SUBMISSION.md`; the
catalogue itself is a directory of human-reviewed YAML entries in `NousResearch/hermes-agent`, with no
self-serve registry.

### What is already in place

- **The repository name is decided** — `TobiasDraven/chroma-for-hermes` — and the fork presents under
  it (`cd90ea9`).
- **`plugin.yaml` exists** (the gate refuses a plugin directory without one), the private core imports
  are gone, and the search-filter template literal that tripped the security scan is plain
  concatenation.
- **CI exists** — four job instances: the three-OS test matrix plus `build-is-current`. It runs the
  JS suite, pytest, `check-packs.py` and `check-package.py`, then rebuilds and refuses a diff.
- **The catalogue entry is drafted** in `docs/CATALOG-SUBMISSION.md`: name `chroma`, tier `community`,
  category `desktop`, version 2.9.0, `requires_hermes: ">=0.22.0"`, empty capabilities, and a full
  SHA. The draft pins `43f8e1b`; HEAD is two commits further on (one docs pin, one a11y fix).
- **The admission gate was recorded as passing** in the submission record. The recorded output is the
  same checks the catalogue CI runs: manifest, fields, `requires_hermes`, loadability, Python
  dependencies, tool collisions, `security scan — safe`, no core override, desktop surface, and a
  portable-plugin isolation note.

UNVERIFIED: the catalogue has not been submitted — that status is read from
`docs/CATALOG-SUBMISSION.md`; no catalogue PR was queried this session.
UNVERIFIED: the recorded `hermes plugins validate .` result was not re-run this session; the local CLI
failed to start with `hermes: cannot recover dependency publication … run 'hermes pm repair'`.
UNVERIFIED: the `requires_hermes: ">=0.22.0"` floor is taken from the drafted entry; it was not
re-probed against a Hermes release this session.

### What is actually left

1. **Re-pin the entry.** `git rev-parse HEAD` (or `origin/main`) at the moment of submission; a full
   40-character SHA, never a short one or a branch. Bump `version` in the same PR if the tree moved.
2. **Run the admission gate on a working machine.** `hermes plugins validate .` before opening the PR;
   the CLI is a local-only dependency and the run above did not complete here.
3. **One end-to-end install on a clean machine.** Install from the package, enable the desktop pane,
   apply a skin, import a TweakCN preset, restart Desktop and confirm the boot cache resolves the same
   palette.
4. **A fresh screenshot.** `docs/chroma-banner.png` is recorded in `docs/TASKS.md` as pre-fork UI.
5. **Open the PR** against `NousResearch/hermes-agent` adding `plugin-catalog/chroma.yaml`, with the
   drafted description, the lineage note (derived from jdtimothy/hermes-theme-picker, MIT), and the
   disclosure of the one TweakCN network call and the local-storage/skin-YAML writes.

The intake route is a human-reviewed PR, not a form; the gate documents the checks, not the queue.
After merge, install is `hermes plugins install chroma`; later updates are SHA-bump PRs, never a
self-update.

---

## 3. Feature roadmap

Ordered. F1–F7 are shipped; F8 and F9 are the only feature items still open.

### F1 — Delete and rename a skin — DONE

`08d639b` added the two guarded routes (delete moves to a sidecar trash folder; rename refuses a
built-in, a skin that is not Chroma's, the active skin, and a name that escapes a slug), `bf36a63`
made them reachable from the card, and `98a7ac5` added the provenance index that makes "ours"
knowable. Rename returns `wasActive` so the caller re-broadcasts the new name through `config.set`;
the gateway holds the old name until something sets it again.

### F2 — Mark which skins the CLI can use — DONE

`06e72d8`. A skin is CLI-capable iff its YAML exists at the **top level** of `<hermes home>/skins/` —
`list_skins()` globs `*.yaml` and is not recursive. The card carries *Gateway* vs *Desktop only*; the
badge is the cheapest way to teach the difference the whole architecture rests on.

### F3 — Export individual or all skins — DONE

`73374d6` (backend) and `8aff397` (picker), with the save path recorded in `90f1eaf`. The route returns
JSON carrying YAML text — one file for a named skin, `chroma-skins.json` with every owned skin — and the
pane turns it into a save; a binary zip would not survive the plugin's REST channel. Export round-trips
through the same schema the importer writes, so an export is also the format a user can hand-edit.

### F4 — Import from more sources — DONE

`4168af8` added Windows Terminal, Base16/24 and VS Code adapters behind one interface, all parsing to
colours before the shared skin writer. iTerm2 `.itermcolors` remains deliberately refused by name —
a dependency-free plist parser plus a perceptual colour matrix, for a format with no Windows
relevance. See `docs/TASKS.md` for the VS Code `include` misdiagnosis, which is a separate decision.

### F5 — Per-profile skins — DONE as option (b)

`4d22198` gave the picker a per-profile apply scope: Desktop applies the chosen theme per profile
while the gateway skin stays global. This is the weaker of the two designs in the original entry and
it was chosen because it is achievable entirely inside the plugin — option (a), profile-scoped skin
files, would need `list_skins()` to resolve per active profile and therefore an upstream change.

### F6 — Picker UI rework: squares, not long rectangles — DONE, then corrected

`7637536` shipped fixed-aspect square cards in an auto-fill grid; `39b592c` removed the hover preview;
`d48750e` fixed the card size and added the shape control; `aa4df9e` tightened the circle. The shape
is persisted under a plugin-owned `chroma-*` key and is **global**, not per profile: two profiles on
one machine describe the same window.

**Still open** (tracked in `docs/TASKS.md`):
- The per-card **overflow menu** for Export / Rename / Delete. The actions row sits under the card
  today and cannot move into the square: a button inside a button is invalid HTML, and the card is
  itself a button.
- `CARD_MIN` is a judgement, not a measurement — roughly 90 px is the floor that still fits a swatch,
  a truncated label and the pill.
- The circle gets looser padding on the same reasoning: its inscribed area is narrower than its
  bounding box, so text set to the box edge falls outside it.

### F7 — Sort and group by main hue — DONE, differently

The twelve measured shelves replaced the proposed hue buckets (see §0). `9ccbb8f` added the "By
theme" lens; `418f72b` reconciled the families from two research lanes. The mode axis remains
separate because it carries a real capability difference (`dynamic` means two coordinated palettes);
hue does not. Neutral is its own family, never a leftover.

### F8 — Adjust a skin's tint, value and brightness — UNSTARTED

**Why:** the catalogue is take-it-or-leave-it. "This one, but warmer" is the most common reaction to a
palette, and the only answer today is export, hand-edit, re-import.

**What it waits on:**
- A Captain decision: does an adjustment create a **new owned skin** (exportable, renameable), or is
  it **scratch state** that never persists? Either answer is defensible; the code must not silently
  mutate a catalogue skin.
- A priority slot after the catalogue submission. Nothing in the work is blocked technically.

**What is cheaper now than when this entry was written:** the SDK exports `hexToOklch`,
`oklchToHex`, `oklchToSrgb255`, `maxChroma`, `contrastRatio` and `readableOn`. Work in OKLCH so hue
rotation and lightness stay separable, and re-check `contrastRatio` on the meaning-carrying pairs
(text on background, accent on chrome) before accepting an adjustment.

### F9 — Interoperate with the official accent-picker plugin — UNSTARTED

**Why:** Nous Research's `accent-picker` (MIT, in `NousResearch/hermes-official-plugins`; formerly
`hermes-desktop-accent-picker`, now archived) retints live: an OKLCH wheel in the status bar, with the
palette re-deriving from the one colour picked. It reads and writes `$accentOverride` /
`setAccentOverride`, and the SDK exports both today. The override is deliberately **not persisted** —
it is an authoring knob, so a plugin that sets it must clear it on dispose. Two plugins writing one
appearance is the bug class this project keeps re-learning.

**What it waits on:**
- The precedence decision, documented: a Chroma skin apply and an accent override are two writers of
  one appearance; whichever wins, the other must not be left holding stale state.
- F8, which likely subsumes the useful half. If F8 lands, this shrinks to a precedence question and
  may never need a hard dependency on the other plugin.
- The rule stands: do **not** drive another plugin's internals; go through the shared SDK surface.

**Open:** is interop wanted at all, or is a documented precedence rule enough?

### Explicitly out of scope

- A community theme marketplace — hosting, moderation and trust are a project of their own.
- Time-of-day automatic switching — cheap to fake, annoying in practice.
- Anything that reaches into the app's theming internals. Every difficult bug in this project came
  from the plugin trying to own state the ThemeProvider owns.

---

## 4. Suggested sequence

| Order | Work | State |
|:--|:--|:--|
| — | F1–F7 | **done.** F7 is the twelve measured shelves, not hue buckets. |
| — | Skin editor, E0–E6 (`CHROMA-EDITOR.md`) | **done** — `d39c1af` … `1278139`. |
| — | Theme packs, P0–P6 (`CHROMA-PACKS.md`) | **done** — 94 skins in 7 packs, core 30. |
| — | Release 2.9.0 and C9 accessibility | **done** — `43f8e1b`, `f338063`. |
| 1 | **Catalogue submission** (§2) | **next.** Re-pin, validate, clean install, PR. |
| 2 | F8 tint/value/brightness | **unstarted.** Decide derived-vs-scratch first. |
| 3 | F9 accent-picker interop | **unstarted.** Precedence first; F8 may subsume it. |
| 4 | v3 custom background/backdrop images (§5) | **deferred by the Captain, 2026-10-20.** |

---

## 5. v3 — custom background and backdrop images

**Deferred by the Captain on 2026-10-20:** *"they support custom background/backdrop images! But lol
let's leave that for v3, we can add it to the roadmap for custom images etc."*

This section records a surface, not a design. No code, schema or route is proposed here.

### What it is

A user-supplied image used as the pane's backdrop, the sidebar art, or the empty new-session screen —
per skin or per pack, in both modes. The competitor
([`Adolanium/hermes-pantheon`](https://github.com/Adolanium/hermes-pantheon)) ships bundled dithered
statues for the sidebar and the empty new-session screen. Chroma ships palettes and fonts; it has no
image surface, and its editor edits colours and fonts.

### Why it is v3, not now

The catalogue submission is imminent and this is a new surface with its own storage, licensing and
host-capability questions — not a fix to an existing one.

### What the SDK offers today

Read from the host source on 2026-10-20: the Desktop SDK under
`C:/Users/malan/AppData/Local/hermes/hermes-agent/apps/desktop/src`, and — separately — the
dashboard/web plugin and theme surfaces under the same install.

- **No decoration slot exists in the Desktop SDK.** The SDK exports these contribution areas:
  `APPEARANCE_AREAS`, `CHAT_EMPTY_AREA`, `COMPOSER_AREAS`, `KEYBINDS_AREA`, `MODEL_MENU_ROW_AREA`,
  `PALETTE_AREA`, `PANES_AREA`, `ROUTES_AREA`, `SESSION_ROW_AREAS`, `SETTINGS_PLUGINS_AREA`,
  `SIDEBAR_NAV_AREA`, `SIDEBAR_NAV_PREFS_AREA`, `SIDEBAR_PROFILE_GROUP_HEADER_AREA`,
  `STATUSBAR_AREAS`, `THEMES_AREA`, `TITLEBAR_AREAS`, `TRANSCRIPT_DIRECTIVE_AREA` and
  `WORKSPACE_PAGE_HEADER_AREA`. They are structural mount points. `SIDEBAR_NAV_AREA` and
  `SESSION_ROW_AREAS` decorate *rows*, not the sidebar's background; there is no pane-, sidebar- or
  backdrop-image area.
- **`CHAT_EMPTY_AREA` is narrower than "the new-session screen".** It lets a plugin claim an empty
  *existing* session and render what stands in the gap; the host's doc comment says core owns the
  intro splash for a fresh draft. Replacing that splash needs a host change.
- **The Desktop theme object carries colour and raw CSS, not art.** `DesktopThemeColors` has
  `sidebarBackground` (a colour). `DesktopTheme` carries `customCSS`, injected as a scoped `<style>`
  while the theme is active. The host skin format is richer than Chroma's: `hermes_cli/skin_engine.py`
  also reads a `customCSS` key (32 KiB cap, deliberately not sanitised) and `banner_hero` (Rich-markup
  ASCII art for the CLI banner). Chroma's backend and schema carry neither. A `customCSS`-based image
  is therefore technically possible through the host skin format, but it is a new field and a new
  trust/security surface for Chroma, and reaching the sidebar by host class name remains the fragile
  route.
- **The dashboard/web surface is richer, and it is a different app.** The dashboard theme schema
  already has named asset slots — `assets.bg`, `hero`, `logo`, `crest`, `sidebar`, `header`, plus
  `assets.custom` — emitted as `--theme-asset-*`; `bg` is automatically wired into the dashboard
  backdrop (`hermes_cli/web_server_dashboard.py`, `web/src/themes/context.tsx`, and the dashboard
  docs). The dashboard plugin registry also has `backdrop` and `sidebar` slots
  (`web/src/plugins/slots.ts`). Chroma's `dashboard/manifest.json` declares `"slots": []`, and none
  of this paints the Desktop sidebar or the Desktop empty screen.
- **The Desktop app references `--theme-asset-bg` in exactly two CSS rules, and nothing in the
  Desktop source sets it.** It is not a working Desktop path today.
- **The host already has a backdrop, and it is not a plugin surface.** `backdrop.v1` is a boolean
  setting (`$backdrop`, persisted as `hermes.desktop.backdrop.v1`) for the app's bundled statue image
  behind the chat transcript. It is on/off, not a user image, and the plugin SDK does not expose it as
  a contribution.
- **Pantheon's own disclosure confirms the gap.** Its README says the art lives in the sidebar and the
  empty new-session screen, that every statue is a dithered image packed into `plugin.js`, and: *"The
  bracketed tabs, dotted rules and placement of the art style Hermes Desktop's own markup, because the
  plugin SDK has no slots for decoration yet. If a Desktop update renames that markup, those touches
  fall back to the plain palette."* That is the workaround class, not a supported surface.
- **The catalogue treats binary payloads and core-markup styling as risks.** Rule 17 admits plain
  source only (`.js`, `.py`, `.yaml`, `.md`; no binaries, `.pyc` or archives), and the submission
  record's "what would get us declined" list names querying the app's own markup to restyle core UI.
  Bundled art and a `customCSS` selector hack both need adjudication before they can ship under
  Chroma's name.

**Consequence:** on the Desktop surface this needs a host change — an asset/decoration field on the
Desktop theme model, or a real background slot. The dashboard already proves the schema shape (named
asset slots, `bg` auto-wired) and can be a model, not a drop-in: Chroma is a Desktop plugin and its
dashboard manifest has no UI. Until a Desktop slot exists, the only implementation available is the
same fragile host-markup styling Pantheon discloses, and Chroma should not adopt that silently.

### Open questions

1. **Where does the image live?** A path field in the skin YAML, a file the user picks, or a URL?
   Chroma's skin schema carries colours, fonts and catalogue metadata; it has no image field, and its
   backend does not read or emit the host's `customCSS` / `banner_hero` (`grep` finds no occurrence in
   `dashboard/`, `desktop/`, `scripts/` or `skins-v2/`). The pane has no filesystem access — the
   editor plan records that every write goes through `dashboard/plugin_api.py`. A URL adds a network
   surface, and the only network call disclosed today is the TweakCN import.
2. **Per skin, per pack, or per profile?** Skins are portable files; packs are curated metadata;
   profile scoping already exists for the applied theme (F5, option b). Each answer chooses a
   different owner for the asset and a different export behaviour.
3. **Light and dark: one image, or two?** Every skin carries both palettes. One image must read on
   both grounds; two doubles the asset count and the pack size.
4. **Sizing, cropping and tiling.** Cover, contain, repeat, focal point? What happens in a narrow
   window, and at the 104 px card size — does the card show the image, or only the applied pane? The
   plugin has no layout measurement today; those choices must be inline styles, not host classes the
   stylesheet may not generate.
5. **What the SDK actually offers now versus what needs a host change.** This is the load-bearing
   question. Today: no Desktop decoration slot, `CHAT_EMPTY_AREA` only for empty existing sessions,
   colour plus `customCSS` on the Desktop theme, the host skin format's `customCSS` / `banner_hero`,
   and asset slots only on the dashboard theme. Needed: a supported background/decoration field on the
   Desktop model, or a slot for the Desktop sidebar and the fresh-draft splash.
6. **Licensing.** A user-supplied image is the user's: Chroma may read and display it locally, but must
   not redistribute it or claim a licence over it. A bundled image is not: it needs a licence that
   permits redistribution, an entry in `THIRD_PARTY_NOTICES.md`, and the catalogue's payload rule
   answered. Pantheon's MIT repository and SIL OFL fonts are the model for the bundled case, not a
   permission slip for ours.
7. **Storage and privacy.** A skin file that gets exported or shared carries whatever the image field
   carries. An absolute local path leaks the user's filesystem layout and breaks on another machine; a
   URL leaks a request to a third party and may be unreachable offline; embedded bytes inflate the
   YAML and every pack bundle. Decide what travels before deciding the format.

### What would have to be true first

1. **A prior-art scout** of Pantheon and the other decoration packs — what they bundle, how they load
   it, what breaks when the host markup moves, and whether their licence covers the art.
2. **An SDK capability check** against the Hermes version that will be current at v3: does a supported
   decoration/background slot exist by then, or is a host change required? If a host change is
   required, the item is not solely Chroma's to schedule.
3. **A Captain decision** on the surface (sidebar, empty screen, pane, or a subset), on user-supplied
   versus bundled art, and on the derived-versus-scratch storage rule.
4. **A catalogue-rule answer** on binaries and network access before any bundled art is designed into
   the package.

---

## 6. Evidence

Every number and state claim above comes from a command run in this session (2026-10-20), from the
host source read in this session, or is marked `UNVERIFIED`. No figure was carried forward from the
previous version of this file.

```
$ "/c/Program Files/Git/cmd/git.exe" rev-parse --short HEAD
f338063

$ "/c/Program Files/Git/cmd/git.exe" log --oneline -12
f338063 fix(a11y): the roving set returned a fake React element, and every card broke
e251603 docs(submission): pin 2.9.0 and its sha
43f8e1b feat(a11y): the pane is operable and announceable without a pointer (C9)
c0575ca docs(plan): v2 carries all eleven review findings; the review is on the record
775103d docs: the ARIA pass is planned, and the scout's evidence is on the record
7ec8ab4 docs(submission): pin 2.8.1 and its sha
df327d8 fix(skins): the quiet tier clears AA — 44 one-mode failures, 168 values, 0 left
738b1a2 docs(agents): name the gates that exist, and the runner that actually runs
37c0846 fix(pane): every dead class replaced by the channel the host cannot drop
2caf959 fix(editor): the modal caps itself in the one channel the host cannot drop
d2fac1b ci: install the runner the suite needs, and run the suites as the repo documents
6baa64c docs: pin the submission to 4462d05, and say when to re-pin

$ cat VERSION
2.9.0

$ ls skins-v2/*.yaml | wc -l
94

$ ls gateway-skins/*.yaml | wc -l
188

$ "/c/Program Files/nodejs/node" --test tests/*.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
ℹ tests 266
ℹ pass 266
ℹ fail 0

$ unset PYTHONPATH && python -m pytest tests/ -q 2>&1 | tail -3
........................................................................ [ 76%]
.................................sss........                   [100%]
185 passed, 4 skipped, 9 subtests passed in 132.35s (0:02:12)

$ python scripts/check-package.py
OK: package contract holds at 2.9.0 (94 skins, 533 tracked files)

$ python scripts/check-packs.py
skins: 94
packs: {'core': 30, 'cyberpunk': 11, 'earth': 11, 'noir': 10, 'retro': 11, 'studio': 10, 'zen': 11}
categories: {'cobalt': 13, 'neutral': 10, 'indigo': 8, 'amber': 8, 'gold': 8, 'persimmon': 8, 'violet': 8, 'teal': 8, 'rose': 7, 'fern': 7, 'apricot': 5, 'lemon': 4}

OK: contract holds

$ python scripts/check-host-classes.py
host sheets: 6 (399988 chars) · classes used: 134 · with no rule: 0
OK: every class we use has a rule in the host stylesheet.

$ "/c/Program Files/Git/cmd/git.exe" tag --list | tail -5
v1.5.0
v1.5.1
v2.7.0

$ "/c/Program Files/Git/cmd/git.exe" describe --tags --always
v2.7.0-16-gf338063

$ "/c/Program Files/Git/cmd/git.exe" rev-list --count 43f8e1b..HEAD
2

$ python -c "import yaml;d=yaml.safe_load(open('.github/workflows/ci.yml'));print('jobs:',list(d['jobs']));print('matrix:',d['jobs']['test']['strategy']['matrix']['os'])"
jobs: ['test', 'build-is-current']
matrix: ['ubuntu-latest', 'macos-latest', 'windows-latest']

$ hermes plugins validate .
hermes: cannot recover dependency publication: C:\Users\malan\AppData\Local\hermes\installs\a13589dc3d4cc6ea\publication.json: config changed after publication began; preserve it for manual recovery; run `hermes pm repair`

$ grep -rn "customCSS" dashboard desktop scripts skins-v2
(no output; exit 1)

$ grep -rhoE "[A-Z][A-Z_]+_AREAS?" "C:/Users/malan/AppData/Local/hermes/hermes-agent/apps/desktop/src/sdk/index.ts" | sort -u
APPEARANCE_AREAS
CHAT_EMPTY_AREA
COMPOSER_AREAS
KEYBINDS_AREA
MODEL_MENU_ROW_AREA
PALETTE_AREA
PANES_AREA
ROUTES_AREA
SESSION_ROW_AREAS
SETTINGS_PLUGINS_AREA
SIDEBAR_NAV_AREA
SIDEBAR_NAV_PREFS_AREA
SIDEBAR_PROFILE_GROUP_HEADER_AREA
STATUSBAR_AREAS
THEMES_AREA
TITLEBAR_AREAS
TRANSCRIPT_DIRECTIVE_AREA
WORKSPACE_PAGE_HEADER_AREA

$ grep -rn "theme-asset" "C:/Users/malan/AppData/Local/hermes/hermes-agent/apps/desktop/src"
C:/Users/malan/AppData/Local/hermes/hermes-agent/apps/desktop/src/styles.css:1003::root:not([style*='--theme-asset-bg:']) .theme-default-filler {
C:/Users/malan/AppData/Local/hermes/hermes-agent/apps/desktop/src/styles.css:1007::root[style*='--theme-asset-bg:'] .theme-default-filler {

$ grep -n "sidebarBackground\|customCSS" .../apps/desktop/src/themes/types.ts
46:  sidebarBackground?: string
112:  customCSS?: string

$ grep -n "banner_hero: str\|custom_css: str\|banner_hero=data\|custom_css=str" .../hermes_cli/skin_engine.py
29:    banner_hero: str = ""    # Rich-markup hero art (replaces HERMES_CADUCEUS)
30:    custom_css: str = ""     # Raw CSS injected as a <style> tag on the desktop GUI (32 KiB cap)
407:        banner_hero=data.get("banner_hero", ""),
408:        custom_css=str(data.get("customCSS", "")).strip()[:32768])

$ grep -n "customCSS" .../apps/desktop/src/themes/context.tsx
201:// (never shadowed — see ingestBackendSkin), but its customCSS is carried
202:// separately in $backendCustomCSS. The seed's own customCSS (non-built-in
204:const customCSSOf = (seed: DesktopTheme): string | undefined => seed.customCSS ?? $backendCustomCSS.get()[seed.name]
213:    customCSS: customCSSOf(seed)
247:    customCSS: customCSSOf(base)
421:  // Inject / clear customCSS from the skin (mirrors web/src/themes/context.tsx).
422:  // A theme carries the optional customCSS field; we inject/remove a single
426:  const customCSS = theme.customCSS?.trim()
428:  if (!customCSS) {
440:    cssEl.textContent = customCSS

$ sed -n '298,311p' .../hermes_cli/web_server_dashboard.py
# Named asset slots; other keys under ``assets.custom`` become ``--theme-asset-custom-<key>``.
_THEME_NAMED_ASSET_KEYS = {"bg", "hero", "logo", "crest", "sidebar", "header"}

# Component-style buckets: each camelCase property under a bucket emits
# ``--component-<bucket>-<kebab-property>`` on :root, consumed by shell components.
_THEME_COMPONENT_BUCKETS = {
    "card", "header", "footer", "sidebar", "tab", "progress", "badge", "backdrop", "page"
}
_THEME_LAYOUT_VARIANTS = {"standard", "cockpit", "tiled"}

# customCSS cap so an oversized theme YAML can't blow up the payload or <style> tag.
_THEME_CUSTOM_CSS_MAX = 32 * 1024

$ sed -n '329,333p' .../hermes_cli/web_server_dashboard.py
    customCSS is clipped but intentionally NOT sanitised — themes are user-authored YAML in
    ~/.hermes/, the same trust level as config.yaml. Empty asset values are dropped so a
    theme can explicitly clear a slot.

$ sed -n '20,26p' .../web/src/plugins/slots.ts
 *  Shell-wide slots:
 *  - `backdrop`         — optional full-viewport background decoration;
 *                         mounted behind shell chrome at z-0
 *  - `header-left`      — injected before the Hermes brand in the top bar
 *  - `header-right`     — injected before the theme/language switchers
 *  - `header-banner`    — injected below the top nav bar, full-width

$ sed -n '60,64p' .../web/src/plugins/slots.ts
export const KNOWN_SLOT_NAMES = [
  // Shell-wide
  "backdrop",
  "header-left",
  "header-right",

$ sed -n '185,196p' .../website/docs/user-guide/features/extending-the-dashboard.md
Ship artwork URLs with a theme. Each named slot becomes a CSS var (`--theme-asset-<name>`) that the built-in shell and any plugin can read. The `bg` slot is automatically wired into the backdrop; other slots are plugin-facing.
```yaml
assets:
  bg: "https://example.com/hero-bg.jpg"           # auto-wired into <Backdrop />
  hero: "/my-images/strike-freedom.png"           # for plugin sidebars
  crest: "/my-images/crest.svg"                   # for header-left plugins
  logo: "/my-images/logo.png"
  sidebar: "/my-images/rail.png"
  header: "/my-images/header-art.png"
  custom:
    scanLines: "/my-images/scanlines.png"         # → --theme-asset-custom-scanLines

$ grep -n '"slots"' dashboard/manifest.json
12:  "slots": [],

$ for c in d39c1af e450eb0 832e5d4 a80c8c7 256d1a0 1278139 08d639b bf36a63 06e72d8 73374d6 8aff397 4168af8 4d22198 7637536 39b592c d48750e aa4df9e 9ccbb8f 418f72b df327d8 ba0749f 05154e6 829e3f5 461336d cd90ea9; do "/c/Program Files/Git/cmd/git.exe" log --oneline -1 "$c"; done
d39c1af feat(editor): the schema, the overrides store, and the first editor surface
e450eb0 feat(editor): owned skins edit in place, the schema becomes a drift alarm, and the 409 gets helpful
832e5d4 feat(editor): duplicate a skin, and packs that export and import
a80c8c7 E4 pane: user category shelves, management UI, and per-skin assignment
256d1a0 E5 pane: typography overrides, boot survival, schema drift, emoji fallback
1278139 E6 polish: keyboard/touch reach selectors, empty states verified, authored-snapshot reset confirmed
08d639b feat(api): delete and rename an owned skin, with the guards that make it safe
bf36a63 feat(picker): reachable delete and rename on owned skins
06e72d8 feat(picker): mark which skins the CLI can actually use
73374d6 feat(api): export one owned skin or all of them
8aff397 feat(picker): export one skin or every owned skin from the picker
4168af8 feat(import): sniff and import Windows Terminal, Base16/24 and VS Code themes
4d22198 feat(picker): per-profile apply scope, so a pick can stay on this profile
7637536 feat(picker): square cards in an auto-fill grid, with a debounced hover preview
39b592c perf(picker): preview on a click, not on hover
d48750e feat(picker): smaller cards, and a control for their shape
aa4df9e fix(picker): a circle holds only its palette
9ccbb8f feat(gallery): a By theme lens, circle caption above, bigger base, one settings row
418f72b feat(taxonomy): twelve measured families, reconciled from two research lanes
df327d8 fix(skins): the quiet tier clears AA — 44 one-mode failures, 168 values, 0 left
ba0749f feat(skins): six packs, a font for every skin, and a gate that enforces it
05154e6 feat(skins): the generator reads schema v2, and the catalogue is 94 skins
829e3f5 feat(packs): core is the default shelf, and every skin has a home
461336d chore: remove the abandoned v2 builds and their design doc
cd90ea9 docs: present the fork for its public rename to chroma-for-hermes
```

The host source lines above were read from the install named in §5. `sed -n '1,20p'` of
`apps/desktop/src/lib/chat-empty.ts` produced the doc comment quoted in §5, including "Core owns
exactly one empty state: the intro splash, which belongs to a fresh draft with no session selected."
`sed -n '1,14p'` of `apps/desktop/src/store/backdrop.ts` produced `const KEY =
'hermes.desktop.backdrop.v1'`, the comment "Whether the faint statue image renders behind the chat
transcript", and `export const $backdrop = atom(storedBoolean(KEY, false))`. The competitor quotations
are from `https://github.com/Adolanium/hermes-pantheon` (README, fetched 2026-10-20).
