import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const pluginPath = new URL('../desktop/plugin.js', import.meta.url)

/**
 * The bug this test exists to stop.
 *
 * Both older harnesses hand-wrote a `useRef` and `useCallback` stub in their VM
 * context. The real app has no such global — those names can only arrive through
 * `import ... from 'react'`. So when F6 added `useRef` and F1 added `useCallback`
 * without adding them to the import, the page died on render while every suite
 * stayed green: the harness supplied what the import forgot.
 *
 * This one does the opposite. It reads the SHIPPED file's own import statements
 * and injects exactly those names and nothing else. Any identifier the module
 * uses but does not import is undefined here, the same as in the app.
 */

// Browser globals the renderer genuinely has. Not hooks, not SDK — real globals.
function rendererGlobals() {
  const storage = new Map()
  return {
    console,
    document: {
      documentElement: { dataset: {}, style: { setProperty() {} }, classList: { toggle() {} } }
    },
    fetch: () => Promise.reject(new Error('no fetch in test')),
    setTimeout: (fn) => fn(),
    clearTimeout() {},
    MutationObserver: class { observe() {} disconnect() {} },
    localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k)
    },
    __storage: storage
  }
}

// Known SDK/react names get useful stubs. Anything NOT listed and NOT imported
// falls through to a reference error, which is the point.
function stubFor(name) {
  const known = {
    host: {
      notify() {},
      navigate() {},
      onEvent() {},
      request: async () => ({}),
      state: {
        profile: { get: () => 'default' },
        viewport: { get: () => ({ width: 1200, height: 800, narrow: false }) }
      }
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
    useRef: (v) => ({ current: v })
  }
  if (name in known) return known[name]
  // Area constants are plain strings.
  if (/^[A-Z][A-Z0-9_]*$/.test(name)) return name.toLowerCase()
  if (name[0] === name[0].toUpperCase() && /[A-Z]/.test(name.slice(1))) return () => null
  return () => {}
}

function importedNames(source) {
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

async function loadPlugin() {
  const source = await readFile(pluginPath, 'utf8')
  const names = importedNames(source)
  assert.ok(names.length >= 5, 'the import block must be parseable')

  const executable = source
    .replace(/import\s+\{[\s\S]*?\}\s+from\s+'@hermes\/plugin-sdk'\n/, '')
    .replace(/import\s+\{[^}]*\}\s+from\s+'react\/jsx-runtime'\n/, '')
    .replace(/import\s+\{[^}]*\}\s+from\s+'react'\n/, '')
    .replace('export default {', 'globalThis.plugin = {')
    + '\nglobalThis.testHelpers = { ThemeCard, ThemePicker, ThemeChip }\n'

  const context = rendererGlobals()

  // ONLY what the file imports, plus the two primitives jsx needs.
  for (const n of names) context[n] = stubFor(n)

  // Execute function components as the tree is built, so a render actually runs
  // component bodies instead of merely assembling element objects.
  const render = (type, props) =>
    typeof type === 'function' ? type(props || {}) : { type, props }
  context.jsx = render
  context.jsxs = (type, props) => render(type, props)

  // react/jsx-runtime and react were both stripped; restore the two jsx names
  // if the file imported them from jsx-runtime rather than react.
  if (!('jsx' in context)) context.jsx = render
  if (!('jsxs' in context)) context.jsxs = (type, props) => render(type, props)

  context.globalThis = context
  vm.runInNewContext(executable, context, { filename: 'plugin.js' })
  return { context, names }
}

function recordingCtx(registrations) {
  return {
    rest: async () => ({ skins: [] }),
    register(entry) { registrations.push(entry) },
    storage: { get: async () => null, set: async () => {} }
  }
}

test('the shipped build imports every hook it uses', async () => {
  const source = await readFile(pluginPath, 'utf8')
  const names = new Set(importedNames(source))
  for (const hook of ['useRef', 'useCallback', 'useState', 'useEffect', 'useMemo']) {
    assert.ok(names.has(hook), `${hook} is used by the picker but missing from the react import`)
  }
})

test('the plugin registers and every surface RENDERS without a ReferenceError', async () => {
  const { context } = await loadPlugin()
  const regs = []
  context.plugin.register(recordingCtx(regs))

  assert.ok(regs.length >= 100, 'the catalog must still register its themes')

  const rendered = []
  for (const entry of regs) {
    if (typeof entry.render !== 'function') continue
    const node = entry.render()
    assert.ok(node, `${entry.id} rendered nothing`)
    rendered.push(entry.id)
  }
  // Two surfaces render today: the full page (which mounts ThemePicker) and the
  // statusbar chip (which mounts ThemeChip). Both are asserted by id so a future
  // surface joining them does not silently weaken this.
  assert.deepEqual(rendered, ['chroma-page', 'chroma-chip'])
})

test('ThemeCard and ThemePicker component bodies execute', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const scene = {
    name: 'demo-theme', label: 'Demo', description: 'demo', modeSupport: 'dynamic',
    colors: { background: '#111111', ui_accent: '#ff0000' },
    lightColors: { background: '#111111' },
    darkColors: { background: '#111111' }
  }
  assert.doesNotThrow(() => t.ThemeCard({
    scene, mode: 'dark', active: null, applying: null, onApply() {},
    owned: false, managing: null, onDelete() {}, onRename() {},
    previewTheme: null, clearThemePreview: null, localScope: false
  }), 'ThemeCard must resolve every identifier it references')
  assert.doesNotThrow(() => t.ThemePicker({}), 'ThemePicker must resolve every identifier it references')
  assert.doesNotThrow(() => t.ThemeChip({}), 'ThemeChip must resolve every identifier it references')
})
