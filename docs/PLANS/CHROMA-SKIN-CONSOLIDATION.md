# Skin consolidation — one concept, one word

> **SUPERSEDED 2026-10-19.** This plan describes the campaign that produced
> release 2.6.0. Where it disagrees with the build, the build wins:
> read `docs/RELEASE-2.6.0.md` for what actually ships.

Status: PLAN — not started.
Author: Faris al-Faris. Decisions by Captain Tobias, 2026-10-19.
Baseline: `7eaa80b`, 109 cards, 150 palette files.

## 1. Decision record

| # | Decision | Consequence |
|---|---|---|
| D1 | **Every skin is a file.** | No skin exists only in code. The catalogue is the `skins/` directory. |
| D2 | **Write once, never derive again.** | Derivation happens once, at migration, and the result is written into the file. The build never invents colour. |
| D3 | **Exactly one pack per skin** — `core` or one of five. | Packs partition the catalogue. Overlap is a build failure. |
| D4 | **Exactly one category per skin.** | Categories partition the catalogue independently of packs. |
| D5 | **One word: skin.** | "Scene" disappears from code, API, docs and UI. |
| D6 | **Host built-ins leave the catalogue.** | 15 entries (`nous`, `midnight`, `ember`, `mono`, `cyberpunk`, `slate` + 7 backend) are Hermes' themes, not ours. **94 skins ship.** Appearance still lists the host's own themes. |

## 2. The model

```
skins/<id>.yaml        one file  = one skin = one card
  schema_version: 2
  name: <id>           stable; it is the transport stem and the override key
  label: <display>
  pack: core|earth|cyberpunk|zen|retro|noir
  category: <one of twelve>
  typography: {...}    optional
  light_colors: { 43 roles }     REQUIRED
  dark_colors:  { 43 roles }     REQUIRED
```

`light_colors` and `dark_colors` already exist in the backend contract
(`plugin_api.py:1435`). **Zero of the 150 shipped files use them.**

## 3. Why compatibility is nearly free

Everything persisted already speaks the **card** id, not the file name:

| surface | key | survives? |
|---|---|---|
| gateway transports | `theme-picker-<id>-light` / `-dark` | yes — id unchanged |
| overrides store | skin id | yes |
| `packs.json` members | skin id | yes |
| user's saved theme | transport name | yes |

So the migration must preserve the **109 existing ids exactly**. No user loses
a saved theme or an override.

## 4. Migration arithmetic

| input | count |
|---|---|
| palette files today | 150 |
| user cards | 94 (54 merged from two files, 40 single) |
| host built-in cards | 15 (8 Desktop, 7 backend) |
| **target skin files** | **94** (D6) |

### 4.1 Resolved — host built-ins leave (D6)

They are **the host's** themes, not ours, and they are the 8 skins carrying no
`status_bar_bg` and no `banner_dim`. Dropping all 15 removes the entire
missing-role defect class: **the 94 remaining skins are complete.**

### 4.2 Measured — the migration reproduces every shipped palette

`scripts/migrate-to-skins.py` builds the 94 records, projects each back to the
current catalogue shape, and diffs it against `desktop/plugin.js`:

```
records=94 checked=94 mismatched=0
```

Two rules make that exact, and both were found the hard way:

- A **derived** half is ported from the *compacted* palette (`KEEP_KEYS`), not
  the 43-role file, because `_port_palette` synthesises extra roles.
- A **derived** half is emitted whole (27 roles); an **authored** half is
  compacted to `KEEP_KEYS` on load. Compacting both broke 40 skins.

### 4.3 Resolved — the 16 missing roles are completed at P6

40 skins ship a ported half that lacks 16 roles (`diff_*`, `syntax_*`,
`voice_status_bg`, `selection_bg`…). The picker never reads them, so nothing on
screen is wrong today.

**Captain's decision (2026-10-19): accept now, complete at P6** — after the full
colour-science redesign, so the missing roles are filled by the new rules rather
than by the old ones.

The migration therefore records exactly what ships. Nothing is invented in P2.

## 5. Phases

| # | Phase | Done when |
|---|---|---|
| P1 | **Contract v2** — schema version, both modes required, `pack` and `category` required, load-time validation | a file missing either mode refuses to load, with a named error |
| P2 | **Materialise** — merge 54 pairs, write the 47 derived halves into their files, repair the 7 `background` gaps from the shell key they already carry | 94 files, each dual-mode, palettes **byte-identical** to today's output |
| P3 | **Generator** — delete `THEME_PAIRS` (55 hardcoded pairs), delete `_port_palette` from the build path, delete pair collapsing | the build does one thing: file in, card out |
| P4 | **Backend vocabulary** — one concept: `/skins/{name}` and its override; the separate `/overrides/{scene}` surface folds in | no route mentions a scene |
| P5 | **Rename sweep** — 424 occurrences in the template, 77 in the generator, 52 in the backend, 8 test files | `grep -ri scene` in shipped code returns nothing |
| P6 | **Colour-science redesign, then allocation** — rebuild the taxonomy on measured OKLCH axes; assign every skin exactly one category and exactly one pack; complete the 16 missing roles in every ported half; the scheme must also **guide the creation of future packs**, not just label today's | every skin has exactly one of each; the rules generate a defensible assignment for a new skin without a human vote; a new pack can be tested for coherence before it ships |

P6 depends on the two research lanes (`deleg_31885767`): a measured colour
taxonomy and a 12-name vocabulary.

### 6.1 The taxonomy, decided

Twelve families, cut on the measured gaps in the 94 accent hues: **Persimmon,
Apricot, Amber, Gold, Lemon, Fern, Teal, Cobalt, Indigo, Violet, Rose, Neutral**
(C < 0.04). Counts 8/5/8/8/4/7/8/13/8/8/7/10 — sums to 94, no shelf below 4.

Three reconciliations were needed between the two lanes:

- Lane A's cuts leave **teal and azure at 2 skins each** — unusable as filters.
- Lane B's Rose/Magenta split needs a shelf of 2 at 322–345. One family, Rose.
- Lane B's **Slate** is rejected: the host shipped a theme called `slate` (D6),
  and Tailwind gives "olive" and "slate" different meanings. `Neutral` says what
  it means.

### 6.2 Character is measured alongside hue

Hue alone cannot answer "is this muted?". **Energy** is measured from the accent
chroma: quiet (C < 0.06) 15 · balanced 52 · vivid (C ≥ 0.14) 27.

**11 name/colour conflicts are reported, never silently resolved** — e.g.
`rice-paper` promises quiet and measures *vivid*; `vibrant-pacific` promises
loud and measures *balanced*. A skin is never called muted when it measures
otherwise.

### 6.3 Pack allocation — blocked on a decision

Defined by measured region and scored, an honest assignment gives Noir 16,
Cyberpunk 14, Zen 12, but **Earth 5 and Retro 5**, with 12–16 skins fitting no
theme. Forcing 13 per pack put an indigo and two neutrals in Earth and a vivid
lemon in Noir — the duplicates problem wearing a different coat.

Awaiting the Captain: build the missing Earth/Retro skins, relax the range, or
add a sixth pack for the ported editor themes.

## 6. Gates

1. **Palette digest** — SHA-256 of all 109 (or 94) palettes before and after;
   the migration must not move a single channel value.
2. **Dual-mode** — every skin file has both `light_colors` and `dark_colors`.
3. **Partition** — every skin has exactly one pack and exactly one category, and
   every declared id is in use.
4. **One word** — `scene` appears nowhere in shipped code, routes, docs or UI.
5. **Build currency** — `regenerate.py` twice leaves the tree clean.

Gate 1 is the one that makes this safe: the refactor may rename anything, but it
must not change a colour.

## 7. Risks

| risk | mitigation |
|---|---|
| A merged skin silently changes a colour | digest gate 1, per skin, before any other work |
| The 47 derived halves differ from the build-time derivation | derive with the existing `_port_palette`, then compare to the shipped catalog value |
| Transport names drift, breaking saved themes | ids are frozen; a test loads a 2.5.2 localStorage blob |
| The rename misses a caller | grep gate 4, plus the suite |

## 8. Not in scope

- New skins. The pack campaign may add them later, but this refactor changes
  structure only.
- The accessibility pass (C9).
- Any change to the 43-role contract itself.
