# Chroma 2.6.0 — submission record

Cut 2026-10-19. This is the record for the plugin-catalogue submission: what
ships, what was proven, and what is knowingly accepted.

## What ships

- **94 skins**, one file each in `skins-v2/`. Every file carries a light palette,
  a dark palette, a colour family, a pack, a measured energy and a font choice.
- **30 core skins** on a fresh install. Six packs hold the rest: Earth (11),
  Cyberpunk (11), Zen (11), Retro (11), Noir (10), Studio (10).
- **Twelve colour families**, cut on measured gaps in the catalogue's own accent
  hues: Persimmon, Apricot, Amber, Gold, Lemon, Fern, Teal, Cobalt, Indigo,
  Violet, Rose, Neutral (`C < 0.04`).
- **188 gateway transports** — two per skin, mode-locked.
- **The editor**, categories, packs, import/export, and the Python gateway half.

The fifteen host built-ins that used to pad the picker are gone. They were
Hermes' own themes, they failed the signature-role check, and Hermes still lists
them in Appearance. Dropping them removed the entire missing-role defect class.

## What was proven

| Claim | Proof |
|---|---|
| The cutover moved no colour | 94 of 94 palettes byte-identical to the previous build; 0 digests changed in the parity fixture |
| Every skin has both modes | `scripts/check-packs.py` asserts a shell and an accent in both palettes |
| The pack contract holds | core exactly 30, every other pack 10–20, one pack and one family per skin, no empty family |
| The default is the promise | `tests/pack-default.test.mjs` — 30 on a fresh install, a missing pack list never opens the catalogue, a pack adds exactly its own skins |
| The generator is deterministic | a second run leaves `git status` clean |
| The catalogue is valid | `hermes plugins validate .` passes |

## Gates at cut

| Gate | Result |
|---|---|
| JS suite | 227 / 227, exit 0 |
| Backend suite | 163 passed |
| Generator suite | 16 passed, 4 skipped |
| `scripts/check-packs.py` | OK: contract holds |
| `hermes plugins validate .` | Validation passed |
| GitHub CI (`8e99e9e`) | success — 3-OS matrix + build-is-current |
| `rigour check --ci` | **24 violations, 28/100 — red** |

## Accepted, not silenced

`rigour check --ci` is red and this release does not claim otherwise. The
findings, and what each one actually is:

- **hallucinated-imports (CRITICAL, 2)** — the plugin imports
  `@hermes/plugin-sdk`, a host module resolved at runtime, not an npm
  dependency. The host's own reference plugins do the same.
- **promise-safety (HIGH, 7)** — the findings sit on host-API calls
  (`host.request`, `host.rest`) whose callers guard failures; no unguarded
  rejection reaches the render path.
- **file-guard (HIGH, 4)** — "Protected file was modified". This release edits
  `docs/**` on purpose. It is the guard working, not a defect.
- **phantom-apis (HIGH, 1)** — the reported `os.fdopen` site is a false positive.
- **inconsistent-error-handling (HIGH, 1)** — real but pre-existing in
  `dashboard/plugin_api.py`; not touched by this cutover.
- **context-window-artifacts (HIGH, 1)** — a doc-comment length rule firing on
  `scripts/analyse-palettes.py`.

The genuinely real code item is `stripJsonNoise` (cyclomatic complexity 16) in
`desktop/plugin.template.js`. It is pre-existing, self-contained, and belongs in
its own change rather than this submission.

The genuinely real item is `stripJsonNoise` (cyclomatic complexity 16) in
`desktop/plugin.template.js`. It is pre-existing, self-contained, and belongs in
its own change rather than this submission.

## Known limits

- **Five light palettes have low accent-on-shell contrast.** The `dark-pastel-*`
  skins were authored for dark mode; their derived light halves measure 1.41–2.05:1
  for the accent against the shell (`dark-pastel-buttercup`: `#EFD292` on
  `#FEFAF0`). This predates the cutover and is unchanged by it. It is a real
  readability defect in shipped skins and the next content pass should retune
  those five light halves.

- The **G15 acceptance walk** — install from the catalogue URL and click through
  the picker — has not been run on the Captain's machine. Until it is, the
  plugin is proven on this host only.
- No **2.x release tag** exists yet; tags stop at `v1.5.1`.
- Accessibility / ARIA (`C9`) is not started and is not claimed.
