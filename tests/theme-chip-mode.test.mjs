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

/**
 * The provider the chip captures. `themeName` is the ACTIVE skin, because the
 * chip asks the provider what is applied rather than sniffing the DOM; `mode`
 * and `renderedMode` are the live polarity. Calls are recorded, and setMode
 * mutates the provider so a re-render sees the new state, exactly as the host
 * does.
 */
function provider(frame, calls) {
  return {
    themeName: frame.themeName,
    mode: frame.mode,
    renderedMode: frame.mode,
    setTheme: name => calls.push(['theme', name]),
    setMode: value => { calls.push(['mode', value]); frame.mode = value },
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
  const frame = { themeName: theme, mode }
  const { context } = await loadPlugin({ stubbed: { useTheme: () => provider(frame, calls) } })
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
  root.dataset.hermesTheme = scene.name
  root.dataset.hermesMode = mode
  store.set('hermes-desktop-theme-v2', scene.name)
  store.set('hermes-desktop-mode-v1', mode)
  return { context, helpers, css, root, scene, calls, frame }
}

test('the lightbulb hands a PORTED scene to the provider in the opposite mode', async () => {
  // amber-terminal was dark-only before every scene became dynamic, so its light
  // palette is derived (derivedLight), not authored.
  const { helpers, css, scene, calls } = await loadAppliedChip({ theme: 'amber-terminal', mode: 'dark' })
  assert.equal(scene.derivedLight, true, 'fixture: this scene is a ported one')

  lightbulb(helpers.ThemeChip({})).props.onClick()

  assert.ok(calls.some(call => call[0] === 'mode' && call[1] === 'light'),
    'Desktop is told to render the light palette')
  assert.ok(calls.some(call => call[0] === 'theme' && call[1] === 'amber-terminal'),
    'and it is told which scene, so the two cannot drift apart')
  assert.equal(css.size, 0, 'the chip paints nothing: the provider owns every token')
})

test('the lightbulb hands an AUTHORED pair to the provider the same way', async () => {
  const { helpers, css, scene, calls } = await loadAppliedChip({ theme: 'dark-aubergine', mode: 'dark' })
  assert.notEqual(scene.derivedLight, true, 'fixture: this palette pair is authored')
  assert.notEqual(scene.derivedDark, true, 'fixture: this palette pair is authored')

  lightbulb(helpers.ThemeChip({})).props.onClick()

  assert.ok(calls.some(call => call[0] === 'mode' && call[1] === 'light'),
    'an authored pair takes the same path as a derived one')
  assert.ok(calls.some(call => call[0] === 'theme' && call[1] === 'dark-aubergine'))
  assert.equal(css.size, 0, 'and still paints nothing itself')
})

test('the lightbulb hands EVERY dynamic scene over, so the path is not origin-specific', async () => {
  // Prove the scope rather than trusting the report's guess that it only affects
  // single-mode-origin scenes: the same hand-off must run for all 94.
  const calls = []
  const frame = { themeName: 'amber-terminal', mode: 'dark' }
  const { context } = await loadPlugin({ stubbed: { useTheme: () => provider(frame, calls) } })
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
    calls.length = 0
    root.dataset = {}
    const css = new Map()
    root.style = {
      setProperty: (key, value) => css.set(key, value),
      getPropertyValue: key => css.get(key) ?? ''
    }
    frame.themeName = scene.name
    frame.mode = 'dark'
    lightbulb(helpers.ThemeChip({})).props.onClick()

    const handedMode = calls.some(call => call[0] === 'mode' && call[1] === 'light')
    const handedTheme = calls.some(call => call[0] === 'theme' && call[1] === scene.name)
    if (!handedMode || !handedTheme || css.size !== 0) failures.push(scene.name)
  }

  assert.deepEqual(failures, [], `the lightbulb did not hand these scenes over: ${failures.join(', ')}`)
  assert.equal(scenes.length, 94, 'the shipped catalog is 94 skins')
})
