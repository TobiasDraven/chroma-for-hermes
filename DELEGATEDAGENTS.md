# DELEGATEDAGENTS.md — the operational handbook

Working detail for any agent in this repository. The binding contract is `AGENTS.md`; this
file carries how the work is actually done and is edited freely as the repository changes. Read
both before you touch anything.

Every number here was measured. If you change a command or a path, re-measure it and update
this file in the same commit.

**2026-10-23:** the shipped package moved off the repo root into `chroma/` (the catalog
installs it with `subdir: chroma`, and the host sparse-clones only that directory). Every path
in this file already says `chroma/...` — that is why this file, not the old one, is the one to
edit. `AGENTS.md` is the contract; this is the map.

---

**Measured caveat, 2026-10-16:** the Hermes documentation says a delegated child inherits the
workspace's project context files automatically. Two subagents working in this repository reported that
**nothing was embedded in their prompts** — they had to read this file from disk. So put the rules here
AND have the brief name this file; ask a child which context files it was given rather than assuming.

**Project:** Chroma for Hermes — a theme-picker plugin for Hermes Desktop. A hard fork of
`jdtimothy/hermes-theme-picker` (MIT). Plugin id `chroma`; the manifest is `plugin.yaml` and the
version lives in `VERSION`. Upstream is a different project now — do not "sync" with it by reflex.

---

## 1. The rule that breaks everything

`chroma/desktop/plugin.template.js` is the **source of truth**. `chroma/desktop/plugin.js` is **generated output**.

```bash
python scripts/regenerate.py                             # after EVERY edit to the template
"/c/Program Files/nodejs/node" --check chroma/desktop/plugin.js # then prove it parses
```

**Use the SYSTEM node for the syntax check.** The Hermes-bundled node is first on `PATH`, and its
`node --check` silently reports success for an ESM file — including one with a deliberate syntax
error (verified 2026-10-19: `node --check` exit 0 on a build with a missing `})`). The failure then
surfaces inside the test harness as "Unexpected token" at a line number that belongs to the
harness's transformed source, not to your file. `node --test` itself is trustworthy; the check is not.

Editing `plugin.js` by hand is always wrong: the next regenerate discards it without a word. A change
is not shipped until the build has been regenerated, and the template is the only file to review.

## 2. Repository map

```
chroma/                   the shipped plugin package — the catalog installs THIS subdirectory
  plugin.yaml             manifest (id, version, entry points) — the plugin's contract with Desktop
  __init__.py             agent-plugin entry point (hasYaml + hasInit)
  README.md               the user-facing readme, including the install URLs
  LICENSE
  THIRD_PARTY_NOTICES.md  MIT credits for every idea copied from another project — update it when you copy
  desktop/
    plugin.template.js    SOURCE OF TRUTH: the whole renderer plugin (ESM, jsx() calls, no JSX syntax)
    plugin.js             GENERATED from the template — never edit
  dashboard/
    plugin_api.py         FastAPI backend mounted at /api/plugins/chroma/ (skins, import, export, trash)
    manifest.json         the backend half's manifest
  install/                platform installers for the plugin and its gateway transports
VERSION                   version, mirrored into plugin.yaml
skins-v2/                 the catalogue: one file per skin, both palettes (a build input)
gateway-skins/            the mode-locked transports, generated from the catalogue (a build output)
skins/                    retired v1 pair table - not read by the build
scripts/regenerate.py     template -> build; also emits the skin catalog and gateway transports
tests/                    node:test suites + helpers; fixtures/ holds pinned parity data
  helpers/load-plugin.mjs THE harness: loads the built plugin into a vm context
docs/SPEC.md              surfaces, features, backend contract, acceptance commands
docs/ARCH.md              layout, build pipeline, load-time constraints, test strategy — THIS one
docs/ARCHITECTURE.md      pre-fork reference from upstream (Desktop's three-layer theme system);
                          not this plugin's architecture — kept for background only
docs/DECISIONS.md         numbered decisions and WHY (read before proposing a redesign)
docs/TASKS.md             open work, adjudicated gate findings, quality-gate debt
docs/PLANS/               campaign tracker, roadmap, research artifacts
docs/CATALOG-SUBMISSION.md  the catalog entry draft (its subdir field names chroma/)
rigour.yml                quality gates; committed; NEVER tuned to make a check pass
```

## 3. Non-negotiable constraints

1. **No `package.json` and no npm dependency, ever.** The Desktop plugin loader resolves exactly three
   specifiers: `@hermes/plugin-sdk`, `react`, `react/jsx-runtime`. Everything else must be hand-written
   and dependency-free — that is why the parsers are tables and regexes, not libraries.
2. **Plain, uncompiled ESM.** No JSX syntax: build elements with `jsx()` / `jsxs()` calls. No build step
   other than `regenerate.py`, which only substitutes data.
3. **Line endings are normalised, not preserved.** `.gitattributes` sets `* text=auto eol=lf`, and
   `regenerate.py` writes the build with LF. The template may be CRLF in your working tree; the
   committed build is LF. An earlier version of this section said "preserve CRLF" — `.gitattributes`
   and the generator have the last word, so do not chase a CRLF diff.
4. **Two classes of localStorage key may be written, and no others.** (a) Chroma's own `chroma-*` keys.
   (b) The app's own appearance keys the code already reads and writes — the `hermes-desktop-*`
   theme/mode/profile keys and the `hermes-boot-*` boot hints (`desktop/plugin.template.js:69-73`).
   The boot cache in particular MUST be written: Desktop reads its theme cache *before* plugins
   register, so a contributed theme not mirrored there is unresolvable at the next startup. Never invent
   a *new* app-owned key — if the app does not already use the key, do not write it.
5. **No backtick string in the plugin source may look like shell.** The plugin catalog's security
   scan reads SOURCE TEXT, not semantics. Its `inline_shell_exec` pattern matches a backtick that
   is preceded by an exclamation mark (the *Skills* inline-shell auto-exec DSL,
   `tools/skills_guard.py:393`), and its `backtick_subshell` pattern matches a backtick string that
   contains a command substitution (a dollar sign followed by a parenthesised command,
   `tools/skills_guard.py:386`). **Neither one looks for `${...}`.** A JavaScript template literal is
   not shell, but a backtick string carrying that shape is reported as an execution finding, so
   keep shell-looking text out of the source. Ordinary template literals are fine: the host's own
   `tools.plugin_guard.scan_plugin` returns `verdict: safe` for this repo (measured 2026-10-20), and
   the build's template literals are not among its findings. An earlier version of this rule said
   the scan "reads `${...}` as inline shell" — that was **false**, and it is retired. Keep the rule
   for the reason above, not for the reason it used to give.
6. **Import React hooks explicitly.** A hook that is used but not imported is a dead page, and the test
   harness cannot catch it if it stubs the hook for you (see §5).
7. **The backend `_hex` accepts only `#rrggbb` / `#rgb`.** Anything else must be normalised at the edge
   and the loss made visible, never silently dropped mid-pipeline.

## 4. Serena is available — use it for structure, and claim the slot first

Serena is a symbol-level code-intelligence server (LSP-backed) for this repo. Reach for it before
editing anything non-trivial: it answers "who defines this, who calls it" and finds the re-export
alias, the barrel file and the second render path that a text search cannot see.

```bash
SERENA=~/.local/bin/serena.exe        # v1.7.0; NOT on PATH, call it by path
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9123/mcp   # 406 = alive, 200 is NOT success
```

`406` is the alive signal: a bare `GET` is not a valid MCP request, so the server answers "not
acceptable" and that is exactly what a healthy server says. Start it detached, because it must
outlive the shell that started it, and clear `PYTHONPATH` first or it fails on pydantic:

```powershell
Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
Start-Process serena.exe start-mcp-server --transport streamable-http --port 9123 -WindowStyle Hidden
```

**One active project per server, shared by every concurrent session.** Call `get_current_config`
before symbol work; if the active project is not this repo, call `activate_project` with a
**Windows-native** path (`C:/DEV/hermes-theme-picker`) — an MSYS `/c/DEV/...` path fails. Then check
that returned paths really belong to this repo: a wrong-project answer reads like a normal answer.
Starting the server with `--project C:/DEV/hermes-theme-picker` (a real flag, from
`start-mcp-server --help`) avoids the race entirely — do that if you own the machine.

`.serena/` is recreated in the repo whenever a project is activated; it is gitignored, keep it so. A
cold LSP start takes about 90 seconds, and the first query can report an empty language-server list:
that is lazy-startup noise, not failure.

**CLI vs tools — they are not the same surface.** The CLI *manages* Serena:

```bash
"$SERENA" project create|index|index-file|health-check|is_ignored_path
"$SERENA" memories list|read|write|edit|delete|rename|check|initialize
"$SERENA" tools list|description          # lists and describes tools — it does NOT run symbol queries
"$SERENA" mode list|create|edit|delete ;  "$SERENA" context list|create|edit|delete
"$SERENA" config edit ; "$SERENA" memories check     # check = referential integrity across memories
```

Symbol work is done through the **MCP tools**: `activate_project`, `get_symbols_overview`,
`find_symbol` (its argument is `name_path_pattern`, not `name_path`), `find_referencing_symbols`,
`find_declaration`, `find_implementations`, `replace_symbol_body`, `replace_content`,
`create_text_file`, `rename_symbol`, `get_diagnostics_for_file`. If the server answers on 9123 but the
tools are missing from the catalog, drive it over HTTP yourself: a minimal streamable-http client needs
`initialize` (protocolVersion `2025-06-18`) -> `tools/list` -> `tools/call`, handling the
`Mcp-Session-Id` header and SSE frames. Do not restart the server to "fix" a catalog gap.

Two habits that pay: call `find_referencing_symbols` before changing any shared function, and treat
**clean diagnostics on a plain `.js` file as worthless** — with no `checkJs` and no node_modules, the
LSP reports "cannot find module" and says nothing about identifiers that do not exist. Only a runtime
harness can catch an undefined global here (§5).

## 5. How to verify anything

```bash
node --test tests/<name>.test.mjs      # one suite; WITHOUT a pipe, so you see the real exit code
node --test tests/*.test.mjs           # every JS suite
python -m pytest tests/ -q             # every Python suite; needs a venv with fastapi + pyyaml + pytest
python scripts/check-package.py        # package contract: version loci, entry points, tracked junk
python scripts/check-packs.py          # catalogue contract
python scripts/check-host-classes.py   # a class we use that the HOST stylesheet never generates
hermes plugins validate .              # the plugin admission gate (LOCAL ONLY: no PyPI package carries it)
rigour check --ci                      # quality gates (exit 1 = FAIL, 2 = no config)
```

**`node --test tests/` does not work — use the glob.** On Node 24.19.0 a bare directory argument
is treated as a MODULE path, and the run exits 1 with "Cannot find module '…\tests'". The glob form
`node --test tests/*.test.mjs` is the one that works, on every platform, because node expands the
pattern itself (node >= 21). It is also what CI runs.

**Run the Python suites with pytest, not unittest.** `tests/test_skin_contract.py`
imports pytest at module scope, and under `unittest` a pytest-style module loads and
runs ZERO tests — a green step that proves nothing. CI installs pytest for this reason.

**`check-host-classes.py` needs the Desktop app's compiled stylesheet** (auto-discovered
under `apps/desktop/dist/assets/*.css`; pass `--css '<glob>'` otherwise). It escapes
selectors the Tailwind way, so an unescaped `grep 'max-h-[87vh]'` is NOT evidence: it
returns 0 for a present class too. A class with no rule silently takes the browser
default — that is how a white pill, an invisible role colour and an unscrollable modal
all shipped. Anything that constrains layout or carries meaning is an INLINE STYLE.
**This gate is LOCAL-ONLY**: a GitHub runner has no Hermes Desktop build, so the script
exits 2 (UNVERIFIED) there. CI still runs it — it reports the UNVERIFIED state as a warning
rather than hiding it — and enforces the part it can without the host (§10).

Environment truths that change the answer:

- **`unset PYTHONPATH`** before repo Python or rigour. The Hermes shell exports its own site-packages,
  which shadows other virtualenvs.
- **Read rigour's LIVE output**, never `.rigour/last-scan.json` — the cached file lags and scores
  differently. The headline score is a **band, not a monotonic metric**: a HIGH finding has disappeared
  and the score has fallen. Report the finding LIST, which is diffable.
- **Name the gate you actually ran.** A recorded "exit 0" against a name that never ran is a fabricated
  green.
- The plugin loads from the LOCAL machine's `desktop-plugins/chroma/`. A changed build is invisible in
  Desktop until it is copied/reinstalled and Desktop restarts.

## 6. Pits we have already fallen into — do not repeat them

- **The test harness derives its stubs from the BUILD'S OWN import statements.** Never hand-stub a hook:
  a harness that stubbed `useRef` for a build that forgot to import it kept every suite green while the
  picker died on first render. Anything the build does not import must stay undefined in the harness.
- **A vm-context array fails `assert.deepEqual`** ("same structure but not reference-equal"). Round-trip
  it (`JSON.parse(JSON.stringify(value))`) or `Array.from` it before comparing.
- **A digest that flattens props onto the node lets a prop named `type` rename the element** — an
  `<input type="text">` digested as an element named `text`. Assign the element name after the props.
- **Complexity gates name the FIRST over-budget function in source order and truncate at five** — not the
  worst one. Never scope a refactor to the function the gate names; enumerate them yourself
  (this repo's checklist: a probe that replicates the gate's own counting rule).
- **Reducing cyclomatic complexity means MOVING branches, not hiding them.** Extraction to a helper only
  relocates the count unless the helper lands under budget; data tables and early returns are what
  actually reduce it. Never replace a `||` with `??` to dodge a counter.
- **Backend route order is load-bearing**: `POST /skins/rename` must be declared above `/skins/{name}`,
  or the literal path is captured as a name.
- **Writes are ordered, never atomic-by-luck**: the skin file lands first, then the provenance index.
- **Use the SYSTEM git** (`/c/Program Files/Git/cmd/git.exe`). The Hermes-bundled git silently no-ops
  network operations — it prints nothing, exits 0, and pushes nothing.
- **Commit message files need an explicit native path** (`-F C:/...`). `$TMPDIR` can be empty, and a
  failed `-F` leaves earlier staged work to leak into the next commit.
- **`write_file` refuses to overwrite a file it has not read in this task** (staleness guard). Read
  first, or write through a script.
- **Serena:** call `activate_project` with a Windows-native path before any symbol query, and keep
  `.serena/` gitignored. `find_symbol` takes `name_path_pattern`, not `name_path`.
- **`npm root -g` lies under the Hermes shell** — it reports the bundled node's directory.
- **A battery that prints only DERIVED counts hides its own failure.** A loop that greps
  `pass`/`fail` out of a test run, and discards the raw output, reported every suite failing with no
  numbers at all - and the discarded text was the only thing that could have said why. Print the raw
  output, or write it to a file and read it. A summary you cannot explain is worth less than nothing.
- **A background process starts in the scratch directory, not the repo.** `cd` explicitly in the
  command; a relative path or a glob will quietly resolve against the wrong tree.
- **Do not touch `rigour.yml` thresholds to pass a check.** If a finding is a false positive, adjudicate
  it in `docs/TASKS.md` with the evidence, as the existing entries do.

## 7. Parity discipline — how a change to a mapper or a card is proven

Behaviour-preserving work is proven, never asserted:

1. Pin the current behaviour FIRST (`tests/regenerate-scene-parity.mjs`,
   `tests/regenerate-theme-card-parity.mjs`). Run a generator ONLY when a change in the output is
   intended, and say so in the commit.
2. Change the code.
3. Re-generate and **diff**. Any difference is a behaviour change — fix the code, never the fixture.
4. Fault-inject the guard: break one value and confirm the test fails, then restore and confirm it
   passes. A guard that has never failed is not a guard.
5. Mind what a digest cannot see: the card digest records handlers as their presence (`[fn]`), not their
   behaviour, so structural parity does not prove a handler still works. That is why the manage row is
   asserted by INVOKING it — export, rename (Enter/Save/Escape), delete confirmation, the CLI badge — in
   `tests/theme-card.test.mjs`, and why those tests were fault-injected before being trusted.
6. Know what a CASE COUNT is worth: 27 cases in `tests/helpers/card-cases.mjs` yield 24 distinct
   digests, because the harness stubs `useState` (the rename and delete states are unreachable through
   the card) and three keys are scene handles other tests read by name. A case that cannot differ proves
   nothing; the file says which ones those are.

## 8. Delivery contract

- **Commits:** Conventional Commits. One concern per commit. Generated artifacts (`rigour-report.json`,
  `rigour-fix-packet.json`, `.rigour/`, `__pycache__/`) are gitignored — never commit them.
- **Identify the author per invocation** rather than relying on ambient config, e.g.
  `git -c user.name="<name>" -c user.email="<address>" commit`.
- **Report what you RAN**, with raw output, and state plainly what you did NOT verify. "Done" is a claim
  with a burden of proof: the acceptance step a user would run, run by you.
- **Research and review lanes are read-only.** Name a scratch path outside the repo for any file they
  must write; git is read-only for them (no stash/checkout/reset/add/commit); they may run tests but must
  not regenerate the build or edit the tree under review.
- **Never report a flow as working from its first green step.** Walk every step of the user's path.

## 9. Known limitations, deliberate and documented

- iTerm2 `.itermcolors` import is **refused by name** (a plist parser with no dependencies, plus a
  perceptual colour matrix, for a format with no Windows relevance) — a v1.1 candidate.
- VS Code themes that carry their palette through `include` are still **refused**; the refusal names the
  include target and explains that a single paste cannot read a second file. See `docs/TASKS.md` for the
  settled decision (reword, not resolve — resolving the include is deferred).
- Alpha in colour values is flattened to opaque, because the backend accepts only `#rrggbb`. About a
  fifth of real VS Code values carry alpha — see `docs/PLANS/VSCODE-MAPPING-RESEARCH.md`.
- Complexity and file-size debt is tracked, not hidden: `desktop/plugin.template.js` is far past the
  500-line gate, and the honest fix is splitting it.
- The "one-step install" claim (paste the repo URL into Desktop -> Plugins) is **being settled, not
  established**: it is published in `README.md` and printed by `scripts/regenerate.py` on every
  build, and it depends on the repo root being an agent package. Do not repeat it in a doc or a
  commit message until it has been re-proven on a real machine —
  `docs/REVIEWS/review-2026-10-20/review-F-packaging-gates.md` (F1, F2) holds the evidence.

## 10. Quality gates

`rigour.yml` is committed and is not to be weakened. The standing gates are complexity 10 per function,
500 lines per file, no TODO/FIXME, and the required docs files must exist. Rigour's own agent
workflow (recall -> scope -> check-pattern -> work -> review -> check) is preserved in
`docs/AGENT_INSTRUCTIONS.md` alongside the MCP tool notes. Current debt and every
adjudicated false positive (imports the loader provides, a two-argument `.then()` that IS the rejection
handler, prototype-pollution in pre-existing code) are recorded in `docs/TASKS.md` with the evidence.

### What CI runs, and what each job is allowed to decide

| Job | Gate | Fails the build when |
|:--|:--|:--|
| `test` (ubuntu/macos/windows) | `node --test tests/*.test.mjs`, `python -m pytest tests/ -q`, `check-packs.py`, `check-package.py` | a test, the catalogue contract or the package contract fails |
| `build-is-current` | `regenerate.py` + `generate-gallery.py`, then the committed tree must match what they produced | the committed build, the transports or `docs/gallery.html` differ from the generators — including a file the generator produced that was never committed |
| `contrast` | every text pair the plugin paints clears WCAG AA 4.5:1 | one painted pair drops below 4.5:1 |
| `rigour` | the whole `rigour check --ci` gate, against a PINNED finding set | the finding set moves in EITHER direction |
| `host-classes` | `check-host-classes.py` (host stylesheet) + the arbitrary-value inventory | a class we use has no rule in the host's stylesheet, or the inventory of arbitrary-value utilities moves |

Four facts about that table that are easy to get wrong:

- **The rigour job is a NO-REGRESSION gate, not a green gate.** `rigour check --ci` is RED at the pin
  and cannot be made green without weakening `rigour.yml`, which §3/§6 forbid: the file-size and
  complexity debt is tracked on purpose (§9), and the docs are over the limit by design. So the job
  pins the finding set it is allowed to see. A finding that is NOT in the pin fails the build; a
  finding IN the pin that is no longer reported ALSO fails the build, because the pin is then stale
  and must be updated in the same change that fixed it. Nothing is suppressed — rigour runs every
  sub-gate and the report is uploaded either way — and the pin can only shrink. It lives in
  `.github/workflows/ci.yml`.
- **The pin is measured on a CLEAN checkout, and the two views differ.** `style-drift` and
  `logic-drift` compare against a baseline under `.rigour/`, which is gitignored: on a fresh runner
  those gates build the baseline from the tree they are scanning and report nothing, while a
  developer with an old local `.rigour/style-baseline.json` sees five extra `style-drift` findings.
  The clean-checkout view at the pin is 20 findings (2 critical, 12 high, 5 medium, 1 low); a
  developer's working tree can show more, and uncommitted work adds its own. Only the clean-checkout
  view is what the job compares against. Measure it in a clean clone when you are reproducing a CI
  failure — and remember that any change which moves the finding set (a lane fixing a finding, a
  file crossing 500 lines, the review documents being committed) needs the pin updated in the SAME
  change. The failing job prints the set to copy.
- **The build-currency gate must see UNTRACKED files.** `git diff --exit-code` compares the index
  with the working tree and ignores them, so a committed transport that was deleted and regenerated
  came back as `??` and the old gate still exited 0 — a package missing a mode-locked transport
  shipped with CI green. The gate stages what the generators produced and diffs the INDEX.
- **The host-class gate is only half-verifiable on a runner.** Without the Desktop app's compiled
  stylesheet the script exits 2 (UNVERIFIED) and the job says so in a warning; what the job CAN
  enforce is the inventory of arbitrary-value utilities, because the host cannot have generated our
  literal. Adding one is a deliberate act, not an accident.

