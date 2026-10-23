import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { loadPlugin } from './helpers/load-plugin.mjs'

/**
 * The bug this test exists to stop.
 *
 * `importTweakcn` used to end with
 *     await importThemeIntoSkins(name, theme).catch(() => null)
 * and then ALWAYS raise a plain "Imported ..." toast. On an install with no
 * Python half mounted - the normal Desktop-only case - the gateway skin was
 * never minted, yet the user was told it was. The UI told the user a lie, which
 * is the most corrosive defect a product can ship.
 *
 * These tests pin the honest behaviour: only a real gateway mint may raise the
 * bare success string, a missing backend is named as such, and a backend error
 * is surfaced with its reason rather than swallowed.
 */

const h = async () => (await loadPlugin()).context.testHelpers

test('a real gateway mint reports a plain success', async () => {
  const t = await h()
  const notice = t.importOutcomeNotice('Catppuccin', true, null)
  assert.equal(notice.kind, 'info')
  assert.equal(notice.message, 'Imported Catppuccin')
})

test('a missing backend is reported as local-only, never as success', async () => {
  const t = await h()
  const notice = t.importOutcomeNotice('Catppuccin', false, new Error('plugin backend not ready'))
  assert.notEqual(notice.kind, 'info', 'a failed mint must not raise a success toast')
  assert.equal(notice.kind, 'warning')
  assert.match(notice.message, /for this Desktop only/)
  assert.match(notice.message, /backend is not installed/)
  assert.notEqual(notice.message, 'Imported Catppuccin', 'the bare success string is reserved for a real mint')
})

test('a backend that errors is reported with its reason, not swallowed', async () => {
  const t = await h()
  const notice = t.importOutcomeNotice('Catppuccin', false, new Error('HTTP 500'))
  assert.equal(notice.kind, 'warning')
  assert.match(notice.message, /not created/)
  assert.match(notice.message, /HTTP 500/, 'the backend error must reach the user, not vanish')
})

test('hasGatewayBackend tracks the mounted backend slot', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  assert.equal(t.hasGatewayBackend(), false, 'no rest port before register means no backend')
  context.plugin.register({
    rest: async () => ({ skins: [] }),
    register() {},
    storage: { get: async () => null, set: async () => {} }
  })
  assert.equal(t.hasGatewayBackend(), true, 'register() handing over a rest port means the backend is mounted')
})

test('the shipped build never discards a backend failure with .catch(() => null)', async () => {
  const source = await readFile(new URL('../chroma/desktop/plugin.js', import.meta.url), 'utf8')
  assert.ok(
    !/importThemeIntoSkins\([^)]*\)\.catch\(\(\) => null\)/.test(source),
    'a failed gateway mint must be surfaced, not swallowed by .catch(() => null)'
  )
  // And the local-only notice the user sees must be reachable from the shipped
  // build, so the fix cannot silently regress to a bare success toast.
  assert.ok(source.includes('importOutcomeNotice'), 'the outcome notice chooser must ship')
})
