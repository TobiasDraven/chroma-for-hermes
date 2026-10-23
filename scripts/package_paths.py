"""Single source of truth for where the shipped package lives.

The catalog installs the `chroma/` subdirectory, so the package root moved off
the repo root. Every script resolves the package through here: one place to
change when the layout moves again, and no script can silently re-acquire the
old root-relative path.

Layout:
    <repo>/chroma/                 the shipped package (what the catalog installs)
    <repo>/skins-v2/, gateway-skins/, scripts/, tests/, docs/   build and dev
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "chroma"
BUILD = PACKAGE / "desktop" / "plugin.js"
TEMPLATE = PACKAGE / "desktop" / "plugin.template.js"
MANIFEST = PACKAGE / "plugin.yaml"
