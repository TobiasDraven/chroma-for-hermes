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

test('the palette strip takes the first name a skin carries for each of the six roles', () => {
  const strip = helpers.paletteStrip
  // Full palette: six roles, in the documented reading order - shell, surface,
  // signature, reading colour, secondary text, structure.
  assert.deepEqual(plain(strip({
    background: '#bb', status_bar_bg: '#aa', ui_accent: '#cc',
    banner_text: '#ee', banner_dim: '#dd', ui_border: '#ff'
  })), ['#bb', '#aa', '#cc', '#ee', '#dd', '#ff'])
  // The second name is used only when the first is absent.
  assert.deepEqual(plain(strip({
    completion_menu_bg: '#a2', banner_accent: '#c2', ui_text: '#e2',
    banner_dim: '#d2', session_border: '#f2'
  })), ['#888888', '#a2', '#c2', '#e2', '#d2', '#f2'])
  // A partial palette still yields six swatches, and every missing role is MIXED
  // from the shell instead of repeating one colour: four identical swatches down
  // a column would preview a theme nobody will ever see.
  const partial = plain(strip({ background: '#bbc' }))
  assert.equal(partial.length, 6)
  assert.equal(partial[0], '#bbc', 'the shell leads the row')
  assert.ok(new Set(partial).size >= 4, `expected a mixed anatomy, got ${partial.join(' ')}`)
  assert.equal(plain(strip({})).length, 6, 'even a palette with nothing in it fills the row')
})

// The harness digests structure and class STRINGS, so it cannot see layout. It
// CAN see the class contract that layout depends on. `flex-col` alone sets only
// flex-direction: without `display: flex` the container is a block and its inline
// <span> children collapse to zero size - the swatches render, but paint nothing.
// That shipped once; this holds the contract for every shape.
test('the palette is a 2 x 6 matrix: a flex column of two flex rows of six swatches', () => {
  for (const overrides of [{}, { shape: 'rectangle' }, { shape: 'circle' }]) {
    const tree = render(overrides)
    let palette = null
    walk(tree, (el) => { if (palette === null && String(el.className || '').includes('ring-black/15')) palette = el })
    assert.ok(palette, `no palette container rendered for ${JSON.stringify(overrides)}`)
    // Match whole class TOKENS. `'flex-col'.includes('flex')` is true, so a
    // substring check would pass a build that has lost display:flex entirely.
    const tokens = String(palette.className).split(/\s+/)
    assert.ok(tokens.includes('flex'), 'palette needs display:flex, not flex-direction alone')
    assert.ok(tokens.includes('flex-col'), 'the two mode rows stack in a column')
    const rows = (palette.children || []).filter(child => child && child.type === 'div')
    assert.equal(rows.length, 2, 'one row for the light variant, one for the dark')
    for (const [r, row] of rows.entries()) {
      const rowTokens = String(row.className).split(/\s+/)
      assert.ok(rowTokens.includes('flex'), 'a row lays its swatches out with flex')
      assert.ok(rowTokens.includes('flex-row'), 'a row runs horizontally')
      assert.ok(rowTokens.includes('flex-1'), 'each row takes half the block')
      if (r === 1) assert.ok(rowTokens.includes('border-t'), 'a hairline separates dark from light')
      const swatches = (row.children || []).filter(child => child && child.type === 'span')
      assert.equal(swatches.length, 6, 'six roles per variant')
      for (const swatch of swatches) {
        assert.ok(swatch.style && swatch.style.backgroundColor, 'every swatch carries a backgroundColor')
        const swatchTokens = String(swatch.className).split(/\s+/)
        assert.ok(swatchTokens.includes('flex-1'), 'every swatch shares the width')
        assert.ok(swatchTokens.includes('min-w-0'), 'a swatch may not overflow its row')
      }
    }
  }
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

test('a circle holds only its palette, and its label sits ABOVE the card', () => {
  const square = render({ shape: 'square', owned: false })
  const circle = render({ shape: 'circle', owned: false })
  assert.equal(firstButton(square).children.length, 2, 'square card: palette + label row inside')
  assert.equal(firstButton(circle).children.length, 1, 'circle card: palette alone inside')
  assert.equal(square.children.length, 2, 'wrapper: card + pill')
  // The circle stacks a caption above a box holding [card, pill]. The name moved
  // from below the circle to above it, to match where every other shape puts it.
  assert.equal(circle.children.length, 2, 'circle wrapper: caption + card box')
  const [caption, box] = circle.children
  assert.equal(box.children.length, 2, 'card box: card + pill')
  assert.equal(box.children[0], firstButton(circle), 'the card lives inside the box, under the caption')
  assert.ok(String(caption.className).includes('mb-1'), 'caption owns the gap below itself, because it sits above')
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

// The digest records handlers as PRESENT ('[fn]'), never called, and until now the
// whole suite invoked three handlers in total. So a handler whose BODY was broken -
// a dropped call, a forgotten argument - digested identically and shipped green.
// These tests call the real handlers and watch what leaves the component.

/** Walk a LIVE tree (props.children, not children) to the first button. */
function firstLiveButton(node) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) { const hit = firstLiveButton(child); if (hit) return hit }
    return null
  }
  if (node.type === 'button') return node
  return firstLiveButton(node.props && node.props.children)
}

/** The live element carrying a key, out of a piece's returned array. */
const liveByKey = (nodes, key) => nodes.find((n) => n.props && n.props.key === key)

test('clicking the card applies that exact scene, once', () => {
  const scene = CARD_CASES['square owned idle dark'].scene
  const applied = []
  const live = helpers.ThemeCard({
    ...cardSpies(), ...BASE_CARD_PROPS, scene, owned: true,
    onApply: (s) => applied.push(s)
  })
  const card = firstLiveButton(live)
  assert.ok(card, 'the card is a button')
  card.props.onClick()
  assert.equal(applied.length, 1, 'applied exactly once')
  assert.equal(applied[0], scene, 'the very scene object it was given')
})

test('the manage row is wired to its handlers, and Rename opens a row instead of renaming', () => {
  const scene = CARD_CASES['square owned idle dark'].scene
  const calls = []
  const row = helpers.ThemeCardManageButtons({
    scene,
    onDelete: (n) => calls.push(['delete', n]),
    onRename: (n) => calls.push(['rename', n]),
    onExport: (n) => calls.push(['export', n]),
    onStartRename: (s) => calls.push(['startRename', s.name]),
    onStartConfirm: () => calls.push(['startConfirm'])
  })
  liveByKey(row, 'export').props.onClick()
  liveByKey(row, 'rename').props.onClick()
  liveByKey(row, 'delete').props.onClick()
  assert.deepEqual(plain(calls), [
    ['export', 'ocean-skin'], ['startRename', 'ocean-skin'], ['startConfirm']
  ], 'each button calls out with the scene it was given')
  assert.ok(!calls.some((c) => c[0] === 'rename' || c[0] === 'delete'),
    'Rename and Delete must not act before the user confirms')

  // Through the real container, where the state actually lives: Delete must open
  // the confirmation rather than deleting.
  const viaActions = []
  const actions = helpers.ThemeCardActions({
    scene, managing: false,
    onDelete: (n) => viaActions.push(['delete', n]),
    onRename: (n, d) => viaActions.push(['rename', n, d]),
    onExport: (n) => viaActions.push(['export', n])
  })
  liveByKey(actions.props.children, 'delete').props.onClick()
  assert.deepEqual(plain(viaActions), [], 'Delete asks first')
  liveByKey(actions.props.children, 'export').props.onClick()
  assert.deepEqual(plain(viaActions), [['export', 'ocean-skin']], 'Export does not ask')
})

test('the rename row commits the draft on Enter and on Save, and only Escape cancels', () => {
  const scene = CARD_CASES['square owned idle dark'].scene
  const calls = []
  const row = helpers.ThemeCardRename({
    scene, draft: 'ocean-skin/new',
    setDraft: (v) => calls.push(['draft', v]),
    managing: false,
    onRename: (n, d) => calls.push(['rename', n, d]),
    onCancel: () => calls.push(['cancel'])
  })
  const input = liveByKey(row, 'name')
  const save = liveByKey(row, 'save')

  input.props.onChange({ target: { value: 'typed' } })
  assert.deepEqual(plain(calls), [['draft', 'typed']], 'typing only updates the draft')

  calls.length = 0
  input.props.onKeyDown({ key: 'Escape' })
  assert.deepEqual(plain(calls), [['cancel']], 'Escape closes WITHOUT renaming')

  calls.length = 0
  input.props.onKeyDown({ key: 'Enter' })
  assert.deepEqual(plain(calls), [['rename', 'ocean-skin', 'ocean-skin/new'], ['cancel']],
    'Enter commits the draft under the scene name, then closes')

  calls.length = 0
  save.props.onClick()
  assert.deepEqual(plain(calls), [['rename', 'ocean-skin', 'ocean-skin/new'], ['cancel']], 'Save commits too')
  assert.notEqual(save.props.disabled, true, 'and is usable when no rename is in flight')
})

test('the delete confirmation deletes on Yes and only closes on No', () => {
  const scene = CARD_CASES['square owned idle dark'].scene
  const calls = []
  const row = helpers.ThemeCardDeleteConfirm({
    scene, managing: false,
    onDelete: (n) => calls.push(['delete', n]), onCancel: () => calls.push(['cancel'])
  })
  liveByKey(row, 'no').props.onClick()
  assert.deepEqual(plain(calls), [['cancel']], 'No never deletes')
  calls.length = 0
  liveByKey(row, 'yes').props.onClick()
  assert.deepEqual(plain(calls), [['delete', 'ocean-skin'], ['cancel']],
    'Yes deletes the skin it was given, then closes')

  const busy = helpers.ThemeCardDeleteConfirm({ scene, managing: true, onDelete: () => {}, onCancel: () => {} })
  assert.equal(liveByKey(busy, 'yes').props.disabled, true, 'disabled while the delete is in flight')
  assert.equal(liveByKey(busy, 'yes').props.children, 'Deleting\u2026')
})

test('the CLI badge never claims a gateway skin reaches the CLI under a local scope', () => {
  const gateway = CARD_CASES['gateway owned, everywhere'].scene
  const title = (localScope) => helpers.CliBadge({ scene: gateway, localScope }).props.title
  assert.match(title(false), /the CLI and every connected Desktop follow this theme/)
  assert.match(title(true), /the CLI will NOT follow/)
  const desktopOnly = helpers.CliBadge({ scene: CARD_CASES['square owned idle dark'].scene, localScope: false })
  assert.match(desktopOnly.props.title, /Desktop only/)
  assert.equal(helpers.isGatewayCapable(gateway), true)
  assert.equal(helpers.isGatewayCapable(CARD_CASES['square owned idle dark'].scene), false)
})
