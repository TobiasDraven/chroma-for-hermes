/**
 * The default shelf is the product promise: thirty core skins on a fresh install,
 * every other skin behind a pack the user turns on. These tests hold that line,
 * because it is the difference between a curated picker and a dump of 94 cards.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './helpers/load-plugin.mjs'

test('a fresh install shows the thirty core skins and nothing else', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const visible = t.filterByPacks(t.SKINS, [])

  assert.equal(visible.length, 30, 'core is exactly thirty skins')
  for (const skin of visible) {
    assert.equal(skin.pack, 'core', `${skin.name} is not a core skin`)
  }
})

test('a missing pack list is treated as no packs, never as every pack', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers

  for (const value of [undefined, null, 'retro', 0]) {
    const visible = t.filterByPacks(t.SKINS, value)
    assert.equal(visible.length, 30, `enabledPacks ${String(value)} must not open the vault`)
  }
})

test('enabling a pack adds exactly that pack', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const retroOnly = t.SKINS.filter(skin => skin.pack === 'retro')

  assert.ok(retroOnly.length >= 10, 'the retro pack is a real shelf')
  const visible = t.filterByPacks(t.SKINS, ['retro'])
  assert.equal(visible.length, 30 + retroOnly.length)
  for (const skin of visible) {
    assert.ok(skin.pack === 'core' || skin.pack === 'retro', `${skin.name} leaked in`)
  }
})

test('every pack is reachable, and no skin is unreachable', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const packs = [...new Set(t.SKINS.map(skin => skin.pack))]
  const visible = t.filterByPacks(t.SKINS, packs.filter(pack => pack !== 'core'))
  assert.equal(visible.length, t.SKINS.length, 'enabling every pack must reveal the catalogue')
})

test('a catalogue with no pack data is not filtered at all', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const bare = t.SKINS.map(skin => ({ ...skin, pack: undefined }))
  assert.equal(t.filterByPacks(bare, []).length, bare.length)
})
