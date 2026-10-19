"""The skin contract: design_spec v1 is grandfathered, v2 must carry the ten.

A v2 skin is not "the 43 keys again". It is ten surfaces and two fonts; the rest
of the palette derives. This suite proves the gate says so out loud, so the
document and the checker cannot drift apart.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
SKINS = ROOT / "skins-v2"
SCRIPT = ROOT / "scripts" / "check-packs.py"

V2_SURFACES = (
    "background", "status_bar_bg", "ui_text", "banner_dim", "ui_accent",
    "ui_border", "ui_ok", "ui_warn", "ui_error", "selection_bg",
)


def run_check(directory: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--dir", str(directory)],
        capture_output=True, text=True, timeout=180,
    )


def test_every_shipped_skin_declares_a_design_spec():
    files = sorted(SKINS.glob("*.yaml"))
    assert len(files) >= 90, "the catalogue should be present"
    for path in files:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        assert data.get("design_spec") in {"v1", "v2"}, f"{path.name} has no design_spec"
        if data["design_spec"] == "v2":
            for mode in ("light_colors", "dark_colors"):
                for key in V2_SURFACES:
                    assert data[mode].get(key), f"{path.name}: v2 {mode} omits {key}"


def test_the_shipped_catalogue_passes_its_own_gate():
    result = run_check(SKINS)
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.fixture()
def one_skin(tmp_path: Path) -> Path:
    directory = tmp_path / "skins"
    directory.mkdir()
    source = SKINS / "dark-nord.yaml"
    shutil.copy(source, directory / source.name)
    return directory


def test_a_v2_skin_missing_a_surface_is_rejected(one_skin: Path):
    data = yaml.safe_load((one_skin / "dark-nord.yaml").read_text(encoding="utf-8"))
    data["design_spec"] = "v2"
    # v1 skins carry only the keys they needed; pick a surface this one has.
    surface = next(key for key in V2_SURFACES if key in data["light_colors"])
    del data["light_colors"][surface]
    (one_skin / "dark-nord.yaml").write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")

    result = run_check(one_skin)
    assert result.returncode == 1
    assert surface in result.stdout, "the gate must name the surface it wants"
    assert "v2 light_colors omits" in result.stdout


def test_an_unknown_design_spec_is_rejected(one_skin: Path):
    data = yaml.safe_load((one_skin / "dark-nord.yaml").read_text(encoding="utf-8"))
    data["design_spec"] = "v3"
    (one_skin / "dark-nord.yaml").write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")

    result = run_check(one_skin)
    assert result.returncode == 1
    assert "design_spec is 'v3'" in result.stdout


def test_a_v1_skin_may_keep_its_whole_hand_authored_palette(one_skin: Path):
    data = yaml.safe_load((one_skin / "dark-nord.yaml").read_text(encoding="utf-8"))
    assert data["design_spec"] == "v1"
    result = run_check(one_skin)
    # It still fails the catalogue-wide pack arithmetic - that is correct for a
    # one-skin directory - but nothing in the output may complain about colour.
    assert "omits" not in result.stdout
    assert "design_spec" not in result.stdout
