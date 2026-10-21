VERDICT: HOLD

# Review Lane B — Backend and scripts: data integrity and hostile input

**PIN: `352c3c5ad86db06cc600c3555675e2baf0928e12`** (branch `main`, tree clean at review time; `git status --short` empty, `git rev-parse HEAD` = the pin).
The working tree was not the subject. No file in the repo was edited, created, deleted or staged; no git write command was run.

## 2. What I read (line counts by `wc -l`)

| File | Lines | Read |
|---|---:|---|
| `dashboard/plugin_api.py` | 2493 | **in full** (Read 1–2494) |
| `desktop/plugin.template.js` | 6263 | full file read via `read` in slices; **every** function in the import path read line-by-line (330–950, 1855–1924, 1990–2230, 3440–3480, 5100–5279, 5320–5390) + targeted greps over all 6263 lines |
| `desktop/plugin.js` | 6263 | not read line-by-line; used as the **build** (grep + a `node` extraction of the TweakCN functions) |
| `scripts/regenerate.py` | 826 | **in full** |
| `scripts/check-package.py` | 141 | in full |
| `scripts/check-packs.py` | 166 | in full |
| `scripts/classify-skins.py` | 399 | in full |
| `scripts/migrate-to-skins.py` | 177 | in full |
| `scripts/font-register.py` | 254 | in full |
| `scripts/generate-gallery.py` | 352 | in full (1–120, 240–352) |
| `scripts/check-host-classes.py` | 152 | in full |
| `scripts/analyse-palettes.py` | 252 | 1–60 + greps |
| `scripts/make-pastel-skins.py` | 174 | 120–174 + header |

Host source read (read-only, outside the repo) for the contract this plugin depends on:
`hermes_cli/skin_engine.py` (558 lines — the loader that decides whether a skin file is usable),
`hermes_cli/web_server.py` (the auth middlewares), `hermes_cli/web_server_dashboard.py`
(`_mount_one_plugin_api`, the mount gates), `hermes_cli/plugin_validate.py` (the admission
gate's shape), `tools/plugin_guard.py` + `tools/skills_guard.py` (the admission scanner),
`hermes_constants.py` (`get_hermes_home`).

## 3. What I actually RAN vs what I only READ

### 3.1 Ran (exact exit codes)

Every command below ran against **a scratch copy of the pin** (`git archive 352c3c5 | tar -x`
into `C:/Users/<user>/AppData/Local/Temp/opencode/…`) or against a **scratch `HERMES_HOME`**
(`tempfile.mkdtemp()`), never against the real Hermes home and never against the repo tree.

| Command | Exit | Result |
|---|---:|---|
| `python -m pytest tests/ -q` (in the repo, read-only) | **0** | `185 passed, 4 skipped, 9 subtests passed in 77.59s` — the brief's claim is TRUE |
| `python scripts/check-package.py` (scratch copy) | **0** | `OK: package contract holds at 2.9.0 (94 skins, 0 tracked files)` |
| `python scripts/check-packs.py` (scratch copy) | **0** | 94 skins, 7 packs, 12 categories, `OK: contract holds` |
| `python scripts/classify-skins.py --dry-run` | **0** | measured categories/packs/energy; 7 name-vs-colour conflicts reported |
| `python scripts/font-register.py` | **0** | `94 skins scanned; 20 families; 1 untabled (licence UNVERIFIED)` — output **byte-identical** to the committed `docs/FONTS.md` |
| `python scripts/generate-gallery.py` | **0** | `wrote docs/gallery.html: 94 cards` — byte-identical to the committed file |
| `python scripts/analyse-palettes.py --stdout` | **0** | wrote `docs/PALETTE-ANALYSIS.{json,md}` — **DIFFERENT bytes from the committed files** (see m8) |
| `python scripts/migrate-to-skins.py` (no `--write`) | **0** | printed **5 `MISMATCH` rows** (banner_dim drift on blueprint/bone-white/brutalist-concrete/chrome-rain/…) and still exited **0** (see m9) |
| `python scripts/make-pastel-skins.py` | **0** | wrote 10 files into `skins/` — byte-identical to the committed ones |
| `python scripts/check-host-classes.py --list` | **0** | `host sheets: 6 (399988 chars) · classes used: 134 · with no rule: 0` |
| `python scripts/regenerate.py` (scratch copy, repo inputs) | **0** | `Rebuilt … with 94 scenes from 94 bundled skins + 0 backend built-ins, 40 derived palettes and 188 gateway transports`; `diff` of `desktop/plugin.js` before/after = **IDENTICAL** → **idempotent** |
| `python scripts/regenerate.py mini-skins` (scratch copy, 1 skin in the dir) | **0** | **`gateway-skins/` went 188 → 2 files (186 deleted)**, `desktop/plugin.js` 497 543 → 285 641 bytes, success message printed. See **M3** |
| `python scripts/regenerate.py --out <elsewhere> mini-skins` | **0** | still pruned the repo's `gateway-skins/` and still rewrote `docs/DERIVED-PALETTES.md` in the repo. See **M3** |
| `node -e` (extraction of `slug` + `tweakcnUrl` from the built `desktop/plugin.js`) | **0** | URL matrix, see **M4** |
| 6 `python -c` probes against a scratch `HERMES_HOME` (module loaded exactly the way `tests/test_plugin_api.py` loads it) | 0 | the evidence for **M1, M2**, m1, m2, m3, m4 — outputs quoted verbatim in §4 |
| `python -c` → `tools.plugin_guard.scan_plugin("C:/DEV/hermes-theme-picker")` (host scanner, read-only) | **0** | **`verdict: safe`**, no high/critical findings. See §4 M4 and the note in §4.4 |
| `rigour check --ci` (scratch copy, so the repo's `rigour-report.json` was not touched) | **1** | `FAIL: 20 violation(s) Score: 37/100` — full list in §3.3 |

### 3.2 Read only (not executed)

`hermes plugins validate .` (per the brief: the local CLI cannot start) — I read
`hermes_cli/plugin_validate.py` instead and ran the scanner it delegates to
(`tools/plugin_guard.scan_plugin`). No `hermes` command was run; nothing was installed.

### 3.3 The rigour live output (scratch copy of the pin)

`FAIL: 20 violation(s) Score: 37/100` — `[LOW] file-size` (`dashboard/plugin_api.py` 2494,
`scripts/regenerate.py` 827, …), `[MEDIUM] AST_COMPLEXITY stripJsonNoise 16` ×2 (template and
build), `[MEDIUM] AST_COMPLEXITY_LIMIT_EXCEEDED` ×2, `[CRITICAL] hallucinated-imports` ×2,
`[HIGH] inconsistent-error-handling` (6 `except` strategies across 7 files),
`[HIGH] context-window-artifacts` ×2, `[HIGH] promise-safety` ×8, `[HIGH] phantom-apis`,
`[MEDIUM] side-effect-analysis` (Resource Leak).

**No `inline_shell_exec` and no `command_injection` finding.** The brief's premise that the
`${...}` literals are "flagged by the Hermes `security` scan as `inline_shell_exec`" is **not
borne out by either scanner on this pin** (see §4.4 for the argument).

### 3.4 What I could NOT verify — honest `UNVERIFIED`

* The real host's `desktop-plugins/chroma/` install (whether the shipped build on this machine
  matches the pin). I never pointed anything at the host-owned directory.
* Behaviour of the Electron renderer's `fetch` under the app's CSP and proxy settings — M4's
  impact analysis assumes a normal renderer `fetch` (no cookies cross-origin).
* Whether the Desktop's `ctx.rest` attaches the session token on every call. The **gate** is
  verified from the host source (`auth_middleware` → 401 without a valid
  `X-Hermes-Session-Token`/`Authorization: Bearer`); the SDK's transport is not.
* Multi-profile behaviour of M5 (the host's `?profile=` scope is verified to exist; that a
  client actually sends it is not — the Desktop's `ctx.rest` does not).

## 4. Findings

Severity key: `blocker` = irreversible user-data loss or a remotely-triggerable hole ·
`major` = silent corruption of user state, or a hostile-input hole that writes into the user's
real skin directory · `minor` = a real defect with a bounded blast radius.

---

### M1 — `major` — a failed rename restores the PATH but not the BYTES: the skin's `name:` no longer matches its filename

**file:line** `dashboard/plugin_api.py:762-776` (rollback at 766-770)

```python
        try:
            _write_index(index)
        except OSError as exc:
            # Put the file back under its old name: a rename the index never
            # learned about is a skin the picker can neither show nor delete.
            try:
                os.replace(dst, src)
            except OSError:
                pass
```

**Failure mode.** `_rewrite_skin_name(dst, source, target)` (line 745) has already rewritten
the file's `name:` field to the NEW name *before* the index write. The rollback moves the file
back to `src` but never restores its bytes, so the file ends up at `old-name.yaml` containing
`name: 'new-name'`. The error message ("the rename was rolled back") is then false about the
state on disk.

**Verified** (probe, scratch `HERMES_HOME`, `_write_index` monkey-patched to raise
`OSError(28, "No space left on device")`):

```
RENAME FAILED: HTTPException 500: the skin was moved but the provenance index could not be
updated ([Errno 28] No space left on device); the rename was rolled back.
AFTER  : "name: 'new-name'\ndescription: 'My old skin'\ncolors:\n  background: '#111111' …"
files  : ['old-name.yaml']
```

**Why it matters** (read against the host's `hermes_cli/skin_engine.py`):
`list_skins()` (line 411) keys a skin by the FILE's `name:` field
(`result.append({"name": data.get("name", f.stem), …})`), while `load_skin(name)` (line 424)
looks for `<skins>/<name>.yaml`. After the failed rename the CLI **lists a skin called
`new-name`** (no such file) and, when the user selects it, `load_skin("new-name")` finds
nothing and **falls back to the built-in default palette** with only a `logger.warning`. The
user's own theme silently stops being their theme. `load_skin("old-name")` finds the file but
builds a `SkinConfig` whose `name` is `new-name`. The picker (which reads the index) still
shows it under the old name, so the two surfaces disagree.

**Smallest correct fix.** Capture the original text before the rewrite and restore it in the
rollback (the file is already atomic, so this is a two-line change):

```python
    original = src.read_text(encoding="utf-8")   # before os.replace
    ...
    except OSError as exc:
        try:
            os.replace(dst, src)
            _atomic_write_text(src, original)    # <-- the missing half
        except OSError:
            pass
```
(and the same in the `_rewrite_skin_name` failure branch). A regression test should force the
index write to fail and assert the file's `name:` still equals the old name.

---

### M2 — `major` — a user-supplied label/description is written into the skin YAML with no control-character validation: a shared pack bundle can make the plugin write a skin file the Hermes engine cannot parse

**file:line** `dashboard/plugin_api.py:43-46` (the writer) with the four entry points at
`515` (`import_skin` description), `1500` (`put_skin` description), `1877`
(`duplicate_skin` label) and `2163` (`import_pack` bundle label)

```python
def _yaml_scalar(value: Any) -> str:
    """Emit one YAML scalar. Only plain strings reach here (hex colours, names,
    descriptions), so single-quoting with doubled quotes is sufficient."""
    return "'" + str(value).replace("'", "''") + "'"
```

**Failure mode.** The quoting doubles `'` but does nothing about **control characters**. A
label containing a newline, a `---` document marker or a NUL is written verbatim into the
skin YAML. The Hermes engine's loader (`skin_engine.py:369 _load_skin_from_yaml`) catches the
parse error and **returns `None` → the skin is silently skipped**: it does not appear in
`hermes /skin list`, and `load_skin()` falls back to the default palette. The plugin, meanwhile,
reports a **successful** import.

**Verified** (probe: a pack bundle with `label` values, imported through the real
`import_pack`, then parsed with the same `yaml.safe_load` the engine uses):

```
H doc marker | ENGINE PARSE ERROR: ScannerError … found unexpected document  -> THE ENGINE SKIPS THIS SKIN
   file: "name: 's-h'\ndescription: 'x\n---\nname: ''other'''\ncolors:\n  background: '#111111'\n…"
J null byte | ENGINE PARSE ERROR: ReaderError unacceptable character #x0000 … -> THE ENGINE SKIPS THIS SKIN
```

A plain newline (no `---`) is less dramatic but still corrupts the file: the engine folds the
injected lines into the `description` (`"evil name: 'pwned'"`) and the backend's own reader
`_read_skin_file` (line 1112) then mis-parses the file, reporting the skin's name as
`"'pwned'"` — the two readers in the same product disagree about the same file.

I checked whether the injection can corrupt the **palette** (worse than invisibility): it
cannot. Because `'` in the value is doubled, the attacker cannot terminate the scalar, PyYAML
folds the injected lines into the `description`, and the real `colors:` block that follows wins
PyYAML's last-key-wins rule. The damage is *invisibility and description corruption*, not a
wrong palette — and the `colors:`/`light_colors:` blocks are written after `description`, so
they always survive.

**Reachability.** A pack bundle is a **JSON document people share**; `label` is a free-form
string in it and is never checked (`_validate_bundle_skins`, line 2159-2164, only strips it).
The same hole exists for `req.label` (`duplicate_skin`) and `req.description` (`import_skin`,
`put_skin`) on the API. The Desktop's own TweakCN path does not reach it (it posts
`{name, theme}` and never a description), but the API and the pack path do.

**Smallest correct fix.** Refuse control characters at the boundary, in the one function that
writes YAML — a label/description is human text, so a rejection cannot lose real intent:

```python
def _yaml_scalar(value: Any) -> str:
    text = str(value)
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in text):
        raise ValueError("a skin label may not contain control characters")
    return "'" + text.replace("'", "''") + "'"
```
and turn that `ValueError` into a 400 at the four call sites (the two bundle paths already
have a validation function to hang it on).

---

### M3 — `major` — `regenerate.py` writes to three locations and only one of them is under the caller's control: the documented invocation deletes 186 of the 188 shipped transport skins with exit 0

**file:line** `scripts/regenerate.py:788-790` (destinations), `723-725` (the prune),
`813` (the non-atomic write)

```python
    derived_count = _write_derivation_report(catalog, Path(__file__).resolve().parent.parent / "docs" / "DERIVED-PALETTES.md")
    repo_gateway_skins = script_dir.parent / "gateway-skins"
    transport_count = _write_gateway_transport_skins(catalog, repo_gateway_skins)
```
```python
    for path in destination.glob("*.yaml"):
        if path.name not in expected:
            path.unlink()
```

**Failure mode.** The catalogue **source** is `argv[0]` (or the repo's `skins-v2/`), but the
transport **destination** and the derivation report are hardcoded to the repository. The
script's own docstring (lines 8-13) advertises `python3 regenerate.py [skins_dir]
[out_plugin_js]` with `skins_dir = <hermes home>/skins` — so the documented invocation points
the catalogue at a **different** directory while the prune still targets the repo.

**Verified** (scratch copy of the pin, `mini-skins/` holding one skin):

```
### run: regenerate.py mini-skins (the docstring's own usage) ###
Rebuilt … with 1 scenes from 1 bundled skins … 1 derived palettes and 2 gateway transports.
EXIT=0
--- gateway-skins now: ---
2
--- plugin.js size before/after ---
497543 plug-before.js
285641 desktop/plugin.js
```

186 tracked files deleted and the committed build rewritten, with a **success message and exit
0**. `--out` does not help: the same run with `--out <elsewhere>` still pruned the repo's
`gateway-skins/` and still rewrote `docs/DERIVED-PALETTES.md` in the repo.

Two further answers to the brief's question:
* **Does it write in place?** Yes — `out_path.write_text(plugin, encoding="utf-8", newline="\n")`
  (line 813) is a plain in-place write, not a temp-file + `os.replace`. A crash/OOM mid-write
  leaves a **truncated `plugin.js`** in the tree. The backend has `_atomic_write_text` for
  exactly this; the build tool does not use it.
* **Can it destroy a hand-edit?** Yes, in two places: any hand-edit to `desktop/plugin.js` is
  discarded (by design — the template is the source of truth, per AGENTS.md §1), and **any
  hand-added file in `gateway-skins/` is deleted** by the prune, because the prune's
  "expected" set is derived only from the catalogue.
* **Is it idempotent?** **Yes** — verified: rebuilding from the repo's own inputs produced a
  byte-identical `desktop/plugin.js` and left `gateway-skins/` at 188 files.

**Smallest correct fix.** Tie the prune destination to the catalogue/output, and refuse to
prune a directory that is not the build's own:

```python
    gateway_dir = Path(argv[2]) if len(argv) > 2 else (out_path.parent / "gateway-skins")
    …
    if gateway_dir.resolve() != (script_dir.parent / "gateway-skins").resolve():
        print("refusing to prune a directory outside the build", file=sys.stderr); return 1
```
plus write the build through a temp file + `os.replace`, and make the derivation report
follow `--out` (or a new `--report`).

---

### M4 — `major` — the TweakCN import fetches **any** http(s) URL the user pastes, while the UI and the error text say "TweakCN"

**file:line** `desktop/plugin.template.js:845-860` (`tweakcnUrl`), fetch at `875`

```javascript
  if (!/^https?:\/\//i.test(ref)) return `${TWEAKCN_BASE}${slug(ref)}.json`

  const bare = ref.split(/[?#]/)[0].replace(/\/+$/, '')
  // Already a registry endpoint - hand it through untouched.
  if (/\/r\/themes\/[^/]+$/i.test(bare)) return ref
  if (!/^https?:\/\/(www\.)?tweakcn\.com\//i.test(bare)) return ref
```

**Failure mode.** The "already a registry endpoint" test is **not host-anchored** — it matches
any URL whose path ends in `/r/themes/<something>` — and the next line returns **any**
non-tweakcn URL unchanged. The result is that the app will issue a request to a host the user
never intended, while every message says TweakCN ("TweakCN did not return a preset for
`<url>`", "TweakCN request failed: …").

**Verified** (the real functions extracted from the built `desktop/plugin.js` and executed):

```
"https://evil.example/r/themes/x.json"            -> "https://evil.example/r/themes/x.json"
"https://evil.example/anything"                   -> "https://evil.example/anything"
"http://127.0.0.1:8740/api/plugins/chroma/skins" -> "http://127.0.0.1:8740/api/plugins/chroma/skins"
"http://169.254.169.254/latest/meta-data/"        -> "http://169.254.169.254/latest/meta-data/"
"https://tweakcn.com.evil.example/x"             -> "https://tweakcn.com.evil.example/x"
```

**The slug path is safe, and the brief's SSRF question deserves the precise answer:** a
non-URL input can never escape the base — `slug()` reduces every non-`[a-z0-9]` run to `-`:

```
"catppuccin"              -> https://tweakcn.com/r/themes/catppuccin.json
"../../etc/passwd"        -> slug "etc-passwd"
"..\\..\\windows\\system32" -> slug "windows-system32"
"file:///C:/Users/<user>/secret.txt" -> slug "file-c-users-x-secret-txt"
"//evil.example/x"        -> slug "evil-example-x"
```
So there is **no path traversal and no local-file read**; the exposure is the HOST, and only
for a URL the user typed (the fetch is behind an Import button).

**Bounded impact, stated honestly:** the request carries no credentials cross-origin
(`fetch(url)` with default `credentials: 'same-origin'`), the response is only used to derive
colours (the backend re-validates every colour as `#rgb`/`#rrggbb`), and `file://` is refused
by the slug path. The real costs are (a) the user's machine contacting a host the UI
mislabels, (b) a **status oracle** for an internal URL in the error text, and (c) a beacon.

**Smallest correct fix.** Refuse a non-TweakCN host instead of passing it through, and show
the host that will be contacted:

```javascript
  if (!/^https?:\/\/(www\.)?tweakcn\.com\//i.test(bare)) {
    throw new Error('only a tweakcn.com preset can be imported from a URL')
  }
```
(the same check must be applied to the `/r/themes/` branch, which must be host-anchored too).

---

### m1 — `minor` — `DELETE /packs/{slug}?withSkins=true` trashes skins Chroma does **not** own

**file:line** `dashboard/plugin_api.py:2466-2485`

```python
            for member in members:
                member_name = str(member)
                if _is_unsafe_name(member_name):
                    continue
                target = _skins_dir() / f"{member_name}.yaml"
                if not target.is_file():
                    index.pop(member_name, None)
                    continue
                …
                os.replace(target, trashed)
```

**Failure mode.** `delete_skin` refuses anything without a provenance record ("Both
operations act only on skins Chroma owns"); this path takes the pack record's `members` list
on trust and moves **any** matching top-level skin to the trash, then pops its index entry.

**Verified** (probe: a hand-written `my-own-skin.yaml` not in the index, named by a
hand-written pack JSON):

```
before: ['my-own-skin.yaml']
delete_pack(withSkins=True) -> {'ok': True, 'slug': 'my-pack', 'removedSkins': ['my-own-skin']}
after : []
trash : ['my-own-skin-20261020-161959-672798.yaml']
```

**Blast radius.** The pack record is Chroma's own JSON, so the exposure needs a hand-edited
(or externally supplied) pack file. The file is **moved, not unlinked** — it is recoverable
from `<skins>/.chroma/_trash/`. The sibling inconsistency: if `_write_index_or_500` fails
after the members were trashed (line 2486), the skins are already gone from the CLI while the
500 says the index could not be updated; and if `path.unlink()` (2489) fails afterwards, the
pack record survives with its members already trashed.

**Smallest correct fix.** Check ownership before trashing, exactly as `delete_skin` does:

```python
                if not isinstance(index.get(member_name), dict):
                    continue   # not ours: leave the user's own skin alone
```

---

### m2 — `minor` — one non-UTF-8 skin file 500s `GET /export` (all) and `GET /skins/{name}` with an unhandled `UnicodeDecodeError`: one bad file blocks exporting every skin

**file:line** `dashboard/plugin_api.py:806` and `1122`

```python
        return path.read_text(encoding="utf-8")
```
```python
    for raw in path.read_text(encoding="utf-8").splitlines():
```

**Failure mode.** `UnicodeDecodeError` is a `ValueError`, **not** an `OSError`, so the
`except OSError` guards in `_authored_scene` (1169) do not catch it, and there is no guard at
all in `read_one`/`_read_skin_file`. The index and the packs are read leniently
(`except (OSError, ValueError)`, lines 186/974/1030) — the **skin files** are not.

**Verified** (probe: one owned skin whose file was written in latin-1):

```
=== GET /export (all) ===   FAILED: UnicodeDecodeError 'utf-8' codec can't decode byte 0xe9 in position 29
=== GET /export (one, the good one) ===  ok, count= 1
=== GET /skins/{bad} ===      FAILED: UnicodeDecodeError …
```

**Blast radius.** The exception escapes the endpoint → a bare 500 with a traceback in the
log. It does not take the process down, and the other skins are unaffected — but "export all"
is impossible while one file is mis-encoded, and `POST /packs/export` (which calls the same
`_read_skin_file` via `_skin_palettes`) dies the same way for the whole pack.

**Smallest correct fix.** Treat an unreadable skin file as a per-file error, not a crash:

```python
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise HTTPException(500, f"the skin file {path} is not readable UTF-8 ({exc})")
```
and in `export_skins`'s "all" branch, collect the failures and report them alongside the
files that did export.

---

### m3 — `minor` — the editor's light-mode merge base is `colors`, but the editor **displays** `light_colors`: a save silently replaces a divergent light palette

**file:line** `dashboard/plugin_api.py:1493` (write) vs `1405` (read)

```python
        base_light = existing.get("colors") if isinstance(existing.get("colors"), dict) else {}
```
```python
    light = data.get("light_colors") if isinstance(data.get("light_colors"), dict) else colors
```

**Failure mode.** `GET /skins/{name}` shows the pane the `light_colors` palette, but
`PUT /skins/{name}` merges the pane's edits over **`colors`** and then writes the result into
**both** `colors` and `light_colors`. For a skin whose two maps differ, the light palette the
user was looking at is replaced by the shared one on the first save.

**Verified** (probe: an owned skin with `colors: {background:#111111, ui_accent:#00ff00}` and
`light_colors: {background:#222222, ui_accent:#ff0000, selection_bg:#333333}`):

```
GET shows light: {'background': '#222222', 'ui_accent': '#ff0000', 'selection_bg': '#333333'}
AFTER PUT, file:
colors:      {background: '#111111', ui_accent: '#00ff00', ui_text: '#ffffff'}
light_colors:{background: '#111111', ui_accent: '#00ff00', ui_text: '#ffffff'}
```
The user's light palette (`#222222`, the red accent) and the `selection_bg` role are **gone**.

**Blast radius.** Narrow in practice: every writer in this backend emits `light_colors ==
colors` (`import_skin` 519, `duplicate_skin` 1879-1880, `import_pack` 2362-2363, `put_skin`
1503-1504), so the divergence only exists in a hand-authored or legacy file.

**Smallest correct fix.** Use the same source the reader uses:

```python
        base_light = existing.get("light_colors") if isinstance(existing.get("light_colors"), dict) else base_colors
```

---

### m4 — `minor` — a non-string colour value is silently replaced by a default instead of being refused, contradicting `_hex`'s own contract

**file:line** `dashboard/plugin_api.py:428`

```python
            if value is None or not isinstance(value, str):
                continue
```

**Failure mode.** `_hex`'s docstring (lines 397-405) promises "A value that IS supplied but is
not a hex colour is an error, not a fallback: silently substituting a default would hand the
gateway a skin whose palette contradicts what the user imported." `_validate_colors` skips
every non-string, so the promise is never kept for a number, a list or a boolean.

**Verified** (probe: `theme={"colors":{"background":123456,…}}`):

```
numeric skin colors -> #000000  (the caller sent 123456)
```

A 200 OK, and a palette that silently disagrees with the request — exactly what the
docstring says must not happen.

**Smallest correct fix.** Refuse it, as the docstring already promises:

```python
            if value is None:
                continue
            if not isinstance(value, str):
                raise HTTPException(400, f"invalid colour for '{key}': {value!r} is not a hex colour")
```

---

### m5 — `minor` — `HERMES_HOME` is captured at import time, so in a multi-profile host the plugin API writes to the launch profile's home even for a `?profile=` request

**file:line** `dashboard/plugin_api.py:29-34`

```python
HERMES_HOME = None
try:
    from hermes_constants import get_hermes_home  # documented way to resolve <hermes home>
    HERMES_HOME = Path(get_hermes_home())
```

**Failure mode.** `hermes_constants.get_hermes_home()` is **context-local**
(`get_hermes_home_override()` reads a ContextVar) and the host mounts the plugin router with
`dependencies=[Depends(_plugin_route_secret_scope)]` (`web_server_dashboard.py:1041`), which
establishes exactly that context for the request's profile. But the plugin module is imported
**once**, and `HERMES_HOME` is frozen at that moment, so a request scoped to another profile
still reads and writes the **launch profile's** `skins/` directory.

**Blast radius.** Misplacement, not loss: an import scoped to profile B lands in profile A's
skins directory. The Desktop's `ctx.rest` does not send `?profile=`, so this needs a
profile-aware client to reach.

**Smallest correct fix.** Resolve the home per request instead of at import:

```python
def _home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:
        return Path(os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes")))
```
and use `_home()` in `_skins_dir()` / `_index_path()`.

---

### m6 — `minor` — the override boot-mirror's write result is ignored: the user is told "Override saved" even when the mirror write failed, and the override is then lost at the next boot

**file:line** `desktop/plugin.template.js:5334` (call) with `2013-2026` (the writer)

```javascript
      writeOverrideMirror(name, effectiveOverride)
```

**Failure mode.** `writeOverrideMirror` returns `false` on a storage failure (quota exceeded,
restricted storage) and the return value is discarded, so the success notice
("Override saved … now uses your colours") is shown unconditionally. The backend holds the
override, but the **boot mirror** (`chroma-overrides-v1`) does not — and the mirror is what
`register()` reads synchronously at startup, because the host's `register()` may not await.
The user's edit therefore silently reverts to the shipped palette at the next restart.

**Blast radius.** The comment at 2010-2012 acknowledges "a failure costs the next boot its
override" — but the user is never told, and the failure is invisible until a restart.

**Smallest correct fix.** Surface it:

```javascript
      if (!writeOverrideMirror(name, effectiveOverride)) {
        host.notify({ kind: 'warning', message: 'Saved, but the boot cache could not be written — the override may not survive a restart' })
      }
```

---

### m7 — `minor` — two gate scripts die with a traceback on one malformed skin YAML instead of reporting a failure

**file:line** `scripts/check-packs.py:71`, `scripts/classify-skins.py:57`

```python
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
```

**Failure mode.** Neither call is wrapped. A malformed skin file in `skins-v2/` raises
`yaml.YAMLError` (or `KeyError: 'name'` at `classify-skins.py:58`) and the script exits with
a **traceback** rather than the `FAIL …` line the script's own docstring promises ("Exits 1
on the first broken invariant, printing every failure it found"). `regenerate.py` gets this
right (`_load_v2_skins` raises `ValueError`, and `main` prints
`ERROR: … refusing to replace <out>` and returns 1) — the two gate scripts do not.

**Blast radius.** Developer-facing only; the exit code is still non-zero, so CI would still
fail — but the output is unreadable, and `classify-skins.py` (which **rewrites every file in
`skins-v2/`**) would die *after* having loaded half the catalogue, with no statement of what
it had changed.

**Smallest correct fix.** One `try/except` per file, appending to `failures`:

```python
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as exc:
            failures.append(f"{path.name}: not valid YAML ({exc})"); continue
```

---

### m8 — `minor` — the committed `docs/PALETTE-ANALYSIS.{json,md}` is stale (it describes a 109-skin catalogue; the shipped build has 94) and no gate keeps it current

**file:line** `scripts/analyse-palettes.py:146-147` (outputs) — the artifact is
`docs/PALETTE-ANALYSIS.json` / `.md`

**Failure mode.** Re-running the generator against the pinned build produces a **different**
document from the committed one (verified by diffing a re-run against the pinned tree: only
`docs/PALETTE-ANALYSIS.json` and `.md` differ). The committed file says `skins | 109`; the
current build has 94. Three research documents cite the stale numbers as their input
(`docs/RESEARCH/COLOUR-TAXONOMY.md:4` "109 cards × up to 6 signature roles × 2 modes",
`docs/RESEARCH/CATEGORY-NAMES.md:4` "109 skins", `docs/PLANS/CHROMA-PACKS.md:98`).
CI's drift check covers only `desktop/plugin.js`, `gateway-skins` and
`docs/DERIVED-PALETTES.md` (`.github/workflows/ci.yml`), so the analysis artifact can rot
silently — and it did.

**Smallest correct fix.** Add the two files to CI's drift list (`git diff --exit-code -- …
docs/PALETTE-ANALYSIS.json docs/PALETTE-ANALYSIS.md`) and regenerate them once; or delete
them if the research that cites them is done.

---

### m9 — `minor` — `migrate-to-skins.py` reports five projection mismatches and still exits 0

**file:line** `scripts/migrate-to-skins.py:145`

```python
    print(f"records={len(records)} checked={checked} mismatched={len(mismatched)}")
```

**Failure mode.** The script's whole purpose is to prove that the v1→v2 projection reproduces
the shipped build; it prints `MISMATCH` rows and returns **0**. Only `--write` is gated
(`REFUSED to write: projection does not match the shipped build`, line 163). The five
mismatches are all `banner_dim` drift (`blueprint`, `bone-white`, `brutalist-concrete`,
`chrome-rain`, …) — the v1 files and the current catalogue disagree about one role, which is
exactly the kind of drift a gate exists to catch. It is a dev script, so the blast radius is
"a maintainer believes the migration is clean when it is not".

**Smallest correct fix.** `return 1` when `mismatched` is non-empty, whatever the mode.

---

### m10 — `minor` — `TweakcnColorMap` is dead code

**file:line** `dashboard/plugin_api.py:330-349`

```python
class TweakcnColorMap(BaseModel):
    background: str
    ui_text: str
    …
```

**Failure mode.** It is defined and never referenced anywhere in the repo (grep over
`*.py`, `*.js`, `*.mjs`: one hit, the definition). It reads like the validated shape of the
TweakCN payload — but nothing validates against it: `import_skin` accepts an open
`dict[str, Any]` and validates the colours with `_validate_colors` instead. A reader will
believe the import boundary is stricter than it is.

**Smallest correct fix.** Delete it, or use it as the `ImportRequest.theme` type so the
declared shape is the enforced one.

---

### m11 — `minor` — a skin name longer than the filesystem's limit is a 500, not a 400

**file:line** `dashboard/plugin_api.py:464` (and `_SLUG_RE`, line 313)

```python
    target = skins_dir / f"{name}.yaml"
```

**Failure mode.** `_SLUG_RE` bounds the alphabet but not the **length**. A 300-character slug
passes `_is_unsafe_name`, then `tempfile.mkstemp(prefix=path.name + ".")` fails with
`OSError: [Errno 36] File name too long` (Windows) or `ENAMETOOLONG` (Linux) → the import
returns a 500 "could not write the skin file" instead of a 400 that names the offending
input. No file is created (mkstemp fails before anything is written), so this is a wrong
status code, not corruption.

**Smallest correct fix.** Bound the name at the guard:

```python
    if len(clean) > 64:
        raise HTTPException(400, f"{field} is too long (max 64 characters)")
```

---

### m12 — `minor` — the TweakCN fetch has no timeout and no response-size cap

**file:line** `desktop/plugin.template.js:875-882`

```javascript
  const r = await fetch(url)
  if (!r.ok) throw new Error(`TweakCN request failed: ${r.status}`)
  …
    json = await r.json()
```

**Failure mode.** No `AbortSignal`, no `Content-Length` check, no streaming cap. A host that
never answers leaves the import pending forever — the Import button stays `disabled` and
reads "Importing…" (line 5966) until the app is restarted, because `setBusy(false)` only
runs in the `finally` of a settled promise. A host that answers with a 500 MB body is
buffered whole into the renderer's heap by `r.json()`.

**Smallest correct fix.** A timeout and a size cap:

```javascript
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 15000)
  try { const r = await fetch(url, { signal: ctl.signal }) ; … } finally { clearTimeout(timer) }
```

---

### m13 — `minor` — the paste-import path has no size bound: a large paste blocks the renderer

**file:line** `desktop/plugin.template.js:827-843` with `563-592` (`stripJsonNoise`)

```javascript
function parseImportedTheme(text) {
  const t = (text || '').trim()
```

**Failure mode.** The import box is a plain `<textarea>` with no `maxLength`, and
`stripJsonNoise` walks the string **character by character** in JS on the UI thread. A
multi-megabyte paste therefore blocks the renderer for as long as it takes to scan it (the
known complexity-16 function is a lint debt, not a bug — it is O(n) and terminates — but it
is O(n) **on the UI thread**).

**Smallest correct fix.** Bound the paste at the boundary:

```javascript
  if (t.length > 256 * 1024) throw new Error('that paste is too large to import (256 KB max)')
```

---

### 4.4 On the accepted items the brief asked me to argue

* **`stripJsonNoise` complexity 16 — accepted, and I agree.** I read it (template 563-592): it
  is a single-pass scanner with a bounded inner loop, O(n), and it terminates on every input
  (unterminated strings/comments are simply consumed to the end). It is lint debt, not a
  defect. The *real* issue attached to it is m13 (it runs on the UI thread with no size cap).
* **The 20-24 `${...}` template literals — accepted, and the brief's premise does not hold.**
  I ran the host's own admission scanner, `tools.plugin_guard.scan_plugin`, over the pinned
  tree: **`verdict: safe`**, with **no high or critical findings** and no
  `inline_shell_exec`/`command_injection` finding; `rigour check --ci` likewise reports no
  shell finding. On the merits I enumerated all 24 occurrences in `desktop/plugin.js`: font
  stacks, a hex literal, the TweakCN URL join, error messages, badge counts and a theme id.
  **None** reaches a shell, `eval`, or an HTML sink — the build contains no `innerHTML`, no
  `dangerouslySetInnerHTML` and no `eval`/`new Function` (grepped, zero hits). Two of them
  interpolate **external** data (the remote font name at 502, the URL at 867) but both land
  in React-escaped text, not in markup. The honest rule is not "no template literals" but
  "no external data into an unescaped sink"; as written, the repo's blanket ban generates
  false positives without buying anything.
* **`hermes plugins validate .` cannot be re-run here — agreed, and I read the source
  instead.** `hermes_cli/plugin_validate.py` delegates the security step to
  `tools/plugin_guard.scan_plugin` (line 601-615), which I ran directly (§3.1). The plugin
  passes that gate today.
* **CI 4/4 green / pytest 185 passed, 4 skipped — confirmed by running them** (§3.1).
* **Exactly one external `fetch`** — confirmed: `fetch(` appears once in the whole build
  (`desktop/plugin.js:875`), and it is behind the Import button.
* **"The backend writes to the user's real vault/config directory by design"** — agreed; this
  review judges the *safety* of those writes, and §5 does exactly that.

## 5. What the user can lose — every piece of user data, and whether a bug or a crash can destroy it

| # | User data | Where | Can a bug/crash destroy it? |
|---|---|---|---|
| 1 | **The user's own skin files** (hand-written or imported) | `<hermes home>/skins/*.yaml` | **No irreversible destruction.** Nothing in the backend ever `unlink`s a pre-existing skin file: the only `unlink` calls on a skin path (580, 1909, 2409, 2415) target files the same call just wrote, as a rollback. Deletion **moves** to `<skins>/.chroma/_trash/<name>-<stamp>.yaml` (688, 2475) — recoverable by hand, though there is no "restore" UI and **no purge**, so the trash grows forever. The two ways a skin can be *lost from the CLI* (not lost from disk): **M1** (a failed rename leaves `name:` ≠ filename → the CLI lists it under a name it cannot load and falls back to the default palette) and **M2** (a crafted label makes the file unparseable → the engine skips it). Both leave the file and its colours on disk. |
| 2 | **The provenance index** | `<skins>/.chroma/index.json` | **No.** Every write is `_atomic_write_text` (temp + `os.replace`). A corrupt index is never silently overwritten: `_read_index_for_update` raises `IndexUnreadableError` and **copies the bad file aside** first (`index.json.unreadable-<stamp>`), so the provenance survives even a truncated write. The only writer that can lose a record is one that *reads* corruptly — prevented by the strict read path. |
| 3 | **The override store** | `<skins>/.chroma/overrides.json` | **No.** Same discipline: strict read before write, atomic write, and the transport-mint failure path restores the previous record (1631-1634). The one residue: if the *second* of two transport mints fails, the already-minted one keeps the new palette while the record is rolled back (1627-1637) — a transient pane/CLI disagreement, not a loss of the record. |
| 4 | **The category store** | `<skins>/.chroma/categories.json` | **No.** Atomic writes; the pack-import transaction restores the exact prior bytes on failure (`_restore_categories`, 2250). |
| 5 | **The pack records** | `<skins>/.chroma/packs/*.json` | **Almost no.** The record is written **last** inside the import transaction, so a failure before it rolls the skins and the index back and leaves the old record intact. One asymmetry: `delete_pack` unlinks the record **after** trashing the members; if the unlink fails, the members are already gone from the CLI but the record survives (2451-2491). |
| 6 | **The trash** | `<skins>/.chroma/_trash/*.yaml` | **It is the safety net** — and nothing purges it, so a deleted skin stays recoverable forever (until the user deletes it by hand). |
| 7 | **The imported-theme cache** | `localStorage: hermes-desktop-user-themes-v1` | **Yes, partially.** `readStoredThemes()` (913-920) returns `{}` on a parse error, and `persistTheme()` (922-930) then writes a map containing only the new theme — **every previously imported theme is dropped from the cache** (the gateway skin files survive, so the skins themselves are not lost; the picker stops listing them as imported). The same swallow-on-failure pattern hides a localStorage quota error: `persistTheme` returns `true` even when `setItem` threw. |
| 8 | **The override boot mirror** | `localStorage: chroma-overrides-v1` | **Yes, one override at a time (m6).** A failed mirror write is invisible; the next boot resolves the shipped palette. The mirror is best-effort by design, but the user is not told. |
| 9 | **Favourites** | `localStorage: chroma-favourites-v1` (whatever the key is) | **No.** `writeFavorites` (2176-2183) writes the whole cleaned list and swallows failures; a failed write loses the **last toggle only** (the in-memory list still holds it for the session). |
| 10 | **The appearance selection** | `localStorage: hermes-desktop-theme-v2`, `-mode-v1`, `-profile-themes-v1`, `-profile-modes-v1` | **No.** Single-key writes, failures swallowed; a failed write loses the selection for the session. |
| 11 | **The pack list / apply scope / card shape / group mode** | `localStorage: chroma-packs-v1`, `chroma-apply-scope-v1`, `chroma-card-shape-v1`, `chroma-card-size-v1`, `chroma-group-mode-v1` | **No** — the same best-effort pattern; a failed write loses the preference for the session. |
| 12 | **The boot hints** | `localStorage: hermes-boot-background`, `hermes-boot-color-scheme` | **No** — regenerated on every apply. |
| 13 | **The Hermes config** (`display.skin` etc.) | the host's `config.yaml` | **Not Chroma's to write.** The desktop calls `host.request('config.set', …)`; the host owns the file and validates the value. Chroma's backend never touches the config. |
| 14 | **The shipped catalogue in the repo** | `skins-v2/*.yaml` (94), `gateway-skins/*.yaml` (188) | **Yes — M3.** A `regenerate.py` run with a positional catalogue directory **deletes 186 of the 188 transport skins** and rewrites the committed build, exit 0. Recoverable only by `git checkout` (the files are tracked). `classify-skins.py` also rewrites all 94 `skins-v2/*.yaml` in place, non-atomically, with no backup. |
| 15 | **The shipped build** | `desktop/plugin.js` (497 KB) | **Yes — M3**: rewritten from a different catalogue, and the write is **not atomic** (line 813), so a crash mid-write leaves a truncated build. Recoverable by re-running (idempotent — verified). |
| 16 | **The derivation report** | `docs/DERIVED-PALETTES.md` | **Yes — M3**: rewritten on every run, regardless of `--out`. |
| 17 | **The palette analysis** | `docs/PALETTE-ANALYSIS.{json,md}` | **Already stale (m8)** — describes 109 skins; the build has 94. |
| 18 | **The trash / disk** | `<hermes home>` | The trash is never purged, so deleting skins grows the home directory without bound. |

**Summary of the data-loss verdict: nothing in the backend can irreversibly destroy user
data.** Every destructive path either writes atomically, moves to a recoverable trash, or
rolls back. The two ways a user's theme can be *lost from the CLI* while remaining on disk
are **M1** (a failed rename misnames the skin) and **M2** (a crafted label makes the file
unparseable) — and both are cheap to fix.

## 6. The embarrassing section — the three things that would embarrass us publicly in this surface

1. **A shared pack bundle can make Chroma write a skin file that Hermes cannot read — and
   Chroma reports success.** "Import this pack I found" → the skin is in the user's real
   `skins/` directory, the picker shows it as an owned skin, the toast says "imported", and
   `hermes /skin list` does not show it. A user filing "Chroma imported a theme and the CLI
   says it doesn't exist" is a bug we cannot answer with "works on my machine", because the
   trigger is a **label containing `---`** in a JSON file. (M2 — verified with the engine's
   own parser.)
2. **A rename that fails on a full disk leaves the user's skin wearing the wrong name, and
   the error message says the opposite.** The user is told "the rename was rolled back"; the
   file is back at the old path with the new name inside; the CLI lists a theme that cannot
   be loaded and silently paints the **default** palette. "Your theme disappeared and the
   app says it saved it" is the worst sentence in this product. (M1 — verified.)
3. **`python scripts/regenerate.py <anything>` deletes 186 shipped files and rewrites the
   published build, prints a success message and exits 0.** The script's own docstring
   documents that exact invocation. CI's drift check would catch the consequence, but only
   *after* the deletion is committed by someone who believed the tool. A build tool that
   silently prunes a directory you did not name is the kind of thing that ends up as a
   "why did 188 skins disappear" thread. (M3 — verified: 188 → 2 files in one command.)

*(Runner-up: the TweakCN import will fetch `https://evil.example/anything` and then tell the
user "TweakCN did not return a preset for https://evil.example/anything" — which is at least
honest about the URL, but not about the trust model.)*

## 7. Closing line

**Total findings: 17 — 0 blockers, 4 major (M1 rename-rollback byte loss, M2 YAML control-character injection, M3 `regenerate.py` prune outside the output path, M4 unconfined TweakCN URL fetch), 13 minor (m1–m13).**
No finding causes irreversible user-data loss; every destructive path in the backend is atomic,
recoverable or rolled back. The four majors are each a handful of lines to fix and are all
reproducible with the probes quoted above.
