# Chroma Theme Packs — plan

**Status:** **APPROVED for implementation 2026-10-18** — all decisions (§3) and all five pack names
(§6) confirmed by the Captain. Sequenced **after** the skin editor: the editor campaign ships first,
this one follows.

**Baseline this plan is written against:** commit `e30f56c`, version 2.5.2, 109 scenes, 150 files in
`skins/`, 218 gateway transports, 12 category shelves.

---

## 1. The two axes — do not confuse them

This plan adds a **second** axis of grouping. They are independent and must stay so.

| Axis | What it is | How it is decided | Where it shows |
|:--|:--|:--|:--|
| **Category** (shipped in 2.5.0) | a *measured* property of the palette: minimal, pastels, vibrant, muted, earth, terminal, nature, warm, orange, gold, cool, violet | computed by `sceneCategory()` from OKLCH, no human input | the "By theme" lens, and shelves |
| **Pack** (this plan) | a *curated* product bundle: core + Earth + Cyberpunk + Zen + … | a human decision, recorded in the generator | the badge on a card, and the Theme Packs panel |

A skin's category can never be edited by a user; its pack can. A pack is **not** a container: its
members stay ordinary skin files on disk, exactly as the editor plan (§ "a pack is metadata, not a
container") already refused. Deleting a pack must never delete a skin.

## 2. What the Captain asked for

1. Keep only **30 core skins**.
2. Verify our skins are **unique**, and that they do not duplicate skins that ship with Hermes
   Desktop. **Deliberately not** compared against the local install — that install carries many
   themes the Captain added, so it is not a reference.
3. Define **theme packs** of **10–20 skins** each.
4. A new **Theme Packs** UI where packs can be **enabled or disabled**: enabled packs appear in the
   picker, disabled ones are hidden.
5. A **badge** on every skin showing its pack name, or `core`.
6. Create **5 packs** to start (Earth, Cyberpunk, Zen, …).
7. Move the non-core skins into packs, and **build new skins** to fill each pack to 10–20.
8. More packs in later versions — the model must be data-driven, not hard-coded per pack.
9. A robust, **design- and colour-science-grounded analysis script** for skin colour schemes.
10. **Documentation** updated: recent changes and additions (the skin editor), and the roadmap.

## 3. Decisions — all six APPROVED by the Captain, 2026-10-18

| # | Decision | Recommendation | Why |
|:--|:--|:--|:--|
| D1 | Membership | A skin belongs to **exactly one** pack, or to core. Packs partition the catalogue. | The badge is singular; two badges per card is a design smell, and a partition makes the "every skin accounted for" gate trivial to assert. |
| D2 | Disabling | Disabling a pack **hides** its skins in the picker but **leaves the files on disk**. | "Unplug, not remove." The CLI may still resolve a skin the user already applied; deleting files would break a theme in use. |
| D3 | The applied theme | Disabling the pack of the **currently applied** skin never changes what is applied. | Never silently change the user's appearance as a side effect of a list filter. |
| D4 | Core selection | A **rule**, not a hand-picked list: mandatory breadth first (at least one skin per category that has one), then the identity skins, then fill to 30 by measured quality. | Reviewable, re-runnable, and it cannot silently drift as packs change. |
| D5 | Where packs live | In the **generator** (`scripts/regenerate.py` + a `scripts/packs.json` table), never hand-edited in `plugin.js`. | `plugin.js` is regenerated; a pack defined there would die at the next build. |
| D6 | Version | **2.6.0**. | New user-facing surface, no data loss, no break for an existing user. |

## 4. Uniqueness audit — against the right reference

### 4.1 The reference set

Compared against **two** sets, reported separately:

- **(a) Our own scenes** — all 109, pairwise.
- **(b) Hermes Desktop's own bundled skins**, taken from a **pristine upstream source**, never from
  `<hermes home>/skins/` on the Captain's machine. That directory holds themes he added; using it
  would manufacture false duplicates and hide real ones.

**P0 must identify and record the pristine source** (the `hermes-agent` install's own bundled skins
tree, or the upstream repo at a pinned commit) and record **the path, the version and a content hash**
in the report. If a pristine set cannot be established, the audit says so and reports set (a) only —
it does not silently fall back to the polluted directory.

### 4.2 The metric

Colour-science, not eyeballing:

- Reduce each skin to its **6 signature roles** — shell (`background`), raised surface, signature
  (`ui_accent`), reading (`banner_text`), secondary (`banner_dim`), structure (`ui_border`) — in both
  modes. These are the roles a user actually perceives.
- Convert to **OKLab** and compute **ΔE(OKLab) per role**, then the **maximum** role distance as the
  skin-to-skin distance. Maximum, not mean: two skins that differ only in their accent are still the
  same skin to a user.
- Thresholds (to be confirmed against the measured distribution in P0, not asserted):
  - `ΔE < 0.02` → **near-duplicate**, blocks.
  - `0.02 ≤ ΔE < 0.05` → **close**, reported and reviewed.
- Also report **name collisions** and name-implies-one-family-but-measures-another cases (the same
  signal the 12-category work already computes).

### 4.3 Output

`docs/DUPLICATE-AUDIT.md`: the closest pairs ranked, the decision for each (retire / re-tune / keep
with a reason), and a one-line justification per kept pair. **Retirement is archival, not deletion** —
a retired skin moves out of the pack set and is recorded, so it can be reinstated.

## 5. The colour-analysis script

Two scripts, both deterministic, both tested, no network:

### 5.1 `scripts/analyse-palettes.py` → `docs/PALETTE-ANALYSIS.md`

Grounded in the same OKLCH space the classifier already uses (no second colour model):

1. **Per skin**: the 6 roles in both modes, as hex, OKLCH `(L, C, h)`, and **WCAG contrast** of
   reading-on-shell and signature-on-shell.
2. **Distributions**: hue histogram (36 bins), chroma histogram, lightness histogram — for accents and
   for shells separately.
3. **Distinctness**: nearest-neighbour distance for every skin, the ranked closest pairs (this feeds
   §4).
4. **Coverage and gaps**: which hue bands and which lightness/chroma cells are **under-served** —
   this is the design-grounded input for the *new* skins in §7, so a new skin is chosen to fill a
   measured gap rather than to look nice in isolation.
5. **Gates**: fail on any role missing, any contrast below the port floor, any two skins under the
   duplicate threshold, any hue band with zero skins. Warnings are listed, not swallowed.

### 5.2 `scripts/check-packs.py` → a gate

Asserts the invariants the product depends on: every scene has exactly one pack; core is exactly 30;
every pack holds 10–20; every pack id is unique and every member exists. Runs in the same gate sweep
as the suite.

Both scripts get unit tests for the pure parts (colour conversion, ΔE, contrast, the gap finder) — a
report is only as trustworthy as its arithmetic.

## 6. Core 30 — the selection rule

Applied mechanically, then reviewed:

1. **Breadth first**: for each of the 12 categories that has members, take its highest-contrast skin.
2. **Identity**: add the skins the product is known by and that a returning user expects to find.
3. **Quality**: fill to 30 by measured contrast and distinctness — prefer skins that are far from
   their neighbours.
4. **Conflict rule**: if a step exceeds 30, drop the lowest-contrast candidate and say so in the
   report. Never silently exceed the count.

The output is a **proposed list with the reason per skin**, for the Captain to approve or override —
not a fait accompli.

## 7. The five packs

**The approved set — single-word names, final 2026-10-18.** Mapped to what the catalogue already
contains:

| Pack | Idea | Likely home for | Target |
|:--|:--|:--|:--|
| **Earth** | soil, moss, clay, autumn, forest | nature, earth, warm, gold shelves | 10–20 |
| **Cyberpunk** | neon, synth, matrix, night-city | neon-ish vibrant, synthetic greens | 10–20 |
| **Zen** | quiet, low-chroma, paper and ink | minimal, muted, pastels, the paper skins | 10–20 |
| **Retro** | phosphor CRTs and 1980s machines | the terminal shelf | 10–20 |
| **Noir** | deep, high-contrast, single-signal dark | deep cool/violet, monochrome-with-one-accent | 10–20 |

**Capacity check, before anything is built:** 109 − 30 = **79 non-core skins** to distribute across
five packs of 10–20, i.e. capacity 50–100. So the existing catalogue can fill the packs, and **new
skins are only needed where** (a) a pack lands under 10, or (b) the analysis in §5.1 shows a pack is
visually crowded — five near-identical greens do not make an Earth pack. New skins are specified from
the measured gaps, in the order the gaps are largest.

## 8. Enable / disable semantics

- **Storage**: one profile-scoped key, e.g. `chroma-packs-v1`, holding the enabled pack ids. Default
  state for a new user: **core only**. (The key name and shape are confirmed against the existing
  preference keys in P2 — the pane already writes five keys, and the naming rule is in question per
  roast C item C6.)
- **The picker** shows core + the enabled packs. It shows a **hidden count with a way in** — "37 skins
  hidden by 2 disabled packs" linking to the panel. A filter that silently hides things is how a user
  loses a theme and blames the product.
- **Search** searches what is visible, and says so when it is filtered.
- **The gateway/CLI** is unaffected by disabling (D2). Pack membership is surfaced in the UI so that a
  skin visible in the CLI and hidden in the picker is explained, not mysterious.
- **Enabling is instant** — no regeneration, no restart. If it ever needs one, the UI says so.

## 9. The UI

- **Theme Packs** — a button on the page header (not a second route; the pane is one page today),
  opening a panel: one row per pack with title, description, member count, a colour preview strip, and
  an enable/disable control. Core is shown as a row that cannot be disabled.
- **Badge** — a small pill on each card: the pack title, or `core`. **Text, not colour alone** (the
  same 2 × 6 swatch already carries meaning in colour only; the badge must not repeat that mistake).
  The pill is also the affordance that tells the user why a card disappears later.
- **Editor interplay** — a skin's pack is shown in the (planned) editor and is **not** editable there
  in v1; changing a skin's pack is a catalogue decision, not a user preference. Record that in the
  editor plan so the two documents agree.

## 10. Phases

| Phase | Deliverable | Gate |
|:--|:--|:--|
| **P0** | Identify the pristine upstream skin source (path + version + hash); `analyse-palettes.py` + tests; `docs/PALETTE-ANALYSIS.md`; the baseline duplicate report | the script runs deterministic, its own tests pass, and the source is proven pristine and recorded |
| **P1** | Resolve duplicates: retire / re-tune / keep-with-reason, recorded in `docs/DUPLICATE-AUDIT.md` | no pair under the duplicate threshold without a written reason |
| **P2** | Pack model in the generator (`scripts/packs.json` + `regenerate.py`); core-30 selected by rule; `pack` on every scene; `check-packs.py` | every scene has exactly one pack; core == 30; every pack 10–20 |
| **P3** | Theme Packs UI: enable/disable, persistence, hidden-count hint, badge on every card | enabled appears, disabled is hidden, the applied theme is never disturbed (D3); render → vision check |
| **P4** | Fill the five packs: assign the non-core skins, then build the missing skins from the measured gaps | each pack 10–20; every new skin fills a named gap and clears the contrast and duplicate gates |
| **P5** | Docs: README made true, `docs/PLANS/CHROMA-ROADMAP.md` updated, the editor plan cross-referenced, CHANGELOG, and `docs/ARCH.md` vs `docs/ARCHITECTURE.md` resolved (two architecture files in one repo is a defect) | every doc claim matches the build |
| **P6** | Release 2.6.0, G15 acceptance, registry readiness re-check against `docs/REVIEWS/ROAST-TRIAGE-2026-10-17.md` | §1 of the triage empty; clean-machine install shows the packs |

## 11. What must not break

- **No palette moves** for an existing skin except where P1 deliberately retires or re-tunes one, and
  that is recorded. The parity fixture stays the proof.
- **The 12 categories stay measured.** Packs are curated; they must never feed back into
  `sceneCategory()`.
- **Regeneration stays idempotent** — a second run changes nothing.
- **Disabling a pack performs no file I/O at all.**
- **Every new skin is generated, not hand-written**: it enters through the same pipeline (scene +
  derived light/dark halves + gateway transports) so it cannot drift from the contract.

## 12. Decisions (resolved 2026-10-18 — the Captain approved all four)

| # | Question | Answer |
|:--|:--|:--|
| 1 | The five pack names | **Earth, Cyberpunk, Zen, Retro, Noir** — single-word, as ordered. |
| 2 | Core 30 | The **rule's output** is approved. P2 produces the proposed list with a reason per skin for the record, and the rule is re-runnable. |
| 3 | A skin in two packs | **Exactly one.** The badge is singular and every skin is accounted for by construction. |
| 4 | Disabled packs and the CLI | **Files stay on disk** (D2). Disabling hides from the picker and performs no file I/O; the applied theme is never disturbed (D3). |

## 13. Risks

| Risk | Mitigation |
|:--|:--|
| The "upstream" reference is polluted, silently manufacturing or hiding duplicates | P0 proves pristineness, records path/version/hash, and refuses to guess |
| 5 packs × 10–20 does not divide 79 cleanly, so packs look padded | The analysis proposes new skins only where a measured gap exists; padding with near-identical skins is explicitly refused |
| Users lose access to a favourite skin when a pack is off | The hidden-count hint, the badge, and never disturbing the applied theme |
| Pack metadata drifts from the catalogue after a later edit | `check-packs.py` runs in the gate sweep |
| Scope creep into the editor | The editor stays its own planned work; this plan only records the pack field in it |
| The registry submission is delayed by a large feature | P6 re-checks the triage; the two fix subagents in flight are independent of all of this |
