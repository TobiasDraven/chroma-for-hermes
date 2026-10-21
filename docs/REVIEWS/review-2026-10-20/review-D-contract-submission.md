VERDICT: HOLD

PIN: 352c3c5ad86db06cc600c3555675e2baf0928e12 (branch `main`, tree clean)

---

## 2. Files I read at the pin

All of these were read with `git show 352c3c5:…` — never from the working tree.

`README.md`, `plugin.yaml`, `VERSION`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `CHANGELOG.md`,
`desktop/plugin.template.js` (6263 lines), `desktop/plugin.js` (the committed build),
`dashboard/plugin_api.py` (2493 lines), `dashboard/manifest.json`,
`scripts/regenerate.py`, `scripts/check-package.py`, `scripts/check-packs.py`,
`scripts/check-host-classes.py`, `scripts/packs.json`, `scripts/analyse-palettes.py`,
`scripts/classify-skins.py`, `scripts/font-register.py`, `scripts/generate-gallery.py`,
`install/install-gateway-skins.sh`, `install/install-windows.ps1`,
`.github/workflows/ci.yml`, `rigour.yml`,
`docs/SPEC.md`, `docs/ARCH.md`, `docs/CATALOG-SUBMISSION.md`, `docs/DISCLOSURE.md`,
`docs/FONTS.md`, `docs/THEME-PACK-CREATION.md`, `docs/TASKS.md`, `docs/DECISIONS.md`,
`docs/PLANS/CHROMA-ROADMAP.md`, `docs/PLANS/V2-REDESIGN.md`, `docs/PLANS/CHROMA-PACKS.md`,
`docs/PLANS/ARIA-PASS-PLAN.md`, `docs/REVIEWS/ARIA-PLAN-REVIEW-2026-10-19.md`,
`docs/REVIEWS/DISTRIBUTION-READINESS-2026-10-19.md`, `docs/RESEARCH/CATEGORY-NAMES.{md,json}`,
`docs/RESEARCH/COLOUR-TAXONOMY.md`, `docs/PALETTE-ANALYSIS.{md,json}`,
`skins-v2/*.yaml` (all 94, parsed), `gateway-skins/` (188), `skins/` (150).

Host-side files read **read-only** from the local `hermes-agent` checkout
(`C:/Users/<user>/AppData/Local/hermes/hermes-agent`, release 0.22.2, commit `d923a5e`):
`plugin-catalog/README.md` (the 17 admission rules + entry schema), `hermes_cli/plugin_validate.py`,
`hermes_cli/plugin_validate_desktop.py`, `hermes_cli/plugin_validate_private_imports.py`,
`hermes_cli/web_server_dashboard.py`, `apps/desktop/electron/desktop-plugin-install.ts`,
`apps/desktop/electron/desktop-plugins-root.ts`, `hermes_constants.py`, `pyproject.toml`,
`tools/plugin_guard.py` (through the scanner API).

---

## 3. What I actually ran vs what I only read

### 3a. What I RAN (read-only; a fresh clone in `%TEMP%\opencode\chroma-fresh`, never the repo)

| # | Command | Where | Exit | Result |
|---|---|---|---|---|
| 1 | `node --test tests/*.test.mjs` | fresh clone | **0** | `tests 266 / pass 266 / fail 0 / skipped 0` |
| 2 | `python -m pytest tests/ -q` | fresh clone | **0** | `185 passed, 4 skipped, 9 subtests passed in 143.49s` |
| 3 | `python scripts/check-package.py` | fresh clone | **0** | `OK: package contract holds at 2.9.0 (94 skins, 538 tracked files)` |
| 4 | `python scripts/check-packs.py` | fresh clone | **0** | `OK: contract holds` — packs `{core 30, cyberpunk 11, earth 11, noir 10, retro 11, studio 10, zen 11}`, 12 categories |
| 5 | `python scripts/regenerate.py` | fresh clone | **0** | `Rebuilt … with 94 scenes … 40 derived palettes and 188 gateway transports` |
| 6 | `git diff --exit-code -- desktop/plugin.js gateway-skins docs/DERIVED-PALETTES.md` | fresh clone after #5 | **0** | byte-identical build — **the CI "build is current" job genuinely holds on a fresh clone** |
| 7 | `python scripts/check-host-classes.py` | fresh clone | **0** | `host sheets: 6 (399988 chars) · classes used: 134 · with no rule: 0` (needs the local Desktop app's CSS) |
| 8 | `rigour check --ci` | fresh clone | **1** | run 1: `FAIL: 20 violation(s) Score: 37/100`; run 2 (baseline now exists): `FAIL: 25 violation(s) Score: 29/100` — 2 CRITICAL `hallucinated-imports`, 8 HIGH `promise-safety`, 1 HIGH `phantom-apis`, 1 HIGH `inconsistent-error-handling`, 2 HIGH `context-window-artifacts`, 4 MEDIUM complexity/file-size, 5 LOW style-drift |
| 9 | `python scripts/font-register.py` | fresh clone | **0** | `git status` clean — `docs/FONTS.md` is current |
| 10 | `python scripts/generate-gallery.py` | fresh clone | **0** | `git status` clean — `docs/gallery.html` is current |
| 11 | `python scripts/analyse-palettes.py` | fresh clone | **0** | **2 files changed**: `docs/PALETTE-ANALYSIS.json` (12,872 lines; 12,760 ignoring whitespace) and `docs/PALETTE-ANALYSIS.md` (32 lines) — the committed artefacts are stale |
| 12 | `validate_plugin_dir(<fresh clone>)` — the **real** `hermes plugins validate` gate, run from the hermes-agent 0.22.2 checkout (`venv/Scripts/python.exe -B`) | fresh clone | **report.exit_code 0** | see §3c — 12 checks OK, 1 warning, isolation `portable`/`host_ready: True` |
| 13 | `desktop_surface_hits(<fresh clone>)` | fresh clone | — | `HITS: NONE` over `desktop/plugin.js` + `desktop/plugin.template.js` |
| 14 | `tools.plugin_guard.scan_plugin(<fresh clone>)` | fresh clone | — | `verdict: safe`, 28 findings, all medium/low (details §6) |
| 15 | `git ls-tree`/`git show`/`git log -p --all` sweeps for secrets, emails, absolute paths, usernames | repo, read-only | — | see §5 |
| 16 | `python` parse of all 94 `skins-v2/*.yaml` via `git show` | repo, read-only | — | pack/category/design_spec/mode tallies (§4) |

**Not run, deliberately:** `hermes` CLI of any kind (guardrail); `scripts/classify-skins.py`,
`scripts/make-pastel-skins.py`, `scripts/migrate-to-skins.py` (they **write into `skins-v2/`** —
running them would have mutated the tree).

### 3b. What I only READ

Everything else. In particular I did **not** run the plugin inside a Desktop, did not install it,
did not mount the backend, and did not exercise a paste-URL install. Every claim about host
behaviour below is marked `UNVERIFIED` where I could not check it.

### 3c. The admission gate's REAL output (I ran it)

`hermes plugins validate .` cannot run here (the local CLI is broken: *cannot recover dependency
publication … run `hermes pm repair`*), but the validator is a library, so I ran the exact code
path the CLI runs, against a fresh clone of the pin, with the host's own 0.22.2 checkout:

```
OK manifest -- plugin.yaml parses
OK manifest fields -- name, version, description present
OK requires_hermes -- spec '>=0.22.0' parses
OK config schema -- not declared
OK requires_env -- all entries UPPER_SNAKE
OK loadable -- entry: desktop/plugin.js
OK python dependencies -- none declared
OK capability probe -- skipped (no __init__.py)
OK built-in tool collisions -- no tools to check
OK security scan -- safe
OK no core override -- no runtime rebinds of Hermes core
OK desktop surface -- stays inside the plugin SDK surface
⚠ no __init__.py — capability probe skipped (manifest-only plugin)
Isolation — portable (host_ready: True)
Validation passed.   (exit 0)
```

**Two things the recorded evidence in `docs/CATALOG-SUBMISSION.md:70-84` does not say:**

1. The **capability probe is SKIPPED** (`no __init__.py`). Rule 6 — *"Declared capabilities must
   match reality"* — is therefore **not actually verified** by the gate: nothing ever imported the
   plugin. The empty `capabilities:` block in the entry is *true* (I verified the build registers no
   tools/hooks/middleware by reading it), but the gate did not and could not check it.
2. The **Python half is never imported** by the gate either (`dashboard/plugin_api.py` is not an
   entrypoint the probe or the scanner loads). Its imports are therefore unverified by the gate.

The recorded evidence lines are each **true** (I reproduced them), but the table presents a
complete-looking list of a run that in fact *skipped* its most important check.

---

## 4. README claim table

Judged as a stranger reads it. `file:line` is the deciding evidence.

| # | README claim (line) | Verdict | Deciding evidence |
|---|---|---|---|
| 1 | "A hard fork of Hermes Theme Picker … originally by Joshua Timothy" (5) | **TRUE** | `plugin.yaml:14-16`, `LICENSE:3-4`, `THIRD_PARTY_NOTICES.md:5-7` |
| 2 | "not endorsed by, and is not affiliated with, the original author or Nous Research" (14-15) | **TRUE** | no endorsement anywhere in the tree; `plugin.yaml` names no Nous affiliation |
| 3 | "Dynamic Themes — switch one theme between coordinated light and dark palettes" (26-27) | **TRUE** | all 94 skins carry both palettes (parsed); `desktop/plugin.template.js:6149` `supportsBoth` |
| 4 | "the current Desktop repaints immediately, then every connected Desktop and CLI receives the same palette" (28-29) | **TRUE** | `tpl.js:2755-2757` `applyDesktopTheme` + `tpl.js:2676` `host.request('config.set', …)` |
| 5 | "Pushing to the gateway needs the Python backend … without it the repaint stays on this Desktop" (29-31) | **TRUE** | `tpl.js:2669-2671` scope check + `tpl.js:2713-2729` warning notice |
| 6 | "browse real color swatches, search 94 skins by name" (32-33) | **TRUE** | 94 skins; `tpl.js:5212` searches name+label+description (so "by name" is narrower than reality — search is a superset) |
| 7 | "Favourites — star a skin from its card and it joins a scrollable rail on the left" (34-36) | **TRUE** | `tpl.js:3126-3142` star; `tpl.js:4428-4441` `<aside aria-label="Favourites">` with `overflow-y-auto` child; rendered before the ScrollArea (`tpl.js:5993-6002`) |
| 8 | "Unstar it from the card or from the rail" (36) | **TRUE** | `tpl.js:3130` (card) and `tpl.js:4417-4424` (rail) |
| 9 | "one skin carries its light and its dark palette and a font choice of its own" (37-38) | **TRUE** | 94/94 have `light_colors` + `dark_colors`; 7 distinct mono stacks across the catalogue |
| 10 | "The swatch preview shows both at once as a 2 x 6 matrix" (38-39) | **TRUE** | `tpl.js:2931-2953` `paletteStrip` returns 6 bands; two strips rendered per card |
| 11 | "There are no single-mode skins." (39, 63-64) | **TRUE** | parsed: 94/94 have both palettes |
| 12 | "The picker opens on thirty core skins." (40) | **TRUE** | `tpl.js:2449-2457` default `[]` → `tpl.js:2418-2423` allows only `core`; parsed `core = 30` |
| 13 | "Turn on Earth, Cyberpunk, Zen, Retro, Noir or Studio" (41) | **TRUE** | parsed packs: exactly those six non-core packs |
| 14 | "the choice is remembered on this machine" (42) | **TRUE** | `tpl.js:2442` `chroma-packs-v1` |
| 15 | "**Two ways to browse** — group by skin, or … group by color family" (43-46) | **FALSE** | there are **three** lenses: `tpl.js:100` `GROUP_MODES = ['scene','theme','pack']`; `tpl.js:5873-5875` renders *By skin* / *By colour family* / *By theme pack* |
| 16 | "The family is measured from the accent in OKLCH" (45-46) | **TRUE** | `tpl.js:2940` `oklch(background)`; `scripts/taxonomy.json`; `check-packs.py` |
| 17 | "Persimmon, Apricot, Amber, Gold, Lemon, Fern, Teal, Cobalt, Indigo, Violet, Rose and Neutral" (44-45) | **TRUE** | parsed category set == exactly those 12 |
| 18 | "Works offline — the catalog is embedded in the plugin" (49-50) | **TRUE** | catalogue embedded in `desktop/plugin.js`; `tpl.js:875` is the only `fetch` |
| 19 | "themes are also available in Settings → Appearance when the gateway is unavailable" (49-50) | **TRUE** | `tpl.js:6225-6231` registers 94 `THEMES_AREA` themes |
| 20 | "each profile remembers its theme and mode across restarts" (51) | **TRUE** | `tpl.js:2071-2072` `PROFILE_SKINS_KEY` / `PROFILE_MODES_KEY` |
| 21 | "paste a TweakCN preset, a Windows Terminal scheme, a Base16/Base24 palette, or a VS Code color theme" (52-53) | **TRUE** (incomplete) | `tpl.js:820-842`; the code also accepts **shadcn CSS**, which the FAQ (298) lists and this bullet omits — see m3 |
| 22 | "With the Python backend installed it also becomes a real gateway skin … without it the theme stays local, and the picker says so" (54-56) | **TRUE** | `tpl.js:970-979` `importOutcomeNotice`; visible notice at `tpl.js:5969-5972` |
| 23 | "Rename, export as hand-editable YAML, or delete from the card (backend required)" (56-57) | **TRUE** | `tpl.js:3272-3300` Export/Rename/Delete, all gated on `_rest` |
| 24 | "hover any card and click 'Preview 10s' … A countdown shows the remaining time … Click again to stop early" (58-60) | **TRUE** (desktop only) | `tpl.js:3067-3083` label `Preview 10s`, `tpl.js:3076` title "for 10 seconds"; the pill is `opacity-0 group-hover:opacity-100` — see **m8** for the touch case |
| 25 | "The plugin ships **94 skins**" (62) | **TRUE** | 94 files in `skins-v2/`; `check-packs.py` says 94 |
| 26 | "A skin belongs to exactly one pack and exactly one color family" (64) | **TRUE** | single `pack:`/`category:` scalar per file; `check-packs.py` enforces both |
| 27 | "**Python 3.9+** and `PyYAML` only if you want to regenerate the catalog (the generator calls `str.removeprefix`)" (74-75) | **TRUE** | `scripts/regenerate.py:20` `from __future__ import annotations` makes the `str | None` annotations safe on 3.9; `:627` `removeprefix` (3.9+) |
| 28 | "They are not required to use the picker." (75) | **TRUE** | the Desktop half has no Python dependency; `tpl.js:875` is the only network call |
| 29 | "Both live in one directory, `<hermes home>/plugins/chroma/`, and Desktop copies the UI half out to `desktop-plugins/chroma/` by itself" (77-80) | **TRUE** | `apps/desktop/electron/desktop-plugin-install.ts:181-195` `findDesktopEntry` → `desktop/plugin.js` wins; `desktop-plugins-root.ts:21` `DESKTOP_PLUGINS_DIR = 'desktop-plugins'` |
| 30 | "Open Hermes Desktop, go to **Capabilities → Plugins → Install**, and give it this URL: `https://github.com/TobiasDraven/chroma-for-hermes`" (82-87) | **UNVERIFIED** | no code in this repo implements the dialog; `plugin.yaml`/`homepage` point at the repo, and `install/install-windows.ps1` documents the same package layout, but the paste-URL walk is host behaviour I could not run |
| 31 | "That is the whole install. The dialog installs the package with the plugin enabled and switches on its Desktop half in the same step … **Chroma appears as an enabled row on the Plugins page and its pane joins the sidebar when the install finishes**" (89-93) | **UNVERIFIED** | same reason; the *shape* is right (`plugin.yaml` at the package root, `desktop/plugin.js` discovered by `findDesktopEntry`), but "enabled in the same step" and "Force reinstall" are Desktop UI claims with no evidence in this repo |
| 32 | "From a terminal, the same install is: `hermes plugins install TobiasDraven/chroma-for-hermes`" (95-100) | **UNVERIFIED** | the CLI is broken locally (guardrail: I did not run it); the catalogue README:5-6 confirms `hermes plugins install <name>` is the mechanism for catalog entries, but `TobiasDraven/chroma-for-hermes` is a **repo**, not a catalog name — a repo install path is host behaviour I could not check |
| 33 | "a non-interactive install cannot answer the 'enable now?' prompt, so it installs the plugin disabled" (102-104) | **UNVERIFIED** | no code in this repo; plausible but unverified here |
| 34 | "A backend that is enabled but not yet mounted needs a full Hermes **restart** (the Python half mounts at startup)" (106-107) | **TRUE** | `hermes_cli/web_server_dashboard.py:869-896` mounts at import time; `install/install-windows.ps1` says the same |
| 35 | "Until then the picker's themes still apply and preview, but an import cannot mint a gateway skin and rename, export and delete are unavailable" (107-109) | **TRUE** | `tpl.js:5969-5972` notice; all four actions throw `BACKEND_MISSING_MESSAGE` (`tpl.js:933,984,992,1000`) |
| 36 | "#### Windows### Linux or manual installation (Desktop half only)" (116) | **FALSE** | a broken heading — see **m1** |
| 37 | Destination table: `%LOCALAPPDATA%\hermes\desktop-plugins\chroma\plugin.js` / `~/.hermes/desktop-plugins/chroma/plugin.js` (121-124) | **UNVERIFIED** (consistent) | the repo's own installer agrees (`install/install-windows.ps1:31-34` uses `%LOCALAPPDATA%\hermes` on Windows, `%USERPROFILE%\.hermes` otherwise); the host's own resolution of HERMES_HOME was not run |
| 38 | "The installer honors `$HERMES_HOME` and otherwise uses `~/.hermes/skins/`. It does not require a gateway restart and will not overwrite modified skins unless you deliberately rerun it with `--force`; destination symlinks are always refused." (147-150) | **TRUE** | `install/install-gateway-skins.sh:6-7,19-34,36-58` |
| 39 | "The statusbar chip shows the active theme with a color dot." (161-162) | **TRUE** | `tpl.js:6175-6180` |
| 40 | "When the active theme supports both light and dark modes, a **lightbulb icon** (💡) appears next to it. Click the lightbulb to toggle between light and dark mode…" (162-165) | **FALSE** | the build renders the **word** `Dark`/`Light`: `tpl.js:6183-6191`, whose own comment says "The glyph it used to carry was a codicon that painted as an empty box". `grep "💡" desktop/plugin.js` → **no match**. `CHANGELOG.md:172-177` and `:203-206` record the replacement. See **B1** |
| 41 | "The choice persists per profile." (165) | **TRUE** | `tpl.js:2071-2072` |
| 42 | "A selection is applied in two coordinated steps: … repaints the current Desktop in place and saves the selected theme and mode for the active profile." (169-174) | **TRUE** | `tpl.js:2745-2752` |
| 43 | "It sends the matching light or dark skin to the active gateway, which broadcasts the palette to every connected Desktop and CLI." (173-174) | **TRUE** | `tpl.js:2673-2677`, `tpl.js:2640-2644` picks the mode-locked transport name |
| 44 | "A warning tells you when only the local Desktop was updated." (176-177) | **TRUE** | `tpl.js:2718-2726` `kind: 'warning'` |
| 45 | "`hermes config set display.skin <theme-name>`" (181-183) | **UNVERIFIED** | consistent with `tpl.js:2098-2100` ("config.set writes the one global display.skin"), but I could not run the CLI |
| 46 | "`docs/THEME-PACK-CREATION.md` — it maps all 43 colour surfaces, states which ten a new skin must decide (`design_spec: v2`), gives the derivation rules for the other 33" (187-189) | **TRUE** | `docs/THEME-PACK-CREATION.md:115` ("all 43 names"), `:199-201` (the ten), `:216` ("Derivation — the other 33"); parsed: 43 distinct colour keys in the catalogue |
| 47 | "Every skin shipped before 2.7.0 is marked `design_spec: v1` and stays valid as-is." (190-191) | **TRUE** (imprecise) | parsed: **all 94** skins are `design_spec: v1`; the doc says the same (`THEME-PACK-CREATION.md:89`). The sentence reads as if post-2.7.0 skins exist and are v2 — none do |
| 48 | "place it in the gateway's `~/.hermes/skins/` directory and apply it once. Live discovery adds it to the current picker session." (196-198) | **TRUE** | `tpl.js:2595-2606` `host.onEvent('skin.changed')` → `setLive` |
| 49 | "The retired `skins/` pair table is not read by the build." (201-202) | **TRUE** | `scripts/regenerate.py:766-775` reads `skins-v2/` only |
| 50 | "The generator reads **schema v2** skins only … It refuses anything else by name and leaves the existing `plugin.js` untouched" (217-220) | **TRUE** | `scripts/regenerate.py:769-778` |
| 51 | "The generator refuses to replace `plugin.js` when no valid skins are found." (231) | **TRUE** | `scripts/regenerate.py:776-779` |
| 52 | "For UI changes, edit `desktop/plugin.template.js`, run the generator, then copy the rebuilt `desktop/plugin.js` into Hermes Desktop" (233-234) | **TRUE** | `scripts/regenerate.py:795-800` |
| 53 | "**Network:** one HTTPS `GET` to `https://tweakcn.com/r/themes/<name>` when you import a TweakCN preset. Nothing else leaves the machine" (240-243) | **FALSE** | `tpl.js:845-860`: `if (!/^https?:\/\/(www\.)?tweakcn\.com\//i.test(bare)) return ref` — **any** http(s) URL is returned verbatim and fetched at `tpl.js:875`. See **M2** |
| 54 | "no telemetry, no analytics, no update check, no remote code" (241-242) | **TRUE** | no telemetry/analytics/update-fetch constructs in either half; `tpl.js:875` is the only `fetch`; `plugin_api.py` imports no network client |
| 55 | "**Writes:** the theme choice through `config.set('skin', …)`, and its own keys in the Desktop's local storage (`chroma-packs-v1` …, `chroma-overrides-v1` and its mirror …, plus the user-theme key)." (244-247) | **FALSE** | the build writes **14** keys; the README names 3. Undisclosed: `chroma-apply-scope-v1` (:2120), `chroma-card-shape-v1` (:2138), `chroma-card-size-v1` (:2206), `chroma-group-mode-v1` (:2224), `chroma-favorites-v1` (:2178), `hermes-desktop-theme-v2` (:2067), `hermes-desktop-mode-v1` (:2068), `hermes-desktop-profile-themes-v1` (:2071), `hermes-desktop-profile-modes-v1` (:2072), `hermes-boot-background` (:1917), `hermes-boot-color-scheme` (:1918). See **M1** |
| 56 | "**Reads:** the Hermes skin directory and its own keys." (249) | **FALSE** | the Desktop half reads no skin directory at all (the backend does); it reads app-owned `hermes-desktop-*` keys (:916, :2082-2086) that the bullet does not list |
| 57 | "No credential store, no browser profile, no shell. The plugin has no `requires_env` and no tools." (249-250) | **TRUE** | `plugin.yaml:8-9` `requires_env: []`, `provides_tools: []`; no `eval`/`exec`/`subprocess`/`urllib` in either half |
| 58 | "delete the `chroma` directory from the local `desktop-plugins` folder, and remove `chroma` from `plugins.enabled` (or delete `plugins/chroma`)" (268-271) | **UNVERIFIED** | host-side uninstall semantics; the repo's `install/desktop-plugin-remove.ts` exists but I did not run the app |
| 59 | "the 188 `theme-picker-*.yaml` transports in `~/.hermes/skins/`" (274) | **TRUE** | 188 files in `gateway-skins/`; `install/install-gateway-skins.sh` writes exactly that set |
| 60 | "**Q: The lightbulb icon does not appear in the statusbar.** A: … the lightbulb appears for all of them." (292-294) | **FALSE** | there is no lightbulb in the build at all — see **B1** |
| 61 | "Supported formats: TweakCN preset name or URL, shadcn CSS, Windows Terminal scheme, Base16/Base24 scheme, or VS Code color theme JSON." (297-299) | **TRUE** | `tpl.js:827-842` |
| 62 | "Hover the card and click the manage buttons (Export, Rename, Delete). Delete moves the skin to the Chroma trash — it is recoverable." (303-305) | **TRUE** | `tpl.js:3250-3300`; trash in `plugin_api.py` (`_trash` sidecar, `docs/DISCLOSURE.md:82-84`) |
| 63 | "'This profile' applies … only to the current Hermes profile. 'Everywhere' broadcasts … to every connected Desktop and CLI" (307-310) | **TRUE** (default undisclosed) | `tpl.js:2665-2671`; but the **default is Everywhere** (`tpl.js:2109-2113` returns `everywhere` unless explicitly set to `profile`) — the README never says so. See **m12** |
| 64 | "Can I use Chroma without a gateway? A: Yes. The local catalog works offline." (312-314) | **TRUE** | `tpl.js:875` is the only network call; all 94 skins are embedded |
| 65 | "How do I create my own skin? … Place a YAML file in `~/.hermes/skins/` and apply it once." (316-318) | **TRUE** | live discovery, claim 48 |
| 66 | Credits: MIT, BChop pack, CliffWade pack (320-331) | **TRUE** | `THIRD_PARTY_NOTICES.md:15-16`, `LICENSE` |
| 67 | "MIT — see LICENSE" (333-334) | **TRUE** | `LICENSE`; `plugin.yaml:13` `license: MIT` |

**Summary:** 67 claims checked — **54 TRUE**, **7 FALSE** (rows 15, 36, 40, 53, 55, 56, 60 — six
distinct defects; rows 40 and 60 are the same lightbulb defect stated twice), **6 UNVERIFIED**
(rows 30, 31, 32, 33, 37, 58 — all of them host-behaviour claims I could not execute without a
Desktop or the `hermes` CLI, which the guardrail forbids). No credential claim and no licence
claim is false.

---

## 5. Findings

### B1 — The README documents a status-bar lightbulb that the shipped plugin does not have
* **severity:** `blocker`
* **file:line:** `README.md:160-165` and `README.md:292-295`
* **quoted:**
  > `## The statusbar lightbulb` … "When the active theme supports both light and dark modes, a **lightbulb icon** (💡) appears next to it. Click the lightbulb to toggle between light and dark mode without opening the picker."
  > `**Q: The lightbulb icon does not appear in the statusbar.** A: Every bundled skin supports both modes, so the lightbulb appears for all of them.`
* **evidence:** `desktop/plugin.template.js:6183-6191` renders the target mode as a **word**:
  `children: mode === 'light' ? 'Dark' : 'Light'`, with the comment at `:6188-6189` — *"The target
  mode, as a word. The glyph it used to carry was a codicon that painted as an empty box wherever
  that font is not loaded."* `grep -n "💡" desktop/plugin.js` → **no match**. The project's own
  `CHANGELOG.md:172-177` ("the status bar reads the mode it will switch to … No icon font is
  required anywhere") and `CHANGELOG.md:203-206` record the replacement in 2.6.0.
* **failure mode:** the README at the pinned SHA *is* the plugin's public page (`/docs/plugins/chroma`,
  per `plugin-catalog/README.md:189-196`). A stranger installs, looks for a 💡 next to the theme
  name in the status bar, finds a text button reading "Dark", and the FAQ then tells them with
  confidence that "the lightbulb appears for all of them". It is a whole named section of the
  public page describing a control that does not exist, contradicted by the repo's own changelog.
* **smallest correct fix:** rewrite `README.md:160-165` to describe the button that is there
  ("a **Dark**/**Light** button appears next to the theme name; click it to switch mode"), and
  delete `README.md:292-295` (or re-point it at the button). Two sentences, no code change.

### M1 — "What it touches" under-reports the storage the plugin writes
* **severity:** `major`
* **file:line:** `README.md:244-250`
* **quoted:**
  > "**Writes:** the theme choice through `config.set('skin', …)`, and its own keys in the Desktop's local storage (`chroma-packs-v1` for the pack chips, `chroma-overrides-v1` and its mirror for palette edits, plus the user-theme key)."
  > "**Reads:** the Hermes skin directory and its own keys."
* **evidence:** the build writes **14** localStorage keys; the README names **3**. Full list with
  `file:line`: `hermes-desktop-user-themes-v1` (`tpl.js:927`, `:2047`), `hermes-boot-background`
  (`:1917`), `hermes-boot-color-scheme` (`:1918`), `chroma-overrides-v1` (`:2021`),
  `hermes-desktop-theme-v2` (`:2067`, `:2287`), `hermes-desktop-mode-v1` (`:2068`, `:2288`),
  `hermes-desktop-profile-themes-v1` (`:2071`, `:2302`), `hermes-desktop-profile-modes-v1`
  (`:2072`, `:2303`), `chroma-apply-scope-v1` (`:2120`), `chroma-card-shape-v1` (`:2138`),
  `chroma-favorites-v1` (`:2178`), `chroma-card-size-v1` (`:2206`), `chroma-group-mode-v1`
  (`:2224`), `chroma-packs-v1` (`:2462`). The **Reads** bullet is also wrong in both directions:
  the Desktop half reads no skin directory (only the backend does), and it reads app-owned
  `hermes-desktop-*` keys it does not list. The repo's own `docs/DISCLOSURE.md:78-95` lists the
  inventory correctly — the README is a less accurate copy of the disclosure. The same
  under-report is in the PR-description draft at `docs/CATALOG-SUBMISSION.md:104-109`.
* **failure mode:** catalogue rule 13 ("Risky behaviour is disclosed … goes in the PR description
  and the plugin's README") is answered with an inventory that is wrong by eleven keys, including
  five app-owned `hermes-desktop-*` keys and the two `hermes-boot-*` keys the boot cache depends on.
  A reviewer who diffs the README against the code finds the disclosure incomplete — the exact
  finding that reads as "the author did not look".
* **smallest correct fix:** replace `README.md:244-250` with the `docs/DISCLOSURE.md:78-95`
  inventory (it is already written, already cited, and correct), and mirror it into
  `docs/CATALOG-SUBMISSION.md:104-109`.

### M2 — The network disclosure is false: the plugin will GET any http(s) URL the user pastes
* **severity:** `major`
* **file:line:** `README.md:240-243` (and the same claim at `docs/CATALOG-SUBMISSION.md:104-107`
  and `docs/DISCLOSURE.md:110-116`)
* **quoted:**
  > "**Network:** one HTTPS `GET` to `https://tweakcn.com/r/themes/<name>` when you import a TweakCN preset. Nothing else leaves the machine: no telemetry, no analytics, no update check, no remote code."
* **evidence:** `desktop/plugin.template.js:845-860`:
  ```js
  if (/\/r\/themes\/[^/]+$/i.test(bare)) return ref
  if (!/^https?:\/\/(www\.)?tweakcn\.com\//i.test(bare)) return ref   // <-- any other host, verbatim
  ```
  and `tpl.js:875` `const r = await fetch(url)`. The URL-import branch of the picker calls this
  unconditionally: `tpl.js:5161-5162` `importMode === 'url' ? await fetchTweakcnTheme(ref)`.
  The behaviour is **pinned by a test**: `tests/tweakcn-import.test.mjs:192` — *"resolves a preset
  name to the registry URL and passes a URL through"*. So pasting `http://<private-ip>/…` or
  `http://example.org/x.json` makes the Desktop renderer issue that GET. The scheme is not
  restricted to HTTPS either — `/^https?:\/\//i` accepts `http://`.
* **failure mode:** the public README and the PR both tell the reviewer the network behaviour is
  one host over HTTPS, and it is not: the plugin will fetch any URL the user pastes, in plain
  HTTP, from the user's machine, including a private-network address. That is exactly the class of
  behaviour rule 13 exists to surface, and a reviewer who notices the discrepancy will re-open the
  whole disclosure.
* **smallest correct fix:** in `tweakcnUrl` (`tpl.js:845-860`), reject anything whose host is not
  `tweakcn.com` and require `https://` — return `null`/throw "only tweakcn.com preset URLs are
  supported" — and then the README sentence becomes literally true. One guard, ~3 lines.

### M3 — The Python half imports `fastapi` and `pydantic` but the package declares no dependencies
* **severity:** `major`
* **file:line:** `dashboard/plugin_api.py:240-241`; `plugin.yaml` (no `python_dependencies`); no
  `pyproject.toml` in the tree
* **quoted:**
  > `from fastapi import APIRouter, HTTPException`
  > `from pydantic import BaseModel`
* **evidence:** I ran the real gate against the pin: `OK python dependencies -- none declared`.
  The declaration surface is `python_dependencies` / `pip_dependencies` in the manifest, or a
  `pyproject.toml` (`pm/plugin_declarations.py:149-154`) — Chroma has neither. The backend's
  import failure mode is a **log line, not a user-visible error**: the dashboard mounts the plugin
  API inside `try/except Exception` and only logs
  `_log.warning("Failed to load plugin %s API routes: %s", …)`
  (`hermes_cli/web_server_dashboard.py:1052-1056`). `fastapi` and `pydantic` happen to be present
  in this Hermes checkout (`pyproject.toml:489` pins `fastapi==0.133.1`; the venv has both), so the
  backend mounts — but that is Hermes's core dependency set, not a dependency of Chroma, and rule
  10 puts "the dependency list at the pinned SHA" squarely in the plugin's policy.
* **failure mode:** on a Hermes install whose core dependency set does not include fastapi, the
  Python half never mounts. The user is told in the pane ("Gateway-skin backend not installed…"),
  so it is not silent to them — but the plugin then advertises mint/rename/export/delete that do
  not exist, and the only trace on the gateway is a WARNING line in a log nobody reads. A reviewer
  reading "python dependencies — none declared" and then reading `plugin_api.py:240` sees an
  undeclared dependency on a third-party framework.
* **smallest correct fix:** add the requirement to the README's Requirements section ("the Python
  half needs `fastapi` and `pydantic`, which Hermes ships") — one sentence, no packaging change —
  and, if the plugin wants the installer to guarantee it, declare `python_dependencies` in
  `plugin.yaml`. **Caveat for whoever takes the second option:** rule 10 asks for floors with upper
  bounds, and Hermes's core pin `fastapi==0.133.1` must not move — a declared spec that conflicts
  with the core pin could fail the plugin's own install. The documentation fix is the safe one.

### m1 — `README.md:116` is a mangled heading that renders as one broken line
* **severity:** `minor`
* **file:line:** `README.md:116`
* **quoted:** `#### Windows### Linux or manual installation (Desktop half only)`
* **evidence:** introduced by commit `711858b`, whose diff shows the `### Windows` and `### macOS`
  manual-install sections deleted and the surviving `### Linux or manual installation` heading
  prefixed with the leftover `#### Windows` (`+#### Windows### Linux or manual installation (Desktop half only)`).
  Git history confirms the removed text (`-### Windows`, `-Double-click install\install-windows.cmd`).
* **failure mode:** on the public page this is a single broken heading; the Windows and macOS
  manual-install instructions the repo still ships (`install/install-windows.cmd`,
  `install/install-windows.ps1`, `install/install-macos.command`) are no longer documented anywhere
  in the README, although `README.md:260` still advertises `install/  Desktop and gateway installers`.
* **smallest correct fix:** make it two headings — `#### Windows` and `### Linux or manual
  installation (Desktop half only)` — and either restore the two deleted platform sections or
  change `README.md:260` to name only the two installers the README actually documents.

### m2 — "Two ways to browse" is two of three lenses
* **severity:** `minor`
* **file:line:** `README.md:43-46`
* **quoted:** `**Two ways to browse** — group by skin, or switch the dropdown to group by color family: …`
* **evidence:** `desktop/plugin.template.js:100` `const GROUP_MODES = ['scene', 'theme', 'pack']`;
  the dropdown renders three items — `tpl.js:5873-5875` `By skin` / `By colour family` /
  `By theme pack`. `CHANGELOG.md:198-199` records the third lens landing in 2.6.0.
* **failure mode:** the README's own headline count is wrong, and the third lens (group by the six
  packs) — a feature the CHANGELOG advertises — is invisible to a reader.
* **smallest correct fix:** "**Three ways to browse** — group by skin, by colour family, or by theme
  pack", and name the pack lens.

### m3 — The import formats are listed two different ways
* **severity:** `minor`
* **file:line:** `README.md:52-53` vs `README.md:297-299`
* **quoted:** Highlights: "paste a TweakCN preset, a Windows Terminal scheme, a Base16/Base24 palette,
  or a VS Code color theme" / FAQ: "Supported formats: TweakCN preset name or URL, **shadcn CSS**,
  Windows Terminal scheme, Base16/Base24 scheme, or VS Code color theme JSON."
* **evidence:** `tpl.js:838` `if (/:root\s*{/.test(t)) return parseCssTheme(text, 'pasted.css')` —
  shadcn CSS is a first-class import; the import textarea's own placeholder names it
  (`tpl.js:5965`).
* **failure mode:** the Highlights bullet is the one a skimmer reads; it is missing a supported
  format, and the two lists on the same page disagree.
* **smallest correct fix:** add "shadcn CSS" to `README.md:52-53`.

### m4 — `docs/SPEC.md` is stale at the pin
* **severity:** `minor`
* **file:line:** `docs/SPEC.md:10` and `docs/SPEC.md:14`
* **quoted:**
  > "`plugin.yaml`: name `chroma`, version `2.8.1` (matching `VERSION`)."
  > "Six registrations. All six are asserted by `tests/surfaces-regression.test.mjs`, because a past restructure removed several of them while every other test stayed green:"
* **evidence:** `VERSION` and `plugin.yaml:3` both read `2.9.0` at the pin — the SPEC is a version
  behind. And the build makes **five** `ctx.register` calls — `desktop/plugin.template.js:6225`
  (THEMES_AREA), `:6233` (ROUTES_AREA), `:6239` (SIDEBAR_NAV_AREA), `:6244` (PALETTE_AREA), `:6256`
  (STATUSBAR_AREAS.right). The SPEC's sixth table row ("Gateway sync") is not a registration; the
  test file asserts six *facts*, five of which are registrations.
* **failure mode:** SPEC.md is one of rigour's `required_files`. It tells a reviewer the plugin
  registers six surfaces and is one release behind. `docs/DISCLOSURE.md:30-32` states the same
  thing correctly ("five `ctx.register` calls"), so the repo contradicts itself in the two documents
  a reviewer reads side by side.
* **smallest correct fix:** `2.8.1` → `2.9.0`; "Six registrations" → "Five registrations"; drop the
  "Gateway sync" row or relabel it "— (not a registration)".

### m5 — `docs/PALETTE-ANALYSIS.{md,json}` are stale committed artefacts, and no gate notices
* **severity:** `minor`
* **file:line:** `docs/PALETTE-ANALYSIS.md:10-13`; `docs/PALETTE-ANALYSIS.json`
* **quoted:** `| skins | 109 |` / `| with a derived mode | 47 |` / `| missing a signature role | 14 |`
* **evidence:** I ran `python scripts/analyse-palettes.py` on a fresh clone of the pin: exit 0 and
  **two files modified** — `docs/PALETTE-ANALYSIS.json` by 12,872 lines (12,760 ignoring
  whitespace) and `docs/PALETTE-ANALYSIS.md` by 32 lines. The regenerated `.md` says `skins 94`,
  `with a derived mode 40`, `missing a signature role 0`. The catalogue has 94 skins.
  `scripts/regenerate.py` is the only generator CI diffs (`ci.yml:79`); this one is not.
* **failure mode:** a committed generated file that no gate checks has already drifted from its
  generator by ~13k lines, and it still describes a 109-skin catalogue that stopped existing at
  2.6.0. `docs/RESEARCH/CATEGORY-NAMES.md:4` and `docs/RESEARCH/COLOUR-TAXONOMY.md:4` cite it as
  their input ("109 skins"), so the drift propagates into two research documents.
* **smallest correct fix:** regenerate and commit the two files at the pin, and add
  `docs/PALETTE-ANALYSIS.md docs/PALETTE-ANALYSIS.json` to the `git diff --exit-code` line in
  `ci.yml:79` (or add the generator to CI).

### m6 — `scripts/regenerate.py`'s module docstring describes the retired v1 workflow
* **severity:** `minor`
* **file:line:** `scripts/regenerate.py:1-18`
* **quoted:**
  > "Drop new skin YAML files into the Hermes skins folder, then run this script." … "skins_dir = <hermes home>/skins (HERMES_HOME, else ~/.hermes)" … "out_plugin = <hermes home>/desktop/plugin.js" … "copy the output plugin.js to … %LOCALAPPDATA%\hermes\desktop-plugins\theme-picker\plugin.js"
* **evidence:** the code reads `skins-v2/` and writes the repo's `desktop/plugin.js`
  (`scripts/regenerate.py:766-775`); the README (`README.md:217-220`) says the opposite of the
  docstring — "`~/.hermes/skins/` … is never valid input"; the destination folder is now `chroma`,
  not `theme-picker`.
* **failure mode:** the README points a stranger at `python3 scripts/regenerate.py`
  (`README.md:208`); the script's own `--help` text tells them the opposite of what it does, and
  names a plugin id (`theme-picker`) that no longer exists.
* **smallest correct fix:** replace the docstring's Usage block with the current defaults
  (`skins-v2/` → `desktop/plugin.js`).

### m7 — The maintainer's absolute path and OS username are live in the tree
* **severity:** `minor`
* **file:line:** `docs/PLANS/CHROMA-ROADMAP.md:309, 480, 485, 505, 506, 507`;
  `docs/PLANS/V2-REDESIGN.md:138`; `docs/REVIEWS/ARIA-PLAN-REVIEW-2026-10-19.md:7`;
  `AGENTS.md:107, 109`
* **quoted:** `` `C:/Users/<user>/AppData/Local/hermes/hermes-agent/apps/desktop/src` ``
* **evidence:** `git grep -n "<user>" 352c3c5 -- .` → 10 live hits across three docs files and
  AGENTS.md. `AGENTS.md` additionally carries `C:/DEV/hermes-theme-picker` (the checkout path).
  `docs/PLANS/CHROMA-ROADMAP.md:480` also carries a local install id
  (`…\installs\a13589dc3d4cc6ea\publication.json`) and the broken-CLI error text.
* **failure mode:** **no credential, no token, no key, no email address, no private hostname** —
  the secrets sweep (§7) is clean. What leaks is the OS username and the local Hermes install
  layout, in a repository that is about to become public and is being read by strangers. It also
  makes the docs look like they were dumped rather than written.
* **smallest correct fix:** replace the absolute paths with `<hermes home>/…` or `$HERMES_HOME/…`
  in the three docs files; `AGENTS.md` can keep a generic example.

### m8 — The "Preview 10s" pill has no touch fallback and swallows taps on the card's centre
* **severity:** `minor`
* **file:line:** `desktop/plugin.template.js:3059-3065` and `:3088-3090`
* **quoted:**
  > `const PREVIEW_PILL_IDLE = 'border-white/30 bg-black/50 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100'`
  > (comment at `:3088-3090`) "Hidden until hover, but ALWAYS in the DOM and reachable without a pointer: `focus-visible:` for the keyboard and `pointer-coarse:` for touch — the standing rule this project applies to hover-only affordances."
* **evidence:** the class string contains **no `pointer-coarse:`** — the rule the comment states is
  not implemented for this control (the only two `pointer-coarse` hits in the whole file are the
  comments at `:3089` and `:3166`). The pill is `absolute inset-0 z-10` centred over the card
  (`:3059-3063`, `margin:auto; height:fit-content`) and is a **sibling of, and stacked above, the
  card button** (`tpl.js:4536-4566`); `opacity: 0` affects rendering only — the element still
  receives pointer events, and nothing sets `pointer-events: none`. Keyboard users can still reach
  it (`focus-visible:opacity-100` plus the arrow-key roving set, `tpl.js:3075` `tabIndex: -1`).
* **failure mode:** on a touch device the pill is permanently invisible and permanently over the
  middle of every card; a tap in the middle of a card — where a user aims to pick a theme — hits
  the invisible "Preview 10s" button and starts a 10-second preview instead of applying the theme.
  The README's only instruction for it is "hover any card and click 'Preview 10s'"
  (`README.md:58`), which a touch user cannot perform.
* **smallest correct fix:** add `pointer-coarse:opacity-100` to `PREVIEW_PILL_IDLE` (the rule the
  comment already claims), and — because an invisible control over the card's centre is still a
  mis-target — move the pill out of the card's centre (it has room in the action row, where the
  star/Edit/Fork already sit).

### m9 — The group-by control's accessible name omits the third lens
* **severity:** `minor`
* **file:line:** `desktop/plugin.template.js:5867-5869`
* **quoted:** `title: 'Group the gallery by skin, or by colour family'`, `'aria-label': 'Group gallery by'`
* **evidence:** the list below it has three items — `tpl.js:5873-5875` `By skin` /
  `By colour family` / `By theme pack`.
* **failure mode:** a screen-reader user hears "Group gallery by" and a title naming two lenses,
  and is never told a third exists. It is the same false "two ways" as **m2**, in the UI.
* **smallest correct fix:** `'Group the gallery by skin, colour family or theme pack'`.

### m10 — The pane has no `h1`/`h2`; the pane title is a `<div>`
* **severity:** `minor`
* **file:line:** `desktop/plugin.template.js:5815` vs `:6025`
* **quoted:** `jsx('div', { key: 'n', className: 'text-sm font-semibold', children: 'Chroma' })`
* **evidence:** the only heading element in the build is the per-group `h3` (`tpl.js:6025`).
  `CHANGELOG.md:24-27` claims "headings labelling their sections" — true for the groups, but the
  document has no top level.
* **failure mode:** heading navigation (the H key in most screen readers) lands on `h3` with no
  `h1`/`h2` ancestor, so the pane presents as a wall of level-3 headings with no page title.
* **smallest correct fix:** make the pane title an `h1` (or `h2`) and the group headings `h2`.

### m11 — Two of the repo's own documented gates are not in CI, and one of them fails
* **severity:** `minor`
* **file:line:** `.github/workflows/ci.yml` (whole file); `AGENTS.md:5` and `AGENTS.md:10`
* **quoted:** AGENTS.md lists as acceptance commands
  `python scripts/check-host-classes.py` and `rigour check --ci`; `ci.yml` runs neither.
* **evidence:** `ci.yml` runs four things: `node --test tests/*.test.mjs`,
  `python scripts/check-packs.py`, `python -m pytest tests/ -q`, and (in the other job)
  `python scripts/check-package.py` + `regenerate.py` + `git diff --exit-code`. It does **not**
  run `check-host-classes.py` (which needs the Desktop app's compiled CSS — it found 6 host sheets
  on this machine and reported `with no rule: 0`, so it is the gate that catches the "white pill /
  invisible role colour / unscrollable modal" failures AGENTS.md:5 warns about) and it does **not**
  run `rigour check --ci`, which in a fresh clone of the pin exits **1** with 20 findings on the
  first run and 25 on the second (2 CRITICAL `hallucinated-imports`, 8 HIGH `promise-safety`, 1
  HIGH `phantom-apis`, 1 HIGH `inconsistent-error-handling`, 2 HIGH `context-window-artifacts`,
  4 MEDIUM complexity/file-size, 5 LOW style-drift).
* **failure mode:** the rigour findings are **known and adjudicated** — `docs/TASKS.md:34-45`
  ("`rigour check --ci` currently reports FAIL") and `CHANGELOG.md:49-52` ("Rigour: 23 findings,
  none introduced by this pass") — so this is not a hidden regression. But the standing gates in
  `AGENTS.md:10` are not enforced by CI, and a reviewer who runs the repo's documented acceptance
  commands gets a FAIL from a tool the repo ships a config for. Note also that rigour's score is
  **not reproducible on a fresh clone**: `rigour.yml` points `style_drift.baseline_path` at
  `.rigour/style-baseline.json`, which is gitignored, so the baseline is created on first run and
  the score moves (37 → 29 in my two runs).
* **smallest correct fix:** none required for the admission gate; if the repo wants its own
  contract to be enforced, add a `check-host-classes.py` step to the `build-is-current` job
  (it needs the Desktop app's CSS, so it must be a local-only step, not a GitHub runner) and state
  in `AGENTS.md` that `rigour check --ci` is a local, advisory gate with its findings adjudicated
  in `docs/TASKS.md`.

### m12 — The apply scope defaults to "Everywhere" and the README never says so
* **severity:** `minor`
* **file:line:** `desktop/plugin.template.js:2109-2113`; `README.md:307-310`
* **quoted:** `return readRecord(APPLY_SCOPE_KEY)[profile] === APPLY_SCOPE_LOCAL ? APPLY_SCOPE_LOCAL : APPLY_SCOPE_EVERYWHERE`
* **evidence:** the default is `everywhere`; the FAQ presents the choice as *"Use 'Everywhere' when
  you want all your devices to follow"*, which reads as opt-in. The Highlights bullet does advertise
  the behaviour (`README.md:19-20`, `:28-31`).
* **failure mode:** a first-time user who clicks a skin broadcasts to every connected Desktop and
  the CLI without having chosen to, and the README's own wording suggests they had to opt in.
  Nothing breaks; the disclosure is just incomplete about the default.
* **smallest correct fix:** one clause in the FAQ — "the default is *Everywhere*; switch the
  scope control to *This profile* to keep a pick local."

### m13 — The PR-description draft quotes stale test counts
* **severity:** `minor`
* **file:line:** `docs/CATALOG-SUBMISSION.md:110-111`
* **quoted:** "> **Evidence:** `hermes plugins validate .` passes every check including `security scan — safe`; **242 JS tests, 164 backend tests + 5 skin-contract tests, 16 generator tests (19 collected, 3 skipped)** and the catalogue and package contract gates are green"
* **evidence:** at the pin I measured **266 JS tests** (`node --test tests/*.test.mjs` → 266 pass,
  0 fail) and **185 pytest passed / 4 skipped** (`python -m pytest tests/ -q`). The draft's figures
  are from an earlier tree.
* **failure mode:** the PR body is what the reviewer reads first; stale numbers in it are the kind
  of detail that makes a reviewer stop trusting the rest of the document.
* **smallest correct fix:** replace the counts with the measured ones (266 JS; 185 pytest passed /
  4 skipped) — or state the commands and let the reviewer re-run them.

### m14 — The catalogue entry still pins `43f8e1b`, two commits behind the tip
* **severity:** `minor` (pre-submission task, not a code defect)
* **file:line:** `docs/CATALOG-SUBMISSION.md:21-24`
* **quoted:** `sha: 43f8e1ba0ca277825b833cd94aa5a8c395bcd5d0` … "**Re-pin before you submit.**"
* **evidence:** the pin under review is `352c3c5ad86db06cc600c3555675e2baf0928e12`. The file's
  own instruction is right and was simply not carried out. The entry also says
  `version: "2.9.0"`, which matches `VERSION`/`plugin.yaml` at the tip ✓, and
  `requires_hermes: ">=0.22.0"` ≤ the current release (the host checkout is 0.22.2) ✓.
* **failure mode:** if the PR is opened with this SHA, the reviewer fetches a tree two commits
  behind the one the README describes — and one of those two commits is the a11y fix
  `f338063` ("the roving set returned a fake React element, and every card broke"), i.e. the
  pinned tree would ship a build where **every card throws** and the whole gallery renders "This
  theme could not be drawn."
* **smallest correct fix:** `git rev-parse origin/main` at PR time; bump `version` in the same PR
  if the tree moved. **Do not ship the file as-is.**
* **Note:** this is a genuine "ship it or not" item, but it is a *process* step the repo already
  documents, not a defect in the product. It must be done before the PR opens.

---

## 6. What the registry reviewer will ask, and whether we have the answer

1. **"Does `hermes plugins validate .` pass?"**
   **Yes.** I ran the real validator (hermes-agent 0.22.2) against a fresh clone of the pin:
   **exit 0**, 12 checks OK, `security scan — safe`, `desktop surface — stays inside the plugin
   SDK surface`, `no core override — no runtime rebinds of Hermes core`, `loadable — entry:
   desktop/plugin.js`, `python dependencies — none declared`, isolation `portable`.
   **But** the run **skipped the capability probe** (`no __init__.py`) — rule 6 was not actually
   verified — and the Python half was never imported. We must say that ourselves rather than let
   the reviewer find it.
2. **"Is the SHA a real 40-character pin of the tree you reviewed?"**
   **Not yet.** `docs/CATALOG-SUBMISSION.md:21` still pins `43f8e1b…`. Must be re-pinned (**m14**).
3. **"Is `requires_hermes` truthful and not newer than the current release?"**
   **Yes.** `>=0.22.0`; the host checkout is 0.22.2; `docs/DISCLOSURE.md:187-189` records the
   0.22.2 walk. `docs/PLANS/CHROMA-ROADMAP.md:143-144` honestly marks the floor as **not re-probed
   this session** — shipping that mark is honest, and it is better than dropping it, because the
   reviewer can see exactly what was and was not checked. Keep it; it costs nothing and it buys
   credibility for everything else in the file.
4. **"What does this plugin do on the network?"**
   **Our answer is wrong.** We say "one HTTPS GET to tweakcn.com"; the code will GET any http(s)
   URL pasted into the import box (**M2**). Fix the code, then the answer is true and simple.
5. **"What does it write, and where?"**
   **Our answer is incomplete.** We name 3 localStorage keys; there are 14 (**M1**). The complete
   inventory already exists and is correct at `docs/DISCLOSURE.md:78-95` — paste it in.
6. **"Does it need credentials or environment variables?"**
   **Yes, clean.** `requires_env: []`, `provides_tools/hooks/middleware: []`; no `eval`, no
   `new Function`, no shell, no credential store, no browser profile, no `.env` read, no OAuth.
   Verified by reading both halves and by the gate's own `no core override` and
   `desktop surface` checks.
7. **"What are the plugin's Python dependencies?"**
   **We say "none" — and the gate agrees — but `dashboard/plugin_api.py:240-241` imports fastapi
   and pydantic.** This is the question the reviewer will actually ask, because the answer is
   sitting in the file (**M3**).
8. **"Is this a fork, and is the lineage declared?"**
   **Yes, and the attribution is in every place the catalogue asks for.** Rule 16 says a listed
   fork names its origin in its disclosure line; the upstream `hermes-theme-picker` is **not** in
   the 614-entry catalogue (I listed it: only `accent-picker`, `claude-code-theme`,
   `openrouter-picker`, `profile-picker`, `t3-code-theme` match "theme|picker"), so Chroma is
   not competing with a listed entry. The lineage appears in: `plugin.yaml:10-16` (description
   **and** `author`), `LICENSE:3-4`, `THIRD_PARTY_NOTICES.md:5-7`, `README.md:5, 7-15, 320-331`,
   and the PR-description draft (`docs/CATALOG-SUBMISSION.md:117-118`, "Derived from
   jdtimothy/hermes-theme-picker (MIT)"). The catalogue entry's one-line `description` does not
   carry it — the schema calls that "One-line description", and rule 16's requirement is met by the
   disclosure line (README + PR body). **No change needed.**
   The one thing to *decide*: rule 16 also says a fork is listed only when it is *materially
   different*. Chroma is (the TweakCN importer, the skin backend, the editor, 94 dual-palette
   skins, the packs) — say so explicitly in the PR body rather than leaving the reviewer to
   compare.
9. **"Are the bundled palette licences compatible with MIT, and are third-party files credited?"**
   **Yes.** `THIRD_PARTY_NOTICES.md` names every upstream pack, states its licence, and reproduces
   both MIT texts in full. The catalogue's `scripts/cliffwade-v1.1.0-sha256.json` plus the
   generator tests enforce byte identity against the upstream v1.1.0 release.
   **The fonts are the cleanest part of the whole submission:** `docs/FONTS.md` states "Chroma
   ships no font binaries: a skin only names families" — the plugin ships **no** font files at all,
   so there is no font redistribution question. Every family it names is marked with its licence
   or with an honest `UNVERIFIED`. I verified `docs/FONTS.md` is **current** (re-running
   `scripts/font-register.py` on a fresh clone produces a byte-identical file).
10. **"Is the plugin's own build reproducible?"**
    **Yes, and I proved it.** `python scripts/regenerate.py` on a fresh clone of the pin, then
    `git diff --exit-code -- desktop/plugin.js gateway-skins docs/DERIVED-PALETTES.md` → **exit 0**,
    byte-identical. That is CI's `build-is-current` job and it genuinely holds.
11. **"Do your tests pass on a fresh clone?"**
    **Yes.** 266/266 JS, 185 passed / 4 skipped pytest, both contract gates green, on a clone I made
    from the pin. **But the PR body quotes 242 / 164+5 / 16** — stale (**m13**).
12. **"Do you ship binaries or archives?"**
    **No.** The tree is `.js`, `.py`, `.yaml`, `.md`, `.json`, `.sh`, `.ps1`, `.cmd`, `.png`.
    The only binary-ish file is `docs/chroma-banner.png` — an image, and the scanner flags it only
    as `medium oversized_file`. The scanner's verdict on the whole tree is **`safe`** (28 findings,
    all medium/low — the notable ones are `medium unpinned_pip_install` at
    `.github/workflows/ci.yml:35` and `:65` and at `README.md:230`, and `medium python_subprocess`
    at `scripts/check-package.py:109`, which is the `git ls-files` call).
13. **"Does it touch the app's own markup or rebind core?"**
    **No, mechanically verified.** I ran the real `desktop_surface_hits` over
    `desktop/plugin.js` **and** `desktop/plugin.template.js` (the lint covers both): `HITS: NONE`.
    The one `MutationObserver` in the build observes `document.documentElement` for the
    `data-hermes-theme` attribute the plugin itself writes — not `document.body`, and not for
    `data-slot`/`data-tour`/`data-sidebar`/`data-testid`.
14. **"What happens on a user's machine?"**
    **The Desktop half works with no backend; the backend half mounts at startup; a paste-URL
    install is the documented path.** Two host behaviours I could **not** verify (no Desktop
    available, and the guardrail forbids running the `hermes` CLI): the paste-URL dialog's
    "installed and enabled in one step" claim and the terminal `hermes plugins install
    TobiasDraven/chroma-for-hermes` line. Both are marked `UNVERIFIED` in the claim table. The
    roadmap already lists "One end-to-end install on a clean machine" as outstanding work
    (`docs/PLANS/CHROMA-ROADMAP.md:152-154`) — **that walk is the single most valuable thing left
    to do before the PR.**
15. **"Are the docs true?"**
    **Mostly, with three exceptions**: `docs/SPEC.md` is a version behind and miscounts the
    registrations (**m4**), `docs/PALETTE-ANALYSIS.*` has drifted from its generator (**m5**), and
    `scripts/regenerate.py`'s docstring describes the retired v1 workflow (**m6**).
    `docs/THEME-PACK-CREATION.md` (the one the README points a skin author at) is **accurate** —
    43 surfaces, ten v2 surfaces, the other 33, and the `status_bar_dim` figure (11 light skins,
    worst 3.996:1) matches the brief. `docs/DISCLOSURE.md` is **the best document in the repo**
    and should be the source for the README's disclosure section. `docs/FONTS.md` is accurate and
    current. `CHANGELOG.md` is accurate except that it does not record the `f338063` field defect
    (arguably correct — that fix is unreleased).
16. **"Is `rigour check --ci` green?"**
    **No — exit 1, 20–25 findings.** They are adjudicated in `docs/TASKS.md:34-45` and
    `CHANGELOG.md:49-52`, and `rigour.yml` is not to be weakened. The honest position is to say so
    in the PR body with the TASKS.md link, rather than let the reviewer discover it. Note the score
    is not reproducible on a fresh clone (the style baseline is gitignored) — **report the finding
    list, not the score** (`AGENTS.md:5` says exactly this).
17. **"Do you ship secrets, keys, emails, or machine paths?"**
    **No secrets.** I swept the tree and the whole history: no API keys, tokens, passwords, private
    keys, JWTs, AWS/GitHub/Slack keys, email addresses, or private hostnames. What the sweep *did*
    find is the maintainer's username and absolute path, live in three docs files and AGENTS.md
    (**m7**), plus the historical `C:/Users/<user>/…` paths in commits `06e1c5d` and `c0575ca`
    (removed from the tree but permanent in history — the repo is public, so the history is public).

---

## 7. The embarrassing section — the README claims I would delete or rewrite

If I had to cut the README down to only what the build can prove, these go:

1. **`README.md:160-165` — the whole "## The statusbar lightbulb" section.** It describes a 💡
   that is not in the plugin. Delete it or rewrite it around the Dark/Light button.
2. **`README.md:292-295` — the lightbulb FAQ.** It instructs the reader to look for something
   that does not exist, and to conclude the plugin is broken if they don't find it. **Delete.**
3. **`README.md:240-243` — "one HTTPS GET to `https://tweakcn.com/r/themes/<name>` … Nothing else
   leaves the machine."** Until `tweakcnUrl` is fixed, this sentence is false. Rewrite it to the
   truth, or fix the code so the sentence becomes true. I would fix the code — the sentence is the
   better sentence.
4. **`README.md:244-250` — the Writes/Reads bullets.** Replace with `docs/DISCLOSURE.md:78-95`.
   A disclosure section that under-reports by eleven keys is worse than no disclosure section,
   because it tells the reviewer it was checked.
5. **`README.md:116` — `#### Windows### Linux or manual installation (Desktop half only)`.**
   Delete the mangled heading. As it stands it reads like a corrupted file, and the README at the
   pinned SHA *is* the plugin's public page.
6. **`README.md:43-46` — "**Two ways to browse**".** It is three. The count is wrong and it hides a
   feature.
7. **`README.md:52-53` — the import-format bullet.** It is missing shadcn CSS, which the FAQ on
   the same page lists. Two lists, two answers.
8. **`README.md:154-158` and the deleted platform sections.** The README points at
   `install/install-windows.cmd` only via a `Project layout` line; the Windows and macOS manual
   installs were removed from the README in `711858b` and nothing replaced them. Either restore
   them or stop implying in `README.md:260` that `install/` holds installers the README documents.

What I would **not** delete: the fork attribution (three places, all correct and required), the
"What it touches" *structure* (it is the right idea, just wrong in detail), the "94 skins" /
"thirty core / six packs" / "twelve families" numbers (all exactly right), the "no single-mode
skins" claim (right), the "Works offline" claim (right), and the "no telemetry / no credential
store / no shell" claims (right, and the gate agrees).

---

## 8. Closing counts

**Findings: 18 total — 1 blocker, 3 major, 14 minor.**

| Severity | Count | IDs |
|---|---|---|
| blocker | 1 | B1 |
| major | 3 | M1, M2, M3 |
| minor | 14 | m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14 |

**ENUMERATED LIST (authoritative):** 18 findings — **1 blocker** (B1), **3 major** (M1, M2, M3),
**14 minor** (m1–m14).

**What is NOT a finding, because it checks out:** the admission gate itself passes (exit 0, and I
ran the real code); the build is byte-reproducible from a clean checkout; 266/266 JS and 185
pytest pass on a fresh clone; the licence position is clean (MIT, both upstream palette licences
credited in full, **no font binaries shipped**); the fork attribution is present in every place
the catalogue requires; no secrets, tokens, keys, emails or private hostnames exist in the tree or
in the history; `docs/FONTS.md` and `docs/gallery.html` are current; `docs/THEME-PACK-CREATION.md`
is accurate; the disclosed "no telemetry / no update check / no core override / no app-markup
reach" claims are all true and mechanically verified against the host's own linters.

**Why HOLD and not PUBLISH:** B1 alone is enough — the public page asserts a control the product
does not have, and the FAQ tells the reader to go looking for it. M1–M3 are the kind of thing the
reviewer's own diff will find, and each of them is an answer to a question the catalogue asks
(rule 13 disclosure, network behaviour, dependency list). None of them needs a redesign; all of
them need an edit and a re-pin.

**If you fix exactly five things before opening the PR:** B1 (rewrite the lightbulb section and
delete its FAQ), M2 (host-lock `tweakcnUrl`), M1 (paste `docs/DISCLOSURE.md:78-95` into the
README), M3 (document the fastapi/pydantic requirement), and the re-pin (**m14**) — plus one
end-to-end install on a clean machine (`docs/PLANS/CHROMA-ROADMAP.md:152-154`), which is the only
thing standing between "the gate passes" and "we know it works on a user's machine".
