VERDICT: CONFORMS

# Review Lane E — Adherence to the Hermes Plugin guidelines (whole package)

**Chroma for Hermes** (`chroma`), repo `TobiasDraven/chroma-for-hermes`, a hard fork of
`jdtimothy/hermes-theme-picker` (MIT).

The package satisfies the publishing contract. All 17 catalogue admission rules pass on their
enumerated criteria, and the admission gate itself passes 13/13 with a single warning — I did not
have to predict that output, I produced it (§6). Nothing here is a rule-3 or rule-9 decline.

Two things must be fixed **before the PR opens** (they are PR-text and comment fixes, not design
changes): the network disclosure under-states the reachable endpoint set (F1, major), and the
in-code justification for writing the host's root theme markup is factually false (F2, major).
The drafted entry's `sha` is three commits stale and must be re-pinned (F6, minor).

---

## 2. PIN and sources

**PIN under review:** `352c3c5ad86db06cc600c3555675e2baf0928e12` (branch `main`).
`git rev-parse HEAD` = `352c3c5ad86db06cc600c3555675e2baf0928e12`; `git status --porcelain` empty.
The working tree was **not** the subject: I exported the pin read-only with
`git archive 352c3c5 | tar -x -C <scratch>` into
`C:/Users/<user>/AppData/Local/Temp/opencode/review-E/pin` and did every tree-level check there.
**No file in the repository was created, edited, deleted or staged; no git write command was run.**
The only file I wrote is this report.

### Sources read

| Source | Path | What it is |
|---|---|---|
| Catalogue rules (canonical) | `C:/Users/<user>/AppData/Local/hermes/hermes-agent/plugin-catalog/README.md` | the 17 admission rules + entry schema |
| Submission guide | `…/website/docs/developer-guide/plugins/catalog-submission.md` (fetched from GitHub) | the same rules + what reviewers read |
| Admission gate | `…/hermes_cli/plugin_validate.py` (665 lines) | the gate the CLI's `plugins validate` wraps |
| Desktop-surface lint | `…/hermes_cli/plugin_validate_desktop.py` (161 lines) | rule 8's mechanical form |
| Core-override lint | `…/hermes_cli/plugin_validate_core_override.py` (331 lines) | rule 9's mechanical form |
| Install scanner | `…/tools/plugin_guard.py` (396 lines) + `…/tools/skills_guard.py` | the `security scan` check + every pattern |
| Manifest model | `…/hermes_cli/plugins_manifest.py` | `plugin.yaml` field set, valid `kind`s |
| Catalogue entry parser | `…/hermes_cli/plugin_catalog.py` | `_SHA_RE`, `_NAME_RE`, `entry_from_mapping` |
| Structural gate | `…/scripts/validate_plugin_catalog.py` | the CI's entry-schema gate |
| Payload gate | `…/scripts/scan_plugin_payloads.py` | rule 17's mechanical form |
| Admission CI | `…/.github/workflows/plugin-catalog-ci.yml`, `…/.github/actions/plugin-validate/action.yml` | what actually runs on an entry PR |
| Desktop SDK contract | `…/apps/desktop/src/contrib/plugin.ts:181-194`, `…/runtime-loader.ts:423,496`, `…/src/sdk/index.ts:2048` | what a `desktop/plugin.js` must export |
| Host theme system | `…/apps/desktop/src/themes/context.tsx:328,479-480`, `…/src/hooks/use-theme-epoch.ts:9,16-17`, `…/src/themes/presets.ts:444-458`, `…/src/themes/user-themes.ts:46,70,141` | the app's public theme protocol and built-in theme names |
| Desktop installer | `…/apps/desktop/electron/desktop-plugin-install.ts:181-195` | `findDesktopEntry` — the layout it accepts |
| Live catalogue | `NousResearch/hermes-agent` `plugin-catalog/` via `gh api` (705 yaml + `README.md`) | 704 real entries + `removed.yaml` |
| Upstream fork | `jdtimothy/hermes-theme-picker` via GitHub API | 281 files, `VERSION` 1.5.1, last push 2026-08-08 |

---

## 3. Rule-by-rule table

| # | Rule | Verdict | Deciding evidence |
|---|---|---|---|
| 1 | Human-merged PR only | **PASS** | n/a — the submission act. `docs/CATALOG-SUBMISSION.md` "Procedure" 1-5 |
| 2 | Exact 40-hex SHA pin | **PASS** | `docs/CATALOG-SUBMISSION.md` entry `sha: 43f8e1ba0ca277825b833cd94aa5a8c395bcd5d0`; host `_SHA_RE = ^[0-9a-f]{40}$` (`plugin_catalog.py:43`); `entry_from_mapping` parsed it; `scripts/validate_plugin_catalog.py` → `OK: 1 file(s) valid`. **Staleness is a separate finding (F6)** — the sha is a real, reachable ancestor commit, not the tip. |
| 3 | No self-updating code | **PASS** | the CI's own self-updater grep (`.github/workflows/plugin-catalog-ci.yml:342-346`) over the pin returns **nothing**; zero `!`+backtick, zero `releases/latest`, zero `raw.githubusercontent`, zero `codeload` in any JS file. The only network call in the build is `desktop/plugin.js:875`. No `import()` of a remote URL, no `writeTextFile`/`renamePath`/`writeFile` in any `.js`. |
| 4 | SHA bumps are new PRs | **PASS** | process; `docs/CATALOG-SUBMISSION.md` "Procedure" 5: "Later updates are SHA-bump PRs, never a self-update" |
| 5 | Owner or major contributor submits | **PASS** | `maintainer: TobiasDraven` = the repo owner (`TobiasDraven/chroma-for-hermes`). Not a drive-by. |
| 6 | Declared capabilities match reality | **PASS** (by inspection — the gate cannot check it here) | `plugin.yaml:5-8` declares `provides_tools: []`, `provides_hooks: []`, `provides_middleware: []`, `requires_env: []`. Reality: `ctx.register` × 5 and `ctx.rest` × 1 only (`desktop/plugin.js:6204,6225-6261`); **zero** `register_tool` / `register_hook` / `register_middleware` in either half (grep over `desktop/plugin.js` + `dashboard/plugin_api.py` → no match); **zero** `os.environ`/`.env`/`auth.json`/credential reads (the only env read is the `HERMES_HOME` fallback at `dashboard/plugin_api.py:34`, used for path resolution, not a secret). **Caveat:** the gate's capability probe is *skipped* for a plugin with no `__init__.py` (`plugin_validate.py:397-402`), so rule 6 is satisfied by reading the code, not by the gate. |
| 7 | The install scanner runs at admission | **PASS** | `tools/plugin_guard.scan_plugin()` on the pin → **verdict `safe`**, 27 findings (15 medium, 12 low), **0 high, 0 critical** (see §6). |
| 8 | Desktop plugins stay inside the SDK surface | **PASS** | `check_desktop_surface` → `stays inside the plugin SDK surface`. Per-pattern: prototype patching 0; `eval`/`new Function` 0; dynamic `import()` 0; remote `import 'scheme:'` 0; script injection 0; `data-slot`/`data-tour`/`data-sidebar`/`data-testid` **0**; `document.body` MutationObserver **0**. The two `MutationObserver` hits are `desktop/plugin.js:2592` and `:5134` — see §5 F2 and §7. |
| 9 | No runtime overrides of Hermes core | **PASS** | `check_core_override` → `no runtime rebinds of Hermes core`. The plugin's Python runtime surface is `dashboard/plugin_api.py` (the import closure the lint walks, `plugin_validate_core_override.py:82`). No `setattr` on a core object, no `sys.modules[...] =`, no `AIAgent.<method> =`, no `mock.patch`. |
| 10 | Dependency security policy is the plugin's | **PASS** | `python dependencies — none declared`; no `pyproject.toml`, no `python_dependencies`, no `pip_dependencies` in `plugin.yaml`. Nothing to floor, so no bare floor to bound. (`fastapi`/`pydantic` in `dashboard/plugin_api.py` are Hermes core deps, already present in the host env.) |
| 11 | Credentials come through Hermes | **PASS** | `requires_env: []`; no credential store is read anywhere: no `auth.json`, no `.env`, no keychain, no browser profile, no vendor token file, no `agent.secret_scope` needed. `os.environ.get("HERMES_HOME", …)` (`dashboard/plugin_api.py:34`) is a *path* fallback, and only when the documented `hermes_constants.get_hermes_home()` import fails (`:31-32`). |
| 12 | Approvals and unattended runs respected | **PASS** | no shell, no subprocess, no child process in the shipped code (`scripts/regenerate.py` and `scripts/check-package.py` use `subprocess.run` but are dev tooling, never loaded by Hermes; the lint's runtime set is `__init__.py` + `dashboard/*.py` only). The `install/*.sh`/`.ps1`/`.cmd` scripts are user-invoked setup helpers, not runtime. No auto-approval, no guard-disabling. |
| 13 | Risky behaviour is disclosed | **FAIL (incomplete) → F1** | the README has a "What it touches" section and the PR draft has a "Disclosure" paragraph, so the *form* of rule 13 is met. But both say the only external request is `https://tweakcn.com/r/themes/<name>`; `tweakcnUrl()` (`desktop/plugin.js:845-859`) returns **any** user-supplied `http(s)://` URL verbatim, including plaintext `http://`. The endpoint set is under-disclosed. |
| 14 | Compatibility metadata is truthful | **PASS** | `version: "2.9.0"` in five places that agree: `plugin.yaml:2`, `VERSION:1`, `desktop/plugin.js:58` (`BUILD_STAMP = '2.9.0'`), `dashboard/manifest.json:6`, `CHANGELOG.md:6`, plus the entry's `version: "2.9.0"`. `requires_hermes: ">=0.22.0"` parses (`_requires_hermes_spec_valid`) and is **not newer than the current release** — this host checkout reports `0.22.2`. |
| 15 | No skins or forks of bundled plugins | **PASS** | Chroma is a standalone third-party plugin, not a fork of a *bundled* Hermes plugin. No vendor-lookalike: the 94 `skins-v2/` names, the 188 `gateway-skins/` names and the 150 retired `skins/` names have **zero** exact intersection with the host's `BUILTIN_THEMES` (`nous, github, catppuccin, everforest, solarized, nous-alt, classic, midnight, ember, mono, slate, cyberpunk`) or `RETIRED_SKINS` (`nous-light, default, gold`). Chroma also mints only prefixed gateway skins (`TRANSPORT_PREFIX = "theme-picker-"`, `dashboard/plugin_api.py:945`). |
| 16 | One listing per plugin lineage | **PASS** | the upstream fork is **not** in the catalogue (704 entries: no `theme-picker`, no `hermes-theme-picker`; only `claude-code-theme`, `t3-code-theme`, `wallpaper-theme` match "theme"), and `removed.yaml` lists neither. So there is no competing entry to be declined in favour of. The fork is **materially different**: upstream = 281 files, `plugin/plugin.js` at 921 lines, 140 v1 skins, 114 transports, `VERSION` 1.5.1, no backend, no importer, last push 2026-08-08; Chroma = 538 files, `desktop/plugin.js` at 6263 lines, 94 v2-schema skins, 188 transports, a 2493-line FastAPI backend that mints gateway skins, TweakCN import, packs/favourites/preview/colour-families/a11y, `VERSION` 2.9.0. **Origin is named** in the README (top block + "Credits"), `plugin.yaml` description, `LICENSE:3-4` (both copyright lines), `THIRD_PARTY_NOTICES.md`, and the PR draft's "**Lineage:** derived from jdtimothy/hermes-theme-picker (MIT)". Rule 16's literal `Derived from <entry>` form does not apply: there is no entry to name. |
| 17 | No unscannable executable payloads | **PASS** | `scripts/scan_plugin_payloads.py` on the pin → **exit 0, no output**. My own header-based sweep (ELF / Mach-O / PE-`MZ` / WASM / ZIP / GZIP / BZIP2 / XZ, plus `.pyc/.pyo/.so/.dll/.dylib/.exe/.wasm` and every archive extension) over all 538 files → **0 hits**. No `attested_binaries` needed. |

### The manifest, field by field

`plugin.yaml` (15 lines) against `hermes_cli/plugins_manifest.py`. Required by the gate:
`name`, `version`, `description` (`plugin_validate.py:101-112`) — all present.

| Field | Value | Verdict |
|---|---|---|
| `name` | `chroma` | PASS — equals the catalogue key; equals the Desktop plugin id (`desktop/plugin.js:67,6201`) |
| `version` | `"2.9.0"` | PASS — rule 14 |
| `manifest_version` | `1` | PASS — supported (`SUPPORTED_MANIFEST_VERSION = 2`); but v1 means unknown fields log at DEBUG, not WARNING |
| `kind` | `plugin` | **FAIL → F3** — not in `_VALID_PLUGIN_KINDS` (`plugins_manifest.py:27`); the host logs `unknown kind 'plugin' … treating as 'standalone'` and coerces it |
| `provides_tools` | `[]` | PASS — truthful |
| `provides_hooks` | `[]` | PASS — truthful |
| `provides_middleware` | `[]` | **FAIL (cosmetic) → F4** — not in `_KNOWN_MANIFEST_FIELDS` (`plugins_manifest.py:32-39`); the loader ignores it (`unknown manifest field(s) ignored: provides_middleware`). The *gate* does read it (`plugin_validate.py:420`), so the value is honoured where it matters — it is simply not a field the plugin manifest knows. |
| `requires_env` | `[]` | PASS — truthful |
| `requires_hermes` | `">=0.22.0"` | PASS — parses; ≤ current 0.22.2 |
| `description` | prose | PASS |
| `license` | `MIT` | PASS |
| `homepage` | `https://github.com/TobiasDraven/chroma-for-hermes` | PASS — https, matches the entry `repo` |
| `author` | "Tobias Draven (fork maintainer) · original … Joshua Timothy" | PASS |
| not declared | `config_schema`, `python_dependencies`, `capabilities`, `requires_auth`, `provides_locales`, `api_version`, `requires_plugins`, `tags`, `hooks`, `emits`, `listens`, `hermes`, `depends`, `python_runtime`, `platforms`, `pip_dependencies`, `optional_env`, `label` | all correctly absent |

Note on `capabilities:`: in a **plugin manifest** that key is a *list of capability ids*
(`tools.override`, `llm.provider_override`, … — `plugin_capabilities.py:28-50`). Chroma's manifest
correctly omits it. The `capabilities:` **mapping** in `docs/CATALOG-SUBMISSION.md` is the *catalogue
entry* schema (`plugin-catalog/README.md:174-178`) and is correct there.

### `register()` contract

| Requirement | Reality at the pin | Verdict |
|---|---|---|
| Synchronous (no top-level await) | `register(ctx) {` at `desktop/plugin.js:6203` is a plain method — not `async`, no `await` in its body. The host calls it synchronously (`runtime-loader.ts:496`). | PASS |
| `id` present and stable | `export default { id: ID, … }` with `const ID = 'chroma'` (`desktop/plugin.js:67,6200-6201`); the loader rejects a plugin without it (`runtime-loader.ts:423`) | PASS |
| `version` matching the manifest | **The brief's premise is wrong here.** The Desktop `HermesPlugin` interface (`apps/desktop/src/contrib/plugin.ts:181-194`) has `id`, `name?`, `description?`, `defaultEnabled?`, `register` — **no `version` field at all**, and the loader does not check one. The version-truthfulness requirement lives in rule 14 (entry `version` vs pinned code), which holds: 2.9.0 in six places. | PASS (premise corrected) |
| Registration surface | 5 `ctx.register` calls: `THEMES_AREA` (per-skin theme objects), `ROUTES_AREA` (`/chroma`), `SIDEBAR_NAV_AREA`, `PALETTE_AREA`, `STATUSBAR_AREAS.right` (`desktop/plugin.js:6225-6261`); plus `ctx.rest` (`:6204`) | PASS |

### SDK import rules — every import in the shipped build

Three import statements, all in the shipped `desktop/plugin.js:27-53`:

```
import { Badge, Button, cn, EmptyState, haptic, host, Input, oklchToHex, PALETTE_AREA,
         ROUTES_AREA, ScrollArea, SearchField, Select, SelectContent, SelectItem, SelectTrigger,
         SelectValue, SegmentedControl, SIDEBAR_NAV_AREA, STATUSBAR_AREAS, THEMES_AREA,
         useTheme, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Component, cloneElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
```

`import()` → **0**. `eval` → **0**. `new Function` → **0**. Prototype patching → **0**
(`Array.prototype.slice.call` at `:2790` is a *read*; the lint requires an assignment; the
`'__proto__'` strings at `:343,346` are a comment and a `Set` member). Script injection → **0**.

### The `desktop surface` check — every hit, with the verdict

| Pattern | Hits in the shipped build | Verdict |
|---|---|---|
| `data-slot` / `data-tour` / `data-sidebar` / `data-testid` | **0** | PASS — confirmed by grep over `desktop/plugin.js` and `desktop/plugin.template.js` |
| `document.querySelector*` / `getElementById` with a `[data-*]` selector | **0** | PASS — the only `querySelectorAll` is `root.querySelectorAll(FOCUSABLE_SELECTOR)` at `:2790`, where `root` is a plugin-owned ref (`inputRef`/`noRef`/`renameButtonRef`/`deleteButtonRef`/`cardRef`/`actionsRef`/`manageRef`), never `document`, and `FOCUSABLE_SELECTOR` (`:2785`) contains no `[data-*]` |
| `document.body` MutationObserver | **0** | PASS — `document.body` appears twice, at `:1810` and `:1812`, inside `saveTextFile`: the plugin appends **its own** `<a download>` anchor to the body to hand a Blob to Electron's download handler, then removes it. Not an observer, not a subtree watch |
| `MutationObserver` | **2** — `:2592`, `:5134` | **PASS.** Both: `observer.observe(root, { attributes: true, attributeFilter: ['data-hermes-theme'] })` / `['data-hermes-mode']`, where `root = document.documentElement` (`:2587`, `:5131`); read-only (`sync` only reads `root.dataset.*`); `observer.disconnect()` on cleanup (`:2611`, `:5137`); never `document.body`; never `childList`/`subtree`. **Precedent in the host itself:** `apps/desktop/src/hooks/use-theme-epoch.ts:16-17` uses the identical idiom — `new MutationObserver(...)` + `observer.observe(document.documentElement, { attributeFilter: ATTRS, attributes: true })` — with `ATTRS = ['class','style','data-hermes-mode','data-hermes-theme']` (`:9`). Chroma's observers are a narrower instance of the app's own sanctioned pattern. |
| prototype patching / `eval` / `new Function` / dynamic `import()` / remote import / script tag | **0** each | PASS |

### The `security` scan — what it would report, and whether any finding blocks

I ran the host's own scanner (`tools/plugin_guard.scan_plugin`, `plugin-guard-v11`) over the pin:

```
verdict: safe
summary: pin: safe — 27 finding(s) in execution, network, persistence, structural, supply_chain, traversal
27 findings: 15 medium, 12 low — 0 high, 0 critical
```

| Pattern | n | Severity | Where | Real blocker? |
|---|---|---|---|---|
| `too_many_files` | 1 | medium | `(directory)` — 538 files vs the scanner's 400 limit | **No.** medium never blocks (`_determine_verdict`: critical→dangerous, high→caution, medium/low→safe). It is visible in the CI log, though — F9. |
| `oversized_file` | 1 | medium | `docs/chroma-banner.png` 1383KB vs the 1MB single-file limit | No. F9. |
| `unpinned_pip_install` | 3 | medium | `.github/workflows/ci.yml:35,65`, `README.md:230` (dev-only pip) | No. |
| `python_subprocess` | 8 | medium | `scripts/check-package.py:109`, `tests/test_*.py` | No — dev tooling and tests, never loaded by Hermes. |
| `path_traversal` | 2 | medium | `tests/test_plugin_api.py:193,351` (fixtures asserting the *refusal* of `../../escape`) | No. |
| `agent_config_ref` / `other_agent_config_ref` | 11 | low | `AGENTS.md`, `docs/DISCLOSURE.md`, `rigour.yml`, plan docs | No. |
| `hardcoded_ip_port` | 1 | low | `AGENTS.md:93` | No. |

**The 20 `${...}` template literals are NOT flagged.** The brief's premise is wrong, and so is the
repo's own belief about it. The host's `inline_shell_exec` pattern is
``!`[^`\s][^`\n]*` `` (`tools/skills_guard.py:390-394`) — a backtick **preceded by `!`**, i.e. the
`` !`cmd` `` auto-exec DSL. It does not look for `${`. The build has **0** occurrences of
`` !` ``. The 20 `${…}` lines (`desktop/plugin.js:135,136,137,139,140,179,502,848,859,867,876,2705,2724,2753,5211,5843,6028,6171,6186,6226`) are ordinary JS template literals and produce **no
finding at all**. See F8: the repo's `AGENTS.md` §3 rule 5 and the code comment at
`desktop/plugin.js:5210-5211` both assert the opposite, and a reviewer will read that comment.

### Declarations vs reality — the full answer

- **Does `register()` register a tool?** No. `ctx.register` × 5, all SDK *area* contributions
  (`THEMES_AREA`, `ROUTES_AREA`, `SIDEBAR_NAV_AREA`, `PALETTE_AREA`, `STATUSBAR_AREAS.right`).
  Zero `register_tool` in either half.
- **A hook?** No. Zero `register_hook`.
- **Middleware?** No. Zero `register_middleware`.
- **An env var?** No. `requires_env: []` and the code reads no env var except the `HERMES_HOME`
  path fallback (`dashboard/plugin_api.py:34`).
- **Does it need one?** No. It has no credential, no API key, no account. The only credential-shaped
  thing anywhere near it is `ctx.rest` — the *sanctioned* door the host itself documents for a
  plugin that ships a `plugin_api.py` (`apps/desktop/src/contrib/plugin.ts:147-150`).
- **Verdict:** the four empty declarations are **truthful**. The gate cannot prove this for a
  plugin with no `__init__.py` (the probe is skipped, `plugin_validate.py:397-402`) — I proved it by
  reading the code.

### Directory layout

| Piece | Where | Host expectation | Verdict |
|---|---|---|---|
| Manifest | `plugin.yaml` at repo root | required by the CI's pinned-source gate (`plugin-catalog-ci.yml:253-256`) and by the gate's `manifest` check | PASS |
| Desktop half | `desktop/plugin.js` | `_LOADABLE_ENTRYPOINTS` includes `desktop/plugin.js` (`plugin_validate.py:558`); the installer prefers a root `plugin.js`, else `desktop/plugin.js` (`desktop-plugin-install.ts:181-195`) — Chroma takes the second branch | PASS |
| Build source | `desktop/plugin.template.js` → `desktop/plugin.js` | the repo's own contract; **I regenerated the build from the template at the pin and it is byte-identical** (`diff -q` → identical; `gateway-skins/` and `docs/DERIVED-PALETTES.md` also identical) | PASS |
| Backend | `dashboard/manifest.json` + `dashboard/plugin_api.py` | the dashboard route surface; the host reads `name/label/description/icon/version/tab/slots/api` (`web_server_dashboard.py:520-548`); `api: "plugin_api.py"` | PASS |
| Python plugin | *(none — no `__init__.py`)* | a Desktop-only plugin; the Python plugin manager never loads it, and the gate's `loadable` check passes on `desktop/plugin.js` | PASS (one warning) |

### The entry itself

`docs/CATALOG-SUBMISSION.md`'s YAML block, fed to the host's own parsers:

- `hermes_cli.plugin_catalog.entry_from_mapping(...)` → a fully populated `PluginCatalogEntry` with
  `capabilities=CatalogCapabilities(provides_tools=[], provides_hooks=[], provides_middleware=[],
  requires_env=[])`. **PASS**
- `scripts/validate_plugin_catalog.py` (the CI's structural gate) → `OK: 1 file(s) valid`, exit 0.
  **PASS**
- `sha` — 40 lowercase hex, a real commit object, an ancestor of the tip. **PASS as a pin;
  F6 as a tip.**
- `name: chroma` — free. The live catalogue has **704 entries**; `chroma` is not among them, and
  `removed.yaml` (12 lines) does not list it or the repo URL. **PASS**
- `category: desktop` — right. The user-facing surface is a Desktop pane; the
  `dashboard/manifest.json` is the *backend* route namespace for that pane (`tab.hidden: true`),
  not a separate web product. **PASS**
- `tier: community` — correct; only maintainers set `official`/`verified`.
- `version: "2.9.0"` — matches the pinned code. **PASS**
- `readme: true` — the README at the pinned sha renders on the plugin page. **PASS**

### CI at the pin

`gh api repos/TobiasDraven/chroma-for-hermes/actions/runs/39396539351/jobs` →
`build-is-current: success`, `test (macos-latest): success`, `test (windows-latest): success`,
`test (ubuntu-latest): success` — **4/4 green at `352c3c5`**.

---

## 4. What I actually ran vs what I only read

### RAN (executed, output in hand)

| # | Command | Result |
|---|---|---|
| R1 | `git rev-parse HEAD`, `git status --porcelain` in the repo | pin confirmed `352c3c5…`; tree clean |
| R2 | `git archive 352c3c5 \| tar -x -C <scratch>` | read-only export of the pin to a scratch path outside the repo |
| R3 | `hermes_cli.plugin_validate.validate_plugin_dir(<pin>)` — the **real gate**, driven through its own module because the `hermes` CLI cannot start here | **13 checks, 13 PASS, 1 warning, `ok: True`, exit_code 0** (full output in §6) |
| R4 | `tools.plugin_guard.scan_plugin(<pin>)` + `_walk` file/size census | `safe`; 27 findings (15 medium / 12 low); 538 files, 5721 KB |
| R5 | `hermes_cli.plugins_manifest.parse_manifest_file(plugin.yaml)` with a log capture | surfaced the two real manifest warnings: `unknown kind 'plugin'` and `unknown manifest field(s) ignored: provides_middleware` |
| R6 | `hermes_cli.plugin_catalog.entry_from_mapping(<draft entry>)` | entry parses; all fields populated |
| R7 | `scripts/validate_plugin_catalog.py <draft entry>` | `OK: 1 file(s) valid`, exit 0 |
| R8 | `scripts/scan_plugin_payloads.py <pin>` | exit 0, no output (rule 17) |
| R9 | the CI's **exact** self-updater grep (`plugin-catalog-ci.yml:342-346`) over the pin | empty — no self-updating code |
| R10 | `python scripts/regenerate.py` in the **scratch** copy, then `diff -q` vs the committed build | `desktop/plugin.js` byte-identical; `gateway-skins/` and `docs/DERIVED-PALETTES.md` identical |
| R11 | `gh api …/actions/runs?head_sha=352c3c5…` and `…/jobs` | 1 run, 4 jobs, all `success` |
| R12 | `gh api repos/NousResearch/hermes-agent/contents/plugin-catalog` | 705 yaml + README.md; `chroma` absent; `theme-picker` absent |
| R13 | `curl …/plugin-catalog/removed.yaml`, `curl …/catalog-submission.md` | removed list does not name chroma; the submission guide read in full |
| R14 | `gh api` on `jdtimothy/hermes-theme-picker` (tree + repo metadata) | 281 files, `VERSION` 1.5.1, last push 2026-08-08 |
| R15 | my own header-based binary/pyc/archive sweep over all 538 files | 0 hits |
| R16 | greps over the pin: imports, `import(`, `eval`, `new Function`, `.prototype.`, `data-*`, `document.*`, `MutationObserver`, `fetch(`, `ctx.*`, `host.*`, `register_tool|hook|middleware`, localStorage keys, `${` count, `!`+backtick count | all counts quoted above |
| R17 | Python: parsed all 94 `skins-v2/*.yaml`, 188 `gateway-skins/*.yaml`, 150 `skins/*.yaml` names and intersected them with the host's `BUILTIN_THEMES` / `RETIRED_SKINS` | 0 collisions in all three sets |
| R18 | verified all 7 app-owned localStorage keys against the host's own source | every one is a key the app already uses (see F1/F2 notes) |
| R19 | the gate **re-run at the draft pin** `43f8e1b` | also 13/13 PASS — the drafted sha would also pass CI |

### READ ONLY (never executed)

- `hermes_cli/plugin_validate.py`, `plugin_validate_desktop.py`, `plugin_validate_core_override.py`,
  `plugin_validate_private_imports.py`, `plugin_validate_locales.py`, `plugin_isolation_audit.py`
- `tools/plugin_guard.py`, `tools/skills_guard.py`, `tools/plugin_guard_context.py` (pattern table)
- `hermes_cli/plugins_manifest.py`, `plugin_capabilities.py`, `plugin_catalog.py`, `web_server_dashboard.py`
- `apps/desktop/src/contrib/{plugin,types,runtime-loader}.ts`, `src/sdk/index.ts`,
  `src/themes/{context.tsx,presets.ts,user-themes.ts}`, `src/hooks/use-theme-epoch.ts`
- `apps/desktop/electron/desktop-plugin-install.ts`
- `.github/workflows/plugin-catalog-ci.yml`, `.github/actions/plugin-validate/action.yml`
- The plugin's own `README.md`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`,
  `docs/{DISCLOSURE,CATALOG-SUBMISSION,SPEC,ARCH,DECISIONS,TASKS}.md`, `docs/PLANS/CHROMA-ROADMAP.md`
- `install/install-gateway-skins.sh` (head), `.github/workflows/ci.yml`

### NOT VERIFIED (honest gaps)

- **The `hermes` CLI itself never ran here** (`cannot recover dependency publication … run 'hermes pm repair'`).
  I drove `hermes_cli.plugin_validate.validate_plugin_dir` directly — the exact function
  `hermes_cli.main plugins validate` calls (`plugins_cmd_catalog.py:804`) — so the *checks* are
  authoritative, but I did not exercise the CLI's argument parsing, its `--install-deps` path, or
  its exit-code plumbing. I also did not run the gate with `--install-deps` (which CI does); with no
  `python_dependencies` declared, that path is a no-op for this plugin.
- **CI runs the gate against `hermes-agent` `main` at PR time**, not against this checkout. A future
  hermes-agent change could add a check this review did not see.
- **No runtime observation.** Nothing here was loaded into Electron. Whether the picker renders,
  applies and reverts correctly is not a question this lane answers.
- **`docs/PLANS/CHROMA-ROADMAP.md`'s 4 `UNVERIFIED` marks** are the repo's own honest self-labels;
  I did not discharge them (except the one at `:141`, which this review's gate run does discharge).
- **The catalogue CI's `attested_binaries` path** was not exercised (not applicable — the entry
  declares none).
- **I did not run the repo's own test suites** (`node --test`, `pytest`) — code quality is another
  lane's subject. The 4/4 CI result at the pin covers them.

---

## 5. Findings

### F1 — the network disclosure under-states the reachable endpoint set — **major**

`desktop/plugin.js:845-859` (template: `desktop/plugin.template.js:845-859`)

```js
function tweakcnUrl(ref) {
  ref = (ref || '').trim()
  if (!ref) return null
  if (!/^https?:\/\//i.test(ref)) return `${TWEAKCN_BASE}${slug(ref)}.json`

  const bare = ref.split(/[?#]/)[0].replace(/\/+$/, '')
  // Already a registry endpoint - hand it through untouched.
  if (/\/r\/themes\/[^/]+$/i.test(bare)) return ref
  if (!/^https?:\/\/(www\.)?tweakcn\.com\//i.test(bare)) return ref
  …
```

and `desktop/plugin.js:875`

```js
  const r = await fetch(url)
```

**The behaviour:** when the user pastes something that starts with `http://` or `https://`, the URL
is returned **verbatim** and fetched — the origin is never checked. `https://anything.example/x`
and `http://192.168.1.1/` are both accepted. Only a *tweakcn.com page* URL is rewritten to the
registry endpoint.

**What is disclosed:** README §"What it touches" says "**Network:** one HTTPS `GET` to
`https://tweakcn.com/r/themes/<name>` when you import a TweakCN preset. Nothing else leaves the
machine". `docs/DISCLOSURE.md` §3 says "`fetch` appears exactly once in the build, fetching
`https://tweakcn.com/r/themes/<name>.json`". The PR draft's Disclosure paragraph says "importing a
TweakCN preset makes one HTTPS `GET` to `https://tweakcn.com/r/themes/<name>`".

**Rule broken:** rule 13 — "network calls to third-party services … goes in the PR description and
the plugin's README … undisclosed behaviour found in review is a request for changes." The
disclosure is *present* but *inaccurate*: the reachable endpoint set is "any URL the user pastes",
not "tweakcn.com". A plaintext `http://` request is also possible, which the words "HTTPS" and
"nothing else leaves the machine" both rule out.

**Why major and not minor:** the disclosure is the thing rule 13 exists to protect, and a reviewer
who reads `tweakcnUrl` will find the gap in under a minute. The actual risk is low (the user
initiates it; the response is only parsed as a JSON theme and never evaluated), but "the disclosure
is wrong" is exactly the finding that turns a PR into a request for changes.

**Smallest correct fix** (one of):
- *(text only, keeps the feature)* — amend the README, `docs/DISCLOSURE.md` §3 and the PR
  Disclosure paragraph to: *"one `GET` to the URL you paste in the import box (a bare preset name
  is expanded to `https://tweakcn.com/r/themes/<name>.json`); the URL is used as given, including
  `http://` if you type it"*; and
- *(hardening, optional)* — in `tweakcnUrl`, reject any host other than `tweakcn.com` (and any
  `http://` scheme), e.g. one line: `if (!/^https:\/\/(www\.)?tweakcn\.com\//i.test(ref)) return null`.

---

### F2 — the in-code justification for writing the host's root theme markup is false — **major**

`desktop/plugin.js:1853-1855`

```js
/**
 * Immediate local repaint — a source-faithful port of Desktop's applyTheme().
 * The public plugin SDK does not expose ThemeContext.setTheme/setMode, so this
 * updates the same root tokens and native window hooks without navigating or
 * remounting the React app.
 */
```

**The behaviour:** `applyDesktopTheme()` writes the host's root element directly —
`desktop/plugin.js:1870-1872`:

```js
  root.dataset.hermesTheme = theme.name
  root.dataset.hermesMode = rendered
  root.classList.toggle('dark', isDark)
```

plus the host's `--theme-*` / `--dt-*` custom properties (`desktop/plugin.js:1905-1907`), the
`color-scheme` property, the native chrome hooks (`window.hermesDesktop?.setTitleBarTheme` /
`setNativeTheme`, `:1911-1912`) and the `hermes-boot-*` localStorage hints (`:1916-1918`).

**The premise is false.** The SDK **does** export `useTheme` (`apps/desktop/src/sdk/index.ts:2048`:
`export { useTheme } from '@/themes/context'`), and the app's `ThemeContextValue` **does** expose
`setTheme` and `setMode` (`apps/desktop/src/themes/context.tsx:479-480`). The plugin itself calls
them at `desktop/plugin.js:1931-1935`:

```js
function syncDesktopState(name, mode, api) {
  const target = api || desktopThemeApi
  if (!target || typeof target.setTheme !== 'function') return false
  try {
    target.setTheme(name)
    if (typeof target.setMode === 'function') target.setMode(mode)
```

So the comment contradicts the plugin's own code 80 lines later, and `docs/DISCLOSURE.md` §5 repeats
the same false claim ("The SDK exposes no decoration slot — no `setTheme`/`setMode` on the
renderer's ThemeContext is reachable from the public plugin surface").

**Rule touched:** rule 8 ("no reaching into the app's … own markup … to restyle … core UI") and
rule 9. **The rule-8 verdict is still PASS** — the plugin performs none of the enumerated
prohibitions, and the write targets the app's *public* theme protocol, which the host's own
provider writes identically (`apps/desktop/src/themes/context.tsx:328`:
`root.dataset.hermesTheme = skinName`; the host's own `use-theme-epoch.ts:9` declares
`['class','style','data-hermes-mode','data-hermes-theme']` as the theme-epoch attribute set). But
the *reason* the plugin gives for bypassing the sanctioned surface is untrue, so a reviewer has no
accurate justification to read and must either accept it on trust or block the PR.

**Smallest correct fix** (text, not design): correct the comment at `:1853-1855` and
`docs/DISCLOSURE.md` §5 to state what is actually true — *"the SDK's `setTheme` repaints on the
provider's next render; this is the immediate, pre-render paint, written through the app's own
documented root-token protocol (`data-hermes-theme` / `data-hermes-mode` / `--theme-*`), the same
attributes Desktop's own provider writes (`themes/context.tsx:328`)"* — and add one line to the PR
disclosure saying that the plugin writes the app's root theme attributes/tokens as well as calling
`setTheme`. The design change (drop the direct write, rely on `setTheme` alone) is a bigger call
and is not required by any rule; if the immediate repaint is genuinely wanted, it can stay.

---

### F3 — `kind: plugin` is not a Hermes plugin kind — **minor**

`plugin.yaml:4`

```yaml
kind: plugin
```

The host's valid kinds are `standalone | backend | exclusive | platform | model-provider`
(`hermes_cli/plugins_manifest.py:27`). Parsing the manifest at the pin emits, verbatim:

```
WARNING: Plugin chroma/pin: unknown kind 'plugin' (valid: backend, exclusive, model-provider, platform, standalone); treating as 'standalone'
```

It is a warning, not a failure — the plugin still loads as `standalone`. But the manifest asserts a
kind that does not exist, and the warning is printed in every user's load log.

**Rule:** none of the 17 is broken; this is manifest hygiene, and it touches the manifest-fields
part of rule 14 ("compatibility metadata is truthful").

**Smallest correct fix:** `kind: standalone` — or delete the line, since `standalone` is the
default.

---

### F4 — `provides_middleware` is not a field the plugin manifest knows — **minor**

`plugin.yaml:6`

```yaml
provides_middleware: []
```

`_KNOWN_MANIFEST_FIELDS` (`hermes_cli/plugins_manifest.py:32-39`) contains `provides_tools` and
`provides_hooks` but **not** `provides_middleware`. Parsing at the pin emits (at DEBUG, because
`manifest_version: 1`):

```
DEBUG: Plugin chroma/pin: unknown manifest field(s) ignored: provides_middleware (newer manifest schema or typo; plugin still loads)
```

The value is not lost where it matters — the gate reads the raw manifest
(`plugin_validate.py:420`) — but the *loader* ignores it, so `plugin.yaml` currently claims a
declaration the loader does not enforce. It is also invisible at v1 (v2+ would log it as a
WARNING).

**Smallest correct fix:** either drop the line, or set `manifest_version: 2` so the declaration is
honoured/warned about loudly.

---

### F5 — the drafted gate output omits the one warning the gate prints — **minor**

`docs/CATALOG-SUBMISSION.md`, the "Admission rules" table (rows 6-9) quotes the gate's output as
`loadable — entry: desktop/plugin.js`, `built-in tool collisions — no tools to check`,
`security scan — safe`, `desktop surface — stays inside the plugin SDK surface`,
`no core override — no runtime rebinds of Hermes core`, `python dependencies — none declared`.
Every one of those strings is **exactly** what the gate prints (I have the real output in §6).

What the table does not mention is the gate's single warning:

```
⚠ no __init__.py — capability probe skipped (manifest-only plugin)
```

A reviewer running the gate will see a warning the submission notes do not predict, and — because
the probe is skipped — the *declared-vs-registered capability* check (rule 6) is **not** enforced
by the gate for a Desktop-only plugin at all. The claim is still true (I verified it by reading the
code: 5 `ctx.register` area contributions, 1 `ctx.rest`, zero tools/hooks/middleware, zero env
reads), but the submission notes should say so.

**Smallest correct fix:** add the warning line to the quoted evidence, and add one sentence to
rule 6's row: *"the gate's capability probe is skipped (no `__init__.py`); the empty declarations
were verified by inspection — `ctx.register` × 5 area contributions, `ctx.rest` × 1, no
`register_tool`/`register_hook`/`register_middleware` in either half."*

---

### F6 — the drafted `sha` is three commits stale, and the tip is what carries the capability declarations — **minor**

`docs/CATALOG-SUBMISSION.md` pins `sha: 43f8e1ba0ca277825b833cd94aa5a8c395bcd5d0`. That commit is
a real ancestor of the reviewed tip (`43f8e1b` → `f338063` → `06e1c5d` → `352c3c5`), and the
submission file's own instruction ("**Re-pin before you submit.** This value is the tip of `main`
when the file was last touched") is honest and correct.

Two things a reviewer should know: (a) the file's statement "This value is the tip of `main` when
the file was last touched" was true when written (commit `e251603`, "docs(submission): pin 2.9.0 and
its sha") and is now stale; (b) **the plugin.yaml at the drafted pin does not contain the six
declaration lines** — `manifest_version`, `kind`, `provides_tools`, `provides_hooks`,
`provides_middleware`, `requires_env` were added by `352c3c5` itself. The drafted pin therefore
validates a tree whose manifest makes *no* capability claims, and the reviewed tip is the tree
that does. (I ran the gate at `43f8e1b` too: also 13/13 PASS, so the drafted sha would not fail
CI — but it is not the tree this review covers.)

**Rule:** rule 2 is satisfied (a full 40-hex pin of a reachable commit); the *submission process*
is what is at risk.

**Smallest correct fix:** re-pin at PR time with `git rev-parse origin/main` and bump the entry
`version` in the same PR if the version moved — exactly as the file already instructs. Nothing
else changes.

---

### F7 — the scanner's own structural limits are tripped by the shipped tree — **minor**

`tools/plugin_guard.py:106-108` sets `MAX_PLUGIN_FILE_COUNT = 400` and
`MAX_PLUGIN_SINGLE_FILE_KB = 1024`. The pin trips both:

```
medium  too_many_files    (directory):0   match: '538 files'
medium  oversized_file    docs/chroma-banner.png:0   match: '1383KB'
```

The verdict stays `safe` (medium never blocks, and the catalogue's rule 7 only makes `dangerous`
fail), so this is not a blocker. But it is two visible lines in the CI log a reviewer reads, and
both are trivially removable: the **retired v1 table** `skins/` (150 files, "not read by the
build" per the repo's own `AGENTS.md`) is dead weight in a published tree, and the banner PNG is
1.4MB against a 1MB limit.

**Smallest correct fix:** drop `skins/` from the published tree (or move it out of the plugin root
if the migration record must be kept) and recompress `docs/chroma-banner.png` under 1MB. Both
together bring the file count to ~388 and clear both findings.

---

### F8 — the repo's working contract and a source comment assert a false fact about the scanner — **minor**

`AGENTS.md` §3, rule 5:

> **New picker code must not use template literals** — the plugin catalog's security scan reads
> `${...}` as inline shell. Use string concatenation and `+`.

`desktop/plugin.js:5210-5211` (and `desktop/plugin.template.js` at the same lines):

```js
      // Plain concatenation, not a template literal: the catalog security scan
      // reads `${...}` as inline shell execution and flags it.
```

**The fact:** the host's `inline_shell_exec` pattern is ``!`[^`\s][^`\n]*` ``
(`tools/skills_guard.py:390-394`) — it matches a backtick preceded by `!`, i.e. the `` !`cmd` ``
auto-exec DSL in SKILL.md bodies. It does **not** look for `${`. The shipped build has 20 lines
containing `${…}` and **0** occurrences of `` !` ``, and the scan reports `safe` with no
execution-category finding at all. The premise is false in both places.

**Rule:** none broken — and that is the point. Nothing flags today, and the constraint costs
nothing if kept. But a false security claim in the working contract, and the same false claim
inside a source file a reviewer will open, is the kind of thing that erodes trust in the rest of
the document.

**Smallest correct fix:** correct the rationale in both places — the pattern is the `` !` ``
auto-exec DSL, not `${…}` — and either keep the no-template-literals style rule as a *style*
preference or drop it. Note the irony: the rule is what produced the 20 template literals in the
first place, which are fine.

---

### F9 — the "refuse to shadow a built-in" guard covers 6 of the host's 12 built-in theme names — **minor**

`desktop/plugin.js:130`

```js
const CORE_DESKTOP_THEMES = new Set(['nous', 'midnight', 'ember', 'mono', 'cyberpunk', 'slate'])
```

The host's `BUILTIN_THEMES` (`apps/desktop/src/themes/presets.ts:444-458`) has twelve: `nous`,
`github`, `catppuccin`, `everforest`, `solarized`, `nous-alt`, `classic`, `midnight`, `ember`,
`mono`, `slate`, `cyberpunk`. The guard therefore misses `github`, `catppuccin`, `everforest`,
`solarized`, `nous-alt` and `classic` — so a TweakCN preset named "github" would pass Chroma's own
check at `desktop/plugin.js:884`.

**Impact today: none.** The host defends itself twice — `installUserTheme()` throws
`"<name>" collides with a built-in theme.` (`apps/desktop/src/themes/user-themes.ts:70`) and the
`THEMES_AREA` resolution skips a plugin theme whose name matches a built-in
(`user-themes.ts:141`). And every gateway skin Chroma mints is prefixed `theme-picker-`
(`dashboard/plugin_api.py:945`). So no built-in is actually shadowed.

**Rule:** adjacent to rule 15 ("vendor-lookalike skins are not listed under Nous branding"). Not a
violation today, because the host prevents it.

**Smallest correct fix:** make the guard complete — derive it from the six missing names:
`new Set(['nous','github','catppuccin','everforest','solarized','nous-alt','classic','midnight',
'ember','mono','slate','cyberpunk'])`.

---

### F10 — the roadmap's own `UNVERIFIED` about the gate is now discharged — **informational**

`docs/PLANS/CHROMA-ROADMAP.md:141`

> UNVERIFIED: the recorded `hermes plugins validate .` result was not re-run this session; …

This review re-ran the gate (R3) against the pin and got 13/13 PASS with one warning, so that
mark can be struck with the citation "gate re-run 2026-10-20 against `352c3c5` via
`hermes_cli.plugin_validate.validate_plugin_dir`". The other three `UNVERIFIED` marks
(`:139` catalogue not submitted; `:143` `requires_hermes` floor not re-verified; `:410`) are
honest and stay.

---

## 6. The admission gate's predicted output

**This is not a prediction.** The `hermes` CLI cannot start on this machine
(`cannot recover dependency publication … run 'hermes pm repair'`), so I ran the gate's own engine
directly: `hermes_cli/plugin_validate.validate_plugin_dir(Path(<pin>))` — the exact function
`hermes_cli.main plugins validate` calls (`hermes_cli/plugins_cmd_catalog.py:804`) — against the
exported pin, using the host checkout's own code. The printed form below is the CLI's
(`plugins_cmd_catalog.py:810-822`: `✓ <check> — <detail>`, `⚠ <warning>`, `◆ Isolation — <summary>`).

```
✓ manifest — plugin.yaml parses
✓ manifest fields — name, version, description present
✓ requires_hermes — spec '>=0.22.0' parses
✓ config schema — not declared
✓ requires_env — all entries UPPER_SNAKE
✓ loadable — entry: desktop/plugin.js
✓ python dependencies — none declared
✓ capability probe — skipped (no __init__.py)
✓ built-in tool collisions — no tools to check
✓ security scan — safe
✓ no core override — no runtime rebinds of Hermes core
✓ desktop surface — stays inside the plugin SDK surface
⚠ no __init__.py — capability probe skipped (manifest-only plugin)
◆ Isolation — portable plugin (no Python): runs anywhere

Validation passed.
```

**exit code 0.** 13 checks, 13 PASS, 0 FAIL, 1 warning, isolation verdict `portable`
(`host_ready: true`, no reasons, no notes).

Two notes on the shape of this list, because a reviewer will read them:

- **`capability probe — skipped` is the honest shape of rule 6 for a Desktop-only plugin.** The
  gate cannot compare declared-vs-registered capabilities for a plugin with no `__init__.py`
  (`plugin_validate.py:397-402`). The declarations are truthful — verified by reading the code
  (§3, rule 6) — but a reviewer must confirm them by eye, not from this output. That is the one
  thing the gate does not decide for Chroma.
- **The `security scan — safe` line hides 27 findings.** The verdict is `safe` because all 27 are
  medium/low; a reviewer is expected to read them. The list is in §3 and none of them blocks.

### The rest of the admission CI, run by hand

| CI step (`plugin-catalog-ci.yml`) | Result at the pin |
|---|---|
| structural — `scripts/validate_plugin_catalog.py plugin-catalog/` (the draft entry) | `OK: 1 file(s) valid`, exit 0 |
| pinned source — clone at the sha, `git cat-file -t` = commit | the drafted sha is a real commit object; reachable |
| `hermes plugins validate --install-deps $PLUGIN_DIR` | 13/13 PASS (§6). `--install-deps` is a no-op: nothing is declared |
| unscannable payload — `scripts/scan_plugin_payloads.py $PLUGIN_DIR` | exit 0, no output |
| self-updater gate — the exact grep at `:342-346` | empty: no file mentions a GitHub release/raw URL, and no file pairs one with a write API |
| `attested_binaries` / attestation | not applicable — the entry declares none |
| "an entry PR may only touch `plugin-catalog/**` and `contributors/emails/**`" (`:89-98`) | a Chroma PR touches exactly one new file, `plugin-catalog/chroma.yaml` |

**Is shipping without a green CLI run acceptable?** — **Yes, but the run must exist before the PR
opens, and it now does.** The reasoning: the admission gate is not a safety mechanism at admission
time, it is a *reproduction* of what the reviewer will run. The catalogue's own workflow is the
real gate (`.github/workflows/plugin-catalog-ci.yml` runs the same validator against the pinned
sha, on hermes-agent `main`, for every entry PR), so a PR that reaches CI is validated by the
gate regardless of what the author ran locally. Shipping the *package* (as opposed to opening the
PR) is not blocked by the missing local run. What the missing run cost is the submission notes'
claim to have a green gate — and that gap is now closed by this review, which produced the gate's
output from the gate's own code at the reviewed pin. The residual obligation is narrow and
already stated in the repo's own file: re-run `hermes plugins validate .` on the machine that
carries the CLI **at the final pinned sha**, and let the PR's CI job be the authority.

---

## 7. The embarrassing section — what a Nous reviewer flags first

In the order I expect them, with the answer already prepared:

1. **"Your plugin fetches whatever URL the user pastes, but your README says the only request is
   to tweakcn.com."** — That is F1, and it is the first thing a reviewer with a `grep fetch` habit
   will find. It is a text fix, and until it is made the disclosure line in the PR is false. Fix it
   *before* the PR, not in review.
2. **"You write `document.documentElement.dataset.hermesTheme` and toggle the `dark` class on
   `<html>` — and your comment says the SDK can't do that."** — F2. The SDK *can* (`useTheme` is
   exported at `apps/desktop/src/sdk/index.ts:2048` and exposes `setTheme`/`setMode`), the plugin
   itself calls it at `desktop/plugin.js:1934-1935`, and the host's own provider writes the same
   attribute at `apps/desktop/src/themes/context.tsx:328`. So the write is defensible — the
   *justification* is not. A reviewer who catches the contradiction will stop reading the code
   until it is answered. One comment + one disclosure line answers it.
3. **"Your two `MutationObserver`s watch the host's own attributes."** — the most likely
   *refusal* candidate, and the answer is clean: they observe `document.documentElement` (never
   `document.body`), `attributes: true` with a one-attribute `attributeFilter`, read-only,
   disconnected on cleanup, and they watch exactly the attributes the host itself declares as its
   theme-epoch contract (`apps/desktop/src/hooks/use-theme-epoch.ts:9,16-17` uses the identical
   idiom). I would put that sentence in the PR description proactively — it costs one line and
   removes the question.
4. **"You are a fork of another plugin. Why are you not upstream?"** — answer: the upstream is not
   in the catalogue, and the fork is materially different (a 2493-line FastAPI backend that mints
   real gateway skins, a TweakCN importer, a 94-skin v2 catalogue with 188 transports, packs,
   favourites, previews, colour families, an a11y pass) — 538 files and 6263 build lines against
   the upstream's 281 files and 921. The upstream's own layout is `plugin/plugin.js`, which the
   current host's installer does not accept (`findDesktopEntry` looks for a root `plugin.js` or
   `desktop/plugin.js`); Chroma uses the documented one. And the lineage is named in five places
   including both copyright lines in `LICENSE`. Rule 16's "one listing per lineage" is satisfied
   because there is only one listing and the original has none.
5. **"Your repo has 538 files and a 1.4MB PNG. What is in there?"** — F7: 188 gateway transports,
   94 catalogue skins, a 150-file retired v1 table that nothing reads, 37 tests, 34 docs, 15
   scripts. The retired table is the easy cut and it also clears the scanner's own `too_many_files`
   finding. Cut it before the PR; a reviewer will not do it for you.
6. **"Your manifest says `kind: plugin`."** — F3. One line.
7. **"Your README says 'one HTTPS GET to tweakcn.com' and your disclosure doc says the same."**
   — F1 again; fix once, in both files.
8. **"Your agent contract says template literals are flagged as inline shell."** — F8. Nothing
   breaks; it just reads as a rule the author invented and then had to work around in 20 places.
   Correct it.
9. **The thing nobody will say but will notice:** `docs/CATALOG-SUBMISSION.md` quotes the gate's
   output and it is *accurate* — every quoted string is exactly what the gate prints — but it
   quotes the six PASS lines and not the one WARNING. A reviewer will see a warning the submission
   notes did not predict, and the first thing they will wonder is what else the notes did not
   predict. F5.

---

## 8. Closing line

**Findings: 2 major, 7 minor, 1 informational. 0 blockers.**

- major: F1 (network disclosure incomplete — `tweakcnUrl` fetches any pasted `http(s)://` URL
  verbatim) · F2 (the in-code premise that the SDK cannot set the theme is false, so the
  direct write of the host's root theme markup has no accurate justification).
- minor: F3 (`kind: plugin` is not a valid kind) · F4 (`provides_middleware` is not a manifest
  field) · F5 (the drafted gate output omits the gate's only warning) · F6 (the drafted sha is
  three commits stale and predates the capability declarations) · F7 (538 files > 400; 1383KB PNG
  > 1MB) · F8 (the AGENTS.md rule and a source comment assert a false fact about the scanner) ·
  F9 (the built-in-shadow guard covers 6 of 12 host theme names; the host prevents the impact
  anyway) · F10 (a roadmap `UNVERIFIED` this review discharges).
- informational: F10.

**Rule tally at `352c3c5ad86db06cc600c3555675e2baf0928e12`: 16 PASS, 1 FAIL (rule 13, incomplete
disclosure → F1), 0 UNVERIFIED. Admission gate: 13/13 PASS, 1 warning, exit 0. Structural entry
gate: valid. Payload gate: exit 0. Self-updater gate: clean. CI: 4/4 green. Build: byte-identical
when regenerated from the template.**
