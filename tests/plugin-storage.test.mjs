import assert from 'node:assert/strict'
import test from 'node:test'

import { loadPlugin } from './helpers/load-plugin.mjs'

/**
 * Chroma's own state lives in the host's namespaced store.
 *
 * `ctx.storage` is the sanctioned place for plugin state: the host scopes every
 * key under `hermes.plugin.<id>.` (contrib/plugin.ts:49-55, 196-216), so the app
 * owns the prefix and no plugin can read or clobber ours. This file pins that
 * Chroma USES it when it is offered, and that every value it keeps there is its
 * own -- never a key the Desktop app owns.
 */

async function registered(store, localStorage) {
  const { context } = await loadPlugin()
  context.window = { localStorage }
  context.plugin.register({
    rest: async () => ({}),
    register() { return () => {} },
    storage: store
  })
  return context
}

function memoryLocalStorage() {
  const keys = new Map()
  return {
    keys,
    getItem: key => (keys.has(key) ? keys.get(key) : null),
    setItem: (key, value) => keys.set(key, value),
    removeItem: key => keys.delete(key)
  }
}

function memoryStore() {
  const values = new Map()
  return {
    values,
    get: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    set: (key, value) => { values.set(key, value) },
    remove: key => { values.delete(key) }
  }
}

test('the appearance map is written to ctx.storage, not to localStorage', async () => {
  const store = memoryStore()
  const local = memoryLocalStorage()
  const context = await registered(store, local)

  assert.equal(context.persistAppearance('nord-light', 'light', 'work'), true)

  const saved = store.values.get('chroma-appearance-v1')
  assert.ok(saved, 'the host store must carry the map')
  // The store round-trips JSON, and the value crosses the sandbox boundary, so
  // compare the shape rather than object identity.
  assert.deepEqual(JSON.parse(JSON.stringify(saved)).work, { theme: 'nord-light', mode: 'light' })
  assert.equal(local.keys.size, 0, 'nothing may be written to localStorage when the host offers a store')

  // And it reads back through the same door.
  assert.deepEqual(JSON.parse(JSON.stringify(context.readAppearance('work'))), { theme: 'nord-light', mode: 'light' })
})

test('imported themes are written to ctx.storage, not to the app\'s theme store', async () => {
  const store = memoryStore()
  const local = memoryLocalStorage()
  const context = await registered(store, local)

  const theme = {
    name: 'my-fork',
    source: 'vscode',
    colors: { background: '#101010' },
    darkColors: { background: '#000000' }
  }
  assert.equal(context.persistTheme(theme), true)

  const saved = store.values.get('chroma-imported-themes-v1')
  assert.ok(saved, 'the host store must carry imported themes')
  const record = JSON.parse(JSON.stringify(saved['my-fork']))
  assert.equal(record.name, 'my-fork')
  assert.equal(record.themePickerSource, 'vscode', 'provenance is stamped at the writer')
  assert.equal(local.keys.has('hermes-desktop-user-themes-v1'), false,
    'the app\'s user-theme store must never be written')
})

test('a store that answers with a Promise is not treated as data', async () => {
  // A host with a different (async) contract must degrade to our own key rather
  // than hand a Promise to a caller that expects a map.
  const store = { get: () => Promise.resolve(null), set: () => {} }
  const local = memoryLocalStorage()
  const context = await registered(store, local)

  assert.equal(context.persistAppearance('nord-light', 'dark', 'default'), true)
  const raw = local.keys.get('chroma-appearance-v1')
  assert.ok(raw, 'the fallback key carries the value')
  assert.deepEqual(JSON.parse(raw).default, { theme: 'nord-light', mode: 'dark' })
  assert.deepEqual(JSON.parse(JSON.stringify(context.readAppearance('default'))), { theme: 'nord-light', mode: 'dark' })
})

test('without a host store, Chroma still keeps its own keys only', async () => {
  const local = memoryLocalStorage()
  const context = await registered(null, local)

  assert.equal(context.persistAppearance('nord-light', 'light', 'default'), true)
  assert.ok(local.keys.has('chroma-appearance-v1'))
  for (const key of local.keys.keys()) {
    assert.ok(key.startsWith('chroma-'), `only chroma-* keys may be written, saw ${key}`)
  }
})
