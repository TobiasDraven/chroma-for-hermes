// The provider slot is MODULE state, and BOTH the picker page and the
// command-bar chip call useDesktopThemeApi(). The old cleanup nulled the slot
// whenever a consumer's own api matched — true for every consumer sharing the
// provider — so the page navigating away while the chip stayed mounted left
// syncDesktopState() with no provider to hand a switch to. Desktop's next render
// then reverted the surface: the second, independent cause of "the theme does
// not stick".
//
// The harness executes component bodies eagerly and stubs useEffect, so this
// suite drives the REAL hook through a minimal mount/unmount runtime: mounting a
// consumer runs its effects, unmounting runs only that consumer's cleanups.
//
// The same suite pins the OTHER half of syncDesktopState: the name guard. The
// host's setTheme coerces a name it cannot resolve to the DEFAULT skin and
// PERSISTS it (hermes-agent apps/desktop/src/themes/context.tsx:
// normalizeSkin), so handing the host a name it does not know rewrites the
// user's profile to the default theme - silently, with no error. The host's
// availableThemes is the same merged set its own resolveTheme searches
// (built-in + user-installed + backend + registry-contributed), so a name it
// lists is a name the host can resolve.
//
// The guard's exact boundary matters, because the obvious version of it -
// "refuse any name not in availableThemes" - is wrong in two ways recorded
// below: a provider that publishes NO list cannot answer the question, and an
// EMPTY list is not a verdict that the name is unknown (a scene Chroma
// contributed through THEMES_AREA lands in the list only once the registry has
// published it).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './helpers/load-plugin.mjs'


async function mountRuntime() {
  const calls = []
  const provider = {
    themeName: 'nous',
    mode: 'dark',
    setTheme: name => calls.push(['theme', name]),
    setMode: value => calls.push(['mode', value]),
    previewTheme() {},
    clearThemePreview() {}
  }
  let current = null
  const useEffect = (fn) => {
    if (current) current.effects.push(fn)
  }
  const { context } = await loadPlugin({ stubbed: { useTheme: () => provider, useEffect } })
  const helpers = context.testHelpers
  const cleanups = new Map()
  const mount = (name) => {
    current = { name, effects: [] }
    const api = helpers.useDesktopThemeApi()
    cleanups.set(name, current.effects.map(fn => fn()).filter(Boolean))
    current = null
    return api
  }
  const unmount = (name) => {
    for (const cleanup of cleanups.get(name) || []) cleanup()
    cleanups.delete(name)
  }
  return { helpers, provider, calls, mount, unmount }
}

test('one consumer unmounting cannot null the provider slot a still-mounted consumer needs', async () => {
  const { helpers, calls, mount, unmount } = await mountRuntime()

  mount('page')
  mount('chip')
  calls.length = 0

  // The picker page navigates away; the statusbar chip stays mounted.
  unmount('page')

  assert.equal(
    helpers.syncDesktopState('shadow-thief', 'light'),
    true,
    'the chip still needs the slot after the page unmounts'
  )
  assert.deepEqual(calls, [['theme', 'shadow-thief'], ['mode', 'light']])

  // Only when the LAST consumer goes may the slot be cleared.
  unmount('chip')
  assert.equal(
    helpers.syncDesktopState('shadow-thief', 'light'),
    false,
    'and the slot clears once the last consumer unmounts'
  )
})

test('the slot survives the chip unmounting first, and clears with the page', async () => {
  const { helpers, calls, mount, unmount } = await mountRuntime()

  mount('chip')
  mount('page')
  calls.length = 0

  unmount('chip')
  assert.equal(helpers.syncDesktopState('nous', 'dark'), true, 'the page still holds the slot')

  unmount('page')
  assert.equal(helpers.syncDesktopState('nous', 'dark'), false, 'and the page is the last consumer')
})

// A provider that publishes a theme list, like the host's ThemeProvider.
function providerWith(themes) {
  const calls = []
  const provider = {
    themeName: 'nous',
    mode: 'dark',
    setTheme: name => calls.push(['theme', name]),
    setMode: value => calls.push(['mode', value]),
    previewTheme() {},
    clearThemePreview() {}
  }
  if (themes !== undefined) provider.availableThemes = themes
  return { provider, calls }
}

// The provider slot is MODULE state, filled by a mounted consumer's effect.
// So the harness has to MOUNT one before syncDesktopState can reach it.
async function helpersWith(provider) {
  let current = null
  const useEffect = (fn) => {
    if (current) current.effects.push(fn)
  }
  const { context } = await loadPlugin({ stubbed: { useTheme: () => provider, useEffect } })
  const helpers = context.testHelpers
  current = { effects: [] }
  helpers.useDesktopThemeApi()
  for (const fn of current.effects) fn()
  current = null
  return helpers
}

test('a name the host cannot resolve is refused, so the profile is not rewritten', async () => {
  const { provider, calls } = providerWith([
    { name: 'nous', label: 'Nous', description: '' },
    { name: 'midnight', label: 'Midnight', description: '' }
  ])
  const helpers = await helpersWith(provider)

  // 'shadow-thief' is NOT in the list. The host would coerce it to 'nous' and
  // persist that, replacing whatever the user had chosen.
  assert.equal(
    helpers.syncDesktopState('shadow-thief', 'light'),
    false,
    'an unresolvable name must not reach the host'
  )
  assert.deepEqual(calls, [], 'and the host must not be called at all')
})

test('a name the host lists is applied', async () => {
  const { provider, calls } = providerWith([
    { name: 'nous', label: 'Nous', description: '' },
    { name: 'shadow-thief', label: 'Shadow Thief', description: '' }
  ])
  const helpers = await helpersWith(provider)

  assert.equal(helpers.syncDesktopState('shadow-thief', 'light'), true)
  assert.deepEqual(calls, [['theme', 'shadow-thief'], ['mode', 'light']])
})

test('a provider that publishes no list is not second-guessed', async () => {
  // A host that does not expose availableThemes cannot say whether the name
  // resolves. Refusing here would break every switch on that host.
  const { provider, calls } = providerWith(undefined)
  const helpers = await helpersWith(provider)

  assert.equal(helpers.syncDesktopState('shadow-thief', 'light'), true)
  assert.deepEqual(calls, [['theme', 'shadow-thief'], ['mode', 'light']])
})

test('an empty list is not a verdict that the name is unknown', async () => {
  // The host treats an empty list as "nothing to switch to". A scene Chroma
  // contributed lands in the list only after the registry publishes it.
  const { provider, calls } = providerWith([])
  const helpers = await helpersWith(provider)

  assert.equal(helpers.syncDesktopState('shadow-thief', 'light'), true)
  assert.deepEqual(calls, [['theme', 'shadow-thief'], ['mode', 'light']])
})
