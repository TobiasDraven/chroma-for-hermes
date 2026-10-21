VERDICT: HOLD

# Lane A — Desktop pane: runtime correctness
Review of `352c3c5ad86db06cc600c3555675e2baf0928e12` (branch `main`).

---

## 2. PIN, files read, line counts

**PIN: `352c3c5ad86db06cc600c3555675e2baf0928e12`**

Files read **at the pin** (extracted with `git show <sha>:<path>` into a scratch dir; the
working tree was confirmed byte-identical to the pin and was never the subject):

| File | Lines at pin | Read how |
|:--|--:|:--|
| `desktop/plugin.template.js` | 6263 | full read, in sections |
| `desktop/plugin.js` (generated) | 6263 | diffed against the template, line 165 inspected |
| `dashboard/plugin_api.py` | 2493 | read at the pin (`/import`, `/overrides/{scene}`, `_mint_transport`) |
| `docs/SPEC.md` | 122 | read (the contract I checked the code against) |
| `docs/PLANS/CHROMA-IMPLEMENTATION.md` | — | grepped (`ensureImportedSkinsLoaded` history) |

**The template and the build agree, and I proved it rather than assuming it.**
`diff desktop/plugin.template.js desktop/plugin.js` at the pin produces exactly **one**
changed line — line 165, `const SKINS = __SKINS_DATA__` → the injected 214,172-character
JSON catalogue. Every other line is identical, so **line numbers are the same in both
files** and every `file:line` below applies to the template *and* to the shipped build.
I also confirmed the working tree's `desktop/plugin.js` has the same MD5 as the pin's
(`805dc1a3f0cb02a40c8a76f1a67465d1`), which is why the repo's own harness — which loads
the working-tree build — is evidence about the pin.

**Host source read (read-only, outside the repo)**, because the axis is "what does the
plugin do to the host at runtime" and the host is the other half of that contract:
`apps/desktop/src/themes/context.tsx`, `user-themes.ts`, `backend-sync.ts`, `request.ts`,
`types.ts`, `presets.ts`; `apps/desktop/src/sdk/index.ts`; `hermes_cli/plugin_validate.py`;
`tools/plugin_guard.py`; `tools/skills_guard.py`.

---

## 3. What I actually ran vs what I only read

### 3.1 What I ran (raw results, exit codes)

| # | Command | Exit | Result |
|--:|:--|--:|:--|
| R1 | `"/c/Program Files/nodejs/node" --test tests/*.test.mjs` | **0** | `tests 266 / pass 266 / fail 0 / skipped 0`, duration 1721 ms |
| R2 | `"/c/Program Files/nodejs/node" --test tests/` (the form `AGENTS.md` §5 documents) | **1** | `Error: Cannot find module 'C:\DEV\hermes-theme-picker\tests'` — Node 24.19.0 treats a bare directory argument as a module path. **The documented command in AGENTS.md is wrong for the installed Node; the glob form is the one that works.** Flagging, not fixing (read-only lane). |
| R3 | `node --input-type=module -e "<inline>"` — loads the **pinned build** through the repo's own `tests/helpers/load-plugin.mjs` and calls the real parsers | **0** | See the table in F2 — it is the executed evidence for that finding |
| R4 | `python -c "from tools.plugin_guard import scan_plugin; scan_plugin(Path('C:/DEV/hermes-theme-picker'))"` (host source, read-only) | **0** | `VERDICT: safe` — 31 findings, **none** of them `inline_shell_exec` and **none** about template literals. Full list reproduced in §4 F12. |
| R5 | `HERMES_HOME=<scratch>/fakehome python -m pytest tests/ -q` (system python; `HERMES_HOME` pointed at a scratch dir, never the real `~/.hermes`) | **0** | `185 passed, 4 skipped, 9 subtests passed in 51.77s` — matches the brief's baseline |
| R6 | `git ls-tree -r -l <pin>` / `git diff <pin>` / `git show <pin>:<path>` | 0 | 538 tracked files; 5,721 KB of tracked blobs; largest `docs/chroma-banner.png` 1,383 KB |
| R7 | `diff` template vs build at the pin | 1 (differences found) | exactly one differing line (165) |
| R8 | `grep` sweeps over the pinned build: `fetch(`, `setInterval`, `setTimeout`, `addEventListener`, `new MutationObserver`, `XMLHttpRequest|WebSocket|sendBeacon|EventSource|import(`, `new Map()|new Set(` | 0 | 1 `fetch(` (line 875); 1 `setInterval`; 2 `setTimeout`; 1 `addEventListener` pair; 2 `MutationObserver`; **zero** other network primitives |

### 3.2 What I only read (never executed)

* The whole runtime of `ThemePicker` (4814–6136), `EditorModal` (4074–4387),
  `ModalShell`/`PackPickerModal`/`CategoryModal` (3891–4072), `FavoritesRail` (4393–4443),
  `ThemeCard` (4445–4607), `useActiveSkin` (2578–2644), `useModalA11y` (2820–2862),
  `applyScene`/`syncSceneToGateway` (2664–2757), `applyDesktopTheme` (1857–1923),
  the import parsers (486–905), the export path (1789–1814), the group builders
  (2352–2570), the override/editor plumbing (1025–1420, 3431–3659).
* The host's `ThemeProvider`, `resolveTheme`, `normalizeSkin`, `installUserTheme`,
  `ingestBackendSkin`, `requestTheme`.
* `hermes_cli/plugin_validate.py` (665 lines) — `_check_manifest_fields` (name/version/
  description), `_check_capabilities` (declared vs registered tools/hooks/middleware),
  `_check_security_scan` (critical → `dangerous` → **fail**; high → `caution` → pass with a
  warning; medium/low → `safe`).
* `tools/plugin_guard.py` / `tools/skills_guard.py` — the pattern set and `_determine_verdict`.

### 3.3 What I did NOT verify (stated plainly)

* **I never ran Hermes Desktop.** Every claim about host behaviour below is read from the
  host source at `apps/desktop/src/themes/*`, with the file and line cited. The *visible*
  consequence in a live window is therefore `UNVERIFIED`; the *code path* is not.
* I did not run `scripts/regenerate.py` (forbidden), `hermes plugins validate .`
  (forbidden and the local CLI is broken), or `rigour check --ci`.
* I did not re-measure the 11 light `status_bar_dim` skins' contrast ratios — that is a
  colour-science question outside this axis, and the repo's own measurement tooling is the
  authority for it.

---

## 4. Findings

### F1 — **blocker** — an imported or live-discovered skin is handed to Desktop's theme provider under a name the provider cannot resolve, and the provider answers by resetting the whole app to the default skin and persisting that

**File:line** — `desktop/plugin.template.js:1934` (in `syncDesktopState`, 1930–1940)
**Quoted:**
```js
1930: function syncDesktopState(name, mode, api) {
1931:   const target = api || desktopThemeApi
1932:   if (!target || typeof target.setTheme !== 'function') return false
1933:   try {
1934:     target.setTheme(name)
1935:     if (typeof target.setMode === 'function') target.setMode(mode)
```

**Failure mode.** `applyScene` (2735–2757) calls `syncDesktopState(scene.name, mode, api)`
for **every** scene — including skins that Desktop has never heard of. The host's
`setTheme` is not a "set this or leave it alone" door; it *coerces*:

* `apps/desktop/src/themes/context.tsx:60` —
  `const normalizeSkin = (name) => name && resolveTheme(name) && !RETIRED_SKINS.has(name) ? name : DEFAULT_SKIN_NAME`
  (`DEFAULT_SKIN_NAME = 'nous'`, `presets.ts:462`).
* `apps/desktop/src/themes/context.tsx:631-638` — `setTheme` does `const next = normalizeSkin(name)`,
  `setThemeNameState(next)` **and** `skinPref.assign(liveProfile(), next)`.
* `apps/desktop/src/themes/context.tsx:604-608` — the `applyTheme` effect repaints every
  root token whenever `paintedTheme` changes.

`resolveTheme` (`user-themes.ts:145-155`) resolves only four things: Desktop built-ins,
`$userThemes`, `$backendThemes`, and plugin `THEMES_AREA` contributions. Chroma
contributes **only its 88 shipped skins** (`plugin.template.js:6218-6230`); imported skins
and live-discovered skins are never contributed. And `$userThemes` is a nanostores atom
initialised **once at module load** from `hermes-desktop-user-themes-v1`
(`user-themes.ts:70`), mutated only by `installUserTheme`/`removeUserTheme`
(`user-themes.ts:79,95`) — never re-read. Chroma's `persistTheme` (922–930) is a raw
`localStorage.setItem`, so the theme it writes is **not** in the host's registry for the
rest of the session.

So, on the session where you import a theme:

1. `applyDesktopTheme` paints Chroma's palette into the root — correct, for one frame.
2. `setTheme('dracula')` → `normalizeSkin('dracula')` → **'nous'** → the provider
   repaints the entire app with the default skin and **persists `'nous'` as the profile's
   skin** (`skinPref.assign`).
3. The imported theme is gone from the UI, and the persisted appearance is now the default.

Two things make this exact rather than approximate:

* **Under the "This profile" (local) apply scope it never recovers.** The scope check in
  `syncSceneToGateway` (`plugin.template.js:2671`) returns before `config.set`, so the
  gateway never broadcasts the new skin, so `$backendThemes` never learns it, so
  `resolveTheme` keeps failing. The persisted skin stays `'nous'`.
* **Under "Everywhere" it half-recovers, and the half that recovers is the wrong half.**
  The `config.set` broadcast arrives later, `ingestBackendSkin` registers the skin and
  `$pendingSkinApply` drives `setTheme` a second time — but the palette that lands is the
  *backend's* 15-token round-trip of the import, not the imported palette, and only if the
  broadcast wins the race with the `setTheme` in step 2.

The host anticipated this exact hazard and shipped the correct door: `requestTheme`
(`apps/desktop/src/themes/request.ts:29-38`) — *"An unknown name is refused rather than
coerced. `setTheme` falls back to the default skin for anything it can't resolve, which
is right for a person picking from a list but wrong for code reacting to an event."*
Chroma uses `setTheme` anyway.

**Smallest correct fix.** In `syncDesktopState`, look the name up before handing it over,
and skip the provider when it is not there:

```js
function syncDesktopState(name, mode, api) {
  const target = api || desktopThemeApi
  if (!target || typeof target.setTheme !== 'function') return false
  // Desktop's setTheme COERCES an unknown name to the default skin and persists
  // it (themes/context.tsx:60,631-638). Only hand it a name it can resolve.
  const known = Array.isArray(target.availableThemes)
    && target.availableThemes.some(t => t && t.name === name)
  if (!known) return false
  ...
}
```
`useTheme().availableThemes` is `listAllThemes()` (`context.tsx:523-531`) — built-ins +
contributed + backend + user — so it is the availability check the host itself offers.
With that guard, Chroma's manual `applyDesktopTheme` paint stands for an imported skin
instead of being overwritten by Nous.

---

### F2 — **major** — the persisted record of an imported theme carries no marker the rehydrator filters on, so no import is ever rehydrated (three of the four advertised formats could never be, even if the marker survived)

**File:line** — `desktop/plugin.template.js:1826` (the filter), `:2039` (the overwrite),
`:636` / `:684` / `:770` (the parsers that never set the marker)
**Quoted:**
```js
1826:     if (t && IMPORT_SOURCES.indexOf(t.themePickerSource) >= 0) {
```
```js
2039:       if (!existing || existing.themePickerManaged || isLegacyPickerTheme(existing, theme)) {
2040:         // ...
2043:         stored[theme.name] = theme
```

**Failure mode.** `ensureImportedSkinsLoaded` (1821–1833) rebuilds the gallery's imported
skins from `hermes-desktop-user-themes-v1`, and it only accepts a record whose
`themePickerSource` is one of `['tweakcn','windows-terminal','base16','vscode']`
(1819). Two independent things guarantee that filter never matches:

1. **The boot write destroys the marker.** `importTweakcn` calls `persistTheme(theme)`
   (5165) — that record *does* carry `themePickerSource` for a TweakCN import — and then
   `applyScene` calls `persistThemesForBoot([theme])` (2740) on the **same key**. The
   guard at 2039 is `existing.themePickerManaged`, which the raw import sets to `true`
   (`tweakcnToDesktopTheme`, line 514) — so the boot write **replaces** the record with
   `sceneToDesktopTheme(scene)`, which has no `themePickerSource` (verified, R3).
2. **Three of the four parsers never set the marker at all.** `windowsTerminalTheme`
   (636), `base16Theme` (684) and `vsCodeTheme` (770) set `source:`; only
   `tweakcnToDesktopTheme` (515) sets `themePickerSource:`. `importTweakcn` puts
   `themePickerSource` on the **scene** (5177), never on the persisted record.

**Executed evidence (R3, against the pinned build through the repo's harness):**

```
--- themePickerSource on each parser output ---
windows-terminal   themePickerSource= undefined  source= "windows-terminal"
base16             themePickerSource= undefined  source= "base16"
vscode             themePickerSource= undefined  source= "vscode"
tweakcn            themePickerSource= "tweakcn"  source= undefined
--- sceneToDesktopTheme (what persistThemesForBoot writes) ---
keys: name,label,description,colors,darkColors,typography,themePickerManaged
themePickerSource on converted: undefined
```

So the filter at 1826 rejects a Windows Terminal, Base16 or VS Code record on its face,
and rejects a TweakCN record because the boot write has already overwritten it.

**What the user sees.** A theme imported yesterday is not in the gallery today. It is
still in the backend's provenance index (so `GET /skins` lists it and `owned[scene.name]`
is truthy) but it has **no card**, so from the Desktop it cannot be exported, renamed,
categorised or deleted — the manage row lives on the card. `docs/SPEC.md:35` lists
"F4 Import TweakCN, Windows Terminal, Base16/24, VS Code — shipped". Three of those four
formats cannot be re-found after a restart.

**Smallest correct fix.** (a) carry the marker through the conversion, e.g. in
`sceneToDesktopTheme` add `themePickerSource: scene.themePickerSource`, and (b) set
`themePickerSource` on the three parser outputs instead of `source`. Note (a) alone still
leaves the WT/Base16/VS Code records unmarked, and (b) alone still leaves the TweakCN
record overwritten — **both are needed**.

---

### F3 — **major** — the rehydration runs in a mount effect, but the list that consumes it is a `useMemo` computed before that effect and whose dependencies never change

**File:line** — `desktop/plugin.template.js:5128` (the effect), `:5139-5143` (the memo)
**Quoted:**
```js
5128:   useEffect(() => { ensureImportedSkinsLoaded() }, [])
```
```js
5139:   const { usable: allSkins, unusable: unusableSkins } = useMemo(() => {
5140:     const known = new Set(SKINS.map(s => s.name))
5141:     const imported = IMPORTED_SKINS.filter(s => !known.has(s.name))
5142:     return splitUsableSkins([...imported, ...SKINS, ...live.filter(...)])
5143:   }, [live, importedTick])
```

**Failure mode.** `useMemo` is evaluated during render; `useEffect` runs after the commit.
On the first render the memo computes `allSkins` from an **empty** `IMPORTED_SKINS`
(module-level, line 68). The effect then pushes the hydrated scenes into
`IMPORTED_SKINS` — a plain array mutation. No state changes, so React does not
re-render, and even if it did, the memo's dependencies have not changed:

* `importedTick` is written only by user-initiated async paths — `removeSkin` (5052),
  `renameSkin` (5087), `importTweakcn` (5197), `saveEditor` (5309), `foldDuplicate` (5407).
* `live` is written only by the `skin.changed` host event (`useActiveSkin`, 2602).

Neither moves on a plain page load. `useMemo` returns its cached value whenever the
dependency array is unchanged, so **the hydrated scenes are never listed** — the memo is
frozen at the pre-hydration value for the life of the mount.

This is independent of F2: even after F2 is fixed and the marker survives, the hydration
still would not reach the gallery.

**Smallest correct fix.** Hydrate *before* the memo can see an empty array, and make the
memo depend on the thing that changed. Either seed the state synchronously —
`const [imported, setImported] = useState(() => { ensureImportedSkinsLoaded(); return IMPORTED_SKINS })`
— or, keeping the effect, bump a counter in it and add that counter to the memo's deps:

```js
const [importedTick, setImportedTick] = useState(0)
useEffect(() => { ensureImportedSkinsLoaded(); setImportedTick(n => n + 1) }, [])
```

---

### F4 — **major** — a 404 from one route (`GET /schema`) retires the whole backend transport for the session, and the pane then tells the user the backend is not installed

**File:line** — `desktop/plugin.template.js:1259`
**Quoted:**
```js
1259:     if (isMissingRoute(e)) _rest = null
```

**Failure mode.** `fetchEditorSchema` (1245–1263) treats *any* 404 from `/schema` as
"the backend is not here" and nulls `_rest` — the single module-level transport used by
**every** backend call: `listOwnedSkins` (946), `listOverrides` (1018), `listPacks` (1520),
`listCategories` (1081), `putSkin` (1047), `putOverride` (1027), `dropOverride` (1036),
`importThemeIntoSkins` (932), `exportOwnedSkins` (999), the pack routes (1528–1545) and
the category routes (1110–1133). After that null:

* `hasGatewayBackend()` (958) returns `false`, so the pane renders the banner at 5969:
  *"Gateway-skin backend not installed… Install the Python half and restart Hermes to
  enable them."* — **the backend is installed; it is missing one route.**
* Every manage action now throws `BACKEND_MISSING_MESSAGE` and shows "The gateway half is
  not installed". Rename, delete, export, packs and categories all become unavailable.

The trigger is not exotic: the plugin's own `overrideFailureNotice` (1758–1765) tells the
user *"Restart Hermes to enable the editor… The routes mount when the Chroma backend is
imported, and a running backend is never re-imported"* — i.e. the plugin knows that a
backend installed during this session has not mounted its routes yet. In exactly that
state, the 404 is expected, and the plugin punishes it by killing everything else.

`isMissingRoute` (1742–1747) is also loose: it matches any error whose message contains
`not found` or `404`, so a plain "skin 'x' not found" is misread as a missing route and
produces the "Restart Hermes to enable the editor" message (1758–1765) for an ordinary
not-found.

**Smallest correct fix.** Stop retiring the transport for a route-scoped 404. Keep the
"no schema" answer in its own flag and let every other route keep working:

```js
} catch (e) {
  if (isMissingRoute(e)) _editorSchemaCache = null   // no /schema on this backend
  return null
}
```
(and tighten `isMissingRoute` to a status check rather than a message substring).

---

### F5 — **minor** — in the "By colour family" lens the gallery renders every built-in shelf, including the empty ones, each as a heading reading `(0)`

**File:line** — `desktop/plugin.template.js:6016` (the renderer), `:2519-2520` (the comment
that says otherwise), `:2529-2546`
**Quoted:**
```js
6016:                  groups.map((group, index) => {
```
```js
2519:  * E4 — the twelve built-ins keep their ids, titles and order; USER categories
2520:  * render as shelves AFTER them, so the familiar shelf never moves under the
```
and, at 2526-2527 of the same comment block: *"Empty groups are dropped by the caller,
so a category with nothing in it costs no vertical space."*

**Failure mode.** The caller does not drop them. `buildCategoryGroups` (2529–2546) returns
all twelve built-ins plus every user shelf, each with `scenes: scenes.filter(...)`, and
6016 maps **all** of them. With the full catalogue all twelve are non-empty (measured:
persimmon 8, apricot 5, amber 8, gold 8, lemon 4, fern 7, teal 8, cobalt 13, indigo 8,
violet 8, rose 7, neutral 10) — but as soon as a search narrows the gallery, the eleven
shelves that no longer match are still rendered, each as a heading like
`Persimmon (0)` above an empty grid. The comment states the opposite of what the code
does, so a future reader will trust the comment.

**Smallest correct fix.** In the renderer, drop the empty shelves:
`groups.filter(g => g.scenes.length).map(...)`. (The pack lens, `buildPackGroups` 2552–2564,
already only emits shelves that exist and needs no change.)

---

### F6 — **minor** — the "N theme(s) could not be drawn" warning re-fires on every unrelated change

**File:line** — `desktop/plugin.template.js:5147-5154`
**Quoted:**
```js
5147:   useEffect(() => {
5148:     if (unusableSkins.length) {
5149:       host.notify({
5150:         kind: 'warning',
5151:         message: unusableSkins.length + ' theme(s) could not be drawn and were skipped'
5152:       })
5153:     }
5154:   }, [unusableSkins])
```

**Failure mode.** `unusableSkins` is a fresh array every time the `allSkins` memo
recomputes (5139), and the memo recomputes whenever `live` or `importedTick` changes —
i.e. on every import, delete, rename, duplicate and every `skin.changed` event. The
effect therefore re-fires and the user gets the same warning toast again and again, long
after they have understood it. The `useMemo` identity is not a stable dependency.

**Smallest correct fix.** Depend on the count, not the array identity, and remember what
you have already said:
```js
const warnedRef = useRef(0)
useEffect(() => {
  if (unusableSkins.length && warnedRef.current !== unusableSkins.length) {
    warnedRef.current = unusableSkins.length
    host.notify({ kind: 'warning', message: ... })
  }
}, [unusableSkins.length])
```

---

### F7 — **minor** — the `applying` state is set and cleared inside one synchronous block, so the "applying" affordance on the card never engages

**File:line** — `desktop/plugin.template.js:5261-5266`, bound at `:4506`
**Quoted:**
```js
5261:     setApplying(scene.name)
5262:     try {
5263:       applyScene(scene, nextMode, setActive, desktopTheme)
5264:     } finally {
5265:       setApplying(null)
5266:     }
```
```js
4506:     disabled: applying === scene.name,
```

**Failure mode.** `applyScene` is synchronous — it paints, hands the switch to the
provider and *returns* the gateway-sync promise. So `setApplying(scene.name)` and
`setApplying(null)` land in the same React batch and React never renders the
intermediate state. `applying` is read in exactly one place (4506) and is therefore
always `null`. The card is never disabled, and a double-click fires two applies — two
queued `config.set` broadcasts to the gateway (the queue at `gatewaySyncQueue`, 143, is
serialised, so the second one is sent immediately after the first).

**Smallest correct fix.** Make the flag mean what it says — await the sync the apply
starts:
```js
const onApply = scene => {
  ...
  setApplying(scene.name)
  Promise.resolve(applyScene(scene, nextMode, setActive, desktopTheme))
    .finally(() => setApplying(null))
}
```
If the affordance is not wanted, delete `applying` and the `disabled` binding at 4506
rather than leaving a dead one.

---

### F8 — **minor** — the import path swallows the error from applying the theme it just imported

**File:line** — `desktop/plugin.template.js:5196`
**Quoted:**
```js
5196:       try { applyScene(scene, scene.modeSupport === 'dynamic' ? mode : scene.modeSupport, () => {}, desktopTheme) } catch (e) { }
```

**Failure mode.** If the paint or the provider hand-off throws, the failure is discarded
with no notice. The import then reports success (`importOutcomeNotice`, 5199) — "Imported
catppuccin" — while the app is still on the old theme. The user has no way to tell that
the import applied but the *theme* did not. (This line is also the only place the import
path calls `applyScene` with a no-op `setActive`; the active badge therefore only updates
because `useActiveSkin`'s `MutationObserver` (2588–2590) sees `data-hermes-theme` change.
That works, but it means the import depends on a DOM mutation as its source of truth.)

**Smallest correct fix.** Catch and say so:
```js
try { applyScene(...) } catch (e) {
  host.notify({ kind: 'error', message: 'Imported ' + (theme.label || theme.name) + ', but it could not be applied: ' + (e && e.message ? e.message : e) })
}
```

---

### F9 — **minor** — the category write shares the `managing` mutex with delete and rename but does not check it, so a delete clicked during a category write silently does nothing

**File:line** — `desktop/plugin.template.js:5645`, guards at `:5042` and `:5066`
**Quoted:**
```js
5645:     setManaging(name)          // assignSkinCategory — no `if (managing) return` guard
```
```js
5042:     if (managing) return        // removeSkin — early return, NO notice
5066:     if (!target || target === name || managing) return   // renameSkin — same
```

**Failure mode.** `managing` is a single string used as a global mutex over the whole
gallery. `assignSkinCategory` (5643–5661) sets it but never tests it, so a category
write and a delete can be in flight together; the delete then returns at 5042 with **no
message at all**. The user's click on "Delete" does nothing visible and they have no
reason to think why.

**Smallest correct fix.** Give the category write its own flag
(`const [categorising, setCategorising] = useState(null)`), or make the shared guard
loud:
```js
if (managing) { host.notify({ kind: 'info', message: 'Another skin operation is still running' }); return }
```

---

### F10 — **minor** — the preview's end announcement writes the same string every time, so only the first preview is ever announced

**File:line** — `desktop/plugin.template.js:5231`
**Quoted:**
```js
5231:     setAnnouncement('Preview ended.')
```

**Failure mode.** The pane's live region is `<div aria-live="polite" role="status">`
(5806). A live region announces a **change** of its text; writing the identical string
again changes nothing. The second and every later preview therefore ends silently for a
screen-reader user, while the sighted countdown (3067–3084) still ticks. The same pattern
appears at 5244 (`'Previewing ' + name`) and 4863/4866 (the favourite toast is sent
*twice* — once as an announcement and once as `host.notify`).

**Smallest correct fix.** Make the message change every time, e.g.
`setAnnouncement('Preview ended: ' + (lastPreviewName || 'theme') + '.')`, or append a
monotonic counter to the text.

---

### F11 — **minor** — the plugin writes Desktop's root tokens itself, which is the mechanism behind F1 and the thing `docs/SPEC.md` lists as a non-goal

**File:line** — `desktop/plugin.template.js:1857-1923` (`applyDesktopTheme`)
**Quoted:**
```js
1869:   root.style.setProperty('color-scheme', rendered)
1870:   root.dataset.hermesTheme = theme.name
1871:   root.dataset.hermesMode = rendered
1872:   root.classList.toggle('dark', isDark)
```
and, 1905–1907, a loop writing 25 `--theme-*` / `--dt-*` custom properties onto the same
element.

**Failure mode.** `applyDesktopTheme` mutates `document.documentElement` — the host's
root — on every apply: 25 CSS custom properties, the `dark` class and two `data-*`
attributes. `docs/SPEC.md:106-107` lists as a **non-goal**: *"Reaching into the app's
theming internals. Every difficult bug in this project came from the plugin trying to own
state the ThemeProvider owns."* This is that. It is also the direct cause of F1: the
plugin paints a palette the provider does not know about, so the two disagree, and the
provider wins on the next render. The plugin also appends a transient `<a>` to
`document.body` (1807–1812) for the export download — removed synchronously, so that one
is clean.

**Smallest correct fix.** None is small, and I do not think this should be refactored
blindly — but it should be *recorded* as the architectural reason F1 exists, and the
provider-first path should be the default for every theme the host can resolve, with the
manual paint kept only as the fallback for the ones it cannot (which is exactly the F1
fix, inverted).

---

### F12 — **minor** — the shipped package exceeds the admission scanner's file-count and single-file-size limits (it passes, but the plugin carries a 1.38 MB PNG and 538 tracked files)

**File:line** — package root; largest offender `docs/chroma-banner.png`
**Evidence (R4, the real scanner, run read-only against the plugin):**
```
VERDICT: safe
SUMMARY: hermes-theme-picker: safe — 31 finding(s) in execution, network, persistence, structural, supply_chain, traversal
 - medium | oversized_file | docs/chroma-banner.png : 0 | file is 1383KB (limit: 1024KB)
 - medium | too_many_files | (directory) : 0 | plugin has 568 files (limit: 400)
```
The tracked package at the pin is **538 files** (R6) — the 568 in the scan includes the
untracked `.serena/` cache — and **5,721 KB** of tracked blobs, so the 10 MB bundle limit
is *not* exceeded, but the 1,024 KB single-file limit is, by `docs/chroma-banner.png`
(1,383 KB). `docs/gallery.html` is a further 917 KB.

**Why this is minor and not a blocker:** `tools/skills_guard.py:949-952` —
`_determine_verdict` returns `dangerous` only for **critical**, `caution` for **high**,
`safe` otherwise; and `hermes_cli/plugin_validate.py:601-616` fails admission only on
`dangerous`. `medium` findings therefore pass. The measured verdict is **safe** and
admission is not blocked.

**Smallest correct fix.** Re-compress or drop `docs/chroma-banner.png` (and consider
whether a 917 KB `docs/gallery.html` belongs in an installable package), and prune the
tracked tree below 400 files. Neither is urgent; both are the kind of thing a public
catalogue reviewer notices before a security reviewer does.

---

### 4.1 The accepted items — my position on each

* **11 light `status_bar_dim` skins at 3.996–4.238:1.** Out of this axis, and I did not
  re-measure. The characterisation (WCAG AA large-text only) is consistent with the
  numbers quoted. **No objection.**
* **`stripJsonNoise` complexity 16.** Backend, known, recorded. **No objection.**
* **The template literals.** **The premise in the brief is wrong, and the truth is
  better than the brief claims.** I measured **25** `${` occurrences in the shipped
  `desktop/plugin.js` (24 real template literals + 1 inside the comment at line 5211), not
  20. I then ran the real admission scanner (R4): the verdict is **`safe`** and **not
  one** of its 31 findings is `inline_shell_exec`, or about template literals at all.
  The `inline_shell_exec` pattern in `tools/skills_guard.py:393` is
  `` r'!`[^`\s][^`\n]*`' `` — the *Skills* inline-shell auto-exec DSL (`!`cmd``), not
  `${…}`. There is no `${…}`-as-shell rule in the guard. **So the 24 literals are not an
  admission blocker and are not a security finding at all.**
  The real objection is narrower and it is the repo's own: `AGENTS.md` §3.5 says *"New
  picker code must not use template literals — the plugin catalog's security scan reads
  `${...}` as inline shell."* That rule's justification is false, but the rule is still
  binding, and **eight** of the 24 literals sit in code the rule covers — five in
  `ThemePicker` (2705, 2724, 2753, 5843, 6028) and three in `ThemeChip` (6171, 6186,
  6226). Either the rule is retired because its premise is false, or those eight are
  converted to concatenation. **Leaving a rule in `AGENTS.md` that the codebase violates
  in eight places, for a reason the repo has now proved false, is the part I would
  actually fix** — and it is a ten-minute, zero-risk change that also removes the scan
  noise from the conversation entirely. I would not hold the release for it.
* **`hermes plugins validate .` cannot be re-run.** Confirmed the constraint and worked
  around it by reading `hermes_cli/plugin_validate.py` (665 lines) and then running its
  security-scan step directly (R4). The checks are: manifest `name`/`version`/
  `description` present; `requires_hermes` spec parses; `config_schema` shape; declared
  vs actually-registered tools/hooks/middleware; built-in tool-name collisions; Python
  dependency declaration; the security scan; the desktop surface check; and an isolation
  audit. Chroma registers **no** tools, hooks or middleware (five area contributions and
  HTTP routes only), so the declared-capability diff is trivially satisfied. The security
  scan passes with verdict `safe`.
* **CI 4/4 green; JS 266/266; pytest 185 passed / 4 skipped.** **Re-verified:** R1
  (266/266, exit 0) and R5 (185 passed / 4 skipped / 9 subtests, exit 0) both reproduce
  the stated baseline exactly. The JS suite being green is *not* evidence against F1–F3:
  the harness (`tests/helpers/load-plugin.mjs`) stubs `useEffect` as a no-op (line 133)
  and `useMemo` as a direct call (line 134), so **the harness cannot observe effect
  ordering or memo staleness at all**, and `syncDesktopState` is tested only as a pure
  function against a stubbed `useTheme`.
* **Exactly one external `fetch`.** **Verified** (R8): one `fetch(` in the build, at
  line 875 (`await fetch(url)` inside `fetchTweakcnTheme`), user-initiated; and **zero**
  `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource` or dynamic `import(` in the
  whole build.
* **The two `MutationObserver` calls.** **Verified** (R8): line 2592 observes
  `document.documentElement` with `attributeFilter: ['data-hermes-theme']`, line 5134
  observes it with `attributeFilter: ['data-hermes-mode']`; both are `disconnect()`ed in
  their cleanups (2611, 5136). They **read** an attribute and write React state; they
  do not restyle, hide or click anything. **I do not think they violate the spirit of
  the catalogue rule.** The thing that *does* touch the host's chrome is
  `applyDesktopTheme` (F11), which writes 25 custom properties and the `dark` class onto
  `document.documentElement` — and it is not an observer, it is the paint. The brief's
  framing ("the catalogue rule names `document.body`") is beside the point: the rule is
  about not restyling core UI, and this plugin does restyle core UI — by hand, in
  JavaScript, on the host's root element. That is worth a deliberate decision, and the
  decision has already been made in code but not in the rule.

---

## 5. The embarrassing section — the three things that would embarrass us publicly in this surface

1. **"I imported a TweakCN theme and Hermes switched to *Nous* and forgot my pick."**
   This is F1, and it is the kind of bug that gets a video posted with the plugin's name
   in it. The user types `catppuccin` — the example the plugin's own input placeholder
   gives them (5964) — presses Import, and the whole app repaints with the default
   skin and writes `'nous'` into their profile. Worse, the *card strip in our own
   gallery* keeps showing the imported palette, so our UI is actively lying about what
   the app is about to look like. The failure is silent: the import reports success.
   And there is a second, sharper version of it: `catppuccin`, `everforest`, `solarized`,
   `github` and `classic` are **Desktop built-ins** (`presets.ts:444-459`), so importing
   the TweakCN preset named `catppuccin` produces a scene whose name resolves to the
   *host's* built-in — the app paints the host's catppuccin, our card shows the
   imported one, and the two palettes are different. Our own refusal list
   (`CORE_DESKTOP_THEMES`, 130) names six themes and knows nothing about the other six
   the host ships.

2. **"I imported it yesterday. Today the plugin has never heard of it."** This is F2 + F3.
   The import is a session artefact: the theme is in the backend's index but has no
   card, so it cannot be exported, renamed, categorised or deleted from the Desktop. The
   user is told the feature "shipped" in `docs/SPEC.md:35` for four formats, three of
   which can never be re-found. The uncomfortable detail is that this was *known* once
   already — `docs/PLANS/CHROMA-IMPLEMENTATION.md:594` records a previous crash in
   `ensureImportedSkinsLoaded` — and the fix that landed (`Object.values(...)`) fixed the
   crash and left the feature dead.

3. **"The plugin says the backend isn't installed, but it is."** This is F4. A 404 from
   one optional route (`/schema`) silently disarms rename, delete, export, packs and
   categories for the whole session, and the banner tells the user to install the Python
   half — which they already did. The user's next move is to go and install a thing they
   already have, or to file a bug against a backend that is running perfectly. That is
   the kind of support ticket that costs an afternoon.

---

## 6. Closing counts

**Total findings: 12** — **1 blocker** (F1), **3 major** (F2, F3, F4), **8 minor**
(F5, F6, F7, F8, F9, F10, F11, F12).

HOLD on F1 alone. F2 and F3 are the same user-visible symptom as each other (an imported
theme never returns to the gallery) and must be fixed together; F4 takes out the whole
manage surface whenever the backend is one restart behind.
