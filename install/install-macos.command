#!/bin/sh
# Installs the Chroma plugin package into the active macOS Hermes home.
# Double-click this .command file in Finder, or run it from Terminal.
#
# This is the MANUAL route. The supported routes are:
#   - Desktop: Capabilities -> Plugins -> Install, and paste
#     https://github.com/TobiasDraven/chroma-for-hermes
#     (the dialog installs the package - backend AND desktop half - in one step)
#   - CLI:     hermes plugins install https://github.com/TobiasDraven/chroma-for-hermes
# Use this script only when neither is reachable (an air-gapped machine, a mirror).
#
# The repository root IS the plugin package:
#     __init__.py              <- the agent-plugin entry point (register(ctx))
#     plugin.yaml              <- the manifest (name: chroma)
#     desktop/plugin.js        <- the desktop UI half
#     dashboard/manifest.json  <- the backend half's manifest
#     dashboard/plugin_api.py  <- the FastAPI router (mounted at /api/plugins/chroma/)
#
# Installing means placing that package at <hermes home>/plugins/chroma/. The
# Desktop app copies the desktop half out of <plugins>/chroma/desktop/ into
# <desktop-plugins>/chroma/ by itself, so nothing else has to be copied.
set -eu

installer_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(dirname -- "$installer_dir")

plugin_file="$repo_root/desktop/plugin.js"
if [ ! -f "$plugin_file" ]; then
  printf 'Chroma plugin file was not found.\nExpected: %s\n' "$plugin_file" >&2
  exit 1
fi

hermes_home=${HERMES_HOME:-"$HOME/.hermes"}
# Same layout as the Windows installer and as `hermes plugins install`: the
# package directory carries the manifest, the agent entry point, the desktop
# half and the dashboard half. A bare plugin.js under desktop-plugins/ is the
# legacy manual route: it has no manifest, so Hermes refuses it at the catalog
# gate, and without __init__.py the plugin raises FileNotFoundError at every
# gateway start.
if [ ! -f "$repo_root/plugin.yaml" ]; then
  printf 'This installer needs a source checkout (plugin.yaml beside desktop/).\n' >&2
  printf 'Missing: %s\n' "$repo_root/plugin.yaml" >&2
  exit 1
fi
if [ ! -f "$repo_root/__init__.py" ]; then
  printf 'This installer needs a source checkout (__init__.py beside plugin.yaml).\n' >&2
  printf 'Missing: %s\n' "$repo_root/__init__.py" >&2
  exit 1
fi
plugin_dir="$hermes_home/plugins/chroma"

rm -rf "$plugin_dir"
mkdir -p "$plugin_dir"
cp -R "$repo_root/desktop" "$repo_root/dashboard" "$plugin_dir/"
cp "$repo_root/plugin.yaml" "$repo_root/__init__.py" "$repo_root/LICENSE" "$repo_root/THIRD_PARTY_NOTICES.md" "$repo_root/README.md" "$plugin_dir/"

printf '\nInstalled Chroma into: %s\n' "$plugin_dir"
printf 'Restart Hermes Desktop once so the pane and the backend mount.\n'
printf '(Then Capabilities -> Plugins -> Rescan if the row does not appear.)\n'
