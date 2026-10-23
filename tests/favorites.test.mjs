import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { loadPlugin } from './helpers/load-plugin.mjs'
import { BASE_CARD_PROPS, CARD_CASES, cardSpies } from './helpers/card-cases.mjs'

/**
 * Favourites: a star on every card and a scrollable rail beside the gallery.
 *
 * What this file exists to stop:
 *   - a star that renders but writes nothing. The list is stored under Chroma's
 *     own key, and a mount that folds a hand-edited or corrupt entry back into a
 *     crash is worse than an empty shelf.
 *   - a rail that lists names the catalogue no longer has: a ghost row the user
 *     cannot apply and cannot see why.
 *   - the action row drifting back out of the card's frame. The star, Edit and
 *     Fork all ride ONE in-flow row, which is the fix for the row that shipped
 *     hanging over the card's edge three times.
 */

async function helpers() {
  const { context } = await loadPlugin()
  return { t: context.testHelpers, context }
}

/** A VM-realm array cannot be compared with deepEqual: rebuild it out here. */
const plain = (value) => JSON.parse(JSON.stringify(value))

const SCENE = CARD_CASES['square owned idle dark'].scene
const OTHER_SCENE = CARD_CASES['no label'].scene

const childrenOf = (el) => {
  if (!el) return []
  if (Array.isArray(el)) return el
  const props = el.props || {}
  if (props.children === undefined) return []
  return Array.isArray(props.children) ? props.children : [props.children]
}

const at = (el, key) => (el && el.props ? el.props[key] : undefined)

const buttonsIn = (node) => {
  const found = []
  const walk = (el) => {
    if (!el || typeof el !== 'object') return
    if (Array.isArray(el)) { el.forEach(walk); return }
    if (el.type === 'button') found.push(el)
    childrenOf(el).forEach(walk)
  }
  walk(node)
  return found
}

/** The card's own action row: the frame's last child. */
const rowOf = (el) => childrenOf(el)[2]

test('favourites survive a hostile store and never throw', async () => {
  const { t, context } = await helpers()
  assert.deepEqual(plain(t.readFavorites()), [], 'no key yet: an empty shelf, not a crash')

  context.localStorage.setItem(t.FAVORITES_KEY, '{not json')
  assert.deepEqual(plain(t.readFavorites()), [], 'corrupt JSON degrades to empty')

  context.localStorage.setItem(t.FAVORITES_KEY, '{"a":1}')
  assert.deepEqual(plain(t.readFavorites()), [], 'a non-array is not a shelf')

  context.localStorage.setItem(t.FAVORITES_KEY, JSON.stringify(['a', 'a', 7, '', null, 'b']))
  assert.deepEqual(plain(t.readFavorites()), ['a', 'b'], 'junk and duplicates drop out, and the order of the rest holds')

  assert.deepEqual(plain(t.cleanFavoriteNames('nope')), [], 'a non-array is cleaned to nothing, never thrown on')
})

test('a write round-trips, and a toggle moves exactly one name', async () => {
  const { t } = await helpers()
  assert.equal(t.writeFavorites(['one', 'two']), true)
  assert.deepEqual(plain(t.readFavorites()), ['one', 'two'])

  assert.deepEqual(plain(t.toggleFavoriteName(['one', 'two'], 'three')), ['one', 'two', 'three'], 'a star appends')
  assert.deepEqual(plain(t.toggleFavoriteName(['one', 'two'], 'one')), ['two'], 'a second star removes, keeping the order of the rest')
  assert.deepEqual(plain(t.toggleFavoriteName(['one', 'two'], '')), ['one', 'two'], 'an empty name changes nothing')

  assert.equal(t.writeFavorites(['x']), true)
  assert.deepEqual(plain(t.readFavorites()), ['x'], 'the write replaces the shelf, it never merges it')
})

test('the star is a real control, painted in both states', async () => {
  const { t } = await helpers()
  const off = t.ThemeCardFavorite({ scene: SCENE, favorited: false, onToggleFavorite: () => {} })
  assert.equal(off.type, 'button')
  assert.equal(off.props.children, '\u2606', 'unstarred is the hollow star')
  assert.equal(off.props['aria-pressed'], 'false')
  assert.ok(String(off.props.style.background).length > 0, 'the star paints its own background')
  assert.equal(String(off.props.style.color).toLowerCase(), '#ffffff')
  assert.ok(String(off.props.style.border || '').length > 0, 'and its own edge')

  let asked = null
  const on = t.ThemeCardFavorite({ scene: SCENE, favorited: true, onToggleFavorite: s => { asked = s } })
  assert.equal(on.props.children, '\u2605', 'starred is the solid star')
  assert.equal(on.props['aria-pressed'], 'true')
  assert.notEqual(on.props.style.background, off.props.style.background,
    'the two states must differ in PAINT, not only in glyph: a glyph alone is invisible on some skins')
  assert.ok(String(on.props['aria-label']).includes('Remove'), 'and it says what the next click will do')
  on.props.onClick()
  assert.equal(asked, SCENE, 'the star hands its own scene back')
})

test('the star leads the row, and the manage actions stay together behind it', async () => {
  const { t } = await helpers()
  const starred = t.ThemeCard({ ...cardSpies(), ...BASE_CARD_PROPS, scene: SCENE, onToggleFavorite: () => {} })
  const row = rowOf(starred)
  assert.ok(row, 'a card with handlers carries an action row')
  assert.ok(String(at(row, 'className')).includes('mt-auto'), 'the row is the frame last in-flow child')
  assert.equal(String(at(row, 'className')).includes('absolute'), false, 'and it is not floating over the edge')

  const children = childrenOf(row)
  assert.equal(children.length, 2, 'the star, then the manage group')
  assert.equal(buttonsIn(children[0]).length, 1, 'the star rides alone on the left')
  assert.equal(at(buttonsIn(children[0])[0], 'aria-pressed'), 'false')
  assert.equal(buttonsIn(children[1]).length, 2, 'Edit and Fork stay together on the right')

  // A pane that hands in no favourites handler still gets the manage row, with no star in it.
  const plain = t.ThemeCard({ ...cardSpies(), onToggleFavorite: undefined, ...BASE_CARD_PROPS, scene: SCENE })
  assert.equal(childrenOf(rowOf(plain)).length, 1, 'no star handler, no star')
  assert.equal(buttonsIn(childrenOf(rowOf(plain))[0]).length, 2, 'the manage actions are untouched')
})

test('the rail lists what it can resolve, applies, and removes one at a time', async () => {
  const { t } = await helpers()
  const known = t.SKINS[0]
  const second = t.SKINS[1]
  const applied = []
  const removed = []
  const rail = t.FavoritesRail({
    favorites: [known.name, 'no-such-skin', second.name],
    skins: t.SKINS,
    mode: 'dark',
    onApply: s => applied.push(s.name),
    onRemove: s => removed.push(s.name)
  })

  assert.equal(rail.type, 'aside')
  assert.equal(at(rail, 'data-favorites'), '2', 'a name the catalogue cannot resolve is not a row')
  assert.ok(String(childrenOf(rail)[0].props.children).includes('Favourites (2)'), 'the header counts the rows, not the stored names')

  const list = childrenOf(childrenOf(rail)[1])
  assert.equal(list.length, 2, 'one row per resolvable favourite')
  const firstRow = list[0]
  const rowButtons = buttonsIn(firstRow)
  assert.equal(rowButtons.length, 2, 'each row applies, and offers a removal')

  rowButtons[0].props.onClick()
  assert.deepEqual(applied, [known.name], 'the name applies that skin')
  rowButtons[1].props.onClick()
  assert.deepEqual(removed, [known.name], 'the cross removes that skin, and nothing else')
  assert.equal(rowButtons[1].props.children, '\u00d7')
})

test('the pane wires the star and the rail into the built plugin', async () => {
  // The rail only renders when the list is non-empty, and every card is handed
  // both props. Asserted against the BUILD, because the pane's own body is not
  // reachable through the harness (its hooks are stubbed, so state cannot move).
  const build = readFileSync('chroma/desktop/plugin.js', 'utf8')
  assert.ok(build.includes('onToggleFavorite: toggleFavorite'), 'the cards receive the toggle handler')
  assert.ok(build.includes('favorited: favorites.indexOf(scene.name) >= 0'), 'and their own current state')
  assert.ok(build.includes('jsx(FavoritesRail'), 'the rail is rendered beside the gallery')
  assert.ok(build.includes('onRemove: removeFavorite'), 'and it can remove a favourite')
  assert.ok(build.includes("'chroma-favorites-v1'"), 'the shelf lives under Chroma own storage key')
})
