import assert from 'node:assert/strict'
import test from 'node:test'

import { loadPlugin } from './helpers/load-plugin.mjs'

/**
 * E1b — the editor's save door and its schema consumption (plan §3, §19.2 item 1,
 * §19.3).
 *
 * Two things this file exists to stop:
 *   - an owned skin with no way to edit it. `PUT /skins/{name}` exists; the pane
 *     must reach it, and the door must be chosen by OWNERSHIP, not by the name.
 *   - a schema that is fetched and ignored. The six rows stay the card's anatomy,
 *     but the mode pair and the caps come from the backend, and a role whose
 *     primary key is not in `paletteKeys` must be raised, not swallowed.
 */

async function withRest(handler) {
  const { context } = await loadPlugin()
  context.plugin.register({
    rest: handler,
    register() {},
    storage: { get: async () => null, set: async () => {} }
  })
  return context.testHelpers
}

// Values built inside the vm context carry that realm's prototypes, and
// node:assert/strict compares prototypes. Round-trip through JSON so a
// comparison is about the value, not the realm it was born in.
const plain = value => (value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)))

test('an owned skin is written IN PLACE through PUT /skins/{name}', async () => {
  const calls = []
  const t = await withRest(async (path, options) => { calls.push({ path, options }); return { ok: true } })

  await t.putSkin('ocean-skin', { light: { ui_accent: '#ff00ff' }, dark: {} })
  assert.equal(calls[0].path, 'skins/ocean-skin', 'the in-place route')
  assert.equal(calls[0].options.method, 'PUT')
  assert.deepEqual(JSON.parse(calls[0].options.body), { light: { ui_accent: '#ff00ff' }, dark: {} })

  // The two doors are genuinely different routes.
  await t.putOverride('ocean-skin', { light: {}, dark: {} })
  assert.equal(calls[1].path, 'overrides/ocean-skin', 'the override door is not the skin door')

  // A pane with no backend cannot write either: same refusal as the override.
  const bare = await loadPlugin()
  await assert.rejects(() => bare.context.testHelpers.putSkin('x', { light: {}, dark: {} }))
})

test('the payload iterates the modes /schema reports, defaulting to the pair', async () => {
  const t = (await loadPlugin()).context.testHelpers
  const draft = { light: { shell: '#101010' }, dark: { shell: '#000000' } }
  assert.deepEqual(plain(t.overridePayload(draft)), { light: { background: '#101010' }, dark: { background: '#000000' } })
  assert.deepEqual(plain(t.overridePayload(draft, ['light'])), { light: { background: '#101010' }, dark: {} },
    'a schema that speaks one mode writes one mode')
})

test('the mode pair comes from /schema when it answers, and falls back when it does not', async () => {
  const t = (await loadPlugin()).context.testHelpers
  assert.deepEqual(plain(t.editorModes(null)), ['light', 'dark'], 'no schema, the standing pair')
  assert.deepEqual(plain(t.editorModes({ modes: ['light', 'dark'] })), ['light', 'dark'])
  assert.deepEqual(plain(t.editorModes({ modes: ['dark'] })), ['dark'], 'a single-mode schema is read as-is')
  assert.deepEqual(plain(t.editorModes({ modes: ['sepia'] })), ['light', 'dark'], 'an unknown mode is ignored, never offered')
})

test('the size caps are read from /schema, not re-declared', async () => {
  const t = (await loadPlugin()).context.testHelpers
  assert.equal(t.schemaCaps(null), null)
  assert.deepEqual(plain(t.schemaCaps({ caps: { maxColors: 512, maxBytes: 65536 } })), { maxColors: 512, maxBytes: 65536 })
  assert.equal(t.schemaCaps({ caps: {} }), null, 'an empty caps map is no caps')
})

test('a role whose primary key is missing from paletteKeys raises a drift alarm', async () => {
  const t = (await loadPlugin()).context.testHelpers
  const agreeing = ['background', 'status_bar_bg', 'ui_accent', 'banner_text', 'banner_dim', 'ui_border']
  assert.equal(t.schemaDrift(t.EDITOR_ROLES, agreeing).length, 0, 'the two vocabularies agree today')

  const drifted = t.schemaDrift(t.EDITOR_ROLES, ['background', 'ui_accent'])
  assert.deepEqual(
    plain(drifted.map(item => item.role + ':' + item.key)),
    ['surface:status_bar_bg', 'text:banner_text', 'dim:banner_dim', 'structure:ui_border']
  )
  const notice = t.schemaDriftNotice(drifted)
  assert.equal(notice.kind, 'warning')
  assert.match(notice.message, /surface/)
  assert.match(notice.message, /status_bar_bg/)
  assert.equal(t.schemaDriftNotice([]), null, 'agreement is silent')
})

test('fetchEditorSchema reads once, caches, and degrades to null when the route is absent', async () => {
  const calls = []
  const answering = await withRest(async path => { calls.push(path); return { modes: ['light', 'dark'], paletteKeys: [] } })
  const first = await answering.fetchEditorSchema()
  const second = await answering.fetchEditorSchema()
  assert.equal(calls.length, 1, 'the schema is read once and cached for the session')
  assert.equal(second, first, 'and the same object comes back')
  assert.deepEqual(plain(first.modes), ['light', 'dark'])

  const missing = await withRest(async () => { throw Object.assign(new Error('404: Not Found'), { status: 404 }) })
  assert.equal(await missing.fetchEditorSchema(), null, 'an absent route degrades to null, never a throw')
  const notice = missing.schemaMissingNotice()
  assert.equal(notice.kind, 'info')
  assert.match(notice.message, /without GET \/schema/)
})

test('an in-place save folds the backend read-back into the pane scene', async () => {
  const t = (await loadPlugin()).context.testHelpers
  t.IMPORTED_SKINS.push({ name: 'editable', label: 'Editable', modeSupport: 'light', colors: { background: '#101010' }, lightColors: { background: '#101010' } })
  t.foldSavedSkin('editable', { light: { background: '#222222' }, dark: { background: '#000000' } })
  const scene = t.IMPORTED_SKINS.find(item => item.name === 'editable')
  assert.equal(scene.lightColors.background, '#222222', 'the written light palette wins')
  assert.equal(scene.darkColors.background, '#000000', 'and so does the dark one')

  // A skin only known from live discovery is recorded, not silently dropped.
  t.foldSavedSkin('discovered', { light: { background: '#333333' }, dark: {} })
  const made = t.IMPORTED_SKINS.find(item => item.name === 'discovered')
  assert.equal(made.lightColors.background, '#333333')
  assert.equal(made.modeSupport, 'light', 'one mode means a single-mode scene')

  // A payload with nothing to fold leaves the list exactly as it was.
  const before = t.IMPORTED_SKINS.length
  t.foldSavedSkin('nope', null)
  assert.equal(t.IMPORTED_SKINS.length, before)
})

test('a failed save names the door that failed', async () => {
  const t = (await loadPlugin()).context.testHelpers
  const skin = t.overrideFailureNotice(new Error('boom'), 'save', 'skin')
  assert.equal(skin.title, 'Skin save failed')
  assert.match(skin.detail, /skin write did not go through/)
  const override = t.overrideFailureNotice(new Error('boom'), 'save', 'override')
  assert.equal(override.title, 'Save failed')
  assert.match(override.detail, /override write did not go through/)
  assert.equal(t.overrideFailureNotice({ status: 404 }, 'save', 'skin').message, 'Restart Hermes to enable the editor')
})
