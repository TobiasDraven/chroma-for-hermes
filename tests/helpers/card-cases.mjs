// The card cases the parity guard renders. Kept apart from the guard so the
// generator and the test cannot drift: both read this list.
//
// Every entry pins one axis of the card: its shape, whether it is owned, whether
// it is the active or the applying skin, whether a preview is running, and what
// the palette looks like (rich, thin, alias-only, or empty). The palette cases
// matter because the strip is built from a fallback chain, and a refactor of that
// chain is exactly the kind of change that silently drops a band.

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

export const BASE_CARD_PROPS = {
  mode: 'dark', active: 'none', applying: null, owned: false, managing: false,
  previewing: false, previewUntil: 0, shape: 'square', localScope: null
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
  'managing owned': { scene: richScene, owned: true, managing: true },
  'no label': { scene: bareScene, owned: true },
  'thin palette': { scene: thinScene, owned: true },
  'alias palette': { scene: aliasScene, owned: true },
  'no palette at all': { scene: noPaletteScene, owned: true },
  'circle + no palette': { scene: noPaletteScene, shape: 'circle', owned: true },
  'light mode circle active': { scene: richScene, mode: 'light', shape: 'circle', active: 'ocean-skin', owned: true },
  'rectangle previewing unowned': { scene: richScene, shape: 'rectangle', previewing: true, previewUntil: 999 },
  'owned + localScope': { scene: richScene, owned: true, localScope: 'profile' },
  'dynamic dark title': { scene: richScene, owned: true },
  'single-mode dark title': { scene: bareScene, owned: true },
  'single-mode light title': { scene: thinScene, owned: true },
  'applying other skin': { scene: richScene, owned: true, applying: 'some-other-skin' }
}

/** Handlers are recorded as present, never called, by the digest. */
export function cardSpies() {
  return {
    onApply: () => {}, onDelete: () => {}, onRename: () => {},
    onExport: () => {}, onPreview: () => {}, onStopPreview: () => {}
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
