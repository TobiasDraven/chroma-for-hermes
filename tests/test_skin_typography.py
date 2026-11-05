"""D1 — a font-only save on an OWNED skin must land in the skin file.

The editor sends `typography` on the same payload as the palettes. Before this
fix `PUT /skins/{name}` only normalised/wrote colours, so a font-only request hit
the "nothing to write" 400 and a font edit could never persist.

Run with:

    python -m pytest tests/test_skin_typography.py -q
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

API_PATH = Path(__file__).resolve().parents[1] / "chroma" / "dashboard" / "plugin_api.py"


def load_api(hermes_home: Path):
    spec = importlib.util.spec_from_file_location("chroma_plugin_api_typography", API_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    module.HERMES_HOME = hermes_home
    return module


class OwnedSkinTypographyTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)
        self.api = load_api(self.home)
        self.api.import_skin(
            self.api.ImportRequest(
                name="mine",
                theme={"colors": {"background": "#101010", "ui_accent": "#ff0000"}},
                description="TweakCN mine",
            )
        )

    def tearDown(self):
        self._tmp.cleanup()

    def _yaml(self):
        yaml = __import__("yaml")
        return yaml.safe_load((Path(self.home) / "skins" / "mine.yaml").read_text(encoding="utf-8"))

    def test_a_font_only_put_survives_the_nothing_to_write_check_and_writes_the_key(self):
        saved = self.api.put_skin(
            "mine",
            self.api.ScenePaletteRequest(typography={"fontSans": '"Segoe UI", sans-serif'}),
        )
        self.assertEqual(saved["typography"]["fontSans"], '"Segoe UI", sans-serif')

        parsed = self._yaml()
        self.assertEqual(parsed["typography"]["fontSans"], '"Segoe UI", sans-serif')
        self.assertEqual(parsed["colors"]["background"], "#101010", "the palette is left alone")

        # A second font-only save keeps the first font and the original palette.
        self.api.put_skin(
            "mine",
            self.api.ScenePaletteRequest(typography={"fontMono": '"Courier Prime", monospace'}),
        )
        parsed = self._yaml()
        self.assertEqual(parsed["typography"]["fontSans"], '"Segoe UI", sans-serif')
        self.assertEqual(parsed["typography"]["fontMono"], '"Courier Prime", monospace')
        self.assertEqual(parsed["colors"]["background"], "#101010")
        self.assertEqual(self.api.get_skin("mine")["typography"]["fontMono"], '"Courier Prime", monospace')


if __name__ == "__main__":
    unittest.main()
