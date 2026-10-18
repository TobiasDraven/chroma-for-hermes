ROLE: Read-only code review subagent.
BRIEF: Review the chroma-for-hermes plugin (repo C:/DEV/hermes-theme-picker) for registry-readiness before public release. Check these surfaces ONLY:
1. dashboard/plugin_api.py — all routes, schema, category management (E4), typography (E5), security gates, atomic writes.
2. desktop/plugin.template.js — grouping, schema drift, edit modal, boot path, category/typography wiring.
3. docs/PLANS/CHROMA-EDITOR.md — plan consistency vs implementation.
4. tests/test_plugin_api.py, tests/editor-categories.test.mjs, tests/editor-typography.test.mjs — coverage of new routes.
EVIDENCE RULE: Every claim cites file:line. Any claim without a live file reference = UNVERIFIED.
OUTPUT: A structured report with: gate results (count/pass/fail), any new quality issues found, the boot-survival verification, and a verdict APPROVE or REQUEST-CHANGES with exact line anchors.
CONSTRAINTS: Read-only. No edits. Verify each claim against the filesystem, not from memory. Report back in the brief file .briefs/E6-review-subagent.md.
