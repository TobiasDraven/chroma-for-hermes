/**
 * The override store and a pasted TweakCN palette are external input. A shallow
 * `Object.assign` copies an own `__proto__` through [[Set]], which rewrites the
 * prototype of the fresh target — so one hostile key could reach every object
 * built from it. These tests fail against `Object.assign` and pass against the
 * merge the plugin now uses.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './helpers/load-plugin.mjs'

async function helpers() {
  const { context } = await loadPlugin()
  return context.testHelpers
}

test('safeMerge copies ordinary keys', async () => {
  const t = await helpers()
  const merged = t.safeMerge({ a: 1 }, { b: 2 }, null, undefined, { a: 3 })
  assert.deepEqual(JSON.parse(JSON.stringify(merged)), { a: 3, b: 2 })
})

test('safeMerge refuses __proto__ from a parsed payload', async () => {
  const t = await helpers()
  const hostile = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}')
  const merged = t.safeMerge(hostile)
  assert.equal(merged.polluted, undefined, 'the prototype is untouched')
  assert.equal({}.polluted, undefined, 'and nothing global was written')
  assert.equal(merged.ok, 1, 'the ordinary key survives')
  // The merged object is built inside the plugin's VM realm, so its prototype is
  // that realm's Object.prototype. Assert the OUTCOME, not a foreign identity.
  // (Reading `.__proto__` returns the prototype itself, so ask for an OWN key.)
  assert.equal(Object.prototype.hasOwnProperty.call(merged, '__proto__'), false, 'no own __proto__ key was copied')
  assert.deepEqual(Object.keys(merged).sort(), ['ok'])
})

test('safeMerge refuses constructor and prototype keys too', async () => {
  const t = await helpers()
  const merged = t.safeMerge({ constructor: 'x', prototype: 'y', keep: 1 })
  assert.deepEqual(Object.keys(merged), ['keep'])
})

test('applyOverride cannot be made to pollute by a hostile palette', async () => {
  const t = await helpers()
  const scene = t.SKINS[0]
  const overrides = JSON.parse('{"' + scene.name + '": {"light": {"__proto__": {"polluted": true}, "background": "#010101"}}}')
  const merged = t.applyOverride(scene, overrides)
  assert.equal({}.polluted, undefined, 'a hostile override key never reaches the prototype')
  assert.equal(merged.lightColors.background, '#010101', 'while the real colour still applies')
})
