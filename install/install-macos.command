#!/bin/sh
# Installs the Theme Picker desktop plugin into the active macOS Hermes home.
# Double-click this .command file in Finder, or run it from Terminal.
set -eu

installer_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(dirname -- "$installer_dir")

# Support both layouts:
# - a source checkout: <repo>/desktop/plugin.js
# - a small distributable bundle: <bundle>/chroma/plugin.js
checkout_plugin="$repo_root/desktop/plugin.js"
bundled_plugin="$installer_dir/chroma/plugin.js"
if [ -f "$checkout_plugin" ]; then
  source_plugin=$checkout_plugin
elif [ -f "$bundled_plugin" ]; then
  source_plugin=$bundled_plugin
else
  printf 'Theme Picker plugin file was not found.\nExpected: %s\nOr: %s\n' \
    "$checkout_plugin" "$bundled_plugin" >&2
  exit 1
fi

hermes_home=${HERMES_HOME:-"$HOME/.hermes"}
# Same layout as the Windows installer and as `hermes plugins install`: the
# package directory carries plugin.yaml, the desktop half and the dashboard half.
# A bare plugin.js under desktop-plugins/ is the legacy manual route and has no
# manifest, so Hermes refuses it at the catalog gate.
if [ ! -f "$repo_root/plugin.yaml" ]; then
  printf 'This installer needs a source checkout (plugin.yaml beside desktop/).\n' >&2
  printf 'Missing: %s\n' "$repo_root/plugin.yaml" >&2
  exit 1
fi
plugin_dir="$hermes_home/plugins/chroma"

rm -rf "$plugin_dir"
mkdir -p "$plugin_dir"
cp -R "$repo_root/desktop" "$repo_root/dashboard" "$plugin_dir/"
cp "$repo_root/plugin.yaml" "$repo_root/LICENSE" "$repo_root/THIRD_PARTY_NOTICES.md" "$repo_root/README.md" "$plugin_dir/"

printf '\nInstalled Chroma into: %s\n' "$plugin_dir"
printf 'Restart Hermes Desktop once so the pane and the backend mount.\n'
printf '(Then Capabilities -> Plugins -> Rescan if the row does not appear.)\n'
