import assert from 'node:assert/strict'
import test from 'node:test'

import { loadPlugin } from './helpers/load-plugin.mjs'

/**
 * F3's testable half.
 *
 * The backend already exports YAML (73374d6). What the UI adds is the mapping
 * from that payload to the file the user actually receives, plus the save
 * action. `exportArtifact` is pure so both can be asserted without a DOM;
 * `saveTextFile` only runs against the renderer's anchor/blob path, which is
 * exercised in the app, not here.
 */

async function helpers() {
  const { context } = await loadPlugin()
  return context.testHelpers
}

test('a single skin exports as its own YAML, byte for byte', async () => {
  const t = await helpers()
  const payload = {
    ok: true, filename: 'nice-teal.yaml', count: 1,
    files: [{ name: 'nice-teal', yaml: 'name: nice-teal\ncolors:\n  background: "#001e26"\n' }]
  }
  const art = t.exportArtifact(payload)
  assert.equal(art.filename, 'nice-teal.yaml')
  assert.equal(art.text, payload.files[0].yaml, 'the YAML must pass through untouched so a round-trip holds')
})

test('a bulk export saves the backend bundle under its declared filename', async () => {
  const t = await helpers()
  const payload = {
    ok: true, filename: 'chroma-skins.json', count: 2,
    index: { a: { source: 'chroma' } },
    files: [{ name: 'a', yaml: 'name: a' }, { name: 'b', yaml: 'name: b' }]
  }
  const art = t.exportArtifact(payload)
  assert.equal(art.filename, 'chroma-skins.json')
  const parsed = JSON.parse(art.text)
  assert.equal(parsed.count, 2)
  assert.equal(parsed.files.length, 2, 'every owned skin must survive the export')
  assert.equal(parsed.files[1].yaml, 'name: b')
})

test('an empty or malformed payload fails loudly instead of writing a dead file', async () => {
  const t = await helpers()
  for (const bad of [null, {}, { files: [] }, { filename: 'x.yaml' }]) {
    assert.throws(() => t.exportArtifact(bad), /no files/, 'expected a throw for ' + JSON.stringify(bad))
  }
})

test('the bulk filename is never inferred from a single non-YAML file', async () => {
  const t = await helpers()
  // Two files must take the bundle path even though the first one is YAML-shaped.
  const art = t.exportArtifact({
    ok: true, filename: 'chroma-skins.json',
    files: [{ name: 'a', yaml: 'name: a' }, { name: 'b', yaml: 'name: b' }]
  })
  assert.equal(art.filename, 'chroma-skins.json')
  assert.doesNotThrow(() => JSON.parse(art.text))
})
