# PLAN — answer catalog review 1 (PR #149767)

Status: drafted 2026-11-10. Review recorded verbatim in `docs/REVIEWS/PLUGINREVIEW1.md`.
Read with `AGENTS.md` and `DELEGATEDAGENTS.md`. Never hand-edit `chroma/desktop/plugin.js`.

## The ask

Upstream reviewed Chroma at `494770ba` and requested changes. Three blocking items,
two recommended. Their verdict is the gate on listing: fix, re-pin our entry's
`sha:`, comment on the PR, and they review the delta from `494770ba`.

Their one-line diagnosis: **the Desktop bundle does by hand what the theme
provider already does.** The backend is explicitly called clean and needs nothing.

## What blocks, in their words

| # | Blocking | Their requirement |
|:--|:--|:--|
| 1 | The hand-rolled painter | Delete the root-token writer and the direct `setTitleBarTheme` / `setNativeTheme` calls. Switch themes only through `useTheme().setTheme/setMode`, or `requestTheme` outside React. |
| 2 | Core's localStorage | Stop writing every app-owned key (`hermes-boot-*`, `hermes-desktop-theme-v2`, `hermes-desktop-mode-v1`, `hermes-desktop-profile-*-v1`, `hermes-desktop-user-themes-v1`). Keep only `chroma-*`. File an upstream issue for the boot-resolution gap instead. |
| 3 | `tweakcnUrl` | Accept only `https://tweakcn.com/…` (or www), reject every other host and `http:`, and rebuild `/r/themes/<slug>.json` from the slug. |
| 4 | Recommended | Read theme name and mode from `useTheme()`, not a `MutationObserver` on `documentElement`. |

## The shape of the work — one file, therefore serial

Every item is in `chroma/desktop/plugin.template.js`. Two lanes cannot work it in
parallel without a merge fight. Do it as one campaign with four stages, each
landable on its own:

1. **W3 — `tweakcnUrl` allowlist.** Smallest, no dependency, proves the branch.
2. **W4 — `useTheme` instead of observers.** Also small; removes state duplication.
3. **W1 — delete the painter.** Needs the SDK contract confirmed first.
4. **W2 — delete the app-key writes.** The largest behaviour change; needs a
   decision on what replaces the boot cache.

Stages 1-2 can ship as one pull request. Stages 3-4 are the delta the reviewer
actually cares about; ship them together, since W1 without W2 still writes boot
keys the provider already writes.

## Progress — 2026-11-10

| Stage | State | Commit |
|:--|:--|:--|
| W3 — `tweakcnUrl` allowlist | done. Separate `tweakcnPathName` / `tweakcnSlugFromUrl` / `decodeSegment` so no function trips the complexity gate; the registry URL is always rebuilt | uncommitted |
| W4 — `useTheme`, no observers | done. Both `MutationObserver`s gone; the chip and the picker read `themeName` / `renderedMode` from the hook | uncommitted |
| W1 — painter deleted | done. `applyDesktopTheme`, `renderedModeFor`, `mixesFor`, `NEUTRAL_CHROME` and the native-chrome calls are gone; `handThemeToProvider` is the only apply path and reports `{ok, reason}` | uncommitted |
| W2 — app keys | done. `persistThemesForBoot` and `migrateAppearanceAliases` deleted; Chroma writes only its own keys, moved onto `ctx.storage` (`hermes.plugin.chroma.*`) with `chroma-*` localStorage as the fallback; imported themes moved to `chroma-imported-themes-v1` and are seeded once, read-only, from the app's store | uncommitted |

Three decisions worth recording:

* **No boot cache, no sentinel.** A contributed theme cannot be resolved at boot;
  that is the SDK gap the reviewer named, and it is an upstream issue, not a
  plugin workaround. Chroma therefore stops seeding it. A post-apply paint check
  was also dropped: comparing root tokens a frame later races the provider's own
  render, and a false alarm is a lie. The contract test pins the hand-off instead.
* **`availableThemes` is the refusal test**, because the host coerces an unknown
  name to its default skin and persists that (`normalizeSkin`). An empty list is
  not a verdict; it means the area has published nothing yet.
* **The alias migration is gone with `migrateAppearanceAliases`.** It existed to
  repair app-key records written by earlier builds. Those keys are now read once,
  as a seed, and never written; a name the host cannot resolve is refused with a
  warning rather than silently coerced.

## Review round — two adversarial passes, 2026-11-10

Both reviewers returned REQUEST-CHANGES with real defects. What they found, and
what was done:

| # | Finding | Fix |
|:--|:--|:--|
| 1 | A just-imported theme was refused by the hand-off, with a "Reload Desktop" notice that could not help: the `availableThemes` array a component captured at render is a SNAPSHOT | `_publishedThemeNames` records every name this session published; the guard trusts it over the snapshot |
| 2 | Imported themes were never registered at boot, so a Desktop-only install lost the user's theme on every restart | `register()` loads them synchronously and contributes them beside the 94 scenes |
| 3 | The recovery path could write another profile's pick into the active profile as its saved choice | the recovery restores the surface only; it never persists |
| 4 | A refused recovery was silent | `restoreScene` reports it, for the profile the user is looking at |
| 5 | Deleting the last import resurrected it on the next boot | the legacy seed is gated on a one-shot marker, not on emptiness |
| 6 | `storeRead` had no data fallback, and a double-encoded value emptied the map | own-key fallback plus a single decode step |
| 7 | `tweakcnUrl` threw a raw TypeError on a non-string, slugged a one-slash URL into a fetch, and used a realm-sensitive `instanceof` | type guard, scheme gate, message check |
| 8 | A refused mode change left the toggle flipped | `onModeChange` restores the previous mode |
| 9 | `setMode` pinned a `system` user to an explicit polarity | skipped when the provider reports `system` |
| 10 | A label match could hand `setTheme` a name it cannot resolve | the match is resolved to `match.name` |
| 11 | Dead code from the painter: `harmonize`, `hexToOklch`, `maxChroma`, `hueDelta`, `PRIMARY_SOLID_FG`, `SUCCESS_SEED`, `isLegacyPickerTheme`, a discarded `shipped` binding | deleted |
| 12 | Three acknowledgement tests were VACUOUS: they asserted provider state the click itself had set | the transport repaint is simulated before resolving; deleting the restore now fails them, proven by mutation |

Two more items came out of the pass and belong to the Captain, not to code:

* **The upstream issue the maintainer asked for** is drafted at
  `docs/REVIEWS/UPSTREAM-ISSUE-DRAFT.md`. Filing it is a public act on
  NousResearch's repository, so it waits for his word.
* **`CORE_DESKTOP_THEMES` now carries the host's full union** (12 built-ins + 3
  retired). Registering one is dropped by the app while the app still lists its
  own built-in, and a retired name is coerced to the default and persisted. Our
  catalogue has no collision, so nothing is lost.

## W1 — the painter

Today, in source order:

| Symbol | Does now | Becomes |
|:---|:---|:---|
| `applyDesktopTheme(theme, mode)` (2131) | builds a ~200-key token map, sets root CSS custom properties, sets `data-*` attributes | **deleted** |
| same, 2192-2193 | `setTitleBarTheme`, `setNativeTheme` | **deleted** — the provider sets the native chrome |
| same, 2198-2199 | writes `hermes-boot-background`, `hermes-boot-color-scheme` | **deleted** (W2) |
| `syncDesktopState(name, mode)` | `setTheme` + `setMode` after our paint | becomes **the** apply path, and the only one |

Replace the paint call with `requestTheme(scene.name)` at module scope and
`api.setTheme(scene.name)` inside React — whichever is available for the call site.
Both resolve the same contributed theme by name.

**Verification, not painting.** A deleted paint leaves a question worth keeping:
did the provider actually take the theme? After applying, read one sentinel token
(`--dt-background` or the host's equivalent) and compare it to the scene. Report a
mismatch through `host.notify` — never repaint it by hand. This is a check, and it
must be named as one.

**Risk — typography: resolved, no risk.** The provider paints typography itself.
`applyTheme` merges `theme.typography` over the defaults (context.tsx:321) and
applies `fontSans`, `fontMono`, `baseSize`, `lineHeight`, `letterSpacing`
(292-312, 383-384, 392). Our registered theme already carries `fontSans`/`fontMono`
under exactly those keys, so the font feature survives the deletion. The painter's
typography block goes with the rest of it.

## SDK contract — confirmed from the host source

These five facts decide the design; each is quoted from the host at the commit we
target.

1. **`requestTheme` only enqueues.** `requestTheme(name)` returns `false` when the
   name does not resolve, else sets `$pendingSkinApply`; the `ThemeProvider` drains
   it into `setTheme` (`themes/request.ts:29-37`, `context.tsx:656-663`). It never
   paints. So it is safe at module scope, and `setTheme` inside React remains the
   real owner.
2. **`setTheme` persists the choice for us.** It calls `skinPref.assign(liveProfile(),
   next)` (`context.tsx:632-638`). The app writes `hermes-desktop-theme-v2` and the
   per-profile keys itself — which is why our boot cache was redundant work in
   someone else's lane.
3. **The provider paints everything we painted**: root CSS vars, `data-hermes-theme`
   / `data-hermes-mode`, `.dark`, typography, `setTitleBarTheme`, `setNativeTheme`,
   `hermes-boot-background`, `hermes-boot-color-scheme` (`context.tsx:314-420`).
4. **A stored contributed name self-heals.** The boot IIFE paints from the stored
   name before React mounts (`context.tsx:451-461`), which may resolve to the
   default; `storedSkin` keeps the raw name and the `committedName` memo re-resolves
   when `registryVersion` moves (582-587). So a contributed theme paints correctly
   as soon as the plugin registers — a flash, not a loss.
5. **`useTheme()` returns `themeName`, `mode`, `resolvedMode`, `renderedMode`,
   `availableThemes`, `setTheme`, `setMode`** (`context.tsx:465-488`). Everything the
   MutationObservers were reading, reactively.

The reviewer's sentence — "the provider paints the tokens, sets the native chrome
and writes the boot keys" — is literally true of `applyTheme`. Our code was a
duplicate of it, one host version behind.

## W2 — the app's keys

| Symbol | Key(s) | Becomes |
|:---|:---|:---|
| `USER_THEMES_KEY` (76) + `persistThemesForBoot` (2333) | `hermes-desktop-user-themes-v1` | **deleted** |
| `SKIN_KEY` (85), `MODE_KEY` (86) and their writers | `hermes-desktop-theme-v2`, `hermes-desktop-mode-v1` | **deleted** |
| `migrateAppearanceAliases` (2563) | several app keys | **deleted** |
| the `hermes-desktop-profile-*-v1` writes | per-profile appearance | **deleted**; our own `chroma-*` map already holds it |

What stays: registering the catalogue into `THEMES_AREA` (that is the SDK path), and
Chroma's own state — the per-profile choice, imported skins, overrides, packs — moved
from raw `chroma-*` localStorage keys to **`ctx.storage`**, which the host already
namespaces as `hermes.plugin.<id>.*` (`contrib/plugin.ts:49-55, 196-216`, verified).
That is strictly stronger than "keep only your `chroma-*` keys": the app owns the
prefix, and no plugin can read or clobber another's. `ctx.storage` is per plugin,
not per profile, so the appearance map stays one key holding a map keyed by profile.

**The boot gap, stated honestly.** Desktop reads its theme cache before plugins
register, so a contributed theme is unresolvable at first paint; that is exactly
why the boot keys were written. Removing them means a short window at startup
where the app shows its own last theme before our `setTheme` lands. The reviewer
accepted this and asked for an issue. So:
- file `NousResearch/hermes-agent` issue: *persisted / boot-resolvable THEMES_AREA
  contributions*, linked from the PR comment and from `docs/TASKS.md`;
- keep first paint honest in our own docs: no claim of "instant at startup".

**Partial-value case to handle.** A user who has never run Chroma, or who has an
older install, has appearance only in the app keys. We may **read** them once to
seed `chroma-*` on first run (a read is not a write), then never write them again.
That preserves the migration and satisfies the review.

## W3 — `tweakcnUrl`

Accept exactly: a bare slug (`catppuccin`), `https://tweakcn.com/…`,
`https://www.tweakcn.com/…`. Reject with a named reason: `http:`, any other host,
userinfo in the URL, and any path that is not `/themes/<slug>` or
`/r/themes/<slug>.json`. Build the registry URL from the slug — never pass the
user's URL through. Tests: one case per rejection, plus the three accepted forms.

## W4 — `useTheme` instead of the observer

Two `MutationObserver`s watch `documentElement` (2906, 5460) to learn the current
theme name and mode. `useTheme()` already exposes both reactively; the scout's
answer fixes the exact shape. Delete both observers and derive from the hook.
The statusbar chip keeps working off the same state.

## What must not change

- The backend. The reviewer called it clean; nothing here touches it.
- Gateway sync (`config.set('skin', …)`), which they explicitly endorsed.
- `/skin <name>`, the CLI transports, and the per-mode pair from `3ffdb83`.
- No new dependency, no JSX, no `package.json` — `AGENTS.md` §3.

## Proof

- `node --test tests/*.test.mjs` and `python -m pytest tests/ -q`, both green.
- Five suites reference the deleted symbols today (`port-superset-tokens`,
  `surfaces-regression`, `theme-chip-mode`, `editor-typography`, the harness) —
  each must be rewritten to assert the new path, not deleted.
- A fault-injected guard: make the provider ignore a theme, confirm the sentinel
  check reports it.
- `rigour check --ci` finding set unchanged except for what deleting code removes;
  the CI pin shrinks in the same commit if it does.
- On the G15: apply a skin, switch mode, restart the app, confirm the theme
  survives the startup window and that no `hermes-*` key is written.

## Order and gates

1. Scout the SDK contract (done — see above) → fixes W1's typography answer and
   W4's shape.
1b. Survey every other Hermes theme/skin plugin **from public sources only** (GitHub,
   the catalog on GitHub, npm, the docs site — no local plugin directories) and record
   how each applies and persists a theme. Their verdict on painter-vs-provider
   decides nothing on its own — the host contract does — but a plugin that ships
   today and passes review is evidence about which SDK path survives contact with
   the product. Record it in `docs/RESEARCH/`.
2. W3 + W4 → one commit, gates, no review needed (mechanical, isolated).
3. W1 + W2 → one commit; adversarial review of the diff before it ships.
4. Re-pin `docs/catalog/chroma.yaml` to the new sha, rebuild the branch, comment on
   PR #149767 with the delta summary.
5. File the SDK-gap issue; link it in the PR comment.
