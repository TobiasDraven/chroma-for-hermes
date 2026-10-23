import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { loadPlugin } from './helpers/load-plugin.mjs'

/**
 * The preview pill replaced a hover-driven preview.
 *
 * The old version armed `previewTheme` 140ms after the pointer entered a card.
 * `previewTheme` repaints the WHOLE app, so sweeping the pointer across a
 * hundred cards repainted Hermes over and over - reported from the field as the
 * gallery being "horribly slow". The replacement fires only on a deliberate
 * click, holds for a fixed window, and reverts.
 *
 * Two halves are asserted: the pure countdown maths, and the pill's wiring
 * (the harness executes component bodies, so the handlers can really be called).
 */

async function helpers() {
  const { context } = await loadPlugin()
  return context.testHelpers
}

const scene = {
  name: 'nice-teal',
  label: 'Nice Teal',
  description: 'a test scene',
  modeSupport: 'dynamic',
  colors: { background: '#001e26', ui_accent: '#31c48d', ui_text: '#e6fffa', ui_border: '#0b4f45' },
  lightColors: { background: '#f7fffe', ui_accent: '#0f766e', ui_text: '#04241f', ui_border: '#99f6e4' },
  darkColors: { background: '#001e26', ui_accent: '#31c48d', ui_text: '#e6fffa', ui_border: '#0b4f45' }
}

function cardProps(overrides = {}) {
  return {
    scene,
    mode: 'dark',
    active: null,
    applying: null,
    onApply() {},
    owned: false,
    managing: false,
    onDelete() {},
    onRename() {},
    onExport() {},
    previewing: false,
    previewUntil: 0,
    onPreview() {},
    onStopPreview() {},
    localScope: false,
    ...overrides
  }
}

/** Every 'button' BELOW a node, not counting the node itself. Used to prove the
 *  card holds no nested button, which is invalid HTML. */
function buttonsBelow(node) {
  const acc = []
  const walk = n => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'button') acc.push(n)
    const children = n.props && n.props.children
    const list = Array.isArray(children) ? children : (children === undefined || children === null ? [] : [children])
    list.forEach(walk)
  }
  const children = node && node.props && node.props.children
  const list = Array.isArray(children) ? children : (children === undefined || children === null ? [] : [children])
  list.forEach(walk)
  return acc
}

test('a preview holds for ten seconds and reverts', async () => {
  const t = await helpers()
  assert.equal(t.PREVIEW_MS, 10000, 'the preview window is the whole feature; it must not drift')
})

test('the countdown floors at zero and never goes negative', async () => {
  const t = await helpers()
  const now = 1_000_000
  assert.equal(t.previewSecondsLeft(now + 10000, now), 10)
  assert.equal(t.previewSecondsLeft(now + 1, now), 1)
  assert.equal(t.previewSecondsLeft(now, now), 0)
  assert.equal(t.previewSecondsLeft(now - 5000, now), 0, 'an expired preview must not render a negative countdown')
  assert.equal(t.previewSecondsLeft(0, now), 0, 'no preview means no countdown')
})

test('the shipped build arms no hover preview', () => {
  // Synchronous on purpose: this test only reads the shipped artifact, so it has
  // no promise to await and must not be declared async (the gate flags that).
  const src = readFileSync(new URL('../chroma/desktop/plugin.js', import.meta.url), 'utf8')
  assert.ok(!src.includes('schedulePreview'), 'the hover debounce must be gone: it repainted the app on every pointer move')
  assert.ok(!src.includes('cancelPreview'), 'the hover cancel path must be gone with it')
  assert.ok(src.includes('Preview 10s'), 'the pill label must ship')
})

test('the pill previews on click, and stops on a second click', async () => {
  const t = await helpers()
  const calls = []
  const pills = props => {
    const stacked = t.ThemeCard(props)
    const children = stacked.props.children
    return { card: children[0], pill: children[1] }
  }

  const idle = pills(cardProps({ onPreview: s => calls.push(['preview', s.name]), onStopPreview: () => calls.push(['stop']) }))
  assert.equal(idle.pill.type, 'button')
  assert.equal(idle.pill.props.children, 'Preview 10s')
  idle.pill.props.onClick()
  assert.deepEqual(calls, [['preview', 'nice-teal']], 'a click on the pill must preview, and must not apply')

  calls.length = 0
  const live = pills(cardProps({ previewing: true, previewUntil: Date.now() + 10000, onPreview: s => calls.push(['preview', s.name]), onStopPreview: () => calls.push(['stop']) }))
  live.pill.props.onClick()
  assert.deepEqual(calls, [['stop']], 'while previewing the same pill stops it')
})

test('while previewing the pill shows the countdown instead of the label', async () => {
  const t = await helpers()
  const stacked = t.ThemeCard(cardProps({ previewing: true, previewUntil: Date.now() + 10000 }))
  const pill = stacked.props.children[1]
  assert.equal(pill.props.children.type, 'span', 'the countdown renders in place of the label')
  assert.equal(pill.props.children.props.children, '10s')
})

test('the pill is a sibling of the card, never inside it', async () => {
  const t = await helpers()
  const stacked = t.ThemeCard(cardProps())
  const [card, pill] = stacked.props.children
  assert.equal(stacked.type, 'div', 'card and pill share a positioned wrapper')
  assert.equal(card.type, 'button', 'the card applies the theme')
  assert.equal(pill.type, 'button')
  assert.equal(buttonsBelow(card).length, 0, 'a button inside a button is invalid HTML; the pill must stay out of the card')
})

test('the card still applies the theme when its body is clicked', async () => {
  const t = await helpers()
  const applied = []
  const stacked = t.ThemeCard(cardProps({ onApply: s => applied.push(s.name) }))
  stacked.props.children[0].props.onClick()
  assert.deepEqual(applied, ['nice-teal'], 'the pill must not have taken over the card click')
})

test('an owned card renders its manage actions plus the pill', async () => {
  const t = await helpers()
  const out = t.ThemeCard(cardProps({ owned: true }))
  assert.equal(out.props.children.length, 2, 'the wrapper and the actions row')
  assert.equal(out.props.children[1].type, 'div', 'actions stay outside the card button')

  const stacked = out.props.children[0]
  assert.equal(stacked.props.children.length, 2, 'card and pill are siblings inside the wrapper')
  assert.equal(buttonsBelow(stacked).length, 2, 'the wrapper holds exactly the card button and the pill button')
  assert.equal(buttonsBelow(stacked.props.children[0]).length, 0, 'and the card itself holds no nested button')
})

test('a circle holds only its palette, and its label sits ABOVE the card', async () => {
  const t = await helpers()
  const stacked = t.ThemeCard(cardProps({ shape: 'circle' }))
  const [caption, box] = stacked.props.children

  assert.equal(stacked.props.children.length, 2, 'circle mode stacks a caption above a card box')
  assert.ok(caption && caption.type === 'div', 'the label renders above the circle')
  assert.equal(box.props.children.length, 2, 'the box holds the card and the pill')
  const [card, pill] = box.props.children
  assert.equal(
    card.props.children.length, 1,
    'the card holds only its colour block: rounded-full does not clip children, so a label set inside would paint outside the circle'
  )
  assert.equal(buttonsBelow(card).length, 0, 'and still no button is nested inside the card')
  assert.equal(pill.type, 'button', 'the pill stays with the circle')
})

test('square and rectangle cards keep their label inside the card', async () => {
  const t = await helpers()
  for (const shape of ['square', 'rectangle']) {
    const stacked = t.ThemeCard(cardProps({ shape }))
    assert.equal(stacked.props.children.length, 2, shape + ': no caption below the card')
    assert.equal(stacked.props.children[0].props.children.length, 2, shape + ': the colour block and the label row')
  }
})
