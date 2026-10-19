> **HISTORICAL — 2026-10-19, before the v2 cutover.** Its counts (109 scenes,
> 0 packs) describe the tree as it stood that morning, not the release.
> See `docs/RELEASE-2.6.0.md`.

# Distribution readiness review — 2026-10-19

Repo: `C:/DEV/hermes-theme-picker` (`TobiasDraven/chroma-for-hermes`)
Branch `main` at `594f9eb` + the review fixes in this pass.
Reviewer: Faris al-Faris. Method: every claim below was measured on this host.

## Verdict

**Ready to ship, with one caveat stated plainly: Theme Packs is a model, not a
feature.** The pack filter is gated on the data, so no pack control appears in
the pane while the catalog carries no pack membership. Everything else — the
picker, the editor (duplicate, categories, typography, packs import/export),
gateway sync, and the backend — is green and platform-portable.

## 1. Gates, measured

| Gate | Command | Result |
|---|---|---|
| JS suite | `node --test tests/*.test.mjs` | **217 pass, 0 fail, exit 0** (was 200/21) |
| Backend | `python -m unittest tests.test_plugin_api` | **163 pass, OK** |
| Generator | `python -m unittest tests.test_regenerate` | **OK, 4 skipped** (was 3 failures) |
| Plugin validation | `hermes plugins validate .` | **passed** |
| Build determinism | `python scripts/regenerate.py` twice | byte-identical |
| Rigour | `rigour check --ci` | 15 violations, score 37/100 (was 29, 31/100) |

## 2. Defects found and fixed

### 2.1 `register()` was async — a host-contract violation (HIGH)

The Desktop loader calls `plugin.register(ctx)` **synchronously** inside a
`try/catch`, and `trackGatewayEventDisposers` restores its tracker in a
`finally` (`contrib/events.ts:19-28`).

Consequences, both real:

1. `publishPlugin({status: 'loaded'})` fired before any theme was registered.
2. Every `ctx.register()` that ran after the `await` lost its disposer, so
   disabling or reloading the plugin could not withdraw those contributions.

Fixed: `register()` is synchronous. The boot override read comes from a local
mirror (`chroma-overrides-v1`) that every successful save and reset writes.
The editor still reads the backend; boot never touches the network.

### 2.2 Prototype pollution through the shared object merge (HIGH ×5 sites)

`Object.assign({}, parsed)` copies an **own** `__proto__` key through `[[Set]]`,
which rewrites the prototype of the fresh target. Measured:

```
Object.assign path — polluted: true
safeMerge path      — polluted: false, ok kept: true
```

Two of those sites are external input: the override store, and a palette pasted
from tweakcn.com. All 23 `Object.assign({}, …)` sites now use `safeMerge`, which
copies own string keys and refuses `__proto__`, `constructor`, `prototype`.
Covered by `tests/safe-merge.test.mjs` (4 tests, fail against the old pattern).

### 2.3 The E5 boot-survival test proved nothing

It asserted that a `rest` call happened, never that the registered theme carried
the override. Rewritten to assert the real contract: `register()` returns no
promise, and the theme carries the mirrored font.

### 2.4 Three generator tests encoded the pre-2.4.0 catalog

`modeSupport == 'dark'`, `57 dynamic`, `50 pairs`. The generator deliberately
ports a missing palette and marks it `derived*` so every card's mode toggle
works. The tests now assert that invariant instead of pinned counts.

### 2.5 CI ran on Windows only

A plugin distributed to Desktop users on three platforms was tested on one. CI
is now a matrix over `ubuntu-latest`, `macos-latest`, `windows-latest`, runs both
Python suites, and adds a `build-is-current` job that rebuilds and fails on any
diff to `desktop/plugin.js`, `gateway-skins/`, or `docs/DERIVED-PALETTES.md`.

**Corrected 2026-10-19 by the readiness audit:** the matrix now runs a *third*
Python suite (`tests/test_skin_contract.py`, added with 2.7.0 and unenforced until
now) plus `scripts/check-package.py`. `hermes plugins validate .` remains
local-only — the CLI is not installable from PyPI, so no runner can carry it.

### 2.6 Documentation and licence accuracy

- `README` claimed **Python 3.8+**; the generator calls `str.removeprefix`
  (3.9+). Corrected.
- `LICENSE` carried only the upstream copyright. The fork adds its own line,
  retaining the original, as MIT requires.

## 3. Rigour findings — triaged, all HIGH/CRITICAL proven false

| Finding | Severity | Verdict | Evidence |
|---|---|---|---|
| Hallucinated imports (`@hermes/plugin-sdk`, `react`, `react/jsx-runtime`) | CRITICAL ×2 | **False positive** | The host's own runtime plugins import exactly these three with no `package.json`: `apps/desktop/src/plugins/radio/plugin.js:1-4`, `hello-runtime/plugin.runtime.js:12`. The repo has no `package.json` by design. |
| `phantom-apis`: `os.fdopen` "does not exist" | HIGH | **False positive** | `python -c "import os; print(callable(os.fdopen))"` → `True`. |
| `promise-safety` at `plugin.template.js` L2586 | HIGH ×2 | **False positive** | The flagged line is `gatewaySyncQueue.then(perform, perform)` — the second argument is the rejection handler. |
| `promise-safety` in `tests/test_regenerate.py` L219 | HIGH | **False positive** | A test reading a repo-owned manifest SHOULD raise when the manifest is corrupt. Swallowing it would hide a broken repo. |
| Remaining AST complexity, file size, Python style drift | MEDIUM/LOW | Accepted | Structural; a refactor of the 5k-line template is its own campaign, not a release blocker. |

No allowlist was added and no threshold was tuned.

## 4. Platform readiness

| Surface | Windows | macOS | Linux | Evidence |
|---|---|---|---|---|
| Desktop half | yes | yes | yes | Plain ESM, `localStorage`, SDK-only imports, no Node or path APIs |
| Backend | yes | yes | yes | `pathlib`, `tempfile.mkstemp`, `os.replace`; the one Windows caveat (locked target) is already handled |
| Generator | yes | yes | yes | `pathlib` throughout; pinned hashes; deterministic |
| Install docs | yes | yes | yes | README has a section per platform |

## 5. Catalogue integrity

- 109 scenes, each shipping both modes; derived palettes are flagged and listed
  in `docs/DERIVED-PALETTES.md`.
- 150 skin files, 55 pinned pairs (110 skins), 218 gateway transports = 2 per
  scene, all unique.
- `hermes plugins validate` reports a portable, manifest-only plugin.

## 6. BLOCKER — Theme Packs is a stub, and it is visible

Measured in the committed build (`0910070`):

| Check | Required (CHROMA-PACKS.md) | Actual |
|---|---|---|
| A scene carries its pack | every scene → exactly one pack | **0 of 109 scenes carry `pack`** |
| Core size | exactly 30 | 33 named in `scripts/packs.json` |
| Pack size | 10–20 | 8, 8, 10, 11, 11 |
| No overlap | each scene in exactly one pack | **45 duplicate slots across 36 unique names**; 73 scenes unassigned |
| Gate script | `check-packs.py` | does not exist |

The pane rendered one control from this model: a filter button that, once any
pack was enabled, kept a hard-coded 31-name list and dropped everything else —
because `scene.pack` is `undefined` for all 109 scenes. (A pack badge was
planned in the same pass but never reached the build; `desktop/plugin.js` has no
`PackBadge` and no `pack` field.)

It cannot be corrected by editing counts: the plan requires curated membership
justified by the palette audit (`analyse-palettes.py`), which has not been run.

**Decision taken in this pass:** the pack filter is now gated on the data. It
renders only when at least one scene carries a `pack`, so the shipped pane shows
no pack control against a catalog that has no pack membership
(`tests/pack-filter-gate.test.mjs` pins both directions). Nothing false reaches
the screen, and the control appears by itself the moment the generator stamps
pack membership.

The campaign itself is still outstanding — `scripts/packs.json` needs real
curation (30 core, five packs of 10–20, every scene in exactly one), backed by
`analyse-palettes.py` and enforced by `check-packs.py`. That is a curation job,
not a wiring job, and it does not block the editor release.

## 7. Also open

- **C3** — no 2.x tag; `VERSION` is still 2.5.2 while E0–E6 added features. A
  bump to 2.6.0 belongs with the release, not before the blocker clears.
- **C9** — accessibility/ARIA pass not started.
- `rigour check --ci` is red on the items triaged in Section 3. Reported, not
  silenced.

## 8. Not verified here

- The G15 acceptance walk (the Captain's own machine).
- A real Hermes install of this tree end to end; the suite exercises the pane in
  a VM and the backend in-process.
- macOS and Linux execution on real hardware — CI now covers them, but this pass
  ran on Windows only.
