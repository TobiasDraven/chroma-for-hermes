import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { importedNames, loadPlugin } from './helpers/load-plugin.mjs'

/**
 * The bug this test exists to stop.
 *
 * Both older harnesses hand-wrote a `useRef` and `useCallback` stub in their VM
 * context. The real app has no such global - those names can only arrive through
 * `import ... from 'react'`. So when F6 added `useRef` and F1 added `useCallback`
 * without adding them to the import, the page died on render while every suite
 * stayed green: the harness supplied what the import forgot.
 *
 * The shared loader therefore injects only what the SHIPPED file imports, so the
 * stub set cannot drift apart between test files. This file proves the build
 * boots, registers, and renders.
 */

test('the shipped build imports every hook it uses', async () => {
  const source = await readFile(new URL('../chroma/desktop/plugin.js', import.meta.url), 'utf8')
  const names = new Set(importedNames(source))
  for (const hook of ['useRef', 'useCallback', 'useState', 'useEffect', 'useMemo']) {
    assert.ok(names.has(hook), hook + ' is used by the picker but missing from the react import')
  }
})

test('the plugin registers and both render surfaces render', async () => {
  const { context } = await loadPlugin()
  const regs = []
  context.plugin.register({
    rest: async () => ({ skins: [] }),
    register(entry) { regs.push(entry) },
    storage: { get: async () => null, set: async () => {} }
  })

  assert.ok(regs.length >= 90, 'the catalog must still register its themes')

  const rendered = []
  for (const entry of regs) {
    if (typeof entry.render !== 'function') continue
    const node = entry.render()
    assert.ok(node, entry.id + ' rendered nothing')
    rendered.push(entry.id)
  }
  // Two surfaces render today: the full page (which mounts ThemePicker) and the
  // statusbar chip (which mounts ThemeChip). Asserted by id so a future surface
  // joining them does not silently weaken this.
  assert.deepEqual(rendered, ['chroma-page', 'chroma-chip'])
})

test('ThemeCard and ThemePicker component bodies execute', async () => {
  const { context } = await loadPlugin()
  const t = context.testHelpers
  const scene = {
    name: 'demo-theme', label: 'Demo', description: 'demo', modeSupport: 'dynamic',
    colors: { background: '#111111', ui_accent: '#ff0000' },
    lightColors: { background: '#111111' },
    darkColors: { background: '#111111' }
  }
  assert.doesNotThrow(() => t.ThemeCard({
    scene, mode: 'dark', active: null, applying: null, onApply() {},
    owned: false, managing: null, onDelete() {}, onRename() {}, onExport() {},
    previewTheme: null, clearThemePreview: null, localScope: false
  }), 'ThemeCard must resolve every identifier it references')
  assert.doesNotThrow(() => t.ThemePicker({}), 'ThemePicker must resolve every identifier it references')
  assert.doesNotThrow(() => t.ThemeChip({}), 'ThemeChip must resolve every identifier it references')
})
