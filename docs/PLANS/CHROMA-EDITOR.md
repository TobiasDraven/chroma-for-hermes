# CHROMA — the editor expansion (plan)

Status: **plan, not built.** Written 2026-10-17 for Captain Tobias's review.
Scope: the first bigger expansion after the picker — editing, duplicating, packing, and
categorising skins from inside the plugin.

---

## 1. What the Captain asked for

> A gear icon on the theme, which takes the user to another page or modal, where the user can edit
> skin colors, fonts, etc., then save or export; copy or duplicate themes; import or export packs of
> themes, manage theme packs; create or delete and manage categories.

Five capabilities:

| # | Capability | Shape |
|:--|:--|:--|
| E1 | Edit a skin's colours (+ fonts where the platform allows) | gear on the card → editor → save / export |
| E2 | Copy / duplicate a theme | one action on the card |
| E3 | Import / export theme **packs**; manage packs | bundle files, a pack list, delete |
| E4 | Create / delete / manage **categories** | user categories beside the built-in ones |
| E5 | Fonts | the part with a platform constraint — see §8 |

---

## 2. What already exists (verified in the tree, 2026-10-17)

The plugin is **not** a blank slate. `dashboard/plugin_api.py` already ships a real backend:

| Route | Line | Does |
|:--|:--|:--|
| `GET /skins` | 128 | every Chroma-owned skin + `cliCapable` |
| `POST /import` | 235 | write a skin YAML (slug validated) |
| `DELETE /skins/{name}` | 397 | move to `_trash/` — never unlink |
| `POST /skins/rename` | 438 | rename + description rewrite, returns `wasActive` |
| `GET /export` | 487 | export one or all |

Plus the machinery the editor must reuse rather than re-invent:

- `_dump_skin_yaml()` / `_atomic_write_text()` (lines 46, 59) — the gateway's skin watcher must never
  see a half-written palette.
- `_read_index()` / `_write_index()` (93, 111) — the **provenance index**: who owns which skin file.
- `_trash_dir()` (115) — deletion is reversible by design.
- `_is_unsafe_name()` (231) — slug gate on every name that can become a path.
- Route-order discipline: `/skins/rename` is declared **above** future `POST /skins/{name}` because
  FastAPI matches in registration order (comment at 435).

Tests: `tests/test_plugin_api.py`, `tests/test_regenerate.py` (backend), plus the JS suite.

**Consequence for the plan:** E1–E4 are mostly *new routes + a UI*, not new infrastructure. The
storage layer, the writer and the safety rules already exist. That is why this plan is short.

---

## 3. The contract: an edit produces a REAL skin

Locked earlier by the Captain: an import must create a real skin file, not a Desktop-only theme.
The same rule governs editing.

- **A built-in scene is never mutated in place.** The 109 shipped scenes are generated from
  `scripts/regenerate.py`; editing one would be erased by the next regeneration. Editing a built-in
  scene therefore performs **Save as a copy** by default: a new user skin, provenance `user`.
- **A user skin is edited in place** — its YAML is rewritten atomically, its index entry updated.
- **Every edit is CLI-visible.** The file lands at the top level of `<hermes home>/skins/`, which is
  the only directory `list_skins()` reads (it does not recurse). A skin the CLI cannot see is not a
  skin.
- **Write-then-activate ordering stays.** The YAML must exist before anything asks the gateway for
  that name, or `resolve_skin()` broadcasts the default palette to every surface.
- **The pane owns the palette; the server owns the file.** A built-in scene has no YAML on the
  server: `skins/` holds 150 files and neither `nous.yaml` nor `nord.yaml` is one of them
  (verified 2026-10-17). So the backend can never resolve `from: 'nous'` by reading a file. Every
  save and every duplicate sends the **skin-keyed palette from the pane**, and the backend writes
  what it is given.
- **The shadcn mapper is not the scene writer.** `import_skin` maps TweakCN's keys (`foreground`,
  `primary`, `cardForeground`, `destructive`) into skin keys (`plugin_api.py:265-292`). Hand it a
  scene palette - `ui_accent`, `banner_text` - and `ui_accent` silently falls back to `#ffffff`.
  Editing therefore needs a writer that takes **skin keys** and validates them; the TweakCN mapper
  stays exactly as it is, for TweakCN.
- **A dual-mode skin needs two files, until the engine says otherwise.** `_parse_skin_file` reads
  `colors` only (`regenerate.py:163-182`); `light_colors`/`dark_colors` are written by `import_skin`
  and read by nothing in this tree; built-in dual-mode is delivered as two transport skins. So a
  dynamic user skin is saved as a pair - `<slug>-light.yaml` + `<slug>-dark.yaml` - and this plan
  says so rather than pretending one file carries both. (The `skin_engine` spike may retire this;
  until it does, the pair is the design.)

---

## 4. Data model

| Store | Location | Holds |
|:--|:--|:--|
| skin files | `<hermes home>/skins/<slug>.yaml` | the palette the engine reads |
| provenance index | `<skins>/.chroma/index.json` | `{ "<slug>": { source, pack, importedAt, category?, label? } }` |
| categories (new) | `<skins>/.chroma/categories.json` | user-defined categories + per-skin overrides |
| packs (new) | `<skins>/.chroma/packs/<slug>.json` | pack metadata; the skins stay individual files |
| trash | `<skins>/.chroma/_trash/<stamp>-<slug>.yaml` | deleted skins |

Two deliberate choices:

1. **A pack is metadata, not a container.** Importing a pack writes ordinary skin files plus one pack
   record. Exporting a pack gathers the skins its record names. This keeps every skin CLI-visible and
   individually deletable, and it means a pack can outlive or precede its members without corrupting
   the catalog.
2. **Categories live beside the index, not inside it.** A category is a user-visible object with a
   name and a rule; a skin's category is an override. Two files, two lifetimes.

---

## 5. New API surface

All under the plugin's mount (`/api/plugins/chroma`). Every mutating route: slug validation through
`_is_unsafe_name()`, atomic writes, a JSON body model, and an explicit error for "unknown skin",
"built-in, copy required", "active" where it matters.

| Method | Path | Purpose |
|:--|:--|:--|
| `GET` | `/schema` | the editable role list + typography fields, so the UI never hardcodes what it may edit |
| `GET` | `/skins/{name}` | read one skin's palette back — without this the picker cannot show an owned skin's colours at all (`GET /skins` returns no colours today, `plugin_api.py:140-159`) |
| `PUT` | `/skins/{name}` | rewrite a **user** skin from a **skin-keyed** palette the pane sends; a new writer, not the TweakCN mapper |
| `POST` | `/skins/duplicate` | `{to, label?, light:{role:hex}, dark:{role:hex}}` — both palettes arrive from the pane; the server resolves nothing and invents nothing |
| `GET` | `/packs` | list pack records with member counts |
| `POST` | `/packs/export` | `{name, members[]}` → one bundle document |
| `POST` | `/packs/import` | bundle → preview, then write; collision policy in §7 |
| `DELETE` | `/packs/{slug}` | drop the record; members are untouched unless `withSkins` |
| `GET` | `/categories` | built-in + user categories, with counts |
| `POST` | `/categories` | create a user category `{id, title, rule}` |
| `PUT`/`DELETE` | `/categories/{id}` | rename / delete (members fall back to their measured category) |

`PUT /skins/{name}` refuses a built-in name with `409` and the message that names the copy path. That
refusal is a feature: it is the only thing standing between the user and a regeneration that silently
undoes their work.

---

## 6. UI surface

**Gear on the card.** One icon button in the card's action row (the row that already carries
apply/preview), revealed on hover and **always present for keyboard and touch**
(`focus-visible:` + `pointer-coarse:` — the standing rule from the OVERWATCH sweep). It opens the
**editor modal**, not a new page: the picker is a single view, and a route change would lose the
user's filter, scroll and search.

**The editor modal** — three zones, one job each:

1. **Preview** — a live 2 × 6 matrix per mode, exactly the swatch contract the cards use, so the
   preview and the card cannot disagree.
2. **Roles** — one row per editable role, light and dark side by side. A colour field, a hex field,
   and the role's purpose in one line ("signature — accent surface"). Contrast read-out per role
   against its own shell: **text 9:1, interface 3:1, signals 4.5:1**, the same targets the port uses.
   A role below target is marked, not blocked — it is the user's skin.
3. **Identity + actions** — name (slug), label, description; then `Save`, `Save as copy`, `Export`.

**Editing a built-in scene** opens the modal with the name field prefilled as `<name>-custom` and
`Save` disabled, with one sentence saying why. No modal of "are you sure": the disabled button is the
explanation.

---

## 7. Packs

**Export format** — one JSON document, versioned:

```json
{ "chroma_pack": 1, "name": "...", "author": "...", "created": "...",
  "categories": [ { "id": "...", "title": "..." } ],
  "skins": [ { "name": "...", "label": "...", "light": { "<role>": "#rrggbb" }, "dark": { ... } } ] }
```

Self-contained: a pack carries the palettes themselves, not references to files that may not exist on
the receiving machine. Categories travel with it, so an imported pack does not arrive uncategorised.

**Import** — always preview before write. The preview lists, per skin: `new`, `identical` (skip),
`collides` (a different skin already holds that name → the user picks rename-to-suffix or skip).
Nothing is written until the user confirms. The whole import is one transaction against the index: a
failure mid-way rolls back what it wrote.

**Management** — a pack list showing name, member count, and whether every member is still present
(a pack whose members were individually deleted says so rather than lying). Delete offers
"record only" (default) and "record + skins".

**Validation is hostile by default**: cap the document size, require a slug on every name, reject
unknown roles (report, do not silently drop), reject a colour that is not `#rrggbb`, and never
accept a path.

---

## 8. Fonts — the constrained part

Skin YAML carries **colours only** (see `_dump_skin_yaml`; the schema is top-level scalars plus
string→string maps). Typography in this product is a **Desktop theme** field (`SCENE_TYPOGRAPHY` in
the template), not a skin field. So:

- Editing a font cannot produce a real skin. It produces a Desktop-only overlay.
- Two honest options, and this is the Captain's call:
  - **(a) Desktop-only typography**: the editor writes typography into the plugin's own theme data
    for that scene. Works on this Desktop; invisible to the CLI and to other machines. Must be
    labelled as such in the UI — an unlabelled Desktop-only setting is a lie about portability.
  - **(b) No font editing in v1**: ship colours, duplicate, packs and categories first, and treat
    fonts as their own campaign once the skin schema question is settled.
- **Recommendation: (a), labelled.** It satisfies the request without pretending the CLI can render a
  font it will never receive.

**Spike required before E5**: confirm against `hermes_cli/skin_engine.py` that no font key is read
from a skin. One read, not a guess.

---

## 9. Categories

The picker's categories are currently **derived** (OKLCH measurement of the accent). The editor adds
**declared** categories beside them. Resolution order for a skin:

1. an explicit per-skin override (user),
2. a user category whose rule claims it (first match by declaration order),
3. the built-in measurement.

A built-in category cannot be deleted; a user one can. Deleting a user category does not move its
skins to a black hole — they fall back to their measured category, which is why step 3 exists.

The **12** built-in categories are the taxonomy work landing separately; this plan only needs the
container to hold them plus the user's own. Note that the shipped picker carries **7**
(`THEME_CATEGORIES`), so "12" is a target, not a fact on disk — do not write the number into the
backend until the classifier ships it.

**The rule grammar, specified (the review's finding: §4 and §9 named "a rule" and never defined
it).** A user category carries one of exactly two rule kinds, never both under one name:

1. `{"kind": "measured", "roles": "accent", "minChroma": 0.16}` — a threshold set over the measured
   OKLCH accent. The **pane** measures (it already does, `sceneCategory`); the backend stores and
   echoes the rule but never re-implements the classifier.
2. `{"kind": "names", "names": ["nord", "dracula"]}` — an explicit list. It cannot drift with the
   colour maths, and it is honest about being a judgement.

`GET /categories` therefore returns the **declared** categories only; counts come from the pane,
which is the only side that can see the catalog. A per-skin override is a plain category id; if it
points at a deleted category the skin falls back to its measured category (step 3), which is exactly
why step 3 exists. Two matching rules resolve by declaration order — and the order is returned by
`GET /categories` so the UI can show it rather than the user guessing.

---

## 10. Guardrails

- Never mutate a built-in. Copy, always. (`409` from `PUT`.)
- Never unlink. Trash. (Existing rule, inherited.)
- Never write a path. Slug-gate every name that can become a filename. (Existing rule.)
- Never write a half-file. Atomic replace. (Existing rule.)
- Never activate before the file exists. (Write-then-activate.)
- Never silently drop a field on import. Report unknown roles.
- One writer per file in the plugin; the gateway watcher is a reader.
- Every destructive action names what it will remove, in the confirmation text.

---

## 11. Testing and gates

| Gate | What it must prove |
|:--|:--|
| backend unit | `PUT` refuses a built-in; a user skin round-trips byte-identically after an unrelated rename; a failed pack import leaves the index unchanged **and no orphan file** |
| pack round-trip | export → delete → import restores every palette exactly |
| JS suite | the editor modal renders the 2 × 6 contract; a colour edit updates the preview without a save |
| **gallery visibility** | a saved copy is **visible in the picker with its colours, and still there after a Desktop restart** — the acceptance the review found missing, and the one that catches a save the user cannot see |
| **pane-route table** | every action the pane can call exists on the backend (the "two surfaces" rule), read out of the shipped pane source |
| validate | `hermes plugins validate .` passes (the catalog admission gate) |
| rigour | `rigour check --ci` no new findings |
| **clean-machine** | install from the git URL, restart, edit a skin, confirm the CLI sees it **and the picker still lists it** |

The last two are the ones that matter: an edit the CLI cannot see has failed the product's own
definition of a skin, and a save the picker cannot show has failed the user's.

---

## 12. Phasing

| Phase | Content | Why this order |
|:--|:--|:--|
| **E0** | `GET /schema`; index gains `category`/`label`; categories.json scaffold | every later phase needs one definition of "what is editable" |
| **E1** | `PUT /skins/{name}` + the editor modal, colours only | the smallest end-to-end that delivers the ask |
| **E2** | `POST /skins/duplicate` + the gear's second action | the escape hatch the built-in rule requires |
| **E3** | packs: export → import with preview → management | largest surface; needs E0's schema to validate |
| **E4** | categories CRUD + resolution order | depends on the 12-category taxonomy landing |
| **E5** | typography (spike first), labelled Desktop-only | isolated, and the only Desktop-only piece |
| **E6** | polish: keyboard/touch reach, empty states, export naming | last, so it reflects what actually shipped |

Each phase: one commit, gates green, and a real render check of the modal (the render → vision step
that caught the `nous` swatch bug).

---

## 13. Open questions for the Captain

1. **Fonts**: option (a) Desktop-only and labelled, or (b) defer? (Recommendation: (a).)
2. **Where does the editor write when the user edits a built-in?** My plan forbids in-place edits.
   The alternative — allowing it and protecting the file from regeneration — needs a "user overrides
   this built-in" concept that the regenerator must honour. Bigger, but it is what a user expects
   when they click a gear on their favourite theme.
3. **Packs: file on disk, or shareable through the gateway?** v1 = file export the user sends
   themselves. A gateway-side pack registry is a different campaign.
4. **Do categories belong to a pack?** v1 = yes, carried in the bundle. Confirming this keeps an
   imported pack self-describing.

---

## 14. Alignment with the Hermes plugin contract (verified 2026-10-17)

**Sourcing correction (2026-10-17, after adversarial review).** An earlier draft of this section
attributed the five constraints below to "the authoring contract", which a reviewer correctly read as
the two vault docs (`PLUGIN-AUTHORING.md`, `DESKTOP-PLUGINS.md`) — and those two docs do **not**
contain them. The constraints are real; they come from my own distilled contract,
`profiles/faris/skills/hermes-plugin-authoring/SKILL.md:391` (no filesystem access), `:480` (routes
mount at import), `:510-511` (the `${...}` security scan) and
`references/install-and-distribution.md:132`. The nearest support inside the vault docs is
`DESKTOP-PLUGINS.md:75-87` and `INSTALL-AND-DISTRIBUTION.md:87-90`. Cited wrongly is not the same as
untrue, but it is the same as unverified — so the line numbers are now given and a reader can check
each one.

Read against that contract and the installed source. Each line is a constraint the plan must obey,
with its evidence. Anything not verified is marked UNVERIFIED.

### 14.1 The five hard constraints

| Constraint | Evidence | Effect on this plan |
|:--|:--|:--|
| **A plugin has no filesystem access.** The pane's SDK carries no fs/save method, and there is no generic file-write in the gateway RPC registry. | authoring contract, "a plugin has NO filesystem access" | The editor **cannot** be built in the pane alone. `dashboard/plugin_api.py` is mandatory, which makes this a unified package. §5 stands. |
| **A dashboard router mounts at IMPORT time**, not per request. | authoring contract, "its routes mount at import time" | Every new route needs a **restart** before it exists. The editor must say so on a 404 rather than looking broken. |
| **The pane's route table is a second surface.** An action routed only at the far end is a 404 at the only path the pane uses. | authoring contract, "an action routed only at the far end is a 404" | Every new action needs the route **and** the pane side, pinned in a test that reads the action names out of the shipped pane source. §11 gains that test. |
| **Rule 9 — public surfaces only.** A backend half must not import `utils.*` or `hermes_yaml`. | authoring contract, `hermes plugins validate` | The existing hand-rolled YAML emitter stays; new code uses stdlib only. |
| **The security scan reads every `${...}` as `inline_shell_exec`.** | authoring contract, "the security scan false-positives on template literals" | New pane code uses plain string concatenation in anything the scanner reads, or the validation gate reports a false shell call. |

### 14.2 The theming APIs, verified in the installed source

- `requestTheme(name): boolean` — **exported** at `apps/desktop/src/sdk/index.ts:2053`. It refuses a
  name it cannot resolve, and otherwise queues through the provider, which normalises, persists per
  profile and drops previews (`themes/request.ts:1-37`).
- `requestMode(mode)` — **NOT exported** (`themes/request.ts:43`; the SDK export list carries
  `requestTheme`, `retintTheme`, `themeHue` and `THEMES_AREA` only). A plugin has no SDK door to an
  imperative mode switch; `useTheme().setMode` is the only one.
- `setTheme(name)` **falls back to the default skin** for a name it cannot resolve
  (`themes/request.ts:22-27`). For a person picking from a list that is correct; for code reacting to
  an event it is a silent appearance reset.
- `THEMES_AREA` is exported (`sdk/index.ts:2056`). A theme registration reaches the **Desktop GUI
  only**; a skin file reaches every surface. Never call a theme registration "creating a skin".

**Consequence for E1**: the editor must hand a *skin* to the backend (which writes the file) and only
then request the theme. A pane-only "save" would produce a theme that vanishes on the next machine.

**Consequence for the lightbulb bug**: the provider can only repaint a theme it can resolve, so a
mode flip on an unresolvable scene repaints the DEFAULT palette. That is a silent reset, not a dead
button — and it is why the report reads "does not respond or gets stuck".

### 14.3 Distribution and verification rules this plan inherits

- The desktop half is **materialized** by the host from `<pkg>/desktop/plugin.js`; the folder must be
  named `desktop/`, and a stale marker-less hand install shadows it. (Existing layout is correct.)
- `hermes plugins validate <dir>` is the catalog admission gate; run it before proposing anything.
- A UI change requires **fixture regeneration** (`tests/regenerate-theme-card-parity.mjs`) and a
  **render → vision** check; behavioural suites stay green while the DOM contract is broken.
- Regenerate before testing: the harness loads the shipped `desktop/plugin.js`, not the template.
- `python_dependencies` entries need an upper bound (`>=floor,<next_major`).

### 14.4 Still UNVERIFIED, and the plan does not assume it

- That the skin engine reads **no** font key from a skin YAML (§8's spike).
- That a user skin created by the backend is visible to a **running** CLI without a restart of the
  gateway (the watcher's behaviour on a brand-new file).
- Whether the host's theme reconciler re-materialises `desktop/plugin.js` on a byte difference alone
  when the plugin was installed by **git URL** rather than a linked folder.

---

## 15. Review record — round 1 (2026-10-17)

An independent read-only lane reviewed this plan against the plugin contract, `plugin_api.py`,
`plugin.template.js`, `plugin.yaml` and the backend tests. Verdict: **REQUEST-CHANGES**, four
findings at BLOCKER/HIGH. Each was re-verified against the tree before acceptance. Disposition:

| Finding | Verified? | Disposition |
|:--|:--|:--|
| **[BLOCKER] a duplicate cannot be produced from a built-in, and a saved skin never reappears in the gallery.** No `nous.yaml`/`nord.yaml` exists; `import_skin` maps shadcn keys, so a scene palette loses its accent; `GET /skins` returns no colours; `allSkins` never merges owned rows; `IMPORT_SOURCES` rehydrates only `tweakcn/windows-terminal/base16/vscode`, so a `user` skin vanishes on restart. | **Yes** — all four sub-claims confirmed by reading the files | §3 gains "the pane owns the palette"; §5 gains `GET /skins/{name}`, a skin-keyed writer, and pane-supplied palettes; §11 gains the gallery-visibility gate |
| **[HIGH] "one transaction" is not implementable** on per-file atomic writes; no staging, no rollback; `install-gateway-skins.sh` puts 358 files at the top level of `skins/`, so orphans are CLI-visible; the preview never mentions `CORE_NAMES` 409s. | **Yes** — `plugin_api.py:59-64`, `:322-334`, `:240-241` | §7 now stages every member, validates against three collision classes (index, unindexed bundled file, core name), and drops the word "transaction" in favour of the staging contract |
| **[HIGH] one skin file is one palette**; `_parse_skin_file` reads `colors` only, so editing both modes may collapse to one. | **Yes** — `regenerate.py:163-182`, and `light_colors` appears nowhere in that file | §3 now states a dynamic user skin is saved as a **pair** until the `skin_engine` spike says otherwise |
| **[HIGH] the category rule grammar was never defined**, the classifier lives in the pane so the backend cannot count, and "12" contradicted the shipped 7. | **Yes** — `THEME_CATEGORIES` carries 7 ids | §9 now specifies two rule kinds, the measuring side, the override fallback and the ordering rule |
| **[INFO] §14.1's five constraints were cited to docs that do not contain them.** | **Partly** — the docs do not contain them; my distilled skill does | §14 preamble now carries the correction and the real line numbers |

**What this round changed about the shape of the work.** E0 is no longer just "a schema route". It
must also carry the read-back route and the pane's merge of owned skins, because without them E1
cannot be *verified* — the plan would ship an editor whose save the picker cannot show. That is the
cheapest correction available and it costs one route and one merge, not a new phase.

**Still open after round 1** (carried, not hidden): the `skin_engine` font/palette spike (§8, §3); the
gateway watcher's behaviour on a brand-new file (§14.4); whether categories are per-profile or
global — the contract says a pane is app-level, and this plan never states which it wants. Round 2
must close that last one before E4 starts.

---

## 16. Decisions taken, and what this campaign inherits (2026-10-18)

### 16.1 The approved pack decisions that bind the editor

The Captain approved all of `CHROMA-PACKS.md` §3 and §12 on 2026-10-18. Four of those bind this plan:

- **One pack per skin.** Core plus five single-word packs: **Earth, Cyberpunk, Zen, Retro, Noir**.
- **A skin's pack is SHOWN in the editor and NOT editable there in v1.** Pack membership is a
  catalogue decision, not a user preference.
- **Disabling a pack is a picker filter, nothing more.** No file I/O, and the applied theme is never
  disturbed. The editor therefore never needs to know which packs are *enabled* — it edits files, not
  views. That is the whole of the coupling between the two campaigns.
- **The packs campaign runs after this one.** E-phases first, P-phases second.

### 16.2 Working decisions on §13's four questions

Taken as the default so this campaign can proceed. Correct any one and it changes:

| # | Question | Working decision |
|:--|:--|:--|
| 1 | Fonts | **(a) Desktop-only and labelled.** §8's spike still runs before E5 and can overturn it. |
| 2 | Editing a built-in | **Copy, never in place** (§3, §10) — the plan's existing rule, kept. This is the one decision that changes what a user *expects* when they click a gear on their favourite theme, so it is called out for the Captain's word rather than buried. |
| 3 | Packs transport | **A file the user sends.** No gateway-side pack registry in v1. |
| 4 | Categories in a pack bundle | **Yes** — §7's format already carries them. |

### 16.3 A defect this campaign starts with: §2's line references are stale

The 2.5.2 backend round (`8a06221`) rewrote `plugin_api.py`. The routes §2 cites have moved:

| Route | §2 said | Actually at |
|:--|:--|:--|
| `GET /skins` | 128 | **248** |
| `POST /import` | 235 | **428** |
| `DELETE /skins/{name}` | 397 | **638** |
| `POST /skins/rename` | 438 | **688** |
| `GET /export` | 487 | **770** |

E0 re-reads the file and refreshes every citation before a single route is added. A plan that cites
the wrong line is a plan nobody can check.

### 16.4 The host already exports the colour maths — verified 2026-10-18

A plugin may import only `@hermes/plugin-sdk`, so what matters is what the SDK **re-exports**, not
what exists somewhere in the app. Verified by reading the installed source:

| Symbol | Where the SDK gets it | Usable by a plugin? |
|:--|:--|:--|
| `contrastRatio` | `sdk/index.ts:2081` ← `@hermes/shared/color` | **Yes** |
| `hexToOklch`, `maxChroma`, `oklchToHex`, `oklchToSrgb255` | `sdk/index.ts:2036-2043` | **Yes** |
| `retintTheme`, `themeHue` | `sdk/index.ts:2054` | **Yes** — relevant to F8/F9 (accent interop) |

And the plugin **already hand-rolls the same maths**: `hexToRgb` (`plugin.template.js:160`), `rgbToHex`
(`:166`), `relativeLuminance` (`:189`), `contrastRatio` (`:197`) and `oklch` (`:1470`).

**The decision this forces, stated so E1 does not stumble into it.** The editor's displayed contrast
read-out should use the **host's `contrastRatio`**, because that is the number the app itself believes
and the whole point of a read-out is agreement with the product. The **classifier and the swatch stay on
the plugin's own maths** — they are shipped, they are what the 2 x 6 matrix and the twelve categories
were measured with, and re-pointing them at the host implementation is an algebraically-equal rewrite
that can still move outputs at the last ulp, which would silently re-cut the categories. So: host maths
for the *read-out*, our maths for the *catalogue*, and never the two swapped. E1's test pins that the
read-out and the classifier disagreeing about a borderline pair is a display difference, not a data
change.

### 16.5 The writer must use the strict index path, or it re-opens B2

The same round added `_read_index_for_update()`, `IndexUnreadableError` and a quarantine path, and made
`_read_index()` deliberately lenient for read-only views. **Every new editor route that writes must go
through the strict path**, exactly as `import_skin`/delete/rename now do. A new `PUT /skins/{name}`
that reads the index leniently would silently reintroduce the data-loss defect that `8a06221` closed —
a corrupted index read as `{}` and persisted. This is the first thing E1's tests must pin.
