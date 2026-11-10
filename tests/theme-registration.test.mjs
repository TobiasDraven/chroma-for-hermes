import assert from 'node:assert/strict'
import test from 'node:test'

import { loadPlugin } from './helpers/load-plugin.mjs'

/**
 * D2 — a scene created or edited mid-session must publish its Desktop theme.
 *
 * register() runs once, from the static SKINS catalogue, so a fork made later
 * was absent from the host's live `availableThemes`; syncDesktopState then
 * refused its own name and the provider repainted the previous (often light)
 * theme. reRegisterSceneTheme writes the same contribution id the boot loop
 * uses, and the host registry replaces that id rather than rejecting it.
 *
 * The helper loads the generated build, which regenerate.py writes from
 * plugin.template.js; the two are the same code after every build.
 */

async function registeredContext() {
  const { context } = await loadPlugin()
  const registered = []
  context.plugin.register({
    rest: async () => ({}),
    register(contribution) {
      registered.push(contribution)
      return () => {}
    },
    // The host store is synchronous (contrib/plugin.ts): get returns the value,
    // not a Promise. An async stub would model a contract the app does not have.
    storage: { get: () => null, set: () => {} }
  })
  // Drop the boot registrations: this file is about the mid-session path.
  registered.length = 0
  return { context, registered }
}

test('a scene outside SKINS is refused the hand-off until reRegisterSceneTheme publishes it', async () => {
  const { context, registered } = await registeredContext()
  const scene = {
    name: 'mid-session-fork',
    label: 'Mid Session Fork',
    lightColors: { background: '#101010', ui_accent: '#ff0000' },
    darkColors: { background: '#000000' },
    typography: { fontSans: '"Segoe UI", sans-serif' }
  }

  // The host's live list is non-empty and does not carry this name yet.
  let painted = 0
  const hostApi = {
    availableThemes: [{ name: 'nous', label: 'Nous' }],
    setTheme() { painted += 1 },
    setMode() {}
  }
  const refused = context.handThemeToProvider(scene.name, 'dark', hostApi)
  assert.equal(refused.ok, false, 'an unregistered mid-session scene is refused')
  assert.equal(refused.reason, 'unresolved', 'and it is refused BY NAME, not by paint')
  assert.equal(painted, 0, 'the refused hand-off does not touch the provider')

  assert.equal(context.reRegisterSceneTheme(scene), true)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].id, 'theme:' + scene.name, 'the boot contribution id')
  assert.equal(registered[0].area, context.THEMES_AREA, 'the Themes area')
  assert.equal(registered[0].data.name, scene.name)
  assert.equal(registered[0].data.typography.fontSans, '"Segoe UI", sans-serif')

  // The host registry replaces a contribution with the same id, so a second
  // save is a refresh, not a duplicate.
  assert.equal(context.reRegisterSceneTheme({ ...scene, label: 'Renamed Fork' }), true)
  assert.equal(registered.length, 2)
  assert.equal(registered[1].id, registered[0].id)
  assert.equal(registered[1].data.label, 'Renamed Fork')
})
