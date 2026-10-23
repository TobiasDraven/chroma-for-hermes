# CHROMA-SUBDIR — move the shipped tree into `chroma/` and set `subdir: chroma`

Status: PLAN (not started) · Owner: Faris al-Faris · Date: 2026-10-23
Repo: `C:\DEV\hermes-theme-picker` (branch `main`, HEAD `f0ad054`)
Authorised by: Captain Tobias — "scout ahead, then create a plan, then implement A. subdir: chroma"

---

## 1. The problem

The host caps a plugin at **400 files**: `MAX_PLUGIN_FILE_COUNT = 400`
(`tools/plugin_guard.py:106`), and it scans **the whole cloned repo**, not the plugin
(`_walk` excludes only `.git`, `node_modules`, venvs and caches — `plugin_guard.py:33-35`).

Measured on this repo (2026-10-23):

```
$ git ls-files | wc -l
400                       # exactly at the cap -> ZERO headroom
```

The cap is a **medium** finding, so the verdict is `safe` and install is **not** blocked.
But one more file trips it, and every future theme pack makes it worse.

### Where the 400 files go

| Bucket | Files | KB | Read by the installed plugin? |
|:--|--:|--:|:--|
| `gateway-skins/` | 188 | 120 | **No — generated build output** |
| `skins-v2/` | 94 | 223 | **No — build input** |
| `docs/` | 41 | 2693 | No |
| `tests/` | 41 | 807 | No |
| `desktop/` | 2 | 773 | **Yes** |
| `scripts/` | 15 | 139 | No |
| `dashboard/` | 2 | 113 | **Yes** |
| root / `install/` / `.github/` | 17 | 140 | partly |

**282 of 400 files (70%) are never read by the installed plugin.**

### Why (verified, not assumed)

- `desktop/plugin.js` (499 KB) **embeds the whole catalogue** — `dragon-blood`,
  `alabaster` and `theme-picker-dragon-blood-dark` are all present inside it.
- The runtime never opens a skin file: the only skin calls are HTTP
  `_rest('skins/…')` to the backend.
- `dashboard/plugin_api.py` reads **nothing** from the repo. Every read resolves to
  `_skins_dir()` = `$HERMES_HOME/skins/` or its `.chroma/` sidecars. (The only mention of
  the repo tree in that file is a docstring at `:1344`.)
- `scripts/regenerate.py:_write_gateway_transport_skins` **generates** `gateway-skins/*.yaml`
  from the catalogue and **prunes** stale files.

So the skin files are build inputs that ship only because the installer clones the whole repo.

---

## 2. The mechanism (verified on this host)

`PluginCatalogEntry.subdir` is a real catalog field (`hermes_cli/plugin_catalog.py:85`),
and `install_identifier` becomes `repo#subdir` (`:100`).

The install chain scans **the subdir**, not the repo:

```
install_catalog_entry(entry, ref=entry.sha)
  -> _install_plugin_core(identifier = "repo#subdir")
  -> _clone_plugin_repo(tmp_clone, git_url, ref, subdir)
  -> tmp_target = _resolve_subdir_within(tmp_clone, subdir)      # plugins_cmd_install.py:383
  -> _scan_merged_tree(tmp_target)                               # :418
  -> _scan_plugin_tree(tmp_target)                               # plugins_cmd.py:241,188
  -> scan_plugin(tmp_target)                                     # :203
  -> _check_plugin_structure -> counts files under tmp_target    # plugin_guard.py:310-346
```

Proven in production: `accent-picker` (tier `official`) is
`repo: NousResearch/hermes-official-plugins` + `subdir: accent-picker`.

The Desktop already accepts every form (`resolvePluginGitUrl`,
`apps/desktop/electron/desktop-plugin-install.ts:49-105`):
`owner/repo/subdir`, `owner/repo#subdir`, `github.com/owner/repo/tree/<ref>/<subdir>`,
and `<git-url>.git/subdir`.

---

## 3. The design

**`chroma/` ships. Everything else stays at the repo root and is never scanned.**

### 3.1 Moves (`git mv`)

| From | To |
|:--|:--|
| `plugin.yaml` | `chroma/plugin.yaml` |
| `__init__.py` | `chroma/__init__.py` |
| `LICENSE` | `chroma/LICENSE` |
| `README.md` | `chroma/README.md` |
| `THIRD_PARTY_NOTICES.md` | `chroma/THIRD_PARTY_NOTICES.md` |
| `desktop/` | `chroma/desktop/` |
| `dashboard/` | `chroma/dashboard/` |
| `install/` | `chroma/install/` |

### 3.2 Stays at the repo root (dev-only, never shipped)

`scripts/` (15) · `tests/` (41) · `docs/` (41) · `.github/` (1) · `skins-v2/` (94) ·
`gateway-skins/` (188) · `VERSION` · `rigour.yml` · `AGENTS.md` · `CHANGELOG.md` ·
`.gitignore` · `.gitattributes`

### 3.3 New

`chroma/install/gateway-skins.json` — the 188 mode-locked transports as **one** file
(~120 KB). `install/install-gateway-skins.sh` expands it into `$HERMES_HOME/skins/`.

### 3.4 Result

```
scanned files:  400  ->  15        (3.75% of the cap)
scanned size:  ~5.0 MB -> ~1.0 MB  (under the 10 MB cap)
```

Headroom becomes **385 files** — and theme-pack growth no longer touches the cap at all,
because the skin files are not in the scanned tree.

### 3.5 Why `gateway-skins/` becomes one file

`install/install-gateway-skins.sh` does `BUNDLE_DIR=$(cd "$SCRIPT_DIR/.." && pwd)` and
copies `$BUNDLE_DIR/gateway-skins/*.yaml`. Once `install/` ships inside `chroma/`, an
installed copy has no repo root — so the 188 files cannot travel with it. They become one
generated file, expanded at install time. `python3` is present on any host that runs the
gateway (it runs the backend), which is the only host that runs this installer.

---

## 4. Phases (dependency-linked)

```
P1  layout        ──> P2  build tooling ──> P3  tests ──> P4  gates/CI ──> P5  docs/catalog
                        │                                        ^
                        └────────────────────────────────────────┘
```

| Phase | What | Depends on | Files |
|:--|:--|:--|:--|
| **P1** | Move the nine paths into `chroma/`; create `chroma/install/gateway-skins.json`; rewrite `install-gateway-skins.sh` to expand it | — | 9 paths, `install/install-gateway-skins.sh`, new `gateway-skins.json` |
| **P2** | Re-point `scripts/regenerate.py` (catalogue, gateway output, template, build output, the "repo root IS the package" message); retire the tracked `gateway-skins/` dir in favour of the single file | P1 | `scripts/regenerate.py` |
| **P3** | Fix every test that resolves a repo-root path (`tests/helpers/load-plugin.mjs:4`, the build-reading suites, the Python suites) | P1 | `tests/**` |
| **P4** | CI: working directories, `hermes plugins validate` invocation, the rigour **pinned finding set** (file paths change), the `build-is-current` job, the contrast job | P1, P2, P3 | `.github/workflows/ci.yml` |
| **P5** | Docs: README install URL + layout, `__init__.py` docstring, `AGENTS.md`, `docs/SPEC.md`, `docs/TASKS.md`, the catalog entry | P1 | docs |

### Critical path

**P1 → P2 → P4.** P3 and P5 can run beside them. P4 is last because its rigour pin can
only be written once P2/P3 have settled the real finding set.

---

## 5. Gates (each must be run, not assumed)

| Gate | Command | Expectation |
|:--|:--|:--|
| The cap is gone | `scan_plugin(chroma)` via the host guard | verdict `safe`, **~15 files** |
| Node suite | `node --test tests/*.test.mjs` | 276 pass, 0 fail |
| Python suite | `python -m pytest tests/ -q` | 241 pass, 4 skip |
| Package contract | `python scripts/check-package.py` | OK @2.9.1 |
| Pack contract | `python scripts/check-packs.py` | OK |
| Build reproducible | `python scripts/regenerate.py` then `git add -A && git diff --exit-code --cached` | empty diff |
| Rigour | `rigour check --ci`, set-delta vs clean HEAD | only expected path changes |
| Host classes | `python scripts/check-host-classes.py --css '<Desktop dist glob>'` | OK |

---

## 6. Traps (each one is a silent failure, not a loud one)

1. **`regenerate.py:707` `destination.mkdir(parents=True, exist_ok=True)`** — a missed
   re-point *creates* an empty `R/gateway-skins` and the prune at `:723-725` then leaves
   the committed tree stale. The local build looks successful.
2. **`regenerate.py:812` `out_path.parent.mkdir`** — a miss silently creates `R/desktop`.
3. **`regenerate.py:818-821`** prints "this repo root IS the plugin package … paste the repo
   URL" — false after the move, and CI quotes it (`ci.yml:110`).
4. **`tests/helpers/load-plugin.mjs:4`** — `new URL('../../desktop/plugin.js', …)` must
   become `../../chroma/desktop/plugin.js`. One choke point, but every suite depends on it.
5. **`scripts/check-package.py:21`** — `ROOT = parents[1]` is the repo root; it asserts
   `desktop/plugin.js`, `dashboard/plugin_api.py`, `plugin.yaml` exist. It must point at
   `chroma/` or it reports a broken package.
6. **`install/install-windows.ps1:54` / `install-macos.command:54-55`** — they copy the
   package by name; the source dir becomes `chroma/`.
7. **The rigour pin** (`.github/workflows/ci.yml`) names files by path — `desktop/plugin.js`
   becomes `chroma/desktop/plugin.js`. The pin must be re-derived from a real run.
8. **`__init__.py:3`** says "This repository root IS the plugin package" — false after the move.
9. **`VERSION`** is not copied by either installer, so it may stay at the root — but
   `check-package.py` compares it against `plugin.yaml`. Decide and keep it consistent.
10. **An existing install** came from a bare repo URL. With `subdir`, the Desktop derives the
    folder name from the subdir (`desktopPluginFolderName(gitUrl, subdir)`), so a re-install
    lands in a new folder. Document the one-line re-install.

---

## 6b. CORRECTION from the scout (read this before acting)

**The 400 cap is not a hard gate.** `MAX_PLUGIN_FILE_COUNT = 400` fires `too_many_files` at
**`medium`** severity (`plugin_guard.py:344-346`), and `medium`/`low` alone map to verdict
**`safe`** (`tools/skills_guard.py:949-952`), which installs with no prompt. At **exactly 400**
the finding does not even fire (`>` at `:344`). At 401+ the install still succeeds; the only
difference is one line in a scan report.

So the move is **headroom and hygiene, not a gate**. It is still worth doing, for reasons that
do hold:

- **Unlimited theme packs.** The skin files leave the scanned tree entirely.
- **A smaller clone.** A subdir install is a blobless sparse clone of `chroma/` only
  (`plugins_cmd_git.py:223-225`, `:245-246`) — the host's own docstring cites Hindsight
  (170 MB repo → 2 MB plugin folder) as the reason.
- **Users stop receiving `docs/`, `tests/` and `scripts/`.**

### Migration traps (live on this machine)

Local state measured by the scout:

```
~/.hermes/plugins/.install-metadata.json
  "chroma": {"pinned": false, "revision": "f0ad054…", "source": "https://github.com/TobiasDraven/chroma-for-hermes"}
~/.hermes/plugins/chroma/.git  present          (root-layout checkout)
~/.hermes/plugins/chroma/.hermes-catalog.json  absent
```

Because `.git` is present and there is no catalog sidecar, the current install takes the
**record path** → in-place `git pull`.

- **T1 (high) — never run `hermes plugins update chroma` after this move.** The pull brings a
  root with no `plugin.yaml`; `_read_manifest_for_install` returns `{}` without raising
  (`plugins_cmd_install.py:234-248`), `publish_plugin` replaces `plugins/chroma` wholesale with
  the pulled root, leaving `plugins/chroma/chroma/plugin.yaml`. `reconcileUnifiedDesktopHalves`
  then cannot find `plugins/chroma/desktop/plugin.js` and the ghost-prune removes
  `desktop-plugins/chroma` — **the picker vanishes from Desktop, and it never self-heals.**
- **T2 (medium) — a `--force` reinstall drops user files.** The carry hook only fires when
  `prior["source"] == source` (`plugins_cmd_install.py:406-413`); the source changes from `repo`
  to `repo#chroma`, so nothing is carried. Exposure on this machine is **none** (`git status`
  in `plugins/chroma` is empty); on a machine that has written state into the plugin folder it
  is silent data loss.
- **T3 (low)** — the repin preview full-clones instead of sparse. Slower, not wrong.
- **No folder rename.** The installed name is `manifest["name"]` = `chroma`
  (`plugins_cmd_install.py:385-386`), so the folder stays `<plugins>/chroma`.

### The safe migration

**Reinstall from the catalog after the entry exists — do not update:**

```
hermes plugins install chroma --force
```

That resolves to `repo#chroma`, sparse-clones, scans the subdir, and writes the record with
`source=…git#chroma` (`plugins_cmd_install.py:379,383,442-447`). From then on the sidecar routes
updates through the subdir-aware `repin_catalog_plugin` path and T1 cannot recur.

---

## 7. Decisions the Captain owns

1. **Subdirectory name** — `chroma/` (matches the install folder and the manifest name).
2. **Migration** — accept that an existing install lands in a new folder; I document it.
3. **`gateway-skins/` retirement** — stop tracking 188 generated files in favour of one
   generated file inside `chroma/install/`. This is a removal of a build artefact, reversible
   from the commit before it.
