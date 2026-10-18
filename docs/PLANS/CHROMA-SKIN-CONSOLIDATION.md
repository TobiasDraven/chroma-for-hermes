# Skin consolidation — one concept, one word

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
| **target skin files** | **94, or 109 if D1 is read to include host built-ins** |

### 4.1 The one open sub-decision

The 15 host built-ins (`nous`, `midnight`, `ember`, `mono`, `cyberpunk`, `slate`,
+ 7 backend) are **the host's** themes, not ours. They are also the 8 skins that
carry no `status_bar_bg` and no `banner_dim` — the reason 14 skins fail the
signature-role check today.

- **Recommended: drop them from the catalogue.** 94 skins, every one a complete
  file, zero invented colour, and the 14 missing-role defects vanish. Hermes'
  own Appearance list still shows the host's themes, which is where they belong.
- Alternative: materialise them as files — but then we must invent the two roles
  the host does not define, and the picker shows a second copy of a theme the
  user already has.

## 5. Phases

| # | Phase | Done when |
|---|---|---|
| P1 | **Contract v2** — schema version, both modes required, `pack` and `category` required, load-time validation | a file missing either mode refuses to load, with a named error |
| P2 | **Materialise** — merge 54 pairs, write the 47 derived halves into their files, repair the 7 `background` gaps from the shell key they already carry | 94 files, each dual-mode, palettes **byte-identical** to today's output |
| P3 | **Generator** — delete `THEME_PAIRS` (55 hardcoded pairs), delete `_port_palette` from the build path, delete pair collapsing | the build does one thing: file in, card out |
| P4 | **Backend vocabulary** — one concept: `/skins/{name}` and its override; the separate `/overrides/{scene}` surface folds in | no route mentions a scene |
| P5 | **Rename sweep** — 424 occurrences in the template, 77 in the generator, 52 in the backend, 8 test files | `grep -ri scene` in shipped code returns nothing |
| P6 | **Taxonomy + packs** — apply the researched category scheme, curate the packs, both enforced | every skin has exactly one of each |

P6 depends on the two research lanes (`deleg_31885767`): a measured colour
taxonomy and a 12-name vocabulary.

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
