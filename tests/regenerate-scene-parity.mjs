// Regenerates tests/fixtures/scene-theme-parity.json from the CURRENT build.
//
// Run this ONLY when a palette change is intended. The fixture exists to prove
// that a refactor moved no value: if a test fails after an edit you believed was
// behaviour-neutral, the edit changed behaviour - do not "fix" it by regenerating
// this file.
//
//   node tests/regenerate-scene-parity.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { loadPlugin } from './helpers/load-plugin.mjs'
import { EDGE_SKINS, GOLDEN_EDGES, GOLDEN_SCENES } from './helpers/parity-cases.mjs'

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
const { context } = await loadPlugin()
const t = context.testHelpers
const scenes = t.SKINS || t.CATALOG

const fixture = {
  note: 'Digests of every catalog scene palette plus full palettes for a few representative '
    + 'skins. Regenerate with tests/regenerate-scene-parity.mjs ONLY when a palette change is '
    + 'intended: this file exists to prove a refactor moved no value, so an unexpected diff '
    + 'means behaviour changed.',
  sceneCount: scenes.length,
  scenes: {},
  edges: {},
  goldens: {}
}

for (const scene of [...scenes].sort((a, b) => (a.name < b.name ? -1 : 1))) {
  const theme = t.sceneToDesktopTheme(scene)
  fixture.scenes[scene.name] = `${digest(theme.colors)}:${digest(theme.darkColors)}`
}

for (const skin of EDGE_SKINS) {
  const theme = t.skinToDesktopTheme(skin)
  fixture.edges[skin.name] = digest(theme.colors)
  if (GOLDEN_EDGES.includes(skin.name)) fixture.goldens[skin.name] = theme.colors
}

for (const name of GOLDEN_SCENES) {
  const scene = scenes.filter((s) => s.name === name)[0]
  if (scene) {
    const theme = t.sceneToDesktopTheme(scene)
    fixture.goldens[name] = { light: theme.colors, dark: theme.darkColors }
  }
}

const target = new URL('./fixtures/scene-theme-parity.json', import.meta.url)
await writeFile(target, JSON.stringify(fixture, null, 1) + '\n')
const written = JSON.parse(await readFile(target, 'utf8'))
console.log(`wrote ${Object.keys(written.scenes).length} scenes, ${Object.keys(written.edges).length} edges, `
  + `${Object.keys(written.goldens).length} goldens`)
