# Adversarial review triage — 2026-10-17

Three independent read-only lanes reviewed commit `e8071a7` (2.4.1) on disjoint axes:

- **A** — desktop pane: correctness, state, async, races, resource safety → `ROAST-A-findings.md`
- **B** — Python backend: integrity, hostile input, concurrency, data loss → `ROAST-B-findings.md`
- **C** — contract, product truth, registry readiness → `ROAST-C-findings.md`

All three returned **HOLD**. Every finding below was re-verified against the tree by the
maintainer before it was accepted; anything not re-verified is marked.

---

## 1. Blocks a catalog submission

These are the findings that must be closed before the plugin is offered to anyone.

| # | Finding | Source | Verified | Why it blocks |
|:--|:--|:--|:--|:--|
| B1 | **Unguarded index read-modify-write + one fixed temp name** (`index.json.tmp`). Two concurrent imports: one provenance entry lost, and a `WinError 32` on the shared temp file → HTTP 500. | B | Yes — reproduced by the reviewer | A skin loses its provenance and becomes unmanageable. Two Desktops is a normal case, not an edge. |
| B2 | **A corrupt or unreadable index is replaced by `{}` and then persisted.** `_read_index` maps `OSError`/`ValueError` → `{}` (`plugin_api.py:100-107`); the next import writes that empty dict back. | B | Yes — read the code | A truncated file, a Windows lock or an AV touch silently destroys the whole provenance index. This is data loss, not a bug. |
| C1 | **The README sells a different product.** `README.md:51-52` promises "140 skin palettes, 57 Dynamic Themes plus dark-only and light-only scenes"; the build ships **109 scenes, all `dynamic`**, from 150 bundled skin files, and `README.md:34` itself says single-mode skins do not exist. | C | Yes | The first thing a stranger reads is false in three ways. |
| C2 | **A failed import reports success.** `importTweakcn` catches the backend failure and still raises an "Imported …" toast (`plugin.template.js:2182, 2191`); on a backend-less install the manage buttons simply vanish (`:2048`). | C | Partly — mechanism read; toast text confirmed | The UI tells the user a lie. This is the single most corrosive defect in the product. |
| C3 | **No 2.x release exists.** Latest tag is `v1.5.1`; `VERSION` is 2.5.0. | C | Yes | The catalog expects real releases; an untagged version cannot be pinned or installed by `--ref`. |

## 2. Should fix before submission

| # | Finding | Source |
|:--|:--|:--|
| A1 | Shared `desktopThemeApi` slot is nulled by any consumer's unmount, silently disabling the provider handoff and reverting the theme. **Fix in flight.** | A |
| A2 | No error boundary: one malformed stored skin white-screens the entire picker. **Fix in flight.** | A |
| A3 | Stale Desktop boot cache outranks our registration; the repair guard compares `"Deep-void"` to `"Deep Void"` and never fires. **Fix in flight.** | A |
| B3 | `_hex` accepts non-hex (`#zzzzzz`, `#12 456`, `#fffffé`) — contradicts the documented contract, and **has no test at all**. | B |
| B4 | No request-size cap; `theme: dict[str, Any]` is unbounded. | B |
| B5 | Windows reserved device names (`con`, `nul`, `com1`…) pass the slug allowlist (`con.yaml` is reserved on Windows). | B |
| B6 | Import can leave an orphan file when the index write fails, and every filesystem error is a bare 500 with no user-meaningful message. | B |
| C4 | No enable step in the install docs — the desktop half is opt-in, so a stranger following the README sees nothing. | C |
| C5 | The Windows installer's destination disagrees with the README (`plugins/chroma` vs `desktop-plugins/chroma`) and needs a full restart; the README says reload. | C |
| C6 | The repo's own "we only write `chroma-*` keys" rule is false — the code writes five `hermes-desktop-*` keys. Contradicted by `AGENTS.md`, `SPEC.md:71`, `ARCH.md:72`, `DECISIONS.md` §11. | C |
| C7 | Version divergence: `dashboard/manifest.json:6` says 2.0.0, `SPEC.md:10` says 2.0.0, `VERSION` says 2.5.0. | C |
| C8 | Committed junk: `.hermes-tmp.Qw7TB7` is tracked in git. | C |
| C9 | Zero ARIA in the pane; the 2 x 6 swatch carries meaning in colour only. | C |
| C10 | `dashboard/manifest.json` points at a `dist/index.js` that does not exist (gitignored). | C |

## 3. Accepted, with a reason

| Finding | Decision |
|:--|:--|
| `rigour check --ci` FAIL 18 / 39-100 | The 16 are pre-existing debt and documented false positives (the SDK is host-provided, not an npm dep). The 2 new `logic-drift` HIGHs are the deliberate re-cut of the hue bands in 2.5.0. To be paid by rewriting `sceneCategory` as a hue-band table, which removes both the mutated operators and the complexity. **Not to be silenced with an allowlist.** |
| `plugin.js` is a large generated artifact | By design: the desktop loads uncompiled ESM. Never hand-edited, always regenerated. |
| Seven scenes lack a canonical `background` key | Real, small, tracked separately: `ares`, `slate`, `poseidon`, `sisyphus`, `charizard` (dark), `daylight`, `warm-lightmode` (light). |
| 218 transport files at the top of `skins/` | Deliberate: the CLI resolves a skin by file name. Reviewed as arguably untidy, not unsafe. |

## 4. Order of work

1. **Bug round 2** (in flight): A1, A2, A3 — each with a failing assertion first.
2. **Backend integrity**: B1, B2, then B3–B6 with the failure-path tests the suite is missing (there is no `_hex` test, no concurrent-write test, and nothing that distinguishes `_atomic_write_text` from a plain write).
3. **Product truth**: C1, C2, C7, C8, then C4, C5, C6 — the README rewritten to what the build actually does, the code aligned to the documented key rule, versions unified.
4. **Release mechanics**: C3 (tag 2.5.x on the shipped commit), C10.
5. **Accessibility**: C9.
6. **Cleanup**: `sceneCategory` band table (pays the two `logic-drift` HIGHs); the seven missing `background` keys.

Submission gate: sections 1 and 2 empty, every remaining item either closed or written into §3 with a
reason. Until then the honest answer to "is it ready for the registry" is **no**.
