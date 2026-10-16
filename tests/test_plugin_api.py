"""Backend tests for Chroma's dashboard half.

Run with the Hermes venv interpreter (the one that actually mounts the router):

    /c/Users/malan/AppData/Local/hermes/installs/*/environments/*/venv/Scripts/python.exe \
        -m unittest tests.test_plugin_api

The module imports fastapi at load time, so the system python cannot import it.
HERMES_HOME is overridden on the module AFTER import, so every path helper
resolves inside a temp directory and never touches the real vault.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

API_PATH = Path(__file__).resolve().parents[1] / "dashboard" / "plugin_api.py"


def load_api(hermes_home: Path):
    spec = importlib.util.spec_from_file_location("chroma_plugin_api_under_test", API_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    module.HERMES_HOME = hermes_home
    return module


class BackendTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)
        self.api = load_api(self.home)

    def tearDown(self):
        self._tmp.cleanup()


class YamlEmitterTests(BackendTestCase):
    def test_emits_parseable_yaml(self):
        yaml = __import__("yaml")
        data = {
            "name": "catppuccin",
            "description": "TweakCN catppuccin",
            "colors": {"background": "#f5eff1", "ui_text": "#664750"},
        }
        parsed = yaml.safe_load(self.api._dump_skin_yaml(data))
        self.assertEqual(parsed, data)

    def test_escapes_a_quote_rather_than_breaking_the_document(self):
        yaml = __import__("yaml")
        data = {"name": "x", "description": "it's 'quoted'", "colors": {"background": "#000000"}}
        parsed = yaml.safe_load(self.api._dump_skin_yaml(data))
        self.assertEqual(parsed["description"], "it's 'quoted'")

    def test_emits_nested_maps_for_the_dark_palette(self):
        yaml = __import__("yaml")
        data = {
            "name": "x",
            "description": "d",
            "colors": {"background": "#111111"},
            "dark_colors": {"background": "#000000"},
        }
        parsed = yaml.safe_load(self.api._dump_skin_yaml(data))
        self.assertEqual(parsed["dark_colors"]["background"], "#000000")
        self.assertEqual(parsed["colors"]["background"], "#111111")


class SlugTests(BackendTestCase):
    def test_accepts_plain_slugs(self):
        for good in ("catppuccin", "my-theme", "t3-chat", "v2-nord"):
            self.assertFalse(self.api._is_unsafe_name(good), good)

    def test_rejects_path_traversal_and_separators(self):
        for bad in ("../escape", "a/b", "a\\b", "..", "", "UPPER", "has space", ".hidden"):
            self.assertTrue(self.api._is_unsafe_name(bad), bad)


class IndexTests(BackendTestCase):
    def test_missing_index_reads_as_empty(self):
        self.assertEqual(self.api._read_index(), {})

    def test_round_trips(self):
        self.api._write_index({"catppuccin": {"source": "chroma", "label": "Catppuccin"}})
        self.assertEqual(self.api._read_index()["catppuccin"]["label"], "Catppuccin")

    def test_corrupt_index_reads_as_empty_rather_than_raising(self):
        self.api._index_path().write_text("{ this is not json", encoding="utf-8")
        self.assertEqual(self.api._read_index(), {})

    def test_the_sidecar_dir_is_not_a_skin_file(self):
        """The index must live in a subdirectory: the skin engine globs top-level
        *.yaml only, so a sidecar at the top level would appear as a skin."""
        self.api._write_index({"x": {}})
        skins_dir = Path(self.home) / "skins"
        self.assertEqual(list(skins_dir.glob("*.yaml")), [])
        self.assertTrue(self.api._index_path().is_file())


class SkinListingTests(BackendTestCase):
    def _import(self, name):
        self.api.import_skin(
            self.api.ImportRequest(
                name=name,
                theme={"colors": {"background": "#101010", "foreground": "#eeeeee", "primary": "#ff0000"}},
                description=f"TweakCN {name}",
            )
        )

    def test_a_skin_appears_as_cli_capable_while_its_file_is_at_the_top_level(self):
        self._import("catppuccin")
        listing = self.api.list_chroma_skins()
        self.assertEqual(listing["count"], 1)
        row = listing["skins"][0]
        self.assertEqual(row["name"], "catppuccin")
        self.assertTrue(row["cliCapable"])
        self.assertFalse(row["missing"])
        self.assertTrue(row["owned"])

    def test_a_deleted_file_is_reported_missing_not_silently_dropped(self):
        self._import("ghost")
        (Path(self.home) / "skins" / "ghost.yaml").unlink()
        row = self.api.list_chroma_skins()["skins"][0]
        self.assertTrue(row["missing"])
        self.assertFalse(row["cliCapable"])

    def test_import_records_provenance(self):
        self._import("provenance-check")
        index = self.api._read_index()
        self.assertIn("provenance-check", index)
        self.assertEqual(index["provenance-check"]["source"], "chroma")
        self.assertTrue(index["provenance-check"]["importedAt"])

    def test_import_refuses_a_builtin_and_a_second_write(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            self.api.import_skin(
                self.api.ImportRequest(name="nord", theme={"colors": {"background": "#101010"}})
            )
        self._import("twice")
        with self.assertRaises(HTTPException):
            self._import("twice")


if __name__ == "__main__":
    unittest.main()
