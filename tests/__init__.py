# Makes `tests` a regular Python package rather than a namespace portion.
#
# Without this file, `python -m unittest tests.test_plugin_api` can silently
# resolve a DIFFERENT `tests` package that happens to sit on PYTHONPATH (the
# Hermes runtime exports a path containing hermes-agent, which ships its own
# tests/__init__.py). A regular package at cwd is found first and wins; a
# namespace portion does not. The symptom is a confusing
# "ModuleNotFoundError: No module named 'tests.test_plugin_api'" that depends
# on the caller's environment rather than on this repo.
#
# The JavaScript suites are unaffected: they import files by path.
