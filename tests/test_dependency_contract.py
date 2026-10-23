"""The zero-resolution dependency contract.

Installing Chroma must NEVER invoke a package resolver. The host decides
whether a plugin joins the uv workspace from two surfaces only:

* ``plugin.yaml`` - ``python_dependencies`` / ``pip_dependencies``
  (``pm/plugin_declarations.py:149-153``);
* a ``pyproject.toml`` at the plugin root - ``project.dependencies``
  (``pm/plugin_declarations.py:132-147``).

Both feed ``PythonDeclaration.install_requirements``; when it is empty AND
``python_runtime`` is ``"external"`` the declaration is not a workspace member
(``pm/plugin_declarations.py:63-72``), so there is no resolver run, no
"install deps" prompt, no uv lock and no frozen lockfile.

The dashboard half imports ``fastapi`` and ``pydantic``, which the HOST
already ships (``pyproject.toml:71,137``) - the bundled dashboard plugins
(kanban, hermes-achievements) do exactly the same and declare no
dependencies. Those are host-provided, not Chroma's to install.

This module is the permanent gate for that contract. It is deliberately
dependency-free: it parses the manifest and the sources as TEXT/AST and never
imports the plugin package (importing it would pull in FastAPI, which is
exactly what the contract forbids at install time).
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1] / "chroma"
MANIFEST_PATH = ROOT / "plugin.yaml"
AGENT_ENTRYPOINT = ROOT / "__init__.py"
DASHBOARD_API = ROOT / "dashboard" / "plugin_api.py"
INSTALL_DIR = ROOT / "install"

# Third-party packages the dashboard half is allowed to import. Both are
# host-provided (hermes-agent/pyproject.toml:71,137) and are used by the
# bundled dashboard plugins as well.
#   hermes_constants is a HOST ROOT MODULE (hermes-agent/hermes_constants.py),
#   shipped by the host's own distribution - not an installable dependency of
#   this plugin, so it is not a resolver concern either.
HOST_PROVIDED_PACKAGES = {"fastapi", "pydantic", "hermes_constants"}

# A PEP 508 requirement starts with a package name. This is checked on its own
# so the failure message names the actual defect (a bare version range such as
# ">=0.133.1,<0.134.0" is not a requirement, it is a specifier with no owner).
_PEP508_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*")

# Package-manager commands. "python -m pip" and its "py" launcher spelling are
# the same thing on Windows, and both appear in installer prose.
_PACKAGE_MANAGER_PATTERNS = (
    re.compile(r"\bpip3\b", re.IGNORECASE),
    re.compile(r"\bpip\s+install\b", re.IGNORECASE),
    re.compile(r"\buv\s+pip\b", re.IGNORECASE),
    re.compile(r"\buv\s+sync\b", re.IGNORECASE),
    re.compile(r"\bnpm\s+install\b", re.IGNORECASE),
    re.compile(r"\bnpm\s+i(?=\s|$)", re.IGNORECASE),
    re.compile(r"\bconda\s+install\b", re.IGNORECASE),
    re.compile(r"\bpoetry\s+add\b", re.IGNORECASE),
    re.compile(r"\bpython(?:\d(?:\.\d+)?)?\s+-m\s+pip\b", re.IGNORECASE),
    re.compile(r"\bpy\s+-m\s+pip\b", re.IGNORECASE),
)

# Quoted spans are blanked before the "is this EXECUTED?" question is asked.
_QUOTED_SPAN = re.compile(r"'[^']*'|\"[^\"]*\"")

# A package-manager command that survives only inside a quoted message is not
# an invocation - it is prose. Each such line must be allowlisted EXACTLY, so
# that editing it re-arms the gate instead of quietly widening it.
#   install/regenerate-windows.ps1 tells the user how to satisfy PyYAML for the
#   regenerator. The throw never runs a package manager. That file belongs to
#   another lane, so the line is allowlisted rather than edited here.
_ALLOWED_QUOTED_MENTIONS = {
    (
        "install/regenerate-windows.ps1",
        "throw 'PyYAML is required. Install it for this Python with: "
        "py -m pip install --user PyYAML'",
    ),
}


def _load_manifest() -> dict:
    assert MANIFEST_PATH.is_file(), f"plugin.yaml is missing at {MANIFEST_PATH}"
    data = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
    assert isinstance(data, dict), f"plugin.yaml must parse to a mapping, got {type(data).__name__}"
    return data


def _imported_top_level_modules(source: str) -> set[str]:
    """Top-level module names imported by a source file, parsed - never imported."""
    tree = ast.parse(source)
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                modules.add(node.module.split(".")[0])
    return modules


def _unquoted(line: str) -> str:
    """Blank out quoted spans so prose is not mistaken for a command."""
    return _QUOTED_SPAN.sub(" ", line)


def test_plugin_yaml_parses_and_declares_external_runtime():
    """plugin.yaml must parse, declare python_runtime: external, and carry no deps."""
    manifest = _load_manifest()

    assert (
        manifest.get("python_runtime") == "external"
    ), (
        "plugin.yaml must declare a top-level 'python_runtime: external'. "
        f"Found {manifest.get('python_runtime')!r}. Without it the host treats "
        "declared packages as the plugin's own and may resolve them."
    )

    assert "python_dependencies" not in manifest, (
        "plugin.yaml must NOT contain a 'python_dependencies' key. The host reads "
        "it (pm/plugin_declarations.py:149-153) and a non-empty declaration makes "
        "the plugin a workspace member, which means a resolver run at install time."
    )


def test_plugin_manifest_has_no_python_dependencies():
    """Separate, unambiguous statement of the same rule (a re-added key must fail here)."""
    manifest = _load_manifest()

    assert "python_dependencies" not in manifest, (
        "plugin.yaml re-declares 'python_dependencies': "
        f"{manifest.get('python_dependencies')!r}. Chroma installs NO python "
        "packages - the dashboard half uses the host's own fastapi/pydantic."
    )

    assert "pip_dependencies" not in manifest, (
        "plugin.yaml re-declares 'pip_dependencies': "
        f"{manifest.get('pip_dependencies')!r}. The host reads that alias with the "
        "same meaning as 'python_dependencies' (pm/plugin_declarations.py:149-153)."
    )


def test_declared_python_dependencies_would_be_valid_pep508():
    """IF a dependency list ever comes back, every entry must be a real requirement."""
    manifest = _load_manifest()

    declared = manifest.get("python_dependencies")
    if declared is None:
        # The contract is satisfied by ABSENCE. Nothing to validate.
        return

    assert isinstance(declared, list), (
        f"'python_dependencies' must be a list, got {type(declared).__name__}"
    )

    try:
        from packaging.requirements import InvalidRequirement, Requirement
    except ImportError:  # pragma: no cover - packaging ships with pytest
        Requirement = None  # type: ignore[assignment]
        InvalidRequirement = Exception  # type: ignore[assignment,misc]

    for entry in declared:
        assert isinstance(entry, str), (
            f"'python_dependencies' entries must be strings, got {entry!r}"
        )

        assert _PEP508_NAME.match(entry), (
            f"python_dependencies entry {entry!r} has no package name. PEP 508 "
            "requires 'name[extras]specifier' (for example 'fastapi>=0.133.1'); "
            "a bare range such as '>=0.133.1,<0.134.0' names no package and "
            "cannot be resolved."
        )

        if Requirement is not None:
            try:
                Requirement(entry)
            except InvalidRequirement as exc:
                pytest.fail(
                    f"python_dependencies entry {entry!r} is not a valid PEP 508 "
                    f"requirement: {exc}"
                )


def test_plugin_root_has_no_dependency_bearing_manifest():
    """No root pyproject/requirements/lockfile: the host must find nothing to resolve."""
    forbidden = (
        "pyproject.toml",
        "setup.py",
        "setup.cfg",
        "Pipfile",
        "Pipfile.lock",
        "poetry.lock",
        "uv.lock",
        "environment.yml",
    )

    for name in forbidden:
        assert not (ROOT / name).exists(), (
            f"{name} exists at the plugin root. The host reads a root "
            "pyproject.toml's project.dependencies as the plugin's own "
            "(pm/plugin_declarations.py:132-147), so a manifest at the root can "
            "re-introduce a resolver even with no plugin.yaml key."
        )

    for requirement_file in sorted(ROOT.glob("requirements*.txt")):
        pytest.fail(
            f"{requirement_file.name} exists at the plugin root. It is a "
            "dependency-bearing manifest and must not ship with the plugin."
        )


def test_agent_entrypoint_imports_only_standard_library():
    """__init__.py must import stdlib only - it runs in the host's interpreter."""
    assert AGENT_ENTRYPOINT.is_file(), f"missing agent entry point {AGENT_ENTRYPOINT}"

    modules = _imported_top_level_modules(AGENT_ENTRYPOINT.read_text(encoding="utf-8"))
    non_stdlib = sorted(m for m in modules if m not in sys.stdlib_module_names)

    assert not non_stdlib, (
        f"__init__.py imports non-stdlib module(s) {non_stdlib}. The host imports "
        "this module in its own interpreter and the admission probe imports it in "
        "a scratch subprocess with no Hermes packages available, so a third-party "
        "import here is a hard dependency the plugin does not declare."
    )


def test_no_package_manager_invocation_in_shipped_entrypoints():
    """No shipped entrypoint may run a package manager."""
    # scripts/*.py are developer tools (the build, the gates), not shipped
    # entrypoints - they are deliberately NOT scanned here.
    targets = [MANIFEST_PATH, AGENT_ENTRYPOINT, DASHBOARD_API]
    targets.extend(sorted(p for p in INSTALL_DIR.rglob("*") if p.is_file()))

    problems: list[str] = []
    for path in targets:
        rel = path.relative_to(ROOT).as_posix()
        text = path.read_text(encoding="utf-8", errors="replace")
        for lineno, raw in enumerate(text.splitlines(), 1):
            code = _unquoted(raw)
            for pattern in _PACKAGE_MANAGER_PATTERNS:
                match = pattern.search(code)
                if match:
                    problems.append(
                        f"{rel}:{lineno} executes a package manager command "
                        f"({match.group(0)!r}): {raw.strip()!r}"
                    )
                    break
            else:
                for pattern in _PACKAGE_MANAGER_PATTERNS:
                    match = pattern.search(raw)
                    if match:
                        if (rel, raw.strip()) not in _ALLOWED_QUOTED_MENTIONS:
                            problems.append(
                                f"{rel}:{lineno} mentions a package manager command "
                                f"({match.group(0)!r}) outside an allowlisted "
                                f"message: {raw.strip()!r}"
                            )
                        break

    assert not problems, (
        "A shipped entrypoint names a package manager. Installing Chroma must "
        "never reach for a resolver:\n  " + "\n  ".join(problems)
    )


def test_dashboard_imports_only_host_provided_third_party_packages():
    """The dashboard half may only import packages the host already ships."""
    assert DASHBOARD_API.is_file(), f"missing dashboard API {DASHBOARD_API}"

    modules = _imported_top_level_modules(DASHBOARD_API.read_text(encoding="utf-8"))
    third_party = sorted(m for m in modules if m not in sys.stdlib_module_names)
    unexpected = sorted(set(third_party) - HOST_PROVIDED_PACKAGES)

    assert not unexpected, (
        f"dashboard/plugin_api.py imports third-party module(s) {unexpected}, which "
        f"the host does not provide. Only {sorted(HOST_PROVIDED_PACKAGES)} are "
        "allowed - a new third-party import here is a silent dependency that "
        "installing the plugin would have to resolve."
    )


def test_plugin_yaml_declares_no_package_manager_or_install_command():
    """The manifest must not instruct anyone to run a package manager."""
    text = MANIFEST_PATH.read_text(encoding="utf-8")

    for phrase in ("pip install", "uv pip", "npm install", "conda install"):
        assert phrase not in text.lower(), (
            f"plugin.yaml mentions {phrase!r}. The manifest must not carry an "
            "install command - the host owns dependency resolution."
        )
