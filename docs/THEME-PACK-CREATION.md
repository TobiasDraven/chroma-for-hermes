# Theme Pack Creation

**The Chroma skin specification — colours, typography, and how an agent builds one.**

Status: **in force**. `design_spec: v1` is grandfathered; `design_spec: v2` is the
target for every new skin and every skin that is revised.
Owner: Faris. Gate: `python scripts/check-packs.py` plus `pytest tests/`.
Measured against: the 94 skins in `skins-v2/`, on 2026-10-19.

---

## 0. What this document is for

A skin is a promise about light. It says: *here is a room, here is the ink on the
wall, here is how a warning looks in that room.* A reader never inspects the file;
they sit in the room. So the file has to be written by someone who knows what the
room will feel like, and checked by something that does not care about feelings.

This document is both halves:

- §1–§3 — the model: what a skin **is**, what it must declare, and what may be derived.
- §4 — the complete colour surface: all 43 names, what each one paints, and whether
  the Desktop window reads it.
- §5 — the ten surfaces a v2 skin must address, and the derivation rules for the rest.
- §6 — colour science: perceptual space, ramps, contrast, signals, and the traps.
- §7 — typography.
- §8 — packs and categories.
- §9 — naming, label, description, energy.
- §10 — the build recipe an agent follows, step by step.
- §11 — acceptance gates, with numbers.
- §12 — known limits, stated rather than hidden.

Read §4 and §5 before you write a palette. Read §6 before you believe it looks good.

---

## 1. The model

One skin is one file. `skins-v2/<name>.yaml`. The file name equals the `name`; the
gate fails otherwise.

A skin belongs to **exactly one theme pack** (`pack`) and **exactly one category**
(`category`). Not zero, not two. Packs are how the gallery shelves skins; categories
are what a skin *is*, measured from its accent (§8). The pack is a curatorial
decision; the category is a measurement.

A skin carries **both modes**. A light-only or dark-only skin is not a skin — it is
half a promise. The one exception in the catalogue is a `provenance.derived` half,
which states which side was inherited from a sibling so that the gap is on the
record rather than in the eye.

```yaml
schema_version: 2        # the FILE format
design_spec: v2          # the DESIGN contract this skin was authored against
name: dark-nord
label: Nord
description: Nord, arctic bluish calm
pack: studio
category: teal
energy: quiet            # quiet | balanced | vivid
provenance: { ... }      # where the palette came from
light_colors: { ... }    # ten surfaces minimum, forty-three at full spectrum
dark_colors: { ... }
typography:
  fontSans: '"Inter", "Segoe UI", system-ui, sans-serif'
  fontMono: '"IBM Plex Mono", Consolas, monospace'
```

---

## 2. Versioning: v1, v2, and full spectrum

There are three possible states, and they are not a ladder of quality — they are a
ladder of **how much of the skin is a decision**.

| state | `design_spec` | what it means | who may ship it |
|---|---|---|---|
| V1 | `v1` | A hand-authored palette. The author chose whichever of the 43 keys the skin needed; the rest inherit. Nothing states which ten the skin is *built on*. | the existing catalogue only, until revised |
| V2 | `v2` | **Ten named surfaces plus two fonts.** The other 33 keys either derive by the rules in §5 or are overridden deliberately. | every new skin, and every revised skin |
| Full spectrum | `v2` + all 43 | V2, with all 43 keys authored by hand because the design demanded it — a terminal skin with custom diff tints, a syntax theme that must match an external standard. | optional, and never required |

**Why v2 is ten and not forty-three.** Forty-three decisions is not rigour; it is
thirty-three opportunities to drift. A skin where the menu-highlight colour was
chosen separately from the accent is a skin where the two will disagree the first
time someone edits one. Ten surfaces forces the author to answer the questions that
actually shape a room — *what is the floor, what is the ink, what is the signal* —
and derive the rest from those answers, so the answers cannot contradict each other.

**Why v1 still exists.** All 94 shipped skins are marked `design_spec: v1`. They
carry between 27 and 43 keys each, and 88 of them have no `selection_bg` in their
light palette at all. Rewriting them wholesale would replace work that already has
judgement in it with work that has only arithmetic. They stay v1, honestly labelled,
and graduate one at a time when someone has a reason to open them.

**Graduating a skin.** Add `design_spec: v2`, then walk §5: confirm the ten are
present in both modes and *mean* what the table says. Where a key was hand-picked
and must not change, keep it and note why in the commit. The gate only checks
presence; the judgement is yours.

---

## 3. What the engine does with the file

- The palette is merged over the base skin at load; a key the skin omits is not an
  error, it is an inheritance. That is why a v1 skin with 27 keys still renders.
- `typography.fontSans` and `typography.fontMono` are applied as font stacks by the
  Desktop. Both are required of every skin, v1 or v2, by the gate.
- An override written by the editor lives outside the skin file (`.chroma/overrides
  .json`) and is re-applied after registration. Editing a skin never rewrites the
  shipped YAML.
- `scripts/regenerate.py` reads `skins-v2/` and nothing else. There is no v1 fallback.

---

## 4. The complete colour surface — 43 names

Fourteen keys are read by the Desktop window's renderer (marked **D**). The whole
palette is handed to the host, but the renderer paints from fourteen of them; the
CLI paints from all 43. A key without **D** is real, and editing it will not repaint the window — the
editor marks those rows `CLI` rather than pretending they are inert.

Grouped as the editor groups them.

### Core — the room itself

| key | role | what it paints | D |
|---|---|---|---|
| `background` | shell | the base every other role is read against | ● |
| `status_bar_bg` | surface | raised bars, menus, cards | ● |
| `completion_menu_bg` | surface (alias) | the menu body | ● |
| `ui_accent` | signature | accent surfaces and highlights | ● |
| `banner_accent` | signature (alias) | the header's accent | ● |
| `banner_title` | signature (alias) | the title in the header | ● |
| `ui_text` | text | the reading colour | ● |
| `banner_text` | text (alias) | the header's reading colour | ● |
| `status_bar_text` | text (alias) | status bar text | ● |
| `banner_dim` | dim | secondary and muted labels | ● |
| `ui_border` | structure | borders and dividers | ● |
| `banner_border` | structure (alias) | the header's divider | ● |
| `session_border` | structure (alias) | the session list divider | ● |

### Menus — the surfaces you point at

| key | role | what it paints | D |
|---|---|---|---|
| `completion_menu_current_bg` | menu selection | the highlighted row | |
| `completion_menu_meta_bg` | menu meta | the meta strip under a row | |
| `completion_menu_meta_current_bg` | menu meta selection | that strip, highlighted | |
| `selection_bg` | text selection | selected text in the transcript | |
| `voice_status_bg` | voice bar | the voice input surface | |

### Text — small print and marks

| key | role | what it paints | D |
|---|---|---|---|
| `ui_label` | labels | small interface labels | |
| `status_bar_dim` | status dim | secondary status bar text | |
| `status_bar_strong` | status strong | emphasised status bar text | |
| `session_label` | session label | the session name in the header | |
| `prompt` | prompt | the input prompt mark | |
| `shell_dollar` | shell mark | the shell prompt glyph | |

### State — the signals

| key | role | what it paints | D |
|---|---|---|---|
| `ui_ok` | success | success | |
| `ui_warn` | caution | caution | |
| `ui_error` | failure | failure | ● |
| `ui_thinking` | reasoning | the reasoning indicator | |
| `ui_tool` | tool | the tool-call accent | |
| `status_bar_good` | status healthy | status bar, healthy | |
| `status_bar_warn` | status warning | status bar, warning | |
| `status_bar_bad` | status failure | status bar, failure | |
| `status_bar_critical` | status critical | status bar, critical | |

### Syntax and diffs — code

| key | role | what it paints | D |
|---|---|---|---|
| `syntax_comment` | comment | code comments | |
| `syntax_keyword` | keyword | language keywords | |
| `syntax_number` | number | numeric literals | |
| `syntax_string` | string | string literals | |
| `diff_added` | added line | an added line | |
| `diff_added_word` | added word | the changed word in it | |
| `diff_removed` | removed line | a removed line | |
| `diff_removed_word` | removed word | the changed word in it | |

### Framing — the edges of a response

| key | role | what it paints | D |
|---|---|---|---|
| `response_border` | response frame | the border around a response | |
| `input_rule` | input rule | the rule above the composer | |

---

## 5. The ten surfaces — the v2 contract

A v2 skin addresses these ten, in both modes. Everything else derives.

| # | key | it decides | what good looks like |
|---|---|---|---|
| 1 | `background` | the floor of the room | the largest area; never pure white or pure black as a habit |
| 2 | `status_bar_bg` | the raised surface | distinguishable from the floor without a border |
| 3 | `ui_text` | the reading ink | the highest contrast in the skin, by a wide margin |
| 4 | `banner_dim` | the quiet ink | still readable, never a guess |
| 5 | `ui_accent` | the one colour the skin is remembered by | one accent, used sparingly |
| 6 | `ui_border` | the seams | visible against both floor and raised surface |
| 7 | `ui_ok` | healthy | distinguishable from the accent |
| 8 | `ui_warn` | caution | distinguishable from `ui_ok` |
| 9 | `ui_error` | failure | the most saturated signal, never a second accent |
| 10 | `selection_bg` | what "selected" looks like | a tint of the accent or the surface, never a signal colour |

### Derivation — the other 33

When a key is not authored, it takes its value from a surface. *Mix* means a blend
in OKLCH toward the second colour by the stated percentage — not an alpha, because
an alpha over an unknown background is a promise to a background you do not own.

| derived key | from | rule |
|---|---|---|
| `banner_text`, `status_bar_text` | `ui_text` | same value |
| `banner_title` | `ui_text` | same value |
| `banner_accent` | `ui_accent` | same value |
| `banner_border`, `session_border` | `ui_border` | same value |
| `completion_menu_bg` | `status_bar_bg` | same value |
| `completion_menu_current_bg` | `ui_accent` → `status_bar_bg` | mix 18% |
| `completion_menu_meta_bg` | `status_bar_bg` | mix 6% toward `ui_text` |
| `completion_menu_meta_current_bg` | `ui_accent` → `status_bar_bg` | mix 26% |
| `voice_status_bg` | `status_bar_bg` | same value |
| `selection_bg` | `ui_accent` → `background` | mix 22% (light) / 30% (dark) |
| `ui_label` | `banner_dim` | same value |
| `status_bar_dim` | `banner_dim` | same value |
| `status_bar_strong` | `ui_text` | same value |
| `session_label` | `ui_accent` | same value |
| `prompt`, `shell_dollar` | `ui_text` / `ui_accent` | prompt = text, mark = accent |
| `ui_thinking` | `banner_dim` | same value |
| `ui_tool` | `ui_accent` | same value |
| `status_bar_good` | `ui_ok` | same value |
| `status_bar_warn` | `ui_warn` | same value |
| `status_bar_bad` | `ui_error` | same value |
| `status_bar_critical` | `ui_error` | mix 12% toward `ui_text` (heavier) |
| `syntax_comment` | `banner_dim` | same value |
| `syntax_keyword` | `ui_accent` | same value |
| `syntax_number` | `ui_accent` | mix 14% toward `ui_text` |
| `syntax_string` | `ui_ok` | same value |
| `diff_added` | `ui_ok` | same value |
| `diff_removed` | `ui_error` | same value |
| `diff_added_word` | `ui_ok` → `status_bar_bg` | mix 45% toward the surface |
| `diff_removed_word` | `ui_error` → `status_bar_bg` | mix 45% toward the surface |
| `response_border` | `ui_accent` → `status_bar_bg` | mix 55% |
| `input_rule` | `ui_accent` | same value |

**Overriding a derived key is allowed and sometimes right.** A skin that must match
an external syntax standard overrides the four syntax keys. A skin with a decorative
diff keeps its own tints. The rule is: *derive by default, override with a reason.*

---

## 6. Colour science

### 6.1 Work in a perceptual space

Use **OKLCH**: lightness `L` 0–1, chroma `C` ≥ 0, hue angle `h` 0–360. It is the
cylindrical form of Oklab, built so that equal steps in `L` look like equal steps in
brightness and equal steps in `h` look like equal changes of colour. CSS supports it
directly (`oklch(0.62 0.11 250)`), and `oklch.com` converts.

HSL is not a substitute. In HSL, yellow at `l=50%` reads far brighter than blue at
`l=50%`, so a palette built by stepping HSL lightness comes out visually lopsided —
the yellows shout and the blues sink. That is the single most common reason a
hand-built palette looks "off" without anyone being able to say why.

Our own catalogue confirms the asymmetry: measured over 94 skins, light canvases sit
at `L` 0.913–1.000 (median 0.974) with `C` ≤ 0.063, and dark canvases at `L` 0.000–
0.335 (median 0.209) with `C` ≤ 0.067. The hue is carried by the accent, not the
floor.

### 6.2 The ramp

Build one hue family, then take steps. A workable dark-to-light ramp:

| step | `L` | `C` multiplier | use |
|---|---|---|---|
| 0 | 0.16 | 0.45 | deepest surface |
| 1 | 0.21 | 0.55 | canvas |
| 2 | 0.26 | 0.65 | raised surface |
| 3 | 0.33 | 0.75 | hover |
| 4 | 0.55 | 1.00 | muted ink |
| 5 | 0.72 | 1.05 | accent (dark mode) |
| 6 | 0.93 | 0.55 | reading ink |

Two rules that prevent mud:

1. **Chroma falls off at both ends.** The lightest and darkest steps of a ramp hold
   less colour than the middle. A cream at `C = 0.12` turns yellow; a near-black at
   `C = 0.12` turns navy whether you wanted it or not.
2. **Hue shifts slightly, in one direction.** Shadows drift toward the cool side of
   the family, highlights toward the warm side, by 6–12°. More than that and the
   skin looks like two colours arguing. Apple's and Google's systems both do this,
   which is why their greys never look dead.

### 6.3 Elevation in the dark

Dark UIs read "lighter = closer to you", because a light source above the screen is
the metaphor the eye already accepts. So the raised surface must be *lighter* than
the canvas by a **visible** step: `L` + 0.025 to +0.05, or it will not separate.
Our catalogue's dark median gap between `background` (0.209) and `status_bar_bg`
(0.188) is **negative** — many skins do the opposite and rely on borders. Both work,
but pick one and be consistent; a skin that half-does elevation reads as a mistake.

Pure `#000` as a canvas flattens every shadow and makes a border the only tool you
have; pure `#fff` does the same in light mode and glares at 3 a.m. Use them as a
deliberate statement, not as a default.

### 6.4 Contrast

WCAG 2.1, which is what our gate measures:

| what | AA | AAA |
|---|---|---|
| body text | 4.5:1 | 7:1 |
| large text (≥ 24px, or ≥ 18.66px bold) | 3:1 | 4.5:1 |
| non-text UI (borders that convey state, focus rings, icons) | 3:1 | — |

Our gate uses **4.5** as the floor for any colour used as text (`MIN_CONTRAST_RATIO`
in the plugin). Measured over the catalogue: reading text sits at 6.0–21.0:1
(median 13.6). Quiet text (`banner_dim`) sits at 1.30–7.39:1 (median 5.2) — and
**44 of 94 skins fall below 4.5:1 in one mode**: 11 in light, 33 in dark, none in
both. That is a real defect, recorded in §12 and fixed per skin, not globally.

**Borders are the honest exception.** Our `ui_border` sits at 1.1–6.9:1 (median 1.4)
because it is a decorative seam, not a control boundary. The moment a border *is* the
control — an unfocused input, a selected card — it needs 3:1 against its neighbour.
Do not use the decorative border as the control border.

APCA is the successor model W3C is drafting. It weights by font size and polarity and
disagrees with WCAG precisely where WCAG is weakest: light text on dark grounds, and
mid-greys. Our gate stays on WCAG 2.1 because it is a settled standard with a
published threshold; where the two disagree, prefer the harsher one.

Accent as text vs accent as background are different jobs. A saturated accent that
passes 4.5:1 as a 2px underline will fail as a 14px label. If the accent must carry
text, darken it for light mode and lighten it for dark mode until it passes — our
catalogue already does this (accent `L` median 0.504 in light, 0.721 in dark).

### 6.5 Signals

Three rules:

1. **Green / amber / red are not enough.** Deuteranopia and protanopia collapse the
   red-green axis; the classic failure is a "success" green and an "error" red that
   are the same grey to ~8% of men. Separate them in **lightness** as well as hue:
   our catalogue does (dark mode `ui_ok` L 0.78, `ui_warn` 0.81, `ui_error` 0.68).
2. **Never let a signal be the accent.** If the accent is orange and `ui_warn` is
   orange, warnings become decoration.
3. **Never let a signal vibrate.** A saturated signal on a saturated accent
   background produces edge flicker. Signals live on surfaces, not on accents.

### 6.6 Traps

- **Grey mud.** Two neutrals picked independently in RGB differ in hue; the pair
  reads dirty. Derive them from one hue family.
- **The alias drift.** `banner_text` and `ui_text` that were chosen separately will
  diverge the first time one is edited. Derive the alias.
- **The neon accent on a dark canvas.** Chroma that looks right on a swatch glows at
  full-window scale. Check the accent on `background`, not in the picker.
- **The white selection.** A selection that is pure white on a light canvas is
  invisible. Tint it.

---

## 7. Typography

Two stacks, both required:

- `fontSans` — the reading font of the interface.
- `fontMono` — code, diffs, the prompt, anything where character width matters.

**The stack is a queue of promises.** First family that exists wins; the last entry
is a generic (`sans-serif`, `monospace`) so the page never falls back to the wrong
class. Quote every family with a space in it. Keep the stack short — three or four
families — because each one is a chance to render differently on someone else's
machine.

```yaml
typography:
  fontSans: '"Inter", "Segoe UI", system-ui, sans-serif'
  fontMono: '"JetBrains Mono", "Cascadia Code", Consolas, monospace'
```

**Pairing.** A UI sans and a code mono want different things. The sans wants a large
x-height and open apertures so 12px labels stay crisp. The mono wants unambiguous
glyphs (`0` vs `O`, `l` vs `1`) and a fixed advance so columns line up. A good pair
shares proportions without sharing a family — Inter + JetBrains Mono, Segoe UI +
Cascadia Code.

**Sizes.** The Desktop reads at 12–14px. Body 13px with 1.45 line height; labels
11–12px; code 12.5–13px. Never take a UI below 11px: contrast maths assumes you can
resolve the strokes, and at 10px the maths stops describing the experience.

**The editor offers a list, not a text box,** because a stack is a choice. The list
in `desktop/plugin.template.js` (`FONT_CHOICES_SANS`, `FONT_CHOICES_MONO`) is the
canonical set; a skin that carries something else appears as `Custom: <family>` and
is never silently rewritten.

---

## 8. Packs and categories

**Pack** = where the gallery shelves it. Six packs plus core:

| pack | holds | rule |
|---|---|---|
| `core` | 30 | the default shelf; the 30 skins a new user meets |
| `earth` | 11 | mineral, clay, moss, unbleached paper |
| `cyberpunk` | 11 | neon on darkness, high chroma, deliberate clash |
| `zen` | 11 | low chroma, paper, stone, tea |
| `retro` | 11 | terminal, 70s print, faded phosphor |
| `noir` | 10 | near-monochrome, one signal |
| `studio` | 10 | IDE themes: Nord, Gruvbox, Solarized, One, Ayu… |

Core is exactly 30 and every other pack 10–20; the gate enforces both, because a
pack of two is not a shelf.

**Category** = what the skin *is*, measured not chosen: the accent's OKLCH hue angle
in 11 sectors, with anything below `C = 0.04` collapsing into `neutral` — 12 cells in
all. The full rule, the rejected alternatives and the validation over the catalogue
are in `docs/RESEARCH/COLOUR-TAXONOMY.md`. Assign the category from the accent, never
from the mood.

---

## 9. Naming and description

- `name` — lowercase, hyphenated, stable. It is an id: users' overrides and favourites
  point at it. `dark-nord`, not `Nord (dark)`.
- `label` — what the gallery shows. Title case, short, unique in the catalogue.
- `description` — one line, comma-separated, factual. Name the colour and the
  temperature: *"Nord, arctic bluish calm"*. No "beautiful", no "modern".
- `energy` — `quiet | balanced | vivid`. A measured character, not a mood: how much
  the skin asks of the eye.
- `provenance` — where the palette came from (`source`, `derived`, `upstream`). Keep
  it truthful; it is the credit line.

---

## 10. Build recipe for an agent

1. **Read** §5 (the ten), §6.2 (the ramp), and one existing skin in the pack you are
   joining.
2. **Pick the room.** Decide mode-first: what is the floor, is it warm or cool, is
   the accent one colour or none. Write the ten surfaces in OKLCH.
3. **Convert** to hex with `oklch.com` or a script; keep a table of the ten so the
   arithmetic is auditable later.
4. **Derive** the rest with §5. Override only with a written reason.
5. **Check** the numbers: text ≥ 4.5:1 on `background` and on `status_bar_bg`; each
   signal distinguishable from the accent and from each other; `selection_bg`
   visible on both.
6. **Write** the file: `schema_version: 2`, `design_spec: v2`, both palettes,
   `typography`, `pack`, `category`, `energy`, `provenance`.
7. **Run** the gates:

```bash
python scripts/check-packs.py
pytest tests/test_skin_contract.py -q
python scripts/regenerate.py
node --test tests/*.test.mjs
hermes plugins validate .
```

8. **Look at it.** Open the editor on the new card in both modes. The gate cannot see
   that the accent vibrates or that the dim ink disappears at 12px.
9. **Commit** one skin per commit, with the ten-surface table in the message.

---

## 11. Acceptance gates

| gate | passes when |
|---|---|
| `check-packs.py` | both palettes present; one pack; one category; core = 30; other packs 10–20; ids and labels unique; both fonts; `energy` valid; `design_spec` ∈ {v1, v2}; a v2 skin carries all ten surfaces in both modes |
| `tests/test_skin_contract.py` | the catalogue declares a spec; v2 carries the ten; a v2 skin missing a surface is **rejected by name**; an unknown spec is rejected |
| `tests/*.test.mjs` | the plugin's own contract — cards, editor, packs, override payload |
| `hermes plugins validate .` | the package is loadable by the host |
| `rigour check --ci` | known-red, 24 violations recorded in `docs/REVIEWS/`; not a silent pass |

Contrast, as an advisory measure rather than a gate (five skins fail; see §12):

- reading text on `background` ≥ 4.5:1 — catalogue 6.0–21.0
- quiet text on `background` ≥ 4.5:1 — catalogue 1.30–7.39 (median 5.2); 44 skins miss
- accent as text ≥ 4.5:1

---

## 12. Known limits, stated

1. **44 of 94 skins put quiet text below 4.5:1 in one mode** — 11 in light (worst:
   `linen-sage` 1.98, `alabaster` 2.13, `rice-paper` 2.22), 33 in dark (worst:
   `single-malt` 1.30, `deep-void` 1.38, `brutalist-concrete` 1.39). No skin fails in
   both modes, which suggests a per-mode habit rather than a systemic error. They are
   v1: each is fixed when it is revised, and the fix is the skin's own, not a global
   rule that would flatten 94 deliberate choices.
2. **29 of the 43 keys do not repaint the Desktop window.** The CLI reads all 43. The
   editor marks those rows `CLI`. A user editing `syntax_comment` changes the CLI and
   nothing else; the badge is the honest answer.
3. **v1 skins carry 27–43 keys.** Inheritance fills the gaps at load. This is
   documented, not accidental, and it is why the v2 gate does not run backwards over
   the old catalogue.
4. **`design_spec` is a design contract, not a file format.** `schema_version: 2`
   describes the YAML; `design_spec` describes how much of the skin was decided.
5. **The gate checks presence, not taste.** Every number in §6 is guidance a human or
   an agent applies; only the ten-surface check is mechanical.

---

## Sources

- WCAG 2.1 — contrast minimums: <https://www.w3.org/TR/WCAG21/#contrast-minimum>,
  non-text contrast: <https://www.w3.org/TR/WCAG21/#non-text-contrast>
- OKLab / OKLCH, Björn Ottosson: <https://bottosson.github.io/posts/oklab/>
- OKLCH picker and conversion: <https://oklch.com>
- CSS Color 4, `oklch()`: <https://www.w3.org/TR/css-color-4/#ok-lab>
- APCA (draft): <https://w3c.github.io/APCA/>
- Our own measurements: `cache/scratch/measure.py` over `skins-v2/`, 2026-10-19.
