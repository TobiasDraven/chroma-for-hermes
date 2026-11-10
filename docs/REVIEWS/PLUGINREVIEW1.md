# PLUGINREVIEW1 — catalog review of Chroma (PR #149767)

Reviewer: @teknium1 (NousResearch), via GitHub.
Reviewed at: `494770ba`.
Verdict: **requested changes** — three blocking items, two recommended.
Recorded verbatim 2026-11-10. Do not edit the quoted text; add notes below it.

---

## Verbatim review

> Thanks @TobiasDraven, we reviewed chroma at 494770ba. It's a Desktop pane for
> browsing, importing and editing skins, with an optional dashboard backend that
> writes skin YAMLs under the profile's skins/ dir.
>
> The backend is clean: names are validated, writes are atomic, and the active
> skin changes through the public config.set RPC. The problems are all in the
> Desktop bundle, which does by hand what the theme provider already does.
>
> Before it can list:
>
> 1. `desktop/plugin.js#L2117-L2190`: applyDesktopTheme paints the app's root CSS
>    tokens itself and calls `window.hermesDesktop.setTitleBarTheme` /
>    `setNativeTheme` directly (L2178-L2179). Remove that. Switch themes only
>    through the SDK: `useTheme().setTheme(name)` / `setMode(mode)` (you already
>    capture them at L2237-L2256), or `requestTheme` from `@hermes/plugin-sdk`
>    outside React. The provider paints the tokens, sets the native chrome and
>    writes the boot keys.
> 2. `desktop/plugin.js#L2184-L2185`, `#L2367-L2372`, `#L2584-L2603`, and
>    L76/L2347 (`persistThemesForBoot`, `migrateAppearanceAliases`): stop writing
>    the app's own localStorage keys (`hermes-boot-*`,
>    `hermes-desktop-theme-v2`, `hermes-desktop-mode-v1`,
>    `hermes-desktop-profile-*-v1`, `hermes-desktop-user-themes-v1`). Keep only
>    your `chroma-*` keys. Your reason (contributed themes can't be resolved at
>    boot) is a real SDK gap. Please open a hermes-agent issue asking for a hook,
>    such as a persisted THEMES_AREA contribution, instead of writing core's
>    user-theme store.
> 3. `desktop/plugin.js#L1036-L1051`: `tweakcnUrl` passes any `http(s)://` URL
>    through unchanged, but the description says it only accepts https on
>    tweakcn.com. Make the code match: accept only `https://tweakcn.com/...` (or
>    www.), reject every other host and `http:`, and rebuild the
>    `/r/themes/<slug>.json` URL from the slug.
>
> Recommended, not blocking:
>
> 4. `desktop/plugin.js#L2887-L2893` and L5424-L5428: read the theme name and mode
>    from `useTheme()` instead of watching `document.documentElement` attributes
>    with a MutationObserver.
>
> We'll update the disclosure line at merge. Push the fix, re-pin sha: here and
> comment when it's in; we'll review the delta from 494770ba.

---

## What we owe them

| # | Blocking | Owner file |
|:--|:--|:--|
| 1 | Remove the hand-painted token writer and the direct native-chrome calls | `chroma/desktop/plugin.template.js` |
| 2 | Stop writing the app's localStorage keys; file the upstream SDK-gap issue | `chroma/desktop/plugin.template.js` + a GitHub issue on `NousResearch/hermes-agent` |
| 3 | `tweakcnUrl`: https-on-tweakcn only, host allowlist, rebuild the registry URL from the slug | `chroma/desktop/plugin.template.js` |
| 4 | Read theme name and mode from `useTheme()`, not a MutationObserver (recommended) | `chroma/desktop/plugin.template.js` |

## Notes

- Every citation is in the **generated** `plugin.js`. The source of truth is
  `plugin.template.js`; line numbers there differ. Locate by symbol, not by line.
- The review also says the backend is clean, so no backend change is called for by
  this review. Backend work happens only if the pane change requires it.
- Upstream will re-pin the catalog entry's `sha:` themselves at merge; we re-pin
  our own fork's entry after the push and comment on the PR.
