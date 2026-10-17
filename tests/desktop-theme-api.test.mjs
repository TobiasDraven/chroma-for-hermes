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
