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

test('the pack filter is absent when no scene carries a pack', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  assert.equal(
    t.SKINS.some(scene => scene && scene.pack),
    false,
    'the shipped catalog carries no pack membership yet'
  )
  assert.doesNotThrow(() => t.ThemePicker({}))
  assert.equal(hasPackButton(t.ThemePicker({})), false, 'no filter over data that does not exist')
})

test('the pack filter appears as soon as a scene carries a pack', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  t.SKINS[0].pack = 'earth'
  assert.equal(hasPackButton(t.ThemePicker({})), true, 'the filter follows the data')
})
