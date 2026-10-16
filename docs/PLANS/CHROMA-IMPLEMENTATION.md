# Chroma — Implementation Tracker

**Source of truth for F1–F6.** Updated in the SAME commit as each feature, never afterwards.

Legend: `[x]` done · `[~]` in progress · `[ ]` not started · `[!]` blocked · `[-]` decided against

| # | Work | State | Commit |
|:--|:--|:--|:--|
| F0 | Surfaces regression guard | [x] | |
| 0 | Remove stale v2 leftovers | [x] | |
| N | Provenance index + `GET /skins` | [ ] | |
| F2 | CLI-capable badges | [ ] | |
| F1 | Delete / rename a skin | [ ] | |
| F3 | Export / import | [ ] | |
| F6 | Square-card picker UI | [ ] | |
| F4 | Import from more sources | [ ] | |
| F5 | Per-profile skins (spike, then decide) | [ ] | |
| ✓ | Review | [ ] | |

---

## F0 — Surfaces regression guard

**Why this is first.** A previous restructure deleted the route, sidebar entry,
statusbar chip, palette command and gateway sync, and every suite stayed green —
because nothing asserted those surfaces existed. The tests all pointed at
behaviour, and the surfaces are not behaviour.

`tests/surfaces-regression.test.mjs` registers the plugin against a recording
`ctx` and asserts:

- [x] `plugin.id === 'chroma'`
- [x] exactly one `ROUTES_AREA` entry, path `/chroma`, with a render function
- [x] exactly one `SIDEBAR_NAV_AREA` entry
- [x] exactly one `STATUSBAR_AREAS.right` entry with a render function
- [x] exactly one `PALETTE_AREA` entry (`chroma.open`)
- [x] >50 `THEMES_AREA` registrations, each with a name and colours
- [x] `host.request('config.set'` still present in the shipped build
- [x] `syncDesktopState` still present (the ThemeProvider handoff = the revert fix)
- [x] app-owned keys present: `hermes-desktop-user-themes-v1`, `hermes-boot-*`

**A failure here is a product decision, not a test to fix.** If a session
removes a surface, that session surfaces it to the Captain.

---

## 0 — Stale leftovers

- [x] `desktop/plugin.v2.js` removed
- [x] `desktop/plugin.v2.template.js` removed
- [x] `docs/V2.md` removed (it documented the abandoned design and told the reader
      to build a file that no longer exists)
- [x] gateway transport names left alone, per the Captain (`theme-picker-*`)

---

## N — Provenance index (foundation for F1/F2/F3) — DONE

**The gap.** Nothing currently records that a skin is ours. The importer writes
`<name>.yaml` and nothing else, so "delete the ones we created" has no honest
implementation — filename heuristics would eventually delete a user's own
hand-written skin.

- [x] Sidecar index at `<hermes home>/skins/.chroma/index.json`:
      `{ name: { source, label, importedAt } }`
- [x] Written atomically (`os.replace`), same discipline as the skin writer
- [x] The `.chroma/` subdirectory is invisible to `list_skins()` (top-level
      `*.yaml` glob, non-recursive) — **asserted by a test**, not assumed
- [x] `GET /api/plugins/chroma/skins` → `[{name, label, source, owned, cliCapable, missing}]`
- [x] Corrupt index reads as empty rather than raising — the safe direction, since
      "nothing is ours" makes F1 refuse to delete
- [x] `missing` is reported, not hidden: the index remembers a skin whose file is
      gone, so a vanished skin is explainable
- [x] Pure functions unit-tested with a temp `HERMES_HOME` — 13/13 in the Hermes venv

**Evidence:** `tests/test_plugin_api.py`, 13 tests, run with the Hermes venv python
(the module imports fastapi at load time, so the system python cannot import it).

---

## F2 — CLI-capable badges — DONE

A skin is **CLI-capable** iff its YAML sits at the TOP LEVEL of
`<hermes home>/skins/` — `list_skins()` globs `*.yaml` and is NOT recursive, so
a skin in a subdirectory is invisible to the CLI. That distinction is the
architecture, and the picker did not teach it.

- [x] `isGatewayCapable(scene)` — a scene is gateway-wide iff it carries
      `gatewayLightName`/`gatewayDarkName`. Computed in the Desktop plugin from
      data already in the build; no backend, no restart
- [x] `CliBadge` on every card: `CLI` (accent) vs `desktop` (dim), with a title
      tooltip carrying the real explanation
- [x] Imported themes are gateway-capable by construction (the backend writes
      their YAML at the top level)
- [x] Three tests, including one that asserts the SHIPPED catalog really carries
      transports (>50), so the badge cannot silently become all-desktop

**Evidence:** `tests/tweakcn-import.test.mjs` 16/16 (was 13). Guard 9/9,
persistence 30/30. Verification needs only "Reload desktop plugins" — no
backend, because this is catalog data plus a render.

---

## F1 — Delete and rename a skin — BACKEND DONE, UI OPEN

**Status is deliberately split.** The backend is complete and tested; the
user-visible part is not built yet, and calling this "done" on the strength of a
green test count is the exact failure this session has been recovering from.

### Backend — done

- [x] `DELETE /api/plugins/chroma/skins/{name}`
- [x] `POST /api/plugins/chroma/skins/rename` `{source, target, active}`
- [x] Guards, all mandatory and all tested: built-in name refused (the UNION of
      the Desktop theme names and the skin-engine built-ins — guarding with only
      one half mints a skin the other half refuses); name must be in the
      provenance index; the active skin refused; slug validated hard, because the
      name becomes a path
- [x] Delete MOVES to `.chroma/_trash/<name>-<µs>.yaml` — never unlink.
      Microsecond resolution because two deletes in the same second would
      otherwise collide and `os.replace` would silently destroy the first copy,
      defeating the recoverability it exists for
- [x] Rename rewrites the file, the `name:` field, the `description` (it carries
      the import label) AND the index label — a test caught the description, and
      the same staleness in the index would have made `GET /skins` name a skin
      that no longer exists
- [x] Rename returns `wasActive` — see the open half below
- [x] Route-order comment on `/skins/rename`, so a future session does not add
      `POST /skins/{name}` and shadow it

**Evidence:** `tests/test_plugin_api.py` 27/27 in the Hermes venv.

### UI — DONE

- [x] Per-card **Rename** / **Delete** actions, shown only on skins Chroma owns
      (the catalog scenes are bundled; the backend refuses anything without a
      provenance record)
- [x] **`wasActive` is consumed.** Renaming the active skin re-broadcasts
      `config.set {key:'skin', value:<new name>}` after the backend confirms.
      Without it the gateway keeps the old name, resolution fails, and the CLI
      silently drops to the default skin
- [x] Delete confirms inline first — it sits one click from the card the user
      meant to apply — and the confirmation says the skin goes to the trash
- [x] The actions live **outside** the card button: a button inside a button is
      invalid HTML, and the card is itself a button
- [x] No `window.confirm` / `window.prompt`: both are unreliable in the renderer,
      and a confirm that silently returns true is worse than none
- [ ] Skins imported before the provenance index existed have no record and
      cannot be managed until re-imported once. **Still to say in the UI** — they
      currently just show no actions
- [ ] Backend change ⇒ **full Hermes restart**, not a rescan

**Evidence:** backend 27/27; guard 9/9, importer 16/16, persistence 30/30;
`hermes plugins validate .` → Validation passed.

---

## F3 — Export / import

- [ ] `GET /api/plugins/chroma/export?name=<n>` → one YAML
- [ ] `GET /api/plugins/chroma/export` (no name) → zip of every owned skin + index
- [ ] Import accepts `.yaml` or `.zip`, validated through the same writer
- [ ] Export round-trips through the SAME schema the importer writes, so an
      export is also a hand-editable file — say so in the UI
- [ ] Renderer save path: check for a host file-save API before falling back to
      a blob + temporary `<a download>`

---

## F6 — Square-card picker UI

- [ ] `repeat(auto-fill, minmax(<n>, 1fr))`, `aspect-ratio: 1`
- [ ] Colour block + truncated label (`nowrap` / `hidden` / `ellipsis`)
- [ ] F2 badges on the card
- [ ] Actions (Export, Rename, Delete) in a per-card overflow menu
- [ ] Hover = `previewTheme`, leave = `clearThemePreview`, click = commit —
      DEBOUNCED, and cleared on unmount, or a 100+ card grid thrashes
- [ ] UI stays `jsx()`/`jsxs()` calls — never JSX syntax
- [ ] **A rendering change only.** It must not touch a single registration.

---

## F4 — Import from more sources

Parsers live in JS beside `parseCssTheme`, behind one `parseToColors(text, format)`
interface, reusing the backend writer so every source mints a REAL gateway skin.

- [ ] VS Code theme (`.json`, `colors` map)
- [ ] Windows Terminal scheme (`.json`)
- [ ] Base16 / Base24 (fixed 16-colour contract)
- [ ] iTerm2 (`.itermcolors`, XML plist — `DOMParser` is available)
- [ ] One fixture + one test per format; token mapping is a judgement call and
      lossy, so the mapping table is written down
- [ ] Each needs a mocked `fetch` in the harness if it fetches

---

## F5 — Per-profile skins (spike first, then decide)

**The honest problem.** Per-profile *gateway* skins are not achievable in-plugin:
`display.skin` is one global value and two profiles' CLIs can run at once, so the
CLI cannot show two skins at the same time.

- [ ] Spike: confirm there is no per-profile skin-resolution hook
- [ ] Implement the achievable design (per-profile DESKTOP theme, gateway
      broadcast made explicit) — or park it with the reason recorded
- [ ] State the limitation plainly. Do not fake parity.

---

## Review

- [ ] Surfaces guard passes — nothing amputated
- [ ] `hermes plugins validate .` still prints `Validation passed`
- [ ] Every feature has named evidence (test output or endpoint result), not a claim
- [ ] F5's limitation is written down, not glossed
- [ ] A diff read asking one question: **what did I delete, and did I tell the Captain?**

---

## Verification commands

```bash
python scripts/regenerate.py                                    # ALWAYS after editing the template
node --test tests/surfaces-regression.test.mjs                  # the safety net (9)
node --test tests/tweakcn-import.test.mjs                       # importer (13)
node --test tests/theme-persistence.test.mjs                    # apply/paint/gateway (30)
hermes plugins validate .                                       # catalog admission gate
```

**The tests load `desktop/plugin.js`, not the template** — an unregenerated
template is invisible to every suite. Regenerate or you are testing the past.
