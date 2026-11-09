from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

API_PATH = Path(__file__).resolve().parents[1] / "chroma" / "dashboard" / "plugin_api.py"


def load_api(hermes_home: Path):
    spec = importlib.util.spec_from_file_location("chroma_plugin_api_fp", API_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    module.HERMES_HOME = hermes_home
    return module


class ForkPairTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)
        self.api = load_api(self.home)

    def tearDown(self):
        self._tmp.cleanup()

    def test_duplicate_writes_three_files(self):
        self.api.duplicate_skin(self.api.DuplicateRequest(to="fork", light={"ui_accent": "#00ff00"}, dark={"ui_accent": "#0000ff"}))
        sd = self.api._skins_dir()
        self.assertTrue((sd / "fork.yaml").is_file())
        self.assertTrue((sd / "fork-light.yaml").is_file())
        self.assertTrue((sd / "fork-dark.yaml").is_file())
        # read yaml via api
        light_file = self.api._read_skin_file(sd / "fork-light.yaml")
        dark_file = self.api._read_skin_file(sd / "fork-dark.yaml")
        self.assertEqual(light_file["colors"], {"ui_accent": "#00ff00"})
        self.assertEqual(dark_file["colors"], {"ui_accent": "#0000ff"})

    def test_gateway_in_index_and_list(self):
        self.api.duplicate_skin(self.api.DuplicateRequest(to="fork", light={"ui_accent": "#00ff00"}, dark={"ui_accent": "#0000ff"}))
        idx = self.api._read_index()
        self.assertEqual(idx["fork"]["gateway"], {"light": "fork-light", "dark": "fork-dark"})
        rows = self.api.list_chroma_skins()["skins"]
        self.assertEqual(rows[0]["gateway"], {"light": "fork-light", "dark": "fork-dark"})

    def test_delete_removes_all_three(self):
        self.api.duplicate_skin(self.api.DuplicateRequest(to="fork", light={"ui_accent": "#00ff00"}, dark={"ui_accent": "#0000ff"}))
        self.api.delete_skin("fork")
        sd = self.api._skins_dir()
        self.assertFalse((sd / "fork.yaml").exists())
        self.assertFalse((sd / "fork-light.yaml").exists())
        self.assertFalse((sd / "fork-dark.yaml").exists())

    def test_rename_carries_all_three(self):
        self.api.duplicate_skin(self.api.DuplicateRequest(to="fork", light={"ui_accent": "#00ff00"}, dark={"ui_accent": "#0000ff"}))
        self.api.rename_skin(self.api.RenameRequest(source="fork", target="renamed"))
        sd = self.api._skins_dir()
        self.assertTrue((sd / "renamed.yaml").is_file())
        self.assertTrue((sd / "renamed-light.yaml").is_file())
        self.assertTrue((sd / "renamed-dark.yaml").is_file())

    def test_second_ensure_mints_nothing(self):
        self.api.duplicate_skin(self.api.DuplicateRequest(to="fork", light={"ui_accent": "#00ff00"}, dark={"ui_accent": "#0000ff"}))
        sd = self.api._skins_dir()
        mtimes = {p.name: p.stat().st_mtime for p in sd.glob("fork*.yaml")}
        self.api._ensure_owned_pairs()
        mtimes2 = {p.name: p.stat().st_mtime for p in sd.glob("fork*.yaml")}
        self.assertEqual(mtimes, mtimes2)

    def test_corrupt_file_does_not_block_list(self):
        sd = self.api._skins_dir()
        (sd / "broken.yaml").write_text(":\n  bad", encoding="utf-8")
        # index entry
        idx = self.api._read_index() if False else {}
        self.api._write_index({"broken": {"label": "broken", "source": "user", "pack": None, "importedAt": "", "owned": True}})
        resp = self.api.list_chroma_skins()
        self.assertEqual(resp["ok"], True)


if __name__ == "__main__":
    unittest.main()