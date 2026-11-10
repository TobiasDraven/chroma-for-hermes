# Draft — upstream issue for NousResearch/hermes-agent

Requested by @teknium1 in the catalog review of PR #149767:

> Your reason (contributed themes can't be resolved at boot) is a real SDK gap.
> Please open a hermes-agent issue asking for a hook, such as a persisted
> THEMES_AREA contribution, instead of writing core's user-theme store.

Not filed. A public issue on someone else's repository is the Captain's call.
Post with:

```
gh issue create --repo NousResearch/hermes-agent \
  --title "Desktop: let a plugin's THEMES_AREA contribution survive a restart" \
  --body-file docs/REVIEWS/UPSTREAM-ISSUE-DRAFT.md
```

---

**Title:** Desktop: a plugin's `THEMES_AREA` contribution is lost at boot, so a selected plugin skin cannot be restored

**Body:**

### What happens

A plugin can register a theme into `THEMES_AREA` and the app applies it while the
session lives. After a restart the same skin cannot be restored, because the
`skinPref` that `setTheme` persisted is resolved at boot — before any plugin has
registered anything. The name does not resolve, so `applyTheme` falls back to the
default skin. The user's choice is silently lost.

### Why this matters

A plugin that ships a whole theme catalogue is therefore unable to make its
themes durable through the supported path. The only ways to keep the choice are
both wrong:

* write the app's own boot keys (`hermes-boot-*`, `hermes-desktop-theme-v2`) — the
  workaround that the catalog review correctly rejected, because core's store
  belongs to core; or
* re-apply the theme on every mount, which flashes the default skin first and
  races the provider.

### What we ask for

A supported way for a contributed theme to survive a restart. Any of these would
close it, and the choice is yours:

1. **Persisted contribution.** Let a plugin declare a contribution as durable, so
   the registry replays it from storage before the first resolve. The plugin
   supplies the theme data; the app owns the storage and the replay.
2. **Deferred boot resolution.** When the persisted `skinPref` does not resolve at
   boot, keep it pending for a short window or until the theme areas have
   published, then apply it if it resolves — instead of immediately coercing it to
   the default and persisting that.
3. **A hook.** An exported `onThemesReady(cb)` (or a registry event) that fires
   once the areas have published, so a plugin can re-apply its own skin without
   guessing at timing.

Option 1 is the one the review suggested and the one we would use. Option 2 also
fixes the flash for anyone who registers at boot.

### Current behaviour we can point at

`apps/desktop/src/themes/context.tsx`: the boot path reads the persisted
`skinPref` and calls `normalizeSkin`, which coerces an unresolvable name to
`DEFAULT_SKIN`. `setTheme` then persists the coerced value, so the user's
original choice is not merely ignored — it is overwritten.

### Context

Chroma (`TobiasDraven/chroma-for-hermes`) is the plugin that hit this: a desktop
skin browser that registers ~94 scenes through `THEMES_AREA`. It no longer writes
core's keys; with no supported hook, a contributed skin simply cannot be made the
durable active theme. Related: PR #149767.
