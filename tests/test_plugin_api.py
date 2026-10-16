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


class DeleteTests(BackendTestCase):
    def _import(self, name):
        self.api.import_skin(
            self.api.ImportRequest(
                name=name,
                theme={"colors": {"background": "#101010", "foreground": "#eeeeee", "primary": "#ff0000"}},
                description=f"TweakCN {name}",
            )
        )

    def test_refuses_a_builtin(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            self.api.delete_skin("nord")

    def test_refuses_a_skin_chroma_does_not_own(self):
        """A hand-written skin has no provenance record. We must not delete work
        the plugin never created."""
        from fastapi import HTTPException

        (Path(self.home) / "skins").mkdir(parents=True, exist_ok=True)
        (Path(self.home) / "skins" / "handmade.yaml").write_text("name: 'handmade'\n", encoding="utf-8")
        with self.assertRaises(HTTPException):
            self.api.delete_skin("handmade")
        self.assertTrue((Path(self.home) / "skins" / "handmade.yaml").is_file())

    def test_refuses_a_path_traversal_name(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            self.api.delete_skin("../../escape")

    def test_refuses_the_active_skin(self):
        from fastapi import HTTPException

        self._import("live")
        with self.assertRaises(HTTPException):
            self.api.delete_skin("live", active="live")
        self.assertTrue((Path(self.home) / "skins" / "live.yaml").is_file())

    def test_moves_to_trash_rather_than_unlinking(self):
        self._import("mistake")
        result = self.api.delete_skin("mistake")
        self.assertTrue(result["deleted"])
        self.assertFalse((Path(self.home) / "skins" / "mistake.yaml").is_file())
        trashed = Path(result["trashed"])
        self.assertTrue(trashed.is_file(), "the file must survive in the trash")
        self.assertIn("_trash", trashed.parts)
        self.assertIn("name: ", trashed.read_text(encoding="utf-8"))

    def test_removes_the_provenance_record(self):
        self._import("forget-me")
        self.api.delete_skin("forget-me")
        self.assertNotIn("forget-me", self.api._read_index())
        self.assertEqual(self.api.list_chroma_skins()["count"], 0)

    def test_a_vanished_file_drops_the_record_and_says_so(self):
        self._import("phantom")
        (Path(self.home) / "skins" / "phantom.yaml").unlink()
        result = self.api.delete_skin("phantom")
        self.assertFalse(result["deleted"], "nothing was deleted, and the response says so")
        self.assertNotIn("phantom", self.api._read_index())


class RenameTests(BackendTestCase):
    def _import(self, name):
        self.api.import_skin(
            self.api.ImportRequest(
                name=name,
                theme={"colors": {"background": "#101010", "foreground": "#eeeeee", "primary": "#ff0000"}},
                description=f"TweakCN {name}",
            )
        )

    def test_renames_the_file_the_record_and_the_inner_name(self):
        self._import("old-name")
        result = self.api.rename_skin(self.api.RenameRequest(source="old-name", target="new-name"))
        self.assertTrue(result["ok"])

        skins = Path(self.home) / "skins"
        self.assertFalse((skins / "old-name.yaml").is_file())
        self.assertTrue((skins / "new-name.yaml").is_file())

        # The engine reads the `name:` field, so a stale one would give the CLI
        # a name that disagrees with the filename.
        body = (skins / "new-name.yaml").read_text(encoding="utf-8")
        self.assertIn("name: 'new-name'", body)
        self.assertNotIn("old-name", body)

        index = self.api._read_index()
        self.assertNotIn("old-name", index)
        self.assertIn("new-name", index)
        # GET /skins reads its label from the index, so a stale one would show
        # the old name on the card while the skin file disagreed with it.
        self.assertEqual(index["new-name"]["label"], "TweakCN new-name")

    def test_reports_whether_the_renamed_skin_was_active(self):
        self._import("live")
        active = self.api.rename_skin(
            self.api.RenameRequest(source="live", target="live-2", active="live")
        )
        self.assertTrue(active["wasActive"], "the caller must know to re-broadcast")

        self._import("idle")
        idle = self.api.rename_skin(self.api.RenameRequest(source="idle", target="idle-2"))
        self.assertFalse(idle["wasActive"])

    def test_refuses_a_builtin_target(self):
        from fastapi import HTTPException

        self._import("mine")
        with self.assertRaises(HTTPException):
            self.api.rename_skin(self.api.RenameRequest(source="mine", target="nord"))

    def test_refuses_an_unowned_source(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            self.api.rename_skin(self.api.RenameRequest(source="not-mine", target="whatever"))

    def test_refuses_a_target_that_exists(self):
        from fastapi import HTTPException

        self._import("one")
        self._import("two")
        with self.assertRaises(HTTPException):
            self.api.rename_skin(self.api.RenameRequest(source="one", target="two"))
        self.assertTrue((Path(self.home) / "skins" / "one.yaml").is_file())

    def test_refuses_a_traversal_target(self):
        from fastapi import HTTPException

        self._import("safe")
        with self.assertRaises(HTTPException):
            self.api.rename_skin(self.api.RenameRequest(source="safe", target="../escape"))

    def test_refuses_renaming_onto_itself(self):
        from fastapi import HTTPException

        self._import("same")
        with self.assertRaises(HTTPException):
            self.api.rename_skin(self.api.RenameRequest(source="same", target="same"))


if __name__ == "__main__":
    unittest.main()
