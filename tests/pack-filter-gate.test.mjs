/**
 * The pack filter is a build-time contract: it may only appear once the catalog
 * actually stamps `pack` on its scenes. Shipping the button against a catalog
 * with no pack data would hide every card whose pack is unknown, so the pane
 * keeps it out until the pack campaign fills the model.
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

function hasPackButton(tree) {
  let found = false
  walk(tree, node => {
    const children = node.children ?? (node.props && node.props.children)
    if (children === 'Enable packs' || children === 'All packs') found = true
  })
  return found
}

test('every shipped skin carries a pack, and the filter is visible', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const without = t.SKINS.filter(scene => !scene || !scene.pack)
  assert.equal(without.length, 0, `skins with no pack: ${without.map(s => s.name).join(', ')}`)
  assert.equal(hasPackButton(t.ThemePicker({})), true, 'the filter renders over real pack data')
})

test('the filter follows the data: strip the packs and the control goes away', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const saved = t.SKINS.map(scene => scene.pack)
  try {
    for (const scene of t.SKINS) scene.pack = undefined
    assert.equal(hasPackButton(t.ThemePicker({})), false, 'no filter over data that does not exist')
  } finally {
    t.SKINS.forEach((scene, index) => { scene.pack = saved[index] })
  }
  assert.equal(hasPackButton(t.ThemePicker({})), true, 'the control returns with the data')
})
