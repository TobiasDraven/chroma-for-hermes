import { writeFile } from 'node:fs/promises'
import { loadPlugin } from './helpers/load-plugin.mjs'
import { CARD_CASES, BASE_CARD_PROPS, cardSpies, digestElement } from './helpers/card-cases.mjs'
const { context } = await loadPlugin()
const h = context.testHelpers
const plain = v => JSON.parse(JSON.stringify(v))
const out = {}
for (const [label] of Object.entries(CARD_CASES)) {
  out[label] = plain(digestElement(h.ThemeCard({ ...cardSpies(), ...BASE_CARD_PROPS, scene: CARD_CASES[label].scene })))
}
await writeFile(process.argv[2], JSON.stringify(out, null, 2) + '\n')
console.log('cases', Object.keys(out).length)
