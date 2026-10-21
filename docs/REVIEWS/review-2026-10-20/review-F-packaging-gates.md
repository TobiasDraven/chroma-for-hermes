VERDICT: HOLD

# Review Lane F — Packaging, CI, gates, and cross-surface integration

**PIN: `352c3c5ad86db06cc600c3555675e2baf0928e12`** (branch `main`, tree clean —
`git status --porcelain` empty at the pin; the working tree was not modified by this
review; the only writes anywhere were the gitignored rigour run-artifacts and this
report).

## 2. Files I read

Repo (read-only, at the pin):
`plugin.yaml`, `VERSION`, `dashboard/manifest.json`, `dashboard/plugin_api.py`
(routes + route order), `desktop/plugin.template.js` (head, plugin-registration
block, every `_rest(...)` call site), `desktop/plugin.js` (BUILD_STAMP, size),
`scripts/regenerate.py`, `scripts/check-package.py`, `scripts/check-packs.py`,
`scripts/check-host-classes.py`, `scripts/taxonomy.json`, `rigour.yml`,
`.gitignore`, `.gitattributes`, `.github/workflows/ci.yml`, `README.md`,
`CHANGELOG.md` (head), `docs/SPEC.md` (head), `docs/CATALOG-SUBMISSION.md`,
`docs/TASKS.md` (head), `docs/PLANS/CHROMA-ROADMAP.md` (grep), `install/*` (5 files),
`tests/test_plugin_api.py` (head), `tests/test_regenerate.py` (skip markers),
`tests/regenerate-scene-parity.mjs` (head).

Host (read-only, for the install path):
`C:/Users/<user>/AppData/Local/hermes/hermes-agent` @ `d923a5eb487a17c0a68801bba9ef0f56c81040a8`
("Release 0.22.2") —
`apps/desktop/electron/desktop-plugin-install.ts`, `apps/desktop/electron/desktop-plugins-root.ts`,
`apps/desktop/src/app/settings/plugin-install-run.ts`, `apps/desktop/src/app/settings/plugin-install-modal.tsx`,
`apps/desktop/src/app/settings/use-plugin-probe.ts`, `apps/desktop/src/store/plugin-install-request.ts`,
`apps/desktop/src/contrib/runtime-loader.ts`, `apps/desktop/src/contrib/plugins-store.ts`,
`apps/desktop/src/api/plugins.ts`, `apps/desktop/src/contrib/plugin.ts`,
`hermes_cli/plugins_loader.py`, `hermes_cli/plugins_discovery.py`,
`hermes_cli/plugins_cmd_install.py`, `hermes_cli/plugins_manifest.py`,
`hermes_cli/plugin_validate.py`, `hermes_cli/plugin_validate_desktop.py`,
`hermes_cli/web_server_dashboard.py`.

## 3. What I actually RAN vs what I only READ

### 3a. I RAN (with exact exit codes and raw output)

| # | Command | Where | Exit | Raw result |
|---|---|---|---|---|
| R1 | `python scripts/regenerate.py` | **scratch clone** at `/tmp/chroma-buildcheck/repo` (NOT the repo) | `0` | `Rebuilt .../desktop/plugin.js with 94 scenes from 94 bundled skins + 0 backend built-ins, 40 derived palettes and 188 gateway transports.` |
| R2 | `git diff --exit-code -- desktop/plugin.js gateway-skins docs/DERIVED-PALETTES.md` | scratch clone, after R1 | `0` | empty diff; `git status --porcelain` empty |
| R3 | `sha256sum desktop/plugin.js` (scratch) vs (repo) | both | — | **identical**: `b4f8e68976a7ba74d8ae44d074c7de6ce91741bad9c906722fe561910650b9c6` |
| R4 | `sha256sum docs/DERIVED-PALETTES.md` (scratch) vs (repo) | both | — | **identical**: `7bbd97ee073e25d7a1323f380a92e748b1de72a8ee5ee83e97ecc01d927830a0` |
| R5 | `diff -rq gateway-skins <repo>/gateway-skins` | scratch vs repo | `0` | `gateway-skins IDENTICAL` (188 files) |
| R6 | `python scripts/check-package.py` | repo | `0` | `OK: package contract holds at 2.9.0 (94 skins, 538 tracked files)` |
| R7 | `python scripts/check-packs.py` | repo | `0` | `skins: 94` / `packs: {'core': 30, 'cyberpunk': 11, 'earth': 11, 'noir': 10, 'retro': 11, 'studio': 10, 'zen': 11}` / `categories: {...}` / `OK: contract holds` |
| R8 | `python scripts/check-host-classes.py` | repo | `0` | `host sheets: 6 (399988 chars) · classes used: 134 · with no rule: 0` / `OK: every class we use has a rule in the host stylesheet.` |
| R9 | `rigour check --ci` | repo | **`1`** | `FAIL: 25 violation(s) Score: 29/100` + the 25-item list (full list in §4) |
| R10 | `node --test "tests/*.test.mjs"` (quoted, as PowerShell passes it) | repo | `0` | `tests 266 / pass 266 / fail 0 / skipped 0` (node v24.19.0) |
| R11 | `python -m pytest tests/ -q` | repo | `0` | `185 passed, 4 skipped, 9 subtests passed in 150.31s (0:02:30)` |
| R12 | `python -m pytest tests/ -q -rs` | repo | `0` | 4 skips, all `label='symlink'`: `tests\test_regenerate.py:55` (host cannot create symlinks), `:257`, `:284` (macOS `.command` cannot run on this host), `:364` (needs symlink creation privilege) |
| R13 | host `detectPluginComponents` re-implementation, verbatim port of `desktop-plugin-install.ts:181-255`, run against the pinned tree | inline `node -e` (no file written) | `0` | `{"hasYaml":true,"hasInit":false,"hasPortable":false,"agent":false,"desktop":true,...}` → `probe.agent = false`, `probe.desktop = true` |
| R14 | host `installComponents` / `desktopHalfFromPackage` / `enablePackageDesktopHalf` branch simulation, same inline harness | inline `node -e` | `0` | `installComponents -> {"agent":false,"desktop":true}`; `desktopHalfFromPackage(components, remote=false) = false` → path taken: **CLONE STANDALONE**; `agentResult = undefined` → `enablePackageDesktopHalf()` **never called**; installed folder name = `chroma-for-hermes` |
| R15 | **Fault injection of the CI build-currency gate**: in the scratch clone, `git rm --cached` + `rm` one committed gateway transport, commit, then `python scripts/regenerate.py`, then the CI's exact command | scratch clone | **`0` (CI GATE PASSES)** | `git status --porcelain` → `?? gateway-skins/theme-picker-neon-ghost-light.yaml`; `git diff --exit-code -- desktop/plugin.js gateway-skins docs/DERIVED-PALETTES.md` → **exit 0** |
| R16 | `git ls-files` hygiene sweeps: junk patterns, binary sniff (`file --mime-encoding`), secret regexes (PEM / AKIA / ghp_ / sk- / xox), sizes | repo | `0` | junk: **0 hits**; binaries: **2** (`docs/chroma-banner.png`, `docs/hermes-chroma.png`); secrets: **0 hits**; largest tracked file `docs/chroma-banner.png` 1,416,692 B (1.35 MB) — the only file over 1 MB; tracked bytes total **5,893,135 (5.6 MB)**; `.git` pack 740.79 KiB |
| R17 | host `hermes_cli.plugins_discovery.scan_directory` against a synthetic `plugin.yaml`+`dashboard/manifest.json` dir with **no** `__init__.py` | inline `python -` in the host checkout | `0` | `DISCOVERED: [('chroma', 'chroma', 'user', '.../chroma')]` — the manifest IS discovered; the missing `__init__.py` is not a discovery-time failure |
| R18 | `git check-ignore -v` on `.rigour/scan-cache.json`, `rigour-report.json`, `rigour-fix-packet.json`, `.serena/x` | repo | `0` | all four are **ignored** (`.gitignore:12,13,14,18`) |
| R19 | `git ls-files \| grep -Ei '(\.rigour\|\.serena\|__pycache__\|pytest_cache\|node_modules\|rigour-report\|rigour-fix-packet\|\.log$\|scratch/…)'` | repo | `1` (no match) | **empty** — the brief's "`.rigour/scan-cache.json` and `rigour-report.json` are committed" premise is **false at the pin**; the only tracked `rigour*` file is `rigour.yml` |
| R20 | `python -c` reading `rigour-report.json` (the LIVE report the R9 run wrote) and dumping every failure's id/severity/files/details | repo | `0` | 25 failures, listed in §4 |

**Note on R1/R2/R15:** `scripts/regenerate.py` was executed **only in a scratch clone at
`/tmp/chroma-buildcheck/repo`**, never in the repo. The repo's working tree is
byte-identical to the pin (`git status --porcelain` empty after every step). The
scratch clone was `git reset --hard` back to the pin afterwards.

### 3b. I only READ (could not / did not run)

| # | Thing | Why not run |
|---|---|---|
| U1 | `hermes plugins validate .` | Local CLI is broken on this host (per the brief; confirmed: `pip show hermes-agent` → 0.21.5, and the host checkout is at "Release 0.22.2"). I read the validator source instead (`hermes_cli/plugin_validate.py`, `plugin_validate_desktop.py`) and re-implemented the one function that decides the outcome (`desktop-plugin-install.ts::detectPluginComponents`) verbatim. |
| U2 | The GitHub Actions run itself | No CI runner here. Every CI step was re-run locally in equivalent form (R1-R15); the CI *workflow file* was audited line by line. |
| U3 | A live paste-URL install | Guardrail: "Never point anything at the real host-owned directory." I did not install into `~/AppData/Local/hermes/`. The install path was established by reading the host's own detection + install functions and re-running the detection function against the pinned tree (R13/R14). |
| U4 | The 11 light `status_bar_dim` skins at 3.996-4.238:1 contrast | Contrast is not in my axis and no repo gate checks it (see F14). I did not re-measure. |
| U5 | `docs/CATALOG-SUBMISSION.md`'s quoted validator output | The quotes are second-hand from a session where the CLI ran. I verified what the validator *would* do at this pin from source (see F1c) — and it differs from the quoted evidence. |

## 4. Gate table

| Gate | What it checks | What it does NOT check | Raw result at the pin |
|---|---|---|---|
| `node --test tests/*.test.mjs` (CI `test` job, ×3 OS) | 26 JS suites, 266 assertions: rendering, ARIA, import formats, persistence, card behaviour, element integrity | The Python suite, the check scripts, the rigour gate, the host-class gate. The two `tests/regenerate-*-parity.mjs` files are *generators*, not suites — their fixtures are consumed by `tests/scene-parity.test.mjs` and `tests/theme-card.test.mjs`, which ARE in the glob, so no gap there. 4 python tests skip on the Windows leg only (symlink privilege) | **PASS** — `tests 266 / pass 266 / fail 0` (R10). Glob is portable: node ≥21 expands `tests/*.test.mjs` itself; CI pins node 22 (`actions/setup-node@v4`, `node-version: '22'`) |
| `python -m pytest tests/ -q` (CI `test` job, ×3 OS) | 185 backend + contract + generator tests across 3 files | Contrast, packaging, the manifest, the host install path | **PASS** — `185 passed, 4 skipped, 9 subtests passed` (R11/R12) |
| `python scripts/check-packs.py` (CI `test` + `build-is-current`) | 94 skins: unique ids, file-stem==id, unique labels, both palettes present, `background`+`ui_accent` in each, pack ∈ 7, pack partition (core=30, others 10-20), category ∈ taxonomy, both font stacks, energy ∈ 3, `schema_version==2`, `design_spec` ∈ {v1,v2}, v2 ten surfaces, `provenance.derived` ∈ {light,dark} | **Contrast/legibility** (no `contrast`/`ratio` token anywhere in the file). Hex format. The `KEEP_KEYS` subset the build actually ships. The gateway transport count. | **PASS** — `OK: contract holds` (R7) |
| `python scripts/check-package.py` (CI `build-is-current` only) | 4 version loci agree (VERSION / plugin.yaml / dashboard/manifest.json / BUILD_STAMP in the committed build); 7 required manifest fields non-empty; `plugin.yaml name == 'chroma'`; entry points `desktop/plugin.js` + `dashboard/plugin_api.py` exist; no tracked file matches 6 junk patterns; `skins-v2/` non-empty | **Whether the package is installable at all** — it never checks for `__init__.py`, never checks `register(ctx)`, never checks the agent/desktop package layout the host requires. Never checks `docs/SPEC.md` or `CHANGELOG.md` (it says "every version locus agrees" and then checks 4 of ≥6). Never checks the build is *current*. Never checks the plugin.js size. | **PASS** — `OK: package contract holds at 2.9.0 (94 skins, 538 tracked files)` (R6) |
| `python scripts/regenerate.py` + `git diff --exit-code -- desktop/plugin.js gateway-skins docs/DERIVED-PALETTES.md` (CI `build-is-current`) | The committed build and transports match what the template + catalogue produce | **Untracked files.** `git diff` ignores them. Also does not check that `plugin.js` is *tracked* (that is covered only incidentally by check-package's "exists" test). | **PASS** — byte-identical output (R1-R5). **BUT the gate is blind**: fault injection R15 removed one committed gateway transport, regeneration recreated it as `??`, and the CI command **still exited 0**. A shipped package can be missing a mode-locked transport with CI green. |
| `python scripts/check-host-classes.py` | 134 class tokens used by the build against the host's 6 compiled stylesheets (399,988 chars) | Cannot run without the host's compiled CSS. **Not in CI at all.** Exit 2 = `UNVERIFIED` when no stylesheet is found, so it cannot be a CI gate as written. | **PASS locally** — `with no rule: 0` (R8). **Not wired into CI** — a gate nobody runs. |
| `rigour check --ci` (the repo's own committed `rigour.yml`) | 24 sub-gates: file-size 500, AST complexity 10, required docs, hallucinated imports, promise safety, phantom APIs, deprecated APIs, security patterns, secret exposure, duplication drift, test quality, style/logic drift, side-effect analysis, context-window artifacts, error-handling consistency | **Not in CI at all.** `rigour.yml` is committed, `AGENTS.md §5` lists it as a verification command, and the config is a stated team standard. | **RED — `FAIL: 25 violation(s) Score: 29/100`**, exit `1` (R9). Breakdown: 2 CRITICAL (`hallucinated-imports`), 8 HIGH (`promise-safety` ×8, `inconsistent-error-handling` ×1, `context-window-artifacts` ×2, `phantom-apis` ×1), 6 MEDIUM (`AST_COMPLEXITY` ×2 + `AST_COMPLEXITY_LIMIT_EXCEEDED` ×2 + `side-effect-analysis`), 1 LOW (`file-size`), 5 LOW (`style-drift`) + 3 more. Un-adjudicated by `docs/TASKS.md`: `phantom-apis` (`os.fdopen` in `dashboard/plugin_api.py:75`), `context-window-artifacts` ×2 (`scripts/analyse-palettes.py:126`, `tests/helpers/card-cases.mjs:110`), `side-effect-analysis` (`scripts/measure/measure-catalogue.py:77`). `docs/TASKS.md:42` adjudicates **three** `promise-safety` sites; the live gate reports **eight**. |

### The 25 rigour failures, verbatim

```
FAIL: 25 violation(s) Score: 29/100
  - [LOW] [file-size] File Size Limit
  - [MEDIUM] [AST_COMPLEXITY] Function 'stripJsonNoise' has cyclomatic complexity of 16 (max: 10)
  - [MEDIUM] [AST_COMPLEXITY_LIMIT_EXCEEDED] More than 5 AST_COMPLEXITY violations in desktop/plugin.js
  - [MEDIUM] [AST_COMPLEXITY] Function 'stripJsonNoise' has cyclomatic complexity of 16 (max: 10)
  - [MEDIUM] [AST_COMPLEXITY_LIMIT_EXCEEDED] More than 5 AST_COMPLEXITY violations in desktop/plugin.template.js
  - [CRITICAL] [hallucinated-imports] Hallucinated Imports
  - [CRITICAL] [hallucinated-imports] Hallucinated Imports
  - [HIGH] [inconsistent-error-handling] Inconsistent Error Handling
  - [HIGH] [context-window-artifacts] Context Window Artifacts
  - [HIGH] [context-window-artifacts] Context Window Artifacts
  - [HIGH] [promise-safety] Async & Error Safety Violation
  - [HIGH] [promise-safety] Async & Error Safety Violation
  - [HIGH] [promise-safety] Async & Error Safety Violation
  - [HIGH] [promise-safety] Async & Error Safety Violation
  - [HIGH] [promise-safety] Async & Error Safety Violation
  - [HIGH] [promise-safety] Async & Error Safety Violation
  - [HIGH] [promise-safety] Async & Error Safety Violation
  - [HIGH] [promise-safety] Async & Error Safety Violation
  - [HIGH] [phantom-apis] Phantom APIs
  - [MEDIUM] [side-effect-analysis] Side-Effect: Resource Leak
  - [LOW] [style-drift] Style Drift
  - [LOW] [style-drift] Style Drift
  - [LOW] [style-drift] Style Drift
  - [LOW] [style-drift] Style Drift
```

## 5. Findings

### F1 — BLOCKER — the repo root is not an agent-plugin package: no `__init__.py`

**Location:** the repo root — the file is **absent** (the pin's root tree is
`.gitattributes .github .gitignore AGENTS.md CHANGELOG.md LICENSE README.md
THIRD_PARTY_NOTICES.md VERSION dashboard desktop docs gateway-skins install
plugin.yaml rigour.yml scripts skins-v2 skins tests`).
Host contract: `apps/desktop/electron/desktop-plugin-install.ts:197-203`
(`detectPluginComponents`), `hermes_cli/plugins_loader.py:704-706`,
`hermes_cli/plugin_validate.py:397-401`.

**Quoted host lines:**

```ts
// apps/desktop/electron/desktop-plugin-install.ts:197-203
const hasYaml = pathExistsSync(path.join(pluginRoot, 'plugin.yaml')) || pathExistsSync(path.join(pluginRoot, 'plugin.yml'))
const hasInit = pathExistsSync(path.join(pluginRoot, '__init__.py'))
const hasPortable = pathExistsSync(path.join(pluginRoot, 'plugin.json'))
const agent = (hasYaml && hasInit) || hasPortable
```

```python
# hermes_cli/plugins_loader.py:704-706
init_file = plugin_dir / "__init__.py"
if not init_file.exists():
    raise FileNotFoundError(f"No __init__.py in {plugin_dir}")
```

**Evidence (R13/R14, a verbatim re-implementation of the host function run against the pinned tree):**

```
detectPluginComponents(chroma repo root) =
{ "hasYaml": true, "hasInit": false, "hasPortable": false,
  "agent": false, "desktop": true, "agentName": null,
  "desktopName": "desktop", "desktopSourceSubdir": "desktop" }
probe.agent = false   probe.desktop = true
installComponents -> {"agent":false,"desktop":true}
desktopHalfFromPackage(components, remote=false) = false
=> path taken: CLONE STANDALONE (cloneDesktopHalf)
agentResult = undefined  => `agentResult?.enabled` is undefined (falsy)
                            -> enablePackageDesktopHalf() NEVER CALLED
installed desktop folder name would be: chroma-for-hermes
```

**Failure mode — three separate consequences, all from one missing file:**

1. **The paste-URL install does not install the package.** `installComponents`
   (`plugin-install-run.ts:31-33`) returns `{agent: false, desktop: true}`.
   `desktopHalfFromPackage` (`:38-40`) is `components.agent && !remote` → `false` →
   `cloneDesktopHalf` (`:124-143`) runs `installDesktopPluginFromGit`, which clones
   the repo and publishes **only `desktop/`** into
   `<desktop-plugins-root>/chroma-for-hermes/`. The Python half is never
   installed: `dashboard/plugin_api.py` is never mounted, `/api/plugins/chroma/`
   does not exist, and every backend-backed feature (TweakCN import minting a real
   gateway skin, rename, export, delete, categories, packs, overrides) is dead.
   The folder is `chroma-for-hermes`, **not** `chroma` as `README.md:79-80`
   promises.
2. **The route that *does* land the package leaves the plugin unloadable.**
   `hermes plugins install` publishes the tree at `plugins/chroma/` (the name comes
   from `plugin.yaml`, `plugins_cmd_install.py:386-388`) and the dashboard API
   *does* mount (it is discovered by a separate scan of
   `<plugins root>/*/dashboard/manifest.json`, `web_server_dashboard.py:559-586`,
   independent of the plugin loader) — but the plugin itself raises
   `FileNotFoundError: No __init__.py in <plugins>/chroma` at every gateway start
   (`plugins_loader.py:704-706`). `plugins_cmd_install.py:488` only logs a
   *warning*. The catalog reviewer would install a plugin that cannot register.
3. **The catalog's own admission gate reports green anyway.**
   `plugin_validate.py:397-401` skips the capability probe and records it as a
   **pass**: `report.add("capability probe", True, "skipped (no __init__.py)")`.
   `docs/CATALOG-SUBMISSION.md` quotes exactly that validator output as the
   evidence for admission rules 6, 7, 8 and 9 — none of which was exercised.

**Smallest correct fix:** add a root `__init__.py` exposing `register(ctx)` (a
no-op `register` is enough — Chroma registers no tools/hooks/middleware, and the
desktop half does the work). That single file flips `probe.agent` to `true`, which
takes `installComponents` down the `both` branch, makes
`desktopHalfFromPackage` true for a local backend, lets the dialog install the
package at `plugins/chroma/` and enable the desktop half via
`enablePackageDesktopHalf` (`plugin-install-run.ts:171-173`), and makes the
capability probe real. Then re-run `hermes plugins validate .` and refresh the
quoted evidence in `docs/CATALOG-SUBMISSION.md`.

**Corroborating:** the repo's own `scripts/check-package.py:73-74` asserts
`plugin.yaml name must be 'chroma' (the install folder name)` — true only for the
agent route, which the package cannot currently take.

---

### F2 — MAJOR — the "one-step install" claim is published as fact and is false at the pin

**Locations:** `README.md:87-93`; `scripts/regenerate.py:818-821`;
`docs/CATALOG-SUBMISSION.md` (PR-description draft).

**Quoted (`README.md:87-93`):**

```
That is the whole install. The dialog installs the package with the plugin
enabled and switches on its Desktop half in the same step, so **Chroma appears as
an enabled row on the Plugins page and its pane joins the sidebar when the
install finishes**: no file copying, no script, no second toggle.
```

**Quoted (`scripts/regenerate.py:818-821`, printed to the user on every build):**

```
print("Next: this repo root IS the plugin package. Install it from Hermes "
      "Desktop -> Capabilities -> Plugins -> Install, by pasting the repo "
      "URL (https://github.com/TobiasDraven/chroma-for-hermes). The dialog "
      "enables the plugin and its Desktop half in one step.")
```

**Failure mode:** "The dialog installs the package" is false — it installs the
*desktop half only* (F1). The visible half of the claim happens to hold: the
cloned half lands without a `.hermes-package.json` marker, so
`runtime-loader.ts:924` gives `defaultEnabled: undefined`, and
`plugin.defaultEnabled ?? true` (Chroma sets no `defaultEnabled`) makes
`pluginActive('chroma', true)` true, so the pane *does* appear enabled on a fresh
machine. Everything the claim implies about the package — that the backend is
installed, that the install folder is `chroma/`, that the import mints a real
gateway skin — does not hold. `README.md:78-80` states the opposite explicitly:
"Both live in one directory, `<hermes home>/plugins/chroma/`, and Desktop copies
the UI half out to `desktop-plugins/chroma/` by itself." On the paste-URL route
nothing lands in `plugins/chroma/` and the copy lands in
`desktop-plugins/chroma-for-hermes/`.

**Smallest correct fix:** fix F1 (one `__init__.py`), then re-prove the claim on
a real machine. Until it is re-proven, `README.md:87-93` and `regenerate.py:818-821`
must be downgraded from "That is the whole install" to the accurate statement:
the dialog installs the desktop half; the backend arrives through
`hermes plugins install` + `hermes plugins enable chroma` and needs a restart.
(§6 settles the claim.)

---

### F3 — MAJOR — `scripts/check-package.py` passes while the package cannot be installed

**Location:** `scripts/check-package.py:88-91` (entry points) and `:60-86`
(version loci).

**Quoted:**

```python
    # 2. The entry points the manifest promises exist.
    for relative in ("desktop/plugin.js", "dashboard/plugin_api.py"):
        if not (ROOT / relative).exists():
            fail(problems, f"entry point {relative} is missing")
```

**Failure mode:** the gate names two entry points and omits the third one the
host requires. `desktop/plugin.js` is the desktop entry;
`dashboard/plugin_api.py` is the dashboard entry; `__init__.py` is the **agent**
entry, and without it the host's probe classifies the repository as desktop-only
(F1). A gate that passes while the shipped package is a different product from
the one the catalog entry describes is a finding, not a pass. The same script
asserts "every version locus agrees" (`:60-61`) while checking 4 loci and
missing `docs/SPEC.md` (F6).

**Smallest correct fix:** add `__init__.py` to the entry-point list and assert it
exposes `register(ctx)`; assert the manifest declares the capabilities it
registers (empty tool/hook/middleware lists are a *claim* the catalog makes);
and add `docs/SPEC.md` to the version loci (or drop the "every locus" wording).

---

### F4 — MAJOR — the CI build-currency gate is blind to untracked files

**Location:** `.github/workflows/ci.yml:81-82`.

**Quoted:**

```yaml
      - name: The committed build must match its template
        run: git diff --exit-code -- desktop/plugin.js gateway-skins docs/DERIVED-PALETTES.md
```

**Failure mode (fault-injected, R15):** `git diff` compares the index to the
working tree and **ignores untracked files**. In the scratch clone I removed one
committed gateway transport, committed the removal, ran `regenerate.py` (which
recreated it) and ran the CI's exact command:

```
git status --porcelain  ->  ?? gateway-skins/theme-picker-neon-ghost-light.yaml
git diff --exit-code -- desktop/plugin.js gateway-skins docs/DERIVED-PALETTES.md
CI GATE EXIT=0
```

So a package whose committed `gateway-skins/` is missing a mode-locked transport
ships with CI **green**. A user on that build gets a scene whose CLI transport was
never minted. The `desktop/plugin.js` diff does catch a stale *catalogue*, but it
cannot catch a missing transport on its own.

**Smallest correct fix:** stage what the generator produced and compare the index:

```yaml
      - name: The committed build must match its template
        run: |
          git add -A -- desktop/plugin.js gateway-skins docs/DERIVED-PALETTES.md
          git diff --exit-code --cached
```

(`git status --porcelain` is the cheaper equivalent and also catches a build that
was never committed at all.)

---

### F5 — MAJOR — the repo's own committed quality gate is not in CI, and it is RED at the pin

**Location:** `rigour.yml` (committed, "TEAM STANDARD - DO NOT MODIFY"), `AGENTS.md §5`
and `AGENTS.md §10`, `.github/workflows/ci.yml` (no rigour step anywhere).

**Failure mode:** `rigour check --ci` is the gate the repo documents as its own
standard, and it exits **1** with **25 violations including 2 CRITICAL and 8
HIGH** (R9, full list in §4). CI does not run it, so the number a catalog
reviewer sees ("4/4 green") says nothing about it. The known-debt table in
`docs/TASKS.md:37-45` is also **stale**: it adjudicates three `promise-safety`
sites while the live gate reports **eight** (five of them new `unsafe-parse`
findings in `scripts/check-packs.py:55`, `scripts/generate-gallery.py:52`,
`scripts/analyse-palettes.py:97`, `scripts/migrate-to-skins.py:36`,
`scripts/classify-skins.py:48`), and `phantom-apis`, both
`context-window-artifacts` and `side-effect-analysis` are not adjudicated at all.
`AGENTS.md §6` is explicit that the right response to a false positive is to
adjudicate it in `docs/TASKS.md` with evidence — not to leave it undocumented.

**Smallest correct fix:** add a `rigour` job to `.github/workflows/ci.yml`
(`npx @rigour-labs/cli check --ci`) — start it non-blocking if the CRITICAL/HIGH
count is still being worked down, but make it *visible*; and refresh the
`docs/TASKS.md` table to the live 25-item list, adjudicating the six un-adjudicated
findings or fixing them. Do not touch `rigour.yml` thresholds.

---

### F6 — MAJOR — `check-host-classes.py` is a gate nobody runs, and it cannot be one as written

**Locations:** `scripts/check-host-classes.py:103-126`; `AGENTS.md §5` lists it
under "How to verify anything"; `.github/workflows/ci.yml` (absent).

**Quoted (`scripts/check-host-classes.py:122-126`):**

```python
    sheets = find_stylesheets(args.css)
    if not sheets:
        print("UNVERIFIED: no host stylesheet found. Pass --css '<glob>' pointing at the")
        print("Desktop app's built assets (apps/desktop/dist/assets/*.css).")
        return 2 if not args.list else 0
```

**Failure mode:** the script needs the Desktop app's compiled Tailwind CSS, which
a GitHub runner does not have, so it exits **2 (UNVERIFIED)** there and is
correctly excluded from CI. But nothing anywhere records that it is
local-only. `AGENTS.md` lists it beside commands that CI actually runs, and
`AGENTS.md §6` records that this exact gate caught three shipped defects ("a
white card pill on a white label, a role colour that painted nothing, and an
editor sheet whose `max-h-[87vh]` never applied"). A gate that is only ever run
by whoever remembers it is not a gate. It passes today (R8: `with no rule: 0`),
so this is a coverage-hygiene finding, not a live defect.

**Smallest correct fix:** label it as local-only in `AGENTS.md §5` and in the
script's docstring ("exit 2 = UNVERIFIED; CI cannot run this"), and add a CI job
that fails when the script would return 2 — e.g. run it with `--css` pointed at a
downloaded host CSS artifact, or a `python scripts/check-host-classes.py; test $?
-ne 2` step that at least makes the UNVERIFIED state loud.

---

### F7 — MINOR — `docs/SPEC.md` advertises the wrong version, and the submission file over-counts the loci

**Location:** `docs/SPEC.md:10`; `docs/CATALOG-SUBMISSION.md` (admission rule 14).

**Quoted (`docs/SPEC.md:10`):**

```
`plugin.yaml`: name `chroma`, version `2.8.1` (matching `VERSION`). The repo root IS the plugin package.
```

**Quoted (`docs/CATALOG-SUBMISSION.md`, rule 14):**

```
| 14 | Compatibility metadata is truthful | `version` 2.9.0 in five places; `requires_hermes: ">=0.22.0"` |
```

**Failure mode:** `VERSION` is `2.9.0`; `plugin.yaml`, `dashboard/manifest.json`
and both `BUILD_STAMP`s are `2.9.0`; the CHANGELOG's newest entry is `## [2.9.0]`.
`docs/SPEC.md` still says `2.8.1` **and claims it matches VERSION** — it does
not. So the claim "2.9.0 in five places" is false: SPEC.md is a sixth place
carrying 2.8.1. `scripts/check-package.py` checks four loci and never looks at
the docs, so CI is green over the disagreement. Rule 14 of the catalog admission
is *literally* "Compatibility metadata is truthful"; the file that would be
attached to the PR is the one place the metadata is not truthful.

**Smallest correct fix:** `docs/SPEC.md:10` → `version \`2.9.0\``; add
`docs/SPEC.md` to `check-package.py`'s version loci so the next bump cannot
drift; correct the "five places" count (or drop the count).

---

### F8 — MINOR — two of the six new `plugin.yaml` fields are inert or wrong for the host

**Location:** `plugin.yaml:3-8` (added by the pin commit `352c3c5`).

**Quoted (`plugin.yaml`):**

```yaml
manifest_version: 1
kind: plugin
provides_tools: []
provides_hooks: []
provides_middleware: []
requires_env: []
```

**Quoted (host `hermes_cli/plugins_manifest.py:27`):**

```python
_VALID_PLUGIN_KINDS: set[str] = {"standalone", "backend", "exclusive", "platform", "model-provider"}
```

**Quoted (host `hermes_cli/plugins_manifest.py:508-512`):**

```python
    if kind not in _VALID_PLUGIN_KINDS:
        logger.warning(
            "Plugin %s: unknown kind '%s' (valid: %s); treating as 'standalone'",
```

**Failure mode:** `kind: plugin` is not a valid kind. The host logs
`Plugin chroma: unknown kind 'plugin' (valid: backend, exclusive, model-provider,
platform, standalone); treating as 'standalone'` on **every** discovery pass, and
treats it as `standalone` anyway. `manifest_version: 1` is fine (the host supports
v2 and treats absent as v1). `provides_middleware` is **not** in
`_KNOWN_MANIFEST_FIELDS` for `plugin.yaml` (`plugins_manifest.py:32-39`) — it is
a *catalog* capability field (`plugin_catalog.py:71`, `plugin_validate.py:419`) —
so in `plugin.yaml` it is warned-and-ignored. `requires_env: []` and
`provides_tools/hooks: []` are known and meaningful. None of this breaks the
install; all of it is noise a reviewer will read as a mistake, and the catalog
entry already declares capabilities in the right place.

**Smallest correct fix:** drop `kind: plugin` (or set `kind: standalone`); move
`provides_middleware` out of `plugin.yaml` and into the catalog entry's
`capabilities:` block, where `docs/CATALOG-SUBMISSION.md` already has it.

---

### F9 — MINOR — the README renders a broken heading on the plugin's own catalog page

**Location:** `README.md:116`.

**Quoted:**

```
#### Windows### Linux or manual installation (Desktop half only)
```

**Failure mode:** the Windows sub-heading was lost and concatenated with the next
heading, so the rendered plugin page shows a garbage heading and the Windows
fallback (which the README's own table documents as
`%LOCALAPPDATA%\hermes\desktop-plugins\chroma\plugin.js`) has no section. The
README is what the catalog renders as the plugin page
(`docs/CATALOG-SUBMISSION.md`: "The README renders as the plugin page at
`/docs/plugins/chroma`"), so this is a public artifact, not an internal one.

**Smallest correct fix:** split into two headings — `#### Windows` and
`#### Linux or macOS (manual, desktop half only)` — and restore the Windows
paragraph.

---

### F10 — MINOR — the shipped `install/` directory still speaks the pre-fork name and a stale layout

**Locations:** `install/install-macos.command:2,19`, `install/install-windows.cmd:4`,
`install/install-windows.ps1:1`, `install/regenerate-windows.ps1:36`,
`install/install-gateway-skins.sh:76`.

**Quoted (`install/install-macos.command:2`):**

```
# Installs the Theme Picker desktop plugin into the active macOS Hermes home.
```

**Quoted (`install/install-macos.command:12-21`):**

```sh
checkout_plugin="$repo_root/desktop/plugin.js"
bundled_plugin="$installer_dir/chroma/plugin.js"
if [ -f "$checkout_plugin" ]; then
  source_plugin=$checkout_plugin
elif [ -f "$bundled_plugin" ]; then
  source_plugin=$bundled_plugin
else
  printf 'Theme Picker plugin file was not found.\nExpected: %s\nOr: %s\n' ...
```

**Failure mode:** this is a hard fork renamed to Chroma, and the five installer
files still say "Theme Picker" in the strings the user sees. The macOS script
also carries a `<bundle>/chroma/plugin.js` layout the repo does not have (the
repo's own layout is `desktop/plugin.js`, which the first branch does match, so
the script still works). These are the manual-copy path that the one-step claim
says is unnecessary — shipping them under the old name, next to a claim that
they are not needed, is confusing in a fork submission. `install/install-windows.ps1`
is also the only place in the repo that documents the correct unified-package
behaviour ("The Desktop app COPIES a package's desktop half out of
`<hermes home>/plugins/<name>/desktop/` … by itself") — which is exactly what the
paste-URL route does **not** do (F1).

**Smallest correct fix:** replace "Theme Picker" with "Chroma" in all five
files, drop the dead `<bundle>/chroma/plugin.js` branch, and either move
`install/` out of the shipped package or say in the README why it is there.

---

### F11 — MINOR — the tip commit ships user-facing surface with no version bump and no changelog entry

**Location:** commit `352c3c5` (the pin) — `docs/DISCLOSURE.md` (+198),
`docs/FONTS.md` (+47), `plugin.yaml` (+6), `scripts/font-register.py` (+254).
`CHANGELOG.md` was not touched; `VERSION` was not bumped.

**Failure mode:** the shipped `2.9.0` CHANGELOG entry is dated `2026-10-19`; the
pin commit is `2026-10-20` and adds a disclosure register, a 20-family font
licence register, and six new manifest fields — none of which appears in the
changelog for the version that ships them. The catalog's admission rule 14
requires "Compatibility metadata is truthful", and a reviewer diffing the
changelog against the pinned SHA will see an unlisted change set.

**Smallest correct fix:** either bump to `2.9.1` (and update VERSION,
plugin.yaml, dashboard/manifest.json, both BUILD_STAMPs, SPEC.md, CHANGELOG) or
add the tip commit's changes to the existing `2.9.0` changelog section.

---

### F12 — MINOR — the submission file's PR draft quotes stale test counts

**Location:** `docs/CATALOG-SUBMISSION.md` (PR-description draft).

**Quoted:**

```
**Evidence:** `hermes plugins validate .` passes every check including
`security scan — safe`; 242 JS tests, 164 backend tests + 5 skin-contract tests,
16 generator tests (19 collected, 3 skipped) and the catalogue and package
contract gates are green; the build is reproducible from a clean checkout
(byte-identical `plugin.js` and 188 transports).
```

**Failure mode:** the counts are one release stale. At the pin the truth is
**266 JS tests** and **185 pytest passed / 4 skipped** (R10/R11), not 242 and
164+5+16. The "reproducible from a clean checkout (byte-identical plugin.js and
188 transports)" half IS true — I verified it (R1-R5). The `hermes plugins
validate .` half is unverifiable here and, at this pin, its quoted evidence was
produced by a probe the validator **skips** (F1c).

**Smallest correct fix:** regenerate the numbers from the pin before opening the
PR (`node --test "tests/*.test.mjs"` and `python -m pytest tests/ -q`), and
replace the quoted validator output with output from a run that actually
exercised the capability probe (which requires F1 first).

---

### F13 — MINOR — the shipped build is 27 KB under a hard 512 KiB load limit, with no gate watching it

**Location:** `desktop/plugin.js` (497,543 bytes) vs
`apps/desktop/src/contrib/runtime-loader.ts:679-699`.

**Quoted (host):**

```ts
    if (result.truncated) {
      throw new PluginSourceOversizeError(
        "plugin.js exceeds this shell's 512 KiB read limit — update Hermes Desktop to load larger plugins"
      )
    }
```

**Failure mode:** the modern `readPluginSource` IPC allows 16 MiB, but shells
without it fall back to a 512 KiB preview read, and the file is **497,543 bytes**
— 26,745 bytes of headroom, roughly eight to ten more skins. A skin added
without a size check can push the plugin past the limit, and on an older shell
that is not a degraded feature: it is `failed to load`, i.e. the pane does not
exist. No gate in the repo watches the size, and `check-package.py` does not
measure it.

**Smallest correct fix:** measure `desktop/plugin.js` in
`scripts/check-package.py` and fail above a threshold with margin (e.g. 480 KiB
= 491,520 B), naming the host limit in the message. The catalogue is the growth
driver, so this is a per-skin tripwire.

---

### F14 — MINOR — no gate in the repo checks contrast

**Locations:** `scripts/check-packs.py` (no `contrast`/`ratio` token),
`scripts/check-package.py` (none), `scripts/measure/measure-catalogue.py`
(measures, is not a gate, is not in CI).

**Failure mode:** the accepted-known item — 11 light `status_bar_dim` skins at
3.996–4.238:1, below the 4.5:1 AA threshold for body text — passes **every**
gate the repo runs, because no gate measures contrast. `check-packs.py` checks
that both palettes exist, that a `background` and a `ui_accent` are present, and
that the ten v2 surfaces are populated; it never asks whether they are legible.
The measurement tool exists and is not a gate.

**Smallest correct fix:** fold the contrast assertion into `check-packs.py` (it
already has the palettes in hand; the contrast maths is ~20 lines of the
`_contrast` helper already in `scripts/regenerate.py:391-394`) and fail on a
sub-4.5:1 role. The 11 skins then need fixing under the same change, or an
explicit, dated exception list inside the gate.

---

### F15 — MINOR — CI workflow hygiene

**Location:** `.github/workflows/ci.yml` (whole file).

**Findings:**
- No `permissions:` block — the workflow inherits the repository default token
  scopes.
- No `concurrency:` group — a burst of pushes runs the full 3-OS matrix each
  time.
- No `timeout-minutes:` on any job — a hung test burns the 6-hour default.
- `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5` are
  pinned to **floating major tags**, not commit SHAs, in a repository that is
  about to be reviewed by a third party.
- No `workflow_dispatch:` — the gate cannot be re-run on demand from the UI.
- `scripts/check-package.py` runs only in the `build-is-current` job, not in the
  `test` job that runs on all three platforms; a packaging error is therefore
  caught on Linux only.

**Smallest correct fix:** add `permissions: contents: read`, a `concurrency:`
group with `cancel-in-progress: true`, `timeout-minutes: 15` per job, pin the
three actions to SHAs, add `workflow_dispatch:`, and move the
`check-package.py` step into the `test` matrix.

---

### F16 — MINOR — the retired v1 skin table and the 289 KB template both ship in the package

**Locations:** `skins/` (150 tracked files, 664 KB), `desktop/plugin.template.js`
(289,552 bytes), `scripts/` (15 files), `tests/` (37 files), `docs/` (34 files).

**Failure mode:** nothing in the shipped tree reads `skins/` — `regenerate.py:765-770`
reads the catalogue from `skins-v2/` and the v1 table is kept "for the migration
record" — and `install/install-gateway-skins.sh` explicitly refuses it. But the
agent-side install copies the **whole repo** into `plugins/chroma/`, and the
desktop-only install copies the whole `desktop/` directory (so
`plugin.template.js`, the maintainer-facing source of truth, ships to every
user's `desktop-plugins/<name>/`). The package is 5.6 MB of tracked bytes for a
486 KB runtime file.

**Smallest correct fix:** the desktop-half publish step is the host's
(`publishDesktopTree(sourceDir=.../desktop, ...)`) — the cheapest fix is to move
`plugin.template.js` out of `desktop/` (e.g. to `src/`) so the host's `desktop/`
scan publishes only runtime files; and delete `skins/` from the repo, keeping the
migration record in `docs/` if it is wanted.

---

### F17 — MINOR — `regenerate.py` names the wrong directory in its failure message

**Location:** `scripts/regenerate.py:784-786`.

**Quoted:**

```python
    if not user_skins:
        print(f"ERROR: no valid bundled skins found in {skins_dir}; refusing to replace {out_path}.", file=sys.stderr)
        return 1
```

**Failure mode:** `skins_dir` (line 756) defaults to the repo's **retired v1**
`skins/` table, but the catalogue is read from `skins-v2/` (line 769). If the
catalogue is empty or malformed, the error tells the maintainer to look in the
directory the build does not read. Small, but it is the message that has to
diagnose a broken build.

**Smallest correct fix:** use `catalogue_dir` in the message (it is the variable
the loop actually read).

---

## 6. The install claim, settled

**Settled: CODE-READ, and the code says the claim is FALSE at the pin.** This is
not "unproven" — it is disproven, by the host's own detection function, run
against the pinned tree.

The evidence chain, all of it read or re-run in this review:

1. `apps/desktop/electron/desktop-plugin-install.ts:197-203` — the agent half is
   detected **only** when the repo root has `plugin.yaml` **AND** `__init__.py`
   (or a portable `plugin.json`). Chroma's root has `plugin.yaml` and **no**
   `__init__.py` (R13).
2. `plugin-install-run.ts:31-33` — `installComponents` returns
   `{agent: probe.agent, desktop: probe.desktop}` = `{agent: false, desktop: true}`.
3. `plugin-install-run.ts:38-40` — `desktopHalfFromPackage` is
   `components.agent && !remote` → **false** → the `else` branch at `:166-168`
   calls `cloneDesktopHalf` instead of materialising the desktop half out of the
   installed package.
4. `plugin-install-run.ts:171-173` — `if (agentResult?.enabled && agentResult.pluginName) await enablePackageDesktopHalf(...)`.
   `agentResult` is `undefined` (no agent install ran), so **the enable call never
   happens**. The half still ends up enabled by default, but by a different route
   (`runtime-loader.ts:523`, no `.hermes-package.json` marker → `defaultEnabled:
   undefined` → `plugin.defaultEnabled ?? true` → true), not by the mechanism the
   claim names.
5. `desktop-plugin-install.ts:430-441` — the standalone path publishes
   `sourceDir = <clone>/desktop` into `<desktop-plugins-root>/<repo-name>`, where
   the repo name is `chroma-for-hermes` (`repoNameFromUrl`). The Python half,
   `plugin.yaml` and `dashboard/` are **not** published anywhere.
6. `hermes_cli/plugins_cmd_install.py:386-388` — the CLI route *does* land the
   whole repo at `plugins/chroma/`, and `web_server_dashboard.py:559-586` *does*
   mount `/api/plugins/chroma/` from `dashboard/manifest.json` — but
   `plugins_loader.py:704-706` raises `FileNotFoundError: No __init__.py` when the
   plugin itself loads.

**What the user actually gets from the paste-URL route at the pin:** a working
Desktop pane (themes, gallery, preview, favourites, persistence) with **no
backend**: no gateway-skin minting, no rename, no export, no delete, no
categories, no packs, no overrides; the plugin installed under
`desktop-plugins/chroma-for-hermes/` rather than `desktop-plugins/chroma/`.

**What the CLI route gives:** the backend mounted and working, the desktop half
copied to `desktop-plugins/chroma/` — but the agent plugin unloadable
(`No __init__.py`), and the desktop half landing **opt-in** (the unified path
writes the `.hermes-package.json` marker, so `runtime-loader.ts:924` sets
`defaultEnabled: false`), i.e. it needs `hermes plugins enable chroma` or the
dialog's enable step.

**The brief's note that the paste-URL probe "landed the files and then died
(exit 130) BEFORE the enable check" is consistent with this and adds nothing: the
enable check is unreachable on this route, because there is no agent install to
enable.** The claim should not ship as-is in any form. Either add
`__init__.py` (one file, F1) and re-prove the claim on a machine, or restate the
claim as the two-route reality the README's own §Fallbacks already describes.

**Cross-surface naming — this part is sound.** Every identifier the three
surfaces share agrees:

| Thing | Desktop half | Backend | Data | Agrees? |
|---|---|---|---|---|
| Plugin id | `ID = 'chroma'` (`plugin.template.js:66`) | `dashboard/manifest.json` `"name": "chroma"` | — | yes |
| REST base | `pluginRest` → `/api/plugins/${pluginId}` (`apps/desktop/src/api/plugins.ts:80`) | mounted at `/api/plugins/{name}/` (`web_server_dashboard.py:849`) | — | yes |
| Agent package folder | — | `plugins_cmd_install.py:386-388` → `plugins/chroma/` | — | yes |
| 19 REST paths + methods | 19 `_rest(...)` call sites in the template | 19 routes in `plugin_api.py` | — | yes, 1:1 (see below) |
| Local storage keys | `chroma-*` + the app's own `hermes-desktop-*` / `hermes-boot-*` | — | — | yes (`plugin.template.js:72-100`) |
| Scene ids | `scene.name` | `skins-v2/*.yaml` `name:` | `gateway-skins/theme-picker-<name>-{light,dark}.yaml` | yes |

Every desktop-called path exists in the backend with a matching HTTP method:
`GET /skins`, `POST /import`, `DELETE /skins/{name}`, `POST /skins/rename`,
`GET /export`, `GET /schema`, `GET /overrides`, `PUT /overrides/{scene}`,
`DELETE /overrides/{scene}`, `PUT /skins/{name}`, `GET /categories`,
`POST /categories`, `DELETE /categories/{cat_id}`, `POST /skins/duplicate`,
`GET /packs`, `POST /packs/export`, `POST /packs/import`, `DELETE /packs/{slug}`.
Route order is safe: `POST /skins/rename` and `POST /skins/duplicate` are POST
literals with no `POST /skins/{name}` route to shadow, and `GET /skins/{name}`
sits after `GET /skins`.

**Degradation when the backend is absent — sound.** The template's
`!_rest` guard looks dead at first glance (`ctx.rest` is always a function,
`apps/desktop/src/contrib/plugin.ts:366`), but it is a two-stage guard and the
second stage is real: `fetchEditorSchema` (`plugin.template.js:1245-1263`) retires
the transport on the first 404 (`if (isMissingRoute(e)) _rest = null`), and
`isMissingRoute` (`:1742-1747`) recognises 404 by status *or* message. The
"Restart Hermes to enable the editor" notice (`:1758-1765`) then fires. This is
the mechanism that makes the desktop-only install survivable, and it is why F1
degrades to "a working pane with no backend" rather than "a broken pane".

**Does the backend work without the desktop half?** Yes: the dashboard API is
discovered and mounted by its own scan of `<plugins root>/*/dashboard/manifest.json`
(`web_server_dashboard.py:559-586`) and knows nothing about the Desktop half.
**Does the desktop half work without the backend?** Yes — see the paragraph above.

## 7. The embarrassing section

1. **The catalog's own admission gate will report "Validation passed" for a
   plugin that cannot load, and our submission file quotes that output as the
   evidence for four admission rules.** `plugin_validate.py:397-401` skips the
   capability probe when `__init__.py` is absent and records the skip as a
   **pass**. `docs/CATALOG-SUBMISSION.md` presents `loadable — entry:
   desktop/plugin.js`, `security scan — safe`, `desktop surface — stays inside
   the plugin SDK surface` and `no core override` as proof. A reviewer who runs
   the validator sees green; a reviewer who then installs the plugin from the
   catalog sees `No __init__.py in …/plugins/chroma` at every gateway start. The
   green gate is the thing that makes the bug invisible.

2. **The public README tells users "That is the whole install… no file copying,
   no script, no second toggle", and the paste-URL route installs only the
   desktop half, into a folder the README says will be `chroma/` but is actually
   `chroma-for-hermes/`.** The backend — the entire reason the fork exists
   ("imports that mint real gateway skins so the CLI and every connected Desktop
   follow the change", `plugin.yaml:11-13`) — is not installed by the route the
   README recommends, and `scripts/regenerate.py:818-821` prints the same false
   claim to the maintainer on every build. We would be asking a reviewer to trust
   a one-line install claim that the host's own source contradicts, and they have
   the host source.

3. **The plugin's own catalog page renders a broken heading
   (`#### Windows### Linux or manual installation (Desktop half only)`,
   `README.md:116`), the SPEC still advertises version `2.8.1` while the plugin
   ships `2.9.0` (`docs/SPEC.md:10`), and the submission file's evidence line
   quotes test counts from a release ago (242/164+5+16 against the pin's
   266/185).** Those three are the first things a reviewer reads, before any
   code. They are each a two-minute fix and together they read as "this was
   pushed without the docs being re-read".

## 8. Closing

**Total findings by severity: 1 blocker, 4 major, 12 minor.** (F1 blocker;
F2-F6 major; F7-F17 minor — 17 findings total, none invented: each carries the
host or repo line that produces it.)

**Verdict: HOLD.** One missing file at the repo root (`__init__.py`) makes the
package a desktop-only plugin, which falsifies the headline install claim, makes
the catalog's own admission gate vacuous, and is not caught by any gate in the
repo. Everything else on this axis is either a documentation-truth failure
(F7-F12) or a coverage gap in the gate set (F4-F6, F13-F15) — important, and
none of it a blocker on its own.

**What I did NOT verify, stated plainly:**
- The GitHub Actions run itself (no runner here). Every step was re-run locally
  in equivalent form; the workflow file was audited line by line. The "4/4 green"
  claim is **UNVERIFIED** as a CI fact, though each step's local equivalent
  passes at the pin.
- `hermes plugins validate .` — the local CLI does not start on this host. The
  validator was read from source and the decisive function
  (`detectPluginComponents`) was re-implemented verbatim and run against the
  pinned tree. The validator's own output at this pin is **UNVERIFIED** (and per
  F1c it would skip the capability probe).
- A live paste-URL install. Guardrail: "Never point anything at the real
  host-owned directory." The install path is established by code-read plus a
  verbatim re-implementation of the host's detection function, not by an install.
- The 11 low-contrast `status_bar_dim` skins were not re-measured (F14 records
  that no gate checks them, which is the in-axis fact).
- The `install/` scripts were read, not executed, on any platform.
- Whether the 4 pytest skips behave identically on the Linux and macOS CI legs
  (they are `label='symlink'` skips, so on those legs they run).

---

*Review lane F — packaging, CI, gates, cross-surface integration. Pin
`352c3c5ad86db06cc600c3555675e2baf0928e12`. Read-only: no repo file was edited,
created, deleted or staged; `scripts/regenerate.py` was run only in a scratch
clone at `/tmp/chroma-buildcheck/repo`; no `hermes` CLI command was run; nothing
was pointed at the real host-owned directory. The only writes were the gitignored
rigour run-artifacts (`.rigour/`, `rigour-report.json`) and this report.*
