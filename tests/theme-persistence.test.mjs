import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const USER_THEMES_KEY = 'hermes-desktop-user-themes-v1'
const pluginPath = new URL('../desktop/plugin.js', import.meta.url)

function loadPlugin(storage, exposeTestHelpers = false, requestHandler = null, profileGetter = () => 'default') {
  return readFile(pluginPath, 'utf8').then(source => {
    let executable = source
      .replace(/import\s+\{[\s\S]*?\}\s+from\s+'@hermes\/plugin-sdk'\n/, '')
      .replace(/import\s+\{[^}]*\}\s+from\s+'react\/jsx-runtime'\n/, '')
      .replace(/import\s+\{[^}]*\}\s+from\s+'react'\n/, '')
      .replace('export default {', 'globalThis.plugin = {')
    if (exposeTestHelpers) {
      executable += '\nglobalThis.testHelpers = { buildThemeGroups, buildGroups, buildCategoryGroups, sceneCategory, oklch, normaliseHex, readGroupMode, writeGroupMode, GROUP_MODES, THEME_CATEGORIES, persistAppearance, sceneNameFor, sceneToDesktopTheme, desktopModeFor, applyScene, readApplyScope, writeApplyScope, APPLY_SCOPE_LOCAL, APPLY_SCOPE_EVERYWHERE, cardMinFor, cardAspect, cardShapeClasses, readCardShape, writeCardShape, CARD_MIN, CARD_SHAPES, scenes: SKINS }\n'
    }

    const css = new Map()
    const state = { reloads: 0, active: null, notifications: [], requests: [], css, root: null }
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

test('registering the picker seeds every contributed skin for boot-time theme resolution', async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage)
  const contributed = []

  plugin.register({
    register: contribution => {
      if (contribution.id.startsWith('theme:')) contributed.push(contribution.data)
    }
  })

  const persisted = JSON.parse(storage.get(USER_THEMES_KEY) ?? '{}')
  assert.ok(contributed.length > 0)
  for (const theme of contributed) {
    assert.equal(JSON.stringify(persisted[theme.name]), JSON.stringify(theme))
    assert.ok(['background', 'foreground', 'primary'].every(key => typeof persisted[theme.name].colors[key] === 'string'))
  }
})

test('registration upgrades legacy single-palette picker themes to dynamic scenes', async () => {
  const catalog = await loadPlugin(new Map(), true)
  const scene = catalog.__test.scenes.find(item => item.name === 'shadow-thief')
  const expected = catalog.__test.sceneToDesktopTheme(scene)
  assert.equal(expected.darkColors.input, '#101014')
  const legacy = {
    'shadow-thief': {
      name: 'shadow-thief',
      label: 'Shadow-thief',
      description: scene.description,
      colors: expected.darkColors,
      darkColors: expected.darkColors
    }
  }
  const storage = new Map([[USER_THEMES_KEY, JSON.stringify(legacy)]])
  const plugin = await loadPlugin(storage)

  plugin.register({ register: () => {} })

  const upgraded = JSON.parse(storage.get(USER_THEMES_KEY))['shadow-thief']
  assert.equal(upgraded.themePickerManaged, true)
  assert.notEqual(upgraded.colors.background, upgraded.darkColors.background)
})

test('registration preserves dark mode when upgrading a selected canonical dark source theme', async () => {
  const catalog = await loadPlugin(new Map(), true)
  const scene = catalog.__test.scenes.find(item => item.name === 'dark-aubergine')
  const combined = catalog.__test.sceneToDesktopTheme(scene)
  const legacy = {
    ...combined,
    label: 'Dark-aubergine',
    colors: combined.darkColors,
    darkColors: combined.darkColors,
    themePickerManaged: undefined
  }
  const storage = new Map([
    [USER_THEMES_KEY, JSON.stringify({ 'dark-aubergine': legacy })],
    ['hermes-desktop-theme-v2', 'dark-aubergine'],
    ['hermes-desktop-mode-v1', 'light'],
    ['hermes-desktop-profile-themes-v1', JSON.stringify({ work: 'dark-aubergine' })],
    ['hermes-desktop-profile-modes-v1', JSON.stringify({ work: 'light' })]
  ])
  const plugin = await loadPlugin(storage)

  plugin.register({ register: () => {} })

  assert.equal(storage.get('hermes-desktop-theme-v2'), 'dark-aubergine')
  assert.equal(storage.get('hermes-desktop-mode-v1'), 'dark')
  assert.equal(JSON.parse(storage.get('hermes-desktop-profile-modes-v1')).work, 'dark')
  const upgraded = JSON.parse(storage.get(USER_THEMES_KEY))['dark-aubergine']
  assert.notEqual(upgraded.colors.background, upgraded.darkColors.background)
})

test('registration does not force a current combined scene from light to dark', async () => {
  const catalog = await loadPlugin(new Map(), true)
  const scene = catalog.__test.scenes.find(item => item.name === 'dark-aubergine')
  const combined = catalog.__test.sceneToDesktopTheme(scene)
  const storage = new Map([
    [USER_THEMES_KEY, JSON.stringify({ 'dark-aubergine': combined })],
    ['hermes-desktop-theme-v2', 'dark-aubergine'],
    ['hermes-desktop-mode-v1', 'light']
  ])
  const plugin = await loadPlugin(storage)

  plugin.register({ register: () => {} })

  assert.equal(storage.get('hermes-desktop-theme-v2'), 'dark-aubergine')
  assert.equal(storage.get('hermes-desktop-mode-v1'), 'light')
})

test('registration never overwrites an unrelated single-palette user import', async () => {
  const palette = { background: '#111111', foreground: '#eeeeee' }
  const imported = {
    name: 'dark-aubergine',
    label: 'My Aubergine',
    description: 'Personal imported theme',
    colors: palette,
    darkColors: palette
  }
  const storage = new Map([[USER_THEMES_KEY, JSON.stringify({
    'dark-aubergine': imported
  })]])
  const plugin = await loadPlugin(storage)

  plugin.register({ register: () => {} })

  const cached = JSON.parse(storage.get(USER_THEMES_KEY))
  assert.deepEqual(cached['dark-aubergine'], imported)
})

test('legacy migration never overwrites a same-signature user import with a different palette', async () => {
  const catalog = await loadPlugin(new Map(), true)
  const scene = catalog.__test.scenes.find(item => item.name === 'dark-aubergine')
  const combined = catalog.__test.sceneToDesktopTheme(scene)
  const palette = { ...combined.darkColors, background: '#123456', foreground: '#fedcba' }
  const imported = {
    ...combined,
    label: 'Dark-aubergine',
    colors: palette,
    darkColors: palette,
    themePickerManaged: undefined
  }
  const storage = new Map([
    [USER_THEMES_KEY, JSON.stringify({ 'dark-aubergine': imported })],
    ['hermes-desktop-theme-v2', 'dark-aubergine'],
    ['hermes-desktop-mode-v1', 'light'],
    ['hermes-desktop-profile-themes-v1', JSON.stringify({ work: 'dark-aubergine' })],
    ['hermes-desktop-profile-modes-v1', JSON.stringify({ work: 'light' })]
  ])
  const plugin = await loadPlugin(storage)

  plugin.register({ register: () => {} })

  assert.equal(storage.get('hermes-desktop-mode-v1'), 'light')
  assert.equal(JSON.parse(storage.get('hermes-desktop-profile-modes-v1')).work, 'light')
  assert.deepEqual(
    JSON.parse(storage.get(USER_THEMES_KEY))['dark-aubergine'],
    JSON.parse(JSON.stringify(imported))
  )
})

test('registration migrates a selected variant to its dynamic scene and mode', async () => {
  const storage = new Map([
    ['hermes-desktop-theme-v2', 'light-lilac'],
    ['hermes-desktop-mode-v1', 'dark']
  ])
  const plugin = await loadPlugin(storage)

  plugin.register({ register: () => {} })

  assert.equal(storage.get('hermes-desktop-theme-v2'), 'shadow-thief')
  assert.equal(storage.get('hermes-desktop-mode-v1'), 'light')
})

test('registration migrates a gateway transport variant back to its dynamic scene', async () => {
  const storage = new Map([
    ['hermes-desktop-theme-v2', 'theme-picker-nous-dark'],
    ['hermes-desktop-mode-v1', 'light']
  ])
  const plugin = await loadPlugin(storage)

  plugin.register({ register: () => {} })

  assert.equal(storage.get('hermes-desktop-theme-v2'), 'nous')
  assert.equal(storage.get('hermes-desktop-mode-v1'), 'dark')
})

test('active variant names resolve to their dynamic scene card', async () => {
  const plugin = await loadPlugin(new Map(), true)

  assert.equal(plugin.__test.sceneNameFor('light-lilac'), 'shadow-thief')
  assert.equal(plugin.__test.sceneNameFor('shadow-thief'), 'shadow-thief')
  assert.equal(plugin.__test.sceneNameFor('theme-picker-nous-light'), 'nous')
  assert.equal(plugin.__test.sceneNameFor('theme-picker-nous-dark'), 'nous')
  assert.equal(plugin.__test.sceneNameFor('unknown-theme'), 'unknown-theme')
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

test('themes are grouped as dynamic, dark-only, then light-only', async () => {
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
    ['Dynamic Scenes', 'Dark Mode Only', 'Light Mode Only']
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

test('the classifier reads perceptual lightness and chroma, and pastel is a colour', async () => {
  const plugin = await loadPlugin(new Map(), true)
  const { sceneCategory, oklch } = plugin.__test
  const scene = (accent, modeSupport) => ({ name: 'x', modeSupport: modeSupport || 'dynamic', lightColors: { ui_accent: accent } })

  // Pastel is high perceptual lightness with real but low chroma - the tint
  // family. These are the accents of the five pastel skins.
  assert.equal(sceneCategory(scene('#E795BE')), 'pastels', 'a pale pink')
  assert.equal(sceneCategory(scene('#9CD3BA')), 'pastels', 'a pale mint')
  assert.equal(sceneCategory(scene('#EFD292')), 'pastels', 'a pale butter')
  assert.equal(sceneCategory(scene('#A9C6E6')), 'pastels', 'a pale powder blue')

  // A pastel is not simply "a pink": the same hue, deepened, stops being pastel.
  assert.equal(sceneCategory(scene('#B91C1C')), 'vibrant', 'a crimson is loud, not pastel')
  assert.equal(sceneCategory(scene('#2F855A')), 'nature', 'a forest green')
  assert.equal(sceneCategory(scene('#22C55E')), 'vibrant', 'a neon green is synthetic')
  assert.equal(sceneCategory(scene('#0053FD')), 'vibrant', 'a saturated blue')
  assert.equal(sceneCategory(scene('#5B7BB5')), 'cool', 'a muted blue still reads blue')
  assert.equal(sceneCategory(scene('#C05621')), 'warm', 'an orange')
  assert.equal(sceneCategory(scene('#1E293B')), 'muted', 'a slate with only a trace of blue')
  assert.equal(sceneCategory(scene('#808080')), 'minimal', 'grey has no hue to file')

  assert.equal(sceneCategory(scene('#E795BE', 'dark')), 'dark', 'a dark-only scene files by its mode')
  assert.equal(sceneCategory(scene('#E795BE', 'light')), 'light')
  assert.equal(sceneCategory({ name: 'bare', modeSupport: 'dynamic' }), 'minimal', 'a scene with no palette still files somewhere')

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

  assert.deepEqual(Array.from(GROUP_MODES), ['scene', 'theme'])
  assert.equal(readGroupMode(), 'scene', 'default lens is the scene grouping')
  assert.equal(writeGroupMode('theme'), true)
  assert.equal(storage.get('chroma-group-mode-v1'), 'theme')
  assert.equal(readGroupMode(), 'theme', 'the choice survives a remount')
  assert.equal(writeGroupMode('nonsense'), false, 'an unknown lens is refused')
  assert.equal(readGroupMode(), 'theme', 'a refused write leaves the stored value alone')
  storage.set('chroma-group-mode-v1', 'garbage')
  assert.equal(readGroupMode(), 'scene', 'a corrupt value falls back to scenes instead of throwing')
})

test('appearance persistence stores theme and explicit mode for the active profile', async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage, true)

  plugin.__test.persistAppearance('dark-example', 'dark', 'work')

  assert.deepEqual(JSON.parse(storage.get('hermes-desktop-profile-themes-v1')), { work: 'dark-example' })
  assert.deepEqual(JSON.parse(storage.get('hermes-desktop-profile-modes-v1')), { work: 'dark' })
})

test('desktop mode follows the rendered mode and falls back to the active profile', async () => {
  const storage = new Map([
    ['hermes-desktop-profile-modes-v1', JSON.stringify({ work: 'dark' })]
  ])
  const plugin = await loadPlugin(storage, true)

  assert.equal(plugin.__test.desktopModeFor('work', undefined), 'dark')
  assert.equal(plugin.__test.desktopModeFor('work', 'light'), 'light')
})

test('applying a scene repaints in place without reloading or leaving the picker', async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage, true)
  const scene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')
  let active = null

  plugin.__test.applyScene(scene, 'dark', value => { active = value })

  assert.equal(plugin.__state.reloads, 0)
  assert.equal(active, 'shadow-thief')
  assert.equal(plugin.__state.root.dataset.hermesTheme, 'shadow-thief')
  assert.equal(plugin.__state.root.dataset.hermesMode, 'dark')
  assert.ok(plugin.__state.css.has('--theme-primary'))
  assert.equal(storage.get('hermes-desktop-theme-v2'), 'shadow-thief')
  assert.equal(storage.get('hermes-desktop-mode-v1'), 'dark')
})

test('applying a dynamic scene immediately repaints locally and synchronizes its selected variant through the gateway', async () => {
  const plugin = await loadPlugin(new Map(), true)
  const scene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

  const darkSync = plugin.__test.applyScene(scene, 'dark', () => {})
  assert.equal(plugin.__state.root.dataset.hermesTheme, 'shadow-thief')
  await darkSync

  const lightSync = plugin.__test.applyScene(scene, 'light', () => {})
  assert.equal(plugin.__state.root.dataset.hermesMode, 'light')
  await lightSync

  assert.deepEqual(
    JSON.parse(JSON.stringify(plugin.__state.requests)),
    [
      { method: 'config.set', payload: { key: 'skin', value: 'theme-picker-shadow-thief-dark' } },
      { method: 'config.set', payload: { key: 'skin', value: 'theme-picker-shadow-thief-light' } }
    ]
  )
  assert.equal(plugin.__state.reloads, 0)
  assert.deepEqual(plugin.__state.notifications, [])
})

// --- F5: apply scope -------------------------------------------------------
//
// Per-profile Desktop themes are the Desktop's own behaviour; Chroma inherits
// them by applying through setTheme. What flattens a per-profile choice is OUR
// gateway broadcast, so the scope decides only whether that broadcast happens.
//
// The NEGATIVE assertion is the whole feature. A test that only proved the
// everywhere case would pass unchanged on a build where the scope did nothing.

test('a profile-scoped pick repaints locally and sends NO gateway broadcast', async () => {
  const plugin = await loadPlugin(new Map(), true)
  const scene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

  plugin.__test.writeApplyScope('default', plugin.__test.APPLY_SCOPE_LOCAL)
  assert.equal(plugin.__test.readApplyScope('default'), plugin.__test.APPLY_SCOPE_LOCAL)

  await plugin.__test.applyScene(scene, 'dark', () => {})

  assert.deepEqual(
    JSON.parse(JSON.stringify(plugin.__state.requests)),
    [],
    'a locally scoped pick must not touch the gateway at all'
  )
  // The local half still has to work: the theme must actually be applied.
  assert.equal(plugin.__state.root.dataset.hermesTheme, 'shadow-thief')
})

test('the default scope is unchanged, so an existing pick still broadcasts', async () => {
  const plugin = await loadPlugin(new Map(), true)
  const scene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

  // Nothing written: this is the state every existing user is in.
  assert.equal(plugin.__test.readApplyScope('default'), plugin.__test.APPLY_SCOPE_EVERYWHERE)

  await plugin.__test.applyScene(scene, 'dark', () => {})

  assert.deepEqual(
    plugin.__state.requests.map(request => request.payload.value),
    ['theme-picker-shadow-thief-dark']
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
  const scene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

  plugin.__test.writeApplyScope('default', plugin.__test.APPLY_SCOPE_LOCAL)
  await plugin.__test.applyScene(scene, 'dark', () => {})
  assert.equal(plugin.__state.requests.length, 0)

  plugin.__test.writeApplyScope('default', plugin.__test.APPLY_SCOPE_EVERYWHERE)
  await plugin.__test.applyScene(scene, 'light', () => {})
  assert.equal(
    plugin.__state.requests.length,
    1,
    'switching back to Everywhere must resume broadcasting'
  )
})

test('rapid scene changes preserve gateway request order while repainting locally immediately', async () => {
  let releaseFirst
  let requestCount = 0
  const firstRequest = new Promise(resolve => { releaseFirst = resolve })
  const plugin = await loadPlugin(new Map(), true, () => {
    requestCount += 1
    return requestCount === 1 ? firstRequest : Promise.resolve({})
  })
  const scene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

  const darkSync = plugin.__test.applyScene(scene, 'dark', () => {})
  const lightSync = plugin.__test.applyScene(scene, 'light', () => {})

  assert.equal(plugin.__state.root.dataset.hermesMode, 'light')
  await Promise.resolve()
  assert.equal(plugin.__state.requests.length, 1)

  releaseFirst({})
  await Promise.all([darkSync, lightSync])
  assert.deepEqual(
    plugin.__state.requests.map(request => request.payload.value),
    ['theme-picker-shadow-thief-dark', 'theme-picker-shadow-thief-light']
  )
})

test('queued gateway changes never leak into a different active profile', async () => {
  let profile = 'default'
  let releaseFirst
  const firstRequest = new Promise(resolve => { releaseFirst = resolve })
  let requestCount = 0
  const plugin = await loadPlugin(
    new Map(),
    true,
    () => {
      requestCount += 1
      return requestCount === 1 ? firstRequest : Promise.resolve({})
    },
    () => profile
  )
  const scene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

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
    ['theme-picker-shadow-thief-dark', 'theme-picker-shadow-thief-dark']
  )
})

test('an in-flight failure never repaints its old profile over the newly active profile', async () => {
  let activeProfile = 'default'
  let rejectRequest
  const pending = new Promise((_resolve, reject) => { rejectRequest = reject })
  const plugin = await loadPlugin(new Map(), true, () => pending, () => activeProfile)
  const scene = plugin.__test.scenes.find(item => item.name === 'nous')

  const sync = plugin.__test.applyScene(scene, 'dark', () => {})
  await Promise.resolve()
  activeProfile = 'work'
  plugin.__state.root.dataset.hermesTheme = 'work-theme'
  plugin.__state.root.dataset.hermesMode = 'light'
  plugin.__state.root.style.setProperty('--theme-background-seed', '#abcdef')
  rejectRequest(new Error('old profile request failed'))
  await sync

  assert.equal(plugin.__state.root.dataset.hermesTheme, 'work-theme')
  assert.equal(plugin.__state.root.dataset.hermesMode, 'light')
  assert.equal(plugin.__state.root.style.getPropertyValue('--theme-background-seed'), '#abcdef')
})

test('an in-flight success restores the newly active profile after the old broadcast repaints it', async () => {
  let activeProfile = 'default'
  let resolveOldRequest
  let resolveCurrentRequest
  const oldRequest = new Promise(resolve => { resolveOldRequest = resolve })
  const currentRequest = new Promise(resolve => { resolveCurrentRequest = resolve })
  let requestCount = 0
  let plugin
  const storage = new Map()
  plugin = await loadPlugin(storage, true, (_method, payload) => {
    requestCount += 1
    if (requestCount === 1) return oldRequest
    return currentRequest
  }, () => activeProfile)
  const oldScene = plugin.__test.scenes.find(item => item.name === 'nous')
  const currentScene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

  const oldSync = plugin.__test.applyScene(oldScene, 'dark', () => {})
  await Promise.resolve()
  activeProfile = 'work'
  const currentSync = plugin.__test.applyScene(currentScene, 'light', () => {})

  // config.set broadcasts before resolving. Simulate the old profile's
  // concrete transport repainting both the root and shared default storage.
  plugin.__state.root.dataset.hermesTheme = oldScene.gatewayDarkName
  plugin.__state.root.dataset.hermesMode = 'dark'
  plugin.__state.root.style.setProperty('--theme-background-seed', oldScene.darkColors.background)
  storage.set('hermes-desktop-theme-v2', oldScene.gatewayDarkName)
  storage.set('hermes-desktop-mode-v1', 'dark')
  resolveOldRequest({})
  await oldSync

  assert.equal(plugin.__state.root.dataset.hermesTheme, 'shadow-thief')
  assert.equal(plugin.__state.root.dataset.hermesMode, 'light')
  assert.equal(plugin.__state.root.style.getPropertyValue('--theme-background-seed'), currentScene.lightColors.background)
  assert.equal(JSON.parse(storage.get('hermes-desktop-profile-themes-v1')).work, 'shadow-thief')
  assert.equal(JSON.parse(storage.get('hermes-desktop-profile-modes-v1')).work, 'light')
  assert.deepEqual(plugin.__state.notifications, [])
  assert.equal(plugin.__state.requests.length, 2)

  resolveCurrentRequest({})
  await currentSync
})

test('an in-flight success restores a switched profile from its pre-request persisted appearance', async () => {
  let activeProfile = 'default'
  let resolveRequest
  const pending = new Promise(resolve => { resolveRequest = resolve })
  const storage = new Map([
    ['hermes-desktop-profile-themes-v1', JSON.stringify({ work: 'shadow-thief' })],
    ['hermes-desktop-profile-modes-v1', JSON.stringify({ work: 'light' })]
  ])
  const plugin = await loadPlugin(storage, true, () => pending, () => activeProfile)
  const oldScene = plugin.__test.scenes.find(item => item.name === 'nous')
  const workScene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

  const oldSync = plugin.__test.applyScene(oldScene, 'dark', () => {})
  await Promise.resolve()
  activeProfile = 'work'

  // Simulate the old request's broadcast corrupting the newly active profile
  // before its RPC acknowledgement arrives. No new theme click occurs in work.
  plugin.__state.root.dataset.hermesTheme = oldScene.gatewayDarkName
  plugin.__state.root.dataset.hermesMode = 'dark'
  plugin.__state.root.style.setProperty('--theme-background-seed', oldScene.darkColors.background)
  storage.set('hermes-desktop-profile-themes-v1', JSON.stringify({ work: oldScene.gatewayDarkName }))
  storage.set('hermes-desktop-profile-modes-v1', JSON.stringify({ work: 'dark' }))
  resolveRequest({})
  await oldSync

  assert.equal(plugin.__state.root.dataset.hermesTheme, 'shadow-thief')
  assert.equal(plugin.__state.root.dataset.hermesMode, 'light')
  assert.equal(plugin.__state.root.style.getPropertyValue('--theme-background-seed'), workScene.lightColors.background)
  assert.equal(JSON.parse(storage.get('hermes-desktop-profile-themes-v1')).work, 'shadow-thief')
  assert.equal(JSON.parse(storage.get('hermes-desktop-profile-modes-v1')).work, 'light')
  assert.equal(plugin.__state.requests.length, 1)
  assert.deepEqual(plugin.__state.notifications, [])
})

test('gateway acknowledgement restores the dynamic scene name after Desktop ingests the concrete variant', async () => {
  const storage = new Map()
  const plugin = await loadPlugin(storage, true, (_method, payload) => {
    storage.set('hermes-desktop-theme-v2', payload.value)
    return Promise.resolve({})
  })
  const scene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

  await plugin.__test.applyScene(scene, 'light', () => {})

  assert.equal(storage.get('hermes-desktop-theme-v2'), 'shadow-thief')
  assert.equal(storage.get('hermes-desktop-mode-v1'), 'light')
})

test('gateway success reasserts every requested dark dynamic palette after Desktop applies it with stale light mode', async () => {
  const storage = new Map()
  let plugin
  plugin = await loadPlugin(storage, true, (_method, payload) => {
    // ThemeProvider's internal mode is still light because the plugin's local
    // repaint cannot call setMode(). Simulate skin.changed applying the concrete
    // dark skin through that stale light state before the RPC acknowledges.
    plugin.__state.root.dataset.hermesTheme = payload.value
    plugin.__state.root.dataset.hermesMode = 'light'
    plugin.__state.root.style.setProperty('--theme-background-seed', '#ffffff')
    storage.set('hermes-desktop-theme-v2', payload.value)
    return Promise.resolve({})
  })
  const dynamicScenes = plugin.__test.scenes.filter(item => item.modeSupport === 'dynamic')

  for (const scene of dynamicScenes) {
    await plugin.__test.applyScene(scene, 'dark', () => {})

    assert.equal(plugin.__state.root.dataset.hermesTheme, scene.name, scene.name)
    assert.equal(plugin.__state.root.dataset.hermesMode, 'dark', scene.name)
    // The seed is the converter's DARK output, not the raw palette background: a
    // pure-black surface seed has always read as absent and falls back to the
    // ramp tone (see skinSeeds), so the raw background is not always what lands
    // on the root.
    const desktop = plugin.__test.sceneToDesktopTheme(scene)
    const seed = plugin.__state.root.style.getPropertyValue('--theme-background-seed')
    assert.equal(seed, desktop.darkColors.background, scene.name)
    // And it is the dark half of the pair that was reasserted, never the light.
    if (desktop.colors.background !== desktop.darkColors.background) {
      assert.notEqual(seed, desktop.colors.background, `${scene.name} must not reassert the light palette`)
    }
    assert.equal(storage.get('hermes-desktop-theme-v2'), scene.name, scene.name)
    assert.equal(storage.get('hermes-desktop-mode-v1'), 'dark', scene.name)
  }
})

test('gateway synchronization failure keeps the local repaint and reports a warning', async () => {
  const plugin = await loadPlugin(
    new Map(),
    true,
    () => Promise.reject(new Error('gateway unavailable'))
  )
  const scene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

  const synchronized = await plugin.__test.applyScene(scene, 'dark', () => {})

  assert.equal(synchronized, false)
  assert.equal(plugin.__state.root.dataset.hermesTheme, 'shadow-thief')
  assert.equal(plugin.__state.root.dataset.hermesMode, 'dark')
  assert.equal(plugin.__state.notifications.at(-1).kind, 'warning')
  assert.match(plugin.__state.notifications.at(-1).message, /connected gateway could not apply/)
})

test('a stale acknowledgement cannot replace the latest persisted scene when the latest gateway request fails', async () => {
  const storage = new Map()
  let releaseFirst
  const firstRequest = new Promise(resolve => { releaseFirst = resolve })
  let requestCount = 0
  const plugin = await loadPlugin(storage, true, () => {
    requestCount += 1
    return requestCount === 1 ? firstRequest : Promise.reject(new Error('latest request failed'))
  })
  const staleScene = plugin.__test.scenes.find(item => item.name === 'nous')
  const latestScene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

  const stale = plugin.__test.applyScene(staleScene, 'dark', () => {})
  await Promise.resolve()
  const latest = plugin.__test.applyScene(latestScene, 'light', () => {})
  // Simulate Desktop handling the stale request's skin.changed broadcast after
  // the latest optimistic repaint but before that latest gateway request fails.
  plugin.__state.root.dataset.hermesTheme = 'nous'
  plugin.__state.root.dataset.hermesMode = 'dark'
  plugin.__state.root.style.setProperty('--theme-background-seed', staleScene.darkColors.background)
  storage.set('hermes-desktop-theme-v2', staleScene.gatewayDarkName)
  releaseFirst({})
  await Promise.all([stale, latest])

  assert.equal(storage.get('hermes-desktop-theme-v2'), 'shadow-thief')
  assert.equal(storage.get('hermes-desktop-mode-v1'), 'light')
  assert.equal(plugin.__state.root.dataset.hermesTheme, 'shadow-thief')
  assert.equal(plugin.__state.root.dataset.hermesMode, 'light')
  assert.equal(plugin.__state.root.style.getPropertyValue('--theme-background-seed'), latestScene.lightColors.background)
})

test('post-ack persistence failure warns that the combined scene is not durable', async () => {
  const stored = new Map()
  let blockAppearance = false
  const partialStorage = {
    get: key => stored.get(key) ?? null,
    set: (key, value) => {
      if (blockAppearance && key === 'hermes-desktop-theme-v2') throw new Error('appearance write blocked')
      stored.set(key, value)
    }
  }
  const plugin = await loadPlugin(partialStorage, true, (_method, payload) => {
    stored.set('hermes-desktop-theme-v2', payload.value)
    blockAppearance = true
    return Promise.resolve({})
  })
  const scene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

  await plugin.__test.applyScene(scene, 'dark', () => {})

  assert.equal(plugin.__state.notifications.at(-1).kind, 'warning')
  assert.match(plugin.__state.notifications.at(-1).message, /combined scene could not be saved for restart/)
})

test('in-place repaint still works when appearance storage is unavailable', async () => {
  const blockedStorage = {
    get: () => { throw new Error('storage blocked') },
    set: () => { throw new Error('storage blocked') }
  }
  const plugin = await loadPlugin(blockedStorage, true)
  const scene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

  assert.doesNotThrow(() => plugin.register({ register: () => {} }))
  assert.doesNotThrow(() => plugin.__test.applyScene(scene, 'light', () => {}))
  assert.equal(plugin.__state.root.dataset.hermesTheme, 'shadow-thief')
  assert.equal(plugin.__state.root.dataset.hermesMode, 'light')
  assert.equal(plugin.__state.reloads, 0)
})

test('applying a contributed scene warns when its boot theme cache cannot be saved', async () => {
  const stored = new Map()
  const partialStorage = {
    get: key => stored.get(key) ?? null,
    set: (key, value) => {
      if (key === USER_THEMES_KEY) throw new Error('theme cache quota exceeded')
      stored.set(key, value)
    }
  }
  const plugin = await loadPlugin(partialStorage, true)
  const scene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

  plugin.__test.applyScene(scene, 'dark', () => {})

  assert.equal(plugin.__state.root.dataset.hermesTheme, 'shadow-thief')
  assert.equal(stored.get('hermes-desktop-theme-v2'), 'shadow-thief')
  assert.equal(plugin.__state.notifications.at(-1).kind, 'warning')
  assert.match(plugin.__state.notifications.at(-1).message, /could not be saved for restart/)
})

test('the self-contained plugin never fetches remote theme fonts', async () => {
  const source = await readFile(pluginPath, 'utf8')

  assert.doesNotMatch(source, /fonts\.googleapis\.com|fonts\.gstatic\.com/)
})

test('applying a scene hands the switch to Desktop\'s ThemeProvider so its state cannot revert it', async () => {
  const plugin = await loadPlugin(new Map(), true)
  const scene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')
  const calls = []
  const provider = {
    setTheme: name => calls.push(['theme', name]),
    setMode: mode => calls.push(['mode', mode])
  }

  await plugin.__test.applyScene(scene, 'dark', () => {}, provider)

  // The manual paint still lands immediately (no flicker on the switch)...
  assert.equal(plugin.__state.root.dataset.hermesTheme, 'shadow-thief')
  assert.equal(plugin.__state.root.dataset.hermesMode, 'dark')
  // ...and Desktop's own React state is told, so a later render keeps the theme
  // instead of repainting its stale state over the manual paint.
  assert.deepEqual(calls, [['theme', 'shadow-thief'], ['mode', 'dark']])
})

test('applying a scene without a captured provider still paints (non-React fallback)', async () => {
  const plugin = await loadPlugin(new Map(), true)
  const scene = plugin.__test.scenes.find(item => item.name === 'shadow-thief')

  assert.doesNotThrow(() => plugin.__test.applyScene(scene, 'light', () => {}))
  assert.equal(plugin.__state.root.dataset.hermesTheme, 'shadow-thief')
  assert.equal(plugin.__state.root.dataset.hermesMode, 'light')
})
