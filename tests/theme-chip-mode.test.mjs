// The statusbar chip's lightbulb is the only place the user can flip the live
// mode without opening Chroma. It has to repaint the SAME surface the picker
// paints, or the report reads "does not respond / gets stuck".
//
// This suite holds that contract by rendering the shipped `ThemeChip`, invoking
// the real lightbulb `onClick`, and reading the root tokens `applyDesktopTheme`
// writes. The harness stubs the SDK, so the only observable for "the user can
// see it" is our own paint: the provider's `setMode` is recorded but is not the
// surface under test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './helpers/load-plugin.mjs'

/** The provider the chip captures and hands to applyScene. Records its calls. */
function provider(mode, calls) {
  return {
    themeName: 'nous',
    mode,
    setTheme: name => calls.push(['theme', name]),
    setMode: value => calls.push(['mode', value]),
    previewTheme() {},
    clearThemePreview() {}
  }
}

/** Walk a live element tree (props.children) and return every host button. */
function buttonsIn(node, acc = []) {
  if (!node || typeof node !== 'object') return acc
  if (Array.isArray(node)) { node.forEach(child => buttonsIn(child, acc)); return acc }
  if (node.type === 'button') acc.push(node)
  buttonsIn(node.props && node.props.children, acc)
  return acc
}

function lightbulb(chip) {
  return buttonsIn(chip).find(button => String(button.props.title || '').startsWith('Switch to'))
}

/** The seed applyDesktopTheme writes for a scene in a given mode. */
function seedFor(helpers, scene, mode) {
  const desktop = helpers.sceneToDesktopTheme(scene)
  return mode === 'dark' ? desktop.darkColors.background : desktop.colors.background
}

/**
 * Load the shipped build and give it a mutable localStorage plus a root whose
 * painted tokens can be read back, then seed the surface exactly as a prior
 * scene apply would have left it, so the chip starts where a user who just
 * picked the scene would start.
 */
async function loadAppliedChip({ theme, mode }) {
  const calls = []
  const { context } = await loadPlugin({ stubbed: { useTheme: () => provider(mode, calls) } })
  const helpers = context.testHelpers
  const store = new Map()
  context.window = {
    localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value)
    }
  }
  const css = new Map()
  const root = context.document.documentElement
  root.dataset = {}
  root.style = {
    setProperty: (key, value) => css.set(key, value),
    getPropertyValue: key => css.get(key) ?? ''
  }
  const scene = helpers.SKINS.find(item => item.name === theme)
  assert.ok(scene, `the catalog must carry ${theme}`)
  const desktop = helpers.sceneToDesktopTheme(scene)
  root.dataset.hermesTheme = scene.name
  root.dataset.hermesMode = mode
  css.set('--theme-background-seed', mode === 'dark' ? desktop.darkColors.background : desktop.colors.background)
  store.set('hermes-desktop-theme-v2', scene.name)
  store.set('hermes-desktop-mode-v1', mode)
  return { context, helpers, css, root, scene, calls }
}

test('the lightbulb repaints a scene whose second palette was PORTED (originally dark-only)', async () => {
  // amber-terminal was dark-only before every scene became dynamic, so its light
  // palette is derived (derivedLight), not authored.
  const { helpers, css, root, scene, calls } = await loadAppliedChip({ theme: 'amber-terminal', mode: 'dark' })
  assert.equal(scene.derivedLight, true, 'fixture: this scene is a ported one')
  assert.equal(root.dataset.hermesMode, 'dark', 'fixture: it starts on the dark palette')

  lightbulb(helpers.ThemeChip({})).props.onClick()

  assert.equal(root.dataset.hermesMode, 'light', 'the surface must follow the lightbulb to the light palette')
  assert.equal(root.dataset.hermesTheme, 'amber-terminal', 'and stay on the active scene')
  assert.equal(css.get('--theme-background-seed'), seedFor(helpers, scene, 'light'))
  assert.ok(calls.some(call => call[0] === 'mode' && call[1] === 'light'), 'Desktop provider stays in step')
})

test('the lightbulb repaints a scene that always shipped a PAIR (authored both ways)', async () => {
  const { helpers, css, root, scene } = await loadAppliedChip({ theme: 'dark-aubergine', mode: 'dark' })
  assert.notEqual(scene.derivedLight, true, 'fixture: this palette pair is authored')
  assert.notEqual(scene.derivedDark, true, 'fixture: this palette pair is authored')
  assert.equal(root.dataset.hermesMode, 'dark', 'fixture: it starts on the dark palette')

  lightbulb(helpers.ThemeChip({})).props.onClick()

  assert.equal(root.dataset.hermesMode, 'light', 'the surface must follow the lightbulb to the light palette')
  assert.equal(css.get('--theme-background-seed'), seedFor(helpers, scene, 'light'))
})

test('the lightbulb repaints EVERY dynamic scene, so the failure is not origin-specific', async () => {
  // Prove the scope of the defect rather than trusting the report's guess that
  // it only affects single-mode-origin scenes: the same path runs for all 94.
  const calls = []
  const { context } = await loadPlugin({ stubbed: { useTheme: () => provider('dark', calls) } })
  const helpers = context.testHelpers
  const store = new Map()
  context.window = {
    localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value)
    }
  }
  const root = context.document.documentElement
  const scenes = helpers.SKINS.filter(scene => scene.modeSupport === 'dynamic')
  const failures = []

  for (const scene of scenes) {
    const css = new Map()
    root.dataset = {}
    root.style = {
      setProperty: (key, value) => css.set(key, value),
      getPropertyValue: key => css.get(key) ?? ''
    }
    const desktop = helpers.sceneToDesktopTheme(scene)
    root.dataset.hermesTheme = scene.name
    root.dataset.hermesMode = 'dark'
    css.set('--theme-background-seed', desktop.darkColors.background)
    store.set('hermes-desktop-theme-v2', scene.name)
    store.set('hermes-desktop-mode-v1', 'dark')
    lightbulb(helpers.ThemeChip({})).props.onClick()
    if (root.dataset.hermesMode !== 'light') failures.push(scene.name)
  }

  assert.deepEqual(
    failures,
    [],
    `the lightbulb left these scenes on the old palette: ${failures.join(', ')}`
  )
  assert.equal(scenes.length, 94, 'the shipped catalog is 94 skins')
})
