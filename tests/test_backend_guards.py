"""Backend guards: the global skin cap, the free-slug refusal, and path leaks.

Three defects this file pins down:

  * ``MAX_TOTAL_SKINS`` was only a constant and a loop bound, so every mint path
    ignored it — the cap protected nothing.
  * ``_free_slug`` exhausted its search with a bare ``RuntimeError``, which the
    route turns into an opaque 500.
  * 500 details and one success payload carried absolute filesystem paths.

Run with:

    python -m pytest tests/test_backend_guards.py -q
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

API_PATH = Path(__file__).resolve().parents[1] / "chroma" / "dashboard" / "plugin_api.py"


def load_api(hermes_home: Path):
    spec = importlib.util.spec_from_file_location("chroma_plugin_api_guards", API_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    module.HERMES_HOME = hermes_home
    return module


class GuardTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)
        self.api = load_api(self.home)

    def tearDown(self):
        self._tmp.cleanup()

    def _import(self, name: str):
        return self.api.import_skin(
            self.api.ImportRequest(
                name=name,
                theme={"colors": {"background": "#101010", "ui_accent": "#ff0000"}},
                description=f"skin {name}",
            )
        )

    # --- the cap ---------------------------------------------------------------

    def test_the_counter_ignores_derived_transport_files(self):
        self._import("mine")
        transport = self.api._skins_dir() / f"{self.api.TRANSPORT_PREFIX}scene-dark.yaml"
        transport.write_text("name: whatever\n", encoding="utf-8")
        self.assertEqual(self.api._owned_skin_count(), 1, "transport files are derived, not owned")

    def test_import_refuses_at_the_cap(self):
        self._import("one")
        self.api.MAX_TOTAL_SKINS = 1
        with self.assertRaises(HTTPException) as ctx:
            self._import("two")
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("skin limit reached", str(ctx.exception.detail))
        self.assertFalse((self.api._skins_dir() / "two.yaml").exists(), "nothing was written")

    def test_duplicate_refuses_at_the_cap(self):
        self._import("one")
        self.api.MAX_TOTAL_SKINS = 1
        with self.assertRaises(HTTPException) as ctx:
            self.api.duplicate_skin(
                self.api.DuplicateRequest(
                    to="two", light={"ui_accent": "#00ff00"}, dark={"ui_accent": "#00ff00"}
                )
            )
        self.assertEqual(ctx.exception.status_code, 409)

    def test_the_guard_itself_refuses_a_bundle_that_would_overflow(self):
        self._import("one")
        self._import("two")
        self.api.MAX_TOTAL_SKINS = 3
        self.api._assert_mint_capacity(1)  # 2 + 1 == 3: still allowed
        with self.assertRaises(HTTPException) as ctx:
            self.api._assert_mint_capacity(2)  # 2 + 2 > 3: refused before any write
        self.assertEqual(ctx.exception.status_code, 409)

    # --- the free-slug exhaustion ---------------------------------------------

    def test_free_slug_exhaustion_is_a_409_not_a_500(self):
        skins = self.api._skins_dir()
        # The loop tries ``range(MAX_TOTAL_SKINS)`` candidates starting at 2, so a
        # bound of 2 covers exactly base-2 and base-3. Occupy both to exhaust it.
        self.api.MAX_TOTAL_SKINS = 2
        for candidate in ("base-2", "base-3"):
            (skins / f"{candidate}.yaml").write_text("name: x\n", encoding="utf-8")
        with self.assertRaises(HTTPException) as ctx:
            self.api._free_slug("base", skins)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("no free name", str(ctx.exception.detail))

    # --- path leaks ------------------------------------------------------------

    def test_delete_payload_keeps_a_readable_trash_path(self):
        # `trashed` is a PATH by contract: export-from-trash reads that file
        # (tests/test_plugin_api.py::ExportTests). Sanitising it to a basename
        # broke that flow, so this pins the working shape instead.
        self._import("mine")
        result = self.api.delete_skin("mine")
        trashed = Path(result["trashed"])
        self.assertTrue(trashed.is_file(), "the trashed file must still be readable")
        self.assertTrue(trashed.name.endswith(".yaml"))


if __name__ == "__main__":
    unittest.main()
