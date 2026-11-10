import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

// Desktop's own stores. Chroma READS two of them once (as a seed) and must
// never write any of them: ThemeProvider owns them, paints from them and
// persists the active skin itself.
const APP_THEME_KEY = 'hermes-desktop-theme-v2'
const APP_MODE_KEY = 'hermes-desktop-mode-v1'
const APP_PROFILE_THEMES = 'hermes-desktop-profile-themes-v1'
const APP_PROFILE_MODES = 'hermes-desktop-profile-modes-v1'
const APP_USER_THEMES = 'hermes-desktop-user-themes-v1'
const APP_KEYS = [APP_THEME_KEY, APP_MODE_KEY, APP_PROFILE_THEMES, APP_PROFILE_MODES, APP_USER_THEMES]

// Chroma's own stores.
const APPEARANCE_KEY = 'chroma-appearance-v1'
const THEMES_KEY = 'chroma-imported-themes-v1'

const pluginPath = new URL('../chroma/desktop/plugin.js', import.meta.url)

function loadPlugin(
  storage,
  exposeTestHelpers = false,
  requestHandler = null,
  profileGetter = () => 'default',
  // The SDK's out-of-React door. A host with no queue reports `false` here,
  // which is the honest "nothing received this switch".
  requestTheme = () => false
) {
  return readFile(pluginPath, 'utf8').then(source => {
    let executable = source
      .replace(/import\s+\{[\s\S]*?\}\s+from\s+'@hermes\/plugin-sdk'\n/, '')
      .replace(/import\s+\{[^}]*\}\s+from\s+'react\/jsx-runtime'\n/, '')
      .replace(/import\s+\{[^}]*\}\s+from\s+'react'\n/, '')
      .replace('export default {', 'globalThis.plugin = {')
    if (exposeTestHelpers) {
      executable += '\nglobalThis.testHelpers = { buildThemeGroups, buildGroups, buildCategoryGroups, sceneCategory, oklch, normaliseHex, readGroupMode, writeGroupMode, GROUP_MODES, THEME_CATEGORIES, persistAppearance, readAppearance, persistTheme, readStoredThemes, writeThemesTo, handThemeToProvider, handOffFailureNotice, useDesktopThemeApi, sceneNameFor, sceneToDesktopTheme, desktopModeFor, applyScene, readApplyScope, writeApplyScope, APPLY_SCOPE_LOCAL, APPLY_SCOPE_EVERYWHERE, cardMinFor, cardAspect, cardShapeClasses, readCardShape, writeCardShape, CARD_MIN, CARD_SHAPES, scenes: SKINS, forgetScene, IMPORTED_SKINS, appearanceKey: CHROMA_APPEARANCE_KEY, themesKey: CHROMA_THEMES_KEY }\n'
    }

    const css = new Map()
    const state = {
      reloads: 0,
      active: null,
      notifications: [],
      requests: [],
      css,
      root: null,
      provider: null,
      effects: [],
      themeRequests: []
    }
    const root = {
      dataset: {},
      style: {
        setProperty: (key, value) => css.set(key, value),
        getPropertyValue: key => css.get(key) ?? ''
      },
      classList: { toggle: (name, enabled) => { state.darkClass = name === 'dark' && enabled } }
    }
    state.root = root
    const context = {
      console,
      globalThis: null,
      document: {
        documentElement: root,
        head: { appendChild: () => {} },
        createElement: () => ({ dataset: {} })
      },
      haptic: () => {},
      Component: class {},
      // React, as the module sees it: useTheme answers with whatever provider
      // the test mounted, and useEffect records the effect so the test can run
      // it (the real hook fills the module-level provider slot from there).
      useTheme: () => state.provider,
      useEffect: fn => { state.effects.push(fn) },
      // The SDK's out-of-React door.
      requestTheme: name => {
        state.themeRequests.push(name)
        return requestTheme(name)
      },
      host: {
        notify: value => state.notifications.push(value),
        onEvent: () => () => {},
        request: (method, payload) => {
          state.requests.push({ method, payload })
          return requestHandler ? requestHandler(method, payload) : Promise.resolve({})
        },
        state: { profile: { get: profileGetter } }
      },
      PALETTE_AREA: 'palette',
      ROUTES_AREA: 'routes',
      SIDEBAR_NAV_AREA: 'sidebar-nav',
      STATUSBAR_AREAS: { right: 'statusbar-right' },
      THEMES_AREA: 'themes',
      window: {
        hermesDesktop: {},
        location: { reload: () => { state.reloads += 1 } },
        localStorage: {
          getItem: key => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value)
        },
        setTimeout: fn => fn()
      }
    }
    context.globalThis = context
    vm.runInNewContext(executable, context, { filename: 'plugin.js' })
    context.plugin.__test = context.testHelpers
    context.plugin.__state = state
    return context.plugin
  })
}

// A provider stub shaped like the host's ThemeProvider. setTheme/setMode mutate
// it, so a later read sees what a re-render would see.
function providerStub(options = {}) {
  const calls = []
  const provider = {
    themeName: 'nous',
    mode: 'dark',
    renderedMode: 'dark',
    previewTheme() {},
    clearThemePreview() {},
    setTheme(name) { calls.push(['theme', name]); provider.themeName = name },
    setMode(value) { calls.push(['mode', value]); provider.mode = value }
  }
  if ('availableThemes' in options) provider.availableThemes = options.availableThemes
  return { provider, calls }
}

// Fill the module-level provider slot the way a mounted consumer does. Without
// this, applyScene's post-acknowledgement re-assert has nobody to talk to.
function mountProvider(plugin, provider) {
  plugin.__state.provider = provider
  plugin.__test.useDesktopThemeApi()
  const effects = plugin.__state.effects.splice(0)
  return effects.map(fn => fn()).filter(Boolean)
}

const isSceneNameOnly = (calls, name) =>
  calls.every(call => (call[0] === 'theme' ? call[1] === name : true))

// Chroma must not paint. Not the root dataset, not the CSS variables, not the
// dark class: the ThemeProvider owns all three, and a second painter behind its
// back is exactly what made a switch revert on the next render.
function assertNotPainted(plugin) {
  assert.deepEqual(Object.keys(plugin.__state.root.dataset), [], 'Chroma must not write the root dataset')
  assert.deepEqual([...plugin.__state.css.keys()], [], 'Chroma must not write theme CSS variables')
  assert.equal(plugin.__state.darkClass, undefined, 'Chroma must not toggle the dark class')
}

const appearanceOf = storage => JSON.parse(storage.get(APPEARANCE_KEY) ?? '{}')

// --- Registration ---------------------------------------------------------
//
// register() used to mirror all 94 scenes into Desktop's user-theme store so a
// contributed skin could resolve at the next boot. That store belongs to the
// ThemeProvider, and the contribution itself is what Desktop resolves from now
// (registry entry + the provider's merged availableThemes), so Chroma writes
// nothing at boot.

test('registering publishes every scene to the host registry and stores nothing itself', async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage, true)
  const contributed = []

  plugin.register({
    register: contribution => {
      if (contribution.id.startsWith('theme:')) contributed.push(contribution)
    }
  })

  const scenes = plugin.__test.scenes
  assert.equal(contributed.length, scenes.length, 'every bundled scene is contributed')
  assert.ok(contributed.length > 0, 'fixture: the catalog is not empty')

  const byName = new Map(scenes.map(scene => [scene.name, scene]))
  for (const contribution of contributed) {
    const theme = contribution.data
    assert.equal(contribution.area, 'themes', `${theme.name} must land in the THEMES area`)
    assert.equal(contribution.id, `theme:${theme.name}`)
    assert.equal(
      plugin.__test.sceneNameFor(theme.name),
      theme.name,
      `${theme.name} must be a name the picker can resolve back to its card`
    )
    assert.ok(
      ['background', 'foreground', 'primary'].every(key => typeof theme.colors[key] === 'string'),
      `${theme.name} carries no usable light palette`
    )
    // Desktop's paletteFor() is `darkColors ?? colors`, so a contribution with
    // no dark half leaves the lightbulb a no-op. That is the guarantee the old
    // cache-repair tests protected; it now lives in the contribution itself.
    assert.ok(theme.darkColors, `${theme.name} must ship a dark half`)
    const scene = byName.get(theme.name)
    if (scene && scene.lightColors && scene.darkColors) {
      assert.notEqual(
        theme.colors.background,
        theme.darkColors.background,
        `${theme.name} ships one palette as both halves, so the mode switch does nothing`
      )
    }
  }

  // register() writes ONE key: the one-shot marker that stops the legacy seed
  // from running twice. It writes no theme data and no appearance.
  for (const key of storage.keys()) {
    assert.ok(key.startsWith('chroma-'), `register() wrote a foreign key: ${key}`)
  }
  assert.deepEqual([...storage.keys()].sort(), ['chroma-imported-seeded-v1'],
    'the only write at boot is the seed marker')
  assert.equal(plugin.__test.readStoredThemes ? Object.keys(plugin.__test.readStoredThemes()).length : 0, 0,
    'and nothing was imported from an empty app store')
})

test("registering leaves the app's own theme, mode and profile keys exactly as it found them", async () => {
  const catalog = await loadPlugin(new Map(), true)
  const scene = catalog.__test.scenes.find(item => item.name === 'dark-aubergine')
  const combined = catalog.__test.sceneToDesktopTheme(scene)

  // The pre-change build rewrote all of these at boot (seeding, cache repair,
  // legacy alias migration). None of it is Chroma's to write any more.
  const before = new Map([
    [APP_THEME_KEY, 'theme-picker-alabaster-dark'],
    [APP_MODE_KEY, 'light'],
    [APP_PROFILE_THEMES, JSON.stringify({ work: 'dark-aubergine' })],
    [APP_PROFILE_MODES, JSON.stringify({ work: 'light' })],
    [APP_USER_THEMES, JSON.stringify({ 'dark-aubergine': { name: 'dark-aubergine', colors: combined.darkColors } })]
  ])
  const storage = new Map(before)
  const plugin = await loadPlugin(storage)

  plugin.register({ register: () => {} })

  // Compare the app's keys only: Chroma's own marker is allowed to appear, the
  // app's stores must not move by a byte.
  for (const [key, value] of before) {
    assert.equal(storage.get(key), value, `a boot rewrote the app key ${key}`)
  }
  for (const key of storage.keys()) {
    if (before.has(key)) continue
    assert.ok(key.startsWith('chroma-'), `a boot wrote a foreign key: ${key}`)
  }
})

// --- Chroma's own stores --------------------------------------------------

test("imported themes live in Chroma's own store, seeded once from the app's user-theme store", async () => {
  const ours = { name: 'my-fork', themePickerSource: 'owned', colors: { background: '#101010' } }
  const foreign = { name: 'foreign', colors: { background: '#202020' } }
  const storage = new Map([[APP_USER_THEMES, JSON.stringify({ 'my-fork': ours, foreign })]])
  const plugin = await loadPlugin(storage, true)

  const seeded = plugin.__test.readStoredThemes()
  assert.deepEqual(Object.keys(seeded), ['my-fork'], 'only a theme Chroma imported is ours to carry over')
  assert.deepEqual(JSON.parse(storage.get(THEMES_KEY)), { 'my-fork': ours })

  // Read, copy, never write back: the app's store is a seed, not a mirror.
  assert.deepEqual(
    JSON.parse(storage.get(APP_USER_THEMES)),
    { 'my-fork': ours, foreign },
    'the copy must not disturb the store it copied from'
  )

  // Once Chroma has a store of its own the seed is spent: a later app-store
  // change must not silently reappear in ours.
  const later = { name: 'added-later', themePickerSource: 'vscode' }
  storage.set(APP_USER_THEMES, JSON.stringify({ 'my-fork': ours, 'added-later': later }))
  assert.equal(
    Object.prototype.hasOwnProperty.call(plugin.__test.readStoredThemes(), 'added-later'),
    false,
    'the seed runs once; afterwards our store is the only truth'
  )
})

test("an imported theme is stamped with its provenance in Chroma's own store", async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage, true)

  plugin.__test.persistTheme({ name: 'from-vscode', source: 'vscode', colors: { background: '#010101' } })
  plugin.__test.persistTheme({ name: 'plain', colors: { background: '#020202' } })

  const stored = JSON.parse(storage.get(THEMES_KEY))
  assert.equal(stored['from-vscode'].themePickerSource, 'vscode', 'provenance is stamped at the writer')
  assert.equal(stored.plain.themePickerSource, 'owned', 'and never left undefined for the reader to guess')
  assert.equal(storage.has(APP_USER_THEMES), false, "the app's user-theme store is never written")
  assert.equal(storage.has(APP_PROFILE_THEMES), false)
})

test("appearance is stored under Chroma's own key, and the app's keys are never written", async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage, true)

  assert.equal(plugin.__test.persistAppearance('dark-example', 'dark', 'work'), true)

  assert.deepEqual(appearanceOf(storage), { work: { theme: 'dark-example', mode: 'dark' } })
  for (const key of APP_KEYS) {
    assert.equal(storage.has(key), false, `Chroma must not write ${key}`)
  }

  // Profiles are independent records, not one global pair.
  plugin.__test.persistAppearance('alabaster', 'light', 'default')
  assert.deepEqual(appearanceOf(storage), {
    work: { theme: 'dark-example', mode: 'dark' },
    default: { theme: 'alabaster', mode: 'light' }
  })
})

test("Chroma's own record is the authority, and the app's keys are only a seed", async () => {
  const storage = new Map([
    [APPEARANCE_KEY, JSON.stringify({ work: { theme: 'alabaster', mode: 'dark' } })],
    [APP_PROFILE_THEMES, JSON.stringify({ work: 'dark-example' })],
    [APP_PROFILE_MODES, JSON.stringify({ work: 'light' })],
    [APP_THEME_KEY, 'dark-example'],
    [APP_MODE_KEY, 'light']
  ])
  const plugin = await loadPlugin(storage, true)
  const { readAppearance, desktopModeFor } = plugin.__test

  // The objects come out of the VM, so compare them as plain JSON.
  assert.deepEqual(
    JSON.parse(JSON.stringify(readAppearance('work'))),
    { theme: 'alabaster', mode: 'dark' },
    'our record wins over the app store for the same profile'
  )

  // No record of ours for this profile: seed once from what the app had.
  assert.deepEqual(
    JSON.parse(JSON.stringify(readAppearance('personal'))),
    { theme: 'dark-example', mode: 'light' }
  )

  // A mode the provider actually rendered beats any stored preference.
  assert.equal(desktopModeFor('work', undefined), 'dark')
  assert.equal(desktopModeFor('work', 'light'), 'light')
  assert.equal(desktopModeFor('work', 'nonsense'), 'dark', 'anything that is not a mode falls back to the record')

  // Unrecorded profile with no per-profile seed: the app's global pick is next.
  assert.deepEqual(
    JSON.parse(JSON.stringify(readAppearance('scratch'))),
    { theme: 'dark-example', mode: 'light' }
  )

  // And nothing is invented when there is nothing to seed from.
  const empty = await loadPlugin(new Map(), true)
  assert.deepEqual(
    JSON.parse(JSON.stringify(empty.__test.readAppearance('default'))),
    { theme: 'nous', mode: 'light' }
  )
})

// --- Card geometry --------------------------------------------------------
//
// The grid target used to be derived from a column count capped at four, so a
// wide window produced four enormous squares (~330px each at 1400px wide). The
// target is fixed now and the responsive work belongs to the grid's auto-fill:
// a wider window shows MORE cards, not bigger ones. This test replaces the one
// that asserted the old column count, which is what caused the ballooning.

test('the grid target is fixed, so a wide window shows more cards, not bigger ones', async () => {
  const plugin = await loadPlugin(new Map(), true)
  const { cardMinFor, cardAspect, CARD_MIN, CARD_SHAPES } = plugin.__test

  assert.equal(CARD_MIN, 132)
  // Array.from: CARD_SHAPES is built inside the VM, so its prototype is the VM's
  // Array and deepStrictEqual would reject it as a different structure.
  assert.deepEqual(Array.from(CARD_SHAPES), ['square', 'rectangle', 'circle'])

  assert.equal(cardMinFor('square'), CARD_MIN)
  assert.equal(cardMinFor('circle'), CARD_MIN, 'a circle wants a square slot, like a square card')
  assert.ok(
    cardMinFor('rectangle') > CARD_MIN,
    'a rectangle is wider than it is tall, so it needs a wider slot to keep a usable height'
  )
  assert.ok(cardMinFor('rectangle') < CARD_MIN * 3, 'but not so wide that a card fills the row')

  assert.equal(cardAspect('square'), '1')
  assert.equal(cardAspect('circle'), '1', 'a circle is round by radius, not by ratio')
  assert.equal(cardAspect('rectangle'), '16 / 10')
})

test('the card shape is remembered, and an unknown shape falls back to squares', async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage, true)
  const { readCardShape, writeCardShape, cardShapeClasses } = plugin.__test

  assert.equal(readCardShape(), 'square', 'the gallery must render before anything is stored')

  assert.equal(writeCardShape('circle'), true)
  assert.equal(readCardShape(), 'circle', 'a view preference must survive a reload')
  assert.equal(storage.get('chroma-card-shape-v1'), 'circle')

  assert.equal(writeCardShape('hexagon'), false, 'an unknown shape must not be stored')
  assert.equal(readCardShape(), 'circle', 'and must not clobber the stored one')

  assert.ok(cardShapeClasses('circle').includes('rounded-full'), 'a circle needs a full radius')
  assert.ok(cardShapeClasses('square').includes('rounded-lg'))
  assert.ok(!cardShapeClasses('square').includes('rounded-full'), 'the shapes must differ')
})

test('skins are grouped as both-mode, dark-only, then light-only', async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage, true)
  const { buildThemeGroups } = plugin.__test
  const groups = buildThemeGroups([
    { name: 'light', modeSupport: 'light' },
    { name: 'dynamic', modeSupport: 'dynamic' },
    { name: 'dark', modeSupport: 'dark' }
  ])

  assert.deepEqual(
    Array.from(groups, group => group.title),
    ['Skins', 'Dark only', 'Light only']
  )
  assert.deepEqual(Array.from(groups, group => group.scenes[0].name), ['dynamic', 'dark', 'light'])
})

test('the theme lens puts every scene in exactly one category, and no category ships empty', async () => {
  const plugin = await loadPlugin(new Map(), true)
  const { buildCategoryGroups, buildGroups, scenes, THEME_CATEGORIES } = plugin.__test
  const groups = buildCategoryGroups(scenes)

  const seen = new Set()
  let total = 0
  for (const group of groups) {
    for (const scene of group.scenes) {
      assert.ok(!seen.has(scene.name), `${scene.name} appears in two categories`)
      seen.add(scene.name)
      total += 1
    }
  }
  assert.equal(total, scenes.length, 'every scene lands in exactly one category')
  assert.equal(seen.size, scenes.length)
  assert.equal(groups.length, THEME_CATEGORIES.length)
  // A bucket that no shipped scene can reach is a lie in the UI: the divider would
  // promise a category and then render nothing.
  for (const group of groups) {
    assert.ok(group.scenes.length > 0, `category ${group.id} is empty on the shipped catalog`)
  }
  // The two lenses are switchable, and an unknown value falls back to scenes.
  assert.deepEqual(Array.from(buildGroups(scenes, 'theme'), group => group.id),
    Array.from(THEME_CATEGORIES, category => category.id))
  assert.deepEqual(Array.from(buildGroups(scenes, 'nonsense'), group => group.id),
    ['dynamic', 'dark', 'light'])
})

test('the classifier files an unstamped palette by its measured hue family', async () => {
  const plugin = await loadPlugin(new Map(), true)
  const { sceneCategory, oklch } = plugin.__test
  const scene = (accent, modeSupport) => ({ name: 'x', modeSupport: modeSupport || 'dynamic', lightColors: { ui_accent: accent } })

  // Hue is the family; chroma below 0.04 is the achromatic shelf. These hues are
  // measured, not assumed: each value is printed beside the cut it must land in.
  assert.equal(sceneCategory(scene('#E795BE')), 'rose', 'h 348.6')
  assert.equal(sceneCategory(scene('#9CD3BA')), 'teal', 'h 165.1')
  assert.equal(sceneCategory(scene('#EFD292')), 'gold', 'h 86.2')
  assert.equal(sceneCategory(scene('#A9C6E6')), 'cobalt', 'h 251.1')
  assert.equal(sceneCategory(scene('#B91C1C')), 'persimmon', 'h 27.5')
  assert.equal(sceneCategory(scene('#2F855A')), 'teal', 'h 158.0')
  assert.equal(sceneCategory(scene('#22C55E')), 'fern', 'h 149.6')
  assert.equal(sceneCategory(scene('#0053FD')), 'indigo', 'h 262.7')
  assert.equal(sceneCategory(scene('#C05621')), 'persimmon', 'h 43.8')
  assert.equal(sceneCategory(scene('#1E293B')), 'neutral', 'C 0.037 is below the floor')
  assert.equal(sceneCategory(scene('#808080')), 'neutral', 'grey has no hue to file')

  assert.equal(sceneCategory(scene('#E795BE', 'dark')), 'dark', 'a dark-only scene files by its mode')
  assert.equal(sceneCategory(scene('#E795BE', 'light')), 'light')
  assert.equal(sceneCategory({ name: 'bare', modeSupport: 'dynamic' }), 'neutral', 'a scene with no palette still files somewhere')

  // The measurement itself, in the space the rule depends on.
  const white = oklch('#FFFFFF')
  assert.ok(white.l > 0.99 && white.c < 0.005, 'white is as light as it gets, and colourless')
  const tint = oklch('#F0F4FF')
  assert.ok(tint.l > 0.95 && tint.c < 0.03, 'a near-white tint carries almost no chroma')
  assert.ok(oklch('#0053FD').c > tint.c * 5, 'a saturated blue is far more colourful than a tint')
  // HSL reported this pair as equally "saturated"; Oklab separates them.
  assert.ok(oklch('#E795BE').l > 0.7, 'a pastel accent is genuinely light')
})

test('the grouping lens persists, and defaults to the scene view', async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage, true)
  const { readGroupMode, writeGroupMode, GROUP_MODES } = plugin.__test

  assert.deepEqual(Array.from(GROUP_MODES), ['scene', 'theme', 'pack'])
  assert.equal(readGroupMode(), 'scene', 'default lens is the scene grouping')
  assert.equal(writeGroupMode('theme'), true)
  assert.equal(storage.get('chroma-group-mode-v1'), 'theme')
  assert.equal(readGroupMode(), 'theme', 'the choice survives a remount')
  assert.equal(writeGroupMode('pack'), true)
  assert.equal(storage.get('chroma-group-mode-v1'), 'pack')
  assert.equal(readGroupMode(), 'pack', 'the pack lens survives a remount')
  assert.equal(writeGroupMode('theme'), true)
  assert.equal(writeGroupMode('nonsense'), false, 'an unknown lens is refused')
  assert.equal(readGroupMode(), 'theme', 'a refused write leaves the stored value alone')
  storage.set('chroma-group-mode-v1', 'garbage')
  assert.equal(readGroupMode(), 'scene', 'a corrupt value falls back to scenes instead of throwing')
})

test('active variant names resolve to their dynamic scene card', async () => {
  const plugin = await loadPlugin(new Map(), true)

  assert.equal(plugin.__test.sceneNameFor('theme-picker-alabaster-light'), 'alabaster')
  assert.equal(plugin.__test.sceneNameFor('alabaster'), 'alabaster')
  assert.equal(plugin.__test.sceneNameFor('theme-picker-dark-aubergine-light'), 'dark-aubergine')
  assert.equal(plugin.__test.sceneNameFor('theme-picker-dark-aubergine-dark'), 'dark-aubergine')
  assert.equal(plugin.__test.sceneNameFor('unknown-theme'), 'unknown-theme')
})

// --- Apply: the provider paints, Chroma only hands it a name and a mode ----
//
// applyDesktopTheme, syncDesktopState, renderedModeFor, mixesFor and
// NEUTRAL_CHROME are gone. Every assertion below is about what the PROVIDER was
// told or what Chroma's own record holds -- plus, every time, that Chroma
// painted nothing. The old assertions on the root dataset and on
// `--theme-*-seed` are not convertible: they were the second painter.

test("applying a scene hands the switch to Desktop's ThemeProvider and paints nothing itself", async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage, true)
  const scene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  const { provider, calls } = providerStub()
  mountProvider(plugin, provider)
  let active = null

  const sync = plugin.__test.applyScene(scene, 'dark', value => { active = value })

  // The hand-off is synchronous: the surface moves without waiting for a network.
  assert.deepEqual(calls, [['theme', 'alabaster'], ['mode', 'dark']])
  assert.equal(provider.themeName, 'alabaster')
  assert.equal(provider.mode, 'dark')

  await sync

  // After the acknowledgement Chroma may re-assert, but only ever with the
  // scene's own name and mode -- never a transport variant, never a palette.
  assert.ok(isSceneNameOnly(calls, 'alabaster'), `a variant name reached the provider: ${JSON.stringify(calls)}`)
  assert.deepEqual([...new Set(calls.map(call => call.join(' ')))], ['theme alabaster', 'mode dark'])

  assert.equal(active, 'alabaster', 'the card is marked')
  assert.equal(plugin.__state.reloads, 0, 'the picker is never reloaded out from under the user')

  // Chroma's own record of the pick, for its next boot.
  assert.deepEqual(appearanceOf(storage), { default: { theme: 'alabaster', mode: 'dark' } })
  for (const key of APP_KEYS) {
    assert.equal(storage.has(key), false, `applyScene must not write ${key}`)
  }
  assertNotPainted(plugin)
})

test('applying a dynamic scene hands off first, then broadcasts its selected variant', async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage, true)
  const scene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  const { provider, calls } = providerStub()
  mountProvider(plugin, provider)

  const darkSync = plugin.__test.applyScene(scene, 'dark', () => {})
  assert.deepEqual(calls, [['theme', 'alabaster'], ['mode', 'dark']], 'the surface moves before the network is touched')
  assert.deepEqual(plugin.__state.requests, [], 'and no request has gone out yet')
  await darkSync

  assert.deepEqual(plugin.__state.requests.map(request => request.payload.value), ['theme-picker-alabaster-dark'])
  // The broadcast applied the concrete transport variant; the dynamic scene
  // name is re-asserted so the card, the chip and the lightbulb keep pointing
  // at the scene the user actually picked.
  assert.deepEqual(calls.slice(-2), [['theme', 'alabaster'], ['mode', 'dark']])
  assert.deepEqual(appearanceOf(storage), { default: { theme: 'alabaster', mode: 'dark' } })

  const lightSync = plugin.__test.applyScene(scene, 'light', () => {})
  assert.equal(provider.mode, 'light')
  await lightSync

  assert.deepEqual(
    plugin.__state.requests.map(request => request.payload.value),
    ['theme-picker-alabaster-dark', 'theme-picker-alabaster-light']
  )
  assert.equal(plugin.__state.reloads, 0)
  assert.deepEqual(plugin.__state.notifications, [])
  assertNotPainted(plugin)
})

// --- F5: apply scope -------------------------------------------------------
//
// Per-profile Desktop themes are the Desktop's own behaviour; Chroma inherits
// them by applying through setTheme. What flattens a per-profile choice is OUR
// gateway broadcast, so the scope decides only whether that broadcast happens.
//
// The NEGATIVE assertion is the whole feature. A test that only proved the
// everywhere case would pass unchanged on a build where the scope did nothing.

test('a profile-scoped pick still hands off to the provider and sends NO gateway broadcast', async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage, true)
  const scene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  const { provider, calls } = providerStub()
  mountProvider(plugin, provider)

  plugin.__test.writeApplyScope('default', plugin.__test.APPLY_SCOPE_LOCAL)
  assert.equal(plugin.__test.readApplyScope('default'), plugin.__test.APPLY_SCOPE_LOCAL)

  await plugin.__test.applyScene(scene, 'dark', () => {})

  assert.deepEqual(
    plugin.__state.requests,
    [],
    'a locally scoped pick must not touch the gateway at all'
  )
  // The local half still has to work: the provider must actually be told.
  assert.deepEqual(calls, [['theme', 'alabaster'], ['mode', 'dark']], 'exactly one hand-off, and nothing after it')
  assert.equal(provider.themeName, 'alabaster')
  assert.deepEqual(appearanceOf(storage), { default: { theme: 'alabaster', mode: 'dark' } })
})

test('the default scope is unchanged, so an existing pick still broadcasts', async () => {
  const plugin = await loadPlugin(new Map(), true)
  const scene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  const { provider } = providerStub()
  mountProvider(plugin, provider)

  // Nothing written: this is the state every existing user is in.
  assert.equal(plugin.__test.readApplyScope('default'), plugin.__test.APPLY_SCOPE_EVERYWHERE)

  await plugin.__test.applyScene(scene, 'dark', () => {})

  assert.deepEqual(
    plugin.__state.requests.map(request => request.payload.value),
    ['theme-picker-alabaster-dark']
  )
})

test('the scope is remembered per profile, not globally', async () => {
  const plugin = await loadPlugin(new Map(), true)
  plugin.__test.writeApplyScope('default', plugin.__test.APPLY_SCOPE_LOCAL)

  assert.equal(plugin.__test.readApplyScope('default'), plugin.__test.APPLY_SCOPE_LOCAL)
  assert.equal(
    plugin.__test.readApplyScope('work'),
    plugin.__test.APPLY_SCOPE_EVERYWHERE,
    'scoping one profile must not scope another'
  )
})

test('clearing the scope restores the broadcast', async () => {
  const plugin = await loadPlugin(new Map(), true)
  const scene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  const { provider, calls } = providerStub()
  mountProvider(plugin, provider)

  plugin.__test.writeApplyScope('default', plugin.__test.APPLY_SCOPE_LOCAL)
  await plugin.__test.applyScene(scene, 'dark', () => {})
  assert.equal(plugin.__state.requests.length, 0)
  assert.deepEqual(calls, [['theme', 'alabaster'], ['mode', 'dark']], 'scoped: a hand-off and no broadcast')

  plugin.__test.writeApplyScope('default', plugin.__test.APPLY_SCOPE_EVERYWHERE)
  await plugin.__test.applyScene(scene, 'light', () => {})
  assert.equal(
    plugin.__state.requests.length,
    1,
    'switching back to Everywhere must resume broadcasting'
  )
  assert.equal(provider.mode, 'light')
})

test('rapid scene changes preserve gateway request order while the surface keeps up', async () => {
  let releaseFirst
  let requestCount = 0
  const firstRequest = new Promise(resolve => { releaseFirst = resolve })
  const plugin = await loadPlugin(new Map(), true, () => {
    requestCount += 1
    return requestCount === 1 ? firstRequest : Promise.resolve({})
  })
  const scene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  const { provider } = providerStub()
  mountProvider(plugin, provider)

  const darkSync = plugin.__test.applyScene(scene, 'dark', () => {})
  const lightSync = plugin.__test.applyScene(scene, 'light', () => {})

  assert.equal(provider.mode, 'light', 'the second pick is on screen at once, gateway or no gateway')
  await Promise.resolve()
  assert.equal(plugin.__state.requests.length, 1)

  releaseFirst({})
  await Promise.all([darkSync, lightSync])
  assert.deepEqual(
    plugin.__state.requests.map(request => request.payload.value),
    ['theme-picker-alabaster-dark', 'theme-picker-alabaster-light']
  )
  assert.equal(provider.themeName, 'alabaster', 'the late acknowledgement must not drag the surface back')
  assert.equal(provider.mode, 'light')
})

test('queued gateway changes never leak into a different active profile', async () => {
  let profile = 'default'
  let releaseFirst
  const firstRequest = new Promise(resolve => { releaseFirst = resolve })
  let requestCount = 0
  const storage = new Map()
  const plugin = await loadPlugin(
    storage,
    true,
    () => {
      requestCount += 1
      return requestCount === 1 ? firstRequest : Promise.resolve({})
    },
    () => profile
  )
  const scene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  const { provider } = providerStub()
  mountProvider(plugin, provider)

  const first = plugin.__test.applyScene(scene, 'dark', () => {})
  await Promise.resolve()
  const stale = plugin.__test.applyScene(scene, 'light', () => {})
  profile = 'work'
  const current = plugin.__test.applyScene(scene, 'dark', () => {})

  await Promise.resolve()
  releaseFirst({})
  await Promise.all([first, stale, current])

  assert.deepEqual(
    plugin.__state.requests.map(request => request.payload.value),
    ['theme-picker-alabaster-dark', 'theme-picker-alabaster-dark']
  )
  // The stale light pick belonged to `default`. It must not become the record
  // of the profile the user is in now.
  assert.deepEqual(appearanceOf(storage).work, { theme: 'alabaster', mode: 'dark' })
  assert.equal(provider.mode, 'dark', 'and the surface ends on the pick that belongs to this profile')
})

test('a failure for a profile that is no longer active does not reach the live surface', async () => {
  let activeProfile = 'default'
  let rejectRequest
  const pending = new Promise((_resolve, reject) => { rejectRequest = reject })
  const storage = new Map()
  const plugin = await loadPlugin(storage, true, () => pending, () => activeProfile)
  const scene = plugin.__test.scenes.find(item => item.name === 'dark-aubergine')
  const { provider, calls } = providerStub()
  mountProvider(plugin, provider)

  const sync = plugin.__test.applyScene(scene, 'dark', () => {})
  await Promise.resolve()
  activeProfile = 'work'
  rejectRequest(new Error('old profile request failed'))
  await sync

  // The only hand-off was the user's own click, taken while `default` was
  // active. A late failure in that profile must not be re-asserted into the
  // one the user has switched to.
  assert.deepEqual(calls, [['theme', 'dark-aubergine'], ['mode', 'dark']])
  assert.equal(provider.themeName, 'dark-aubergine')
  assert.deepEqual(appearanceOf(storage).default, { theme: 'dark-aubergine', mode: 'dark' })
  assert.equal(
    Object.prototype.hasOwnProperty.call(appearanceOf(storage), 'work'),
    false,
    'a failed request must not write a record for a profile it was never for'
  )
})

test('an acknowledgement for an abandoned profile hands the newly active profile back to the provider', async () => {
  let activeProfile = 'default'
  let resolveOldRequest
  let resolveCurrentRequest
  const oldRequest = new Promise(resolve => { resolveOldRequest = resolve })
  const currentRequest = new Promise(resolve => { resolveCurrentRequest = resolve })
  let requestCount = 0
  const storage = new Map()
  const plugin = await loadPlugin(storage, true, () => {
    requestCount += 1
    if (requestCount === 1) return oldRequest
    return currentRequest
  }, () => activeProfile)
  const oldScene = plugin.__test.scenes.find(item => item.name === 'dark-aubergine')
  const currentScene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  const { provider, calls } = providerStub()
  mountProvider(plugin, provider)

  const oldSync = plugin.__test.applyScene(oldScene, 'dark', () => {})
  await Promise.resolve()
  activeProfile = 'work'
  const currentSync = plugin.__test.applyScene(currentScene, 'light', () => {})

  // config.set broadcasts before resolving, so the old profile's transport
  // lands last on the live surface. Chroma cannot repaint it away any more, so
  // it has to hand the ACTIVE profile's choice back to the provider instead.
  // The corruption is SIMULATED: without it the assertions below would only
  // re-state what the click already did.
  provider.themeName = oldScene.gatewayDarkName || 'dark-aubergine-dark'
  resolveOldRequest({})
  await oldSync

  assert.deepEqual(calls.slice(-2), [['theme', 'alabaster'], ['mode', 'light']])
  assert.equal(provider.themeName, 'alabaster')
  assert.equal(provider.mode, 'light')
  assert.deepEqual(appearanceOf(storage).work, { theme: 'alabaster', mode: 'light' })
  assert.deepEqual(plugin.__state.notifications, [])
  assert.equal(plugin.__state.requests.length, 2)

  resolveCurrentRequest({})
  await currentSync
})

test('an acknowledgement restores a switched profile from its pre-request persisted appearance', async () => {
  let activeProfile = 'default'
  let resolveRequest
  const pending = new Promise(resolve => { resolveRequest = resolve })
  const storage = new Map([
    [APPEARANCE_KEY, JSON.stringify({ work: { theme: 'alabaster', mode: 'light' } })]
  ])
  const plugin = await loadPlugin(storage, true, () => pending, () => activeProfile)
  const oldScene = plugin.__test.scenes.find(item => item.name === 'dark-aubergine')
  const { provider, calls } = providerStub()
  mountProvider(plugin, provider)

  const oldSync = plugin.__test.applyScene(oldScene, 'dark', () => {})
  await Promise.resolve()
  activeProfile = 'work'

  // The old request's broadcast corrupts the newly active surface before its
  // RPC acknowledges. No new theme click occurs in `work`. The corruption is
  // simulated here; without it the restore cannot be observed.
  provider.themeName = oldScene.gatewayDarkName || 'dark-aubergine-dark'
  resolveRequest({})
  await oldSync

  assert.deepEqual(calls.slice(-2), [['theme', 'alabaster'], ['mode', 'light']])
  assert.equal(provider.themeName, 'alabaster')
  assert.equal(provider.mode, 'light')
  // And the recovery is durable: `work` keeps its own pick, not the stale one.
  assert.deepEqual(appearanceOf(storage).work, { theme: 'alabaster', mode: 'light' })
  assert.equal(plugin.__state.requests.length, 1)
  assert.deepEqual(plugin.__state.notifications, [])
  assertNotPainted(plugin)
})

test('a gateway acknowledgement re-asserts the dynamic scene name, not the concrete variant', async () => {
  const storage = new Map()
  // The broadcast paints the CONCRETE transport skin before the RPC resolves.
  // Without simulating that, this test would assert a value the click had already
  // set and would stay green with the restore deleted.
  let liveProvider = null
  const plugin = await loadPlugin(storage, true, (_method, payload) => {
    storage.set(APP_THEME_KEY, payload.value)
    if (liveProvider) liveProvider.themeName = payload.value
    return Promise.resolve({})
  })
  const scene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  const { provider } = providerStub()
  liveProvider = provider
  mountProvider(plugin, provider)

  await plugin.__test.applyScene(scene, 'light', () => {})

  assert.equal(
    storage.get(APP_THEME_KEY),
    'theme-picker-alabaster-light',
    "the app's key is the app's to write; Chroma does not rewrite it"
  )
  assert.equal(storage.has(APP_MODE_KEY), false, 'and does not invent the mode key either')
  assert.equal(provider.themeName, 'alabaster')
  assert.equal(provider.mode, 'light')
  assert.deepEqual(appearanceOf(storage), { default: { theme: 'alabaster', mode: 'light' } })
})

test('every dark pick of a dynamic scene ends with the provider holding that scene, in dark', async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage, true)
  const dynamicScenes = plugin.__test.scenes.filter(item => item.modeSupport === 'dynamic')
  assert.ok(dynamicScenes.length > 0, 'fixture: the catalog has dynamic scenes')
  const { provider, calls } = providerStub()
  mountProvider(plugin, provider)

  for (const scene of dynamicScenes) {
    const before = calls.length
    await plugin.__test.applyScene(scene, 'dark', () => {})

    assert.ok(calls.length > before, `${scene.name}: nothing was handed to the provider`)
    // The click itself, before any acknowledgement...
    assert.deepEqual(calls.slice(before, before + 2), [['theme', scene.name], ['mode', 'dark']], scene.name)
    // ...and the same pair after it, never a transport variant or the light half.
    assert.deepEqual(calls.slice(-2), [['theme', scene.name], ['mode', 'dark']], scene.name)
    assert.equal(provider.themeName, scene.name, scene.name)
    assert.equal(provider.mode, 'dark', scene.name)
    assert.deepEqual(appearanceOf(storage).default, { theme: scene.name, mode: 'dark' }, scene.name)
    assertNotPainted(plugin)
  }
})

test('a gateway failure keeps the hand-off and reports a warning', async () => {
  const storage = new Map()
  const plugin = await loadPlugin(
    storage,
    true,
    () => Promise.reject(new Error('gateway unavailable'))
  )
  const scene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  const { provider } = providerStub()
  mountProvider(plugin, provider)

  const synchronized = await plugin.__test.applyScene(scene, 'dark', () => {})

  assert.equal(synchronized, false)
  // The switch itself did land: the gateway is a second surface, not the one
  // the user is looking at.
  assert.equal(provider.themeName, 'alabaster')
  assert.equal(provider.mode, 'dark')
  assert.deepEqual(appearanceOf(storage), { default: { theme: 'alabaster', mode: 'dark' } })
  assert.equal(plugin.__state.notifications.at(-1).kind, 'warning')
  assert.match(plugin.__state.notifications.at(-1).message, /connected gateway could not apply/)
  assertNotPainted(plugin)
})

test('a stale acknowledgement cannot replace the latest pick when the latest gateway request fails', async () => {
  let releaseFirst
  const firstRequest = new Promise(resolve => { releaseFirst = resolve })
  let requestCount = 0
  const storage = new Map()
  const plugin = await loadPlugin(storage, true, () => {
    requestCount += 1
    return requestCount === 1 ? firstRequest : Promise.reject(new Error('latest request failed'))
  })
  const staleScene = plugin.__test.scenes.find(item => item.name === 'dark-aubergine')
  const latestScene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  const { provider, calls } = providerStub()
  mountProvider(plugin, provider)

  const stale = plugin.__test.applyScene(staleScene, 'dark', () => {})
  await Promise.resolve()
  const latest = plugin.__test.applyScene(latestScene, 'light', () => {})

  releaseFirst({})
  await Promise.all([stale, latest])

  // The stale acknowledgement re-asserts the LATEST selection, and the latest
  // request's failure re-asserts it again: the user's last pick survives both.
  assert.equal(provider.themeName, 'alabaster')
  assert.equal(provider.mode, 'light')
  assert.deepEqual(calls.slice(-2), [['theme', 'alabaster'], ['mode', 'light']])
  assert.deepEqual(appearanceOf(storage).default, { theme: 'alabaster', mode: 'light' })
  // Never the abandoned scene, once the latest pick has been handed over.
  const latestAt = calls.map(call => call[1]).lastIndexOf('alabaster')
  assert.equal(
    calls.slice(latestAt).some(call => call[1] === 'dark-aubergine'),
    false,
    'the abandoned scene was handed over again after the latest pick'
  )
  assertNotPainted(plugin)
})

test('post-acknowledgement persistence failure warns that the record is not durable', async () => {
  const stored = new Map()
  let blockAppearance = false
  const partialStorage = {
    get: key => stored.get(key) ?? null,
    set: (key, value) => {
      if (blockAppearance && key === APPEARANCE_KEY) throw new Error('appearance write blocked')
      stored.set(key, value)
    }
  }
  const plugin = await loadPlugin(partialStorage, true, (_method, _payload) => {
    blockAppearance = true
    return Promise.resolve({})
  })
  const scene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  const { provider } = providerStub()
  mountProvider(plugin, provider)

  await plugin.__test.applyScene(scene, 'dark', () => {})

  assert.equal(provider.themeName, 'alabaster', 'the session applied the scene')
  assert.equal(
    stored.get(APPEARANCE_KEY),
    JSON.stringify({ default: { theme: 'alabaster', mode: 'dark' } }),
    'the click itself was saved before the gateway ran'
  )
  assert.equal(plugin.__state.notifications.at(-1).kind, 'warning')
  assert.match(plugin.__state.notifications.at(-1).message, /appearance record could not be saved for restart/)
})

test('a storage failure still applies the switch for the session, and says so', async () => {
  const blockedStorage = {
    get: () => { throw new Error('storage blocked') },
    set: () => { throw new Error('storage blocked') }
  }
  const plugin = await loadPlugin(blockedStorage, true)
  const scene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  const { provider } = providerStub()
  mountProvider(plugin, provider)
  let active = null

  assert.doesNotThrow(() => plugin.register({ register: () => {} }))
  await assert.doesNotReject(() => plugin.__test.applyScene(scene, 'light', value => { active = value }))

  // Nothing about the hand-off depends on localStorage: the surface still moves.
  assert.equal(provider.themeName, 'alabaster')
  assert.equal(provider.mode, 'light')
  assert.equal(active, 'alabaster')
  assert.equal(plugin.__state.reloads, 0)
  assert.ok(
    plugin.__state.notifications.some(note =>
      note.kind === 'warning' && /could not be saved for restart/.test(note.message)),
    `expected a "could not be saved" warning, got ${JSON.stringify(plugin.__state.notifications)}`
  )
  assertNotPainted(plugin)
})

// --- No provider at all ----------------------------------------------------
//
// Outside React (before the hook has captured anything) the SDK's requestTheme
// is the same door: it resolves the name and the provider drains the queue when
// it mounts. What Chroma must NOT do is paint, and what it must not do either is
// pretend a switch landed when no door existed.

test('with no provider captured yet the switch is queued through the SDK instead of painted', async () => {
  const storage = new Map()
  const queued = []
  const plugin = await loadPlugin(storage, true, null, () => 'default', name => {
    queued.push(name)
    return true
  })
  const scene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  let active = null

  await plugin.__test.applyScene(scene, 'light', value => { active = value })

  assert.ok(queued.length > 0, 'the SDK door was never used')
  assert.deepEqual([...new Set(queued)], ['alabaster'], 'only ever the scene name, never a variant or a palette')
  assert.deepEqual(appearanceOf(storage), { default: { theme: 'alabaster', mode: 'light' } })
  assert.equal(active, 'alabaster')
  assert.equal(plugin.__state.reloads, 0)
  assertNotPainted(plugin)
})

test('a switch nothing can receive is reported, and changes nothing', async () => {
  const storage = new Map()
  // No consumer mounted, and this host has no requestTheme queue to drain.
  const plugin = await loadPlugin(storage, true)
  const scene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  let active = null

  const applied = await plugin.__test.applyScene(scene, 'dark', value => { active = value })

  assert.equal(applied, false)
  assert.equal(active, null, 'a card must not look applied when nothing was')
  assert.equal(storage.has(APPEARANCE_KEY), false, "and a lost switch is not recorded as the user's choice")
  assert.deepEqual(plugin.__state.requests, [], 'nothing may be broadcast for a pick that never landed')
  assert.equal(plugin.__state.notifications.at(-1).kind, 'error')
  assert.match(plugin.__state.notifications.at(-1).message, /could not be handed to Desktop/)
  assertNotPainted(plugin)
})

test('a scene Desktop does not list is refused instead of being coerced to the default skin', async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage, true)
  const scene = plugin.__test.scenes.find(item => item.name === 'alabaster')
  const { provider, calls } = providerStub({
    availableThemes: [
      { name: 'nous', label: 'Nous' },
      { name: 'midnight', label: 'Midnight' }
    ]
  })
  mountProvider(plugin, provider)
  let active = null

  const applied = await plugin.__test.applyScene(scene, 'dark', value => { active = value })

  assert.equal(applied, false)
  assert.deepEqual(calls, [], 'the host would coerce an unknown name to its default skin and PERSIST that')
  assert.equal(active, null)
  assert.equal(storage.has(APPEARANCE_KEY), false)
  assert.deepEqual(plugin.__state.requests, [])
  assert.equal(plugin.__state.notifications.at(-1).kind, 'warning')
  assert.match(plugin.__state.notifications.at(-1).message, /is not registered with Desktop yet/)
  assertNotPainted(plugin)
})

test('the self-contained plugin never fetches remote theme fonts', async () => {
  const source = await readFile(pluginPath, 'utf8')

  assert.doesNotMatch(source, /fonts\.googleapis\.com|fonts\.gstatic\.com/)
})

test("deleting a skin forgets its local scene and its stored theme", async () => {
  // Field bug: the backend record was deleted and the card stayed on screen,
  // because the pane's own copies (IMPORTED_SKINS + the stored theme) were never
  // purged. A delete must leave no local trace.
  // Seeded BEFORE load: the store is read (and its one-shot marker set) at boot.
  const storage = new Map([[THEMES_KEY, JSON.stringify({
    'ghost-skin': { name: 'ghost-skin', themePickerSource: 'owned' },
    'kept-skin': { name: 'kept-skin', themePickerSource: 'owned' }
  })]])
  const plugin = await loadPlugin(storage, true)
  const helpers = plugin.__test
  helpers.IMPORTED_SKINS.push({ name: 'ghost-skin', label: 'Ghost', colors: { background: '#101010' } })

  helpers.forgetScene('ghost-skin')

  assert.equal(helpers.IMPORTED_SKINS.some(scene => scene.name === 'ghost-skin'), false)
  const stored = JSON.parse(storage.get(THEMES_KEY))
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'ghost-skin'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'kept-skin'), true, 'other skins survive')
  assert.equal(storage.has(APP_USER_THEMES), false, "and the app's user-theme store is left alone")
})
