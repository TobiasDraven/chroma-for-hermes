// React refuses an object as a child unless it is a real element carrying
// `$$typeof`. A helper that rebuilt `{ type: el.type, key: el.key, props: ... }`
// returned an element-shaped object with NO marker, so every card render threw
// error #31 ("found: object with keys {type, key, props}") and the gallery was
// replaced by the error boundary. The digest-based suites could not see it: any
// object with `type` and `props` passes for an element there.
//
// Coverage: every object child in the trees the app really renders, for the page
// and for representative card shapes (owned/unowned, square/rectangle/circle,
// dynamic/single-mode/gateway). It walks only `children`, which is what React's
// rule covers.
//
// What it cannot do: it cannot observe real-DOM behaviour, reconciliation, or a
// marker that the real React runtime would reject for another reason. It proves
// the marker is present and shaped like an element, not that the page paints.
import assert from 'node:assert/strict'
import test from 'node:test'

import { loadPlugin, REACT_ELEMENT } from './helpers/load-plugin.mjs'
import { BASE_CARD_PROPS, CARD_CASES, assertNoRawElements, cardSpies } from './helpers/card-cases.mjs'

const { context } = await loadPlugin()
const helpers = context.testHelpers

// The SDK's ScrollArea normally folds to null in the harness, which would hide
// the whole gallery. This stub renders its children as a marked element so the
// picker tree actually reaches the cards, exactly as the app's own ScrollArea
// does.
const { context: galleryContext } = await loadPlugin({
  stubbed: { ScrollArea: (props) => ({ $$typeof: REACT_ELEMENT, type: 'div', props }) }
})

const cardTree = (label) => helpers.ThemeCard({
  ...cardSpies(), ...BASE_CARD_PROPS, ...CARD_CASES[label]
})

test('ThemePicker renders no raw object child', () => {
  const tree = galleryContext.testHelpers.ThemePicker({})
  assert.ok(tree, 'ThemePicker rendered nothing')
  assertNoRawElements(tree, 'ThemePicker')
})

for (const label of [
  'square owned idle dark',
  'square unowned dark',
  'rectangle owned',
  'circle owned',
  'circle unowned',
  'no label',
  'thin palette',
  'no palette at all',
  'gateway owned, this profile'
]) {
  test('ThemeCard renders no raw object child: ' + label, () => {
    assertNoRawElements(cardTree(label), 'ThemeCard ' + label)
  })
}
