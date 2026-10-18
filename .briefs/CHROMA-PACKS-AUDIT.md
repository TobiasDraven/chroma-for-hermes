ROLE: Read-only audit subagent for chroma Theme Packs campaign.
BRIEF: Audit the chroma-for-hermes plugin (repo C:/DEV/hermes-theme-picker) for Theme Pack readiness. Focus on:
1. Uniqueness audit: verify the 109 scenes do NOT duplicate any of the 30 core skins selected for packs; compare against the 150 files in skins/ (not against the local install which carries extra Captain-added themes). Use the metric defined in CHROMA-PACKS.md: 6 signature roles in OKLab, distance = max per-role ΔE.
2. Category shelf integrity: verify the 12 built-in shelves (E4) stay measured/read-only (no user edits); verify user categories (E4) are additive only.
3. Pack design review: verify the 5 final single-word pack names (Earth, Cyberpunk, Zen, Retro, Noir) are recorded; verify pack = curated metadata (not container), members stay ordinary skin files, delete never deletes skins.
EVIDENCE RULE: Every claim cites file:line or run command. Every claim without empirical verification = UNVERIFIED.
OUTPUT: Structured audit saved to .briefs/CHROMA-PACKS-AUDIT.md. Sections: uniqueness results (count of duplicates found, metric values), shelf integrity verdict, pack design verdict, APPROVE / REQUEST-CHANGES with line anchors.
CONSTRAINTS: Read-only, no edits. Verify against filesystem. Report honestly.
