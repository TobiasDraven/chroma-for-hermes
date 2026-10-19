// The editor's promise: change a role, and the skin you apply changes with it.
//
// The suite did not test this, and it was broken for two of the six roles. The
// editor wrote `banner_text` and `status_bar_bg` while the palette engine reads
// `ui_text` and `background` first, so the preview strip moved and the applied
// theme did not. A green suite said nothing, because nothing asserted the seam.
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadPlugin } from './helpers/load-plugin.mjs'

const PROBE = '#010203'

function themeFor(t, skin, colors) {
  return JSON.stringify(
    t.skinToDesktopTheme({ name: skin.name, description: skin.description, colors })
  )
}

test('every editor role changes the theme that gets applied', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const skin = t.SKINS.find(s => s.name === 'dark-dracula') || t.SKINS[0]
  const base = themeFor(t, skin, { ...skin.colors })

  // The Desktop's theme mapper reads a subset of the palette; the CLI reads all of
  // it. A role outside that subset is allowed to leave this window untouched - but
  // only if it admits that in the row, because silence there is the bug this file
  // was written for.
  const dead = []
  const unmarked = []
  for (const role of t.EDITOR_ROLES) {
    const key = role.keys[0]
    const colors = { ...skin.colors, [key]: PROBE }
    const unchanged = themeFor(t, skin, colors) === base
    if (unchanged && role.desktop !== false) dead.push(role.id + ' writes ' + key)
    if (!unchanged && role.desktop === false) unmarked.push(role.id + ' is marked CLI-only but repaints')
  }

  assert.deepEqual(dead, [],
    'these roles change the preview without changing the applied theme: ' + dead.join(', '))
  assert.deepEqual(unmarked, [],
    'these roles are marked CLI-only but do reach the window: ' + unmarked.join(', '))
})

test('every editor role is reachable in the applied theme, not only in the strip', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers

  // Sample across packs so a skin whose palette is thin cannot hide a broken role.
  const sample = ['alabaster', 'dark-dracula', 'chrome-rain', 'high-noon', 'redwood']
    .map(name => t.SKINS.find(s => s.name === name))
    .filter(Boolean)
  assert.ok(sample.length >= 4, 'the sample must resolve')

  const dead = []
  for (const skin of sample) {
    const base = themeFor(t, skin, { ...skin.colors })
    for (const role of t.EDITOR_ROLES) {
      // A CLI-only colour is allowed to leave this window alone - it is marked.
      if (role.desktop === false) continue
      const key = role.keys[0]
      if (themeFor(t, skin, { ...skin.colors, [key]: PROBE }) === base) {
        dead.push(skin.name + ': ' + role.id)
      }
    }
  }
  assert.deepEqual(dead, [], 'dead roles: ' + dead.join(', '))
})

test('the strip and the applied theme read the same key for each role', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  // A role whose primary key the palette engine ignores is a cosmetic control.
  // The strip is the preview; if the two disagree the preview lies.
  const skin = t.SKINS[0]
  const base = themeFor(t, skin, { ...skin.colors })

  for (const role of t.EDITOR_ROLES) {
    if (role.desktop === false) {
      // Not a promise about the preview: a promise about the label. The row must
      // say CLI, or the edit looks like it did something it did not do.
      assert.ok(role.desktop === false, `${role.id}: a colour this window does not read must say so`)
      continue
    }
    const key = role.keys[0]
    const applied = themeFor(t, skin, { ...skin.colors, [key]: PROBE }) !== base
    assert.ok(applied, `${role.id}: writing ${key} must reach the applied theme`)
  }
})

test('Save is offered always and enabled only when the draft changed', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  // An untouched save writes an override that pins the shipped palette, so a
  // later catalogue fix would never reach that skin.
  assert.equal(t.saveDisabled(false, null), true, 'nothing changed: disabled')
  assert.equal(t.saveDisabled(true, null), false, 'a real edit: enabled')
  assert.equal(t.saveDisabled(true, 'save'), true, 'a write in flight: disabled')
  assert.equal(t.saveDisabled(true, 'reset'), true, 'a reset in flight: disabled')
})

test('a font choice reaches the override body, and an empty one is omitted', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const body = t.overridePayload({
    light: {}, dark: {},
    typography: { fontSans: 'Inter, sans-serif', fontMono: 'JetBrains Mono, monospace' }
  })
  const plain = value => JSON.parse(JSON.stringify(value))
  assert.deepEqual(plain(body.typography), {
    fontSans: 'Inter, sans-serif',
    fontMono: 'JetBrains Mono, monospace'
  }, 'both stacks ride the same payload as the colours')

  const fontOnly = t.overridePayload({ light: {}, dark: {}, typography: { fontSans: 'Georgia' } })
  assert.deepEqual(plain(fontOnly.typography), { fontSans: 'Georgia' })
  assert.equal(fontOnly.light && Object.keys(fontOnly.light).length, 0, 'a font-only edit carries no colours')

  const none = t.overridePayload({ light: {}, dark: {}, typography: { fontSans: '', fontMono: '' } })
  assert.equal(none.typography, undefined, 'cleared fonts are not sent as empty strings')
})
