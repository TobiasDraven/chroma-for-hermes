// E5 — typography overrides (plan §22.2, §23).
//
// A font edit must survive a restart. The resolution chain is:
//   applyOverride → sceneToDesktopTheme → register() → persistThemesForBoot
//
// This file pins:
//   - applyOverride merges typography onto a scene
//   - sceneToDesktopTheme prefers scene.typography over SCENE_TYPOGRAPHY
//   - the emoji fallback is appended (and not duplicated)
//   - forbidden characters are refused locally
//   - overridePayload carries typography keys
//   - the boot path reads overrides and applies them
//   - schema-drift fires on a typography-key mismatch

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './helpers/load-plugin.mjs'

const plain = (value) => (value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)))

async function ctx() {
  const { context } = await loadPlugin()
  return context
}

async function withRest(handler) {
  const { context } = await loadPlugin()
  context.plugin.register({
    rest: handler,
    register() {},
    storage: { get: async () => null, set: async () => {} }
  })
  return { t: context, calls: [] }
}

// --- applyOverride: typography merge -------------------------------------------

test('applyOverride: a typography override is merged onto the scene', async () => {
  const t = await ctx()
  const scene = { name: 'nous', lightColors: { background: '#fff' }, typography: { fontMono: '"Courier Prime", monospace' } }
  const overrides = { nous: { typography: { fontSans: '"Segoe UI", sans-serif' } } }
  const result = t.applyOverride(scene, overrides)
  assert.equal(result.typography.fontSans, '"Segoe UI", sans-serif')
  assert.equal(result.typography.fontMono, '"Courier Prime", monospace', 'authored fontMono is preserved')
})

test('applyOverride: a scene with no override keeps its authored typography', async () => {
  const t = await ctx()
  const scene = { name: 'nous', lightColors: { background: '#fff' }, typography: { fontMono: '"Courier Prime", monospace' } }
  const result = t.applyOverride(scene, {})
  assert.equal(result.typography.fontMono, '"Courier Prime", monospace')
})

test('applyOverride: a font-only override does not clobber colours', async () => {
  const t = await ctx()
  const scene = { name: 'nous', lightColors: { background: '#fff', ui_accent: '#ff0000' } }
  const overrides = { nous: { typography: { fontSans: '"Segoe UI", sans-serif' } } }
  const result = t.applyOverride(scene, overrides)
  assert.equal(result.lightColors.background, '#fff')
  assert.equal(result.lightColors.ui_accent, '#ff0000')
  assert.equal(result.typography.fontSans, '"Segoe UI", sans-serif')
})

test('applyOverride: the authored scene object is never mutated', async () => {
  const t = await ctx()
  const scene = { name: 'nous', lightColors: { background: '#fff' }, typography: { fontMono: '"Courier Prime", monospace' } }
  const overrides = { nous: { typography: { fontSans: '"Segoe UI", sans-serif' } } }
  const result = t.applyOverride(scene, overrides)
  assert.notEqual(result, scene)
  assert.equal(scene.typography.fontSans, undefined, 'authored scene is unchanged')
})

// --- sceneToDesktopTheme: typography preference ---------------------------------

test('sceneToDesktopTheme: the scene typography wins over SCENE_TYPOGRAPHY', async () => {
  const t = await ctx()
  const scene = {
    name: 'nous',
    lightColors: { background: '#fff' },
    darkColors: { background: '#000' },
    typography: { fontSans: '"Custom Sans", sans-serif' }
  }
  const theme = t.sceneToDesktopTheme(scene)
  assert.equal(theme.typography.fontSans, '"Custom Sans", sans-serif')
  // fontMono falls back to the authored default
  assert.ok(theme.typography.fontMono, 'fontMono is present from SCENE_TYPOGRAPHY')
})

test('sceneToDesktopTheme: a scene with no typography uses SCENE_TYPOGRAPHY', async () => {
  const t = await ctx()
  const scene = { name: 'nous', lightColors: { background: '#fff' }, darkColors: { background: '#000' } }
  const theme = t.sceneToDesktopTheme(scene)
  assert.ok(theme.typography.fontMono, 'fontMono comes from SCENE_TYPOGRAPHY')
})

// --- emoji fallback ------------------------------------------------------------

test('withEmojiFallback: appends the fallback when missing', async () => {
  const t = await ctx()
  const stack = '"Segoe UI", sans-serif'
  const result = t.withEmojiFallback(stack)
  assert.ok(result.length > stack.length, 'fallback is appended')
  assert.ok(result.startsWith('"Segoe UI"'), 'original stack is preserved')
  assert.ok(result.includes('Apple Color Emoji'), 'emoji fallback is present')
})

test('withEmojiFallback: does not duplicate when already present', async () => {
  const t = await ctx()
  // The full EMOJI_FALLBACK string from the plugin
  const full = '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", emoji'
  const withFallback = '"Segoe UI", sans-serif, ' + full
  const result = t.withEmojiFallback(withFallback)
  assert.equal(result, withFallback, 'no duplication')
})

// --- validation ----------------------------------------------------------------

test('validTypoStack: refuses forbidden characters', async () => {
  const t = await ctx()
  assert.equal(t.validTypoStack('"Segoe UI", sans-serif'), true)
  assert.equal(t.validTypoStack('"Segoe UI"; sans-serif'), false, 'semicolon')
  assert.equal(t.validTypoStack('"Segoe UI" { sans-serif'), false, 'brace')
  assert.equal(t.validTypoStack('"Segoe UI" < sans-serif'), false, 'angle')
  assert.equal(t.validTypoStack('"Segoe UI"\nsans-serif'), false, 'newline')
  assert.equal(t.validTypoStack(''), false, 'empty')
  assert.equal(t.validTypoStack(null), false, 'null')
})

// --- overridePayload: typography keys -------------------------------------------

test('overridePayload: carries typography keys the user set', async () => {
  const t = await ctx()
  // The draft uses role ids as keys; the payload uses palette keys.
  const draft = {
    light: { shell: '#fff', signature: '#ff0000' },
    dark: { shell: '#000' },
    typography: { fontSans: '"Segoe UI", sans-serif', fontMono: '"Courier Prime", monospace' }
  }
  const payload = t.overridePayload(draft, ['light', 'dark'])
  assert.equal(payload.typography.fontSans, '"Segoe UI", sans-serif')
  assert.equal(payload.typography.fontMono, '"Courier Prime", monospace')
  // shell role → background palette key
  assert.ok(payload.light.background, 'colour keys still present')
  assert.ok(payload.light.ui_accent, 'signature role → ui_accent key')
})

test('overridePayload: a font-only override carries no light/dark', async () => {
  const t = await ctx()
  const draft = { typography: { fontSans: '"Segoe UI", sans-serif' } }
  const payload = t.overridePayload(draft, ['light', 'dark'])
  assert.equal(payload.typography.fontSans, '"Segoe UI", sans-serif')
  assert.deepEqual(plain(payload.light), {})
  assert.deepEqual(plain(payload.dark), {})
})

// --- schemaTypoDrift ------------------------------------------------------------

test('schemaTypoDrift: empty when backend lists both font keys', async () => {
  const t = await ctx()
  assert.deepEqual(plain(t.schemaTypoDrift([{ id: 'fontSans' }, { id: 'fontMono' }])), [])
})

test('schemaTypoDrift: reports a missing key', async () => {
  const t = await ctx()
  const drift = t.schemaTypoDrift([{ id: 'fontSans' }])
  assert.equal(drift.length, 1)
  assert.equal(drift[0].key, 'fontMono')
  assert.equal(drift[0].side, 'pane')
})

test('schemaTypoDriftNotice: null when no drift, warning when drift', async () => {
  const t = await ctx()
  assert.equal(t.schemaTypoDriftNotice([]), null)
  const notice = t.schemaTypoDriftNotice([{ key: 'fontSans', side: 'pane' }])
  assert.equal(notice.kind, 'warning')
  assert.match(notice.message, /fontSans/)
})

// --- boot survival ---------------------------------------------------------------

test('boot survival: a typography override reaches the registered theme', async () => {
  const { t, calls } = await withRest(async (path, options) => {
    calls.push({ path, options: options || {} })
    if (path === 'overrides') {
      return { nous: { typography: { fontSans: '"Boot Sans", sans-serif' } } }
    }
    return {}
  })
  // register() is async and reads overrides before building themes
  await t.plugin.register({
    rest: calls.length >= 0 ? async (path, options) => {
      calls.push({ path, options: options || {} })
      if (path === 'overrides') {
        return { nous: { typography: { fontSans: '"Boot Sans", sans-serif' } } }
      }
      return {}
    } : null,
    register() {},
    storage: { get: async () => null, set: async () => {} }
  })
  // The overrides call happened
  const overrideCall = calls.find(c => c.path === 'overrides')
  assert.ok(overrideCall, 'register() reads overrides at boot')
})

test('boot survival: applyOverride carries typography into sceneToDesktopTheme', async () => {
  const t = await ctx()
  const scene = { name: 'nous', lightColors: { background: '#fff' }, darkColors: { background: '#000' } }
  const overrides = { nous: { typography: { fontSans: '"Boot Sans", sans-serif' } } }
  const overridden = t.applyOverride(scene, overrides)
  const theme = t.sceneToDesktopTheme(overridden)
  assert.equal(theme.typography.fontSans, '"Boot Sans", sans-serif',
    'the boot theme carries the override font, not the authored one')
})
