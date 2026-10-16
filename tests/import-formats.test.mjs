import assert from 'node:assert/strict'
import test from 'node:test'

import { loadPlugin } from './helpers/load-plugin.mjs'

/**
 * F4 - the four import formats.
 *
 * Fixtures are shaped after the real files the research scout opened: the MS
 * Learn Campbell example for Windows Terminal, chriskempson/default-dark.yaml
 * and tinted-theming 0.11 for Base16, and a theme JSON in the shape VS Code's
 * own colorThemeSchema allows (comments and trailing commas are permitted, so
 * the parser must tolerate them).
 */

async function t() {
  const { context } = await loadPlugin()
  return context.testHelpers
}

// Campbell, as printed on the Windows Terminal colour-schemes page.
const CAMPBELL = {
  name: 'Campbell',
  cursorColor: '#FFFFFF',
  selectionBackground: '#FFFFFF',
  background: '#0C0C0C',
  foreground: '#CCCCCC',
  black: '#0C0C0C', red: '#C50F1F', green: '#13A10E', yellow: '#C19C00',
  blue: '#0037DA', purple: '#881798', cyan: '#3A96DD', white: '#CCCCCC',
  brightBlack: '#767676', brightRed: '#E74856', brightGreen: '#16C60C',
  brightYellow: '#F9F1A5', brightBlue: '#3B78FF', brightPurple: '#B4009E',
  brightCyan: '#61D6D6', brightWhite: '#F2F2F2'
}

const BASE16_LEGACY = [
  'scheme: "Default Dark"',
  'author: "Chris Kempson"',
  'base00: 181818',
  'base01: 282828',
  'base02: 383838',
  'base03: 585858',
  'base04: d8d8d8',
  'base05: d8d8d8',
  'base06: e8e8e8',
  'base07: f8f8f8',
  'base08: ab4642',
  'base0D: 7cafc2',
  ''
].join('\n')

const BASE16_MODERN = [
  'system: "base16"',
  'name: Default Light',
  'slug: default-light',
  'author: "Chris Kempson"',
  'variant: "light"',
  'palette:',
  '  base00: "#fafafa"',
  '  base03: "#8c8c8c"',
  '  base05: "#181818"',
  '  base06: "#282828"',
  '  base08: "#ac4142"',
  '  base0D: "#3a7ca5"',
  ''
].join('\n')

const VSCODE = [
  '{',
  '  // a comment VS Code accepts',
  '  "name": "My Workbench Theme",',
  '  "type": "dark",',
  '  "colors": {',
  '    "editor.background": "#1e1e1e",',
  '    "editor.foreground": "#d4d4d4",',
  '    "panel.border": "#3c3c3c",',
  '    "descriptionForeground": "#9d9d9d",',
  '    "button.background": "#0e639c",',
  '    "textLink.foreground": "#3794ff",',
  '    "errorForeground": "#f48771",',
  '  },',
  '  "tokenColors": []',
  '}'
].join('\n')

test('normHex reduces every colour form these formats carry to 6-digit hex', async () => {
  const h = await t()
  assert.equal(h.normHex('#0C0C0C'), '#0c0c0c', 'case is normalised')
  assert.equal(h.normHex('181818'), '#181818', 'Base16 ships bare hex without a hash')
  assert.equal(h.normHex('#abc'), '#aabbcc', '3-digit expands')
  assert.equal(h.normHex('#ABCD'), '#aabbcc', '4-digit expands and drops alpha')
  assert.equal(h.normHex('#1e1e1ecc'), '#1e1e1e', '8-digit drops alpha so the backend will not silently discard it later')
  assert.equal(h.normHex('rgb(1, 2, 3)'), null, 'css functional colour is not carried by these formats')
  assert.equal(h.normHex('not-a-colour'), null)
  assert.equal(h.normHex(undefined), null)
})

test('a Windows Terminal scheme maps its literal colours and guesses the rest', async () => {
  const theme = await t().then(h => h.parseImportedTheme(JSON.stringify(CAMPBELL)))
  assert.equal(theme.source, 'windows-terminal')
  assert.equal(theme.colors.background, '#0c0c0c')
  assert.equal(theme.colors.foreground, '#cccccc')
  assert.equal(theme.variant, 'dark', 'a near-black background is a dark scheme')
  // The format has no UI semantics: these are ANSI roles standing in for design
  // tokens, so they are asserted as the documented guesses they are.
  assert.equal(theme.colors.primary, '#0037da', 'ANSI blue')
  assert.equal(theme.colors.destructive, '#c50f1f', 'ANSI red')
  assert.equal(theme.colors.border, '#767676', 'ANSI bright black')
})

test('pasting a whole Windows Terminal settings file picks the selected scheme', async () => {
  const settings = {
    '$help': 'https://aka.ms/terminal-documentation',
    'defaultProfile': '{guid}',
    profiles: { defaults: { colorScheme: 'Campbell' } },
    schemes: [
      { name: 'One Half Dark', background: '#282C34', foreground: '#DCDFE4', blue: '#61AFEF', brightBlue: '#61AFEF', red: '#E06C75', brightBlack: '#5C6370' },
      { name: 'Campbell', background: '#0C0C0C', foreground: '#CCCCCC', blue: '#0037DA', brightBlue: '#3B78FF', red: '#C50F1F', brightBlack: '#767676' }
    ]
  }
  const theme = await t().then(h => h.parseImportedTheme(JSON.stringify(settings)))
  assert.equal(theme.label, 'Campbell', 'profiles.defaults.colorScheme names the one the user is actually running')
  assert.equal(theme.colors.background, '#0c0c0c')
})

test('an unselected multi-scheme settings file falls back to its first scheme', async () => {
  const settings = { schemes: [CAMPBELL, Object.assign({}, CAMPBELL, { name: 'Other' })] }
  const theme = await t().then(h => h.parseImportedTheme(JSON.stringify(settings)))
  assert.equal(theme.label, 'Campbell')
})

test('Base16 legacy flat file parses, with no hash and no variant marker', async () => {
  const theme = await t().then(h => h.parseImportedTheme(BASE16_LEGACY))
  assert.equal(theme.source, 'base16')
  assert.equal(theme.label, 'Default Dark')
  assert.equal(theme.colors.background, '#181818')
  assert.equal(theme.colors.foreground, '#d8d8d8')
  assert.equal(theme.colors.destructive, '#ab4642', 'base08 is the red slot by convention')
  assert.equal(theme.colors.primary, '#7cafc2', 'base0D is the blue slot by convention')
  assert.equal(theme.variant, 'dark', 'without a variant marker the spec defines detection by luminance')
})

test('Tinted 0.11 nested palette parses and honours its explicit variant', async () => {
  const theme = await t().then(h => h.parseImportedTheme(BASE16_MODERN))
  assert.equal(theme.variant, 'light', 'an explicit variant must win over a luminance guess')
  assert.equal(theme.colors.background, '#fafafa')
  assert.equal(theme.colors.foreground, '#181818')
  assert.equal(theme.colors.destructive, '#ac4142')
})

test('a VS Code theme parses despite comments and trailing commas', async () => {
  const theme = await t().then(h => h.parseImportedTheme(VSCODE))
  assert.equal(theme.source, 'vscode')
  assert.equal(theme.label, 'My Workbench Theme')
  assert.equal(theme.colors.background, '#1e1e1e')
  assert.equal(theme.colors.foreground, '#d4d4d4')
  assert.equal(theme.colors.destructive, '#f48771', 'errorForeground is a real error colour, unlike the ANSI guesses')
  assert.equal(theme.colors.border, '#3c3c3c')
  assert.equal(theme.variant, 'dark', '"type": "dark" is authoritative')
})

test('a syntax-only VS Code theme is refused rather than imported empty', async () => {
  const h = await t()
  // A syntax-only theme has no workbench block at all - the common marketplace case.
  // async arrows: parseImportedTheme throws synchronously, and assert.rejects
  // only catches a returned promise.
  const noWorkbench = JSON.stringify({ name: 'x', uiTheme: 'vs-dark', tokenColors: [] })
  await assert.rejects(
    async () => h.parseImportedTheme(noWorkbench),
    /no workbench colors found/,
    'many marketplace themes ship tokenColors only; the backend would have filled background with #000000'
  )
  // A colors block that exists but carries no editor colours is refused too,
  // and the message must name what was actually missing.
  const emptyWorkbench = JSON.stringify({ name: 'y', type: 'dark', colors: {}, tokenColors: [] })
  await assert.rejects(
    async () => h.parseImportedTheme(emptyWorkbench),
    /no editor\.background and editor\.foreground/
  )
})

test('iTerm2 is recognised and refused, not half-read', async () => {
  const plist = '<?xml version="1.0"?><plist version="1.0"><dict><key>Background Color</key><dict><key>Red Component</key><real>0.1</real></dict></dict></plist>'
  await assert.rejects(
    () => t().then(h => h.parseImportedTheme(plist)),
    /iTerm2 \.itermcolors is not supported yet/,
    'silently returning null would tell the user their file was empty'
  )
})

test('unrecognised text fails with a message that names the accepted formats', async () => {
  await assert.rejects(
    () => t().then(h => h.parseImportedTheme('just some words')),
    /could not recognise this as/
  )
  await assert.rejects(() => t().then(h => h.parseImportedTheme('')), /nothing to import/)
})

test('every accepted format delivers the shape the existing backend writer consumes', async () => {
  const h = await t()
  const inputs = [
    JSON.stringify(CAMPBELL),
    BASE16_LEGACY,
    BASE16_MODERN,
    VSCODE
  ]
  const REQUIRED = ['background', 'foreground', 'primary', 'accent', 'border', 'muted', 'cardForeground', 'destructive']
  for (const input of inputs) {
    const theme = h.parseImportedTheme(input)
    assert.ok(theme.name && /^[a-z0-9-]+$/.test(theme.name), 'name must be a slug the backend accepts')
    assert.ok(['light', 'dark'].includes(theme.variant), 'variant must be one the picker reports')
    for (const key of REQUIRED) {
      assert.match(theme.colors[key], /^#[0-9a-f]{6}$/, theme.source + ' must deliver ' + key + ' as #rrggbb, got ' + theme.colors[key])
      assert.match(theme.darkColors[key], /^#[0-9a-f]{6}$/)
    }
  }
})
