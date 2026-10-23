#!/bin/sh
# Installs the Chroma gateway skin transports into the active Hermes home.
#
# These are the MODE-LOCKED transports catalogued in gateway-skins.json - the
# files the gateway reads when a theme is applied. The picker's catalogue
# (skins-v2/) and the plugin itself are installed by the plugin package; this
# script only puts the transports where the gateway looks for them.
#
# The catalogue ships as one JSON file beside this script, because an installed
# copy is sparse-cloned from chroma/ and has no repo root: the old
# gateway-skins/*.yaml tree does not travel with it. The expansion needs
# python3, which every host that runs the gateway already has.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CATALOGUE="$SCRIPT_DIR/gateway-skins.json"
HERMES_DIR=${HERMES_HOME:-"$HOME/.hermes"}
DESTINATION="$HERMES_DIR/skins"
force=0

case "${1:-}" in
  '') ;;
  --force) force=1 ;;
  *) printf 'Usage: %s [--force]\n' "$0" >&2; exit 2 ;;
esac

if [ ! -f "$CATALOGUE" ]; then
  printf 'Missing gateway skin catalogue: %s\n' "$CATALOGUE" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  printf 'python3 is required to expand gateway-skins.json but was not ' >&2
  printf 'found on PATH.\n' >&2
  printf 'Install Python 3, then rerun this script.\n' >&2
  exit 1
fi

mkdir -p "$DESTINATION"

# Native Windows python3 launched from Git Bash/MSYS cannot open a POSIX path.
# cygpath is available there and is absent on the POSIX hosts this script also
# serves, so the conversion is a no-op everywhere it is not needed.
catalogue_path="$CATALOGUE"
destination_path="$DESTINATION"
if command -v cygpath >/dev/null 2>&1; then
  catalogue_path=$(cygpath -m "$CATALOGUE")
  destination_path=$(cygpath -m "$DESTINATION")
fi

# Only the mode-locked transports are installed. The retired v1 pair table was
# archived out of the repo on 2026-10-20 and must never reach a gateway: it
# would list 150 single-palette skins the picker does not show.
python3 - "$catalogue_path" "$destination_path" "$force" <<'PY'
import json
import os
import sys

catalogue_path, destination, force_argument = sys.argv[1:4]
force = force_argument == '1'

with open(catalogue_path, encoding='utf-8') as handle:
    catalogue = json.load(handle)

transports = catalogue.get('transports')
if not isinstance(transports, list):
    sys.exit('gateway-skins.json: "transports" must be a list')


def yaml_scalar(value):
    """Render one string so a YAML reader gets the same text back."""
    text = str(value)
    needs_quotes = (
        not text
        or text != text.strip()
        or any(char in text for char in '\r\n\t')
        or text[0] in "-?:,[]{}#&*!|>'\"%@\x60"
        or ': ' in text
        or ' #' in text
        or text.endswith(':')
    )
    if needs_quotes:
        return "'" + text.replace("'", "''") + "'"
    return text


entries = []
for transport in transports:
    name = str(transport.get('name', ''))
    if not name or name in ('.', '..') or '/' in name or '\\' in name:
        sys.exit('gateway-skins.json: unsafe transport name: %r' % name)
    colors = transport.get('colors') or {}
    if not isinstance(colors, dict):
        sys.exit(
            'gateway-skins.json: "colors" must be an object for %s' % name
        )
    lines = [
        'name: ' + yaml_scalar(name),
        'description: ' + yaml_scalar(transport.get('description', '')),
        'colors:',
    ]
    for key, value in colors.items():
        lines.append('  ' + yaml_scalar(key) + ': ' + yaml_scalar(value))
    payload = ('\n'.join(lines) + '\n').encode('utf-8')
    entries.append((name + '.yaml', payload))

# Never follow a destination symlink, including with --force. The bundle owns
# regular skin files only and must not be able to overwrite an external target.
def display_path(filename):
    return destination.rstrip('/\\') + '/' + filename


for filename, _ in entries:
    target = os.path.join(destination, filename)
    if os.path.islink(target):
        sys.exit('Refusing destination symlink: %s' % display_path(filename))

if not force:
    collisions = []
    for filename, payload in entries:
        target = os.path.join(destination, filename)
        if os.path.isfile(target):
            with open(target, 'rb') as handle:
                if handle.read() != payload:
                    collisions.append(display_path(filename))
    if collisions:
        sys.stderr.write('Refusing to overwrite modified gateway skins:\n')
        for target in collisions:
            sys.stderr.write('  %s\n' % target)
        sys.stderr.write(
            'Review the files, back them up, then rerun with --force if '
            'replacement is intended.\n'
        )
        sys.exit(1)

for filename, payload in entries:
    target = os.path.join(destination, filename)
    if os.path.isfile(target):
        with open(target, 'rb') as handle:
            if handle.read() == payload:
                continue
    with open(target, 'wb') as handle:
        handle.write(payload)

print(
    'Installed %s Chroma gateway skins into: %s' % (len(entries), destination)
)
print('The next config.set skin request can resolve them without restarting '
      'Hermes Desktop.')
PY
