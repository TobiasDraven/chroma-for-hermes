# Adversarial review triage — 2026-10-17 (closing pass 2026-10-18)

Three independent read-only lanes reviewed commit `e8071a7` (2.4.1) on disjoint axes:

- **A** — desktop pane: correctness, state, async, races, resource safety → `ROAST-A-findings.md`
- **B** — Python backend: integrity, hostile input, concurrency, data loss → `ROAST-B-findings.md`
- **C** — contract, product truth, registry readiness → `ROAST-C-findings.md`

All three returned **HOLD**. Every finding below was re-verified against the tree by the
maintainer before it was accepted; anything not re-verified is marked.

**Closing pass, 2026-10-18:** every finding except **C3** and **C9** is now closed. The
closures were verified by the maintainer, not taken from the implementer's report: both
suites re-run, regeneration re-run twice for idempotency, and the backend driven over a real
ASGI client. Commits: `fbd4e5e` (2.5.1), `8a06221` (backend), `2168634` (product truth, 2.5.2).

---

## 1. Blocks a catalog submission

| # | Finding | Status |
|:--|:--|:--|
| B1 | Unguarded index read-modify-write + one fixed temp name (`index.json.tmp`); two concurrent imports lost a provenance entry and hit `WinError 32` → 500. | **CLOSED** `8a06221` — unique temp per write (`mkstemp` in the target dir, so the replace stays a same-volume atomic rename) and the whole index read-modify-write serialised by a module-level lock. Concurrency model confirmed in host source: one in-process app, one `uvicorn.Server` with no `workers`, sync `def` endpoints → threads in one process. |
| B2 | A corrupt or unreadable index was replaced by `{}` and then persisted, destroying provenance. | **CLOSED** `8a06221` — a present-but-unreadable index is quarantined beside itself and raises; only a missing file reads empty. |
| C1 | The README sold a different product: "140 skin palettes, 57 Dynamic Themes plus dark-only and light-only scenes", while the build ships 109 all-dynamic scenes from 150 files. | **CLOSED** `2168634` — README, ARCH, ARCHITECTURE, THIRD_PARTY_NOTICES and SPEC now state 150 skin palettes, 109 two-mode scenes and the real twelve categories; the `requestTheme()` FAQ (zero hits in the plugin) was rewritten. |
| C2 | A failed import reported success: `importTweakcn` swallowed the backend failure and still toasted "Imported …"; the manage buttons silently vanished. | **CLOSED** `2168634` — the notice is chosen by a pure `importOutcomeNotice(label, minted, error)`; only a real mint reports a bare success, a missing backend is stated as local-only with its cause, and a `backendReady` notice names what still works. A source-level test guards that `.catch(() => null)` never returns to the import path. |
| C3 | **No 2.x release exists.** Latest tag is `v1.5.1`. | **OPEN** — release mechanics. Awaiting the Captain's G15 acceptance before a tag is placed; deliberately not tagged unilaterally. |

## 2. Should fix before submission

| # | Finding | Status |
|:--|:--|:--|
| A1 | Shared `desktopThemeApi` slot nulled by any consumer's unmount, reverting the theme. | **CLOSED** `fbd4e5e` — reference-counted, cleared only when the last consumer unmounts. |
| A2 | No error boundary: one malformed stored skin white-screened the picker. | **CLOSED** `fbd4e5e` — boundary with an honest fallback that reports what it could not draw. |
| A3 | Stale boot cache outranked our registration; the repair guard compared `"Deep-void"` to `"Deep Void"` and never fired. | **CLOSED** `fbd4e5e` — staleness is detected by **shape** (identical palette halves, or no `darkColors`), so the guard can actually match. |
| B3 | `_hex` accepted non-hex (`#zzzzzz`, `#12 456`, `#fffffe`) and had no test at all. | **CLOSED** `8a06221` — strict `#rgb`/`#rrggbb`; a bad token is a 400 naming the value and no file is written. |
| B4 | No request-size cap; `theme: dict[str, Any]` was unbounded. | **CLOSED** `8a06221` — 64 KiB byte cap and a 512 colour-token cap, both 413. |
| B5 | Windows reserved device names (`con`, `nul`, `com1`…) passed the slug allowlist. | **CLOSED** `8a06221` — refused; the allowlist shape is kept (`console`, `con-artist`, `com10` still legal). |
| B6 | A failed index write could orphan the skin file, and every filesystem error was a bare 500. | **CLOSED** `8a06221` — the skin is rolled back on index-write failure; delete/rename are actionable. |
| C4 | No enable step in the install docs — the desktop half is opt-in. | **CLOSED** `2168634`. |
| C5 | The Windows installer's destination disagreed with the README, and the backend needs a full restart. | **CLOSED** `2168634` — README aligned to the installer (`plugins/chroma`) and to the restart. |
| C6 | The "we only write `chroma-*` keys" rule was false — the code writes five `hermes-desktop-*` keys. | **CLOSED** `2168634` — the **documents** were corrected, not the code: a contributed theme must mirror the app's own keys or it is lost at next startup. Recorded in `DECISIONS.md` §11 and rewritten identically across AGENTS/SPEC/ARCH, plus a false code comment. |
| C7 | Version divergence: `manifest.json` and `SPEC.md` said 2.0.0, `VERSION` said 2.5.0. | **CLOSED** `2168634`, unified on the shipped release (now 2.5.2). |
| C8 | Committed junk: `.hermes-tmp.Qw7TB7`. | **CLOSED** `2168634` — removed and the pattern gitignored. |
| C9 | Zero ARIA in the pane; the 2 x 6 swatch carries meaning in colour only. | **OPEN** — accessibility pass not started. |
| C10 | `dashboard/manifest.json` pointed at a `dist/index.js` that does not exist. | **CLOSED** `2168634` — the dead `entry` removed, matching the host's hidden-tab plugins. |

## 3. Accepted, with a reason

| Finding | Decision |
|:--|:--|
| `rigour check --ci` FAIL 18 / 39-100 (as recorded at 2.5.0) | The 16 were pre-existing debt and documented false positives (the SDK is host-provided, not an npm dep). The 2 new `logic-drift` HIGHs were the deliberate re-cut of the hue bands in 2.5.0. To be paid by rewriting `sceneCategory` as a hue-band table, which removes both the mutated operators and the complexity. **Not to be silenced with an allowlist.** |
| **Measured now, and the number is not what §3 said.** At `fbd4e5e` a worktree baseline gives **FAIL 13 / 40**; the current tree gives **FAIL 21 / 31**. | The delta is precise and small. **+4 `file-guard` HIGHs** — `docs/ARCH.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `SPEC.md` are protected and were deliberately edited to correct false claims on the Captain's order. This is a raised-and-accepted exception, not a silenced gate. **+1 `phantom-apis` HIGH is a rule bug, not a code bug**: it claims `os.fdopen()` "does not exist on `os`" and suggests `popen` — `os.fdopen` is real (verified by calling it) and is the correct idiom with `mkstemp`. Correct code is not deformed to please a broken detector. **+3 `style-drift` LOW** are detector noise: the per-file ratio moved for two files *this change never touched*, which means the project baseline is recomputed from the scanned set. **Lesson: rigour's score is not stable across sessions — establish the baseline in a worktree at the same commit before judging a delta.** |
| The two `hallucinated-imports` CRITICALs | False positives, and pre-existing (present in the baseline too): they fire because no `package.json` exists, but `@hermes/plugin-sdk`, `react` and `react/jsx-runtime` are exactly the import set a desktop plugin may use. The premise is unsatisfiable by design. |
| `plugin.js` is a large generated artifact | By design: the desktop loads uncompiled ESM. Never hand-edited, always regenerated. Regeneration is idempotent and reproduces the build byte for byte (verified twice). |
| Seven scenes lack a canonical `background` key | Real, small, tracked separately: `ares`, `slate`, `poseidon`, `sisyphus`, `charizard` (dark), `daylight`, `warm-lightmode` (light). |
| 218 transport files at the top of `skins/` | Deliberate: the CLI resolves a skin by file name. Reviewed as arguably untidy, not unsafe. |

## 4. Order of work

1. ~~Bug round 2: A1, A2, A3~~ — **done** `fbd4e5e` (7 new tests; suite 125/125).
2. ~~Backend integrity: B1, B2, B3–B6~~ — **done** `8a06221` (34 → 58 tests).
3. ~~Product truth: C1, C2, C7, C8, C4, C5, C6~~ — **done** `2168634` (125 → 130 tests).
4. **Release mechanics**: C3 (tag 2.5.x on the shipped commit); C10 is done.
5. **Accessibility**: C9.
6. **Cleanup**: `sceneCategory` band table (pays the two `logic-drift` HIGHs); the seven missing `background` keys.

Submission gate: sections 1 and 2 empty, every remaining item either closed or written into §3 with a
reason. Two items remain — **C3** (the release tag, which awaits the Captain's acceptance) and **C9**
(accessibility). Until then the honest answer to "is it ready for the registry" is **no**.
