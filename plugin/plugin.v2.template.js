/**
 * theme-picker v2 — data-first, no paint.
 *
 * v1 painted Desktop's root tokens itself and pushed the pick to the gateway.
 * Desktop's ThemeProvider then re-applied its own React state on the next
 * render, so the theme reverted on any navigation or click. v2 removes the
 * whole fight:
 *
 *   - Every catalog theme is registered as pure THEMES_AREA data, so it appears
 *     in the native Appearance picker and Cmd-K like a built-in.
 *   - Applying goes through the app's own useTheme().setTheme/setMode. The app
 *     owns the paint, the per-profile persistence, and the mode.
 *   - The only UI is one contribution at the END of the Appearance page
 *     (APPEARANCE_AREAS.extra): a searchable swatch grid plus a TweakCN
 *     importer.
 *
 * There is no manual repaint, no gateway sync, no MutationObserver, no custom
 * route and no statusbar chip. Nothing here can develop v1's revert bug,
 * because nothing here writes theme state that the app does not own.
 *
 * Plain ESM loaded uncompiled: UI is jsx() calls, NOT JSX syntax; only
 * @hermes/plugin-sdk, react, react/jsx-runtime resolve.
 */

import {
  APPEARANCE_AREAS,
  Badge,
  Button,
  cn,
  haptic,
  host,
  Input,
  PALETTE_AREA,
  SearchField,
  SegmentedControl,
  THEMES_AREA,
  oklchToHex,
  useTheme
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useMemo, useState } from 'react'

const ID = 'theme-picker'
// Desktop reads this cache before plugins register, so an imported theme
// resolves on the next boot's first frame instead of waiting for us.
const USER_THEMES_KEY = 'hermes-desktop-user-themes-v1'
// TweakCN serves each preset as a shadcn registry item.
const TWEAKCN_BASE = 'https://tweakcn.com/r/themes/'
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

// ---------------------------------------------------------------------------
// Embedded skin catalog — generated from the repo's skins/ by
// scripts/regenerate.py (see __SKINS_DATA__).
// ---------------------------------------------------------------------------

const SKINS = __SKINS_DATA__

// ---------------------------------------------------------------------------
// Colour math — faithful port of apps/desktop/src/themes/color.ts, used only
// to translate a Hermes CLI skin's palette into DesktopThemeColors.
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
  const ar = hexToRgb(a)
  const br = hexToRgb(b)
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

function readableOn(hex) {
  return luminance(hex) > 0.5 ? '#161616' : '#ffffff'
}

// ---------------------------------------------------------------------------
// Hermes CLI skin -> DesktopThemeColors (same mapping v1 used).
// ---------------------------------------------------------------------------

function skinToDesktopTheme(skin) {
  const c = skin.colors || {}
  const pick = (...keys) => keys.map(k => c[k]).find(v => typeof v === 'string' && v)
  const background = pick('background', 'status_bar_bg') || '#111111'
  const foreground = pick('banner_text', 'ui_text') || readableOn(background)
  const accent = pick('ui_accent', 'banner_accent', 'banner_title') || foreground
  const border = pick('ui_border', 'banner_border') || mix(background, foreground, 0.2)
  const surface = pick('completion_menu_bg', 'status_bar_bg') || mix(background, foreground, 0.04)
  const raised = pick('completion_menu_current_bg') || mix(background, foreground, 0.08)
  const muted = pick('banner_dim', 'ui_label') || mix(background, foreground, 0.45)

  const palette = {
    background,
    foreground,
    card: surface,
    cardForeground: foreground,
    muted: mix(background, foreground, 0.12),
    mutedForeground: muted,
    popover: raised,
    popoverForeground: foreground,
    primary: accent,
    primaryForeground: readableOn(accent),
    secondary: mix(background, accent, 0.22),
    secondaryForeground: foreground,
    accent: mix(background, accent, 0.3),
    accentForeground: foreground,
    border,
    input: border,
    ring: accent,
    destructive: pick('ui_error') || '#b94a3a',
    destructiveForeground: readableOn(pick('ui_error') || '#b94a3a'),
    sidebarBackground: mix(background, foreground, 0.03),
    sidebarBorder: border,
    userBubble: mix(background, accent, 0.18),
    userBubbleBorder: border
  }

  return {
    name: skin.name,
    label: skin.name.charAt(0).toUpperCase() + skin.name.slice(1),
    description: skin.description || 'Hermes skin',
    colors: palette,
    darkColors: palette
  }
}

function sceneToDesktopTheme(scene) {
  const lightColors = scene.lightColors || scene.darkColors || scene.colors || {}
  const darkColors = scene.darkColors || scene.lightColors || scene.colors || {}
  const light = skinToDesktopTheme({ ...scene, colors: lightColors })
  const dark = skinToDesktopTheme({ ...scene, colors: darkColors })
  return {
    ...light,
    label: scene.label || light.label,
    description: scene.description || 'Theme Picker scene',
    colors: light.colors,
    darkColors: dark.colors,
    typography: SCENE_TYPOGRAPHY[scene.name],
    themePickerManaged: true
  }
}

const CATALOG = SKINS.map(sceneToDesktopTheme).filter(theme => theme && !CORE_DESKTOP_THEMES.has(theme.name))

// ---------------------------------------------------------------------------
// TweakCN import.
//
// A TweakCN preset is a shadcn registry item:
//   { name, type: 'registry:style',
//     cssVars: { theme: {font-sans, font-mono, radius, ...},
//                light: {background, foreground, 'card-foreground', ...},
//                dark:  {...} } }
//
// shadcn writes colours as `oklch(L C H)` (some older presets as hex/rgb/hsl),
// and Hermes' colour maths is hex-only — so every value is normalised to hex
// here. The SDK supplies oklchToHex, so nothing perceptual is hand-rolled.
// ---------------------------------------------------------------------------

const OKLCH_RE = /^oklch\(\s*([^)\s/]+)\s+([^)\s/]+)\s+([^)\s/]+)\s*(?:\/\s*([^)\s]+)\s*)?\)$/i
const RGB_RE = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i
const HEX_RE = /^#([0-9a-f]{3,8})$/i

/** Normalise one CSS colour token to `#rrggbb`, or undefined if unsupported. */
function cssColorToHex(value) {
  if (typeof value !== 'string') return undefined
  const raw = value.trim()
  if (!raw) return undefined

  const hex = raw.match(HEX_RE)
  if (hex) {
    const d = hex[1].toLowerCase()
    if (d.length === 3 || d.length === 4) return `#${d.slice(0, 3).split('').map(ch => ch + ch).join('')}`
    if (d.length === 6 || d.length === 8) return `#${d.slice(0, 6)}`
    return undefined
  }

  const ok = raw.match(OKLCH_RE)
  if (ok) {
    const l = Number(ok[1].endsWith('%') ? parseFloat(ok[1]) / 100 : ok[1])
    // `none` is a legal CSS component; treat it as zero chroma / zero hue.
    const c = ok[2].toLowerCase() === 'none' ? 0 : Number(ok[2].endsWith('%') ? parseFloat(ok[2]) / 100 : ok[2])
    const h = ok[3].toLowerCase() === 'none' ? 0 : Number(ok[3])
    if (![l, c, h].every(Number.isFinite)) return undefined
    const out = oklchToHex({ l, c, h })
    return out && out.startsWith('#') ? out.slice(0, 7) : undefined
  }

  const rgb = raw.match(RGB_RE)
  if (rgb) {
    return rgbToHex([Number(rgb[1]), Number(rgb[2]), Number(rgb[3])])
  }

  return undefined
}

/** Map a TweakCN `cssVars` colour group onto DesktopThemeColors. */
function tweakcnColors(group) {
  const g = group || {}
  const at = key => cssColorToHex(g[key])
  const background = at('background') || '#111111'
  const foreground = at('foreground') || readableOn(background)
  const primary = at('primary') || foreground
  const border = at('border') || at('input') || mix(background, foreground, 0.2)

  const colors = {
    background,
    foreground,
    card: at('card') || background,
    cardForeground: at('card-foreground') || foreground,
    muted: at('muted') || mix(background, foreground, 0.12),
    mutedForeground: at('muted-foreground') || mix(background, foreground, 0.45),
    popover: at('popover') || background,
    popoverForeground: at('popover-foreground') || foreground,
    primary,
    primaryForeground: at('primary-foreground') || readableOn(primary),
    secondary: at('secondary') || mix(background, foreground, 0.12),
    secondaryForeground: at('secondary-foreground') || foreground,
    accent: at('accent') || mix(background, primary, 0.3),
    accentForeground: at('accent-foreground') || foreground,
    border,
    input: at('input') || border,
    ring: at('ring') || primary,
    destructive: at('destructive') || '#b94a3a',
    destructiveForeground: at('destructive-foreground') || '#ffffff',
    sidebarBackground: at('sidebar') || at('sidebar-background') || mix(background, foreground, 0.03),
    sidebarBorder: at('sidebar-border') || border,
    userBubble: at('sidebar-accent') || mix(background, primary, 0.18),
    userBubbleBorder: at('sidebar-border') || border
  }

  return colors
}

const slug = value =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Convert a parsed TweakCN registry item into a DesktopTheme. */
function tweakcnToDesktopTheme(item) {
  if (!item || typeof item !== 'object') return null
  const name = slug(item.name)
  if (!name || CORE_DESKTOP_THEMES.has(name)) return null

  const cssVars = item.cssVars || {}
  const theme = cssVars.theme || {}
  const hasDark = cssVars.dark && Object.keys(cssVars.dark).length > 0
  const fontSans = typeof theme['font-sans'] === 'string' ? theme['font-sans'] : undefined
  const fontMono = typeof theme['font-mono'] === 'string' ? theme['font-mono'] : undefined

  return {
    name,
    label: name.replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()),
    description: `TweakCN${fontSans ? ` · ${fontSans.split(',')[0].trim()}` : ''}`,
    colors: tweakcnColors(cssVars.light),
    ...(hasDark ? { darkColors: tweakcnColors(cssVars.dark) } : {}),
    typography: {
      fontSans: fontSans || DEFAULT_FONT_SANS,
      fontMono: fontMono || DEFAULT_FONT_MONO
    },
    themePickerManaged: true,
    themePickerSource: 'tweakcn'
  }
}

/** Resolve a preset name or a full URL to its registry item URL. */
function tweakcnUrl(ref) {
  const value = String(ref || '').trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  const name = slug(value)
  return name ? `${TWEAKCN_BASE}${name}.json` : null
}

async function fetchTweakcnTheme(ref) {
  const url = tweakcnUrl(ref)
  if (!url) throw new Error('Enter a TweakCN preset name or URL')
  const response = await fetch(url)
  if (!response.ok) throw new Error(`TweakCN returned ${response.status} for ${url}`)
  const theme = tweakcnToDesktopTheme(await response.json())
  if (!theme) throw new Error('That registry item is not a usable theme')
  return theme
}

// ---------------------------------------------------------------------------
// Persistence for imported themes. Desktop resolves a stored theme on the next
// boot's first frame from this key, before any plugin registers.
// ---------------------------------------------------------------------------

function readStoredThemes() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(USER_THEMES_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function persistTheme(theme) {
  try {
    const stored = readStoredThemes()
    stored[theme.name] = theme
    window.localStorage.setItem(USER_THEMES_KEY, JSON.stringify(stored))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// UI — one contribution at the end of the Appearance page.
// ---------------------------------------------------------------------------

function themeStrip(theme, mode) {
  const c = (mode === 'dark' ? theme.darkColors : theme.colors) || theme.colors || {}
  return [c.background, c.primary, c.accent, c.foreground, c.border].filter(Boolean)
}

function ThemeButton({ theme, mode, active, onApply }) {
  const strip = themeStrip(theme, mode)
  return jsxs('button', {
    type: 'button',
    onClick: () => onApply(theme),
    title: theme.description || theme.name,
    className: cn(
      'group flex w-full flex-col gap-1.5 rounded-md border p-2 text-left transition-colors',
      active ? 'border-(--ui-accent)' : 'border-(--ui-stroke-secondary) hover:border-(--ui-accent)'
    ),
    children: [
      jsx('span', {
        className: 'flex h-5 w-full overflow-hidden rounded-sm',
        children: strip.map((colour, index) => jsx('span', { key: index, className: 'flex-1', style: { backgroundColor: colour } }))
      }),
      jsxs('span', {
        className: 'flex items-center justify-between gap-1',
        children: [
          jsx('span', { className: 'truncate text-[0.6875rem] font-medium', children: theme.label || theme.name }),
          active
            ? jsx(Badge, { variant: 'outline', className: 'shrink-0 px-1 text-[0.5625rem] text-(--ui-accent)', children: 'ACTIVE' })
            : theme.themePickerSource === 'tweakcn'
              ? jsx('span', { className: 'shrink-0 text-[0.5625rem] uppercase text-(--ui-text-tertiary)', children: 'tweakcn' })
              : null
        ]
      })
    ]
  })
}

function ThemePickerPanel() {
  const { themeName, mode, setTheme, setMode } = useTheme()
  const [query, setQuery] = useState('')
  const [imported, setImported] = useState([])
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)

  // Imported themes registered this session, plus anything already stored.
  useEffect(() => {
    const stored = readStoredThemes()
    setImported(
      Object.values(stored)
        .filter(theme => theme && theme.themePickerManaged && !CORE_DESKTOP_THEMES.has(theme.name))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    )
  }, [])

  const previewMode = mode === 'light' ? 'light' : 'dark'

  const themes = useMemo(() => {
    const seen = new Set()
    const all = [...imported, ...CATALOG].filter(theme => {
      if (!theme || seen.has(theme.name)) return false
      seen.add(theme.name)
      return true
    })
    const q = query.trim().toLowerCase()
    return q ? all.filter(t => `${t.name} ${t.label || ''} ${t.description || ''}`.toLowerCase().includes(q)) : all
  }, [imported, query])

  const onApply = useCallback(
    theme => {
      haptic('tap')
      setTheme(theme.name)
    },
    [setTheme]
  )

  const onImport = useCallback(async () => {
    const target = ref.trim()
    if (!target || busy) return
    setBusy(true)
    try {
      const theme = await fetchTweakcnTheme(target)
      registerTheme(theme)
      persistTheme(theme)
      setImported(prev => [theme, ...prev.filter(t => t.name !== theme.name)])
      setRef('')
      haptic('tap')
      setTheme(theme.name)
      host.notify({ kind: 'success', message: `Imported ${theme.label}` })
    } catch (error) {
      host.notify({ kind: 'error', message: `TweakCN import failed: ${error && error.message ? error.message : error}` })
    } finally {
      setBusy(false)
    }
  }, [ref, busy, setTheme])

  return jsxs('div', {
    className: 'flex flex-col gap-3 border-t border-(--ui-stroke-secondary) pt-4',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between gap-2',
        children: [
          jsx('div', { className: 'text-sm font-semibold', children: 'Theme Picker' }),
          jsx(Badge, { variant: 'muted', children: `${themes.length}` })
        ]
      }),
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-2',
        children: [
          jsx('div', {
            className: 'min-w-48 flex-1',
            children: jsx(SearchField, {
              placeholder: 'Search themes…',
              value: query,
              onChange: v => setQuery(typeof v === 'string' ? v : '')
            })
          }),
          jsx(SegmentedControl, {
            options: [
              { id: 'dark', label: '☾' },
              { id: 'light', label: '☀' }
            ],
            value: previewMode,
            onChange: next => {
              if (next === 'light' || next === 'dark') setMode(next)
            }
          })
        ]
      }),
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-2',
        children: [
          jsx('div', {
            className: 'min-w-48 flex-1',
            children: jsx(Input, {
              placeholder: 'TweakCN preset name or URL (e.g. catppuccin)',
              value: ref,
              onChange: event => setRef(event && event.target ? event.target.value : '')
            })
          }),
          jsx(Button, {
            type: 'button',
            variant: 'secondary',
            disabled: busy || !ref.trim(),
            onClick: onImport,
            children: busy ? 'Importing…' : 'Import from TweakCN'
          })
        ]
      }),
      jsx('div', {
        className: 'grid gap-2',
        style: { gridTemplateColumns: 'repeat(auto-fill, minmax(9rem, 1fr))' },
        children:
          themes.length === 0
            ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: 'No themes match that search.' })
            : themes.map(theme => jsx(ThemeButton, { theme, mode: previewMode, active: theme.name === themeName, onApply }, theme.name))
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// Kept so an import can register its theme from inside the panel, after load.
let registerContribution = () => {}

function registerTheme(theme) {
  if (!theme || !theme.name) return
  registerContribution({ id: `theme:${theme.name}`, area: THEMES_AREA, data: theme })
}

export default {
  id: ID,
  name: 'Theme Picker',
  register(ctx) {
    registerContribution = contribution => ctx.register(contribution)

    // Every catalog theme as pure data: it lands in the native Appearance grid
    // and Cmd-K automatically. No render, no apply, no state of ours.
    for (const theme of CATALOG) registerTheme(theme)

    // Anything imported on a previous run, re-registered for this session.
    for (const theme of Object.values(readStoredThemes())) {
      if (theme && theme.themePickerManaged && !CORE_DESKTOP_THEMES.has(theme.name)) registerTheme(theme)
    }

    // The one piece of UI: a control row at the end of the Appearance page.
    ctx.register({
      id: 'theme-picker-appearance',
      area: APPEARANCE_AREAS.extra,
      render: () => jsx(ThemePickerPanel, {})
    })

    ctx.register({
      id: 'theme-picker-command',
      area: PALETTE_AREA,
      data: {
        id: 'theme-picker.open',
        label: 'Open Appearance settings',
        keywords: ['theme', 'skin', 'appearance', 'color', 'tweakcn'],
        run: () => host.navigate('/settings?tab=appearance')
      }
    })
  }
}
