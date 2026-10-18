import assert from 'node:assert/strict'
import test from 'node:test'

import { loadPlugin } from './helpers/load-plugin.mjs'
import { digestElement, textsIn } from './helpers/card-cases.mjs'

/**
 * E2 + E3 — the duplicate action, and the pack surface (plan §5, §7, §18.3).
 *
 * Two things this file exists to stop:
 *   - a fork that throws on a 409 and takes the user's colours with it. A name
 *     collision is a FIELD-level complaint: the modal stays open, the draft is
 *     untouched, and the user picks the name.
 *   - a pack UI that lies. A pack whose members were individually deleted must
 *     SAY so, an import must preview before it writes, and the export filename
 *     must be the pack's slug.
 *
 * The pure builders are function declarations, so they land on the vm global
 * this harness executes; nothing here is stubbed by hand (the loader's rule).
 */

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

// Values built inside the vm context carry that realm's prototypes, and
// node:assert/strict compares prototypes. Round-trip through JSON.
const plain = value => (value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)))

// A role-keyed draft, the shape the editor holds: one value per EDITOR_ROLES id.
const draft = () => ({ light: { shell: '#101010', signature: '#aa00cc' }, dark: { shell: '#000000' } })

// A valid bundle, the shape §7 pins.
const bundle = () => ({
  chroma_pack: 1,
  name: 'earth-pack',
  author: 'Faris',
  created: '2026-10-18T00:00:00Z',
  categories: [],
  skins: [
    { name: 'ashes', label: 'Ashes', light: { background: '#101010' }, dark: { background: '#000000' } },
    { name: 'moss', label: 'Moss', light: { background: '#0a1a0a' }, dark: { background: '#001000' } }
  ]
})

// --- E2: the duplicate action -------------------------------------------------

test('the duplicate body carries concrete skin keys and a defaulted label', async () => {
  const t = await ctx()
  const body = t.duplicateBody(draft(), 'ocean-skin-copy', '', null, 'Ocean Skin', 'ocean-skin')
  assert.deepEqual(plain(body), {
    to: 'ocean-skin-copy',
    label: 'Ocean Skin copy',
    // shell -> background, signature -> ui_accent: the primary key per role.
    light: { background: '#101010', ui_accent: '#aa00cc' },
    dark: { background: '#000000' }
  })

  // A given label is respected verbatim (trimmed).
  const named = t.duplicateBody(draft(), 'x-copy', '  My Copy  ', null, 'Ocean Skin', 'ocean-skin')
  assert.equal(named.label, 'My Copy')

  // The pre-filled fork name is always a slug.
  assert.equal(t.duplicateSlug('Ocean Skin'), 'ocean-skin-copy')
  assert.equal(t.duplicateSlug(''), 'skin-copy')
  assert.equal(t.isSlug('ocean-skin-copy'), true)
  assert.equal(t.isSlug('Ocean Skin'), false)
  assert.equal(t.isSlug('a--b'), false, 'a slug the backend would collapse is refused')
  assert.equal(t.isSlug('a-b'), true)
  assert.equal(t.isSlug('-x'), false)
})

test('a 409 from duplicate is a field-level collision, not a thrown crash', async () => {
  const t = await ctx()
  const conflict = t.duplicateFailure({ status: 409, message: 'a skin named ocean-skin-copy already exists' })
  assert.equal(conflict.kind, 'collision')
  assert.equal(conflict.field, 'to', 'the collision lands on the name field')
  assert.equal(conflict.status, 409)
  assert.equal(conflict.notice.kind, 'warning')
  assert.match(conflict.notice.detail, /colours are untouched/i)
  assert.match(conflict.message, /already exists/)

  const bad = t.duplicateFailure({ status: 400, message: 'unknown role: nope' })
  assert.equal(bad.kind, 'invalid')
  assert.equal(bad.field, 'to')
  assert.match(bad.notice.message, /unknown role: nope/)

  const other = t.duplicateFailure({ status: 500, message: 'boom' })
  assert.equal(other.kind, 'error')
  assert.equal(other.field, null)
  assert.match(other.notice.message, /boom/)
})

test('duplicateSkin posts the exact body through the rest transport', async () => {
  const { t, calls } = await withRest(async (path, options) => { calls.push({ path, options }); return { ok: true, name: 'ocean-skin-copy', path: 'x' } })
  const body = t.duplicateBody(draft(), 'ocean-skin-copy', '', null, 'Ocean Skin', 'ocean-skin')
  await t.duplicateSkin(body.to, body.label, body.light, body.dark)
  assert.equal(calls[0].path, 'skins/duplicate')
  assert.equal(calls[0].options.method, 'POST')
  assert.deepEqual(plain(JSON.parse(calls[0].options.body)), {
    to: 'ocean-skin-copy', label: 'Ocean Skin copy',
    light: { background: '#101010', ui_accent: '#aa00cc' }, dark: { background: '#000000' }
  })

  // A pane with no backend cannot fork either.
  const bare = await ctx()
  await assert.rejects(() => bare.duplicateSkin('x-copy', 'X copy', {}, {}))
})

// --- E3: the bundle, its filename, and the missing-member warning -------------

test('the bundle builder pins the §7 document shape', async () => {
  const t = await ctx()
  const doc = t.packBundle('earth-pack', bundle().skins, { author: 'Faris', created: '2026-10-18T00:00:00Z' })
  assert.equal(doc.chroma_pack, 1)
  assert.equal(doc.name, 'earth-pack')
  assert.equal(doc.author, 'Faris')
  assert.deepEqual(plain(doc.categories), [], 'categories default to an empty array, never undefined')
  assert.equal(doc.skins.length, 2)

  // The export body the pane sends carries a name, the members and an author.
  assert.deepEqual(plain(t.packExportBody(' earth-pack ', ['ashes', '', 'moss'], 'Faris')), {
    name: 'earth-pack', members: ['ashes', 'moss'], author: 'Faris'
  })
})

test('the export filename is the pack slug plus .json', async () => {
  const t = await ctx()
  assert.equal(t.packFilename('Earth Pack'), 'earth-pack.json')
  assert.equal(t.packArtifact(bundle()).filename, 'earth-pack.json')
  assert.match(t.packArtifact(bundle()).text, /"chroma_pack": 1/)
  assert.throws(() => t.packArtifact(null), /no bundle/)
  assert.throws(() => t.packArtifact({ skins: [] }), /no bundle/)
})

test('a pack that lost members says so instead of rendering as whole', async () => {
  const t = await ctx()
  const whole = { name: 'Earth', slug: 'earth', memberCount: 3, members: ['a', 'b', 'c'], missing: [] }
  const broken = { name: 'Earth', slug: 'earth', memberCount: 3, members: ['a', 'b'], missing: ['ashes'] }

  assert.deepEqual(plain(t.packMissing(whole)), [])
  assert.equal(t.packMissingNotice(whole), null)
  assert.equal(t.packMemberSummary(whole), '3 skins')

  assert.deepEqual(plain(t.packMissing(broken)), ['ashes'])
  assert.equal(t.packMemberSummary(broken), '2 of 3 skins present — 1 missing')
  const notice = t.packMissingNotice(broken)
  assert.equal(notice.kind, 'warning')
  assert.match(notice.message, /ashes/)

  // The row RENDERS the warning: the counts and the word "missing" are in the tree.
  const rendered = t.PackRow({ pack: broken, busy: null, onExport() {}, onDelete() {} })
  const text = textsIn(digestElement(rendered)).join(' ')
  assert.match(text, /Earth/)
  assert.match(text, /2 of 3 skins present/)
  assert.match(text, /1 missing/)

  // A whole pack renders its count and NO warning word.
  const wholeText = textsIn(digestElement(t.PackRow({ pack: whole, busy: null, onExport() {}, onDelete() {} }))).join(' ')
  assert.match(wholeText, /3 skins/)
  assert.doesNotMatch(wholeText, /missing/)
})

// --- E3: import — preview, then write ----------------------------------------

test('the import preview groups new / identical / collides', async () => {
  const t = await ctx()
  const groups = t.groupImportPlan({ plan: [
    { name: 'ashes', status: 'new' },
    { name: 'moss', status: 'identical' },
    { name: 'fern', status: 'collides', to: 'fern-2' },
    { name: 'weird', status: 'something-else' }
  ] })
  assert.deepEqual(plain(groups.new.map(r => r.name)), ['ashes', 'weird'], 'an unknown status is treated as new')
  assert.deepEqual(plain(groups.identical.map(r => r.name)), ['moss'])
  assert.deepEqual(plain(groups.collides.map(r => r.name)), ['fern'])
  assert.equal(groups.collides[0].to, 'fern-2')

  const summary = t.packImportSummary(groups)
  assert.deepEqual(plain(summary), { total: 4, isNew: 2, identical: 1, collides: 1 })
})

test('a rename choice lands in the applied payload; a skip drops the skin', async () => {
  const t = await ctx()
  const choices = { moss: { action: 'rename', to: 'moss-green' }, ashes: { action: 'skip' } }
  const applied = t.applyPackChoices(bundle(), choices)
  const names = plain(applied.bundle.skins.map(s => s.name))
  assert.deepEqual(names, ['moss-green'], 'ashes was skipped, moss renamed')
  assert.deepEqual(plain(applied.skipped), ['ashes'])

  // With no choices at all, every skin is written as it stands.
  const untouched = t.applyPackChoices(bundle(), {})
  assert.deepEqual(plain(untouched.bundle.skins.map(s => s.name)), ['ashes', 'moss'])
})

test('requestPackImport sends dryRun, and the applied notice reports what happened', async () => {
  const { t, calls } = await withRest(async (path, options) => { calls.push({ path, options }); return { ok: true, applied: [{ name: 'ashes' }], skipped: ['moss'] } })
  await t.requestPackImport(bundle(), true)
  assert.equal(calls[0].path, 'packs/import')
  assert.equal(JSON.parse(calls[0].options.body).dryRun, true, 'the preview is a dry run')
  await t.requestPackImport(bundle(), false)
  assert.equal(JSON.parse(calls[1].options.body).dryRun, false, 'confirming is a real write')

  const t2 = await ctx()
  const notice = t2.packImportNotice({ applied: [{ name: 'ashes' }], skipped: ['moss'] })
  assert.equal(notice.kind, 'success')
  assert.match(notice.message, /1 skin\(s\) written, 1 skipped/)
  assert.match(notice.detail, /moss/)
})

test('a malformed bundle produces a readable error path, never a stack trace', async () => {
  const t = await ctx()
  const cases = [
    ['not json at all', /not valid JSON/i],
    ['[]', /JSON object, not an array/i],
    ['{"chroma_pack": 2}', /chroma_pack must be 1/i],
    ['{"chroma_pack": 1}', /no pack name/i],
    ['{"chroma_pack": 1, "name": "Not A Slug"}', /is not a slug/i],
    ['{"chroma_pack": 1, "name": "ok"}', /no skins array/i],
    ['{"chroma_pack": 1, "name": "ok", "skins": [{"name": "NotASlug"}]}', /is not a slug/i],
    ['{"chroma_pack": 1, "name": "ok", "skins": [{"name": "child", "light": {"background": "blue"}}]}', /not #rrggbb/i]
  ]
  for (const [text, re] of cases) {
    const parsed = t.parsePackBundle(text)
    assert.equal(parsed.ok, false, 'expected a refusal for ' + text)
    assert.equal(typeof parsed.error, 'string', 'the error is a message, not an exception')
    assert.match(parsed.error, re)
  }

  // A good bundle parses, and categories default to [] rather than vanishing.
  const good = t.parsePackBundle(JSON.stringify({ chroma_pack: 1, name: 'ok', skins: [] }))
  assert.equal(good.ok, true)
  assert.deepEqual(plain(good.bundle.categories), [])
})

// --- E3: delete — record only vs record + skins ------------------------------

test('the delete confirmation names both choices, and the route passes withSkins', async () => {
  const t = await ctx()
  const recordOnly = t.packDeleteNotice({ name: 'Earth', slug: 'earth' }, false)
  assert.equal(recordOnly.withSkins, false)
  assert.match(recordOnly.title, /record\?/)
  assert.match(recordOnly.message, /skins themselves stay/)
  assert.equal(recordOnly.confirm, 'Delete record')

  const withSkins = t.packDeleteNotice({ name: 'Earth', slug: 'earth' }, true)
  assert.equal(withSkins.withSkins, true)
  assert.match(withSkins.title, /AND its skins/)
  assert.equal(withSkins.confirm, 'Delete pack + skins')

  const { t: wired, calls } = await withRest(async (path, options) => { calls.push({ path, options }); return { ok: true, removedSkins: [] } })
  await wired.dropPack('earth', false)
  assert.equal(calls[0].path, 'packs/earth?withSkins=false')
  assert.equal(calls[0].options.method, 'DELETE')
  await wired.dropPack('earth', true)
  assert.equal(calls[1].path, 'packs/earth?withSkins=true')
})

test('listPacks tolerates the envelope and never crashes on a bad answer', async () => {
  const ok = await withRest(async () => ({ packs: [{ slug: 'earth', name: 'Earth' }] }))
  assert.equal((await ok.t.listPacks()).length, 1)

  const bare = await withRest(async () => [{ slug: 'x' }])
  assert.equal((await bare.t.listPacks()).length, 1, 'a bare array is accepted')

  const junk = await withRest(async () => ({ nope: true }))
  assert.deepEqual(plain(await junk.t.listPacks()), [], 'anything else means "no packs"')

  const noBackend = await ctx()
  assert.deepEqual(plain(await noBackend.listPacks()), [])
})
