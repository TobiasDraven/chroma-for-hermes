import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const pluginPath = new URL('../chroma/desktop/plugin.js', import.meta.url)

/**
 * Surface regression guard.
 *
 * This file pins the plugin's PUBLIC SURFACES — the route, the sidebar entry,
 * the statusbar chip, the palette command, the gateway broadcast and the theme
 * catalog. It exists because a previous restructure silently deleted all of
 * them, and every suite stayed green because nothing asserted they were there.
 *
 * If you are here because this test fails, you removed a user-facing surface.
 * That is a product decision. Surface it to the Captain; do not "fix" the test.
 */
async function loadForRegistration() {
  const source = await readFile(pluginPath, 'utf8')
  const executable = source
    .replace(/import\s+\{[\s\S]*?\}\s+from\s+'@hermes\/plugin-sdk'\n/, '')
    .replace(/import\s+\{[^}]*\}\s+from\s+'react\/jsx-runtime'\n/, '')
    .replace(/import\s+\{[^}]*\}\s+from\s+'react'\n/, '')
    .replace('export default {', 'globalThis.plugin = {')

  const registrations = []
  const requests = []
  const storage = new Map()

  const context = {
    console,
    globalThis: null,
    document: {
      documentElement: {
        dataset: {},
        style: { setProperty: () => {} },
        classList: { toggle: () => {} },
        setAttribute: () => {},
        removeAttribute: () => {}
      },
      head: { appendChild: () => {}, removeChild: () => {} },
      createElement: () => ({ setAttribute: () => {}, style: {}, remove: () => {} }),
      getElementById: () => null,
      querySelector: () => null,
      body: { appendChild: () => {}, removeChild: () => {} }
    },
    MutationObserver: class { observe() {} disconnect() {} },
    fetch: () => Promise.reject(new Error('no fetch in the guard')),
    oklchToHex: () => '#000000',
    haptic: () => {},
    host: {
      notify: () => {},
      navigate: () => {},
      onEvent: () => {},
      request: async (method, params) => { requests.push({ method, params }); return {} },
      settings: { get: () => undefined, set: () => {} }
    },
    // jsx is only ever referenced from inside component bodies, which this guard
    // never invokes. Stub it so a registration that builds an element eagerly
    // still records rather than throwing.
    jsx: () => null,
    jsxs: () => null,
    APPEARANCE_AREAS: { extra: 'appearance.extra' },
    PALETTE_AREA: 'palette',
    ROUTES_AREA: 'routes',
    SIDEBAR_NAV_AREA: 'sidebar',
    STATUSBAR_AREAS: { right: 'statusbar-right' },
    THEMES_AREA: 'themes',
    Badge: () => null,
    Button: () => null,
    Input: () => null,
    SearchField: () => null,
    SegmentedControl: () => null,
    cn: (...parts) => parts.filter(Boolean).join(' '),
    useTheme: () => ({
      themeName: 'nous',
      mode: 'dark',
      resolvedMode: 'dark',
      setTheme: () => {},
      setMode: () => {},
      previewTheme: () => {},
      clearThemePreview: () => {}
    }),
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useMemo: fn => fn(),
    Component: class {},
    useCallback: fn => fn,
    useRef: value => ({ current: value }),
    setTimeout: () => 0,
    clearTimeout: () => {},
    AbortController: class {
      constructor() {
        const signal = { aborted: false, addEventListener: () => {}, removeEventListener: () => {} }
        this.signal = signal
        this.abort = () => { signal.aborted = true }
      }
    },
    window: {
      localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key)
      }
    }
  }
  context.globalThis = context
  vm.runInNewContext(executable, context, { filename: 'plugin.js' })

  const plugin = context.plugin
  plugin.register({
    register: entry => registrations.push(entry),
    rest: (...args) => Promise.resolve({ args }),
    onUnload: () => {},
    onEvent: () => {},
    spawnTask: () => {},
    injectMessage: () => false
  })

  return { plugin, registrations, requests, storage, source }
}

const inArea = (registrations, area) => registrations.filter(r => r.area === area)

test('the plugin still identifies itself as chroma', async () => {
  const { plugin } = await loadForRegistration()
  assert.equal(plugin.id, 'chroma')
})

test('the full-page picker route is still registered', async () => {
  const { registrations } = await loadForRegistration()
  const routes = inArea(registrations, 'routes')
  assert.equal(routes.length, 1, 'exactly one route must be registered')
  assert.equal(routes[0].data.path, '/chroma')
  assert.equal(typeof routes[0].render, 'function', 'the route must render the picker')
})

test('the sidebar entry is still registered', async () => {
  const { registrations } = await loadForRegistration()
  const nav = inArea(registrations, 'sidebar')
  assert.equal(nav.length, 1, 'exactly one sidebar entry must be registered')
  assert.equal(nav[0].data.path, '/chroma')
})

test('the statusbar chip is still registered', async () => {
  const { registrations } = await loadForRegistration()
  const chip = inArea(registrations, 'statusbar-right')
  assert.equal(chip.length, 1, 'exactly one statusbar chip must be registered')
  assert.equal(typeof chip[0].render, 'function')
})

test('the command palette entry is still registered', async () => {
  const { registrations } = await loadForRegistration()
  const palette = inArea(registrations, 'palette')
  assert.equal(palette.length, 1, 'exactly one palette command must be registered')
  assert.equal(palette[0].data.id, 'chroma.open')
})

test('the theme catalog is still registered as Desktop themes', async () => {
  const { registrations } = await loadForRegistration()
  const themes = inArea(registrations, 'themes')
  assert.ok(themes.length > 50, `expected the catalog, got ${themes.length} themes`)
  for (const theme of themes) {
    assert.ok(theme.data.name, 'every registered theme needs a name')
    assert.ok(theme.data.colors?.background, 'every registered theme needs colours')
  }
})

test('gateway sync is still wired into the shipped build', async () => {
  const { source } = await loadForRegistration()
  assert.ok(
    source.includes("host.request('config.set'"),
    'the gateway broadcast must survive — it is what makes the CLI follow'
  )
})

test('applying a skin still hands the switch to the Desktop ThemeProvider', async () => {
  const { source } = await loadForRegistration()
  assert.ok(
    source.includes('syncDesktopState'),
    'the ThemeProvider handoff is the fix for the reverting-theme bug; it must not be removed'
  )
})

test('the app-owned localStorage keys are still untouched', async () => {
  const { source } = await loadForRegistration()
  for (const key of ['hermes-desktop-user-themes-v1', 'hermes-boot-background', 'hermes-boot-color-scheme']) {
    assert.ok(source.includes(key), `app-owned key lost: ${key}`)
  }
})
