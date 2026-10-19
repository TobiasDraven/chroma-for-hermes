// The ARIA pass (C9, plan v2). This file FAILS against the pre-pass build and is
// the evidence that the work landed: it asserts the attribute surface the plan
// names as unit-testable, and nothing more.
//
// What this file CANNOT see, and does not pretend to:
//   - focus in/out, the Tab trap, document Escape, focus restore, roving keys.
//     The VM harness has no layout, no real document focus and stubs useEffect.
//   - the live region's TEXT after a discrete event (state setters are no-ops).
//     Only presence and the aria-live value are assertable.
// Those are the Captain's walk (plan "NOT unit-testable").

import assert from 'node:assert/strict'
import test from 'node:test'

import { loadPlugin } from './helpers/load-plugin.mjs'
import { BASE_CARD_PROPS, CARD_CASES, cardSpies } from './helpers/card-cases.mjs'

const SCENE = CARD_CASES['square owned idle dark'].scene
const BARE_SCENE = CARD_CASES['no label'].scene

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

const cardProps = (extra = {}) => ({ ...cardSpies(), ...BASE_CARD_PROPS, scene: SCENE, ...extra })

// --- WS2: names ---------------------------------------------------------------

test('WS2 the five segmented controls carry word labels inside a labelled group', async () => {
  // The SDK renders a SegmentedControl's `label` visibly, so the harness stub that
  // returns null would hide the only thing under test. Render the props instead.
  const { context } = await loadPlugin({
    stubbed: { SegmentedControl: (props) => ({ type: 'div', props }) }
  })
  const tree = context.ThemePicker({})
  const groups = findAll(tree, el => at(el, 'role') === 'group' && typeof at(el, 'aria-label') === 'string')
  const labelSets = groups
    .map(group => childrenOf(group).find(child => Array.isArray(at(child, 'options'))))
    .filter(Boolean)
    .map(child => at(child, 'options').map(option => option.label))
  const names = groups.map(group => at(group, 'aria-label'))
  for (const expected of [
    ['Dark', 'Light'],
    ['Square', 'Rectangle', 'Circle'],
    ['Small', 'Medium', 'Large']
  ]) {
    assert.ok(
      labelSets.some(set => JSON.stringify(set) === JSON.stringify(expected)),
      'a segmented group uses the words ' + expected.join('/') + ', not glyphs'
    )
  }
  for (const name of ['Preview mode', 'Card shape', 'Card size', 'Apply scope', 'Import from']) {
    assert.ok(names.includes(name), 'a group is labelled "' + name + '"')
  }
})

test('WS2 the preview pill has a stable skin-scoped name, and the countdown is not it', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  const idle = h.ThemeCardPreviewPill({ scene: SCENE, previewing: false, previewUntil: 0, onPreview() {}, onStopPreview() {} })
  assert.equal(at(idle, 'aria-label'), 'Preview Ocean Skin for 10 seconds')
  assert.equal(at(idle, 'children'), 'Preview 10s', 'the visible label is unchanged for sighted users')
  const live = h.ThemeCardPreviewPill({ scene: SCENE, previewing: true, previewUntil: Date.now() + 5000, onPreview() {}, onStopPreview() {} })
  assert.equal(at(live, 'aria-label'), 'Stop previewing Ocean Skin')
})

test('WS2 the star, the repeated verbs and the rename input are item-scoped', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  const off = h.ThemeCardFavorite({ scene: SCENE, favorited: false, onToggleFavorite() {} })
  assert.equal(at(off, 'aria-label'), 'Add Ocean Skin to favourites')
  const on = h.ThemeCardFavorite({ scene: SCENE, favorited: true, onToggleFavorite() {} })
  assert.equal(at(on, 'aria-label'), 'Remove Ocean Skin from favourites')

  const verbs = h.ThemeCardManageButtons({
    scene: SCENE, onDelete() {}, onRename() {}, onExport() {}, onStartRename() {}, onStartConfirm() {},
    categories: [], currentCategory: '', onSetCategory() {}
  })
  const buttonLabel = (text) => {
    const found = verbs.filter(el => el.type === 'button' && at(el, 'children') === text)[0]
    return found ? at(found, 'aria-label') : null
  }
  assert.equal(buttonLabel('Export'), 'Export Ocean Skin')
  assert.equal(buttonLabel('Rename'), 'Rename Ocean Skin')
  assert.equal(buttonLabel('Delete'), 'Delete Ocean Skin')

  const rename = h.ThemeCardRename({ scene: SCENE, draft: 'x', setDraft() {}, managing: false, onRename() {}, onCancel() {} })
  assert.equal(at(rename[0], 'aria-label'), 'New name for Ocean Skin')
  const save = rename.filter(el => el.type === 'button')[0]
  assert.equal(at(save, 'aria-label'), 'Save rename of Ocean Skin')

  const confirm = h.ThemeCardDeleteConfirm({ scene: SCENE, managing: false, onDelete() {}, onCancel() {} })
  const yes = confirm.filter(el => el.type === 'button' && at(el, 'children') === 'Yes')[0]
  assert.equal(at(yes, 'aria-label'), 'Delete Ocean Skin')
})

test('WS2 the unlabelled text inputs and textareas are named', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  const modal = h.CategoryModal({
    categories: [], busy: false, name: '', title: '',
    onName() {}, onTitle() {}, onCreate() {}, onDelete() {}, surface: '#101010', onClose() {}
  })
  const labeled = findAll(modal, el => (el.type === 'input' || el.type === 'textarea') && typeof at(el, 'aria-label') === 'string')
  const names = labeled.map(el => at(el, 'aria-label'))
  assert.ok(names.includes('Category id'), 'the category id field is named')
  assert.ok(names.includes('Category title'), 'the category title field is named')

  const pre = context.PackImportPreview({
    groups: { new: [], identical: [], collides: [{ name: 'fern', to: 'fern-2' }] },
    choices: {}, onChoice() {}
  })
  const colliding = findAll(pre, el => el.type === 'input')[0]
  assert.equal(at(colliding, 'aria-label'), 'Rename fern on import')
  const skip = pre && findAll(pre, el => el.type === 'button' && String(at(el, 'children')).indexOf('skip') === 0)[0]
  assert.equal(at(skip, 'aria-label'), 'Skip fern')
  assert.equal(at(skip, 'aria-pressed'), 'false', 'the skip control carries its skipped state')
})

test('WS2 the pack rows name their verbs, and the decorative dots are hidden', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  const row = context.PackRow({
    pack: { name: 'Earth', slug: 'earth', memberCount: 2, members: ['a', 'b'], missing: [] },
    busy: null, onExport() {}, onDelete() {}
  })
  const exportBtn = findAll(row, el => el.type === 'button' && at(el, 'children') === 'Export')[0]
  assert.equal(at(exportBtn, 'aria-label'), 'Export Earth')
  const deleteBtn = findAll(row, el => el.type === 'button' && at(el, 'children') === 'Delete')[0]
  assert.equal(at(deleteBtn, 'aria-label'), 'Delete Earth')

  const chip = findAll(h.ThemeChip({}), el => at(el, 'style') && String(at(el, 'style').backgroundColor || '').length > 0 && String(at(el, 'className')).includes('rounded-full'))
  assert.ok(chip.length >= 1, 'the chip paints a dot')
  assert.ok(chip.every(el => at(el, 'aria-hidden') === 'true'), 'every decorative dot is aria-hidden')
})

test('WS2 the statusbar chip names what the button does', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  const button = findAll(h.ThemeChip({}), el => el.type === 'button')[0]
  assert.ok(String(at(button, 'aria-label')).startsWith('Active theme:'), 'the active-theme button says what it is')
  assert.ok(String(at(button, 'aria-label')).includes('open Chroma'))
})

// --- WS3: state and structure -------------------------------------------------

test('WS3 the card button has an explicit concise name and an active state, all shapes', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  const active = findAll(h.ThemeCard(cardProps({ active: 'ocean-skin' })), el => el.type === 'button')[0]
  assert.equal(at(active, 'aria-label'), 'Apply Ocean Skin (dark variant)')
  assert.equal(at(active, 'aria-current'), 'true')
  const idle = findAll(h.ThemeCard(cardProps({ active: 'none' })), el => el.type === 'button')[0]
  assert.notEqual(at(idle, 'aria-current'), 'true')

  const circle = h.ThemeCard(cardProps({ shape: 'circle' }))
  const circleCard = findAll(circle, el => el.type === 'button')[0]
  assert.ok(typeof at(circleCard, 'aria-label') === 'string' && at(circleCard, 'aria-label').length > 0,
    'a circle card is named by its button, not by the palette inside it')
  assert.equal(childrenOf(circleCard).length, 1, 'and it gains no new child')
})

test('WS3 an invalid hex field points at an id-ed alert, and the chip names its target state', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  const field = h.ColorField({ id: 'chroma-x', value: 'nonsense', label: 'Shell in light mode', onChange() {} })
  const hex = findAll(field, el => el.type === 'input' && at(el, 'type') === 'text')[0]
  assert.equal(at(hex, 'aria-invalid'), 'true')
  assert.equal(at(hex, 'aria-describedby'), 'chroma-x-hex-error')
  const error = findAll(field, el => at(el, 'id') === 'chroma-x-hex-error' && at(el, 'role') === 'alert')[0]
  assert.ok(error, 'the hex error is id-ed and role=alert')

  const chip = h.ContrastChip({ ratio: 2, target: 9, label: 'Text against the shell (light)' })
  assert.equal(at(chip, 'children'), '2.00:1', 'the pinned child string must not change')
  assert.equal(at(chip, 'aria-label'), at(chip, 'title'), 'the chip names its target state via aria-label')
})

test('WS3 landmarks, headings and the collection structure are present', async () => {
  // The gallery lives inside the host ScrollArea, which the harness stubs to null.
  // Render its children so the collection structure is reachable here.
  const { context } = await loadPlugin({ stubbed: { ScrollArea: (props) => ({ type: 'div', props }) } })
  const h = context.testHelpers
  const tree = h.ThemePicker({})

  const rail = h.FavoritesRail({ favorites: [SCENE.name], skins: h.SKINS, mode: 'dark', onApply() {}, onRemove() {} })
  assert.equal(at(rail, 'aria-label'), 'Favourites')

  const headings = findAll(tree, el => el.type === 'h3')
  assert.ok(headings.length >= 1, 'group titles are real headings')
  assert.ok(headings.every(el => typeof at(el, 'id') === 'string'), 'each heading has an id')
  const sections = findAll(tree, el => el.type === 'section')
  assert.ok(sections.length >= 1, 'the gallery groups are sections')
  assert.ok(sections.every(el => headings.some(heading => at(heading, 'id') === at(el, 'aria-labelledby'))),
    'every section is labelled by its heading')
  const lists = findAll(tree, el => at(el, 'role') === 'list')
  assert.ok(lists.length >= 1, 'the card grid is a list')
  assert.ok(findAll(tree, el => at(el, 'role') === 'listitem').length >= 1, 'every card wrapper is a listitem')
})

// --- WS4: content, live regions, focus, tab order -----------------------------

test('WS4 the palette has a concise text alternative on the card and is decorative in the editor', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  const named = h.ThemeCardPalette({ lightStrip: ['#111111'], darkStrip: ['#222222'], shape: 'square', label: 'Ocean Skin palette, six bands per mode' })
  assert.equal(at(named, 'role'), 'img')
  assert.equal(at(named, 'aria-label'), 'Ocean Skin palette, six bands per mode')
  assert.ok(!String(at(named, 'aria-label')).includes('#111111'), 'the name is not a wall of hex')
  const decorative = h.ThemeCardPalette({ lightStrip: ['#111111'], darkStrip: ['#222222'], shape: 'square' })
  assert.equal(at(decorative, 'aria-hidden'), 'true', 'the editor strip is decorative: the fields carry the data')
})

test('WS4 an aria-live polite region exists, and never lives in the editor body', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  const modal = h.EditorModal({ scene: SCENE, overrides: {}, owned: false, mode: 'dark', busy: null, onClose() {}, onSave() {}, onReset() {} })
  const sheet = childrenOf(modal)[0]
  const body = childrenOf(childrenOf(sheet)[1])
  assert.equal(body.length, 5, 'the editor body still carries exactly its five zones')
  const liveInBody = findAll(body, el => at(el, 'aria-live'))
  assert.equal(liveInBody.length, 0, 'the live region is not in the body')
  const live = findAll(modal, el => at(el, 'aria-live') === 'polite')
  assert.ok(live.length >= 1, 'the editor overlay carries a polite live region')
  assert.equal(childrenOf(modal)[0], sheet, 'the live region follows the sheet, so the sheet stays child 0')

  const pane = h.ThemePicker({})
  assert.ok(findAll(pane, el => at(el, 'aria-live') === 'polite').length >= 1, 'the pane carries a live region')
})

test('WS4 the colour well is visible when focused, via the host pair', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  const field = h.ColorField({ id: 'chroma-x', value: '#123456', label: 'Shell in light mode', onChange() {} })
  const label = childrenOf(field)[0]
  const classes = String(at(label, 'className'))
  assert.ok(classes.includes('focus-within:outline-2'), 'the well uses the host focus ring pair')
  assert.ok(classes.includes('focus-within:outline-ring'))
})

test('WS4 a card is one tab stop; its actions are a roving set of toolbars', async () => {
  const { context } = await loadPlugin()
  const h = context.testHelpers
  const tree = h.ThemeCard(cardProps({ owned: true, favorited: true }))
  const card = findAll(tree, el => el.type === 'button')[0]
  assert.equal(at(card, 'tabIndex'), 0, 'the card itself is the tab stop')
  const pill = findAll(tree, el => el.type === 'button')[1]
  assert.equal(at(pill, 'tabIndex'), -1, 'the pill leaves the tab sequence')
  const actionRow = findAll(tree, el => at(el, 'role') === 'toolbar' && /actions$/.test(String(at(el, 'aria-label'))))[0]
  assert.ok(actionRow, 'the card action row is a labelled toolbar')
  assert.equal(at(actionRow, 'aria-label'), 'Ocean Skin actions')
  const manageRow = findAll(tree, el => at(el, 'role') === 'toolbar' && /manage actions$/.test(String(at(el, 'aria-label'))))[0]
  assert.ok(manageRow, 'the manage row is its own labelled toolbar')
  assert.equal(at(manageRow, 'aria-label'), 'Ocean Skin manage actions')
  for (const button of findAll(tree, el => el.type === 'button')) {
    if (button === card) continue
    assert.equal(at(button, 'tabIndex'), -1, 'every other button is out of the tab sequence')
  }
  const select = findAll(tree, el => el.type === 'select')[0]
  assert.equal(at(select, 'tabIndex'), -1, 'the category select is in the roving set too')
})
