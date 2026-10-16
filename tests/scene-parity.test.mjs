// The parity guard for the scene -> Desktop theme mapper.
//
// skinToDesktopTheme was refactored from 24 branches to a data-driven ramp. These
// tests pin the VALUES it produces, for every catalog scene and for hand-built
// edge skins, so a future "behaviour-neutral" refactor cannot quietly move a hex.
//
// A failure here means behaviour changed. Fix the code. Regenerate the fixture
// (tests/regenerate-scene-parity.mjs) only when the change is intended.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { loadPlugin } from './helpers/load-plugin.mjs'
import { EDGE_SKINS, GOLDEN_SCENES, GOLDEN_EDGES } from './helpers/parity-cases.mjs'

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/scene-theme-parity.json', import.meta.url), 'utf8')
)
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
// Values built inside the VM carry the VM's prototypes, so deep-compare plain data.
const plain = (value) => JSON.parse(JSON.stringify(value))
// Both cases are legitimate: a skin's own seed colours pass through verbatim
// (#F8FAFF), while every derived colour comes back lowercase from rgbToHex.
const HEX = /^#[0-9a-fA-F]{6}$/

test('every catalog scene still maps to its recorded palette', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const scenes = t.SKINS || t.CATALOG
  assert.equal(scenes.length, fixture.sceneCount, 'the catalog size changed')

  const moved = []
  for (const scene of scenes) {
    const theme = t.sceneToDesktopTheme(scene)
    const got = `${digest(theme.colors)}:${digest(theme.darkColors)}`
    if (got !== fixture.scenes[scene.name]) moved.push(scene.name)
  }
  assert.deepEqual(moved, [], `these scene palettes changed: ${moved.slice(0, 8).join(', ')}`)
})

test('the representative skins keep their exact palettes', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const scenes = t.SKINS || t.CATALOG
  for (const name of GOLDEN_SCENES) {
    const golden = fixture.goldens[name]
    if (!golden) continue
    const scene = scenes.filter((s) => s.name === name)[0]
    assert.ok(scene, `golden scene ${name} is not in the catalog`)
    const theme = t.sceneToDesktopTheme(scene)
    assert.deepEqual(plain(theme.colors), golden.light, `${name}: light palette moved`)
    assert.deepEqual(plain(theme.darkColors), golden.dark, `${name}: dark palette moved`)
  }
})

test('hand-built edge skins still resolve as recorded', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  for (const skin of EDGE_SKINS) {
    const theme = t.skinToDesktopTheme(skin)
    assert.equal(digest(theme.colors), fixture.edges[skin.name], `${skin.name}: palette moved`)
    if (GOLDEN_EDGES.includes(skin.name)) {
      assert.deepEqual(plain(theme.colors), fixture.goldens[skin.name], `${skin.name}: key-level change`)
    }
  }
})

test('every palette is complete, in the same key order, and every value is a 6-digit hex', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const scenes = t.SKINS || t.CATALOG
  const expected = Object.keys(fixture.goldens[GOLDEN_SCENES[0]].light)
  const problems = []

  for (const scene of scenes) {
    const theme = t.sceneToDesktopTheme(scene)
    for (const [variant, palette] of [['light', theme.colors], ['dark', theme.darkColors]]) {
      if (!palette) {
        problems.push(`${scene.name}/${variant}: missing`)
        continue
      }
      if (Object.keys(palette).join(',') !== expected.join(',')) {
        problems.push(`${scene.name}/${variant}: key set or order changed`)
      }
      for (const key of Object.keys(palette)) {
        if (!HEX.test(palette[key])) problems.push(`${scene.name}/${variant}.${key}=${palette[key]}`)
      }
    }
  }
  assert.deepEqual(problems, [], `palette problems: ${problems.slice(0, 8).join(' | ')}`)
})
