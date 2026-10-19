# Colour taxonomy for Chroma for Hermes

**Status:** proposal, measured against all 109 shipped skins.
**Inputs:** `docs/PALETTE-ANALYSIS.json` (generated from `desktop/plugin.js`), 109 cards × up to 6 signature roles × 2 modes.
**Companion:** `COLOUR-TAXONOMY.json` (the same rules as data, plus the 109 assignments).

---

## 1. The defect being fixed

The current 12 ids are not one taxonomy. They are four different axes wearing one list:

| current id | what it actually classifies |
|---|---|
| `orange`, `gold`, `violet` | hue |
| `minimal`, `pastels`, `vibrant`, `muted` | chroma / lightness character |
| `warm`, `cool`, `earth`, `nature` | temperature or material mood |
| `terminal` | medium / aesthetic reference |

The failure is not stylistic. A partition requires that the categories be mutually exclusive *by rule*. "Warm" and "gold" overlap in principle: an amber accent on a warm shell is both. So is "earth" and "muted". Because the categories are not disjoint by any measurable test, each skin's category today is an author's judgement call, and two people sorting the same 109 skins would not produce the same 12 buckets. That is the thing to fix: **one axis, one rule, one category per skin, no judgement in the assignment.**

## 2. Two axes, and why they are orthogonal

The taxonomy uses two OKLCH coordinates, and only two:

| axis | id | measures | levels |
|---|---|---|---|
| hue angle `h` | `hue` | the direction of the accent's (a,b) vector — *which* colour it is | 11 intervals |
| chroma `C` | `chroma_floor` | the radius from the neutral axis — *whether* it has a colour at all | 2 (below / at-or-above 0.04) |

OKLCH is the cylindrical form of Oklab: a lightness axis, a chroma radius, and a hue angle around it.[1][3] Oklab was designed to predict perceived lightness, chroma and hue, which is why an even step in `h` is a meaningful step and an even step in `C` is a meaningful distance from grey.[4]

The two axes are **orthogonal**: `C` is a radius scalar, `h` is an angle; moving along one leaves the other unchanged *by construction*. They are **complete** over the gamut because every OKLCH colour with `0 ≤ L ≤ 1`, `C ≥ 0`, `0 ≤ h < 360` has exactly one `(C, h)` pair.

Their cross product is 11 × 2 = 22 nominal cells, of which 11 are **unrealisable**: a colour below the chroma floor has no hue to classify, and the CSS specification says so directly — "<hue> components are the most common components to become powerless; any color sufficiently close to the central achromatic axis will have a powerless hue component."[1] An achromatic colour therefore collapses across all eleven hue intervals into a single cell. 22 − 11 = **12 realisable categories**. The count is a consequence of the axes, not a number chosen first and filled afterwards.

Note what is *not* an axis: lightness. Lightness in this catalogue encodes **mode**, not identity — light shells sit at L 0.91–1.00 (median 0.975) and dark shells at L 0.00–0.35 (median 0.207), for the same skins. Using it to split categories would sort skins by which mode the author drew first, which is exactly the kind of category error the current scheme makes with `minimal`/`vibrant`.

## 3. The partition

Each category is a half-open hue interval. The eleven cuts sit at the midpoint of an empty interval between two adjacent identity accents, so no cut bisects a cluster and none was hand-tuned: move a cut 2° either way and the assignment of all 109 skins is unchanged (verified for every cut).

| category | `h` from | `h` to | width | skins | nearest skin to `lo` | nearest skin to `hi` |
|---|---:|---:|---:|---:|---:|---:|
| red | 2.8 | 45.2 | 42.4° | 11 | 5.22° | 5.58° |
| orange | 45.2 | 58.5 | 13.3° | 5 | 5.58° | 3.55° |
| amber | 58.5 | 88.4 | 29.9° | 16 | 3.55° | 2.08° |
| yellow | 88.4 | 117.8 | 29.4° | 5 | 2.08° | 7.98° |
| green | 117.8 | 157.1 | 39.3° | 8 | 7.98° | 4.66° |
| jade | 157.1 | 178.0 | 20.9° | 3 | 4.66° | 9.97° |
| teal | 178.0 | 202.5 | 24.5° | 2 | 9.97° | 7.32° |
| azure | 202.5 | 227.3 | 24.8° | 2 | 7.32° | 9.99° |
| blue | 227.3 | 276.2 | 48.9° | 28 | 9.99° | 10.07° |
| violet | 276.2 | 319.9 | 43.7° | 10 | 10.07° | 8.46° |
| magenta | 319.9 | 2.8 (wraps) | 42.9° | 8 | 8.46° | 5.22° |
| achromatic | `C < 0.04` | — | — | 11 | — | — |

Union: `[2.8, 45.2) ∪ [45.2, 58.5) ∪ … ∪ [319.9, 2.8)` covers `[0, 360)` exactly once, with no gap and no overlap, because each interval is half-open and each one's `hi` is the next one's `lo`. Intersection: empty, for the same reason. Add the achromatic cell, which is disjoint from all eleven by the `C` gate, and every possible `(C, h)` lands in exactly one category.

Widths are deliberately unequal (13.3° to 48.9°). Hue naming is not uniform around the circle — the sRGB primaries and secondaries are not evenly spaced in OKLCH: red 29.2°, yellow 109.8°, green 142.5°, cyan 194.8°, blue 264.1°, magenta 328.4°. The yellow–green arc is 32.7° wide while the cyan–blue arc is 69.3°. Equal-width sectors would therefore cut through the middle of named families. This partition instead cuts where the *catalogue* is empty, which is what makes every skin unambiguous.

Most category names are anchored by a CSS named colour that falls inside the interval — crimson (20.1°) in red, goldenrod (84.0°) in amber, teal (194.8°) in teal, magenta (328.4°) in magenta; the hex values come from the named-colour table[2][6] and the angles are computed with the same conversion. Three are not keyword-anchored, and the JSON says so: `amber` and `jade` are conventional colour words with no CSS keyword at that hue, `achromatic` is the technical term, and CSS `azure` (#F0FFFF, h 196.9°) is a pale cyan lying in the jade/teal region rather than in this cell, whose actual anchors are powderblue (205.7°), lightblue (219.7°) and skyblue (225.8°). There, `azure` labels the cyan-leaning blues; it does not claim the keyword.

## 4. The rule

Evaluate in this order; the order is the tie-break.

1. **Pick the identity accent.**
   a. If exactly one mode is derived (`docs/DERIVED-PALETTES.md` names it), use the **authored** mode's `ui_accent`. A derived palette is a manufactured port; classifying by it would classify the generator.
   b. Otherwise use the accent with the **higher chroma**.
   c. On a tie, use the **dark** accent.
2. **Achromatic gate.** If the identity accent has `C < 0.04`, the category is `achromatic`. Stop.
3. **Hue sector.** Take `h mod 360` and select the single half-open interval above that contains it. A value exactly on a boundary belongs to the interval that starts there (`[lo, hi)`).

Reference implementation:

```python
SECTORS = [
    ("red", 2.8, 45.2), ("orange", 45.2, 58.5), ("amber", 58.5, 88.4),
    ("yellow", 88.4, 117.8), ("green", 117.8, 157.1), ("jade", 157.1, 178.0),
    ("teal", 178.0, 202.5), ("azure", 202.5, 227.3), ("blue", 227.3, 276.2),
    ("violet", 276.2, 319.9), ("magenta", 319.9, 2.8),
]

def category(accent_light, accent_dark, derived_mode=None):
    # accents are dicts {L, C, h}
    if derived_mode == "light":
        o = accent_dark
    elif derived_mode == "dark":
        o = accent_light
    elif accent_light["C"] > accent_dark["C"]:
        o = accent_light
    else:
        o = accent_dark
    if o["C"] < 0.04:
        return "achromatic"
    h = o["h"] % 360.0
    for name, lo, hi in SECTORS:
        if lo < hi and lo <= h < hi:
            return name
        if lo > hi and (h >= lo or h < hi):   # magenta wraps 0
            return name
    raise AssertionError("unreachable: sectors cover [0,360)")
```

The function is total (the final loop cannot fall through) and deterministic (no floating-point comparison depends on ties, because the boundaries sit in empty intervals).

## 5. Why eleven sectors and not twelve

The cut set is not free. There are 98 chromatic identity accents; the empty intervals between them, largest first, are:

20.2°, 20.1°, 20.0°, 16.9°, 16.0°, 14.7°, 13.7°, 13.6°, 12.2°, 11.3°, 10.5°, 9.3°, 8.0°, 7.3°, 7.2°, 7.1°, then 4.3° and a tail under 4°.

Nine of the eleven cuts used sit in intervals of 9.3° or more (the other two are the 7.2° orange/amber interval and the 4.3° amber/yellow one). The intervals that were available and are *not* used are the interesting part:

- **13.7° at 8.0°–21.8°** and **12.2° at 328.4°–340.5°** each isolate a single skin (`vibrant-sunset`, `neon-ghost`). A one-skin category is not a filter, so both are rejected.
- **13.6° at 129.6°–143.2°** splits green into a four-skin sage group and a four-skin green group. It is a perfectly defensible cut — but taking it would force amber and yellow back together, and the catalogue's amber (16) and yellow (5) cells are worth more to a picker than sage (4) and green (4).

That is the argument for eleven rather than twelve: **every remaining interval large enough to host a cut either creates a one-skin cell or destroys a cell worth keeping.** The 4.3° interval between `dark-pastel-buttercup` (86.2°) and `arcane-tome` (90.5°) is the narrowest cut in the scheme and the weakest claim in this document; it is what buys `amber` and `yellow` as separate chips rather than one 21-skin "gold" cell. If the product ever wants a more robust partition at the cost of granularity, merging amber and yellow is the first move, and it raises the minimum margin from 2.08° to 3.55°.

## 6. Why not a chroma or lightness character axis

The obvious alternative is hue × character (quiet / balanced / loud), which is what `muted` / `pastels` / `vibrant` were gesturing at. Two measurements say no:

1. **Chroma does not separate in this catalogue.** Identity-accent chroma runs 0.000 to 0.322 with a median of 0.126; it is one continuous population, not two. Any cut is a line through a dense region, unlike the hue cuts, which sit in intervals where no skin lives. In the 16-skin amber cell, chroma spans 0.063 to 0.173 without a break — the "quiet" and "loud" halves are not separable populations.
2. **A chroma threshold is not comparable across hues.** The maximum in-gamut chroma varies strongly with hue: the sRGB gamut is a triangle per hue slice with a cusp whose lightness and chroma depend on `h`.[5] A C = 0.15 accent is loud in blue and unremarkable in yellow-green. Any chroma-based category would therefore be hue-relative, i.e. a disguised second hue axis.

Lightness fails for a different reason, given in §2: it encodes mode.

Chroma still matters — it decides the `achromatic` cell — but it is a gate, not a partition.

## 7. Validation against the 109 skins

Every skin is assigned; `sum(counts) = 109`; every category is non-empty.

| category | n | skins |
|---|---:|---|
| blue | 28 | alabaster, aurora-boreal, baby-blue, blueprint, dark-ayu, dark-catppuccin, dark-charcoal, dark-github, dark-kanagawa, dark-mac, dark-material, dark-navy, dark-nord, dark-one, dark-pastel-powder-blue, dark-solarized, dark-tokyo-night, dark-vscode, daylight, forge-master, high-noon, nature-nordic, nous, poseidon, retro-blue, slate, slate-mist, stained-glass |
| amber | 16 | amber-terminal, charizard, dark-cozy-paper, dark-crimson, dark-gruvbox, dark-lcars, dark-pastel-buttercup, dark-vanilla, desert-neon, midnight-studio, nature-desert, netrunner, newsprint-noir, retro-amber, single-malt, typewriter-cream |
| red | 11 | ares, brutalist-concrete, dark-rosepine, dragon-blood, glitch-punk, peach-fuzz, red-alert, redwood, rice-paper, solar-flare, vibrant-sunset |
| achromatic | 11 | bone-white, dark-bone, graphite, liquid-silver, minimal-graphite, mono, obsidian, sisyphus, steel-thread, warm-ash, warm-parchment |
| violet | 10 | commodore-64, dark-aubergine, dark-dracula, dark-obsidian, dark-plum, deep-void, eclipse, lavender-dream, midnight, shadow-thief |
| green | 8 | cyberpunk, dark-everforest, dark-sage, green-screen, linen-sage, moss-stone, nature-forest, retro-terminal |
| magenta | 8 | chrome-rain, dark-pastel-cotton-candy, dusty-rose, neon-ghost, rose, vaporwave-mall, vibrant-synthwave, void-sunset |
| orange | 5 | dark-pastel-peach-blossom, ember, nature-autumn, sandstone, warm-lightmode |
| yellow | 5 | arcane-tome, black-canary, dark-lemon, enchanted-forest, white-flash |
| jade | 3 | dark-pastel-mint-sorbet, seafoam-silk, vibrant-neon |
| teal | 2 | hermes-teal, nature-ocean |
| azure | 2 | deep-ocean, vibrant-pacific |

**Coverage:** no empty categories. Largest `blue` (28, 26% of the catalogue); smallest `teal` and `azure` (2 each). The two thin cells are thin because the data is thin — the 188°–196° and 210°–217° clusters are real, separated by 15° and 10° of empty hue from their neighbours, but each contains only two skins. They are not artefacts of the rule, and merging them into a 4-skin "teal" cell would be the second robustness trade available after amber/yellow.

### 7.1 Agreement with the names

74 of the 109 skin names carry a colour word. Of those, **52 agree with the rule (70.3%)** and **22 disagree**; the other 35 names (`dark-nord`, `nous`, `poseidon`, `dark-github`, …) make no colour claim and are excluded rather than scored as either outcome. All 22 disagreements are listed in `hard_calls` in the JSON, with the measured `L/C/h`, the name's implication, the chosen category and a per-skin reason. They fall into six disjoint groups:

| group | n | skins | reading |
|---|---:|---|---|
| name describes the **shell**, accent is another hue | 5 | brutalist-concrete, dark-crimson, dark-obsidian, enchanted-forest, rice-paper | The accent is measured; the shell is not. `dark-crimson` is a red wall (#200608) with a gold accent (#E8B84A). |
| **neutral** name, chromatic accent | 4 | alabaster, chrome-rain, dark-charcoal, white-flash | The accent carries 0.107–0.218 chroma; the neutrality lives in the shell (`white-flash` is in fact pure yellow, #FFFF00). |
| **thematic** name, no chromatic claim in fact | 4 | aurora-boreal, charizard, midnight, void-sunset | "Midnight" is a mood; its accent is periwinkle at h 286.3. "Void-sunset" is hot pink at 340.5. |
| **adjacent family**, ≤ 8° from a cut | 5 | dark-pastel-buttercup, nature-ocean, peach-fuzz, solar-flare, warm-lightmode | Coral at 39.5° reads orange but is red-side; buttercup at 86.2° is 2.18° from the amber/yellow cut; ocean at 195.1° is CSS teal. |
| colour word used **loosely** / compound name | 3 | dark-rosepine, newsprint-noir, vibrant-sunset | Rose at 23.1° is crimson, not magenta; "newsprint" is sepia and "noir" is grey across the two modes; "sunset" at h 8.0 is pink-red. |
| sits on the **chroma gate** | 1 | warm-parchment | C 0.0365, i.e. 0.0035 below the floor. |

The most uncomfortable single result is `dark-crimson → amber`. It is reported rather than special-cased, because a rule with one exception is not a rule. If the product decides that shell hue should outrank accent hue, that is a different taxonomy and this document should be revised rather than patched.

## 8. Sensitivity

**Achromatic floor.** Changing `C < 0.04` to 0.02, 0.03, 0.05 or 0.06 changes the achromatic cell to 4, 6, **11**, **11** and 15 skins respectively. The assignment is identical at 0.04 and 0.05, so the rule sits on a plateau rather than a cliff; the first skins to enter above the plateau are `linen-sage` (0.052), `dark-pastel-powder-blue` (0.055), `slate-mist` (0.057) and `baby-blue` (0.059). `warm-parchment` (0.0365) is the boundary case on the other side.

**Identity accent.** Using the light accent unconditionally instead of step 1 moves 15 of 109 skins. Using the dark accent unconditionally moves 11. The three rules agree on the other ~85%, which is the useful finding: **accent hue is stable across modes** — median |Δh| between the two accents is 1.3° over the 96 skins where both are chromatic. The disagreements are concentrated in six skins whose two palettes genuinely have two different hues: `nous` (262.7° light / 69.4° dark), `dark-ayu` (58.5 / 237.3), `dark-crimson` (1.3 / 84.9), `dark-material` (182.4 / 264.3), `shadow-thief` (311.4 / 195.3), `vaporwave-mall` (194.8 / 347.1).

**Boundary movement.** The minimum margin from any skin to any cut is 2.08° (`arcane-tome` at 90.5° against the 88.4° cut); the median margin is 11.96°. Moving any cut by ±2° would change at most two skins.

## 9. Independence from the pack axis

`category` and `pack` are **different axes** and are independent: a skin has exactly **one** category and exactly **one** pack. Category answers "what colour is this skin"; pack answers "which curated bundle is it sold in". Nothing in this document assigns, implies or constrains a pack, and no pack membership was read while designing it.

The category names were checked against the five pack names — **Earth, Cyberpunk, Zen, Retro, Noir** — for collisions of word *and* meaning. There is no category named `earth`, `cyberpunk`, `zen`, `retro` or `noir`, and none that means the same thing under a different word: no `natural`, `earthy`, `monochrome`, `retro-*` or `cyber-*`. `achromatic` is the one that needed the check — it is a colorimetric term for "no hue", not a synonym for the Noir pack, and it is defined by a chroma threshold rather than by darkness or mood.

## 10. What happens to the old ids

Two old ids survive as hue categories with new, rule-based definitions: `orange` and `violet`. `gold` has no successor id — its hue band is now split between `amber` and `yellow` at the 88.4° cut. The nine character/mood/medium ids (`minimal`, `pastels`, `vibrant`, `muted`, `warm`, `cool`, `earth`, `nature`, `terminal`) have no successors, by design; that is the incoherence being removed. If character labels are wanted for browsing, they belong in a second, independent facet (e.g. a `voice` tag derived from chroma), not in this partition.

## 11. Verification and limitations

**Colour maths verified.** An independent OKLab implementation (Ottosson's M1/M2 matrices, sRGB EOTF) was written for this document and reproduces the published reference values for the sRGB primaries (red L 0.627955 / C 0.257683 / h 29.234; blue 0.452014 / 0.313214 / 264.052; white C 0.000).[4] Run over all 1,266 stored role colours in `PALETTE-ANALYSIS.json` (109 skins × up to 6 roles × 2 modes), it reproduces every stored L and C exactly and every hue to within 0.005°. The numbers this taxonomy is built on are therefore not taken on trust.

**What is asserted, not measured:** the 0.04 chroma floor (see `unverified` in the JSON); the choice of eleven sectors (a product constraint of twelve chips); the English names themselves; and the "name implies" labels, which are one reviewer's reading. No observer study was run.

**Not affected by the missing-role skins.** 14 skins lack a signature role (8 built-ins lack `status_bar_bg` and `banner_dim`; 7 lack `background` on one side). None of them lacks `ui_accent` — the only role this taxonomy reads — so all 14 are classified normally and none were skipped.

## Sources

1. W3C, *CSS Color Module Level 4* (Candidate Recommendation Draft, 9 October 2026) — cylindrical polar colour model, hue as an angle, and §4.4.1 "powerless" components: "any color sufficiently close to the central achromatic axis will have a powerless hue component". https://www.w3.org/TR/css-color-4/
2. W3C, *CSS Color Module Level 4*, §6.1 Named Colors — the reference hue names used to anchor each interval. https://www.w3.org/TR/css-color-4/#named-colors
3. MDN, *`oklch()`* — L is 0–1, C's minimum useful value is 0 and it does not exceed about 0.5 in practice, H is a hue angle. https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch
4. B. Ottosson, *A perceptual color space for image processing* (Oklab, 2020) — the space and its stated aim of predicting perceived lightness, chroma and hue. https://bottosson.github.io/posts/oklab/
5. B. Ottosson, *Gamut clipping* — the sRGB gamut as a triangle per hue slice with a hue-dependent cusp, hence chroma thresholds are not comparable across hues. https://bottosson.github.io/posts/gamutclipping/
6. CSS named-colour hex table used to compute the reference hues in §3 (machine-readable copy of the CSS Color 4 named colours). https://raw.githubusercontent.com/bahamas10/css-color-names/master/css-color-names.json
