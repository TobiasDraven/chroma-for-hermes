# Chroma for Hermes — pre-publication critical review: triage

**Verdict: HOLD.** Six read-only lanes against pin
`352c3c5ad86db06cc600c3555675e2baf0928e12` (branch `main`, tree clean, 538 tracked files).

**Tally: 84 findings — 3 blockers, 20 majors, 60 minors, 1 informational.**

| Lane | Surface | Verdict | Blocker | Major | Minor | Inf |
|:--|:--|:--|--:|--:|--:|--:|
| A | Desktop pane: runtime correctness | HOLD | 1 | 3 | 8 | 0 |
| B | Backend + scripts: data integrity, hostile input | HOLD | 0 | 4 | 13 | 0 |
| C | Data layer + the tests that claim to guard it | HOLD | 0 | 4 | 7 | 0 |
| D | Contract, product truth, submission | HOLD | 1 | 3 | 14 | 0 |
| E | Adherence to the Hermes plugin guidelines | CONFORMS | 0 | 2 | 7 | 1 |
| F | Packaging, CI, gates, integration | HOLD | 1 | 5 | 11 | 0 |

Every lane ran read-only. The only write each was permitted was its own report file. Each
report separates **what it ran** (with exit codes) from **what it only read**, and gives an
evidence line per finding. The parent verified the three blockers directly against the host
source and the shipped build — see the evidence under each.

---

## The three blockers

### B1 — importing a theme resets the app and forgets the pick
**Lane A, F1 · `desktop/plugin.template.js:1934`**

`applyScene` calls `syncDesktopState(scene.name, …)` for **every** scene, including skins
Desktop has never heard of. The host's `setTheme` does not leave an unknown name alone — it
**coerces** it:

```js
// apps/desktop/src/themes/context.tsx:60
const normalizeSkin = (name) =>
  name && resolveTheme(name) && !RETIRED_SKINS.has(name) ? name : DEFAULT_SKIN_NAME

// apps/desktop/src/themes/context.tsx:631-638
const setTheme = useCallback((name) => {
  const next = normalizeSkin(name)
  setThemeNameState(next)
  skinPref.assign(liveProfile(), next)   // persists the coerced name
}, [])
```

`resolveTheme` resolves only built-ins, `$userThemes`, `$backendThemes` and plugin
`THEMES_AREA` contributions. Chroma contributes only its 88 shipped skins; imported and
live-discovered skins are never contributed, and `$userThemes` is read once at module load.
So on the session where you import a theme: the plugin paints the imported palette for one
frame, `setTheme('dracula')` resolves to `'nous'`, the provider repaints the whole app with
the default skin **and persists `'nous'` as the profile's skin**. The import reports success.

Under the "This profile" apply scope it never recovers. Under "Everywhere" it half-recovers
through a race.

**The host anticipated this exact hazard and shipped the correct door** —
`themes/request.ts:29-38`:

```js
// a theme the user never installed would silently reset their appearance
// instead of leaving it alone. The boolean doubles as the availability check,
// so a caller needs no separate lookup to know it got what it asked for.
export function requestTheme(name: string): boolean {
  if (!resolveTheme(name)) return false
  $pendingSkinApply.set(name)
  return true
}
```

Chroma uses `setTheme` anyway. **Fix:** guard the name before handing it over —
`useTheme().availableThemes` (`listAllThemes()`) is the host's own availability check.
With the guard, the plugin's manual paint stands for an imported skin.

**Parent verification:** read `context.tsx:58-64`, `:625-645`, `user-themes.ts:143-158`,
`request.ts:25-40`. Confirmed.

### B2 — the README documents a status-bar lightbulb the plugin does not have
**Lane D, B1 · `README.md:160-165`, `:292-295`**

The README's "The statusbar lightbulb" section and its FAQ both assert a 💡 icon. The shipped
build renders the **word** `Dark` / `Light` (`plugin.template.js:6183-6191`), whose own
comment records why: *"The glyph it used to carry was a codicon that painted as an empty box
wherever that font is not loaded."* `CHANGELOG.md:203-206` records the replacement.

**Fix:** rewrite the section and the FAQ answer to describe the word chip. Delete the icon
claim. **Parent verification:** `grep -c "💡" desktop/plugin.js` → **0**. Confirmed.

### B3 — the repo root is not an agent-plugin package: no `__init__.py`
**Lane F, F1 · the repo root**

The host's installer decides what to install from the tree:

```js
// apps/desktop/electron/desktop-plugin-install.ts:181-185
const hasInit = pathExistsSync(path.join(pluginRoot, '__init__.py'))
const agent = (hasYaml && hasInit) || hasPortable
```

Without a root `__init__.py`, `agent` is `false`, so:

```js
// apps/desktop/src/app/settings/plugin-install-run.ts:37-39
export function desktopHalfFromPackage(components, remote) {
  return components.agent && !remote        // → false
}
```

…and the enable branch never runs (`plugin-install-run.ts:172`: `if (agentResult?.enabled …)`).
The paste-URL install takes the clone-standalone path and installs **only `desktop/`** —
no backend, so every backend feature (minting real gateway skins) is dead, and the README's
install claim is false.

**It breaks the CLI route too.** The CLI lands the tree at `plugins/chroma/` and mounts the
dashboard API, but `plugins_loader.py:704-706` raises
`FileNotFoundError: No __init__.py` at **every gateway start**. One file fixes all three
routes.

**Fix:** add a root `__init__.py` exposing `register(ctx)`. Chroma registers no tools, hooks
or middleware, so a no-op `register` returning a `Plugin` is enough; the desktop half does
the work. **Parent verification:** read `desktop-plugin-install.ts:175-215`,
`plugin-install-run.ts:25-45`, `:160-180`. Confirmed.

**This also hides behind the gate's own green.** Lane D ran the real `hermes plugins validate`
from the host's 0.22.2 checkout: exit 0, 12 checks OK — but the **capability probe is
SKIPPED**, because with no `__init__.py` there is no agent half to probe. So the gate cannot
verify the `provides_*` declarations at all, and reports PASS. Fixing B3 is what makes the
gate actually check something.

---

## The twenty majors

**A — desktop runtime**
- **A-F2** No import is ever rehydrated. `ensureImportedSkinsLoaded` filters on
  `themePickerSource`, but the boot write destroys that marker (`existing.themePickerManaged`
  is true, so `persistThemesForBoot` replaces the record with one that has no marker), and
  three of the four parsers (`windowsTerminalTheme`, `base16Theme`, `vsCodeTheme`) set
  `source:` and never `themePickerSource:`. A theme imported yesterday has no card today.
- **A-F3** The hydration runs in a mount effect (`useEffect(…, [])`) but the list that
  consumes it is a `useMemo` whose deps (`live`, `importedTick`) never move on a plain load.
  The memo is frozen at the pre-hydration value for the life of the mount. Independent of F2.
- **A-F4** A 404 from one optional route (`GET /schema`) nulls `_rest` — the single transport
  every backend call shares. The pane then renders "Gateway-skin backend not installed" for a
  backend that is installed and running, and rename/delete/export/packs/categories all throw.
  `isMissingRoute` is also loose (matches any message containing `not found`/`404`).

**B — backend and scripts**
- **B-M1** A failed rename restores the *path* but not the *bytes* (`plugin_api.py:762-776`).
  The skin's `name:` no longer matches its filename, so the CLI lists it under a name it
  cannot load and falls back to the default palette.
- **B-M2** `_yaml_scalar` (`plugin_api.py:43-46`) writes labels/descriptions with no
  control-character validation. A pack bundle label containing `---` or a NUL mints a skin
  file the Hermes engine cannot parse — the skin silently vanishes while the import reports
  success.
- **B-M3** `regenerate.py` ignores `--out` for the prune target and the derivation report.
  The documented invocation `regenerate.py <dir>` deleted **186 of 188** shipped transport
  skins and rewrote the committed build, **exit 0**.
- **B-M4** The TweakCN import fetches **any** `http(s)://` URL the user pastes
  (`plugin.template.js:845-860`) while every message says "TweakCN". The slug cannot escape
  the base; the host is unconfined.

**C — data and tests**
- **C-F1** 16 of the 43 documented colour roles are authored in `skins-v2/` and shipped
  **nowhere**. The docs say the opposite.
- **C-F2** `scripts/packs.json` is **not** ignored legacy: `generate-gallery.py` reads it, and
  it omits the `studio` pack with 27 dangling members. *(This narrows the premise the brief
  carried — see the corrections below.)*
- **C-F3** `tests/test_regenerate.py` guards 363 lines of generator code the build never
  executes.
- **C-F4** `scripts/check-packs.py` (the CI data gate) cannot see a broken palette: it accepts
  invalid hex, unknown keys and the 21-key compaction. **This is the gate gap that hid B-M2.**

**D — contract and submission**
- **D-M1** The README writes/reads under-reports the install footprint (14 keys vs 3).
- **D-M2** The network disclosure is false (same root as B-M4).
- **D-M3** `fastapi`/`pydantic` are undeclared dependencies.

**E — guidelines**
- **E-F1** The network disclosure under-states the reachable endpoint set — rule 13
  incomplete (same root as B-M4).
- **E-F2** The in-code comment claims *"The public plugin SDK does not expose
  `ThemeContext.setTheme`/`setMode`"*. **This is false** — the SDK exports `useTheme` with
  both, and the plugin calls them 80 lines later. The justification for writing host root
  markup is therefore wrong (the write itself still passes the rule: it targets the app's
  public theme protocol).

**F — packaging and gates**
- **F-F2** The "one-step install" claim is published as fact and is false at the pin.
- **F-F3** `scripts/check-package.py` passes while the package cannot be installed.
- **F-F4** The CI build-currency gate is blind to untracked files.
- **F-F5** The repo's own committed quality gate (`rigour`) is not in CI, and it is **RED**
  at the pin — 25 violations, 2 CRITICAL, 8 HIGH.
- **F-F6** `check-host-classes.py` is a gate nobody runs, and it cannot be one as written.

---

## Corrections to our own premises

Four things the briefs asserted that the lanes **disproved**. Two of them are rules this
project has been enforcing on a false basis.

1. **The `${...}` template-literal rule is false.** The brief said 20 template literals were
   flagged as `inline_shell_exec`. Lanes A, B and E each ran the host's real scanner
   (`tools.plugin_guard.scan_plugin`) against the plugin: **`verdict: safe`, 31 findings, and
   not one of them is `inline_shell_exec` or about template literals.** The
   `inline_shell_exec` pattern in `tools/skills_guard.py:393` is `` r'!`[^`\s][^`\n]*`' `` —
   the **Skills** inline-shell auto-exec DSL (`!`cmd``), not `${…}`. There is no
   `${…}`-as-shell rule in the guard. `AGENTS.md` §3.5 and a source comment both assert the
   false rule. **Either the rule is retired or the eight covered literals are converted.**
   This corrects a rule carried in session memory.

2. **`scripts/packs.json` is not dead.** The brief said "not read by the build since 2.6.0".
   It is not read by `regenerate.py`, but it **is** read by `generate-gallery.py` — and it is
   wrong (C-F2).

3. **The admission gate passes — it can be run.** The brief said `hermes plugins validate .`
   cannot be re-run because the local CLI fails to start. Lanes D and E worked around it by
   driving `hermes_cli.plugin_validate.validate_plugin_dir` directly: **13/13 PASS, 1 warning,
   exit 0.** Lane A ran the security scan step directly: **`verdict: safe`.** The gate is
   discharged; the warning (file count/size) is a real cosmetic item, not a blocker.

4. **The SDK does expose `setTheme`/`setMode`.** E-F2. Our in-code comment and
   `docs/DISCLOSURE.md` §5 both say otherwise. Both need correcting.
5. **`.rigour/scan-cache.json` and `rigour-report.json` are not tracked.** The brief listed
   them as committed junk. Lane F checked `git ls-files`: they are **gitignored**; only
   `rigour.yml` ships. Nothing to clean.
6. **The two `MutationObserver` calls match the host's own idiom.** The brief framed them as
   a catalogue-rule risk. Lane E found `apps/desktop/src/hooks/use-theme-epoch.ts:16-17`
   uses the **identical** pattern — `document.documentElement`, one-attribute
   `attributeFilter`, read-only. Our two observers are not a workaround; they are the host's
   own technique.
   Rule tally at the pin: **16 PASS, 1 FAIL (rule 13, incomplete network disclosure),
   0 UNVERIFIED.**

---

## Proposed fix order

**Wave 1 — the blockers (must fix before the PR).**
1. B3 — add root `__init__.py` (one file, one line of behaviour).
2. B1 — guard the theme name in `syncDesktopState` with the host's `availableThemes`.
3. B2 — rewrite the README lightbulb section and FAQ.

**Wave 2 — the user-visible majors.**
4. A-F2 + A-F3 together (the same symptom: an imported theme never returns).
5. A-F4 — stop retiring the transport on a route-scoped 404.
6. B-M1 — restore the bytes on a failed rename.
7. B-M2 — validate control characters in `_yaml_scalar`.
8. B-M3 — honour `--out` for the prune target; make the build write atomic.
9. B-M4 / D-M2 / E-F1 — confine the import fetch to the TweakCN base and state the reachable
   endpoint set in the README **and** the PR (rule 13). The scheme check is `/^https?:\/\//i`
   — it accepts plain `http://`. **Note:** `tests/tweakcn-import.test.mjs:192` *pins* the
   current pass-through behaviour ("passes a URL through"), so the fix must change that test.

**Wave 3 — the gates and the truth.**
10. F-F5 — run `rigour` in CI and clear the RED.
11. C-F4 — teach `check-packs.py` to see a broken palette.
12. F-F3 / F-F4 / F-F6 — make the packaging gates real.
13. C-F1 — either ship the 16 roles or correct the docs.
14. F-F2 — settle the install claim: proven, or code-read-only, with the evidence.

**Wave 4 — the minors, and the false-premise cleanups.**
15. Retire or honour the `${…}` rule; fix the source comment and `DISCLOSURE.md` §5.
16. The remaining minors in the six reports.
17. **`AGENTS.md` §5 documents a command that fails on the installed Node.** `node --test
    tests/` exits 1 on Node 24.19.0 (`Cannot find module '…\tests'` — a bare directory
    argument is treated as a module path). The glob form `node --test tests/*.test.mjs` is
    the one that works. Fix the doc.

---

## Evidence index

| Lane | Report |
|:--|:--|
| A | `docs/REVIEWS/review-2026-10-20/review-A-desktop-runtime.md` |
| B | `docs/REVIEWS/review-2026-10-20/review-B-backend-data.md` |
| C | `docs/REVIEWS/review-2026-10-20/review-C-data-tests.md` |
| D | `docs/REVIEWS/review-2026-10-20/review-D-contract-submission.md` |
| E | `docs/REVIEWS/review-2026-10-20/review-E-guidelines.md` |
| F | `docs/REVIEWS/review-2026-10-20/review-F-packaging-gates.md` |

**Lane briefs** (the handoffs): `cache/scratch/brief-review-{A..F}.md`.

**Baseline gates at the pin, re-verified by the lanes:** JS 266/266 (exit 0);
pytest 185 passed / 4 skipped / 9 subtests (exit 0); admission gate 13/13 (exit 0);
security scan `verdict: safe`.
