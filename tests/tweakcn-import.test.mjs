import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const pluginPath = new URL('../desktop/plugin.js', import.meta.url)

/**
 * Reference OKLCH -> sRGB hex, standing in for the SDK's `oklchToHex`. The real
 * one lives in apps/desktop/src/themes/color.ts and is tested by the app; this
 * mirror lets the converter's output be asserted exactly.
 */
function oklchToHexRef({ l, c, h }) {
  const hr = (h * Math.PI) / 180
  const a = c * Math.cos(hr)
  const b = c * Math.sin(hr)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const L = l_ ** 3
  const M = m_ ** 3
  const S = s_ ** 3
  const lin = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S
  ]
  const enc = v => {
    const x = Math.max(0, Math.min(1, v))
    return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055
  }
  return `#${lin.map(v => Math.round(enc(v) * 255).toString(16).padStart(2, '0')).join('')}`
}

function loadPlugin(storage = new Map(), fetchImpl = null) {
  return readFile(pluginPath, 'utf8').then(source => {
    const executable = source
      .replace(/import\s+\{[\s\S]*?\}\s+from\s+'@hermes\/plugin-sdk'\n/, '')
      .replace(/import\s+\{[^}]*\}\s+from\s+'react\/jsx-runtime'\n/, '')
      .replace(/import\s+\{[^}]*\}\s+from\s+'react'\n/, '')
      .replace('export default {', 'globalThis.plugin = {')
      + '\nglobalThis.testHelpers = { cssColorToHex, tweakcnToDesktopTheme, tweakcnUrl, fetchTweakcnTheme, parseCssTheme, sceneToDesktopTheme, catalog: CATALOG }\n'

    const context = {
      console,
      globalThis: null,
      document: { documentElement: { dataset: {}, style: { setProperty: () => {} }, classList: { toggle: () => {} } } },
      fetch: fetchImpl || (() => Promise.reject(new Error('no fetch in test'))),
      oklchToHex: oklchToHexRef,
      haptic: () => {},
      host: { notify: () => {}, navigate: () => {}, onEvent: () => {} },
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
      useTheme: () => ({ themeName: 'nous', mode: 'dark', setTheme: () => {}, setMode: () => {} }),
      useState: value => [typeof value === 'function' ? value() : value, () => {}],
      useEffect: () => {},
      useMemo: fn => fn(),
      useCallback: fn => fn,
      window: {
        localStorage: {
          getItem: key => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value)
        }
      },
      setTimeout: fn => fn()
    }
    context.globalThis = context
    vm.runInNewContext(executable, context, { filename: 'plugin.js' })
    context.plugin.__test = context.testHelpers
    return context.plugin
  })
}

// --- colour normalisation -------------------------------------------------

test('normalises hex, oklch and rgb colour tokens to #rrggbb', async () => {
  const { __test } = await loadPlugin()
  const hex = __test.cssColorToHex

  assert.equal(hex('#fff'), '#ffffff')
  assert.equal(hex('#abcdef'), '#abcdef')
  assert.equal(hex('#abcdef80'), '#abcdef')
  assert.equal(hex('  #ABC  '), '#aabbcc')
  assert.equal(hex('oklch(1 0 0)'), '#ffffff')
  assert.equal(hex('oklch(0 0 0)'), '#000000')
  assert.equal(hex('rgb(255, 0, 0)'), '#ff0000')
  assert.equal(hex('rgba(0, 0, 255, 0.5)'), '#0000ff')
})

test('rejects colour values it cannot convert', async () => {
  const { __test } = await loadPlugin()
  const hex = __test.cssColorToHex

  assert.equal(hex('var(--primary)'), undefined)
  assert.equal(hex('currentColor'), undefined)
  assert.equal(hex(''), undefined)
  assert.equal(hex(null), undefined)
  assert.equal(hex('#12'), undefined)
  assert.equal(hex('oklch(broken)'), undefined)
})

// --- registry item -> DesktopTheme ---------------------------------------

const GRAPHITE = {
  name: 'graphite',
  type: 'registry:style',
  cssVars: {
    theme: { 'font-sans': 'Inter, sans-serif', 'font-mono': 'Fira Code, monospace' },
    light: {
      background: 'oklch(1 0 0)',
      foreground: 'oklch(0 0 0)',
      card: 'oklch(0.97 0 0)',
      'card-foreground': 'oklch(0 0 0)',
      primary: 'oklch(0.205 0 0)',
      'primary-foreground': 'oklch(1 0 0)',
      secondary: 'oklch(0.9 0 0)',
      'secondary-foreground': 'oklch(0.205 0 0)',
      muted: 'oklch(0.885 0 0)',
      'muted-foreground': 'oklch(0.51 0 0)',
      accent: 'oklch(0.9 0 0)',
      'accent-foreground': 'oklch(0.205 0 0)',
      border: 'oklch(0.9 0 0)',
      input: 'oklch(0.9 0 0)',
      ring: 'oklch(0.7 0 0)',
      destructive: 'oklch(0.577 0.245 27.325)',
      'destructive-foreground': 'oklch(1 0 0)'
    },
    dark: {
      background: 'oklch(0.145 0 0)',
      foreground: 'oklch(0.985 0 0)',
      primary: 'oklch(0.985 0 0)',
      'primary-foreground': 'oklch(0.205 0 0)',
      border: 'oklch(0.269 0 0)'
    }
  }
}

test('maps a TweakCN registry item onto a valid DesktopTheme', async () => {
  const { __test } = await loadPlugin()
  const theme = __test.tweakcnToDesktopTheme(GRAPHITE)

  assert.equal(theme.name, 'graphite')
  assert.equal(theme.label, 'Graphite')
  assert.equal(theme.themePickerSource, 'tweakcn')
  assert.equal(theme.typography.fontSans, 'Inter, sans-serif')
  assert.equal(theme.typography.fontMono, 'Fira Code, monospace')

  // Every required DesktopTheme colour key is present and hex.
  for (const key of ['background', 'foreground', 'primary']) {
    assert.match(theme.colors[key], /^#[0-9a-f]{6}$/, key)
  }
  // camelCase mapping survived.
  assert.equal(theme.colors.cardForeground, '#000000')
  assert.equal(theme.colors.mutedForeground, __test.cssColorToHex('oklch(0.51 0 0)'))
  // Missing optional tokens fall back rather than going undefined.
  assert.match(theme.colors.popover, /^#[0-9a-f]{6}$/)
  assert.match(theme.colors.ring, /^#[0-9a-f]{6}$/)
})

test('derives darkColors only when the preset ships a dark group', async () => {
  const { __test } = await loadPlugin()

  const withDark = __test.tweakcnToDesktopTheme(GRAPHITE)
  assert.ok(withDark.darkColors)
  assert.notEqual(withDark.darkColors.background, withDark.colors.background)

  const noDark = __test.tweakcnToDesktopTheme({ name: 'solo', cssVars: { light: { background: '#fff', foreground: '#000' } } })
  assert.equal(noDark.darkColors, undefined)
})

test('refuses to shadow a built-in desktop theme name', async () => {
  const { __test } = await loadPlugin()
  assert.equal(__test.tweakcnToDesktopTheme({ name: 'nous', cssVars: { light: {} } }), null)
  assert.equal(__test.tweakcnToDesktopTheme({ name: '   ' }), null)
  assert.equal(__test.tweakcnToDesktopTheme(null), null)
})

// --- URL resolution + fetch ----------------------------------------------

test('resolves a preset name to the registry URL and passes a URL through', async () => {
  const { __test } = await loadPlugin()

  assert.equal(__test.tweakcnUrl('catppuccin'), 'https://tweakcn.com/r/themes/catppuccin.json')
  assert.equal(__test.tweakcnUrl('Cosmic Night'), 'https://tweakcn.com/r/themes/cosmic-night.json')
  assert.equal(
    __test.tweakcnUrl('https://tweakcn.com/r/themes/custom.json'),
    'https://tweakcn.com/r/themes/custom.json'
  )
  // A theme PAGE url serves HTML; the preset name is its last path segment.
  assert.equal(
    __test.tweakcnUrl('https://tweakcn.com/themes/catppuccin'),
    'https://tweakcn.com/r/themes/catppuccin.json'
  )
  assert.equal(
    __test.tweakcnUrl('https://tweakcn.com/themes/catppuccin/'),
    'https://tweakcn.com/r/themes/catppuccin.json'
  )
  assert.equal(
    __test.tweakcnUrl('https://www.tweakcn.com/themes/doom-64?ref=x'),
    'https://tweakcn.com/r/themes/doom-64.json'
  )
  // Not tweakcn: hand the URL through untouched.
  assert.equal(__test.tweakcnUrl('https://example.com/theme.json'), 'https://example.com/theme.json')
  assert.equal(__test.tweakcnUrl('  '), null)
})

test('reports an HTML answer as a bad preset instead of a JSON parse error', async () => {
  // tweakcn answers an unknown preset with 500 + an HTML body, and a theme page
  // URL with 200 + HTML; both used to surface "Unexpected token '<'" / doctype.
  const htmlFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('Unexpected token \'<\', "<!DOCTYPE " is not valid JSON') }
  })
  const { __test } = await loadPlugin(new Map(), htmlFetch)
  await assert.rejects(
    () => __test.fetchTweakcnTheme('https://tweakcn.com/themes/nope'),
    /did not return a preset/
  )
})

test('fetches and converts a preset, and surfaces a bad response', async () => {
  const calls = []
  const okFetch = async url => {
    calls.push(url)
    return { ok: true, status: 200, json: async () => GRAPHITE }
  }
  const { __test } = await loadPlugin(new Map(), okFetch)
  const theme = await __test.fetchTweakcnTheme('graphite')

  assert.deepEqual(calls, ['https://tweakcn.com/r/themes/graphite.json'])
  assert.equal(theme.name, 'graphite')

  const badFetch = async () => ({ ok: false, status: 404, json: async () => ({}) })
  const { __test: bad } = await loadPlugin(new Map(), badFetch)
  await assert.rejects(() => bad.fetchTweakcnTheme('nope'), /404/)
})

// --- catalog --------------------------------------------------------------

test('registers the catalog as pure data without any apply machinery', async () => {
  const plugin = await loadPlugin()
  const contributions = []

  plugin.register({ register: contribution => contributions.push(contribution) })

  const themes = contributions.filter(c => c.area === 'themes')
  assert.ok(themes.length > 50, `expected a full catalog, got ${themes.length}`)
  for (const contribution of themes) {
    assert.ok(contribution.id.startsWith('theme:'))
    assert.match(contribution.data.colors.background, /^#[0-9a-fA-F]{6}$/)
  }
  // One picker route, the statusbar chip, and no Appearance panel (importer lives in the picker page).
  assert.equal(contributions.filter(c => c.area === 'appearance.extra').length, 0)
  assert.equal(contributions.filter(c => c.area === 'routes').length, 1)
  assert.equal(contributions.filter(c => c.area === 'statusbar-right').length, 1)
})

// --- CSS paste import -----------------------------------------------------

const SHADCN_CSS = `:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0 0 0);
  --card: oklch(0.97 0 0);
  --card-foreground: oklch(0 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.9 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.885 0 0);
  --muted-foreground: oklch(0.51 0 0);
  --accent: oklch(0.9 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --border: oklch(0.9 0 0);
  --input: oklch(0.9 0 0);
  --ring: oklch(0.7 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(1 0 0);
  --font-sans: "Inter", sans-serif;
  --font-mono: "Fira Code", monospace;
}
.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --border: oklch(0.269 0 0);
}`

test('parses raw shadcn CSS into a DesktopTheme', async () => {
  const { __test } = await loadPlugin()
  const theme = __test.parseCssTheme(SHADCN_CSS, 'my-theme')

  assert.equal(theme.name, 'my-theme')
  assert.equal(theme.label, 'My Theme')
  assert.equal(theme.themePickerSource, 'tweakcn')
  assert.equal(theme.typography.fontSans, '"Inter", sans-serif')
  assert.equal(theme.typography.fontMono, '"Fira Code", monospace')

  for (const key of ['background', 'foreground', 'primary']) {
    assert.match(theme.colors[key], /^#[0-9a-f]{6}$/, key)
  }
  assert.equal(theme.colors.cardForeground, '#000000')
  assert.ok(theme.darkColors)
  assert.notEqual(theme.darkColors.background, theme.colors.background)
})

test('parses CSS without a dark block (light-only theme)', async () => {
  const { __test } = await loadPlugin()
  const css = `:root { --background: #ffffff; --foreground: #000000; --primary: #333333; }`
  const theme = __test.parseCssTheme(css, 'light-only')

  assert.equal(theme.name, 'light-only')
  assert.equal(theme.colors.background, '#ffffff')
  assert.equal(theme.darkColors, undefined)
})

test('rejects CSS without a :root block', async () => {
  const { __test } = await loadPlugin()
  assert.equal(__test.parseCssTheme('not css at all', 'bad'), null)
  assert.equal(__test.parseCssTheme('', 'empty'), null)
  assert.equal(__test.parseCssTheme(null, 'null'), null)
})

test('refuses to shadow a built-in desktop theme name', async () => {
  const { __test } = await loadPlugin()
  assert.equal(__test.parseCssTheme(SHADCN_CSS, 'nous'), null)
})
