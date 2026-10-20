"""Backend data-integrity and hostile-input tests (review lane B).

These cover the findings the backend review raised against `dashboard/plugin_api.py`:

  M1   a failed rename restored the PATH but not the BYTES, so the skin's `name:`
       no longer matched its filename and the CLI listed it under a name it could
       not load (falling back to the default palette).
  M2   `_yaml_scalar` wrote control characters verbatim, so a label carrying a
       newline, a `---` marker or a NUL produced a file the Hermes engine cannot
       parse -- the skin vanished from the CLI while the import reported success.
  m1   `DELETE /packs/{slug}?withSkins=true` trashed skins Chroma does not own.
  m2   one non-UTF-8 skin file 500'd `GET /export` (all) and `GET /skins/{name}`.
  m3   the editor DISPLAYS `light_colors` but the writer merged over `colors`, so
       a save silently replaced a divergent light palette.
  m4   a non-string colour value was silently replaced by a default, contradicting
       `_hex`'s own contract.
  m5   `HERMES_HOME` was captured at import time, so a `?profile=` request wrote to
       the launch profile's home.
  m10  `TweakcnColorMap` was declared and never referenced.
  m11  a skin name longer than the filesystem's limit was a 500, not a 400.

The last class proves the review's NEGATIVES still hold: no backend path destroys
user data irreversibly, a hand-written skin survives every delete/rename path,
deletes move to a recoverable trash, a corrupt index is quarantined before a
refusal, and every write is atomic.

Run them with:

    python -m pytest tests/test_backend_data_integrity.py -q

`CHROMA_API_PATH` points the suite at a different revision of the backend (e.g. a
copy of the pinned file) so a fix can be shown FAILING against the unfixed code
and passing against the fix. HERMES_HOME is rebound to a temp directory, so every
path helper resolves inside it and never touches the real Hermes home.
"""

from __future__ import annotations

import ast
import contextvars
import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

import yaml

API_PATH = Path(
    os.environ.get("CHROMA_API_PATH")
    or (Path(__file__).resolve().parents[1] / "dashboard" / "plugin_api.py")
)


def load_api(hermes_home: Path):
    spec = importlib.util.spec_from_file_location("chroma_plugin_api_data_integrity", API_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    # The module-level override is the ONLY thing that keeps a test run away from
    # the real <hermes home>; every path helper must honour it.
    module.HERMES_HOME = hermes_home
    return module


class BackendTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)
        self.api = load_api(self.home)

    def tearDown(self):
        self._tmp.cleanup()

    # --- helpers ----------------------------------------------------------

    def skins_dir(self) -> Path:
        return Path(self.home) / "skins"

    def ensure_skins_dir(self) -> Path:
        d = self.skins_dir()
        d.mkdir(parents=True, exist_ok=True)
        return d

    def skin_path(self, name: str) -> Path:
        return self.skins_dir() / f"{name}.yaml"

    def trash_dir(self) -> Path:
        return self.skins_dir() / ".chroma" / "_trash"

    def import_skin(self, name: str = "before", description: str | None = None):
        self.api.import_skin(
            self.api.ImportRequest(
                name=name,
                theme={
                    "colors": {
                        "background": "#101010",
                        "foreground": "#eeeeee",
                        "primary": "#ff0000",
                    }
                },
                description=description if description is not None else f"TweakCN {name}",
            )
        )

    def own(self, name: str, label: str = "owned") -> None:
        """Give the index a provenance record for a file the test wrote by hand."""
        index = self.api._read_index()
        index[name] = {"source": "chroma", "label": label, "category": "", "importedAt": "2026-10-20T00:00:00+00:00"}
        self.api._write_index(index)

    def parsed(self, path: Path):
        """Parse a skin file the way the Hermes engine's parser does."""
        return yaml.safe_load(path.read_text(encoding="utf-8"))

    def assert_name_matches_filename(self, path: Path) -> None:
        """The invariant the CLI depends on.

        `skin_engine.list_skins` keys a skin by the `name:` field INSIDE the file,
        while `skin_engine.load_skin` opens `<skins>/<name>.yaml`. A file whose
        two disagree is listed under a name it cannot be loaded by."""
        parsed = self.parsed(path)
        self.assertIsInstance(parsed, dict, f"{path} must parse as a mapping")
        self.assertEqual(
            parsed.get("name"),
            path.stem,
            f"{path.name}: the file's name: field must match its filename",
        )

    def skin_bytes_anywhere(self, needle: bytes) -> bool:
        """Is these exact bytes on disk -- at a skin path or in the trash?"""
        if not self.skins_dir().is_dir():
            return False
        for path in self.skins_dir().rglob("*.yaml"):
            try:
                if path.read_bytes() == needle:
                    return True
            except OSError:
                continue
        return False

    def break_index_write(self, exc=None):
        exc = exc or OSError(28, "No space left on device")

        def boom(index):
            raise exc

        self.api._write_index = boom


# --- M1: a failed rename must restore the BYTES as well as the PATH ----------


class RenameRollbackTests(BackendTestCase):
    """M1 -- the rollback moved the file back but left the NEW name inside it.

    The engine lists a skin by the `name:` field and loads it by filename, so a
    half-renamed skin is listed under a name it cannot be loaded by: the user's
    theme silently reverts to the default palette while the picker still shows it.
    """

    def _break_index_write(self):
        def boom(index):
            raise OSError(28, "No space left on device")

        self.api._write_index = boom

    def test_a_failed_index_write_leaves_the_name_matching_the_filename(self):
        from fastapi import HTTPException

        self.import_skin("before")
        original = self.skin_path("before").read_bytes()
        self._break_index_write()

        with self.assertRaises(HTTPException) as ctx:
            self.api.rename_skin(self.api.RenameRequest(source="before", target="after"))
        self.assertEqual(ctx.exception.status_code, 500)

        self.assertTrue(self.skin_path("before").is_file(), "the rename must be rolled back")
        self.assertFalse(self.skin_path("after").exists())
        self.assert_name_matches_filename(self.skin_path("before"))
        self.assertEqual(
            self.skin_path("before").read_bytes(),
            original,
            "the rolled-back file must hold its original bytes, not the renamed ones",
        )

    def test_a_rollback_claim_is_backed_by_the_file_on_disk(self):
        """The error message says 'the rename was rolled back'. That claim is
        only true if the file on disk really is the skin it was."""
        from fastapi import HTTPException

        self.import_skin("before")
        self._break_index_write()

        with self.assertRaises(HTTPException) as ctx:
            self.api.rename_skin(self.api.RenameRequest(source="before", target="after"))

        detail = str(ctx.exception.detail).lower()
        if "rolled back" in detail:
            self.assert_name_matches_filename(self.skin_path("before"))
        else:
            self.assertTrue(
                self.skin_path("before").is_file() or self.skin_path("after").is_file(),
                "a rename that was not rolled back must still leave the skin on disk",
            )

    def test_the_skin_is_still_loadable_after_a_failed_rename(self):
        """The end-to-end consequence: the file's `name:` is what the CLI lists."""
        from fastapi import HTTPException

        self.import_skin("before")
        self._break_index_write()

        with self.assertRaises(HTTPException):
            self.api.rename_skin(self.api.RenameRequest(source="before", target="after"))

        listed = self.parsed(self.skin_path("before"))["name"]
        self.assertEqual(listed, "before")
        self.assertTrue((self.skins_dir() / f"{listed}.yaml").is_file())

    def test_a_successful_rename_still_names_the_new_file(self):
        self.import_skin("before")
        self.api.rename_skin(self.api.RenameRequest(source="before", target="after"))
        self.assertTrue(self.skin_path("after").is_file())
        self.assertFalse(self.skin_path("before").exists())
        self.assert_name_matches_filename(self.skin_path("after"))

    def test_renaming_an_unreadable_skin_names_the_file_and_moves_nothing(self):
        """A file that is not UTF-8 cannot be rewritten, and the error says so
        instead of crashing the endpoint — and nothing moves."""
        from fastapi import HTTPException

        self.ensure_skins_dir()
        path = self.skin_path("latin")
        path.write_bytes("name: 'latin'\ndescription: 'caf\xe9'\n".encode("latin-1"))
        self.own("latin")

        with self.assertRaises(HTTPException) as ctx:
            self.api.rename_skin(self.api.RenameRequest(source="latin", target="renamed"))

        self.assertEqual(ctx.exception.status_code, 500)
        self.assertIn("latin", str(ctx.exception.detail))
        self.assertTrue(self.skin_path("latin").is_file())
        self.assertFalse(self.skin_path("renamed").exists())


# --- M2: control characters in a skin label ----------------------------------


class ControlCharacterTests(BackendTestCase):
    """M2 -- a label is human text, so a control character in one is a mistake or
    an attack, never intent.

    The policy is REFUSE, not sanitise: silently rewriting a user's label would
    hide the very thing the user needs to see, and a refusal cannot lose intent.
    The refusal is a 400 that names the offending character.
    """

    CONTROL_LABELS = (
        ("newline", "line one\nline two"),
        ("carriage return", "line one\rline two"),
        ("nul", "nul\x00here"),
        ("tab", "tab\there"),
        ("delete", "del\x7fhere"),
        ("document marker", "--- injected\nname: 'pwned'"),
    )

    def test_a_description_with_a_control_character_is_refused(self):
        from fastapi import HTTPException

        for what, label in self.CONTROL_LABELS:
            with self.assertRaises(HTTPException, msg=what) as ctx:
                self.import_skin("hostile", description=label)
            self.assertEqual(ctx.exception.status_code, 400, what)
            self.assertFalse(self.skin_path("hostile").exists(), what)
            self.assertEqual(self.api._read_index(), {}, what)

    def test_a_bundle_label_with_a_control_character_is_refused(self):
        from fastapi import HTTPException

        bundle = {
            "chroma_pack": 1,
            "name": "Hostile Pack",
            "author": "tester",
            "created": "2026-10-20T00:00:00+00:00",
            "categories": [],
            "skins": [
                {
                    "name": "hostile",
                    "label": "evil\nname: 'pwned'",
                    "light": {"background": "#101010"},
                    "dark": {"background": "#000000"},
                }
            ],
        }
        with self.assertRaises(HTTPException) as ctx:
            self.api.import_pack(self.api.PackImportRequest(**bundle))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertFalse(self.skin_path("hostile").exists())
        self.assertEqual(self.api._read_index(), {})

    def test_a_bundle_label_with_a_control_character_is_refused_in_the_preview(self):
        """The preview writes nothing, so it is where the user learns the bundle
        is broken -- before they confirm an import that would corrupt a file."""
        from fastapi import HTTPException

        bundle = {
            "chroma_pack": 1,
            "name": "Hostile Pack",
            "author": "tester",
            "created": "2026-10-20T00:00:00+00:00",
            "categories": [],
            "skins": [
                {
                    "name": "hostile",
                    "label": "evil\x00here",
                    "light": {"background": "#101010"},
                    "dark": {"background": "#000000"},
                }
            ],
        }
        with self.assertRaises(HTTPException) as ctx:
            self.api.import_pack(self.api.PackImportRequest(**bundle, dryRun=True))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_a_duplicate_label_with_a_control_character_is_refused(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.duplicate_skin(
                self.api.DuplicateRequest(
                    to="forked",
                    label="evil\nname: 'pwned'",
                    light={"background": "#101010"},
                )
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertFalse(self.skin_path("forked").exists())

    def test_a_description_with_a_control_character_is_refused_on_a_save(self):
        from fastapi import HTTPException

        self.import_skin("mine")
        with self.assertRaises(HTTPException) as ctx:
            self.api.put_skin(
                "mine", self.api.ScenePaletteRequest(description="evil\x00here")
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_a_label_with_a_document_marker_alone_is_accepted_and_still_parses(self):
        """`---` on its own is not a control character: inside a single-quoted
        scalar it is just text. The refusal is for control characters, not for
        punctuation."""
        self.import_skin("marker", description="--- not a document marker")
        parsed = self.parsed(self.skin_path("marker"))
        self.assertEqual(parsed["description"], "--- not a document marker")
        self.assertEqual(parsed["name"], "marker")

    def test_every_written_skin_file_parses_and_names_itself(self):
        """The property that matters: whatever label arrives, the file the
        backend leaves on disk is one the engine can read."""
        from fastapi import HTTPException

        for label in ("plain", "---", "a\nb", "x\x00y", "--- injected\nname: 'pwned'"):
            with self.subTest(label=repr(label)):
                try:
                    self.import_skin("probe", description=label)
                except HTTPException as exc:
                    self.assertEqual(exc.status_code, 400, repr(label))
                    continue
                path = self.skin_path("probe")
                self.assertTrue(path.is_file())
                self.assert_name_matches_filename(path)
                path.unlink()
                self.api._write_index({})


# --- m1: a pack delete must not trash skins Chroma does not own --------------


class PackDeleteOwnershipTests(BackendTestCase):
    """m1 -- `delete_skin` refuses anything without a provenance record ('both
    operations act only on skins Chroma owns'). The pack delete took the pack
    record's `members` list on trust and moved ANY matching skin to the trash."""

    def _write_pack(self, slug: str, members: list[str]) -> Path:
        packs = self.skins_dir() / ".chroma" / "packs"
        packs.mkdir(parents=True, exist_ok=True)
        record = packs / f"{slug}.json"
        record.write_text(
            json.dumps(
                {
                    "chroma_pack": 1,
                    "slug": slug,
                    "name": slug,
                    "author": "tester",
                    "created": "2026-10-20T00:00:00+00:00",
                    "members": members,
                    "categories": [],
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return record

    def test_a_skin_chroma_does_not_own_is_left_alone(self):
        self.ensure_skins_dir()
        mine = self.skin_path("my-own-skin")
        mine.write_text("name: 'my-own-skin'\ndescription: 'mine'\n", encoding="utf-8")
        original = mine.read_bytes()
        self._write_pack("my-pack", ["my-own-skin"])

        result = self.api.delete_pack("my-pack", withSkins=True)

        self.assertEqual(result["removedSkins"], [])
        self.assertTrue(mine.is_file(), "a skin Chroma does not own must not be trashed")
        self.assertEqual(mine.read_bytes(), original)

    def test_an_owned_member_is_still_trashed(self):
        self.import_skin("owned-member")
        self._write_pack("my-pack", ["owned-member"])

        result = self.api.delete_pack("my-pack", withSkins=True)

        self.assertEqual(result["removedSkins"], ["owned-member"])
        self.assertFalse(self.skin_path("owned-member").exists())
        self.assertTrue(
            any(self.trash_dir().glob("owned-member-*.yaml")),
            "the member must be in the recoverable trash",
        )

    def test_a_failed_index_write_puts_the_members_back(self):
        """The pack delete moved the members to the trash and THEN wrote the
        index. A failure in between left the skins gone from the CLI while the
        500 said only that the index could not be updated."""
        from fastapi import HTTPException

        self.import_skin("one")
        self.import_skin("two")
        before = {
            name: self.skin_path(name).read_bytes() for name in ("one", "two")
        }
        self._write_pack("my-pack", ["one", "two"])
        self.break_index_write()

        with self.assertRaises(HTTPException) as ctx:
            self.api.delete_pack("my-pack", withSkins=True)
        self.assertEqual(ctx.exception.status_code, 500)

        for name, needle in before.items():
            self.assertTrue(
                self.skin_path(name).is_file(),
                f"'{name}' must be back at its own path after a failed index write",
            )
            self.assertEqual(self.skin_path(name).read_bytes(), needle)


# --- m2: one unreadable skin file must not break the others -----------------


class UnreadableSkinFileTests(BackendTestCase):
    """m2 -- `UnicodeDecodeError` is a `ValueError`, not an `OSError`, so the
    `except OSError` guards did not catch it and one mis-encoded file 500'd the
    export of EVERY skin."""

    def _write_latin1_skin(self, name: str) -> Path:
        self.ensure_skins_dir()
        path = self.skin_path(name)
        path.write_bytes("name: 'bad'\ndescription: 'caf\xe9'\n".encode("latin-1"))
        self.own(name)
        return path

    def test_export_all_reports_the_unreadable_file_and_exports_the_rest(self):
        self.import_skin("good")
        self._write_latin1_skin("bad")

        result = self.api.export_skins()

        self.assertEqual(result["count"], 1)
        self.assertEqual([f["name"] for f in result["files"]], ["good"])
        self.assertTrue(
            result.get("unreadable"),
            "the export must name the file it could not read",
        )
        self.assertIn("bad", str(result["unreadable"]))

    def test_exporting_one_unreadable_skin_names_the_file(self):
        from fastapi import HTTPException

        self._write_latin1_skin("bad")
        with self.assertRaises(HTTPException) as ctx:
            self.api.export_skins("bad")
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertIn("bad", str(ctx.exception.detail))

    def test_reading_one_unreadable_skin_names_the_file(self):
        from fastapi import HTTPException

        self._write_latin1_skin("bad")
        with self.assertRaises(HTTPException) as ctx:
            self.api.get_skin("bad")
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertIn("bad", str(ctx.exception.detail))


# --- m3: the editor's merge base must be the palette it DISPLAYED -----------


class LightMergeBaseTests(BackendTestCase):
    """m3 -- `GET /skins/{name}` shows the `light_colors` palette, but
    `PUT /skins/{name}` merged the pane's edits over `colors` and wrote the
    result into BOTH. A save therefore replaced a divergent light palette with
    the shared one."""

    def _hand_authored_skin(self) -> None:
        self.ensure_skins_dir()
        self.skin_path("mine").write_text(
            self.api._dump_skin_yaml(
                {
                    "name": "mine",
                    "description": "hand authored",
                    "colors": {"background": "#111111", "ui_accent": "#00ff00"},
                    "light_colors": {
                        "background": "#222222",
                        "ui_accent": "#ff0000",
                        "selection_bg": "#333333",
                    },
                }
            ),
            encoding="utf-8",
        )
        self.own("mine")

    def test_the_editor_and_the_writer_agree_on_the_light_palette(self):
        self._hand_authored_skin()

        shown = self.api.get_skin("mine")["light"]
        self.assertEqual(shown["background"], "#222222")
        self.assertEqual(shown["selection_bg"], "#333333")

        self.api.put_skin("mine", self.api.ScenePaletteRequest(light={"ui_accent": "#abcdef"}))

        written = self.parsed(self.skin_path("mine"))
        self.assertEqual(written["light_colors"]["background"], "#222222")
        self.assertEqual(written["light_colors"]["selection_bg"], "#333333")
        self.assertEqual(written["light_colors"]["ui_accent"], "#abcdef")

    def test_a_save_keeps_every_role_the_editor_displayed(self):
        self._hand_authored_skin()
        shown = self.api.get_skin("mine")["light"]
        self.api.put_skin("mine", self.api.ScenePaletteRequest(light={"ui_accent": "#abcdef"}))
        written = self.parsed(self.skin_path("mine"))["light_colors"]
        for role, value in shown.items():
            if role == "ui_accent":
                continue
            self.assertEqual(written.get(role), value, role)


# --- m4: a supplied colour that is not a colour is an error ------------------


class NonStringColourTests(BackendTestCase):
    """m4 -- `_hex`'s docstring promises that a supplied-but-broken colour is an
    error, not a fallback. `_validate_colors` skipped every non-string, so a
    number became a default palette with a 200 OK."""

    def test_a_non_string_colour_is_refused_with_a_400(self):
        from fastapi import HTTPException

        for bad in (123456, True, ["#ffffff"], {"hex": "#ffffff"}):
            with self.subTest(value=repr(bad)):
                with self.assertRaises(HTTPException) as ctx:
                    self.api.import_skin(
                        self.api.ImportRequest(
                            name="numeric", theme={"colors": {"background": bad}}
                        )
                    )
                self.assertEqual(ctx.exception.status_code, 400)
                self.assertFalse(self.skin_path("numeric").exists())

    def test_an_absent_colour_is_still_a_fallback(self):
        """None means 'the caller did not supply this token' -- absence, not error."""
        result = self.api.import_skin(
            self.api.ImportRequest(name="sparse", theme={"colors": {"background": None}})
        )
        self.assertTrue(result["ok"])


# --- m5: the home is resolved per request ------------------------------------


class HomeResolutionTests(BackendTestCase):
    """m5 -- `hermes_constants.get_hermes_home()` is CONTEXT-LOCAL, and the host
    mounts this router with the profile dependency, so the home must be resolved
    per request. The module is imported once, so a home frozen at import time
    sends every profile's request to the launch profile's directory."""

    def _install_fake_hermes_constants(self):
        """A `hermes_constants` whose `get_hermes_home` reads a ContextVar.

        The host's real module is context-local for exactly this reason; the
        fake reproduces that shape without touching the real <hermes home>."""
        override = contextvars.ContextVar("hermes_home_probe", default=None)
        fake = types.ModuleType("hermes_constants")

        def get_hermes_home():
            return override.get() or str(self.home)

        fake.get_hermes_home = get_hermes_home
        original = sys.modules.get("hermes_constants")
        sys.modules["hermes_constants"] = fake
        self.addCleanup(
            lambda: sys.modules.__setitem__("hermes_constants", original)
            if original is not None
            else sys.modules.pop("hermes_constants", None)
        )
        return override

    def test_the_home_is_resolved_per_request_not_at_import(self):
        override = self._install_fake_hermes_constants()
        # No static override: the module must consult the host per call.
        self.api.HERMES_HOME = None

        other = Path(self.home) / "other-profile"
        override.set(other)
        self.assertEqual(self.api._skins_dir(), other / "skins")

        override.set(self.home)
        self.assertEqual(self.api._skins_dir(), self.home / "skins")

    def test_the_import_path_resolves_the_home_per_request_too(self):
        """Every path helper must go through `_home()`. One that read the raw
        module global would raise on the production default (None) and would
        write to the launch profile's directory."""
        override = self._install_fake_hermes_constants()
        self.api.HERMES_HOME = None

        other = Path(self.home) / "other-profile"
        override.set(other)
        self.api.import_skin(
            self.api.ImportRequest(
                name="scoped", theme={"colors": {"background": "#101010"}}
            )
        )
        self.assertTrue((other / "skins" / "scoped.yaml").is_file())
        self.assertFalse((self.home / "skins" / "scoped.yaml").exists())

    def test_the_static_override_still_wins(self):
        """The override is what keeps a test run (and an explicit deployment)
        away from the real <hermes home>."""
        self.assertEqual(self.api._skins_dir(), self.home / "skins")


# --- m10: no declared-but-unused request model -------------------------------


class DeadModelTests(BackendTestCase):
    """m10 -- `TweakcnColorMap` was declared and never referenced. It reads like
    the validated shape of the TweakCN payload; nothing validates against it."""

    def test_the_module_declares_no_model_nothing_uses(self):
        tree = ast.parse(API_PATH.read_text(encoding="utf-8"))
        declared = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                for base in node.bases:
                    if isinstance(base, ast.Name) and base.id == "BaseModel":
                        declared.add(node.name)
        used = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
        unused = sorted(name for name in declared if name not in used)
        self.assertEqual(
            unused,
            [],
            "a model nothing validates against is a lie about the import boundary",
        )


# --- m11: an over-long name is a 400, not a 500 ------------------------------


class LongNameTests(BackendTestCase):
    """m11 -- `_SLUG_RE` bounds the alphabet but not the LENGTH, so a
    300-character slug passed every guard and then failed in `mkstemp` with
    ENAMETOOLONG -- a 500 for what is really a bad input."""

    def test_an_over_long_skin_name_is_a_400(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.import_skin(self.api.ImportRequest(name="a" * 300, theme={}))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("long", str(ctx.exception.detail).lower())
        self.assertEqual(list(self.skins_dir().glob("*.yaml")), [])

    def test_the_name_limit_is_named_in_the_error(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.api.delete_skin("a" * 300)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("long", str(ctx.exception.detail).lower())

    def test_a_name_at_the_limit_is_accepted(self):
        limit = getattr(self.api, "MAX_SKIN_NAME_CHARS", 64)
        name = "a" * limit
        result = self.api.import_skin(self.api.ImportRequest(name=name, theme={}))
        self.assertTrue(result["ok"])


# --- the review's NEGATIVES: no backend path destroys user data --------------


class DataLossNegativesTests(BackendTestCase):
    """The review's verdict was that NOTHING here can irreversibly destroy user
    data. These prove it still holds, behaviourally rather than by assertion."""

    def test_a_hand_written_skin_survives_every_delete_and_rename_path(self):
        """The backend must never unlink or trash a skin it does not own."""
        from fastapi import HTTPException

        self.ensure_skins_dir()
        mine = self.skin_path("hand-written")
        mine.write_text("name: 'hand-written'\ndescription: 'mine'\n", encoding="utf-8")
        original = mine.read_bytes()

        # DELETE /skins/{name}
        with self.assertRaises(HTTPException):
            self.api.delete_skin("hand-written")
        # POST /skins/rename as the source
        with self.assertRaises(HTTPException):
            self.api.rename_skin(self.api.RenameRequest(source="hand-written", target="stolen"))
        # PUT /skins/{name}
        with self.assertRaises(HTTPException):
            self.api.put_skin("hand-written", self.api.ScenePaletteRequest(light={"background": "#000000"}))
        # DELETE /packs/{slug}?withSkins=true naming it
        packs = self.skins_dir() / ".chroma" / "packs"
        packs.mkdir(parents=True, exist_ok=True)
        (packs / "hand.json").write_text(
            json.dumps(
                {
                    "chroma_pack": 1,
                    "slug": "hand",
                    "name": "hand",
                    "author": "tester",
                    "created": "2026-10-20T00:00:00+00:00",
                    "members": ["hand-written"],
                    "categories": [],
                }
            ),
            encoding="utf-8",
        )
        self.api.delete_pack("hand", withSkins=True)

        self.assertTrue(mine.is_file(), "a skin Chroma does not own must survive")
        self.assertEqual(mine.read_bytes(), original)
        self.assertEqual(list(self.trash_dir().glob("hand-written-*.yaml")), [])

    def test_deletes_move_to_a_recoverable_trash(self):
        self.import_skin("doomed")
        original = self.skin_path("doomed").read_bytes()
        self.api.delete_skin("doomed")
        trashed = list(self.trash_dir().glob("doomed-*.yaml"))
        self.assertEqual(len(trashed), 1)
        self.assertEqual(trashed[0].read_bytes(), original, "the trash holds the skin's bytes")

    def test_a_corrupt_index_is_quarantined_before_a_refusal(self):
        from fastapi import HTTPException

        index_path = self.api._index_path()
        index_path.write_text("{ this is not json", encoding="utf-8")
        with self.assertRaises(HTTPException) as ctx:
            self.import_skin("doomed")
        self.assertEqual(ctx.exception.status_code, 500)
        backups = list(index_path.parent.glob("index.json.unreadable-*"))
        self.assertEqual(len(backups), 1, "the unreadable index must be copied aside")
        self.assertEqual(backups[0].read_text(encoding="utf-8"), "{ this is not json")

    def test_a_failed_write_leaves_the_target_untouched_and_no_temp_behind(self):
        self.ensure_skins_dir()
        path = self.skin_path("atomic")
        path.write_text("name: 'atomic'\n", encoding="utf-8")
        before = path.read_bytes()

        with mock.patch.object(self.api.os, "replace", side_effect=OSError(28, "No space left on device")):
            with self.assertRaises(OSError):
                self.api._atomic_write_text(path, "name: 'new'\n")

        self.assertEqual(path.read_bytes(), before, "a failed write must not touch the target")
        self.assertEqual(list(self.skins_dir().glob("*.tmp")), [])

    def test_no_failure_path_leaves_a_skin_unaccounted_for(self):
        """After every forced write failure the skin's bytes are either at their
        own path or in the recoverable trash -- never nowhere."""
        from fastapi import HTTPException

        self.import_skin("survivor")
        original = self.skin_path("survivor").read_bytes()

        # a failed IMPORT index write
        self.break_index_write()
        with self.assertRaises(HTTPException):
            self.api.import_skin(
                self.api.ImportRequest(name="second", theme={"colors": {"background": "#101010"}})
            )
        self.assertTrue(self.skin_bytes_anywhere(original), "the first skin must survive")

        # a failed RENAME index write
        self.api._write_index = lambda index: None
        self.api._write_index({"survivor": {"source": "chroma", "label": "survivor"}})
        self.break_index_write()
        with self.assertRaises(HTTPException):
            self.api.rename_skin(self.api.RenameRequest(source="survivor", target="renamed"))
        self.assertTrue(self.skin_bytes_anywhere(original), "the renamed skin must survive")

        # a failed SAVE index write
        self.api._write_index = lambda index: None
        self.api._write_index({"survivor": {"source": "chroma", "label": "survivor"}})
        self.break_index_write()
        with self.assertRaises(HTTPException):
            self.api.put_skin(
                "survivor", self.api.ScenePaletteRequest(light={"ui_accent": "#abcdef"})
            )
        self.assertTrue(self.skin_bytes_anywhere(original), "the saved skin must survive")


if __name__ == "__main__":
    unittest.main()
