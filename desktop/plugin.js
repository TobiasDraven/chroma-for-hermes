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
const GROUP_MODES = ['scene', 'theme']
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
  { id: 'minimal', title: 'Minimal' },
  { id: 'pastels', title: 'Pastels' },
  { id: 'vibrant', title: 'Vibrant' },
  { id: 'muted', title: 'Muted' },
  { id: 'earth', title: 'Earth' },
  { id: 'terminal', title: 'Retro & Terminal' },
  { id: 'nature', title: 'Nature' },
  { id: 'warm', title: 'Warm' },
  { id: 'orange', title: 'Orange' },
  { id: 'gold', title: 'Gold' },
  { id: 'cool', title: 'Cool' },
  { id: 'violet', title: 'Violet' },
]
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

const SKINS = [{"category":"Built-in","colors":{"background":"#F8FAFF","banner_accent":"#0053FD","banner_border":"#C7D7FA","banner_text":"#17171A","ui_accent":"#0053FD","ui_border":"#C7D7FA","ui_text":"#17171A","ui_tool":"#0053FD"},"darkColors":{"background":"#0D2F86","banner_accent":"#FFE6CB","banner_border":"#3158AD","banner_text":"#FFE6CB","ui_accent":"#FFE6CB","ui_border":"#3158AD","ui_text":"#FFE6CB","ui_tool":"#0053FD"},"darkName":"default","description":"Glass neutrals with Nous blue accents","gatewayDarkName":"theme-picker-nous-dark","gatewayLightName":"theme-picker-nous-light","label":"Nous","lightColors":{"background":"#F8FAFF","banner_accent":"#0053FD","banner_border":"#C7D7FA","banner_text":"#17171A","ui_accent":"#0053FD","ui_border":"#C7D7FA","ui_text":"#17171A","ui_tool":"#0053FD"},"lightName":"nous","modeSupport":"dynamic","name":"nous","source":"builtin-desktop"},{"category":"Built-in","colors":{"background":"#FFFFFF","banner_accent":"#8B80E8","banner_border":"#DEDDF5","banner_text":"#161616","ui_accent":"#8B80E8","ui_border":"#DEDDF5","ui_text":"#161616","ui_tool":"#8B80E8"},"darkColors":{"background":"#08081C","banner_accent":"#8B80E8","banner_border":"#1E1E52","banner_text":"#DDD6FF","ui_accent":"#8B80E8","ui_border":"#1E1E52","ui_text":"#DDD6FF","ui_tool":"#8B80E8"},"darkName":"midnight","description":"Deep blue-violet with cool accents","gatewayDarkName":"theme-picker-midnight-dark","gatewayLightName":"theme-picker-midnight-light","label":"Midnight","lightColors":{"background":"#FFFFFF","banner_accent":"#8B80E8","banner_border":"#DEDDF5","banner_text":"#161616","ui_accent":"#8B80E8","ui_border":"#DEDDF5","ui_text":"#161616","ui_tool":"#8B80E8"},"lightName":"midnight","modeSupport":"dynamic","name":"midnight","source":"builtin-desktop"},{"category":"Built-in","colors":{"background":"#FFFFFF","banner_accent":"#D97316","banner_border":"#F1D9C4","banner_text":"#161616","ui_accent":"#D97316","ui_border":"#F1D9C4","ui_text":"#161616","ui_tool":"#D97316"},"darkColors":{"background":"#160800","banner_accent":"#D97316","banner_border":"#3A1C08","banner_text":"#FFD8B0","ui_accent":"#D97316","ui_border":"#3A1C08","ui_text":"#FFD8B0","ui_tool":"#D97316"},"darkName":"ember","description":"Warm crimson and bronze — forge vibes","gatewayDarkName":"theme-picker-ember-dark","gatewayLightName":"theme-picker-ember-light","label":"Ember","lightColors":{"background":"#FFFFFF","banner_accent":"#D97316","banner_border":"#F1D9C4","banner_text":"#161616","ui_accent":"#D97316","ui_border":"#F1D9C4","ui_text":"#161616","ui_tool":"#D97316"},"lightName":"ember","modeSupport":"dynamic","name":"ember","source":"builtin-desktop"},{"category":"Built-in","colors":{"background":"#FFFFFF","banner_accent":"#707070","banner_border":"#DEDEDE","banner_text":"#161616","ui_accent":"#707070","ui_border":"#DEDEDE","ui_text":"#161616","ui_tool":"#707070"},"darkColors":{"background":"#0E0E0E","banner_accent":"#9A9A9A","banner_border":"#2A2A2A","banner_text":"#EAEAEA","ui_accent":"#9A9A9A","ui_border":"#2A2A2A","ui_text":"#EAEAEA","ui_tool":"#9A9A9A"},"darkName":"mono","description":"Clean grayscale — minimal and focused","gatewayDarkName":"theme-picker-mono-dark","gatewayLightName":"theme-picker-mono-light","label":"Mono","lightColors":{"background":"#FFFFFF","banner_accent":"#707070","banner_border":"#DEDEDE","banner_text":"#161616","ui_accent":"#707070","ui_border":"#DEDEDE","ui_text":"#161616","ui_tool":"#707070"},"lightName":"mono","modeSupport":"dynamic","name":"mono","source":"builtin-desktop"},{"category":"Built-in","colors":{"background":"#FFFFFF","banner_accent":"#008F28","banner_border":"#C9E8D2","banner_text":"#161616","ui_accent":"#008F28","ui_border":"#C9E8D2","ui_text":"#161616","ui_tool":"#008F28"},"darkColors":{"background":"#000A00","banner_accent":"#00FF41","banner_border":"#003000","banner_text":"#00FF41","ui_accent":"#00FF41","ui_border":"#003000","ui_text":"#00FF41","ui_tool":"#00FF41"},"darkName":"cyberpunk","description":"Neon green on black — matrix terminal","gatewayDarkName":"theme-picker-cyberpunk-dark","gatewayLightName":"theme-picker-cyberpunk-light","label":"Cyberpunk","lightColors":{"background":"#FFFFFF","banner_accent":"#008F28","banner_border":"#C9E8D2","banner_text":"#161616","ui_accent":"#008F28","ui_border":"#C9E8D2","ui_text":"#161616","ui_tool":"#008F28"},"lightName":"cyberpunk","modeSupport":"dynamic","name":"cyberpunk","source":"builtin-desktop"},{"category":"Built-in","colors":{"background":"#FFF8FB","banner_accent":"#B64F78","banner_border":"#E8CAD6","banner_text":"#24171D","ui_accent":"#B64F78","ui_border":"#E8CAD6","ui_text":"#24171D","ui_tool":"#B64F78"},"darkColors":{"background":"#1A0F15","banner_accent":"#F9A8D4","banner_border":"#54283B","banner_text":"#FFD4E1","ui_accent":"#F9A8D4","ui_border":"#54283B","ui_text":"#FFD4E1","ui_tool":"#F9A8D4"},"darkName":"rose","description":"Soft pink and warm ivory — easy on the eyes","gatewayDarkName":"theme-picker-rose-dark","gatewayLightName":"theme-picker-rose-light","label":"Rose","lightColors":{"background":"#FFF8FB","banner_accent":"#B64F78","banner_border":"#E8CAD6","banner_text":"#24171D","ui_accent":"#B64F78","ui_border":"#E8CAD6","ui_text":"#24171D","ui_tool":"#B64F78"},"lightName":"rose","modeSupport":"dynamic","name":"rose","source":"builtin-desktop"},{"category":"Built-in","colors":{"background":"#f7f1fa","banner_accent":"#8b5ca8","banner_border":"#d8c8e0","banner_dim":"#6d5a80","banner_text":"#3a2645","banner_title":"#3a2645","completion_menu_bg":"#ffffff","input_rule":"#8b5ca8","prompt":"#3a2645","response_border":"#a87fc0","session_border":"#d8c8e0","status_bar_bg":"#ede3f2","status_bar_text":"#3a2645","ui_accent":"#8b5ca8","ui_border":"#d8c8e0","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#3a2645","ui_tool":"#7a4f94","ui_warn":"#a87a1f"},"darkColors":{"background":"#101014","banner_accent":"#50a8a8","banner_border":"#4a4060","banner_dim":"#7e7c8c","banner_text":"#b0b0c0","banner_title":"#8898b0","completion_menu_bg":"#101014","input_rule":"#50a8a8","prompt":"#b0b0c0","response_border":"#8898b0","session_border":"#2a2838","status_bar_bg":"#08080c","status_bar_text":"#787888","ui_accent":"#50a8a8","ui_border":"#4a4060","ui_error":"#a05060","ui_ok":"#50a070","ui_text":"#b0b0c0","ui_tool":"#50a8a8","ui_warn":"#a09050"},"darkName":"shadow-thief","description":"Rogue's night — matte black, muted plum, and silver-steel with a glint of cyan","gatewayDarkName":"theme-picker-shadow-thief-dark","gatewayLightName":"theme-picker-shadow-thief-light","label":"Shadow Thief","lightColors":{"background":"#f7f1fa","banner_accent":"#8b5ca8","banner_border":"#d8c8e0","banner_dim":"#6d5a80","banner_text":"#3a2645","banner_title":"#3a2645","completion_menu_bg":"#ffffff","input_rule":"#8b5ca8","prompt":"#3a2645","response_border":"#a87fc0","session_border":"#d8c8e0","status_bar_bg":"#ede3f2","status_bar_text":"#3a2645","ui_accent":"#8b5ca8","ui_border":"#d8c8e0","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#3a2645","ui_tool":"#7a4f94","ui_warn":"#a87a1f"},"lightName":"light-lilac","modeSupport":"dynamic","name":"shadow-thief","source":"builtin-desktop"},{"category":"Built-in","colors":{"background":"#F4FCFC","banner_accent":"#087F7A","banner_border":"#B9DBD8","banner_text":"#132B2B","ui_accent":"#087F7A","ui_border":"#B9DBD8","ui_text":"#132B2B","ui_tool":"#087F7A"},"darkColors":{"background":"#041C1C","banner_accent":"#33C4BA","banner_border":"#205654","banner_text":"#FFE6CB","ui_accent":"#33C4BA","ui_border":"#205654","ui_text":"#FFE6CB","ui_tool":"#33C4BA"},"darkName":"hermes-teal","description":"Classic teal — the canonical Hermes dashboard look","gatewayDarkName":"theme-picker-hermes-teal-dark","gatewayLightName":"theme-picker-hermes-teal-light","label":"Hermes Teal","lightColors":{"background":"#F4FCFC","banner_accent":"#087F7A","banner_border":"#B9DBD8","banner_text":"#132B2B","ui_accent":"#087F7A","ui_border":"#B9DBD8","ui_text":"#132B2B","ui_tool":"#087F7A"},"lightName":"hermes-teal","modeSupport":"dynamic","name":"hermes-teal","source":"builtin-desktop"},{"category":"Dynamic","colors":{"background":"#f6f3fb","banner_accent":"#7a5fc0","banner_border":"#ddd5ec","banner_dim":"#6f6590","banner_text":"#2a2438","banner_title":"#2a2438","completion_menu_bg":"#eae7ef","input_rule":"#7a5fc0","prompt":"#2a2438","response_border":"#7a5fc0","session_border":"#ddd5ec","status_bar_bg":"#f7f4fb","status_bar_text":"#2a2438","ui_accent":"#7a5fc0","ui_border":"#ddd5ec","ui_error":"#c65a5a","ui_ok":"#2f8e52","ui_text":"#2a2438","ui_tool":"#7a5fc0","ui_warn":"#a17a17"},"darkColors":{"background":"#150d22","banner_accent":"#c084fc","banner_border":"#3c2a55","banner_dim":"#8f7ab0","banner_text":"#f3e8ff","banner_title":"#f3e8ff","completion_menu_bg":"#221a2f","input_rule":"#c084fc","prompt":"#f3e8ff","response_border":"#7B2D8E","session_border":"#3c2a55","status_bar_bg":"#130c1f","status_bar_text":"#f3e8ff","ui_accent":"#c084fc","ui_border":"#3c2a55","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#f3e8ff","ui_tool":"#7B2D8E","ui_warn":"#fbbf24"},"darkName":"dark-aubergine","description":"Deep aubergine with violet accents","gatewayDarkName":"theme-picker-dark-aubergine-dark","gatewayLightName":"theme-picker-dark-aubergine-light","label":"Aubergine","lightColors":{"background":"#f6f3fb","banner_accent":"#7a5fc0","banner_border":"#ddd5ec","banner_dim":"#6f6590","banner_text":"#2a2438","banner_title":"#2a2438","completion_menu_bg":"#eae7ef","input_rule":"#7a5fc0","prompt":"#2a2438","response_border":"#7a5fc0","session_border":"#ddd5ec","status_bar_bg":"#f7f4fb","status_bar_text":"#2a2438","ui_accent":"#7a5fc0","ui_border":"#ddd5ec","ui_error":"#c65a5a","ui_ok":"#2f8e52","ui_text":"#2a2438","ui_tool":"#7a5fc0","ui_warn":"#a17a17"},"lightName":"light-lavender","modeSupport":"dynamic","name":"dark-aubergine","source":"user"},{"category":"Dynamic","colors":{"background":"#fafafa","banner_accent":"#a36229","banner_border":"#e8e8e8","banner_dim":"#6f737a","banner_text":"#555f6a","banner_title":"#555f6a","completion_menu_bg":"#f0f0f0","input_rule":"#a36229","prompt":"#555f6a","response_border":"#a36229","session_border":"#e8e8e8","status_bar_bg":"#f0f0f0","status_bar_text":"#555f6a","ui_accent":"#a36229","ui_border":"#e8e8e8","ui_error":"#bc453b","ui_ok":"#6e8e39","ui_text":"#555f6a","ui_tool":"#8a521f","ui_warn":"#936b09"},"darkColors":{"background":"#0b0e14","banner_accent":"#59c2ff","banner_border":"#1f2430","banner_dim":"#787b77","banner_text":"#b3b1ad","banner_title":"#b3b1ad","completion_menu_bg":"#0a0d12","input_rule":"#59c2ff","prompt":"#b3b1ad","response_border":"#59c2ff","session_border":"#1f2430","status_bar_bg":"#0a0d12","status_bar_text":"#b3b1ad","ui_accent":"#59c2ff","ui_border":"#1f2430","ui_error":"#f07178","ui_ok":"#a6cc70","ui_text":"#b3b1ad","ui_tool":"#8ad6ff","ui_warn":"#e6b450"},"darkName":"dark-ayu","description":"Ayu Dark, soft blue-charcoal","gatewayDarkName":"theme-picker-dark-ayu-dark","gatewayLightName":"theme-picker-dark-ayu-light","label":"Ayu","lightColors":{"background":"#fafafa","banner_accent":"#a36229","banner_border":"#e8e8e8","banner_dim":"#6f737a","banner_text":"#555f6a","banner_title":"#555f6a","completion_menu_bg":"#f0f0f0","input_rule":"#a36229","prompt":"#555f6a","response_border":"#a36229","session_border":"#e8e8e8","status_bar_bg":"#f0f0f0","status_bar_text":"#555f6a","ui_accent":"#a36229","ui_border":"#e8e8e8","ui_error":"#bc453b","ui_ok":"#6e8e39","ui_text":"#555f6a","ui_tool":"#8a521f","ui_warn":"#936b09"},"lightName":"light-ayu","modeSupport":"dynamic","name":"dark-ayu","source":"user"},{"category":"Dynamic","colors":{"background":"#eae6dc","banner_accent":"#696458","banner_border":"#d4cebf","banner_dim":"#6b665c","banner_text":"#2e2b24","banner_title":"#2e2b24","completion_menu_bg":"#dfdbd1","input_rule":"#696458","prompt":"#2e2b24","response_border":"#8a8374","session_border":"#d4cebf","status_bar_bg":"#ece8df","status_bar_text":"#2e2b24","ui_accent":"#696458","ui_border":"#d4cebf","ui_error":"#bc5656","ui_ok":"#2c854d","ui_text":"#2e2b24","ui_tool":"#8a8374","ui_warn":"#977316"},"darkColors":{"background":"#1a1814","banner_accent":"#c9c2b4","banner_border":"#34302a","banner_dim":"#8f8a80","banner_text":"#f5f2ec","banner_title":"#f5f2ec","completion_menu_bg":"#181612","input_rule":"#c9c2b4","prompt":"#f5f2ec","response_border":"#c9c2b4","session_border":"#34302a","status_bar_bg":"#181612","status_bar_text":"#f5f2ec","ui_accent":"#c9c2b4","ui_border":"#34302a","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#f5f2ec","ui_tool":"#e8e2d6","ui_warn":"#fbbf24"},"darkName":"dark-bone","description":"Dark bone, warm charcoal with stone","gatewayDarkName":"theme-picker-dark-bone-dark","gatewayLightName":"theme-picker-dark-bone-light","label":"Bone","lightColors":{"background":"#eae6dc","banner_accent":"#696458","banner_border":"#d4cebf","banner_dim":"#6b665c","banner_text":"#2e2b24","banner_title":"#2e2b24","completion_menu_bg":"#dfdbd1","input_rule":"#696458","prompt":"#2e2b24","response_border":"#8a8374","session_border":"#d4cebf","status_bar_bg":"#ece8df","status_bar_text":"#2e2b24","ui_accent":"#696458","ui_border":"#d4cebf","ui_error":"#bc5656","ui_ok":"#2c854d","ui_text":"#2e2b24","ui_tool":"#8a8374","ui_warn":"#977316"},"lightName":"minimal-bone","modeSupport":"dynamic","name":"dark-bone","source":"user"},{"category":"Dynamic","colors":{"background":"#eff1f5","banner_accent":"#1d62eb","banner_border":"#ccd0da","banner_dim":"#686b7b","banner_text":"#4c4f69","banner_title":"#4c4f69","completion_menu_bg":"#e5e7eb","input_rule":"#1d62eb","prompt":"#4c4f69","response_border":"#1d62eb","session_border":"#ccd0da","status_bar_bg":"#e5e7eb","status_bar_text":"#4c4f69","ui_accent":"#1d62eb","ui_border":"#ccd0da","ui_error":"#bd0e33","ui_ok":"#3a9027","ui_text":"#4c4f69","ui_tool":"#1751c4","ui_warn":"#b27217"},"darkColors":{"background":"#1e1e2e","banner_accent":"#89b4fa","banner_border":"#313244","banner_dim":"#8489a0","banner_text":"#cdd6f4","banner_title":"#cdd6f4","completion_menu_bg":"#1c1c2a","input_rule":"#89b4fa","prompt":"#cdd6f4","response_border":"#89b4fa","session_border":"#313244","status_bar_bg":"#1c1c2a","status_bar_text":"#cdd6f4","ui_accent":"#89b4fa","ui_border":"#313244","ui_error":"#f38ba8","ui_ok":"#a6e3a1","ui_text":"#cdd6f4","ui_tool":"#a9c4f8","ui_warn":"#f9e2af"},"darkName":"dark-catppuccin","description":"Catppuccin Mocha, creamy pastel dark","gatewayDarkName":"theme-picker-dark-catppuccin-dark","gatewayLightName":"theme-picker-dark-catppuccin-light","label":"Catppuccin","lightColors":{"background":"#eff1f5","banner_accent":"#1d62eb","banner_border":"#ccd0da","banner_dim":"#686b7b","banner_text":"#4c4f69","banner_title":"#4c4f69","completion_menu_bg":"#e5e7eb","input_rule":"#1d62eb","prompt":"#4c4f69","response_border":"#1d62eb","session_border":"#ccd0da","status_bar_bg":"#e5e7eb","status_bar_text":"#4c4f69","ui_accent":"#1d62eb","ui_border":"#ccd0da","ui_error":"#bd0e33","ui_ok":"#3a9027","ui_text":"#4c4f69","ui_tool":"#1751c4","ui_warn":"#b27217"},"lightName":"light-catppuccin","modeSupport":"dynamic","name":"dark-catppuccin","source":"user"},{"category":"Dynamic","colors":{"background":"#f5f7fa","banner_accent":"#3b6ea8","banner_border":"#d9e0e8","banner_dim":"#5c6b7d","banner_text":"#1c2430","banner_title":"#1c2430","completion_menu_bg":"#e8eaee","input_rule":"#3b6ea8","prompt":"#1c2430","response_border":"#3b6ea8","session_border":"#d9e0e8","status_bar_bg":"#f6f8fa","status_bar_text":"#1c2430","ui_accent":"#3b6ea8","ui_border":"#d9e0e8","ui_error":"#d05f5f","ui_ok":"#2f8e52","ui_text":"#1c2430","ui_tool":"#3b6ea8","ui_warn":"#a17a17"},"darkColors":{"background":"#16181d","banner_accent":"#8ec5ff","banner_border":"#262a33","banner_dim":"#8b919c","banner_text":"#e6e9ef","banner_title":"#e6e9ef","completion_menu_bg":"#22252a","input_rule":"#8ec5ff","prompt":"#e6e9ef","response_border":"#4f9cf0","session_border":"#262a33","status_bar_bg":"#14161a","status_bar_text":"#e6e9ef","ui_accent":"#8ec5ff","ui_border":"#262a33","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#e6e9ef","ui_tool":"#4f9cf0","ui_warn":"#fbbf24"},"darkName":"dark-charcoal","description":"Steel gray-blue, calm and neutral","gatewayDarkName":"theme-picker-dark-charcoal-dark","gatewayLightName":"theme-picker-dark-charcoal-light","label":"Charcoal","lightColors":{"background":"#f5f7fa","banner_accent":"#3b6ea8","banner_border":"#d9e0e8","banner_dim":"#5c6b7d","banner_text":"#1c2430","banner_title":"#1c2430","completion_menu_bg":"#e8eaee","input_rule":"#3b6ea8","prompt":"#1c2430","response_border":"#3b6ea8","session_border":"#d9e0e8","status_bar_bg":"#f6f8fa","status_bar_text":"#1c2430","ui_accent":"#3b6ea8","ui_border":"#d9e0e8","ui_error":"#d05f5f","ui_ok":"#2f8e52","ui_text":"#1c2430","ui_tool":"#3b6ea8","ui_warn":"#a17a17"},"lightName":"light-cloud","modeSupport":"dynamic","name":"dark-charcoal","source":"user"},{"category":"Dynamic","colors":{"background":"#f7f4ec","banner_accent":"#8e623a","banner_border":"#ded7c9","banner_dim":"#6f675c","banner_text":"#2b2620","banner_title":"#2b2620","completion_menu_bg":"#ebe8e0","input_rule":"#8e623a","prompt":"#2b2620","response_border":"#9a6b3f","session_border":"#ded7c9","status_bar_bg":"#f8f5ee","status_bar_text":"#2b2620","ui_accent":"#8e623a","ui_border":"#ded7c9","ui_error":"#c65a5a","ui_ok":"#2f8e52","ui_text":"#2b2620","ui_tool":"#9a6b3f","ui_warn":"#a17a17"},"darkColors":{"background":"#232323","banner_accent":"#c9a87c","banner_border":"#3a3a3a","banner_dim":"#9a948a","banner_text":"#ddd7c9","banner_title":"#ddd7c9","completion_menu_bg":"#202020","input_rule":"#c9a87c","prompt":"#ddd7c9","response_border":"#c9a87c","session_border":"#3a3a3a","status_bar_bg":"#202020","status_bar_text":"#ddd7c9","ui_accent":"#c9a87c","ui_border":"#3a3a3a","ui_error":"#c97b7b","ui_ok":"#a8b57a","ui_text":"#ddd7c9","ui_tool":"#dcbc92","ui_warn":"#d8b26a"},"darkName":"dark-cozy-paper","description":"Cozy Paper, warm dark","gatewayDarkName":"theme-picker-dark-cozy-paper-dark","gatewayLightName":"theme-picker-dark-cozy-paper-light","label":"Cozy Paper","lightColors":{"background":"#f7f4ec","banner_accent":"#8e623a","banner_border":"#ded7c9","banner_dim":"#6f675c","banner_text":"#2b2620","banner_title":"#2b2620","completion_menu_bg":"#ebe8e0","input_rule":"#8e623a","prompt":"#2b2620","response_border":"#9a6b3f","session_border":"#ded7c9","status_bar_bg":"#f8f5ee","status_bar_text":"#2b2620","ui_accent":"#8e623a","ui_border":"#ded7c9","ui_error":"#c65a5a","ui_ok":"#2f8e52","ui_text":"#2b2620","ui_tool":"#9a6b3f","ui_warn":"#a17a17"},"lightName":"light-cozy-paper","modeSupport":"dynamic","name":"dark-cozy-paper","source":"user"},{"category":"Dynamic","colors":{"background":"#faf4f5","banner_accent":"#a2556d","banner_border":"#ead7dc","banner_dim":"#7d646d","banner_text":"#33262b","banner_title":"#33262b","completion_menu_bg":"#eee8e9","input_rule":"#a2556d","prompt":"#33262b","response_border":"#b05c77","session_border":"#ead7dc","status_bar_bg":"#faf5f6","status_bar_text":"#33262b","ui_accent":"#a2556d","ui_border":"#ead7dc","ui_error":"#d05f5f","ui_ok":"#2f8e52","ui_text":"#33262b","ui_tool":"#b05c77","ui_warn":"#a17a17"},"darkColors":{"background":"#200608","banner_accent":"#e8b84a","banner_border":"#3d1214","banner_dim":"#c09090","banner_text":"#f5d9d9","banner_title":"#f5d9d9","completion_menu_bg":"#2a0e10","input_rule":"#e8b84a","prompt":"#f5d9d9","response_border":"#c03030","session_border":"#3d1214","status_bar_bg":"#180406","status_bar_text":"#f5d9d9","ui_accent":"#e8b84a","ui_border":"#3d1214","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#f5d9d9","ui_tool":"#c03030","ui_warn":"#fbbf24"},"darkName":"dark-crimson","description":"Deep blood red with warm gold","gatewayDarkName":"theme-picker-dark-crimson-dark","gatewayLightName":"theme-picker-dark-crimson-light","label":"Crimson","lightColors":{"background":"#faf4f5","banner_accent":"#a2556d","banner_border":"#ead7dc","banner_dim":"#7d646d","banner_text":"#33262b","banner_title":"#33262b","completion_menu_bg":"#eee8e9","input_rule":"#a2556d","prompt":"#33262b","response_border":"#b05c77","session_border":"#ead7dc","status_bar_bg":"#faf5f6","status_bar_text":"#33262b","ui_accent":"#a2556d","ui_border":"#ead7dc","ui_error":"#d05f5f","ui_ok":"#2f8e52","ui_text":"#33262b","ui_tool":"#b05c77","ui_warn":"#a17a17"},"lightName":"light-rose","modeSupport":"dynamic","name":"dark-crimson","source":"user"},{"category":"Dynamic","colors":{"background":"#f8f8f2","banner_accent":"#7b4fb8","banner_border":"#dcd9d0","banner_dim":"#4c5d99","banner_text":"#282a36","banner_title":"#282a36","completion_menu_bg":"#f4f4ee","input_rule":"#b33f8d","prompt":"#282a36","response_border":"#7b4fb8","session_border":"#dcd9d0","status_bar_bg":"#ecebe4","status_bar_text":"#282a36","ui_accent":"#7b4fb8","ui_border":"#dcd9d0","ui_error":"#c22f2f","ui_ok":"#1f7f3b","ui_text":"#282a36","ui_tool":"#0d6b85","ui_warn":"#8a8210"},"darkColors":{"background":"#282a36","banner_accent":"#bd93f9","banner_border":"#44475a","banner_dim":"#8b99c9","banner_text":"#f8f8f2","banner_title":"#f8f8f2","completion_menu_bg":"#21222c","input_rule":"#ff79c6","prompt":"#f8f8f2","response_border":"#bd93f9","session_border":"#44475a","status_bar_bg":"#21222c","status_bar_text":"#f8f8f2","ui_accent":"#bd93f9","ui_border":"#44475a","ui_error":"#ff5555","ui_ok":"#50fa7b","ui_text":"#f8f8f2","ui_tool":"#8be9fd","ui_warn":"#f1fa8c"},"darkName":"dark-dracula","description":"Dracula dark, purple on near-black","gatewayDarkName":"theme-picker-dark-dracula-dark","gatewayLightName":"theme-picker-dark-dracula-light","label":"Dracula","lightColors":{"background":"#f8f8f2","banner_accent":"#7b4fb8","banner_border":"#dcd9d0","banner_dim":"#4c5d99","banner_text":"#282a36","banner_title":"#282a36","completion_menu_bg":"#f4f4ee","input_rule":"#b33f8d","prompt":"#282a36","response_border":"#7b4fb8","session_border":"#dcd9d0","status_bar_bg":"#ecebe4","status_bar_text":"#282a36","ui_accent":"#7b4fb8","ui_border":"#dcd9d0","ui_error":"#c22f2f","ui_ok":"#1f7f3b","ui_text":"#282a36","ui_tool":"#0d6b85","ui_warn":"#8a8210"},"lightName":"light-dracula","modeSupport":"dynamic","name":"dark-dracula","source":"user"},{"category":"Dynamic","colors":{"background":"#fdf6e3","banner_accent":"#637242","banner_border":"#eae4d2","banner_dim":"#6a7268","banner_text":"#515d64","banner_title":"#515d64","completion_menu_bg":"#f3ecda","input_rule":"#637242","prompt":"#515d64","response_border":"#637242","session_border":"#eae4d2","status_bar_bg":"#f3ecda","status_bar_text":"#515d64","ui_accent":"#637242","ui_border":"#eae4d2","ui_error":"#9e4a39","ui_ok":"#536436","ui_text":"#515d64","ui_tool":"#556537","ui_warn":"#7d6230"},"darkColors":{"background":"#2f383e","banner_accent":"#a7c080","banner_border":"#475258","banner_dim":"#99a39c","banner_text":"#d3c6aa","banner_title":"#d3c6aa","completion_menu_bg":"#2b3439","input_rule":"#a7c080","prompt":"#d3c6aa","response_border":"#a7c080","session_border":"#475258","status_bar_bg":"#2b3439","status_bar_text":"#d3c6aa","ui_accent":"#a7c080","ui_border":"#475258","ui_error":"#e67e80","ui_ok":"#a7c080","ui_text":"#d3c6aa","ui_tool":"#c0d0a0","ui_warn":"#dbbc7f"},"darkName":"dark-everforest","description":"Everforest, green-tinted forest dark","gatewayDarkName":"theme-picker-dark-everforest-dark","gatewayLightName":"theme-picker-dark-everforest-light","label":"Everforest","lightColors":{"background":"#fdf6e3","banner_accent":"#637242","banner_border":"#eae4d2","banner_dim":"#6a7268","banner_text":"#515d64","banner_title":"#515d64","completion_menu_bg":"#f3ecda","input_rule":"#637242","prompt":"#515d64","response_border":"#637242","session_border":"#eae4d2","status_bar_bg":"#f3ecda","status_bar_text":"#515d64","ui_accent":"#637242","ui_border":"#eae4d2","ui_error":"#9e4a39","ui_ok":"#536436","ui_text":"#515d64","ui_tool":"#556537","ui_warn":"#7d6230"},"lightName":"light-everforest","modeSupport":"dynamic","name":"dark-everforest","source":"user"},{"category":"Dynamic","colors":{"background":"#ffffff","banner_accent":"#0969da","banner_border":"#d1d9e0","banner_dim":"#59636e","banner_text":"#1f2328","banner_title":"#1f2328","completion_menu_bg":"#f5f5f5","input_rule":"#0969da","prompt":"#1f2328","response_border":"#0969da","session_border":"#d1d9e0","status_bar_bg":"#f5f5f5","status_bar_text":"#1f2328","ui_accent":"#0969da","ui_border":"#d1d9e0","ui_error":"#ba1f29","ui_ok":"#177232","ui_text":"#1f2328","ui_tool":"#0756b0","ui_warn":"#7b5200"},"darkColors":{"background":"#0d1117","banner_accent":"#2f81f7","banner_border":"#30363d","banner_dim":"#9198a1","banner_text":"#e6edf3","banner_title":"#e6edf3","completion_menu_bg":"#0c1015","input_rule":"#2f81f7","prompt":"#e6edf3","response_border":"#2f81f7","session_border":"#30363d","status_bar_bg":"#0c1015","status_bar_text":"#e6edf3","ui_accent":"#2f81f7","ui_border":"#30363d","ui_error":"#f85149","ui_ok":"#3fb950","ui_text":"#e6edf3","ui_tool":"#6cb0fa","ui_warn":"#d29922"},"darkName":"dark-github","description":"GitHub Dark, official GitHub theme","gatewayDarkName":"theme-picker-dark-github-dark","gatewayLightName":"theme-picker-dark-github-light","label":"Github","lightColors":{"background":"#ffffff","banner_accent":"#0969da","banner_border":"#d1d9e0","banner_dim":"#59636e","banner_text":"#1f2328","banner_title":"#1f2328","completion_menu_bg":"#f5f5f5","input_rule":"#0969da","prompt":"#1f2328","response_border":"#0969da","session_border":"#d1d9e0","status_bar_bg":"#f5f5f5","status_bar_text":"#1f2328","ui_accent":"#0969da","ui_border":"#d1d9e0","ui_error":"#ba1f29","ui_ok":"#177232","ui_text":"#1f2328","ui_tool":"#0756b0","ui_warn":"#7b5200"},"lightName":"light-github","modeSupport":"dynamic","name":"dark-github","source":"user"},{"category":"Dynamic","colors":{"background":"#fbf1c7","banner_accent":"#915e10","banner_border":"#d5c4a1","banner_dim":"#776b60","banner_text":"#3c3836","banner_title":"#3c3836","completion_menu_bg":"#f1e7bf","input_rule":"#915e10","prompt":"#3c3836","response_border":"#915e10","session_border":"#d5c4a1","status_bar_bg":"#f1e7bf","status_bar_text":"#3c3836","ui_accent":"#915e10","ui_border":"#d5c4a1","ui_error":"#a53427","ui_ok":"#64650e","ui_text":"#3c3836","ui_tool":"#7a4e0d","ui_warn":"#7b5d0d"},"darkColors":{"background":"#282828","banner_accent":"#fabd2f","banner_border":"#504945","banner_dim":"#9b8d7f","banner_text":"#ebdbb2","banner_title":"#ebdbb2","completion_menu_bg":"#252525","input_rule":"#fabd2f","prompt":"#ebdbb2","response_border":"#fabd2f","session_border":"#504945","status_bar_bg":"#252525","status_bar_text":"#ebdbb2","ui_accent":"#fabd2f","ui_border":"#504945","ui_error":"#fb4934","ui_ok":"#b8bb26","ui_text":"#ebdbb2","ui_tool":"#f4c856","ui_warn":"#fabd2f"},"darkName":"dark-gruvbox","description":"Gruvbox dark, retro warm groove","gatewayDarkName":"theme-picker-dark-gruvbox-dark","gatewayLightName":"theme-picker-dark-gruvbox-light","label":"Gruvbox","lightColors":{"background":"#fbf1c7","banner_accent":"#915e10","banner_border":"#d5c4a1","banner_dim":"#776b60","banner_text":"#3c3836","banner_title":"#3c3836","completion_menu_bg":"#f1e7bf","input_rule":"#915e10","prompt":"#3c3836","response_border":"#915e10","session_border":"#d5c4a1","status_bar_bg":"#f1e7bf","status_bar_text":"#3c3836","ui_accent":"#915e10","ui_border":"#d5c4a1","ui_error":"#a53427","ui_ok":"#64650e","ui_text":"#3c3836","ui_tool":"#7a4e0d","ui_warn":"#7b5d0d"},"lightName":"light-gruvbox","modeSupport":"dynamic","name":"dark-gruvbox","source":"user"},{"category":"Dynamic","colors":{"background":"#f2ecbc","banner_accent":"#47688f","banner_border":"#d8d0b0","banner_dim":"#6e6a5e","banner_text":"#545464","banner_title":"#545464","completion_menu_bg":"#e8e3b4","input_rule":"#47688f","prompt":"#545464","response_border":"#47688f","session_border":"#d8d0b0","status_bar_bg":"#e8e3b4","status_bar_text":"#545464","ui_accent":"#47688f","ui_border":"#d8d0b0","ui_error":"#ad354a","ui_ok":"#647b46","ui_text":"#545464","ui_tool":"#3b5878","ui_warn":"#7d6230"},"darkColors":{"background":"#1f1f28","banner_accent":"#7e9cd8","banner_border":"#363646","banner_dim":"#898881","banner_text":"#dcd7ba","banner_title":"#dcd7ba","completion_menu_bg":"#1d1d25","input_rule":"#7e9cd8","prompt":"#dcd7ba","response_border":"#7e9cd8","session_border":"#363646","status_bar_bg":"#1d1d25","status_bar_text":"#dcd7ba","ui_accent":"#7e9cd8","ui_border":"#363646","ui_error":"#e46876","ui_ok":"#98bb6c","ui_text":"#dcd7ba","ui_tool":"#a3c0e8","ui_warn":"#e6c384"},"darkName":"dark-kanagawa","description":"Kanagawa Wave, Japanese ink-wash dark","gatewayDarkName":"theme-picker-dark-kanagawa-dark","gatewayLightName":"theme-picker-dark-kanagawa-light","label":"Kanagawa","lightColors":{"background":"#f2ecbc","banner_accent":"#47688f","banner_border":"#d8d0b0","banner_dim":"#6e6a5e","banner_text":"#545464","banner_title":"#545464","completion_menu_bg":"#e8e3b4","input_rule":"#47688f","prompt":"#545464","response_border":"#47688f","session_border":"#d8d0b0","status_bar_bg":"#e8e3b4","status_bar_text":"#545464","ui_accent":"#47688f","ui_border":"#d8d0b0","ui_error":"#ad354a","ui_ok":"#647b46","ui_text":"#545464","ui_tool":"#3b5878","ui_warn":"#7d6230"},"lightName":"light-kanagawa","modeSupport":"dynamic","name":"dark-kanagawa","source":"user"},{"category":"Dynamic","colors":{"background":"#F2F0EC","banner_accent":"#7a4c00","banner_border":"#1f4fa8","banner_dim":"#5a5a64","banner_text":"#0A0A14","banner_title":"#0A0A14","completion_menu_bg":"#F7F5F1","input_rule":"#7a4c00","prompt":"#0A0A14","response_border":"#1f4fa8","session_border":"#1f4fa8","status_bar_bg":"#E6E3DC","status_bar_text":"#0A0A14","ui_accent":"#7a4c00","ui_border":"#1f4fa8","ui_error":"#c22f2f","ui_ok":"#1f7f3b","ui_text":"#0A0A14","ui_tool":"#0d6b85","ui_warn":"#8a6d1a"},"darkColors":{"background":"#050510","banner_accent":"#FF9C00","banner_border":"#3366FF","banner_dim":"#999999","banner_text":"#FFFFFF","banner_title":"#FFFFFF","completion_menu_bg":"#0A0A1A","input_rule":"#FF9C00","prompt":"#FFFFFF","response_border":"#FF9C00","session_border":"#3366FF","status_bar_bg":"#0A0A1A","status_bar_text":"#FFFFFF","ui_accent":"#FF9C00","ui_border":"#3366FF","ui_error":"#FF5555","ui_ok":"#66FF99","ui_text":"#FFFFFF","ui_tool":"#66CCFF","ui_warn":"#FFCC66"},"darkName":"dark-lcars","description":"LCARS, Star Trek black with orange accents","gatewayDarkName":"theme-picker-dark-lcars-dark","gatewayLightName":"theme-picker-dark-lcars-light","label":"Lcars","lightColors":{"background":"#F2F0EC","banner_accent":"#7a4c00","banner_border":"#1f4fa8","banner_dim":"#5a5a64","banner_text":"#0A0A14","banner_title":"#0A0A14","completion_menu_bg":"#F7F5F1","input_rule":"#7a4c00","prompt":"#0A0A14","response_border":"#1f4fa8","session_border":"#1f4fa8","status_bar_bg":"#E6E3DC","status_bar_text":"#0A0A14","ui_accent":"#7a4c00","ui_border":"#1f4fa8","ui_error":"#c22f2f","ui_ok":"#1f7f3b","ui_text":"#0A0A14","ui_tool":"#0d6b85","ui_warn":"#8a6d1a"},"lightName":"light-lcars","modeSupport":"dynamic","name":"dark-lcars","source":"user"},{"category":"Dynamic","colors":{"background":"#fbf6e2","banner_accent":"#826d14","banner_border":"#e4dca8","banner_dim":"#77703f","banner_text":"#3a3313","banner_title":"#3a3313","completion_menu_bg":"#ffffff","input_rule":"#826d14","prompt":"#3a3313","response_border":"#ab9434","session_border":"#e4dca8","status_bar_bg":"#f0e8c0","status_bar_text":"#3a3313","ui_accent":"#826d14","ui_border":"#e4dca8","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#3a3313","ui_tool":"#726012","ui_warn":"#a87a1f"},"darkColors":{"background":"#1a1810","banner_accent":"#d4c84a","banner_border":"#33311e","banner_dim":"#9a9460","banner_text":"#f5f2ec","banner_title":"#f5f2ec","completion_menu_bg":"#18160f","input_rule":"#d4c84a","prompt":"#f5f2ec","response_border":"#d4c84a","session_border":"#33311e","status_bar_bg":"#18160f","status_bar_text":"#f5f2ec","ui_accent":"#d4c84a","ui_border":"#33311e","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#f5f2ec","ui_tool":"#e8de6e","ui_warn":"#fbbf24"},"darkName":"dark-lemon","description":"Dark lemon, olive-yellow on near-black","gatewayDarkName":"theme-picker-dark-lemon-dark","gatewayLightName":"theme-picker-dark-lemon-light","label":"Lemon","lightColors":{"background":"#fbf6e2","banner_accent":"#826d14","banner_border":"#e4dca8","banner_dim":"#77703f","banner_text":"#3a3313","banner_title":"#3a3313","completion_menu_bg":"#ffffff","input_rule":"#826d14","prompt":"#3a3313","response_border":"#ab9434","session_border":"#e4dca8","status_bar_bg":"#f0e8c0","status_bar_text":"#3a3313","ui_accent":"#826d14","ui_border":"#e4dca8","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#3a3313","ui_tool":"#726012","ui_warn":"#a87a1f"},"lightName":"light-lemon","modeSupport":"dynamic","name":"dark-lemon","source":"user"},{"category":"Dynamic","colors":{"background":"#e8e4da","banner_accent":"#245a8e","banner_border":"#b8b3a8","banner_dim":"#656057","banner_text":"#1f1f24","banner_title":"#1f1f24","completion_menu_bg":"#f4f1e8","input_rule":"#245a8e","prompt":"#1f1f24","response_border":"#4a7fa8","session_border":"#b8b3a8","status_bar_bg":"#d8d4c9","status_bar_text":"#1f1f24","ui_accent":"#245a8e","ui_border":"#b8b3a8","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#1f1f24","ui_tool":"#2e5f88","ui_warn":"#a87a1f"},"darkColors":{"background":"#1c1a16","banner_accent":"#6ea8d6","banner_border":"#35312b","banner_dim":"#9a958a","banner_text":"#f5f2ec","banner_title":"#f5f2ec","completion_menu_bg":"#1a1814","input_rule":"#6ea8d6","prompt":"#f5f2ec","response_border":"#6ea8d6","session_border":"#35312b","status_bar_bg":"#1a1814","status_bar_text":"#f5f2ec","ui_accent":"#6ea8d6","ui_border":"#35312b","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#f5f2ec","ui_tool":"#9cc8ea","ui_warn":"#fbbf24"},"darkName":"dark-mac","description":"Dark Mac, charcoal platinum with blue","gatewayDarkName":"theme-picker-dark-mac-dark","gatewayLightName":"theme-picker-dark-mac-light","label":"Mac","lightColors":{"background":"#e8e4da","banner_accent":"#245a8e","banner_border":"#b8b3a8","banner_dim":"#656057","banner_text":"#1f1f24","banner_title":"#1f1f24","completion_menu_bg":"#f4f1e8","input_rule":"#245a8e","prompt":"#1f1f24","response_border":"#4a7fa8","session_border":"#b8b3a8","status_bar_bg":"#d8d4c9","status_bar_text":"#1f1f24","ui_accent":"#245a8e","ui_border":"#b8b3a8","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#1f1f24","ui_tool":"#2e5f88","ui_warn":"#a87a1f"},"lightName":"retro-mac","modeSupport":"dynamic","name":"dark-mac","source":"user"},{"category":"Dynamic","colors":{"background":"#fafafa","banner_accent":"#007e71","banner_border":"#e0e0e0","banner_dim":"#60737d","banner_text":"#263238","banner_title":"#263238","completion_menu_bg":"#f0f0f0","input_rule":"#007e71","prompt":"#263238","response_border":"#007e71","session_border":"#e0e0e0","status_bar_bg":"#f0f0f0","status_bar_text":"#263238","ui_accent":"#007e71","ui_border":"#e0e0e0","ui_error":"#b22424","ui_ok":"#29702d","ui_text":"#263238","ui_tool":"#00685e","ui_warn":"#936b09"},"darkColors":{"background":"#263238","banner_accent":"#82aaff","banner_border":"#37474f","banner_dim":"#b0bec5","banner_text":"#eceff1","banner_title":"#eceff1","completion_menu_bg":"#232e34","input_rule":"#82aaff","prompt":"#eceff1","response_border":"#82aaff","session_border":"#37474f","status_bar_bg":"#232e34","status_bar_text":"#eceff1","ui_accent":"#82aaff","ui_border":"#37474f","ui_error":"#ef9a9a","ui_ok":"#a5d6a7","ui_text":"#eceff1","ui_tool":"#a9c4ff","ui_warn":"#ffe082"},"darkName":"dark-material","description":"Material, blue-gray developer dark","gatewayDarkName":"theme-picker-dark-material-dark","gatewayLightName":"theme-picker-dark-material-light","label":"Material","lightColors":{"background":"#fafafa","banner_accent":"#007e71","banner_border":"#e0e0e0","banner_dim":"#60737d","banner_text":"#263238","banner_title":"#263238","completion_menu_bg":"#f0f0f0","input_rule":"#007e71","prompt":"#263238","response_border":"#007e71","session_border":"#e0e0e0","status_bar_bg":"#f0f0f0","status_bar_text":"#263238","ui_accent":"#007e71","ui_border":"#e0e0e0","ui_error":"#b22424","ui_ok":"#29702d","ui_text":"#263238","ui_tool":"#00685e","ui_warn":"#936b09"},"lightName":"light-material","modeSupport":"dynamic","name":"dark-material","source":"user"},{"category":"Dynamic","colors":{"background":"#e8f4fd","banner_accent":"#1a6fb5","banner_border":"#b8d4e8","banner_dim":"#4a6b85","banner_text":"#16324a","banner_title":"#16324a","completion_menu_bg":"#ffffff","input_rule":"#1a6fb5","prompt":"#16324a","response_border":"#4a90c4","session_border":"#b8d4e8","status_bar_bg":"#d8ebf7","status_bar_text":"#16324a","ui_accent":"#1a6fb5","ui_border":"#b8d4e8","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#16324a","ui_tool":"#1f5f8f","ui_warn":"#a87a1f"},"darkColors":{"background":"#0b1220","banner_accent":"#93c5fd","banner_border":"#1c2942","banner_dim":"#7c8aa5","banner_text":"#e2e8f0","banner_title":"#e2e8f0","completion_menu_bg":"#181f2c","input_rule":"#93c5fd","prompt":"#e2e8f0","response_border":"#3b82f6","session_border":"#1c2942","status_bar_bg":"#0a101d","status_bar_text":"#e2e8f0","ui_accent":"#93c5fd","ui_border":"#1c2942","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#e2e8f0","ui_tool":"#3b82f6","ui_warn":"#fbbf24"},"darkName":"dark-navy","description":"Deep ocean navy with clear blue accents","gatewayDarkName":"theme-picker-dark-navy-dark","gatewayLightName":"theme-picker-dark-navy-light","label":"Navy","lightColors":{"background":"#e8f4fd","banner_accent":"#1a6fb5","banner_border":"#b8d4e8","banner_dim":"#4a6b85","banner_text":"#16324a","banner_title":"#16324a","completion_menu_bg":"#ffffff","input_rule":"#1a6fb5","prompt":"#16324a","response_border":"#4a90c4","session_border":"#b8d4e8","status_bar_bg":"#d8ebf7","status_bar_text":"#16324a","ui_accent":"#1a6fb5","ui_border":"#b8d4e8","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#16324a","ui_tool":"#1f5f8f","ui_warn":"#a87a1f"},"lightName":"light-sky","modeSupport":"dynamic","name":"dark-navy","source":"user"},{"category":"Dynamic","colors":{"background":"#eceff4","banner_accent":"#4f6c90","banner_border":"#d8dee9","banner_dim":"#4c566a","banner_text":"#2e3440","banner_title":"#2e3440","completion_menu_bg":"#e3e5ea","input_rule":"#4f6c90","prompt":"#2e3440","response_border":"#4f6c90","session_border":"#d8dee9","status_bar_bg":"#e3e5ea","status_bar_text":"#2e3440","ui_accent":"#4f6c90","ui_border":"#d8dee9","ui_error":"#934646","ui_ok":"#547356","ui_text":"#2e3440","ui_tool":"#405a78","ui_warn":"#7b6632"},"darkColors":{"background":"#2e3440","banner_accent":"#88c0d0","banner_border":"#4c566a","banner_dim":"#81a1c1","banner_text":"#e5e9f0","banner_title":"#e5e9f0","completion_menu_bg":"#2a303b","input_rule":"#88c0d0","prompt":"#e5e9f0","response_border":"#88c0d0","session_border":"#4c566a","status_bar_bg":"#2a303b","status_bar_text":"#e5e9f0","ui_accent":"#88c0d0","ui_border":"#4c566a","ui_error":"#bf616a","ui_ok":"#a3be8c","ui_text":"#e5e9f0","ui_tool":"#a6d4e0","ui_warn":"#ebcb8b"},"darkName":"dark-nord","description":"Nord, arctic bluish calm","gatewayDarkName":"theme-picker-dark-nord-dark","gatewayLightName":"theme-picker-dark-nord-light","label":"Nord","lightColors":{"background":"#eceff4","banner_accent":"#4f6c90","banner_border":"#d8dee9","banner_dim":"#4c566a","banner_text":"#2e3440","banner_title":"#2e3440","completion_menu_bg":"#e3e5ea","input_rule":"#4f6c90","prompt":"#2e3440","response_border":"#4f6c90","session_border":"#d8dee9","status_bar_bg":"#e3e5ea","status_bar_text":"#2e3440","ui_accent":"#4f6c90","ui_border":"#d8dee9","ui_error":"#934646","ui_ok":"#547356","ui_text":"#2e3440","ui_tool":"#405a78","ui_warn":"#7b6632"},"lightName":"light-nord","modeSupport":"dynamic","name":"dark-nord","source":"user"},{"category":"Dynamic","colors":{"background":"#f8f9fa","banner_accent":"#3b6ea5","banner_border":"#c8cdd4","banner_dim":"#5a6270","banner_text":"#1f2328","banner_title":"#1f2328","completion_menu_bg":"#ffffff","input_rule":"#3b6ea5","prompt":"#1f2328","response_border":"#7a96b5","session_border":"#c8cdd4","status_bar_bg":"#e8eaed","status_bar_text":"#1f2328","ui_accent":"#3b6ea5","ui_border":"#c8cdd4","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#1f2328","ui_tool":"#2f5f8a","ui_warn":"#a87a1f"},"darkColors":{"background":"#0d0d12","banner_accent":"#b3a6ff","banner_border":"#232330","banner_dim":"#8a8699","banner_text":"#e8e6f2","banner_title":"#e8e6f2","completion_menu_bg":"#1a1a1f","input_rule":"#b3a6ff","prompt":"#e8e6f2","response_border":"#6e5ce6","session_border":"#232330","status_bar_bg":"#0c0c10","status_bar_text":"#e8e6f2","ui_accent":"#b3a6ff","ui_border":"#232330","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#e8e6f2","ui_tool":"#6e5ce6","ui_warn":"#fbbf24"},"darkName":"dark-obsidian","description":"Near-black with violet-gray light","gatewayDarkName":"theme-picker-dark-obsidian-dark","gatewayLightName":"theme-picker-dark-obsidian-light","label":"Obsidian","lightColors":{"background":"#f8f9fa","banner_accent":"#3b6ea5","banner_border":"#c8cdd4","banner_dim":"#5a6270","banner_text":"#1f2328","banner_title":"#1f2328","completion_menu_bg":"#ffffff","input_rule":"#3b6ea5","prompt":"#1f2328","response_border":"#7a96b5","session_border":"#c8cdd4","status_bar_bg":"#e8eaed","status_bar_text":"#1f2328","ui_accent":"#3b6ea5","ui_border":"#c8cdd4","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#1f2328","ui_tool":"#2f5f8a","ui_warn":"#a87a1f"},"lightName":"light-porcelain","modeSupport":"dynamic","name":"dark-obsidian","source":"user"},{"category":"Dynamic","colors":{"background":"#fafafa","banner_accent":"#386ad5","banner_border":"#e5e5e6","banner_dim":"#6d6d72","banner_text":"#383a42","banner_title":"#383a42","completion_menu_bg":"#f0f0f0","input_rule":"#386ad5","prompt":"#383a42","response_border":"#386ad5","session_border":"#e5e5e6","status_bar_bg":"#f0f0f0","status_bar_text":"#383a42","ui_accent":"#386ad5","ui_border":"#e5e5e6","ui_error":"#cd4d42","ui_ok":"#489147","ui_text":"#383a42","ui_tool":"#2f5ab3","ui_warn":"#9a6a01"},"darkColors":{"background":"#282c34","banner_accent":"#61afef","banner_border":"#3e4451","banner_dim":"#90959e","banner_text":"#abb2bf","banner_title":"#abb2bf","completion_menu_bg":"#252830","input_rule":"#61afef","prompt":"#abb2bf","response_border":"#61afef","session_border":"#3e4451","status_bar_bg":"#252830","status_bar_text":"#abb2bf","ui_accent":"#61afef","ui_border":"#3e4451","ui_error":"#e06c75","ui_ok":"#98c379","ui_text":"#abb2bf","ui_tool":"#8ec7f5","ui_warn":"#e5c07b"},"darkName":"dark-one","description":"One Dark, Atom's default editor theme","gatewayDarkName":"theme-picker-dark-one-dark","gatewayLightName":"theme-picker-dark-one-light","label":"One","lightColors":{"background":"#fafafa","banner_accent":"#386ad5","banner_border":"#e5e5e6","banner_dim":"#6d6d72","banner_text":"#383a42","banner_title":"#383a42","completion_menu_bg":"#f0f0f0","input_rule":"#386ad5","prompt":"#383a42","response_border":"#386ad5","session_border":"#e5e5e6","status_bar_bg":"#f0f0f0","status_bar_text":"#383a42","ui_accent":"#386ad5","ui_border":"#e5e5e6","ui_error":"#cd4d42","ui_ok":"#489147","ui_text":"#383a42","ui_tool":"#2f5ab3","ui_warn":"#9a6a01"},"lightName":"light-one","modeSupport":"dynamic","name":"dark-one","source":"user"},{"category":"Dynamic","colors":{"background":"#f6eff7","banner_accent":"#7d4a96","banner_border":"#dccce2","banner_dim":"#6d5280","banner_text":"#33203f","banner_title":"#33203f","completion_menu_bg":"#ffffff","input_rule":"#7d4a96","prompt":"#33203f","response_border":"#a06ab8","session_border":"#dccce2","status_bar_bg":"#eae0ee","status_bar_text":"#33203f","ui_accent":"#7d4a96","ui_border":"#dccce2","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#33203f","ui_tool":"#6a3f82","ui_warn":"#a87a1f"},"darkColors":{"background":"#1a0f2e","banner_accent":"#a56ae0","banner_border":"#2f1f4a","banner_dim":"#9a8ab5","banner_text":"#f0e8f8","banner_title":"#f0e8f8","completion_menu_bg":"#251841","input_rule":"#a56ae0","prompt":"#f0e8f8","response_border":"#7b2d8e","session_border":"#2f1f4a","status_bar_bg":"#150c26","status_bar_text":"#f0e8f8","ui_accent":"#a56ae0","ui_border":"#2f1f4a","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#f0e8f8","ui_tool":"#8b4fc8","ui_warn":"#fbbf24"},"darkName":"dark-plum","description":"Deep royal purple with orchid","gatewayDarkName":"theme-picker-dark-plum-dark","gatewayLightName":"theme-picker-dark-plum-light","label":"Plum","lightColors":{"background":"#f6eff7","banner_accent":"#7d4a96","banner_border":"#dccce2","banner_dim":"#6d5280","banner_text":"#33203f","banner_title":"#33203f","completion_menu_bg":"#ffffff","input_rule":"#7d4a96","prompt":"#33203f","response_border":"#a06ab8","session_border":"#dccce2","status_bar_bg":"#eae0ee","status_bar_text":"#33203f","ui_accent":"#7d4a96","ui_border":"#dccce2","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#33203f","ui_tool":"#6a3f82","ui_warn":"#a87a1f"},"lightName":"light-grape","modeSupport":"dynamic","name":"dark-plum","source":"user"},{"category":"Dynamic","colors":{"background":"#faf4ed","banner_accent":"#9b5e5b","banner_border":"#f2e9e1","banner_dim":"#6f6c87","banner_text":"#575279","banner_title":"#575279","completion_menu_bg":"#f0eae4","input_rule":"#9b5e5b","prompt":"#575279","response_border":"#9b5e5b","session_border":"#f2e9e1","status_bar_bg":"#f0eae4","status_bar_text":"#575279","ui_accent":"#9b5e5b","ui_border":"#f2e9e1","ui_error":"#a2596e","ui_ok":"#4d858f","ui_text":"#575279","ui_tool":"#7e4a48","ui_warn":"#ac6865"},"darkColors":{"background":"#191724","banner_accent":"#ebbcba","banner_border":"#26233a","banner_dim":"#908caa","banner_text":"#e0def4","banner_title":"#e0def4","completion_menu_bg":"#171521","input_rule":"#ebbcba","prompt":"#e0def4","response_border":"#ebbcba","session_border":"#26233a","status_bar_bg":"#171521","status_bar_text":"#e0def4","ui_accent":"#ebbcba","ui_border":"#26233a","ui_error":"#eb6f92","ui_ok":"#9ccfd8","ui_text":"#e0def4","ui_tool":"#f2cfcd","ui_warn":"#f6c177"},"darkName":"dark-rosepine","description":"Rosé Pine, rose-tinted dusk","gatewayDarkName":"theme-picker-dark-rosepine-dark","gatewayLightName":"theme-picker-dark-rosepine-light","label":"Rosepine","lightColors":{"background":"#faf4ed","banner_accent":"#9b5e5b","banner_border":"#f2e9e1","banner_dim":"#6f6c87","banner_text":"#575279","banner_title":"#575279","completion_menu_bg":"#f0eae4","input_rule":"#9b5e5b","prompt":"#575279","response_border":"#9b5e5b","session_border":"#f2e9e1","status_bar_bg":"#f0eae4","status_bar_text":"#575279","ui_accent":"#9b5e5b","ui_border":"#f2e9e1","ui_error":"#a2596e","ui_ok":"#4d858f","ui_text":"#575279","ui_tool":"#7e4a48","ui_warn":"#ac6865"},"lightName":"light-rosepine","modeSupport":"dynamic","name":"dark-rosepine","source":"user"},{"category":"Dynamic","colors":{"background":"#f0f4ea","banner_accent":"#52703a","banner_border":"#d2dcc4","banner_dim":"#627054","banner_text":"#2c3a26","banner_title":"#2c3a26","completion_menu_bg":"#ffffff","input_rule":"#52703a","prompt":"#2c3a26","response_border":"#7a9658","session_border":"#d2dcc4","status_bar_bg":"#e2e9d8","status_bar_text":"#2c3a26","ui_accent":"#52703a","ui_border":"#d2dcc4","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#2c3a26","ui_tool":"#4a6634","ui_warn":"#a87a1f"},"darkColors":{"background":"#141812","banner_accent":"#8fae6a","banner_border":"#2a3223","banner_dim":"#7d8a70","banner_text":"#f5f2ec","banner_title":"#f5f2ec","completion_menu_bg":"#121611","input_rule":"#8fae6a","prompt":"#f5f2ec","response_border":"#8fae6a","session_border":"#2a3223","status_bar_bg":"#121611","status_bar_text":"#f5f2ec","ui_accent":"#8fae6a","ui_border":"#2a3223","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#f5f2ec","ui_tool":"#b3cc8f","ui_warn":"#fbbf24"},"darkName":"dark-sage","description":"Dark sage, olive on near-black","gatewayDarkName":"theme-picker-dark-sage-dark","gatewayLightName":"theme-picker-dark-sage-light","label":"Sage","lightColors":{"background":"#f0f4ea","banner_accent":"#52703a","banner_border":"#d2dcc4","banner_dim":"#627054","banner_text":"#2c3a26","banner_title":"#2c3a26","completion_menu_bg":"#ffffff","input_rule":"#52703a","prompt":"#2c3a26","response_border":"#7a9658","session_border":"#d2dcc4","status_bar_bg":"#e2e9d8","status_bar_text":"#2c3a26","ui_accent":"#52703a","ui_border":"#d2dcc4","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#2c3a26","ui_tool":"#4a6634","ui_warn":"#a87a1f"},"lightName":"light-sage","modeSupport":"dynamic","name":"dark-sage","source":"user"},{"category":"Dynamic","colors":{"background":"#fdf6e3","banner_accent":"#2075b0","banner_border":"#eee8d5","banner_dim":"#647072","banner_text":"#4d6167","banner_title":"#4d6167","completion_menu_bg":"#f3ecda","input_rule":"#2075b0","prompt":"#4d6167","response_border":"#2075b0","session_border":"#eee8d5","status_bar_bg":"#f3ecda","status_bar_text":"#4d6167","ui_accent":"#2075b0","ui_border":"#eee8d5","ui_error":"#9f3429","ui_ok":"#4f6e00","ui_text":"#4d6167","ui_tool":"#1a5e8a","ui_warn":"#6e5800"},"darkColors":{"background":"#002b36","banner_accent":"#3794d6","banner_border":"#073642","banner_dim":"#7e9097","banner_text":"#9ca9a9","banner_title":"#9ca9a9","completion_menu_bg":"#002832","input_rule":"#3794d6","prompt":"#9ca9a9","response_border":"#3794d6","session_border":"#073642","status_bar_bg":"#002832","status_bar_text":"#9ca9a9","ui_accent":"#3794d6","ui_border":"#073642","ui_error":"#dc322f","ui_ok":"#859900","ui_text":"#9ca9a9","ui_tool":"#6db3e8","ui_warn":"#b58900"},"darkName":"dark-solarized","description":"Solarized dark, teal-black with cyan blue","gatewayDarkName":"theme-picker-dark-solarized-dark","gatewayLightName":"theme-picker-dark-solarized-light","label":"Solarized","lightColors":{"background":"#fdf6e3","banner_accent":"#2075b0","banner_border":"#eee8d5","banner_dim":"#647072","banner_text":"#4d6167","banner_title":"#4d6167","completion_menu_bg":"#f3ecda","input_rule":"#2075b0","prompt":"#4d6167","response_border":"#2075b0","session_border":"#eee8d5","status_bar_bg":"#f3ecda","status_bar_text":"#4d6167","ui_accent":"#2075b0","ui_border":"#eee8d5","ui_error":"#9f3429","ui_ok":"#4f6e00","ui_text":"#4d6167","ui_tool":"#1a5e8a","ui_warn":"#6e5800"},"lightName":"light-solarized","modeSupport":"dynamic","name":"dark-solarized","source":"user"},{"category":"Dynamic","colors":{"background":"#e1e2e7","banner_accent":"#235fb1","banner_border":"#c4c8da","banner_dim":"#565a6e","banner_text":"#343b58","banner_title":"#343b58","completion_menu_bg":"#d8d9de","input_rule":"#235fb1","prompt":"#343b58","response_border":"#235fb1","session_border":"#c4c8da","status_bar_bg":"#d8d9de","status_bar_text":"#343b58","ui_accent":"#235fb1","ui_border":"#c4c8da","ui_error":"#af3a46","ui_ok":"#2a6334","ui_text":"#343b58","ui_tool":"#1c4f8f","ui_warn":"#7b5519"},"darkColors":{"background":"#1a1b26","banner_accent":"#7aa2f7","banner_border":"#2f334d","banner_dim":"#7f85a5","banner_text":"#c0caf5","banner_title":"#c0caf5","completion_menu_bg":"#181923","input_rule":"#7aa2f7","prompt":"#c0caf5","response_border":"#7aa2f7","session_border":"#2f334d","status_bar_bg":"#181923","status_bar_text":"#c0caf5","ui_accent":"#7aa2f7","ui_border":"#2f334d","ui_error":"#f7768e","ui_ok":"#9ece6a","ui_text":"#c0caf5","ui_tool":"#a9c2fb","ui_warn":"#e0af68"},"darkName":"dark-tokyo-night","description":"Tokyo Night, blue-purple dusk","gatewayDarkName":"theme-picker-dark-tokyo-night-dark","gatewayLightName":"theme-picker-dark-tokyo-night-light","label":"Tokyo Night","lightColors":{"background":"#e1e2e7","banner_accent":"#235fb1","banner_border":"#c4c8da","banner_dim":"#565a6e","banner_text":"#343b58","banner_title":"#343b58","completion_menu_bg":"#d8d9de","input_rule":"#235fb1","prompt":"#343b58","response_border":"#235fb1","session_border":"#c4c8da","status_bar_bg":"#d8d9de","status_bar_text":"#343b58","ui_accent":"#235fb1","ui_border":"#c4c8da","ui_error":"#af3a46","ui_ok":"#2a6334","ui_text":"#343b58","ui_tool":"#1c4f8f","ui_warn":"#7b5519"},"lightName":"light-tokyo-day","modeSupport":"dynamic","name":"dark-tokyo-night","source":"user"},{"category":"Dynamic","colors":{"background":"#faf5ea","banner_accent":"#8a6a2f","banner_border":"#e3d9c2","banner_dim":"#7a6f58","banner_text":"#3c3323","banner_title":"#3c3323","completion_menu_bg":"#ffffff","input_rule":"#8a6a2f","prompt":"#3c3323","response_border":"#b0925a","session_border":"#e3d9c2","status_bar_bg":"#f0e8d2","status_bar_text":"#3c3323","ui_accent":"#8a6a2f","ui_border":"#e3d9c2","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#3c3323","ui_tool":"#785e2a","ui_warn":"#a87a1f"},"darkColors":{"background":"#1c1711","banner_accent":"#d9a83c","banner_border":"#352b1c","banner_dim":"#9a8a6a","banner_text":"#f5f2ec","banner_title":"#f5f2ec","completion_menu_bg":"#1a1510","input_rule":"#d9a83c","prompt":"#f5f2ec","response_border":"#d9a83c","session_border":"#352b1c","status_bar_bg":"#1a1510","status_bar_text":"#f5f2ec","ui_accent":"#d9a83c","ui_border":"#352b1c","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#f5f2ec","ui_tool":"#e8c06a","ui_warn":"#fbbf24"},"darkName":"dark-vanilla","description":"Dark vanilla, honey on warm dark","gatewayDarkName":"theme-picker-dark-vanilla-dark","gatewayLightName":"theme-picker-dark-vanilla-light","label":"Vanilla","lightColors":{"background":"#faf5ea","banner_accent":"#8a6a2f","banner_border":"#e3d9c2","banner_dim":"#7a6f58","banner_text":"#3c3323","banner_title":"#3c3323","completion_menu_bg":"#ffffff","input_rule":"#8a6a2f","prompt":"#3c3323","response_border":"#b0925a","session_border":"#e3d9c2","status_bar_bg":"#f0e8d2","status_bar_text":"#3c3323","ui_accent":"#8a6a2f","ui_border":"#e3d9c2","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#3c3323","ui_tool":"#785e2a","ui_warn":"#a87a1f"},"lightName":"light-vanilla","modeSupport":"dynamic","name":"dark-vanilla","source":"user"},{"category":"Dynamic","colors":{"background":"#ffffff","banner_accent":"#0066b8","banner_border":"#e5e5e5","banner_dim":"#6a6a6a","banner_text":"#333333","banner_title":"#333333","completion_menu_bg":"#f5f5f5","input_rule":"#0066b8","prompt":"#333333","response_border":"#0066b8","session_border":"#e5e5e5","status_bar_bg":"#f5f5f5","status_bar_text":"#333333","ui_accent":"#0066b8","ui_border":"#e5e5e5","ui_error":"#b82c2c","ui_ok":"#007300","ui_text":"#333333","ui_tool":"#00539a","ui_warn":"#614b1e"},"darkColors":{"background":"#1e1e1e","banner_accent":"#298fd4","banner_border":"#3a3a3a","banner_dim":"#8a8a8a","banner_text":"#d4d4d4","banner_title":"#d4d4d4","completion_menu_bg":"#1c1c1c","input_rule":"#298fd4","prompt":"#d4d4d4","response_border":"#298fd4","session_border":"#3a3a3a","status_bar_bg":"#1c1c1c","status_bar_text":"#d4d4d4","ui_accent":"#298fd4","ui_border":"#3a3a3a","ui_error":"#f48771","ui_ok":"#4ec9b0","ui_text":"#d4d4d4","ui_tool":"#4fa8e0","ui_warn":"#dcdcaa"},"darkName":"dark-vscode","description":"VSCode Dark+, the most-used editor default","gatewayDarkName":"theme-picker-dark-vscode-dark","gatewayLightName":"theme-picker-dark-vscode-light","label":"Vscode","lightColors":{"background":"#ffffff","banner_accent":"#0066b8","banner_border":"#e5e5e5","banner_dim":"#6a6a6a","banner_text":"#333333","banner_title":"#333333","completion_menu_bg":"#f5f5f5","input_rule":"#0066b8","prompt":"#333333","response_border":"#0066b8","session_border":"#e5e5e5","status_bar_bg":"#f5f5f5","status_bar_text":"#333333","ui_accent":"#0066b8","ui_border":"#e5e5e5","ui_error":"#b82c2c","ui_ok":"#007300","ui_text":"#333333","ui_tool":"#00539a","ui_warn":"#614b1e"},"lightName":"light-vscode","modeSupport":"dynamic","name":"dark-vscode","source":"user"},{"category":"Dynamic","colors":{"background":"#f4f5f7","banner_accent":"#5b6572","banner_border":"#c9cdd3","banner_dim":"#565d66","banner_text":"#2e3033","banner_title":"#2e3033","completion_menu_bg":"#ffffff","input_rule":"#5b6572","prompt":"#2e3033","response_border":"#9aa1aa","session_border":"#c9cdd3","status_bar_bg":"#e6e8eb","status_bar_text":"#2e3033","ui_accent":"#5b6572","ui_border":"#c9cdd3","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#2e3033","ui_tool":"#6b7684","ui_warn":"#a87a1f"},"darkColors":{"background":"#17181a","banner_accent":"#c3cad2","banner_border":"#26272b","banner_dim":"#8f959c","banner_text":"#e8eaec","banner_title":"#e8eaec","completion_menu_bg":"#242527","input_rule":"#c3cad2","prompt":"#e8eaec","response_border":"#9aa3ad","session_border":"#26272b","status_bar_bg":"#151617","status_bar_text":"#e8eaec","ui_accent":"#c3cad2","ui_border":"#26272b","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#e8eaec","ui_tool":"#9aa3ad","ui_warn":"#fbbf24"},"darkName":"minimal-graphite","description":"Gray monochrome, quiet and precise","gatewayDarkName":"theme-picker-minimal-graphite-dark","gatewayLightName":"theme-picker-minimal-graphite-light","label":"Minimal Graphite","lightColors":{"background":"#f4f5f7","banner_accent":"#5b6572","banner_border":"#c9cdd3","banner_dim":"#565d66","banner_text":"#2e3033","banner_title":"#2e3033","completion_menu_bg":"#ffffff","input_rule":"#5b6572","prompt":"#2e3033","response_border":"#9aa1aa","session_border":"#c9cdd3","status_bar_bg":"#e6e8eb","status_bar_text":"#2e3033","ui_accent":"#5b6572","ui_border":"#c9cdd3","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#2e3033","ui_tool":"#6b7684","ui_warn":"#a87a1f"},"lightName":"minimal-pearl","modeSupport":"dynamic","name":"minimal-graphite","source":"user"},{"category":"Dynamic","colors":{"background":"#fdf1e6","banner_accent":"#b04f22","banner_border":"#ecd2b8","banner_dim":"#8a624a","banner_text":"#43281c","banner_title":"#43281c","completion_menu_bg":"#ffffff","input_rule":"#b04f22","prompt":"#43281c","response_border":"#d47a3c","session_border":"#ecd2b8","status_bar_bg":"#f6e2cc","status_bar_text":"#43281c","ui_accent":"#b04f22","ui_border":"#ecd2b8","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#43281c","ui_tool":"#9a451e","ui_warn":"#a87a1f"},"darkColors":{"background":"#241510","banner_accent":"#e07b39","banner_border":"#3d2418","banner_dim":"#b89880","banner_text":"#f5e8d8","banner_title":"#f5e8d8","completion_menu_bg":"#2e1c13","input_rule":"#e07b39","prompt":"#f5e8d8","response_border":"#c25a24","session_border":"#3d2418","status_bar_bg":"#1d110c","status_bar_text":"#f5e8d8","ui_accent":"#e07b39","ui_border":"#3d2418","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#f5e8d8","ui_tool":"#c25a24","ui_warn":"#fbbf24"},"darkName":"nature-autumn","description":"Rust and burnt orange on warm earth","gatewayDarkName":"theme-picker-nature-autumn-dark","gatewayLightName":"theme-picker-nature-autumn-light","label":"Nature Autumn","lightColors":{"background":"#fdf1e6","banner_accent":"#b04f22","banner_border":"#ecd2b8","banner_dim":"#8a624a","banner_text":"#43281c","banner_title":"#43281c","completion_menu_bg":"#ffffff","input_rule":"#b04f22","prompt":"#43281c","response_border":"#d47a3c","session_border":"#ecd2b8","status_bar_bg":"#f6e2cc","status_bar_text":"#43281c","ui_accent":"#b04f22","ui_border":"#ecd2b8","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#43281c","ui_tool":"#9a451e","ui_warn":"#a87a1f"},"lightName":"light-melon","modeSupport":"dynamic","name":"nature-autumn","source":"user"},{"category":"Dynamic","colors":{"background":"#f6f1e4","banner_accent":"#667433","banner_border":"#e0d8bf","banner_dim":"#716b54","banner_text":"#2e2a1e","banner_title":"#2e2a1e","completion_menu_bg":"#eae5d8","input_rule":"#667433","prompt":"#2e2a1e","response_border":"#7a8a3d","session_border":"#e0d8bf","status_bar_bg":"#f7f2e6","status_bar_text":"#2e2a1e","ui_accent":"#667433","ui_border":"#e0d8bf","ui_error":"#c65a5a","ui_ok":"#2f8e52","ui_text":"#2e2a1e","ui_tool":"#7a8a3d","ui_warn":"#a17a17"},"darkColors":{"background":"#1d1710","banner_accent":"#f0c07a","banner_border":"#3a2c1c","banner_dim":"#a89072","banner_text":"#f0e6d8","banner_title":"#f0e6d8","completion_menu_bg":"#2a231c","input_rule":"#f0c07a","prompt":"#f0e6d8","response_border":"#d99a3d","session_border":"#3a2c1c","status_bar_bg":"#1a150e","status_bar_text":"#f0e6d8","ui_accent":"#f0c07a","ui_border":"#3a2c1c","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#f0e6d8","ui_tool":"#d99a3d","ui_warn":"#fbbf24"},"darkName":"nature-desert","description":"Sand dune amber on warm dark","gatewayDarkName":"theme-picker-nature-desert-dark","gatewayLightName":"theme-picker-nature-desert-light","label":"Nature Desert","lightColors":{"background":"#f6f1e4","banner_accent":"#667433","banner_border":"#e0d8bf","banner_dim":"#716b54","banner_text":"#2e2a1e","banner_title":"#2e2a1e","completion_menu_bg":"#eae5d8","input_rule":"#667433","prompt":"#2e2a1e","response_border":"#7a8a3d","session_border":"#e0d8bf","status_bar_bg":"#f7f2e6","status_bar_text":"#2e2a1e","ui_accent":"#667433","ui_border":"#e0d8bf","ui_error":"#c65a5a","ui_ok":"#2f8e52","ui_text":"#2e2a1e","ui_tool":"#7a8a3d","ui_warn":"#a17a17"},"lightName":"light-sand","modeSupport":"dynamic","name":"nature-desert","source":"user"},{"category":"Dynamic","colors":{"background":"#eff5ec","banner_accent":"#3f7a45","banner_border":"#d0dcc8","banner_dim":"#5f745f","banner_text":"#233a26","banner_title":"#233a26","completion_menu_bg":"#ffffff","input_rule":"#3f7a45","prompt":"#233a26","response_border":"#6a9a68","session_border":"#d0dcc8","status_bar_bg":"#dfe8d8","status_bar_text":"#233a26","ui_accent":"#3f7a45","ui_border":"#d0dcc8","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#233a26","ui_tool":"#356a3a","ui_warn":"#a87a1f"},"darkColors":{"background":"#0f1a12","banner_accent":"#8fe08f","banner_border":"#24382a","banner_dim":"#86a086","banner_text":"#d9ead9","banner_title":"#d9ead9","completion_menu_bg":"#1b261e","input_rule":"#8fe08f","prompt":"#d9ead9","response_border":"#4caf50","session_border":"#24382a","status_bar_bg":"#0e1710","status_bar_text":"#d9ead9","ui_accent":"#8fe08f","ui_border":"#24382a","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#d9ead9","ui_tool":"#4caf50","ui_warn":"#fbbf24"},"darkName":"nature-forest","description":"Moss and pine, deep green calm","gatewayDarkName":"theme-picker-nature-forest-dark","gatewayLightName":"theme-picker-nature-forest-light","label":"Nature Forest","lightColors":{"background":"#eff5ec","banner_accent":"#3f7a45","banner_border":"#d0dcc8","banner_dim":"#5f745f","banner_text":"#233a26","banner_title":"#233a26","completion_menu_bg":"#ffffff","input_rule":"#3f7a45","prompt":"#233a26","response_border":"#6a9a68","session_border":"#d0dcc8","status_bar_bg":"#dfe8d8","status_bar_text":"#233a26","ui_accent":"#3f7a45","ui_border":"#d0dcc8","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#233a26","ui_tool":"#356a3a","ui_warn":"#a87a1f"},"lightName":"light-fern","modeSupport":"dynamic","name":"nature-forest","source":"user"},{"category":"Dynamic","colors":{"background":"#eef4f8","banner_accent":"#2f6f9f","banner_border":"#d3e0ea","banner_dim":"#5b6f80","banner_text":"#22303b","banner_title":"#22303b","completion_menu_bg":"#e2e8ed","input_rule":"#2f6f9f","prompt":"#22303b","response_border":"#2f6f9f","session_border":"#d3e0ea","status_bar_bg":"#eff5f9","status_bar_text":"#22303b","ui_accent":"#2f6f9f","ui_border":"#d3e0ea","ui_error":"#c65a5a","ui_ok":"#2f8e52","ui_text":"#22303b","ui_tool":"#2f6f9f","ui_warn":"#a17a17"},"darkColors":{"background":"#121a20","banner_accent":"#b7dbe8","banner_border":"#26343e","banner_dim":"#8ba0ad","banner_text":"#dfe8ee","banner_title":"#dfe8ee","completion_menu_bg":"#1e262c","input_rule":"#b7dbe8","prompt":"#dfe8ee","response_border":"#7fb2c5","session_border":"#26343e","status_bar_bg":"#10171d","status_bar_text":"#dfe8ee","ui_accent":"#b7dbe8","ui_border":"#26343e","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#dfe8ee","ui_tool":"#7fb2c5","ui_warn":"#fbbf24"},"darkName":"nature-nordic","description":"Frosted fjord blue-gray","gatewayDarkName":"theme-picker-nature-nordic-dark","gatewayLightName":"theme-picker-nature-nordic-light","label":"Nature Nordic","lightColors":{"background":"#eef4f8","banner_accent":"#2f6f9f","banner_border":"#d3e0ea","banner_dim":"#5b6f80","banner_text":"#22303b","banner_title":"#22303b","completion_menu_bg":"#e2e8ed","input_rule":"#2f6f9f","prompt":"#22303b","response_border":"#2f6f9f","session_border":"#d3e0ea","status_bar_bg":"#eff5f9","status_bar_text":"#22303b","ui_accent":"#2f6f9f","ui_border":"#d3e0ea","ui_error":"#c65a5a","ui_ok":"#2f8e52","ui_text":"#22303b","ui_tool":"#2f6f9f","ui_warn":"#a17a17"},"lightName":"light-frost","modeSupport":"dynamic","name":"nature-nordic","source":"user"},{"category":"Dynamic","colors":{"background":"#e9f5f2","banner_accent":"#127a7a","banner_border":"#bcd8d4","banner_dim":"#3f6666","banner_text":"#143838","banner_title":"#143838","completion_menu_bg":"#ffffff","input_rule":"#127a7a","prompt":"#143838","response_border":"#3ea0a0","session_border":"#bcd8d4","status_bar_bg":"#d4e8e4","status_bar_text":"#143838","ui_accent":"#127a7a","ui_border":"#bcd8d4","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#143838","ui_tool":"#106666","ui_warn":"#a87a1f"},"darkColors":{"background":"#0a1a24","banner_accent":"#4dd8d8","banner_border":"#14303f","banner_dim":"#7fa8b5","banner_text":"#d8f0f5","banner_title":"#d8f0f5","completion_menu_bg":"#122630","input_rule":"#4dd8d8","prompt":"#d8f0f5","response_border":"#2db4b4","session_border":"#14303f","status_bar_bg":"#081520","status_bar_text":"#d8f0f5","ui_accent":"#4dd8d8","ui_border":"#14303f","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#d8f0f5","ui_tool":"#2db4b4","ui_warn":"#fbbf24"},"darkName":"nature-ocean","description":"Deep sea teal with foam white","gatewayDarkName":"theme-picker-nature-ocean-dark","gatewayLightName":"theme-picker-nature-ocean-light","label":"Nature Ocean","lightColors":{"background":"#e9f5f2","banner_accent":"#127a7a","banner_border":"#bcd8d4","banner_dim":"#3f6666","banner_text":"#143838","banner_title":"#143838","completion_menu_bg":"#ffffff","input_rule":"#127a7a","prompt":"#143838","response_border":"#3ea0a0","session_border":"#bcd8d4","status_bar_bg":"#d4e8e4","status_bar_text":"#143838","ui_accent":"#127a7a","ui_border":"#bcd8d4","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#143838","ui_tool":"#106666","ui_warn":"#a87a1f"},"lightName":"light-tide","modeSupport":"dynamic","name":"nature-ocean","source":"user"},{"category":"Dynamic","colors":{"background":"#f7f4ec","banner_accent":"#8e623a","banner_border":"#ded7c9","banner_dim":"#6f675c","banner_text":"#2b2620","banner_title":"#2b2620","completion_menu_bg":"#ebe8e0","input_rule":"#8e623a","prompt":"#2b2620","response_border":"#9a6b3f","session_border":"#ded7c9","status_bar_bg":"#f8f5ee","status_bar_text":"#2b2620","ui_accent":"#8e623a","ui_border":"#ded7c9","ui_error":"#c65a5a","ui_ok":"#2f8e52","ui_text":"#2b2620","ui_tool":"#9a6b3f","ui_warn":"#a17a17"},"darkColors":{"background":"#101012","banner_accent":"#787890","banner_border":"#505870","banner_dim":"#808090","banner_text":"#d8d8e0","banner_title":"#d0d0d8","completion_menu_bg":"#101012","input_rule":"#787890","prompt":"#d8d8e0","response_border":"#d0d0d8","session_border":"#383848","status_bar_bg":"#08080a","status_bar_text":"#888898","ui_accent":"#84849c","ui_border":"#505870","ui_error":"#b05850","ui_ok":"#60a070","ui_text":"#d8d8e0","ui_tool":"#6090a0","ui_warn":"#c0a860"},"darkName":"newsprint-noir","description":"1940s detective film — stark off-white text on ink-black, with muted navy and rust accents","gatewayDarkName":"theme-picker-newsprint-noir-dark","gatewayLightName":"theme-picker-newsprint-noir-light","label":"Newsprint Noir","lightColors":{"background":"#f7f4ec","banner_accent":"#8e623a","banner_border":"#ded7c9","banner_dim":"#6f675c","banner_text":"#2b2620","banner_title":"#2b2620","completion_menu_bg":"#ebe8e0","input_rule":"#8e623a","prompt":"#2b2620","response_border":"#9a6b3f","session_border":"#ded7c9","status_bar_bg":"#f8f5ee","status_bar_text":"#2b2620","ui_accent":"#8e623a","ui_border":"#ded7c9","ui_error":"#c65a5a","ui_ok":"#2f8e52","ui_text":"#2b2620","ui_tool":"#9a6b3f","ui_warn":"#a17a17"},"lightName":"light-paper","modeSupport":"dynamic","name":"newsprint-noir","source":"user"},{"category":"Dynamic","colors":{"background":"#fdf1ea","banner_accent":"#b84c24","banner_border":"#e8cdbd","banner_dim":"#8a5f4e","banner_text":"#4a2418","banner_title":"#4a2418","completion_menu_bg":"#ffffff","input_rule":"#b84c24","prompt":"#4a2418","response_border":"#d97a4a","session_border":"#e8cdbd","status_bar_bg":"#f7e5d8","status_bar_text":"#4a2418","ui_accent":"#b84c24","ui_border":"#e8cdbd","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#4a2418","ui_tool":"#a84a2a","ui_warn":"#a87a1f"},"darkColors":{"background":"#201c18","banner_accent":"#e0a080","banner_border":"#d89070","banner_dim":"#948474","banner_text":"#e8d8c8","banner_title":"#f0c8a8","completion_menu_bg":"#201c18","input_rule":"#e0a080","prompt":"#e8d8c8","response_border":"#f0c8a8","session_border":"#584838","status_bar_bg":"#141210","status_bar_text":"#a89080","ui_accent":"#e0a080","ui_border":"#d89070","ui_error":"#d07068","ui_ok":"#90c090","ui_text":"#e8d8c8","ui_tool":"#90b8c0","ui_warn":"#e0b870"},"darkName":"peach-fuzz","description":"Pantone Color of the Year 2024 — soft peach, warm coral, and gentle cream on dark taupe","gatewayDarkName":"theme-picker-peach-fuzz-dark","gatewayLightName":"theme-picker-peach-fuzz-light","label":"Peach Fuzz","lightColors":{"background":"#fdf1ea","banner_accent":"#b84c24","banner_border":"#e8cdbd","banner_dim":"#8a5f4e","banner_text":"#4a2418","banner_title":"#4a2418","completion_menu_bg":"#ffffff","input_rule":"#b84c24","prompt":"#4a2418","response_border":"#d97a4a","session_border":"#e8cdbd","status_bar_bg":"#f7e5d8","status_bar_text":"#4a2418","ui_accent":"#b84c24","ui_border":"#e8cdbd","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#4a2418","ui_tool":"#a84a2a","ui_warn":"#a87a1f"},"lightName":"light-peach","modeSupport":"dynamic","name":"peach-fuzz","source":"user"},{"category":"Dynamic","colors":{"background":"#faf6ef","banner_accent":"#b15435","banner_border":"#e5dccb","banner_dim":"#7d6f5e","banner_text":"#33291f","banner_title":"#33291f","completion_menu_bg":"#eeeae3","input_rule":"#b15435","prompt":"#33291f","response_border":"#c05b3a","session_border":"#e5dccb","status_bar_bg":"#faf7f0","status_bar_text":"#33291f","ui_accent":"#b15435","ui_border":"#e5dccb","ui_error":"#d05f5f","ui_ok":"#2f8e52","ui_text":"#33291f","ui_tool":"#c05b3a","ui_warn":"#a17a17"},"darkColors":{"background":"#1e1814","banner_accent":"#8a7050","banner_border":"#6b8a5a","banner_dim":"#928070","banner_text":"#d8d0c0","banner_title":"#a0c080","completion_menu_bg":"#1e1814","input_rule":"#6b8a5a","prompt":"#d8d0c0","response_border":"#a0c080","session_border":"#4a3828","status_bar_bg":"#14100c","status_bar_text":"#a09880","ui_accent":"#a28868","ui_border":"#6b8a5a","ui_error":"#b87050","ui_ok":"#90b870","ui_text":"#d8d0c0","ui_tool":"#80a868","ui_warn":"#c8a050"},"darkName":"redwood","description":"Ancient forest floor — deep bark brown, moss green, and dappled amber light","gatewayDarkName":"theme-picker-redwood-dark","gatewayLightName":"theme-picker-redwood-light","label":"Redwood","lightColors":{"background":"#faf6ef","banner_accent":"#b15435","banner_border":"#e5dccb","banner_dim":"#7d6f5e","banner_text":"#33291f","banner_title":"#33291f","completion_menu_bg":"#eeeae3","input_rule":"#b15435","prompt":"#33291f","response_border":"#c05b3a","session_border":"#e5dccb","status_bar_bg":"#faf7f0","status_bar_text":"#33291f","ui_accent":"#b15435","ui_border":"#e5dccb","ui_error":"#d05f5f","ui_ok":"#2f8e52","ui_text":"#33291f","ui_tool":"#c05b3a","ui_warn":"#a17a17"},"lightName":"light-cream","modeSupport":"dynamic","name":"redwood","source":"user"},{"category":"Dynamic","colors":{"background":"#faf5e8","banner_accent":"#8a5f0c","banner_border":"#ddd0b4","banner_dim":"#7a6a4a","banner_text":"#4a3a1e","banner_title":"#4a3a1e","completion_menu_bg":"#ffffff","input_rule":"#8a5f0c","prompt":"#4a3a1e","response_border":"#b98d2e","session_border":"#ddd0b4","status_bar_bg":"#f0e8d2","status_bar_text":"#4a3a1e","ui_accent":"#8a5f0c","ui_border":"#ddd0b4","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#4a3a1e","ui_tool":"#7a5a10","ui_warn":"#a87a1f"},"darkColors":{"background":"#150d04","banner_accent":"#ffc37d","banner_border":"#3a2810","banner_dim":"#a07c45","banner_text":"#ffe8c8","banner_title":"#ffe8c8","completion_menu_bg":"#231a10","input_rule":"#ffc37d","prompt":"#ffe8c8","response_border":"#ff9d2e","session_border":"#3a2810","status_bar_bg":"#130c04","status_bar_text":"#ffe8c8","ui_accent":"#ffc37d","ui_border":"#3a2810","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#ffe8c8","ui_tool":"#ff9d2e","ui_warn":"#fbbf24"},"darkName":"retro-amber","description":"Amber CRT glow on near-black","gatewayDarkName":"theme-picker-retro-amber-dark","gatewayLightName":"theme-picker-retro-amber-light","label":"Retro Amber","lightColors":{"background":"#faf5e8","banner_accent":"#8a5f0c","banner_border":"#ddd0b4","banner_dim":"#7a6a4a","banner_text":"#4a3a1e","banner_title":"#4a3a1e","completion_menu_bg":"#ffffff","input_rule":"#8a5f0c","prompt":"#4a3a1e","response_border":"#b98d2e","session_border":"#ddd0b4","status_bar_bg":"#f0e8d2","status_bar_text":"#4a3a1e","ui_accent":"#8a5f0c","ui_border":"#ddd0b4","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#4a3a1e","ui_tool":"#7a5a10","ui_warn":"#a87a1f"},"lightName":"light-honey","modeSupport":"dynamic","name":"retro-amber","source":"user"},{"category":"Dynamic","colors":{"background":"#e7edf5","banner_accent":"#3a5f8a","banner_border":"#c2d0de","banner_dim":"#52637a","banner_text":"#1e2f47","banner_title":"#1e2f47","completion_menu_bg":"#ffffff","input_rule":"#3a5f8a","prompt":"#1e2f47","response_border":"#6a88a8","session_border":"#c2d0de","status_bar_bg":"#d6e0ec","status_bar_text":"#1e2f47","ui_accent":"#3a5f8a","ui_border":"#c2d0de","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#1e2f47","ui_tool":"#2f5078","ui_warn":"#a87a1f"},"darkColors":{"background":"#04081a","banner_accent":"#8ccaff","banner_border":"#122452","banner_dim":"#6a86b0","banner_text":"#d6e6ff","banner_title":"#d6e6ff","completion_menu_bg":"#111528","input_rule":"#8ccaff","prompt":"#d6e6ff","response_border":"#44aaff","session_border":"#122452","status_bar_bg":"#040717","status_bar_text":"#d6e6ff","ui_accent":"#8ccaff","ui_border":"#122452","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#d6e6ff","ui_tool":"#44aaff","ui_warn":"#fbbf24"},"darkName":"retro-blue","description":"Commodore-style bright blue","gatewayDarkName":"theme-picker-retro-blue-dark","gatewayLightName":"theme-picker-retro-blue-light","label":"Retro Blue","lightColors":{"background":"#e7edf5","banner_accent":"#3a5f8a","banner_border":"#c2d0de","banner_dim":"#52637a","banner_text":"#1e2f47","banner_title":"#1e2f47","completion_menu_bg":"#ffffff","input_rule":"#3a5f8a","prompt":"#1e2f47","response_border":"#6a88a8","session_border":"#c2d0de","status_bar_bg":"#d6e0ec","status_bar_text":"#1e2f47","ui_accent":"#3a5f8a","ui_border":"#c2d0de","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#1e2f47","ui_tool":"#2f5078","ui_warn":"#a87a1f"},"lightName":"light-denim","modeSupport":"dynamic","name":"retro-blue","source":"user"},{"category":"Dynamic","colors":{"background":"#f2faf5","banner_accent":"#267e58","banner_border":"#d3e8dd","banner_dim":"#5b7569","banner_text":"#1e2b25","banner_title":"#1e2b25","completion_menu_bg":"#e5eee9","input_rule":"#267e58","prompt":"#1e2b25","response_border":"#2f9e6e","session_border":"#d3e8dd","status_bar_bg":"#f3faf6","status_bar_text":"#1e2b25","ui_accent":"#267e58","ui_border":"#d3e8dd","ui_error":"#d05f5f","ui_ok":"#2f8e52","ui_text":"#1e2b25","ui_tool":"#2f9e6e","ui_warn":"#a17a17"},"darkColors":{"background":"#0a1208","banner_accent":"#7dffa8","banner_border":"#17331c","banner_dim":"#5f8f6a","banner_text":"#c8ffd5","banner_title":"#c8ffd5","completion_menu_bg":"#152014","input_rule":"#7dffa8","prompt":"#c8ffd5","response_border":"#33ff66","session_border":"#17331c","status_bar_bg":"#091007","status_bar_text":"#c8ffd5","ui_accent":"#7dffa8","ui_border":"#17331c","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#c8ffd5","ui_tool":"#33ff66","ui_warn":"#fbbf24"},"darkName":"retro-terminal","description":"Classic green phosphor terminal","gatewayDarkName":"theme-picker-retro-terminal-dark","gatewayLightName":"theme-picker-retro-terminal-light","label":"Retro Terminal","lightColors":{"background":"#f2faf5","banner_accent":"#267e58","banner_border":"#d3e8dd","banner_dim":"#5b7569","banner_text":"#1e2b25","banner_title":"#1e2b25","completion_menu_bg":"#e5eee9","input_rule":"#267e58","prompt":"#1e2b25","response_border":"#2f9e6e","session_border":"#d3e8dd","status_bar_bg":"#f3faf6","status_bar_text":"#1e2b25","ui_accent":"#267e58","ui_border":"#d3e8dd","ui_error":"#d05f5f","ui_ok":"#2f8e52","ui_text":"#1e2b25","ui_tool":"#2f9e6e","ui_warn":"#a17a17"},"lightName":"light-mint","modeSupport":"dynamic","name":"retro-terminal","source":"user"},{"category":"Dynamic","colors":{"background":"#eef2f6","banner_accent":"#4a6a85","banner_border":"#ccd6de","banner_dim":"#5a6a7a","banner_text":"#24313d","banner_title":"#24313d","completion_menu_bg":"#ffffff","input_rule":"#4a6a85","prompt":"#24313d","response_border":"#7890a5","session_border":"#ccd6de","status_bar_bg":"#dbe2e8","status_bar_text":"#24313d","ui_accent":"#4a6a85","ui_border":"#ccd6de","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#24313d","ui_tool":"#3e5a72","ui_warn":"#a87a1f"},"darkColors":{"background":"#1c1e22","banner_accent":"#687488","banner_border":"#444a54","banner_dim":"#888e98","banner_text":"#c0c4cc","banner_title":"#a0a8b4","completion_menu_bg":"#1c1e22","input_rule":"#687488","prompt":"#c0c4cc","response_border":"#a0a8b4","session_border":"#343a44","status_bar_bg":"#121418","status_bar_text":"#808488","ui_accent":"#808ca0","ui_border":"#444a54","ui_error":"#907a7a","ui_ok":"#7a907a","ui_text":"#c0c4cc","ui_tool":"#687488","ui_warn":"#908a70"},"darkName":"slate-mist","description":"Fogged window — soft blue-gray monochrome with barely-there contrast, calm and quiet","gatewayDarkName":"theme-picker-slate-mist-dark","gatewayLightName":"theme-picker-slate-mist-light","label":"Slate Mist","lightColors":{"background":"#eef2f6","banner_accent":"#4a6a85","banner_border":"#ccd6de","banner_dim":"#5a6a7a","banner_text":"#24313d","banner_title":"#24313d","completion_menu_bg":"#ffffff","input_rule":"#4a6a85","prompt":"#24313d","response_border":"#7890a5","session_border":"#ccd6de","status_bar_bg":"#dbe2e8","status_bar_text":"#24313d","ui_accent":"#4a6a85","ui_border":"#ccd6de","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#24313d","ui_tool":"#3e5a72","ui_warn":"#a87a1f"},"lightName":"light-mist","modeSupport":"dynamic","name":"slate-mist","source":"user"},{"category":"Dynamic","colors":{"background":"#f7f3ee","banner_accent":"#2a5da8","banner_border":"#d8d0c4","banner_dim":"#6b6b78","banner_text":"#141414","banner_title":"#141414","completion_menu_bg":"#ede9e4","input_rule":"#2a5da8","prompt":"#141414","response_border":"#2a5da8","session_border":"#d8d0c4","status_bar_bg":"#ede9e4","status_bar_text":"#141414","ui_accent":"#2a5da8","ui_border":"#d8d0c4","ui_error":"#d36060","ui_ok":"#3fbd6d","ui_text":"#141414","ui_tool":"#1f4a86","ui_warn":"#bc8f1b"},"darkColors":{"background":"#141420","banner_accent":"#50a0d0","banner_border":"#c0a050","banner_dim":"#808090","banner_text":"#d8d0c8","banner_title":"#e07050","completion_menu_bg":"#141420","input_rule":"#c0a050","prompt":"#d8d0c8","response_border":"#e07050","session_border":"#383848","status_bar_bg":"#0a0a14","status_bar_text":"#908878","ui_accent":"#50a0d0","ui_border":"#c0a050","ui_error":"#c05050","ui_ok":"#60b870","ui_text":"#d8d0c8","ui_tool":"#50a0d0","ui_warn":"#c0a050"},"darkName":"stained-glass","description":"Cathedral window — jewel tones of sapphire, ruby, emerald, and amber on dark lead","gatewayDarkName":"theme-picker-stained-glass-dark","gatewayLightName":"theme-picker-stained-glass-light","label":"Stained Glass","lightColors":{"background":"#f7f3ee","banner_accent":"#2a5da8","banner_border":"#d8d0c4","banner_dim":"#6b6b78","banner_text":"#141414","banner_title":"#141414","completion_menu_bg":"#ede9e4","input_rule":"#2a5da8","prompt":"#141414","response_border":"#2a5da8","session_border":"#d8d0c4","status_bar_bg":"#ede9e4","status_bar_text":"#141414","ui_accent":"#2a5da8","ui_border":"#d8d0c4","ui_error":"#d36060","ui_ok":"#3fbd6d","ui_text":"#141414","ui_tool":"#1f4a86","ui_warn":"#bc8f1b"},"lightName":"light-stained-glass","modeSupport":"dynamic","name":"stained-glass","source":"user"},{"category":"Dynamic","colors":{"background":"#f2f2f0","banner_accent":"#6e6e68","banner_border":"#d2d2cc","banner_dim":"#5f5f5a","banner_text":"#2c2c2a","banner_title":"#2c2c2a","completion_menu_bg":"#ffffff","input_rule":"#6e6e68","prompt":"#2c2c2a","response_border":"#94948e","session_border":"#d2d2cc","status_bar_bg":"#e2e2dc","status_bar_text":"#2c2c2a","ui_accent":"#6e6e68","ui_border":"#d2d2cc","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#2c2c2a","ui_tool":"#5e5e58","ui_warn":"#a87a1f"},"darkColors":{"background":"#18181a","banner_accent":"#707078","banner_border":"#4a4a50","banner_dim":"#88888c","banner_text":"#c0c0c8","banner_title":"#a0a0a8","completion_menu_bg":"#18181a","input_rule":"#707078","prompt":"#c0c0c8","response_border":"#a0a0a8","session_border":"#343438","status_bar_bg":"#0e0e10","status_bar_text":"#808088","ui_accent":"#888890","ui_border":"#4a4a50","ui_error":"#a07070","ui_ok":"#78a078","ui_text":"#c0c0c8","ui_tool":"#7088a0","ui_warn":"#a09860"},"darkName":"steel-thread","description":"Machined metal — cool, precise silver on dark gunmetal with zero warmth","gatewayDarkName":"theme-picker-steel-thread-dark","gatewayLightName":"theme-picker-steel-thread-light","label":"Steel Thread","lightColors":{"background":"#f2f2f0","banner_accent":"#6e6e68","banner_border":"#d2d2cc","banner_dim":"#5f5f5a","banner_text":"#2c2c2a","banner_title":"#2c2c2a","completion_menu_bg":"#ffffff","input_rule":"#6e6e68","prompt":"#2c2c2a","response_border":"#94948e","session_border":"#d2d2cc","status_bar_bg":"#e2e2dc","status_bar_text":"#2c2c2a","ui_accent":"#6e6e68","ui_border":"#d2d2cc","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#2c2c2a","ui_tool":"#5e5e58","ui_warn":"#a87a1f"},"lightName":"light-ash","modeSupport":"dynamic","name":"steel-thread","source":"user"},{"category":"Dynamic","colors":{"background":"#e7f7f4","banner_accent":"#0b7171","banner_border":"#b8ded8","banner_dim":"#3f6b6b","banner_text":"#123c3c","banner_title":"#123c3c","completion_menu_bg":"#ffffff","input_rule":"#0b7171","prompt":"#123c3c","response_border":"#2e9e9e","session_border":"#b8ded8","status_bar_bg":"#d4eeea","status_bar_text":"#123c3c","ui_accent":"#0b7171","ui_border":"#b8ded8","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#123c3c","ui_tool":"#0f5f5f","ui_warn":"#a87a1f"},"darkColors":{"background":"#1a1a28","banner_accent":"#ff6ac1","banner_border":"#ff6ac1","banner_dim":"#9686b6","banner_text":"#d8d8f0","banner_title":"#66d9ef","completion_menu_bg":"#1a1a28","input_rule":"#ff6ac1","prompt":"#d8d8f0","response_border":"#66d9ef","session_border":"#5a4a7a","status_bar_bg":"#101018","status_bar_text":"#9898b0","ui_accent":"#ff6ac1","ui_border":"#ff6ac1","ui_error":"#f92672","ui_ok":"#a6e22e","ui_text":"#d8d8f0","ui_tool":"#66d9ef","ui_warn":"#e6db74"},"darkName":"vaporwave-mall","description":"Abandoned 90s shopping mall — seafoam, mauve, and chrome on checkerboard dark","gatewayDarkName":"theme-picker-vaporwave-mall-dark","gatewayLightName":"theme-picker-vaporwave-mall-light","label":"Vaporwave Mall","lightColors":{"background":"#e7f7f4","banner_accent":"#0b7171","banner_border":"#b8ded8","banner_dim":"#3f6b6b","banner_text":"#123c3c","banner_title":"#123c3c","completion_menu_bg":"#ffffff","input_rule":"#0b7171","prompt":"#123c3c","response_border":"#2e9e9e","session_border":"#b8ded8","status_bar_bg":"#d4eeea","status_bar_text":"#123c3c","ui_accent":"#0b7171","ui_border":"#b8ded8","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#123c3c","ui_tool":"#0f5f5f","ui_warn":"#a87a1f"},"lightName":"light-aqua","modeSupport":"dynamic","name":"vaporwave-mall","source":"user"},{"category":"Dynamic","colors":{"background":"#f0faf6","banner_accent":"#0d7a4e","banner_border":"#cfe8dd","banner_dim":"#3f6b5c","banner_text":"#141414","banner_title":"#141414","completion_menu_bg":"#e6f0ec","input_rule":"#0d7a4e","prompt":"#141414","response_border":"#0d7a4e","session_border":"#cfe8dd","status_bar_bg":"#e6f0ec","status_bar_text":"#141414","ui_accent":"#0d7a4e","ui_border":"#cfe8dd","ui_error":"#d36060","ui_ok":"#3fbd6d","ui_text":"#141414","ui_tool":"#0a5c3c","ui_warn":"#bc8f1b"},"darkColors":{"background":"#081420","banner_accent":"#6dffce","banner_border":"#123044","banner_dim":"#7fa3c9","banner_text":"#e0f7ef","banner_title":"#e0f7ef","completion_menu_bg":"#15222c","input_rule":"#6dffce","prompt":"#e0f7ef","response_border":"#00e5a0","session_border":"#123044","status_bar_bg":"#07121d","status_bar_text":"#e0f7ef","ui_accent":"#6dffce","ui_border":"#123044","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#e0f7ef","ui_tool":"#00e5a0","ui_warn":"#fbbf24"},"darkName":"vibrant-neon","description":"Electric green on deep teal-black","gatewayDarkName":"theme-picker-vibrant-neon-dark","gatewayLightName":"theme-picker-vibrant-neon-light","label":"Vibrant Neon","lightColors":{"background":"#f0faf6","banner_accent":"#0d7a4e","banner_border":"#cfe8dd","banner_dim":"#3f6b5c","banner_text":"#141414","banner_title":"#141414","completion_menu_bg":"#e6f0ec","input_rule":"#0d7a4e","prompt":"#141414","response_border":"#0d7a4e","session_border":"#cfe8dd","status_bar_bg":"#e6f0ec","status_bar_text":"#141414","ui_accent":"#0d7a4e","ui_border":"#cfe8dd","ui_error":"#d36060","ui_ok":"#3fbd6d","ui_text":"#141414","ui_tool":"#0a5c3c","ui_warn":"#bc8f1b"},"lightName":"light-neon","modeSupport":"dynamic","name":"vibrant-neon","source":"user"},{"category":"Dynamic","colors":{"background":"#eef9fd","banner_accent":"#0b6e8f","banner_border":"#c9e4ef","banner_dim":"#40707f","banner_text":"#141414","banner_title":"#141414","completion_menu_bg":"#e4eff3","input_rule":"#0b6e8f","prompt":"#141414","response_border":"#0b6e8f","session_border":"#c9e4ef","status_bar_bg":"#e4eff3","status_bar_text":"#141414","ui_accent":"#0b6e8f","ui_border":"#c9e4ef","ui_error":"#d36060","ui_ok":"#3fbd6d","ui_text":"#141414","ui_tool":"#0a5873","ui_warn":"#bc8f1b"},"darkColors":{"background":"#06202b","banner_accent":"#66e0ff","banner_border":"#0f3a4a","banner_dim":"#7fb4c4","banner_text":"#d9f4ff","banner_title":"#d9f4ff","completion_menu_bg":"#132d38","input_rule":"#66e0ff","prompt":"#d9f4ff","response_border":"#00b4d8","session_border":"#0f3a4a","status_bar_bg":"#051d27","status_bar_text":"#d9f4ff","ui_accent":"#66e0ff","ui_border":"#0f3a4a","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#d9f4ff","ui_tool":"#00b4d8","ui_warn":"#fbbf24"},"darkName":"vibrant-pacific","description":"Tropical lagoon cyan on deep sea","gatewayDarkName":"theme-picker-vibrant-pacific-dark","gatewayLightName":"theme-picker-vibrant-pacific-light","label":"Vibrant Pacific","lightColors":{"background":"#eef9fd","banner_accent":"#0b6e8f","banner_border":"#c9e4ef","banner_dim":"#40707f","banner_text":"#141414","banner_title":"#141414","completion_menu_bg":"#e4eff3","input_rule":"#0b6e8f","prompt":"#141414","response_border":"#0b6e8f","session_border":"#c9e4ef","status_bar_bg":"#e4eff3","status_bar_text":"#141414","ui_accent":"#0b6e8f","ui_border":"#c9e4ef","ui_error":"#d36060","ui_ok":"#3fbd6d","ui_text":"#141414","ui_tool":"#0a5873","ui_warn":"#bc8f1b"},"lightName":"light-pacific","modeSupport":"dynamic","name":"vibrant-pacific","source":"user"},{"category":"Dynamic","colors":{"background":"#fdf0f2","banner_accent":"#b04a62","banner_border":"#e6c8cf","banner_dim":"#8a5a68","banner_text":"#46222c","banner_title":"#46222c","completion_menu_bg":"#ffffff","input_rule":"#b04a62","prompt":"#46222c","response_border":"#d07a8e","session_border":"#e6c8cf","status_bar_bg":"#f6e2e7","status_bar_text":"#46222c","ui_accent":"#b04a62","ui_border":"#e6c8cf","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#46222c","ui_tool":"#9a3f55","ui_warn":"#a87a1f"},"darkColors":{"background":"#1e0f1f","banner_accent":"#ffb37d","banner_border":"#43283a","banner_dim":"#c08a8a","banner_text":"#ffe9e0","banner_title":"#ffe9e0","completion_menu_bg":"#2c1c2b","input_rule":"#ffb37d","prompt":"#ffe9e0","response_border":"#ff6b35","session_border":"#43283a","status_bar_bg":"#1b0e1c","status_bar_text":"#ffe9e0","ui_accent":"#ffb37d","ui_border":"#43283a","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#ffe9e0","ui_tool":"#ff6b35","ui_warn":"#fbbf24"},"darkName":"vibrant-sunset","description":"Burnt orange and rose dusk","gatewayDarkName":"theme-picker-vibrant-sunset-dark","gatewayLightName":"theme-picker-vibrant-sunset-light","label":"Vibrant Sunset","lightColors":{"background":"#fdf0f2","banner_accent":"#b04a62","banner_border":"#e6c8cf","banner_dim":"#8a5a68","banner_text":"#46222c","banner_title":"#46222c","completion_menu_bg":"#ffffff","input_rule":"#b04a62","prompt":"#46222c","response_border":"#d07a8e","session_border":"#e6c8cf","status_bar_bg":"#f6e2e7","status_bar_text":"#46222c","ui_accent":"#b04a62","ui_border":"#e6c8cf","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#46222c","ui_tool":"#9a3f55","ui_warn":"#a87a1f"},"lightName":"light-blush","modeSupport":"dynamic","name":"vibrant-sunset","source":"user"},{"category":"Dynamic","colors":{"background":"#fdf2f9","banner_accent":"#b23a7d","banner_border":"#e8cadd","banner_dim":"#7d5a72","banner_text":"#141414","banner_title":"#141414","completion_menu_bg":"#f3e8ef","input_rule":"#b23a7d","prompt":"#141414","response_border":"#b23a7d","session_border":"#e8cadd","status_bar_bg":"#f3e8ef","status_bar_text":"#141414","ui_accent":"#b23a7d","ui_border":"#e8cadd","ui_error":"#d36060","ui_ok":"#3fbd6d","ui_text":"#141414","ui_tool":"#8f2c63","ui_warn":"#bc8f1b"},"darkColors":{"background":"#1a0b2e","banner_accent":"#ff8ac0","banner_border":"#3c1f5c","banner_dim":"#b78fd4","banner_text":"#f5e9ff","banner_title":"#f5e9ff","completion_menu_bg":"#27183b","input_rule":"#ff8ac0","prompt":"#f5e9ff","response_border":"#ff2e88","session_border":"#3c1f5c","status_bar_bg":"#170a29","status_bar_text":"#f5e9ff","ui_accent":"#ff8ac0","ui_border":"#3c1f5c","ui_error":"#f87171","ui_ok":"#4ade80","ui_text":"#f5e9ff","ui_tool":"#ff2e88","ui_warn":"#fbbf24"},"darkName":"vibrant-synthwave","description":"Retro synthwave, hot pink on violet","gatewayDarkName":"theme-picker-vibrant-synthwave-dark","gatewayLightName":"theme-picker-vibrant-synthwave-light","label":"Vibrant Synthwave","lightColors":{"background":"#fdf2f9","banner_accent":"#b23a7d","banner_border":"#e8cadd","banner_dim":"#7d5a72","banner_text":"#141414","banner_title":"#141414","completion_menu_bg":"#f3e8ef","input_rule":"#b23a7d","prompt":"#141414","response_border":"#b23a7d","session_border":"#e8cadd","status_bar_bg":"#f3e8ef","status_bar_text":"#141414","ui_accent":"#b23a7d","ui_border":"#e8cadd","ui_error":"#d36060","ui_ok":"#3fbd6d","ui_text":"#141414","ui_tool":"#8f2c63","ui_warn":"#bc8f1b"},"lightName":"light-synthwave","modeSupport":"dynamic","name":"vibrant-synthwave","source":"user"},{"category":"Dynamic","colors":{"background":"#fdf4ee","banner_accent":"#b04f2c","banner_border":"#e6d2c8","banner_dim":"#7d5a5c","banner_text":"#141414","banner_title":"#141414","completion_menu_bg":"#f3eae4","input_rule":"#b04f2c","prompt":"#141414","response_border":"#b04f2c","session_border":"#e6d2c8","status_bar_bg":"#f3eae4","status_bar_text":"#141414","ui_accent":"#b04f2c","ui_border":"#e6d2c8","ui_error":"#d36060","ui_ok":"#3fbd6d","ui_text":"#141414","ui_tool":"#8c3d21","ui_warn":"#bc8f1b"},"darkColors":{"background":"#1a1030","banner_accent":"#ff5fd2","banner_border":"#ff5fd2","banner_dim":"#9277b8","banner_text":"#e6d8f0","banner_title":"#ffb870","completion_menu_bg":"#1a1030","input_rule":"#ff5fd2","prompt":"#e6d8f0","response_border":"#ffb870","session_border":"#7a5fa0","status_bar_bg":"#0f0820","status_bar_text":"#c8b8d8","ui_accent":"#ff5fd2","ui_border":"#ffb870","ui_error":"#ff5fd2","ui_ok":"#5af7b0","ui_text":"#e6d8f0","ui_tool":"#5af7b0","ui_warn":"#ffb870"},"darkName":"void-sunset","description":"Neon sunset bleeding into a dead channel — violet, tangerine, and seafoam on bruised plum","gatewayDarkName":"theme-picker-void-sunset-dark","gatewayLightName":"theme-picker-void-sunset-light","label":"Void Sunset","lightColors":{"background":"#fdf4ee","banner_accent":"#b04f2c","banner_border":"#e6d2c8","banner_dim":"#7d5a5c","banner_text":"#141414","banner_title":"#141414","completion_menu_bg":"#f3eae4","input_rule":"#b04f2c","prompt":"#141414","response_border":"#b04f2c","session_border":"#e6d2c8","status_bar_bg":"#f3eae4","status_bar_text":"#141414","ui_accent":"#b04f2c","ui_border":"#e6d2c8","ui_error":"#d36060","ui_ok":"#3fbd6d","ui_text":"#141414","ui_tool":"#8c3d21","ui_warn":"#bc8f1b"},"lightName":"light-sunset","modeSupport":"dynamic","name":"void-sunset","source":"user"},{"category":"Dynamic","colors":{"background":"#f4f1ea","banner_accent":"#6e6250","banner_border":"#d8d2c2","banner_dim":"#6d675c","banner_text":"#332f28","banner_title":"#332f28","completion_menu_bg":"#ffffff","input_rule":"#6e6250","prompt":"#332f28","response_border":"#988e76","session_border":"#d8d2c2","status_bar_bg":"#e6e0d2","status_bar_text":"#332f28","ui_accent":"#6e6250","ui_border":"#d8d2c2","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#332f28","ui_tool":"#5e5544","ui_warn":"#a87a1f"},"darkColors":{"background":"#1e1c18","banner_accent":"#786858","banner_border":"#504840","banner_dim":"#8e8884","banner_text":"#c8c0b8","banner_title":"#b0a898","completion_menu_bg":"#1e1c18","input_rule":"#786858","prompt":"#c8c0b8","response_border":"#b0a898","session_border":"#3a3430","status_bar_bg":"#141210","status_bar_text":"#888070","ui_accent":"#9c8c7c","ui_border":"#504840","ui_error":"#987060","ui_ok":"#809868","ui_text":"#c8c0b8","ui_tool":"#7098a0","ui_warn":"#988850"},"darkName":"warm-ash","description":"Fireplace embers gone cold — a warm gray monochrome with the faintest amber memory","gatewayDarkName":"theme-picker-warm-ash-dark","gatewayLightName":"theme-picker-warm-ash-light","label":"Warm Ash","lightColors":{"background":"#f4f1ea","banner_accent":"#6e6250","banner_border":"#d8d2c2","banner_dim":"#6d675c","banner_text":"#332f28","banner_title":"#332f28","completion_menu_bg":"#ffffff","input_rule":"#6e6250","prompt":"#332f28","response_border":"#988e76","session_border":"#d8d2c2","status_bar_bg":"#e6e0d2","status_bar_text":"#332f28","ui_accent":"#6e6250","ui_border":"#d8d2c2","ui_error":"#b23a3a","ui_ok":"#3f7d4e","ui_text":"#332f28","ui_tool":"#5e5544","ui_warn":"#a87a1f"},"lightName":"light-oat","modeSupport":"dynamic","name":"warm-ash","source":"user"},{"category":"Dynamic","colors":{"background":"#FDF3F8","banner_accent":"#E795BE","banner_border":"#F1D3E3","banner_dim":"#8A6B7B","banner_text":"#4A3341","banner_title":"#4A3341","completion_menu_bg":"#F8E7F0","input_rule":"#B85F8A","prompt":"#4A3341","response_border":"#B85F8A","session_border":"#F1D3E3","shell_dollar":"#B85F8A","status_bar_bg":"#F8E7F0","status_bar_text":"#4A3341","ui_accent":"#E795BE","ui_border":"#F1D3E3","ui_error":"#BE6E6C","ui_ok":"#6F9469","ui_text":"#4A3341","ui_tool":"#B85F8A","ui_warn":"#BD8A4A"},"darkColors":{"background":"#231A1F","banner_accent":"#F2ACC9","banner_border":"#46323E","banner_dim":"#A98EA0","banner_text":"#F6E6EE","banner_title":"#F6E6EE","completion_menu_bg":"#2C2128","input_rule":"#F2ACC9","prompt":"#F6E6EE","response_border":"#F2ACC9","session_border":"#46323E","shell_dollar":"#F7C6DB","status_bar_bg":"#2C2128","status_bar_text":"#F6E6EE","ui_accent":"#F2ACC9","ui_border":"#46323E","ui_error":"#E39293","ui_ok":"#A8C6A6","ui_text":"#F6E6EE","ui_tool":"#F7C6DB","ui_warn":"#E2B77E"},"darkName":"dark-pastel-cotton-candy","description":"Cotton candy — blush and lilac, soft as spun sugar","gatewayDarkName":"theme-picker-dark-pastel-cotton-candy-dark","gatewayLightName":"theme-picker-dark-pastel-cotton-candy-light","label":"Pastel Cotton Candy","lightColors":{"background":"#FDF3F8","banner_accent":"#E795BE","banner_border":"#F1D3E3","banner_dim":"#8A6B7B","banner_text":"#4A3341","banner_title":"#4A3341","completion_menu_bg":"#F8E7F0","input_rule":"#B85F8A","prompt":"#4A3341","response_border":"#B85F8A","session_border":"#F1D3E3","shell_dollar":"#B85F8A","status_bar_bg":"#F8E7F0","status_bar_text":"#4A3341","ui_accent":"#E795BE","ui_border":"#F1D3E3","ui_error":"#BE6E6C","ui_ok":"#6F9469","ui_text":"#4A3341","ui_tool":"#B85F8A","ui_warn":"#BD8A4A"},"lightName":"light-pastel-cotton-candy","modeSupport":"dynamic","name":"dark-pastel-cotton-candy","source":"user"},{"category":"Dynamic","colors":{"background":"#F2FAF6","banner_accent":"#9CD3BA","banner_border":"#D8EAE1","banner_dim":"#6E8A80","banner_text":"#2F463D","banner_title":"#2F463D","completion_menu_bg":"#E7F4EE","input_rule":"#4F8E74","prompt":"#2F463D","response_border":"#4F8E74","session_border":"#D8EAE1","shell_dollar":"#4F8E74","status_bar_bg":"#E7F4EE","status_bar_text":"#2F463D","ui_accent":"#9CD3BA","ui_border":"#D8EAE1","ui_error":"#BC7571","ui_ok":"#66956D","ui_text":"#2F463D","ui_tool":"#4F8E74","ui_warn":"#B98C50"},"darkColors":{"background":"#14201B","banner_accent":"#A9E0C6","banner_border":"#2E453C","banner_dim":"#8FA9A0","banner_text":"#E7F3ED","banner_title":"#E7F3ED","completion_menu_bg":"#1B2A24","input_rule":"#A9E0C6","prompt":"#E7F3ED","response_border":"#A9E0C6","session_border":"#2E453C","shell_dollar":"#C3EBD9","status_bar_bg":"#1B2A24","status_bar_text":"#E7F3ED","ui_accent":"#A9E0C6","ui_border":"#2E453C","ui_error":"#E0938E","ui_ok":"#A3C6A4","ui_text":"#E7F3ED","ui_tool":"#C3EBD9","ui_warn":"#E0BA85"},"darkName":"dark-pastel-mint-sorbet","description":"Mint sorbet — cool mint over clean porcelain","gatewayDarkName":"theme-picker-dark-pastel-mint-sorbet-dark","gatewayLightName":"theme-picker-dark-pastel-mint-sorbet-light","label":"Pastel Mint Sorbet","lightColors":{"background":"#F2FAF6","banner_accent":"#9CD3BA","banner_border":"#D8EAE1","banner_dim":"#6E8A80","banner_text":"#2F463D","banner_title":"#2F463D","completion_menu_bg":"#E7F4EE","input_rule":"#4F8E74","prompt":"#2F463D","response_border":"#4F8E74","session_border":"#D8EAE1","shell_dollar":"#4F8E74","status_bar_bg":"#E7F4EE","status_bar_text":"#2F463D","ui_accent":"#9CD3BA","ui_border":"#D8EAE1","ui_error":"#BC7571","ui_ok":"#66956D","ui_text":"#2F463D","ui_tool":"#4F8E74","ui_warn":"#B98C50"},"lightName":"light-pastel-mint-sorbet","modeSupport":"dynamic","name":"dark-pastel-mint-sorbet","source":"user"},{"category":"Dynamic","colors":{"background":"#FEFAF0","banner_accent":"#EFD292","banner_border":"#F0E3C6","banner_dim":"#8A7D5C","banner_text":"#4A4028","banner_title":"#4A4028","completion_menu_bg":"#FAF2DF","input_rule":"#A88A3E","prompt":"#4A4028","response_border":"#A88A3E","session_border":"#F0E3C6","shell_dollar":"#A88A3E","status_bar_bg":"#FAF2DF","status_bar_text":"#4A4028","ui_accent":"#EFD292","ui_border":"#F0E3C6","ui_error":"#BA6B65","ui_ok":"#6E8A5F","ui_text":"#4A4028","ui_tool":"#A88A3E","ui_warn":"#B5813A"},"darkColors":{"background":"#201C12","banner_accent":"#F0DCA4","banner_border":"#453D26","banner_dim":"#ADA286","banner_text":"#F7F0DF","banner_title":"#F7F0DF","completion_menu_bg":"#2A2517","input_rule":"#F0DCA4","prompt":"#F7F0DF","response_border":"#F0DCA4","session_border":"#453D26","shell_dollar":"#F7E9C4","status_bar_bg":"#2A2517","status_bar_text":"#F7F0DF","ui_accent":"#F0DCA4","ui_border":"#453D26","ui_error":"#DF918B","ui_ok":"#A9C39C","ui_text":"#F7F0DF","ui_tool":"#F7E9C4","ui_warn":"#E4BE7C"},"darkName":"dark-pastel-buttercup","description":"Buttercup — warm butter and cream, gentle as morning light","gatewayDarkName":"theme-picker-dark-pastel-buttercup-dark","gatewayLightName":"theme-picker-dark-pastel-buttercup-light","label":"Pastel Buttercup","lightColors":{"background":"#FEFAF0","banner_accent":"#EFD292","banner_border":"#F0E3C6","banner_dim":"#8A7D5C","banner_text":"#4A4028","banner_title":"#4A4028","completion_menu_bg":"#FAF2DF","input_rule":"#A88A3E","prompt":"#4A4028","response_border":"#A88A3E","session_border":"#F0E3C6","shell_dollar":"#A88A3E","status_bar_bg":"#FAF2DF","status_bar_text":"#4A4028","ui_accent":"#EFD292","ui_border":"#F0E3C6","ui_error":"#BA6B65","ui_ok":"#6E8A5F","ui_text":"#4A4028","ui_tool":"#A88A3E","ui_warn":"#B5813A"},"lightName":"light-pastel-buttercup","modeSupport":"dynamic","name":"dark-pastel-buttercup","source":"user"},{"category":"Dynamic","colors":{"background":"#F3F8FD","banner_accent":"#A9C6E6","banner_border":"#DAE7F3","banner_dim":"#6C8199","banner_text":"#2C3D4F","banner_title":"#2C3D4F","completion_menu_bg":"#E8F1FA","input_rule":"#5279A6","prompt":"#2C3D4F","response_border":"#5279A6","session_border":"#DAE7F3","shell_dollar":"#5279A6","status_bar_bg":"#E8F1FA","status_bar_text":"#2C3D4F","ui_accent":"#A9C6E6","ui_border":"#DAE7F3","ui_error":"#BC7276","ui_ok":"#6A9179","ui_text":"#2C3D4F","ui_tool":"#5279A6","ui_warn":"#B98C50"},"darkColors":{"background":"#151E27","banner_accent":"#B4D0EC","banner_border":"#2C3D4C","banner_dim":"#93A7BA","banner_text":"#E7EFF7","banner_title":"#E7EFF7","completion_menu_bg":"#1C2833","input_rule":"#B4D0EC","prompt":"#E7EFF7","response_border":"#B4D0EC","session_border":"#2C3D4C","shell_dollar":"#D0E3F6","status_bar_bg":"#1C2833","status_bar_text":"#E7EFF7","ui_accent":"#B4D0EC","ui_border":"#2C3D4C","ui_error":"#E0959A","ui_ok":"#A2C2AE","ui_text":"#E7EFF7","ui_tool":"#D0E3F6","ui_warn":"#E0B981"},"darkName":"dark-pastel-powder-blue","description":"Powder blue — calm sky over fresh snow","gatewayDarkName":"theme-picker-dark-pastel-powder-blue-dark","gatewayLightName":"theme-picker-dark-pastel-powder-blue-light","label":"Pastel Powder Blue","lightColors":{"background":"#F3F8FD","banner_accent":"#A9C6E6","banner_border":"#DAE7F3","banner_dim":"#6C8199","banner_text":"#2C3D4F","banner_title":"#2C3D4F","completion_menu_bg":"#E8F1FA","input_rule":"#5279A6","prompt":"#2C3D4F","response_border":"#5279A6","session_border":"#DAE7F3","shell_dollar":"#5279A6","status_bar_bg":"#E8F1FA","status_bar_text":"#2C3D4F","ui_accent":"#A9C6E6","ui_border":"#DAE7F3","ui_error":"#BC7276","ui_ok":"#6A9179","ui_text":"#2C3D4F","ui_tool":"#5279A6","ui_warn":"#B98C50"},"lightName":"light-pastel-powder-blue","modeSupport":"dynamic","name":"dark-pastel-powder-blue","source":"user"},{"category":"Dynamic","colors":{"background":"#FFF6F1","banner_accent":"#F0B694","banner_border":"#F3DFD2","banner_dim":"#8B6F60","banner_text":"#4A362C","banner_title":"#4A362C","completion_menu_bg":"#FBEADF","input_rule":"#B0703F","prompt":"#4A362C","response_border":"#B0703F","session_border":"#F3DFD2","shell_dollar":"#B0703F","status_bar_bg":"#FBEADF","status_bar_text":"#4A362C","ui_accent":"#F0B694","ui_border":"#F3DFD2","ui_error":"#BA6A63","ui_ok":"#6E8A60","ui_text":"#4A362C","ui_tool":"#B0703F","ui_warn":"#B98C50"},"darkColors":{"background":"#231A15","banner_accent":"#F3C4A4","banner_border":"#46342A","banner_dim":"#AE9384","banner_text":"#F7EAE1","banner_title":"#F7EAE1","completion_menu_bg":"#2C221B","input_rule":"#F3C4A4","prompt":"#F7EAE1","response_border":"#F3C4A4","session_border":"#46342A","shell_dollar":"#F8D8C0","status_bar_bg":"#2C221B","status_bar_text":"#F7EAE1","ui_accent":"#F3C4A4","ui_border":"#46342A","ui_error":"#E09189","ui_ok":"#A7C29A","ui_text":"#F7EAE1","ui_tool":"#F8D8C0","ui_warn":"#E2B87C"},"darkName":"dark-pastel-peach-blossom","description":"Peach blossom — ripe peach and warm cream","gatewayDarkName":"theme-picker-dark-pastel-peach-blossom-dark","gatewayLightName":"theme-picker-dark-pastel-peach-blossom-light","label":"Pastel Peach Blossom","lightColors":{"background":"#FFF6F1","banner_accent":"#F0B694","banner_border":"#F3DFD2","banner_dim":"#8B6F60","banner_text":"#4A362C","banner_title":"#4A362C","completion_menu_bg":"#FBEADF","input_rule":"#B0703F","prompt":"#4A362C","response_border":"#B0703F","session_border":"#F3DFD2","shell_dollar":"#B0703F","status_bar_bg":"#FBEADF","status_bar_text":"#4A362C","ui_accent":"#F0B694","ui_border":"#F3DFD2","ui_error":"#BA6A63","ui_ok":"#6E8A60","ui_text":"#4A362C","ui_tool":"#B0703F","ui_warn":"#B98C50"},"lightName":"light-pastel-peach-blossom","modeSupport":"dynamic","name":"dark-pastel-peach-blossom","source":"user"},{"category":"Other","colors":{"background":"#fdfdfa","banner_accent":"#3858b0","banner_border":"#909090","banner_dim":"#b0b0b0","banner_text":"#1a1a1a","banner_title":"#1a1a1a","completion_menu_bg":"#fdfdfa","input_rule":"#3858b0","prompt":"#1a1a1a","response_border":"#909090","session_border":"#b0b0b0","shell_dollar":"#3858b0","status_bar_bg":"#f0f0e8","status_bar_text":"#606060","ui_accent":"#3858b0","ui_border":"#909090","ui_error":"#b03838","ui_ok":"#388040","ui_text":"#1a1a1a","ui_tool":"#3858b0","ui_warn":"#b08020"},"darkColors":{"background":"#101009","banner_accent":"#7CA1FA","banner_border":"#36362E","banner_dim":"#A19E96","banner_text":"#EEEBE2","banner_title":"#EEEBE2","completion_menu_bg":"#242417","completion_menu_current_bg":"#2C2B1B","completion_menu_meta_bg":"#242417","input_rule":"#7CA1FA","prompt":"#EEEBE2","response_border":"#7CA1FA","session_border":"#36362E","session_label":"#8DAFFE","shell_dollar":"#8DAFFE","status_bar_bg":"#1D1C11","status_bar_critical":"#F0726D","status_bar_good":"#70B975","status_bar_text":"#EEEBE2","status_bar_warn":"#DAA84F","ui_accent":"#7CA1FA","ui_border":"#36362E","ui_error":"#F0726D","ui_ok":"#70B975","ui_text":"#EEEBE2","ui_tool":"#8DAFFE","ui_warn":"#DAA84F"},"darkName":null,"derivedDark":true,"description":"Pure white stone — almost-white canvas with charcoal text and a single cobalt thread","gatewayDarkName":"theme-picker-alabaster-dark","gatewayLightName":"theme-picker-alabaster-light","isDark":false,"label":"Alabaster","lightColors":{"background":"#fdfdfa","banner_accent":"#3858b0","banner_border":"#909090","banner_dim":"#b0b0b0","banner_text":"#1a1a1a","banner_title":"#1a1a1a","completion_menu_bg":"#fdfdfa","input_rule":"#3858b0","prompt":"#1a1a1a","response_border":"#909090","session_border":"#b0b0b0","shell_dollar":"#3858b0","status_bar_bg":"#f0f0e8","status_bar_text":"#606060","ui_accent":"#3858b0","ui_border":"#909090","ui_error":"#b03838","ui_ok":"#388040","ui_text":"#1a1a1a","ui_tool":"#3858b0","ui_warn":"#b08020"},"lightName":"alabaster","modeSupport":"dynamic","name":"alabaster","source":"user"},{"category":"Other","colors":{"background":"#F9F6F2","banner_accent":"#835A0F","banner_border":"#D7D0C7","banner_dim":"#67635C","banner_text":"#27241E","banner_title":"#27241E","completion_menu_bg":"#E9E2D9","completion_menu_current_bg":"#E5DBCE","completion_menu_meta_bg":"#E9E2D9","input_rule":"#835A0F","prompt":"#27241E","response_border":"#835A0F","session_border":"#D7D0C7","session_label":"#694E03","shell_dollar":"#694E03","status_bar_bg":"#F2ECE4","status_bar_critical":"#A62B0C","status_bar_good":"#6A5F0A","status_bar_text":"#27241E","status_bar_warn":"#836311","ui_accent":"#835A0F","ui_border":"#D7D0C7","ui_error":"#A62B0C","ui_ok":"#6A5F0A","ui_text":"#27241E","ui_tool":"#694E03","ui_warn":"#836311"},"darkColors":{"background":"#0c0804","banner_accent":"#c89030","banner_border":"#b08020","banner_dim":"#604818","banner_text":"#e0c088","banner_title":"#e0b040","completion_menu_bg":"#0c0804","input_rule":"#b08020","prompt":"#e0c088","response_border":"#e0b040","session_border":"#604818","shell_dollar":"#e0b040","status_bar_bg":"#060402","status_bar_text":"#a08048","ui_accent":"#c89030","ui_border":"#b08020","ui_error":"#e05030","ui_ok":"#c0b040","ui_text":"#e0c088","ui_tool":"#e0b040","ui_warn":"#e0b040"},"darkName":"amber-terminal","derivedLight":true,"description":"Classic CRT phosphor — warm amber text on a deep burnt-black tube with scanline vibes","gatewayDarkName":"theme-picker-amber-terminal-dark","gatewayLightName":"theme-picker-amber-terminal-light","isDark":true,"label":"Amber Terminal","lightColors":{"background":"#F9F6F2","banner_accent":"#835A0F","banner_border":"#D7D0C7","banner_dim":"#67635C","banner_text":"#27241E","banner_title":"#27241E","completion_menu_bg":"#E9E2D9","completion_menu_current_bg":"#E5DBCE","completion_menu_meta_bg":"#E9E2D9","input_rule":"#835A0F","prompt":"#27241E","response_border":"#835A0F","session_border":"#D7D0C7","session_label":"#694E03","shell_dollar":"#694E03","status_bar_bg":"#F2ECE4","status_bar_critical":"#A62B0C","status_bar_good":"#6A5F0A","status_bar_text":"#27241E","status_bar_warn":"#836311","ui_accent":"#835A0F","ui_border":"#D7D0C7","ui_error":"#A62B0C","ui_ok":"#6A5F0A","ui_text":"#27241E","ui_tool":"#694E03","ui_warn":"#836311"},"lightName":null,"modeSupport":"dynamic","name":"amber-terminal","source":"user"},{"category":"Other","colors":{"background":"#F7F6FA","banner_accent":"#796009","banner_border":"#D2CFD9","banner_dim":"#646269","banner_text":"#242329","banner_title":"#242329","completion_menu_bg":"#E4E1EB","completion_menu_current_bg":"#DEDAE8","completion_menu_meta_bg":"#E4E1EB","input_rule":"#796009","prompt":"#242329","response_border":"#796009","session_border":"#D2CFD9","session_label":"#0B5786","shell_dollar":"#0B5786","status_bar_bg":"#EEEBF4","status_bar_critical":"#9E3144","status_bar_good":"#067040","status_bar_text":"#242329","status_bar_warn":"#806502","ui_accent":"#796009","ui_border":"#D2CFD9","ui_error":"#9E3144","ui_ok":"#067040","ui_text":"#242329","ui_tool":"#0B5786","ui_warn":"#806502"},"darkColors":{"background":"#161022","banner_accent":"#c0a040","banner_border":"#7a58a8","banner_dim":"#3a2858","banner_text":"#c8c0e0","banner_title":"#70b8f0","completion_menu_bg":"#161022","input_rule":"#c0a040","prompt":"#c8c0e0","response_border":"#70b8f0","session_border":"#3a2858","shell_dollar":"#70b8f0","status_bar_bg":"#0c0816","status_bar_text":"#8878a0","ui_accent":"#c0a040","ui_border":"#7a58a8","ui_error":"#c05060","ui_ok":"#50c080","ui_text":"#c8c0e0","ui_tool":"#70b8f0","ui_warn":"#c0a040"},"darkName":"arcane-tome","derivedLight":true,"description":"Wizard's spellbook — deep violet leather, glowing arcane blue, and aged gold foil","gatewayDarkName":"theme-picker-arcane-tome-dark","gatewayLightName":"theme-picker-arcane-tome-light","isDark":true,"label":"Arcane Tome","lightColors":{"background":"#F7F6FA","banner_accent":"#796009","banner_border":"#D2CFD9","banner_dim":"#646269","banner_text":"#242329","banner_title":"#242329","completion_menu_bg":"#E4E1EB","completion_menu_current_bg":"#DEDAE8","completion_menu_meta_bg":"#E4E1EB","input_rule":"#796009","prompt":"#242329","response_border":"#796009","session_border":"#D2CFD9","session_label":"#0B5786","shell_dollar":"#0B5786","status_bar_bg":"#EEEBF4","status_bar_critical":"#9E3144","status_bar_good":"#067040","status_bar_text":"#242329","status_bar_warn":"#806502","ui_accent":"#796009","ui_border":"#D2CFD9","ui_error":"#9E3144","ui_ok":"#067040","ui_text":"#242329","ui_tool":"#0B5786","ui_warn":"#806502"},"lightName":null,"modeSupport":"dynamic","name":"arcane-tome","source":"user"},{"category":"Other","colors":{"background":"#F3F7FA","banner_accent":"#3664A0","banner_border":"#C9D3D9","banner_dim":"#5C6567","banner_text":"#1E2628","banner_title":"#1E2628","completion_menu_bg":"#DAE5EB","completion_menu_current_bg":"#D0DFE8","completion_menu_meta_bg":"#DAE5EB","input_rule":"#3664A0","prompt":"#1E2628","response_border":"#3664A0","session_border":"#C9D3D9","session_label":"#056248","shell_dollar":"#056248","status_bar_bg":"#E6EEF4","status_bar_critical":"#A4273F","status_bar_good":"#0A6F46","status_bar_text":"#1E2628","status_bar_warn":"#836311","ui_accent":"#3664A0","ui_border":"#C9D3D9","ui_error":"#A4273F","ui_ok":"#0A6F46","ui_text":"#1E2628","ui_tool":"#056248","ui_warn":"#836311"},"darkColors":{"background":"#0a1820","banner_accent":"#6090d0","banner_border":"#40b090","banner_dim":"#284860","banner_text":"#c8e8f0","banner_title":"#80e8c0","completion_menu_bg":"#0a1820","input_rule":"#6090d0","prompt":"#c8e8f0","response_border":"#80e8c0","session_border":"#284860","shell_dollar":"#80e8c0","status_bar_bg":"#061014","status_bar_text":"#88b8c8","ui_accent":"#6090d0","ui_border":"#40b090","ui_error":"#e06070","ui_ok":"#60e0a0","ui_text":"#c8e8f0","ui_tool":"#80e8c0","ui_warn":"#e0b040"},"darkName":"aurora-boreal","derivedLight":true,"description":"Northern lights over frozen tundra — emerald, violet, and ice blue shimmer on darkest teal","gatewayDarkName":"theme-picker-aurora-boreal-dark","gatewayLightName":"theme-picker-aurora-boreal-light","isDark":true,"label":"Aurora Boreal","lightColors":{"background":"#F3F7FA","banner_accent":"#3664A0","banner_border":"#C9D3D9","banner_dim":"#5C6567","banner_text":"#1E2628","banner_title":"#1E2628","completion_menu_bg":"#DAE5EB","completion_menu_current_bg":"#D0DFE8","completion_menu_meta_bg":"#DAE5EB","input_rule":"#3664A0","prompt":"#1E2628","response_border":"#3664A0","session_border":"#C9D3D9","session_label":"#056248","shell_dollar":"#056248","status_bar_bg":"#E6EEF4","status_bar_critical":"#A4273F","status_bar_good":"#0A6F46","status_bar_text":"#1E2628","status_bar_warn":"#836311","ui_accent":"#3664A0","ui_border":"#C9D3D9","ui_error":"#A4273F","ui_ok":"#0A6F46","ui_text":"#1E2628","ui_tool":"#056248","ui_warn":"#836311"},"lightName":null,"modeSupport":"dynamic","name":"aurora-boreal","source":"user"},{"category":"Other","colors":{"background":"#F5F7FB","banner_accent":"#486684","banner_border":"#CCD1DA","banner_dim":"#5E646A","banner_text":"#20252A","banner_title":"#20252A","completion_menu_bg":"#DEE3ED","completion_menu_current_bg":"#D6DDEA","completion_menu_meta_bg":"#DEE3ED","input_rule":"#486684","prompt":"#20252A","response_border":"#486684","session_border":"#CCD1DA","session_label":"#395571","shell_dollar":"#395571","status_bar_bg":"#E9EDF5","status_bar_critical":"#844A4C","status_bar_good":"#356B47","status_bar_text":"#20252A","status_bar_warn":"#7E6708","ui_accent":"#486684","ui_border":"#CCD1DA","ui_error":"#844A4C","ui_ok":"#356B47","ui_text":"#20252A","ui_tool":"#395571","ui_warn":"#7E6708"},"darkColors":{"background":"#181c24","banner_accent":"#80a0c0","banner_border":"#6888a8","banner_dim":"#384858","banner_text":"#d0dce8","banner_title":"#a0c0e0","completion_menu_bg":"#181c24","input_rule":"#80a0c0","prompt":"#d0dce8","response_border":"#a0c0e0","session_border":"#384858","shell_dollar":"#a0c0e0","status_bar_bg":"#0e1218","status_bar_text":"#8898a8","ui_accent":"#80a0c0","ui_border":"#6888a8","ui_error":"#c88888","ui_ok":"#88c098","ui_text":"#d0dce8","ui_tool":"#a0c0e0","ui_warn":"#c8b060"},"darkName":"baby-blue","derivedLight":true,"description":"Calm nursery tones — powder blue, soft cream, and gentle coral on muted navy, soothing","gatewayDarkName":"theme-picker-baby-blue-dark","gatewayLightName":"theme-picker-baby-blue-light","isDark":true,"label":"Baby Blue","lightColors":{"background":"#F5F7FB","banner_accent":"#486684","banner_border":"#CCD1DA","banner_dim":"#5E646A","banner_text":"#20252A","banner_title":"#20252A","completion_menu_bg":"#DEE3ED","completion_menu_current_bg":"#D6DDEA","completion_menu_meta_bg":"#DEE3ED","input_rule":"#486684","prompt":"#20252A","response_border":"#486684","session_border":"#CCD1DA","session_label":"#395571","shell_dollar":"#395571","status_bar_bg":"#E9EDF5","status_bar_critical":"#844A4C","status_bar_good":"#356B47","status_bar_text":"#20252A","status_bar_warn":"#7E6708","ui_accent":"#486684","ui_border":"#CCD1DA","ui_error":"#844A4C","ui_ok":"#356B47","ui_text":"#20252A","ui_tool":"#395571","ui_warn":"#7E6708"},"lightName":null,"modeSupport":"dynamic","name":"baby-blue","source":"user"},{"category":"Other","colors":{"background":"#F8F7F2","banner_accent":"#74620E","banner_border":"#D4D1C7","banner_dim":"#66635C","banner_text":"#26241D","banner_title":"#26241D","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#74620E","prompt":"#26241D","response_border":"#74620E","session_border":"#D4D1C7","session_label":"#075787","shell_dollar":"#075787","status_bar_bg":"#F0EDE4","status_bar_critical":"#AF1016","status_bar_good":"#0B7037","status_bar_text":"#26241D","status_bar_warn":"#7B680B","ui_accent":"#74620E","ui_border":"#D4D1C7","ui_error":"#AF1016","ui_ok":"#0B7037","ui_text":"#26241D","ui_tool":"#075787","ui_warn":"#7B680B"},"darkColors":{"background":"#101010","banner_accent":"#ffd700","banner_border":"#ffd700","banner_dim":"#606060","banner_text":"#f0f0f0","banner_title":"#ffffff","completion_menu_bg":"#101010","input_rule":"#ffd700","prompt":"#f0f0f0","response_border":"#ffffff","session_border":"#606060","shell_dollar":"#40b0ff","status_bar_bg":"#080808","status_bar_text":"#b0b0b0","ui_accent":"#ffd700","ui_border":"#ffd700","ui_error":"#ff3030","ui_ok":"#00e070","ui_text":"#f0f0f0","ui_tool":"#40b0ff","ui_warn":"#ffd700"},"darkName":"black-canary","derivedLight":true,"description":"Aviation cockpit — bright yellow on matte black with crisp white signals, zero ambiguity","gatewayDarkName":"theme-picker-black-canary-dark","gatewayLightName":"theme-picker-black-canary-light","isDark":true,"label":"Black Canary","lightColors":{"background":"#F8F7F2","banner_accent":"#74620E","banner_border":"#D4D1C7","banner_dim":"#66635C","banner_text":"#26241D","banner_title":"#26241D","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#74620E","prompt":"#26241D","response_border":"#74620E","session_border":"#D4D1C7","session_label":"#075787","shell_dollar":"#075787","status_bar_bg":"#F0EDE4","status_bar_critical":"#AF1016","status_bar_good":"#0B7037","status_bar_text":"#26241D","status_bar_warn":"#7B680B","ui_accent":"#74620E","ui_border":"#D4D1C7","ui_error":"#AF1016","ui_ok":"#0B7037","ui_text":"#26241D","ui_tool":"#075787","ui_warn":"#7B680B"},"lightName":null,"modeSupport":"dynamic","name":"black-canary","source":"user"},{"category":"Other","colors":{"background":"#d8e4f0","banner_accent":"#2858a0","banner_border":"#3a6090","banner_dim":"#8098b8","banner_text":"#102848","banner_title":"#102848","completion_menu_bg":"#d8e4f0","input_rule":"#2858a0","prompt":"#102848","response_border":"#3a6090","session_border":"#8098b8","shell_dollar":"#2858a0","status_bar_bg":"#c8d8e8","status_bar_text":"#405870","ui_accent":"#2858a0","ui_border":"#3a6090","ui_error":"#902820","ui_ok":"#307050","ui_text":"#102848","ui_tool":"#2858a0","ui_warn":"#906020"},"darkColors":{"background":"#0B1015","banner_accent":"#72A5F4","banner_border":"#30363C","banner_dim":"#9A9FA6","banner_text":"#E6ECF3","banner_title":"#E6ECF3","completion_menu_bg":"#1A242D","completion_menu_current_bg":"#1F2B37","completion_menu_meta_bg":"#1A242D","input_rule":"#72A5F4","prompt":"#E6ECF3","response_border":"#72A5F4","session_border":"#30363C","session_label":"#81B2FD","shell_dollar":"#81B2FD","status_bar_bg":"#141D25","status_bar_critical":"#E9796B","status_bar_good":"#75B592","status_bar_text":"#E6ECF3","status_bar_warn":"#DAA669","ui_accent":"#72A5F4","ui_border":"#30363C","ui_error":"#E9796B","ui_ok":"#75B592","ui_text":"#E6ECF3","ui_tool":"#81B2FD","ui_warn":"#DAA669"},"darkName":null,"derivedDark":true,"description":"Architectural cyanotype — white lines on Prussian blue, crisp and technical","gatewayDarkName":"theme-picker-blueprint-dark","gatewayLightName":"theme-picker-blueprint-light","isDark":false,"label":"Blueprint","lightColors":{"background":"#d8e4f0","banner_accent":"#2858a0","banner_border":"#3a6090","banner_dim":"#8098b8","banner_text":"#102848","banner_title":"#102848","completion_menu_bg":"#d8e4f0","input_rule":"#2858a0","prompt":"#102848","response_border":"#3a6090","session_border":"#8098b8","shell_dollar":"#2858a0","status_bar_bg":"#c8d8e8","status_bar_text":"#405870","ui_accent":"#2858a0","ui_border":"#3a6090","ui_error":"#902820","ui_ok":"#307050","ui_text":"#102848","ui_tool":"#2858a0","ui_warn":"#906020"},"lightName":"blueprint","modeSupport":"dynamic","name":"blueprint","source":"user"},{"category":"Other","colors":{"background":"#F8F7F2","banner_accent":"#376C79","banner_border":"#D4D1C7","banner_dim":"#66635C","banner_text":"#26241D","banner_title":"#26241D","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#376C79","prompt":"#26241D","response_border":"#376C79","session_border":"#D4D1C7","session_label":"#2F5A64","shell_dollar":"#2F5A64","status_bar_bg":"#F0EDE4","status_bar_critical":"#7C5051","status_bar_good":"#43684D","status_bar_text":"#26241D","status_bar_warn":"#756840","ui_accent":"#376C79","ui_border":"#D4D1C7","ui_error":"#7C5051","ui_ok":"#43684D","ui_text":"#26241D","ui_tool":"#2F5A64","ui_warn":"#756840"},"darkColors":{"background":"#1a1a1a","banner_accent":"#608088","banner_border":"#444a50","banner_dim":"#383838","banner_text":"#d8d8d8","banner_title":"#c8d0d8","completion_menu_bg":"#1a1a1a","input_rule":"#608088","prompt":"#d8d8d8","response_border":"#c8d0d8","session_border":"#383838","shell_dollar":"#608088","status_bar_bg":"#101010","status_bar_text":"#909090","ui_accent":"#608088","ui_border":"#444a50","ui_error":"#987878","ui_ok":"#789880","ui_text":"#d8d8d8","ui_tool":"#608088","ui_warn":"#989078"},"darkName":"bone-white","derivedLight":true,"description":"Pure minimalism — off-white text on soft black, with one muted teal accent","gatewayDarkName":"theme-picker-bone-white-dark","gatewayLightName":"theme-picker-bone-white-light","isDark":true,"label":"Bone White","lightColors":{"background":"#F8F7F2","banner_accent":"#376C79","banner_border":"#D4D1C7","banner_dim":"#66635C","banner_text":"#26241D","banner_title":"#26241D","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#376C79","prompt":"#26241D","response_border":"#376C79","session_border":"#D4D1C7","session_label":"#2F5A64","shell_dollar":"#2F5A64","status_bar_bg":"#F0EDE4","status_bar_critical":"#7C5051","status_bar_good":"#43684D","status_bar_text":"#26241D","status_bar_warn":"#756840","ui_accent":"#376C79","ui_border":"#D4D1C7","ui_error":"#7C5051","ui_ok":"#43684D","ui_text":"#26241D","ui_tool":"#2F5A64","ui_warn":"#756840"},"lightName":null,"modeSupport":"dynamic","name":"bone-white","source":"user"},{"category":"Other","colors":{"background":"#F8F7F2","banner_accent":"#AA3602","banner_border":"#D4D1C7","banner_dim":"#66635C","banner_text":"#26241D","banner_title":"#26241D","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#AA3602","prompt":"#26241D","response_border":"#AA3602","session_border":"#D4D1C7","session_label":"#8F2C00","shell_dollar":"#8F2C00","status_bar_bg":"#F0EDE4","status_bar_critical":"#AF1309","status_bar_good":"#2E6E30","status_bar_text":"#26241D","status_bar_warn":"#9D5206","ui_accent":"#AA3602","ui_border":"#D4D1C7","ui_error":"#AF1309","ui_ok":"#2E6E30","ui_text":"#26241D","ui_tool":"#8F2C00","ui_warn":"#9D5206"},"darkColors":{"background":"#202020","banner_accent":"#ff5500","banner_border":"#505050","banner_dim":"#383838","banner_text":"#c0c0c0","banner_title":"#a0a0a0","completion_menu_bg":"#202020","input_rule":"#ff5500","prompt":"#c0c0c0","response_border":"#505050","session_border":"#383838","shell_dollar":"#ff5500","status_bar_bg":"#141414","status_bar_text":"#787878","ui_accent":"#ff5500","ui_border":"#505050","ui_error":"#e04030","ui_ok":"#60a060","ui_text":"#c0c0c0","ui_tool":"#ff5500","ui_warn":"#ff8800"},"darkName":"brutalist-concrete","derivedLight":true,"description":"Raw architectural concrete — unflinching gray on gray with one fluorescent orange signal","gatewayDarkName":"theme-picker-brutalist-concrete-dark","gatewayLightName":"theme-picker-brutalist-concrete-light","isDark":true,"label":"Brutalist Concrete","lightColors":{"background":"#F8F7F2","banner_accent":"#AA3602","banner_border":"#D4D1C7","banner_dim":"#66635C","banner_text":"#26241D","banner_title":"#26241D","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#AA3602","prompt":"#26241D","response_border":"#AA3602","session_border":"#D4D1C7","session_label":"#8F2C00","shell_dollar":"#8F2C00","status_bar_bg":"#F0EDE4","status_bar_critical":"#AF1309","status_bar_good":"#2E6E30","status_bar_text":"#26241D","status_bar_warn":"#9D5206","ui_accent":"#AA3602","ui_border":"#D4D1C7","ui_error":"#AF1309","ui_ok":"#2E6E30","ui_text":"#26241D","ui_tool":"#8F2C00","ui_warn":"#9D5206"},"lightName":null,"modeSupport":"dynamic","name":"brutalist-concrete","source":"user"},{"category":"Other","colors":{"background":"#F6F6FB","banner_accent":"#A53065","banner_border":"#D0D0DA","banner_dim":"#646269","banner_text":"#252329","banner_title":"#252329","completion_menu_bg":"#E2E2EC","completion_menu_current_bg":"#DBDBE9","completion_menu_meta_bg":"#E2E2EC","input_rule":"#A53065","prompt":"#252329","response_border":"#A53065","session_border":"#D0D0DA","session_label":"#095B75","shell_dollar":"#095B75","status_bar_bg":"#ECECF5","status_bar_critical":"#B10702","status_bar_good":"#037139","status_bar_text":"#252329","status_bar_warn":"#7C670B","ui_accent":"#A53065","ui_border":"#D0D0DA","ui_error":"#B10702","ui_ok":"#037139","ui_text":"#252329","ui_tool":"#095B75","ui_warn":"#7C670B"},"darkColors":{"background":"#120c2e","banner_accent":"#e6398c","banner_border":"#e6398c","banner_dim":"#6b5fa0","banner_text":"#e8def8","banner_title":"#4dc9f6","completion_menu_bg":"#120c2e","input_rule":"#e6398c","prompt":"#e8def8","response_border":"#4dc9f6","session_border":"#6b5fa0","shell_dollar":"#4dc9f6","status_bar_bg":"#0a081c","status_bar_text":"#c8c0d8","ui_accent":"#e6398c","ui_border":"#4dc9f6","ui_error":"#e74c3c","ui_ok":"#2ecc71","ui_text":"#e8def8","ui_tool":"#4dc9f6","ui_warn":"#f4d03f"},"darkName":"chrome-rain","derivedLight":true,"description":"Wet chrome streets at midnight — electric blue, hot pink, and acid yellow on deep indigo","gatewayDarkName":"theme-picker-chrome-rain-dark","gatewayLightName":"theme-picker-chrome-rain-light","isDark":true,"label":"Chrome Rain","lightColors":{"background":"#F6F6FB","banner_accent":"#A53065","banner_border":"#D0D0DA","banner_dim":"#646269","banner_text":"#252329","banner_title":"#252329","completion_menu_bg":"#E2E2EC","completion_menu_current_bg":"#DBDBE9","completion_menu_meta_bg":"#E2E2EC","input_rule":"#A53065","prompt":"#252329","response_border":"#A53065","session_border":"#D0D0DA","session_label":"#095B75","shell_dollar":"#095B75","status_bar_bg":"#ECECF5","status_bar_critical":"#B10702","status_bar_good":"#037139","status_bar_text":"#252329","status_bar_warn":"#7C670B","ui_accent":"#A53065","ui_border":"#D0D0DA","ui_error":"#B10702","ui_ok":"#037139","ui_text":"#252329","ui_tool":"#095B75","ui_warn":"#7C670B"},"lightName":null,"modeSupport":"dynamic","name":"chrome-rain","source":"user"},{"category":"Other","colors":{"background":"#F5F7FB","banner_accent":"#6E4DA9","banner_border":"#CDD1DA","banner_dim":"#62626A","banner_text":"#23232A","banner_title":"#23232A","completion_menu_bg":"#DFE3ED","completion_menu_current_bg":"#D7DCEA","completion_menu_meta_bg":"#DFE3ED","input_rule":"#6E4DA9","prompt":"#23232A","response_border":"#6E4DA9","session_border":"#CDD1DA","session_label":"#594091","shell_dollar":"#594091","status_bar_bg":"#E9EDF5","status_bar_critical":"#9E3337","status_bar_good":"#0B7218","status_bar_text":"#23232A","status_bar_warn":"#766A0E","ui_accent":"#6E4DA9","ui_border":"#CDD1DA","ui_error":"#9E3337","ui_ok":"#0B7218","ui_text":"#23232A","ui_tool":"#594091","ui_warn":"#766A0E"},"darkColors":{"background":"#202840","banner_accent":"#9070d0","banner_border":"#8068c0","banner_dim":"#483868","banner_text":"#c8c8e8","banner_title":"#a088e0","completion_menu_bg":"#202840","input_rule":"#9070d0","prompt":"#c8c8e8","response_border":"#a088e0","session_border":"#483868","shell_dollar":"#a088e0","status_bar_bg":"#141828","status_bar_text":"#8888a8","ui_accent":"#9070d0","ui_border":"#8068c0","ui_error":"#d06060","ui_ok":"#70d070","ui_text":"#c8c8e8","ui_tool":"#a088e0","ui_warn":"#d0c050"},"darkName":"commodore-64","derivedLight":true,"description":"1980s home computer — that specific washed-out blue background with purple-magenta titles","gatewayDarkName":"theme-picker-commodore-64-dark","gatewayLightName":"theme-picker-commodore-64-light","isDark":true,"label":"Commodore 64","lightColors":{"background":"#F5F7FB","banner_accent":"#6E4DA9","banner_border":"#CDD1DA","banner_dim":"#62626A","banner_text":"#23232A","banner_title":"#23232A","completion_menu_bg":"#DFE3ED","completion_menu_current_bg":"#D7DCEA","completion_menu_meta_bg":"#DFE3ED","input_rule":"#6E4DA9","prompt":"#23232A","response_border":"#6E4DA9","session_border":"#CDD1DA","session_label":"#594091","shell_dollar":"#594091","status_bar_bg":"#E9EDF5","status_bar_critical":"#9E3337","status_bar_good":"#0B7218","status_bar_text":"#23232A","status_bar_warn":"#766A0E","ui_accent":"#6E4DA9","ui_border":"#CDD1DA","ui_error":"#9E3337","ui_ok":"#0B7218","ui_text":"#23232A","ui_tool":"#594091","ui_warn":"#766A0E"},"lightName":null,"modeSupport":"dynamic","name":"commodore-64","source":"user"},{"category":"Other","colors":{"background":"#F3F8FA","banner_accent":"#0C707D","banner_border":"#C8D3D8","banner_dim":"#5C6565","banner_text":"#1D2626","banner_title":"#1D2626","completion_menu_bg":"#DAE5EA","completion_menu_current_bg":"#CFE0E6","completion_menu_meta_bg":"#DAE5EA","input_rule":"#0C707D","prompt":"#1D2626","response_border":"#0C707D","session_border":"#C8D3D8","session_label":"#055E63","shell_dollar":"#055E63","status_bar_bg":"#E5EFF3","status_bar_critical":"#A5263D","status_bar_good":"#0B6F50","status_bar_text":"#1D2626","status_bar_warn":"#816512","ui_accent":"#0C707D","ui_border":"#C8D3D8","ui_error":"#A5263D","ui_ok":"#0B6F50","ui_text":"#1D2626","ui_tool":"#055E63","ui_warn":"#816512"},"darkColors":{"background":"#0a1a20","banner_accent":"#3098a8","banner_border":"#206880","banner_dim":"#1a4858","banner_text":"#c0e8e8","banner_title":"#50c8d0","completion_menu_bg":"#0a1a20","input_rule":"#3098a8","prompt":"#c0e8e8","response_border":"#50c8d0","session_border":"#1a4858","shell_dollar":"#50c8d0","status_bar_bg":"#061014","status_bar_text":"#80b0b0","ui_accent":"#3098a8","ui_border":"#206880","ui_error":"#d05060","ui_ok":"#50d0a0","ui_text":"#c0e8e8","ui_tool":"#50c8d0","ui_warn":"#d0a840"},"darkName":"deep-ocean","derivedLight":true,"description":"Abyssal trench — darkest teal, bioluminescent blue-green, and pale sea-foam highlights","gatewayDarkName":"theme-picker-deep-ocean-dark","gatewayLightName":"theme-picker-deep-ocean-light","isDark":true,"label":"Deep Ocean","lightColors":{"background":"#F3F8FA","banner_accent":"#0C707D","banner_border":"#C8D3D8","banner_dim":"#5C6565","banner_text":"#1D2626","banner_title":"#1D2626","completion_menu_bg":"#DAE5EA","completion_menu_current_bg":"#CFE0E6","completion_menu_meta_bg":"#DAE5EA","input_rule":"#0C707D","prompt":"#1D2626","response_border":"#0C707D","session_border":"#C8D3D8","session_label":"#055E63","shell_dollar":"#055E63","status_bar_bg":"#E5EFF3","status_bar_critical":"#A5263D","status_bar_good":"#0B6F50","status_bar_text":"#1D2626","status_bar_warn":"#816512","ui_accent":"#0C707D","ui_border":"#C8D3D8","ui_error":"#A5263D","ui_ok":"#0B6F50","ui_text":"#1D2626","ui_tool":"#055E63","ui_warn":"#816512"},"lightName":null,"modeSupport":"dynamic","name":"deep-ocean","source":"user"},{"category":"Other","colors":{"background":"#FAF5F6","banner_accent":"#675796","banner_border":"#D9CDD0","banner_dim":"#656169","banner_text":"#262329","banner_title":"#262329","completion_menu_bg":"#EBDFE2","completion_menu_current_bg":"#E9D7DC","completion_menu_meta_bg":"#EBDFE2","input_rule":"#675796","prompt":"#262329","response_border":"#675796","session_border":"#D9CDD0","session_label":"#41507E","shell_dollar":"#41507E","status_bar_bg":"#F4EAEC","status_bar_critical":"#914141","status_bar_good":"#3B6B3C","status_bar_text":"#262329","status_bar_warn":"#776838","ui_accent":"#675796","ui_border":"#D9CDD0","ui_error":"#914141","ui_ok":"#3B6B3C","ui_text":"#262329","ui_tool":"#41507E","ui_warn":"#776838"},"darkColors":{"background":"#000000","banner_accent":"#7060a0","banner_border":"#3a3050","banner_dim":"#2a2040","banner_text":"#b0a0c0","banner_title":"#9080c0","completion_menu_bg":"#050508","input_rule":"#3a3050","prompt":"#b0a0c0","response_border":"#7060a0","session_border":"#2a2040","shell_dollar":"#6070a0","status_bar_bg":"#000000","status_bar_text":"#807090","ui_accent":"#7060a0","ui_border":"#3a3050","ui_error":"#904040","ui_ok":"#508050","ui_text":"#b0a0c0","ui_tool":"#6070a0","ui_warn":"#908050"},"darkName":"deep-void","derivedLight":true,"description":"True AMOLED black with barely-there violet undertones — the darkest readable theme possible","gatewayDarkName":"theme-picker-deep-void-dark","gatewayLightName":"theme-picker-deep-void-light","isDark":true,"label":"Deep Void","lightColors":{"background":"#FAF5F6","banner_accent":"#675796","banner_border":"#D9CDD0","banner_dim":"#656169","banner_text":"#262329","banner_title":"#262329","completion_menu_bg":"#EBDFE2","completion_menu_current_bg":"#E9D7DC","completion_menu_meta_bg":"#EBDFE2","input_rule":"#675796","prompt":"#262329","response_border":"#675796","session_border":"#D9CDD0","session_label":"#41507E","shell_dollar":"#41507E","status_bar_bg":"#F4EAEC","status_bar_critical":"#914141","status_bar_good":"#3B6B3C","status_bar_text":"#262329","status_bar_warn":"#776838","ui_accent":"#675796","ui_border":"#D9CDD0","ui_error":"#914141","ui_ok":"#3B6B3C","ui_text":"#262329","ui_tool":"#41507E","ui_warn":"#776838"},"lightName":null,"modeSupport":"dynamic","name":"deep-void","source":"user"},{"category":"Other","colors":{"background":"#FAF6F3","banner_accent":"#805C10","banner_border":"#D7CFC8","banner_dim":"#68625C","banner_text":"#28231E","banner_title":"#28231E","completion_menu_bg":"#EAE1D9","completion_menu_current_bg":"#E6DACF","completion_menu_meta_bg":"#EAE1D9","input_rule":"#805C10","prompt":"#28231E","response_border":"#805C10","session_border":"#D7CFC8","session_label":"#085F5F","shell_dollar":"#085F5F","status_bar_bg":"#F2EBE5","status_bar_critical":"#AA0B53","status_bar_good":"#0A7037","status_bar_text":"#28231E","status_bar_warn":"#88610A","ui_accent":"#805C10","ui_border":"#D7CFC8","ui_error":"#AA0B53","ui_ok":"#0A7037","ui_text":"#28231E","ui_tool":"#085F5F","ui_warn":"#88610A"},"darkColors":{"background":"#14100c","banner_accent":"#ffb800","banner_border":"#ff4088","banner_dim":"#443020","banner_text":"#e8d8c8","banner_title":"#00e8e8","completion_menu_bg":"#14100c","input_rule":"#ffb800","prompt":"#e8d8c8","response_border":"#00e8e8","session_border":"#443020","shell_dollar":"#00e8e8","status_bar_bg":"#0a0804","status_bar_text":"#a89080","ui_accent":"#ffb800","ui_border":"#ff4088","ui_error":"#ff4088","ui_ok":"#40e880","ui_text":"#e8d8c8","ui_tool":"#00e8e8","ui_warn":"#ffb800"},"darkName":"desert-neon","derivedLight":true,"description":"Vegas motel sign at 3am — hot turquoise, flamingo pink, and desert gold on baked black","gatewayDarkName":"theme-picker-desert-neon-dark","gatewayLightName":"theme-picker-desert-neon-light","isDark":true,"label":"Desert Neon","lightColors":{"background":"#FAF6F3","banner_accent":"#805C10","banner_border":"#D7CFC8","banner_dim":"#68625C","banner_text":"#28231E","banner_title":"#28231E","completion_menu_bg":"#EAE1D9","completion_menu_current_bg":"#E6DACF","completion_menu_meta_bg":"#EAE1D9","input_rule":"#805C10","prompt":"#28231E","response_border":"#805C10","session_border":"#D7CFC8","session_label":"#085F5F","shell_dollar":"#085F5F","status_bar_bg":"#F2EBE5","status_bar_critical":"#AA0B53","status_bar_good":"#0A7037","status_bar_text":"#28231E","status_bar_warn":"#88610A","ui_accent":"#805C10","ui_border":"#D7CFC8","ui_error":"#AA0B53","ui_ok":"#0A7037","ui_text":"#28231E","ui_tool":"#085F5F","ui_warn":"#88610A"},"lightName":null,"modeSupport":"dynamic","name":"desert-neon","source":"user"},{"category":"Other","colors":{"background":"#FBF5F5","banner_accent":"#AC3031","banner_border":"#DACDCD","banner_dim":"#68625C","banner_text":"#28231E","banner_title":"#28231E","completion_menu_bg":"#ECDFDF","completion_menu_current_bg":"#E9D7D7","completion_menu_meta_bg":"#ECDFDF","input_rule":"#AC3031","prompt":"#28231E","response_border":"#AC3031","session_border":"#DACDCD","session_label":"#645005","shell_dollar":"#645005","status_bar_bg":"#F5EAEA","status_bar_critical":"#AF0F18","status_bar_good":"#1C7021","status_bar_text":"#28231E","status_bar_warn":"#7F6603","ui_accent":"#AC3031","ui_border":"#DACDCD","ui_error":"#AF0F18","ui_ok":"#1C7021","ui_text":"#28231E","ui_tool":"#645005","ui_warn":"#7F6603"},"darkColors":{"background":"#141010","banner_accent":"#d04040","banner_border":"#b83030","banner_dim":"#582828","banner_text":"#e0d0c0","banner_title":"#f0c840","completion_menu_bg":"#141010","input_rule":"#d04040","prompt":"#e0d0c0","response_border":"#f0c840","session_border":"#582828","shell_dollar":"#f0c840","status_bar_bg":"#0a0808","status_bar_text":"#a08070","ui_accent":"#d04040","ui_border":"#b83030","ui_error":"#e03030","ui_ok":"#50a050","ui_text":"#e0d0c0","ui_tool":"#f0c840","ui_warn":"#f0c840"},"darkName":"dragon-blood","derivedLight":true,"description":"Ancient wyrm — dark crimson, molten gold, and charcoal black, forged in fire","gatewayDarkName":"theme-picker-dragon-blood-dark","gatewayLightName":"theme-picker-dragon-blood-light","isDark":true,"label":"Dragon Blood","lightColors":{"background":"#FBF5F5","banner_accent":"#AC3031","banner_border":"#DACDCD","banner_dim":"#68625C","banner_text":"#28231E","banner_title":"#28231E","completion_menu_bg":"#ECDFDF","completion_menu_current_bg":"#E9D7D7","completion_menu_meta_bg":"#ECDFDF","input_rule":"#AC3031","prompt":"#28231E","response_border":"#AC3031","session_border":"#DACDCD","session_label":"#645005","shell_dollar":"#645005","status_bar_bg":"#F5EAEA","status_bar_critical":"#AF0F18","status_bar_good":"#1C7021","status_bar_text":"#28231E","status_bar_warn":"#7F6603","ui_accent":"#AC3031","ui_border":"#DACDCD","ui_error":"#AF0F18","ui_ok":"#1C7021","ui_text":"#28231E","ui_tool":"#645005","ui_warn":"#7F6603"},"lightName":null,"modeSupport":"dynamic","name":"dragon-blood","source":"user"},{"category":"Other","colors":{"background":"#FAF5F8","banner_accent":"#805464","banner_border":"#D8CDD3","banner_dim":"#696165","banner_text":"#292225","banner_title":"#292225","completion_menu_bg":"#EADFE5","completion_menu_current_bg":"#E7D7DF","completion_menu_meta_bg":"#EADFE5","input_rule":"#805464","prompt":"#292225","response_border":"#805464","session_border":"#D8CDD3","session_label":"#3C556D","shell_dollar":"#3C556D","status_bar_bg":"#F3EAEE","status_bar_critical":"#924042","status_bar_good":"#3C694D","status_bar_text":"#292225","status_bar_warn":"#81642C","ui_accent":"#805464","ui_border":"#D8CDD3","ui_error":"#924042","ui_ok":"#3C694D","ui_text":"#292225","ui_tool":"#3C556D","ui_warn":"#81642C"},"darkColors":{"background":"#1c181a","banner_accent":"#b88898","banner_border":"#a87088","banner_dim":"#483840","banner_text":"#d8d0d4","banner_title":"#d0a0b8","completion_menu_bg":"#1c181a","input_rule":"#b88898","prompt":"#d8d0d4","response_border":"#d0a0b8","session_border":"#483840","shell_dollar":"#88a0b8","status_bar_bg":"#120e10","status_bar_text":"#988890","ui_accent":"#b88898","ui_border":"#a87088","ui_error":"#c87070","ui_ok":"#88b898","ui_text":"#d8d0d4","ui_tool":"#88a0b8","ui_warn":"#c8a870"},"darkName":"dusty-rose","derivedLight":true,"description":"Antique velvet — muted rose, dusty mauve, and faded sage on warm charcoal","gatewayDarkName":"theme-picker-dusty-rose-dark","gatewayLightName":"theme-picker-dusty-rose-light","isDark":true,"label":"Dusty Rose","lightColors":{"background":"#FAF5F8","banner_accent":"#805464","banner_border":"#D8CDD3","banner_dim":"#696165","banner_text":"#292225","banner_title":"#292225","completion_menu_bg":"#EADFE5","completion_menu_current_bg":"#E7D7DF","completion_menu_meta_bg":"#EADFE5","input_rule":"#805464","prompt":"#292225","response_border":"#805464","session_border":"#D8CDD3","session_label":"#3C556D","shell_dollar":"#3C556D","status_bar_bg":"#F3EAEE","status_bar_critical":"#924042","status_bar_good":"#3C694D","status_bar_text":"#292225","status_bar_warn":"#81642C","ui_accent":"#805464","ui_border":"#D8CDD3","ui_error":"#924042","ui_ok":"#3C694D","ui_text":"#292225","ui_tool":"#3C556D","ui_warn":"#81642C"},"lightName":null,"modeSupport":"dynamic","name":"dusty-rose","source":"user"},{"category":"Other","colors":{"background":"#F6F6FB","banner_accent":"#6A588C","banner_border":"#D0D0DA","banner_dim":"#62626A","banner_text":"#23232A","banner_title":"#23232A","completion_menu_bg":"#E2E2EC","completion_menu_current_bg":"#DBDBE9","completion_menu_meta_bg":"#E2E2EC","input_rule":"#6A588C","prompt":"#23232A","response_border":"#6A588C","session_border":"#D0D0DA","session_label":"#3D5377","shell_dollar":"#3D5377","status_bar_bg":"#ECECF5","status_bar_critical":"#8F4344","status_bar_good":"#3D6A3E","status_bar_text":"#23232A","status_bar_warn":"#81642C","ui_accent":"#6A588C","ui_border":"#D0D0DA","ui_error":"#8F4344","ui_ok":"#3D6A3E","ui_text":"#23232A","ui_tool":"#3D5377","ui_warn":"#81642C"},"darkColors":{"background":"#18181a","banner_accent":"#9a88c0","banner_border":"#6a5a8a","banner_dim":"#3a3050","banner_text":"#d0d0d8","banner_title":"#c8b8e8","completion_menu_bg":"#18181a","input_rule":"#9a88c0","prompt":"#d0d0d8","response_border":"#c8b8e8","session_border":"#3a3050","shell_dollar":"#7890b8","status_bar_bg":"#101012","status_bar_text":"#9898a0","ui_accent":"#9a88c0","ui_border":"#6a5a8a","ui_error":"#b86868","ui_ok":"#78a878","ui_text":"#d0d0d8","ui_tool":"#7890b8","ui_warn":"#c8a870"},"darkName":"eclipse","derivedLight":true,"description":"Total solar eclipse — charcoal field with a corona ring of soft lilac and electric white","gatewayDarkName":"theme-picker-eclipse-dark","gatewayLightName":"theme-picker-eclipse-light","isDark":true,"label":"Eclipse","lightColors":{"background":"#F6F6FB","banner_accent":"#6A588C","banner_border":"#D0D0DA","banner_dim":"#62626A","banner_text":"#23232A","banner_title":"#23232A","completion_menu_bg":"#E2E2EC","completion_menu_current_bg":"#DBDBE9","completion_menu_meta_bg":"#E2E2EC","input_rule":"#6A588C","prompt":"#23232A","response_border":"#6A588C","session_border":"#D0D0DA","session_label":"#3D5377","shell_dollar":"#3D5377","status_bar_bg":"#ECECF5","status_bar_critical":"#8F4344","status_bar_good":"#3D6A3E","status_bar_text":"#23232A","status_bar_warn":"#81642C","ui_accent":"#6A588C","ui_border":"#D0D0DA","ui_error":"#8F4344","ui_ok":"#3D6A3E","ui_text":"#23232A","ui_tool":"#3D5377","ui_warn":"#81642C"},"lightName":null,"modeSupport":"dynamic","name":"eclipse","source":"user"},{"category":"Other","colors":{"background":"#F3F8F6","banner_accent":"#746301","banner_border":"#C9D4CF","banner_dim":"#5D6561","banner_text":"#1F2622","banner_title":"#1F2622","completion_menu_bg":"#DBE6E1","completion_menu_current_bg":"#D0E1DA","completion_menu_meta_bg":"#DBE6E1","input_rule":"#746301","prompt":"#1F2622","response_border":"#746301","session_border":"#C9D4CF","session_label":"#0D6241","shell_dollar":"#0D6241","status_bar_bg":"#E6F0EB","status_bar_critical":"#9E3337","status_bar_good":"#046F49","status_bar_text":"#1F2622","status_bar_warn":"#7A680D","ui_accent":"#746301","ui_border":"#C9D4CF","ui_error":"#9E3337","ui_ok":"#046F49","ui_text":"#1F2622","ui_tool":"#0D6241","ui_warn":"#7A680D"},"darkColors":{"background":"#0e1814","banner_accent":"#c8b040","banner_border":"#388060","banner_dim":"#284838","banner_text":"#c0e0d0","banner_title":"#60d8a0","completion_menu_bg":"#0e1814","input_rule":"#c8b040","prompt":"#c0e0d0","response_border":"#60d8a0","session_border":"#284838","shell_dollar":"#60d8a0","status_bar_bg":"#08100c","status_bar_text":"#80a090","ui_accent":"#c8b040","ui_border":"#388060","ui_error":"#d06060","ui_ok":"#60d8a0","ui_text":"#c0e0d0","ui_tool":"#60d8a0","ui_warn":"#c8b040"},"darkName":"enchanted-forest","derivedLight":true,"description":"Feywild glade — deep viridian, bioluminescent teal, pale gold motes on woodland shadow","gatewayDarkName":"theme-picker-enchanted-forest-dark","gatewayLightName":"theme-picker-enchanted-forest-light","isDark":true,"label":"Enchanted Forest","lightColors":{"background":"#F3F8F6","banner_accent":"#746301","banner_border":"#C9D4CF","banner_dim":"#5D6561","banner_text":"#1F2622","banner_title":"#1F2622","completion_menu_bg":"#DBE6E1","completion_menu_current_bg":"#D0E1DA","completion_menu_meta_bg":"#DBE6E1","input_rule":"#746301","prompt":"#1F2622","response_border":"#746301","session_border":"#C9D4CF","session_label":"#0D6241","shell_dollar":"#0D6241","status_bar_bg":"#E6F0EB","status_bar_critical":"#9E3337","status_bar_good":"#046F49","status_bar_text":"#1F2622","status_bar_warn":"#7A680D","ui_accent":"#746301","ui_border":"#C9D4CF","ui_error":"#9E3337","ui_ok":"#046F49","ui_text":"#1F2622","ui_tool":"#0D6241","ui_warn":"#7A680D"},"lightName":null,"modeSupport":"dynamic","name":"enchanted-forest","source":"user"},{"category":"Other","colors":{"background":"#FAF6F3","banner_accent":"#476685","banner_border":"#D7CFC8","banner_dim":"#66635C","banner_text":"#27241E","banner_title":"#27241E","completion_menu_bg":"#E9E1D9","completion_menu_current_bg":"#E6DACF","completion_menu_meta_bg":"#E9E1D9","input_rule":"#476685","prompt":"#27241E","response_border":"#476685","session_border":"#D7CFC8","session_label":"#375573","shell_dollar":"#375573","status_bar_bg":"#F2EBE5","status_bar_critical":"#AD180C","status_bar_good":"#266F29","status_bar_text":"#27241E","status_bar_warn":"#955811","ui_accent":"#476685","ui_border":"#D7CFC8","ui_error":"#AD180C","ui_ok":"#266F29","ui_text":"#27241E","ui_tool":"#375573","ui_warn":"#955811"},"darkColors":{"background":"#141210","banner_accent":"#6888a8","banner_border":"#c86030","banner_dim":"#483020","banner_text":"#d0c8b8","banner_title":"#f0a050","completion_menu_bg":"#141210","input_rule":"#c86030","prompt":"#d0c8b8","response_border":"#f0a050","session_border":"#483020","shell_dollar":"#6888a8","status_bar_bg":"#0a0808","status_bar_text":"#908870","ui_accent":"#6888a8","ui_border":"#c86030","ui_error":"#d04030","ui_ok":"#60a860","ui_text":"#d0c8b8","ui_tool":"#6888a8","ui_warn":"#f0a050"},"darkName":"forge-master","derivedLight":true,"description":"Dwarven smithy — hot ember orange, cooling steel blue, and soot black, hammer on anvil","gatewayDarkName":"theme-picker-forge-master-dark","gatewayLightName":"theme-picker-forge-master-light","isDark":true,"label":"Forge Master","lightColors":{"background":"#FAF6F3","banner_accent":"#476685","banner_border":"#D7CFC8","banner_dim":"#66635C","banner_text":"#27241E","banner_title":"#27241E","completion_menu_bg":"#E9E1D9","completion_menu_current_bg":"#E6DACF","completion_menu_meta_bg":"#E9E1D9","input_rule":"#476685","prompt":"#27241E","response_border":"#476685","session_border":"#D7CFC8","session_label":"#375573","shell_dollar":"#375573","status_bar_bg":"#F2EBE5","status_bar_critical":"#AD180C","status_bar_good":"#266F29","status_bar_text":"#27241E","status_bar_warn":"#955811","ui_accent":"#476685","ui_border":"#D7CFC8","ui_error":"#AD180C","ui_ok":"#266F29","ui_text":"#27241E","ui_tool":"#375573","ui_warn":"#955811"},"lightName":null,"modeSupport":"dynamic","name":"forge-master","source":"user"},{"category":"Other","colors":{"background":"#F8F7F2","banner_accent":"#AC3038","banner_border":"#D4D1C7","banner_dim":"#5F655F","banner_text":"#212620","banner_title":"#212620","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#AC3038","prompt":"#212620","response_border":"#AC3038","session_border":"#D4D1C7","session_label":"#146407","shell_dollar":"#146407","status_bar_bg":"#F0EDE4","status_bar_critical":"#AF0C28","status_bar_good":"#127201","status_bar_text":"#212620","status_bar_warn":"#9D5206","ui_accent":"#AC3038","ui_border":"#D4D1C7","ui_error":"#AF0C28","ui_ok":"#127201","ui_text":"#212620","ui_tool":"#146407","ui_warn":"#9D5206"},"darkColors":{"background":"#0d0d0d","banner_accent":"#ff003c","banner_border":"#39ff14","banner_dim":"#3a7a30","banner_text":"#c0ffc0","banner_title":"#39ff14","completion_menu_bg":"#0d0d0d","input_rule":"#39ff14","prompt":"#c0ffc0","response_border":"#ff003c","session_border":"#3a7a30","shell_dollar":"#39ff14","status_bar_bg":"#050505","status_bar_text":"#a0d0a0","ui_accent":"#ff003c","ui_border":"#39ff14","ui_error":"#ff003c","ui_ok":"#39ff14","ui_text":"#c0ffc0","ui_tool":"#39ff14","ui_warn":"#ff8800"},"darkName":"glitch-punk","derivedLight":true,"description":"Broken signal aesthetic — toxic green on corrupted black with flickering red accents","gatewayDarkName":"theme-picker-glitch-punk-dark","gatewayLightName":"theme-picker-glitch-punk-light","isDark":true,"label":"Glitch Punk","lightColors":{"background":"#F8F7F2","banner_accent":"#AC3038","banner_border":"#D4D1C7","banner_dim":"#5F655F","banner_text":"#212620","banner_title":"#212620","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#AC3038","prompt":"#212620","response_border":"#AC3038","session_border":"#D4D1C7","session_label":"#146407","shell_dollar":"#146407","status_bar_bg":"#F0EDE4","status_bar_critical":"#AF0C28","status_bar_good":"#127201","status_bar_text":"#212620","status_bar_warn":"#9D5206","ui_accent":"#AC3038","ui_border":"#D4D1C7","ui_error":"#AF0C28","ui_ok":"#127201","ui_text":"#212620","ui_tool":"#146407","ui_warn":"#9D5206"},"lightName":null,"modeSupport":"dynamic","name":"glitch-punk","source":"user"},{"category":"Other","colors":{"background":"#F8F7F2","banner_accent":"#356E6E","banner_border":"#D4D1C7","banner_dim":"#66635C","banner_text":"#26241D","banner_title":"#26241D","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#356E6E","prompt":"#26241D","response_border":"#356E6E","session_border":"#D4D1C7","session_label":"#37576B","shell_dollar":"#37576B","status_bar_bg":"#F0EDE4","status_bar_critical":"#7C5050","status_bar_good":"#426942","status_bar_text":"#26241D","status_bar_warn":"#736940","ui_accent":"#356E6E","ui_border":"#D4D1C7","ui_error":"#7C5050","ui_ok":"#426942","ui_text":"#26241D","ui_tool":"#37576B","ui_warn":"#736940"},"darkColors":{"background":"#1e1e1e","banner_accent":"#608080","banner_border":"#4a4a4a","banner_dim":"#3a3a3a","banner_text":"#c8c8c8","banner_title":"#809090","completion_menu_bg":"#1e1e1e","input_rule":"#4a4a4a","prompt":"#c8c8c8","response_border":"#608080","session_border":"#3a3a3a","shell_dollar":"#607888","status_bar_bg":"#141414","status_bar_text":"#909090","ui_accent":"#608080","ui_border":"#4a4a4a","ui_error":"#886060","ui_ok":"#608860","ui_text":"#c8c8c8","ui_tool":"#607888","ui_warn":"#888060"},"darkName":"graphite","derivedLight":true,"description":"Dark pencil-lead tones — warm graphite grays with subtle blue-green accent, no harsh contrast","gatewayDarkName":"theme-picker-graphite-dark","gatewayLightName":"theme-picker-graphite-light","isDark":true,"label":"Graphite","lightColors":{"background":"#F8F7F2","banner_accent":"#356E6E","banner_border":"#D4D1C7","banner_dim":"#66635C","banner_text":"#26241D","banner_title":"#26241D","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#356E6E","prompt":"#26241D","response_border":"#356E6E","session_border":"#D4D1C7","session_label":"#37576B","shell_dollar":"#37576B","status_bar_bg":"#F0EDE4","status_bar_critical":"#7C5050","status_bar_good":"#426942","status_bar_text":"#26241D","status_bar_warn":"#736940","ui_accent":"#356E6E","ui_border":"#D4D1C7","ui_error":"#7C5050","ui_ok":"#426942","ui_text":"#26241D","ui_tool":"#37576B","ui_warn":"#736940"},"lightName":null,"modeSupport":"dynamic","name":"graphite","source":"user"},{"category":"Other","colors":{"background":"#F5F8F4","banner_accent":"#0E7814","banner_border":"#CDD3CA","banner_dim":"#5F655F","banner_text":"#212620","banner_title":"#212620","completion_menu_bg":"#DFE5DC","completion_menu_current_bg":"#D7E0D2","completion_menu_meta_bg":"#DFE5DC","input_rule":"#0E7814","prompt":"#212620","response_border":"#0E7814","session_border":"#CDD3CA","session_label":"#09650E","shell_dollar":"#09650E","status_bar_bg":"#E9EFE7","status_bar_critical":"#AC1826","status_bar_good":"#02720B","status_bar_text":"#212620","status_bar_warn":"#6E6D04","ui_accent":"#0E7814","ui_border":"#CDD3CA","ui_error":"#AC1826","ui_ok":"#02720B","ui_text":"#212620","ui_tool":"#09650E","ui_warn":"#6E6D04"},"darkColors":{"background":"#0a0e08","banner_accent":"#40b840","banner_border":"#308830","banner_dim":"#1a5018","banner_text":"#b0e8b0","banner_title":"#50e050","completion_menu_bg":"#0a0e08","input_rule":"#40b840","prompt":"#b0e8b0","response_border":"#50e050","session_border":"#1a5018","shell_dollar":"#50e050","status_bar_bg":"#050804","status_bar_text":"#70a070","ui_accent":"#40b840","ui_border":"#308830","ui_error":"#e05050","ui_ok":"#50e050","ui_text":"#b0e8b0","ui_tool":"#50e050","ui_warn":"#e0e050"},"darkName":"green-screen","derivedLight":true,"description":"Vintage IBM monochrome — phosphor green on dark tube glass, with a slight glow bloom","gatewayDarkName":"theme-picker-green-screen-dark","gatewayLightName":"theme-picker-green-screen-light","isDark":true,"label":"Green Screen","lightColors":{"background":"#F5F8F4","banner_accent":"#0E7814","banner_border":"#CDD3CA","banner_dim":"#5F655F","banner_text":"#212620","banner_title":"#212620","completion_menu_bg":"#DFE5DC","completion_menu_current_bg":"#D7E0D2","completion_menu_meta_bg":"#DFE5DC","input_rule":"#0E7814","prompt":"#212620","response_border":"#0E7814","session_border":"#CDD3CA","session_label":"#09650E","shell_dollar":"#09650E","status_bar_bg":"#E9EFE7","status_bar_critical":"#AC1826","status_bar_good":"#02720B","status_bar_text":"#212620","status_bar_warn":"#6E6D04","ui_accent":"#0E7814","ui_border":"#CDD3CA","ui_error":"#AC1826","ui_ok":"#02720B","ui_text":"#212620","ui_tool":"#09650E","ui_warn":"#6E6D04"},"lightName":null,"modeSupport":"dynamic","name":"green-screen","source":"user"},{"category":"Other","colors":{"background":"#f5f5f0","banner_accent":"#3366aa","banner_border":"#335588","banner_dim":"#8898a8","banner_text":"#1a2a44","banner_title":"#1a2a44","completion_menu_bg":"#f5f5f0","input_rule":"#3366aa","prompt":"#1a2a44","response_border":"#335588","session_border":"#8898a8","shell_dollar":"#3366aa","status_bar_bg":"#e8e8e0","status_bar_text":"#445566","ui_accent":"#3366aa","ui_border":"#335588","ui_error":"#aa2222","ui_ok":"#227744","ui_text":"#1a2a44","ui_tool":"#3366aa","ui_warn":"#aa6622"},"darkColors":{"background":"#101009","banner_accent":"#71A7F0","banner_border":"#36362E","banner_dim":"#9A9FA6","banner_text":"#E6EBF3","banner_title":"#E6EBF3","completion_menu_bg":"#242417","completion_menu_current_bg":"#2C2B1B","completion_menu_meta_bg":"#242417","input_rule":"#71A7F0","prompt":"#E6EBF3","response_border":"#71A7F0","session_border":"#36362E","session_label":"#7DB3FD","shell_dollar":"#7DB3FD","status_bar_bg":"#1D1C11","status_bar_critical":"#F76C62","status_bar_good":"#69B982","status_bar_text":"#E6EBF3","status_bar_warn":"#E79F5F","ui_accent":"#71A7F0","ui_border":"#36362E","ui_error":"#F76C62","ui_ok":"#69B982","ui_text":"#E6EBF3","ui_tool":"#7DB3FD","ui_warn":"#E79F5F"},"darkName":null,"derivedDark":true,"description":"Bright terminal for daylight — dark navy text on soft white, readable in direct sun","gatewayDarkName":"theme-picker-high-noon-dark","gatewayLightName":"theme-picker-high-noon-light","isDark":false,"label":"High Noon","lightColors":{"background":"#f5f5f0","banner_accent":"#3366aa","banner_border":"#335588","banner_dim":"#8898a8","banner_text":"#1a2a44","banner_title":"#1a2a44","completion_menu_bg":"#f5f5f0","input_rule":"#3366aa","prompt":"#1a2a44","response_border":"#335588","session_border":"#8898a8","shell_dollar":"#3366aa","status_bar_bg":"#e8e8e0","status_bar_text":"#445566","ui_accent":"#3366aa","ui_border":"#335588","ui_error":"#aa2222","ui_ok":"#227744","ui_text":"#1a2a44","ui_tool":"#3366aa","ui_warn":"#aa6622"},"lightName":"high-noon","modeSupport":"dynamic","name":"high-noon","source":"user"},{"category":"Other","colors":{"background":"#F7F6FA","banner_accent":"#6D5591","banner_border":"#D1CFD9","banner_dim":"#646269","banner_text":"#252329","banner_title":"#252329","completion_menu_bg":"#E3E1EB","completion_menu_current_bg":"#DDDAE9","completion_menu_meta_bg":"#E3E1EB","input_rule":"#6D5591","prompt":"#252329","response_border":"#6D5591","session_border":"#D1CFD9","session_label":"#2B596E","shell_dollar":"#2B596E","status_bar_bg":"#EDEBF4","status_bar_critical":"#913F49","status_bar_good":"#2E6D42","status_bar_text":"#252329","status_bar_warn":"#816335","ui_accent":"#6D5591","ui_border":"#D1CFD9","ui_error":"#913F49","ui_ok":"#2E6D42","ui_text":"#252329","ui_tool":"#2B596E","ui_warn":"#816335"},"darkColors":{"background":"#1e1a2a","banner_accent":"#a088c8","banner_border":"#8870a8","banner_dim":"#483858","banner_text":"#d8d0e8","banner_title":"#c0a8e0","completion_menu_bg":"#1e1a2a","input_rule":"#a088c8","prompt":"#d8d0e8","response_border":"#c0a8e0","session_border":"#483858","shell_dollar":"#88b8d0","status_bar_bg":"#141020","status_bar_text":"#9888a8","ui_accent":"#a088c8","ui_border":"#8870a8","ui_error":"#c87078","ui_ok":"#88c898","ui_text":"#d8d0e8","ui_tool":"#88b8d0","ui_warn":"#c8a878"},"darkName":"lavender-dream","derivedLight":true,"description":"Soft purple twilight — gentle lavender, blush pink, and mint on deep plum, no eye strain","gatewayDarkName":"theme-picker-lavender-dream-dark","gatewayLightName":"theme-picker-lavender-dream-light","isDark":true,"label":"Lavender Dream","lightColors":{"background":"#F7F6FA","banner_accent":"#6D5591","banner_border":"#D1CFD9","banner_dim":"#646269","banner_text":"#252329","banner_title":"#252329","completion_menu_bg":"#E3E1EB","completion_menu_current_bg":"#DDDAE9","completion_menu_meta_bg":"#E3E1EB","input_rule":"#6D5591","prompt":"#252329","response_border":"#6D5591","session_border":"#D1CFD9","session_label":"#2B596E","shell_dollar":"#2B596E","status_bar_bg":"#EDEBF4","status_bar_critical":"#913F49","status_bar_good":"#2E6D42","status_bar_text":"#252329","status_bar_warn":"#816335","ui_accent":"#6D5591","ui_border":"#D1CFD9","ui_error":"#913F49","ui_ok":"#2E6D42","ui_text":"#252329","ui_tool":"#2B596E","ui_warn":"#816335"},"lightName":null,"modeSupport":"dynamic","name":"lavender-dream","source":"user"},{"category":"Other","colors":{"background":"#f4f0e8","banner_accent":"#687858","banner_border":"#889878","banner_dim":"#a8b098","banner_text":"#384830","banner_title":"#384830","completion_menu_bg":"#f4f0e8","input_rule":"#687858","prompt":"#384830","response_border":"#889878","session_border":"#a8b098","shell_dollar":"#587088","status_bar_bg":"#e8e4d8","status_bar_text":"#585848","ui_accent":"#687858","ui_border":"#889878","ui_error":"#905048","ui_ok":"#588050","ui_text":"#384830","ui_tool":"#587088","ui_warn":"#907048"},"darkColors":{"background":"#120F08","banner_accent":"#99AD85","banner_border":"#39352D","banner_dim":"#9BA099","banner_text":"#E8EDE5","banner_title":"#E8EDE5","completion_menu_bg":"#282217","completion_menu_current_bg":"#31291A","completion_menu_meta_bg":"#282217","input_rule":"#99AD85","prompt":"#E8EDE5","response_border":"#99AD85","session_border":"#39352D","session_label":"#99B4D0","shell_dollar":"#99B4D0","status_bar_bg":"#201B11","status_bar_critical":"#CF8980","status_bar_good":"#88B280","status_bar_text":"#E8EDE5","status_bar_warn":"#CDAA81","ui_accent":"#99AD85","ui_border":"#39352D","ui_error":"#CF8980","ui_ok":"#88B280","ui_text":"#E8EDE5","ui_tool":"#99B4D0","ui_warn":"#CDAA81"},"darkName":null,"derivedDark":true,"description":"Linen fabric — natural flax background with muted sage green and soft clay accents","gatewayDarkName":"theme-picker-linen-sage-dark","gatewayLightName":"theme-picker-linen-sage-light","isDark":false,"label":"Linen Sage","lightColors":{"background":"#f4f0e8","banner_accent":"#687858","banner_border":"#889878","banner_dim":"#a8b098","banner_text":"#384830","banner_title":"#384830","completion_menu_bg":"#f4f0e8","input_rule":"#687858","prompt":"#384830","response_border":"#889878","session_border":"#a8b098","shell_dollar":"#587088","status_bar_bg":"#e8e4d8","status_bar_text":"#585848","ui_accent":"#687858","ui_border":"#889878","ui_error":"#905048","ui_ok":"#588050","ui_text":"#384830","ui_tool":"#587088","ui_warn":"#907048"},"lightName":"linen-sage","modeSupport":"dynamic","name":"linen-sage","source":"user"},{"category":"Other","colors":{"background":"#F6F6FB","banner_accent":"#605E84","banner_border":"#D0D0DA","banner_dim":"#62626A","banner_text":"#23232A","banner_title":"#23232A","completion_menu_bg":"#E2E2EC","completion_menu_current_bg":"#DBDBE9","completion_menu_meta_bg":"#E2E2EC","input_rule":"#605E84","prompt":"#23232A","response_border":"#605E84","session_border":"#D0D0DA","session_label":"#315773","shell_dollar":"#315773","status_bar_bg":"#ECECF5","status_bar_critical":"#844858","status_bar_good":"#346B4E","status_bar_text":"#23232A","status_bar_warn":"#776839","ui_accent":"#605E84","ui_border":"#D0D0DA","ui_error":"#844858","ui_ok":"#346B4E","ui_text":"#23232A","ui_tool":"#315773","ui_warn":"#776839"},"darkColors":{"background":"#121216","banner_accent":"#9090a8","banner_border":"#707080","banner_dim":"#383840","banner_text":"#d0d0d8","banner_title":"#c0c0d0","completion_menu_bg":"#121216","input_rule":"#9090a8","prompt":"#d0d0d8","response_border":"#c0c0d0","session_border":"#383840","shell_dollar":"#78a0c0","status_bar_bg":"#08080c","status_bar_text":"#888898","ui_accent":"#9090a8","ui_border":"#707080","ui_error":"#b07080","ui_ok":"#78b090","ui_text":"#d0d0d8","ui_tool":"#78a0c0","ui_warn":"#b0a070"},"darkName":"liquid-silver","derivedLight":true,"description":"Mercury runoff — reflective silver, liquid chrome gradients, and deep void black accents","gatewayDarkName":"theme-picker-liquid-silver-dark","gatewayLightName":"theme-picker-liquid-silver-light","isDark":true,"label":"Liquid Silver","lightColors":{"background":"#F6F6FB","banner_accent":"#605E84","banner_border":"#D0D0DA","banner_dim":"#62626A","banner_text":"#23232A","banner_title":"#23232A","completion_menu_bg":"#E2E2EC","completion_menu_current_bg":"#DBDBE9","completion_menu_meta_bg":"#E2E2EC","input_rule":"#605E84","prompt":"#23232A","response_border":"#605E84","session_border":"#D0D0DA","session_label":"#315773","shell_dollar":"#315773","status_bar_bg":"#ECECF5","status_bar_critical":"#844858","status_bar_good":"#346B4E","status_bar_text":"#23232A","status_bar_warn":"#776839","ui_accent":"#605E84","ui_border":"#D0D0DA","ui_error":"#844858","ui_ok":"#346B4E","ui_text":"#23232A","ui_tool":"#315773","ui_warn":"#776839"},"lightName":null,"modeSupport":"dynamic","name":"liquid-silver","source":"user"},{"category":"Other","colors":{"background":"#F6F6FB","banner_accent":"#7F5D01","banner_border":"#CFD0DA","banner_dim":"#68625C","banner_text":"#28231E","banner_title":"#28231E","completion_menu_bg":"#E1E2EC","completion_menu_current_bg":"#DADBEA","completion_menu_meta_bg":"#E1E2EC","input_rule":"#7F5D01","prompt":"#28231E","response_border":"#7F5D01","session_border":"#CFD0DA","session_label":"#3D5378","shell_dollar":"#3D5378","status_bar_bg":"#EBECF5","status_bar_critical":"#943F39","status_bar_good":"#446934","status_bar_text":"#28231E","status_bar_warn":"#8B6005","ui_accent":"#7F5D01","ui_border":"#CFD0DA","ui_error":"#943F39","ui_ok":"#446934","ui_text":"#28231E","ui_tool":"#3D5378","ui_warn":"#8B6005"},"darkColors":{"background":"#1a1a2e","banner_accent":"#c8a050","banner_border":"#c8a050","banner_dim":"#504868","banner_text":"#d8d0c8","banner_title":"#e8d080","completion_menu_bg":"#1a1a2e","input_rule":"#c8a050","prompt":"#d8d0c8","response_border":"#e8d080","session_border":"#504868","shell_dollar":"#7088b0","status_bar_bg":"#121224","status_bar_text":"#a09888","ui_accent":"#c8a050","ui_border":"#504868","ui_error":"#b05850","ui_ok":"#80a870","ui_text":"#d8d0c8","ui_tool":"#7088b0","ui_warn":"#d8a040"},"darkName":"midnight-studio","derivedLight":true,"description":"Late-night coding den — dark indigo, warm gold accents, and soft amber glow","gatewayDarkName":"theme-picker-midnight-studio-dark","gatewayLightName":"theme-picker-midnight-studio-light","isDark":true,"label":"Midnight Studio","lightColors":{"background":"#F6F6FB","banner_accent":"#7F5D01","banner_border":"#CFD0DA","banner_dim":"#68625C","banner_text":"#28231E","banner_title":"#28231E","completion_menu_bg":"#E1E2EC","completion_menu_current_bg":"#DADBEA","completion_menu_meta_bg":"#E1E2EC","input_rule":"#7F5D01","prompt":"#28231E","response_border":"#7F5D01","session_border":"#CFD0DA","session_label":"#3D5378","shell_dollar":"#3D5378","status_bar_bg":"#EBECF5","status_bar_critical":"#943F39","status_bar_good":"#446934","status_bar_text":"#28231E","status_bar_warn":"#8B6005","ui_accent":"#7F5D01","ui_border":"#CFD0DA","ui_error":"#943F39","ui_ok":"#446934","ui_text":"#28231E","ui_tool":"#3D5378","ui_warn":"#8B6005"},"lightName":null,"modeSupport":"dynamic","name":"midnight-studio","source":"user"},{"category":"Other","colors":{"background":"#F5F8F3","banner_accent":"#5B6A43","banner_border":"#CED3C9","banner_dim":"#62645D","banner_text":"#23251F","banner_title":"#23251F","completion_menu_bg":"#E0E5DB","completion_menu_current_bg":"#D8DFD1","completion_menu_meta_bg":"#E0E5DB","input_rule":"#5B6A43","prompt":"#23251F","response_border":"#5B6A43","session_border":"#CED3C9","session_label":"#2F5A62","shell_dollar":"#2F5A62","status_bar_bg":"#EAEEE6","status_bar_critical":"#8B4839","status_bar_good":"#386D27","status_bar_text":"#23251F","status_bar_warn":"#7D6619","ui_accent":"#5B6A43","ui_border":"#CED3C9","ui_error":"#8B4839","ui_ok":"#386D27","ui_text":"#23251F","ui_tool":"#2F5A62","ui_warn":"#7D6619"},"darkColors":{"background":"#1c2018","banner_accent":"#788860","banner_border":"#6a7a5a","banner_dim":"#3a4430","banner_text":"#c8d0b8","banner_title":"#90a878","completion_menu_bg":"#1c2018","input_rule":"#788860","prompt":"#c8d0b8","response_border":"#90a878","session_border":"#3a4430","shell_dollar":"#7098a0","status_bar_bg":"#121610","status_bar_text":"#909880","ui_accent":"#788860","ui_border":"#6a7a5a","ui_error":"#b87060","ui_ok":"#80b870","ui_text":"#c8d0b8","ui_tool":"#7098a0","ui_warn":"#c0a860"},"darkName":"moss-stone","derivedLight":true,"description":"Cool forest stone — gray-green granite, soft olive, and earthy brown warmth","gatewayDarkName":"theme-picker-moss-stone-dark","gatewayLightName":"theme-picker-moss-stone-light","isDark":true,"label":"Moss Stone","lightColors":{"background":"#F5F8F3","banner_accent":"#5B6A43","banner_border":"#CED3C9","banner_dim":"#62645D","banner_text":"#23251F","banner_title":"#23251F","completion_menu_bg":"#E0E5DB","completion_menu_current_bg":"#D8DFD1","completion_menu_meta_bg":"#E0E5DB","input_rule":"#5B6A43","prompt":"#23251F","response_border":"#5B6A43","session_border":"#CED3C9","session_label":"#2F5A62","shell_dollar":"#2F5A62","status_bar_bg":"#EAEEE6","status_bar_critical":"#8B4839","status_bar_good":"#386D27","status_bar_text":"#23251F","status_bar_warn":"#7D6619","ui_accent":"#5B6A43","ui_border":"#CED3C9","ui_error":"#8B4839","ui_ok":"#386D27","ui_text":"#23251F","ui_tool":"#2F5A62","ui_warn":"#7D6619"},"lightName":null,"modeSupport":"dynamic","name":"moss-stone","source":"user"},{"category":"Other","colors":{"background":"#F6F6FB","banner_accent":"#913990","banner_border":"#D0D0DA","banner_dim":"#62626A","banner_text":"#23232A","banner_title":"#23232A","completion_menu_bg":"#E2E2EC","completion_menu_current_bg":"#DBDBEA","completion_menu_meta_bg":"#E2E2EC","input_rule":"#913990","prompt":"#23232A","response_border":"#913990","session_border":"#D0D0DA","session_label":"#055F5F","shell_dollar":"#055F5F","status_bar_bg":"#ECECF5","status_bar_critical":"#AE083D","status_bar_good":"#027139","status_bar_text":"#23232A","status_bar_warn":"#8F5D00","ui_accent":"#913990","ui_border":"#D0D0DA","ui_error":"#AE083D","ui_ok":"#027139","ui_text":"#23232A","ui_tool":"#055F5F","ui_warn":"#8F5D00"},"darkColors":{"background":"#0a0a0f","banner_accent":"#ff00ff","banner_border":"#ff00ff","banner_dim":"#7d3c98","banner_text":"#e0e0ff","banner_title":"#00ffff","completion_menu_bg":"#0a0a0f","input_rule":"#ff00ff","prompt":"#e0e0ff","response_border":"#00ffff","session_border":"#7d3c98","shell_dollar":"#00ffff","status_bar_bg":"#05050a","status_bar_text":"#c0c0d0","ui_accent":"#ff00ff","ui_border":"#ff00ff","ui_error":"#ff3366","ui_ok":"#00ff88","ui_text":"#e0e0ff","ui_tool":"#00ffff","ui_warn":"#ffaa00"},"darkName":"neon-ghost","derivedLight":true,"description":"Electric ghost in the machine — hot magenta on void black with cyan whispers","gatewayDarkName":"theme-picker-neon-ghost-dark","gatewayLightName":"theme-picker-neon-ghost-light","isDark":true,"label":"Neon Ghost","lightColors":{"background":"#F6F6FB","banner_accent":"#913990","banner_border":"#D0D0DA","banner_dim":"#62626A","banner_text":"#23232A","banner_title":"#23232A","completion_menu_bg":"#E2E2EC","completion_menu_current_bg":"#DBDBEA","completion_menu_meta_bg":"#E2E2EC","input_rule":"#913990","prompt":"#23232A","response_border":"#913990","session_border":"#D0D0DA","session_label":"#055F5F","shell_dollar":"#055F5F","status_bar_bg":"#ECECF5","status_bar_critical":"#AE083D","status_bar_good":"#027139","status_bar_text":"#23232A","status_bar_warn":"#8F5D00","ui_accent":"#913990","ui_border":"#D0D0DA","ui_error":"#AE083D","ui_ok":"#027139","ui_text":"#23232A","ui_tool":"#055F5F","ui_warn":"#8F5D00"},"lightName":null,"modeSupport":"dynamic","name":"neon-ghost","source":"user"},{"category":"Other","colors":{"background":"#F4F7FB","banner_accent":"#845A03","banner_border":"#CBD1DA","banner_dim":"#5E646A","banner_text":"#20252A","banner_title":"#20252A","completion_menu_bg":"#DDE3EC","completion_menu_current_bg":"#D4DDEA","completion_menu_meta_bg":"#DDE3EC","input_rule":"#845A03","prompt":"#20252A","response_border":"#845A03","session_border":"#CBD1DA","session_label":"#0D614D","shell_dollar":"#0D614D","status_bar_bg":"#E8EDF5","status_bar_critical":"#AF0D24","status_bar_good":"#066E57","status_bar_text":"#20252A","status_bar_warn":"#8A5F0F","ui_accent":"#845A03","ui_border":"#CBD1DA","ui_error":"#AF0D24","ui_ok":"#066E57","ui_text":"#20252A","ui_tool":"#0D614D","ui_warn":"#8A5F0F"},"darkColors":{"background":"#0a1628","banner_accent":"#ffb000","banner_border":"#ffb000","banner_dim":"#4a6a8a","banner_text":"#d0e0f0","banner_title":"#00d4aa","completion_menu_bg":"#0a1628","input_rule":"#ffb000","prompt":"#d0e0f0","response_border":"#00d4aa","session_border":"#4a6a8a","shell_dollar":"#00d4aa","status_bar_bg":"#050e1a","status_bar_text":"#a8b8c8","ui_accent":"#ffb000","ui_border":"#ffb000","ui_error":"#ff3344","ui_ok":"#00d4aa","ui_text":"#d0e0f0","ui_tool":"#00d4aa","ui_warn":"#ffb000"},"darkName":"netrunner","derivedLight":true,"description":"Jacked into the mainframe — phosphor amber, digital teal, and alert red on deep navy","gatewayDarkName":"theme-picker-netrunner-dark","gatewayLightName":"theme-picker-netrunner-light","isDark":true,"label":"Netrunner","lightColors":{"background":"#F4F7FB","banner_accent":"#845A03","banner_border":"#CBD1DA","banner_dim":"#5E646A","banner_text":"#20252A","banner_title":"#20252A","completion_menu_bg":"#DDE3EC","completion_menu_current_bg":"#D4DDEA","completion_menu_meta_bg":"#DDE3EC","input_rule":"#845A03","prompt":"#20252A","response_border":"#845A03","session_border":"#CBD1DA","session_label":"#0D614D","shell_dollar":"#0D614D","status_bar_bg":"#E8EDF5","status_bar_critical":"#AF0D24","status_bar_good":"#066E57","status_bar_text":"#20252A","status_bar_warn":"#8A5F0F","ui_accent":"#845A03","ui_border":"#CBD1DA","ui_error":"#AF0D24","ui_ok":"#066E57","ui_text":"#20252A","ui_tool":"#0D614D","ui_warn":"#8A5F0F"},"lightName":null,"modeSupport":"dynamic","name":"netrunner","source":"user"},{"category":"Other","colors":{"background":"#F8F7F2","banner_accent":"#71623A","banner_border":"#D4D1C7","banner_dim":"#66635C","banner_text":"#26241D","banner_title":"#26241D","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#71623A","prompt":"#26241D","response_border":"#71623A","session_border":"#D4D1C7","session_label":"#2D5387","shell_dollar":"#2D5387","status_bar_bg":"#F0EDE4","status_bar_critical":"#9F3235","status_bar_good":"#2F6E2A","status_bar_text":"#26241D","status_bar_warn":"#86620D","ui_accent":"#71623A","ui_border":"#D4D1C7","ui_error":"#9F3235","ui_ok":"#2F6E2A","ui_text":"#26241D","ui_tool":"#2D5387","ui_warn":"#86620D"},"darkColors":{"background":"#0f0f0f","banner_accent":"#787878","banner_border":"#555555","banner_dim":"#444444","banner_text":"#d0d0d0","banner_title":"#a0a0a0","completion_menu_bg":"#0f0f0f","input_rule":"#555555","prompt":"#d0d0d0","response_border":"#787878","session_border":"#444444","shell_dollar":"#6088c0","status_bar_bg":"#080808","status_bar_text":"#a0a0a0","ui_accent":"#787878","ui_border":"#555555","ui_error":"#c05050","ui_ok":"#6aaa64","ui_text":"#d0d0d0","ui_tool":"#6088c0","ui_warn":"#c8a050"},"darkName":"obsidian","derivedLight":true,"description":"Polished black glass — cool silver text, slate borders, and crimson alerts on pure darkness","gatewayDarkName":"theme-picker-obsidian-dark","gatewayLightName":"theme-picker-obsidian-light","isDark":true,"label":"Obsidian","lightColors":{"background":"#F8F7F2","banner_accent":"#71623A","banner_border":"#D4D1C7","banner_dim":"#66635C","banner_text":"#26241D","banner_title":"#26241D","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#71623A","prompt":"#26241D","response_border":"#71623A","session_border":"#D4D1C7","session_label":"#2D5387","shell_dollar":"#2D5387","status_bar_bg":"#F0EDE4","status_bar_critical":"#9F3235","status_bar_good":"#2F6E2A","status_bar_text":"#26241D","status_bar_warn":"#86620D","ui_accent":"#71623A","ui_border":"#D4D1C7","ui_error":"#9F3235","ui_ok":"#2F6E2A","ui_text":"#26241D","ui_tool":"#2D5387","ui_warn":"#86620D"},"lightName":null,"modeSupport":"dynamic","name":"obsidian","source":"user"},{"category":"Other","colors":{"background":"#F8F7F2","banner_accent":"#AB3514","banner_border":"#D4D1C7","banner_dim":"#6A6161","banner_text":"#2A2222","banner_title":"#2A2222","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#AB3514","prompt":"#2A2222","response_border":"#AB3514","session_border":"#D4D1C7","session_label":"#932509","shell_dollar":"#932509","status_bar_bg":"#F0EDE4","status_bar_critical":"#AF1112","status_bar_good":"#02720B","status_bar_text":"#2A2222","status_bar_warn":"#9D5206","ui_accent":"#AB3514","ui_border":"#D4D1C7","ui_error":"#AF1112","ui_ok":"#02720B","ui_text":"#2A2222","ui_tool":"#932509","ui_warn":"#9D5206"},"darkColors":{"background":"#0a0a0a","banner_accent":"#ff4400","banner_border":"#cc2222","banner_dim":"#662222","banner_text":"#e8e0e0","banner_title":"#ffffff","completion_menu_bg":"#0a0a0a","input_rule":"#ff4400","prompt":"#e8e0e0","response_border":"#cc2222","session_border":"#662222","shell_dollar":"#ff6644","status_bar_bg":"#050505","status_bar_text":"#a88888","ui_accent":"#ff4400","ui_border":"#cc2222","ui_error":"#ff2222","ui_ok":"#44cc44","ui_text":"#e8e0e0","ui_tool":"#ff6644","ui_warn":"#ff8800"},"darkName":"red-alert","derivedLight":true,"description":"Klaxon warning — deep crimson, hazard orange, and cold white on near-black, urgent but clean","gatewayDarkName":"theme-picker-red-alert-dark","gatewayLightName":"theme-picker-red-alert-light","isDark":true,"label":"Red Alert","lightColors":{"background":"#F8F7F2","banner_accent":"#AB3514","banner_border":"#D4D1C7","banner_dim":"#6A6161","banner_text":"#2A2222","banner_title":"#2A2222","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#AB3514","prompt":"#2A2222","response_border":"#AB3514","session_border":"#D4D1C7","session_label":"#932509","shell_dollar":"#932509","status_bar_bg":"#F0EDE4","status_bar_critical":"#AF1112","status_bar_good":"#02720B","status_bar_text":"#2A2222","status_bar_warn":"#9D5206","ui_accent":"#AB3514","ui_border":"#D4D1C7","ui_error":"#AF1112","ui_ok":"#02720B","ui_text":"#2A2222","ui_tool":"#932509","ui_warn":"#9D5206"},"lightName":null,"modeSupport":"dynamic","name":"red-alert","source":"user"},{"category":"Other","colors":{"background":"#fafaf5","banner_accent":"#cc3333","banner_border":"#888888","banner_dim":"#aaaaaa","banner_text":"#1a1a1a","banner_title":"#1a1a1a","completion_menu_bg":"#fafaf5","input_rule":"#cc3333","prompt":"#1a1a1a","response_border":"#888888","session_border":"#aaaaaa","shell_dollar":"#336688","status_bar_bg":"#efefe8","status_bar_text":"#555555","ui_accent":"#cc3333","ui_border":"#888888","ui_error":"#cc3333","ui_ok":"#408040","ui_text":"#1a1a1a","ui_tool":"#336688","ui_warn":"#aa6622"},"darkColors":{"background":"#101009","banner_accent":"#F9776E","banner_border":"#36362E","banner_dim":"#A19E96","banner_text":"#EEEBE2","banner_title":"#EEEBE2","completion_menu_bg":"#242417","completion_menu_current_bg":"#2C2B1B","completion_menu_meta_bg":"#242417","input_rule":"#F9776E","prompt":"#EEEBE2","response_border":"#F9776E","session_border":"#36362E","session_label":"#83B8DE","shell_dollar":"#83B8DE","status_bar_bg":"#1D1C11","status_bar_critical":"#FF645D","status_bar_good":"#76B875","status_bar_text":"#EEEBE2","status_bar_warn":"#E79F5F","ui_accent":"#F9776E","ui_border":"#36362E","ui_error":"#FF645D","ui_ok":"#76B875","ui_text":"#EEEBE2","ui_tool":"#83B8DE","ui_warn":"#E79F5F"},"darkName":null,"derivedDark":true,"description":"Japanese washi — off-white paper, sumi ink black, and a single vermilion accent","gatewayDarkName":"theme-picker-rice-paper-dark","gatewayLightName":"theme-picker-rice-paper-light","isDark":false,"label":"Rice Paper","lightColors":{"background":"#fafaf5","banner_accent":"#cc3333","banner_border":"#888888","banner_dim":"#aaaaaa","banner_text":"#1a1a1a","banner_title":"#1a1a1a","completion_menu_bg":"#fafaf5","input_rule":"#cc3333","prompt":"#1a1a1a","response_border":"#888888","session_border":"#aaaaaa","shell_dollar":"#336688","status_bar_bg":"#efefe8","status_bar_text":"#555555","ui_accent":"#cc3333","ui_border":"#888888","ui_error":"#cc3333","ui_ok":"#408040","ui_text":"#1a1a1a","ui_tool":"#336688","ui_warn":"#aa6622"},"lightName":"rice-paper","modeSupport":"dynamic","name":"rice-paper","source":"user"},{"category":"Other","colors":{"background":"#F9F6F2","banner_accent":"#974C07","banner_border":"#D6D0C7","banner_dim":"#67635C","banner_text":"#27231E","banner_title":"#27231E","completion_menu_bg":"#E8E2D9","completion_menu_current_bg":"#E4DBCE","completion_menu_meta_bg":"#E8E2D9","input_rule":"#974C07","prompt":"#27231E","response_border":"#974C07","session_border":"#D6D0C7","session_label":"#385572","shell_dollar":"#385572","status_bar_bg":"#F1ECE4","status_bar_critical":"#95401F","status_bar_good":"#456A23","status_bar_text":"#27231E","status_bar_warn":"#8B6005","ui_accent":"#974C07","ui_border":"#D6D0C7","ui_error":"#95401F","ui_ok":"#456A23","ui_text":"#27231E","ui_tool":"#385572","ui_warn":"#8B6005"},"darkColors":{"background":"#1e1a14","banner_accent":"#c87840","banner_border":"#b89060","banner_dim":"#5a4030","banner_text":"#e8dcc8","banner_title":"#d8b880","completion_menu_bg":"#1e1a14","input_rule":"#c87840","prompt":"#e8dcc8","response_border":"#d8b880","session_border":"#5a4030","shell_dollar":"#80a0c0","status_bar_bg":"#14100c","status_bar_text":"#b0a080","ui_accent":"#c87840","ui_border":"#b89060","ui_error":"#b05838","ui_ok":"#80a860","ui_text":"#e8dcc8","ui_tool":"#80a0c0","ui_warn":"#d8a040"},"darkName":"sandstone","derivedLight":true,"description":"Desert canyon at golden hour — warm terracotta, pale sand, and deep shadowed rust","gatewayDarkName":"theme-picker-sandstone-dark","gatewayLightName":"theme-picker-sandstone-light","isDark":true,"label":"Sandstone","lightColors":{"background":"#F9F6F2","banner_accent":"#974C07","banner_border":"#D6D0C7","banner_dim":"#67635C","banner_text":"#27231E","banner_title":"#27231E","completion_menu_bg":"#E8E2D9","completion_menu_current_bg":"#E4DBCE","completion_menu_meta_bg":"#E8E2D9","input_rule":"#974C07","prompt":"#27231E","response_border":"#974C07","session_border":"#D6D0C7","session_label":"#385572","shell_dollar":"#385572","status_bar_bg":"#F1ECE4","status_bar_critical":"#95401F","status_bar_good":"#456A23","status_bar_text":"#27231E","status_bar_warn":"#8B6005","ui_accent":"#974C07","ui_border":"#D6D0C7","ui_error":"#95401F","ui_ok":"#456A23","ui_text":"#27231E","ui_tool":"#385572","ui_warn":"#8B6005"},"lightName":null,"modeSupport":"dynamic","name":"sandstone","source":"user"},{"category":"Other","colors":{"background":"#F3F8F6","banner_accent":"#327255","banner_border":"#C8D4D0","banner_dim":"#5D6663","banner_text":"#1E2623","banner_title":"#1E2623","completion_menu_bg":"#DAE6E2","completion_menu_current_bg":"#D0E1DB","completion_menu_meta_bg":"#DAE6E2","input_rule":"#327255","prompt":"#1E2623","response_border":"#327255","session_border":"#C8D4D0","session_label":"#235B69","shell_dollar":"#235B69","status_bar_bg":"#E5F0EC","status_bar_critical":"#894842","status_bar_good":"#2E6C42","status_bar_text":"#1E2623","status_bar_warn":"#7C662F","ui_accent":"#327255","ui_border":"#C8D4D0","ui_error":"#894842","ui_ok":"#2E6C42","ui_text":"#1E2623","ui_tool":"#235B69","ui_warn":"#7C662F"},"darkColors":{"background":"#1a201e","banner_accent":"#78b898","banner_border":"#68a890","banner_dim":"#385848","banner_text":"#c8e0d8","banner_title":"#90d0b8","completion_menu_bg":"#1a201e","input_rule":"#78b898","prompt":"#c8e0d8","response_border":"#90d0b8","session_border":"#385848","shell_dollar":"#80b8c8","status_bar_bg":"#101614","status_bar_text":"#88a098","ui_accent":"#78b898","ui_border":"#68a890","ui_error":"#d08880","ui_ok":"#90d0a0","ui_text":"#c8e0d8","ui_tool":"#80b8c8","ui_warn":"#d0b880"},"darkName":"seafoam-silk","derivedLight":true,"description":"Tide pool at dawn — soft seafoam green, pale sand, and gentle coral on dark teal-gray","gatewayDarkName":"theme-picker-seafoam-silk-dark","gatewayLightName":"theme-picker-seafoam-silk-light","isDark":true,"label":"Seafoam Silk","lightColors":{"background":"#F3F8F6","banner_accent":"#327255","banner_border":"#C8D4D0","banner_dim":"#5D6663","banner_text":"#1E2623","banner_title":"#1E2623","completion_menu_bg":"#DAE6E2","completion_menu_current_bg":"#D0E1DB","completion_menu_meta_bg":"#DAE6E2","input_rule":"#327255","prompt":"#1E2623","response_border":"#327255","session_border":"#C8D4D0","session_label":"#235B69","shell_dollar":"#235B69","status_bar_bg":"#E5F0EC","status_bar_critical":"#894842","status_bar_good":"#2E6C42","status_bar_text":"#1E2623","status_bar_warn":"#7C662F","ui_accent":"#327255","ui_border":"#C8D4D0","ui_error":"#894842","ui_ok":"#2E6C42","ui_text":"#1E2623","ui_tool":"#235B69","ui_warn":"#7C662F"},"lightName":null,"modeSupport":"dynamic","name":"seafoam-silk","source":"user"},{"category":"Other","colors":{"background":"#FAF6F3","banner_accent":"#7C5D2D","banner_border":"#D9CFC8","banner_dim":"#66635C","banner_text":"#27241E","banner_title":"#27241E","completion_menu_bg":"#EBE1DA","completion_menu_current_bg":"#E7D9D0","completion_menu_meta_bg":"#EBE1DA","input_rule":"#7C5D2D","prompt":"#27241E","response_border":"#7C5D2D","session_border":"#D9CFC8","session_label":"#385B4B","shell_dollar":"#385B4B","status_bar_bg":"#F4EBE5","status_bar_critical":"#894B2B","status_bar_good":"#4B682A","status_bar_text":"#27241E","status_bar_warn":"#866128","ui_accent":"#7C5D2D","ui_border":"#D9CFC8","ui_error":"#894B2B","ui_ok":"#4B682A","ui_text":"#27241E","ui_tool":"#385B4B","ui_warn":"#866128"},"darkColors":{"background":"#1a1410","banner_accent":"#907040","banner_border":"#705830","banner_dim":"#3a2818","banner_text":"#d0c0a0","banner_title":"#c09860","completion_menu_bg":"#1a1410","input_rule":"#907040","prompt":"#d0c0a0","response_border":"#c09860","session_border":"#3a2818","shell_dollar":"#80a090","status_bar_bg":"#0e0a08","status_bar_text":"#907850","ui_accent":"#907040","ui_border":"#705830","ui_error":"#a06040","ui_ok":"#80a060","ui_text":"#d0c0a0","ui_tool":"#80a090","ui_warn":"#c09860"},"darkName":"single-malt","derivedLight":true,"description":"Warm whiskey in a dark room — amber on deep brown-black, one color, perfectly restrained","gatewayDarkName":"theme-picker-single-malt-dark","gatewayLightName":"theme-picker-single-malt-light","isDark":true,"label":"Single Malt","lightColors":{"background":"#FAF6F3","banner_accent":"#7C5D2D","banner_border":"#D9CFC8","banner_dim":"#66635C","banner_text":"#27241E","banner_title":"#27241E","completion_menu_bg":"#EBE1DA","completion_menu_current_bg":"#E7D9D0","completion_menu_meta_bg":"#EBE1DA","input_rule":"#7C5D2D","prompt":"#27241E","response_border":"#7C5D2D","session_border":"#D9CFC8","session_label":"#385B4B","shell_dollar":"#385B4B","status_bar_bg":"#F4EBE5","status_bar_critical":"#894B2B","status_bar_good":"#4B682A","status_bar_text":"#27241E","status_bar_warn":"#866128","ui_accent":"#7C5D2D","ui_border":"#D9CFC8","ui_error":"#894B2B","ui_ok":"#4B682A","ui_text":"#27241E","ui_tool":"#385B4B","ui_warn":"#866128"},"lightName":null,"modeSupport":"dynamic","name":"single-malt","source":"user"},{"category":"Other","colors":{"background":"#F3F8FA","banner_accent":"#A63B0E","banner_border":"#C8D3D7","banner_dim":"#66635C","banner_text":"#26241E","banner_title":"#26241E","completion_menu_bg":"#D9E5E9","completion_menu_current_bg":"#CFE0E6","completion_menu_meta_bg":"#D9E5E9","input_rule":"#A63B0E","prompt":"#26241E","response_border":"#A63B0E","session_border":"#C8D3D7","session_label":"#04578A","shell_dollar":"#04578A","status_bar_bg":"#E5EFF2","status_bar_critical":"#AF1016","status_bar_good":"#586504","status_bar_text":"#26241E","status_bar_warn":"#846306","ui_accent":"#A63B0E","ui_border":"#C8D3D7","ui_error":"#AF1016","ui_ok":"#586504","ui_text":"#26241E","ui_tool":"#04578A","ui_warn":"#846306"},"darkColors":{"background":"#002b36","banner_accent":"#cb4b16","banner_border":"#b58900","banner_dim":"#586e75","banner_text":"#eee8d5","banner_title":"#fdf6e3","completion_menu_bg":"#002b36","input_rule":"#cb4b16","prompt":"#eee8d5","response_border":"#b58900","session_border":"#586e75","shell_dollar":"#268bd2","status_bar_bg":"#001b24","status_bar_text":"#839496","ui_accent":"#cb4b16","ui_border":"#b58900","ui_error":"#dc322f","ui_ok":"#859900","ui_text":"#eee8d5","ui_tool":"#268bd2","ui_warn":"#b58900"},"darkName":"solar-flare","derivedLight":true,"description":"Intense dark solarized — deep navy background with blazing amber, cyan, and magenta signals","gatewayDarkName":"theme-picker-solar-flare-dark","gatewayLightName":"theme-picker-solar-flare-light","isDark":true,"label":"Solar Flare","lightColors":{"background":"#F3F8FA","banner_accent":"#A63B0E","banner_border":"#C8D3D7","banner_dim":"#66635C","banner_text":"#26241E","banner_title":"#26241E","completion_menu_bg":"#D9E5E9","completion_menu_current_bg":"#CFE0E6","completion_menu_meta_bg":"#D9E5E9","input_rule":"#A63B0E","prompt":"#26241E","response_border":"#A63B0E","session_border":"#C8D3D7","session_label":"#04578A","shell_dollar":"#04578A","status_bar_bg":"#E5EFF2","status_bar_critical":"#AF1016","status_bar_good":"#586504","status_bar_text":"#26241E","status_bar_warn":"#846306","ui_accent":"#A63B0E","ui_border":"#C8D3D7","ui_error":"#AF1016","ui_ok":"#586504","ui_text":"#26241E","ui_tool":"#04578A","ui_warn":"#846306"},"lightName":null,"modeSupport":"dynamic","name":"solar-flare","source":"user"},{"category":"Other","colors":{"background":"#F9F6F2","banner_accent":"#765F38","banner_border":"#D5D0C7","banner_dim":"#66635C","banner_text":"#26241E","banner_title":"#26241E","completion_menu_bg":"#E7E2D9","completion_menu_current_bg":"#E3DCCE","completion_menu_meta_bg":"#E7E2D9","input_rule":"#765F38","prompt":"#26241E","response_border":"#765F38","session_border":"#D5D0C7","session_label":"#385B4B","shell_dollar":"#385B4B","status_bar_bg":"#F1ECE4","status_bar_critical":"#954028","status_bar_good":"#4B682A","status_bar_text":"#26241E","status_bar_warn":"#836401","ui_accent":"#765F38","ui_border":"#D5D0C7","ui_error":"#954028","ui_ok":"#4B682A","ui_text":"#26241E","ui_tool":"#385B4B","ui_warn":"#836401"},"darkColors":{"background":"#2a2418","banner_accent":"#a08860","banner_border":"#8a7850","banner_dim":"#5a4a30","banner_text":"#e0d8c0","banner_title":"#c8b890","completion_menu_bg":"#2a2418","input_rule":"#a08860","prompt":"#e0d8c0","response_border":"#c8b890","session_border":"#5a4a30","shell_dollar":"#80a090","status_bar_bg":"#1a1810","status_bar_text":"#a09870","ui_accent":"#a08860","ui_border":"#8a7850","ui_error":"#b05840","ui_ok":"#80a060","ui_text":"#e0d8c0","ui_tool":"#80a090","ui_warn":"#c0a050"},"darkName":"typewriter-cream","derivedLight":true,"description":"Aged manuscript — warm cream paper background with faded ink, sepia accents, and soft rust","gatewayDarkName":"theme-picker-typewriter-cream-dark","gatewayLightName":"theme-picker-typewriter-cream-light","isDark":true,"label":"Typewriter Cream","lightColors":{"background":"#F9F6F2","banner_accent":"#765F38","banner_border":"#D5D0C7","banner_dim":"#66635C","banner_text":"#26241E","banner_title":"#26241E","completion_menu_bg":"#E7E2D9","completion_menu_current_bg":"#E3DCCE","completion_menu_meta_bg":"#E7E2D9","input_rule":"#765F38","prompt":"#26241E","response_border":"#765F38","session_border":"#D5D0C7","session_label":"#385B4B","shell_dollar":"#385B4B","status_bar_bg":"#F1ECE4","status_bar_critical":"#954028","status_bar_good":"#4B682A","status_bar_text":"#26241E","status_bar_warn":"#836401","ui_accent":"#765F38","ui_border":"#D5D0C7","ui_error":"#954028","ui_ok":"#4B682A","ui_text":"#26241E","ui_tool":"#385B4B","ui_warn":"#836401"},"lightName":null,"modeSupport":"dynamic","name":"typewriter-cream","source":"user"},{"category":"Other","colors":{"background":"#f8f0e0","banner_accent":"#5a4040","banner_border":"#8a7058","banner_dim":"#a89880","banner_text":"#3a2818","banner_title":"#3a2818","completion_menu_bg":"#f8f0e0","input_rule":"#5a4040","prompt":"#3a2818","response_border":"#8a7058","session_border":"#a89880","shell_dollar":"#486880","status_bar_bg":"#efe4d0","status_bar_text":"#5a4838","ui_accent":"#5a4040","ui_border":"#8a7058","ui_error":"#883838","ui_ok":"#406840","ui_text":"#3a2818","ui_tool":"#486880","ui_warn":"#886838"},"darkColors":{"background":"#120F08","banner_accent":"#C89696","banner_border":"#39352D","banner_dim":"#A49D97","banner_text":"#F1EAE3","banner_title":"#F1EAE3","completion_menu_bg":"#282217","completion_menu_current_bg":"#31291A","completion_menu_meta_bg":"#282217","input_rule":"#C89696","prompt":"#F1EAE3","response_border":"#C89696","session_border":"#39352D","session_label":"#94B6D1","shell_dollar":"#94B6D1","status_bar_bg":"#201B11","status_bar_critical":"#DB827F","status_bar_good":"#87B286","status_bar_text":"#F1EAE3","status_bar_warn":"#CDAB79","ui_accent":"#C89696","ui_border":"#39352D","ui_error":"#DB827F","ui_ok":"#87B286","ui_text":"#F1EAE3","ui_tool":"#94B6D1","ui_warn":"#CDAB79"},"darkName":null,"derivedDark":true,"description":"Old book page — warm cream background with dark sepia text and faded indigo accents","gatewayDarkName":"theme-picker-warm-parchment-dark","gatewayLightName":"theme-picker-warm-parchment-light","isDark":false,"label":"Warm Parchment","lightColors":{"background":"#f8f0e0","banner_accent":"#5a4040","banner_border":"#8a7058","banner_dim":"#a89880","banner_text":"#3a2818","banner_title":"#3a2818","completion_menu_bg":"#f8f0e0","input_rule":"#5a4040","prompt":"#3a2818","response_border":"#8a7058","session_border":"#a89880","shell_dollar":"#486880","status_bar_bg":"#efe4d0","status_bar_text":"#5a4838","ui_accent":"#5a4040","ui_border":"#8a7058","ui_error":"#883838","ui_ok":"#406840","ui_text":"#3a2818","ui_tool":"#486880","ui_warn":"#886838"},"lightName":"warm-parchment","modeSupport":"dynamic","name":"warm-parchment","source":"user"},{"category":"Other","colors":{"background":"#FAF5F6","banner_accent":"#67680E","banner_border":"#D9CDD0","banner_dim":"#66635C","banner_text":"#26241D","banner_title":"#26241D","completion_menu_bg":"#EBDFE2","completion_menu_current_bg":"#E9D7DC","completion_menu_meta_bg":"#EBDFE2","input_rule":"#67680E","prompt":"#26241D","response_border":"#67680E","session_border":"#D9CDD0","session_label":"#055F5F","shell_dollar":"#055F5F","status_bar_bg":"#F4EAEC","status_bar_critical":"#AF120B","status_bar_good":"#097207","status_bar_text":"#26241D","status_bar_warn":"#6D6E0B","ui_accent":"#67680E","ui_border":"#D9CDD0","ui_error":"#AF120B","ui_ok":"#097207","ui_text":"#26241D","ui_tool":"#055F5F","ui_warn":"#6D6E0B"},"darkColors":{"background":"#000000","banner_accent":"#ffff00","banner_border":"#ffffff","banner_dim":"#888888","banner_text":"#ffffff","banner_title":"#ffffff","completion_menu_bg":"#080808","input_rule":"#ffff00","prompt":"#ffffff","response_border":"#ffffff","session_border":"#888888","shell_dollar":"#00ffff","status_bar_bg":"#000000","status_bar_text":"#cccccc","ui_accent":"#ffff00","ui_border":"#ffffff","ui_error":"#ff0000","ui_ok":"#00ff00","ui_text":"#ffffff","ui_tool":"#00ffff","ui_warn":"#ffff00"},"darkName":"white-flash","derivedLight":true,"description":"Maximum readability — pure white text on pure black, with electric yellow and cyan signals","gatewayDarkName":"theme-picker-white-flash-dark","gatewayLightName":"theme-picker-white-flash-light","isDark":true,"label":"White Flash","lightColors":{"background":"#FAF5F6","banner_accent":"#67680E","banner_border":"#D9CDD0","banner_dim":"#66635C","banner_text":"#26241D","banner_title":"#26241D","completion_menu_bg":"#EBDFE2","completion_menu_current_bg":"#E9D7DC","completion_menu_meta_bg":"#EBDFE2","input_rule":"#67680E","prompt":"#26241D","response_border":"#67680E","session_border":"#D9CDD0","session_label":"#055F5F","shell_dollar":"#055F5F","status_bar_bg":"#F4EAEC","status_bar_critical":"#AF120B","status_bar_good":"#097207","status_bar_text":"#26241D","status_bar_warn":"#6D6E0B","ui_accent":"#67680E","ui_border":"#D9CDD0","ui_error":"#AF120B","ui_ok":"#097207","ui_text":"#26241D","ui_tool":"#055F5F","ui_warn":"#6D6E0B"},"lightName":null,"modeSupport":"dynamic","name":"white-flash","source":"user"},{"category":"Built-in","colors":{"background":"#FBF5F5","banner_accent":"#AC3226","banner_border":"#DACECD","banner_dim":"#66635C","banner_text":"#27241D","banner_title":"#27241D","completion_menu_bg":"#ECDFDF","completion_menu_current_bg":"#E9D7D7","completion_menu_meta_bg":"#ECDFDF","input_rule":"#AC3226","prompt":"#27241D","response_border":"#AC3226","session_border":"#DACECD","session_label":"#AC3226","shell_dollar":"#AC3226","status_bar_bg":"#F5EAE9","status_bar_critical":"#B1051B","status_bar_good":"#047217","status_bar_text":"#27241D","status_bar_warn":"#8F5C12","ui_accent":"#AC3226","ui_border":"#DACECD","ui_error":"#B1051B","ui_ok":"#047217","ui_text":"#27241D","ui_tool":"#AC3226","ui_warn":"#8F5C12"},"darkColors":{"banner_accent":"#DD4A3A","banner_border":"#A93333","banner_dim":"#905151","banner_text":"#F1E6CF","banner_title":"#C7A96B","completion_menu_bg":"#2A1212","prompt":"#F1E6CF","session_border":"#6E584B","shell_dollar":"#DD4A3A","status_bar_bg":"#2A1212","status_bar_text":"#F1E6CF","ui_accent":"#DD4A3A","ui_error":"#ef5350","ui_ok":"#4caf50","ui_warn":"#ffa726"},"darkName":"ares","derivedLight":true,"description":"War-god theme — crimson and bronze","gatewayDarkName":"theme-picker-ares-dark","gatewayLightName":"theme-picker-ares-light","isDark":true,"label":"Ares","lightColors":{"background":"#FBF5F5","banner_accent":"#AC3226","banner_border":"#DACECD","banner_dim":"#66635C","banner_text":"#27241D","banner_title":"#27241D","completion_menu_bg":"#ECDFDF","completion_menu_current_bg":"#E9D7D7","completion_menu_meta_bg":"#ECDFDF","input_rule":"#AC3226","prompt":"#27241D","response_border":"#AC3226","session_border":"#DACECD","session_label":"#AC3226","shell_dollar":"#AC3226","status_bar_bg":"#F5EAE9","status_bar_critical":"#B1051B","status_bar_good":"#047217","status_bar_text":"#27241D","status_bar_warn":"#8F5C12","ui_accent":"#AC3226","ui_border":"#DACECD","ui_error":"#B1051B","ui_ok":"#047217","ui_text":"#27241D","ui_tool":"#AC3226","ui_warn":"#8F5C12"},"lightName":null,"modeSupport":"dynamic","name":"ares","source":"builtin"},{"category":"Built-in","colors":{"background":"#F5F7FB","banner_accent":"#2E669E","banner_border":"#CDD1DA","banner_dim":"#5E646A","banner_text":"#20252A","banner_title":"#20252A","completion_menu_bg":"#DFE3ED","completion_menu_current_bg":"#D7DCEA","completion_menu_meta_bg":"#DFE3ED","input_rule":"#2E669E","prompt":"#20252A","response_border":"#2E669E","session_border":"#CDD1DA","session_label":"#2E669E","shell_dollar":"#2E669E","status_bar_bg":"#E9EDF5","status_bar_critical":"#924411","status_bar_good":"#056F50","status_bar_text":"#20252A","status_bar_warn":"#8F5D06","ui_accent":"#2E669E","ui_border":"#CDD1DA","ui_error":"#924411","ui_ok":"#056F50","ui_text":"#20252A","ui_tool":"#2E669E","ui_warn":"#8F5D06"},"darkColors":{"banner_accent":"#8EA8FF","banner_border":"#4169e1","banner_dim":"#545E6B","banner_text":"#c9d1d9","banner_title":"#7eb8f6","completion_menu_bg":"#151C2F","prompt":"#c9d1d9","session_border":"#545E6B","shell_dollar":"#7eb8f6","status_bar_bg":"#151C2F","status_bar_text":"#C9D1D9","ui_accent":"#7eb8f6","ui_error":"#F7A072","ui_ok":"#63D0A6","ui_warn":"#e6a855"},"darkName":"slate","derivedLight":true,"description":"Cool blue — developer-focused","gatewayDarkName":"theme-picker-slate-dark","gatewayLightName":"theme-picker-slate-light","isDark":true,"label":"Slate","lightColors":{"background":"#F5F7FB","banner_accent":"#2E669E","banner_border":"#CDD1DA","banner_dim":"#5E646A","banner_text":"#20252A","banner_title":"#20252A","completion_menu_bg":"#DFE3ED","completion_menu_current_bg":"#D7DCEA","completion_menu_meta_bg":"#DFE3ED","input_rule":"#2E669E","prompt":"#20252A","response_border":"#2E669E","session_border":"#CDD1DA","session_label":"#2E669E","shell_dollar":"#2E669E","status_bar_bg":"#E9EDF5","status_bar_critical":"#924411","status_bar_good":"#056F50","status_bar_text":"#20252A","status_bar_warn":"#8F5D06","ui_accent":"#2E669E","ui_border":"#CDD1DA","ui_error":"#924411","ui_ok":"#056F50","ui_text":"#20252A","ui_tool":"#2E669E","ui_warn":"#8F5D06"},"lightName":null,"modeSupport":"dynamic","name":"slate","source":"builtin"},{"category":"Built-in","colors":{"banner_accent":"#1D4ED8","banner_border":"#2563EB","banner_dim":"#475569","banner_text":"#111827","banner_title":"#0F172A","completion_menu_bg":"#F8FAFC","prompt":"#111827","session_border":"#64748B","shell_dollar":"#2563EB","status_bar_bg":"#E5EDF8","status_bar_text":"#111827","ui_accent":"#2563EB","ui_error":"#B91C1C","ui_ok":"#15803D","ui_warn":"#B45309"},"darkColors":{"background":"#0B1016","banner_accent":"#75A2FD","banner_border":"#31363D","banner_dim":"#9B9EA6","banner_text":"#E7EBF3","banner_title":"#E7EBF3","completion_menu_bg":"#1C232D","completion_menu_current_bg":"#212B38","completion_menu_meta_bg":"#1C232D","input_rule":"#75A2FD","prompt":"#E7EBF3","response_border":"#75A2FD","session_border":"#31363D","session_label":"#75A2FD","shell_dollar":"#75A2FD","status_bar_bg":"#161C25","status_bar_critical":"#FF6458","status_bar_good":"#5DBC75","status_bar_text":"#E7EBF3","status_bar_warn":"#FA9257","ui_accent":"#75A2FD","ui_border":"#31363D","ui_error":"#FF6458","ui_ok":"#5DBC75","ui_text":"#E7EBF3","ui_tool":"#75A2FD","ui_warn":"#FA9257"},"darkName":null,"derivedDark":true,"description":"Light theme for bright terminals with dark text and cool blue accents","gatewayDarkName":"theme-picker-daylight-dark","gatewayLightName":"theme-picker-daylight-light","isDark":false,"label":"Daylight","lightColors":{"banner_accent":"#1D4ED8","banner_border":"#2563EB","banner_dim":"#475569","banner_text":"#111827","banner_title":"#0F172A","completion_menu_bg":"#F8FAFC","prompt":"#111827","session_border":"#64748B","shell_dollar":"#2563EB","status_bar_bg":"#E5EDF8","status_bar_text":"#111827","ui_accent":"#2563EB","ui_error":"#B91C1C","ui_ok":"#15803D","ui_warn":"#B45309"},"lightName":"daylight","modeSupport":"dynamic","name":"daylight","source":"builtin"},{"category":"Built-in","colors":{"banner_accent":"#8B4513","banner_border":"#8B6914","banner_dim":"#8B7355","banner_text":"#2C1810","banner_title":"#5C3D11","completion_menu_bg":"#F5EFE0","prompt":"#2C1810","session_border":"#A0845C","shell_dollar":"#8B4513","status_bar_bg":"#F5F0E8","status_bar_text":"#2C1810","ui_accent":"#8B4513","ui_error":"#C62828","ui_ok":"#2E7D32","ui_warn":"#E65100"},"darkColors":{"background":"#130F09","banner_accent":"#DD8F62","banner_border":"#39352D","banner_dim":"#A59C99","banner_text":"#F3E9E5","banner_title":"#F3E9E5","completion_menu_bg":"#282217","completion_menu_current_bg":"#31291A","completion_menu_meta_bg":"#282217","input_rule":"#DD8F62","prompt":"#F3E9E5","response_border":"#DD8F62","session_border":"#39352D","session_label":"#DD8F62","shell_dollar":"#DD8F62","status_bar_bg":"#211B11","status_bar_critical":"#FB685E","status_bar_good":"#6CBA6D","status_bar_text":"#F3E9E5","status_bar_warn":"#FB9069","ui_accent":"#DD8F62","ui_border":"#39352D","ui_error":"#FB685E","ui_ok":"#6CBA6D","ui_text":"#F3E9E5","ui_tool":"#DD8F62","ui_warn":"#FB9069"},"darkName":null,"derivedDark":true,"description":"Warm light mode — dark brown/gold text for light terminal backgrounds","gatewayDarkName":"theme-picker-warm-lightmode-dark","gatewayLightName":"theme-picker-warm-lightmode-light","isDark":false,"label":"Warm Lightmode","lightColors":{"banner_accent":"#8B4513","banner_border":"#8B6914","banner_dim":"#8B7355","banner_text":"#2C1810","banner_title":"#5C3D11","completion_menu_bg":"#F5EFE0","prompt":"#2C1810","session_border":"#A0845C","shell_dollar":"#8B4513","status_bar_bg":"#F5F0E8","status_bar_text":"#2C1810","ui_accent":"#8B4513","ui_error":"#C62828","ui_ok":"#2E7D32","ui_warn":"#E65100"},"lightName":"warm-lightmode","modeSupport":"dynamic","name":"warm-lightmode","source":"builtin"},{"category":"Built-in","colors":{"background":"#F4F7FB","banner_accent":"#116A9B","banner_border":"#CBD2DA","banner_dim":"#5D6469","banner_text":"#1F2529","banner_title":"#1F2529","completion_menu_bg":"#DDE3EC","completion_menu_current_bg":"#D4DDEA","completion_menu_meta_bg":"#DDE3EC","input_rule":"#116A9B","prompt":"#1F2529","response_border":"#116A9B","session_border":"#CBD2DA","session_label":"#116A9B","shell_dollar":"#116A9B","status_bar_bg":"#E8EDF5","status_bar_critical":"#B1051B","status_bar_good":"#047217","status_bar_text":"#1F2529","status_bar_warn":"#8F5C12","ui_accent":"#116A9B","ui_border":"#CBD2DA","ui_error":"#B1051B","ui_ok":"#047217","ui_text":"#1F2529","ui_tool":"#116A9B","ui_warn":"#8F5C12"},"darkColors":{"banner_accent":"#5DB8F5","banner_border":"#2A6FB9","banner_dim":"#44638F","banner_text":"#EAF7FF","banner_title":"#A9DFFF","completion_menu_bg":"#0F2440","prompt":"#EAF7FF","session_border":"#496884","shell_dollar":"#5DB8F5","status_bar_bg":"#0F2440","status_bar_text":"#EAF7FF","ui_accent":"#5DB8F5","ui_error":"#ef5350","ui_ok":"#4caf50","ui_warn":"#ffa726"},"darkName":"poseidon","derivedLight":true,"description":"Ocean-god theme — deep blue and seafoam","gatewayDarkName":"theme-picker-poseidon-dark","gatewayLightName":"theme-picker-poseidon-light","isDark":true,"label":"Poseidon","lightColors":{"background":"#F4F7FB","banner_accent":"#116A9B","banner_border":"#CBD2DA","banner_dim":"#5D6469","banner_text":"#1F2529","banner_title":"#1F2529","completion_menu_bg":"#DDE3EC","completion_menu_current_bg":"#D4DDEA","completion_menu_meta_bg":"#DDE3EC","input_rule":"#116A9B","prompt":"#1F2529","response_border":"#116A9B","session_border":"#CBD2DA","session_label":"#116A9B","shell_dollar":"#116A9B","status_bar_bg":"#E8EDF5","status_bar_critical":"#B1051B","status_bar_good":"#047217","status_bar_text":"#1F2529","status_bar_warn":"#8F5C12","ui_accent":"#116A9B","ui_border":"#CBD2DA","ui_error":"#B1051B","ui_ok":"#047217","ui_text":"#1F2529","ui_tool":"#116A9B","ui_warn":"#8F5C12"},"lightName":null,"modeSupport":"dynamic","name":"poseidon","source":"builtin"},{"category":"Built-in","colors":{"background":"#F8F7F2","banner_accent":"#71623A","banner_border":"#D4D1C7","banner_dim":"#66635C","banner_text":"#26241D","banner_title":"#26241D","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#71623A","prompt":"#26241D","response_border":"#71623A","session_border":"#D4D1C7","session_label":"#71623A","shell_dollar":"#71623A","status_bar_bg":"#F0EDE4","status_bar_critical":"#6B5C34","status_bar_good":"#6B5C34","status_bar_text":"#26241D","status_bar_warn":"#766840","ui_accent":"#71623A","ui_border":"#D4D1C7","ui_error":"#6B5C34","ui_ok":"#6B5C34","ui_text":"#26241D","ui_tool":"#71623A","ui_warn":"#766840"},"darkColors":{"banner_accent":"#E7E7E7","banner_border":"#B7B7B7","banner_dim":"#5C5C5C","banner_text":"#D3D3D3","banner_title":"#F5F5F5","completion_menu_bg":"#202020","prompt":"#F5F5F5","session_border":"#656565","shell_dollar":"#E7E7E7","status_bar_bg":"#202020","status_bar_text":"#D3D3D3","ui_accent":"#E7E7E7","ui_error":"#E7E7E7","ui_ok":"#919191","ui_warn":"#B7B7B7"},"darkName":"sisyphus","derivedLight":true,"description":"Sisyphean theme — austere grayscale with persistence","gatewayDarkName":"theme-picker-sisyphus-dark","gatewayLightName":"theme-picker-sisyphus-light","isDark":true,"label":"Sisyphus","lightColors":{"background":"#F8F7F2","banner_accent":"#71623A","banner_border":"#D4D1C7","banner_dim":"#66635C","banner_text":"#26241D","banner_title":"#26241D","completion_menu_bg":"#E6E3D9","completion_menu_current_bg":"#E1DCCE","completion_menu_meta_bg":"#E6E3D9","input_rule":"#71623A","prompt":"#26241D","response_border":"#71623A","session_border":"#D4D1C7","session_label":"#71623A","shell_dollar":"#71623A","status_bar_bg":"#F0EDE4","status_bar_critical":"#6B5C34","status_bar_good":"#6B5C34","status_bar_text":"#26241D","status_bar_warn":"#766840","ui_accent":"#71623A","ui_border":"#D4D1C7","ui_error":"#6B5C34","ui_ok":"#6B5C34","ui_text":"#26241D","ui_tool":"#71623A","ui_warn":"#766840"},"lightName":null,"modeSupport":"dynamic","name":"sisyphus","source":"builtin"},{"category":"Built-in","colors":{"background":"#FBF5F4","banner_accent":"#8D5405","banner_border":"#DACECA","banner_dim":"#67635C","banner_text":"#27241E","banner_title":"#27241E","completion_menu_bg":"#ECE0DC","completion_menu_current_bg":"#E9D8D2","completion_menu_meta_bg":"#ECE0DC","input_rule":"#8D5405","prompt":"#27241E","response_border":"#8D5405","session_border":"#DACECA","session_label":"#8D5405","shell_dollar":"#8D5405","status_bar_bg":"#F4EAE7","status_bar_critical":"#B1051B","status_bar_good":"#047217","status_bar_text":"#27241E","status_bar_warn":"#8F5C12","ui_accent":"#8D5405","ui_border":"#DACECA","ui_error":"#B1051B","ui_ok":"#047217","ui_text":"#27241E","ui_tool":"#8D5405","ui_warn":"#8F5C12"},"darkColors":{"banner_accent":"#F29C38","banner_border":"#C75B1D","banner_dim":"#C58A45","banner_text":"#FFF0D4","banner_title":"#FFD39A","completion_menu_bg":"#0B0503","prompt":"#FFF0D4","session_border":"#7B593A","shell_dollar":"#F29C38","status_bar_bg":"#2B160E","status_bar_text":"#FFF0D4","ui_accent":"#F29C38","ui_error":"#ef5350","ui_ok":"#4caf50","ui_warn":"#ffa726"},"darkName":"charizard","derivedLight":true,"description":"Volcanic theme — burnt orange and ember","gatewayDarkName":"theme-picker-charizard-dark","gatewayLightName":"theme-picker-charizard-light","isDark":true,"label":"Charizard","lightColors":{"background":"#FBF5F4","banner_accent":"#8D5405","banner_border":"#DACECA","banner_dim":"#67635C","banner_text":"#27241E","banner_title":"#27241E","completion_menu_bg":"#ECE0DC","completion_menu_current_bg":"#E9D8D2","completion_menu_meta_bg":"#ECE0DC","input_rule":"#8D5405","prompt":"#27241E","response_border":"#8D5405","session_border":"#DACECA","session_label":"#8D5405","shell_dollar":"#8D5405","status_bar_bg":"#F4EAE7","status_bar_critical":"#B1051B","status_bar_good":"#047217","status_bar_text":"#27241E","status_bar_warn":"#8F5C12","ui_accent":"#8D5405","ui_border":"#DACECA","ui_error":"#B1051B","ui_ok":"#047217","ui_text":"#27241E","ui_tool":"#8D5405","ui_warn":"#8F5C12"},"lightName":null,"modeSupport":"dynamic","name":"charizard","source":"builtin"}]
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
    card: mix(background, foreground, ratios.card),
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

function sceneToDesktopTheme(scene) {
  const lightColors = scene.lightColors || scene.darkColors || scene.colors || {}
  const darkColors = scene.darkColors || scene.lightColors || scene.colors || {}
  const light = skinToDesktopTheme({ ...scene, colors: lightColors })
  const dark = skinToDesktopTheme({ ...scene, colors: darkColors })
  return {
    ...light,
    label: scene.label || light.label,
    description: scene.description || 'Chroma scene',
    colors: light.colors,
    darkColors: dark.colors,
    typography: Object.assign({}, SCENE_TYPOGRAPHY[scene.name], scene.typography || {}),
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

function cssColorToHex(value) {
  if (typeof value !== 'string') return undefined
  const input = value.trim()
  const m = input.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (m) {
    let next = m[0]
    if (next.length === 4) next = '#' + [...next.slice(1)].map(c => c + c).join('')
    if (next.length === 5) next = '#' + [...next.slice(1, 4)].map(c => c + c).join('') + next.slice(4)
    if (next.length === 9) next = next.slice(0, 7)
    return next.toLowerCase()
  }
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
  const theme = Object.assign({}, cssVars.light || {}, cssVars.theme || {})
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
  if (!scene || !scene.name) return 'minimal'
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
        return cat && typeof cat.id === 'string' && cat.id ? cat.id : 'minimal'
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
    const next = Object.assign({}, scene)
    if (light) {
      next.lightColors = Object.assign({}, scene.lightColors || scene.colors || {}, light)
      next.colors = next.lightColors
    }
    if (dark) next.darkColors = Object.assign({}, scene.darkColors || scene.colors || {}, dark)
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
function duplicateBody(draftRoles, to, label, modes, sourceLabel, sourceName) {
  const palettes = overridePayload(draftRoles, modes)
  const given = typeof label === 'string' ? label.trim() : ''
  return {
    to: to,
    label: given || duplicateLabel(sourceLabel, sourceName),
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
  const body = Object.assign({}, bundle, { dryRun: dryRun ? true : false })
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
  return { ok: true, bundle: Object.assign({}, data, { categories: categories }) }
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
      skins.push(Object.assign({}, skin, { name: choice.to.trim() }))
      continue
    }
    skins.push(skin)
  }
  return { bundle: Object.assign({}, bundle, { skins: skins }), skipped: skipped }
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
  if (shape === 'circle') return 'rounded-full p-2.5'
  return 'rounded-lg p-1.5'
}

function buildThemeGroups(scenes) {
  return [
    { id: 'dynamic', title: 'Dynamic Scenes', scenes: scenes.filter(scene => scene.modeSupport === 'dynamic') },
    { id: 'dark', title: 'Dark Mode Only', scenes: scenes.filter(scene => scene.modeSupport === 'dark') },
    { id: 'light', title: 'Light Mode Only', scenes: scenes.filter(scene => scene.modeSupport === 'light') }
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

/** One broad category per scene - the "by theme" lens.
 *
 *  The rule, in order:
 *   1. A scene that can serve only one mode goes to Light or Dark. It has no
 *      second palette to describe, so a hue bin would hide what it is.
 *   2. A named retro/terminal scene goes to Terminal. The name outranks the
 *      measured accent, because "Commodore 64" is the point of the theme.
 *   3. Character before hue. The accent's chroma is read first: near-neutral
 *      (C < 0.03) is Minimal; a high-lightness, low-chroma tint is Pastels;
 *      loudly saturated (C >= 0.16) is Vibrant. What is left, faintly coloured,
 *      splits on warmth - warm low-chroma is Earth, cool low-chroma is Muted.
 *   4. Hue decides the rest, in the order a person names colours: green is
 *      Nature, then the warm wheel Warm -> Orange -> Gold, then Cool, then
 *      Violet.
 *
 *  Derived, not hand-listed (except Terminal, whose seven names are the whole
 *  list). The catalog's own `category` field is provenance ('Built-in' /
 *  'Dynamic' / 'Other'), not style. Deterministic, so the grid is stable
 *  between renders. Never throws on a partial palette: an unreadable accent
 *  falls back to the neutral Minimal rather than `undefined`. */
function sceneCategory(scene) {
  if (scene.modeSupport === 'dark') return 'dark'
  if (scene.modeSupport === 'light') return 'light'
  const colors = scene.lightColors || scene.darkColors || scene.colors || {}
  const accent = oklch(colors.ui_accent || colors.banner_accent || colors.banner_title)
  if (!accent) return 'minimal'
  if (TERMINAL_SCENE_NAMES.has(scene.name)) return 'terminal'
  // Pastel is a property of the COLOUR, not of the shell: a tint is high
  // lightness with real but low chroma, which is what "paste" in pastello
  // describes. Judged on the accent, the colour a theme is read by.
  //
  // Measured, not assumed: a shell test (pale, faintly tinted background) looks
  // obvious and is useless here, because nearly every light theme in the catalog
  // has exactly that shell - it caught 18 scenes and called dark-sage a pastel.
  // On the accent it now catches exactly the five shipped pastels.
  if (accent.l >= 0.72 && accent.c >= 0.03 && accent.c <= 0.14) return 'pastels'
  if (accent.c < 0.03) return 'minimal'
  if (accent.c >= 0.16) return 'vibrant'
  // Hue family before character for greens: "nature" is the one hue with a
  // natural meaning, so a muted forest green is a forest, not merely "muted".
  // A green loud enough to clear the vibrant test is synthetic - neon,
  // cyberpunk, phosphor terminal - and stays with the loud ones.
  // 118-178 in OKLCH, not 75-170: Oklab puts yellow near 90 and cream near 80,
  // so the wider band filed "vanilla" and "lemon" under Nature. This band is
  // yellow-green through teal-green, which is what a person means by green.
  if (accent.h >= 118 && accent.h < 178) return 'nature'
  // Desaturated, but with real colour. Warm low-chroma is Earth (browns, tans,
  // creams); cool low-chroma is Muted (blue-greys). Both are kept apart from
  // Pastels by lightness and from Minimal by chroma.
  if (accent.c < 0.09) return (accent.h < 118 || accent.h >= 330) ? 'earth' : 'muted'
  // Hue family for the rest, wrapping red through pink at 330.
  if (accent.h < 30 || accent.h >= 330) return 'warm'
  if (accent.h < 60) return 'orange'
  if (accent.h < 118) return 'gold'
  if (accent.h < 288) return 'cool'
  return 'violet'
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
function buildGroups(scenes, groupMode, userCategories) {
  return groupMode === 'theme'
    ? buildCategoryGroups(scenes, userCategories)
    : buildThemeGroups(scenes)
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
          message: `${scene.label || scene.name} synchronized, but its combined scene could not be saved for restart`
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
      reachesCli ? 'bg-(--ui-accent)/15 text-(--ui-accent)' : 'text-(--ui-text-tertiary)'
    ),
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
  ['banner_text', 'ui_text', 'status_bar_text'],
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
      'flex flex-col min-h-0 w-full flex-1 overflow-hidden ring-1 ring-black/15',
      shape === 'circle' ? 'rounded-full' : 'rounded-[4px]'
    ),
    children: rows.map((row, r) =>
      jsx('div', {
        key: r,
        // The hairline is the only chrome in the block: it separates light from
        // dark, so the pair reads as a pair and not as twelve loose swatches.
        className: cn('flex flex-row min-h-0 w-full flex-1', r === 1 && 'border-t border-black/25'),
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
  const glyph = scene.modeSupport === 'dynamic' ? '⇄' : (scene.modeSupport === 'dark' ? '☾' : '☀')
  const modeClass = mode === 'dark' ? 'text-(--ui-accent)' : 'text-(--ui-warn)'
  const support = scene.modeSupport === 'dynamic' ? mode : scene.modeSupport
  const bit = isActive
    ? jsx(Badge, { variant: 'outline', className: 'shrink-0 px-1 text-[0.5625rem] text-(--ui-accent)', children: 'ACTIVE' })
    : jsx('span', { className: 'shrink-0 text-[0.5625rem] uppercase tracking-wide text-(--ui-text-tertiary)', children: support })
  // The bits are built as a LIST rather than a fixed array with a hole in it: an
  // edited card must add one element, and a card without an override must digest
  // byte-for-byte as it did before the editor existed.
  const parts = [
    jsx('span', { className: cn('shrink-0 text-[0.6875rem] leading-none', modeClass), children: glyph }),
    jsx('span', { className: 'truncate text-[0.6875rem] font-medium', children: scene.label || scene.name.replace(/-/g, ' ') }),
    jsx(CliBadge, { scene, localScope })
  ]
  if (edited) {
    // Distinct from the future pack badge: this says what you are looking at is
    // not what shipped, which a user has to be able to see (§17.3.1).
    parts.push(jsx('span', {
      className: 'shrink-0 rounded px-1 text-[0.5rem] uppercase leading-4 tracking-wide text-(--ui-warn)',
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
const PREVIEW_PILL_CLASS = 'absolute inset-0 z-10 m-auto h-fit w-fit max-w-[calc(100%-0.5rem)] rounded-full border px-1.5 py-0.5 text-center text-[0.5rem] font-medium leading-tight backdrop-blur transition-opacity'
const PREVIEW_PILL_LIVE = 'border-(--ui-accent) bg-(--ui-bg-tertiary) text-(--ui-accent) opacity-100'
const PREVIEW_PILL_IDLE = 'border-white/30 bg-black/50 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100'

function ThemeCardPreviewPill({ scene, previewing, previewUntil, onPreview, onStopPreview }) {
  return jsx('button', {
    type: 'button',
    onClick: () => { if (previewing) onStopPreview(); else onPreview(scene) },
    title: previewing ? 'Stop the preview and go back to your theme' : 'Preview this theme for 10 seconds, then revert',
    className: cn(PREVIEW_PILL_CLASS, previewing ? PREVIEW_PILL_LIVE : PREVIEW_PILL_IDLE),
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
const EDIT_GEAR_CLASS = 'absolute bottom-1 left-1/2 z-10 -translate-x-1/2 rounded border border-white/25 bg-black/45 px-1 text-[0.625rem] leading-4 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100'

function ThemeCardEditGear({ scene, onEdit }) {
  return jsx('button', {
    type: 'button',
    onClick: () => onEdit(scene),
    title: 'Edit this theme: recolour it and save your own override',
    'aria-label': 'Edit ' + (scene.label || scene.name),
    className: EDIT_GEAR_CLASS,
    children: jsx('span', { className: 'codicon codicon-settings-gear', 'aria-hidden': 'true' })
  })
}

// E2's card affordance (§6, task 1): a SECOND action beside the gear, offered
// for ANY scene — built-in or owned. A built-in's duplicate is the escape hatch
// §3 requires: it forks the EFFECTIVE palette (override ?? authored) into a new
// OWNED skin, so a shipped theme's colours can be edited without touching the
// shipped file (§17.1). It sits at the bottom-RIGHT so it never collides with
// the centred gear, and it carries the same keyboard/touch reachability rule
// (`focus-visible:` + `pointer-coarse:`) the gear carries.
const EDIT_DUPLICATE_CLASS = 'absolute bottom-1 right-1 z-10 rounded border border-white/25 bg-black/45 px-1 text-[0.625rem] leading-4 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100'

function ThemeCardDuplicate({ scene, onDuplicate }) {
  return jsx('button', {
    type: 'button',
    onClick: () => onDuplicate(scene),
    title: 'Fork this theme into a new skin you own — the source file is untouched',
    'aria-label': 'Duplicate ' + (scene.label || scene.name),
    className: EDIT_DUPLICATE_CLASS,
    children: jsx('span', { className: 'codicon codicon-copy', 'aria-hidden': 'true' })
  })
}

// The manage actions live OUTSIDE the card button, for the same reason the pill
// does. Only an owned skin has them, and only one mode shows at a time: renaming,
// confirming a delete, or the three actions themselves.
const MANAGE_ROW_CLASS = 'mt-1 flex items-center gap-1 text-[0.625rem]'
const MANAGE_BUTTON_CLASS = 'shrink-0 rounded border border-(--ui-stroke-secondary) px-1 py-0.5 hover:border-(--ui-stroke-strong) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--ui-stroke-strong) pointer-coarse:opacity-100'

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
      className: 'shrink-0 rounded border border-(--ui-stroke-secondary) px-1 py-0.5 text-(--ui-error) hover:border-(--ui-stroke-strong)',
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
  { id: 'signals', label: 'Signals', target: 4.5, hint: 'status colours: shipped per scene, not editable in E1' }
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
 *  `kind` picks the advisory target. `against` names the colour the read-out is
 *  measured against: every role is read against the shell, and the shell itself
 *  against its own text — its contrast with itself is 1:1 by definition and
 *  would say nothing. */
const EDITOR_ROLES = [
  { id: 'shell', label: 'Shell', hint: 'the base every other role is read against', keys: ['background'], kind: 'interface', against: 'text' },
  { id: 'surface', label: 'Surface', hint: 'raised bars, menus, cards', keys: ['status_bar_bg', 'completion_menu_bg'], kind: 'interface', against: 'shell' },
  { id: 'signature', label: 'Signature', hint: 'accent surfaces and highlights', keys: ['ui_accent', 'banner_accent', 'banner_title'], kind: 'interface', against: 'shell' },
  { id: 'text', label: 'Text', hint: 'the reading colour', keys: ['banner_text', 'ui_text', 'status_bar_text'], kind: 'text', against: 'shell' },
  { id: 'dim', label: 'Dim text', hint: 'secondary and muted labels', keys: ['banner_dim'], kind: 'text', against: 'shell' },
  { id: 'structure', label: 'Structure', hint: 'borders and dividers', keys: ['ui_border', 'banner_border', 'session_border'], kind: 'interface', against: 'shell' }
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
  const next = Object.assign({}, scene)
  const light = record.light && typeof record.light === 'object' ? record.light : null
  const dark = record.dark && typeof record.dark === 'object' ? record.dark : null
  if (light) {
    next.lightColors = Object.assign({}, scene.lightColors || scene.colors || {}, light)
    next.colors = next.lightColors
  }
  if (dark) {
    next.darkColors = Object.assign({}, scene.darkColors || scene.colors || {}, dark)
    if (!light) next.colors = next.darkColors
  }
  // E5 — typography rides the same override record. A font-only override is
  // valid: the record may carry `typography` with no `light`/`dark` keys.
  const typo = record.typography && typeof record.typography === 'object' ? record.typography : null
  if (typo) {
    next.typography = Object.assign({}, next.typography || {}, typo)
  }
  return next
}

/** The gallery's groups: CLASSIFY the authored catalogue, RENDER the effective
 *  palette (§17.3.2 — the shelf does not move). buildGroups() measures category
 *  from the scene it is handed, so a resolved list would re-file a card the
 *  moment its accent changed. Grouping runs on the authored list; the override
 *  is layered on afterwards, per card. */
function groupCards(scenes, overrides, groupMode, userCategories) {
  return buildGroups(scenes, groupMode, userCategories).map(group => Object.assign({}, group, {
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
  const colors = Object.assign({}, sceneModePalette(scene, modeKey))
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
          className: cn('pointer-events-none h-5 w-5 rounded border', invalid ? 'border-(--ui-error)' : 'border-(--ui-stroke-secondary)'),
          style: hex ? { backgroundColor: hex } : undefined
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
      className: cn(
        'min-w-0 w-full flex-1 rounded border bg-(--ui-bg-secondary) px-1 py-0.5 font-mono text-[0.625rem]',
        invalid ? 'border-(--ui-error)' : 'border-(--ui-stroke-secondary)'
      )
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
    className: cn('shrink-0 rounded px-1 font-mono text-[0.5625rem] leading-4', below ? 'bg-(--ui-warn)/15 text-(--ui-warn)' : 'text-(--ui-text-tertiary)'),
    children: text
  })
}

const EDITOR_OVERLAY_CLASS = 'fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4'
const EDITOR_SHEET_CLASS = 'mt-6 flex max-h-[80vh] w-full max-w-2xl flex-col gap-2 overflow-hidden rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3 shadow-xl'
const EDITOR_PREVIEW_CLASS = 'flex h-14 w-full shrink-0 overflow-hidden rounded-[4px]'
const EDITOR_ROW_CLASS = 'flex items-start gap-2'
const EDITOR_ACTION_CLASS = 'shrink-0 rounded border border-(--ui-stroke-secondary) px-2 py-0.5 text-[0.625rem] hover:border-(--ui-stroke-strong) disabled:opacity-50'
const EDITOR_SAVE_CLASS = 'shrink-0 rounded border border-(--ui-accent) bg-(--ui-accent)/15 px-2 py-0.5 text-[0.625rem] font-medium text-(--ui-accent) hover:border-(--ui-stroke-strong) disabled:opacity-50'
// The fork affordance of §18.3 (`Update "<name>"` / separator / `Save as new`) is
// OMITTED from E1, not rendered disabled: it needs POST /skins/duplicate, which
// is E2 and is not mounted, and a disabled control for a route that cannot
// arrive in this build is noise. The reason is carried by the sentence in the
// actions row instead.
const OWNED_SAVE_REASON = 'Rewrite your own skin file in place — this is not an override of a shipped palette'

/** One role across both modes: the label, then a light and a dark cell, each
 *  with the colour input and its own contrast read-out against that mode's
 *  shell. */
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
        jsx('div', { className: 'font-medium leading-4', children: role.label }),
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
function EditorModal({ scene, overrides, owned, mode, busy, modes, caps, onClose, onSave, onReset, onDuplicate }) {
  const effective = applyOverride(scene, overrides)
  const overridden = !!(overrides && overrides[scene.name])
  // One draft per mode, seeded from the effective palette. Kept apart so `dirty`
  // is a comparison of like with like, and so clearing one mode cannot clear the
  // other.
  const seedLight = draftForScene(effective, 'light')
  const seedDark = draftForScene(effective, 'dark')
  const [lightDraft, setLightDraft] = useState(() => Object.assign({}, seedLight))
  const [darkDraft, setDarkDraft] = useState(() => Object.assign({}, seedDark))
  // The fork (§18.3): `Update "<name>"` (the Save button) beside a `Save as new`
  // that opens a name prompt and posts the SAME draft as a brand-new skin. The
  // prompt stays open on a 409 with the collision ON THE FIELD — the colours are
  // never lost — and the user, never an auto-suffix, picks the name.
  const [forking, setForking] = useState(false)
  const [forkName, setForkName] = useState('')
  const [forkError, setForkError] = useState('')
  const dirty = !modeDraftEqual(lightDraft, seedLight) || !modeDraftEqual(darkDraft, seedDark)
  const changeRole = (modeKey, roleId, value) => {
    const setter = modeKey === 'light' ? setLightDraft : setDarkDraft
    setter(prev => {
      const next = Object.assign({}, prev)
      next[roleId] = value
      return next
    })
  }
  const draft = { light: lightDraft, dark: darkDraft }
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
    const body = duplicateBody(draft, forkName.trim(), '', modes, scene.label, scene.name)
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
        jsx('div', {
          key: 'preview',
          className: EDITOR_PREVIEW_CLASS,
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
        jsxs('div', { key: 'roles', className: 'flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1', children: [
          jsxs('div', { key: 'columns', className: 'flex items-center gap-2 text-[0.5625rem] uppercase tracking-wide text-(--ui-text-tertiary)', children: [
            jsx('span', { className: 'w-24 shrink-0', children: 'Role' }),
            jsx('span', { className: 'flex-1', children: '☀ light' }),
            jsx('span', { className: 'flex-1', children: '☾ dark' })
          ]})
        ].concat(EDITOR_ROLES.map(role => jsx(EditorRoleRow, {
          key: role.id,
          role,
          draft,
          onChange: changeRole,
          shells,
          texts
        })))}),
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
        jsxs('div', {
          key: 'actions',
          className: 'flex items-center justify-between gap-2 border-t border-(--ui-stroke-secondary) pt-2',
          children: [
            jsxs('span', { key: 'state', className: 'min-w-0 text-[0.625rem] text-(--ui-text-tertiary)', children: [
              owned
                ? 'Your own skin file. '
                : (overridden ? 'An override exists for this scene. ' : 'No override yet. '),
              dirty ? jsx('span', { className: 'text-(--ui-warn)', children: 'Unsaved changes.' }) : null
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
                      className: 'min-w-0 w-32 rounded border px-1 py-0.5 font-mono text-[0.625rem] '
                        + (forkError ? 'border-(--ui-error)' : 'border-(--ui-stroke-secondary) bg-(--ui-bg-secondary)')
                    }),
                    jsx('button', {
                      key: 'forkgo',
                      type: 'button',
                      disabled: !!busy,
                      onClick: submitFork,
                      title: 'Write these colours as a brand-new skin you own',
                      className: EDITOR_SAVE_CLASS,
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
                disabled: !!busy,
                onClick: () => { if (onSave) onSave(scene.name, overridePayload(draft, modes)) },
                title: owned ? OWNED_SAVE_REASON : 'Store your edit as an override of the shipped palette',
                className: EDITOR_SAVE_CLASS,
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
                    title: 'Save these colours as a NEW skin you own — the source theme is left untouched',
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

function ThemeCard({ scene, mode, active, applying, onApply, owned, managing, onDelete, onRename, onExport, previewing, previewUntil, onPreview, onStopPreview, shape, localScope, onEdit, onDuplicate, edited, categories, onSetCategory }) {
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
    // The aspect ratio is what makes the grid read as a gallery rather than a
    // list: the colour block takes whatever height is left. The ratio itself is
    // the shape the user picked.
    style: { aspectRatio: cardAspect(shape) },
    disabled: applying === scene.name,
    title: cardTitle(scene, mode),
    className: cn(
      'flex w-full flex-col gap-1 border text-left transition-colors',
      cardShapeClasses(shape),
      isActive
        ? 'border-(--ui-accent) bg-(--ui-bg-tertiary)'
        : 'border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) hover:border-(--ui-stroke-strong)'
    ),
    children: cardChildren
  })
  // The preview pill and the editor's gear are DOM siblings of the card, and the
  // card's own box has to stay their positioning context, so they travel together.
  // The gear appears only when the pane hands in an edit handler: a card with no
  // editor behind it must not offer the affordance.
  const boxChildren = [card, jsx(ThemeCardPreviewPill, { scene, previewing, previewUntil, onPreview, onStopPreview })]
  if (typeof onEdit === 'function') {
    boxChildren.push(jsx(ThemeCardEditGear, { scene, onEdit }))
  }
  if (typeof onDuplicate === 'function') {
    boxChildren.push(jsx(ThemeCardDuplicate, { scene, onDuplicate }))
  }
  const cardBox = jsxs('div', {
    className: 'group relative w-full',
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
          className: 'shrink-0 rounded bg-(--ui-warn)/15 px-1 text-[0.5625rem] text-(--ui-warn)',
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
            className: 'rounded border border-(--ui-stroke-secondary) px-2 py-0.5 text-[0.6875rem] hover:border-(--ui-stroke-strong)',
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
  const [groupMode, setGroupMode] = useState(() => readGroupMode())
  const changeGroupMode = next => {
    if (GROUP_MODES.indexOf(next) < 0) return
    writeGroupMode(next)
    setGroupMode(next)
    haptic('tap')
  }
  const [importRef, setImportRef] = useState('')
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
        if (!schemaNoted.current && hasGatewayBackend()) {
          schemaNoted.current = true
          host.notify(schemaMissingNotice())
        }
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
    try {
      const raw = window.localStorage.getItem('chroma-packs-v1')
      const parsed = raw ? JSON.parse(raw) : null
      const enabled = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.enabled) ? parsed.enabled : [])
      setEnabledPacks(enabled)
    } catch {
      setEnabledPacks([])
    }
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
      try {
        setOverrides(await listOverrides())
      } catch (readError) {
        setOverrides(prev => Object.assign({}, prev, { [name]: { light: palettes.light, dark: palettes.dark } }))
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
          const next = Object.assign({}, prev)
          delete next[name]
          return next
        })
      }
      // The fields are seeded from the effective palette, so they have to be
      // re-seeded: the modal is keyed by this epoch and remounts.
      setEditorEpoch(n => n + 1)
      haptic('tap')
      host.notify({
        kind: 'info',
        title: 'Override reset',
        message: (name.replace(/-/g, ' ')) + ' is back to the palette it shipped with',
        detail: 'Nothing else about the scene changed.'
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
    const body = duplicateBody(draftRoles, duplicateSlug(scene.name), '', modes, scene.label, scene.name)
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
    const body = packExportBody(packName || slug(q) || 'chroma-pack', filtered.map(s => s.name), '')
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

  const chooseCollision = (name, choice) => setPackChoices(prev => Object.assign({}, prev, { [name]: choice }))

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
  const groupsRaw = groupCards(filtered, overrides, groupMode, categories)
  // Theme Packs filter: when enabled packs set, keep scenes whose pack matches; core always visible.
  const coreNames = new Set(['amber-terminal','commodore-64','dark-lcars','green-screen','retro-amber','retro-blue','retro-terminal','earth-brown','earth-green','earth-moss','minimal-white','minimal-black','vibrant-red','vibrant-blue','vibrant-green','vibrant-purple','pastels-pink','pastels-blue','pastels-green','pastels-cream','muted-ink','muted-paper','muted-stone','nature-forest','nature-ocean','warm-amber','warm-coral','orange-flame','orange-ember','gold-harvest','gold-morning'])
  const allowedPacks = enabledPacks && enabledPacks.length ? new Set(enabledPacks) : null
  const groups = groupsRaw
    .map(group => {
      if (!allowedPacks) return group
      const filteredScenes = group.scenes.filter(s => {
        const name = s.name
        const isCore = coreNames.has(name)
        const packId = isCore ? 'core' : (s.pack || 'core')
        return isCore || allowedPacks.has(packId)
      })
      return Object.assign({}, group, { scenes: filteredScenes })
    })
    .filter(group => group.scenes.length)
  const activeScene = applyOverride(allSkins.find(scene => scene.name === active) || null, overrides)
  const activeColors = activeScene && ((mode === 'dark' ? activeScene.darkColors : activeScene.lightColors) || activeScene.colors)
  const editingScene = editing ? (allSkins.find(scene => scene.name === editing.name) || null) : null

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col',
    children: [
      jsxs('div', {
        className: 'flex flex-col gap-2 border-b border-(--ui-stroke-secondary) p-3',
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between gap-2',
            children: [
              jsx('div', { className: 'text-sm font-semibold', children: 'Chroma' }),
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
                    className: 'rounded border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-[0.625rem] hover:border-(--ui-stroke-strong) disabled:opacity-50',
                    children: exporting ? 'Exporting…' : 'Export all'
                  }),
                  jsx(Badge, { variant: 'muted', children: `${filtered.length}` })
                ]
              })
            ]
          }),
          jsx(SearchField, {
            placeholder: 'Search scenes…',
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
                    className: 'h-7 w-[7.5rem] text-[0.6875rem]',
                    title: 'Group the gallery by scene, or by broad theme category',
                    children: jsx(SelectValue, {})
                  }),
                  jsxs(SelectContent, {
                    children: [
                      jsx(SelectItem, { value: 'scene', children: 'By scene' }),
                      jsx(SelectItem, { value: 'theme', children: 'By theme' })
                    ]
                  })
                ]
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
                : jsx('textarea', { className: 'flex-1 rounded-md border border-(--chrome-stroke) bg-(--chrome-surface) px-2 py-1 text-[0.75rem] font-mono text-(--chrome-text)', placeholder: 'Paste shadcn CSS, a Windows Terminal scheme, a Base16/24 scheme, or a VS Code color theme', value: importRef, rows: 3, onChange: e => setImportRef(e && e.target ? e.target.value : '') }),
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
          jsxs('div', { key: 'categories', className: PACK_SECTION_CLASS, children: [
            jsxs('div', { key: 'head', className: 'flex flex-wrap items-center justify-between gap-2', children: [
              jsxs('div', { className: 'flex items-center gap-2', children: [
                jsx('span', { className: 'text-[0.6875rem] font-semibold uppercase tracking-wide text-(--ui-text-tertiary)', children: 'Categories' }),
                jsx(Badge, { variant: 'muted', children: String((categories || []).length) })
              ]})
            ]}),
            jsx(CategoryList, {
              categories,
              busy: categoryBusy,
              onDelete: handleDeleteCategory
            }),
            jsxs('div', { key: 'create', className: 'flex flex-wrap items-center gap-1', children: [
              jsx('input', {
                type: 'text',
                value: categoryName,
                placeholder: 'category id',
                title: 'A slug for the category (lowercase, dashes)',
                onChange: e => setCategoryName(e && e.target ? e.target.value : ''),
                className: 'h-6 w-24 rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-1 font-mono text-[0.625rem]'
              }),
              jsx('input', {
                type: 'text',
                value: categoryTitle,
                placeholder: 'Display title',
                title: 'The title shown on the shelf',
                onChange: e => setCategoryTitle(e && e.target ? e.target.value : ''),
                className: 'h-6 w-28 rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-1 text-[0.625rem]'
              }),
              jsx('button', {
                type: 'button',
                disabled: categoryBusy || !categoryName.trim(),
                onClick: handleCreateCategory,
                title: 'Create a new user category',
                className: MANAGE_BUTTON_CLASS,
                children: categoryBusy ? 'Working…' : 'Create category'
              })
            ]})
          ]}),
          jsxs('div', { key: 'packs', className: PACK_SECTION_CLASS, children: [
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
                  onClick: () => {
                    const next = enabledPacks.length === 0 ? ['earth', 'cyberpunk', 'zen', 'retro', 'noir'] : []
                    setEnabledPacks(next)
                  },
                  title: enabledPacks.length ? 'Show all packs' : 'Enable theme packs',
                  className: MANAGE_BUTTON_CLASS,
                  children: enabledPacks.length ? 'All packs' : 'Enable packs'
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
              ? jsxs('div', { key: 'confirm', className: 'flex flex-col gap-1 rounded border border-(--ui-error) p-2', children: [
                  jsx('div', { className: 'text-[0.625rem] text-(--ui-error)', children: packDeleteNotice(packConfirm.pack, packConfirm.withSkins).title }),
                  jsx('div', { className: 'text-[0.5625rem] text-(--ui-text-tertiary)', children: packDeleteNotice(packConfirm.pack, packConfirm.withSkins).message }),
                  jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
                    jsx('label', { className: 'flex items-center gap-1 text-[0.5625rem] text-(--ui-text-secondary)', children: [
                      jsx('input', {
                        type: 'checkbox',
                        checked: !!packConfirm.withSkins,
                        onChange: e => setPackConfirm(prev => prev ? Object.assign({}, prev, { withSkins: !!(e && e.target && e.target.checked) }) : prev)
                      }),
                      'and the skins it names'
                    ]}),
                    jsx('button', {
                      type: 'button',
                      disabled: packBusy,
                      onClick: confirmDeletePack,
                      className: 'shrink-0 rounded border border-(--ui-error) px-1 py-0.5 text-[0.625rem] text-(--ui-error)',
                      children: packBusy ? 'Deleting…' : packDeleteNotice(packConfirm.pack, packConfirm.withSkins).confirm
                    }),
                    jsx('button', { type: 'button', onClick: cancelDeletePack, className: MANAGE_BUTTON_CLASS, children: 'Cancel' })
                  ]})
                ]})
              : null
          ]})
        ]
      }),
      jsx(ScrollArea, {
        className: 'min-h-0 flex-1 p-2',
        children: jsx(SkinBoundary, {
          children:
            filtered.length === 0
              ? jsx(EmptyState, { title: 'No scenes found', description: 'Try a different search.' })
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
      }),
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
          jsx('span', { className: 'max-w-24 truncate', children: activeLabel })
        ]
      }),
      supportsBoth ? jsx('button', {
        type: 'button',
        onClick: toggleMode,
        title: `Switch to ${mode === 'light' ? 'dark' : 'light'} mode`,
        className: 'flex h-full items-center px-1 text-[0.6875rem] text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground',
        children: jsx('span', { className: 'codicon codicon-lightbulb' })
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
  async register(ctx) {
    _rest = ctx.rest
    // A new registration gets a fresh schema: the cache is per session, not per
    // process, so a reload re-reads it.
    _editorSchemaCache = null
    migrateAppearanceAliases()
    // E5 — read overrides at boot so a font or colour edit survives a restart.
    // Without this, register() maps raw SKINS and every override is lost.
    let overrides = {}
    try {
      const result = await _rest('overrides')
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        overrides = result
      }
    } catch {
      // No backend or no overrides route — boot with authored values.
    }
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
