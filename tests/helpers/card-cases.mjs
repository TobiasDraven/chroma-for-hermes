// The card cases the parity guard renders. Kept apart from the guard so the
// generator and the test cannot drift: both read this list.
//
// Every entry pins one axis of the card: its shape, whether it is owned, whether
// it is the active or the applying skin, whether a preview is running, and what
// the palette looks like (rich, thin, alias-only, or empty). The palette cases
// matter because the strip is built from a fallback chain, and a refactor of that
// chain is exactly the kind of change that silently drops a band.
//
// Two things this list cannot do, both measured rather than assumed:
//
// 1. `managing` and the rename/delete states are invisible to the digest, because
//    the harness stubs useState and `managing` is only read inside those states.
//    A card case that sets `managing` therefore pins NOTHING and was removed; the
//    behaviour is asserted against the pieces in tests/theme-card.test.mjs.
// 2. Three keys below are SCENE HANDLES rather than distinct cases: they coincide
//    with an earlier case's digest because other tests read their `scene` by name
//    ('dynamic dark title', 'single-mode dark title', 'single-mode light title').
//    They are kept for those tests and add no round of protection of their own.
//    So this file lists 27 cases and yields 24 distinct digests, and the count in
//    the parity test is a property of the LIST, not a count of behaviours.

import { REACT_ELEMENT } from './load-plugin.mjs'

export const RICH_COLORS = {
  background: '#1b1f27', status_bar_bg: '#141821',
  ui_accent: '#5aa9e6', banner_accent: '#3d7ea6', banner_title: '#ffffff',
  ui_tool: '#2b3444', banner_text: '#e8edf5', ui_text: '#c9d4e4',
  ui_border: '#39445a', banner_border: '#2a3243'
}

const richScene = {
  name: 'ocean-skin', label: 'Ocean Skin', description: 'A calm blue',
  modeSupport: 'dynamic', colors: RICH_COLORS, lightColors: RICH_COLORS, darkColors: RICH_COLORS
}
const bareScene = {
  name: 'no-label-skin', modeSupport: 'dark', colors: RICH_COLORS, lightColors: RICH_COLORS, darkColors: RICH_COLORS
}
const thinColors = { background: '#101010', ui_text: '#eeeeee' }
const thinScene = {
  name: 'thin-skin', label: 'Thin', description: 'Only two bands',
  modeSupport: 'light', colors: thinColors, lightColors: thinColors, darkColors: thinColors
}
const aliasColors = { banner_accent: '#aa0000', ui_tool: '#00aa00', banner_title: '#0000aa', status_bar_bg: '#ff9900' }
const aliasScene = {
  name: 'alias-skin', label: 'Alias', modeSupport: 'light',
  colors: aliasColors, lightColors: aliasColors, darkColors: aliasColors
}
const noPaletteScene = {
  name: 'bare-skin', label: 'Bare', modeSupport: 'dark',
  colors: {}, lightColors: {}, darkColors: {}
}
// A gateway skin is the only thing that makes localScope visible: the CLI badge
// keys off these two names, so on any other scene the axis is inert and a case
// that sets it proves nothing.
const gatewayScene = {
  name: 'gateway-skin', label: 'Gateway', description: 'Pushed by the gateway',
  modeSupport: 'dynamic', colors: RICH_COLORS, lightColors: RICH_COLORS, darkColors: RICH_COLORS,
  gatewayLightName: 'gateway-light', gatewayDarkName: 'gateway-dark'
}
// No per-mode palettes at all: exercises ThemeCard's `|| scene.colors` fallback.
const colorsOnlyScene = {
  name: 'colors-only-skin', label: 'Colors Only', modeSupport: 'dynamic', colors: RICH_COLORS
}
// Band 2 with neither of its first two names, and band 5 with only its second.
const thirdAliasColors = { background: '#202020', banner_title: '#abcdef', banner_border: '#123456' }
const thirdAliasScene = {
  name: 'third-alias-skin', label: 'Third Alias', modeSupport: 'dark',
  colors: thirdAliasColors, lightColors: thirdAliasColors, darkColors: thirdAliasColors
}

export const BASE_CARD_PROPS = {
  mode: 'dark', active: 'none', applying: null, owned: false, managing: false,
  previewing: false, previewUntil: 0, shape: 'square', localScope: false
}

export const CARD_CASES = {
  'square owned idle dark': { scene: richScene, owned: true },
  'square unowned dark': { scene: richScene },
  'square light mode': { scene: richScene, mode: 'light', owned: true },
  'rectangle owned': { scene: richScene, shape: 'rectangle', owned: true },
  'circle owned': { scene: richScene, shape: 'circle', owned: true },
  'circle unowned': { scene: richScene, shape: 'circle' },
  'circle previewing': { scene: richScene, shape: 'circle', owned: true, previewing: true, previewUntil: 12345 },
  'square previewing': { scene: richScene, owned: true, previewing: true, previewUntil: 12345 },
  'active square': { scene: richScene, active: 'ocean-skin', owned: true },
  'applying square': { scene: richScene, applying: 'ocean-skin', owned: true },
  'active + applying': { scene: richScene, active: 'ocean-skin', applying: 'ocean-skin', owned: true },
  'no label': { scene: bareScene, owned: true },
  'thin palette': { scene: thinScene, owned: true },
  'alias palette': { scene: aliasScene, owned: true },
  'no palette at all': { scene: noPaletteScene, owned: true },
  'circle + no palette': { scene: noPaletteScene, shape: 'circle', owned: true },
  'light mode circle active': { scene: richScene, mode: 'light', shape: 'circle', active: 'ocean-skin', owned: true },
  'rectangle previewing unowned': { scene: richScene, shape: 'rectangle', previewing: true, previewUntil: 999 },
  'gateway owned, this profile': { scene: gatewayScene, owned: true, localScope: true },
  'gateway owned, everywhere': { scene: gatewayScene, owned: true, localScope: false },
  'gateway unowned': { scene: gatewayScene },
  'colors only, no per-mode palette': { scene: colorsOnlyScene, owned: true },
  'title and border from their later aliases': { scene: thirdAliasScene, owned: true },
  'active and previewing at once': { scene: richScene, active: 'ocean-skin', owned: true, previewing: true, previewUntil: 12345 },
  'dynamic dark title': { scene: richScene, owned: true },
  'single-mode dark title': { scene: bareScene, owned: true },
  'single-mode light title': { scene: thinScene, owned: true },
}

/** Handlers are recorded as present, never called, by the digest. The card's own
 *  action row (star, Edit, Fork) is pinned here too: it is the row that has been
 *  reported wrong from the field three times, so parity must watch it. */
export function cardSpies() {
  return {
    onApply: () => {}, onDelete: () => {}, onRename: () => {},
    onExport: () => {}, onPreview: () => {}, onStopPreview: () => {},
    onEdit: () => {}, onDuplicate: () => {}, onToggleFavorite: () => {}
  }
}

/**
 * Digest a rendered element into plain data, at the DOM level.
 *
 * The test harness EXECUTES function components while it builds the tree, so a
 * component boundary leaves no trace and only host elements remain. That is the
 * point: extracting a sub-component out of ThemeCard must not register as a
 * difference, while a changed class, a moved child, a different label, a missing
 * handler or a dropped palette band must.
 */
export function digestValue(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'function') return '[fn]'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(digestValue)
  if (typeof value === 'object') {
    if ('type' in value && 'props' in value) return digestElement(value)
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = digestValue(value[key])
    return out
  }
  return String(value)
}

export function digestElement(el) {
  if (el === null || el === undefined) return null
  if (Array.isArray(el)) return el.map(digestElement)
  if (typeof el !== 'object') return digestValue(el)
  const type = typeof el.type === 'function'
    ? 'COMPONENT:' + (el.type.name || 'anonymous')
    : String(el.type)
  const props = el.props || {}
  const out = {}
  for (const key of Object.keys(props).sort()) {
    if (key === 'children') continue
    out[key] = digestValue(props[key])
  }
  // Assigned AFTER the props so a prop named `type` (an input's, a button's) can
  // never rename the element; its value stays visible as `htmlType` instead.
  if (out.type !== undefined) out.htmlType = out.type
  out.type = type
  out.children = digestValue(props.children)
  return out
}

/**
 * Walk the children of a tree exactly as React does for its "objects are not
 * valid as a React child" rule: primitives are fine, arrays are flattened, and
 * every object child must carry the element marker. It deliberately does NOT
 * descend into arbitrary prop values, because React's rule applies to children,
 * not to what a prop happens to hold.
 *
 * Exists because `digestElement` treats any object with `type` and `props` as an
 * element, so a hand-built `{ type, key, props }` literal (React error #31)
 * digested identically to a real element. This guard sees the marker.
 */
export function assertNoRawElements(node, label) {
  const where = label || 'tree'
  const check = (value, path) => {
    if (value === null || value === undefined) return
    const kind = typeof value
    if (kind === 'string' || kind === 'number' || kind === 'boolean') return
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) check(value[i], path + '[' + i + ']')
      return
    }
    if (kind !== 'object') return
    if (value.$$typeof !== REACT_ELEMENT) {
      const keys = Object.keys(value).join(', ')
      throw new Error(where + ': object is not valid as a React child at ' + path +
        ' (found: object with keys {' + keys + '})')
    }
    const props = value.props
    check(props ? props.children : undefined, path + '.children')
  }
  check(node, 'root')
}

/** Count host elements in a digested or live tree; used by the focused tests. */
export function countType(node, type, acc = { n: 0 }) {
  if (!node || typeof node !== 'object') return acc.n
  if (Array.isArray(node)) { node.forEach((child) => countType(child, type, acc)); return acc.n }
  if (node.type === type) acc.n += 1
  countType(node.children, type, acc)
  return acc.n
}

/** Walk descendants, calling visit on each element. */
export function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return }
  visit(node)
  walk(node.children, visit)
}

/** Every string of text rendered anywhere in the tree. */
export function textsIn(node, acc = []) {
  if (node === null || node === undefined) return acc
  if (typeof node === 'string' || typeof node === 'number') { acc.push(String(node)); return acc }
  if (Array.isArray(node)) { node.forEach((child) => textsIn(child, acc)); return acc }
  if (typeof node === 'object') textsIn(node.children, acc)
  return acc
}
