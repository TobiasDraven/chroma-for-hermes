# Category names — twelve colour families for Chroma for Hermes

**Status:** proposal. Naming lane only; no code, tests, or thresholds changed here.
**Inputs read:** `docs/PALETTE-ANALYSIS.json` (109 skins, six signature roles, OKLCH).
**Companion:** `CATEGORY-NAMES.json` (machine-readable candidates, collisions, rejections).
**Date:** 2026-10-19.

Two axes, never merged:

| Axis | Source | Editable | Count |
|---|---|---|---|
| **Category** | measured from the palette by rule | no | 12 |
| **Pack** | curated by hand | yes | Earth, Cyberpunk, Zen, Retro, Noir, core |

A category name must therefore describe **colour behaviour** and nothing else. A pack name may describe a mood, a decade, a scene. The moment a category name sounds like a mood it starts competing with a pack, and the picker has two overlapping filters that users cannot tell apart.

---

## 1. What is wrong with the current twelve

Current ids: `minimal, pastels, vibrant, muted, earth, terminal, nature, warm, orange, gold, cool, violet`.

They are three different taxonomies in one row:

- **hue** — orange, gold, violet (3)
- **chroma/character** — pastels, vibrant, muted (3)
- **mood/provenance** — minimal, earth, terminal, nature (4)
- **temperature** — warm, cool (2)

That is not a partition, it is a pile. `pastels` overlaps `violet`; `vibrant` overlaps every hue; `warm` overlaps `orange`, `gold` and half of `earth`. Worse, `earth` duplicates the **Earth pack** on the other axis — the one collision that is unambiguous.

The test for a category set is simple: **every skin belongs to exactly one, and the name predicts the colour before you see the card.** Only a hue partition passes.

---

## 2. How the world actually names colour families

Fetched, not recalled. Each row: what the system does, what it teaches, what this proposal takes.

| System | What it does | Lesson | Taken |
|---|---|---|---|
| [ISCC–NBS](https://en.wikipedia.org/wiki/ISCC%E2%80%93NBS_system) | 13 basic categories: pink, red, orange, brown, yellow, **olive**, **yellow green**, green, blue, purple, white, gray, black; plus 16 intermediates (reddish orange, orange yellow, greenish yellow…) | The canonical defensible partition is **10 hue + 3 neutral**, and it already needs *both* `olive` and `yellow green` because that band is too wide for one name | 11 hue + 1 neutral; the olive/lemon split |
| [Munsell](https://en.wikipedia.org/wiki/Munsell_color_system) | 5 principal hues (R Y G B P) + 5 intermediates (YR GY BG PB RP), with value and chroma as separate axes | Hue, lightness and chroma are **orthogonal**; a name that fuses them (pastel, muted) destroys the orthogonality | hue-only categories; chroma handled by one neutral floor |
| [Pantone](https://www.pantone.com/color-of-the-year) | `PANTONE 11-4201 Cloud Dancer` — a number plus an evocative name, in fashion and print | Commercial systems pair a **plain identifier** with a **poetic name**; the poetic name is a product name, not a family name | plain families for categories; the poetry stays in the 109 skin names |
| [Japanese dentou-iro](https://en.wikipedia.org/wiki/Traditional_colors_of_Japan) | "Most names of colors originate from the names of plants, flowers, and animals" — 桜色 sakura-iro (cherry blossom), 紅梅色 kōbai-iro (red plum), 桃色 momo-iro (peach) | Object-nouns are the oldest and most translatable colour vocabulary: the referent does the explaining | the whole register: rose, persimmon, olive, lemon, fern |
| [Radix](https://www.radix-ui.com/colors/docs/palette-composition/scales) | Named 12-step scales — Gray, Mauve, Slate, Sage, Olive, and chromatic families, each with light/dark/alpha variants | UI systems name scales after **hues and materials**, and put light/dark in the variant, never in the name | no mode words; material nouns |
| [Tailwind](https://tailwindcss.com/docs/colors) | 22 hues + neutrals (slate, gray, zinc, neutral, stone, taupe, mauve, mist, olive) | The de-facto vocabulary of the web; using its words buys instant recognition — including its recent `olive` = grey-green neutral, a collision to manage | rose, amber, teal, indigo, violet, slate, olive |
| [Material 3](https://m3.material.io/styles/color/roles) | 26 *roles* (primary, surface, outline…), not hue families | Roles answer "where does it go", not "what colour is it" — a different axis from ours, and a reminder not to smuggle role words into families | rejected as a naming source |
| [CSS named colours](https://developer.mozilla.org/en-US/docs/Web/CSS/named-color) | ~148 names from `red` to `rebeccapurple` | The shared substrate: any name here is already understood by every frontend dev | teal, indigo, violet, magenta, olive |
| [Farrow & Ball](https://www.farrow-ball.com/paint-colours/elephants-breath) | 132 paints with names like *Elephant's Breath No.229*, *Mizzle*, *Dove Tale*, *Skimming Stone*; families stay plain ("Grey Paint Colours") | Paint brands put the whimsy in the **product** and keep the **family** plain — and their product names are exactly the untranslatable, two-word, moody things our categories must not be | the negative example that killed Sunset, Mist, Aurora |

Two conclusions:

1. **The defensible partition is hue families plus a neutral.** Every standards body lands there. Our twelve should be that, at a resolution fine enough for 109 skins.
2. **The register should be object-nouns** — the thing the colour is named after. It is the oldest tradition (dentou-iro), it survives translation because the object exists in every language, and it is concrete enough to be scanned on a chip.

---

## 3. The scheme

> **Twelve hue families. Each is named after an object whose colour is that hue. One of the twelve is the absence of hue.**

Measured on the **accent** (`ui_accent`) of the skin, in OKLCH. A skin has both a light and a dark palette, so the category is taken from the accent that carries the most chroma across the two modes; lightness is never a category input. Accents below a chroma floor belong to Slate regardless of hue.

The arcs below are **descriptive** — where the 109 accents actually sit — not prescribed cut points. The rules lane owns the thresholds and may move any boundary a few degrees. What the names commit to is the *order* and the *shape*: warm arc → yellow arc → green arc → cool arc → magenta arc → neutral.

---

## 4. The twelve

Counts are the real distribution from `PALETTE-ANALYSIS.json` (109 skins, accent with the higher chroma of the two modes).

| # | Name | Arc (OKLCH h) | Cards | Share | Must contain |
|---|---|---|---|---|---|
| 1 | **Rose** | 340–15 | 8 | 7.3% | cherry, dusty rose, coral-red, neon pink-red |
| 2 | **Persimmon** | 15–48 | 11 | 10.1% | vermilion, terracotta, salmon, neon orange |
| 3 | **Amber** | 48–72 | 10 | 9.2% | gold, brass, honey, cream-gold |
| 4 | **Olive** | 72–90 | 13 | 11.9% | khaki, dark yellow, warm cream-khaki |
| 5 | **Lemon** | 90–112 | 5 | 4.6% | chartreuse, acid yellow, near-white yellow |
| 6 | **Fern** | 112–150 | 7 | 6.4% | sage, moss, forest, pure green |
| 7 | **Teal** | 150–215 | 8 | 7.3% | seafoam, mint, cyan, deep ocean |
| 8 | **Cobalt** | 215–255 | 17 | 15.6% | sky, azure, navy, powder blue |
| 9 | **Indigo** | 255–280 | 13 | 11.9% | royal blue, ultramarine, blue-violet |
| 10 | **Violet** | 280–300 | 6 | 5.5% | purple, plum, twilight, lilac-grey |
| 11 | **Magenta** | 300–340 | 6 | 5.5% | fuchsia, orchid, aubergine, hot pink |
| 12 | **Slate** | chroma floor | 5 | 4.6% | mono, graphite, ash, bone |

**Shape check.** Largest bucket 17/109 = 15.6% (Cobalt) — a family, not a bucket. Smallest 5/109 = 4.6% (Lemon, Slate). Twelve names, no initial repeated (`R P A O L F T C I V M S`), no two names closer than one syllable apart in sound, every name one word, 4–9 characters.

**Why the cool side needs three names.** Blue through violet holds 44 of 109 skins (40%). A single "Blue" would be the bucket the brief warns about, so the cool arc is split where users already split it: blue (Cobalt), blue-violet (Indigo), purple (Violet), with Magenta on the far side of purple.

**Why the warm side needs five.** Rose → Persimmon → Amber → Olive → Lemon covers 47 skins across 340°–112°, a 130-degree arc where every 20 degrees changes what the colour *is*. Five names is the minimum that keeps each one honest.

---

## 5. Each name on trial

Format: **covers** · *precedent* · **failure mode if taken literally**.

### Rose — 340–15 · 8 cards
Covers cherry, dusty rose, coral-red, neon pink-red: `rose`, `dusty-rose`, `chrome-rain`, `vaporwave-mall`, `dark-pastel-cotton-candy`, `vibrant-synthwave`, `void-sunset`, `vibrant-sunset`.
*Precedent:* [Rose (color)](https://en.wikipedia.org/wiki/Rose_(color)) — "colour between red and magenta"; Tailwind ships `rose` as a full scale.
**Failure:** it promises pastel pink, but the bucket holds saturated reds. The vivid cards will look misfiled to anyone reading the name literally.

### Persimmon — 15–48 · 11 cards
Covers vermilion, terracotta, salmon, neon orange: `glitch-punk`, `dark-rosepine`, `dragon-blood`, `rice-paper`, `ares`, `red-alert`, `peach-fuzz`, `redwood`, `brutalist-concrete`, `solar-flare`, `warm-parchment`.
*Precedent:* [Shades of orange § Persimmon](https://en.wikipedia.org/wiki/Shades_of_orange) — an established named colour, not an invention.
**Failure:** the fruit reads muted-autumn; `glitch-punk` (C=0.254) is the loudest accent in the catalogue and sits inside it.

### Amber — 48–72 · 10 cards
Covers gold, brass, honey, cream-gold: `warm-lightmode`, `nature-autumn`, `dark-pastel-peach-blossom`, `sandstone`, `ember`, `dark-cozy-paper`, `newsprint-noir`, `charizard`, `dark-lcars`, `retro-amber`.
*Precedent:* Tailwind's [`amber`](https://tailwindcss.com/docs/colors) scale; amber as a resin colour in common use.
**Failure:** amber's own swatch is brighter and more yellow (~h84) than this arc, which is the *muted* warm gold. A colour-literate reviewer will say amber belongs one step clockwise. Accepted because the arc's members (ember, lcars, autumn) are what people call amber in practice.

### Olive — 72–90 · 13 cards
Covers khaki, dark yellow, warm cream-khaki: `nature-desert`, `netrunner`, `single-malt`, `amber-terminal`, `typewriter-cream`, `desert-neon`, `dark-gruvbox`, `dark-vanilla`, `midnight-studio`, `dark-crimson`, `dark-pastel-buttercup`, `obsidian`, `sisyphus`.
*Precedent:* [ISCC–NBS](https://en.wikipedia.org/wiki/ISCC%E2%80%93NBS_system) makes `olive` one of its 13 basics; [CSS](https://developer.mozilla.org/en-US/docs/Web/CSS/named-color) and [Radix](https://www.radix-ui.com/colors/docs/palette-composition/scales) both ship it.
**Failure:** Tailwind's newer `olive` is a grey-green *neutral*, so the web-trained eye expects desaturated green, not warm khaki. Olive also connotes low chroma, while `netrunner` (C=0.170) and `desert-neon` (C=0.171) are vivid.

### Lemon — 90–112 · 5 cards
Covers chartreuse, acid yellow, near-white yellow: `arcane-tome`, `black-canary`, `enchanted-forest`, `dark-lemon`, `white-flash`.
*Precedent:* [Lemon (color)](https://en.wikipedia.org/wiki/Lemon_(color)) — "shade of yellow"; the word is the standard acid-yellow referent.
**Failure:** "a lemon" means a defective unit in English — a quality word arriving through idiom, which the principles forbid. It is also the thinnest bucket (5 cards) and holds `white-flash` (L=0.97), which reads as off-white.

### Fern — 112–150 · 7 cards
Covers sage, moss, forest, pure green: `dark-everforest`, `moss-stone`, `dark-sage`, `linen-sage`, `green-screen`, `cyberpunk`, `nature-forest`.
*Precedent:* [Shades of green § Fern green](https://en.wikipedia.org/wiki/Shades_of_green) — a documented named colour; dentou-iro's plant-name principle.
**Failure:** fern is a muted leaf green, but `cyberpunk` (C=0.278) is the most saturated accent in the set. The name undersells the vivid end.

### Teal — 150–215 · 8 cards
Covers seafoam, mint, cyan, deep ocean: `retro-terminal`, `seafoam-silk`, `dark-pastel-mint-sorbet`, `vibrant-neon`, `hermes-teal`, `nature-ocean`, `graphite`, `deep-ocean`.
*Precedent:* [CSS named colour `teal`](https://developer.mozilla.org/en-US/docs/Web/CSS/named-color); Tailwind `teal` scale. The word itself is the duck's wing patch — an object-noun.
**Failure:** a 65-degree arc is the widest in the set. `deep-ocean` (210) and `graphite` (195) will look blue to someone expecting teal proper. This is the name doing the most work with the least precision.

### Cobalt — 215–255 · 17 cards
Covers sky, azure, navy, powder blue: `bone-white`, `vibrant-pacific`, `dark-ayu`, `poseidon`, `dark-solarized`, `nature-nordic`, `retro-blue`, `slate-mist`, `dark-navy`, `baby-blue`, `forge-master`, `dark-mac`, `dark-pastel-powder-blue`, `slate`, `dark-vscode`, `dark-charcoal`, `dark-nord`.
*Precedent:* [Cobalt blue](https://en.wikipedia.org/wiki/Cobalt_blue) — a pigment with a fixed hue identity.
**Failure:** cobalt implies a deep saturated pigment; the bucket includes `bone-white` (C=0.060) and `baby-blue`. Cobalt's own swatch (~h260) sits just past the arc's upper edge — the boundary with Indigo is the most sensitive cut in the set.

### Indigo — 255–280 · 13 cards
Covers royal blue, ultramarine, blue-violet: `aurora-boreal`, `high-noon`, `dark-tokyo-night`, `dark-github`, `stained-glass`, `blueprint`, `dark-catppuccin`, `nous`, `dark-one`, `daylight`, `dark-kanagawa`, `dark-material`, `alabaster`.
*Precedent:* Tailwind's [`indigo`](https://tailwindcss.com/docs/colors) scale sits at ~270, inside this arc.
**Failure:** CSS `indigo` is a purple (#4B0082, ~h302) and Tailwind's is blue-violet. A user who learned CSS will expect this arc to be Violet, and vice versa.

### Violet — 280–300 · 6 cards
Covers purple, plum, twilight, lilac-grey: `midnight`, `liquid-silver`, `dark-obsidian`, `deep-void`, `commodore-64`, `eclipse`.
*Precedent:* Tailwind's [`violet`](https://tailwindcss.com/docs/colors) (~293) sits inside the arc; CSS `violet` is the pale magenta of the same family.
**Failure:** violet is technically a spectral blue-violet; this arc is purple proper. CSS violet (#EE82EE) is pale magenta-leaning, so name and swatch disagree depending on which definition the user holds.

### Magenta — 300–340 · 6 cards
Covers fuchsia, orchid, aubergine, hot pink: `dark-dracula`, `lavender-dream`, `dark-plum`, `dark-aubergine`, `shadow-thief`, `neon-ghost`.
*Precedent:* [CSS `magenta`](https://developer.mozilla.org/en-US/docs/Web/CSS/named-color) (#FF00FF, ~h328, inside the arc); dentou-iro's dye-name tradition.
**Failure:** magenta is a printing ink at maximum chroma; half this bucket is deep and muted (`dark-plum`, `dark-aubergine`). The name over-promises intensity and under-describes the pinks.

### Slate — chroma floor · 5 cards
Covers the achromatic accents, hue irrelevant: `mono` (C=0.000), `dark-bone`, `minimal-graphite`, `steel-thread`, `warm-ash`.
*Precedent:* Tailwind `slate`, Radix `Slate` scale, [ISCC–NBS](https://en.wikipedia.org/wiki/ISCC%E2%80%93NBS_system) neutral categories (white/gray/black collapsed to one because a skin has both modes).
**Failure:** slate is a cool blue-grey while the bucket holds warm greys (`warm-ash`, `dark-bone`), so the name quietly makes the neutral category colder than its contents.

---

## 6. Collision check against the packs

The packs are a different axis, but they ship in the same picker, so any name that *sounds* like a pack makes the two filters look interchangeable. Severity: **blocks** (must rename) / **warns** (accept with a note) / **notes** (monitor).

| Collides with | Severity | Why |
|---|---|---|
| **Earth** (pack) | **warns** | Olive, Fern and weakly Persimmon share the natural-world vocabulary. They name hue, not mood, so the axes stay distinct — but `Fern` is the one word a user could read as a mood, and Earth-pack cards (nature-forest, moss-stone, sandstone) will be the ones filed under it. The category and the pack will visibly agree, which makes the second axis look redundant. |
| **Retro** (pack) | notes | Amber-on-black and teal CRT are the retro computing trope (`amber-terminal`, `retro-amber`, `retro-terminal`). No name duplicates Retro, but two categories sit inside its colour story. |
| **Cyberpunk** (pack) | notes | Magenta, Lemon and Teal are the neon triad (`glitch-punk`, `netrunner`, `neon-ghost`). Same overlap, same reason it is tolerable: hue ≠ scene. |
| **Noir** (pack) | notes | Slate is nearest to Noir's register — both dark and neutral. One is measured, one is curated. Accepted. |
| **Zen** (pack) | notes | Fern and Olive carry Zen's quiet-green signal. Accepted. |
| **core** (pack) | — | No candidate is a synonym of "core"; it is a provenance/default word, and the naming principles already ban provenance. |
| **Chroma** (product) | notes | The product name already occupies the colour-behaviour register. No candidate repeats it, but if the categories were called Chromatic/Saturated/Tinted the product name would stop meaning anything. Concrete nouns keep the distinction. |
| **`earth`** (existing category id) | **blocks** | Pre-existing defect, not introduced here: the current id `earth` is a straight duplicate of the Earth pack. This is the one collision that is already shipping. |
| **Tailwind `olive`** (external) | **warns** | External semantic drift: Tailwind's olive is a grey-green neutral, ours is warm khaki. Manageable, but the chip colour has to carry the meaning. |
| **Skins named `slate`, `rose`, `ember`** | notes | A category named Slate will contain a skin named Slate. Legal, mildly redundant. `ember` is one letter from Amber — which is precisely why Amber's warm neighbour could never be Ember. |
| **`violet`** (existing category id) | notes | The one name carried over unchanged. Deliberate — a hue word with no pack conflict — but the arc must shrink from the old catch-all to 280–300 or the word keeps its old meaning by accident. |

**Phone check.** Read the twelve aloud in order: Rose, Persimmon, Amber, Olive, Lemon, Fern, Teal, Cobalt, Indigo, Violet, Magenta, Slate. No two are confusable when heard once. That killed Ember (Amber) and would have killed Coral (Cobalt).

---

## 7. Rejected, with reasons

| Rejected | Why |
|---|---|
| **Ember** | Phonetic twin of Amber. In a filter row they are indistinguishable aloud. One had to go; Amber has the stronger precedent. |
| **Earthy / Terra / Terracotta / Clay / Soil** | Paraphrases of the Earth pack — the exact thing the brief bans. |
| **Noir** | Duplicate of the Noir pack. |
| **Cyber / Neon / Chrome** | Collide with Cyberpunk and imply intensity rather than hue. |
| **Retro / Zen** | Pack names; using them merges two deliberately separate axes. |
| **Pastel** | A chroma-and-lightness class, not a hue; implies light mode; one of the four character words this pass removes. |
| **Vibrant** | Intensity, not hue. Overlaps all twelve or empties itself. |
| **Muted** | Same failure inverted; belongs *inside* each category as a rule, not beside it. |
| **Minimal** | A style claim about the skin, not a measurement of its accent. No rule can derive it. |
| **Warm / Cool** | A temperature axis. Both span five or more categories, so either would be a contradictory second sort key. |
| **Gold** | Near-synonym of Amber with no reliable boundary; also a deprecated id, so keeping it blurs old and new taxonomies. |
| **Stone** | Lost to Slate: "stone" is an Earth-pack word and reads as material mood rather than a chroma floor. |
| **Brown** | ISCC–NBS has it, but in UI accents brown is darkened orange: it would steal muted warm cards from Persimmon and Amber and read as Earth. |
| **Chartreuse** | Ten letters, French liqueur etymology, routinely misspelt; fails translation and scan where Lemon passes. |
| **Garnet / Amethyst / Emerald / Sapphire / Citrine** | Coherent and pretty, but 3–4 syllables, jewellery-brand register, and several are not stable colour terms outside English. |
| **Sunset / Aurora / Dusk / Mist** | Scenes and times of day, not hue families; each names a gradient, and all four echo the Retro/Noir mood axis. |
| **Prism / Spectrum / Multi** | Describes *how many* hues a skin uses — a different axis that would cut across all twelve. |
| **Premium / Pro / Signature** | Quality claims. Forbidden. |
| **Taupe / Mauve** | Tailwind's low-chroma neutrals: ambiguous against Slate, hard to translate, and they describe greys the chroma floor already assigns to Slate. |

---

## 8. Migration from the current twelve

Only five of the old ids have a single successor. The other seven dissolve into several categories, which is the clearest evidence that the old set was not a partition.

| Old id | Becomes |
|---|---|
| `minimal` | Slate |
| `orange` | Persimmon |
| `gold` | Amber |
| `earth` | Olive / Amber (and retires the duplicate of the Earth pack) |
| `violet` | Violet (arc shrinks to 280–300) |
| `nature` | Fern / Olive |
| `terminal` | Lemon / Fern / Teal (phosphor colours spread across three) |
| `warm` | Rose / Persimmon / Amber |
| `cool` | Cobalt / Teal |
| `pastels` | all twelve (it was never a hue) |
| `vibrant` | all twelve |
| `muted` | all twelve |

---

## 9. Open questions for the rules lane

1. **Chroma floor.** Slate's boundary is the only non-hue rule in the set. At C < 0.05 the five achromatic skins fall out cleanly; at C < 0.08 it starts eating muted hues.
2. **Which mode.** This proposal measures the accent with the higher chroma of light/dark. If the rule instead uses light-mode only, `nous` (light C=0.26, dark C=0.04) moves from Cobalt to Slate. Nine skins diverge by more than 50° between modes, so the choice is not cosmetic.
3. **Cobalt/Indigo boundary.** The most sensitive cut — 17 and 13 cards sit either side of h255, and cobalt's own swatch is at ~260.
4. **Teal's width.** 150–215 is 65°, the widest arc. If it proves unstable, the nearest honest split is Teal / Cyan, but "Cyan" collides with Cobalt's initial and with nothing else, so it would need a different word.

---

## 10. Unverified

- **Pack membership per skin.** `PALETTE-ANALYSIS.json` reports `pack: ""` for all 109 cards, so every pack-collision judgement above is by name semantics, not by shared cards.
- **Translation.** Whether the twelve current ids are already translated anywhere in the product. The translation-survival claim is a judgement, not a test.
- **Radix chromatic names.** The fetched Scales page rendered only Gray, Mauve, Slate, Sage, Olive before truncating; the "named after hues and materials" claim is supported for the neutrals only.
- **Persimmon abroad.** The fruit is widely known; the colour term is not, outside English-speaking markets.
- **The cut points themselves.** The arcs describe where the 109 accents fall today. They are not prescribed thresholds.
