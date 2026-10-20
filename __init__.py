"""Chroma for Hermes — the agent-plugin entry point.

This repository root IS the plugin package. Its work happens in two other
places, and neither is reached from here:

* ``desktop/plugin.js``      — the Hermes Desktop pane (the picker).
* ``dashboard/plugin_api.py`` — the FastAPI router mounted at ``/api/plugins/chroma/``.

The Desktop app loads the desktop half out of the package's ``desktop/``
directory, and the web dashboard discovers the backend half from the package's
``dashboard/manifest.json``. What this file does is make the root an *agent
plugin package*, which is what the host checks before it installs one:

* ``apps/desktop/electron/desktop-plugin-install.ts`` —
  ``agent = (hasYaml && hasInit) || hasPortable``. Without this file the
  install takes the desktop-only path: only ``desktop/`` is published and the
  Python half never lands.
* ``plugins/plugin_loader.py`` — ``iter_plugin_dirs`` only sees a child
  directory that carries an ``__init__.py``. Without it the plugin raises
  ``FileNotFoundError: No __init__.py`` at every gateway start.
* ``hermes_cli/plugin_validate.py`` — the capability probe is *skipped* when
  the file is absent, so the admission gate reports green for a package that
  cannot load.

Chroma registers no tools, hooks, middleware or providers, so ``register`` is a
no-op. It stays dependency-free on purpose: the host imports this module in
its own interpreter, and the admission probe imports it in a scratch
subprocess that deliberately has no Hermes packages available — so importing
``dashboard.plugin_api`` here would pull in FastAPI and could fail.
"""

from __future__ import annotations


def register(ctx) -> None:
    """Entry point the host calls with its plugin context.

    Chroma contributes no agent-side capability, so nothing is registered and
    nothing is imported. The context is accepted (and ignored) because the host
    always calls ``register(ctx)``.
    """
    return None
