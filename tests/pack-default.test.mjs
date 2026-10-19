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

test('the pack choice persists, and a corrupt store is not fatal', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const store = context.window.localStorage

  store.removeItem('chroma-packs-v1')
  assert.equal(JSON.stringify(t.readEnabledPacks()), '[]', 'nothing stored means no packs')

  t.writeEnabledPacks(['retro', 'studio'])
  assert.equal(JSON.stringify([...t.readEnabledPacks()].sort()), '["retro","studio"]')

  t.writeEnabledPacks([])
  assert.equal(JSON.stringify(t.readEnabledPacks()), '[]', 'an empty choice is a choice')

  store.setItem('chroma-packs-v1', '{not json')
  assert.equal(JSON.stringify(t.readEnabledPacks()), '[]', 'a corrupt store degrades to none, never throws')
  store.removeItem('chroma-packs-v1')
})

test('a search that only matches a hidden pack leaves nothing visible', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  // The pane's empty state is guarded on exactly this value: the skins that
  // survived both the search and the pack filter. If it is zero the user is
  // told why, instead of being shown three shelves reading (0).
  const matches = t.SKINS.filter(skin => /vscode/i.test(skin.name))
  assert.ok(matches.length > 0, 'the catalogue still has a studio skin named vscode')
  assert.equal(t.filterByPacks(matches, []).length, 0, 'hidden by the pack filter')
  assert.equal(t.filterByPacks(matches, ['studio']).length, matches.length, 'visible once studio is on')
})

test('a search that matches nothing at all also leaves nothing visible', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const matches = t.SKINS.filter(skin => /zzzz-no-such-skin/i.test(skin.name))
  assert.equal(t.filterByPacks(matches, []).length, 0)
  assert.equal(t.filterByPacks(matches, ['studio', 'retro', 'noir']).length, 0)
})

test('the shipped toggle writes the store, not just the component state', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const store = context.window.localStorage
  store.removeItem('chroma-packs-v1')

  // togglePackChoice is the function the chip handler passes to setEnabledPacks.
  // If the write were dropped from it, this test fails.
  const after = t.togglePackChoice([], 'studio')
  assert.equal(JSON.stringify(after), '["studio"]')
  assert.equal(store.getItem('chroma-packs-v1'), '["studio"]', 'the click reached storage')

  const off = t.togglePackChoice(after, 'studio')
  assert.equal(JSON.stringify(off), '[]')
  assert.equal(store.getItem('chroma-packs-v1'), '[]', 'turning it off is written too')

  const both = t.togglePackChoice(t.togglePackChoice([], 'retro'), 'studio')
  assert.equal(JSON.stringify([...both].sort()), '["retro","studio"]')
  assert.equal(store.getItem('chroma-packs-v1'), JSON.stringify(both))

  store.removeItem('chroma-packs-v1')
})

test('the empty state names the pack filter when that is what hid the skins', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers

  // Nothing to draw: say why. This is the branch the previous build could never
  // reach because it guarded on a group count.
  assert.equal(t.emptyStateFor(0, 64).title, 'No skins found')
  assert.match(t.emptyStateFor(0, 64).description, /packs you have on/)
  assert.match(t.emptyStateFor(0, 0).description, /different search/)
  // Nothing hidden by packs: the plain message, exactly as before the fix.
  assert.ok(!/packs you have on/.test(t.emptyStateFor(0, 0).description))
  // Skins on screen: no empty state at all.
  assert.equal(t.emptyStateFor(1, 0), null)
  assert.equal(t.emptyStateFor(30, 64), null)
})
