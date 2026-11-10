import assert from 'node:assert/strict'
import test from 'node:test'

import { loadPlugin } from './helpers/load-plugin.mjs'

/**
 * A theme the user imported must be as real as one Chroma ships.
 *
 * The 2026-11-10 change removed the boot cache Chroma used to write into the
 * app's own theme store, so a name nothing registers is a name the host cannot
 * resolve -- and normalizeSkin then coerces it to the default AND persists that.
 * These are the guarantees that replace the cache: the contribution is the
 * resolution path, published at boot and again the moment an import lands.
 */

const THEMES_KEY = 'chroma-imported-themes-v1'
const SEEDED_KEY = 'chroma-imported-seeded-v1'

/** A plugin instance with Chroma's own store seeded and a recorder for contributions. */
async function withStore(themes, options = {}) {
  const { context } = await loadPlugin(options)
  const contributed = []
  context.window.localStorage.setItem(THEMES_KEY, JSON.stringify(themes))
  context.plugin.register({
    rest: async () => ({}),
    register: contribution => { if (contribution.id.startsWith('theme:')) contributed.push(contribution) },
    storage: options.storage
  })
  return { context, contributed, helpers: context.testHelpers }
}

const importedTheme = (name, extra = {}) => ({
  name,
  label: name,
  themePickerSource: 'owned',
  colors: { background: '#101010', foreground: '#f0f0f0', primary: '#7c5cbf' },
  darkColors: { background: '#000000', foreground: '#e8e8e8', primary: '#9d7fe0' },
  ...extra
})

test('an imported theme is contributed to THEMES at boot, not only in the pane', async () => {
  const { contributed } = await withStore({ 'my-fork': importedTheme('my-fork') })
  const ids = contributed.map(c => c.id)

  assert.ok(ids.includes('theme:my-fork'),
    'without this contribution the persisted skin cannot be resolved at launch')
  assert.ok(ids.length >= 94, 'the catalog is contributed alongside it')
})

test('the boot contribution carries a real palette the provider can paint', async () => {
  const { contributed } = await withStore({ 'my-fork': importedTheme('my-fork') })
  const theme = contributed.find(c => c.id === 'theme:my-fork').data

  assert.equal(theme.colors.background, '#101010')
  assert.ok(theme.darkColors && theme.darkColors.background, 'both halves, so the mode switch works')
  assert.notEqual(theme.darkColors.background, theme.colors.background, 'a real dark half, not a copy')
  assert.equal(theme.name, 'my-fork')
})

test('a theme published after render is accepted, though availableThemes is stale', async () => {
  // The api a component captured at render holds the list as it was. A theme
  // imported one line earlier is absent from it, and refusing its own fresh
  // contribution is the bug this pins.
  const { context, helpers } = await withStore({})
  const staleApi = {
    availableThemes: [{ name: 'nous', label: 'Nous' }],
    themeName: 'nous',
    mode: 'dark',
    calls: [],
    setTheme(name) { this.calls.push(['theme', name]); this.themeName = name },
    setMode(value) { this.calls.push(['mode', value]) }
  }

  helpers.reRegisterSceneTheme({ name: 'brand-new-import', label: 'Brand New', colors: {}, darkColors: {} })
  const result = helpers.handThemeToProvider('brand-new-import', 'dark', staleApi)

  assert.equal(result.ok, true, 'a name we just published is resolvable')
  assert.deepEqual(staleApi.calls[0], ['theme', 'brand-new-import'])
})

test('the legacy seed runs ONCE, so a deleted import does not come back', async () => {
  const { context, helpers } = await withStore({ 'ghost-skin': importedTheme('ghost-skin'), 'kept-skin': importedTheme('kept-skin') })

  assert.deepEqual(Object.keys(JSON.parse(context.window.localStorage.getItem(THEMES_KEY))).sort(),
    ['ghost-skin', 'kept-skin'])

  helpers.forgetScene('ghost-skin')

  assert.deepEqual(Object.keys(JSON.parse(context.window.localStorage.getItem(THEMES_KEY))), ['kept-skin'],
    'the deleted skin is gone from the store')
  assert.equal(context.window.localStorage.getItem(SEEDED_KEY), 'true', 'the one-shot marker is set')

  // A second read is a fresh boot's view: nothing may re-seed the deleted skin.
  assert.deepEqual(Object.keys(helpers.readStoredThemes()), ['kept-skin'])
})

test('a host store that answers null does not hide a value written without one', async () => {
  const { context } = await loadPlugin()
  const local = context.window.localStorage
  local.setItem('chroma-appearance-v1', JSON.stringify({ work: { theme: 'nord-light', mode: 'dark' } }))

  context.plugin.register({
    rest: async () => ({}),
    register: () => () => {},
    // Synchronous, but empty: a store that exists and holds nothing.
    storage: { get: (_key, fallback) => fallback, set: () => {} }
  })

  const appearance = JSON.parse(JSON.stringify(context.testHelpers.readAppearance('work')))
  assert.deepEqual(appearance, { theme: 'nord-light', mode: 'dark' },
    'the value under our own key is still found')
})
