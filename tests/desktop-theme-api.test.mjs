// The provider slot is MODULE state, and BOTH the picker page and the
// command-bar chip call useDesktopThemeApi(). The old cleanup nulled the slot
// whenever a consumer's own api matched — true for every consumer sharing the
// provider — so the page navigating away while the chip stayed mounted left the
// hand-off with no provider to talk to. Desktop's next render then reverted the
// surface: the second, independent cause of "the theme does not stick".
//
// The harness executes component bodies eagerly and stubs useEffect, so this
// suite drives the REAL hook through a minimal mount/unmount runtime: mounting a
// consumer runs its effects, unmounting runs only that consumer's cleanups.
//
// The same suite pins the OTHER half of the hand-off: handThemeToProvider is now
// the only apply path (Chroma paints nothing itself), so the name guard lives
// there. The host's setTheme coerces a name it cannot resolve to the DEFAULT
// skin and PERSISTS it (hermes-agent apps/desktop/src/themes/context.tsx:
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

// A provider stub shaped like the host's ThemeProvider. setTheme/setMode mutate
// it, so a later render (and this suite) sees what the provider now holds.
function providerStub(themes) {
  const calls = []
  const provider = {
    themeName: 'nous',
    mode: 'dark',
    renderedMode: 'dark',
    previewTheme() {},
    clearThemePreview() {},
    setTheme(name) {
      calls.push(['theme', name])
      provider.themeName = name
    },
    setMode(value) {
      calls.push(['mode', value])
      provider.mode = value
    }
  }
  if (themes !== undefined) provider.availableThemes = themes
  return { provider, calls }
}

function outcome(result) {
  return { ok: result.ok, reason: result.reason }
}

/**
 * The mount/unmount runtime. `requestTheme` reports false, i.e. this host has no
 * out-of-React queue: once the last consumer unmounts, a switch has nowhere to
 * go, which is exactly what the refcount has to demonstrate.
 */
async function runtime() {
  const state = { provider: null }
  let current = null
  const useEffect = fn => {
    if (current) current.effects.push(fn)
  }
  const { context } = await loadPlugin({
    stubbed: {
      useTheme: () => state.provider,
      useEffect,
      requestTheme: () => false
    }
  })
  const helpers = context.testHelpers
  const cleanups = new Map()
  return {
    helpers,
    mount(name, provider) {
      state.provider = provider
      current = { name, effects: [] }
      const api = helpers.useDesktopThemeApi()
      cleanups.set(name, current.effects.map(fn => fn()).filter(Boolean))
      current = null
      return api
    },
    unmount(name) {
      for (const cleanup of cleanups.get(name) || []) cleanup()
      cleanups.delete(name)
    }
  }
}

// One mounted consumer, for the guard tests: the slot has to be filled before a
// hand-off can reach anything.
async function helpersWith(provider) {
  const harness = await runtime()
  harness.mount('page', provider)
  return harness.helpers
}

test('one consumer unmounting cannot null the provider slot a still-mounted consumer needs', async () => {
  const harness = await runtime()
  const { provider, calls } = providerStub()

  harness.mount('page', provider)
  harness.mount('chip', provider)
  calls.length = 0

  // The picker page navigates away; the statusbar chip stays mounted.
  harness.unmount('page')

  assert.deepEqual(
    outcome(harness.helpers.handThemeToProvider('shadow-thief', 'light')),
    { ok: true, reason: '' },
    'the chip still needs the slot after the page unmounts'
  )
  assert.deepEqual(calls, [['theme', 'shadow-thief'], ['mode', 'light']])
  assert.equal(provider.themeName, 'shadow-thief')
  assert.equal(provider.mode, 'light')

  // Only when the LAST consumer goes may the slot be cleared.
  harness.unmount('chip')
  const orphan = harness.helpers.handThemeToProvider('shadow-thief', 'light')
  assert.equal(orphan.ok, false, 'and the slot clears once the last consumer unmounts')
  assert.equal(orphan.reason, 'no-provider')
  assert.deepEqual(calls, [['theme', 'shadow-thief'], ['mode', 'light']], 'nothing reached a provider afterwards')
})

test('the slot survives the chip unmounting first, and clears with the page', async () => {
  const harness = await runtime()
  const { provider, calls } = providerStub()

  harness.mount('chip', provider)
  harness.mount('page', provider)
  calls.length = 0

  harness.unmount('chip')
  assert.equal(
    harness.helpers.handThemeToProvider('nous', 'dark').ok,
    true,
    'the page still holds the slot'
  )
  assert.deepEqual(calls, [['theme', 'nous'], ['mode', 'dark']])

  harness.unmount('page')
  assert.equal(
    harness.helpers.handThemeToProvider('nous', 'dark').reason,
    'no-provider',
    'and the page is the last consumer'
  )
})

test('a name the host cannot resolve is refused, so the profile is not rewritten', async () => {
  const { provider, calls } = providerStub([
    { name: 'nous', label: 'Nous', description: '' },
    { name: 'midnight', label: 'Midnight', description: '' }
  ])
  const helpers = await helpersWith(provider)

  // 'shadow-thief' is NOT in the list. The host would coerce it to 'nous' and
  // persist that, replacing whatever the user had chosen.
  const result = helpers.handThemeToProvider('shadow-thief', 'light')
  assert.equal(result.ok, false, 'an unresolvable name must not reach the host')
  assert.equal(result.reason, 'unresolved')
  assert.deepEqual(calls, [], 'and the host must not be called at all')
})

test('a name the host lists is applied', async () => {
  const { provider, calls } = providerStub([
    { name: 'nous', label: 'Nous', description: '' },
    { name: 'shadow-thief', label: 'Shadow Thief', description: '' }
  ])
  const helpers = await helpersWith(provider)

  assert.equal(helpers.handThemeToProvider('shadow-thief', 'light').ok, true)
  assert.deepEqual(calls, [['theme', 'shadow-thief'], ['mode', 'light']])
  assert.equal(provider.themeName, 'shadow-thief')
  assert.equal(provider.mode, 'light')
})

test('a LABEL match hands over the host name, never the label', async () => {
  // setTheme resolves by name. Passing it a label that a contributor also
  // exposed would be coerced to the default skin and persisted -- the same
  // damage the refusal guard prevents, arriving through the guard's own matching.
  const { provider, calls } = providerStub([
    { name: 'nous', label: 'Nous', description: '' },
    { name: 'shadow-thief', label: 'Shadow Thief', description: '' }
  ])
  const helpers = await helpersWith(provider)

  const result = helpers.handThemeToProvider('Shadow Thief', 'dark')

  assert.equal(result.ok, true, 'a listed label is still an acceptable handle')
  assert.deepEqual(calls, [['theme', 'shadow-thief'], ['mode', 'dark']],
    'the provider must be told the name it can resolve')
  assert.equal(provider.themeName, 'shadow-thief')
})

test('a provider that publishes no list is not second-guessed', async () => {
  // A host that does not expose availableThemes cannot say whether the name
  // resolves. Refusing here would break every switch on that host.
  const { provider, calls } = providerStub(undefined)
  const helpers = await helpersWith(provider)

  assert.equal(helpers.handThemeToProvider('shadow-thief', 'light').ok, true)
  assert.deepEqual(calls, [['theme', 'shadow-thief'], ['mode', 'light']])
})

test('an empty list is not a verdict that the name is unknown', async () => {
  // The host treats an empty list as "nothing to switch to". A scene Chroma
  // contributed lands in the list only after the registry publishes it.
  const { provider, calls } = providerStub([])
  const helpers = await helpersWith(provider)

  assert.equal(helpers.handThemeToProvider('shadow-thief', 'light').ok, true)
  assert.deepEqual(calls, [['theme', 'shadow-thief'], ['mode', 'light']])
})

test('an api handed in explicitly is the one that is told, not the cached slot', async () => {
  const moduleScoped = providerStub()
  const helpers = await helpersWith(moduleScoped.provider)
  const explicit = providerStub()

  assert.equal(helpers.handThemeToProvider('alabaster', 'dark', explicit.provider).ok, true)
  assert.deepEqual(explicit.calls, [['theme', 'alabaster'], ['mode', 'dark']])
  assert.deepEqual(moduleScoped.calls, [], 'the slot must stay out of a call that named its own provider')
})

test('a provider that throws is reported instead of being retried, and the mode is not sent', async () => {
  const calls = []
  const provider = {
    themeName: 'nous',
    mode: 'dark',
    renderedMode: 'dark',
    setTheme() { throw new Error('provider is gone') },
    setMode(value) { calls.push(['mode', value]) },
    previewTheme() {},
    clearThemePreview() {}
  }
  const helpers = await helpersWith(provider)

  const result = helpers.handThemeToProvider('alabaster', 'dark')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'threw')
  // A half-applied switch (new name, stale mode) is worse than a reported one.
  assert.deepEqual(calls, [])
})

test('the failure notice names the scene and tells the user what to do about it', async () => {
  const helpers = await helpersWith(providerStub().provider)
  const scene = { name: 'alabaster', label: 'Alabaster' }

  const unresolved = helpers.handOffFailureNotice(scene, 'unresolved')
  assert.equal(unresolved.kind, 'warning')
  assert.match(unresolved.message, /^Alabaster is not registered with Desktop yet/)
  assert.match(unresolved.message, /Reload Desktop/)

  const threw = helpers.handOffFailureNotice(scene, 'threw')
  assert.equal(threw.kind, 'error')
  assert.match(threw.message, /^Alabaster could not be handed to Desktop/)

  // A bare scene still produces a usable sentence rather than "undefined".
  assert.match(helpers.handOffFailureNotice({ name: 'alabaster' }, 'no-provider').message, /^alabaster/)
})
