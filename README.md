# Chroma for Hermes

A theme picker plugin for [Hermes Desktop](https://github.com/NousResearch/hermes), and a hard fork of
[jdtimothy/hermes-theme-picker](https://github.com/jdtimothy/hermes-theme-picker) (MIT).

Skins ship with light and dark palettes; they are grouped into packs, and the picker supports
import and export of TweakCN presets and VS Code themes.

## Install

Hermes Desktop → **Capabilities** → **Plugins** → **Install**, then paste:

```
https://github.com/TobiasDraven/chroma-for-hermes/chroma
```

The plugin package is the `chroma/` subdirectory of this repository. The catalog installs that
subdirectory and the host sparse-clones only it, so the rest of this repo is not shipped.

## Repository layout

```
chroma/                    the shipped plugin package (what the catalog installs)
  plugin.yaml              manifest: id, version, entry points
  __init__.py              agent-plugin entry point
  README.md                this file's user-facing sibling
  LICENSE
  THIRD_PARTY_NOTICES.md   MIT credits for every idea copied from another project
  desktop/
    plugin.template.js     SOURCE OF TRUTH: the whole renderer plugin
    plugin.js              GENERATED from the template — never edit by hand
  dashboard/
    plugin_api.py          FastAPI backend: skins, import, export, trash
    manifest.json           the backend half's manifest
  install/                 platform installers for the plugin and its gateway transports
skins-v2/                  the catalogue: one file per skin, both palettes (a build input)
gateway-skins/             mode-locked transports, generated from the catalogue (a build output)
scripts/                   regenerate, package checks, analysis
tests/                     node:test suites + helpers; fixtures/ holds pinned parity data
docs/                      SPEC, ARCH, DECISIONS, TASKS, plans
VERSION                   version, mirrored into plugin.yaml
CHANGELOG.md
AGENTS.md                  the working contract for agents in this repository
DELEGATEDAGENTS.md         the operational handbook, edited freely
rigour.yml                quality gates; committed; never tuned to make a check pass
```

## Development

```bash
python scripts/regenerate.py                              # after EVERY edit to the template
"/c/Program Files/nodejs/node" --test tests/*.test.mjs    # JS suite
pytest                                                    # Python suite
python scripts/check-package.py                           # package contract
python scripts/check-packs.py                             # pack contract
hermes plugins validate chroma                            # host admission gate
```

Use the **system** node for the syntax check. The Hermes-bundled node is first on `PATH` and its
`node --test` reports "stdin is not a tty".

## Licence

MIT — see `LICENSE`. Third-party ideas and copied code are credited in
`THIRD_PARTY_NOTICES.md`.