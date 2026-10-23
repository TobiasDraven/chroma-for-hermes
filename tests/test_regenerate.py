import importlib.util
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml


SCRIPT = Path(__file__).parents[1] / 'scripts' / 'regenerate.py'
spec = importlib.util.spec_from_file_location('regenerate', SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError(f'Could not load {SCRIPT}')
regenerate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(regenerate)


# The tree under test. Defaults to this checkout, but an agent may point it at
# another tree - e.g. an archived commit extracted to a temp dir - to prove a
# guard FAILS against the old behaviour instead of asserting it in prose.
REPO_ROOT = Path(os.environ.get('CHROMA_REPO_ROOT', SCRIPT.parents[1]))


def _symlinks_supported() -> bool:
    """Windows refuses symlink creation without developer mode or the
    SeCreateSymbolicLinkPrivilege (OSError 1314), so a test that needs one must
    ask first instead of reporting an environment limit as a failure."""
    with tempfile.TemporaryDirectory() as probe:
        target = Path(probe) / 'target.txt'
        target.write_text('probe', encoding='utf-8')
        try:
            (Path(probe) / 'link.txt').symlink_to(target)
        except (OSError, NotImplementedError):
            return False
    return True


SYMLINKS_SUPPORTED = _symlinks_supported()

MACOS_ONLY = unittest.skipUnless(
    sys.platform == 'darwin',
    'the macOS installer is a .command shell script and cannot run on this host',
)


class ResolveHermesHomeTests(unittest.TestCase):
    def test_prefers_windows_localappdata_when_hermes_home_is_unset(self):
        home = regenerate.resolve_hermes_home(
            {'LOCALAPPDATA': r'C:\Users\Joshua\AppData\Local'},
            Path(r'C:\Users\Joshua'),
            platform_name='win32',
        )

        self.assertEqual(home, Path(r'C:\Users\Joshua\AppData\Local') / 'hermes')


class RegenerateSafetyTests(unittest.TestCase):
    def test_refuses_empty_or_malformed_bundle_before_mutating_outputs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir) / 'repo'
            scripts_dir = repo / 'scripts'
            scripts_dir.mkdir(parents=True)
            (scripts_dir / 'backend-builtins.json').write_bytes(
                (SCRIPT.parent / 'backend-builtins.json').read_bytes()
            )
            plugin_dir = repo / 'chroma' / 'desktop'
            plugin_dir.mkdir(parents=True)
            (plugin_dir / 'plugin.template.js').write_bytes(
                (SCRIPT.parents[1] / 'chroma' / 'desktop' / 'plugin.template.js').read_bytes()
            )
            gateway_dir = repo / 'gateway-skins'
            gateway_dir.mkdir()
            transport = gateway_dir / 'existing.yaml'
            output = plugin_dir / 'plugin.js'

            cases = {
                'empty': None,
                'invalid yaml': 'name: [unterminated',
                'missing palette': 'name: empty-palette\ncolors: {}\n',
                'symlink': 'symlink',
            }
            for label, contents in cases.items():
                with self.subTest(label=label):
                    for generated in gateway_dir.iterdir():
                        generated.unlink()
                    transport.write_text('name: existing\n', encoding='utf-8')
                    output.write_text('existing plugin', encoding='utf-8')
                    skins_dir = repo / 'skins'
                    skins_dir.mkdir(exist_ok=True)
                    malformed = skins_dir / 'broken.yaml'
                    malformed.unlink(missing_ok=True)
                    if contents == 'symlink':
                        if not SYMLINKS_SUPPORTED:
                            self.skipTest('this host cannot create symlinks')
                        regular_skin = repo / 'outside.yaml'
                        regular_skin.write_text(
                            'name: linked\ncolors:\n  background: "#000000"\n',
                            encoding='utf-8',
                        )
                        malformed.symlink_to(regular_skin)
                    elif contents is not None:
                        malformed.write_text(contents, encoding='utf-8')

                    with (
                        patch.object(regenerate, '__file__', str(scripts_dir / 'regenerate.py')),
                        patch.object(sys, 'argv', ['regenerate.py', str(skins_dir), str(output)]),
                    ):
                        result = regenerate.main()

                    self.assertEqual(result, 1)
                    self.assertEqual(output.read_text(encoding='utf-8'), 'existing plugin')
                    self.assertEqual(transport.read_text(encoding='utf-8'), 'name: existing\n')
                    self.assertEqual(list(gateway_dir.iterdir()), [transport])


class ThemeCatalogTests(unittest.TestCase):
    def test_desktop_builtins_are_the_expected_dynamic_scenes(self):
        scenes = regenerate._desktop_builtin_scenes()

        self.assertEqual(
            [scene['name'] for scene in scenes],
            ['nous', 'midnight', 'ember', 'mono', 'cyberpunk', 'rose', 'shadow-thief', 'hermes-teal'],
        )
        for scene in scenes:
            self.assertEqual(scene['modeSupport'], 'dynamic')
            self.assertIn('lightColors', scene)
            self.assertIn('darkColors', scene)

    def test_desktop_builtins_have_concrete_gateway_variant_names(self):
        scenes = regenerate._desktop_builtin_scenes()

        for scene in scenes:
            self.assertEqual(scene['gatewayLightName'], f"theme-picker-{scene['name']}-light")
            self.assertEqual(scene['gatewayDarkName'], f"theme-picker-{scene['name']}-dark")

    def _v2(self):
        return regenerate._load_v2_skins(SCRIPT.parents[1] / 'skins-v2')

    def test_every_skin_ships_a_matching_gateway_transport(self):
        gateway_dir = SCRIPT.parents[1] / 'gateway-skins'

        for skin in self._v2():
            for mode in ('light', 'dark'):
                transport_name = skin[f'gateway{mode.title()}Name']
                transport = regenerate._parse_skin_file(gateway_dir / f'{transport_name}.yaml')
                self.assertIsNotNone(transport, transport_name)
                self.assertEqual(transport['name'], transport_name)
                palette = skin[f'{mode}Colors']
                for role in ('background', 'ui_accent', 'ui_text'):
                    self.assertEqual(transport['colors'][role].lower(), palette[role].lower())

    def test_every_dynamic_variant_uses_a_unique_mode_locked_gateway_transport(self):
        repo = SCRIPT.parents[1]
        catalog = self._v2()
        names = []

        for skin in catalog:
            for mode in ('light', 'dark'):
                name = skin[f'gateway{mode.title()}Name']
                names.append(name)
                self.assertEqual(name, f"theme-picker-{skin['name']}-{mode}")
                transport = regenerate._parse_skin_file(repo / 'gateway-skins' / f'{name}.yaml')
                self.assertIsNotNone(transport, name)
                # Authored halves are compacted in one place and whole in the
                # other, so the invariant is the signature roles, not the length.
                for role in ('background', 'ui_accent', 'ui_text'):
                    self.assertEqual(transport['colors'][role], skin[f'{mode}Colors'][role], role)

        self.assertEqual(len(names), 2 * len(catalog))
        self.assertEqual(len(set(names)), len(names), 'every transport name is unique')
        self.assertEqual(len(list((repo / 'gateway-skins').glob('*.yaml'))), len(names))

    def test_every_catalog_scene_selects_a_gateway_resolvable_variant(self):
        repo = SCRIPT.parents[1]
        available = {path.stem for path in (repo / 'gateway-skins').glob('*.yaml')}

        for skin in self._v2():
            for mode in ('light', 'dark'):
                self.assertIn(
                    skin[f'gateway{mode.title()}Name'], available,
                    f"missing gateway {mode} transport for {skin['name']}",
                )

    def test_backend_builtins_are_pinned_without_importing_hermes(self):
        real_import = __import__

        def isolated_import(name, *args, **kwargs):
            if name.startswith('hermes_cli'):
                raise ImportError('hermes is intentionally unavailable')
            return real_import(name, *args, **kwargs)

        with patch('builtins.__import__', side_effect=isolated_import):
            builtins = regenerate._backend_builtins()

        self.assertEqual(
            [skin['name'] for skin in builtins],
            ['default', 'ares', 'mono', 'slate', 'daylight', 'warm-lightmode', 'poseidon', 'sisyphus', 'charizard'],
        )

    def test_updated_cliff_pack_has_fifty_complete_pairs(self):
        # The v1 single-palette pack (150 files under skins/) is RETIRED.
        # The build reads ONLY skins-v2/ (scripts/regenerate.py:765-768: "the
        # v1 pair table is retired and there is no fallback to it"), and the
        # published tree tracked 540 files - over the host's
        # MAX_PLUGIN_FILE_COUNT = 400 cap (tools/plugin_guard.py:106), a
        # standing scan finding on every install.
        #
        # I assert on the ABSENCE OF *.yaml FILES under skins/ rather than on
        # the absence of the directory itself: git does not track empty
        # directories, so an empty leftover skins/ can never reach the
        # published tree, while a single stray .yaml in it would put the
        # retired pack back into the shipped tree. The file-level check is
        # the one that carries the guarantee, and it also covers a
        # half-deleted directory.
        retired_dir = REPO_ROOT / 'skins'
        retired_files = []
        if retired_dir.is_dir():
            retired_files = sorted(
                path.relative_to(REPO_ROOT).as_posix()
                for path in retired_dir.rglob('*.yaml')
            )
        self.assertEqual(
            retired_files, [],
            f'the retired v1 pack must not ship: {retired_dir} still holds '
            f'{len(retired_files)} yaml file(s) (e.g. {retired_files[:3]})',
        )

        # The LIVE catalogue is the v2 dual-mode catalogue: one file per skin,
        # both palettes authored in the same file.
        catalogue = REPO_ROOT / 'skins-v2'
        self.assertTrue(
            catalogue.is_dir(),
            f'the live catalogue directory is missing: {catalogue}',
        )
        catalogue_files = sorted(catalogue.glob('*.yaml'))
        self.assertGreaterEqual(
            len(catalogue_files), 90,
            f'the live catalogue {catalogue} holds {len(catalogue_files)} yaml '
            'file(s); the v2 dual-mode catalogue must not shrink below 90',
        )

        # Every catalogue file must carry BOTH palettes, in the shape
        # regenerate._load_v2_skins requires: a mapping, schema_version 2 and
        # non-empty light_colors/dark_colors.
        for path in catalogue_files:
            data = yaml.safe_load(path.read_text(encoding='utf-8')) or {}
            self.assertIsInstance(data, dict, f'{path}: a skin file must be a mapping')
            self.assertEqual(
                data.get('schema_version'), 2,
                f'{path}: schema_version must be 2',
            )
            self.assertTrue(
                data.get('light_colors'),
                f'{path}: light_colors is required',
            )
            self.assertTrue(
                data.get('dark_colors'),
                f'{path}: dark_colors is required',
            )

        # THEME_PAIRS is the historical RECORD of the retired pack: the
        # canonical light/dark matches from CliffWade v1.1.0, which is what the
        # v2 migration folded the singles into. The table stays as provenance,
        # so the guarantee is that the record survives intact - 55 pairs, 110
        # distinct names. It is deliberately NOT a statement that those files
        # ship: the singles are retired, and their absence is asserted above.
        self.assertEqual(len(regenerate.THEME_PAIRS), 55, 'the vendored pack pair list')
        paired = {name for pair in regenerate.THEME_PAIRS for name in pair}
        self.assertEqual(len(paired), 110, 'two distinct skins per pair')

    def test_cliffwade_v1_1_0_files_match_the_pinned_hash_manifest(self):
        # The retired pack is gone from the tree, but its durable record is
        # not: scripts/cliffwade-v1.1.0-sha256.json pins the sha256 of every
        # file of the pack, and the pack itself stays recoverable from the
        # published commit 9439f41. This test is the recoverability proof - if
        # the archive stops resolving, the manifest is a list of hashes to
        # nothing and the retired pack is lost for good.
        manifest_path = REPO_ROOT / 'scripts' / 'cliffwade-v1.1.0-sha256.json'
        self.assertTrue(
            manifest_path.is_file(),
            f'the pinned hash manifest is missing: {manifest_path}',
        )
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))

        self.assertEqual(len(manifest), 100, f'{manifest_path} must pin 100 files')
        for name, expected_hash in manifest.items():
            self.assertTrue(
                name.endswith('.yaml'),
                f'{manifest_path}: key {name!r} must end with .yaml',
            )
            self.assertRegex(
                expected_hash, r'^[0-9a-f]{64}$',
                f'{manifest_path}: {name} must pin a 64-char lowercase sha256',
            )

        # The archive commit must resolve locally. A shallow clone (or a tree
        # extracted with git archive, which carries no .git) cannot serve it,
        # and the guard must say so rather than quietly passing.
        probe = subprocess.run(
            ['git', '-C', str(REPO_ROOT), 'rev-parse', '--verify', '--quiet',
             '9439f41^{commit}'],
            capture_output=True,
        )
        if probe.returncode != 0:
            self.fail(
                'the archive commit 9439f41 is not available in '
                f'{REPO_ROOT}: the retired v1 pack cannot be read back and this '
                'guard cannot be proven. Clone with full history '
                '(git fetch --unshallow) or fetch that commit '
                '(git fetch origin 9439f41), then re-run. '
                f'git said: {probe.stderr.decode("utf-8", "replace").strip()}'
            )

        for name, expected_hash in manifest.items():
            result = subprocess.run(
                ['git', '-C', str(REPO_ROOT), 'show', f'9439f41:skins/{name}'],
                capture_output=True,
            )
            self.assertEqual(
                result.returncode, 0,
                f'git show 9439f41:skins/{name} failed: '
                f'{result.stderr.decode("utf-8", "replace").strip()}',
            )
            actual_hash = hashlib.sha256(result.stdout).hexdigest()
            self.assertEqual(
                actual_hash, expected_hash,
                f'{name} read back from 9439f41 does not match the pinned hash',
            )
            data = yaml.safe_load(result.stdout.decode('utf-8'))
            self.assertIsInstance(data, dict, f'{name}: the recovered file must be a YAML mapping')
            self.assertEqual(
                data.get('name'), name[:-len('.yaml')],
                f'{name}: the recovered file declares a different name',
            )

    def test_daylight_and_warm_lightmode_are_light_only(self):
        self.assertEqual(regenerate._mode_support('daylight', True), 'light')
        self.assertEqual(regenerate._mode_support('warm-lightmode', True), 'light')

    def test_catalog_collapses_pairs_and_keeps_single_mode_skins(self):
        dark = {'name': 'dark-example', 'isDark': True, 'colors': {'background': '#111111'}}
        light = {'name': 'light-example', 'isDark': False, 'colors': {'background': '#eeeeee'}}
        single = {'name': 'only-dark', 'isDark': True, 'colors': {'background': '#000000'}}

        catalog = regenerate._build_catalog(
            [dark, light, single],
            [],
            pairs=[('dark-example', 'light-example')],
            desktop_builtins=[],
        )

        self.assertEqual([scene['name'] for scene in catalog], ['dark-example', 'only-dark'])
        self.assertEqual(catalog[0]['modeSupport'], 'dynamic')
        self.assertEqual(catalog[0]['darkName'], 'dark-example')
        self.assertEqual(catalog[0]['lightName'], 'light-example')
        # A skin shipped with one mode gets the other PORTED, so no dead
        # single-mode shelf survives and the mode toggle works on every card.
        # The port is flagged, so it is never mistaken for an authored palette.
        self.assertEqual(catalog[1]['modeSupport'], 'dynamic')
        self.assertTrue(catalog[1]['derivedLight'], 'the ported light palette is marked as derived')
        self.assertEqual(catalog[1]['darkColors']['background'], '#000000')


class WindowsRunnerTests(unittest.TestCase):
    def test_repo_ships_a_runner_that_preserves_bundled_and_installed_skins(self):
        runner = SCRIPT.parents[1] / 'chroma' / 'install' / 'regenerate-windows.ps1'
        source = runner.read_text(encoding='utf-8')

        self.assertIn("Join-Path $env:LOCALAPPDATA 'hermes'", source)
        self.assertIn("Join-Path $checkout 'skins-v2'", source)
        self.assertIn("scripts" + chr(92) + "regenerate.py", source)
        self.assertNotIn("Join-Path $hermesHome 'skins'", source,
                         'the runner must not feed retired gateway skins into the catalogue')


@MACOS_ONLY
class MacInstallerTests(unittest.TestCase):
    def test_installs_the_package_into_explicit_hermes_home(self):
        installer = SCRIPT.parents[1] / 'chroma' / 'install' / 'install-macos.command'
        source_plugin = SCRIPT.parents[1] / 'chroma' / 'desktop' / 'plugin.js'

        with tempfile.TemporaryDirectory() as temp_dir:
            hermes_home = Path(temp_dir) / 'custom-hermes-home'
            env = os.environ.copy()
            env['HERMES_HOME'] = str(hermes_home)

            result = subprocess.run(
                [str(installer)],
                check=True,
                capture_output=True,
                env=env,
                text=True,
            )

            # The package layout, not a lone plugin.js: Hermes refuses a plugin
            # directory without its manifest.
            package = hermes_home / 'plugins' / 'chroma'
            self.assertTrue((package / 'plugin.yaml').is_file())
            self.assertTrue((package / 'LICENSE').is_file())
            self.assertTrue((package / 'dashboard' / 'manifest.json').is_file())
            self.assertEqual((package / 'desktop' / 'plugin.js').read_bytes(),
                             source_plugin.read_bytes())
            self.assertIn(f'Installed Chroma into: {package}', result.stdout)

    def test_installs_the_package_into_default_home_when_hermes_home_is_unset(self):
        installer = SCRIPT.parents[1] / 'chroma' / 'install' / 'install-macos.command'
        source_plugin = SCRIPT.parents[1] / 'chroma' / 'desktop' / 'plugin.js'

        with tempfile.TemporaryDirectory() as temp_dir:
            home = Path(temp_dir) / 'home with spaces'
            env = os.environ.copy()
            env.pop('HERMES_HOME', None)
            env['HOME'] = str(home)

            subprocess.run(
                [str(installer)],
                check=True,
                capture_output=True,
                env=env,
                text=True,
            )

            package = home / '.hermes' / 'plugins' / 'chroma'
            self.assertTrue((package / 'plugin.yaml').is_file())
            self.assertEqual((package / 'desktop' / 'plugin.js').read_bytes(),
                             source_plugin.read_bytes())


class GatewaySkinInstallerTests(unittest.TestCase):
    def test_installs_bundled_and_transport_skins_into_gateway_home(self):
        repo = SCRIPT.parents[1]
        installer = repo / 'chroma' / 'install' / 'install-gateway-skins.sh'
        self.assertTrue(os.access(installer, os.X_OK))

        with tempfile.TemporaryDirectory() as temp_dir:
            hermes_home = Path(temp_dir) / 'gateway home'
            subprocess.run(
                ['sh', str(installer)],
                check=True,
                env={**os.environ, 'HERMES_HOME': str(hermes_home)},
                capture_output=True,
                text=True,
            )

            installed = hermes_home / 'skins'
            # Only the mode-locked transports install; the retired v1 pair table
            # stays in the repo and must never reach a gateway.
            expected = list((repo / 'gateway-skins').glob('*.yaml'))
            self.assertEqual(len(list(installed.glob('*.yaml'))), len(expected))
            for source in expected:
                self.assertEqual((installed / source.name).read_bytes(), source.read_bytes())

    def test_refuses_modified_collisions_unless_force_is_explicit(self):
        repo = SCRIPT.parents[1]
        installer = repo / 'chroma' / 'install' / 'install-gateway-skins.sh'

        with tempfile.TemporaryDirectory() as temp_dir:
            hermes_home = Path(temp_dir) / 'gateway'
            destination = hermes_home / 'skins'
            destination.mkdir(parents=True)
            collision = destination / 'theme-picker-alabaster-light.yaml'
            collision.write_text('name: theme-picker-alabaster-light\n# locally customized\n', encoding='utf-8')
            env = {**os.environ, 'HERMES_HOME': str(hermes_home)}

            refused = subprocess.run(
                ['sh', str(installer)],
                check=False,
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn('Refusing to overwrite modified gateway skins', refused.stderr)
            self.assertEqual(collision.read_text(encoding='utf-8'), 'name: theme-picker-alabaster-light\n# locally customized\n')

            subprocess.run(
                ['sh', str(installer), '--force'],
                check=True,
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(collision.read_bytes(), (repo / 'gateway-skins' / collision.name).read_bytes())

    @unittest.skipUnless(SYMLINKS_SUPPORTED, 'needs symlink creation privilege')
    def test_force_still_refuses_destination_symlinks(self):
        repo = SCRIPT.parents[1]
        installer = repo / 'chroma' / 'install' / 'install-gateway-skins.sh'

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            hermes_home = root / 'gateway'
            destination = hermes_home / 'skins'
            destination.mkdir(parents=True)
            outside = root / 'outside.yaml'
            outside.write_text('name: protected\n', encoding='utf-8')
            (destination / 'theme-picker-alabaster-light.yaml').symlink_to(outside)

            refused = subprocess.run(
                ['sh', str(installer), '--force'],
                check=False,
                env={**os.environ, 'HERMES_HOME': str(hermes_home)},
                capture_output=True,
                text=True,
            )

            self.assertNotEqual(refused.returncode, 0)
            self.assertIn('Refusing destination symlink', refused.stderr)
            self.assertEqual(outside.read_text(encoding='utf-8'), 'name: protected\n')


class RegeneratePreservesOverridesTests(unittest.TestCase):
    """§17.3.1 — a user override is USER DATA and must survive regeneration.

    Regeneration rebuilds chroma/desktop/plugin.js and the gateway transport skins from
    the authored catalogue. It must neither read the overrides file into the build
    (one person's taste shipped to everyone) nor delete it. This runs the real
    main() over a temp tree holding a populated overrides file and asserts the file
    is byte-identical afterwards, and that the override never reached the build.
    """

    def _build_temp_repo(self, root: Path) -> Path:
        repo = root / 'repo'
        scripts_dir = repo / 'scripts'
        scripts_dir.mkdir(parents=True)
        (scripts_dir / 'backend-builtins.json').write_bytes(
            (SCRIPT.parent / 'backend-builtins.json').read_bytes()
        )
        desktop = repo / 'chroma' / 'desktop'
        desktop.mkdir(parents=True)
        # A self-contained template, so this test does not depend on the contents
        # of the in-repo template (another lane owns that file).
        (desktop / 'plugin.template.js').write_text(
            'window.__CHROMA_CATALOG__ = __SKINS_DATA__;\n', encoding='utf-8'
        )
        skins = repo / 'skins-v2'
        skins.mkdir()
        (skins / 'mine.yaml').write_text(
            "schema_version: 2\n"
            "name: mine\n"
            "label: Mine\n"
            "description: Mine\n"
            "category: persimmon\n"
            "pack: core\n"
            "energy: vivid\n"
            "typography:\n  fontSans: Inter, sans-serif\n  fontMono: Consolas, monospace\n"
            "light_colors:\n"
            "  background: '#ffffff'\n  ui_text: '#111111'\n  ui_accent: '#ff0000'\n"
            "dark_colors:\n"
            "  background: '#101010'\n  ui_text: '#eeeeee'\n  ui_accent: '#ff0000'\n",
            encoding='utf-8',
        )
        (repo / 'gateway-skins').mkdir()
        (repo / 'docs').mkdir()
        return repo

    def test_regeneration_leaves_a_populated_overrides_file_byte_identical(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = self._build_temp_repo(Path(temp_dir))
            skins = repo / 'skins-v2'
            overrides = skins / '.chroma' / 'overrides.json'
            overrides.parent.mkdir(parents=True)
            payload = json.dumps(
                {
                    'nous': {
                        'light': {'ui_accent': '#abcdef'},
                        'dark': {},
                        'at': '2026-10-18T00:00:00+00:00',
                    }
                },
                indent=2,
                sort_keys=True,
            ) + '\n'
            overrides.write_text(payload, encoding='utf-8')
            before = overrides.read_bytes()

            out = repo / 'chroma' / 'desktop' / 'plugin.js'
            with (
                patch.object(regenerate, '__file__', str(repo / 'scripts' / 'regenerate.py')),
                patch.object(sys, 'argv', ['regenerate.py', str(skins), str(out)]),
            ):
                result = regenerate.main()

            self.assertEqual(result, 0, 'regeneration must succeed over a valid bundle')
            self.assertTrue(out.is_file())
            self.assertEqual(overrides.read_bytes(), before, 'the overrides file must be untouched')
            self.assertNotIn(
                '#abcdef',
                out.read_text(encoding='utf-8'),
                'a user override must never be read into the shipped build',
            )


if __name__ == '__main__':
    unittest.main()
