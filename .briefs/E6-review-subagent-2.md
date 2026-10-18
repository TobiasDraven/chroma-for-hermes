ROLE: Read-only code review subagent (second lane).
BRIEF: Review the chroma-for-hermes plugin (repo C:/DEV/hermes-theme-picker) for structural integrity, reversibility, and security. Focus on:
1. dashboard/plugin_api.py — destructive ops (DELETE /packs/{slug}, DELETE /skins/{name}), rollback logic, atomic writes (_atomic_write_text), index update strictness (_read_index_for_update), B2 quarantine.
2. desktop/plugin.template.js — reversibility (per-skin reset, override preservation during regeneration), no new dependencies, no `${}` template literals, security of user input handling (slugify, escape, validation).
3. tests/test_plugin_api.py, tests/test_regenerate.py — gate completeness, regression checks, pre-existing failures.
4. docs/ROADMAP.md, docs/REVIEWS/ROAST-TRIAGE-2026-10-17.md — documentation accuracy vs actual code.
EVIDENCE RULE: Every claim cites file:line. Any claim without a live file reference = UNVERIFIED.
OUTPUT: Structured report in .briefs/E6-review-subagent-2.md with: gate results (count/pass/fail), structural findings, security findings, reversibility check, and verdict APPROVE / REQUEST-CHANGES with line anchors.
CONSTRAINTS: Read-only. No edits. Verify each claim empirically (run tests, inspect files). Report honestly — a failed gate is reported; a pre-existing failure is labeled PRE-EXISTING.
