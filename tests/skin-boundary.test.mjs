// One malformed skin (no usable `name`) made ThemeCard throw
// "...reading 'replace'"; because the throw happened while ThemePicker was
// building the grid, React unmounted the WHOLE picker — the user lost every
// card, not one. Two layers now hold that: splitUsableSkins rejects entries that
// cannot be drawn, and SkinBoundary catches anything that still throws and shows
// an honest fallback with a way to carry on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './helpers/load-plugin.mjs'
import { digestElement, textsIn, walk } from './helpers/card-cases.mjs'

const MALFORMED = [
  { label: 'no name at all', colors: {} },
  { name: null, label: 'null name', colors: {} },
  { name: '', label: 'empty name', colors: {} },
  { name: '   ', label: 'whitespace name', colors: {} },
  { name: 42, label: 'number name', colors: {} },
  null,
  'not an object'
]

test('splitUsableSkins keeps every drawable skin and reports the ones it cannot draw', async () => {
  const { context } = await loadPlugin()
  const { splitUsableSkins } = context.testHelpers
  assert.equal(typeof splitUsableSkins, 'function', 'the boundary validator must exist')

  const valid = { name: 'ocean-skin', label: 'Ocean Skin', colors: {} }
  const { usable, unusable } = splitUsableSkins([...MALFORMED, valid])

  // Array.from: `usable` is built inside the VM, so its prototype is the VM's
  // Array and deepStrictEqual would reject it as a different structure.
  assert.deepEqual(Array.from(usable, s => s.name), ['ocean-skin'], 'the drawable skin survives')
  assert.equal(unusable.length, MALFORMED.length, 'every malformed entry is reported, none silently lost')
})

test('a malformed entry among valid ones does not white-screen the picker', async () => {
  const notifications = []
  // The harness stubs useEffect by default; run effects so the skip report fires.
  const { context } = await loadPlugin({
    host: { notify: n => notifications.push(n) },
    stubbed: { useEffect: (fn) => { fn() } }
  })
  const helpers = context.testHelpers

  helpers.IMPORTED_SKINS.push({ name: null, label: 'Broken', colors: {} })
  try {
    let tree
    assert.doesNotThrow(() => { tree = digestElement(helpers.ThemePicker({})) }, 'one bad card must not take the picker down')
    // The grid lives inside the host ScrollArea, which the harness stubs out;
    // the toolbar proves the picker rendered instead of white-screening.
    assert.ok(textsIn(tree).includes('Categories'), 'the picker still renders its toolbar')
    assert.ok(
      notifications.some(n => n.kind === 'warning' && /could not be drawn/.test(n.message)),
      'the skipped entry is reported, not crashed on'
    )
  } finally {
    helpers.IMPORTED_SKINS.pop()
  }
})

test('SkinBoundary shows an honest fallback with a way to carry on, and reports the error', async () => {
  const notifications = []
  const { context } = await loadPlugin({ host: { notify: n => notifications.push(n) } })
  const Boundary = context.testHelpers.SkinBoundary
  assert.equal(typeof Boundary, 'function', 'the render boundary must exist')

  assert.equal(new Boundary({ children: 'the grid' }).render(), 'the grid', 'a healthy boundary renders its children')

  const instance = new Boundary({ children: 'the grid' })
  instance.state = { ...instance.state, ...Boundary.getDerivedStateFromError(new Error('boom')) }
  instance.componentDidCatch(new Error("Cannot read properties of undefined (reading 'replace')"))
  const fallback = digestElement(instance.render())

  assert.match(textsIn(fallback).join(' '), /could not be drawn/i)
  const labels = []
  walk(fallback, el => { if (el.type === 'button') labels.push(el.children) })
  assert.ok(labels.includes('Try again'), 'the user needs a way to carry on')
  assert.equal(notifications.length, 1)
  assert.match(notifications[0].message, /could not be drawn/)
})
