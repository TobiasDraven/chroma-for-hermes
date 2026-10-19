// E4 — user categories (plan §22.1, §23).
//
// The twelve built-in shelves are measured and read-only. A user category is
// an ADDITIVE record: it lives in .chroma/categories.json, renders as a shelf
// AFTER the built-ins, and never edits the classifier. This file pins:
//   - effectiveCategory() resolution order (assignment → names → measured)
//   - buildCategoryGroups() / buildGroups() shelf ordering (builtins first)
//   - schemaCategoryDrift() and its notice
//   - categoryCreateFailure() error mapping
//   - the REST transport for list/create/delete/assign
//
// The pure builders are function declarations, so they land on the vm global
// this harness executes; nothing here is stubbed by hand (the loader's rule).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './helpers/load-plugin.mjs'

// Values built inside the vm context carry that realm's prototypes, and
// node:assert/strict compares prototypes. Round-trip through JSON.
const plain = (value) => (value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)))

async function ctx() {
  const { context } = await loadPlugin()
  return context
}

async function withRest(handler) {
  const { context } = await loadPlugin()
  context.plugin.register({
    rest: handler,
    register() {},
    storage: { get: async () => null, set: async () => {} }
  })
  return { t: context, calls: [] }
}

// --- builtinCategoryIds --------------------------------------------------------

test('builtinCategoryIds returns the twelve pane shelves in display order', async () => {
  const t = await ctx()
  const ids = t.builtinCategoryIds()
  assert.equal(ids.length, 12)
  assert.equal(typeof ids[0], 'string')
  assert.equal(ids[0], 'persimmon')
  assert.equal(ids[11], 'neutral')
  // Join to compare as a plain string, avoiding VM prototype mismatches
  assert.equal(ids.join(','), 'persimmon,apricot,amber,gold,lemon,fern,teal,cobalt,indigo,violet,rose,neutral')
})

// --- effectiveCategory ---------------------------------------------------------

test('effectiveCategory: a non-empty assignment wins when it names a live category', async () => {
  const t = await ctx()
  const scene = { name: 'my-skin', category: 'indigo', lightColors: { ui_accent: '#ff0000' } }
  assert.equal(t.effectiveCategory(scene, []), 'indigo')
  assert.equal(t.effectiveCategory(scene, [{ id: 'custom', title: 'Custom', names: [] }]), 'indigo')
})

test('effectiveCategory: an assignment to a deleted category falls through to measured', async () => {
  const t = await ctx()
  const scene = { name: 'my-skin', category: 'deleted-cat', lightColors: { ui_accent: '#ff0000' } }
  // 'deleted-cat' is not a builtin and not in the user list → falls to sceneCategory
  const result = t.effectiveCategory(scene, [])
  assert.ok(t.builtinCategoryIds().includes(result), `fell to a builtin shelf, got ${result}`)
})

test('effectiveCategory: a user category names list claims a skin by exact name', async () => {
  const t = await ctx()
  const scene = { name: 'my-skin', lightColors: { ui_accent: '#ff0000' } }
  const cats = [{ id: 'custom', title: 'Custom', names: ['my-skin'] }]
  assert.equal(t.effectiveCategory(scene, cats), 'custom')
})

test('effectiveCategory: names matching is case-insensitive', async () => {
  const t = await ctx()
  const scene = { name: 'My-Skin', lightColors: { ui_accent: '#ff0000' } }
  const cats = [{ id: 'custom', title: 'Custom', names: ['my-skin'] }]
  assert.equal(t.effectiveCategory(scene, cats), 'custom')
})

test('effectiveCategory: measured floor when no assignment and no names match', async () => {
  const t = await ctx()
  const scene = { name: 'my-skin', lightColors: { ui_accent: '#ff0000' } }
  const cats = [{ id: 'custom', title: 'Custom', names: ['other-skin'] }]
  const result = t.effectiveCategory(scene, cats)
  assert.ok(t.builtinCategoryIds().includes(result), `fell to a builtin shelf, got ${result}`)
})

test('effectiveCategory: a scene with no name returns neutral', async () => {
  const t = await ctx()
  assert.equal(t.effectiveCategory(null, []), 'neutral')
  assert.equal(t.effectiveCategory({}, []), 'neutral')
})

// --- buildCategoryGroups / buildGroups -----------------------------------------

test('buildCategoryGroups: user shelves render AFTER the twelve builtins', async () => {
  const t = await ctx()
  const scenes = [
    { name: 'a', lightColors: { ui_accent: '#ff0000' } },
    { name: 'b', lightColors: { ui_accent: '#00ff00' } }
  ]
  const cats = [
    { id: 'zzz-custom', title: 'ZZZ Custom', names: ['a'] },
    { id: 'aaa-custom', title: 'AAA Custom', names: ['b'] }
  ]
  const groups = t.buildCategoryGroups(scenes, cats)
  // 12 builtins + 2 user = 14
  assert.equal(groups.length, 14)
  // First 12 are builtins (join to avoid VM prototype mismatches)
  const builtinIds = groups.slice(0, 12).map(g => g.id).join(',')
  assert.equal(builtinIds, 'persimmon,apricot,amber,gold,lemon,fern,teal,cobalt,indigo,violet,rose,neutral')
  // Last 2 are user categories, in the order they were declared
  assert.equal(groups[12].id, 'zzz-custom')
  assert.equal(groups[12].builtin, false)
  assert.equal(groups[13].id, 'aaa-custom')
  assert.equal(groups[13].builtin, false)
})

test('buildCategoryGroups: a skin assigned to a user category leaves its measured shelf', async () => {
  const t = await ctx()
  // 'ashes' measures into some family; assignment must move it out of that shelf
  const scenes = [{ name: 'ashes', lightColors: { ui_accent: '#8B4513' } }]
  const measured = t.effectiveCategory(scenes[0], [])
  const cats = [{ id: 'my-earth', title: 'My Earth', names: ['ashes'] }]
  const groups = t.buildCategoryGroups(scenes, cats)
  const shelf = groups.find(g => g.id === measured)
  assert.equal(shelf.scenes.length, 0, 'ashes left its measured shelf')
  // The user shelf should have it
  const myEarth = groups.find(g => g.id === 'my-earth')
  assert.equal(myEarth.scenes.length, 1)
  assert.equal(myEarth.scenes[0].name, 'ashes')
})

test('buildCategoryGroups: an empty user shelf is dropped by the caller', async () => {
  const t = await ctx()
  const scenes = [{ name: 'a', lightColors: { ui_accent: '#ff0000' } }]
  const cats = [{ id: 'empty-cat', title: 'Empty', names: [] }]
  const groups = t.buildCategoryGroups(scenes, cats)
  const emptyCat = groups.find(g => g.id === 'empty-cat')
  assert.ok(emptyCat, 'the user shelf exists')
  assert.equal(emptyCat.scenes.length, 0)
  // The caller filters: groups.filter(g => g.scenes.length)
  const rendered = groups.filter(g => g.scenes.length)
  assert.ok(!rendered.find(g => g.id === 'empty-cat'), 'empty shelf is dropped by the caller')
})

test('buildGroups: theme mode passes userCategories through', async () => {
  const t = await ctx()
  const scenes = [{ name: 'a', lightColors: { ui_accent: '#ff0000' } }]
  const cats = [{ id: 'custom', title: 'Custom', names: ['a'] }]
  const groups = t.buildGroups(scenes, 'theme', cats)
  assert.ok(groups.find(g => g.id === 'custom'), 'user shelf appears in theme mode')
})

test('buildGroups: non-theme mode ignores userCategories', async () => {
  const t = await ctx()
  const scenes = [{ name: 'a', lightColors: { ui_accent: '#ff0000' } }]
  const cats = [{ id: 'custom', title: 'Custom', names: ['a'] }]
  const groups = t.buildGroups(scenes, 'hue', cats)
  assert.ok(!groups.find(g => g.id === 'custom'), 'user shelf does not appear in hue mode')
})

test('buildCategoryGroups: backward compatible with no userCategories argument', async () => {
  const t = await ctx()
  const scenes = [{ name: 'a', lightColors: { ui_accent: '#ff0000' } }]
  const groups = t.buildCategoryGroups(scenes)
  assert.equal(groups.length, 12)
  assert.ok(groups.every(g => g.builtin === true))
})

// --- schemaCategoryDrift --------------------------------------------------------

test('schemaCategoryDrift: empty when backend and pane agree', async () => {
  const t = await ctx()
  const ids = t.builtinCategoryIds()
  assert.deepEqual(plain(t.schemaCategoryDrift(ids, t.THEME_CATEGORIES)), [])
})

test('schemaCategoryDrift: reports pane-only and backend-only ids', async () => {
  const t = await ctx()
  const backendIds = t.builtinCategoryIds().filter(id => id !== 'violet')
  const drift = t.schemaCategoryDrift(backendIds, t.THEME_CATEGORIES)
  assert.ok(drift.find(d => d.id === 'violet' && d.side === 'pane'), 'violet is pane-only')
  assert.equal(drift.length, 1)
})

test('schemaCategoryDrift: backend-only id is reported', async () => {
  const t = await ctx()
  const backendIds = t.builtinCategoryIds().concat(['extra-backend-cat'])
  const drift = t.schemaCategoryDrift(backendIds, t.THEME_CATEGORIES)
  assert.ok(drift.find(d => d.id === 'extra-backend-cat' && d.side === 'backend'), 'extra is backend-only')
})

test('schemaCategoryDriftNotice: null when no drift, warning when drift', async () => {
  const t = await ctx()
  assert.equal(t.schemaCategoryDriftNotice([]), null)
  assert.equal(t.schemaCategoryDriftNotice(null), null)
  const notice = t.schemaCategoryDriftNotice([{ id: 'violet', side: 'pane' }])
  assert.equal(notice.kind, 'warning')
  assert.equal(notice.title, 'Chroma category schema drift')
  assert.match(notice.message, /violet/)
  assert.match(notice.message, /pane/)
})

// --- categoryCreateFailure -----------------------------------------------------

test('categoryCreateFailure: 409 is a collision on the id field', async () => {
  const t = await ctx()
  const failure = t.categoryCreateFailure({ status: 409, message: 'already exists' })
  assert.equal(failure.kind, 'collision')
  assert.equal(failure.field, 'id')
  assert.equal(failure.status, 409)
  assert.match(failure.notice.message, /already exists/)
})

test('categoryCreateFailure: 400 is invalid input', async () => {
  const t = await ctx()
  const failure = t.categoryCreateFailure({ status: 400, message: 'bad id' })
  assert.equal(failure.kind, 'invalid')
  assert.equal(failure.field, 'id')
  assert.match(failure.notice.message, /bad id/)
})

test('categoryCreateFailure: other statuses are generic errors', async () => {
  const t = await ctx()
  const failure = t.categoryCreateFailure({ status: 500, message: 'boom' })
  assert.equal(failure.kind, 'error')
  assert.equal(failure.field, null)
  assert.match(failure.notice.message, /boom/)
})

test('categoryCreateFailure: no status is still an error', async () => {
  const t = await ctx()
  const failure = t.categoryCreateFailure(new Error('network'))
  assert.equal(failure.kind, 'error')
  assert.equal(failure.field, null)
})

// --- REST transport ------------------------------------------------------------

test('listCategories: GET /categories returns the parsed list', async () => {
  const { t, calls } = await withRest(async (path, options) => {
    calls.push({ path, options: options || {} })
    return { categories: [{ id: 'custom', title: 'Custom', order: 1, names: ['a'] }] }
  })
  const result = await t.listCategories()
  assert.equal(calls[0].path, 'categories')
  assert.equal(calls[0].options.method, undefined, 'GET is the default')
  assert.deepEqual(plain(result), [{ id: 'custom', title: 'Custom', order: 1, names: ['a'] }])
})

test('listCategories: a bare array envelope is accepted', async () => {
  const { t } = await withRest(async () => ([{ id: 'x', title: 'X', order: 0, names: null }]))
  const result = await t.listCategories()
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'x')
})

test('listCategories: a non-array envelope yields an empty list', async () => {
  const { t } = await withRest(async () => ({ error: 'not found' }))
  const result = await t.listCategories()
  assert.deepEqual(plain(result), [])
})

test('listCategories: a transport failure yields an empty list', async () => {
  const { t } = await withRest(async () => { throw new Error('no backend') })
  const result = await t.listCategories()
  assert.deepEqual(plain(result), [])
})

test('createCategory: POST /categories with id and title', async () => {
  const { t, calls } = await withRest(async (path, options) => {
    calls.push({ path, options })
    return { id: 'my-cat', title: 'My Cat' }
  })
  await t.createCategory('my-cat', 'My Cat')
  assert.equal(calls[0].path, 'categories')
  assert.equal(calls[0].options.method, 'POST')
  assert.deepEqual(plain(JSON.parse(calls[0].options.body)), { id: 'my-cat', title: 'My Cat' })
})

test('createCategory: throws when no backend', async () => {
  const t = await ctx()
  await assert.rejects(() => t.createCategory('x', 'X'), /backend/)
})

test('deleteCategory: DELETE /categories/{id}', async () => {
  const { t, calls } = await withRest(async (path, options) => {
    calls.push({ path, options })
    return {}
  })
  await t.deleteCategory('my-cat')
  assert.equal(calls[0].path, 'categories/my-cat')
  assert.equal(calls[0].options.method, 'DELETE')
})

test('deleteCategory: throws when no backend', async () => {
  const t = await ctx()
  await assert.rejects(() => t.deleteCategory('x'), /backend/)
})

test('putSkinCategory: PUT /skins/{name} with category field', async () => {
  const { t, calls } = await withRest(async (path, options) => {
    calls.push({ path, options })
    return { name: 'my-skin', category: 'indigo' }
  })
  await t.putSkinCategory('my-skin', 'indigo')
  assert.equal(calls[0].path, 'skins/my-skin')
  assert.equal(calls[0].options.method, 'PUT')
  assert.deepEqual(plain(JSON.parse(calls[0].options.body)), { category: 'indigo' })
})

test('putSkinCategory: empty string clears the assignment', async () => {
  const { t, calls } = await withRest(async (path, options) => {
    calls.push({ path, options })
    return { name: 'my-skin', category: '' }
  })
  await t.putSkinCategory('my-skin', '')
  assert.deepEqual(plain(JSON.parse(calls[0].options.body)), { category: '' })
})

test('putSkinCategory: throws when no backend', async () => {
  const t = await ctx()
  await assert.rejects(() => t.putSkinCategory('x', 'earth'), /backend/)
})
