/**
 * The pack control is a data-driven contract: the chips exist because the
 * catalogue stamps `pack` on every skin, and they must disappear again if the
 * data goes away — a filter over data that does not exist would hide cards.
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

/** The pack control is a row of chips; each title names its pack. */
function hasPackChips(tree) {
  let found = false
  walk(tree, node => {
    const props = node.props || node
    const type = node.type || props.type
    const title = node.title || props.title
    if (type !== 'button' || typeof title !== 'string') return
    // On: "Earth is on - click to hide it". Off: "Show the Earth pack (11 skins)".
    if (title.indexOf('Show the ') === 0 || title.indexOf('click to hide it') !== -1) found = true
  })
  return found
}

test('every shipped skin carries a pack, and the chips are visible', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const without = t.SKINS.filter(scene => !scene || !scene.pack)
  assert.equal(without.length, 0, `skins with no pack: ${without.map(s => s.name).join(', ')}`)
  assert.equal(hasPackChips(t.ThemePicker({})), true, 'the chips render over real pack data')
})

test('the chips follow the data: strip the packs and the control goes away', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const saved = t.SKINS.map(scene => scene.pack)
  try {
    for (const scene of t.SKINS) scene.pack = undefined
    assert.equal(hasPackChips(t.ThemePicker({})), false, 'no filter over data that does not exist')
  } finally {
    t.SKINS.forEach((scene, index) => { scene.pack = saved[index] })
  }
  assert.equal(hasPackChips(t.ThemePicker({})), true, 'the control returns with the data')
})

test('every pack in the catalogue is offered as a chip', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const packs = [...new Set(t.SKINS.map(scene => scene.pack))].filter(p => p && p !== 'core')
  const titles = []
  walk(t.ThemePicker({}), node => {
    const props = node.props || node
    const title = node.title || props.title
    if (typeof title === 'string' && title.indexOf('Show the ') === 0) titles.push(title)
  })
  for (const pack of packs) {
    assert.ok(titles.some(title => title.indexOf('the ' + pack) !== -1 || title.indexOf('the ' + pack[0].toUpperCase() + pack.slice(1)) !== -1),
      `no chip for the ${pack} pack`)
  }
})
