# Submitting Chroma to the Hermes plugin catalog

Status: **prepared, not submitted.** This file is the record of what the catalog
asks for and where we stand against it. It is not a substitute for the
authoritative rules.

Authoritative sources (checked 2026-10-19):

- `NousResearch/hermes-agent` → `plugin-catalog/README.md` — the 17 admission
  rules and the entry schema. CI fails if the docs copy drifts from it.
- `website/docs/developer-guide/plugins/catalog-submission.md` — the step-by-step
  guide and what reviewers look at.

## The entry

The catalog is a directory of YAML files, one per plugin, admitted only by a
human-reviewed PR to `NousResearch/hermes-agent`. There is no self-serve
registry and no file in this repository that lists us.

The entry we will open a PR with:

```yaml
name: chroma
repo: https://github.com/TobiasDraven/chroma-for-hermes
sha: 711858b4bfdd1a16d76d5bd96f813da64aef12ba
description: >-
  Browse, import and apply Hermes skins from the Desktop, including TweakCN
  imports that mint real gateway skins so the CLI and every connected Desktop
  follow the change.
maintainer: TobiasDraven
tier: community
category: desktop
version: "2.8.0"
requires_hermes: ">=0.22.0"
readme: true
capabilities:
  provides_tools: []
  provides_hooks: []
  provides_middleware: []
  requires_env: []
```

Rules that shape those values:

- `sha` is a **full 40-character commit**. Branches, tags and short SHAs are
  rejected by the loader. Generate it at submission time with
  `git rev-parse HEAD` — never copy a SHA from an earlier session.
- `tier` is `community`. Only Nous maintainers set `official` or `verified`; a
  contributor PR that sets either is changed in review.
- `version` is cosmetic but must match the pinned code. Bump it in the same PR
  that bumps the SHA.
- `requires_hermes` is a SemVer floor and must not be newer than the current
  release. `>=0.22.0` is what we have proven; the plugin has only been walked
  on 0.22.2.
- `capabilities` must match what the plugin actually registers. Chroma registers
  a Desktop pane and a dashboard router: no tools, no hooks, no middleware, no
  environment variables. An empty list here is a claim, and capability creep is
  treated as a security issue.
- `image` and `screenshots` are optional and must be `https` on a GitHub host,
  pinned to the entry's commit. We ship neither today. The README renders as the
  plugin page at `/docs/plugins/chroma`.

## Admission rules — where we stand

| # | Rule | Evidence |
|---|---|---|
| 1 | Human-merged PR only | n/a — the submission act |
| 2 | Full 40-char SHA pin | generated at submission |
| 3 | No self-updating code | no fetcher, no remote `plugin.js`, no update check; the only network call is the TweakCN import |
| 4 | SHA bumps are new PRs | process |
| 5 | Owner or major contributor submits | repo owner: TobiasDraven |
| 6 | Declared capabilities match reality | `hermes plugins validate .` → `loadable — entry: desktop/plugin.js`, `built-in tool collisions — no tools to check` |
| 7 | Install scanner runs at admission | `hermes plugins validate .` → `security scan — safe`, `Validation passed` |
| 8 | Desktop plugins stay inside the SDK surface | `hermes plugins validate .` → `desktop surface — stays inside the plugin SDK surface` |
| 9 | No runtime overrides of Hermes core | `hermes plugins validate .` → `no core override — no runtime rebinds of Hermes core` |
| 10 | Dependency security policy | no Python dependencies declared (`python dependencies — none declared`) |
| 11 | Credentials come through Hermes | the plugin reads no credential store and declares no `requires_env` |
| 12 | Approvals and unattended runs respected | the plugin spawns no shell and no child process |
| 13 | Risky behaviour is disclosed | README §"What it touches" — one HTTPS GET to tweakcn.com on import; local-storage keys; skin YAML writes under the Hermes home |
| 14 | Compatibility metadata is truthful | `version` 2.8.0 in five places; `requires_hermes: ">=0.22.0"` |
| 15 | No skins or forks of bundled plugins | Chroma is a standalone plugin, not a restyled bundled one; the 94 skins were scrubbed of the host's own built-ins in 2.6.0 |
| 16 | One listing per plugin lineage | checked all 690 catalog entries: no `theme-picker`, no `chroma`. The upstream fork is **not** listed, so we do not compete with a listed entry — the PR will still say "Derived from jdtimothy/hermes-theme-picker (MIT)" |
| 17 | No unscannable executable payloads | plain source only: `.js`, `.py`, `.yaml`, `.md`. No binaries, no `.pyc`, no archives |

## PR description draft

> **Chroma — a skin browser, editor and gateway-skin factory for the Desktop.**
>
> Adds a Desktop pane that lists 94 bundled skins (each with a light and a dark
> palette, a mono and a sans stack), lets the user edit and save overrides, and
> applies a choice through `config.set('skin', …)` so the CLI and connected
> desktops follow. Thirty skins are shown by default; the other 64 live behind
> six opt-in theme packs. A TweakCN preset can be imported and minted as a real
> gateway skin.
>
> **Surfaces:** Desktop pane (`desktop/plugin.js`), dashboard router
> (`dashboard/plugin_api.py`, mounted from `dashboard/manifest.json`). No tools,
> no hooks, no middleware, no environment variables.
>
> **Disclosure:** importing a TweakCN preset makes one HTTPS `GET` to
> `https://tweakcn.com/r/themes/<name>`. The plugin writes its own keys in
> Desktop local storage and, through its backend, skin YAML plus a
> `skins/.chroma/` index under the Hermes home. It reads no credential store, no
> browser profile, and runs no shell command. No telemetry.
>
> **Lineage:** derived from jdtimothy/hermes-theme-picker (MIT). The palettes
> are the upstream authors' MIT work; see `THIRD_PARTY_NOTICES.md`.
>
> **Evidence:** `hermes plugins validate .` passes every check including
> `security scan — safe`; 228 JS tests, 179 backend tests, 16 generator tests and
> the catalogue contract gate are green; the build is reproducible from a clean
> checkout (byte-identical `plugin.js` and 188 transports).

## Procedure

1. Finish the acceptance walk on the target machine. Tag nothing before it.
2. `git rev-parse HEAD` → the pin. Confirm the tree is clean and CI is green on
   that exact commit.
3. Fork `NousResearch/hermes-agent`; add `plugin-catalog/chroma.yaml` with the
   entry above and the real SHA.
4. Open the PR with the description above. Expect a reviewer to read the pinned
   commit range and re-run the scanner.
5. After merge: `hermes plugins install chroma`. Later updates are SHA-bump PRs,
   never a self-update.

## What would get us declined

- A self-updater. We have none, and must never add one to this tree.
- Declaring a capability we do not register, or registering one we did not
  declare.
- Querying the app's own markup (`data-slot`, `data-testid`, …) to restyle core
  UI, or patching a core function. The pane draws only its own surface.
- A pin that moves after review. The SHA is the trust model.
