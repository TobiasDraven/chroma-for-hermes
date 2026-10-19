/**
 * chroma — browse and apply Hermes skins from a full-page picker.
 *
 * Self-contained: all scene color data is embedded (no Python backend, no REST),
 * so it works identically on any machine running Hermes Desktop. Applying a
 * scene paints Desktop's root tokens immediately AND hands the switch to
 * Desktop's own ThemeProvider (useTheme().setTheme/setMode), so the provider's
 * React state agrees and the next render keeps the theme instead of reverting to
 * its stale state. The scene and mode are saved for the next boot — no
 * navigation or renderer reload. The
 * selected concrete light/dark variant is also queued through gateway
 * `config.set`, which broadcasts it to every connected Desktop and CLI.
 *
 * It also registers every scene via THEMES_AREA, so the same scenes show up
 * in Settings → Appearance and can be switched there (works even offline).
 *
 * Live discovery: when a skin is applied from elsewhere (CLI /skin, another
 * surface) the `skin.changed` event carries its full palette, so a skin NOT in
 * the embedded catalog (e.g. one you just installed) appears in the picker
 * immediately. To also have it in the browsable catalog before applying, run
 * the regeneration script (see scripts/regenerate.py) and re-copy plugin.js.
 *
 * Plain ESM loaded uncompiled: UI is jsx() calls, NOT JSX syntax; only
 * @hermes/plugin-sdk, react, react/jsx-runtime resolve.
 */

import {
  Badge,
  Button,
  cn,
  EmptyState,
  haptic,
  host,
  Input,
  oklchToHex,
  PALETTE_AREA,
  ROUTES_AREA,
  ScrollArea,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SegmentedControl,
  SIDEBAR_NAV_AREA,
  STATUSBAR_AREAS,
  THEMES_AREA,
  useTheme,
  useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'

let _rest = null

// Replaced with the real version at build time (scripts/regenerate.py).
const BUILD_STAMP = '2.8.1'

// The Python half is optional: the Desktop half applies and previews themes
// with no backend at all. When it is absent every backend call throws this exact
// message, and the UI recognises it so it can say "this Desktop only" instead of
// reporting a gateway skin that was never minted.
const BACKEND_MISSING_MESSAGE = 'plugin backend not ready'

const ID = 'chroma'

const IMPORTED_SKINS = []
const PAGE_PATH = '/chroma'
// Desktop reads this cache before plugins register, so a selected contributed
// theme remains resolvable during the next app startup.
const USER_THEMES_KEY = 'hermes-desktop-user-themes-v1'
// Boot mirror of the backend override store. The host calls register()
// SYNCHRONOUSLY and restores its disposer tracker before any await resolves,
// so register() must not await a network read: a contribution registered after
// an await loses its disposer and can never be withdrawn. Every successful
// override write updates this mirror, so the next boot resolves the same
// palettes with no network at all. The backend remains the source of truth for
// the editor; this key exists only to make boot synchronous.
const OVERRIDES_MIRROR_KEY = 'chroma-overrides-v1'
const SKIN_KEY = 'hermes-desktop-theme-v2'
const MODE_KEY = 'hermes-desktop-mode-v1'
const PROFILE_SKINS_KEY = 'hermes-desktop-profile-themes-v1'
const PROFILE_MODES_KEY = 'hermes-desktop-profile-modes-v1'
// Plugin-owned and per profile, like the `chroma-*` keys below. The
// `hermes-desktop-*` keys above are the app's own, mirrored so a contributed
// theme stays resolvable at next startup; these are ours and the app never
// reads them.
const APPLY_SCOPE_KEY = 'chroma-apply-scope-v1'
// Also plugin-owned. The card shape is a view preference, not a per-profile
// selection, so it is not namespaced by profile the way the apply scope is:
// two profiles on one machine describe the same window.
const CARD_SHAPE_KEY = 'chroma-card-shape-v1'
const CARD_SIZE_KEY = 'chroma-card-size-v1'
const CARD_SHAPES = ['square', 'rectangle', 'circle']
const CARD_SIZES = ['sm', 'md', 'lg']
// Which lens the gallery groups by: the scene grouping that shipped first, or
// the broad style categories. Plugin-owned and per profile, like the rest.
const GROUP_MODE_KEY = 'chroma-group-mode-v1'
const GROUP_MODES = ['scene', 'theme', 'pack']
/** The twelve style categories, in display order. A scene lands in exactly one:
 *  see sceneCategory() for the rule that decides which.
 *
 *  Ordered deliberately: the measured CHARACTER buckets first (Minimal, Pastels,
 *  Vibrant, Muted, Earth - each a statement about lightness and saturation, not
 *  hue), then the one named family a colour cannot derive (Retro & Terminal),
 *  then the hue families a person actually names, green through violet. The
 *  shelf order in the UI follows this array.
 *
 *  None of these is a mode shelf. Light and Dark used to sit here for the
 *  mode-locked skins; every scene now ships both modes, so a mode shelf would
 *  render empty and a category that always renders nothing is a lie in the UI.
 *  The classifier still returns 'light'/'dark' for a single-mode scene, as a
 *  fallback for an import that arrives locked. */
const THEME_CATEGORIES = [
  { id: 'persimmon', title: 'Persimmon' },
  { id: 'apricot', title: 'Apricot' },
  { id: 'amber', title: 'Amber' },
  { id: 'gold', title: 'Gold' },
  { id: 'lemon', title: 'Lemon' },
  { id: 'fern', title: 'Fern' },
  { id: 'teal', title: 'Teal' },
  { id: 'cobalt', title: 'Cobalt' },
  { id: 'indigo', title: 'Indigo' },
  { id: 'violet', title: 'Violet' },
  { id: 'rose', title: 'Rose' },
  { id: 'neutral', title: 'Neutral' },
]
const MEASURED_CATEGORY_IDS = new Set(THEME_CATEGORIES.map(c => c.id))
const CORE_DESKTOP_THEMES = new Set(['nous', 'midnight', 'ember', 'mono', 'cyberpunk', 'slate'])
const EMOJI_FALLBACK = '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", emoji'
const DEFAULT_FONT_SANS = '"Segoe WPC", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif, ' + EMOJI_FALLBACK
const DEFAULT_FONT_MONO = 'Menlo, Monaco, "SF Mono", "Courier Prime", monospace, ' + EMOJI_FALLBACK
const SCENE_TYPOGRAPHY = {
  nous: { fontMono: `"Courier Prime", ${DEFAULT_FONT_MONO}` },
  midnight: { fontMono: `"JetBrains Mono", ${DEFAULT_FONT_MONO}` },
  ember: { fontMono: `"IBM Plex Mono", ${DEFAULT_FONT_MONO}` },
  cyberpunk: {
    fontSans: `"Courier New", Courier, monospace, ${EMOJI_FALLBACK}`,
    fontMono: `"Courier New", Courier, monospace, ${EMOJI_FALLBACK}`
  }
}
let gatewaySyncQueue = Promise.resolve()
let applyGeneration = 0
const latestAppearanceByProfile = new Map()

// Desktop's own ThemeProvider API, captured from a mounted host component.
// The plugin paints root tokens for an instant switch, but Desktop re-applies
// its React state on the next render — so a manual-only paint reverts on any
// navigation, click, or profile switch. Holding setTheme/setMode lets the
// plugin hand the switch to the provider so state, persistence, and the paint
// all agree. Null until a component mounts (e.g. under the test harness).
let desktopThemeApi = null
// How many mounted consumers (the picker page and the statusbar chip) are
// sharing that one slot. A single consumer's unmount must NOT clear a slot
// another mounted consumer still needs, so the slot is released only when the
// count returns to zero.
let desktopThemeApiConsumers = 0

// ---------------------------------------------------------------------------
// Embedded skin catalog — generated from ~/.hermes/skins/*.yaml + backend
// built-ins (see scripts/regenerate.py at the bottom of this folder).
// ---------------------------------------------------------------------------

const SKINS = __SKINS_DATA__
const CATALOG = SKINS

// ---------------------------------------------------------------------------
// Color math — faithful port of apps/desktop/src/themes/color.ts
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const clean = String(hex || '').trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)]
}

function rgbToHex(rgb) {
  return `#${rgb
    .map(n => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0'))
    .join('')}`
}

function mix(a, b, amount) {
  // Normalise first: hexToRgb wants six digits, and a three-digit input used to
  // fall through to `return a` — a silent no-op instead of a blend.
  const ar = hexToRgb(normaliseHex(a) || '')
  const br = hexToRgb(normaliseHex(b) || '')
  return ar && br
    ? rgbToHex([ar[0] + (br[0] - ar[0]) * amount, ar[1] + (br[1] - ar[1]) * amount, ar[2] + (br[2] - ar[2]) * amount])
    : a
}

function luminance(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map(v => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function relativeLuminance(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const linear = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = rgb.map(v => linear(v / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return la >= lb ? (la + 0.05) / (lb + 0.05) : (lb + 0.05) / (la + 0.05)
}

function readableOn(hex) {
  return relativeLuminance(hex) > 0.58 ? '#161616' : '#ffffff'
}

function ensureContrast(color, bg, min) {
  if (contrastRatio(color, bg) >= min) return color
  const towards = relativeLuminance(bg) < 0.5 ? '#ffffff' : '#000000'
  let best = color
  for (let amount = 0.2; amount <= 1.0001; amount += 0.2) {
    best = mix(color, towards, Math.min(amount, 1))
    if (contrastRatio(best, bg) >= min) return best
  }
  return best
}

// ---------------------------------------------------------------------------
// Skin → DesktopTheme — faithful port of skinToDesktopTheme() (themes/skin.ts)
// ---------------------------------------------------------------------------

// The two mix ramps a skin-derived palette is built from, as data. Nine
// `dark ? a : b` ternaries used to be scattered through the mapper below; as a
// table the two ramps sit side by side, and the palette builder branches not at
// all. Values are verbatim from those ternaries - this is a move, not a change.
const SKIN_RAMP = {
  dark: {
    background: '#141414',
    foreground: '#e6e6e6',
    mix: { sidebar: 0.02, card: 0.04, muted: 0.06, popover: 0.08, input: 0.1, border: 0.16, bubble: 0.18, secondary: 0.72, accent: 0.82 }
  },
  light: {
    background: '#f7f7f8',
    foreground: '#161616',
    mix: { sidebar: 0.012, card: 0.025, muted: 0.04, popover: 0.05, input: 0.06, border: 0.14, bubble: 0.12, secondary: 0.86, accent: 0.88 }
  }
}

// The first present, valid hex among `keys`, else the fallback. The fallback is
// an argument, so no caller needs a `||`.
function pickColor(colors, keys, fallback) {
  for (const key of keys) {
    const value = colors[key]
    if (typeof value === 'string' && hexToRgb(value)) return value
  }
  return fallback
}

// What a skin's own records say about its surface: the seeds it carries, the tone
// they imply, and the ramp that follows from it.
function skinSeeds(skin) {
  const colors = skin.colors || {}
  const surface = pickColor(colors, ['background', 'status_bar_bg'], null)
  const text = pickColor(colors, ['ui_text', 'banner_text', 'status_bar_text'], null)
  // Text light enough to read on dark chrome means the skin wanted a dark surface.
  const lightText = Boolean(text && luminance(text) > 0.5)
  // A black surface seed has always read as absent here, so fall back to the tone.
  const absent = !surface || surface === '#000000'
  const background = absent ? SKIN_RAMP[lightText ? 'dark' : 'light'].background : surface
  const dark = luminance(background) < 0.4
  const ramp = SKIN_RAMP[dark ? 'dark' : 'light']
  return { colors, ramp, background, foreground: text || ramp.foreground }
}

// The Desktop palette for a skin. No branching at all: every ratio comes from the
// ramp, and every seed falls back through pickColor.
// The raised-surface seed: an authored bar colour that is meaningfully apart from
// the shell, else the ramp's own card step.
function surfaceSurface(colors, background, foreground, ratio) {
  const seed = pickColor(colors, ['status_bar_bg'], null)
  if (!seed) return mix(background, foreground, ratio)
  if (contrastRatio(seed, background) < 1.02) return mix(background, foreground, ratio)
  return seed
}

function skinPalette({ colors, ramp, background, foreground }) {
  const ratios = ramp.mix
  const accentSeed = pickColor(colors, ['ui_accent', 'banner_accent', 'banner_title'], mix(foreground, background, 0.55))
  const sidebar = mix(background, foreground, ratios.sidebar)
  const accent = ensureContrast(accentSeed, sidebar, 4.5)
  const border = pickColor(colors, ['ui_border', 'banner_border'], mix(background, foreground, ratios.border))
  const mutedForeground = pickColor(colors, ['banner_dim', 'session_border'], mix(foreground, background, 0.45))
  const destructive = pickColor(colors, ['ui_error'], '#e25563')
  return {
    background,
    foreground,
    // The raised surface a skin AUTHORED, when it carries one, instead of a mix
    // that approximates it. Across the catalogue the two sit within 12% of each
    // other in luminance, so this honours the data without designing anything.
    // A bar indistinguishable from the shell falls back to the mix, or the card
    // would vanish into the page it sits on.
    card: surfaceSurface(colors, background, foreground, ratios.card),
    cardForeground: foreground,
    muted: mix(background, foreground, ratios.muted),
    mutedForeground,
    popover: mix(background, foreground, ratios.popover),
    popoverForeground: foreground,
    primary: accent,
    primaryForeground: readableOn(accent),
    secondary: mix(accent, background, ratios.secondary),
    secondaryForeground: foreground,
    accent: mix(accent, background, ratios.accent),
    accentForeground: foreground,
    border,
    input: pickColor(colors, ['completion_menu_bg'], mix(background, foreground, ratios.input)),
    ring: accent,
    midground: accent,
    midgroundForeground: readableOn(accent),
    composerRing: accent,
    destructive,
    destructiveForeground: readableOn(destructive),
    sidebarBackground: sidebar,
    sidebarBorder: border,
    userBubble: mix(background, accent, ratios.bubble),
    userBubbleBorder: border
  }
}

function skinToDesktopTheme(skin) {
  const palette = skinPalette(skinSeeds(skin))
  return {
    name: skin.name,
    label: skin.name.charAt(0).toUpperCase() + skin.name.slice(1),
    description: skin.description || 'Hermes skin',
    colors: palette,
    darkColors: palette
  }
}

// A shallow merge that a hostile key cannot steer. `Object.assign` copies an own
// `__proto__` through [[Set]], which rewrites the prototype of the fresh target;
// the override store and a pasted TweakCN palette are both external input here.
// Own enumerable string keys only, and the three prototype keys are refused.
const UNSAFE_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function safeMerge(...sources) {
  const out = {}
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    for (const key of Object.keys(source)) {
      if (UNSAFE_MERGE_KEYS.has(key)) continue
      out[key] = source[key]
    }
  }
  return out
}

function sceneToDesktopTheme(scene) {
  const lightColors = scene.lightColors || scene.darkColors || scene.colors || {}
  const darkColors = scene.darkColors || scene.lightColors || scene.colors || {}
  const light = skinToDesktopTheme({ ...scene, colors: lightColors })
  const dark = skinToDesktopTheme({ ...scene, colors: darkColors })
  return {
    ...light,
    label: scene.label || light.label,
    description: scene.description || 'Chroma skin',
    colors: light.colors,
    darkColors: dark.colors,
    typography: safeMerge(SCENE_TYPOGRAPHY[scene.name], scene.typography || {}),
    themePickerManaged: true
  }
}

// -------------------------------------------------------------------
// TweakCN importer — grafted from v2. Additive to v1's shell.
// -------------------------------------------------------------------

const TWEAKCN_BASE = 'https://tweakcn.com/r/themes/'

const slug = value =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// Expand a short hex literal to 6-digit form. Split out of cssColorToHex so the
// parser keeps one branch per INPUT FORM instead of one per length.
function expandHex(hex) {
  const value = hex.toLowerCase()
  if (value.length === 4) return '#' + [...value.slice(1)].map(c => c + c).join('')
  if (value.length === 5) return '#' + [...value.slice(1, 4)].map(c => c + c).join('') + value.slice(4)
  if (value.length === 9) return value.slice(0, 7)
  return value
}

function cssColorToHex(value) {
  if (typeof value !== 'string') return undefined
  const input = value.trim()
  const m = input.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (m) return expandHex(m[0])
  const rgb = input.match(/^rgba?\(\s*([0-9.]+)%?\s*,\s*([0-9.]+)%?\s*,\s*([0-9.]+)%?/i)
  if (rgb) {
    let r = Number(rgb[1]), g = Number(rgb[2]), b = Number(rgb[3])
    if (input.includes('%')) { r = Math.round(r * 2.55); g = Math.round(g * 2.55); b = Math.round(b * 2.55) }
    const h = n => Math.round(n).toString(16).padStart(2, '0')
    return ('#' + h(r) + h(g) + h(b)).toLowerCase()
  }
  const oklch = input.match(/^oklch\(\s*([0-9.]+)[^)]*\)/i)
  if (oklch) {
    const num = Number(oklch[1])
    let hue = 0
    const hueMatch = input.match(/([0-9.]+)deg/)
    if (hueMatch) hue = Number(hueMatch[1])
    const cMatch = input.match(/^oklch\(\s*[0-9.]+\s+([0-9.]+)/i)
    const c = cMatch ? Number(cMatch[1]) : 0
    try { return oklchToHex({ l: num, c: c, h: hue }) } catch (e) { return undefined }
  }
  return undefined
}

function tweakcnTokens(group) {
  if (!group || typeof group !== 'object') return {}
  const out = {}
  for (const key in group) out[key.replace(/^--/, '')] = group[key]
  return out
}

function tweakcnThemeName(item) {
  const name = (item && (item.name || item.slug)) || 'tweakcn'
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tweakcn'
}

// Every palette key, its CSS-var aliases in priority order, and the colour to use
// when none of them is present. This was 22 `at(key) || fallback` lines; as a spec
// the whole mapping is readable at once and the builder has one `||` in it.
function tweakcnColors(group) {
  const g = group || {}
  const at = keys => {
    for (const key of keys) {
      const hex = cssColorToHex(g[key])
      if (hex) return hex
    }
    return null
  }

  const background = at(['background']) || '#111111'
  const foreground = at(['foreground']) || readableOn(background)
  const primary = at(['primary']) || foreground
  const border = at(['border']) || at(['input']) || mix(background, foreground, 0.2)
  const soft = mix(background, foreground, 0.12)

  const spec = [
    ['card', ['card'], background],
    ['cardForeground', ['card-foreground'], foreground],
    ['muted', ['muted'], soft],
    ['mutedForeground', ['muted-foreground'], mix(background, foreground, 0.45)],
    ['popover', ['popover'], background],
    ['popoverForeground', ['popover-foreground'], foreground],
    ['primary', [], primary],
    ['primaryForeground', ['primary-foreground'], readableOn(primary)],
    ['secondary', ['secondary'], soft],
    ['secondaryForeground', ['secondary-foreground'], foreground],
    ['accent', ['accent'], mix(background, primary, 0.3)],
    ['accentForeground', ['accent-foreground'], foreground],
    ['border', [], border],
    ['input', ['input'], border],
    ['ring', ['ring'], primary],
    ['destructive', ['destructive'], '#b94a3a'],
    ['destructiveForeground', ['destructive-foreground'], '#ffffff'],
    ['sidebarBackground', ['sidebar', 'sidebar-background'], mix(background, foreground, 0.03)],
    ['sidebarBorder', ['sidebar-border'], border],
    ['userBubble', ['sidebar-accent'], mix(background, primary, 0.18)],
    ['userBubbleBorder', ['sidebar-border'], border]
  ]

  const colors = { background, foreground }
  for (const [key, aliases, fallback] of spec) colors[key] = at(aliases) || fallback
  return colors
}

// TweakCN ships CSS variables in up to three groups: light, dark, and a theme
// group that carries the fonts.
function tweakcnVars(item) {
  const cssVars = (item && item.cssVars) || {}
  const theme = safeMerge(cssVars.light || {}, cssVars.theme || {})
  const font = key => (typeof theme[key] === 'string' ? theme[key] : null)
  const dark = cssVars.dark && Object.keys(cssVars.dark).length > 0
  return { cssVars, fontSans: font('font-sans'), fontMono: font('font-mono'), hasDark: Boolean(dark) }
}

function tweakcnToDesktopTheme(item) {
  if (!item || typeof item !== 'object') return null
  const name = slug(item.name)
  if (!name || CORE_DESKTOP_THEMES.has(name)) return null

  const vars = tweakcnVars(item)
  const fontSans = vars.fontSans || DEFAULT_FONT_SANS
  const fontMono = vars.fontMono || DEFAULT_FONT_MONO
  const fontLabel = vars.fontSans ? ` \u00b7 ${vars.fontSans.split(',')[0].trim()}` : ''

  return {
    name,
    label: name.replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()),
    description: 'TweakCN' + fontLabel,
    colors: tweakcnColors(vars.cssVars.light),
    ...(vars.hasDark ? { darkColors: tweakcnColors(vars.cssVars.dark) } : {}),
    typography: {
      fontSans,
      fontMono
    },
    themePickerManaged: true,
    themePickerSource: 'tweakcn'
  }
}

// ---------------------------------------------------------------------------
// F4 - import from the other theme formats in the wild.
//
// Grounding: read from the specs and the reference implementations rather than
// from recollection; what was copied is credited in THIRD_PARTY_NOTICES.md.
// Two hard constraints shape all of it:
//   1. The plugin is plain ESM with only @hermes/plugin-sdk, react and
//      react/jsx-runtime resolving - there is no package.json, so no parser
//      library can be added. Every parser here is dependency-free.
//   2. The backend's _hex accepts only #rrggbb / #rgb, so every colour is
//      normalised to 6-digit hex before it can be posted.
// ---------------------------------------------------------------------------

/** Copy a flat colour map without Object.assign, which this repo's security
 *  scan already flags as a prototype-pollution merge. */
function copyColors(map) {
  const out = {}
  Object.keys(map).forEach(k => { out[k] = map[k] })
  return out
}

/** Normalise a colour to the #rrggbb the backend accepts. Alpha is dropped on
 *  purpose: _hex discards it silently, and a colour that survives here only to
 *  vanish at the backend is worse than one that is visibly flattened.
 *  Returns null when the value is unusable. */
function normHex(value) {
  if (typeof value !== 'string') return null
  let v = value.trim().toLowerCase()
  if (v[0] === '#') v = v.slice(1)
  if (!/^[0-9a-f]+$/.test(v)) return null
  if (v.length === 3 || v.length === 4) return '#' + v[0] + v[0] + v[1] + v[1] + v[2] + v[2]
  if (v.length === 6) return '#' + v
  if (v.length === 8) return '#' + v.slice(0, 6)
  return null
}

// `luminance()` is already defined above and is reused for variant detection -
// this file must not shadow it: the naive form scores #808080 at 0.502 (light)
// where the WCAG form scores 0.216 (dark), and renderedModeFor() keys its 0.5
// threshold off the original.

/** Theme JSON written for humans may carry comments and trailing commas -
 *  colorThemeSchema.ts sets allowComments and allowTrailingCommas, so a plain
 *  JSON.parse would reject a file VS Code itself accepts. */
function stripJsonNoise(text) {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '"') {
      out += c
      i += 1
      while (i < n) {
        if (text[i] === '\\') { out += text[i] + (text[i + 1] || ''); i += 2; continue }
        out += text[i]
        const closed = text[i] === '"'
        i += 1
        if (closed) break
      }
      continue
    }
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i += 1; continue }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out += c
    i += 1
  }
  return out.replace(/,\s*([}\]])/g, '$1')
}

function parseTolerantJson(text) {
  try {
    return JSON.parse(stripJsonNoise(text))
  } catch (e) {
    throw new Error('could not read the JSON: ' + (e && e.message ? e.message : e))
  }
}

/** Windows Terminal colour scheme. Keys per the MS Learn colour-schemes page:
 *  name, background, foreground, the 16 ANSI colours, optional cursorColor and
 *  selectionBackground; everything but name is #rgb or #rrggbb.
 *  The format carries NO UI semantics, so everything past background and
 *  foreground is an ANSI role chosen as a guess - recorded as such. */
function windowsTerminalTheme(scheme, variant) {
  const pick = (...keys) => {
    for (let i = 0; i < keys.length; i += 1) {
      const h = normHex(scheme[keys[i]])
      if (h) return h
    }
    return null
  }
  const background = pick('background')
  const foreground = pick('foreground')
  if (!background || !foreground) {
    throw new Error('this Windows Terminal scheme has no background or foreground')
  }
  const detected = variant || (luminance(background) < 0.5 ? 'dark' : 'light')
  const colors = {
    background,
    foreground,
    cardForeground: foreground,
    primary: pick('blue', 'brightBlue') || foreground,
    accent: pick('brightBlue', 'cyan') || foreground,
    border: pick('brightBlack', 'white') || foreground,
    muted: pick('brightBlack', 'white') || foreground,
    destructive: pick('red', 'brightRed') || foreground
  }
  const label = scheme.name || 'Windows Terminal'
  return {
    name: slug(label),
    label,
    description: 'Windows Terminal scheme',
    source: 'windows-terminal',
    variant: detected,
    colors,
    darkColors: copyColors(colors)
  }
}

/** Base16 / Base24 scheme. Handles both generations of the spec without a YAML
 *  library: the legacy flat file (chriskempson base16, values bare or #-less)
 *  and the Tinted 0.11 nested palette (values MAY carry a #). A baseNN line is
 *  matched anywhere, so indentation under `palette:` does not matter. */
function base16Theme(text) {
  const found = {}
  const re = /^[ \t]*(base[0-9a-fA-F]{2})[ \t]*:[ \t]*['"]?#?([0-9a-fA-F]{3,8})['"]?[ \t]*(?:#.*)?$/gm
  let m
  while ((m = re.exec(text))) found[m[1].toLowerCase()] = normHex(m[2])

  if (!found.base00 || !found.base05) {
    throw new Error('no base00 and base05 found - this is not a Base16 or Base24 scheme')
  }
  // The spec has no UI semantics: baseNN are syntax roles. Mapped by colour
  // convention, not by definition - say so where it matters.
  const firstOf = (...keys) => {
    for (let i = 0; i < keys.length; i += 1) if (found[keys[i]]) return found[keys[i]]
    return null
  }
  const background = found.base00
  const foreground = found.base05
  const variantMatch = /^[ \t]*variant[ \t]*:[ \t]*(light|dark)\b/im.exec(text)
  const nameMatch = /^[ \t]*(?:scheme|name)[ \t]*:[ \t]*(.+)$/m.exec(text)
  const label = nameMatch ? nameMatch[1].trim().replace(/\s*#.*$/, '').replace(/['"]/g, '') : 'Base16'
  const detected = variantMatch
    ? variantMatch[1].toLowerCase()
    : (luminance(background) < luminance(foreground) ? 'dark' : 'light')
  const colors = {
    background,
    foreground,
    cardForeground: firstOf('base06', 'base07') || foreground,
    border: firstOf('base02', 'base01') || foreground,
    muted: found.base03 || foreground,
    primary: firstOf('base0d', 'base04') || foreground,
    accent: firstOf('base0e', 'base0a') || foreground,
    destructive: firstOf('base08', 'base09') || foreground
  }
  return {
    name: slug(label),
    label,
    description: 'Base16 scheme',
    source: 'base16',
    variant: detected,
    colors,
    darkColors: copyColors(colors)
  }
}

// The workbench colour keys that stand in for each palette role, in priority
// order. A theme carrying none of a role's aliases falls back to the foreground
// colour, which is what the reader saw before this table existed.
const VSCODE_ROLE_KEYS = [
  ['border', ['panel.border', 'editorGroup.border', 'focusBorder']],
  ['muted', ['descriptionForeground', 'statusBar.foreground']],
  ['primary', ['button.background', 'activityBarBadge.background']],
  ['accent', ['textLink.foreground', 'list.activeSelectionBackground']],
  ['cardForeground', ['surface.foreground', 'titleBar.activeForeground']],
  ['destructive', ['errorForeground', 'inputValidation.errorBackground']]
]

// VS Code names its mode as a word that CONTAINS the mode: the legacy `uiTheme`
// values are 'vs-dark' and 'vs-light', and high contrast has names of its own.
// Tested in this order, so a value carrying two words still resolves the way the
// original alternation did ('dark' before 'light', 'hc-black' before 'hc-light').
const VSCODE_MODE_WORDS = [
  ['dark', 'dark'],
  ['hc-black', 'dark'],
  ['light', 'light'],
  ['hc-light', 'light']
]

// First key that carries a real hex colour wins; a theme is free to omit any of them.
function vsCodePick(src, keys) {
  for (const key of keys) {
    const hex = normHex(src[key])
    if (hex) return hex
  }
  return null
}

// The palette to read: the workbench colours, else the colour customisations
// block, else nothing to import.
function vsCodeSource(theme) {
  const colors = theme && theme.colors
  if (colors && typeof colors === 'object') return colors
  const custom = theme && theme.workbench && theme.workbench.colorCustomizations
  if (custom && typeof custom === 'object') return custom
  return null
}

// A theme names its mode as a word; when it names nothing, the background decides.
function vsCodeVariant(theme, background) {
  const ui = String(theme.uiTheme || theme.type || '').toLowerCase()
  for (const [word, variant] of VSCODE_MODE_WORDS) {
    if (ui.indexOf(word) !== -1) return variant
  }
  return luminance(background) < 0.5 ? 'dark' : 'light'
}

function vsCodeColors(src, background, foreground) {
  const colors = { background, foreground }
  for (const [key, aliases] of VSCODE_ROLE_KEYS) {
    colors[key] = vsCodePick(src, aliases) || foreground
  }
  return colors
}

/** VS Code colour theme. The only one of these formats with genuine UI
 *  semantics, including real error colours for `destructive`. Requires the
 *  workbench `colors` block: many marketplace themes ship syntax-only
 *  tokenColors, and those have no palette to import. */
function vsCodeTheme(theme) {
  const src = vsCodeSource(theme)
  if (!src) {
    throw new Error('no workbench colors found - a syntax-only VS Code theme carries no palette to import')
  }
  const background = vsCodePick(src, ['editor.background', 'sideBar.background', 'panel.background', 'background'])
  const foreground = vsCodePick(src, ['editor.foreground', 'foreground'])
  if (!background || !foreground) {
    throw new Error('this VS Code theme has no editor.background and editor.foreground')
  }
  const label = theme.name || 'VS Code theme'
  const colors = vsCodeColors(src, background, foreground)
  return {
    name: slug(label),
    label,
    description: 'VS Code color theme',
    source: 'vscode',
    variant: vsCodeVariant(theme, background),
    colors,
    darkColors: copyColors(colors)
  }
}

/** What a scene can actually do. A source that ships ONE palette still has to
 *  say which one it is: reporting 'dynamic' for two identical palettes would
 *  offer a light/dark toggle that changes nothing. */
function sceneModeSupport(theme) {
  const light = theme.colors || {}
  const dark = theme.darkColors || {}
  const keys = Object.keys(light)
  const identical = keys.length > 0 && keys.every(k => light[k] === dark[k])
  if (theme.darkColors && !identical) return 'dynamic'
  return theme.variant === 'dark' ? 'dark' : 'light'
}

function looksLikeWindowsTerminal(json) {
  if (Array.isArray(json.schemes)) return true
  return !!(json.brightBlack && json.background && json.name && json.colors === undefined)
}

function looksLikeVsCode(json) {
  if (json.workbench && json.workbench.colorCustomizations) return true
  if (json.colors && typeof json.colors === 'object') {
    return !!(json.tokenColors || json.uiTheme || json.type || json.colors['editor.background'])
  }
  // A syntax-only theme has no colors block at all. It is still recognisably
  // VS Code's shape, and recognising it is what lets the parser say WHY it
  // cannot be imported instead of "could not recognise this as...".
  return !!(json.tokenColors || json.uiTheme)
}

/** One entry point for pasted text. Sniffs the format, then hands it to the
 *  matching parser; TweakCN CSS keeps its own path so existing pastes still
 *  work. iTerm2 is recognised but deliberately refused rather than half-read. */
// One Windows Terminal settings file can carry many schemes; the file names the
// one it uses, and the scheme it names wins over simply being first.
function windowsTerminalFromJson(json) {
  if (!Array.isArray(json.schemes)) return windowsTerminalTheme(json)
  if (!json.schemes.length) throw new Error('this Windows Terminal settings file has no schemes')
  if (json.schemes.length === 1) return windowsTerminalTheme(json.schemes[0])
  const wanted = json.profiles && json.profiles.defaults && json.profiles.defaults.colorScheme
  const chosen = (wanted && json.schemes.filter(s => s && s.name === wanted)[0]) || json.schemes[0]
  if (!chosen) throw new Error('the scheme this settings file selects is missing from its own schemes list')
  return windowsTerminalTheme(chosen)
}

function parseImportedJson(t) {
  const json = parseTolerantJson(t)
  if (looksLikeWindowsTerminal(json)) return windowsTerminalFromJson(json)
  if (looksLikeVsCode(json)) return vsCodeTheme(json)
  throw new Error('this JSON is neither a Windows Terminal scheme nor a VS Code color theme')
}

function parseImportedTheme(text) {
  const t = (text || '').trim()
  if (!t) throw new Error('nothing to import')
  // Real .itermcolors files open with `<?xml version=...?>`, so matching only the
  // `<plist` prologue would miss every file in the wild.
  if (t[0] === '<' && /plist/i.test(t)) {
    throw new Error('iTerm2 .itermcolors is not supported yet - export it as Windows Terminal, Base16 or VS Code JSON first')
  }
  if (t[0] === '{' || t[0] === '[') return parseImportedJson(t)
  // TweakCN CSS keeps its own parser so existing pastes still work. Checked before
  // the YAML sniff because a stylesheet can contain `name:`-looking text.
  if (/:root\s*{/.test(t)) return parseCssTheme(text, 'pasted.css')
  if (/^[ \t]*(scheme|name|system)[ \t]*:/m.test(t) || /base[0-9a-fA-F]{2}[ \t]*:/.test(t)) {
    return base16Theme(t)
  }
  throw new Error('could not recognise this as TweakCN CSS, Windows Terminal, Base16 or VS Code JSON')
}

function tweakcnUrl(ref) {
  ref = (ref || '').trim()
  if (!ref) return null
  if (!/^https?:\/\//i.test(ref)) return `${TWEAKCN_BASE}${slug(ref)}.json`

  const bare = ref.split(/[?#]/)[0].replace(/\/+$/, '')
  // Already a registry endpoint - hand it through untouched.
  if (/\/r\/themes\/[^/]+$/i.test(bare)) return ref
  if (!/^https?:\/\/(www\.)?tweakcn\.com\//i.test(bare)) return ref

  // A tweakcn PAGE url (https://tweakcn.com/themes/catppuccin) serves HTML.
  // The preset name is its last path segment, so rebuild the registry URL.
  const last = bare.split('/').pop() || ''
  const name = slug(last.replace(/\.json$/i, ''))
  return name ? `${TWEAKCN_BASE}${name}.json` : null
}

/** TweakCN answers a theme PAGE url with an HTML document (HTTP 200) and an
 *  unknown preset with an HTML error body, so a bare r.json() surfaces
 *  "Unexpected token '<'" / a doctype. Translate that into a real message. */
function tweakcnNotJsonError(url, status) {
  return new Error(
    `TweakCN did not return a preset for ${url} (HTTP ${status}). ` +
    'Use the preset name (e.g. catppuccin) or the /r/themes/<name>.json URL.'
  )
}

async function fetchTweakcnTheme(ref) {
  const url = tweakcnUrl(ref)
  if (!url) throw new Error('provide a TweakCN preset name or URL')
  const r = await fetch(url)
  if (!r.ok) throw new Error(`TweakCN request failed: ${r.status}`)
  let json
  try {
    json = await r.json()
  } catch (e) {
    throw tweakcnNotJsonError(url, r.status)
  }
  const theme = tweakcnToDesktopTheme(json)
  if (!theme || !theme.name || !theme.colors || !theme.colors.background) throw new Error('TweakCN response is not a usable theme')
  if (CORE_DESKTOP_THEMES && CORE_DESKTOP_THEMES.has(theme.name)) throw new Error('refusing to shadow a built-in theme')
  return theme
}
 function parseCssTheme(css, name) {
   if (css == null) return null
   const text = String(css)
   const rootMatch = text.match(/:root\s*\{([^}]*)\}/m)
   if (!rootMatch) return null
   const rootTokens = tweakcnTokens(splitCssVars(rootMatch[1]))
   const darkMatch = text.match(/\.dark\s*\{([^}]*)\}/m)
   const darkTokens = darkMatch ? tweakcnTokens(splitCssVars(darkMatch[1])) : {}
   const item = {
     name: name || 'pasted',
     cssVars: { light: rootTokens, dark: darkTokens, theme: {} }
   }
   const theme = tweakcnToDesktopTheme(item)
   if (!theme || !theme.colors || !theme.colors.background) return null
   return theme
 }

function splitCssVars(block) {
  const out = {}
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g
  let m
  while ((m = re.exec(block))) out['--' + m[1]] = m[2].trim()
  return out
}

function readStoredThemes() {
  try {
    const l = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null
    const raw = l ? l.getItem('hermes-desktop-user-themes-v1') : null
    const parsed = raw ? JSON.parse(raw) : {}
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
  } catch (e) { return {} }
}

function persistTheme(theme) {
  const stored = readStoredThemes()
  stored[theme.name] = theme
  try {
    const l = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null
    if (l) l.setItem('hermes-desktop-user-themes-v1', JSON.stringify(stored))
  } catch (e) { }
  return true
}

async function importThemeIntoSkins(name, theme) {
  if (!_rest) throw new Error(BACKEND_MISSING_MESSAGE)
  const r = await _rest('import', { method: 'POST', body: JSON.stringify({ name, theme }) })
  return r
}

/**
 * Skins Chroma owns, keyed by name.
 *
 * Only these can be deleted or renamed: the catalog scenes are bundled with the
 * plugin and the backend refuses anything without a provenance record. A skin
 * imported before the index existed has no record either, so it reports as
 * unmanaged — which is honest, and why the picker says so instead of pretending.
 */
async function listOwnedSkins() {
  if (!_rest) return {}
  const result = await _rest('skins')
  const rows = (result && result.skins) || []
  const owned = {}
  for (const row of rows) owned[row.name] = row
  return owned
}

/** Whether the Python half is mounted. Chroma's Desktop half works without it,
 *  but only the Python half can mint a real gateway skin or groom one, so the
 *  picker must be able to tell the user which of the two is actually running. */
function hasGatewayBackend() {
  return !!_rest
}

/** Pure: the honest notice for a finished import.
 *
 *  A gateway skin that was not minted is NEVER reported as a plain success. The
 *  desktop theme still applied locally, so the notice says exactly that much and
 *  no more: a local-only import names the cause - the missing backend, or the
 *  backend's own error - instead of telling the user a gateway skin exists. */
function importOutcomeNotice(label, minted, error) {
  if (minted) return { kind: 'info', message: 'Imported ' + label }
  if (error && error.message === BACKEND_MISSING_MESSAGE) {
    return {
      kind: 'warning',
      message: 'Imported ' + label + ' for this Desktop only - the gateway-skin backend is not installed, so it will not sync to other devices.'
    }
  }
  const why = error && error.message ? error.message : String(error)
  return {
    kind: 'warning',
    message: 'Imported ' + label + ' for this Desktop only - the gateway skin was not created (' + why + ').'
  }
}

async function deleteOwnedSkin(name, activeName) {
  if (!_rest) throw new Error(BACKEND_MISSING_MESSAGE)
  // The active-skin guard is enforced by the caller first; this query is the
  // second line of defence, so a stale caller cannot delete the live theme.
  const suffix = activeName ? '?active=' + encodeURIComponent(activeName) : ''
  return await _rest('skins/' + encodeURIComponent(name) + suffix, { method: 'DELETE' })
}

async function renameOwnedSkin(source, target, activeName) {
  if (!_rest) throw new Error(BACKEND_MISSING_MESSAGE)
  return await _rest('skins/rename', {
    method: 'POST',
    body: JSON.stringify({ source, target, active: activeName || '' })
  })
}

async function exportOwnedSkins(name) {
  if (!_rest) throw new Error(BACKEND_MISSING_MESSAGE)
  const path = name ? 'export?name=' + encodeURIComponent(name) : 'export'
  return await _rest(path)
}

// ---------------------------------------------------------------------------
// Built-in overrides (plan §17.2) — the editor's only write path in E1.
//
// The authored catalogue is NEVER rewritten: an edit of a shipped scene is
// stored beside it as an override record, and the effective palette is
// override ?? authored. The routes live on the same rest transport as the skin
// index, so a pane with no backend behaves exactly as it did before.
// ---------------------------------------------------------------------------

/** Every override the backend holds, keyed by scene name. Tolerant about the
 *  envelope — a bare map and {overrides: {...}} are both accepted — but strict
 *  about the type: a backend that answers with something else means "no
 *  overrides", never a crash in the gallery. */
async function listOverrides() {
  if (!_rest) return {}
  const result = await _rest('overrides')
  const rows = result && result.overrides ? result.overrides : result
  return rows && typeof rows === 'object' ? rows : {}
}

/** Write ONE override: PUT /overrides/{scene} with the role palettes the editor
 *  built. It is not the skin: the skin files are untouched. */
async function putOverride(scene, palettes) {
  if (!_rest) throw new Error(BACKEND_MISSING_MESSAGE)
  return await _rest('overrides/' + encodeURIComponent(scene), {
    method: 'PUT',
    body: JSON.stringify({ light: palettes.light || {}, dark: palettes.dark || {} })
  })
}

/** Drop an override: DELETE /overrides/{scene} puts the shipped palette back. */
async function dropOverride(scene) {
  if (!_rest) throw new Error(BACKEND_MISSING_MESSAGE)
  return await _rest('overrides/' + encodeURIComponent(scene), { method: 'DELETE' })
}

/** Write ONE owned (user) skin IN PLACE: PUT /skins/{name} with the same
 *  skin-keyed palette the override body carries (§3 — a user skin is rewritten,
 *  not overridden). Same button as the override door; the picker chooses by
 *  OWNERSHIP, never by the name: a built-in would be refused here with a 409
 *  that names the override route, and refusing it is the point (regeneration
 *  would silently undo an in-place edit). */
async function putSkin(name, palettes) {
  if (!_rest) throw new Error(BACKEND_MISSING_MESSAGE)
  return await _rest('skins/' + encodeURIComponent(name), {
    method: 'PUT',
    body: JSON.stringify({ light: palettes.light || {}, dark: palettes.dark || {} })
  })
}

// ---------------------------------------------------------------------------
// E4 — user categories (plan §9, §22.1).
//
// The twelve shelves in THEME_CATEGORIES are MEASURED and stay so: a skin's
// built-in shelf is computed from its accent by sceneCategory() and is never
// stored. A USER category is a named container a person creates; a skin joins
// one by an explicit assignment kept on its index record (`category`), and
// deleting the container does NOT touch the skin — the assignment stops
// resolving and the skin falls back to its measured shelf. That fallback is
// exactly why the measured classifier stays the floor and must never learn
// about user categories.
//
// The routes ride the same rest transport as the override store, so a pane with
// no backend degrades to "no user categories" rather than crashing the gallery.
// ---------------------------------------------------------------------------

/** The closed set of built-in shelf ids. The pane's THEME_CATEGORIES is the
 *  source of truth; this is a derived set so a user category cannot shadow a
 *  built-in one. Kept as a function so the tests read it the same way. */
function builtinCategoryIds() {
  return THEME_CATEGORIES.map(category => category.id)
}

/** Every USER category the backend holds, in the backend's own order. Tolerant
 *  about the envelope ({categories:[...]} or a bare array) but strict about the
 *  type: anything else means "no user categories", never a crash in the gallery. */
async function listCategories() {
  if (!_rest) return []
  let result
  try {
    result = await _rest('categories')
  } catch (e) {
    return []
  }
  const rows = result && Array.isArray(result.categories)
    ? result.categories
    : (Array.isArray(result) ? result : [])
  const out = []
  for (const row of rows) {
    if (row && typeof row === 'object' && typeof row.id === 'string' && row.id) {
      out.push({
        id: row.id,
        title: typeof row.title === 'string' ? row.title : row.id,
        order: typeof row.order === 'number' ? row.order : 0,
        names: Array.isArray(row.names) ? row.names : null
      })
    }
  }
  return out
}

/** Create ONE user category: POST /categories with {id, title}. The backend
 *  slugs the id and refuses a built-in or a duplicate with a 409 that the caller
 *  shows as a field-level complaint — the create is not committed to local state
 *  until the backend has answered. */
async function createCategory(id, title) {
  if (!_rest) throw new Error(BACKEND_MISSING_MESSAGE)
  return await _rest('categories', {
    method: 'POST',
    body: JSON.stringify({ id: id || '', title: title || '' })
  })
}

/** Drop ONE user category: DELETE /categories/{id}. No skin file and no index
 *  record is touched — a skin assigned to it falls back to its measured shelf. */
async function deleteCategory(id) {
  if (!_rest) throw new Error(BACKEND_MISSING_MESSAGE)
  return await _rest('categories/' + encodeURIComponent(id), { method: 'DELETE' })
}

/** Assign ONE skin to a category, or clear the assignment with '' — the "reset
 *  to measured" choice. Rides the skin's own in-place route, so it obeys the same
 *  ownership rule putSkin does. */
async function putSkinCategory(name, category) {
  if (!_rest) throw new Error(BACKEND_MISSING_MESSAGE)
  return await _rest('skins/' + encodeURIComponent(name), {
    method: 'PUT',
    body: JSON.stringify({ category: category || '' })
  })
}

/** PURE: the category a skin lands in — the per-skin assignment first, then a
 *  user category whose `names` list claims it by name, then the MEASURED shelf.
 *
 *  1. A non-empty `scene.category` is the explicit assignment. It counts only
 *     while it names a built-in or a live user category, so an assignment left
 *     behind by a DELETED category falls through rather than orphaning the card
 *     in a shelf that is no longer rendered.
 *  2. A user category whose `names` list names this skin (exact name,
 *     case-insensitive; first match in declaration order).
 *  3. `sceneCategory(scene)` — the measured floor. This is why the measured
 *     classifier stays the floor and never learns about user categories. */
function effectiveCategory(scene, userCategories) {
  if (!scene || !scene.name) return 'neutral'
  const list = Array.isArray(userCategories) ? userCategories : []
  const live = new Set(builtinCategoryIds())
  for (const cat of list) {
    if (cat && typeof cat === 'object' && typeof cat.id === 'string' && cat.id) live.add(cat.id)
  }
  const assigned = typeof scene.category === 'string' ? scene.category.trim() : ''
  if (assigned && live.has(assigned)) return assigned
  const name = scene.name.toLowerCase()
  for (const cat of list) {
    const names = cat && Array.isArray(cat.names) ? cat.names : null
    if (!names) continue
    for (const claimed of names) {
      if (typeof claimed === 'string' && claimed.trim().toLowerCase() === name) {
        return cat && typeof cat.id === 'string' && cat.id ? cat.id : 'neutral'
      }
    }
  }
  return sceneCategory(scene)
}

/** PURE: map a failed create to a field-level complaint. A 409 (duplicate or a
 *  built-in id) is a NAME problem the user fixes in place; a 400 is a malformed
 *  entry. Mirrors duplicateFailure's contract so the modal treats them alike. */
function categoryCreateFailure(error) {
  const status = error && error.status ? error.status : null
  const message = error && error.message ? error.message : String(error)
  if (status === 409) {
    return {
      kind: 'collision', field: 'id', status: 409, message: message,
      notice: {
        kind: 'warning', title: 'Category already exists', message: message,
        detail: 'Pick a different id. The category was not created and nothing was changed.'
      }
    }
  }
  if (status === 400) {
    return {
      kind: 'invalid', field: 'id', status: 400, message: message,
      notice: {
        kind: 'warning', title: 'Category not created', message: message,
        detail: 'The id or title was rejected. Nothing was changed.'
      }
    }
  }
  return {
    kind: 'error', field: null, status: status, message: message,
    notice: {
      kind: 'warning', title: 'Category not created', message: message,
      detail: 'The backend refused the create. Nothing was changed.'
    }
  }
}

/** PURE: the schema-drift check for the category vocabulary. A category id the
 *  pane renders but the backend does not list (or vice versa) is exactly the
 *  drift this catches — the same failure mode the role drift already guards. */
function schemaCategoryDrift(backendIds, paneCategories) {
  const back = new Set(Array.isArray(backendIds) ? backendIds : [])
  const pane = (paneCategories || THEME_CATEGORIES).map(category => category.id)
  const drift = []
  for (const id of pane) if (!back.has(id)) drift.push({ id: id, side: 'pane' })
  for (const id of back) if (pane.indexOf(id) === -1) drift.push({ id: id, side: 'backend' })
  return drift
}

/** The one notice the category drift raises, or null when nothing drifted. */
function schemaCategoryDriftNotice(drift) {
  if (!drift || !drift.length) return null
  const first = drift[0]
  const more = drift.length > 1 ? ' (' + drift.length + ' categories disagree)' : ''
  return {
    kind: 'warning',
    title: 'Chroma category schema drift',
    message: 'Category ' + first.id + ' is known to the ' + first.side + ' only' + more,
    detail: 'The pane and the backend disagree about a category id. A category a skin is filed under may not render.'
  }
}

// ---------------------------------------------------------------------------
// The editor's SCHEMA (plan §19.2 item 1) — a drift alarm, not a rewrite.
//
// The six rows are the card's ANATOMY and stay the presentation contract; this
// does not rebuild them from the route. What /schema supplies instead is the
// mode pair and the size caps the writer enforces, and a WATCH for drift: if a
// role's primary skin key is not in the backend's own palette keys, the two
// vocabularies have silently disagreed, and that is a bug worth shouting about.
// Read once and cached for the session; an absent route (404 — not mounted, or
// an older backend) degrades to the pane's own defaults and never blocks the
// editor.
// ---------------------------------------------------------------------------

let _editorSchemaCache = null

/** GET /schema once per session. Null means "no schema here" — never a throw:
 *  an absent route (404) or any transport error degrades the editor to its own
 *  defaults rather than blocking it. */
async function fetchEditorSchema() {
  if (_editorSchemaCache) return _editorSchemaCache
  if (!_rest) return null
  try {
    const schema = await _rest('schema')
    if (schema && typeof schema === 'object') {
      _editorSchemaCache = schema
      return schema
    }
  } catch (e) {
    // A desktop-only install has no Python half. The host still hands us a
    // transport, so the first backend call comes back "not found" — and every
    // later one would too. One 404 is enough: retire the transport for the
    // session so no other surface reports a backend that was never installed.
    if (isMissingRoute(e)) _rest = null
    return null
  }
  return null
}

/** The mode pair the editor offers: the backend's when /schema answered, the
 *  long-standing pair when it did not. The two agree today; reading it is what
 *  keeps them from drifting apart silently. */
function editorModes(schema) {
  const modes = schema && Array.isArray(schema.modes)
    ? schema.modes.filter(mode => mode === 'light' || mode === 'dark')
    : []
  return modes.length ? modes : ['light', 'dark']
}

/** The writer's size caps from /schema, or null when the route did not say.
 *  The pane DISPLAYS these rather than re-declaring the numbers. */
function schemaCaps(schema) {
  const caps = schema && schema.caps && typeof schema.caps === 'object' ? schema.caps : null
  if (!caps) return null
  const maxColors = typeof caps.maxColors === 'number' ? caps.maxColors : null
  const maxBytes = typeof caps.maxBytes === 'number' ? caps.maxBytes : null
  if (maxColors === null && maxBytes === null) return null
  return { maxColors: maxColors, maxBytes: maxBytes }
}

/** Pure drift check: roles whose PRIMARY skin key the backend's palette does
 *  not list. Empty means the two vocabularies agree. */
function schemaDrift(roles, paletteKeys) {
  const known = new Set(Array.isArray(paletteKeys) ? paletteKeys : [])
  const drift = []
  for (const role of roles || []) {
    const key = role && role.keys ? role.keys[0] : null
    if (key && !known.has(key)) drift.push({ role: role.id, key: key })
  }
  return drift
}

/** The one notice the drift alarm raises, or null when nothing drifted. Names
 *  the first offending role and key, so the message is actionable. */
const TYPOGRAPHY_KEYS = ['fontSans', 'fontMono']
const FORBIDDEN_TYPO_CHARS = /[;{}<>\n]/

/** A user-typed font stack is valid when it carries no CSS-breaking character.
 *  The backend refuses these by name; the pane refuses them locally so the
 *  user sees the error before a round trip. */
function validTypoStack(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  return !FORBIDDEN_TYPO_CHARS.test(value)
}

/** The emoji fallback is mandatory: a chosen font silently loses colour-emoji
 *  glyphs without it, and the bug reads as "the emoji broke". */
function withEmojiFallback(stack) {
  if (!stack) return stack
  return stack.includes(EMOJI_FALLBACK) ? stack : stack + ', ' + EMOJI_FALLBACK
}

/** PURE: the typography drift check. A font key the pane renders but the
 *  backend refuses is the drift this catches. */
function schemaTypoDrift(schemaTypography) {
  const known = new Set(Array.isArray(schemaTypography)
    ? schemaTypography.map(item => item && item.id)
    : [])
  const drift = []
  for (const key of TYPOGRAPHY_KEYS) {
    if (!known.has(key)) drift.push({ key: key, side: 'pane' })
  }
  return drift
}

/** The one notice the typography drift raises, or null when nothing drifted. */
function schemaTypoDriftNotice(drift) {
  if (!drift || !drift.length) return null
  const first = drift[0]
  const more = drift.length > 1 ? ' (' + drift.length + ' font keys disagree)' : ''
  return {
    kind: 'warning',
    title: 'Chroma typography schema drift',
    message: 'Font key ' + first.key + ' is rendered by the pane, absent from GET /schema' + more,
    detail: 'The pane and the backend disagree about a font key. A font save may be refused.'
  }
}

function schemaDriftNotice(drift) {
  if (!drift || !drift.length) return null
  const first = drift[0]
  const more = drift.length > 1 ? ' (' + drift.length + ' roles disagree)' : ''
  return {
    kind: 'warning',
    title: 'Chroma editor schema drift',
    message: 'Role ' + first.role + ' writes ' + first.key + ', absent from GET /schema' + more,
    detail: 'The pane and the backend disagree about an editable key. The writer may refuse a save.'
  }
}

/** The quiet, once-per-session note when /schema is not mounted. The editor
 *  keeps working on its own defaults; this says so rather than looking broken. */
function schemaMissingNotice() {
  return {
    kind: 'info',
    title: 'Chroma editor: no schema',
    message: 'Running without GET /schema — using the editor own defaults',
    detail: 'The schema route mounts when the Chroma backend is imported. The editor still works.'
  }
}

/** After an in-place save the pane's own copy of the scene is stale — the file
 *  changed under it. Fold the written palettes back into the scene the gallery
 *  reads, so the card and a re-seeded editor show what was actually saved
 *  rather than the colours the skin had when the editor opened. The payload is
 *  the backend's own read-back (it may normalise), never the local draft. */
function foldSavedSkin(name, saved) {
  const pick = value => (value && typeof value === 'object' && Object.keys(value).length ? value : null)
  const light = saved ? pick(saved.light) : null
  const dark = saved ? pick(saved.dark) : null
  if (!light && !dark) return
  const merged = scene => {
    const next = safeMerge(scene)
    if (light) {
      next.lightColors = safeMerge(scene.lightColors || scene.colors || {}, light)
      next.colors = next.lightColors
    }
    if (dark) next.darkColors = safeMerge(scene.darkColors || scene.colors || {}, dark)
    return next
  }
  const index = IMPORTED_SKINS.findIndex(scene => scene && scene.name === name)
  if (index >= 0) {
    IMPORTED_SKINS[index] = merged(IMPORTED_SKINS[index])
    return
  }
  // A skin the pane only knew from live discovery: it is still a real scene, so
  // record what it now holds rather than leaving the gallery on stale colours.
  IMPORTED_SKINS.push(merged({
    name: name,
    label: name,
    description: 'Chroma skin',
    modeSupport: light && dark ? 'dynamic' : (light ? 'light' : 'dark'),
    colors: light || dark || {},
    lightColors: light || {},
    darkColors: dark || undefined
  }))
}

// ---------------------------------------------------------------------------
// E2 — the duplicate action and the fork (plan §5, §18.3).
//
// POST /skins/duplicate forks the EFFECTIVE palette into a brand-new OWNED
// skin. It is the escape hatch §3 requires: a built-in's authored file is
// NEVER rewritten (§17.1), so the way to edit a shipped theme's copy is to
// fork it. The pane resolves nothing — it sends both palettes in the SAME
// skin-keyed vocabulary overridePayload already builds, so the backend invents
// no colour and the fork cannot disagree with the editor's own preview.
//
// Every builder here is PURE and named, so the suite drives them without a DOM
// (the discipline exportArtifact already keeps).
// ---------------------------------------------------------------------------

/** A slug the backend accepts: lowercase [a-z0-9-], no leading/trailing dash.
 *  The pane validates the name BEFORE it posts, so a bad name is a field-level
 *  complaint rather than a surprise (the backend still refuses it). */
function isSlug(value) {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.length > 0 && slug(s) === s
}

/** The pre-filled name for a fork: `<name>-copy`, always a valid slug. */
function duplicateSlug(sourceName) {
  return (slug(sourceName) || 'skin') + '-copy'
}

/** The default label for a fork: the source's label plus ' copy'. */
function duplicateLabel(sourceLabel, sourceName) {
  const base = (typeof sourceLabel === 'string' && sourceLabel.trim())
    ? sourceLabel.trim()
    : ((typeof sourceName === 'string' && sourceName.trim()) ? sourceName.trim() : 'Skin')
  return base + ' copy'
}

/** PURE: the POST /skins/duplicate body (§5). Both palettes are the CONCRETE
 *  skin keys the editor's draft maps to (overridePayload); `label` defaults to
 *  the source's label + ' copy', never left empty. */
function duplicateBody(draftRoles, to, label, modes, source) {
  const palettes = overridePayload(draftRoles, modes)
  const given = typeof label === 'string' ? label.trim() : ''
  return {
    to: to,
    label: given || duplicateLabel(source && source.label, source && source.name),
    light: palettes.light,
    dark: palettes.dark
  }
}

/** PURE: how a duplicate failure is SHOWN. A 409 is a field-level COLLISION on
 *  the name — the modal stays open and the colours stay put — not a thrown
 *  crash. A 400 is a bad name/role/colour the backend named; anything else is
 *  an honest error. */
function duplicateFailure(error) {
  const status = (error && (error.status || error.statusCode)) || 0
  const raw = error && error.message ? error.message : String(error || 'unknown error')
  if (status === 409) {
    return {
      kind: 'collision',
      field: 'to',
      status: 409,
      message: raw,
      notice: {
        kind: 'warning',
        title: 'That name is taken',
        message: 'A skin or built-in already holds that name',
        detail: raw + ' — pick another name. Your colours are untouched.'
      }
    }
  }
  if (status === 400) {
    return {
      kind: 'invalid',
      field: 'to',
      status: 400,
      message: raw,
      notice: {
        kind: 'error',
        title: 'Duplicate refused',
        message: 'The backend refused the fork: ' + raw,
        detail: 'Fix the name or colour it names and try again — nothing was written.'
      }
    }
  }
  return {
    kind: 'error',
    field: null,
    status: status,
    message: raw,
    notice: {
      kind: 'error',
      title: 'Duplicate failed',
      message: 'Duplicate failed: ' + raw,
      detail: 'Nothing was changed. Your palettes are still here.'
    }
  }
}

/** POST /skins/duplicate — the one writer E2 adds. */
async function duplicateSkin(to, label, light, dark) {
  if (!_rest) throw new Error(BACKEND_MISSING_MESSAGE)
  return await _rest('skins/duplicate', {
    method: 'POST',
    body: JSON.stringify({ to: to, label: label, light: light || {}, dark: dark || {} })
  })
}

// ---------------------------------------------------------------------------
// E3 — packs (plan §7, §16.1). Four behaviours, all in this pane: LIST (with
// member counts and a visible missing-member warning), EXPORT through the SAME
// saveTextFile channel exportArtifact already uses, IMPORT (always preview
// before write), and DELETE (record-only vs record + skins).
// ---------------------------------------------------------------------------

/** GET /packs. Tolerant about the envelope; a backend that answers with
 *  something else means "no packs", never a crash in the pane. */
async function listPacks() {
  if (!_rest) return []
  const result = await _rest('packs')
  const rows = result && Array.isArray(result.packs) ? result.packs : (Array.isArray(result) ? result : [])
  return rows.filter(row => row && typeof row === 'object')
}

/** POST /packs/export. Returns the bundle document the backend built. */
async function requestPackExport(name, members, author) {
  if (!_rest) throw new Error(BACKEND_MISSING_MESSAGE)
  return await _rest('packs/export', {
    method: 'POST',
    body: JSON.stringify({ name: name, members: members, author: author || '' })
  })
}

/** POST /packs/import. dryRun:true previews; dryRun:false writes. The batch is
 *  one transaction on the backend, which rolls a failed import back. */
async function requestPackImport(bundle, dryRun) {
  if (!_rest) throw new Error(BACKEND_MISSING_MESSAGE)
  const body = safeMerge(bundle, { dryRun: dryRun ? true : false })
  return await _rest('packs/import', { method: 'POST', body: JSON.stringify(body) })
}

/** DELETE /packs/{slug}?withSkins=… — record only by default. */
async function dropPack(packSlug, withSkins) {
  if (!_rest) throw new Error(BACKEND_MISSING_MESSAGE)
  return await _rest('packs/' + encodeURIComponent(packSlug) + '?withSkins=' + (withSkins ? 'true' : 'false'), { method: 'DELETE' })
}

/** PURE: the POST /packs/export body. */
function packExportBody(name, members, author) {
  return {
    name: typeof name === 'string' ? name.trim() : '',
    members: (Array.isArray(members) ? members : []).filter(m => typeof m === 'string' && m),
    author: typeof author === 'string' ? author.trim() : ''
  }
}

/** PURE: the export filename — the pack's SLUG + '.json' (brief, §7). */
function packFilename(nameOrSlug) {
  return (slug(nameOrSlug) || 'chroma-pack') + '.json'
}

/** PURE: map a returned bundle to the file the user receives, exactly as
 *  exportArtifact maps a REST payload. */
function packArtifact(bundle) {
  if (!bundle || typeof bundle !== 'object' || !bundle.name) {
    throw new Error('pack export returned no bundle')
  }
  return { filename: packFilename(bundle.name), text: JSON.stringify(bundle, null, 2) }
}

/** PURE: assemble a bundle document (§7). The backend BUILDS the bundle for
 *  POST /packs/export; this mirrors the same shape so a document can be
 *  round-tripped through parsePackBundle and the format can be pinned in a test
 *  without a live backend. */
function packBundle(name, skins, options) {
  const opts = options || {}
  return {
    chroma_pack: 1,
    name: name,
    author: opts.author || '',
    created: opts.created || '',
    categories: Array.isArray(opts.categories) ? opts.categories : [],
    skins: Array.isArray(skins) ? skins : []
  }
}

/** PURE: the count badge beside the section heading. */
function packCountLabel(packs) {
  const n = Array.isArray(packs) ? packs.length : 0
  return n === 1 ? '1 pack' : n + ' packs'
}

/** PURE: the members of this pack whose files are GONE. Never render a pack
 *  that quietly lost members as if it were whole. */
function packMissing(pack) {
  return pack && Array.isArray(pack.missing) ? pack.missing.filter(m => typeof m === 'string' && m) : []
}

/** PURE: one line describing a pack's membership, honest about absence. */
function packMemberSummary(pack) {
  const count = pack && typeof pack.memberCount === 'number'
    ? pack.memberCount
    : (pack && Array.isArray(pack.members) ? pack.members.length : 0)
  const missing = packMissing(pack)
  if (!missing.length) return count + (count === 1 ? ' skin' : ' skins')
  const present = Math.max(0, count - missing.length)
  return present + ' of ' + count + ' skins present — ' + missing.length + ' missing'
}

/** PURE: the warning a pack with missing members carries, or null when whole. */
function packMissingNotice(pack) {
  const missing = packMissing(pack)
  if (!missing.length) return null
  return {
    kind: 'warning',
    title: 'Pack ' + ((pack && (pack.name || pack.slug)) || '') + ' is incomplete',
    message: missing.length + ' member(s) are missing: ' + missing.join(', '),
    detail: 'The pack record names skins whose files are gone. Re-import it, or export it as it stands.'
  }
}

/** PURE: parse an imported bundle defensively (§7, "hostile by default").
 *  Returns {ok:true, bundle} or {ok:false, error:<readable>} — never a stack
 *  trace, never a silently-dropped role or a bare-string error. */
function parsePackBundle(text) {
  let data
  try {
    data = parseTolerantJson(text)
  } catch (e) {
    return { ok: false, error: 'This is not valid JSON: ' + (e && e.message ? e.message : e) }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'A pack bundle is a JSON object, not ' + (Array.isArray(data) ? 'an array' : (data === null ? 'null' : typeof data)) }
  }
  if (data.chroma_pack !== 1) {
    return { ok: false, error: 'Not a Chroma pack bundle — chroma_pack must be 1, saw ' + JSON.stringify(data.chroma_pack) }
  }
  if (typeof data.name !== 'string' || !data.name.trim()) {
    return { ok: false, error: 'The bundle has no pack name' }
  }
  if (!isSlug(data.name)) {
    return { ok: false, error: 'The pack name "' + data.name + '" is not a slug (lowercase, dashes and digits only)' }
  }
  if (!Array.isArray(data.skins)) {
    return { ok: false, error: 'The bundle carries no skins array' }
  }
  for (const skin of data.skins) {
    if (!skin || typeof skin !== 'object' || typeof skin.name !== 'string' || !skin.name.trim()) {
      return { ok: false, error: 'A skin in the bundle has no name' }
    }
    if (!isSlug(skin.name)) {
      return { ok: false, error: 'Skin "' + skin.name + '" is not a slug' }
    }
    for (const modeKey of ['light', 'dark']) {
      const palette = skin[modeKey]
      if (palette === undefined || palette === null) continue
      if (typeof palette !== 'object' || Array.isArray(palette)) {
        return { ok: false, error: 'Skin "' + skin.name + '" has a bad ' + modeKey + ' palette' }
      }
      for (const key of Object.keys(palette)) {
        if (!normaliseHex(palette[key])) {
          return { ok: false, error: 'Skin "' + skin.name + '" has a ' + modeKey + ' value "' + String(palette[key]) + '" that is not #rrggbb' }
        }
      }
    }
  }
  const categories = Array.isArray(data.categories) ? data.categories : []
  return { ok: true, bundle: safeMerge(data, { categories: categories }) }
}

/** PURE: group the backend's dry-run plan by status (§7): a skin that is new,
 *  identical (skipped), or collides with an existing different skin. */
function groupImportPlan(preview) {
  const plan = preview && Array.isArray(preview.plan) ? preview.plan : []
  const groups = { new: [], identical: [], collides: [] }
  for (const row of plan) {
    if (!row || typeof row !== 'object' || typeof row.name !== 'string') continue
    const status = (row.status === 'identical' || row.status === 'collides') ? row.status : 'new'
    groups[status].push({ name: row.name, status: status, to: typeof row.to === 'string' ? row.to : '' })
  }
  return groups
}

/** PURE: the counts the preview header reads before the user confirms. */
function packImportSummary(groups) {
  const g = groups || { new: [], identical: [], collides: [] }
  return { total: g.new.length + g.identical.length + g.collides.length, isNew: g.new.length, identical: g.identical.length, collides: g.collides.length }
}

/** PURE: apply the user's collision choices to the bundle, so the CONFIRMED
 *  payload is `{...bundle, dryRun:false}` exactly — the pinned contract adds no
 *  side channel for choices. A rename rewrites that skin's name; a skip drops
 *  it and is reported. A skin with no choice is left as it stands. */
function applyPackChoices(bundle, choices) {
  const decisions = choices && typeof choices === 'object' ? choices : {}
  const skins = []
  const skipped = []
  for (const skin of (bundle && Array.isArray(bundle.skins) ? bundle.skins : [])) {
    const name = skin && skin.name
    const choice = decisions[name]
    if (choice && choice.action === 'skip') { skipped.push(name); continue }
    if (choice && choice.action === 'rename' && typeof choice.to === 'string' && choice.to.trim()) {
      skins.push(safeMerge(skin, { name: choice.to.trim() }))
      continue
    }
    skins.push(skin)
  }
  return { bundle: safeMerge(bundle, { skins: skins }), skipped: skipped }
}

/** PURE: the notice an applied import reports. */
function packImportNotice(applied) {
  const written = applied && Array.isArray(applied.applied) ? applied.applied : []
  const skipped = applied && Array.isArray(applied.skipped) ? applied.skipped : []
  return {
    kind: written.length ? 'success' : 'info',
    title: 'Pack imported',
    message: written.length + ' skin(s) written' + (skipped.length ? ', ' + skipped.length + ' skipped' : ''),
    detail: skipped.length ? 'Skipped: ' + skipped.join(', ') : 'Every skin in the bundle is now owned by you.'
  }
}

/** PURE: the words a destructive delete and a record-only delete each carry.
 *  The destructive choice gets a confirm step in the pane. */
function packDeleteNotice(pack, withSkins) {
  const name = (pack && (pack.name || pack.slug)) || 'this pack'
  return {
    withSkins: !!withSkins,
    title: withSkins ? 'Delete the ' + name + ' record AND its skins?' : 'Delete the ' + name + ' record?',
    message: withSkins
      ? 'The pack record and every skin it names go to the trash.'
      : 'The pack record is dropped; the skins themselves stay.',
    confirm: withSkins ? 'Delete pack + skins' : 'Delete record'
  }
}

/** Did the backend answer "no such route"? A new route does not exist until
 *  Hermes restarts, because a mounted plugin_api.py is never re-imported, so the
 *  editor has to say that instead of looking broken (plan §14.1, §17.4). */
function isMissingRoute(error) {
  if (!error) return false
  const status = error.status || error.statusCode || (error.response && error.response.status)
  if (status === 404) return true
  return /\b404\b|not found/i.test(String(error.message || error))
}

/** The notice a failed save or reset produces. Pure, so both writes say the same
 *  thing and the test asserts the words without a DOM.
 *
 *  Never a success and never a cleared draft: the caller keeps the user's edit
 *  because this notice is the only thing that changed. A 404 means the routes
 *  are not mounted yet — the one instruction that actually helps is "restart". */
function overrideFailureNotice(error, action, door) {
  const what = action === 'reset' ? 'Reset' : 'Save'
  const where = door === 'skin' ? 'skin' : 'override'
  if (isMissingRoute(error)) {
    return {
      kind: 'error',
      title: what + ' did not run',
      message: 'Restart Hermes to enable the editor',
      detail: 'The ' + where + ' routes mount when the Chroma backend is imported, and a running '
        + 'backend is never re-imported. Restart Hermes, then try again — your edit is still here.'
    }
  }
  const raw = error && error.message ? error.message : String(error || 'unknown error')
  if (raw === BACKEND_MISSING_MESSAGE) {
    return {
      kind: 'error',
      title: what + ' needs the Chroma backend',
      message: 'The gateway half is not installed',
      detail: 'An ' + where + ' is stored by the Python half. Install it, restart Hermes, and try again.'
    }
  }
  return {
    kind: 'error',
    title: door === 'skin' ? 'Skin save failed' : what + ' failed',
    message: what + ' failed: ' + raw,
    detail: 'Nothing was changed, and nothing was thrown away. The ' + where + ' write did not go through.'
  }
}

/** Pure: which file a saved export carries, and its contents. Kept pure so the
 *  test asserts the mapping without needing a DOM or a Blob.
 *  A single skin saves as its own YAML. A bulk export saves the backend's JSON
 *  bundle of {name, yaml} pairs — the envelope the backend already names
 *  chroma-skins.json, so the file matches what the API declared. */
function exportArtifact(payload) {
  if (!payload || !Array.isArray(payload.files) || !payload.files.length) {
    throw new Error('export returned no files')
  }
  if (payload.files.length === 1 && typeof payload.filename === 'string' && /\.ya?ml$/i.test(payload.filename)) {
    return { filename: payload.filename, text: payload.files[0].yaml }
  }
  return { filename: payload.filename || 'chroma-skins.json', text: JSON.stringify(payload, null, 2) }
}

/** Save a text file from the renderer. `host` exposes no save API, so this uses
 *  an anchor + blob — which is not a fallback but the supported path: Electron's
 *  will-download handler routes renderer anchor/blob downloads to the user's
 *  Downloads folder with a save dialog (installDownloadHandling in
 *  apps/desktop/electron/main.ts). */
function saveTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Every provenance tag an imported theme may carry. Stored themes are only
 *  re-hydrated for a tag in this list, so a stray localStorage entry cannot
 *  become a phantom card. */
const IMPORT_SOURCES = ['tweakcn', 'windows-terminal', 'base16', 'vscode']

let _importedLoaded = false
function ensureImportedSkinsLoaded() {
  if (_importedLoaded) return
  _importedLoaded = true
  for (const t of Object.values(readStoredThemes())) {
    if (t && IMPORT_SOURCES.indexOf(t.themePickerSource) >= 0) {
      const scene = { name: t.name, label: t.label || t.name, description: t.description || 'Imported theme',
        modeSupport: sceneModeSupport(t), palette: sceneModeSupport(t),
        colors: t.colors, lightColors: t.colors, darkColors: t.darkColors, typography: t.typography }
      if (!IMPORTED_SKINS.some(s => s.name === scene.name)) IMPORTED_SKINS.push(scene)
    }
  }
}

function renderedModeFor(colors, mode) {
  return luminance(colors.background) > 0.5 ? 'light' : hexToRgb(colors.background) ? 'dark' : mode
}

const NEUTRAL_CHROME = { light: '#f3f3f3', dark: '#0d0d0e' }

function mixesFor(isDark) {
  return {
    '--theme-mix-chrome': isDark ? '74%' : '92%',
    '--theme-mix-sidebar': '100%',
    '--theme-mix-card': isDark ? '38%' : '22%',
    '--theme-mix-elevated': isDark ? '46%' : '28%',
    '--theme-mix-bubble': isDark ? '46%' : '0%'
  }
}

/**
 * Immediate local repaint — a source-faithful port of Desktop's applyTheme().
 * The public plugin SDK does not expose ThemeContext.setTheme/setMode, so this
 * updates the same root tokens and native window hooks without navigating or
 * remounting the React app. Persistence is handled separately for next boot.
 */
function applyDesktopTheme(theme, mode) {
  const root = document.documentElement
  const c = mode === 'dark' ? (theme.darkColors || theme.colors) : theme.colors
  const typo = {
    fontSans: DEFAULT_FONT_SANS,
    fontMono: DEFAULT_FONT_MONO,
    ...(theme.typography || {})
  }
  const rendered = renderedModeFor(c, mode)
  const isDark = rendered === 'dark'
  const midground = c.midground || c.ring

  root.style.setProperty('color-scheme', rendered)
  root.dataset.hermesTheme = theme.name
  root.dataset.hermesMode = rendered
  root.classList.toggle('dark', isDark)

  const seeds = {
    '--theme-foreground': c.foreground,
    '--theme-primary': c.primary,
    '--theme-secondary': c.secondary,
    '--theme-accent-soft': c.accent,
    '--theme-midground': midground,
    '--theme-warm': c.primary,
    '--theme-background-seed': c.background,
    '--theme-sidebar-seed': c.sidebarBackground || c.background,
    '--theme-card-seed': c.card,
    '--theme-elevated-seed': c.popover,
    '--theme-bubble-seed': c.userBubble || c.popover
  }
  const palette = {
    '--dt-primary-foreground': c.primaryForeground,
    '--dt-secondary-foreground': c.secondaryForeground,
    '--dt-accent-foreground': c.accentForeground,
    '--dt-border': c.border,
    '--dt-input': c.input,
    '--dt-ring': c.ring,
    '--dt-muted': c.muted,
    '--dt-midground-foreground': c.midgroundForeground || readableOn(midground),
    '--dt-composer-ring': c.composerRing || midground,
    '--dt-destructive': c.destructive,
    '--dt-destructive-foreground': c.destructiveForeground,
    '--dt-sidebar-border': c.sidebarBorder || c.border,
    '--dt-user-bubble-border': c.userBubbleBorder || c.border,
    '--dt-font-sans': typo.fontSans,
    '--dt-font-mono': typo.fontMono,
    '--noise-opacity-mul': isDark ? 'calc(0.04 / 0.21)' : 'calc(0.34 / 0.21)'
  }
  for (const [key, value] of Object.entries({ ...seeds, ...mixesFor(isDark), ...palette })) {
    if (value) root.style.setProperty(key, value)
  }

  const chromeBg = mix(c.background, NEUTRAL_CHROME[isDark ? 'dark' : 'light'], isDark ? 0.26 : 0.08)
  try {
    window.hermesDesktop?.setTitleBarTheme?.({ background: chromeBg, foreground: c.foreground })
    window.hermesDesktop?.setNativeTheme?.(rendered)
  } catch {
    // Native chrome hooks are optional; the renderer repaint is already done.
  }
  try {
    window.localStorage.setItem('hermes-boot-background', chromeBg)
    window.localStorage.setItem('hermes-boot-color-scheme', rendered)
  } catch {
    // Restricted storage must not block the current in-place repaint.
  }

}

/**
 * Hand a scene switch to Desktop's ThemeProvider so React state stops
 * disagreeing with the painted root tokens. Returns false when no provider API
 * is captured, leaving the manual paint as the only change.
 */
function syncDesktopState(name, mode, api) {
  const target = api || desktopThemeApi
  if (!target || typeof target.setTheme !== 'function') return false
  try {
    target.setTheme(name)
    if (typeof target.setMode === 'function') target.setMode(mode)
    return true
  } catch {
    return false
  }
}

/**
 * Capture Desktop's theme API for the module while the host component lives.
 * Desktop's provider memoizes setTheme/setMode, so the deps stay stable.
 *
 * The picker page and the command-bar chip both call this hook and share the
 * one module slot, so a refcount decides when it may be cleared: the FIRST
 * consumer to mount fills it and every consumer keeps the slot alive until the
 * LAST one unmounts. Clearing on any single unmount left the still-mounted chip
 * unable to hand a switch to the provider, and the next Desktop render reverted
 * the surface — "the theme does not stick".
 */
function useDesktopThemeApi() {
  const api = useTheme()
  useEffect(() => {
    if (!api || typeof api.setTheme !== 'function') return undefined
    desktopThemeApi = { setTheme: api.setTheme, setMode: api.setMode }
    desktopThemeApiConsumers += 1
    return () => {
      desktopThemeApiConsumers = Math.max(0, desktopThemeApiConsumers - 1)
      if (desktopThemeApiConsumers === 0) desktopThemeApi = null
    }
  }, [api && api.setTheme, api && api.setMode])
  return api
}

// Is this cached boot entry the pre-2.4.0 single-mode shape that must be
// repaired?
//
// Before 2.4.0 the single-mode scenes were persisted with ONE palette stored as
// both `colors` and `darkColors` (or with no `darkColors` at all). Desktop's
// `paletteFor()` returns `seed.darkColors ?? seed.colors` for dark and, for
// light, `seed.colors` when there is no `darkColors` — so for that entry the
// lightbulb switches to the SAME palette and is mathematically a no-op. The
// cache also WINS over our THEMES_AREA contribution at boot, so an unrepaired
// entry keeps the toggle dead until it is rewritten.
//
// The old detector could never fire: it rebuilt the expected label with
// `charAt(0).toUpperCase()` ("Deep-void") and compared it to the shipped label
// ("Deep Void"). Detection is by SHAPE now — the cached halves are identical, or
// the dark half is absent — with the cached palette required to be one this theme
// actually ships. A cache carrying some other palette is the user's own import,
// not our stale entry, and is left untouched (that is what keeps the
// "never overwrite an unrelated user import" guarantees intact).
function isLegacyPickerTheme(existing, theme) {
  if (!existing || typeof existing !== 'object' || !theme || !theme.darkColors) return false
  const cachedColors = existing.colors
  const cachedDark = existing.darkColors
  const singlePalette = cachedColors !== undefined && cachedDark !== undefined &&
    JSON.stringify(cachedColors) === JSON.stringify(cachedDark)
  const missingDark = cachedDark === undefined
  if (!singlePalette && !missingDark) return false
  if (cachedColors === undefined) return false
  const shipped = [theme.colors, theme.darkColors].map(value => JSON.stringify(value))
  return shipped.includes(JSON.stringify(cachedColors))
}

// Synchronous boot read of the override store. Returns {} when there is no
// mirror or it is unreadable — the authored palettes are the fallback, exactly
// as when the backend is absent.
function readOverrideMirror() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OVERRIDES_MIRROR_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

// Mirror one override change for the next boot. Best-effort by design: a failure
// costs the next boot its override, never the current save, which the backend
// has already accepted.
function writeOverrideMirror(scene, override) {
  try {
    const mirror = readOverrideMirror()
    if (override) {
      mirror[scene] = override
    } else {
      delete mirror[scene]
    }
    window.localStorage.setItem(OVERRIDES_MIRROR_KEY, JSON.stringify(mirror))
    return true
  } catch {
    return false
  }
}

function persistThemesForBoot(themes) {
  try {
    const raw = window.localStorage.getItem(USER_THEMES_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    const stored = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}

    let changed = false
    for (const theme of themes) {
      // Native imports take precedence over a plugin contribution with the same
      // name, matching the desktop's user-theme resolution order.
      const existing = stored[theme.name]
      if (!existing || existing.themePickerManaged || isLegacyPickerTheme(existing, theme)) {
        // Repairing a stale single-mode entry writes the CURRENT pair here. No
        // reload is issued: Desktop reads $userThemes once at module init, so the
        // repair lands on the NEXT boot — the accepted cost of a silent fix.
        stored[theme.name] = theme
        changed = true
      }
    }
    if (changed) window.localStorage.setItem(USER_THEMES_KEY, JSON.stringify(stored))
    return true
  } catch {
    // Storage is best-effort; the current session can still use contributed themes.
    return false
  }
}

function readRecord(key) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function persistAppearance(themeName, mode, profile = 'default') {
  try {
    if (profile === 'default') {
      window.localStorage.setItem(SKIN_KEY, themeName)
      window.localStorage.setItem(MODE_KEY, mode)
      return true
    }
    window.localStorage.setItem(PROFILE_SKINS_KEY, JSON.stringify({ ...readRecord(PROFILE_SKINS_KEY), [profile]: themeName }))
    window.localStorage.setItem(PROFILE_MODES_KEY, JSON.stringify({ ...readRecord(PROFILE_MODES_KEY), [profile]: mode }))
    return true
  } catch {
    return false
  }
}

function readAppearance(profile = 'default') {
  try {
    const theme = profile === 'default'
      ? window.localStorage.getItem(SKIN_KEY)
      : readRecord(PROFILE_SKINS_KEY)[profile] || window.localStorage.getItem(SKIN_KEY)
    const mode = profile === 'default'
      ? window.localStorage.getItem(MODE_KEY)
      : readRecord(PROFILE_MODES_KEY)[profile] || window.localStorage.getItem(MODE_KEY)
    return { theme: theme || 'nous', mode: mode === 'dark' ? 'dark' : 'light' }
  } catch {
    return { theme: 'nous', mode: 'light' }
  }
}

// --- apply scope -----------------------------------------------------------
//
// Per-profile Desktop themes are the Desktop's OWN behaviour: ThemeProvider
// persists the active skin per profile (skinPref -> PROFILE_SKINS_KEY) and Chroma
// inherits it because it applies through setTheme(). What flattens the user's
// per-profile intent is OUR gateway broadcast -- config.set writes the one global
// display.skin and broadcasts skin.changed, and an inbound broadcast is drained
// through setTheme, which persists into whichever profile is active right then.
//
// So the scope decides only whether a pick is BROADCAST. The default is
// 'everywhere', which is today's behaviour: silently changing what every existing
// pick does would repeat the gateway-sync removal.

const APPLY_SCOPE_LOCAL = 'profile'
const APPLY_SCOPE_EVERYWHERE = 'everywhere'

function readApplyScope(profile = 'default') {
  return readRecord(APPLY_SCOPE_KEY)[profile] === APPLY_SCOPE_LOCAL
    ? APPLY_SCOPE_LOCAL
    : APPLY_SCOPE_EVERYWHERE
}

function writeApplyScope(profile, scope) {
  try {
    const next = { ...readRecord(APPLY_SCOPE_KEY) }
    if (scope === APPLY_SCOPE_LOCAL) next[profile] = APPLY_SCOPE_LOCAL
    else delete next[profile]
    window.localStorage.setItem(APPLY_SCOPE_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

/** Defaults to squares on anything unrecognised, including a storage failure:
 *  the gallery must always render. */
function readCardShape() {
  let stored = null
  try { stored = window.localStorage.getItem(CARD_SHAPE_KEY) } catch (e) { return 'square' }
  return CARD_SHAPES.indexOf(stored) >= 0 ? stored : 'square'
}

function writeCardShape(shape) {
  if (CARD_SHAPES.indexOf(shape) < 0) return false
  try {
    window.localStorage.setItem(CARD_SHAPE_KEY, shape)
    return true
  } catch {
    return false
  }
}

// Favourites are the user's own shelf: the skin names they starred, in the order
// they starred them, under Chroma's own key. Read is defensive in both
// directions - a corrupt store and a hand-edited list of junk both degrade to
// the list that survives, never to a thrown render.
const FAVORITES_KEY = 'chroma-favorites-v1'

function readFavorites() {
  let raw = null
  try {
    raw = window.localStorage.getItem(FAVORITES_KEY)
  } catch {
    return []
  }
  let parsed = null
  try {
    parsed = JSON.parse(raw || '[]')
  } catch {
    return []
  }
  return cleanFavoriteNames(parsed)
}

function cleanFavoriteNames(list) {
  const out = []
  if (!Array.isArray(list)) return out
  for (const name of list) {
    if (typeof name === 'string' && name && out.indexOf(name) < 0) out.push(name)
  }
  return out
}

function writeFavorites(list) {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(cleanFavoriteNames(list)))
    return true
  } catch {
    return false
  }
}

/** Star or unstar ONE name, without touching the order of the rest. */
function toggleFavoriteName(list, name) {
  const next = cleanFavoriteNames(list)
  if (!name) return next
  const at = next.indexOf(name)
  if (at >= 0) next.splice(at, 1)
  else next.push(name)
  return next
}

/** Defaults to medium on anything unrecognised, including a storage failure:
 *  the gallery must always render. */
function readCardSize() {
  let stored = null
  try { stored = window.localStorage.getItem(CARD_SIZE_KEY) } catch (e) { return 'md' }
  return CARD_SIZES.indexOf(stored) >= 0 ? stored : 'md'
}

function writeCardSize(size) {
  if (CARD_SIZES.indexOf(size) < 0) return false
  try {
    window.localStorage.setItem(CARD_SIZE_KEY, size)
    return true
  } catch {
    return false
  }
}

/** Defaults to the scene grouping -- what shipped first -- on anything
 *  unrecognised, including a storage failure: the gallery must always render. */
function readGroupMode() {
  let stored = null
  try { stored = window.localStorage.getItem(GROUP_MODE_KEY) } catch (e) { return 'scene' }
  return GROUP_MODES.indexOf(stored) >= 0 ? stored : 'scene'
}

function writeGroupMode(mode) {
  if (GROUP_MODES.indexOf(mode) < 0) return false
  try {
    window.localStorage.setItem(GROUP_MODE_KEY, mode)
    return true
  } catch {
    return false
  }
}

function desktopModeFor(profile, renderedMode) {
  return renderedMode === 'light' || renderedMode === 'dark'
    ? renderedMode
    : readAppearance(profile).mode
}

function sceneForThemeName(themeName) {
  return SKINS.find(item =>
    item.name === themeName || item.lightName === themeName || item.darkName === themeName ||
    item.gatewayLightName === themeName || item.gatewayDarkName === themeName
  )
}

function sceneNameFor(themeName) {
  const scene = sceneForThemeName(themeName)
  return scene ? scene.name : themeName
}

function migrateAppearanceAliases() {
  let storedThemes = {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(USER_THEMES_KEY) || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) storedThemes = parsed
  } catch {
    // A malformed cache must not block ordinary alias migration.
  }

  const alias = name => {
    if (name === 'default') return { name: 'nous', mode: null }
    const lightScene = SKINS.find(item =>
      (item.lightName === name && item.lightName !== item.name) || item.gatewayLightName === name
    )
    if (lightScene) return { name: lightScene.name, mode: 'light' }
    // Paired source packs conventionally use the dark source name as the new
    // combined scene name. Only infer dark mode when the selected cached theme
    // is the legacy picker-managed single-palette shape; otherwise the same
    // scene name may be an intentional current Light selection or user import.
    const canonicalDarkScene = SKINS.find(item =>
      item.modeSupport === 'dynamic' && item.darkName === name && item.name === name
    )
    if (canonicalDarkScene) {
      const combined = sceneToDesktopTheme(canonicalDarkScene)
      if (isLegacyPickerTheme(storedThemes[name], combined)) {
        return { name: canonicalDarkScene.name, mode: 'dark' }
      }
    }
    const darkScene = SKINS.find(item =>
      (item.darkName === name && item.darkName !== item.name) || item.gatewayDarkName === name
    )
    return darkScene ? { name: darkScene.name, mode: 'dark' } : null
  }

  try {
    const globalTheme = window.localStorage.getItem(SKIN_KEY)
    const globalAlias = alias(globalTheme)
    if (globalAlias) {
      window.localStorage.setItem(SKIN_KEY, globalAlias.name)
      if (globalAlias.mode) window.localStorage.setItem(MODE_KEY, globalAlias.mode)
    }

    const themes = readRecord(PROFILE_SKINS_KEY)
    const modes = readRecord(PROFILE_MODES_KEY)
    let changed = false
    for (const [profile, name] of Object.entries(themes)) {
      const match = alias(name)
      if (!match) continue
      themes[profile] = match.name
      if (match.mode) modes[profile] = match.mode
      changed = true
    }
    if (changed) {
      window.localStorage.setItem(PROFILE_SKINS_KEY, JSON.stringify(themes))
      window.localStorage.setItem(PROFILE_MODES_KEY, JSON.stringify(modes))
    }
  } catch {
    // Migration is best-effort and must not prevent plugin registration.
  }
}

/** Grid target width in CSS px, deliberately FIXED rather than derived from a
 *  column count. The previous layout divided the viewport into a column count
 *  capped at four, so on a wide window the squares grew instead of the gallery
 *  showing more of them - four ~330px squares on a 1400px window, which is what
 *  "the squares are very big" was.
 *
 *  104px was about a third of what that produced, but on a wide pane it read as
 *  "rather small" (Captain, 2.1.1), so the base is 132 now. A card still fits its
 *  swatch, a truncated name and the preview pill, with room to breathe. The size
 *  toggle scales it from here: sm 0.77x, md 1x, lg 1.35x. */
const CARD_MIN = 132

/** A rectangle is wider than it is tall, so it needs a wider slot to keep a
 *  usable height. A circle needs a square slot, exactly like a square card.
 *  Size multiplies the base: sm = 0.77x, md = 1x, lg = 1.35x. */
function cardMinFor(shape, size) {
  const base = shape === 'rectangle' ? Math.round(CARD_MIN * 1.6) : CARD_MIN
  const multiplier = size === 'sm' ? 0.77 : (size === 'lg' ? 1.35 : 1)
  return Math.round(base * multiplier)
}

/** The card's aspect ratio. The shape the user picked carries the look, not the
 *  width the grid happened to hand it. */
function cardAspect(shape) {
  return shape === 'rectangle' ? '16 / 10' : '1'
}

/** Corner and padding treatment per shape. A circle needs looser padding: its
 *  inscribed area is narrower than its bounding box, so text set to the edges of
 *  the box would fall outside the circle. */
function cardShapeClasses(shape) {
  if (shape === 'circle') return 'rounded-full'
  return 'rounded-lg'
}

/** Inner padding for the card's own fill, per shape. A circle needs looser
 *  padding: its inscribed area is narrower than its bounding box. Kept apart from
 *  the frame's radius, because the action row must not inherit it. */
function cardShapePadding(shape) {
  return shape === 'circle' ? 'p-2.5' : 'p-1.5'
}

function buildThemeGroups(scenes) {
  return [
    { id: 'dynamic', title: 'Skins', scenes: scenes.filter(scene => scene.modeSupport === 'dynamic') },
    { id: 'dark', title: 'Dark only', scenes: scenes.filter(scene => scene.modeSupport === 'dark') },
    { id: 'light', title: 'Light only', scenes: scenes.filter(scene => scene.modeSupport === 'light') }
  ]
}

/** Six-digit hex ("#rrggbb") from #RGB / #RRGGBB / #RRGGBBAA, or null.
 *  Not folded into hexToRgb, which requires exactly six digits: 19.8% of the
 *  real palettes in the wild carry an alpha byte, and a category must not
 *  depend on opacity. */
function normaliseHex(hex) {
  const raw = String(hex || '').trim().replace(/^#/, '')
  if (!/^[0-9a-f]+$/i.test(raw)) return null
  if (raw.length === 3 || raw.length === 4) {
    return '#' + raw.slice(0, 3).split('').map(ch => ch + ch).join('')
  }
  return raw.length >= 6 ? '#' + raw.slice(0, 6) : null
}

/** OKLCH of a colour: perceptual lightness L (0-1), chroma C (0 to roughly 0.37
 *  for the sRGB gamut) and hue h (0-360). Null when the input is not a colour.
 *
 *  Oklab, not HSL and not RGB max-minus-min. Both simpler measures fail the one
 *  job this needs to do:
 *   - HSL calls a barely-tinted near-white (s=1.0) "fully saturated", so every
 *     light shell reads as loud.
 *   - RGB max-minus-min is not perceptual: a deep navy and a pale grey-blue can
 *     share a chroma while looking nothing alike, and dark colours saturate it.
 *  Oklab (Ottosson, 2020) separates lightness from colourfulness the way the eye
 *  does, which is exactly the axis "pastel" is defined on: high L, low C. */
function oklch(hex) {
  const rgb = hexToRgb(normaliseHex(hex) || '')
  if (!rgb) return null
  const [r, g, b] = rgb.map(v => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  const c = Math.sqrt(A * A + B * B)
  let h = Math.atan2(B, A) * 180 / Math.PI
  if (h < 0) h += 360
  return { l: L, c, h }
}

/** Scene NAMES that describe a retro machine or terminal rather than a colour.
 *  The name is the one signal a measured classifier cannot derive from the
 *  accent, so this list is explicit and closed: a scene is Terminal only if it
 *  is named here, and these are every name the rule claims. Eleven of the twelve
 *  categories are pure OKLCH rules; this is the single exception. */
const TERMINAL_SCENE_NAMES = new Set([
  'retro-terminal', 'retro-amber', 'retro-blue', 'amber-terminal',
  'green-screen', 'commodore-64', 'dark-lcars'
])

/**
 * The visible catalogue. Core is the default shelf: a fresh install shows the
 * thirty core skins, and enabling a pack adds that pack. When no skin carries a
 * pack the filter stays out of the way and every card shows.
 */
function filterByPacks(skins, enabledPacks) {
  const packsAvailable = skins.some(scene => scene && scene.pack)
  if (!packsAvailable) return skins
  const allowed = new Set(['core', ...(Array.isArray(enabledPacks) ? enabledPacks : [])])
  return skins.filter(scene => allowed.has(scene.pack || 'core'))
}

/** What the gallery says when nothing can be drawn.
 *
 *  Extracted so the branch is testable: the previous guard read a group count
 *  that the group builders never return as zero, so the pack-aware message was
 *  dead code and the plain one had been lost. This takes the two numbers that
 *  actually decide it. */
function emptyStateFor(visibleCount, hiddenByPacks) {
  if (visibleCount > 0) return null
  if (hiddenByPacks > 0) {
    return {
      title: 'No skins found',
      description: 'Nothing in the packs you have on matches. Turn a pack on above, or change the search.'
    }
  }
  return { title: 'No skins found', description: 'Try a different search.' }
}

const PACKS_KEY = 'chroma-packs-v1'
const PACK_TITLES = {
  earth: 'Earth', cyberpunk: 'Cyberpunk', zen: 'Zen',
  retro: 'Retro', noir: 'Noir', studio: 'Studio', core: 'Core'
}

/** The packs the user turned on. Never throws: a corrupt store means none. */
function readEnabledPacks() {
  try {
    const raw = window.localStorage.getItem(PACKS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) return parsed.filter(p => typeof p === 'string')
    if (parsed && Array.isArray(parsed.enabled)) return parsed.enabled.filter(p => typeof p === 'string')
    return []
  } catch { return [] }
}

/** Persist the choice. A full or blocked store must not break the click. */
function writeEnabledPacks(list) {
  try {
    window.localStorage.setItem(PACKS_KEY, JSON.stringify(Array.isArray(list) ? list : []))
  } catch { /* storage is a convenience, never a precondition */ }
}

/** Toggle one pack and persist the result in the same call.
 *
 *  This is the shipped path: the chip handler passes it straight to setEnabledPacks.
 *  Keeping the write here means a test can call the real function and see the
 *  store change - a test that only called writeEnabledPacks could stay green
 *  while the pane never wrote at all. */
function togglePackChoice(prev, pack) {
  const current = Array.isArray(prev) ? prev : []
  const next = current.includes(pack) ? current.filter(p => p !== pack) : current.concat(pack)
  writeEnabledPacks(next)
  return next
}

/** One broad category per scene - the "by theme" lens.
 *
 *  The catalogue stores the measured family, so a shipped skin is filed by its
 *  own `category`. This rule is the floor for a palette that arrives without one
 *  (an import, or an older saved theme):
 *   1. A scene that can serve only one mode goes to Light or Dark.
 *   2. The accent's chroma is read first: below 0.04 there is no hue to file, so
 *      the skin is Neutral.
 *   3. Otherwise the accent's hue picks the family, using the same cut points the
 *      catalogue was measured with (scripts/taxonomy.json).
 *
 *  Deterministic, so the grid is stable between renders. Never throws on a
 *  partial palette: an unreadable accent falls back to Neutral, not `undefined`. */
function sceneCategory(scene) {
  if (scene.modeSupport === 'dark') return 'dark'
  if (scene.modeSupport === 'light') return 'light'
  // Write once, never derive again: the catalogue stores the measured family on
  // the skin, and the runtime reads it. The rule below is only the floor for a
  // scene that arrives without one - an import, or an older saved theme.
  if (scene.category && MEASURED_CATEGORY_IDS.has(scene.category)) return scene.category
  const colors = scene.lightColors || scene.darkColors || scene.colors || {}
  const accent = oklch(colors.ui_accent || colors.banner_accent || colors.banner_title)
  if (!accent) return 'neutral'
  if (accent.c < 0.04) return 'neutral'
  // The same cut points the catalogue was measured with (scripts/taxonomy.json).
  // This path only runs for a palette that arrived without a stored category.
  const h = ((accent.h % 360) + 360) % 360
  const FAMILIES = [
    [2.8, 'persimmon'], [45.2, 'apricot'], [60, 'amber'], [78, 'gold'],
    [92, 'lemon'], [118, 'fern'], [156, 'teal'], [232, 'cobalt'],
    [256, 'indigo'], [278, 'violet'], [322, 'rose'],
  ]
  if (h >= 2.8 && h < 322) {
    for (let i = 0; i < FAMILIES.length - 1; i += 1) {
      if (h >= FAMILIES[i][0] && h < FAMILIES[i + 1][0]) return FAMILIES[i][1]
    }
  }
  return 'rose'
}

/** The same scenes, grouped by category. Empty groups are dropped by the caller,
 *  so a category with nothing in it costs no vertical space.
 *
 *  E4 — the twelve built-ins keep their ids, titles and order; USER categories
 *  render as shelves AFTER them, so the familiar shelf never moves under the
 *  user's feet. Membership follows effectiveCategory(): a skin the user filed
 *  under a user category leaves its measured shelf and lands in that one. The
 *  measured classifier is still the floor — a skin with no assignment lands
 *  where sceneCategory() puts it. `userCategories` is optional so every existing
 *  caller and test keeps its two-argument meaning. */
function buildCategoryGroups(scenes, userCategories) {
  const list = Array.isArray(userCategories) ? userCategories : []
  const builtins = THEME_CATEGORIES.map(category => ({
    id: category.id,
    title: category.title,
    builtin: true,
    scenes: scenes.filter(scene => effectiveCategory(scene, list) === category.id)
  }))
  const users = list
    .filter(category => category && typeof category.id === 'string' && category.id)
    .map(category => ({
      id: category.id,
      title: typeof category.title === 'string' && category.title ? category.title : category.id,
      builtin: false,
      scenes: scenes.filter(scene => effectiveCategory(scene, list) === category.id)
    }))
  return builtins.concat(users)
}

/** One entry point for both lenses, so the caller never branches on the mode. */
/** Sort by theme pack: the six shelves a skin can belong to, core first. Every
 *  skin carries exactly one pack, so the shelves partition the catalogue and
 *  never overlap. An unknown pack still gets a shelf rather than vanishing. */
function buildPackGroups(scenes) {
  const order = ['core'].concat(Object.keys(PACK_TITLES))
  const seen = Array.from(new Set(scenes.map(scene => (scene && scene.pack) || 'core')))
  const ids = seen.sort((a, b) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
  return ids.map(id => ({
    id: id,
    title: id === 'core' ? 'Core' : (PACK_TITLES[id] || (id.charAt(0).toUpperCase() + id.slice(1))),
    scenes: scenes.filter(scene => ((scene && scene.pack) || 'core') === id)
  }))
}

function buildGroups(scenes, groupMode, userCategories) {
  if (groupMode === 'theme') return buildCategoryGroups(scenes, userCategories)
  if (groupMode === 'pack') return buildPackGroups(scenes)
  return buildThemeGroups(scenes)
}

// ---------------------------------------------------------------------------
// Active-skin tracking + live discovery of skins applied elsewhere.
// `skin.changed` events carry the full palette of the newly active skin, so a
// skin installed after this plugin was built shows up as soon as it is applied.
// ---------------------------------------------------------------------------

function useActiveSkin() {
  const profile = useValue(host.state.profile) || 'default'
  const [active, setActive] = useState(() => sceneNameFor(readAppearance(profile).theme))
  const [live, setLive] = useState([])

  useEffect(() => {
    let mounted = true
    setActive(sceneNameFor(readAppearance(profile).theme))

    const root = document.documentElement
    const sync = () => {
      if (mounted && root.dataset.hermesTheme) setActive(sceneNameFor(root.dataset.hermesTheme))
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-hermes-theme'] })

    const off = host.onEvent('skin.changed', event => {
      if (!mounted) return
      const skin = event && event.payload
      const name = skin && skin.name
      if (!name) return
      // Live-discover skins outside the embedded catalog (freshly installed).
      if (!sceneForThemeName(name)) {
        setLive(prev => {
          if (prev.some(s => s.name === name)) return prev
          return [...prev, normalizeLiveSkin(skin)]
        })
      }
    })

    return () => {
      mounted = false
      observer.disconnect()
      off()
    }
  }, [profile])

  return [active, setActive, live]
}

function normalizeLiveSkin(skin) {
  const colors = (skin && skin.colors) || {}
  const isHex = v => typeof v === 'string' && /^#([0-9a-f]{6})$/i.test(v)
  const bg = isHex(colors.background) ? colors.background : isHex(colors.status_bar_bg) ? colors.status_bar_bg : ''
  const text = isHex(colors.banner_text) ? colors.banner_text : isHex(colors.ui_text) ? colors.ui_text : ''
  const isDark = bg ? luminance(bg) < 0.5 : text ? luminance(text) < 0.5 : true
  return {
    name: skin.name,
    label: skin.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    description: skin.description || 'Newly installed skin',
    category: 'New',
    source: 'live',
    modeSupport: isDark ? 'dark' : 'light',
    lightColors: isDark ? null : colors,
    darkColors: isDark ? colors : null,
    lightName: isDark ? null : skin.name,
    darkName: isDark ? skin.name : null,
    colors
  }
}

function gatewaySkinNameFor(scene, mode) {
  return mode === 'dark'
    ? scene.gatewayDarkName || scene.darkName || scene.name
    : scene.gatewayLightName || scene.lightName || scene.name
}

function persistLatestAppearance(profile) {
  const latest = latestAppearanceByProfile.get(profile)
  return latest ? persistAppearance(latest.scene.name, latest.mode, profile) : true
}

function snapshotPersistedAppearances() {
  const themes = readRecord(PROFILE_SKINS_KEY)
  const modes = readRecord(PROFILE_MODES_KEY)
  const profiles = new Set(['default', ...Object.keys(themes), ...Object.keys(modes)])
  const snapshot = new Map()
  for (const profile of profiles) {
    const appearance = readAppearance(profile)
    const scene = sceneForThemeName(appearance.theme)
    if (scene) snapshot.set(profile, { scene, mode: appearance.mode })
  }
  return snapshot
}

function syncSceneToGateway(scene, mode, profile, generation) {
  const skinName = gatewaySkinNameFor(scene, mode)
  const perform = async () => {
    if ((host.state.profile.get() || 'default') !== profile) return false
    // Scoped to this profile: do NOT broadcast. setTheme has already persisted
    // the pick into this profile, and config.set would write the one global
    // display.skin, pulling the CLI and every other machine along with it.
    if (readApplyScope(profile) === APPLY_SCOPE_LOCAL) return false
    // Capture every persisted profile before config.set can broadcast and let
    // Desktop overwrite the newly active profile with this request's alias.
    const recoveryAppearances = snapshotPersistedAppearances()
    try {
      await host.request('config.set', { key: 'skin', value: skinName })
      // The broadcast applies the concrete gateway variant in Desktop before
      // this RPC resolves. ThemeProvider may apply that concrete skin through
      // its stale internal mode (the SDK has no setMode), so restore the latest
      // combined scene both visibly and durably. A stale acknowledgement must
      // never overwrite or repaint over a newer rapid selection.
      const latest = latestAppearanceByProfile.get(profile)
      const activeProfile = host.state.profile.get() || 'default'
      const isActiveProfile = activeProfile === profile
      if (latest && isActiveProfile) {
        applyDesktopTheme(sceneToDesktopTheme(latest.scene), latest.mode)
        syncDesktopState(latest.scene.name, latest.mode)
      } else if (!isActiveProfile) {
        // config.set broadcasts before resolving, so this old-profile request
        // may have just repainted the profile the user switched into. Restore
        // that active profile from its own latest selection, never from the
        // completed request's old-profile map entry.
        const activeRecovery = latestAppearanceByProfile.get(activeProfile) ||
          recoveryAppearances.get(activeProfile) || recoveryAppearances.get('default')
        if (activeRecovery) {
          applyDesktopTheme(sceneToDesktopTheme(activeRecovery.scene), activeRecovery.mode)
          syncDesktopState(activeRecovery.scene.name, activeRecovery.mode)
          persistAppearance(activeRecovery.scene.name, activeRecovery.mode, activeProfile)
        }
      }
      const durable = persistLatestAppearance(profile)
      if (!durable && latestAppearanceByProfile.get(profile)?.generation === generation) {
        host.notify({
          kind: 'warning',
          message: `${scene.label || scene.name} synchronized, but its combined skin could not be saved for restart`
        })
      }
      return true
    } catch {
      const latest = latestAppearanceByProfile.get(profile)
      const isLatest = latest?.generation === generation
      const isActiveProfile = (host.state.profile.get() || 'default') === profile
      if (isLatest && isActiveProfile) {
        // An older queued request may already have broadcast and repainted the
        // root before this latest request failed. Reassert the user's latest
        // optimistic selection in the live Desktop as well as in persistence.
        applyDesktopTheme(sceneToDesktopTheme(latest.scene), latest.mode)
        syncDesktopState(latest.scene.name, latest.mode)
      }
      persistLatestAppearance(profile)
      if (isLatest && isActiveProfile) {
        host.notify({
          kind: 'warning',
          message: `${scene.label || scene.name} is active here, but the connected gateway could not apply "${skinName}"`
        })
      }
      return false
    }
  }
  const queued = gatewaySyncQueue.then(perform, perform)
  gatewaySyncQueue = queued.then(() => undefined, () => undefined)
  return queued
}

function applyScene(scene, mode, setActive, api) {
  const profile = host.state.profile.get() || 'default'
  const generation = ++applyGeneration
  latestAppearanceByProfile.set(profile, { generation, scene, mode })
  const theme = sceneToDesktopTheme(scene)
  const bootThemeSaved = CORE_DESKTOP_THEMES.has(scene.name) || persistThemesForBoot([theme])
  applyDesktopTheme(theme, mode)
  // Keep Desktop's own React state in step with the paint; otherwise its
  // provider repaints the previous theme on the next render and the switch
  // appears to revert (navigation, click, profile switch).
  syncDesktopState(scene.name, mode, api)
  const appearanceSaved = persistAppearance(scene.name, mode, profile)
  const persisted = bootThemeSaved && appearanceSaved
  haptic('tap')
  setActive(scene.name)
  if (!persisted) {
    host.notify({
      kind: 'warning',
      message: `${scene.label || scene.name} applied for this session but could not be saved for restart`
    })
  }
  return syncSceneToGateway(scene, mode, profile, generation)
}

// ---------------------------------------------------------------------------
// Picker UI (shared by the pane and the full page)
// ---------------------------------------------------------------------------

/**
 * Does this skin reach the CLI?
 *
 * A scene is gateway-wide when the build also emitted a transport skin for it
 * (gatewayLightName / gatewayDarkName). Those are exactly the scenes the picker
 * pushes through `config.set`, so the TUI and every connected Desktop follow the
 * change. A scene without them repaints this Desktop only.
 *
 * This is the distinction the whole plugin rests on, and until now nothing in
 * the UI said which was which.
 */
function isGatewayCapable(scene) {
  return !!(scene && (scene.gatewayLightName || scene.gatewayDarkName))
}

function CliBadge({ scene, localScope }) {
  const gateway = isGatewayCapable(scene)
  // The badge must never claim what the current scope suppresses. With a local
  // scope a gateway-capable scene does NOT reach the CLI, so it says so rather
  // than showing a `CLI` it will not honour.
  const reachesCli = gateway && !localScope
  const title = !gateway
    ? 'Desktop only — the CLI cannot use this theme'
    : localScope
      ? 'Gateway skin, but scope is "This profile" — the CLI will NOT follow until you switch to Everywhere'
      : 'Gateway skin — the CLI and every connected Desktop follow this theme'
  return jsx('span', {
    title,
    className: cn(
      'shrink-0 rounded px-1 text-[0.5rem] uppercase leading-4 tracking-wide',
      reachesCli ? 'text-(--ui-accent)' : 'text-(--ui-text-tertiary)'
    ),
    // The 15% accent fill is an inline colour: `bg-(--ui-accent)/15` is an
    // arbitrary-value utility the host's compiled stylesheet never generated.
    style: reachesCli ? { backgroundColor: 'color-mix(in srgb, var(--ui-accent) 15%, transparent)' } : undefined,
    children: reachesCli ? 'CLI' : gateway ? 'cli off' : 'desktop'
  })
}

/** How long a click-triggered preview holds before it reverts. */
const PREVIEW_MS = 10000

/** Seconds left on a preview, floored at zero and never negative. Pure, so the
 *  countdown can be asserted without a clock. */
function previewSecondsLeft(until, now) {
  if (!until) return 0
  return Math.max(0, Math.ceil((until - now) / 1000))
}

/** Display-only countdown. The picker owns the single revert timer; this only
 *  re-renders the pill it lives in, so a preview never re-renders the whole
 *  gallery. `previewTheme` repaints the entire app, which is why the previous
 *  hover-driven version made the page crawl. */
function PreviewCountdown({ until }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 250)
    return () => clearInterval(id)
  }, [])
  return jsx('span', { children: previewSecondsLeft(until, Date.now()) + 's' })
}

// The anatomy of a theme, six roles in reading order: the shell, the raised
// surface, the signature, the reading colour, the secondary text, the structure.
// Six is what a card can carry and still be read at a glance; more turns into
// confetti. The status signals are deliberately NOT here - every theme ships a
// green, an amber and a red, so they say nothing about the palette.
const STRIP_BANDS = [
  ['background'],
  ['status_bar_bg', 'completion_menu_bg'],
  ['ui_accent', 'banner_accent', 'banner_title'],
  ['ui_text', 'banner_text', 'status_bar_text'],
  ['banner_dim'],
  ['ui_border', 'banner_border', 'session_border']
]

// Exactly six colours, always, and a missing role is MIXED from the shell rather
// than repeated. The first version fell back to the accent, which painted four
// identical cream swatches down the dark row of `nous` - a preview of a theme
// nobody will ever see. Mixing background toward text is what the desktop theme
// engine itself does to fill the roles a skin omits (see SKIN_RAMP), so the
// swatch shows the anatomy the theme will actually have.
function paletteStrip(colors) {
  const first = (aliases) => {
    for (const key of aliases) {
      if (colors[key]) return colors[key]
    }
    return null
  }
  const band = (index, fallback) => first(STRIP_BANDS[index]) || fallback
  const background = band(0, '#888888')
  const shell = oklch(background)
  const text = band(3, shell && shell.l < 0.5 ? '#F2F2F2' : '#161616')
  const accent = band(2, text)
  return [
    background,
    // Surface, secondary text and structure are the roles a skin most often
    // omits; each is mixed from the shell at the weight the desktop ramp uses.
    band(1, mix(background, text, 0.06)),
    accent,
    text,
    band(4, mix(background, text, 0.45)),
    band(5, mix(background, text, 0.16))
  ]
}

// The card's hover title: what the theme is, and what it can do.
function cardTitle(scene, mode) {
  const support = scene.modeSupport === 'dynamic' ? mode + ' variant' : scene.modeSupport + ' only'
  return (scene.description || scene.name) + ' (' + support + ')'
}

// The colour block fills the card, and it is the only child of a circle: a
// rounded-full box does not clip its children, so anything else inside a circle
// would paint over the page background.
// The swatch matrix: a 2 x 6 grid, the light variant over the dark one, so a
// single card shows both halves of the pair it will actually apply. Orientation
// is FIXED - light above, dark below - so the eye learns the layout once and
// reads every card in the gallery the same way.
//
// Neither row is dimmed for the current mode. A preview exists to show the
// colours as they are, and the label already says which mode is live.
function ThemeCardPalette({ lightStrip, darkStrip, shape }) {
  const rows = [lightStrip, darkStrip]
  return jsx('div', {
    // `flex` IS REQUIRED: `flex-col` alone sets only flex-direction and leaves
    // the div a block, so its inline <span> children collapse to zero size and
    // the swatches paint nothing. The render harness cannot see layout — see
    // the flex-contract assertion in tests/theme-card.test.mjs.
    className: cn(
      'flex flex-col min-h-0 w-full flex-1 overflow-hidden',
      shape === 'circle' ? 'rounded-full' : 'rounded-[4px]'
    ),
    // The 1px hairline is a ring the host never generated (`ring-black/15`), so
    // it is an inline box-shadow the build cannot drop.
    style: { boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.15)' },
    children: rows.map((row, r) =>
      jsx('div', {
        key: r,
        // The hairline is the only chrome in the block: it separates light from
        // dark, so the pair reads as a pair and not as twelve loose swatches.
        className: cn('flex flex-row min-h-0 w-full flex-1', r === 1 && 'border-t'),
        // `border-black/25` has no rule in the host stylesheet; the colour is
        // inline, and only the top edge carries a width.
        style: r === 1 ? { borderColor: 'rgba(0, 0, 0, 0.25)' } : undefined,
        children: row.map((color, i) =>
          jsx('span', { key: i, className: 'min-w-0 flex-1', style: { backgroundColor: color } })
        )
      })
    )
  })
}

// The label row: the mode glyph, the skin's name, its CLI badge and, when the
// scene carries an override, the `edited` marker. Plus either the ACTIVE badge or
// the mode the skin supports. It sits INSIDE the card when the card has an edge
// to sit in, and BENEATH it when it does not (a circle).
function ThemeCardLabel({ scene, mode, active, localScope, showState, className, edited }) {
  const isActive = scene.name === active
  // Words, not glyphs. `⇄` / `☾` / `☀` are not in every font this pane may be
  // rendered with, and a missing glyph is an empty box on every card at once.
  // `Both` was noise: most of the catalogue is dynamic, so it repeated on every
  // card and pushed the name aside to say what the card already shows. Only a
  // single-mode skin carries a word now, because that is the exceptional case.
  const glyph = scene.modeSupport === 'dynamic' ? '' : (scene.modeSupport === 'dark' ? 'Dark' : 'Light')
  // `text-(--ui-warn)` is not in the host's compiled stylesheet, so the glyph
  // colour is inline: the one channel the build cannot drop.
  const modeStyle = { color: mode === 'dark' ? 'var(--ui-accent)' : 'var(--ui-warn)' }
  const support = scene.modeSupport === 'dynamic' ? mode : scene.modeSupport
  const bit = isActive
    ? jsx(Badge, { variant: 'outline', className: 'shrink-0 px-1 text-[0.5625rem] text-(--ui-accent)', children: 'ACTIVE' })
    : jsx('span', { className: 'shrink-0 text-[0.5625rem] uppercase tracking-wide text-(--ui-text-tertiary)', children: support })
  // The bits are built as a LIST rather than a fixed array with a hole in it: an
  // edited card must add one element, and a card without an override must digest
  // byte-for-byte as it did before the editor existed.
  const parts = [
    glyph ? jsx('span', { className: 'shrink-0 text-[0.6875rem] leading-none', style: modeStyle, children: glyph }) : null,
    jsx('span', { className: 'truncate text-[0.6875rem] font-medium', children: scene.label || scene.name.replace(/-/g, ' ') }),
    jsx(CliBadge, { scene, localScope })
  ]
  if (edited) {
    // Distinct from the future pack badge: this says what you are looking at is
    // not what shipped, which a user has to be able to see (§17.3.1).
    parts.push(jsx('span', {
      className: 'shrink-0 rounded px-1 text-[0.5rem] uppercase leading-4 tracking-wide',
      // `text-(--ui-warn)` has no host rule; the warning colour is inline.
      style: { color: 'var(--ui-warn)' },
      title: 'Edited: this card paints your override, not the shipped palette',
      children: 'edited'
    }))
  }
  const bits = jsxs('span', { className: 'flex min-w-0 items-center gap-1', children: parts })
  return jsxs('div', { className, children: showState ? [bits, bit] : bits })
}

// The preview pill sits visually INSIDE the square but is a DOM SIBLING of the
// card: the card is itself a button, and a button inside a button is invalid HTML.
// It reveals on hover (a CSS opacity change, not an app repaint) and on keyboard
// focus, so it is reachable without a pointer.
// Centred inside the card, not anchored to its bottom edge: a circle's bottom edge
// lies OUTSIDE the circle, so a bottom-anchored pill would poke out of the shape.
// Centring also keeps it clear of the label row.
const PREVIEW_PILL_CLASS = 'absolute inset-0 z-10 w-fit rounded-full border px-1.5 py-0.5 text-center text-[0.5rem] font-medium leading-tight backdrop-blur transition-opacity'
// Centring (`m-auto`), the intrinsic height (`h-fit`) and the width cap
// (`max-w-[calc(...)]`) are arbitrary values the host never generated; they are
// inline so the build cannot drop them.
const PREVIEW_PILL_STYLE = { margin: 'auto', height: 'fit-content', maxWidth: 'calc(100% - 0.5rem)' }
const PREVIEW_PILL_LIVE = 'border-(--ui-accent) bg-(--ui-bg-tertiary) text-(--ui-accent) opacity-100'
const PREVIEW_PILL_IDLE = 'border-white/30 bg-black/50 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100'

function ThemeCardPreviewPill({ scene, previewing, previewUntil, onPreview, onStopPreview }) {
  return jsx('button', {
    type: 'button',
    onClick: () => { if (previewing) onStopPreview(); else onPreview(scene) },
    title: previewing ? 'Stop the preview and go back to your theme' : 'Preview this theme for 10 seconds, then revert',
    className: cn(PREVIEW_PILL_CLASS, previewing ? PREVIEW_PILL_LIVE : PREVIEW_PILL_IDLE),
    style: PREVIEW_PILL_STYLE,
    children: previewing
      ? jsx(PreviewCountdown, { until: previewUntil })
      : 'Preview 10s'
  })
}

// The editor's door. A DOM SIBLING of the card for the same reason the pill is
// (a button inside a button is invalid HTML), and it rides the card's own
// positioning context. Hidden until hover, but ALWAYS in the DOM and reachable
// without a pointer: `focus-visible:` for the keyboard and `pointer-coarse:` for
// touch — the standing rule this project applies to hover-only affordances.
//
// It is anchored to the bottom edge, centred, rather than a corner: the label row
// owns the top of a square card and the caption owns the top of a circle, while
// the centre of the card belongs to the preview pill.
// A card action must be legible over ANY skin, and it must be legible when the
// host's stylesheet does not contain our utility class. It shipped twice as an
// empty white box: `bg-black/45` was never generated, so the button fell back to
// the host's default paint (white) while the label stayed white. Inline styles
// are the one channel the host cannot fail to apply, so the pill carries its own.
// Legible over ANY skin, and never invisible when the host's stylesheet lacks one
// of our utilities: inline paint, no build step in the way. Semi-transparent so
// the swatch under it still reads, opaque on hover so it can be hit.
const CARD_ACTION_STYLE = {
  background: 'rgba(0, 0, 0, 0.55)',
  color: '#ffffff',
  border: '1px solid rgba(255, 255, 255, 0.32)',
  backdropFilter: 'blur(2px)',
  opacity: 0.9
}
const EDIT_GEAR_CLASS = 'rounded px-2 py-0.5 text-[0.6875rem] font-semibold leading-5 transition-all shadow-sm'

// A starred pill reads as ON: the paint inverts. Same channel as the gear's own
// paint (inline, so no host stylesheet can discard it) with the two colours
// swapped, which is the one difference that survives any skin behind it.
const CARD_ACTION_STYLE_ON = {
  background: 'rgba(255, 255, 255, 0.92)',
  color: '#111111',
  border: '1px solid rgba(255, 255, 255, 0.55)',
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
  opacity: 1
}
const FAVORITE_CLASS = 'rounded px-1.5 py-0.5 text-[0.8125rem] leading-5 transition-transform shadow-sm'

/** The star. A Unicode glyph, not an icon font: the codicon face and the inline
 *  SVG both reached the field as an empty control, and a text star cannot. */
function ThemeCardFavorite({ scene, favorited, onToggleFavorite }) {
  return jsx('button', {
    type: 'button',
    onClick: () => onToggleFavorite(scene),
    title: favorited
      ? 'Remove this skin from your favourites'
      : 'Star this skin: it joins the favourites rail on the left',
    'aria-label': (favorited ? 'Remove ' : 'Add ') + (scene.label || scene.name) + ' favourites',
    'aria-pressed': favorited ? 'true' : 'false',
    className: FAVORITE_CLASS,
    style: favorited ? CARD_ACTION_STYLE_ON : CARD_ACTION_STYLE,
    children: favorited ? '\u2605' : '\u2606'
  })
}

function ThemeCardEditGear({ scene, onEdit }) {
  return jsx('button', {
    type: 'button',
    onClick: () => onEdit(scene),
    title: 'Edit this skin: recolour it and save your own override',
    'aria-label': 'Edit ' + (scene.label || scene.name),
    className: EDIT_GEAR_CLASS,
    style: CARD_ACTION_STYLE,
    // A label, not an icon. The codicon face is not loaded by every Desktop and
    // this app's JSX runtime does not paint namespaced SVG, so an icon either
    // arrived as an empty square or did not arrive at all. A word always arrives.
    children: 'Edit'
  })
}

// E2's card affordance (§6, task 1): a SECOND action beside the gear, offered
// for ANY scene — built-in or owned. A built-in's duplicate is the escape hatch
// §3 requires: it forks the EFFECTIVE palette (override ?? authored) into a new
// OWNED skin, so a shipped theme's colours can be edited without touching the
// shipped file (§17.1). It sits at the bottom-RIGHT so it never collides with
// the centred gear, and it carries the same keyboard/touch reachability rule
// (`focus-visible:` + `pointer-coarse:`) the gear carries.
const EDIT_DUPLICATE_CLASS = 'rounded px-2 py-0.5 text-[0.6875rem] font-semibold leading-5 transition-all shadow-sm'

function ThemeCardDuplicate({ scene, onDuplicate }) {
  return jsx('button', {
    type: 'button',
    onClick: () => onDuplicate(scene),
    title: 'Fork this skin into a new skin you own — the source file is untouched',
    'aria-label': 'Duplicate ' + (scene.label || scene.name),
    className: EDIT_DUPLICATE_CLASS,
    style: CARD_ACTION_STYLE,
    children: 'Fork'
  })
}

// The manage actions live OUTSIDE the card button, for the same reason the pill
// does. Only an owned skin has them, and only one mode shows at a time: renaming,
// confirming a delete, or the three actions themselves.
const MANAGE_ROW_CLASS = 'mt-1 flex items-center gap-1 text-[0.625rem]'
const MANAGE_BUTTON_CLASS = 'shrink-0 rounded border border-(--ui-stroke-secondary) px-1 py-0.5 focus-visible:outline focus-visible:outline-2'

function ThemeCardRename({ scene, draft, setDraft, managing, onRename, onCancel }) {
  return [
    jsx('input', {
      key: 'name',
      type: 'text',
      value: draft,
      onChange: e => setDraft(e.target.value),
      onKeyDown: e => {
        if (e.key === 'Enter') { onRename(scene.name, draft); onCancel() }
        if (e.key === 'Escape') { onCancel() }
      },
      className: 'min-w-0 flex-1 rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-1 py-0.5'
    }),
    jsx('button', {
      key: 'save',
      type: 'button',
      disabled: managing,
      onClick: () => { onRename(scene.name, draft); onCancel() },
      className: MANAGE_BUTTON_CLASS,
      children: managing ? 'Saving…' : 'Save'
    })
  ]
}

function ThemeCardDeleteConfirm({ scene, managing, onDelete, onCancel }) {
  return [
    jsx('span', { key: 'q', className: 'text-(--ui-text-tertiary)', children: 'Delete? It goes to the trash.' }),
    jsx('button', {
      key: 'yes',
      type: 'button',
      disabled: managing,
      onClick: () => { onDelete(scene.name); onCancel() },
      className: 'shrink-0 rounded border border-(--ui-stroke-secondary) px-1 py-0.5',
      // The destructive colour is inline: `text-(--ui-error)` has no host rule.
      style: { color: 'var(--ui-error)' },
      children: managing ? 'Deleting…' : 'Yes'
    }),
    jsx('button', {
      key: 'no',
      type: 'button',
      onClick: onCancel,
      className: MANAGE_BUTTON_CLASS,
      children: 'No'
    })
  ]
}

function ThemeCardManageButtons({ scene, onDelete, onRename, onExport, onStartRename, onStartConfirm, categories, currentCategory, onSetCategory }) {
  const builtin = builtinCategoryIds()
  const userCats = Array.isArray(categories) ? categories : []
  return [
    jsx('select', {
      key: 'category',
      value: currentCategory || '',
      onChange: e => onSetCategory(scene.name, e && e.target ? e.target.value : ''),
      title: 'File this skin under a category. Empty resets to its measured shelf.',
      'aria-label': 'Category for ' + (scene.label || scene.name),
      className: 'min-w-0 flex-1 rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-1 py-0.5 text-[0.625rem] text-(--ui-text-secondary)',
      children: [
        jsx('option', { key: 'measured', value: '', children: 'Measured shelf' }),
        builtin.map(id => jsx('option', { key: 'b-' + id, value: id, children: id })),
        userCats.map(cat => jsx('option', { key: 'u-' + cat.id, value: cat.id, children: cat.title || cat.id }))
      ]
    }),
    jsx('button', {
      key: 'export',
      type: 'button',
      onClick: () => onExport(scene.name),
      title: 'Save this skin as hand-editable YAML you can edit and re-import',
      className: MANAGE_BUTTON_CLASS,
      children: 'Export'
    }),
    jsx('button', {
      key: 'rename',
      type: 'button',
      onClick: () => onStartRename(scene),
      className: MANAGE_BUTTON_CLASS,
      children: 'Rename'
    }),
    jsx('button', {
      key: 'delete',
      type: 'button',
      onClick: onStartConfirm,
      className: MANAGE_BUTTON_CLASS,
      children: 'Delete'
    })
  ]
}

function ThemeCardActions({ scene, managing, onDelete, onRename, onExport, categories, onSetCategory }) {
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [draft, setDraft] = useState('')
  const startRename = (target) => { setDraft(target.name); setRenaming(true) }
  const stopRenaming = () => setRenaming(false)
  const stopConfirming = () => setConfirming(false)
  const currentCategory = effectiveCategory(scene, categories)
  const body = renaming
    ? jsx(ThemeCardRename, { scene, draft, setDraft, managing, onRename, onCancel: stopRenaming })
    : (confirming
      ? jsx(ThemeCardDeleteConfirm, { scene, managing, onDelete, onCancel: stopConfirming })
      : jsx(ThemeCardManageButtons, { scene, onDelete, onRename, onExport, onStartRename: startRename, onStartConfirm: () => setConfirming(true), categories, currentCategory, onSetCategory }))
  return jsxs('div', { className: MANAGE_ROW_CLASS, children: body })
}

// ---------------------------------------------------------------------------
// The editor (§6, §17): the colour input, the six role rows and the modal.
//
// The host UI kit has NO free-form colour input — only a fixed ColorSwatches
// grid — so the control is hand-rolled here: a styled swatch over a hidden
// native <input type="color">, plus a free-text hex field. No HSV picker in E1.
//
// The dialog is an IN-PANE OVERLAY, not the SDK's Radix Dialog. The SDK does
// export Dialog, but Dialog needs a mounted React tree and a portal of its own,
// and this pane renders inside the picker's tree; an overlay keeps the editor in
// that same tree, adds no import the plugin contract has to grow for, and stays
// visible to the DOM-contract tests — the same reason the preview pill and the
// strip are plain host elements.
// ---------------------------------------------------------------------------

/** The three advisory contrast targets the port uses (§6): body text 9:1,
 *  interface chrome 3:1, status signals 4.5:1. WCAG 2.2, as the host speaks it;
 *  APCA is deliberately not adopted in E1 (§18.3). */
const ADVICE_TARGETS = [
  { id: 'text', label: 'Text', target: 9, hint: 'body text on its shell' },
  { id: 'interface', label: 'Interface', target: 3, hint: 'chrome, borders and signature surfaces' },
  { id: 'signals', label: 'Signals', target: 4.5, hint: 'status colours: shipped per skin, not editable in E1' }
]

/** A role's advisory target, from its kind. Same table as the strip above, so a
 *  role cannot carry a target the legend does not show. */
function adviceTarget(role) {
  for (const item of ADVICE_TARGETS) {
    if (item.id === role.kind) return item.target
  }
  return ADVICE_TARGETS[0].target
}

/** The six editable roles, in the strip's reading order, each naming the SAME
 *  alias chain paletteStrip() reads (STRIP_BANDS) so a row and the preview can
 *  never disagree about which key a role is.
 *
 *  The chain's FIRST key must be the one the palette engine reads first
 *  (skinSeeds / skinPalette). Two roles shipped with the order reversed: they
 *  wrote `banner_text` and `status_bar_bg` while the engine reads `ui_text` and
 *  `background`, so the row, the strip and the save all moved and the applied
 *  theme did not. `tests/editor-role-application.test.mjs` now pins the seam.
 *
 *  `kind` picks the advisory target. `against` names the colour the read-out is
 *  measured against: every role is read against the shell, and the shell itself
 *  against its own text — its contrast with itself is 1:1 by definition and
 *  would say nothing. */
// The six headline roles are how a skin is usually thought about and they carry
// the advisory readouts. They are NOT the whole palette: a full skin holds 43
// named colours and a ported half holds 27. Every one of them is editable below,
// grouped, because "which colour am I editing" must never be answered with
// "the editor does not have that one".
const EDITOR_ROLES = [
  { id: 'shell', group: 'Core', label: 'Shell', hint: 'the base every other role is read against', keys: ['background'], kind: 'interface', against: 'text' , desktop: true },
  { id: 'surface', group: 'Core', label: 'Surface', hint: 'raised bars, menus, cards', keys: ['status_bar_bg', 'completion_menu_bg'], kind: 'interface', against: 'shell' , desktop: true },
  { id: 'signature', group: 'Core', label: 'Signature', hint: 'accent surfaces and highlights', keys: ['ui_accent', 'banner_accent', 'banner_title'], kind: 'interface', against: 'shell' , desktop: true },
  { id: 'text', group: 'Core', label: 'Text', hint: 'the reading colour', keys: ['ui_text', 'banner_text', 'status_bar_text'], kind: 'text', against: 'shell' , desktop: true },
  { id: 'dim', group: 'Core', label: 'Dim text', hint: 'secondary and muted labels', keys: ['banner_dim'], kind: 'text', against: 'shell' , desktop: true },
  { id: 'structure', group: 'Core', label: 'Structure', hint: 'borders and dividers', keys: ['ui_border', 'banner_border', 'session_border'], kind: 'interface', against: 'shell' , desktop: true },
  { id: 'completion_menu_current_bg', group: 'Menus', label: 'Menu selection', hint: 'the highlighted row in a menu', keys: ['completion_menu_current_bg'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'completion_menu_meta_bg', group: 'Menus', label: 'Menu meta', hint: 'the meta strip under a menu row', keys: ['completion_menu_meta_bg'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'completion_menu_meta_current_bg', group: 'Menus', label: 'Menu meta selection', hint: 'the meta strip on the highlighted row', keys: ['completion_menu_meta_current_bg'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'selection_bg', group: 'Menus', label: 'Text selection', hint: 'selected text in the transcript', keys: ['selection_bg'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'voice_status_bg', group: 'Menus', label: 'Voice bar', hint: 'the voice input bar surface', keys: ['voice_status_bg'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'ui_label', group: 'Text', label: 'Labels', hint: 'small interface labels', keys: ['ui_label'], kind: 'text', against: 'shell' , desktop: false },
  { id: 'status_bar_dim', group: 'Text', label: 'Status dim', hint: 'secondary status bar text', keys: ['status_bar_dim'], kind: 'text', against: 'shell' , desktop: false },
  { id: 'status_bar_strong', group: 'Text', label: 'Status strong', hint: 'emphasised status bar text', keys: ['status_bar_strong'], kind: 'text', against: 'shell' , desktop: false },
  { id: 'session_label', group: 'Text', label: 'Session label', hint: 'the session name in the header', keys: ['session_label'], kind: 'text', against: 'shell' , desktop: false },
  { id: 'prompt', group: 'Text', label: 'Prompt', hint: 'the input prompt mark', keys: ['prompt'], kind: 'text', against: 'shell' , desktop: false },
  { id: 'shell_dollar', group: 'Text', label: 'Shell mark', hint: 'the shell prompt glyph', keys: ['shell_dollar'], kind: 'text', against: 'shell' , desktop: false },
  { id: 'ui_ok', group: 'State', label: 'OK', hint: 'success', keys: ['ui_ok'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'ui_warn', group: 'State', label: 'Warning', hint: 'caution', keys: ['ui_warn'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'ui_error', group: 'State', label: 'Error', hint: 'failure', keys: ['ui_error'], kind: 'interface', against: 'shell' , desktop: true },
  { id: 'ui_thinking', group: 'State', label: 'Thinking', hint: 'the reasoning indicator', keys: ['ui_thinking'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'ui_tool', group: 'State', label: 'Tool', hint: 'the tool-call accent', keys: ['ui_tool'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'status_bar_good', group: 'State', label: 'Status good', hint: 'status bar, healthy', keys: ['status_bar_good'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'status_bar_warn', group: 'State', label: 'Status warn', hint: 'status bar, warning', keys: ['status_bar_warn'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'status_bar_bad', group: 'State', label: 'Status bad', hint: 'status bar, failure', keys: ['status_bar_bad'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'status_bar_critical', group: 'State', label: 'Status critical', hint: 'status bar, critical', keys: ['status_bar_critical'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'syntax_comment', group: 'Syntax', label: 'Comment', hint: 'code comments', keys: ['syntax_comment'], kind: 'text', against: 'shell' , desktop: false },
  { id: 'syntax_keyword', group: 'Syntax', label: 'Keyword', hint: 'language keywords', keys: ['syntax_keyword'], kind: 'text', against: 'shell' , desktop: false },
  { id: 'syntax_number', group: 'Syntax', label: 'Number', hint: 'numeric literals', keys: ['syntax_number'], kind: 'text', against: 'shell' , desktop: false },
  { id: 'syntax_string', group: 'Syntax', label: 'String', hint: 'string literals', keys: ['syntax_string'], kind: 'text', against: 'shell' , desktop: false },
  { id: 'diff_added', group: 'Diffs', label: 'Added line', hint: 'an added line', keys: ['diff_added'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'diff_added_word', group: 'Diffs', label: 'Added word', hint: 'the changed word in an added line', keys: ['diff_added_word'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'diff_removed', group: 'Diffs', label: 'Removed line', hint: 'a removed line', keys: ['diff_removed'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'diff_removed_word', group: 'Diffs', label: 'Removed word', hint: 'the changed word in a removed line', keys: ['diff_removed_word'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'response_border', group: 'Framing', label: 'Response frame', hint: 'the border around a response', keys: ['response_border'], kind: 'interface', against: 'shell' , desktop: false },
  { id: 'input_rule', group: 'Framing', label: 'Input rule', hint: 'the rule above the composer', keys: ['input_rule'], kind: 'interface', against: 'shell' , desktop: false },
]

/** The first present value among `keys`, else ''. A row shows what the palette
 *  actually holds, so a role a thin skin omits is an empty field with a `—`
 *  read-out rather than an invented colour. */
function firstColorIn(colors, keys) {
  for (const key of keys) {
    const value = colors ? colors[key] : null
    if (typeof value === 'string' && value) return value
  }
  return ''
}

/** One mode's authored palette: a scene carries lightColors/darkColors, and a
 *  single-mode scene carries `colors` instead. Same chain the card uses. */
function sceneModePalette(scene, modeKey) {
  if (!scene) return {}
  if (modeKey === 'dark') return scene.darkColors || scene.colors || {}
  return scene.lightColors || scene.colors || {}
}

/** EFFECTIVE palette = override ?? authored (§17.1), per mode, merged role by
 *  role onto a COPY. The authored scene object is never mutated, and the
 *  classifier is never handed the result — see groupCards(). */
function applyOverride(scene, overrides) {
  const record = scene && overrides ? overrides[scene.name] : null
  if (!record || typeof record !== 'object') return scene
  const next = safeMerge(scene)
  const light = record.light && typeof record.light === 'object' ? record.light : null
  const dark = record.dark && typeof record.dark === 'object' ? record.dark : null
  if (light) {
    next.lightColors = safeMerge(scene.lightColors || scene.colors || {}, light)
    next.colors = next.lightColors
  }
  if (dark) {
    next.darkColors = safeMerge(scene.darkColors || scene.colors || {}, dark)
    if (!light) next.colors = next.darkColors
  }
  // E5 — typography rides the same override record. A font-only override is
  // valid: the record may carry `typography` with no `light`/`dark` keys.
  const typo = record.typography && typeof record.typography === 'object' ? record.typography : null
  if (typo) {
    next.typography = safeMerge(next.typography || {}, typo)
  }
  return next
}

/** The gallery's groups: CLASSIFY the authored catalogue, RENDER the effective
 *  palette (§17.3.2 — the shelf does not move). buildGroups() measures category
 *  from the scene it is handed, so a resolved list would re-file a card the
 *  moment its accent changed. Grouping runs on the authored list; the override
 *  is layered on afterwards, per card. */
function groupCards(scenes, overrides, groupMode, userCategories) {
  return buildGroups(scenes, groupMode, userCategories).map(group => safeMerge(group, {
    scenes: group.scenes.map(scene => applyOverride(scene, overrides))
  }))
}

/** A draft: one value per role, from the palette's own chain, '' when absent. */
function draftFromPalette(palette) {
  const draft = {}
  for (const role of EDITOR_ROLES) draft[role.id] = firstColorIn(palette, role.keys)
  return draft
}

function draftForScene(scene, modeKey) {
  return draftFromPalette(sceneModePalette(scene, modeKey))
}

/** Two drafts for the SAME mode are equal when every role normalises to the
 *  same colour, so a three-digit entry and its six-digit twin are not a change,
 *  and '' and a missing role are the same absence.
 *
 *  One mode at a time, deliberately: the modal keeps a light draft and a dark
 *  draft as separate state, and a comparator that took the whole nested shape
 *  would answer "equal" for two flat drafts that disagree (nothing to look up,
 *  nothing to find). */
/** Save is offered always, enabled only when the draft differs from what is
 *  stored. Saving an untouched palette pins the shipped colours as an override,
 *  so a later catalogue fix would never reach that skin. */
function saveDisabled(dirty, busy) {
  return Boolean(busy) || !dirty
}

function modeDraftEqual(a, b) {
  for (const role of EDITOR_ROLES) {
    const av = a ? a[role.id] : ''
    const bv = b ? b[role.id] : ''
    if (normaliseHex(av) !== normaliseHex(bv)) return false
  }
  return true
}

/** A draft painted as a palette: the effective palette with every role's PRIMARY
 *  key replaced. Never a later alias — a palette that carries only
 *  `banner_accent` would otherwise keep painting the authored `ui_accent` the
 *  strip reads first, and the preview would ignore the edit. */
function draftPalette(scene, modeKey, draftRoles) {
  const colors = safeMerge(sceneModePalette(scene, modeKey))
  for (const role of EDITOR_ROLES) {
    const hex = normaliseHex(draftRoles ? draftRoles[role.id] : '')
    if (hex) colors[role.keys[0]] = hex
  }
  return colors
}

/** The body of a PUT /overrides/{scene} (and the same skin-keyed palette for
 *  PUT /skins/{name}): primary skin key per role, per mode. Empty roles are
 *  omitted rather than sent as '' — an override records what the user set, not
 *  what they cleared.
 *
 *  The mode list comes from /schema when the editor has it (§19.2 item 1), so
 *  the pane writes the modes the backend actually speaks; the two are the same
 *  pair today, and reading it is what stops them drifting apart silently. */
function overridePayload(draft, modes) {
  const out = { light: {}, dark: {} }
  const keys = Array.isArray(modes) && modes.length ? modes : ['light', 'dark']
  for (const modeKey of keys) {
    for (const role of EDITOR_ROLES) {
      const hex = normaliseHex(draft && draft[modeKey] ? draft[modeKey][role.id] : '')
      if (hex) out[modeKey][role.keys[0]] = hex
    }
  }
  // E5 — typography keys ride the same payload. Only the keys the user set
  // are included; a font-only override carries no light/dark.
  if (draft && draft.typography && typeof draft.typography === 'object') {
    const t = draft.typography
    if (typeof t.fontSans === 'string' && t.fontSans) {
      if (!out.typography) out.typography = {}
      out.typography.fontSans = t.fontSans
    }
    if (typeof t.fontMono === 'string' && t.fontMono) {
      if (!out.typography) out.typography = {}
      out.typography.fontMono = t.fontMono
    }
  }
  return out
}

/** WCAG 2.2 contrast as a read-out: the plugin's OWN contrastRatio (§16.4 — the
 *  two are algebraically identical, so a second implementation is a second thing
 *  to drift), with exactly one host convention adopted: NULL for a colour that
 *  will not parse. relativeLuminance() answers 0 for unreadable input, which
 *  would print a confident, meaningless ratio; the read-out must render `—`. */
function contrastReadout(a, b) {
  const ha = normaliseHex(a)
  const hb = normaliseHex(b)
  if (!ha || !hb) return null
  return contrastRatio(ha, hb)
}

/** One colour control: a styled swatch, a hidden native <input type="color"> and
 *  a free-text hex field. The swatch is the label FOR the native input, so a
 *  click or a tap opens the platform picker; the text field is the keyboard
 *  path, and a value normaliseHex cannot read is marked invalid and NOT
 *  committed, so a half-typed hex never reaches the palette or the save. */
function ColorField({ id, value, label, onChange }) {
  const [draft, setDraft] = useState(typeof value === 'string' ? value : '')
  const hex = normaliseHex(value)
  const invalid = draft.trim().length > 0 && !normaliseHex(draft)
  const change = raw => {
    setDraft(raw)
    const next = normaliseHex(raw)
    if (next) onChange(next)
  }
  const commit = () => {
    const next = normaliseHex(draft)
    if (next) onChange(next)
  }
  return jsxs('span', { className: 'flex min-w-0 flex-1 items-center gap-1', children: [
    jsxs('label', {
      className: 'relative inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded',
      title: label,
      children: [
        jsx('input', {
          id: id ? id + '-color' : undefined,
          type: 'color',
          value: hex || '#000000',
          onChange: event => change(event && event.target ? event.target.value : ''),
          // Visually hidden but NOT display:none and not off-screen: it has to
          // stay focusable, since it is the keyboard path to the platform picker.
          className: 'absolute inset-0 h-full w-full cursor-pointer opacity-0',
          'aria-label': label
        }),
        jsx('span', {
          className: 'pointer-events-none h-5 w-5 rounded border border-(--ui-stroke-secondary)',
          // The error border colour is inline: `border-(--ui-error)` has no host rule.
          style: invalid
            ? { borderColor: 'var(--ui-error)', backgroundColor: hex }
            : (hex ? { backgroundColor: hex } : undefined)
        })
      ]
    }),
    jsx('input', {
      id: id ? id + '-hex' : undefined,
      type: 'text',
      value: draft,
      spellCheck: false,
      placeholder: '#rrggbb',
      'aria-label': label + ' hex',
      'aria-invalid': invalid ? 'true' : 'false',
      title: invalid ? 'Not a hex colour — try #rrggbb' : label,
      onChange: event => change(event && event.target ? event.target.value : ''),
      onBlur: commit,
      onKeyDown: event => { if (event && event.key === 'Enter') commit() },
      className: 'min-w-0 w-full flex-1 rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-1 py-0.5 font-mono text-[0.625rem]',
      // The error border colour is inline, not a utility the host must generate.
      style: invalid ? { borderColor: 'var(--ui-error)' } : undefined
    })
  ]})
}

/** A role's read-out. ADVISORY, never blocking (§6, §18.3): a role below its
 *  target is marked, not refused — it is the user's skin. */
function ContrastChip({ ratio, target, label }) {
  const measured = typeof ratio === 'number' && isFinite(ratio)
  const text = measured ? ratio.toFixed(2) + ':1' : '—'
  const below = measured && ratio < target
  const title = measured
    ? label + ': ' + text + (below ? ' — below the ' + target + ':1 advisory target' : ' — meets the ' + target + ':1 advisory target')
    : label + ': not a colour that can be measured'
  return jsx('span', {
    title,
    className: cn('shrink-0 rounded px-1 font-mono text-[0.5625rem] leading-4', below ? null : 'text-(--ui-text-tertiary)'),
    // Warning colour and its 15% fill are inline: neither utility is generated
    // by the host's compiled stylesheet.
    style: below ? {
      color: 'var(--ui-warn)',
      backgroundColor: 'color-mix(in srgb, var(--ui-warn) 15%, transparent)'
    } : undefined,
    children: text
  })
}

// `bg-black/50` is missing from the host's stylesheet too, so the scrim is inline.
const EDITOR_OVERLAY_CLASS = 'fixed inset-0 z-50 flex items-start justify-center p-4'
/** The opaque surface a dialog sits on, as a real colour.
 *
 *  Two attempts failed before this one. `bg-(--ui-bg-secondary)` resolved to
 *  nothing in the overlay's context, so the editor read straight through to the
 *  gallery; `var(--card, #1b1f27)` then resolved to its fallback, and the panel
 *  went black. A CSS variable is a promise about a scope we do not own. A colour
 *  computed from the skin being edited cannot fail, and it is the honest one:
 *  the editor wears the skin it is editing. */
function sheetSurface(scene, mode) {
  try {
    const theme = scene ? sceneToDesktopTheme(scene) : null
    const palette = theme ? (mode === 'dark' ? theme.darkColors : theme.colors) : null
    const colour = palette && (palette.card || palette.background)
    if (typeof colour === 'string' && /^#[0-9a-f]{6}$/i.test(colour)) return colour
  } catch (e) {
    // A malformed skin must not stop the editor opening.
  }
  return '#20232b'
}
// Wider than it is tall, on a 4px rhythm, so a 43-colour palette reads as a
// list and not as a scroll bar with a clipboard attached.
// The height cap and the width are NOT here: they are inline styles on the sheet.
// `max-h-[87vh]` and `w-[min(94vw,64rem)]` are arbitrary-value utilities, and the
// host's compiled stylesheet does not contain them — the host's own source never
// used those literals — so the cap silently did not apply and the dialog ran off the
// viewport, unscrollable. scripts/check-host-classes.py reports the class of defect.
const EDITOR_SHEET_CLASS = 'mt-4 flex max-w-none flex-col gap-3 rounded-xl border border-(--ui-stroke-secondary) p-4 shadow-2xl'
const EDITOR_PREVIEW_CLASS = 'flex w-full shrink-0 overflow-hidden rounded-lg'
const EDITOR_ROW_CLASS = 'flex items-center gap-2 rounded px-1 py-[3px] transition-colors'
const EDITOR_ACTION_CLASS = 'shrink-0 rounded border border-(--ui-stroke-secondary) px-2 py-0.5 text-[0.625rem] disabled:opacity-50'
const EDITOR_SAVE_CLASS = 'shrink-0 rounded border border-(--ui-accent) px-2 py-0.5 text-[0.625rem] font-medium text-(--ui-accent) disabled:opacity-50'
/** The save button's 15% accent fill, and the preview's fixed height and 1px
 *  hairline: arbitrary-value utilities (`bg-(--ui-accent)/15`, `h-16`,
 *  `ring-black/20`) the host's stylesheet never generated, so they are inline. */
const EDITOR_SAVE_STYLE = { backgroundColor: 'color-mix(in srgb, var(--ui-accent) 15%, transparent)' }
const EDITOR_PREVIEW_STYLE = { height: '4rem', boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.2)' }
// The fork affordance of §18.3 (`Update "<name>"` / separator / `Save as new`) is
// OMITTED from E1, not rendered disabled: it needs POST /skins/duplicate, which
// is E2 and is not mounted, and a disabled control for a route that cannot
// arrive in this build is noise. The reason is carried by the sentence in the
// actions row instead.
const OWNED_SAVE_REASON = 'Rewrite your own skin file in place — this is not an override of a shipped palette'

/** One role across both modes: the label, then a light and a dark cell, each
 *  with the colour input and its own contrast read-out against that mode's
 *  shell. */
// A font is a CHOICE, not a sentence to type. These are the stacks the engine can
// name without shipping a font file; a skin that already carries something else
// keeps it, listed as its own option under its family name.
const FONT_CHOICES_SANS = [
  { label: 'Skin default', value: 'default' },
  { label: 'System UI', value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { label: 'Inter', value: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif' },
  { label: 'Segoe UI', value: '"Segoe UI", system-ui, Roboto, sans-serif' },
  { label: 'Helvetica Neue', value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: 'IBM Plex Sans', value: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif' },
  { label: 'Space Grotesk', value: '"Space Grotesk", "Segoe UI", system-ui, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, Tahoma, sans-serif' }
]

const FONT_CHOICES_MONO = [
  { label: 'Skin default', value: 'default' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", ui-monospace, Consolas, monospace' },
  { label: 'Cascadia Code', value: '"Cascadia Code", "Cascadia Mono", Consolas, monospace' },
  { label: 'Fira Code', value: '"Fira Code", Consolas, ui-monospace, monospace' },
  { label: 'IBM Plex Mono', value: '"IBM Plex Mono", Consolas, ui-monospace, monospace' },
  { label: 'Consolas', value: 'Consolas, "Courier New", ui-monospace, monospace' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'System mono', value: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }
]

/** The option list for a stack that is already set but not on the short list. */
function fontChoicesWith(current, choices) {
  const empty = !current || current === 'default'
  if (empty || choices.some(choice => choice.value === current)) return choices
  const family = String(current).split(',')[0].replace(/["']/g, '').trim()
  return choices.concat([{ label: 'Custom: ' + family, value: current }])
}

function FontSelect({ label, hint, value, choices, onChange }) {
  const current = value || 'default'
  const options = fontChoicesWith(current, choices)
  return jsxs('div', { className: 'flex items-center gap-2', children: [
    jsx('span', {
      key: 'l',
      title: hint,
      className: 'w-16 shrink-0 text-[0.625rem] text-(--ui-text-secondary)',
      children: label
    }),
    jsx(Select, {
      key: 's',
      value: current,
      onValueChange: next => onChange(next === 'default' ? '' : next),
      children: [
        jsx(SelectTrigger, {
          key: 't',
          className: 'h-7 min-w-0 flex-1 text-[0.625rem]',
          'aria-label': label + ' font',
          children: jsx(SelectValue, {})
        }),
        jsx(SelectContent, {
          key: 'c',
          children: options.map(option => jsx(SelectItem, {
            key: option.value,
            value: option.value,
            children: option.label
          }))
        })
      ]
    }),
    jsx('span', {
      key: 'p',
      'aria-hidden': 'true',
      title: 'A sample in this font',
      className: 'w-8 shrink-0 text-center text-[0.6875rem] text-(--ui-text-tertiary)',
      style: { fontFamily: value || undefined },
      children: 'Aa'
    })
  ]})
}

/** One row per role, with a heading whenever the group changes. The heading is a
 *  row of its own so the list stays a flat scrollable column. */
function editorRoleNodes(draft, onChange, shells, texts) {
  const nodes = []
  let group = null
  for (const role of EDITOR_ROLES) {
    if (role.group !== group) {
      group = role.group
      nodes.push(jsxs('div', {
        key: 'group-' + group,
        className: 'mt-2 flex items-center gap-2 pt-1 first:mt-0',
        children: [
          jsx('span', { key: 't', className: 'text-[0.5625rem] font-semibold uppercase tracking-[0.08em] text-(--ui-text-tertiary)', children: group }),
          jsx('span', { key: 'r', className: 'h-px flex-1 bg-(--ui-stroke-secondary)' })
        ]
      }))
    }
    nodes.push(jsx(EditorRoleRow, {
      key: role.id,
      role,
      draft,
      onChange,
      shells,
      texts
    }))
  }
  return nodes
}

function EditorRoleRow({ role, draft, onChange, shells, texts }) {
  const cell = (modeKey) => {
    const value = draft[modeKey][role.id]
    const against = role.against === 'text' ? texts[modeKey] : shells[modeKey]
    return jsxs('div', {
      key: modeKey,
      className: 'flex min-w-0 flex-1 items-center gap-1',
      children: [
        jsx('span', {
          className: 'w-3 shrink-0 text-center text-[0.625rem] text-(--ui-text-tertiary)',
          'aria-hidden': 'true',
          children: modeKey === 'light' ? '☀' : '☾'
        }),
        jsx(ColorField, {
          id: 'chroma-edit-' + modeKey + '-' + role.id,
          label: role.label + ' in ' + modeKey + ' mode',
          value,
          onChange: next => onChange(modeKey, role.id, next)
        }),
        jsx(ContrastChip, {
          label: role.label + ' against ' + (role.against === 'text' ? 'its text' : 'the shell') + ' (' + modeKey + ')',
          target: adviceTarget(role),
          ratio: contrastReadout(value, against)
        })
      ]
    })
  }
  return jsxs('div', {
    className: EDITOR_ROW_CLASS,
    'data-role': role.id,
    children: [
      jsxs('div', { className: 'w-24 shrink-0 pt-0.5', children: [
        jsxs('div', { className: 'flex items-center gap-1', children: [
          jsx('div', { key: 'l', className: 'font-medium leading-4', children: role.label }),
          // Truth in the row: this window paints a subset of the palette, and a
          // colour this window does not read still reaches the CLI's skins.
          role.desktop === false
            ? jsx('span', {
                key: 'cli',
                title: 'The CLI paints with this colour. This window previews a subset of the palette, so an edit here is saved without repainting the editor.',
                className: 'rounded border border-(--ui-stroke-secondary) px-1 text-[0.5rem] leading-tight text-(--ui-text-tertiary)',
                children: 'CLI'
              })
            : null
        ]}),
        jsx('div', { className: 'text-[0.5625rem] leading-tight text-(--ui-text-tertiary)', children: role.hint })
      ]}),
      cell('light'),
      cell('dark')
    ]
  })
}

/** The editor. Its five zones, in order: header, the 2 x 6 preview matrix, the
 *  six role rows, the advisory strip, the actions.
 *
 *  The draft is local state and the BASELINE is derived from the overrides it is
 *  handed, so `dirty` recomputes after a successful save (the picker re-lists
 *  the overrides) and cannot be cleared by a FAILED one — nothing about the
 *  draft is touched unless the write actually landed. The picker re-seeds the
 *  fields after a Reset by remounting this element under a new key. */
/** The pack's display name, with the same fallback the pane uses. */
function packTitleOf(id) {
  return PACK_TITLES[id] || (id.charAt(0).toUpperCase() + id.slice(1))
}

/** A modal shell: the same overlay and the same opaque sheet the editor uses, so
 *  every dialog in the plugin looks and behaves alike. Escape and a click on the
 *  backdrop close it; the header always carries a real Close button. */
function ModalShell({ title, subtitle, surface, onClose, children }) {
  return jsx('div', {
    className: EDITOR_OVERLAY_CLASS,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
    onClick: event => { if (event && event.target === event.currentTarget && onClose) onClose() },
    onKeyDown: event => { if (event && event.key === 'Escape' && onClose) onClose() },
    children: jsxs('div', {
      className: EDITOR_SHEET_CLASS,
      style: { backgroundColor: surface || '#20232b' },
      children: [
        jsxs('div', { key: 'head', className: 'flex shrink-0 items-start justify-between gap-2 border-b border-(--ui-stroke-secondary) pb-2', children: [
          jsxs('div', { className: 'min-w-0', children: [
            jsx('div', { className: 'truncate text-sm font-semibold', children: title }),
            subtitle ? jsx('div', { className: 'text-[0.625rem] text-(--ui-text-tertiary)', children: subtitle }) : null
          ]}),
          jsx('button', {
            key: 'close',
            type: 'button',
            onClick: onClose,
            title: 'Close (Escape)',
            'aria-label': 'Close ' + title,
            className: EDITOR_ACTION_CLASS,
            children: '✕'
          })
        ]}),
        jsx('div', { key: 'body', className: 'min-h-0 overflow-y-auto', children })
      ]
    })
  })
}

/** Which packs the gallery shows. The chips lived in a strip under the search
 *  field and ate the pane; the rule did not change, only where it is set. */
function PackPickerModal({ packIds, packTotals, enabledPacks, hidden, onToggle, surface, management, onClose }) {
  const [managing, setManaging] = useState(false)
  return jsx(ModalShell, {
    title: 'Theme packs',
    subtitle: 'Core is always on. A pack adds its own skins; nothing is deleted.',
    surface,
    onClose,
    children: jsxs('div', { className: 'flex flex-col gap-1.5', children: [
      jsx('div', {
        key: 'core',
        className: 'flex items-center justify-between gap-2 rounded border border-(--ui-accent) px-2 py-1 text-[0.6875rem]',
        children: [
          jsx('span', { className: 'flex items-center gap-1', children: [
            jsx('span', { children: '✓' }),
            jsx('span', { className: 'font-medium', children: 'Core' })
          ]}),
          jsx('span', { className: 'text-(--ui-text-tertiary)', children: String(packTotals.core || 0) })
        ]
      }),
      ...packIds.map(pack => {
        const on = enabledPacks.includes(pack)
        return jsx('button', {
          key: pack,
          type: 'button',
          onClick: () => onToggle(pack),
          'aria-pressed': on ? 'true' : 'false',
          title: on ? packTitleOf(pack) + ' is on — click to hide it' : 'Show the ' + packTitleOf(pack) + ' pack',
          className: 'flex items-center justify-between gap-2 rounded border px-2 py-1 text-left text-[0.6875rem] '
            + (on ? 'border-(--ui-accent) text-(--ui-accent)' : 'border-(--ui-stroke-secondary) text-(--ui-text-secondary)'),
          children: [
            jsx('span', { key: 'name', className: 'flex items-center gap-1', children: [
              jsx('span', { key: 'mark', children: on ? '✓' : '·' }),
              jsx('span', { key: 't', className: 'font-medium', children: packTitleOf(pack) })
            ]}),
            jsx('span', { key: 'n', className: 'text-(--ui-text-tertiary)', children: String(packTotals[pack] || 0) })
          ]
        })
      }),
      hidden > 0 ? jsx('div', {
        key: 'hidden',
        className: 'pt-1 text-[0.625rem] text-(--ui-text-tertiary)',
        children: hidden + (hidden === 1 ? ' skin hidden by these packs' : ' skins hidden by these packs')
      }) : null,
      // Management lives one level deeper still: the pane shows skins, the pack
      // dialog shows packs, this shows the pack files. Nothing renders until it
      // is asked for.
      management ? jsxs('div', { key: 'manage', className: 'mt-2 border-t border-(--ui-stroke-secondary) pt-2', children: [
        jsx('button', {
          key: 'toggle',
          type: 'button',
          onClick: () => setManaging(prev => !prev),
          'aria-expanded': managing ? 'true' : 'false',
          className: MANAGE_BUTTON_CLASS,
          children: managing ? 'Hide pack management' : 'Manage packs…'
        }),
        managing ? jsx('div', { key: 'body', className: 'pt-2', children: management }) : null
      ]}) : null
    ]})
  })
}

/** The user's own shelves. The twelve measured families are read-only and are
 *  listed for orientation; the user's shelves can be created and dropped here. */
function CategoryModal({ categories, busy, name, title, onName, onTitle, onCreate, onDelete, surface, onClose }) {
  const list = Array.isArray(categories) ? categories : []
  return jsx(ModalShell, {
    title: 'Categories',
    subtitle: 'The twelve colour families are measured and fixed. These are your own shelves.',
    surface,
    onClose,
    children: jsxs('div', { className: 'flex flex-col gap-2', children: [
      jsx('div', { key: 'builtins', className: 'flex flex-wrap gap-1', children:
        THEME_CATEGORIES.map(category => jsx('span', {
          key: category.id,
          className: 'rounded border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-[0.625rem] text-(--ui-text-tertiary)',
          children: category.title
        }))
      }),
      list.length
        ? jsx(CategoryList, { key: 'list', categories: list, busy, onDelete })
        : jsx('div', { key: 'none', className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: 'No categories of your own yet.' }),
      jsxs('div', { key: 'create', className: 'flex flex-wrap items-center gap-1 pt-1', children: [
        jsx('input', {
          key: 'id',
          type: 'text',
          value: name,
          placeholder: 'category id',
          title: 'A slug for the category (lowercase, dashes)',
          onChange: e => onName(e && e.target ? e.target.value : ''),
          className: 'h-7 w-28 rounded border border-(--ui-stroke-secondary) px-1 font-mono text-[0.625rem]'
        }),
        jsx('input', {
          key: 'title',
          type: 'text',
          value: title,
          placeholder: 'Display title',
          title: 'The title shown on the shelf',
          onChange: e => onTitle(e && e.target ? e.target.value : ''),
          className: 'h-7 w-32 rounded border border-(--ui-stroke-secondary) px-1 text-[0.625rem]'
        }),
        jsx('button', {
          key: 'go',
          type: 'button',
          disabled: Boolean(busy) || !String(name || '').trim(),
          onClick: onCreate,
          className: MANAGE_BUTTON_CLASS,
          children: busy ? 'Working…' : 'Create category'
        })
      ]})
    ]})
  })
}

function EditorModal({ scene, overrides, owned, mode, busy, modes, caps, onClose, onSave, onReset, onDuplicate }) {
  const effective = applyOverride(scene, overrides)
  const overridden = !!(overrides && overrides[scene.name])
  // One draft per mode, seeded from the effective palette. Kept apart so `dirty`
  // is a comparison of like with like, and so clearing one mode cannot clear the
  // other.
  const seedLight = draftForScene(effective, 'light')
  const seedDark = draftForScene(effective, 'dark')
  const [lightDraft, setLightDraft] = useState(() => safeMerge(seedLight))
  const [darkDraft, setDarkDraft] = useState(() => safeMerge(seedDark))
  // The fork (§18.3): `Update "<name>"` (the Save button) beside a `Save as new`
  // that opens a name prompt and posts the SAME draft as a brand-new skin. The
  // prompt stays open on a 409 with the collision ON THE FIELD — the colours are
  // never lost — and the user, never an auto-suffix, picks the name.
  // Typography rides the same override record (E5), so the draft carries it.
  const seedFonts = safeMerge({}, (effective && effective.typography) || {})
  const [fonts, setFonts] = useState(() => safeMerge(seedFonts))
  const fontsDirty = String(fonts.fontSans || '') !== String(seedFonts.fontSans || '')
    || String(fonts.fontMono || '') !== String(seedFonts.fontMono || '')
  const changeFont = (key, value) => {
    setFonts(prev => {
      const next = safeMerge(prev)
      if (value) next[key] = value
      else delete next[key]
      return next
    })
  }
  const [forking, setForking] = useState(false)
  const [forkName, setForkName] = useState('')
  const [forkError, setForkError] = useState('')
  const dirty = !modeDraftEqual(lightDraft, seedLight) || !modeDraftEqual(darkDraft, seedDark) || fontsDirty
  const changeRole = (modeKey, roleId, value) => {
    const setter = modeKey === 'light' ? setLightDraft : setDarkDraft
    setter(prev => {
      const next = safeMerge(prev)
      next[roleId] = value
      return next
    })
  }
  const draft = { light: lightDraft, dark: darkDraft, typography: fonts }
  // What the strip paints is the DRAFT on the effective palette, so an edit shows
  // before it is saved, and the preview cannot disagree with the card.
  const light = draftPalette(effective, 'light', draft.light)
  const dark = draftPalette(effective, 'dark', draft.dark)
  const shells = { light: firstColorIn(light, ['background']), dark: firstColorIn(dark, ['background']) }
  const texts = {
    light: firstColorIn(light, ['banner_text', 'ui_text', 'status_bar_text']),
    dark: firstColorIn(dark, ['banner_text', 'ui_text', 'status_bar_text'])
  }
  const name = scene.label || scene.name
  // The fork (§18.3): `Update "<name>"` (the Save button) beside a `Save as new`
  // which opens a name prompt and posts the SAME draft as a brand-new OWNED
  // skin. The prompt stays open on a 409 with the collision ON THE FIELD — the
  // colours are never lost — and the user, never an auto-suffix, picks the name.
  const startFork = () => { setForkName(duplicateSlug(scene.name)); setForkError(''); setForking(true) }
  const cancelFork = () => { setForking(false); setForkError('') }
  const submitFork = () => {
    if (!onDuplicate || busy) return
    if (!isSlug(forkName)) { setForkError('Use lowercase letters, digits and dashes'); return }
    const body = duplicateBody(draft, forkName.trim(), '', modes, scene)
    Promise.resolve(onDuplicate(body)).then(res => {
      if (res && res.ok) { setForking(false); setForkError(''); return }
      const failure = res && res.failure ? res.failure : null
      setForkError(failure && failure.message ? failure.message : 'Duplicate failed')
    }).catch(err => {
      setForkError(err && err.message ? err.message : 'Duplicate failed')
    })
  }
  // The door is chosen by OWNERSHIP, never by the name (§3, §19.3): a user skin
  // is rewritten in place through PUT /skins/{name}; a built-in goes through
  // PUT /overrides/{scene}. `showReset` is therefore an overridden BUILT-IN only —
  // a user skin has no authored palette to restore, so a Reset would do nothing.
  const showReset = overridden && !owned
  const subtitle = owned
    ? 'Your own skin: Save rewrites its file in place.'
    : (overridden
      ? 'Carries your override. Reset puts the shipped palette back.'
      : 'Saving stores an override. The shipped catalogue is never rewritten.')
  return jsx('div', {
    className: EDITOR_OVERLAY_CLASS,
    // The scrim and the scroll fallback, as inline styles. `bg-black/50` is not in
    // the host's compiled stylesheet (the host never uses that exact class), so the
    // dialog had no dim behind it and no way to reach a sheet taller than the
    // viewport. See scripts/check-host-classes.py.
    style: { backgroundColor: 'rgba(0,0,0,0.5)', overflowY: 'auto' },
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Edit ' + name,
    // Click-outside and Escape both close. There is no focus trap in E1 (E6 owns
    // keyboard reach); the header holds a real Close button so the modal is never
    // a trap for the mouse-free.
    onClick: event => { if (event && event.target === event.currentTarget && onClose) onClose() },
    onKeyDown: event => { if (event && event.key === 'Escape' && onClose) onClose() },
    children: jsxs('div', {
      className: EDITOR_SHEET_CLASS,
      // THE MODAL MUST CAP AND SCROLL, and the class cannot do it: `max-h-[87vh]`
      // and `w-[min(94vw,64rem)]` are arbitrary-value utilities that the HOST's
      // compiled stylesheet does not contain — the host's own source never used
      // those literals — so the sheet grew to its full 36-row content height and ran
      // off the viewport, unreachable. Verified live: 0 rules for either class in
      // apps/desktop/dist/assets/*.css. scripts/check-host-classes.py is the gate.
      style: {
        backgroundColor: sheetSurface(effective, mode),
        maxHeight: '87vh',
        width: 'min(94vw, 64rem)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      },
      children: [
        jsxs('div', { key: 'head', className: 'flex items-start justify-between gap-2', children: [
          jsxs('div', { className: 'min-w-0', children: [
            jsx('div', { className: 'truncate text-sm font-semibold', children: 'Edit ' + name }),
            jsx('div', { className: 'text-[0.625rem] text-(--ui-text-tertiary)', children: subtitle })
          ]}),
          jsx('button', {
            key: 'close',
            type: 'button',
            onClick: onClose,
            title: 'Close the editor (Escape)',
            'aria-label': 'Close the editor',
            className: EDITOR_ACTION_CLASS,
            children: '✕'
          })
        ]}),
        // One scroll container, between a pinned header and a pinned footer. The
        // palette is 36 rows; scrolling the whole dialog would take the Save
        // button away with it.
        jsx('div', {
          key: 'body',
          className: 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1',
          // The one scroll container, pinned between header and footer. The classes
          // rely on the host having generated them; the inline trio does not rely on
          // anything. A dialog you cannot scroll is a dialog you cannot save.
          style: { overflowY: 'auto', minHeight: 0, flex: '1 1 auto' },
          children: [
        jsx('div', {
          key: 'preview',
          className: EDITOR_PREVIEW_CLASS,
          style: EDITOR_PREVIEW_STYLE,
          children: jsx(ThemeCardPalette, { lightStrip: paletteStrip(light), darkStrip: paletteStrip(dark), shape: 'square' })
        }),
        jsx('div', {
          key: 'legend',
          className: 'flex flex-wrap items-center gap-2 text-[0.5625rem] uppercase tracking-wide text-(--ui-text-tertiary)',
          children: [
            jsx('span', { key: 'contract', children: 'Light over dark — the same 2 × 6 contract the card paints' }),
            caps
              ? jsx('span', {
                  key: 'caps',
                  title: 'The writer enforces these caps; the pane reads them from GET /schema',
                  className: 'rounded bg-(--ui-bg-tertiary) px-1 normal-case text-(--ui-text-secondary)',
                  children: 'Caps '
                    + (caps.maxColors === null ? '—' : caps.maxColors)
                    + ' colours · '
                    + (caps.maxBytes === null ? '—' : Math.round(caps.maxBytes / 1024))
                    + ' KB'
                })
              : null
          ]
        }),
        jsxs('div', { key: 'roles', className: 'flex flex-col gap-0.5', children: [
          jsxs('div', { key: 'columns', className: 'flex items-center gap-2 text-[0.5625rem] uppercase tracking-wide text-(--ui-text-tertiary)', children: [
            jsx('span', { className: 'w-24 shrink-0', children: 'Role' }),
            jsx('span', { className: 'flex-1', children: '☀ light' }),
            jsx('span', { className: 'flex-1', children: '☾ dark' })
          ]})
        ].concat(editorRoleNodes(draft, changeRole, shells, texts))}),
        // Typography. A skin is not only colour: it carries the two font stacks the
        // engine reads, so an editor that cannot set them cannot make a skin.
        jsxs('div', { key: 'fonts', className: 'flex flex-col gap-1 rounded border border-(--ui-stroke-secondary) p-2', children: [
          jsxs('div', { key: 'head', className: 'flex items-baseline justify-between', children: [
            jsx('span', { key: 't', className: 'text-[0.5625rem] font-semibold uppercase tracking-wide text-(--ui-text-tertiary)', children: 'Typography' }),
            jsx('span', { key: 'h', className: 'text-[0.5625rem] text-(--ui-text-tertiary)', children: 'applies to both modes' })
          ]}),
          jsx(FontSelect, {
            key: 'sans',
            label: 'Interface',
            hint: 'the reading font of the interface',
            value: fonts.fontSans,
            choices: FONT_CHOICES_SANS,
            onChange: value => changeFont('fontSans', value)
          }),
          jsx(FontSelect, {
            key: 'mono',
            label: 'Code',
            hint: 'the font of code, diffs and the prompt',
            value: fonts.fontMono,
            choices: FONT_CHOICES_MONO,
            onChange: value => changeFont('fontMono', value)
          })
        ]}),
        jsxs('div', {
          key: 'advice',
          className: 'flex flex-wrap items-center gap-2 rounded border border-(--ui-stroke-secondary) px-2 py-1 text-[0.5625rem] text-(--ui-text-tertiary)',
          children: [
            jsx('span', { key: 'label', children: 'Advisory targets:' })
          ].concat(ADVICE_TARGETS.map(item => jsx('span', {
            key: item.id,
            title: item.hint,
            className: 'rounded bg-(--ui-bg-tertiary) px-1 text-(--ui-text-secondary)',
            children: item.label + ' ' + item.target + ':1'
          }))).concat([
            jsx('span', { key: 'note', children: 'Marked, never refused — it is your skin.' })
          ])
        }),
        ]}),
        jsxs('div', {
          key: 'actions',
          className: 'flex shrink-0 items-center justify-between gap-2 border-t border-(--ui-stroke-secondary) pt-2',
          children: [
            jsxs('span', { key: 'state', className: 'min-w-0 text-[0.625rem] text-(--ui-text-tertiary)', children: [
              owned
                ? 'Your own skin file. '
                : (overridden ? 'An override exists for this skin. ' : 'No override yet. '),
              dirty ? jsx('span', { style: { color: 'var(--ui-warn)' }, children: 'Unsaved changes.' }) : null
            ]}),
            jsxs('div', { key: 'buttons', className: 'flex shrink-0 items-center gap-1', children: [
              forking
                ? jsxs('span', { key: 'fork', className: 'flex min-w-0 items-center gap-1', children: [
                    jsx('input', {
                      type: 'text',
                      value: forkName,
                      spellCheck: false,
                      placeholder: '<name>-copy',
                      'aria-label': 'Name for the new skin',
                      'aria-invalid': forkError ? 'true' : 'false',
                      title: forkError || 'The new skin\u2019s name (a slug)',
                      onChange: e => { setForkName(e && e.target ? e.target.value : ''); setForkError('') },
                      onKeyDown: e => { if (e && e.key === 'Enter') submitFork(); if (e && e.key === 'Escape') cancelFork() },
                      className: 'min-w-0 w-32 rounded border border-(--ui-stroke-secondary) px-1 py-0.5 font-mono text-[0.625rem]'
                        + (forkError ? '' : ' bg-(--ui-bg-secondary)'),
                      // The error border colour is inline, not a host utility.
                      style: forkError ? { borderColor: 'var(--ui-error)' } : undefined
                    }),
                    jsx('button', {
                      key: 'forkgo',
                      type: 'button',
                      disabled: !!busy,
                      onClick: submitFork,
                      title: 'Write these colours as a brand-new skin you own',
                      className: EDITOR_SAVE_CLASS,
                      style: EDITOR_SAVE_STYLE,
                      children: busy === 'fork' ? 'Saving…' : 'Save copy'
                    }),
                    jsx('button', {
                      key: 'forkcancel',
                      type: 'button',
                      disabled: !!busy,
                      onClick: cancelFork,
                      className: EDITOR_ACTION_CLASS,
                      children: 'Cancel'
                    })
                  ]})
                : null,
              showReset
                ? jsx('button', {
                    key: 'reset',
                    type: 'button',
                    disabled: !!busy,
                    onClick: () => onReset(scene.name),
                    title: 'Delete your override and put the shipped palette back',
                    className: EDITOR_ACTION_CLASS,
                    children: busy === 'reset' ? 'Resetting…' : 'Reset'
                  })
                : null,
              jsx('button', {
                key: 'save',
                type: 'button',
                disabled: saveDisabled(dirty, busy),
                onClick: () => { if (onSave) onSave(scene.name, overridePayload(draft, modes)) },
                title: owned ? OWNED_SAVE_REASON : 'Store your edit as an override of the shipped palette',
                className: EDITOR_SAVE_CLASS,
                style: EDITOR_SAVE_STYLE,
                children: busy === 'save' ? 'Saving…' : 'Save'
              }),
              (!forking && typeof onDuplicate === 'function')
                ? jsx('span', { key: 'sep', className: 'px-0.5 text-(--ui-text-tertiary)', 'aria-hidden': 'true', children: '|' })
                : null,
              (!forking && typeof onDuplicate === 'function')
                ? jsx('button', {
                    key: 'forkopen',
                    type: 'button',
                    disabled: !!busy,
                    onClick: startFork,
                    title: 'Save these colours as a NEW skin you own — the source skin is left untouched',
                    className: EDITOR_ACTION_CLASS,
                    children: 'Save as new'
                  })
                : null
            ]})
          ]
        })
      ]
    })
  })
}

/** The favourites rail: a column on the LEFT of the gallery, scrolling on its
 *  own so a long shelf cannot push the skins out of the pane. It is also the one
 *  place a favourite is removed from, and it resolves every name against the
 *  catalogue - a star that outlives its skin is dropped, never a ghost row. */
function FavoritesRail({ favorites, skins, mode, onApply, onRemove }) {
  const rows = []
  for (const name of favorites) {
    const scene = skins.find(candidate => candidate && candidate.name === name)
    if (!scene) continue
    const colors = (mode === 'dark' ? scene.darkColors : scene.lightColors) || scene.colors || {}
    rows.push(jsxs('div', {
      key: name,
      className: 'flex items-center gap-1 rounded',
      children: [
        jsx('button', {
          type: 'button',
          onClick: () => onApply(scene),
          title: 'Apply ' + (scene.label || name),
          className: 'flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left',
          children: [
            jsx('span', {
              className: 'h-2.5 w-2.5 shrink-0 rounded-full',
              style: { backgroundColor: colors.ui_accent || colors.banner_accent || 'var(--ui-accent)' }
            }),
            jsx('span', { className: 'truncate text-[0.6875rem]', children: scene.label || name.replace(/-/g, ' ') })
          ]
        }),
        jsx('button', {
          type: 'button',
          onClick: () => onRemove(scene),
          title: 'Remove from favourites',
          'aria-label': 'Remove ' + (scene.label || name) + ' from favourites',
          className: 'shrink-0 rounded px-1 text-[0.8125rem] leading-5 text-(--ui-text-tertiary)',
          children: '\u00d7'
        })
      ]
    }))
  }
  return jsxs('aside', {
    className: 'flex w-36 shrink-0 flex-col gap-1 overflow-hidden rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-1.5',
    'data-favorites': String(rows.length),
    children: [
      jsx('div', {
        className: 'text-[0.625rem] font-semibold uppercase tracking-wide text-(--ui-text-tertiary)',
        children: 'Favourites (' + rows.length + ')'
      }),
      jsx('div', {
        className: 'flex min-h-0 flex-1 flex-col overflow-y-auto',
        children: rows
      })
    ]
  })
}

function ThemeCard({ scene, mode, active, applying, onApply, owned, managing, onDelete, onRename, onExport, previewing, previewUntil, onPreview, onStopPreview, shape, localScope, onEdit, onDuplicate, edited, categories, onSetCategory, favorited, onToggleFavorite }) {
  // Both halves of the pair, always: every scene ships both modes now, and the
  // card shows them side by side rather than only the mode that happens to be
  // live.
  const lightStrip = paletteStrip(scene.lightColors || scene.colors || {})
  const darkStrip = paletteStrip(scene.darkColors || scene.colors || {})
  const isActive = scene.name === active
  const labelClass = shape === 'circle'
    ? 'mb-1 flex w-full items-center justify-center gap-1'
    : 'flex w-full items-center justify-between gap-1'
  const cardChildren = []
  if (shape !== 'circle') {
    cardChildren.push(jsx(ThemeCardLabel, { scene, mode, active, localScope, showState: true, className: labelClass, edited }))
  }
  cardChildren.push(jsx(ThemeCardPalette, { lightStrip, darkStrip, shape }))
  const card = jsxs('button', {
    type: 'button',
    onClick: () => onApply(scene),
    disabled: applying === scene.name,
    title: cardTitle(scene, mode),
    // The card FILLS its frame. The border, the radius and the aspect ratio
    // belong to the box that also carries the action row (see cardBox below), so
    // the row can sit inside the same edge instead of floating over it.
    className: cn('absolute inset-0 flex w-full flex-col gap-1 text-left', cardShapePadding(shape)),
    children: cardChildren
  })
  // The preview pill and the editor's gear are DOM siblings of the card, and the
  // card's own box has to stay their positioning context, so they travel together.
  // The gear appears only when the pane hands in an edit handler: a card with no
  // editor behind it must not offer the affordance.
  const boxChildren = [card, jsx(ThemeCardPreviewPill, { scene, previewing, previewUntil, onPreview, onStopPreview })]
  // The action row is IN FLOW: the frame's last child. It cannot hang over the
  // card's edge, because it is not positioned at all. It rides the palette's
  // bottom band (the card fills the frame behind it), and the row itself takes no
  // pointer, so a click in the gap still reaches the card while the pills do not.
  // The star rides alone on the LEFT of the row; the manage actions stay
  // together on the right, so the row reads as one shelf rather than a scatter.
  const manageActions = []
  if (typeof onEdit === 'function') manageActions.push(jsx(ThemeCardEditGear, { scene, onEdit }))
  if (typeof onDuplicate === 'function') manageActions.push(jsx(ThemeCardDuplicate, { scene, onDuplicate }))
  const rowChildren = []
  if (typeof onToggleFavorite === 'function') {
    rowChildren.push(jsx('span', {
      key: 'star',
      className: 'pointer-events-auto',
      children: jsx(ThemeCardFavorite, { scene, favorited, onToggleFavorite })
    }))
  }
  if (manageActions.length) {
    rowChildren.push(jsx('div', {
      key: 'manage',
      className: 'pointer-events-auto flex items-center gap-1.5',
      children: manageActions
    }))
  }
  if (rowChildren.length) {
    boxChildren.push(jsx('div', {
      className: cn(
        'pointer-events-none relative z-20 mt-auto flex items-center gap-1.5',
        shape === 'circle' ? 'justify-center px-2 pb-2' : 'justify-between px-1.5 pb-1.5'
      ),
      children: rowChildren
    }))
  }
  const cardBox = jsxs('div', {
    // The frame: one border, one radius, the gallery's aspect ratio, and the
    // overflow guard that keeps every child inside the edge.
    style: { aspectRatio: cardAspect(shape) },
    className: cn(
      'group relative flex w-full flex-col overflow-hidden border transition-colors',
      cardShapeClasses(shape),
      isActive
        ? 'border-(--ui-accent) bg-(--ui-bg-tertiary)'
        : 'border-(--ui-stroke-secondary) bg-(--ui-bg-secondary)'
    ),
    children: boxChildren
  })
  // A circle cannot hold its label inside: a rounded-full box does not clip its
  // children, so a name set at the top of the box would fall outside the arc.
  // It rides ABOVE the circle instead - above, like every other shape, not below.
  const stacked = shape === 'circle'
    ? jsxs('div', {
        className: 'flex w-full flex-col',
        children: [
          jsx(ThemeCardLabel, { scene, mode, active, localScope, showState: false, className: labelClass, edited }),
          cardBox
        ]
      })
    : cardBox
  // Only an owned skin has manage actions, and it keeps its unwrapped shape when it
  // does not: the extra flex column is what holds the action row.
  if (!owned) return stacked
  // Theme Packs badge (§9): 'core' for core members; pack id otherwise. Text only (not colour-only) per plan.
  const packId = scene && scene.pack ? scene.pack : (scene && scene.name ? 'core' : 'core')
  const badgeText = packId === 'core' ? 'core' : (packId || 'core')
  return jsxs('div', { className: 'flex w-full flex-col', children: [
    stacked,
    jsxs('div', { className: 'mt-1 flex items-center gap-1', children: [
      jsx('span', { className: 'inline-flex items-center rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-0.5 py-0.5 text-[0.5625rem] text-(--ui-text-secondary) font-medium', children: badgeText }),
      jsx(ThemeCardActions, { scene, managing, onDelete, onRename, onExport, categories, onSetCategory })
    ]})
  ]})
}

// ---------------------------------------------------------------------------
// E3 — the pack surface (plan §7). Kept IN the pane: a list with member counts
// and an honest missing-member warning, an export that rides saveTextFile, an
// import that previews before it writes, and a delete with two real choices.
// ---------------------------------------------------------------------------

const PACK_ROW_CLASS = 'flex items-center justify-between gap-2 rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-2 py-1'
const PACK_SECTION_CLASS = 'flex flex-col gap-1 rounded border border-(--ui-stroke-secondary) p-2'

/** One pack: its name, its membership (honest about absence), and its two
 *  actions. A pack that lost members says so — it is never rendered as whole. */
function PackRow({ pack, busy, onExport, onDelete }) {
  const missing = packMissing(pack)
  const slugName = pack.slug || slug(pack.name) || 'pack'
  return jsxs('div', { className: PACK_ROW_CLASS, 'data-pack': slugName, children: [
    jsxs('div', { key: 'id', className: 'min-w-0', children: [
      jsx('div', { className: 'truncate text-[0.6875rem] font-medium', children: pack.name || slugName }),
      jsx('div', { className: 'text-[0.5625rem] text-(--ui-text-tertiary)', children: packMemberSummary(pack) })
    ]}),
    missing.length
      ? jsx('span', {
          key: 'missing',
          title: 'The pack record names skins whose files are gone: ' + missing.join(', '),
          className: 'shrink-0 rounded px-1 text-[0.5625rem]',
          // Warning colour and its 15% fill are inline, not host utilities.
          style: { color: 'var(--ui-warn)', backgroundColor: 'color-mix(in srgb, var(--ui-warn) 15%, transparent)' },
          children: missing.length + ' missing'
        })
      : null,
    jsxs('div', { key: 'actions', className: 'flex shrink-0 items-center gap-1', children: [
      jsx('button', {
        key: 'export',
        type: 'button',
        disabled: !!busy,
        onClick: () => onExport(pack),
        title: 'Save this pack as a self-contained bundle you can send to someone else',
        className: MANAGE_BUTTON_CLASS,
        children: 'Export'
      }),
      jsx('button', {
        key: 'delete',
        type: 'button',
        disabled: !!busy,
        onClick: () => onDelete(pack),
        title: 'Drop the pack record, or the record and the skins it names',
        className: MANAGE_BUTTON_CLASS,
        children: 'Delete'
      })
    ]})
  ]})
}

/** The pack list, with the required empty state. */
function CategoryList({ categories, busy, onDelete }) {
  if (!categories || !categories.length) {
    return jsx(EmptyState, {
      title: 'No user categories yet',
      description: 'Create your own shelf to file skins under, beside the twelve measured ones.'
    })
  }
  return jsxs('div', { className: 'flex flex-col gap-1', children: categories.map(cat =>
    jsxs('div', {
      key: cat.id,
      className: 'flex items-center gap-1',
      children: [
        jsx('span', {
          className: 'min-w-0 flex-1 truncate text-[0.625rem] text-(--ui-text-secondary)',
          title: cat.id,
          children: cat.title || cat.id
        }),
        jsx('button', {
          key: 'delete',
          type: 'button',
          disabled: busy,
          onClick: () => onDelete(cat.id),
          title: 'Delete this category. Skins filed under it fall back to their measured shelf.',
          className: MANAGE_BUTTON_CLASS,
          children: busy ? '\u2026' : 'Delete'
        })
      ]
    })
  )})
}

function PackList({ packs, busy, onExport, onDelete }) {
  if (!packs || !packs.length) {
    return jsx(EmptyState, { title: 'No packs yet', description: 'Save your filtered skins as a pack, or import one someone sent you.' })
  }
  return jsxs('div', { className: 'flex flex-col gap-1', children: packs.map(pack =>
    jsx(PackRow, { key: pack.slug || slug(pack.name), pack, busy, onExport, onDelete })
  )})
}

/** The import preview, grouped by status (§7). `new` will be written, `identical`
 *  is skipped, `collides` needs a choice — rename or skip — and nothing is
 *  written until the user confirms. */
function PackImportPreview({ groups, choices, onChoice }) {
  const g = groups || { new: [], identical: [], collides: [] }
  const names = (rows, cls) => rows.map(r =>
    jsx('div', { key: r.name, className: cls, children: r.name }))
  const collisions = g.collides.map(r => jsxs('div', {
    key: r.name,
    className: 'flex items-center gap-2 text-[0.625rem]',
    children: [
      jsx('span', { className: 'min-w-0 truncate text-(--ui-text-secondary)', children: r.name }),
      jsx('input', {
        className: 'min-w-0 flex-1 rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-1 py-0.5 font-mono text-[0.625rem]',
        value: (choices && choices[r.name] && choices[r.name].to) || (r.to || (r.name + '-2')),
        onChange: e => onChoice(r.name, { action: 'rename', to: e && e.target ? e.target.value : '' })
      }),
      jsx('button', {
        type: 'button',
        onClick: () => onChoice(r.name, { action: 'skip' }),
        className: MANAGE_BUTTON_CLASS,
        children: (choices && choices[r.name] && choices[r.name].action === 'skip') ? 'skipped' : 'skip'
      })
    ]
  }))
  const block = (key, label, items) => jsxs('div', { key: key, className: 'flex flex-col gap-0.5', children: [
    jsx('div', { className: 'text-[0.5625rem] uppercase tracking-wide text-(--ui-text-tertiary)', children: label }),
    items.length ? items : jsx('div', { className: 'text-[0.625rem] text-(--ui-text-tertiary)', children: '— none —' })
  ]})
  return jsxs('div', { className: 'flex flex-col gap-2 rounded border border-(--ui-stroke-secondary) p-2', children: [
    block('new', 'New (' + g.new.length + ')', names(g.new, 'text-[0.625rem] text-(--ui-text-secondary)')),
    block('identical', 'Identical — skipped (' + g.identical.length + ')', names(g.identical, 'text-[0.625rem] text-(--ui-text-tertiary)')),
    block('collides', 'Collides — choose (' + g.collides.length + ')', collisions)
  ]})
}

// ---------------------------------------------------------------------------
// Untrusted entries and the render boundary
//
// A skin arriving from local storage or the backend is UNTRUSTED input. A card
// dereferences `scene.name.replace(...)` during render, so one entry with a
// missing or non-string name throws and React tears down the WHOLE picker — the
// user loses every card, not one. Two layers guard that:
//   1. splitUsableSkins rejects entries that cannot be drawn, keeping the rest;
//   2. SkinBoundary catches anything that still throws and offers a way on.
// ---------------------------------------------------------------------------

/** A name is usable only if it is a string with non-whitespace content. */
function hasUsableSkinName(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Split a mixed list into what can be drawn and what cannot. Never drops the
 * list for one bad entry: the usable skins are returned intact and the rejected
 * ones are handed back so the caller can say so.
 */
function splitUsableSkins(list) {
  const usable = []
  const unusable = []
  for (const item of Array.isArray(list) ? list : []) {
    if (item && typeof item === 'object' && hasUsableSkinName(item.name)) usable.push(item)
    else unusable.push(item)
  }
  return { usable, unusable }
}

/**
 * Last line of defence behind the validation above. If a card still throws
 * during render, React unmounts the whole tree by default; this keeps the page
 * alive and replaces only the gallery with an honest message and a way to carry
 * on. It reports the failure rather than swallowing it silently.
 */
class SkinBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
    this.reset = this.reset.bind(this)
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    host.notify({
      kind: 'warning',
      message: 'A theme could not be drawn: ' + (error && error.message ? error.message : error)
    })
  }

  reset() {
    this.setState({ failed: false })
  }

  render() {
    if (this.state.failed) {
      return jsxs('div', {
        className: 'flex flex-col items-center gap-2 p-6 text-center',
        children: [
          jsx('div', { className: 'text-[0.8125rem] text-(--ui-text-secondary)', children: 'This theme could not be drawn.' }),
          jsx('button', {
            type: 'button',
            onClick: this.reset,
            className: 'rounded border border-(--ui-stroke-secondary) px-2 py-0.5 text-[0.6875rem]',
            children: 'Try again'
          })
        ]
      })
    }
    return this.props.children
  }
}

function ThemePicker() {
  const [active, setActive, live] = useActiveSkin()
  const desktopTheme = useDesktopThemeApi()
  const [q, setQ] = useState('')
  const [applying, setApplying] = useState(null)
  const profile = useValue(host.state.profile) || 'default'
  const [mode, setMode] = useState(() => desktopModeFor(profile, document.documentElement.dataset.hermesMode))
  const [importMode, setImportMode] = useState('url')
  // Scope governs whether a pick is broadcast. Read per profile, so two profiles
  // on one Desktop can answer this differently.
  const [scope, setScope] = useState(() => readApplyScope(profile))
  useEffect(() => { setScope(readApplyScope(profile)) }, [profile])
  const changeScope = next => {
    if (next !== APPLY_SCOPE_LOCAL && next !== APPLY_SCOPE_EVERYWHERE) return
    writeApplyScope(profile, next)
    setScope(next)
    haptic('tap')
  }
  const [shape, setShape] = useState(() => readCardShape())
  const changeShape = next => {
    if (CARD_SHAPES.indexOf(next) < 0) return
    writeCardShape(next)
    setShape(next)
    haptic('tap')
  }
  const [size, setSize] = useState(() => readCardSize())
  const changeSize = next => {
    if (CARD_SIZES.indexOf(next) < 0) return
    writeCardSize(next)
    setSize(next)
    haptic('tap')
  }
  // Favourites: one list, written once, and both surfaces read it - the star on
  // the card and the rail beside the gallery. A refused write says so instead of
  // showing a shelf the next mount would drop.
  const [favorites, setFavorites] = useState(() => readFavorites())
  const toggleFavorite = scene => {
    if (!scene || !scene.name) return
    const next = toggleFavoriteName(favorites, scene.name)
    const starred = next.indexOf(scene.name) >= 0
    if (!writeFavorites(next)) {
      host.notify({ kind: 'error', message: 'Could not save your favourites' })
      return
    }
    setFavorites(next)
    haptic('tap')
    host.notify({
      kind: 'info',
      message: (starred ? 'Starred ' : 'Unstarred ') + (scene.label || scene.name)
    })
  }
  const removeFavorite = scene => toggleFavorite(scene)
  const [groupMode, setGroupMode] = useState(() => readGroupMode())
  const changeGroupMode = next => {
    if (GROUP_MODES.indexOf(next) < 0) return
    writeGroupMode(next)
    setGroupMode(next)
    haptic('tap')
  }
  const [importRef, setImportRef] = useState('')
  // The pack chips and the category manager moved off the pane: two buttons open
  // them as modals, so the gallery keeps its height for the skins themselves.
  const [packsOpen, setPacksOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importedTick, setImportedTick] = useState(0)
  const [owned, setOwned] = useState({})
  // Whether the Python half answered. The Desktop half still applies and
  // previews themes without it, but normalisation, gateway sync and the manage
  // actions cannot work, so the pane states that instead of hiding the buttons.
  const [backendReady, setBackendReady] = useState(hasGatewayBackend())
  const [managing, setManaging] = useState(null)
  // The editor's own state (§17): the override map (effective = override ??
  // authored), which scene is open, whether a write is in flight, and an epoch the
  // modal is keyed by so a Reset re-seeds its fields.
  const [overrides, setOverrides] = useState({})
  const [editing, setEditing] = useState(null)
  const [editorBusy, setEditorBusy] = useState(null)
  const [editorEpoch, setEditorEpoch] = useState(0)
  // The backend schema (§19.2 item 1), read once per session. Null means the
  // route was absent — the editor keeps its own defaults and says so quietly.
  const [schema, setSchema] = useState(null)
  const schemaNoted = useRef(false)
  // E4 — the user's own categories. These are additive records the user creates;
  // they never edit the twelve measured shelves. `categories` is the list the
  // "by theme" lens renders as extra shelves, and the picker assigns a skin's
  // category field. An absent /categories route (older backend) leaves this
  // empty and the editor falls back to measured-only, same as packs.
  const [categories, setCategories] = useState([])

  // E4 — the category create form. `categoryName` is the id (a slug the user
  // types), `categoryTitle` is the display name. Both reset on a successful
  // create so the form is ready for the next one.
  const [categoryName, setCategoryName] = useState('')
  const [categoryTitle, setCategoryTitle] = useState('')
  const [categoryBusy, setCategoryBusy] = useState(false)

  // E3 — the pack surface. `packs` is the list the section renders; the import
  // flow is a small state machine: a paste box, a dry-run PREVIEW grouped by
  // status, per-collision choices, then a confirmed write. Nothing is written
  // until the user confirms.
  const [packs, setPacks] = useState([])
  const [packBusy, setPackBusy] = useState(false)
  const [packName, setPackName] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [packText, setPackText] = useState('')
  const [packBundle, setPackBundle] = useState(null)
  const [packGroups, setPackGroups] = useState(null)
  const [packChoices, setPackChoices] = useState({})
  const [packConfirm, setPackConfirm] = useState(null)
  // Theme Packs (CHROMA-PACKS.md §8): profile-scoped enabled pack ids.
  const [enabledPacks, setEnabledPacks] = useState([])
  // E2 — the card's Duplicate action, in flight for one scene at a time.
  const [duplicating, setDuplicating] = useState(null)

  // Fetch /schema once on mount: modes and caps come from it, and a disagreement
  // between a role's primary key and the backend's palette keys is raised as a
  // drift alarm rather than swallowed. A missing route degrades gracefully — the
  // editor must never block on it.
  useEffect(() => {
    let alive = true
    fetchEditorSchema().then(next => {
      if (!alive) return
      if (!next) {
        // No backend, or a route that answered nothing useful. The editor has a
        // documented default pair and works without the schema, so this is not
        // news and it is not an error. A desktop-only install must never see a
        // backend complaint for a backend it deliberately did not install.
        return
      }
      setSchema(next)
      const drift = schemaDrift(EDITOR_ROLES, next.paletteKeys)
      const typoDrift = schemaTypoDrift(next.typography)
      const catDrift = schemaCategoryDrift(next.categories, THEME_CATEGORIES)
      if (typoDrift.length) {
        console.warn('Chroma editor typography schema drift: ' + typoDrift.length
          + ' font keys absent from GET /schema')
        host.notify(schemaTypoDriftNotice(typoDrift))
      }
      if (drift.length) {
        for (const item of drift) {
          console.warn('Chroma editor schema drift: role ' + item.role + ' writes ' + item.key
            + ', which GET /schema does not list')
        }
        host.notify(schemaDriftNotice(drift))
      }
      if (catDrift.length) {
        console.warn('Chroma editor schema category drift: ' + catDrift.length
          + ' built-in categories absent from GET /schema')
        host.notify(schemaCategoryDriftNotice(catDrift))
      }
      // E4 — the same vocabulary check for the category shelf. The backend's
      // /schema answers the twelve built-in ids; the pane owns THEME_CATEGORIES.
      // A disagreement means the editor would render a shelf the backend cannot
      // accept, so it is surfaced the same way as a palette-key drift rather than
      // silently ignored. The check is one-way (backend vs pane): the pane never
      // treats a backend category id as one of its own, and the pane's user
      // categories are absent from the backend's list by construction.
      const categoryDrift = schemaCategoryDrift(
        Array.isArray(next.categories) ? next.categories : [],
        builtinCategoryIds()
      )
      if (categoryDrift.length) {
        console.warn('Chroma editor schema drift: GET /schema categories disagree with the pane',
          categoryDrift)
        host.notify(schemaCategoryDriftNotice(categoryDrift))
      }
    })
      // fetchEditorSchema is contractually non-throwing (it degrades to null), so
      // this is the last line of defence rather than error handling: an unhandled
      // rejection inside a mount effect surfaces only in the console, where a
      // shipped plugin's user will never look.
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const modes = editorModes(schema)
  const caps = schemaCaps(schema)

  const refreshOwned = useCallback(async () => {
    setBackendReady(hasGatewayBackend())
    try {
      setOwned(await listOwnedSkins())
    } catch (e) {
      // A backend that is not mounted is not worth shouting about, but it IS a
      // real limitation: the manage actions cannot work and an import cannot
      // mint a gateway skin. Track it so the pane can say so rather than hiding
      // the buttons and pretending everything is fine.
      setOwned({})
      setBackendReady(false)
    }
    // Overrides are a store of their own beside the skin index. A backend older
    // than the editor answers /skins and not /overrides, so this failure must be
    // read as "no overrides here" and must not re-flag the whole pane as
    // backend-less: the manage actions still work.
    try {
      setOverrides(await listOverrides())
    } catch (e) {
      setOverrides({})
    }
    // Packs are the same story as overrides: an older backend answers /skins and
    // not /packs, which means "no packs here", never a backend-less pane.
    try {
      setPacks(await listPacks())
    } catch (e) {
      setPacks([])
    }
    // Theme Packs persistence: load enabled pack ids from profile-scoped storage.
    setEnabledPacks(readEnabledPacks())
    // Categories follow the same lenient read: an older backend answers /skins
    // and not /categories, so a failure means "no user categories here" and the
    // editor still renders the twelve measured shelves. A corrupt store makes a
    // WRITER fail loudly, never a silent reset — see the backend.
    try {
      setCategories(await listCategories())
    } catch (e) {
      setCategories([])
    }
  }, [])

  useEffect(() => { refreshOwned() }, [refreshOwned, importedTick])

  const removeSkin = async (name) => {
    if (managing) return
    if (name === active) {
      host.notify({ kind: 'error', message: 'Switch to another theme before deleting this one' })
      return
    }
    setManaging(name)
    try {
      const result = await deleteOwnedSkin(name, active)
      haptic('tap')
      await refreshOwned()
      setImportedTick(n => n + 1)
      host.notify({
        kind: 'info',
        message: result && result.deleted ? 'Deleted ' + name + ' (recoverable from the Chroma trash)' : 'Removed the record for ' + name
      })
    } catch (e) {
      host.notify({ kind: 'error', message: 'Delete failed: ' + (e && e.message ? e.message : e) })
    } finally {
      setManaging(null)
    }
  }

  const renameSkin = async (name, next) => {
    const target = (next || '').trim().toLowerCase()
    if (!target || target === name || managing) return
    setManaging(name)
    try {
      const result = await renameOwnedSkin(name, target, active)
      // Renaming the ACTIVE skin leaves the gateway holding a name that no longer
      // resolves. Under 'everywhere' we repair it by broadcasting the new name.
      // Under a local scope we must NOT broadcast -- that would overwrite another
      // machine's choice -- so we say how to repair it rather than leave the CLI
      // silently on a dead name.
      if (result && result.wasActive) {
        if (readApplyScope(profile) === APPLY_SCOPE_EVERYWHERE) {
          try { await host.request('config.set', { key: 'skin', value: result.to }) } catch (e) { }
        } else {
          host.notify({
            kind: 'info',
            message: 'Renamed. The CLI may still name "' + name + '"; set scope to Everywhere and re-apply to repair it.'
          })
        }
      }
      haptic('tap')
      await refreshOwned()
      setImportedTick(n => n + 1)
      host.notify({ kind: 'info', message: 'Renamed to ' + target })
    } catch (e) {
      host.notify({ kind: 'error', message: 'Rename failed: ' + (e && e.message ? e.message : e) })
    } finally {
      setManaging(null)
    }
  }

  const exportSkin = async (name) => {
    if (managing || exporting) return
    setExporting(true)
    try {
      const payload = await exportOwnedSkins(name)
      const art = exportArtifact(payload)
      saveTextFile(art.filename, art.text)
      haptic('tap')
      host.notify({ kind: 'info', message: 'Exported ' + name + ' as ' + art.filename })
    } catch (e) {
      host.notify({ kind: 'error', message: 'Export failed: ' + (e && e.message ? e.message : e) })
    } finally {
      setExporting(false)
    }
  }

  const exportAllSkins = async () => {
    if (managing || exporting) return
    setExporting(true)
    try {
      const payload = await exportOwnedSkins('')
      const art = exportArtifact(payload)
      saveTextFile(art.filename, art.text)
      haptic('tap')
      host.notify({ kind: 'info', message: 'Exported ' + payload.count + ' skins as ' + art.filename })
    } catch (e) {
      host.notify({ kind: 'error', message: 'Export failed: ' + (e && e.message ? e.message : e) })
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => { ensureImportedSkinsLoaded() }, [])

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setMode(desktopModeFor(profile, root.dataset.hermesMode))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-hermes-mode'] })
    return () => observer.disconnect()
  }, [profile])

  const { usable: allSkins, unusable: unusableSkins } = useMemo(() => {
    const known = new Set(SKINS.map(s => s.name))
    const imported = IMPORTED_SKINS.filter(s => !known.has(s.name))
    return splitUsableSkins([...imported, ...SKINS, ...live.filter(s => !known.has(s.name) && !IMPORTED_SKINS.some(x => x.name === s.name))])
  }, [live, importedTick])

  // A stored or backend entry with no usable name cannot be drawn. Say so once
  // instead of letting one bad entry white-screen the gallery.
  useEffect(() => {
    if (unusableSkins.length) {
      host.notify({
        kind: 'warning',
        message: unusableSkins.length + ' theme(s) could not be drawn and were skipped'
      })
    }
  }, [unusableSkins])

  const importTweakcn = async () => {
    const ref = importRef.trim()
    if (!ref || busy) return
    setBusy(true)
    try {
      const theme = (importMode === 'url')
        ? await fetchTweakcnTheme(ref)
        : await parseImportedTheme(ref)
      if (CORE_DESKTOP_THEMES && CORE_DESKTOP_THEMES.has(theme.name)) throw new Error('refusing to shadow a built-in theme')
      persistTheme(theme)
      const scene = {
        name: theme.name,
        label: theme.label || theme.name,
        description: theme.description || 'Imported theme',
        modeSupport: sceneModeSupport(theme),
        palette: sceneModeSupport(theme),
        colors: theme.colors,
        lightColors: theme.colors,
        darkColors: theme.darkColors || theme.colors,
        typography: theme.typography,
        themePickerManaged: true,
        themePickerSource: theme.source || 'tweakcn'
      }
      if (!IMPORTED_SKINS.some(s => s.name === scene.name)) IMPORTED_SKINS.push(scene)
      // Mint the real gateway skin only if the Python half is mounted, and treat
      // a failure as exactly that: a local-only import, never a success. Swallow
      // nothing - the notice below is chosen from what actually happened.
      let minted = false
      let mintError = null
      try {
        await importThemeIntoSkins(theme.name, theme)
        minted = true
      } catch (e) {
        mintError = e
      }
      haptic('tap')
      // An import is still an apply, so it obeys the scope too.
      if (readApplyScope(profile) === APPLY_SCOPE_EVERYWHERE) {
        try { await host.request('config.set', { key: 'skin', value: theme.name }) } catch (e) { }
      }
      try { applyScene(scene, scene.modeSupport === 'dynamic' ? mode : scene.modeSupport, () => {}, desktopTheme) } catch (e) { }
      setImportedTick(n => n + 1)
      setImportRef('')
      host.notify(importOutcomeNotice(theme.label || theme.name, minted, mintError))
    } catch (e) {
      host.notify({ kind: 'error', message: 'Import failed: ' + (e && e.message ? e.message : e) })
    } finally {
      setBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return allSkins.filter(s => {
      // Plain concatenation, not a template literal: the catalog security scan
      // reads `${...}` as inline shell execution and flags it.
      const haystack = (s.name + ' ' + (s.label || '') + ' ' + (s.description || '')).toLowerCase()
      if (ql && !haystack.includes(ql)) return false
      return true
    })
  }, [allSkins, q])

  // One preview at a time, and exactly one authority for the revert: the timer
  // below. The countdown in the pill is display-only, so the revert still fires
  // if a previewing card is filtered away or scrolled out of the tree.
  const [preview, setPreview] = useState(null)
  const previewTimer = useRef(null)
  const themeApiRef = useRef(desktopTheme)
  themeApiRef.current = desktopTheme
  const revertPreview = useCallback(() => {
    const api = themeApiRef.current
    if (api && typeof api.clearThemePreview === 'function') {
      try { api.clearThemePreview() } catch (e) { }
    }
    setPreview(null)
  }, [])
  const stopPreview = useCallback(() => {
    if (previewTimer.current) { clearTimeout(previewTimer.current); previewTimer.current = null }
    revertPreview()
  }, [revertPreview])
  const startPreview = useCallback(scene => {
    const api = themeApiRef.current
    if (!api || typeof api.previewTheme !== 'function') return
    if (previewTimer.current) clearTimeout(previewTimer.current)
    const previewMode = scene.modeSupport === 'dynamic' ? mode : scene.modeSupport
    try { api.previewTheme(scene.name, previewMode === 'dark' ? 'dark' : 'light') } catch (e) { }
    setPreview({ name: scene.name, until: Date.now() + PREVIEW_MS })
    previewTimer.current = setTimeout(() => { previewTimer.current = null; revertPreview() }, PREVIEW_MS)
  }, [mode, revertPreview])
  // A preview left armed when the picker unmounts would strand the user on a
  // theme they never chose — the exact class of bug this plugin exists to stop.
  useEffect(() => () => {
    if (previewTimer.current) clearTimeout(previewTimer.current)
    const api = themeApiRef.current
    if (api && typeof api.clearThemePreview === 'function') { try { api.clearThemePreview() } catch (e) { } }
  }, [])

  const onApply = scene => {
    // Committing a theme while a preview is armed would leave the revert timer
    // to fire against the theme the user just chose.
    if (previewTimer.current) { clearTimeout(previewTimer.current); previewTimer.current = null }
    setPreview(null)
    const nextMode = scene.modeSupport === 'dynamic' ? mode : scene.modeSupport
    setApplying(scene.name)
    try {
      applyScene(scene, nextMode, setActive, desktopTheme)
    } finally {
      setApplying(null)
    }
  }

  const onModeChange = next => {
    if (next !== 'light' && next !== 'dark') return
    setMode(next)
    // The effective scene, so switching mode keeps an override in play (§17.1).
    const scene = applyOverride(allSkins.find(item => item.name === active) || null, overrides)
    if (scene) applyScene(scene, next, setActive, desktopTheme)
  }

  // --- the editor's write path (§17) -----------------------------------------
  // Open on the AUTHORED scene: the modal resolves the effective palette itself,
  // so what it shows and what a save sends come from one place.
  const openEditor = scene => {
    if (!scene) return
    stopPreview()
    setEditing({ name: scene.name })
  }
  const closeEditor = () => setEditing(null)

  const saveEditor = async (name, palettes) => {
    if (editorBusy) return false
    setEditorBusy('save')
    // One button, two doors, chosen by OWNERSHIP (§3, §19.3): an owned skin is
    // rewritten in place through PUT /skins/{name}; a built-in goes through
    // PUT /overrides/{scene}. The name never decides the door.
    const isOwned = !!owned[name]
    try {
      if (isOwned) {
        const saved = await putSkin(name, palettes)
        // Read the list back rather than trusting the local draft — the same
        // discipline the override save uses. The file may have been normalised.
        try {
          setOwned(await listOwnedSkins())
        } catch (readError) {
          // Keep the prior list; the write itself succeeded.
        }
        // Fold the backend's own read-back into the pane's scene and re-seed the
        // editor, so a successful save clears the dirty state against what was
        // actually written rather than leaving the draft disagreeing with a
        // stale scene.
        foldSavedSkin(name, saved)
        setImportedTick(n => n + 1)
        setEditorEpoch(n => n + 1)
        haptic('tap')
        host.notify({
          kind: 'success',
          title: 'Skin saved',
          message: (name.replace(/-/g, ' ')) + ' was rewritten in place',
          detail: 'Your own skin file was updated. There is no shipped palette to reset.'
        })
        return true
      }
      await putOverride(name, palettes)
      // Read the store back rather than echoing the payload: what is now in
      // force is what the backend holds, not what we sent (it may normalise).
      let effectiveOverride = { light: palettes.light, dark: palettes.dark, typography: palettes.typography }
      try {
        const store = await listOverrides()
        setOverrides(store)
        if (store && store[name]) effectiveOverride = store[name]
      } catch (readError) {
        setOverrides(prev => safeMerge(prev, { [name]: { light: palettes.light, dark: palettes.dark } }))
      }
      // Mirror for the next boot: register() reads this synchronously, and
      // Desktop's own boot cache gets the resolved theme so the selected skin
      // already carries the edit before the plugin runs.
      writeOverrideMirror(name, effectiveOverride)
      const authoredScene = SKINS.find(scene => scene.name === name)
      if (authoredScene) {
        const resolved = sceneToDesktopTheme(applyOverride(authoredScene, { [name]: effectiveOverride }))
        if (resolved) persistThemesForBoot([resolved])
      }
      haptic('tap')
      host.notify({
        kind: 'success',
        title: 'Override saved',
        message: (name.replace(/-/g, ' ')) + ' now uses your colours',
        detail: 'Reset in the editor puts the shipped palette back. The catalogue itself is untouched.'
      })
      return true
    } catch (e) {
      // A failed write changes nothing: the draft stays dirty and the notice says
      // what actually happened and WHICH door failed (a 404 means "restart
      // Hermes", not "broken").
      host.notify(overrideFailureNotice(e, 'save', isOwned ? 'skin' : 'override'))
      return false
    } finally {
      setEditorBusy(null)
    }
  }

  const resetEditor = async (name) => {
    if (editorBusy) return false
    setEditorBusy('reset')
    try {
      await dropOverride(name)
      try {
        setOverrides(await listOverrides())
      } catch (readError) {
        setOverrides(prev => {
          const next = safeMerge(prev)
          delete next[name]
          return next
        })
      }
      // Clear the boot mirror with the backend, so the next start resolves the
      // shipped palette rather than the edit just withdrawn.
      writeOverrideMirror(name, null)
      const authoredScene = SKINS.find(scene => scene.name === name)
      if (authoredScene) {
        const shipped = sceneToDesktopTheme(authoredScene)
        if (shipped) persistThemesForBoot([shipped])
      }
      // The fields are seeded from the effective palette, so they have to be
      // re-seeded: the modal is keyed by this epoch and remounts.
      setEditorEpoch(n => n + 1)
      haptic('tap')
      host.notify({
        kind: 'info',
        title: 'Override reset',
        message: (name.replace(/-/g, ' ')) + ' is back to the palette it shipped with',
        detail: 'Nothing else about the skin changed.'
      })
      return true
    } catch (e) {
      host.notify(overrideFailureNotice(e, 'reset'))
      return false
    } finally {
      setEditorBusy(null)
    }
  }

  // --- the fork (§18.3, E2) --------------------------------------------------
  // After a successful duplicate the skin is OWNED, so the pane folds it in the
  // same way the E1b in-place save does (foldSavedSkin + a re-read): the card
  // list picks it up, there is no phantom card, and no reload is needed.
  const foldDuplicate = async (name, light, dark) => {
    foldSavedSkin(name, { light: light, dark: dark })
    try { setOwned(await listOwnedSkins()) } catch (e) { }
    setImportedTick(n => n + 1)
  }

  const duplicateCard = async (scene) => {
    if (!scene || duplicating) return
    // The scene the CARD holds is already the EFFECTIVE palette (groupCards
    // layered the override), so a built-in's duplicate forks override ?? authored.
    const draftRoles = { light: draftForScene(scene, 'light'), dark: draftForScene(scene, 'dark') }
    const body = duplicateBody(draftRoles, duplicateSlug(scene.name), '', modes, scene)
    setDuplicating(scene.name)
    try {
      const result = await duplicateSkin(body.to, body.label, body.light, body.dark)
      const made = (result && result.name) ? result.name : body.to
      await foldDuplicate(made, body.light, body.dark)
      haptic('tap')
      host.notify({
        kind: 'success',
        title: 'Skin duplicated',
        message: made + ' is now a skin you own',
        detail: 'The source palette was not touched. Edit the copy freely.'
      })
    } catch (e) {
      const failure = duplicateFailure(e)
      host.notify(failure.notice)
      // A collision never auto-suffixes: open the editor so the user picks the
      // name there, with the collision on the field.
      if (failure.kind === 'collision') openEditor(scene)
    } finally {
      setDuplicating(null)
    }
  }

  /** The editor's fork: the same writer, but the NAME comes from the modal's own
   *  prompt and the RESULT is handed back, so a 409 lands on the field rather
   *  than in a thrown crash. */
  const duplicateFromEditor = async (body) => {
    if (editorBusy) return { ok: false, failure: duplicateFailure({ message: 'a write is already in flight' }) }
    setEditorBusy('fork')
    try {
      const result = await duplicateSkin(body.to, body.label, body.light, body.dark)
      const made = (result && result.name) ? result.name : body.to
      await foldDuplicate(made, body.light, body.dark)
      haptic('tap')
      host.notify({
        kind: 'success',
        title: 'Saved as a new skin',
        message: made + ' is yours now',
        detail: 'The source theme was not touched.'
      })
      return { ok: true, name: made }
    } catch (e) {
      const failure = duplicateFailure(e)
      if (failure.kind !== 'collision') host.notify(failure.notice)
      return { ok: false, failure: failure }
    } finally {
      setEditorBusy(null)
    }
  }

  // --- packs (E3) ------------------------------------------------------------
  const exportPackFromFilter = async () => {
    if (packBusy) return
    // A pack must hold what the user can see, not what the search matched.
    const body = packExportBody(packName || slug(q) || 'chroma-pack', visibleSkins.map(s => s.name), '')
    if (!isSlug(body.name)) {
      host.notify({ kind: 'error', message: 'Pack name "' + body.name + '" is not a slug — lowercase letters, digits and dashes' })
      return
    }
    if (!body.members.length) {
      host.notify({ kind: 'error', message: 'No skins to pack — the current filter is empty' })
      return
    }
    setPackBusy(true)
    try {
      const bundle = await requestPackExport(body.name, body.members, body.author)
      const art = packArtifact(bundle)
      saveTextFile(art.filename, art.text)
      haptic('tap')
      await refreshOwned()
      host.notify({ kind: 'success', title: 'Pack exported', message: 'Saved ' + art.filename, detail: body.members.length + ' skin(s) travelled with it.' })
    } catch (e) {
      host.notify({ kind: 'error', message: 'Export failed: ' + (e && e.message ? e.message : e) })
    } finally {
      setPackBusy(false)
    }
  }

  const previewPackImport = async () => {
    if (packBusy) return
    const parsed = parsePackBundle(packText)
    if (!parsed.ok) {
      setPackBundle(null)
      setPackGroups(null)
      host.notify({ kind: 'error', title: 'That is not a Chroma pack', message: parsed.error })
      return
    }
    setPackBusy(true)
    try {
      const preview = await requestPackImport(parsed.bundle, true)
      setPackBundle(parsed.bundle)
      setPackGroups(groupImportPlan(preview))
      setPackChoices({})
    } catch (e) {
      setPackBundle(null)
      setPackGroups(null)
      host.notify({ kind: 'error', message: 'Preview failed: ' + (e && e.message ? e.message : e) })
    } finally {
      setPackBusy(false)
    }
  }

  const chooseCollision = (name, choice) => setPackChoices(prev => safeMerge(prev, { [name]: choice }))

  const confirmPackImport = async () => {
    if (packBusy || !packBundle) return
    setPackBusy(true)
    try {
      const applied = applyPackChoices(packBundle, packChoices)
      const result = await requestPackImport(applied.bundle, false)
      haptic('tap')
      setPackBundle(null)
      setPackGroups(null)
      setPackChoices({})
      setPackText('')
      setImportOpen(false)
      await refreshOwned()
      host.notify(packImportNotice(result))
    } catch (e) {
      host.notify({ kind: 'error', message: 'Import failed: ' + (e && e.message ? e.message : e) })
    } finally {
      setPackBusy(false)
    }
  }

  const exportPack = async (pack) => {
    if (packBusy || !pack) return
    const name = pack.name || pack.slug
    const members = Array.isArray(pack.members) ? pack.members : []
    if (!members.length) {
      host.notify({ kind: 'error', message: 'That pack has no members to export' })
      return
    }
    setPackBusy(true)
    try {
      const bundle = await requestPackExport(name, members, pack.author || '')
      const art = packArtifact(bundle)
      saveTextFile(art.filename, art.text)
      haptic('tap')
      host.notify({ kind: 'success', title: 'Pack exported', message: 'Saved ' + art.filename, detail: members.length + ' skin(s) travelled with it.' })
    } catch (e) {
      host.notify({ kind: 'error', message: 'Export failed: ' + (e && e.message ? e.message : e) })
    } finally {
      setPackBusy(false)
    }
  }

  const askDeletePack = pack => setPackConfirm({ pack: pack, withSkins: false })
  const cancelDeletePack = () => setPackConfirm(null)
  const confirmDeletePack = async () => {
    if (packBusy || !packConfirm) return
    const pack = packConfirm.pack
    const slugName = pack.slug || slug(pack.name)
    const withSkins = packConfirm.withSkins
    setPackBusy(true)
    try {
      const result = await dropPack(slugName, withSkins)
      const removed = result && Array.isArray(result.removedSkins) ? result.removedSkins.length : 0
      setPackConfirm(null)
      await refreshOwned()
      haptic('tap')
      host.notify({
        kind: 'info',
        title: 'Pack deleted',
        message: withSkins ? ('Removed ' + slugName + ' and ' + removed + ' skin(s)') : ('Removed the ' + slugName + ' record'),
        detail: withSkins ? 'The skins went to the Chroma trash.' : 'The skins themselves were left untouched.'
      })
    } catch (e) {
      host.notify({ kind: 'error', message: 'Delete failed: ' + (e && e.message ? e.message : e) })
    } finally {
      setPackBusy(false)
    }
  }

  // E4 — the category handlers. Create POSTs to /categories and refreshes the
  // list; delete DELETEs /categories/{id}; assign PUTs the skin's category field
  // via the skin's own in-place route. All three ride refreshOwned() so the
  // gallery, the shelves and the picker all see the new state at once.
  const handleCreateCategory = async () => {
    if (categoryBusy) return
    const id = (categoryName || '').trim()
    const title = (categoryTitle || '').trim()
    if (!id) {
      host.notify({ kind: 'error', message: 'Give the category an id' })
      return
    }
    setCategoryBusy(true)
    try {
      await createCategory(id, title)
      setCategoryName('')
      setCategoryTitle('')
      haptic('tap')
      await refreshOwned()
      host.notify({ kind: 'success', title: 'Category created', message: 'Filed under ' + id })
    } catch (e) {
      const failure = categoryCreateFailure(e)
      host.notify(failure.notice)
    } finally {
      setCategoryBusy(false)
    }
  }

  const handleDeleteCategory = async (id) => {
    if (categoryBusy || !id) return
    setCategoryBusy(true)
    try {
      await deleteCategory(id)
      haptic('tap')
      await refreshOwned()
      host.notify({
        kind: 'info',
        title: 'Category deleted',
        message: 'Removed ' + id + '. Skins filed under it fall back to their measured shelf.'
      })
    } catch (e) {
      host.notify({ kind: 'error', message: 'Delete failed: ' + (e && e.message ? e.message : e) })
    } finally {
      setCategoryBusy(false)
    }
  }

  const assignSkinCategory = async (name, category) => {
    if (!name) return
    setManaging(name)
    try {
      await putSkinCategory(name, category)
      haptic('tap')
      await refreshOwned()
      host.notify({
        kind: 'info',
        message: category
          ? ('Filed ' + name + ' under ' + category)
          : ('Reset ' + name + ' to its measured shelf')
      })
    } catch (e) {
      host.notify({ kind: 'error', message: 'Category assignment failed: ' + (e && e.message ? e.message : e) })
    } finally {
      setManaging(null)
    }
  }

  // Cards. A grid with auto-fill adapts to a resized window without a second
  // calculation -- the aspect ratio carries the look, not the width. The target
  // width is fixed, so a wide window shows MORE cards rather than four enormous
  // ones.
  const gap = 10
  const cardMin = cardMinFor(shape, size)
  // Groups are cut from the AUTHORED list, then each card is handed its effective
  // palette (§17.3.2): the shelf must not move when a scene is recoloured.
  // Theme Packs filter. Core is the default shelf: the pane opens on the thirty
  // core skins, and enabling a pack adds that pack (filterByPacks owns the rule).
  const packsAvailable = SKINS.some(scene => scene && scene.pack)
  const visibleSkins = filterByPacks(filtered, enabledPacks)
  const groups = groupCards(visibleSkins, overrides, groupMode, categories)
  // The pack chips are built from the catalogue, so a new pack appears by itself.
  const packIds = Array.from(new Set(SKINS.map(scene => scene && scene.pack).filter(p => p && p !== 'core')))
  const packTitle = (id) => PACK_TITLES[id] || (id.charAt(0).toUpperCase() + id.slice(1))
  const packTotals = {}
  for (const scene of SKINS) {
    const id = (scene && scene.pack) || 'core'
    packTotals[id] = (packTotals[id] || 0) + 1
  }
  const hiddenByPacks = Math.max(0, filtered.length - visibleSkins.length)
  const togglePack = (pack) => {
    setEnabledPacks(prev => togglePackChoice(prev, pack))
  }
  const activeScene = applyOverride(allSkins.find(scene => scene.name === active) || null, overrides)
  const activeColors = activeScene && ((mode === 'dark' ? activeScene.darkColors : activeScene.lightColors) || activeScene.colors)
  const editingScene = editing ? (allSkins.find(scene => scene.name === editing.name) || null) : null

  // The dialog surface is the skin the pane is showing, so a modal can never
  // come up on a colour that resolves to nothing.
  const modalSurface = sheetSurface(editingScene || activeScene || SKINS[0], mode)

  // Pack management was a block in the manage panel that sat in the pane even
  // with nothing in it. It is a dialog's job now: the Theme packs modal owns it,
  // behind a Manage button, and the gallery keeps the whole pane for skins.
  const packManagerNode =           jsxs('div', { key: 'packs', className: PACK_SECTION_CLASS, children: [
      jsxs('div', { key: 'head', className: 'flex flex-wrap items-center justify-between gap-2', children: [
        jsxs('div', { className: 'flex items-center gap-2', children: [
          jsx('span', { className: 'text-[0.6875rem] font-semibold uppercase tracking-wide text-(--ui-text-tertiary)', children: 'Packs' }),
          jsx(Badge, { variant: 'muted', children: packCountLabel(packs) })
        ]}),
        jsxs('div', { className: 'flex min-w-0 items-center gap-1', children: [
          jsx('input', {
            type: 'text',
            value: packName,
            placeholder: 'pack name',
            title: 'Name for the pack you save from the current filter (a slug)',
            onChange: e => setPackName(e && e.target ? e.target.value : ''),
            className: 'h-6 w-28 rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-1 font-mono text-[0.625rem]'
          }),
          jsx('button', {
            type: 'button',
            disabled: packBusy,
            onClick: exportPackFromFilter,
            title: 'Save the skins matching the current filter as a pack bundle',
            className: MANAGE_BUTTON_CLASS,
            children: packBusy ? 'Working…' : 'Save filter as pack'
          }),
          jsx('button', {
            type: 'button',
            onClick: () => setImportOpen(v => !v),
            className: MANAGE_BUTTON_CLASS,
            children: importOpen ? 'Close import' : 'Import pack'
          })
        ]})
      ]}),
      jsx(PackList, { packs, busy: packBusy, onExport: exportPack, onDelete: askDeletePack }),
      importOpen
        ? jsxs('div', { key: 'import', className: 'flex flex-col gap-1', children: [
            jsx('textarea', {
              className: 'rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-2 py-1 font-mono text-[0.6875rem]',
              rows: 4,
              placeholder: 'Paste a Chroma pack bundle (JSON) here',
              value: packText,
              onChange: e => setPackText(e && e.target ? e.target.value : '')
            }),
            jsxs('div', { className: 'flex flex-wrap items-center gap-1', children: [
              jsx('button', {
                type: 'button',
                disabled: packBusy || !packText.trim(),
                onClick: previewPackImport,
                title: 'Check what this bundle would do — nothing is written yet',
                className: MANAGE_BUTTON_CLASS,
                children: packBusy ? 'Checking…' : 'Preview import'
              }),
              packGroups
                ? jsx('button', {
                    type: 'button',
                    disabled: packBusy,
                    onClick: confirmPackImport,
                    className: EDITOR_SAVE_CLASS,
                    style: EDITOR_SAVE_STYLE,
                    children: packBusy ? 'Importing…' : 'Confirm import'
                  })
                : null,
              packGroups
                ? jsx('button', {
                    type: 'button',
                    onClick: () => { setPackGroups(null); setPackBundle(null); setPackChoices({}) },
                    className: MANAGE_BUTTON_CLASS,
                    children: 'Cancel'
                  })
                : null
            ]}),
            packGroups ? jsx(PackImportPreview, { groups: packGroups, choices: packChoices, onChoice: chooseCollision }) : null,
            packGroups ? jsx('div', { className: 'text-[0.5625rem] text-(--ui-text-tertiary)', children: 'Nothing is written until you confirm. A collision you leave as a rename is written under that new name; a skipped one is left alone.' }) : null
          ]})
        : null,
      packConfirm
        ? jsxs('div', { key: 'confirm', className: 'flex flex-col gap-1 rounded border p-2', style: { borderColor: 'var(--ui-error)' }, children: [
            jsx('div', { className: 'text-[0.625rem]', style: { color: 'var(--ui-error)' }, children: packDeleteNotice(packConfirm.pack, packConfirm.withSkins).title }),
            jsx('div', { className: 'text-[0.5625rem] text-(--ui-text-tertiary)', children: packDeleteNotice(packConfirm.pack, packConfirm.withSkins).message }),
            jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
              jsx('label', { className: 'flex items-center gap-1 text-[0.5625rem] text-(--ui-text-secondary)', children: [
                jsx('input', {
                  type: 'checkbox',
                  checked: !!packConfirm.withSkins,
                  onChange: e => setPackConfirm(prev => prev ? safeMerge(prev, { withSkins: !!(e && e.target && e.target.checked) }) : prev)
                }),
                'and the skins it names'
              ]}),
              jsx('button', {
                type: 'button',
                disabled: packBusy,
                onClick: confirmDeletePack,
                className: 'shrink-0 rounded border px-1 py-0.5 text-[0.625rem]',
                style: { borderColor: 'var(--ui-error)', color: 'var(--ui-error)' },
                children: packBusy ? 'Deleting…' : packDeleteNotice(packConfirm.pack, packConfirm.withSkins).confirm
              }),
              jsx('button', { type: 'button', onClick: cancelDeletePack, className: MANAGE_BUTTON_CLASS, children: 'Cancel' })
            ]})
          ]})
        : null
    ]})

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col',
    children: [
      jsxs('div', {
        className: 'flex flex-col gap-2 border-b border-(--ui-stroke-secondary) p-3',
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between gap-2',
            children: [
              jsxs('div', { className: 'flex items-baseline gap-1.5', children: [
                jsx('div', { key: 'n', className: 'text-sm font-semibold', children: 'Chroma' }),
                // Which build is on screen. A field report can then name it
                // instead of us inferring it from symptoms.
                jsx('span', { key: 'v', title: 'Loaded build', className: 'rounded border border-(--ui-stroke-secondary) px-1 text-[0.5625rem] text-(--ui-text-tertiary)', children: BUILD_STAMP })
              ]}),
              jsxs('div', {
                className: 'flex min-w-0 items-center gap-1.5',
                children: [
                  active
                    ? jsxs('span', {
                        className: 'flex min-w-0 items-center gap-1 rounded-full border border-(--ui-stroke-secondary) px-2 py-0.5',
                        children: [
                          jsx('span', {
                            className: 'h-2 w-2 shrink-0 rounded-full',
                            style: { backgroundColor: activeColors?.ui_accent || activeColors?.banner_accent || 'var(--ui-accent)' }
                          }),
                          jsx('span', { className: 'truncate text-[0.6875rem] text-(--ui-text-secondary)', children: activeScene?.label || active.replace(/-/g, ' ') })
                        ]
                      })
                    : null,
                  jsx('button', {
                    type: 'button',
                    onClick: exportAllSkins,
                    disabled: exporting || Object.keys(owned).length === 0,
                    title: 'Save every skin Chroma owns as one hand-editable bundle',
                    className: 'rounded border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-[0.625rem] disabled:opacity-50',
                    children: exporting ? 'Exporting…' : 'Export all'
                  }),
                  jsx(Badge, { variant: 'muted', children: `${visibleSkins.length}` })
                ]
              })
            ]
          }),
          jsx(SearchField, {
            placeholder: 'Search skins…',
            value: q,
            onChange: v => setQ(typeof v === 'string' ? v : '')
          }),
          // One line, not four. The settings stack was eating the pane, so the
          // lens switch, mode, shape, size and scope share a single row that
          // wraps only when the window is genuinely too narrow for them.
          jsx('div', {
            className: 'flex flex-wrap items-center gap-2',
            children: [
              jsx(Select, {
                value: groupMode,
                onValueChange: changeGroupMode,
                children: [
                  jsx(SelectTrigger, {
                    className: 'h-7 text-[0.6875rem]',
                    // `w-[7.5rem]` is an arbitrary value the host never generated.
                    style: { width: '7.5rem' },
                    title: 'Group the gallery by skin, or by colour family',
                    children: jsx(SelectValue, {})
                  }),
                  jsxs(SelectContent, {
                    children: [
                      jsx(SelectItem, { value: 'scene', children: 'By skin' }),
                      jsx(SelectItem, { value: 'theme', children: 'By colour family' }),
                      jsx(SelectItem, { value: 'pack', children: 'By theme pack' })
                    ]
                  })
                ]
              }),
              packsAvailable ? jsx('button', {
                type: 'button',
                onClick: () => setPacksOpen(true),
                title: 'Choose which theme packs the gallery shows',
                className: MANAGE_BUTTON_CLASS + ' h-7 px-2 text-[0.6875rem]',
                children: 'Theme packs' + (enabledPacks.length ? ' · ' + enabledPacks.length : '')
              }) : null,
              jsx('button', {
                type: 'button',
                onClick: () => setCategoriesOpen(true),
                title: 'Your own category shelves',
                className: MANAGE_BUTTON_CLASS + ' h-7 px-2 text-[0.6875rem]',
                children: 'Categories'
              }),
              jsx('div', {
                title: 'Preview in dark or light mode',
                children: jsx(SegmentedControl, {
                  options: [
                    { id: 'dark', label: '☾' },
                    { id: 'light', label: '☀' }
                  ],
                  value: mode,
                  onChange: onModeChange
                })
              }),
              jsx('div', {
                title: 'Card shape: squares, rectangles or circles',
                children: jsx(SegmentedControl, {
                  options: [
                    { id: 'square', label: '□' },
                    { id: 'rectangle', label: '▭' },
                    { id: 'circle', label: '○' }
                  ],
                  value: shape,
                  onChange: changeShape
                })
              }),
              jsx('div', {
                title: 'Card size: small, medium or large',
                children: jsx(SegmentedControl, {
                  options: [
                    { id: 'sm', label: 'S' },
                    { id: 'md', label: 'M' },
                    { id: 'lg', label: 'L' }
                  ],
                  value: size,
                  onChange: changeSize
                })
              }),
              jsx(SegmentedControl, {
                // The scope is a first-class control, not a setting buried elsewhere:
                // it decides whether a pick reaches the CLI, and the badges below
                // change meaning with it.
                options: [
                  { id: APPLY_SCOPE_LOCAL, label: 'This profile' },
                  { id: APPLY_SCOPE_EVERYWHERE, label: 'Everywhere' }
                ],
                value: scope,
                onChange: changeScope
              })
            ]
          }),
          jsx('div', {
            className: 'flex items-center gap-2 min-w-0',
            children: [
              jsx('div', { className: 'shrink-0', children: jsx(SegmentedControl, {
                options: [ { id: 'url', label: 'URL' }, { id: 'css', label: 'CSS' } ],
                value: importMode,
                onChange: v => { if (v === 'url' || v === 'css') setImportMode(v) }
              }) }),
              importMode === 'url'
                ? jsx(Input, { placeholder: 'TweakCN preset name or URL (e.g. catppuccin)', value: importRef, onChange: e => setImportRef(e && e.target ? e.target.value : '') })
                : jsx('textarea', { className: 'flex-1 rounded-md border px-2 py-1 text-[0.75rem] font-mono', style: { borderColor: 'var(--chrome-stroke)', backgroundColor: 'var(--chrome-surface)', color: 'var(--chrome-text)' }, placeholder: 'Paste shadcn CSS, a Windows Terminal scheme, a Base16/24 scheme, or a VS Code color theme', value: importRef, rows: 3, onChange: e => setImportRef(e && e.target ? e.target.value : '') }),
              jsx(Button, { variant: 'secondary', disabled: busy || !importRef.trim(), onClick: importTweakcn, children: busy ? 'Importing…' : 'Import' })
            ]
          }),
          !backendReady && jsx('div', {
            className: 'rounded-md border border-(--ui-stroke-secondary) px-2 py-1 text-[0.6875rem] text-(--ui-text-tertiary)',
            children: 'Gateway-skin backend not installed. Themes apply and preview on this Desktop, but an import cannot mint a gateway skin and rename, export and delete are unavailable. Install the Python half and restart Hermes to enable them.'
          }),
          // E3 — the pack surface (plan §7). A list with member counts and an
          // honest missing-member warning, an export that rides saveTextFile, an
          // import that PREVIEWS before it writes, and a two-choice delete.
          // Import reads a pasted bundle: the host exposes no file-OPEN dialog
          // (only a save path), so the paste box is the honest channel here.
          // E4 — the category management surface. The twelve built-ins are
          // measured and read-only; this section manages the user's OWN
          // shelves. Create takes a slug id + display title; delete removes
          // the record (skins filed under it fall back to their measured
          // shelf); per-skin assignment rides the card's own selector.
          // The category manager lives in its own modal now (see the Categories
          // button in the settings row); the manage panel keeps the pack
          // scaffolding, which is a different job.
        ]
      }),
      // The gallery and the rail share one row. An empty rail is not rendered at
      // all: the star on every card is the door, and an empty column is noise.
      jsxs('div', {
        className: 'flex min-h-0 flex-1 items-stretch gap-2 p-2',
        children: [
          favorites.length
            ? jsx(FavoritesRail, {
                key: 'favorites',
                favorites,
                skins: allSkins,
                mode,
                onApply,
                onRemove: removeFavorite
              })
            : null,
          jsx(ScrollArea, {
            className: 'min-h-0 flex-1',
            children: jsx(SkinBoundary, {
          children:
            // Group builders always return their shelves, so a group count is
            // never zero. The empty state is decided by emptyStateFor, which
            // reads the skins that survived the search AND the pack filter.
            visibleSkins.length === 0
              ? jsx(EmptyState, emptyStateFor(visibleSkins.length, hiddenByPacks))
              : jsx('div', {
                  className: 'flex flex-col gap-4',
                  children: groups.map((group, index) =>
                    jsxs('section', {
                      key: group.id,
                      className: index ? 'border-t border-(--ui-stroke-secondary) pt-4' : '',
                      children: [
                        jsx('div', {
                          className: 'mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-(--ui-text-tertiary)',
                          children: `${group.title} (${group.scenes.length})`
                        }),
                        jsx('div', {
                          className: 'grid',
                          style: { gap, gridTemplateColumns: 'repeat(auto-fill, minmax(' + cardMin + 'px, 1fr))' },
                          children: group.scenes.map(scene =>
                            jsx(ThemeCard, {
                              key: scene.name,
                              scene,
                              mode: scene.modeSupport === 'dynamic' ? mode : scene.modeSupport,
                              active,
                              applying,
                              onApply,
                              // Only skins Chroma owns can be managed. The catalog
                              // scenes ship with the plugin and the backend
                              // refuses anything without a provenance record.
                              owned: !!owned[scene.name],
                              managing: managing === scene.name,
                              onDelete: removeSkin,
                              onRename: renameSkin,
                              onExport: exportSkin,
                              previewing: !!preview && preview.name === scene.name,
                              previewUntil: preview ? preview.until : 0,
                              onPreview: startPreview,
                              onStopPreview: stopPreview,
                              onEdit: openEditor,
                              // E2: a second action beside the gear, for ANY
                              // scene — a built-in forks its effective palette.
                              onDuplicate: duplicateCard,
                              // The marker reads from the override map, and the
                              // card already carries the resolved palette.
                              edited: !!overrides[scene.name],
                              favorited: favorites.indexOf(scene.name) >= 0,
                              onToggleFavorite: toggleFavorite,
                              shape,
                              localScope: scope === APPLY_SCOPE_LOCAL,
                              categories,
                              onSetCategory: assignSkinCategory
                            })
                          )
                        })
                      ]
                    })
                  )
                })
            })
          })
        ]
      }),
      // The two surfaces that used to sit inline: the pack chips and the category
      // manager. Both are modals now, reached from the settings row.
      packsOpen
        ? jsx(PackPickerModal, {
            key: 'chroma-packs-modal',
            packIds,
            packTotals,
            enabledPacks,
            hidden: hiddenByPacks,
            onToggle: togglePack,
            surface: modalSurface,
            management: packManagerNode,
            onClose: () => setPacksOpen(false)
          })
        : null,
      categoriesOpen
        ? jsx(CategoryModal, {
            key: 'chroma-categories-modal',
            categories,
            busy: categoryBusy,
            name: categoryName,
            title: categoryTitle,
            onName: setCategoryName,
            onTitle: setCategoryTitle,
            onCreate: handleCreateCategory,
            onDelete: handleDeleteCategory,
            surface: modalSurface,
            onClose: () => setCategoriesOpen(false)
          })
        : null,
      // The editor's dialog, inside the pane's own tree as an overlay rather than
      // through the SDK's Radix Dialog (see the editor section). It is keyed by
      // the epoch so a Reset re-seeds the fields from the shipped palette.
      editingScene
        ? jsx(EditorModal, {
            key: 'chroma-editor-' + editorEpoch,
            epoch: editorEpoch,
            scene: editingScene,
            overrides,
            owned: !!owned[editingScene.name],
            mode,
            modes,
            caps,
            busy: editorBusy,
            onClose: closeEditor,
            onSave: saveEditor,
            onReset: resetEditor,
            onDuplicate: duplicateFromEditor
          })
        : null
    ]
  })
}

// ---------------------------------------------------------------------------
// Statusbar chip — shows the active theme, opens the Chroma page
// ---------------------------------------------------------------------------

function ThemeChip() {
  const desktopTheme = useDesktopThemeApi()
  const [active, setActive] = useActiveSkin()
  const { mode } = useTheme()
  const activeSkin = active
    ? (SKINS.find(s => s.name === active) || IMPORTED_SKINS.find(s => s.name === active)) || null
    : null
  const supportsBoth = !!(activeSkin && activeSkin.darkColors)
  const toggleMode = () => {
    if (!supportsBoth) return
    haptic('tap')
    // A provider-only setMode repaints whatever theme Desktop happens to hold,
    // which is not necessarily this scene (a gateway broadcast can leave it on
    // the single-mode transport skin, and an unresolvable name falls back to the
    // default). Re-apply the scene so our own root paint is the one the user sees.
    applyScene(activeSkin, mode === 'light' ? 'dark' : 'light', setActive, desktopTheme)
  }
  const activeColors = activeSkin && activeSkin.colors ? activeSkin.colors : null
  const activeLabel = activeSkin?.label || (active ? active.replace(/-/g, ' ') : 'Nous')

  return jsxs('div', {
    className: 'flex h-full items-center gap-0.5',
    children: [
      jsx('button', {
        type: 'button',
        onClick: () => {
          haptic('tap')
          host.navigate(PAGE_PATH)
        },
        title: `Active theme: ${active || 'nous'} — open Chroma`,
        className: 'flex h-full items-center gap-1.5 px-1.5 text-[0.6875rem] text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground',
        children: [
          jsx('span', {
            className: 'h-2 w-2 shrink-0 rounded-full',
            style: { backgroundColor: activeColors?.ui_accent || activeColors?.banner_accent || 'var(--ui-accent)' }
          }),
          jsx('span', { className: 'truncate', style: { maxWidth: '6rem' }, children: activeLabel })
        ]
      }),
      supportsBoth ? jsx('button', {
        type: 'button',
        onClick: toggleMode,
        title: `Switch to ${mode === 'light' ? 'dark' : 'light'} mode`,
        className: 'flex h-full items-center px-1 text-[0.6875rem] text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground',
        // The target mode, as a word. The glyph it used to carry was a codicon
        // that painted as an empty box wherever that font is not loaded.
        children: mode === 'light' ? 'Dark' : 'Light'
      }) : null
    ]
  })
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export default {
  id: ID,
  name: 'Chroma',
  register(ctx) {
    _rest = ctx.rest
    // A new registration gets a fresh schema: the cache is per session, not per
    // process, so a reload re-reads it.
    _editorSchemaCache = null
    migrateAppearanceAliases()
    // E5 — an override must survive a restart. register() is synchronous by
    // host contract (see OVERRIDES_MIRROR_KEY), so the boot read comes from the
    // local mirror the override write updates, never from the network.
    const overrides = readOverrideMirror()
    // Register each scene as one Desktop theme. Matched scenes carry a true
    // light palette plus darkColors, so Desktop's mode switch changes polarity
    // without creating duplicate Appearance entries. Core names stay native.
    // applyOverride layers the user's edits onto each scene before the theme
    // is built, so the boot theme carries the override, not the authored value.
    const userThemes = SKINS
      .filter(scene => !CORE_DESKTOP_THEMES.has(scene.name))
      .map(scene => applyOverride(scene, overrides))
      .map(sceneToDesktopTheme)
      .filter(Boolean)
    persistThemesForBoot(userThemes)
    for (const theme of userThemes) {
      ctx.register({
        id: `theme:${theme.name}`,
        area: THEMES_AREA,
        data: theme
      })
    }

    // A full page — reachable from the statusbar chip, sidebar nav, and palette.
    ctx.register({
      id: 'chroma-page',
      area: ROUTES_AREA,
      data: { path: PAGE_PATH },
      render: () => jsx('div', { className: 'h-full', children: jsx(ThemePicker, {}) })
    })
    ctx.register({
      id: 'chroma-nav',
      area: SIDEBAR_NAV_AREA,
      data: { path: PAGE_PATH, label: 'Chroma', codicon: 'paintcan' }
    })
    ctx.register({
      id: 'chroma-command',
      area: PALETTE_AREA,
      data: {
        id: 'chroma.open',
        label: 'Open Chroma',
        keywords: ['theme', 'skin', 'appearance', 'color'],
        run: () => host.navigate(PAGE_PATH)
      }
    })

    // Statusbar chip: current theme at a glance; click opens the picker.
    ctx.register({
      id: 'chroma-chip',
      area: STATUSBAR_AREAS.right,
      order: 130,
      render: () => jsx(ThemeChip, {})
    })
  }
}
