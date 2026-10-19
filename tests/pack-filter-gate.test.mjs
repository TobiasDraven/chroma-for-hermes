/**
 * The pack control is a data-driven contract: the picker exists because the
 * catalogue stamps `pack` on every skin, and the entry point must disappear
 * again if the data goes away — a filter over data that does not exist would
 * hide cards.
 *
 * The chips moved out of the pane and into a modal; the rule did not change,
 * only where it is set. So the pane must OFFER the control, and the picker must
 * list every pack with its own count.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './helpers/load-plugin.mjs'

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  const children = node.children ?? (node.props && node.props.children)
  const list = Array.isArray(children) ? children : children ? [children] : []
  for (const child of list) walk(child, visit)
}

function hasPackEntry(tree) {
  let found = false
  walk(tree, node => {
    const props = node.props || node
    const type = node.type || props.type
    const title = node.title || props.title
    if (type !== 'button' || typeof title !== 'string') return
    if (title === 'Choose which theme packs the gallery shows') found = true
  })
  return found
}

/** Every string a node subtree renders, whichever field the harness keeps it in. */
function textsOf(node, acc = []) {
  if (!node || typeof node !== 'object') return acc
  const kids = node.children ?? (node.props && node.props.children)
  const list = Array.isArray(kids) ? kids : kids === undefined || kids === null ? [] : [kids]
  for (const child of list) {
    if (typeof child === 'string' || typeof child === 'number') acc.push(String(child))
    else textsOf(child, acc)
  }
  return acc
}

function packTotals(skins) {
  const totals = {}
  for (const scene of skins) {
    const id = (scene && scene.pack) || 'core'
    totals[id] = (totals[id] || 0) + 1
  }
  return totals
}

test('every shipped skin carries a pack, and the pane offers the control', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const without = t.SKINS.filter(scene => !scene || !scene.pack)
  assert.equal(without.length, 0, `skins with no pack: ${without.map(s => s.name).join(', ')}`)
  assert.equal(hasPackEntry(t.ThemePicker({})), true, 'the pane offers the pack control')
})

test('the entry point follows the data: strip the packs and the button goes away', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const saved = t.SKINS.map(scene => scene.pack)
  try {
    for (const scene of t.SKINS) scene.pack = undefined
    assert.equal(hasPackEntry(t.ThemePicker({})), false, 'no filter over data that does not exist')
  } finally {
    t.SKINS.forEach((scene, index) => { scene.pack = saved[index] })
  }
  assert.equal(hasPackEntry(t.ThemePicker({})), true, 'the control returns with the data')
})

test('every pack in the catalogue is offered in the picker, with its own count', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const totals = packTotals(t.SKINS)
  const packs = Object.keys(totals).filter(p => p !== 'core').sort()
  assert.ok(packs.length >= 6, 'the catalogue ships the six packs')

  const tree = t.PackPickerModal({
    packIds: packs,
    packTotals: totals,
    enabledPacks: [],
    hidden: 0,
    onToggle: () => {},
    onClose: () => {}
  })

  const rows = []
  walk(tree, node => {
    const props = node.props || node
    if ((node.type || props.type) !== 'button') return
    if (typeof props['aria-pressed'] !== 'string') return
    rows.push(props)
  })
  assert.equal(rows.length, packs.length, 'one row per pack, and no row for core')

  const texts = textsOf(tree)
  for (const pack of packs) {
    const title = pack.charAt(0).toUpperCase() + pack.slice(1)
    assert.ok(texts.includes(title), `the ${pack} pack is not named in the picker`)
  }
  for (const pack of packs) {
    assert.ok(texts.includes(String(totals[pack])), `the ${pack} count is not shown`)
  }
})

test('a pack row reports its state in more than colour', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const totals = { core: 30, earth: 11, zen: 11 }
  const tree = t.PackPickerModal({
    packIds: ['earth', 'zen'],
    packTotals: totals,
    enabledPacks: ['earth'],
    hidden: 53,
    onToggle: () => {},
    onClose: () => {}
  })
  const rows = []
  walk(tree, node => {
    const props = node.props || node
    if ((node.type || props.type) === 'button' && typeof props['aria-pressed'] === 'string') rows.push(props)
  })
  assert.equal(rows[0]['aria-pressed'], 'true')
  assert.equal(rows[1]['aria-pressed'], 'false')
  const onTexts = textsOf(rows[0])
  assert.ok(onTexts.includes('✓'), 'the on row carries a mark, not only a colour')

  const notes = textsOf(tree)
  assert.ok(notes.some(x => x.indexOf('53 skins hidden') !== -1), 'the picker reports what it hides')
})

test('the pack lens partitions the catalogue: every skin on exactly one shelf', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const groups = t.buildPackGroups(t.SKINS)
  const ids = groups.map(g => g.id)
  assert.equal(ids[0], 'core', 'core leads the shelves')
  assert.equal(new Set(ids).size, ids.length, 'no shelf appears twice')

  const seen = new Map()
  for (const group of groups) {
    for (const skin of group.scenes) {
      assert.equal(seen.has(skin.name), false, `${skin.name} is on two shelves`)
      seen.set(skin.name, group.id)
    }
  }
  assert.equal(seen.size, t.SKINS.length, 'every skin lands on a shelf')
  for (const group of groups) {
    assert.ok(group.scenes.length > 0, `the ${group.id} shelf renders empty`)
    assert.equal(typeof group.title, 'string')
  }
})
