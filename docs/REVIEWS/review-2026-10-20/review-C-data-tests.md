VERDICT: HOLD

PIN: 352c3c5ad86db06cc600c3555675e2baf0928e12 (branch `main`, working tree clean at the time of review — `git status --porcelain` empty; I did not read the working tree as my subject and made no repo write).

Files read in full or in the part that matters, with line counts:

| File | Lines | Read |
|---|---:|---|
| `scripts/regenerate.py` | 826 | full (KEEP_KEYS 45-55, THEME_PAIRS 59-116, `_load_v2_skins` 519-582, `_build_catalog` 585-649, `_write_gateway_transport_skins` 704-726, `main` 729-822) |
| `scripts/check-packs.py` | 166 | full |
| `scripts/check-package.py` | — | grep + run (version loci only) |
| `scripts/generate-gallery.py` | 352 | full |
| `scripts/taxonomy.json` | 124 | full |
| `scripts/packs.json` | — | full (via JSON parse) |
| `dashboard/plugin_api.py` | 2494 | read 290-320, 890-960, 1140-1230, grep elsewhere |
| `desktop/plugin.template.js` | 6263 | read 115-133, 2635-2740, 3160-3195, 3389-3450, 3850-3890, 5285-5315; grep elsewhere |
| `desktop/plugin.js` (built) | 497 054 bytes | parsed the embedded `SKINS` literal; grep |
| `skins-v2/*.yaml` | 94 files | all parsed |
| `gateway-skins/*.yaml` | 188 files | all parsed |
| `tests/*.test.mjs` | 26 files, 4 944 lines | all read |
| `tests/helpers/*.mjs` | 3 files, 415 lines | all read |
| `tests/test_plugin_api.py` | 1820 | read 735-805, test-name index of all |
| `tests/test_regenerate.py` | 474 | full |
| `tests/test_skin_contract.py` | 92 | full |
| `docs/THEME-PACK-CREATION.md` | — | read §2-§5, §7 |
| `docs/PLANS/CHROMA-SKIN-CONSOLIDATION.md` | 171 | read §1-§5 |
| `docs/SPEC.md` | 122 | full |
| `.github/workflows/ci.yml` | 81 | full |

---

## 3. What I actually RAN vs what I only READ

### 3.1 Ran (all commands read-only against the repo; every mutation was done on a copy in `C:/Users/<user>/AppData/Local/Temp/opencode/`)

| # | Command | Exit | Raw result |
|---|---|---|---|
| R1 | `"/c/Program Files/nodejs/node" --test tests/*.test.mjs` | **0** | `tests 266 / pass 266 / fail 0 / cancelled 0 / skipped 0 / todo 0 / duration_ms 3051.0` |
| R2 | `unset PYTHONPATH && python -m pytest tests/ -q` | **0** | `185 passed, 4 skipped, 9 subtests passed in 83.71s` |
| R3 | `unset PYTHONPATH && python -m pytest tests/test_plugin_api.py -q` | **0** | `164 passed, 6 subtests passed in 9.46s` |
| R4 | `unset PYTHONPATH && python -m pytest tests/test_regenerate.py -q` | **0** | `16 passed, 4 skipped, 3 subtests passed in 61.38s` |
| R5 | `unset PYTHONPATH && python -m pytest tests/test_skin_contract.py -q` | **0** | `5 passed in 1.53s` |
| R6 | `unset PYTHONPATH && python scripts/check-packs.py` | **0** | `skins: 94` / `packs: {'core':30,'cyberpunk':11,'earth':11,'noir':10,'retro':11,'studio':10,'zen':11}` / `categories: {'cobalt':13,'neutral':10,'indigo':8,'amber':8,'gold':8,'persimmon':8,'violet':8,'teal':8,'rose':7,'fern':7,'apricot':5,'lemon':4}` / `OK: contract holds` |
| R7 | `unset PYTHONPATH && python scripts/check-package.py` | **0** | `OK: package contract holds at 2.9.0 (94 skins, 538 tracked files)` |
| R8 | `python` — full YAML schema audit of all 94 skins (keys, types, palette membership vs the canonical 43, hex format, duplicate labels, stem==id, pack/category/energy validity, provenance shape) | 0 | see §5.1–§5.4 |
| R9 | `python` — cross-layer diff: `skins-v2` ↔ embedded `SKINS` in `desktop/plugin.js` ↔ 188 `gateway-skins/*.yaml` ↔ `scripts/packs.json` | 0 | see §5.2, §5.5 |
| R10 | `python` — **determinism**: copied `skins-v2/ gateway-skins/ scripts/ desktop/ docs/ skins/ plugin.yaml VERSION` to a temp tree, ran `scripts/regenerate.py` twice there | 0, 0 | `run1 == run2` (byte-identical `plugin.js`); `plugin.js == committed`; `gateway-skins == committed`; `docs/DERIVED-PALETTES.md == committed` |
| R11 | `python` — **gallery determinism/staleness**: imported `scripts/generate-gallery.py` with `OUTPUT` redirected to temp, ran it | 0 (crashed *after* writing, at the `relative_to` print) | regenerated 931 956 chars, **byte-identical** to the committed `docs/gallery.html` |
| R12 | `node` — **fixture staleness**: recomputed both parity fixtures from the current build into memory, compared byte-for-byte with the committed files | 0 | `scene-theme-parity.json rebuilt===committed : true`; `theme-card-parity.json rebuilt===committed : true`; 27 card cases → 24 distinct digests (3 documented collisions) |
| R13 | `python` — **fault injection of `scripts/check-packs.py`** against a full temp copy of `skins-v2` (13 mutations, one per run) | see §5.6 | the gate **passes (exit 0)** on an unknown palette key, on an invalid hex value, and on a palette compacted to the 21 `KEEP_KEYS`; it **fails (exit 1)** on missing `ui_accent`, unknown pack, missing typography, duplicate label, bad energy, unknown category, bad `design_spec`, bad `schema_version`, bad `provenance.derived`, stem≠id, and a `v2` skin missing surfaces |
| R14 | `python` — **reachability trace of the build**: `sys.settrace` over the real `main()` in a temp tree, recording every `scripts/regenerate.py` function entered | 0 | **18 functions never entered by the build**; their definitions span **363 of 826 lines**; `THEME_PAIRS` (55 rows) and `CATEGORY_PREFIXES` (6 rows) are also never read. See §5.3 |
| R15 | `node` — **editor-row measurement**: rendered the shipped `EDITOR_ROLES` against all 94 catalogue scenes in both modes | 0 | 36 editor rows; **16 rows are empty for every shipped skin in every mode**, and all 16 are rows the UI badges `CLI`. See §5.1 |
| R16 | `node` — per-suite test counts (26 individual `node --test` runs) | 0 | see §4 |

### 3.2 Only READ (no execution)

- `docs/THEME-PACK-CREATION.md` §4 (the 43-role map) — read, not executed.
- `docs/PLANS/CHROMA-SKIN-CONSOLIDATION.md` §4.2/§4.3 — read; §4.2's claim `records=94 checked=94 mismatched=0` is a historical measurement I did **not** re-run (`scripts/migrate-to-skins.py` is a migration tool; running it would write).
- `docs/gallery.html` — read and byte-compared to a regenerated copy (R11), not edited.
- `scripts/classify-skins.py`, `scripts/make-pastel-skins.py`, `scripts/analyse-palettes.py`, `scripts/migrate-to-skins.py`, `scripts/font-register.py` — read only via grep; not executed.
- `hermes plugins validate .` — **not run** (per the brief; local CLI does not start).
- `rigour check --ci` — **not run** (not in the brief's allowed list; would need network/tooling).
- The real Hermes home / gateway skins directory — **never touched**. All gateway work was done on copies.

---

## 4. Test truth table

Legend: **real** = the assertion would fail if the guarded behaviour broke; **tautological** = true by construction; **vacuous** = the asserted value is a literal or the branch condition; **unreached** = the guarded code path is not exercised by the shipped data or the build.

| Suite (file) | n | What it claims to guard | What it actually proves | Verdict |
|---|---:|---|---|---|
| `tests/test_skin_contract.py` | 5 | The skin contract: every shipped skin declares `design_spec`; a `v2` skin carries all ten surfaces in both modes; the catalogue passes its own gate; the gate rejects a `v2` skin missing a surface, a bad `design_spec`, and a `v1` skin's colour noise. | Real — but the **shipped-data half of the loop is unreachable**: all 94 skins are `design_spec: v1`, so lines 41-44 (the ten-surface check) never execute against the catalogue. They *are* exercised by the synthetic `one_skin` fixture in `test_a_v2_skin_missing_a_surface_is_rejected`, so the guard is proven — just not against real data. | **real** (with an `unreached` note on the data branch) |
| `tests/test_regenerate.py` | 16 (+4 skip) | That the shipped catalogue is built correctly, and that the generator is safe. | Mixed. The **safety** tests are real: `RegenerateSafetyTests` drives the real `main()` over a malformed bundle and proves nothing is mutated (`output` and the transport file byte-identical); `RegeneratePreservesOverridesTests` proves a user override never enters the build and survives a rebuild. But **`ThemeCatalogTests` mostly guards code the build never runs** — see F3. `test_every_skin_ships_a_matching_gateway_transport` checks exactly **3 of 21–43** roles, with the comment *"the invariant is the signature roles, not the length"* — so a transport that lost 18 of its roles would still pass. `test_updated_cliff_pack_has_fifty_complete_pairs` asserts `THEME_PAIRS == 55` and that every paired skin ships in the retired `skins/` table — a table the build does not read. | **real** for the safety half; **unreached** for the catalogue half |
| `tests/test_plugin_api.py` | 164 | The backend contract: import/export/rename/delete, hex validation, concurrency, atomicity, packs, categories, overrides, schema. | Real and thorough. It contains the **best cross-layer guard in the repo**: `test_the_pane_can_reach_every_key_the_writer_accepts` (line 767) parses `EDITOR_ROLES` out of the pane template and asserts it equals the backend's 43-key `EDITABLE_SKIN_KEYS`; `test_the_builtin_list_matches_the_pane` (line 1565) pins the backend's 12 category ids to the pane's `THEME_CATEGORIES`. It reads the **template**, not the built `plugin.js` — the build's currency is CI's job (`build-is-current`). | **real** |
| `tests/scene-parity.test.mjs` | 4 | That the scene→Desktop-theme mapper moved no value. | Real: digests of all 94 scenes + 2 full goldens + 7 edge skins + a "same key order, all 6-digit hex" invariant over every scene in both modes. **Caveat:** the fixture pins the *Desktop theme* (26 SDK roles), so it is blind to the 43-key palette underneath. | **real** |
| `tests/theme-card.test.mjs` | 16 | The card's rendered DOM, its manage row, its handlers. | Real and unusually honest: it renders the rename/delete pieces directly because the harness stubs `useState`, and it **invokes** handlers rather than only digesting them (`onClick` → `['rename','ocean-skin',…]`). | **real** |
| `tests/helpers/card-cases.mjs` + `theme-card-parity.json` | 27 cases → 24 digests | The card's DOM per case. | Real, and the file is honest about its own limits (three cases are scene handles, not new coverage). Fixture recomputed byte-identical from the current build (R12). | **real** |
| `tests/element-integrity.test.mjs` | 10 | That no object child in the rendered trees is a raw element (React error #31). | Real — it checks the `$$typeof` marker that the digest-based suites cannot see. | **real** |
| `tests/render-smoke.test.mjs` | 3 | That the build imports every hook it uses, registers, and renders both surfaces. | Real. `importedNames(source)` is derived from the build's own import statements, so a missing hook import fails. | **real** |
| `tests/safe-merge.test.mjs` | 4 | That `safeMerge` / `applyOverride` cannot pollute a prototype. | Real: asserts `Object.prototype.hasOwnProperty.call(merged,'__proto__') === false` and that `{}` is unpolluted. | **real** |
| `tests/theme-persistence.test.mjs` | 40 | Persistence, boot cache, gateway broadcast, apply scope, per-profile races. | Real, and the strongest suite in the repo: the negative assertions matter (`a locally scoped pick must not touch the gateway at all`), and the race tests drive a genuine mount/unmount runtime rather than trusting the harness. It uses its **own** loader (`tests/theme-persistence.test.mjs:9`) instead of `tests/helpers/load-plugin.mjs` — a second loader, so the "one loader" rule has an exception. | **real** |
| `tests/aria.test.mjs` | 13 | ARIA attributes, names, landmarks, tab order. | Real for what it asserts, and the file states plainly what it cannot see (focus, Tab trap, live-region text after a state change). | **real** |
| `tests/theme-chip-mode.test.mjs` | 3 | The statusbar lightbulb repaints every dynamic scene. | Real, and broad: it loops all 94 dynamic scenes, not a sample. | **real** |
| `tests/theme-categories.test.mjs` | 5 | The category lens: twelve shelves, in order, every scene in exactly one, every shelf non-empty. | Real; it uses the shipped `sceneCategory` with no hand-stub. | **real** |
| `tests/pack-default.test.mjs` | 10 | The default shelf is exactly 30 core skins; a missing pack list opens nothing; the choice persists; the empty state names the right cause. | Real — including the hostile inputs (`undefined`, `null`, `'retro'`, `0`) and a corrupt store. | **real** |
| `tests/pack-filter-gate.test.mjs` | 5 | The pack control follows the data; every pack is offered with its count; the lens partitions the catalogue. | Real — it *mutates* `t.SKINS` to strip `pack` and asserts the button disappears, then restores it. | **real** |
| `tests/favorites.test.mjs` | 6 | Favourites survive a hostile store; the star is a real control; the rail resolves only real names. | Real. | **real** |
| `tests/preview-pill.test.mjs` | 10 | The preview is a 10 s click, not a hover. | Real; the "no hover preview" guard greps the built file. | **real** |
| `tests/skin-boundary.test.mjs` | 3 | One malformed skin must not white-screen the picker. | Real; it injects a `null`-named skin into `IMPORTED_SKINS` and asserts the warning fires. | **real** |
| `tests/surfaces-regression.test.mjs` | 9 | The six public surfaces still exist. | Real for the five surfaces it asserts; the theme-catalog check is `themes.length > 50` (actual 94) — loose, but the exact 94 is pinned elsewhere (`theme-categories`, `scene-parity`). | **real** |
| `tests/desktop-theme-api.test.mjs` | 2 | The provider slot survives one consumer unmounting. | Real; it drives a minimal mount/unmount runtime. | **real** |
| `tests/import-truth.test.mjs` | 5 | The UI never claims an import succeeded when the gateway mint failed. | Real, and it also greps the built file for `.catch(() => null)`. | **real** |
| `tests/import-formats.test.mjs` | 11 | The four import formats parse to the shape the backend writer consumes. | Real; the fixtures are real-shaped Campbell / Base16 flat / Base16 tinted / VS Code JSON, and the iTerm2 refusal is asserted by name. | **real** |
| `tests/tweakcn-import.test.mjs` | 16 | TweakCN URL/CSS import, name shadowing, CLI capability. | Real. The "shipped catalog carries gateway transports" check is `capable.length > 50` (actual 94) — loose but true. | **real** |
| `tests/export.test.mjs` | 4 | The export artefact mapping. | Real, but it only ever tests a **hand-written payload** — never a payload the backend produced. The round-trip claim in `docs/SPEC.md:55` ("YAML is byte-for-byte what the importer writes, so a round trip holds") is proven on the Python side (`test_exports_one_skin_as_reimportable_yaml`), not here. | **real** |
| `tests/editor-categories.test.mjs` | 32 | User categories: resolution order, shelf ordering, drift notice, REST transport. | Real, but one test is **vacuous**: `buildGroups: non-theme mode ignores userCategories` (line 157) passes the mode string `'hue'`, which is not one of `GROUP_MODES = ['scene','theme','pack']`, so `buildGroups` falls through to the default branch. The assertion is trivially true for *any* non-theme input. The real modes `'scene'` and `'pack'` are never tried. | **real** except line 157 (**vacuous**) |
| `tests/editor-modal.test.mjs` | 13 | The editor's layout: zones, role rows, contrast read-outs, actions. | Real. | **real** |
| `tests/editor-packs.test.mjs` | 12 | The fork action, the bundle format, the missing-member warning. | Real; it renders `PackRow` and asserts the warning is in the tree. | **real** |
| `tests/editor-role-application.test.mjs` | 5 | Every editor role reaches the applied theme. | The core assertions are real and **bidirectional** (a `desktop:true` role must repaint; a `desktop:false` role must not). But line 83 is **tautological**: inside `if (role.desktop === false) { assert.ok(role.desktop === false, …) }` — it re-asserts the branch condition. The claim in the comment ("The row must say CLI, or the edit looks like it did something it did not do") is therefore **not** proven by that line, and no test anywhere asserts the editor's `CLI` badge is rendered. | **real** core; line 83 **tautological** |
| `tests/editor-save.test.mjs` | 8 | The save door, the schema consumption, schema drift. | Real. | **real** |
| `tests/editor-typography.test.mjs` | 17 | Typography overrides, emoji fallback, boot survival. | Real; the boot test asserts `register()` returns no promise, which is a real contract. | **real** |
| `tests/safe-merge`, `element-integrity`, `export`, `import-*`, `editor-*` — see above | — | — | — | — |

**Totals:** 26 JS suites / 266 tests / 0 fail; 3 Python suites / 185 pass / 4 skip. **2 tautological-or-vacuous assertions** found (`editor-role-application.test.mjs:83`, `editor-categories.test.mjs:157`). **1 suite whose catalogue half is unreachable** (`test_regenerate.py`'s `ThemeCatalogTests`).

---

## 5. Findings

### F1 — `major` — 16 of the 43 documented colour roles are authored in `skins-v2/` and shipped **nowhere**
`file:line`: `scripts/regenerate.py:45-55` (KEEP_KEYS), `scripts/regenerate.py:548-553` (the compaction), `scripts/regenerate.py:718` (the transport is minted from the *compacted* catalogue).
Quoted: `KEEP_KEYS = { "background", "status_bar_bg", "ui_text", "banner_text", "status_bar_text", "ui_accent", "banner_accent", "banner_title", "ui_border", "banner_border", "banner_dim", "session_border", "ui_error", "ui_ok", "ui_warn", "ui_tool", "completion_menu_bg", "prompt", "shell_dollar", "input_rule", "response_border" }` — and `light_out = light if "light" in derived else { k: v for k, v in light.items() if k in KEEP_KEYS }`.

**Failure mode.** `_load_v2_skins` compacts every *authored* mode down to the 21 `KEEP_KEYS`, and `_write_gateway_transport_skins` mints the 188 gateway files from that already-compacted catalogue. Measured (R9/R15):
- 43 canonical roles are authored across `skins-v2/`; **27** reach the built `desktop/plugin.js`; **27** reach the 188 transports; **16 reach neither**.
- The 16 never-shipped roles are `syntax_comment`, `syntax_keyword`, `syntax_number`, `syntax_string`, `diff_added`, `diff_added_word`, `diff_removed`, `diff_removed_word`, `ui_thinking`, `selection_bg`, `voice_status_bg`, `ui_label`, `status_bar_dim`, `status_bar_strong`, `status_bar_bad`, `completion_menu_meta_current_bg`.
- **9 of them are authored by all 94 skins** (the 8 syntax/diff keys plus `ui_thinking`); the other 7 by 40 skins each. So this is not a "40 ported halves" artefact — it is every skin.
- The editor renders **16 permanently-blank rows** for every shipped skin in every mode (16 empty on 40 scene/mode pairs, 22 on 50, 23 on 98), and every one of those 16 rows is rendered with a **`CLI` badge** whose tooltip reads *"The CLI paints with this colour."* (`desktop/plugin.template.js:3865-3871`).
- The shipped contract doc says the opposite, twice: `docs/THEME-PACK-CREATION.md:119` — *"the CLI paints from all 43"*; and `:511-513` — *"**29 of the 43 keys do not repaint the Desktop window.** The CLI reads all 43. … A user editing `syntax_comment` changes the CLI and nothing else; the badge is the honest answer."*
- The backend agrees with the doc, not the build: `dashboard/plugin_api.py:1156-1180` (`_authored_scene`) reads a built-in's authored palette **from its gateway transport file**, so the backend's own view of a built-in is the compacted 21/27-key palette — the 43-key source in `skins-v2/` is unreachable through the API.
- `docs/PLANS/CHROMA-SKIN-CONSOLIDATION.md:84-92` records the deferral (*"40 skins ship a ported half that lacks 16 roles … accept now, complete at P6"*), but understates the blast radius (94/94 lose 9 roles, not 40/94 lose 16) and is a plan doc, not the normative contract `docs/SPEC.md:72` points a skin author at.

**Smallest correct fix (choose one; the first is the honest minimum).**
(a) *Say what is true.* Change `docs/THEME-PACK-CREATION.md:119` and `:511-513` to state that the build ships 21–27 of the 43 roles and that the CLI inherits the rest, and change the editor's badge tooltip so it no longer claims "The CLI paints with this colour" for a role the shipped catalogue does not carry.
(b) *Ship what is claimed.* Mint the gateway transports from the **uncompacted** palette (pass the raw `light_colors`/`dark_colors` to `_write_gateway_transport_skins` rather than `scene[f"{mode}Colors"]`), and stop compacting the catalogue entry — a one-line change in `_load_v2_skins`.
Either way, add a test that fails today: assert that every one of the 43 `EDITABLE_SKIN_KEYS` appears in at least one shipped transport, or that the transport's key set equals the skin's key set.

### F2 — `major` — `scripts/packs.json` is **not** an ignored legacy file: it is read by the shipped gallery generator, and it is wrong
`file:line`: `scripts/generate-gallery.py:23`, `scripts/generate-gallery.py:63-68`, `scripts/generate-gallery.py:216-234`.
Quoted: `PACKS_PATH = ROOT / "scripts" / "packs.json"` and `def pack_order() -> tuple[list[dict], dict[str, dict]]: data = load_json(PACKS_PATH); declared = list((data.get("packs") or {}).values())`.

**Failure mode.** The brief's premise ("not read by the build since 2.6.0") is only half true: `regenerate.py` does not read it, but `generate-gallery.py` does, for pack **order and titles**. Two consequences, both observable in the committed artefacts:
1. `packs.json` declares six packs and **omits `studio`**. `group_by_pack` therefore pushes the 10 studio skins through the leftover branch (`generate-gallery.py:227-233`), which synthesises `{"id": "studio", "title": "Studio", "description": ""}`. The committed `docs/gallery.html` proves it: the `core`, `earth`, `cyberpunk`, `zen`, `retro` and `noir` sections each carry a `<p class="pack-description">`; the `studio` section carries **none**.
2. The file's `members` arrays are a lie about the catalogue. Measured (R9): 36 distinct member ids, **27 of which do not exist in `skins-v2/`**; only 9 survive. `core` lists **33** members against its own `target_size: 30` and against the gate's `CORE_TARGET = 30`. The stale ids (`earth-brown`, `minimal-white`, `vibrant-red`, `pastels-pink`, `muted-ink`, `cool-ice`, …) are names from a pre-consolidation catalogue. `docs/PLANS/CHROMA-PACKS.md:53` still describes the file as *"the pack model in the generator (`scripts/regenerate.py` + a `scripts/packs.json` table)"* — a statement that is false today.

**My answer to the brief's question ("argue whether a stale file that the build ignores should ship at all"): it should not ship, and the premise is wrong.** A file the build ignores can be deleted for free; this one is *read* by a shipped generator, it is missing a live pack, and 27 of its references dangle. Any reader who trusts it — a new contributor, a reviewer, a future generator — is reading a catalogue that no longer exists.

**Smallest correct fix.** (i) Add the `studio` pack to `packs.json` with a title and description; (ii) delete the `members` arrays (nothing reads them — `check-packs.py` reads the skins' own `pack:` field, and the gallery reads membership from the YAML too), or regenerate them from `skins-v2/`; (iii) regenerate `docs/gallery.html` and add `docs/gallery.html` to CI's `build-is-current` diff list (currently `-- desktop/plugin.js gateway-skins docs/DERIVED-PALETTES.md` only); (iv) fix `docs/PLANS/CHROMA-PACKS.md:53,188` to say where packs live *now*.

### F3 — `major` — `tests/test_regenerate.py` guards 363 lines of generator code that the build never executes
`file:line`: `scripts/regenerate.py:778` (`catalog = user_skins`), `tests/test_regenerate.py:114-240` (`ThemeCatalogTests`).
Quoted: `scripts/regenerate.py:778` — `catalog = user_skins` (no `_build_catalog` call anywhere in `main`).

**Failure mode.** Measured with a `sys.settrace` over the real `main()` (R14): the build enters `_load_v2_skins`, `_write_derivation_report`, `_write_gateway_transport_skins`, `_contrast`, `_hex_channels`, `_linearise`, `_wcag_luminance`, `resolve_hermes_home` — and **never** enters 18 other functions: `_backend_builtins`, `_build_catalog`, `_delinearise`, `_desktop_builtin_scenes`, `_dynamic_scene`, `_luminance`, `_make_dynamic`, `_mode_support`, `_nudge_contrast`, `_oklab_to_rgb`, `_oklch`, `_oklch_hex`, `_parse_skin_file`, `_port_palette`, `_preview`, `_rgb_to_hex`, `_rgb_to_oklab`, `_single_scene`. Their definitions span **363 of the generator's 826 lines**; the `THEME_PAIRS` table (lines 59-116, 55 pairs) and `CATEGORY_PREFIXES` are never read either.

Yet `tests/test_regenerate.py` is green, and six of its tests exercise exactly that dead code:
- `test_desktop_builtins_are_the_expected_dynamic_scenes` and `test_desktop_builtins_have_concrete_gateway_variant_names` assert that the 8 Desktop built-ins (`nous`, `midnight`, `ember`, `mono`, `cyberpunk`, `rose`, `shadow-thief`, `hermes-teal`) are dynamic scenes with gateway variant names. **None of the 8 is in the shipped catalogue** (the embedded `SKINS` contains `"name":"nous"` **0** times) and **no transport file exists for any of them** — `gateway-skins/` has `theme-picker-midnight-studio-*` but nothing for `nous`. The test reads as catalogue coverage and is not.
- `test_backend_builtins_are_pinned_without_importing_hermes` pins 9 backend built-ins (`default`, `ares`, `mono`, …) — `main()` hardcodes `builtins: list[dict] = []` and never calls `_backend_builtins()`.
- `test_updated_cliff_pack_has_fifty_complete_pairs` asserts `len(THEME_PAIRS) == 55` and that every paired skin ships in the retired `skins/` table — a 150-file, 664 KB directory the build does not read (and which `test_cliffwade_v1_1_0_files_match_the_pinned_hash_manifest` also guards).
- `test_daylight_and_warm_lightmode_are_light_only` pins `_mode_support('daylight', True)` — `daylight` is not in the catalogue either.

**Failure mode, stated plainly:** a green `tests/test_regenerate.py` is evidence about a generator that no longer exists. It gives a reviewer false confidence that the 94-scene catalogue is assembled by `_build_catalog`/`THEME_PAIRS`/pair-collapsing, when it is assembled by one line: `_load_v2_skins` → `catalog = user_skins`.

**Smallest correct fix.** Either (a) delete the 363 dead lines, the 55-row `THEME_PAIRS`, `CATEGORY_PREFIXES` and the retired `skins/` tree, and delete the five tests that guard them; or (b) keep them and rename the suite so it cannot be read as catalogue coverage. Option (a) is strictly better: it removes 363 lines from a file that is already past the 500-line gate. Add one test that *does* pin the shipped shape — "the built catalogue has exactly one entry per file in `skins-v2/`, with the id, pack, category and typography of that file" — which is what the suite currently lacks.

### F4 — `major` — the CI data gate cannot see a broken palette: it accepts invalid hex, unknown keys, and the 21-key compaction
`file:line`: `scripts/check-packs.py:86-93`.
Quoted:
```python
for mode in ("light_colors", "dark_colors"):
    palette = data.get(mode)
    if not isinstance(palette, dict) or not palette:
        failures.append(f"{name}: missing {mode}")
    elif not palette.get("background"):
        failures.append(f"{name}: {mode} has no background")
    elif not palette.get("ui_accent"):
        failures.append(f"{name}: {mode} has no ui_accent")
```

**Failure mode.** `check-packs.py` is what CI runs as *"The catalogue obeys its own contract"* (`.github/workflows/ci.yml:34-35`), and it is the only data gate in the repo. Fault injection against a full temp copy of `skins-v2` (R13) shows it **exits 0** on:
- a palette carrying an **unknown key** (`totally_bogus_key: '#ff0000'`) — the `v1` branch checks only truthiness, and `v2` checks only the ten surfaces' *presence*;
- a palette carrying an **invalid colour** (`background: 'not-a-colour'`) — the gate never validates a hex at all, even though the backend's `_hex` accepts only `#rrggbb`/`#rgb` (AGENTS.md §3.7) and the whole editor/import pipeline depends on it;
- a palette **compacted to the 21 `KEEP_KEYS`** — precisely the transformation the build performs (F1). The gate is blind to the very defect the build causes.

It correctly exits 1 on missing `ui_accent`, unknown pack, missing typography, duplicate label, bad `energy`, unknown category, bad `design_spec`, bad `schema_version`, bad `provenance.derived`, stem≠id, and a `v2` skin missing surfaces — so the gate is real, just narrow.

**The shipped data is clean** (R8): 0 colour values that are not `#rgb`/`#rrggbb`, 0 three-digit hexes, 0 palette keys outside the canonical 43, 0 unknown top-level keys, all 12 required top-level keys present in all 94 files, all 94 `file stem == id`. **This finding is a gate gap, not a data defect** — but it means the CI job that the CI file advertises as *"a skin that loses a palette … fails here instead of shipping"* cannot detect a skin whose palette is malformed.

**Smallest correct fix.** In `check-packs.py`, extend the per-mode branch to (i) reject any palette key not in the canonical 43, (ii) reject any value that is not `#rgb`/`#rrggbb`, and (iii) for `v1` skins, assert the palette's key set is a **superset of the 21 `KEEP_KEYS`** — or, better, assert the *shipped* key set (what actually reaches the catalogue/transport) matches what the source file declares, which is the F1 fix's regression test.

### F5 — `minor` — `scripts/taxonomy.json`'s recorded measurements name a category the catalogue does not have
`file:line`: `scripts/taxonomy.json:96-111`.
Quoted: `"measured": { "catalogue": 94, "counts": { …, "violet": 8, "magenta": 7, "neutral": 10 } }`.

**Failure mode.** The `families` array and the whole product use **`rose`** for the 322°–362.8° family (7 skins). The `measured.counts` block still records the pre-reconciliation name **`magenta`** for those 7 skins and has no `rose` key. The file's own `naming.divergences[0]` explains the rename, so the block is simply stale. Nothing reads `measured` today (grep: only `taxonomy["families"]` and `taxonomy["neutral"]["id"]` are read, by `check-packs.py` and `generate-gallery.py`), so nothing breaks — but it is a shipped data file whose numbers are wrong, and the *other* eleven counts are exactly right, which makes the wrong one look deliberate.

**Smallest correct fix.** `"magenta": 7` → `"rose": 7` in `scripts/taxonomy.json`. One character-class edit; no behaviour change.

### F6 — `minor` — `docs/SPEC.md` states the wrong plugin version
`file:line`: `docs/SPEC.md:10`.
Quoted: `` `plugin.yaml`: name `chroma`, version `2.8.1` (matching `VERSION`). The repo root IS the plugin package. ``

**Failure mode.** `VERSION` is `2.9.0` and `plugin.yaml` is `2.9.0`; `scripts/check-package.py` prints `OK: package contract holds at 2.9.0` because it checks `VERSION`, `plugin.yaml`, `dashboard/manifest.json` and the `BUILD_STAMP` in `desktop/plugin.js` — but it does not look at `docs/SPEC.md`, so the drift is invisible to the gate. `docs/SPEC.md` is the document a reviewer reads first.

**Smallest correct fix.** `2.8.1` → `2.9.0` in `docs/SPEC.md:10`. Optionally add `docs/SPEC.md` to `check-package.py`'s version loci.

### F7 — `minor` — a tautological assertion stands where a real one is claimed
`file:line`: `tests/editor-role-application.test.mjs:80-85`.
Quoted:
```js
if (role.desktop === false) {
  // Not a promise about the preview: a promise about the label. The row must
  // say CLI, or the edit looks like it did something it did not do.
  assert.ok(role.desktop === false, `${role.id}: a colour this window does not read must say so`)
  continue
}
```

**Failure mode.** The assertion re-checks the condition of the branch it is in: it is true by construction, for every role, forever. The claim in the comment — *"the row must say CLI"* — is a claim about the **rendered** editor row, and the rendered row's `CLI` badge (`desktop/plugin.template.js:3865-3871`) is asserted by **no test anywhere in the repo** (grep for `'CLI'` in `tests/*.test.mjs` finds only the card-level `CliBadge` in `theme-card.test.mjs:337`). So the one line that claims to guard the badge guards nothing, and the badge is exactly where F1's user-visible lie lives.

**Smallest correct fix.** Render the row and assert the badge: `assert.ok(textsIn(digestElement(helpers.EditorRoleRow({...}))).includes('CLI'))` for a `desktop:false` role, and `assert.ok(!…includes('CLI'))` for a `desktop:true` role. `EditorRoleRow` is already exported by the harness (`tests/helpers/load-plugin.mjs:98`).

### F8 — `minor` — a second vacuous branch: a group mode that does not exist is used to prove a group mode's behaviour
`file:line`: `tests/editor-categories.test.mjs:157-163`.
Quoted:
```js
test('buildGroups: non-theme mode ignores userCategories', async () => {
  …
  const groups = t.buildGroups(scenes, 'hue', cats)
  assert.ok(!groups.find(g => g.id === 'custom'), 'user shelf does not appear in hue mode')
})
```

**Failure mode.** `GROUP_MODES` is `['scene', 'theme', 'pack']` (`theme-persistence.test.mjs:430`); `'hue'` is not a mode. `buildGroups` (`desktop/plugin.template.js:2566-2570`) falls through to `buildThemeGroups` for any unrecognised string, so the assertion holds for *every* possible non-theme input and proves nothing about the two modes that actually exist. (The neighbouring assertion in `theme-persistence.test.mjs:388` uses `'nonsense'` for the same purpose and is honest about it — it is checking the fallback, not a mode.)

**Smallest correct fix.** Use the real modes: assert `'scene'` and `'pack'` also drop the user shelf, e.g. `for (const mode of ['scene', 'pack']) assert.ok(!t.buildGroups(scenes, mode, cats).find(g => g.id === 'custom'))`.

### F9 — `minor` — the shipped gallery is a generated artefact with no staleness gate
`file:line`: `.github/workflows/ci.yml:81`.
Quoted: `run: git diff --exit-code -- desktop/plugin.js gateway-skins docs/DERIVED-PALETTES.md`

**Failure mode.** `docs/gallery.html` (932 KB, tracked) is generated from `skins-v2/` + `scripts/packs.json` + `scripts/taxonomy.json` and is **not** in the CI diff list, so it can drift silently. Today it is *not* drifted — I regenerated it into a temp file and it is byte-identical to the committed file (R11). But F2's `studio` description gap shows the generator's output is already uneven, and nothing would catch a future drift.

**Smallest correct fix.** Add `docs/gallery.html` to the CI `git diff --exit-code` list, and regenerate it in the same step.

### F10 — `minor` — the retired `skins/` table ships 150 files that nothing reads, and two tests guard it
`file:line`: `skins/` (150 tracked files, 664 KB), `tests/test_regenerate.py:197-213`.
Quoted: `def test_updated_cliff_pack_has_fifty_complete_pairs(self):` … `self.assertEqual(len(regenerate.THEME_PAIRS), 55, 'the vendored pack pair list')` and `self.assertEqual(paired - available, set(), 'every paired skin is shipped')` where `available` comes from the retired `skins/` directory.

**Failure mode.** `regenerate.py` reads `skins-v2/` only (`scripts/regenerate.py:768-770`: *"The catalogue is skins-v2 … there is no fallback to it"*). The `skins/` directory is a dead 150-file table that ships in the plugin package, and two passing tests read it, which makes the dead tree look load-bearing. `scripts/regenerate.py:756` still computes `default_skins = repo_skins if repo_skins.is_dir() else home / "skins"` — a variable used only in an error message (`:785`) that would point the reader at the retired directory.

**Smallest correct fix.** Delete `skins/`, `scripts/cliffwade-v1.1.0-sha256.json`, the two tests that guard them, and the `default_skins` variable — all part of the same cleanup as F3. (Note: `scripts/check-package.py` reports "538 tracked files"; that number will change.)

### F11 — `minor` — the gateway-transport guard checks 3 of the roles it should be guarding
`file:line`: `tests/test_regenerate.py:136-147`.
Quoted:
```python
palette = skin[f'{mode}Colors']
for role in ('background', 'ui_accent', 'ui_text'):
    self.assertEqual(transport['colors'][role].lower(), palette[role].lower())
```
with the comment at `:161-162`: *"Authored halves are compacted in one place and whole in the other, so the invariant is the signature roles, not the length."*

**Failure mode.** The test is named *"every skin ships a matching gateway transport"* and it proves that the transport's three headline colours match. It cannot see that 18 further roles are missing from the transport, because the transport was minted from an already-compacted catalogue — the comparison is catalogue-vs-catalogue, so it is **true by construction for exactly the roles it checks**. This is the specific mechanism by which F1 stayed invisible. (The second transport test, `:149-168`, has the same three-role limit; it does add a genuine uniqueness + file-count check.)

**Smallest correct fix.** Assert the transport's key set equals the source skin's key set for the mode (`set(transport['colors']) == set(source_palette)`), reading the source from `skins-v2/` rather than from the compacted catalogue entry. That assertion fails today, which is the point.

### Coverage gaps — user-visible behaviours with **no** test
1. **The 16 never-shipped roles in the editor.** No test asserts the editor's row values, so nobody notices that 16 rows are blank for every shipped skin (F1/F7).
2. **The editor's `CLI` badge.** Rendered at `desktop/plugin.template.js:3865-3871`; asserted by no test (F7).
3. **`docs/gallery.html`.** Not in CI's build-is-current diff; not asserted anywhere (F9). Today it happens to be in sync.
4. **`scripts/packs.json`.** No test reads it. `check-packs.py` reads the skins' own `pack:` field; `generate-gallery.py` reads only the titles. Its `members` arrays are therefore entirely untested — and 27/36 of them are dangling (F2).
5. **`scripts/taxonomy.json`'s `measured` block.** No test reads it; its `magenta` entry is wrong (F5).
6. **The `studio` pack's gallery description.** No test compares pack sections for shape; the `studio` section is visibly missing its description (F2).
7. **A palette-value round trip through the catalogue.** `tests/export.test.mjs` only tests hand-written export payloads; the "byte-for-byte what the importer writes" round-trip claim in `docs/SPEC.md:55` is proven on the Python side only.
8. **The number of registered themes.** `surfaces-regression.test.mjs:156` asserts `themes.length > 50` (actual 94); the exact 94 is pinned elsewhere, so this is a gap in the *surface* guard rather than the product.

### Cross-layer agreement — measured, and it is clean where it matters
| Layer | Count | Agreement |
|---|---:|---|
| `skins-v2/*.yaml` | 94 | — |
| Embedded `SKINS` in `desktop/plugin.js` | 94 | name set **identical** to `skins-v2` (0 orphans either way); `label`, `description`, `category`, `pack`, `energy`, `typography.fontSans`, `typography.fontMono` — **0 mismatches** across all 94 |
| `gateway-skins/*.yaml` | 188 | exactly 2 per skin; **0** skins without a transport; **0** transports without a skin; every transport's `colors` **identical** to the corresponding catalogue entry (0 mismatches) |
| Packs (from YAML) | 7 | core 30, cyberpunk 11, earth 11, noir 10, retro 11, studio 10, zen 11 = 94; matches `CORE_TARGET=30` and the 10–20 band |
| Categories (from YAML) | 12 | cobalt 13, neutral 10, indigo 8, amber 8, gold 8, persimmon 8, violet 8, teal 8, rose 7, fern 7, apricot 5, lemon 4 = 94; all 12 taxonomy ids used, none empty, none unknown |
| Duplicate labels | **0** | exact and normalised (lowercase, alphanumeric-stripped) |
| File stem == `name` | 94/94 | — |
| Colour format | 0 violations | every value in `skins-v2/` and every value in the 188 transports is `#rrggbb`; no 3-digit hex |
| Palette keys vs the canonical 43 | 0 violations | no key outside the 43; all 43 present somewhere in `skins-v2/`; **16 present nowhere downstream** (F1) |

### Determinism — verified, twice
- `scripts/regenerate.py`: run 1 == run 2 (byte-identical `plugin.js`); run 1 == the committed `desktop/plugin.js`; the regenerated `gateway-skins/` == the committed 188 files; the regenerated `docs/DERIVED-PALETTES.md` == the committed file.
- `scripts/generate-gallery.py`: regenerated output == the committed `docs/gallery.html`, byte for byte (931 956 chars).
- Both parity fixtures: recomputed from the current build == the committed JSON, byte for byte. **No fixture is stale.**

---

## 6. The embarrassing section

Three things that would embarrass us publicly here.

**1. The contract document we tell skin authors to follow is false about our own product.**
`docs/THEME-PACK-CREATION.md:119` — *"the CLI paints from all 43"* — and `:511-513` — *"The CLI reads all 43 … A user editing `syntax_comment` changes the CLI and nothing else; the badge is the honest answer."*
Measured: the CLI receives **27** roles, and for the 8 syntax/diff keys and `ui_thinking` it receives **none** — although **all 94 skins author them**. A skin author who follows our documentation and authors `syntax_comment` produces a colour that reaches neither the window nor the CLI. And our own editor, on every one of the 94 shipped skins, shows 16 permanently-blank rows each carrying a tooltip that says *"The CLI paints with this colour."* That is the sentence we would have to read out loud.

**2. A green `tests/test_regenerate.py` is evidence about a generator we deleted.**
Eighteen functions and 363 of `regenerate.py`'s 826 lines are never executed by the build (proven by tracing the real `main()`), including `_build_catalog`, `THEME_PAIRS` (55 pairs), `_desktop_builtin_scenes` (8 built-ins that are in no catalogue and have no transport file) and `_backend_builtins` (9 names that ship nothing). Six passing tests exercise exactly that dead code, and one of them — *"the desktop builtins are the expected dynamic scenes"* — asserts the existence of eight scenes the product does not contain. Anyone reviewing our test coverage, or trusting that suite to tell them how the catalogue is built, is being misled by our own green.

**3. Our CI advertises a data gate that cannot see a broken palette.**
`check-packs.py` is the only data gate in CI, and by direct fault injection it **passes** a palette containing an unknown key, a palette containing `background: 'not-a-colour'` (the backend accepts only `#rrggbb`/`#rgb`), and a palette compacted to 21 keys — the exact transformation the build performs. It is also the gate that cannot see the 16-role drop, because the drop is invisible to it by construction. So the CI step the workflow file describes as *"a skin that loses a palette … fails here instead of shipping"* would not fire for the one palette defect our product actually has.

---

**Total findings: 4 major, 7 minor. 0 blockers.**

The data itself is in genuinely good shape — 94 skins, 188 transports, zero orphans, zero duplicate labels, zero malformed colours, four layers in exact agreement, byte-identical regeneration, and two fixtures that are not stale. Nothing here says "the catalogue is broken". The HOLD is for three specific, cheap-to-fix things: a normative document that states a falsehood about what we ship (F1), a stale file that is read by a shipped generator and missing a live pack (F2), and a test suite plus a CI gate that are green about the wrong things (F3, F4).

**Closing line: 4 major, 7 minor, 0 blocker.**
