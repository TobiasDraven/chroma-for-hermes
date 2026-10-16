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
    + '\nglobalThis.testHelpers = { ThemeCard, ThemePicker, ThemeChip, exportArtifact, exportOwnedSkins, parseImportedTheme, normHex, windowsTerminalTheme, base16Theme, vsCodeTheme, PREVIEW_MS, previewSecondsLeft }\n'

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

  // Execute function components as the tree is built, so a render runs real
  // component bodies instead of merely assembling element objects.
  const render = (type, props) =>
    typeof type === 'function' ? type(props || {}) : { type, props }
  context.jsx = render
  context.jsxs = (type, props) => render(type, props)

  context.globalThis = context
  vm.runInNewContext(executable, context, { filename: 'plugin.js' })
  return { context, names }
}
