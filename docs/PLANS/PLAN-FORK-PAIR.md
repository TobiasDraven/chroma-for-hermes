# PLAN — forked skins revert from dark to light

Status: revised 2026-11-09 after review (verdict REQUEST-CHANGES; findings folded in).
Read with `AGENTS.md`. Never hand-edit `chroma/desktop/plugin.js` — it is generated.

## The report

The Captain, on the G15: skins he forked or edited revert from dark to light about
15–30 seconds after he applies them. Shipped skins do not.

## Root cause — three artefacts agree

1. **The host's converter ignores the pair.** `apps/desktop/src/themes/skin.ts`
   converts a Hermes skin with `skin.colors` only, into BOTH slots:
   *"A skin is single-mode, so both `colors` and `darkColors` get the converted
   palette."* `light_colors` and `dark_colors` are never read.
2. **We write the pair with the light palette in `colors`.**
   `duplicate_skin` (plugin_api.py:2113-2118) writes
   `colors: light`, `light_colors: light`, `dark_colors: dark`. That shape is
   correct for the TUI, which picks by terminal polarity — and unreadable to the
   Desktop, which takes `colors` and calls it both modes.
3. **We hand the Desktop that name.** An owned scene carries no
   `gatewayLightName`/`gatewayDarkName`, so `gatewaySkinNameFor` falls back to
   `scene.name`. `syncDesktopState` and `config.set('skin', …)` therefore name the
   single-mode file, and the Desktop repaints from its light `colors`.

The pane paints the right palette itself from its own catalogue, so the skin
looks right until the host next resolves that name — a `skin.changed`, a
`gateway.ready`, or its own watcher re-announcing the file it just saw move. That
is the delay, and it is why only forks and edits move: a built-in's gateway name
is `<id>-light` / `<id>-dark`, and those files already carry the matching palette
in `colors`.

Proof by inspection: `$HERMES_HOME/skins/dark-lcars-copy.yaml` holds
`colors.background: #f0f0f0` (light) and `dark_colors.background: #050510`.
Fed through step 1, that fork is a light theme in every mode.

## The fix — a per-mode gateway pair for every owned skin

The built-ins already answer this question: one single-mode skin per polarity.
Owned skins get the same treatment.

**Backend** (`chroma/dashboard/plugin_api.py`)

1. `_mint_owned_pair(name, light, dark)` writes `<name>-light.yaml` and
   `<name>-dark.yaml`, each `{name, description, colors: <that mode>}`. Only the
   modes the skin actually carries.
2. `duplicate_skin`, `put_skin` (in-place save) and `import_skin` mint the pair.
3. The index record for an owned skin gains
   `gateway: {"light": "<name>-light", "dark": "<name>-dark"}` (only real modes).
4. `list_chroma_skins` returns that `gateway` map on each row.
5. `delete_skin`, `rename_skin`, `delete_pack` and trash purge remove or rename
   the pair with the skin — an orphaned transport is a skin nobody can delete.
6. A mount-time reconcile `_ensure_owned_pairs()` walks the index once and mints
   any missing pair. Failure is logged, never fatal: a broken skin file must not
   stop the router mounting. This is what repairs the Captain's existing fork
   without him touching anything.

**Pane** (`chroma/desktop/plugin.template.js`)

7. Module map `OWNED_GATEWAY` (name → `{light, dark}`), filled by
   `listOwnedSkins()` from `row.gateway`.
8. `gatewaySkinNameFor` prefers, in order: `OWNED_GATEWAY` → the scene's own
   `gatewayLightName`/`gatewayDarkName` → `lightName`/`darkName` → `scene.name`.
   Every caller already routes through it, so this is the one seam.
9. `foldSavedSkin` copies `saved.gateway` onto the scene in BOTH branches.
10. `normalizeLiveSkin` reads the payload's own pair — `skin.light_colors ??
    skin.colors` and `skin.dark_colors` — instead of assuming one palette, and
    takes gateway names from `OWNED_GATEWAY`. This is the `skin.changed` path,
    i.e. the reported trigger, and today it builds a light-only scene.

**Scene-construction sites (all of them)**

| Site | Line (approx) | Needs |
|:---|:---|:---|
| `normalizeLiveSkin` | 2919 | pair from the payload + names from the map |
| `ensureImportedSkinsLoaded` | 2082 | nothing to pair (stored theme already pairs); names via map |
| `foldSavedSkin` | 1621 | `saved.gateway` |
| import flow (`importTweakcn`) | 5459 | names via map after the POST |
| `foldDuplicate` | 5737 | covered by `foldSavedSkin` |

No owned row becomes a scene directly, which is why the map is the seam.

**Repair ordering (review finding 4).** `_ensure_owned_pairs()` runs lazily inside
`list_chroma_skins`, once per process, guarded by a module flag and the index
lock, and wrapped so any exception is logged and swallowed: a broken skin file
must not block the router or the request. It completes before the first response,
so no client ever sees a row without `gateway`.

**Left alone on purpose**

- The bare `<name>.yaml` keeps the TUI pair shape (`colors` + `light_colors` +
  `dark_colors`). The CLI reads it correctly, and `/skin <name>` must keep
  working. The Desktop never gets that name from us again.
- Built-in transports (`theme-picker-<id>-<mode>`) are unchanged.

## The proof

- Python: duplicate writes three files; each pair file's `colors` equals its mode;
  delete and rename carry the pair; a second reconcile mints nothing; a broken
  file does not stop the route.
- Python: `list_chroma_skins` rows carry `gateway`.
- JS: `gatewaySkinNameFor` returns the mode variant from `OWNED_GATEWAY`, from
  scene fields, and falls back to `scene.name` only when neither exists.
- JS: `normalizeLiveSkin` builds a two-mode scene from a paired payload.
- The existing suites stay green: node 280/280, pytest 251 passed / 4 skipped.

## Deprecated

The claim "a skin file carries one palette" is true for the CLI and false for the
Desktop. Any future skin writer in this repo must mint the pair.
