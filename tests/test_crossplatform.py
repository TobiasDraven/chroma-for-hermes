"""The cross-platform packaging gate: one tree, three operating systems.

The plugin ships to Desktop users on Windows, macOS and Linux from ONE tree, and
the host's admission gate only looks at the tree it is handed. A path that is
legal on the maintainer's machine and illegal on someone else's is therefore a
silent landmine: the commit is green, the plugin installs, and on the platform
that cannot spell the path the file is simply not there.

Every check below reads the TRACKED tree (`git ls-files`), not the working
directory, because the working directory is what one machine happens to have
checked out. The tracked set is what a clone on another platform receives.

The seven checks, and the failure each one prevents:

  1. symlinks            - git records a symlink as mode 120000. A Windows
                           checkout without symlink support materialises a plain
                           TEXT FILE holding the target path, and the plugin
                           then reads a path as if it were data.
  2. case collisions     - "README.md" and "readme.md" are two files to git and
                           ONE file to Windows, and to a case-insensitive macOS
                           volume. The second one silently overwrites the first.
  3. reserved names      - CON, PRN, AUX, NUL, COM1-9 and LPT1-9 cannot be
                           created or opened with the Win32 API, whatever
                           extension they carry.
  4. trailing space/dot  - Windows silently strips them, so the file the gate
                           sees and the file the plugin opens are different
                           files with the same name.
  5. machine paths       - a config that names C:\\Users\\... or /Users/... is a
                           config that cannot work on the other two platforms.
  6. CRLF shell scripts  - a CRLF byte after "#!" makes the kernel report "bad
                           interpreter" and the script never runs.
  7. file count          - the host refuses a plugin with more than
                           MAX_PLUGIN_FILE_COUNT files (tools/plugin_guard.py).
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent

# The host's own cap, read from the host source (read-only):
#   tools/plugin_guard.py:106  MAX_PLUGIN_FILE_COUNT = 400
#   tools/plugin_guard.py:344  if file_count > MAX_PLUGIN_FILE_COUNT:
# so 400 files pass the host and 401 fail it. This gate mirrors that
# comparison exactly (count <= 400), so the tree is never rejected by the host
# and the gate never cries wolf on a tree the host would accept.
MAX_PLUGIN_FILE_COUNT = 400

# The device names Windows reserves. The extension does not matter: "CON.md"
# is CON as far as the Win32 API is concerned.
WINDOWS_RESERVED_NAMES = (
    {"con", "prn", "aux", "nul"}
    | {"com%d" % number for number in range(1, 10)}
    | {"lpt%d" % number for number in range(1, 10)}
)

# Shipped configuration: the two files the host reads, plus every structured
# text file in the tree. A skin's palette is data, but it is also a config the
# build reads on every platform, so it is scanned with the rest.
CONFIG_SUFFIXES = (".json", ".yaml", ".yml", ".toml")
NAMED_CONFIG_FILES = ("chroma/plugin.yaml", "chroma/dashboard/manifest.json")

# Absolute paths that only exist on one developer's machine. Each pattern is
# (what it is, how to recognise it).
MACHINE_PATH_PATTERNS = (
    ("a Windows drive path", re.compile(r"[A-Za-z]:[\\/]")),
    ("a macOS home directory", re.compile(r"/Users/")),
    ("a Linux home directory", re.compile(r"/home/")),
    ("an MSYS home directory", re.compile(r"/c/Users")),
    ("a UNC path", re.compile(r"\\\\")),
)

# A URL is allowed to contain any characters it likes, and a template
# placeholder is allowed to stand in for a path: both are masked out before
# the scan, so "https://example.com/c:/x" and "${HOME}/thing" are not
# landmines, while a literal C:\\Users\\malan\\skin is.
URL_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]*://[^\s\"'<>()\[\],]+")
PLACEHOLDER_PATTERN = re.compile(
    r"\$\{[^}]*\}|\{\{[^}]*\}\}|<[^<>\s]*>|\$[A-Z_][A-Z0-9_]*"
)

SHELL_SUFFIXES = (".sh", ".command")


def git_output(*args: str) -> bytes:
    """Run git in the repository root, and fail loudly if it does not work."""
    result = subprocess.run(
        ["git", *args],
        cwd=str(ROOT),
        capture_output=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "git %s failed in %s: %s"
            % (" ".join(args), ROOT, result.stderr.decode("utf-8", "replace"))
        )
    return result.stdout


def tracked_entries() -> list[tuple[str, str]]:
    """(git mode, path) for every path in the index, as POSIX relative paths."""
    raw = git_output("ls-files", "-s", "-z", "--full-name")
    entries: list[tuple[str, str]] = []
    for record in raw.split(b"\0"):
        if not record:
            continue
        meta, _, path = record.partition(b"\t")
        mode = meta.split(b" ", 1)[0].decode("ascii")
        entries.append((mode, path.decode("utf-8", "surrogateescape")))
    return entries


def tracked_paths() -> list[str]:
    """Every tracked path, as POSIX relative paths."""
    return [path for _mode, path in tracked_entries()]


def mask_allowed_text(text: str) -> str:
    """Blank out URLs and template placeholders, keeping every other byte."""
    masked = URL_PATTERN.sub(lambda match: " " * len(match.group(0)), text)
    return PLACEHOLDER_PATTERN.sub(lambda match: " " * len(match.group(0)), masked)


def shipped_config_paths() -> list[str]:
    """The tracked configuration files this gate scans."""
    paths = set(NAMED_CONFIG_FILES)
    for path in tracked_paths():
        if PurePosixPath(path).suffix.lower() in CONFIG_SUFFIXES:
            paths.add(path)
    return sorted(paths)


def test_no_symlinks_in_tracked_tree() -> None:
    """A tracked symlink is a link on macOS and a text file on Windows."""
    offenders: list[str] = []
    for mode, path in tracked_entries():
        # The git mode is the check that works on EVERY platform. A Windows
        # checkout without symlink support writes a plain file holding the
        # target path, so os.path.islink() is False there even though the
        # repository still carries a symlink.
        if mode == "120000":
            offenders.append("%s (git mode 120000: a symlink in the repository)" % path)
        elif os.path.islink(ROOT / path):
            offenders.append("%s (a symlink in the working tree)" % path)
    assert not offenders, (
        "tracked symlinks do not survive a checkout on every platform, and a "
        "Windows checkout writes them out as text files holding a path: "
        + "; ".join(offenders)
        + ". Ship the target's contents instead of a link to them."
    )


def test_no_case_insensitive_path_collisions() -> None:
    """Two paths that differ only in case are two files to git and one to Windows."""
    buckets: dict[str, list[str]] = {}
    for path in tracked_paths():
        buckets.setdefault(path.lower(), []).append(path)
    collisions = {
        key: sorted(value) for key, value in buckets.items() if len(value) > 1
    }
    assert not collisions, (
        "these tracked paths collide when lowercased, so a Windows or "
        "case-insensitive macOS checkout keeps only one of each and the plugin "
        "loses a file without a word: "
        + "; ".join(
            "%s (all lowercased to %r)" % (", ".join(value), key)
            for key, value in sorted(collisions.items())
        )
    )


def test_no_windows_reserved_names() -> None:
    """CON, PRN, AUX, NUL, COM1-9 and LPT1-9 cannot be opened on Windows."""
    offenders: list[str] = []
    for path in tracked_paths():
        for part in PurePosixPath(path).parts:
            stem = part.split(".", 1)[0].lower()
            if stem in WINDOWS_RESERVED_NAMES:
                offenders.append(
                    "%s (component %r is the reserved device name %r)"
                    % (path, part, stem)
                )
    assert not offenders, (
        "these tracked paths use a name Windows reserves, so the file cannot be "
        "created or opened there at all: "
        + "; ".join(offenders)
        + ". Rename the component."
    )


def test_no_trailing_space_or_dot_in_path_components() -> None:
    """Windows strips a trailing space or dot, so the name changes under the user."""
    offenders: list[str] = []
    for path in tracked_paths():
        for part in PurePosixPath(path).parts:
            if part.endswith(" ") or part.endswith("."):
                offenders.append(
                    "%s (component %r ends with %r)"
                    % (path, part, " " if part.endswith(" ") else ".")
                )
    assert not offenders, (
        "these tracked paths have a component ending in a space or a dot, and "
        "Windows strips it, so the file the user gets is not the file the "
        "repository holds: "
        + "; ".join(offenders)
        + ". Rename the component."
    )


def test_no_absolute_or_machine_specific_paths_in_shipped_config() -> None:
    """A shipped config must not name a path that only exists on one machine."""
    offenders: list[str] = []
    for path in shipped_config_paths():
        target = ROOT / path
        if not target.is_file():
            continue
        masked = mask_allowed_text(target.read_text(encoding="utf-8", errors="replace"))
        for number, line in enumerate(masked.splitlines(), 1):
            for label, pattern in MACHINE_PATH_PATTERNS:
                if pattern.search(line):
                    offenders.append("%s:%d (%s)" % (path, number, label))
    assert not offenders, (
        "these shipped config files carry a machine-specific absolute path, so "
        "they cannot work on the other two platforms: "
        + "; ".join(offenders)
        + ". Use a relative path or a placeholder."
    )


def test_shell_scripts_use_lf_endings() -> None:
    """A CRLF byte after "#!" makes /bin/sh report "bad interpreter"."""
    offenders: list[str] = []
    for path in tracked_paths():
        if PurePosixPath(path).suffix.lower() not in SHELL_SUFFIXES:
            continue
        target = ROOT / path
        if target.is_file() and b"\r\n" in target.read_bytes():
            offenders.append("%s (CRLF line endings in the working tree)" % path)
        blob = git_output("cat-file", "blob", ":" + path)
        if b"\r\n" in blob:
            offenders.append("%s (CRLF line endings in the committed blob)" % path)
    assert not offenders, (
        "these shell scripts carry CRLF line endings, so the kernel reports a "
        "bad interpreter and the script never runs: "
        + "; ".join(offenders)
        + ". Ship them with LF endings."
    )


def test_tracked_file_count_is_under_the_host_plugin_cap() -> None:
    """The host refuses a plugin with more than MAX_PLUGIN_FILE_COUNT files."""
    # The host's guard counts files in the PLUGIN DIRECTORY, not the whole repo
    # (tools/plugin_guard.py scans the plugin package). The shipped package is the
    # chroma/ subdirectory: the catalog installs it with `subdir: chroma` and the
    # host sparse-clones only that directory. So count chroma/, not the tree.
    package = [p for p in tracked_paths() if p.startswith("chroma/")]
    count = len(package)
    # The host's rule is `if file_count > MAX_PLUGIN_FILE_COUNT`
    # (tools/plugin_guard.py:344), so exactly 400 files is VALID. This
    # assertion mirrors the host's comparison rather than a stricter one.
    assert count <= MAX_PLUGIN_FILE_COUNT, (
        "the shipped package holds %d files; the host refuses a plugin with more "
        "than %d (tools/plugin_guard.py: MAX_PLUGIN_FILE_COUNT = %d)"
        % (count, MAX_PLUGIN_FILE_COUNT, MAX_PLUGIN_FILE_COUNT)
    )
