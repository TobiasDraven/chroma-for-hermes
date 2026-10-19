import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const pluginPath = new URL('../../desktop/plugin.js', import.meta.url)

/**
 * The one loader every Chroma test shares.
 *
 * It reads the SHIPPED build's own import statements and injects exactly those
 * names. Nothing else is stubbed, so an identifier the module uses without
 * importing is undefined here just as it is in the app. Hand-written hook stubs
 * are banned: they supplied what the import forgot and let a dead picker ship.
 */

export function importedNames(source) {
  const names = []
  const re = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g
  let m
  while ((m = re.exec(source))) {
    for (const raw of m[1].split(',')) {
      const n = raw.trim().split(/\s+as\s+/).pop().trim()
      if (n) names.push(n)
    }
  }
  return names
}

function rendererGlobals() {
  const storage = new Map()
  const anchors = []
  const blobs = []
  return {
    console,
    document: {
      documentElement: { dataset: {}, style: { setProperty() {} }, classList: { toggle() {} } },
      body: {
        appendChild(node) { anchors.push(node) },
        removeChild() {}
      },
      createElement: (tag) => {
        const node = { tag, href: '', download: '', clicked: false, click() { this.clicked = true } }
        return node
      }
    },
    fetch: () => Promise.reject(new Error('no fetch in test')),
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 1 },
    clearTimeout() {},
    MutationObserver: class { observe() {} disconnect() {} },
    localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k)
    },
    URL: {
      createObjectURL: () => { const u = 'blob:test-' + blobs.length; blobs.push(u); return u },
      revokeObjectURL() {}
    },
    Blob: class {
      constructor(parts, opts) {
        this.text = (parts || []).join('')
        this.type = (opts && opts.type) || ''
      }
    },
    __anchors: anchors,
    __blobs: blobs
  }
}

function stubFor(name, known) {
  if (name in known) return known[name]
  if (/^[A-Z][A-Z0-9_]*$/.test(name)) return name.toLowerCase()
  if (name[0] === name[0].toUpperCase() && /[A-Z]/.test(name.slice(1))) return () => null
  return () => {}
}

/**
 * @param {object} [overrides] extra host/SDK stubs the test genuinely needs
 * @returns {Promise<{context: object, names: string[]}>}
 */
export async function loadPlugin(overrides = {}) {
  const source = await readFile(pluginPath, 'utf8')
  const names = importedNames(source)
  if (names.length < 5) throw new Error('the import block could not be parsed')

  const executable = source
    .replace(/import\s+\{[\s\S]*?\}\s+from\s+'@hermes\/plugin-sdk'\n/, '')
    .replace(/import\s+\{[^}]*\}\s+from\s+'react\/jsx-runtime'\n/, '')
    .replace(/import\s+\{[^}]*\}\s+from\s+'react'\n/, '')
    .replace('export default {', 'globalThis.plugin = {')
    + '\nglobalThis.testHelpers = { ThemeCard, ThemePicker, ThemeChip, exportArtifact, exportOwnedSkins, importOutcomeNotice, hasGatewayBackend, parseImportedTheme, normHex, windowsTerminalTheme, base16Theme, vsCodeTheme, PREVIEW_MS, previewSecondsLeft, SKINS, CATALOG, IMPORTED_SKINS, sceneToDesktopTheme, skinToDesktopTheme, tweakcnColors, tweakcnToDesktopTheme, cssColorToHex, stripJsonNoise, parseTolerantJson, parseCssTheme, splitCssVars, tweakcnTokens, looksLikeVsCode, looksLikeWindowsTerminal, normalizeLiveSkin, migrateAppearanceAliases, CliBadge, isGatewayCapable, paletteStrip, cardTitle, ThemeCardPalette, ThemeCardLabel, ThemeCardPreviewPill, ThemeCardActions, ThemeCardRename, ThemeCardDeleteConfirm, ThemeCardManageButtons, useDesktopThemeApi, syncDesktopState, splitUsableSkins: typeof splitUsableSkins !== "undefined" ? splitUsableSkins : undefined, hasUsableSkinName: typeof hasUsableSkinName !== "undefined" ? hasUsableSkinName : undefined, SkinBoundary: typeof SkinBoundary !== "undefined" ? SkinBoundary : undefined, EditorModal: typeof EditorModal !== "undefined" ? EditorModal : undefined, EditorRoleRow: typeof EditorRoleRow !== "undefined" ? EditorRoleRow : undefined, ColorField: typeof ColorField !== "undefined" ? ColorField : undefined, ContrastChip: typeof ContrastChip !== "undefined" ? ContrastChip : undefined, ThemeCardEditGear: typeof ThemeCardEditGear !== "undefined" ? ThemeCardEditGear : undefined, EDITOR_ROLES: typeof EDITOR_ROLES !== "undefined" ? EDITOR_ROLES : undefined, ADVICE_TARGETS: typeof ADVICE_TARGETS !== "undefined" ? ADVICE_TARGETS : undefined, applyOverride: typeof applyOverride !== "undefined" ? applyOverride : undefined, groupCards: typeof groupCards !== "undefined" ? groupCards : undefined, draftForScene: typeof draftForScene !== "undefined" ? draftForScene : undefined, draftPalette: typeof draftPalette !== "undefined" ? draftPalette : undefined, modeDraftEqual: typeof modeDraftEqual !== "undefined" ? modeDraftEqual : undefined, overridePayload: typeof overridePayload !== "undefined" ? overridePayload : undefined, contrastReadout: typeof contrastReadout !== "undefined" ? contrastReadout : undefined, isMissingRoute: typeof isMissingRoute !== "undefined" ? isMissingRoute : undefined, overrideFailureNotice: typeof overrideFailureNotice !== "undefined" ? overrideFailureNotice : undefined, listOverrides: typeof listOverrides !== "undefined" ? listOverrides : undefined, putOverride: typeof putOverride !== "undefined" ? putOverride : undefined, dropOverride: typeof dropOverride !== "undefined" ? dropOverride : undefined, sceneModePalette: typeof sceneModePalette !== "undefined" ? sceneModePalette : undefined, firstColorIn: typeof firstColorIn !== "undefined" ? firstColorIn : undefined, adviceTarget: typeof adviceTarget !== "undefined" ? adviceTarget : undefined, putSkin: typeof putSkin !== "undefined" ? putSkin : undefined, fetchEditorSchema: typeof fetchEditorSchema !== "undefined" ? fetchEditorSchema : undefined, editorModes: typeof editorModes !== "undefined" ? editorModes : undefined, schemaCaps: typeof schemaCaps !== "undefined" ? schemaCaps : undefined, schemaDrift: typeof schemaDrift !== "undefined" ? schemaDrift : undefined, schemaDriftNotice: typeof schemaDriftNotice !== "undefined" ? schemaDriftNotice : undefined, schemaMissingNotice: typeof schemaMissingNotice !== "undefined" ? schemaMissingNotice : undefined, foldSavedSkin: typeof foldSavedSkin !== "undefined" ? foldSavedSkin : undefined, EMOJI_FALLBACK: typeof EMOJI_FALLBACK !== "undefined" ? EMOJI_FALLBACK : undefined, readOverrideMirror: typeof readOverrideMirror !== "undefined" ? readOverrideMirror : undefined, writeOverrideMirror: typeof writeOverrideMirror !== "undefined" ? writeOverrideMirror : undefined, OVERRIDES_MIRROR_KEY: typeof OVERRIDES_MIRROR_KEY !== "undefined" ? OVERRIDES_MIRROR_KEY : undefined, filterByPacks: typeof filterByPacks !== \"undefined\" ? filterByPacks : undefined, readEnabledPacks: typeof readEnabledPacks !== \"undefined\" ? readEnabledPacks : undefined, writeEnabledPacks: typeof writeEnabledPacks !== \"undefined\" ? writeEnabledPacks : undefined, safeMerge: typeof safeMerge !== "undefined" ? safeMerge : undefined }\n'

  const context = rendererGlobals()

  const known = {
    host: {
      notify() {},
      navigate() {},
      onEvent() {},
      request: async () => ({}),
      state: {
        profile: { get: () => 'default' },
        viewport: { get: () => ({ width: 1200, height: 800, narrow: false }) }
      },
      ...overrides.host
    },
    cn: (...parts) => parts.filter(Boolean).join(' '),
    haptic() {},
    oklchToHex: () => '#000000',
    // The build imports Component for the render error boundary. Provide a real
    // minimal base so `class SkinBoundary extends Component` and the render
    // instrumentation below both work.
    Component: class Component {
      constructor(props) { this.props = props || {}; this.state = {} }
      setState(update) {
        this.state = { ...this.state, ...(typeof update === 'function' ? update(this.state, this.props) : update) }
      }
    },
    useTheme: () => ({
      themeName: 'nous', mode: 'dark',
      setTheme() {}, setMode() {},
      previewTheme() {}, clearThemePreview() {}
    }),
    useValue: (v) => (v && typeof v.get === 'function' ? v.get() : v),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect() {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (v) => ({ current: v }),
    ...overrides.stubbed
  }

  for (const n of names) context[n] = stubFor(n, known)

  // Mark the provided Component as a class component so the render
  // instrumentation below can tell classes from function components.
  if (typeof context.Component === 'function') context.Component.prototype.isReactComponent = {}

  // Execute function components as the tree is built, so a render runs real
  // component bodies instead of merely assembling element objects. A class
  // component is instantiated and its render() called, exactly as React would.
  const render = (type, props) => {
    if (typeof type === 'function') {
      if (type.prototype && type.prototype.isReactComponent) {
        return new type(props || {}).render()
      }
      return type(props || {})
    }
    return { type, props }
  }
  context.jsx = render
  context.jsxs = (type, props) => render(type, props)

  context.globalThis = context
  // The app runs in a browser, where window.localStorage IS localStorage. Give
  // the VM the same binding so the boot-cache and mirror code takes its real
  // path here instead of throwing into a catch.
  context.window = context
  vm.runInNewContext(executable, context, { filename: 'plugin.js' })
  return { context, names }
}
