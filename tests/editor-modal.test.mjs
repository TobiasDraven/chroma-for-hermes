import assert from 'node:assert/strict'
import test from 'node:test'

import { loadPlugin } from './helpers/load-plugin.mjs'
import { BASE_CARD_PROPS, CARD_CASES, cardSpies } from './helpers/card-cases.mjs'

/**
 * The editor's pane half (plan CHROMA-EDITOR §6, §16.4, §17).
 *
 * What this file exists to stop, in the order these bugs have actually shipped:
 *   - a colour control that is not a colour control. The host UI kit has no
 *     free-form colour input, so the swatch + hidden native input + hex field is
 *     hand-rolled here, and a render that quietly loses one of the three would
 *     otherwise stay green (the pill's flex bug is the precedent).
 *   - an effective palette that is resolved but never used. The assertions below
 *     are made against a RENDERED tree, not against the resolver alone.
 *   - the shelf moving when a scene is recoloured (§17.3.2).
 *   - a read-out that fabricates a ratio for a colour that will not parse.
 *
 * The harness EXECUTES function components, so a component boundary leaves no
 * trace and what is examined here is the host-element tree the app would mount.
 */

// A catalogue scene with both modes and a rich palette: the one the card cases
// already use, so the editor is exercised against the shape the gallery ships.
const RICH_SCENE = CARD_CASES['square owned idle dark'].scene
const EMPTY_SCENE = CARD_CASES['no palette at all'].scene

const cardProps = (extra = {}) => ({ ...cardSpies(), ...BASE_CARD_PROPS, scene: RICH_SCENE, ...extra })

// --- raw element tree helpers ------------------------------------------------
// A raw element is { type, props } and its children live in props, exactly as
// the harness builds them. digestElement() flattens that shape; these tests need
// the handlers too, so they walk the raw one.
const childrenOf = (el) => {
  if (!el) return []
  if (Array.isArray(el)) return el
  const props = el.props || {}
  if (props.children === undefined) return []
  return Array.isArray(props.children) ? props.children : [props.children]
}

const at = (el, key) => (el && el.props ? el.props[key] : undefined)

function findAll(node, predicate, acc = []) {
  if (node === null || node === undefined) return acc
  if (Array.isArray(node)) { node.forEach(child => findAll(child, predicate, acc)); return acc }
  if (typeof node !== 'object') return acc
  if (predicate(node)) acc.push(node)
  findAll(childrenOf(node), predicate, acc)
  return acc
}

function textsOf(node, acc = []) {
  if (node === null || node === undefined) return acc
  if (Array.isArray(node)) { node.forEach(child => textsOf(child, acc)); return acc }
  if (typeof node === 'string' || typeof node === 'number') { acc.push(String(node)); return acc }
  if (typeof node === 'object') textsOf(childrenOf(node), acc)
  return acc
}

const countTag = (node, tag) => findAll(node, el => el.type === tag).length
const inputsOfKind = (node, kind) => findAll(node, el => el.type === 'input' && at(el, 'type') === kind)
const buttonsWith = (node, label) => findAll(node, el => el.type === 'button' && at(el, 'children') === label)
const sortedKeys = (value) => Object.keys(value || {}).sort()

function modalProps(extra = {}) {
  return {
    scene: RICH_SCENE,
    overrides: {},
    owned: false,
    mode: 'dark',
    busy: null,
    onClose: () => {},
    onSave: () => {},
    onReset: () => {},
    ...extra
  }
}

test('the gear is on every card the pane renders, and only the eye cannot see it', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const withGear = t.ThemeCard(cardProps({ onEdit: () => {} }))
  const box = childrenOf(withGear)
  assert.equal(box.length, 3, 'the box holds the card, the preview pill and the action row')
  // The actions sit INSIDE the card's frame: the row is the frame's last
  // in-flow child, so nothing can hang over the card's edge.
  const actionRow = box[2]
  const rowClass = String(at(actionRow, 'className'))
  assert.ok(rowClass.includes('mt-auto'), 'the row is the frame last in-flow child')
  assert.equal(rowClass.includes('absolute'), false, 'the row does not float over the edge')
  const buttons = findAll(actionRow, el => el.type === 'button')
  assert.equal(buttons.length, 1, 'a card with only an editor offers only Edit')
  const both = findAll(childrenOf(t.ThemeCard(cardProps({ onEdit: () => {}, onDuplicate: () => {} })))[2],
    el => el.type === 'button')
  assert.equal(both.length, 2, 'Edit and Fork travel together when both exist')
  const gear = buttons[0]
  assert.equal(gear.type, 'button')
  assert.equal(at(gear, 'type'), 'button')
  assert.equal(at(gear, 'aria-label'), 'Edit Ocean Skin')
  const classes = String(at(gear, 'className')).split(/\s+/)
  // The pill carries its own paint: the host's stylesheet did not contain these
  // utilities, so the button fell back to the host's white default and the white
  // label vanished inside it. An inline style cannot be omitted from a build.
  const style = at(gear, 'style') || {}
  assert.ok(String(style.background || '').length > 0, 'the gear paints its own background')
  assert.equal(String(style.color).toLowerCase(), '#ffffff')
  assert.ok(String(style.border || '').length > 0, 'and its own edge, so any backdrop keeps it visible')
  // A word, not a glyph. Two icon strategies reached the field as an empty
  // control: a codicon the host did not paint, and an inline SVG the app's JSX
  // runtime did not paint. Text is the one path both of them share.
  assert.ok(findAll(gear, el => (el.children === 'Edit') || at(el, 'children') === 'Edit').length,
    'the gear renders the word Edit')
  assert.equal(findAll(gear, el => String(at(el, 'className')).includes('codicon')).length, 0, 'and no icon font')

  // Pressing it opens the editor on THIS scene.
  let opened = null
  const wired = t.ThemeCard(cardProps({ onEdit: target => { opened = target } }))
  const wiredGear = findAll(childrenOf(wired)[2], el => el.type === 'button')[0]
  at(wiredGear, 'onClick')()
  assert.equal(opened, RICH_SCENE, 'the gear hands the scene to the editor')

  // A card with no editor behind it must not offer the affordance, and must
  // render as it did before the editor existed: the card parity fixture in
  // tests/fixtures renders exactly this prop set.
  const plain = t.ThemeCard(cardProps())
  assert.equal(childrenOf(plain).length, 2, 'no handler, no gear: card + pill')
  assert.equal(countTag(plain, 'button'), 2, 'the card and its pill, as before')
})

test('an overridden card carries the edited marker, and an authored one carries nothing extra', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  assert.ok(!textsOf(t.ThemeCard(cardProps())).includes('edited'), 'a shipped scene is not marked')
  const marked = t.ThemeCard(cardProps({ edited: true }))
  assert.ok(textsOf(marked).includes('edited'), 'an override is visible on the card')
  const marker = findAll(marked, el => at(el, 'children') === 'edited')[0]
  assert.match(at(marker, 'title'), /not the shipped palette/, 'the marker says what it means')
  assert.equal(countTag(marked, 'button'), 2, 'the marker adds no control')
})

test('the colour field is a swatch over a hidden native input, plus a hex field that validates', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const calls = []
  const field = t.ColorField({ id: 'chroma-edit-light-shell', value: '#123456', label: 'Shell in light mode', onChange: v => calls.push(v) })
  const native = inputsOfKind(field, 'color')
  const hex = inputsOfKind(field, 'text')
  assert.equal(native.length, 1, 'one native colour input')
  assert.equal(hex.length, 1, 'one free-text hex field')
  assert.equal(at(native[0], 'value'), '#123456', 'the native input holds the colour')
  assert.equal(at(hex[0], 'value'), '#123456', 'and so does the text field')
  assert.ok(String(at(native[0], 'className')).split(/\s+/).includes('opacity-0'), 'the native input is hidden, not removed')
  assert.equal(at(native[0], 'id'), 'chroma-edit-light-shell-color')
  assert.equal(at(hex[0], 'aria-invalid'), 'false')
  assert.equal(at(hex[0], 'placeholder'), '#rrggbb')
  const swatch = findAll(field, el => at(el, 'style') && at(el, 'style').backgroundColor)[0]
  assert.equal(at(swatch, 'style').backgroundColor, '#123456', 'the swatch paints the colour')

  at(native[0], 'onChange')({ target: { value: '#00ff00' } })
  assert.deepEqual(calls, ['#00ff00'], 'the platform picker commits immediately')
  calls.length = 0
  at(hex[0], 'onChange')({ target: { value: 'nonsense' } })
  assert.deepEqual(calls, [], 'a value that will not parse never reaches the palette')
  at(hex[0], 'onChange')({ target: { value: '#abc' } })
  assert.deepEqual(calls, ['#aabbcc'], 'a three-digit entry commits as six')
  calls.length = 0
  at(hex[0], 'onKeyDown')({ key: 'Enter' })
  assert.deepEqual(calls, ['#123456'], 'Enter commits the field it started with')
})

test('a role below its advisory target is marked, never refused, and an unreadable colour is a dash', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const below = t.ContrastChip({ ratio: 2, target: 9, label: 'Text against the shell (light)' })
  assert.equal(at(below, 'children'), '2.00:1')
  assert.ok(String(at(below, 'className')).includes('text-(--ui-warn)'), 'below target is marked')
  assert.match(at(below, 'title'), /below the 9:1 advisory target/)
  assert.equal(below.type, 'span', 'marked, never refused: it is not a control')
  const meets = t.ContrastChip({ ratio: 12.5, target: 9, label: 'Text against the shell (dark)' })
  assert.equal(at(meets, 'children'), '12.50:1')
  assert.ok(!String(at(meets, 'className')).includes('text-(--ui-warn)'), 'at or above target is not marked')
  assert.match(at(meets, 'title'), /meets the 9:1 advisory target/)
  const dash = t.ContrastChip({ ratio: null, target: 9, label: 'Text against the shell (light)' })
  assert.equal(at(dash, 'children'), '—', 'never a fabricated ratio')
  assert.match(at(dash, 'title'), /not a colour that can be measured/)

  // The read-out is the plugin's OWN contrastRatio (§16.4), null when unparseable.
  assert.equal(t.contrastReadout('#ffffff', '#000000'), 21)
  assert.equal(t.contrastReadout('#000000', '#000000'), 1)
  assert.equal(t.contrastReadout('rebeccapurple', '#000000'), null)
  assert.equal(t.contrastReadout('#ffffff', ''), null)
})

test('the modal lays out header, preview, six role rows, the advisory strip and the actions', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const modal = t.EditorModal(modalProps())
  assert.equal(at(modal, 'role'), 'dialog')
  assert.equal(at(modal, 'aria-modal'), 'true')
  assert.equal(at(modal, 'aria-label'), 'Edit Ocean Skin')
  assert.ok(String(at(modal, 'className')).includes('fixed'), 'the dialog is an overlay, inside the pane tree')
  assert.ok(String(at(modal, 'className')).includes('bg-black/50'), 'and it dims what is behind it')

  const sheet = childrenOf(modal)[0]
  const zones = childrenOf(sheet)
  assert.equal(zones.length, 3, 'a pinned header, one scrolling body, a pinned footer')
  const body = childrenOf(zones[1])
  assert.equal(body.length, 5, 'the body carries preview, legend, roles, typography and the advisory strip')
  zones.splice(1, 1, ...body)
  assert.ok(textsOf(zones[0]).some(text => text.startsWith('Edit ')), 'the header names the scene')
  assert.equal(countTag(zones[0], 'button'), 1, 'the header holds the Close button')

  // The preview is the card's own 2 x 6 block, light over dark.
  const block = childrenOf(zones[1])[0]
  const rows = childrenOf(block)
  assert.equal(rows.length, 2, 'one row for light, one for dark')
  assert.equal(childrenOf(rows[0]).length, 6, 'six bands in the light row')
  assert.equal(childrenOf(rows[1]).length, 6, 'six bands in the dark row')
  assert.equal(at(childrenOf(rows[0])[0], 'style').backgroundColor, RICH_SCENE.lightColors.background, 'light on top, as shipped')
  assert.equal(at(childrenOf(rows[1])[0], 'style').backgroundColor, RICH_SCENE.darkColors.background, 'dark below')

  // Typography: a skin is colour AND the two font stacks the engine reads.
  const fontZone = zones[4]
  // A font is chosen, never typed. The harness stubs the SDK's Select, so the
  // assertion is on what the harness can see: both roles are named, nothing is
  // typed, and no preset chips remain.
  const fontText = textsOf(fontZone)
  assert.ok(fontText.includes('Interface'), 'the interface font has a row')
  assert.ok(fontText.includes('Code'), 'the code font has a row')
  assert.equal(findAll(fontZone, el => at(el, 'type') === 'text').length, 0,
    'no free-text field: a stack is not a sentence')
  assert.equal(findAll(fontZone, el => el.type === 'button').length, 0,
    'and no preset chips to click - the list lives in the picker')

  // Role rows, light and dark side by side, each with the missing primitive.
  const roleZone = zones[3]
  const rowsFound = findAll(roleZone, el => typeof at(el, 'data-role') === 'string')
  assert.equal(rowsFound.length, t.EDITOR_ROLES.length, 'one row per editable role')
  assert.deepEqual(rowsFound.map(row => at(row, 'data-role')), Array.from(t.EDITOR_ROLES, role => role.id), 'in the strip order')
  assert.equal(inputsOfKind(roleZone, 'color').length, t.EDITOR_ROLES.length * 2, 'a native colour input per role per mode')
  assert.equal(inputsOfKind(roleZone, 'text').length, t.EDITOR_ROLES.length * 2, 'and a hex field beside each')
  const chips = findAll(roleZone, el => typeof at(el, 'title') === 'string' && /advisory target|can be measured/.test(at(el, 'title')))
  assert.equal(chips.length, t.EDITOR_ROLES.length * 2, 'and a contrast read-out per role per mode')
  // Every role the palette carries gets a number; every role it omits reads as a
  // dash. The count follows the catalogue, not a remembered figure.
  const ratios = chips.filter(chip => /^\d+\.\d\d:1$/.test(at(chip, 'children')))
  assert.ok(ratios.length >= 10, 'a real ratio for every role the palette carries, and no invented ones')
  assert.equal(chips.length - ratios.length,
    chips.filter(chip => at(chip, 'children') === '—').length,
    'every read-out is a number or a dash')
  const dimRow = rowsFound.filter(row => at(row, 'data-role') === 'dim')[0]
  const dimChips = findAll(dimRow, el => /can be measured/.test(String(at(el, 'title'))))
  assert.equal(dimChips.length, 2, 'a role this palette omits reads as a dash in both modes')
  assert.ok(dimChips.every(chip => at(chip, 'children') === '—'))

  // The advisory strip names all three targets.
  const advice = textsOf(zones[5])
  for (const label of ['Text 9:1', 'Interface 3:1', 'Signals 4.5:1']) {
    assert.ok(advice.includes(label), 'the strip shows ' + label)
  }

  // Actions: Save is ENABLED for a built-in scene (§17.1), and no Reset exists,
  // because there is no override to clear.
  const actions = textsOf(zones[6])
  assert.ok(actions.includes('Save'), 'Save is offered')
  assert.ok(!actions.includes('Reset'), 'Reset is not: only an override can be reset')
  const save = buttonsWith(zones[6], 'Save')[0]
  assert.equal(at(save, 'disabled'), true, 'Save waits for a change: an untouched save pins the shipped palette')
  assert.match(at(save, 'title'), /override of the shipped palette/)
})

test('an override reaches the fields, offers Reset, and a read-only card says why', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const override = { light: { ui_accent: '#ff00ff' }, dark: { background: '#010203' } }
  const modal = t.EditorModal(modalProps({ overrides: { 'ocean-skin': override } }))
  const values = inputsOfKind(modal, 'text').map(input => at(input, 'value'))
  assert.ok(values.includes('#ff00ff'), 'the light signature field shows the override')
  assert.ok(values.includes('#010203'), 'the dark shell field shows the override')
  assert.ok(values.includes(RICH_SCENE.lightColors.background), 'a role the override omits keeps the authored value')

  // The preview paints the EFFECTIVE palette, not the authored one.
  const preview = findAll(modal, el => String(at(el, 'className')).includes('h-16'))[0]
  const rows = childrenOf(childrenOf(preview)[0])
  const lightRow = rows[0]
  const darkRow = rows[1]
  assert.equal(at(childrenOf(lightRow)[2], 'style').backgroundColor, '#ff00ff', 'light row: the accent is the override')
  assert.equal(at(childrenOf(darkRow)[0], 'style').backgroundColor, '#010203', 'dark row: the shell is the override')

  const texts = textsOf(modal)
  assert.ok(texts.includes('Reset'), 'Reset appears once an override exists')
  assert.ok(texts.some(text => text.includes('Carries your override')), 'and the header says so')
  assert.match(at(buttonsWith(modal, 'Reset')[0], 'title'), /shipped palette back/)

  // An owned skin is edited IN PLACE (§3, §19.3): Save is ENABLED and says so.
  // There is no authored palette to restore, so no Reset is offered — not even
  // when a stray override record happens to share the name.
  const owned = t.EditorModal(modalProps({ owned: true, overrides: { 'ocean-skin': override } }))
  const ownedSave = buttonsWith(owned, 'Save')[0]
  assert.equal(at(ownedSave, 'disabled'), true, 'an owned skin also saves only when something changed')
  assert.match(at(ownedSave, 'title'), /in place/, 'Save names the in-place door')
  assert.ok(textsOf(owned).some(text => text.includes('rewrites its file in place')), 'and the header says so')
  assert.ok(!textsOf(owned).includes('Reset'), 'an owned skin has no authored palette to reset')
  assert.ok(textsOf(owned).some(text => text.includes('Your own skin file.')), 'the state line names the owned file')

  // The mode pair and the writer's caps come from GET /schema when the editor
  // has it (§19.2 item 1); the caps are displayed, never re-declared.
  const withSchema = t.EditorModal(modalProps({ modes: ['light', 'dark'], caps: { maxColors: 512, maxBytes: 65536 } }))
  assert.ok(textsOf(withSchema).includes('Caps 512 colours · 64 KB'), 'the caps are shown from the schema')
  const withoutCaps = t.EditorModal(modalProps())
  assert.ok(!textsOf(withoutCaps).some(text => text.startsWith('Caps ')), 'no schema, no caps line')
})

test('a busy write labels itself, and a palette with nothing in it renders dashes', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const saving = t.EditorModal(modalProps({ overrides: { 'ocean-skin': {} }, busy: 'save' }))
  assert.ok(textsOf(saving).includes('Saving…'), 'the button reports the write in flight')
  assert.equal(at(buttonsWith(saving, 'Saving…')[0], 'disabled'), true)

  const empty = t.EditorModal(modalProps({ scene: EMPTY_SCENE }))
  assert.equal(textsOf(empty).filter(text => text === '—').length, t.EDITOR_ROLES.length * 2, 'one dash per read-out, no invented numbers')
  assert.equal(inputsOfKind(empty, 'text').filter(input => at(input, 'value')).length, 0, 'and empty fields to fill')
})

test('the effective palette is override ?? authored, and the authored scene is never mutated', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const before = JSON.stringify(RICH_SCENE)
  const resolved = t.applyOverride(RICH_SCENE, { 'ocean-skin': { light: { ui_accent: '#ff00ff' }, dark: { background: '#010203' } } })
  assert.notEqual(resolved, RICH_SCENE, 'a copy comes back, not the authored object')
  assert.equal(resolved.lightColors.ui_accent, '#ff00ff')
  assert.equal(resolved.lightColors.background, RICH_SCENE.lightColors.background, 'unset roles survive the merge')
  assert.equal(resolved.darkColors.background, '#010203')
  assert.deepEqual(sortedKeys(resolved.lightColors), sortedKeys(RICH_SCENE.lightColors), 'the merge adds no role')
  assert.equal(JSON.stringify(RICH_SCENE), before, 'the catalogue itself is untouched')
  assert.equal(t.applyOverride(RICH_SCENE, {}), RICH_SCENE, 'no override is a pass-through')
  assert.equal(t.sceneModePalette(resolved, 'dark').background, '#010203')
})

test('the shelf does not move: grouping runs on the authored palette', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  // A green scene files under Nature. Desaturated to a near-neutral it files as
  // Minimal instead — which is exactly why the resolver must never feed the
  // classifier: an override changes the card, never the shelf.
  const scene = {
    name: 'shelf-skin', label: 'Shelf', modeSupport: 'dynamic',
    colors: { background: '#101418', ui_accent: '#1f9d55', banner_text: '#f2f2f2' },
    lightColors: { background: '#101418', ui_accent: '#1f9d55', banner_text: '#f2f2f2' },
    darkColors: { background: '#101418', ui_accent: '#1f9d55', banner_text: '#f2f2f2' }
  }
  const overrides = { 'shelf-skin': { light: { ui_accent: '#8f8f8f' }, dark: { ui_accent: '#8f8f8f' } } }
  const authored = t.groupCards([scene], {}, 'theme').filter(group => group.scenes.length)
  const grouped = t.groupCards([scene], overrides, 'theme').filter(group => group.scenes.length)
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].id, authored[0].id, 'the card stays on its shelf')
  assert.equal(grouped[0].scenes[0].lightColors.ui_accent, '#8f8f8f', 'while the card itself is recoloured')
  // The trap, demonstrated rather than asserted in the abstract: hand the
  // RESOLVED scene to the grouper and the shelf moves.
  const resolved = t.applyOverride(scene, overrides)
  const resolvedGroups = t.groupCards([resolved], {}, 'theme').filter(group => group.scenes.length)
  assert.notEqual(resolvedGroups[0].id, authored[0].id, 'grouping a resolved palette is what would move it')
})

test('an override is written through PUT /overrides/{scene} and cleared with DELETE', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const calls = []
  let answer = {}
  context.plugin.register({
    rest: async (path, options) => { calls.push({ path, options }); return answer },
    register() {},
    storage: { get: async () => null, set: async () => {} }
  })

  await t.putOverride('ocean-skin', { light: { ui_accent: '#ff00ff' }, dark: {} })
  assert.equal(calls[0].path, 'overrides/ocean-skin', 'the route is the one §5 names')
  assert.equal(calls[0].options.method, 'PUT')
  assert.deepEqual(JSON.parse(calls[0].options.body), { light: { ui_accent: '#ff00ff' }, dark: {} })
  await t.dropOverride('ocean-skin')
  assert.equal(calls[1].path, 'overrides/ocean-skin')
  assert.equal(calls[1].options.method, 'DELETE')

  assert.deepEqual(sortedKeys(await t.listOverrides()), [], 'a null answer is no overrides')
  answer = { overrides: { 'ocean-skin': { light: { ui_accent: '#ff00ff' } } } }
  const wrapped = await t.listOverrides()
  assert.deepEqual(sortedKeys(wrapped), ['ocean-skin'], 'the wrapped envelope is read')
  assert.equal(wrapped['ocean-skin'].light.ui_accent, '#ff00ff')
  answer = { 'ocean-skin': { light: {} } }
  assert.deepEqual(sortedKeys(await t.listOverrides()), ['ocean-skin'], 'a bare map is accepted too')
  answer = { something: 'else' }
  assert.deepEqual(sortedKeys(await t.listOverrides()), ['something'])
})

test('a 404 says restart Hermes, and a failed write never reads as a success', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const notFound = t.overrideFailureNotice({ status: 404 }, 'save')
  assert.equal(notFound.kind, 'error')
  assert.equal(notFound.message, 'Restart Hermes to enable the editor')
  assert.match(notFound.detail, /still here/, 'the edit is not claimed as lost')
  assert.equal(t.overrideFailureNotice(new Error('404: Not Found'), 'reset').message, 'Restart Hermes to enable the editor')
  assert.equal(t.overrideFailureNotice(new Error('plugin backend not ready'), 'save').message, 'The gateway half is not installed')
  const other = t.overrideFailureNotice(new Error('boom'), 'save')
  assert.equal(other.message, 'Save failed: boom')
  assert.match(other.detail, /Nothing was changed/)
  assert.equal(t.isMissingRoute(null), false)
  assert.equal(t.isMissingRoute(new Error('500 Internal Server Error')), false)
})

test('a draft becomes the override body the routes expect', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const draft = t.draftForScene(RICH_SCENE, 'light')
  assert.equal(draft.shell, RICH_SCENE.lightColors.background)
  assert.equal(draft.signature, RICH_SCENE.lightColors.ui_accent)
  // ui_text is the key the palette engine reads first; banner_text is its alias.
  // Writing the alias moved the preview and left the applied theme untouched.
  assert.equal(draft.text, RICH_SCENE.lightColors.ui_text)
  assert.equal(draft.dim, '', 'a role the palette omits is empty, not invented')
  const payload = t.overridePayload({ light: draft, dark: t.draftForScene(EMPTY_SCENE, 'dark') })
  // The body carries exactly the primary key of every role the palette holds.
  // The expected list is derived from the palette, so adding a role cannot leave
  // a stale literal behind.
  const expected = []
  for (const role of t.EDITOR_ROLES) {
    if (RICH_SCENE.lightColors[role.keys[0]]) expected.push(role.keys[0])
  }
  assert.deepEqual(sortedKeys(payload.light), expected.sort(), 'the primary skin key per role, no aliases')
  assert.deepEqual(sortedKeys(payload.dark), [], 'a role with nothing in it is omitted, not sent as an empty string')
  assert.equal(payload.light.background, RICH_SCENE.lightColors.background)
  assert.ok(t.modeDraftEqual({ shell: '#abc' }, { shell: '#aabbcc' }), 'three digits and six are the same colour')
  assert.ok(!t.modeDraftEqual({ shell: '#abc' }, { shell: '#abd' }), 'and two different colours are not')
  assert.ok(t.modeDraftEqual({ dim: '' }, {}), 'an absent role and an empty one are the same absence')
  assert.ok(!t.modeDraftEqual(t.draftForScene(RICH_SCENE, 'light'), t.draftForScene(EMPTY_SCENE, 'light')), 'a filled draft differs from an empty one')
  assert.equal(t.adviceTarget({ kind: 'text' }), 9)
  assert.equal(t.adviceTarget({ kind: 'signals' }), 4.5)
  assert.equal(t.adviceTarget({ kind: 'interface' }), 3)
})
