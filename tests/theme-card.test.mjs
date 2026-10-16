// The card's rendered output is a contract, and this is where it is held.
//
// Refactoring a React component can move a label, drop a class, lose a handler or
// silently drop a palette band while every behavioural test stays green, because
// those tests assert on their own narrow slice. So the DOM produced for each case
// is pinned in tests/fixtures/theme-card-parity.json and compared here, and the
// pieces the card was split into are rendered directly as well - which is the only
// way to reach the rename and delete rows, since the harness stubs useState.
//
// Everything below works on DIGESTED trees (digestElement output), whose props sit
// directly on the node: `el.type`, `el.className`, `el.title`, `el.children`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadPlugin } from './helpers/load-plugin.mjs'
import { CARD_CASES, BASE_CARD_PROPS, cardSpies, digestElement, countType, textsIn, walk } from './helpers/card-cases.mjs'

const fixture = JSON.parse(await readFile(new URL('./fixtures/theme-card-parity.json', import.meta.url), 'utf8'))
const { context } = await loadPlugin()
const helpers = context.testHelpers

/** A VM-realm value cannot be compared with deepEqual: rebuild it out here. */
const plain = (value) => JSON.parse(JSON.stringify(value))

/** Render one case and digest it, so every assertion reads the same shape. */
const render = (overrides) => plain(digestElement(helpers.ThemeCard({
  ...cardSpies(), ...BASE_CARD_PROPS, scene: CARD_CASES['square owned idle dark'].scene, ...overrides
})))

/** The card itself is always the first button in the tree. */
function firstButton(tree) {
  let found = null
  walk(tree, (el) => { if (el.type === 'button' && found === null) found = el })
  return found
}

test('every card case renders exactly the DOM it rendered before the card was split up', () => {
  const labels = Object.keys(CARD_CASES)
  assert.equal(labels.length, Object.keys(fixture.cases).length)
  for (const label of labels) {
    assert.deepEqual(render(CARD_CASES[label]), fixture.cases[label], `card case drifted: ${label}`)
  }
})

test('the palette strip takes the first name a skin actually carries for each band', () => {
  const strip = helpers.paletteStrip
  // Full palette: five bands, in the documented order.
  assert.deepEqual(plain(strip({
    background: '#bb', status_bar_bg: '#aa',
    ui_accent: '#cc', ui_tool: '#dd', banner_text: '#ee', ui_border: '#ff'
  })), ['#bb', '#cc', '#dd', '#ee', '#ff'])
  // The second name is used only when the first is absent.
  assert.deepEqual(plain(strip({ status_bar_bg: '#aa', banner_accent: '#c1', ui_tool: '#t1', ui_text: '#t2', banner_border: '#b1' })),
    ['#aa', '#c1', '#t1', '#t2', '#b1'])
  // A band with no colour is dropped, not left blank.
  assert.deepEqual(plain(strip({ background: '#bb' })), ['#bb'])
  assert.deepEqual(plain(strip({})), [])
})

test('an unowned card offers only itself and the preview pill; an owned one adds the three actions', () => {
  const unowned = render({ owned: false })
  assert.equal(countType(unowned, 'button'), 2, 'card + preview pill only')
  const owned = render({ owned: true })
  assert.equal(countType(owned, 'button'), 5, 'card + pill + export + rename + delete')
  const ownedText = textsIn(owned)
  for (const label of ['Export', 'Rename', 'Delete']) assert.ok(ownedText.includes(label), label)
  assert.equal(textsIn(unowned).includes('Delete'), false, 'an unowned card must not offer delete')
})

test('a circle holds only its palette, and its label moves under the card', () => {
  const square = render({ shape: 'square', owned: false })
  const circle = render({ shape: 'circle', owned: false })
  assert.equal(firstButton(square).children.length, 2, 'square card: palette + label row inside')
  assert.equal(firstButton(circle).children.length, 1, 'circle card: palette alone inside')
  assert.equal(square.children.length, 2, 'wrapper: card + pill')
  assert.equal(circle.children.length, 3, 'wrapper: card + pill + caption beneath')
})

test('the active skin is badged, and the applying skin is disabled', async () => {
  // The harness stubs the SDK Badge to null, so it has to be loaded again with a
  // Badge that renders, or the badge could silently vanish and no test would know.
  const withBadge = await loadPlugin({ stubbed: { Badge: (props) => ({ type: 'span', props }) } })
  const label = (overrides) => plain(digestElement(withBadge.context.testHelpers.ThemeCardLabel({
    scene: CARD_CASES['square owned idle dark'].scene, mode: 'dark', active: 'none',
    localScope: null, showState: true, className: 'row', ...overrides
  })))
  assert.ok(textsIn(label({ active: 'ocean-skin' })).includes('ACTIVE'), 'an active skin is badged')
  assert.ok(!textsIn(label({ active: 'other' })).includes('ACTIVE'), 'and only the active one')
  // Not the active skin: the state slot names the mode it supports instead.
  assert.ok(textsIn(label({ active: 'other' })).includes('dark'), 'the mode it supports')

  assert.equal(firstButton(render({ applying: 'ocean-skin' })).disabled, true)
  assert.notEqual(firstButton(render({ applying: 'some-other-skin' })).disabled, true)
})

test('the preview pill offers a preview, and a running preview counts down', () => {
  assert.ok(textsIn(render({ previewing: false })).includes('Preview 10s'))
  const running = textsIn(render({ previewing: true, previewUntil: Date.now() + 9000 }))
  assert.ok(running.some((t) => /^\d+s$/.test(t)), 'a running preview counts down: ' + JSON.stringify(running))
})

test('the mode a card offers is named in its title, and a single-mode skin says which one it is', () => {
  const dynamic = firstButton(render({ scene: CARD_CASES['dynamic dark title'].scene, mode: 'light' }))
  assert.match(dynamic.title, /\(light variant\)$/)
  const single = firstButton(render({ scene: CARD_CASES['single-mode dark title'].scene }))
  assert.match(single.title, /\(dark only\)$/)
})

test('the rename row and the delete row are reachable as pieces, because useState hides them inside the card', () => {
  const scene = CARD_CASES['square owned idle dark'].scene
  const rename = plain(digestElement(helpers.ThemeCardRename({
    scene, draft: 'new-name', setDraft: () => {}, managing: false, onRename: () => {}, onCancel: () => {}
  })))
  assert.equal(rename.length, 2, 'input + save')
  assert.equal(rename[0].type, 'input', 'the element, not the prop')
  assert.equal(rename[0].htmlType, 'text', 'and its HTML type is still recorded')
  assert.equal(rename[0].value, 'new-name')
  assert.equal(rename[1].children, 'Save')
  const saving = plain(digestElement(helpers.ThemeCardRename({
    scene, draft: 'x', setDraft: () => {}, managing: true, onRename: () => {}, onCancel: () => {}
  })))
  assert.equal(saving[1].children, 'Saving\u2026')
  assert.equal(saving[1].disabled, true)

  const confirm = plain(digestElement(helpers.ThemeCardDeleteConfirm({ scene, managing: false, onDelete: () => {}, onCancel: () => {} })))
  assert.equal(confirm.length, 3, 'question + yes + no')
  assert.match(String(confirm[0].children), /goes to the trash/)
  assert.equal(confirm[1].children, 'Yes')
  assert.equal(confirm[2].children, 'No')

  const buttons = plain(digestElement(helpers.ThemeCardManageButtons({
    scene, onDelete: () => {}, onRename: () => {}, onExport: () => {}, onStartRename: () => {}, onStartConfirm: () => {}
  })))
  assert.deepEqual(buttons.map((b) => b.children), ['Export', 'Rename', 'Delete'])
})

test('the label row shows the state only where the card has room for it', () => {
  const scene = CARD_CASES['square owned idle dark'].scene
  const withState = plain(digestElement(helpers.ThemeCardLabel({ scene, mode: 'dark', active: 'none', localScope: null, showState: true, className: 'row' })))
  const without = plain(digestElement(helpers.ThemeCardLabel({ scene, mode: 'dark', active: 'none', localScope: null, showState: false, className: 'caption' })))
  assert.equal(withState.children.length, 2, 'the bits plus the state')
  assert.equal(Array.isArray(without.children), false, 'the caption holds the bits alone')
  assert.equal(without.className, 'caption')
  assert.ok(textsIn(withState).includes('Ocean Skin'), 'the label the user reads')
  assert.ok(!textsIn(withState).includes('ACTIVE'), 'not active in this case')
})
