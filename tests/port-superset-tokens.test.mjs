// What this file guards NOW.
//
// It used to prove a port: Chroma hand-painted Desktop's root tokens, so every
// token the host computed had to match bit for bit. That port is gone -- the
// Desktop ThemeProvider paints -- and a test of a deleted function proves nothing.
//
// What a user can still see is a contributed scene they cannot read. So the guard
// moved to the CONTRIBUTION: every scene Chroma publishes must clear WCAG AA for
// foreground on background in both halves. That is the data the provider paints
// from, so the assertion sits on the thing that ships.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './helpers/load-plugin.mjs'

/** WCAG 2.x relative luminance and contrast ratio, the spec's own formula. */
function wcagLuminance(hex) {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}

function wcagRatio(a, b) {
  const la = wcagLuminance(a)
  const lb = wcagLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

test('every contributed scene clears WCAG AA in BOTH halves', async () => {
  const { context } = await loadPlugin()
  const { SKINS, sceneToDesktopTheme } = context.testHelpers
  const failures = []

  for (const scene of SKINS) {
    const theme = sceneToDesktopTheme(scene)
    if (!theme) continue
    for (const [half, colors] of [['light', theme.colors], ['dark', theme.darkColors]]) {
      if (!colors || !colors.background || !colors.foreground) continue
      if (!/^#[0-9a-f]{6}$/i.test(colors.background) || !/^#[0-9a-f]{6}$/i.test(colors.foreground)) continue
      const ratio = wcagRatio(colors.background, colors.foreground)
      if (ratio < 4.5) failures.push(`${scene.name} ${half}: ${ratio.toFixed(2)}:1`)
    }
  }

  assert.deepEqual(failures, [], `scenes below WCAG AA: ${failures.join(', ')}`)
})

test('a scene application paints nothing: the provider owns every token', async () => {
  // The port this file used to prove is gone on purpose. Shelling to the shipped
  // build keeps the guard honest: it asserts the ABSENCE of the old painter in the
  // artefact the app loads, not merely in a source file a build step might skip.
  const { readFile } = await import('node:fs/promises')
  const shipped = await readFile(new URL('../chroma/desktop/plugin.js', import.meta.url), 'utf8')

  assert.ok(/function handThemeToProvider\(/.test(shipped),
    'the hand-off to Desktop ThemeProvider must exist')
  assert.ok(!/documentElement\.style\.setProperty/.test(shipped),
    'Chroma must never write root CSS tokens again: the provider paints them (context.tsx: applyTheme)')
  assert.ok(!/dataset\.hermesTheme\s*=/.test(shipped),
    'Chroma must never write the provider-owned theme attribute')
  assert.ok(!/dataset\.hermesMode\s*=/.test(shipped),
    'Chroma must never write the provider-owned mode attribute')
})
