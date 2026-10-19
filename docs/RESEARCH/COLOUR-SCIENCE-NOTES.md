# Colour Science Notes

Working notes for Chroma's palettes and synthetic-light review: perceptual models, a
tonal ramp, dark-mode elevation, contrast, signals, typography and a pre-flight
checklist.

External claims carry a URL. Where a permitted source does not support a numeric
rule, the line says `UNVERIFIED`. "Measured" figures come from
`scripts/measure/measure-catalogue.py` over `skins-v2/` (94 skins at the time of
writing), which converts sRGB to Oklab/OKLCH and prints quantiles. Ranges marked
"target" are design guidance calibrated against those quantiles, not claims about
every shipped skin.

## 1. Perceptual models

### 1.1 OKLCH is the working model

OKLCH is the cylindrical form of Oklab: **L** is perceived lightness, **C** is chroma
and **h** is hue angle. Oklab was designed so equal numeric steps predict equal
perceived steps (<https://bottosson.github.io/posts/oklab/>). CSS Color 4 defines
`oklab()`/`oklch()` as device-independent coordinates, with L in 0–1, C from 0 and h
in degrees (<https://www.w3.org/TR/css-color-4/#oklab-lab>). The picker at
<https://oklch.com/> exposes the same axes.

- L: `0` (black) to `1` (diffuse white), number or percentage
  (<https://www.w3.org/TR/css-color-4/#oklab-lab>).
- C: `0` is neutral; usable sRGB chroma tops out around `0.3–0.4`, hue-dependent
  (<https://www.w3.org/TR/css-color-4/#oklab-lab>).
- h: `0–360°` (<https://oklch.com/>).

### 1.2 Why HSL is the wrong control

HSL is a convenience transform of sRGB, not a perceptual space. CSS Color 4 calls it
"more intuitive to use, but still maps easily back to RGB colors"
(<https://www.w3.org/TR/css-color-4/#the-hsl-notation>). Two consequences:

1. **Equal HSL lightness is not equal perceived lightness.** At the same nominal
   HSL lightness, sRGB blue is `oklch(0.452 0.313 264.1)` and yellow is
   `oklch(0.968 0.211 109.8)` — yellow is more than twice as light perceptually
   (<https://www.w3.org/TR/css-color-4/#the-hsl-notation>).
2. **Equal HSL hue steps are not equal perceived steps.** `hsl(220) -> hsl(250)` and
   `hsl(50) -> hsl(80)` both move 30° but look very different in size of change
   (<https://www.w3.org/TR/css-color-4/#the-hsl-notation>).

The Oklab announcement shows the same failure for HSV: a constant-value,
constant-saturation hue sweep has clear lightness differences, with yellow, magenta
and cyan much lighter than red and blue
(<https://bottosson.github.io/posts/oklab/>). Nudging HSL `l` therefore produces an
uneven ramp even when the numbers are evenly spaced.

### 1.3 OKLCH ranges for UI roles

These ranges bracket the medians measured over `skins-v2/` (94 skins). The measured
medians are quoted so the range can be re-derived rather than trusted.

| Role | Mode | L target | C target | h target | Measured median (L / C) |
|---|---|---:|---:|---|---|
| Dark UI canvas | dark | 0.17–0.22 | 0.000–0.020 | family ±10° | 0.209 / 0.016 |
| Dark panel surface | dark | 0.21–0.26 | 0.010–0.030 | family ±8° | n/a (no panel key) |
| Dark body text | dark | 0.90–0.94 | 0.000–0.020 | family or 0 | 0.909 / 0.021 |
| Dark muted text | dark | 0.62–0.70 | 0.020–0.040 | family ±6° | 0.627 / 0.040 |
| Dark accent | dark | 0.62–0.75 | 0.120–0.180 | 20–300° | 0.721 / 0.112 |
| Light UI canvas | light | 0.960–0.985 | 0.003–0.010 | family ±10° | 0.974 / 0.007 |
| Light panel surface | light | 0.930–0.960 | 0.005–0.015 | family ±8° | 0.945 / 0.012 (status bar) |
| Light body text | light | 0.240–0.320 | 0.000–0.020 | family or 0 | 0.272 / 0.013 |
| Light muted text | light | 0.500–0.560 | 0.010–0.030 | family ±6° | 0.502 / 0.018 |
| Light accent | light | 0.450–0.580 | 0.100–0.160 | 20–300° | 0.504 / 0.102 |

- **Canvas** stays low-chroma so content, not the shell, carries colour.
- **Panel surface** sits above canvas in dark mode and below it in light mode (§3).
- **Body text** is near-neutral; a strong tint reads as coloured text, not text.
- **Muted text** is the first failure surface. The light median is only 0.502 L,
  leaving little room before 4.5:1 is lost.
- **Accent** is the only high-chroma role. The measured medians (C 0.102 light,
  0.112 dark) sit below the target midpoint; a strong accent should aim at C
  0.13–0.16, not at the catalogue median.

Only the medians are facts about the catalogue, and they are cited to the
measurement script, not to memory.

## 2. Tonal ramp

### 2.1 Ten steps from one family

A ramp is a set of related surfaces, not ten unrelated tokens. Start with family hue
`h_f` and chroma scale `C_f`, then generate these steps. The dark table is primary;
the light table mirrors it with lightness reversed.

**Dark ramp (target values, one family):**

| # | Step | L | C | Hue | Notes |
|---:|---|---:|---:|---|---|
| 1 | canvas | 0.170 | 0.012 | h_f | lowest surface |
| 2 | surface | 0.205 | 0.016 | h_f + 4° | +0.035 L |
| 3 | surface-raised | 0.240 | 0.020 | h_f + 6° | +0.035 L |
| 4 | hairline | 0.330 | 0.022 | h_f + 8° | boundary, not text |
| 5 | selection | 0.265 | 0.030 | h_f + 10° | separate from 1 and 2 |
| 6 | muted ink | 0.660 | 0.035 | h_f + 6° | secondary text |
| 7 | body ink | 0.920 | 0.012 | h_f + 2° | primary text |
| 8 | signal ok | 0.780 | 0.130 | 148° | semantic, not family |
| 9 | signal warn | 0.820 | 0.120 | 78° | semantic, not family |
| 10 | signal error | 0.680 | 0.160 | 28° | semantic, not family |

**Light ramp (mirror):**

| # | Step | L | C | Hue | Notes |
|---:|---|---:|---:|---|---|
| 1 | canvas | 0.980 | 0.006 | h_f | highest surface |
| 2 | surface | 0.955 | 0.010 | h_f − 4° | −0.025 L |
| 3 | surface-raised | 0.930 | 0.014 | h_f − 6° | −0.025 L |
| 4 | hairline | 0.870 | 0.016 | h_f − 8° | boundary, not text |
| 5 | selection | 0.900 | 0.024 | h_f − 10° | separate from 1 and 2 |
| 6 | muted ink | 0.530 | 0.025 | h_f − 6° | secondary text |
| 7 | body ink | 0.270 | 0.012 | h_f − 2° | primary text |
| 8 | signal ok | 0.530 | 0.100 | 148° | semantic, not family |
| 9 | signal warn | 0.560 | 0.110 | 78° | semantic, not family |
| 10 | signal error | 0.520 | 0.150 | 28° | semantic, not family |

The ramp is ordered by role, not by L: hairline is a low-emphasis boundary, while
muted text must stay readable.

### 2.2 Chroma falloff at the ends

Cap chroma at the lightest and darkest ends, because sRGB cannot hold high chroma
near white or black without clipping, and a high-chroma near-black looks like
coloured ink rather than a surface
(<https://www.w3.org/TR/css-color-4/#oklab-lab>).

- At `L >= 0.960`, cap C at `0.010`.
- At `L <= 0.150`, cap C at `0.014`.
- Between the ends, scale family chroma smoothly, for example
  `C = C_f * min(1, (L / 0.15), ((1 - L) / 0.04))`, then clamp to the role cap.
- At the very ends, multiply by `0.35` before clamping. This is the falloff an agent
  should be able to point at in code.

### 2.3 Hue drift: 6–12°

A ramp that keeps one exact hue reads flat; a ramp that drifts more than about 12°
reads as two families fighting.

- Dark mode: rotate `+6°` to `+12°` from canvas toward the family's cool side as L
  rises, so shadows do not go muddy.
- Light mode: rotate `−6°` to `−12°` as L falls, so the lightest surface does not
  read as a blue cast.
- Never drift more than `12°` between canvas and hairline; the table above uses a
  10° total drift.

The 6–12° band is a design rule, not a measured law. It is consistent with the
cylindrical hue axis (<https://www.w3.org/TR/css-color-4/#oklab-lab>) and with HSL's
perceptually uneven hue steps
(<https://www.w3.org/TR/css-color-4/#the-hsl-notation>), but the specific band is
`UNVERIFIED` as an empirical threshold.

### 2.4 Mix percentages, not alpha

Build ramp steps by mixing opaque OKLCH colours, not `rgba()` over an assumed
backdrop.

1. **Alpha is compositing, not a colour.** CSS Color 4 defines an alpha channel that
   is composited with the backdrop
   (<https://www.w3.org/TR/css-color-4/#alpha-channel>). The rendered result depends
   on what is behind the surface, so the same token has different contrast on canvas,
   panel and selection.
2. **Contrast is defined on the final rendered pair.** WCAG's ratio uses the relative
   luminance of the rendered colours
   (<https://www.w3.org/TR/WCAG21/#dfn-relative-luminance>); an alpha token has no
   single ratio to test.
3. **Perceptual interpolation is stable.** CSS Color 4 defines interpolation in a
   chosen colour space (<https://www.w3.org/TR/css-color-4/#interpolation>); an OKLCH
   mix keeps hue and lightness monotonic, an sRGB alpha blend does not.
4. **The backend accepts only opaque hex.** `_hex` in `dashboard/plugin_api.py:397`
   coerces to `#rrggbb` and rejects anything else. Mix at build time, then emit the
   resolved hex.

Use percentages (for example `70% canvas / 30% family`) as generator input and ship
the opaque result. Do not write `#rrggbbaa`.

## 3. Dark-mode elevation

### 3.1 Lighter means closer

Apple's HIG states that dark-mode "base" backgrounds are dimmer and "elevated"
backgrounds are brighter, so foreground interfaces appear to advance
(<https://developer.apple.com/design/human-interface-guidelines/dark-mode>). Material
3 shows elevation with a surface fill and tone difference rather than a shadow
(<https://m3.material.io/styles/elevation/overview>), and its surface roles are
tone-based, explicitly not tied to elevation levels
(<https://m3.material.io/styles/color/system>). The rule: **a surface visually closer
to the user is lighter in dark mode and darker in light mode.**

### 3.2 Quantify the gap

A gap below about `0.025` in OKLCH L is hard to see on a dim laptop panel; above
about `0.050` a panel looks like a separate window rather than a layer.

| Relationship | Target ΔL (dark) | Target ΔL (light) |
|---|---:|---:|
| canvas -> surface | +0.025 to +0.040 | −0.020 to −0.030 |
| surface -> raised | +0.025 to +0.040 | −0.020 to −0.030 |
| canvas -> selection | +0.035 to +0.050 | −0.030 to −0.045 |
| canvas -> hairline | +0.100 to +0.180 | −0.080 to −0.120 |

Measured by `scripts/measure/measure-catalogue.py`:

- dark canvas median L `0.209`, status bar `0.188` (the status bar is *recessed*, not
  elevated, in this sample);
- dark selection median L `0.266` where the key exists (34 dark skins), about
  `+0.057` over canvas — slightly above the target band;
- dark border median L `0.395`, about `+0.186` over canvas — a hairline, not a
  surface;
- light canvas `0.974`, status bar `0.945` (`−0.029`), border `0.861` (`−0.113`).

The medians support the direction of the rule but are not a clean elevation ladder:
`status_bar_bg` is darker than canvas, and `selection_bg` is missing from most skins
(88 light, 60 dark). The ramp in §2 is the additive fix.

### 3.3 Why pure #000 and #fff miss

- **#000 leaves no headroom below.** A recessed surface cannot be darker than black,
  so the "further away" direction is lost, and text sits at the extreme end of the
  contrast curve where APCA notes WCAG's 4.5:1 can be "functionally unreadable when a
  color is near black"
  (<https://git.apcacontrast.com/documentation/APCAeasyIntro>).
- **#fff leaves no headroom above.** HIG advises softening white backgrounds in dark
  mode so they do not glow against the surrounding context
  (<https://developer.apple.com/design/human-interface-guidelines/dark-mode>), and a
  white canvas has no lighter surface for a raised panel.
- **Pure endpoints make hairlines expensive.** A hairline one or two L steps from
  #fff is still nearly white; reaching 3:1 for an interactive boundary then requires
  a large jump that reads as a heavy rule
  (<https://www.w3.org/TR/WCAG21/#non-text-contrast>).

Use `L 0.14–0.22` for a dark canvas and `L 0.94–0.985` for a light canvas. Those
bounds are design targets; the external claims they protect are headroom and
near-black readability.

## 4. Contrast

### 4.1 WCAG 2.1 figures

WCAG 2.1 SC 1.4.3 (AA) requires **4.5:1** for normal text and **3:1** for large-scale
text (<https://www.w3.org/TR/WCAG21/#contrast-minimum>). "Large-scale" is at least
**18 point** or **14 point bold**
(<https://www.w3.org/TR/WCAG21/#dfn-large-scale>). SC 1.4.6 (AAA) raises those to
**7:1** and **4.5:1** (<https://www.w3.org/TR/WCAG21/#contrast-enhanced>). SC 1.4.11
(AA) requires **3:1** against adjacent colours for UI components, states and
graphical objects (<https://www.w3.org/TR/WCAG21/#non-text-contrast>).

The ratio is computed from relative luminance, not OKLCH L
(<https://www.w3.org/TR/WCAG21/#dfn-relative-luminance>). A ΔL of `0.05` does not map
to a fixed ratio; convert to sRGB and compute, or measure the rendered pair.

### 4.2 APCA differences

APCA (Accessible Perceptual Contrast Algorithm) is the candidate replacement
described by its authors. Its differences from WCAG 2.x are material:

- it reports **Lc** on `0` to `±106`, not a ratio;
- it is **polarity-sensitive**: negative Lc means text is lighter than the
  background, positive means darker;
- it is **luminance-weighted and spatially aware**: font size, weight and line
  thickness change the required Lc;
- published levels are `Lc 90` preferred for body text at `14px/400`, `Lc 75`
  minimum for `18px/400`, and `Lc 60` for non-body content at `24px/400` or
  `16px/700`;
- the same page states WCAG's 4.5:1 "can be functionally unreadable when a color is
  near black" and that WCAG 2.x "cannot provide useful guidance when designing dark
  mode".

All five points: <https://git.apcacontrast.com/documentation/APCAeasyIntro>. APCA is
not a WCAG 2.1 success criterion. Report both where possible: WCAG as the conformance
gate, APCA as the design warning.

### 4.3 Accepted limits of contrast maths

- **Decorative colour is excluded.** SC 1.4.3 exempts pure decoration, incidental
  text and logotypes (<https://www.w3.org/TR/WCAG21/#contrast-minimum>). A ratio
  applied to a decorative fill proves nothing.
- **Hue and colour-vision deficiency are not modelled.** SC 1.4.1 requires colour
  not be the only visual means
  (<https://www.w3.org/TR/WCAG21/#use-of-color>). The Understanding document adds
  that a lightness difference producing 3:1 counts as an additional distinction,
  using light green versus dark red as the example
  (<https://www.w3.org/WAI/WCAG21/Understanding/use-of-color>).
- **A single ratio is not a blanket target.** APCA says "no single figure (such as
  4.5:1 or 3:1) is useful as a blanket target" without considering use case, size and
  thickness (<https://git.apcacontrast.com/documentation/APCAeasyIntro>).
- **Contrast does not prove readability.** APCA separates spot-reading contrast from
  fluent readability contrast
  (<https://git.apcacontrast.com/documentation/APCAeasyIntro>).

### 4.4 What our catalogue measures

From `scripts/measure/measure-catalogue.py` over 94 skins:

| Measure | Light median (min) | Dark median (min) |
|---|---|---|
| text on background | 13.64 (6.04) | 13.49 (6.19) |
| dim text on background | 5.39 (4.50) | 4.85 (4.50) |
| border on background | 1.40 (1.10) | 1.60 (1.15) |

- Body text clears AAA (7:1) at the median and still clears AA at the minimum.
- Muted text now clears the floor: light minimum `4.50`, dark minimum `4.50` (fixed
  2026-10-19; they were `1.98` and `1.30`), and the medians clear AA. A theme with
  muted text below 4.5:1 is unfinished.
- Hairlines are decorative at the median (`1.40`, `1.60`, below 3:1). Acceptable for
  a separator, not for a control boundary or focus ring, which must reach 3:1
  (<https://www.w3.org/TR/WCAG21/#non-text-contrast>).

## 5. Signals

### 5.1 Hue and lightness separation

Signals are semantic and do not follow the family hue.

| Signal | Hue | Dark L | Dark C | Light L | Light C |
|---|---:|---:|---:|---:|---:|
| ok | 148° | 0.780 | 0.130 | 0.530 | 0.100 |
| warn | 78° | 0.820 | 0.120 | 0.560 | 0.110 |
| error | 28° | 0.680 | 0.160 | 0.520 | 0.150 |

Hue separations are ok–warn `70°`, warn–error `50°`, ok–error `120°`; the minimum is
`50°`, enough to keep three small dots nameable without relying on memory alone.
Dark lightness gaps are ok–warn `0.040`, warn–error `0.140`, ok–error `0.100`. The
ok–error gap matters most because those are the two states most likely confused under
red-green colour-vision deficiency.

Measured medians are close to target in dark mode (ok `0.780`, warn `0.806`, error
`0.678`) but not in light mode (ok `0.530`, warn `0.557`, error `0.517`). The light
ok–error gap is only `0.013` L, so hue is doing almost all the work — the weakest
point in the current catalogue (`scripts/measure/measure-catalogue.py`).

### 5.2 Colour-vision deficiency

Deuteranopia and protanopia both reduce separation along the red-green axis. The
physiological detail is outside this note's permitted sources, so that specific claim
is `UNVERIFIED`. The design consequence is not optional: SC 1.4.1 requires a
non-colour means of conveying the information
(<https://www.w3.org/TR/WCAG21/#use-of-color>), and the Understanding document
accepts a 3:1 lightness difference as that additional means
(<https://www.w3.org/WAI/WCAG21/Understanding/use-of-color>).

Target: keep the ok–error L gap at `>= 0.08` dark and `>= 0.06` light, and always ship
an icon or text label with the colour. The current light catalogue (`0.013`) fails
that target and should be corrected rather than excused.

### 5.3 No vibration

"Vibration" is the shimmer from two saturated, near-equal-lightness complementary
colours edge to edge. Avoid it by:

- not placing error red directly against ok green at equal L;
- keeping at least `0.08` L between adjacent signal fills;
- giving each signal a neutral gap or icon between it and its neighbour.

The perceptual mechanism is `UNVERIFIED` against the permitted sources; the
measurable part is the `0.08` L gap and the 3:1 non-text requirement
(<https://www.w3.org/TR/WCAG21/#non-text-contrast>).

## 6. Typography

Pair one humanist sans for prose and UI labels with one mono for code, diffs and
numeric columns. They should share a similar x-height and stroke contrast, or code
looks larger/heavier than prose at the same pixel size.

Apple's HIG recommends readable default and minimum sizes per platform (macOS:
`13 pt` default, `10 pt` minimum) and warns that thin custom weights need larger
sizes (<https://developer.apple.com/design/human-interface-guidelines/typography>).
For this desktop UI:

- **Reading size:** `13 px` default, `12 px` floor, `14 px` for long-form or
  documentation panes.
- **Line height:** `1.45` for dense chrome; `1.5` for body blocks, matching the
  line-spacing figure in WCAG 1.4.12
  (<https://www.w3.org/TR/WCAG21/#text-spacing>).
- **X-height:** match mono to sans within about `5%`. The tolerance is `UNVERIFIED`;
  the HIG's legibility guidance is the external support for testing custom fonts at
  the sizes actually used
  (<https://developer.apple.com/design/human-interface-guidelines/typography>).

A stack is a prioritized list; the user agent iterates until it finds an available
family containing the glyph
(<https://www.w3.org/TR/css-fonts-4/#font-family-prop>). Three rules:

1. **Quote names with spaces or punctuation.** CSS Fonts 4 requires such names to be
   quoted or written as identifiers; `"IBM Plex Mono"` is the safe form
   (<https://www.w3.org/TR/css-fonts-4/#font-family-name-syntax>).
2. **Put the generic family last.** The spec encourages a final generic family for
   robustness and notes that generic keywords cannot be quoted
   (<https://www.w3.org/TR/css-fonts-4/#font-family-prop>).
3. **Budget for a missing family.** If the first family is absent the next is used,
   and its metrics can change line breaks, truncation and apparent code size. The
   fallback is not a no-op
   (<https://www.w3.org/TR/css-fonts-4/#font-family-prop>).

Recommended shape:

```css
font-family: "Segoe UI", -apple-system, system-ui, sans-serif;
font-family: "IBM Plex Mono", "Cascadia Mono", Consolas, monospace;
```

The repository's defaults already follow this shape; the point is that the generic
fallback is deliberate, not decorative.

## 7. Synthetic-light checklist

Run these before calling a theme finished. "Measure" means compute from the resolved
hex values, not eyeball them.

1. **Canvas/text ratio.** Light and dark body text are `>= 4.5:1` against their own
   canvas; stretch target `>= 7:1`
   (<https://www.w3.org/TR/WCAG21/#contrast-minimum>,
   <https://www.w3.org/TR/WCAG21/#contrast-enhanced>).
2. **Panel/canvas separation.** At least one non-canvas surface differs from canvas
   by `ΔL >= 0.025` and `<= 0.050`, in the correct direction for the mode
   (<https://developer.apple.com/design/human-interface-guidelines/dark-mode>).
3. **Accent presence in both modes.** Accent L is `0.45–0.58` light and `0.62–0.75`
   dark, C is `>= 0.10`, and accent/surface is `>= 3:1` for UI or `>= 4.5:1` when the
   accent carries text (<https://www.w3.org/TR/WCAG21/#non-text-contrast>).
4. **Signal presence.** ok, warn and error exist in both modes, with hue separation
   `>= 40°`, ok–error L gap `>= 0.08` dark / `>= 0.06` light, and an icon or text
   label in addition to colour (<https://www.w3.org/TR/WCAG21/#use-of-color>).
5. **Selection visibility.** Selection differs from canvas and the nearest surface by
   `ΔL >= 0.035` or `ΔC >= 0.020`; selected text stays `>= 4.5:1`
   (<https://www.w3.org/TR/WCAG21/#contrast-minimum>).
6. **Focus ring visibility.** Ring reaches `>= 3:1` against both inner and outer
   adjacent colours, and is at least `2 px` thick
   (<https://www.w3.org/TR/WCAG21/#non-text-contrast>).
7. **Code comment legibility.** Muted/comment text on the code surface is `>= 4.5:1`;
   the catalogue's `banner_dim` minimum is the warning sign
   (`scripts/measure/measure-catalogue.py`).
8. **Diff pair distinguishable.** Added and removed backgrounds separate by
   `ΔL >= 0.08` or a `3:1` lightness ratio, not hue alone
   (<https://www.w3.org/WAI/WCAG21/Understanding/use-of-color>).
9. **Hairline discipline.** Decorative separators are `>= 1.3:1`; interactive
   boundaries and focus rings are `>= 3:1`. Do not use one token for both
   (<https://www.w3.org/TR/WCAG21/#non-text-contrast>).
10. **No pure endpoints.** Canvas L is `0.14–0.22` dark and `0.94–0.985` light; no
    `#000000` or `#ffffff` canvas
    (<https://developer.apple.com/design/human-interface-guidelines/dark-mode>).
11. **Ramp integrity.** Ten ordered steps, hue drift `6–12°`, chroma falling to
    `<= 0.010` at the light end and `<= 0.014` at the dark end
    (<https://www.w3.org/TR/css-color-4/#oklab-lab>).
12. **Stack integrity.** Both stacks are quoted where needed, end in a generic family,
    and mono x-height is within `5%` of sans
    (<https://www.w3.org/TR/css-fonts-4/#font-family-prop>).

If a statement cannot be measured from the emitted hex, it is not finished.

## Sources

External sources above, fetched and checked on 2026-10-19:

1. WCAG 2.1, Contrast (Minimum) — <https://www.w3.org/TR/WCAG21/#contrast-minimum>
2. WCAG 2.1, Contrast (Enhanced) — <https://www.w3.org/TR/WCAG21/#contrast-enhanced>
3. WCAG 2.1, Non-text Contrast — <https://www.w3.org/TR/WCAG21/#non-text-contrast>
4. WCAG 2.1, Use of Color — <https://www.w3.org/TR/WCAG21/#use-of-color>
5. WCAG 2.1, Text Spacing — <https://www.w3.org/TR/WCAG21/#text-spacing>
6. WCAG 2.1, large-scale text definition — <https://www.w3.org/TR/WCAG21/#dfn-large-scale>
7. WCAG 2.1, relative luminance definition — <https://www.w3.org/TR/WCAG21/#dfn-relative-luminance>
8. Understanding WCAG 2.1, Use of Color — <https://www.w3.org/WAI/WCAG21/Understanding/use-of-color>
9. CSS Color 4, Oklab and OkLCh — <https://www.w3.org/TR/css-color-4/#oklab-lab>
10. CSS Color 4, HSL — <https://www.w3.org/TR/css-color-4/#the-hsl-notation>
11. CSS Color 4, alpha — <https://www.w3.org/TR/css-color-4/#alpha-channel>
12. CSS Color 4, interpolation — <https://www.w3.org/TR/css-color-4/#interpolation>
13. Oklab announcement — <https://bottosson.github.io/posts/oklab/>
14. OKLCH picker — <https://oklch.com/>
15. APCA easy introduction — <https://git.apcacontrast.com/documentation/APCAeasyIntro>
16. Apple HIG, Dark Mode — <https://developer.apple.com/design/human-interface-guidelines/dark-mode>
17. Apple HIG, Typography — <https://developer.apple.com/design/human-interface-guidelines/typography>
18. Material 3, Color roles — <https://m3.material.io/styles/color/roles>
19. Material 3, Color system — <https://m3.material.io/styles/color/system>
20. Material 3, Elevation — <https://m3.material.io/styles/elevation/overview>
21. CSS Fonts 4, font-family property — <https://www.w3.org/TR/css-fonts-4/#font-family-prop>
22. CSS Fonts 4, font family name syntax — <https://www.w3.org/TR/css-fonts-4/#font-family-name-syntax>

Internal evidence:

- `scripts/measure/measure-catalogue.py` — quantiles over `skins-v2/` (94 skins),
  used for every "measured" figure and the `n` counts.
- `dashboard/plugin_api.py:397` — `_hex` accepts only `#rrggbb` / `#rgb`.

Note on the APCA URL: the brief's suggested <https://w3c.github.io/APCA/> returned
HTTP 404 on 2026-10-19, so APCA claims here cite the author's published introduction
at `git.apcacontrast.com`. WCAG 3 at <https://www.w3.org/TR/wcag-3.0/> does not
currently state APCA thresholds, so it is not used as an APCA source.
