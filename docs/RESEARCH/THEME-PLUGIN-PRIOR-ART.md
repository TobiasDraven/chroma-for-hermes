# Prior art — how other Hermes theme plugins do it

Gathered 2026-11-10 from public sources only (catalog entries on GitHub, plugin
sources on `raw.githubusercontent.com`). Purpose: decide what Chroma should copy
before answering catalog review 1 (`docs/REVIEWS/PLUGINREVIEW1.md`).

**Evidence grade.** These findings come from a delegated survey, not from my own
reads of each file. The one contract fact the design now depends on — `ctx.storage`
— I verified myself in the host source (below). Every other claim here is the
survey's, quoted with its URL. Treat anything unverified as a lead, not a fact.

## The field

| Plugin | Repo | How it applies a theme | Persists | Startup | Typography |
|:--|:--|:--|:--|:--|:--|
| `minimalist-themes` | `mykeura/minimalist-themes-for-hermes` | `registerMany({area: THEMES_AREA})`, then `requestTheme(...)` following the CLI's skin name | none | `MutationObserver` on `data-hermes-theme` to follow CLI picks | bundles Figtree + Geist Mono in the theme's typography |
| `nous-girl-theme` | `mykeura/nous-girl` | `register({area: THEMES_AREA})` | none | none | keeps the app's typography |
| `nord-theme` | `Audiofool934/hermes-nord-theme` | `register({area: THEMES_AREA})` + one `requestTheme(THEME_NAME)` on first enable | `ctx.storage` key `applied-once` | one-shot apply with a retry loop | palette only |
| `accent-picker` | `NousResearch/hermes-official-plugins` | `setAccentOverride(hex)` from the SDK | none — explicitly scratch | resets the override on dispose | n/a |
| `hermes-wallpaper` | catalog | own `z-index:-1` layer + style tag; no theme tokens | IndexedDB + `ctx.storage` | restores its layer | n/a |
| `better-session-appearance` | catalog | per-session colour | plugin state | — | n/a |

Not analysed: `claude-code-theme`, `codex-theme`, `glass-theme` — the survey's
fetches were rate-limited (HTTP 429). **UNVERIFIED.** Nothing here rests on them.

## What the field says, plainly

1. **Nobody hand-paints the app's root tokens.** Four of four theme plugins register
   into `THEMES_AREA` and let the provider paint. Chroma is the outlier the
   maintainer flagged.
2. **Nobody writes the app's localStorage keys.** The one plugin that persists
   anything uses `ctx.storage` (namespaced), for a boolean.
3. **Nobody does URL theme import.** Chroma's tweakcn importer is unique in this
   field — which is why item 3 in the review is about *tightening* it, not removing
   it.
4. **`requestTheme` in the wild is a one-shot or a follow-the-CLI nudge**, never the
   apply path for a user's own pick. That matches the host contract: it only enqueues.
5. **Typography travels inside the theme data** (minimalist bundles fonts that way),
   which matches `applyTheme` merging `theme.typography`. Confirms deleting our
   font injection loses nothing.
6. **A `MutationObserver` on `data-hermes-theme` is a real pattern** — but used to
   follow *someone else's* choice (the CLI's), not to mirror state the plugin
   already owns. The reviewer's item 4 asks us off it; that is compatible with the
   field.

## The one thing I verified myself

`ctx.storage` is real and it is the sanctioned place for plugin state:

- `contrib/plugin.ts:49-55` — `interface PluginStorage { get<T>(key, fallback): T;
  set(key, value): void; remove(key): void }`, documented as *"Namespaced JSON
  persistence (the VS Code `globalState` analog). Keys live under
  `hermes.plugin.<id>.` — plugins can't read or clobber each other."*
- `contrib/plugin.ts:196-216` — `createPluginStorage` scopes every key to
  `hermes.plugin.${pluginId}.` and JSON round-trips the value.
- `contrib/plugin.ts:175, 372` — the context carries `storage`.

So Chroma's `chroma-*` localStorage keys should become `ctx.storage` keys. Same
guarantee the reviewer asked for (our own namespace, not the app's), with the app
managing the prefix instead of us. Scope note: `ctx.storage` is per plugin, not per
profile, so the per-profile appearance map stays one key holding a map.

## Verdict for Chroma

**Copy:** register into `THEMES_AREA`; let `setTheme`/`setMode` apply and persist;
use `requestTheme` only for a nudge; keep every byte of state in `ctx.storage`;
carry typography in the theme payload.

**Avoid:** hand-painted tokens and `setTitleBarTheme`/`setNativeTheme`; any app
`hermes-*` key; a `MutationObserver` for state the hook already gives us.

**Keep, against the field:** the tweakcn importer, tightened to the reviewer's
allowlist — no other plugin has it, so it is a differentiator, not a liability.
