// Hand-built skins covering the paths a catalog scene may not reach: no seeds at
// all, a black surface seed, a light text seed, an unreadable seed, junk values,
// and 3-digit shorthand hex. Shared by the parity test and its fixture generator,
// so the two can never drift apart.
export const EDGE_SKINS = [
  { name: 'edge-none', colors: {} },
  { name: 'edge-black', colors: { background: '#000000' } },
  { name: 'edge-lighttext', colors: { ui_text: '#f0f0f0' } },
  { name: 'edge-darktext', colors: { ui_text: '#101010' } },
  {
    name: 'edge-full',
    colors: {
      background: '#123456', ui_text: '#eeeeee', ui_accent: '#ff00ff', ui_border: '#333333',
      banner_dim: '#999999', ui_error: '#aa0000', completion_menu_bg: '#222222'
    }
  },
  { name: 'edge-junk', colors: { background: 'not-a-color', ui_text: '#zzz', ui_accent: 42 } },
  { name: 'edge-shorthand', colors: { background: '#abc', ui_text: '#fff' } }
]

// The full palettes kept verbatim in the fixture, for key-level diagnosis when a
// digest moves. The rest of the set is digests only, to keep the fixture small.
export const GOLDEN_EDGES = ['edge-full', 'edge-lighttext']
export const GOLDEN_SCENES = ['nous', 'mono', 'ember']
