#!/usr/bin/env python3
"""The package contract: what the manifest, the version and the build must agree on.

`hermes plugins validate chroma` is the admission gate a catalog reviewer runs, but the
Hermes CLI that carries it is not on PyPI yet (`hermes-agent` 0.19.0 ships
`plugins install|update|remove|list|enable|disable` and no `validate`), so CI
cannot run it. This script is the part of that gate we CAN own and run anywhere:
the facts about the package that must hold before anyone pins a commit and opens
a PR.

Run: python scripts/check-package.py    (exit 0 = the package agrees with itself)

The PACKAGE is the `chroma/` subdirectory, not the repo root. The root holds the
build inputs (`skins-v2/`), the version file and the dev tooling, and the catalog
entry pins the repo with `subdir: chroma`, so the host sparse-clones `chroma/`
alone. A path that silently lags here reports a broken package that is fine, or
worse, a fine package that is broken.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "chroma"

# Files that must never be tracked: the working notes a lane or a scan drops.
JUNK_PATTERNS = (
    re.compile(r"(^|/)scratch/"),
    re.compile(r"\.(orig|rej|bak|swp|log)$"),
    re.compile(r"~$"),
    re.compile(r"(^|/)rigour-(report|fix-packet)\.json$"),
    re.compile(r"(^|/)\.(rigour|serena|briefs)/"),
    re.compile(r"(^|/)(__pycache__|\.pytest_cache|node_modules)/"),
)

MANIFEST_FIELDS = ("name", "version", "description", "author", "license", "homepage", "requires_hermes")


def fail(problems: list[str], message: str) -> None:
    problems.append(message)


def read_yaml_flat(path: Path) -> dict[str, str]:
    """A flat read of the manifest's top-level scalars. PyYAML is not always present."""
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$", line)
        if match:
            out[match.group(1)] = match.group(2).strip().strip('"').strip("'")
    return out


def main() -> int:
    problems: list[str] = []

    version_file = ROOT / "VERSION"
    if not version_file.exists():
        fail(problems, "VERSION is missing")
        print("\n".join(problems))
        return 1
    version = version_file.read_text(encoding="utf-8").strip()

    if not PACKAGE.is_dir():
        print(f"FAIL: the package directory is missing: {PACKAGE}")
        return 1

    # 1. Every version locus agrees. A catalog entry pins ONE sha, so a tree whose
    #    manifest and build disagree ships the wrong number to every user.
    manifest = PACKAGE / "plugin.yaml"
    if not manifest.exists():
        fail(problems, "plugin.yaml is missing")
        fields: dict[str, str] = {}
    else:
        fields = read_yaml_flat(manifest)
        if fields.get("version") != version:
            fail(problems, f"plugin.yaml version {fields.get('version')!r} != VERSION {version!r}")
        for field in MANIFEST_FIELDS:
            if not fields.get(field):
                fail(problems, f"plugin.yaml is missing a value for {field!r}")
        if fields.get("name") != "chroma":
            fail(problems, f"plugin.yaml name {fields.get('name')!r} must be 'chroma' (the install folder name)")

    dashboard_manifest = PACKAGE / "dashboard" / "manifest.json"
    if not dashboard_manifest.exists():
        fail(problems, "dashboard/manifest.json is missing")
    else:
        try:
            data = json.loads(dashboard_manifest.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            fail(problems, f"dashboard/manifest.json does not parse: {error}")
            data = {}
        if data.get("version") != version:
            fail(problems, f"dashboard/manifest.json version {data.get('version')!r} != VERSION {version!r}")

    # 2. The entry points the manifest promises exist.
    for relative in ("desktop/plugin.js", "dashboard/plugin_api.py"):
        if not (PACKAGE / relative).exists():
            fail(problems, f"entry point {relative} is missing")

    # 3. The COMMITTED build carries the shipped version. plugin.js is committed
    #    because the installer loads it: a build stamped with an older version is
    #    a user reading the wrong number off the pane.
    build = PACKAGE / "desktop" / "plugin.js"
    if build.exists():
        stamp = re.search(r"const BUILD_STAMP = '([^']+)'", build.read_text(encoding="utf-8", errors="replace"))
        if not stamp:
            fail(problems, "desktop/plugin.js carries no BUILD_STAMP")
        elif stamp.group(1) != version:
            fail(problems, f"desktop/plugin.js BUILD_STAMP {stamp.group(1)!r} != VERSION {version!r}")
        if "export default {" in build.read_text(encoding="utf-8", errors="replace"):
            pass  # the loader's contract: the build exports the plugin object

    # 4. Nothing that should never ship is TRACKED. `.gitignore` hides these from
    #    `git status`; a file added before the ignore line still needs removing.
    try:
        tracked = subprocess.run(
            ["git", "ls-files"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            check=False,
        ).stdout.splitlines()
    except OSError:
        tracked = []
        fail(problems, "git is not available: the tracked-file check could not run")
    for name in tracked:
        for pattern in JUNK_PATTERNS:
            if pattern.search(name):
                fail(problems, f"{name} is tracked but must never ship")
                break

    # 5. The catalogue is present in the shape the build reads.
    skins = sorted((ROOT / "skins-v2").glob("*.yaml"))
    if not skins:
        fail(problems, "skins-v2/ holds no skins")

    # 6. The transport contract: a rest() body must be a PLAIN OBJECT.
    #    The host IPC bridge (desktop/electron/main.ts) runs JSON.stringify on
    #    options.body itself, so a plugin that pre-stringifies sends a JSON
    #    *string literal* on the wire and every write is refused 422
    #    (model_attributes_type). This reached the Captain's desktop once; the
    #    check exists so it cannot reach another.
    for name in ("desktop/plugin.template.js", "desktop/plugin.js"):
        path = PACKAGE / name
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for n, line in enumerate(text.splitlines(), 1):
            if re.search(r"\bbody:\s*JSON\.stringify\s*\(", line):
                fail(problems, f"{name}:{n} pre-stringifies a rest() body; "
                               "pass a plain object — the bridge serialises it")

    if problems:
        print(f"FAIL: {len(problems)} problem(s) in the package contract")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    # The count the host's 400-file cap actually sees: every file under the
    # package except the cache/venv dirs tools/plugin_guard.py skips. Reporting
    # the raw rglob count here would overstate it with untracked __pycache__.
    excluded = {".git", "__pycache__", "node_modules", ".venv", "venv",
                ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox"}
    package_files = 0
    for path in PACKAGE.rglob("*"):
        parts = path.relative_to(PACKAGE).parts
        if not any(part in excluded for part in parts) and path.is_file():
            package_files += 1
    print(f"OK: package contract holds at {version} ({len(skins)} skins, "
          f"{package_files} package files, {len(tracked)} tracked files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
