import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './helpers/load-plugin.mjs'

test('gatewaySkinNameFor prefers OWNED_GATEWAY over scene fields', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  context.OWNED_GATEWAY = new Map()
  context.OWNED_GATEWAY.set('foo', { light: 'foo-light', dark: 'foo-dark' })
  const scene = { name: 'foo', gatewayLightName: 'x', gatewayDarkName: 'y', lightName: 'a', darkName: 'b' }
  assert.equal(context.gatewaySkinNameFor(scene, 'light'), 'foo-light')
  assert.equal(context.gatewaySkinNameFor(scene, 'dark'), 'foo-dark')
})

test('gatewaySkinNameFor falls back to scene fields when map has no entry', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  context.OWNED_GATEWAY = new Map()
  const scene = { name: 'foo', gatewayLightName: 'gl', gatewayDarkName: 'gd', lightName: 'ln', darkName: 'dn' }
  assert.equal(context.gatewaySkinNameFor(scene, 'light'), 'gl')
  assert.equal(context.gatewaySkinNameFor(scene, 'dark'), 'gd')
})

test('gatewaySkinNameFor returns scene.name when neither exists', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  context.OWNED_GATEWAY = new Map()
  const scene = { name: 'foo' }
  assert.equal(context.gatewaySkinNameFor(scene, 'light'), 'foo')
  assert.equal(context.gatewaySkinNameFor(scene, 'dark'), 'foo')
})

test('normalizeLiveSkin of a paired payload produces a two-mode scene', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  context.OWNED_GATEWAY = new Map()
  const skin = { name: 'bar', light_colors: { background: '#ffffff' }, dark_colors: { background: '#000000' } }
  const s = h.normalizeLiveSkin(skin)
  assert.equal(s.modeSupport, 'dynamic')
  assert.ok(s.lightColors)
  assert.ok(s.darkColors)
})

test('normalizeLiveSkin of a single-mode payload still works', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  context.OWNED_GATEWAY = new Map()
  const skin = { name: 'baz', colors: { background: '#ffffff' } }
  const s = h.normalizeLiveSkin(skin)
  assert.ok(s.lightColors)
  assert.equal(s.modeSupport, 'light')
})
