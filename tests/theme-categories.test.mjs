// The category lens must be honest: a bucket that exists in THEME_CATEGORIES but
// is produced by no scene renders as an empty shelf, which is a lie in the UI.
// This walks the REAL catalog through the REAL classifier and holds the twelve
// categories, their order, and their reachability.
//
// sceneCategory is a top-level function in the built script, so the vm loader
// exposes it as a global on the context - the same build Desktop runs. No hook
// is stubbed for it, so an undefined identifier here is an undefined identifier
// in the app.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './helpers/load-plugin.mjs'

const { context } = await loadPlugin()
const t = context.testHelpers
const scenes = t.SKINS || t.CATALOG
const sceneCategory = context.sceneCategory
const buildCategoryGroups = context.buildCategoryGroups

// Values built inside the VM carry the VM's prototypes, and assert/strict's
// deepEqual checks prototypes. Rebuild any array before comparing it.
const plain = (value) => JSON.parse(JSON.stringify(value))

// Display order is deliberate: measured/character buckets before hue families.
const EXPECTED = [
  'persimmon', 'apricot', 'amber', 'gold', 'lemon', 'fern',
  'teal', 'cobalt', 'indigo', 'violet', 'rose', 'neutral'
]

test('the category lens is exactly twelve categories, in deliberate order', () => {
  const groups = buildCategoryGroups(scenes)
  assert.equal(groups.length, 12)
  assert.deepEqual(plain(groups.map((g) => g.id)), EXPECTED)
  for (const group of groups) assert.ok(group.title, `${group.id} has no title`)
})

test('every scene lands in exactly one category, and the counts sum to the catalogue', () => {
  const groups = buildCategoryGroups(scenes)
  const total = groups.reduce((n, group) => n + group.scenes.length, 0)
  assert.equal(total, scenes.length, 'the groups must not drop or duplicate a scene')
  assert.equal(total, 94, 'the shipped catalogue is 94 skins')
})

test('every one of the twelve categories is reached by at least one real scene', () => {
  const groups = buildCategoryGroups(scenes)
  const empty = plain(groups.filter((group) => group.scenes.length === 0).map((group) => group.id))
  assert.deepEqual(empty, [], `a category with no scene is a lie in the UI: ${empty.join(', ')}`)
})

test('a partial palette never throws and falls back to a neutral category, not undefined', () => {
  const ids = new Set(buildCategoryGroups(scenes).map((group) => group.id))
  for (const scene of scenes) {
    const id = sceneCategory(scene)
    assert.ok(ids.has(id), `${scene.name} got an unknown category: ${id}`)
  }
  assert.equal(sceneCategory({ name: 'no-colors' }), 'neutral')
  assert.equal(sceneCategory({ name: 'empty', lightColors: {} }), 'neutral')
  assert.equal(sceneCategory({ name: 'junk', lightColors: { ui_accent: 'not-a-color' } }), 'neutral')
})

test('a stored category is honoured, and every skin carries one', () => {
  for (const scene of scenes) {
    assert.ok(EXPECTED.includes(scene.category), `${scene.name} has no stored category`)
    assert.equal(sceneCategory(scene), scene.category, `${scene.name} ignored its stored category`)
  }
})
