"""Backend tests for Chroma's dashboard half.

Run them with any interpreter that has fastapi and PyYAML:

    python -m pytest tests/test_plugin_api.py
    python -m unittest tests.test_plugin_api

On this host both the system python and the Hermes venv interpreter satisfy
that; if an interpreter lacks fastapi the import fails at load time, which is
the honest failure. HERMES_HOME is rebound to a temp directory, so every path
helper resolves inside it and never touches the real Hermes home.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import threading
import time
import re
import unittest
from pathlib import Path

# CHROMA_API_PATH lets a run point at a different revision of the backend (e.g.
# `git show <rev>:chroma/dashboard/plugin_api.py` written to a temp file) so a
# new test can be shown FAILING against the unfixed code and passing against the fix.
API_PATH = Path(
    os.environ.get("CHROMA_API_PATH")
    or (Path(__file__).resolve().parents[1] / "chroma" / "dashboard" / "plugin_api.py")
)


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


class ExportTests(BackendTestCase):
    def _import(self, name):
        self.api.import_skin(
            self.api.ImportRequest(
                name=name,
                theme={"colors": {"background": "#101010", "foreground": "#eeeeee", "primary": "#ff0000"}},
                description=f"TweakCN {name}",
            )
        )

    def test_exports_one_skin_as_reimportable_yaml(self):
        yaml = __import__("yaml")
        self._import("catppuccin")
        result = self.api.export_skins(name="catppuccin")

        self.assertEqual(result["count"], 1)
        self.assertEqual(result["filename"], "catppuccin.yaml")
        body = result["files"][0]["yaml"]

        # The export must round-trip: the importer writes this schema, so a user
        # can export, hand-edit and bring the file back.
        parsed = yaml.safe_load(body)
        self.assertEqual(parsed["name"], "catppuccin")
        self.assertIn("colors", parsed)
        self.assertTrue(parsed["colors"]["background"].startswith("#"))

    def test_exports_every_owned_skin(self):
        self._import("one")
        self._import("two")
        result = self.api.export_skins()
        self.assertEqual(result["count"], 2)
        self.assertEqual(sorted(f["name"] for f in result["files"]), ["one", "two"])
        self.assertIn("one", result["index"])

    def test_refuses_an_unowned_skin(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            self.api.export_skins(name="not-mine")

    def test_refuses_a_traversal_name(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            self.api.export_skins(name="../../escape")

    def test_exporting_nothing_is_an_empty_result_not_an_error(self):
        result = self.api.export_skins()
        self.assertEqual(result["count"], 0)
        self.assertEqual(result["files"], [])

    def test_a_missing_file_is_skipped_in_the_bulk_export(self):
        self._import("present")
        self._import("gone")
        (Path(self.home) / "skins" / "gone.yaml").unlink()
        result = self.api.export_skins()
        self.assertEqual(result["count"], 1, "a vanished file must not break the export")
        self.assertEqual(result["files"][0]["name"], "present")

    def test_a_deleted_skin_can_be_exported_from_the_trash(self):
        """Deletion is recoverable, and the export is how a user recovers the
        content — so the trashed file must still be readable YAML."""
        yaml = __import__("yaml")
        self._import("mistake")
        deletion = self.api.delete_skin("mistake")
        body = Path(deletion["trashed"]).read_text(encoding="utf-8")
        self.assertEqual(yaml.safe_load(body)["name"], "mistake")


class HexTests(BackendTestCase):
    """B3 — `_hex` had no test at all, and accepted any 7-char '#…' string."""

    VALID = {
        "#abc": "#aabbcc",
        "#ABC": "#aabbcc",
        "#a1b2c3": "#a1b2c3",
        "#A1B2C3": "#a1b2c3",
        "#000000": "#000000",
        "#ffffff": "#ffffff",
        "  #fff  ": "#ffffff",
    }
    INVALID = ("#zzzzzz", "#12 456", "#fffffé", "#12g456", "#12345", "#1234567", "#", "123456", "red", "", "   ")

    def test_valid_forms_normalise_to_rrggbb(self):
        for raw, expected in self.VALID.items():
            self.assertEqual(self.api._hex(raw), expected, raw)

    def test_a_missing_value_is_absence_not_an_error(self):
        """A token the caller did not send falls back to a default; only a token
        that IS sent and is not a colour is an error."""
        self.assertIsNone(self.api._hex(None))
        self.assertIsNone(self.api._hex(0x123456))

    def test_each_invalid_form_is_rejected_and_named(self):
        for bad in self.INVALID:
            with self.assertRaises(ValueError, msg=bad) as ctx:
                self.api._hex(bad)
            self.assertIn(repr(bad), str(ctx.exception), "the message must name the offending value")

    def test_import_refuses_each_bad_colour_with_a_400_naming_it(self):
        from fastapi import HTTPException

        for bad in self.INVALID:
            with self.assertRaises(HTTPException, msg=bad) as ctx:
                self.api.import_skin(
                    self.api.ImportRequest(
                        name="bad-colour",
                        theme={"colors": {"background": bad, "foreground": "#eeeeee"}},
                    )
                )
            self.assertEqual(ctx.exception.status_code, 400)
            self.assertIn(repr(bad), str(ctx.exception.detail))
            self.assertFalse((Path(self.home) / "skins" / "bad-colour.yaml").exists())

    def test_a_bad_colour_never_reaches_the_gateway(self):
        """The whole point of rejecting at the boundary: no skin file is written."""
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            self.api.import_skin(
                self.api.ImportRequest(name="broken", theme={"colors": {"background": "#zzzzzz"}})
            )
        self.assertEqual(list((Path(self.home) / "skins").glob("*.yaml")), [])
        self.assertEqual(self.api._read_index(), {})


class RequestSizeTests(BackendTestCase):
    """B4 — `theme: dict[str, Any]` was unbounded."""

    def _limit(self):
        return self.api.MAX_THEME_BYTES

    def test_a_theme_over_the_byte_limit_is_refused_with_413(self):
        from fastapi import HTTPException

        huge = {"colors": {"background": "#101010"}, "junk": "x" * (self._limit() + 1)}
        with self.assertRaises(HTTPException) as ctx:
            self.api.import_skin(self.api.ImportRequest(name="huge", theme=huge))
        self.assertEqual(ctx.exception.status_code, 413)
        self.assertFalse((Path(self.home) / "skins" / "huge.yaml").exists())

    def test_too_many_colour_tokens_is_refused_with_413(self):
        from fastapi import HTTPException

        wide = {"colors": {f"token{i}": "#101010" for i in range(self.api.MAX_THEME_COLORS + 1)}}
        with self.assertRaises(HTTPException) as ctx:
            self.api.import_skin(self.api.ImportRequest(name="wide", theme=wide))
        self.assertEqual(ctx.exception.status_code, 413)
        self.assertFalse((Path(self.home) / "skins" / "wide.yaml").exists())

    def test_a_theme_at_the_budget_is_still_accepted(self):
        theme = {"colors": {f"token{i}": "#101010" for i in range(100)}}
        self.assertIsNone(self.api._theme_too_large(theme))
        result = self.api.import_skin(self.api.ImportRequest(name="normal", theme=theme))
        self.assertTrue(result["ok"])


class ReservedNameTests(BackendTestCase):
    """B5 — Windows device names are legal slugs but are not files."""

    def test_reserved_device_names_are_unsafe(self):
        for bad in ("con", "prn", "aux", "nul", "com1", "com5", "com9", "lpt1", "lpt9"):
            self.assertTrue(self.api._is_unsafe_name(bad), bad)

    def test_the_allowlist_shape_is_kept_for_everything_else(self):
        for good in ("console", "con-artist", "com10", "lpt0", "null", "auxiliary", "prnt"):
            self.assertFalse(self.api._is_unsafe_name(good), good)

    def test_import_refuses_a_reserved_device_name_with_400(self):
        from fastapi import HTTPException

        for bad in ("con", "nul", "com1"):
            with self.assertRaises(HTTPException, msg=bad) as ctx:
                self.api.import_skin(self.api.ImportRequest(name=bad, theme={}))
            self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(list((Path(self.home) / "skins").glob("*.yaml")), [])

    def test_delete_and_rename_refuse_a_reserved_name_too(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            self.api.delete_skin("con")
        with self.assertRaises(HTTPException):
            self.api.rename_skin(self.api.RenameRequest(source="con", target="safe"))
        with self.assertRaises(HTTPException):
            self.api.rename_skin(self.api.RenameRequest(source="safe", target="nul"))


class ConcurrencyTests(BackendTestCase):
    """B1 — two concurrent imports lost an entry and collided on one temp file.

    The writers are THREADS in one process: the router is mounted with
    `include_router` on the single `hermes_cli.web_server.app`, served by one
    uvicorn Server with no `workers=`, and every endpoint is a sync `def` so
    Starlette runs it via `run_in_threadpool`. `threading.Lock` is therefore the
    right primitive, and the whole read-modify-write must sit inside it.
    """

    def _theme(self, background="#101010"):
        return {"colors": {"background": background, "foreground": "#eeeeee"}}

    def _import_in_thread(self, name, errors, barrier):
        barrier.wait(timeout=10)
        try:
            self.api.import_skin(self.api.ImportRequest(name=name, theme=self._theme()))
        except BaseException as exc:  # noqa: BLE001 - the test asserts none occur
            errors.append(repr(exc))

    def test_two_concurrent_imports_keep_both_entries(self):
        # Widen the read-modify-write window: the loss happens BETWEEN the read
        # and the write, so slowing the write makes a missing lock fail every run
        # instead of occasionally.
        real_write = self.api._write_index

        def slow_write(index):
            time.sleep(0.15)
            real_write(index)

        self.api._write_index = slow_write
        errors: list[str] = []
        barrier = threading.Barrier(2)
        threads = [
            threading.Thread(target=self._import_in_thread, args=("alpha", errors, barrier)),
            threading.Thread(target=self._import_in_thread, args=("beta", errors, barrier)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=15)

        self.assertEqual(errors, [], "neither import may raise")
        survivors = self.api._read_index()
        self.assertEqual(set(survivors), {"alpha", "beta"}, "both provenance entries must survive")

    def test_many_concurrent_imports_all_survive(self):
        names = [f"skin-{i}" for i in range(12)]
        errors: list[str] = []
        barrier = threading.Barrier(len(names))
        threads = [
            threading.Thread(target=self._import_in_thread, args=(n, errors, barrier)) for n in names
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=20)

        self.assertEqual(errors, [])
        self.assertEqual(set(self.api._read_index()), set(names))

    def test_atomic_write_uses_a_distinct_temp_file_per_write(self):
        """A fixed `<name>.tmp` is a shared resource: two writers collide on it
        and the second gets PermissionError from os.replace on Windows."""
        replaced: list[str] = []
        real_replace = self.api.os.replace

        def record_replace(src, dst):
            replaced.append(str(src))
            return real_replace(src, dst)

        self.api.os.replace = record_replace
        try:
            target = Path(self.home) / "sample.txt"
            self.api._atomic_write_text(target, "one")
            self.api._atomic_write_text(target, "two")
        finally:
            self.api.os.replace = real_replace

        self.assertEqual(len(replaced), 2)
        self.assertNotEqual(replaced[0], replaced[1], "each write needs its own temp name")
        for src in replaced:
            self.assertTrue(src.endswith(".tmp"), src)
        self.assertEqual(target.read_text(encoding="utf-8"), "two")


class IndexCorruptionTests(BackendTestCase):
    """B2 — a present-but-unreadable index was read as {} and then persisted."""

    def _seed(self):
        self.api._write_index({"keepme": {"source": "chroma", "label": "Keep Me"}})
        return self.api._index_path()

    def test_a_missing_index_still_reads_as_empty_for_a_writer(self):
        self.assertEqual(self.api._read_index_for_update(), {})

    def test_a_truncated_index_is_not_overwritten_by_an_import(self):
        from fastapi import HTTPException

        path = self._seed()
        truncated = '{"keepme": {"source": "chroma"'
        path.write_text(truncated, encoding="utf-8")

        with self.assertRaises(HTTPException) as ctx:
            self.api.import_skin(self.api.ImportRequest(name="newone", theme={}))
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertIn("unreadable", str(ctx.exception.detail).lower())

        # The original bytes are untouched, and a timestamped copy sits beside the
        # file, so the provenance is still recoverable by hand.
        self.assertEqual(path.read_text(encoding="utf-8"), truncated)
        backups = [p for p in path.parent.iterdir() if p.name.startswith("index.json.unreadable-")]
        self.assertEqual(len(backups), 1, f"expected one backup, got {backups}")
        self.assertEqual(backups[0].read_text(encoding="utf-8"), truncated)
        # And nothing was written from the failed read.
        self.assertFalse((Path(self.home) / "skins" / "newone.yaml").exists())

    def test_a_non_object_index_is_refused_the_same_way(self):
        path = self.api._index_path()
        path.write_text("[1, 2, 3]", encoding="utf-8")
        with self.assertRaises(self.api.IndexUnreadableError):
            self.api._read_index_for_update()

    def test_delete_and_rename_refuse_an_unreadable_index(self):
        from fastapi import HTTPException

        path = self._seed()
        path.write_text("not json at all", encoding="utf-8")
        with self.assertRaises(HTTPException) as ctx:
            self.api.delete_skin("keepme")
        self.assertEqual(ctx.exception.status_code, 500)
        with self.assertRaises(HTTPException) as ctx:
            self.api.rename_skin(self.api.RenameRequest(source="keepme", target="renamed"))
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertEqual(path.read_text(encoding="utf-8"), "not json at all")

    def test_the_read_only_view_still_never_raises(self):
        """The picker's listing degrades to 'nothing is ours' rather than 500ing;
        that reading is safe precisely because no write is derived from it."""
        path = self._seed()
        path.write_text("{ broken", encoding="utf-8")
        self.assertEqual(self.api._read_index(), {})
        self.assertEqual(self.api.list_chroma_skins()["count"], 0)


class FailurePathTests(BackendTestCase):
    """B6 — a failed index write orphaned the skin file and returned a bare 500."""

    def _theme(self):
        return {"colors": {"background": "#101010", "foreground": "#eeeeee"}}

    def _break_index_write(self, exc=None):
        exc = exc or OSError(28, "No space left on device")

        def boom(index):
            raise exc

        self.api._write_index = boom

    def test_a_failed_index_write_removes_the_skin_it_just_wrote(self):
        from fastapi import HTTPException

        self._break_index_write()
        with self.assertRaises(HTTPException) as ctx:
            self.api.import_skin(
                self.api.ImportRequest(name="orphan", theme=self._theme(), description="TweakCN orphan")
            )
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertFalse(
            (Path(self.home) / "skins" / "orphan.yaml").exists(),
            "an unmanageable skin file must not be left behind",
        )
        self.assertEqual(self.api.list_chroma_skins()["count"], 0)

    def test_the_rollback_message_is_actionable(self):
        from fastapi import HTTPException

        self._break_index_write()
        with self.assertRaises(HTTPException) as ctx:
            self.api.import_skin(self.api.ImportRequest(name="orphan", theme=self._theme()))
        detail = str(ctx.exception.detail).lower()
        self.assertIn("provenance index", detail)
        self.assertIn("rolled back", detail)
        self.assertIn("no space left on device", detail)

    def test_a_failed_delete_index_write_is_an_actionable_500_not_a_traceback(self):
        from fastapi import HTTPException

        self.api.import_skin(self.api.ImportRequest(name="victim", theme=self._theme()))
        self._break_index_write()
        with self.assertRaises(HTTPException) as ctx:
            self.api.delete_skin("victim")
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertIn("index", str(ctx.exception.detail).lower())

    def test_a_failed_rename_index_write_puts_the_file_back(self):
        from fastapi import HTTPException

        self.api.import_skin(self.api.ImportRequest(name="before", theme=self._theme()))
        self._break_index_write()
        with self.assertRaises(HTTPException) as ctx:
            self.api.rename_skin(self.api.RenameRequest(source="before", target="after"))
        self.assertEqual(ctx.exception.status_code, 500)

        skins = Path(self.home) / "skins"
        self.assertTrue((skins / "before.yaml").is_file(), "the rename must be rolled back")
        self.assertFalse((skins / "after.yaml").is_file())
        self.assertIn("before", self.api._read_index())


class EditorTestCase(BackendTestCase):
    """Shared setup for the E0/E1 editor routes."""

    def _import(self, name, description=None, theme=None):
        self.api.import_skin(
            self.api.ImportRequest(
                name=name,
                theme=theme
                or {"colors": {"background": "#101010", "foreground": "#eeeeee", "primary": "#ff0000"}},
                description=description or f"TweakCN {name}",
            )
        )

    def _seed_scene(self, scene, light=None, dark=None):
        """Write the gateway transport skins a built-in scene owns. They are both
        the proof the scene exists and the authored palette a Reset restores, so a
        temp tree is enough to exercise the whole override loop with no real
        <hermes home>/skins involvement."""
        skins = Path(self.home) / "skins"
        skins.mkdir(parents=True, exist_ok=True)
        light = light if light is not None else {"background": "#101010", "ui_accent": "#ff0000", "ui_text": "#eeeeee"}
        dark = dark if dark is not None else {"background": "#000000", "ui_accent": "#00ff00", "ui_text": "#dddddd"}
        for mode, palette in (("light", light), ("dark", dark)):
            (skins / f"theme-picker-{scene}-{mode}.yaml").write_text(
                self.api._dump_skin_yaml(
                    {
                        "name": f"theme-picker-{scene}-{mode}",
                        "description": f"transport {scene} {mode}",
                        "colors": palette,
                    }
                ),
                encoding="utf-8",
            )

    def _transport_colors(self, scene, mode):
        path = Path(self.home) / "skins" / f"theme-picker-{scene}-{mode}.yaml"
        return self.api._read_skin_file(path)["colors"]


class SchemaTests(EditorTestCase):
    """E0 — the schema is the pane's only source of what it may edit."""

    def test_reports_the_mode_pair(self):
        self.assertEqual(self.api.get_schema()["modes"], ["light", "dark"])

    def test_reports_exactly_the_writers_vocabulary(self):
        """The schema is the pane's contract, so it must name every colour the
        writer accepts - no more and, above all, no fewer. Ten keys made
        thirty-three named colours unreachable from the only editor that exists."""
        schema = self.api.get_schema()
        self.assertEqual(set(schema["paletteKeys"]), set(self.api.EDITABLE_SKIN_KEYS))
        self.assertEqual(len(schema["paletteKeys"]), 43, "a full skin carries 43 colours")
        self.assertEqual([r["id"] for r in schema["roles"]], list(self.api.EDITABLE_SKIN_KEYS))

    def test_groups_cover_every_key_exactly_once(self):
        schema = self.api.get_schema()
        groups = schema["groups"]
        self.assertEqual(len(groups), len({row[1] for row in self.api.EDITABLE_ROLES}))
        covered = [key for group in groups for key in group["keys"]]
        self.assertEqual(sorted(covered), sorted(schema["paletteKeys"]), "every key sits in a group")
        self.assertEqual(len(covered), len(set(covered)), "and in exactly one")

    def test_the_pane_can_reach_every_key_the_writer_accepts(self):
        """Two vocabularies, one of them on each side of the wire. If the pane's
        role table ever falls behind the writer again, this is the test that says so."""
        template = (Path(__file__).resolve().parent.parent
                    / "chroma" / "desktop" / "plugin.template.js").read_text(encoding="utf-8")
        start = template.index("const EDITOR_ROLES = [")
        end = template.index("\n]", start)
        block = template[start:end]
        pane_keys = set(re.findall(r"keys: \[([^\]]*)\]", block))
        flattened = set()
        for chunk in pane_keys:
            for key in re.findall(r"'([a-z_]+)'", chunk):
                flattened.add(key)
        self.assertEqual(flattened, set(self.api.EDITABLE_SKIN_KEYS),
                         "the editor's roles and the writer's vocabulary must agree")

    def test_keeps_the_size_caps_the_writer_enforces(self):
        caps = self.api.get_schema()["caps"]
        self.assertEqual(caps["maxColors"], self.api.MAX_THEME_COLORS)
        self.assertEqual(caps["maxBytes"], self.api.MAX_THEME_BYTES)


class IndexCategoryTests(EditorTestCase):
    """E0 — `label`/`category` are additive; old entries must still load."""

    def _write_skin(self, name):
        skins = Path(self.home) / "skins"
        skins.mkdir(parents=True, exist_ok=True)
        (skins / f"{name}.yaml").write_text(
            f"name: '{name}'\ncolors:\n  background: '#000000'\n", encoding="utf-8"
        )

    def test_an_entry_written_before_categories_existed_still_loads(self):
        self.api._write_index({"legacy": {"source": "chroma", "label": "Legacy"}})
        self._write_skin("legacy")
        self.assertEqual(self.api.list_chroma_skins()["skins"][0]["category"], "")

    def test_a_category_round_trips_through_the_index(self):
        self.api._write_index(
            {"categorised": {"source": "chroma", "label": "C", "category": "teal"}}
        )
        self._write_skin("categorised")
        self.assertEqual(self.api.list_chroma_skins()["skins"][0]["category"], "teal")

    def test_an_import_records_the_category_key(self):
        self._import("fresh")
        self.assertIn("category", self.api._read_index()["fresh"])


class SkinReadTests(EditorTestCase):
    """E1 — GET /skins/{name}: one owned skin's palette, both modes."""

    def test_reads_an_owned_skins_palette(self):
        self._import("mine")
        result = self.api.get_skin("mine")
        self.assertEqual(result["name"], "mine")
        self.assertEqual(result["light"]["background"], "#101010")
        self.assertIn("dark", result)

    def test_refuses_a_skin_chroma_does_not_own(self):
        from fastapi import HTTPException

        skins = Path(self.home) / "skins"
        skins.mkdir(parents=True, exist_ok=True)
        (skins / "handmade.yaml").write_text("name: 'handmade'\n", encoding="utf-8")
        with self.assertRaises(HTTPException) as ctx:
            self.api.get_skin("handmade")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_refuses_a_builtin(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.get_skin("nord")
        self.assertEqual(ctx.exception.status_code, 409)


class SkinWriteTests(EditorTestCase):
    """E1 — PUT /skins/{name}: the skin-keyed writer."""

    def test_a_user_skin_round_trips(self):
        self._import("mine")
        written = self.api.put_skin(
            "mine", self.api.ScenePaletteRequest(light={"ui_accent": "#abcdef"})
        )
        self.assertTrue(written["ok"])
        self.assertEqual(written["light"]["ui_accent"], "#abcdef")
        self.assertEqual(self.api.get_skin("mine")["light"]["ui_accent"], "#abcdef")

    def test_refuses_a_builtin_and_names_the_override_route(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.put_skin("nord", self.api.ScenePaletteRequest(light={"background": "#000000"}))
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("/overrides/nord", str(ctx.exception.detail))

    def test_a_transport_scene_is_a_409_naming_the_override_route(self):
        """A scene that exists only as a gateway transport is not a name
        Chroma owns, but it is not unknown either: PUT /skins/{name} is the
        wrong door, and the refusal must name the right one (§19.2 item 3)."""
        from fastapi import HTTPException

        self._seed_scene("aurora")  # a transport scene, not a CORE name
        with self.assertRaises(HTTPException) as ctx:
            self.api.put_skin("aurora", self.api.ScenePaletteRequest(light={"ui_accent": "#abcdef"}))
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("/overrides/aurora", str(ctx.exception.detail))
        self.assertIn("DELETE /overrides/aurora", str(ctx.exception.detail))

    def test_a_genuinely_unknown_name_is_still_a_404(self):
        from fastapi import HTTPException

        self._seed_scene("aurora")
        with self.assertRaises(HTTPException) as ctx:
            self.api.put_skin("no-such-skin", self.api.ScenePaletteRequest(light={"ui_accent": "#abcdef"}))
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertIn("no-such-skin", str(ctx.exception.detail))

    def test_refuses_an_unknown_role_by_name(self):
        from fastapi import HTTPException

        self._import("mine")
        with self.assertRaises(HTTPException) as ctx:
            self.api.put_skin("mine", self.api.ScenePaletteRequest(light={"favourite": "#abcdef"}))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("'favourite'", str(ctx.exception.detail))

    def test_refuses_a_bad_colour_and_names_the_value(self):
        from fastapi import HTTPException

        self._import("mine")
        with self.assertRaises(HTTPException) as ctx:
            self.api.put_skin("mine", self.api.ScenePaletteRequest(light={"ui_accent": "not-a-colour"}))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn(repr("not-a-colour"), str(ctx.exception.detail))

    def test_refuses_an_over_cap_body(self):
        from fastapi import HTTPException

        self._import("mine")
        wide = {f"role{i}": "#101010" for i in range(self.api.MAX_THEME_COLORS + 1)}
        with self.assertRaises(HTTPException) as ctx:
            self.api.put_skin("mine", self.api.ScenePaletteRequest(light=wide))
        self.assertEqual(ctx.exception.status_code, 413)

    def test_never_persists_a_corrupt_index_as_empty(self):
        """The 8a06221 defect: a lenient read of a corrupt index, written back."""
        from fastapi import HTTPException

        self._import("keepme")
        path = self.api._index_path()
        truncated = '{"keepme": {"source": "chroma"'
        path.write_text(truncated, encoding="utf-8")
        with self.assertRaises(HTTPException) as ctx:
            self.api.put_skin("keepme", self.api.ScenePaletteRequest(light={"ui_accent": "#abcdef"}))
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertEqual(path.read_text(encoding="utf-8"), truncated, "the index must be untouched")

    def test_a_failed_index_write_rolls_the_skin_file_back(self):
        from fastapi import HTTPException

        self._import("victim")
        target = Path(self.home) / "skins" / "victim.yaml"
        before = target.read_text(encoding="utf-8")

        def boom(index):
            raise OSError(28, "No space left on device")

        self.api._write_index = boom
        with self.assertRaises(HTTPException) as ctx:
            self.api.put_skin("victim", self.api.ScenePaletteRequest(light={"ui_accent": "#abcdef"}))
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertEqual(target.read_text(encoding="utf-8"), before, "the rewrite must be rolled back")


class OverrideTests(EditorTestCase):
    """E1 — GET/PUT/DELETE /overrides/{scene}: the built-in override record."""

    def setUp(self):
        super().setUp()
        self._seed_scene("nous")

    def test_get_overrides_starts_empty(self):
        listing = self.api.list_overrides()
        self.assertEqual(listing["count"], 0)
        self.assertEqual(listing["overrides"], {})

    def test_an_override_round_trips_and_is_reported(self):
        result = self.api.put_override("nous", self.api.OverrideRequest(light={"ui_accent": "#123456"}))
        self.assertTrue(result["ok"])
        self.assertEqual(result["scene"], "nous")

        listing = self.api.list_overrides()
        self.assertEqual(listing["count"], 1)
        self.assertEqual(listing["overrides"]["nous"]["light"], {"ui_accent": "#123456"})

    def test_only_the_named_roles_change(self):
        result = self.api.put_override("nous", self.api.OverrideRequest(light={"ui_accent": "#123456"}))
        self.assertEqual(result["light"]["ui_accent"], "#123456", "the override wins")
        self.assertEqual(result["light"]["background"], "#101010", "everything else stays authored")

    def test_the_transport_skin_is_re_minted_from_the_effective_palette(self):
        self.api.put_override("nous", self.api.OverrideRequest(light={"ui_accent": "#123456"}))
        colors = self._transport_colors("nous", "light")
        self.assertEqual(colors["ui_accent"], "#123456", "the CLI must follow the edit")
        self.assertEqual(colors["background"], "#101010", "roles not overridden keep their authored value")

    def test_reset_restores_the_authored_transport_and_drops_the_record(self):
        self.api.put_override("nous", self.api.OverrideRequest(light={"ui_accent": "#123456"}))
        result = self.api.delete_override("nous")
        self.assertTrue(result["reset"])

        self.assertEqual(self._transport_colors("nous", "light")["ui_accent"], "#ff0000", "authored is restored")
        self.assertEqual(self.api.list_overrides()["count"], 0, "the record is gone")

    def test_reset_is_per_skin(self):
        self._seed_scene("ember")
        self.api.put_override("nous", self.api.OverrideRequest(light={"ui_accent": "#123456"}))
        self.api.put_override("ember", self.api.OverrideRequest(light={"ui_accent": "#654321"}))
        self.api.delete_override("nous")

        listing = self.api.list_overrides()
        self.assertNotIn("nous", listing["overrides"])
        self.assertIn("ember", listing["overrides"], "a reset must not touch a neighbour")
        self.assertEqual(self._transport_colors("ember", "light")["ui_accent"], "#654321")

    def test_refuses_an_unknown_scene_by_name(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.put_override("no-such-scene", self.api.OverrideRequest(light={"ui_accent": "#123456"}))
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertIn("no-such-scene", str(ctx.exception.detail))

    def test_refuses_an_unknown_role_by_name(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.put_override("nous", self.api.OverrideRequest(light={"favourite": "#123456"}))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("'favourite'", str(ctx.exception.detail))

    def test_refuses_a_bad_colour_and_names_the_value(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.put_override("nous", self.api.OverrideRequest(light={"ui_accent": "chartreuse"}))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn(repr("chartreuse"), str(ctx.exception.detail))

    def test_refuses_an_override_that_changes_nothing(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.put_override("nous", self.api.OverrideRequest())
        self.assertEqual(ctx.exception.status_code, 400)

    def test_refuses_an_over_cap_body(self):
        from fastapi import HTTPException

        wide = {f"role{i}": "#101010" for i in range(self.api.MAX_THEME_COLORS + 1)}
        with self.assertRaises(HTTPException) as ctx:
            self.api.put_override("nous", self.api.OverrideRequest(light=wide))
        self.assertEqual(ctx.exception.status_code, 413)

    def test_accepts_the_body_the_pane_actually_sends(self):
        """The editor sends one primary skin key per role, which includes
        `status_bar_bg` (the Surface role). Refusing it by name would break the
        editor, so it is part of the accepted vocabulary."""
        result = self.api.put_override(
            "nous",
            self.api.OverrideRequest(
                light={
                    "background": "#010203",
                    "banner_text": "#111111",
                    "status_bar_bg": "#040506",
                    "ui_accent": "#ff00ff",
                    "ui_border": "#222222",
                },
            ),
        )
        self.assertEqual(result["light"]["status_bar_bg"], "#040506")
        self.assertEqual(result["light"]["ui_accent"], "#ff00ff")

    def test_refuses_a_path_traversal_scene(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            self.api.put_override("../escape", self.api.OverrideRequest(light={"ui_accent": "#123456"}))

    def test_does_not_persist_over_a_corrupt_overrides_file(self):
        """The overrides file is user data, so it gets the same strict read as the
        index: a write over a corrupt file must never persist {}."""
        from fastapi import HTTPException

        path = self.api._overrides_path()
        truncated = '{"nous": {"light": {'
        path.write_text(truncated, encoding="utf-8")
        with self.assertRaises(HTTPException) as ctx:
            self.api.put_override("nous", self.api.OverrideRequest(light={"ui_accent": "#123456"}))
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertEqual(path.read_text(encoding="utf-8"), truncated, "the file must be untouched")

    def test_a_failed_mint_leaves_the_previous_override_untouched(self):
        from fastapi import HTTPException

        self.api.put_override("nous", self.api.OverrideRequest(light={"ui_accent": "#123456"}))
        stored = self.api._overrides_path().read_text(encoding="utf-8")

        def boom(scene, mode, palette):
            raise OSError(28, "No space left on device")

        self.api._mint_transport = boom
        with self.assertRaises(HTTPException) as ctx:
            self.api.put_override("nous", self.api.OverrideRequest(light={"ui_accent": "#abcdef"}))
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertEqual(
            self.api._overrides_path().read_text(encoding="utf-8"),
            stored,
            "a failed PUT must leave the stored override exactly as it was",
        )


class DuplicateTests(EditorTestCase):
    """E2 — POST /skins/duplicate forks a palette; the server resolves nothing."""

    def _dup(self, **kw):
        return self.api.duplicate_skin(self.api.DuplicateRequest(**kw))

    def test_forks_a_palette_into_a_first_class_skin(self):
        self._import("source-skin")
        result = self._dup(
            to="copy-of-source",
            label="My Copy",
            light={"background": "#101010", "ui_accent": "#ff0000"},
            dark={"background": "#000000"},
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["name"], "copy-of-source")

        target = Path(result["path"])
        self.assertTrue(target.is_file())
        yaml = __import__("yaml")
        parsed = yaml.safe_load(target.read_text(encoding="utf-8"))
        self.assertEqual(parsed["name"], "copy-of-source")
        self.assertEqual(parsed["description"], "My Copy")
        self.assertEqual(parsed["colors"]["ui_accent"], "#ff0000")
        self.assertEqual(parsed["dark_colors"]["background"], "#000000")

        index = self.api._read_index()
        self.assertIn("copy-of-source", index)
        self.assertEqual(index["copy-of-source"]["source"], "user")
        self.assertIsNone(index["copy-of-source"]["pack"])
        self.assertTrue(index["copy-of-source"]["importedAt"])

    def test_the_new_skin_is_readable_through_get_skin(self):
        self._dup(to="readable", light={"background": "#123456"})
        self.assertEqual(self.api.get_skin("readable")["light"]["background"], "#123456")

    def test_refuses_collision_with_an_owned_skin(self):
        from fastapi import HTTPException

        self._import("taken")
        with self.assertRaises(HTTPException) as ctx:
            self._dup(to="taken", light={"background": "#000000"})
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("taken", str(ctx.exception.detail))

    def test_refuses_collision_with_a_core_name(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self._dup(to="nord", light={"background": "#000000"})
        self.assertEqual(ctx.exception.status_code, 409)

    def test_refuses_a_bad_slug(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self._dup(to="../escape", light={"background": "#000000"})
        self.assertEqual(ctx.exception.status_code, 400)

    def test_refuses_an_unknown_role_by_name(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self._dup(to="unknown-role", light={"favourite": "#123456"})
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("'favourite'", str(ctx.exception.detail))

    def test_refuses_a_bad_hex_and_names_the_value(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self._dup(to="bad-hex", light={"ui_accent": "not-a-colour"})
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn(repr("not-a-colour"), str(ctx.exception.detail))

    def test_resolves_nothing_a_light_only_request_writes_no_dark_keys(self):
        """The server must not read the source scene to fill in a dark palette."""
        result = self._dup(to="light-only", light={"background": "#abcdef"})
        body = Path(result["path"]).read_text(encoding="utf-8")
        self.assertNotIn("dark_colors", body)
        parsed = __import__("yaml").safe_load(body)
        self.assertNotIn("dark_colors", parsed)
        self.assertEqual(parsed["colors"]["background"], "#abcdef")

    def test_an_absent_role_in_a_supplied_palette_stays_absent(self):
        result = self._dup(to="sparse", light={"background": "#abcdef"})
        parsed = __import__("yaml").safe_load(Path(result["path"]).read_text(encoding="utf-8"))
        self.assertEqual(set(parsed["colors"]), {"background"})


class PackTestCase(EditorTestCase):
    """Shared bundle builders for the E3 pack routes."""

    def _bundle(self, name="Test Pack", skins=None, author="tester"):
        return {
            "chroma_pack": 1,
            "name": name,
            "author": author,
            "created": "2026-10-18T00:00:00+00:00",
            "categories": [],
            "skins": skins if skins is not None else [],
        }

    def _entry(self, name, background="#101010", ui_accent="#ff0000"):
        return {
            "name": name,
            "label": f"Label {name}",
            "light": {"background": background, "ui_accent": ui_accent},
            "dark": {"background": "#000000", "ui_accent": ui_accent},
        }


class PackExportTests(PackTestCase):
    def test_export_gathers_current_palettes_into_the_versioned_bundle(self):
        self._import("one")
        self._import("two")
        bundle = self.api.export_pack(
            self.api.PackExportRequest(name="Test Pack", members=["one", "two"], author="me")
        )
        self.assertEqual(
            set(bundle), {"chroma_pack", "name", "author", "created", "categories", "skins"}
        )
        self.assertEqual(bundle["chroma_pack"], 1)
        self.assertEqual(bundle["name"], "Test Pack")
        self.assertEqual(bundle["author"], "me")
        self.assertEqual(bundle["categories"], [])
        self.assertEqual([s["name"] for s in bundle["skins"]], ["one", "two"])

        editable = set(self.api.EDITABLE_SKIN_KEYS)
        for skin in bundle["skins"]:
            self.assertTrue(skin["label"])
            self.assertIn("background", skin["light"])
            self.assertIn("background", skin["dark"])
            self.assertTrue(set(skin["light"]) <= editable)
            self.assertTrue(set(skin["dark"]) <= editable)

    def test_export_writes_the_pack_record_so_it_appears_in_the_list(self):
        self._import("one")
        self.api.export_pack(self.api.PackExportRequest(name="Test Pack", members=["one"]))
        listing = self.api.list_packs()
        self.assertEqual(listing["count"], 1)
        row = listing["packs"][0]
        self.assertEqual(row["slug"], "test-pack")
        self.assertEqual(row["count"], 1)
        self.assertEqual(row["members"], ["one"])
        self.assertEqual(row["missing"], [])

    def test_export_refuses_a_missing_member_with_400_naming_it(self):
        from fastapi import HTTPException

        self._import("present")
        with self.assertRaises(HTTPException) as ctx:
            self.api.export_pack(self.api.PackExportRequest(name="P", members=["present", "gone"]))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("gone", str(ctx.exception.detail))

    def test_export_refuses_a_path_member(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.export_pack(self.api.PackExportRequest(name="P", members=["../escape"]))
        self.assertEqual(ctx.exception.status_code, 400)


class PackListTests(PackTestCase):
    def test_a_missing_member_is_reported_not_hidden(self):
        self._import("one")
        self._import("two")
        self.api.export_pack(self.api.PackExportRequest(name="Test Pack", members=["one", "two"]))
        (Path(self.home) / "skins" / "two.yaml").unlink()

        row = self.api.list_packs()["packs"][0]
        self.assertEqual(row["count"], 2)
        self.assertEqual(row["missing"], ["two"])

    def test_a_malformed_pack_file_does_not_500_the_list(self):
        self._import("one")
        self.api.export_pack(self.api.PackExportRequest(name="Good Pack", members=["one"]))
        (self.api._packs_dir() / "broken.json").write_text("{ not json", encoding="utf-8")

        listing = self.api.list_packs()
        self.assertEqual(listing["count"], 2)
        self.assertEqual({p["slug"] for p in listing["packs"]}, {"good-pack", "broken"})
        broken = [p for p in listing["packs"] if p["slug"] == "broken"][0]
        self.assertTrue(broken.get("unreadable"))


class PackImportTests(PackTestCase):
    def test_preview_reports_new_and_writes_nothing(self):
        result = self.api.import_pack(
            self.api.PackImportRequest(**self._bundle(skins=[self._entry("brand-new")]), dryRun=True)
        )
        self.assertTrue(result["dryRun"])
        self.assertEqual(result["skins"][0]["status"], "new")
        self.assertEqual(result["skins"][0]["resolved"], "brand-new")
        self.assertFalse((Path(self.home) / "skins" / "brand-new.yaml").exists())

    def test_preview_reports_identical_for_matching_palettes(self):
        self._import("existing")
        light, dark = self.api._skin_palettes(Path(self.home) / "skins" / "existing.yaml")
        bundle = self._bundle(skins=[{"name": "existing", "label": "E", "light": light, "dark": dark}])
        result = self.api.import_pack(self.api.PackImportRequest(**bundle, dryRun=True))
        self.assertEqual(result["skins"][0]["status"], "identical")

    def test_preview_reports_collides_with_a_resolved_name(self):
        self._import("existing")
        bundle = self._bundle(skins=[self._entry("existing", background="#010203")])
        result = self.api.import_pack(self.api.PackImportRequest(**bundle, dryRun=True))
        self.assertEqual(result["skins"][0]["status"], "collides")
        self.assertEqual(result["skins"][0]["resolved"], "existing-2")

    def test_confirm_imports_the_pack_and_records_provenance(self):
        bundle = self._bundle(
            name="My Pack", skins=[self._entry("alpha"), self._entry("beta")]
        )
        result = self.api.import_pack(self.api.PackImportRequest(**bundle))
        self.assertEqual(sorted(result["imported"]), ["alpha", "beta"])
        for name in ("alpha", "beta"):
            self.assertTrue((Path(self.home) / "skins" / f"{name}.yaml").is_file())

        index = self.api._read_index()
        self.assertEqual(index["alpha"]["source"], "user")
        self.assertEqual(index["alpha"]["pack"], "my-pack")
        self.assertEqual([p["slug"] for p in self.api.list_packs()["packs"]], ["my-pack"])

    def test_identical_skins_are_skipped_not_rewritten(self):
        self._import("existing")
        path = Path(self.home) / "skins" / "existing.yaml"
        before = path.read_text(encoding="utf-8")
        light, dark = self.api._skin_palettes(path)
        bundle = self._bundle(skins=[{"name": "existing", "label": "E", "light": light, "dark": dark}])
        result = self.api.import_pack(self.api.PackImportRequest(**bundle))
        self.assertEqual(result["skipped"], ["existing"])
        self.assertEqual(result["imported"], [])
        self.assertEqual(path.read_text(encoding="utf-8"), before)

    def test_confirm_refuses_an_unresolved_collision_and_writes_nothing(self):
        from fastapi import HTTPException

        self._import("existing")
        bundle = self._bundle(
            skins=[self._entry("fresh"), self._entry("existing", background="#010203")]
        )
        with self.assertRaises(HTTPException) as ctx:
            self.api.import_pack(self.api.PackImportRequest(**bundle))
        self.assertEqual(ctx.exception.status_code, 409)
        # The transaction rolled back the earlier skin in the same bundle.
        self.assertFalse((Path(self.home) / "skins" / "fresh.yaml").exists())

    def test_refuses_a_wrong_format_version(self):
        from fastapi import HTTPException

        bundle = self._bundle(skins=[self._entry("x")])
        bundle["chroma_pack"] = 2
        with self.assertRaises(HTTPException) as ctx:
            self.api.import_pack(self.api.PackImportRequest(**bundle))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("chroma_pack", str(ctx.exception.detail))

    def test_refuses_an_unknown_role_by_name(self):
        from fastapi import HTTPException

        bundle = self._bundle(
            skins=[{"name": "bad", "label": "B", "light": {"favourite": "#123456"}, "dark": {}}]
        )
        with self.assertRaises(HTTPException) as ctx:
            self.api.import_pack(self.api.PackImportRequest(**bundle))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("'favourite'", str(ctx.exception.detail))
        self.assertFalse((Path(self.home) / "skins" / "bad.yaml").exists())

    def test_refuses_a_path_in_a_name(self):
        from fastapi import HTTPException

        bundle = self._bundle(
            skins=[{"name": "../escape", "label": "B", "light": {"background": "#101010"}, "dark": {}}]
        )
        with self.assertRaises(HTTPException) as ctx:
            self.api.import_pack(self.api.PackImportRequest(**bundle))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_a_failed_index_write_rolls_the_whole_import_back(self):
        from fastapi import HTTPException

        skins = Path(self.home) / "skins"
        skins.mkdir(parents=True, exist_ok=True)
        before_files = sorted(p.name for p in skins.glob("*.yaml"))
        index_path = self.api._index_path()
        before_index = index_path.read_text(encoding="utf-8") if index_path.is_file() else None

        bundle = self._bundle(skins=[self._entry("alpha"), self._entry("beta")])

        def boom(index):
            raise OSError(28, "No space left on device")

        self.api._write_index = boom
        with self.assertRaises(HTTPException) as ctx:
            self.api.import_pack(self.api.PackImportRequest(**bundle))
        self.assertEqual(ctx.exception.status_code, 500)

        self.assertEqual(sorted(p.name for p in skins.glob("*.yaml")), before_files)
        after_index = index_path.read_text(encoding="utf-8") if index_path.is_file() else None
        self.assertEqual(after_index, before_index)
        self.assertEqual(self.api.list_packs()["count"], 0)


class PackDeleteTests(PackTestCase):
    def _export_two(self):
        self._import("one")
        self._import("two")
        self.api.export_pack(self.api.PackExportRequest(name="Test Pack", members=["one", "two"]))
        return "test-pack"

    def test_record_only_leaves_the_members_untouched(self):
        slug = self._export_two()
        result = self.api.delete_pack(slug)
        self.assertTrue(result["ok"])
        self.assertEqual(result["removedSkins"], [])
        self.assertTrue((Path(self.home) / "skins" / "one.yaml").is_file())
        self.assertTrue((Path(self.home) / "skins" / "two.yaml").is_file())
        self.assertEqual(self.api.list_packs()["count"], 0)

    def test_with_skins_trashes_every_member(self):
        slug = self._export_two()
        result = self.api.delete_pack(slug, withSkins=True)
        self.assertEqual(sorted(result["removedSkins"]), ["one", "two"])
        for name in ("one", "two"):
            self.assertFalse((Path(self.home) / "skins" / f"{name}.yaml").is_file())
        trash = list((Path(self.home) / "skins" / ".chroma" / "_trash").glob("*.yaml"))
        self.assertEqual(len(trash), 2, "members must be trashed, never unlinked")
        self.assertEqual(self.api._read_index(), {})
        self.assertEqual(self.api.list_packs()["count"], 0)

    def test_unknown_slug_is_a_404(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.delete_pack("nope")
        self.assertEqual(ctx.exception.status_code, 404)


class CategoryStoreTests(EditorTestCase):
    """E4 — the user category store: create, list, delete, and the closed built-in set."""

    def _mkcat(self, cid="", title="My Category"):
        return self.api.create_category(self.api.CategoryCreateRequest(id=cid, title=title))

    def test_create_list_delete_round_trip(self):
        created = self._mkcat("cyber-noir", "Cyber Noir")
        self.assertTrue(created["ok"])
        self.assertEqual(created["id"], "cyber-noir")
        self.assertEqual(created["title"], "Cyber Noir")

        listing = self.api.list_categories()
        self.assertEqual(listing["count"], 1)
        self.assertEqual(listing["categories"][0]["id"], "cyber-noir")
        self.assertEqual(listing["categories"][0]["title"], "Cyber Noir")

        removed = self.api.delete_category("cyber-noir")
        self.assertTrue(removed["removed"])
        self.assertEqual(self.api.list_categories()["count"], 0)

    def test_order_is_deterministic_and_after_the_builtins(self):
        for i in range(3):
            self._mkcat(f"cat-{i}", f"Cat {i}")
        listing = self.api.list_categories()
        self.assertEqual([c["id"] for c in listing["categories"]], ["cat-0", "cat-1", "cat-2"])
        base = len(self.api.BUILTIN_CATEGORY_IDS)
        self.assertEqual([c["order"] for c in listing["categories"]], [base, base + 1, base + 2])

    def test_order_survives_a_reload(self):
        self._mkcat("a", "A")
        self._mkcat("b", "B")
        # Re-read from disk (a fresh read, not the in-memory append).
        on_disk = self.api._read_categories()
        self.assertEqual([c["id"] for c in on_disk], ["a", "b"])

    def test_refuses_a_builtin_id_on_create(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self._mkcat("teal", "Cool")
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("teal", str(ctx.exception.detail))
        self.assertIn("built-in", str(ctx.exception.detail))

    def test_refuses_a_builtin_id_on_delete(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.delete_category("teal")
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("teal", str(ctx.exception.detail))

    def test_refuses_a_duplicate_id(self):
        from fastapi import HTTPException

        self._mkcat("dup", "One")
        with self.assertRaises(HTTPException) as ctx:
            self._mkcat("dup", "Two")
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("dup", str(ctx.exception.detail))
        self.assertIn("already exists", str(ctx.exception.detail))

    def test_refuses_an_empty_title(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self._mkcat("", "   ")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("title", str(ctx.exception.detail))

    def test_refuses_an_id_that_cannot_reduce_to_a_slug(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self._mkcat("!!!", "Escape")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_normalises_a_messy_id_to_a_slug(self):
        """The brief says normalise the id to a slug; only an id that reduces to
        nothing is refused. `../escape` normalises to `escape`, it is not rejected."""
        created = self._mkcat("../escape", "Escape")
        self.assertEqual(created["id"], "escape")

    def test_slugifies_an_id_from_the_title_when_omitted(self):
        created = self._mkcat("", "Neon Nights")
        self.assertEqual(created["id"], "neon-nights")

    def test_a_missing_store_lists_as_empty(self):
        self.assertEqual(self.api.list_categories()["count"], 0)

    def test_a_corrupt_store_fails_a_writer_loudly(self):
        """The mirror of the index test: a corrupt file must abort a write, not be
        silently overwritten with a fresh list."""
        from fastapi import HTTPException

        path = self.api._categories_path()
        truncated = '{"categories": [{"id": "broken"'
        path.write_text(truncated, encoding="utf-8")
        with self.assertRaises(HTTPException) as ctx:
            self._mkcat("fresh", "Fresh")
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertEqual(path.read_text(encoding="utf-8"), truncated, "the file must be untouched")

    def test_a_corrupt_store_does_not_500_the_listing(self):
        path = self.api._categories_path()
        path.write_text("{ not json", encoding="utf-8")
        listing = self.api.list_categories()
        self.assertEqual(listing["count"], 0)
        self.assertEqual(listing["categories"], [])

    def test_delete_of_an_absent_category_is_a_404(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.delete_category("ghost")
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertIn("ghost", str(ctx.exception.detail))

    def test_deleting_a_category_leaves_every_skin_file_byte_identical(self):
        self._import("alpha")
        self._import("beta")
        self._mkcat("keep", "Keep")
        self.api.put_skin("alpha", self.api.ScenePaletteRequest(category="keep"))

        skins_dir = Path(self.home) / "skins"
        before = {p.name: p.read_bytes() for p in skins_dir.glob("*.yaml")}

        self.api.delete_category("keep")

        after = {p.name: p.read_bytes() for p in skins_dir.glob("*.yaml")}
        self.assertEqual(before, after, "a category delete must not touch a skin file")

    def test_the_builtin_list_matches_the_pane(self):
        """The drift pin: the backend's copy of the 12 ids must equal the pane's
        THEME_CATEGORIES. Reads the pane file read-only so the two cannot drift."""
        import re as _re

        pane = Path(__file__).resolve().parents[1] / "chroma" / "desktop" / "plugin.template.js"
        if not pane.is_file():
            self.skipTest("chroma/desktop/plugin.template.js is not present to pin against")
        text = pane.read_text(encoding="utf-8")
        match = _re.search(r"const THEME_CATEGORIES\s*=\s*\[(.*?)\]", text, _re.S)
        if not match:
            self.skipTest("THEME_CATEGORIES was not found in the pane template")
        pane_ids = _re.findall(r"id:\s*'([a-z0-9-]+)'", match.group(1))
        self.assertEqual(list(self.api.BUILTIN_CATEGORY_IDS), pane_ids)


class CategoryAssignmentTests(EditorTestCase):
    """E4 — the per-skin category assignment on PUT /skins/{name}."""

    def test_assigns_a_builtin_category_and_persists_it(self):
        self._import("mine")
        result = self.api.put_skin("mine", self.api.ScenePaletteRequest(category="teal"))
        self.assertEqual(result["category"], "teal")
        self.assertEqual(self.api._read_index()["mine"]["category"], "teal")

    def test_assigns_a_user_category(self):
        self._import("mine")
        self.api.create_category(self.api.CategoryCreateRequest(id="neon", title="Neon"))
        result = self.api.put_skin("mine", self.api.ScenePaletteRequest(category="neon"))
        self.assertEqual(result["category"], "neon")

    def test_refuses_an_unknown_category_and_names_it(self):
        from fastapi import HTTPException

        self._import("mine")
        with self.assertRaises(HTTPException) as ctx:
            self.api.put_skin("mine", self.api.ScenePaletteRequest(category="no-such-cat"))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("no-such-cat", str(ctx.exception.detail))

    def test_empty_string_clears_a_previously_set_category(self):
        self._import("mine")
        self.api.put_skin("mine", self.api.ScenePaletteRequest(category="teal"))
        result = self.api.put_skin("mine", self.api.ScenePaletteRequest(category=""))
        self.assertEqual(result["category"], "")
        self.assertEqual(self.api._read_index()["mine"]["category"], "")

    def test_a_category_only_write_is_a_real_write(self):
        """A request carrying only a category must not be refused by the
        "nothing to write" guard."""
        self._import("mine")
        result = self.api.put_skin("mine", self.api.ScenePaletteRequest(category="teal"))
        self.assertTrue(result["ok"])

    def test_a_write_that_changes_nothing_at_all_is_still_refused(self):
        from fastapi import HTTPException

        self._import("mine")
        with self.assertRaises(HTTPException) as ctx:
            self.api.put_skin("mine", self.api.ScenePaletteRequest())
        self.assertEqual(ctx.exception.status_code, 400)

    def test_get_skin_reports_the_stored_category(self):
        self._import("mine")
        self.api.put_skin("mine", self.api.ScenePaletteRequest(category="teal"))
        self.assertEqual(self.api.get_skin("mine")["category"], "teal")

    def test_an_unknown_category_does_not_leave_a_half_write(self):
        from fastapi import HTTPException

        self._import("mine")
        before = self.api._read_index()["mine"]
        with self.assertRaises(HTTPException):
            self.api.put_skin("mine", self.api.ScenePaletteRequest(category="ghost"))
        self.assertEqual(self.api._read_index()["mine"], before)


class CategoryImportTests(PackTestCase):
    """E4 — pack import creates the bundle's categories in the same transaction."""

    def _bundle_with_cats(self, cats, skins=None):
        bundle = self._bundle(skins=skins or [self._entry("packskin")])
        bundle["categories"] = cats
        return bundle

    def test_import_creates_the_bundles_categories(self):
        bundle = self._bundle_with_cats([{"id": "noir", "title": "Noir"}])
        result = self.api.import_pack(self.api.PackImportRequest(**bundle))
        self.assertIn("noir", result["categories"])
        listing = self.api.list_categories()
        self.assertEqual([c["id"] for c in listing["categories"]], ["noir"])
        self.assertEqual(listing["categories"][0]["title"], "Noir")

    def test_reimport_is_idempotent(self):
        bundle = self._bundle_with_cats([{"id": "noir", "title": "Noir"}])
        self.api.import_pack(self.api.PackImportRequest(**bundle))
        bundle2 = self._bundle_with_cats([{"id": "noir", "title": "Noir"}], skins=[self._entry("second")])
        self.api.import_pack(self.api.PackImportRequest(**bundle2))
        listing = self.api.list_categories()
        self.assertEqual(listing["count"], 1, "a re-import must not duplicate a category")

    def test_a_retitled_category_updates_in_place(self):
        bundle = self._bundle_with_cats([{"id": "noir", "title": "Noir"}])
        self.api.import_pack(self.api.PackImportRequest(**bundle))
        bundle2 = self._bundle_with_cats([{"id": "noir", "title": "Noir Deluxe"}], skins=[self._entry("second")])
        result = self.api.import_pack(self.api.PackImportRequest(**bundle2))
        self.assertIn("noir", result["categories"])
        listing = self.api.list_categories()
        self.assertEqual(listing["count"], 1)
        self.assertEqual(listing["categories"][0]["title"], "Noir Deluxe")

    def test_dry_run_does_not_write_categories(self):
        bundle = self._bundle_with_cats([{"id": "noir", "title": "Noir"}])
        result = self.api.import_pack(self.api.PackImportRequest(**bundle, dryRun=True))
        self.assertTrue(result["dryRun"])
        self.assertEqual(self.api.list_categories()["count"], 0)

    def test_a_builtin_collision_is_refused(self):
        from fastapi import HTTPException

        bundle = self._bundle_with_cats([{"id": "teal", "title": "Cool"}])
        with self.assertRaises(HTTPException) as ctx:
            self.api.import_pack(self.api.PackImportRequest(**bundle))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("teal", str(ctx.exception.detail))

    def test_a_failed_import_leaves_the_store_unchanged(self):
        """The category is created first, then the colliding skin aborts the import:
        the rollback must remove the category too."""
        from fastapi import HTTPException

        self._import("existing")
        bundle = self._bundle_with_cats(
            [{"id": "noir", "title": "Noir"}],
            skins=[self._entry("existing", background="#010203")],
        )
        with self.assertRaises(HTTPException) as ctx:
            self.api.import_pack(self.api.PackImportRequest(**bundle))
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(self.api.list_categories()["count"], 0, "the category must be rolled back")

    def test_a_malformed_category_entry_is_refused(self):
        from fastapi import HTTPException

        bundle = self._bundle_with_cats([{"id": "", "title": "Nameless"}])
        with self.assertRaises(HTTPException) as ctx:
            self.api.import_pack(self.api.PackImportRequest(**bundle))
        self.assertEqual(ctx.exception.status_code, 400)


class SchemaCategoryTests(EditorTestCase):
    """E4 — /schema publishes the built-in category ids and the typography keys."""

    def test_schema_lists_the_builtin_category_ids(self):
        self.assertEqual(
            self.api.get_schema()["categories"], list(self.api.BUILTIN_CATEGORY_IDS)
        )

    def test_schema_typography_keys_are_ordered(self):
        self.assertEqual(
            self.api.get_schema()["typography"],
            [{"id": "fontSans", "label": "Sans"}, {"id": "fontMono", "label": "Mono"}],
        )


class TypographyOverrideTests(EditorTestCase):
    """E5 — a font choice rides the existing overrides store."""

    def setUp(self):
        super().setUp()
        self._seed_scene("nous")

    def test_a_typography_only_override_is_accepted(self):
        result = self.api.put_override(
            "nous", self.api.OverrideRequest(typography={"fontSans": "Georgia, serif"})
        )
        self.assertEqual(result["typography"], {"fontSans": "Georgia, serif"})
        self.assertEqual(
            self.api.list_overrides()["overrides"]["nous"]["typography"],
            {"fontSans": "Georgia, serif"},
        )

    def test_an_override_that_changes_neither_a_role_nor_a_font_is_refused(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.put_override("nous", self.api.OverrideRequest())
        self.assertEqual(ctx.exception.status_code, 400)

    def test_an_unknown_typography_key_is_refused_by_name(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.put_override("nous", self.api.OverrideRequest(typography={"fontSerif": "x"}))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("fontSerif", str(ctx.exception.detail))

    def test_an_empty_font_stack_is_refused(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.put_override("nous", self.api.OverrideRequest(typography={"fontSans": "   "}))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_an_over_long_font_stack_is_refused(self):
        from fastapi import HTTPException

        long_stack = "x" * (self.api.MAX_FONT_STACK_CHARS + 1)
        with self.assertRaises(HTTPException) as ctx:
            self.api.put_override("nous", self.api.OverrideRequest(typography={"fontSans": long_stack}))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_each_forbidden_character_is_refused(self):
        from fastapi import HTTPException

        for token in (";", "{", "}", "<", ">", "url("):
            with self.subTest(token=token):
                with self.assertRaises(HTTPException) as ctx:
                    self.api.put_override(
                        "nous", self.api.OverrideRequest(typography={"fontSans": f"Arial{token}x"})
                    )
                self.assertEqual(ctx.exception.status_code, 400)
                self.assertIn("fontSans", str(ctx.exception.detail))

    def test_a_typography_only_override_does_not_touch_the_transport_skins(self):
        """The "no minting" rule: a skin YAML carries colours, not fonts."""
        skins_dir = Path(self.home) / "skins"
        before = {p.name: p.read_bytes() for p in skins_dir.glob("theme-picker-nous-*.yaml")}
        self.api.put_override("nous", self.api.OverrideRequest(typography={"fontMono": "Menlo, monospace"}))
        after = {p.name: p.read_bytes() for p in skins_dir.glob("theme-picker-nous-*.yaml")}
        self.assertEqual(before, after, "a font-only edit must not re-mint a transport skin")

    def test_a_colour_and_typography_override_stores_both_and_mints(self):
        result = self.api.put_override(
            "nous",
            self.api.OverrideRequest(
                light={"ui_accent": "#123456"}, typography={"fontSans": "Georgia, serif"}
            ),
        )
        self.assertEqual(result["light"]["ui_accent"], "#123456")
        self.assertEqual(result["typography"], {"fontSans": "Georgia, serif"})
        self.assertEqual(self._transport_colors("nous", "light")["ui_accent"], "#123456")

    def test_delete_removes_the_typography_with_the_record(self):
        self.api.put_override("nous", self.api.OverrideRequest(typography={"fontSans": "Georgia, serif"}))
        self.api.delete_override("nous")
        self.assertEqual(self.api.list_overrides()["count"], 0)

    def test_only_the_keys_the_user_set_are_recorded(self):
        self.api.put_override("nous", self.api.OverrideRequest(typography={"fontSans": "Georgia, serif"}))
        record = self.api.list_overrides()["overrides"]["nous"]
        self.assertEqual(set(record["typography"]), {"fontSans"}, "an unset key is not recorded")


if __name__ == "__main__":
    unittest.main()
