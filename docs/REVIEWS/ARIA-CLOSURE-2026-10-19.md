# C9 (accessibility) — closed

**Date:** 2026-10-19 · **Status:** CLOSED · **Version:** 2.9.0 · **Commit:** (see git log)

C9 was the last open roast item before the public release. It is closed by a
scout → plan → adversarial review → implementation sequence, each step on the record:

| Step | File |
|:---|:---|
| Evidence (12 ranked gaps, cited) | `docs/REVIEWS/ARIA-SCOUT-2026-10-19.md` |
| Plan v1 | `docs/PLANS/ARIA-PASS-PLAN.md` |
| Adversarial review (11 findings, all accepted) | `docs/REVIEWS/ARIA-PLAN-REVIEW-2026-10-19.md` |
| Plan v2 | `docs/PLANS/ARIA-PASS-PLAN.md` |
| Lane report | `cache/scratch/aria-impl.md` (not committed) |

## What closed it

The highest-impact finding was that `aria-modal` was a promise the pane never kept:
no focus-in, no trap, no document-level Escape, no focus restore. `useModalA11y`
now delivers all four. Behind it came the names (words instead of glyphs, a stable
name on the preview pill, item-scoped verbs), the state and structure (`aria-current`,
`aria-describedby` + `role='alert'`, lists, headings, a labelled `aside`), the
palette's text alternative, one live region per surface, the colour well's focus
ring, and a roving tab order that makes a card a single stop.

## How the parent verified it (not the lane's word for it)

- **Fixture audit, old vs new parity JSON:** 0 paths removed, 0 changed, 681 added.
  No child, label, handler or className was lost or altered.
- **Gates, all run by the parent:** `node --test` 256 pass / 0 fail (was 243) ·
  `pytest` 185 passed / 4 skipped · `check-packs` OK · `check-package` OK ·
  `check-host-classes` exit 0 (134 classes used, 0 with no rule) · regenerate
  deterministic · `node --check` OK · `hermes plugins validate .` passed.
- **Rigour, before/after:** a temp worktree at `c0575ca` vs the post-pass tree. The
  finding sets are identical except five `style-drift` LOWs on Python files this pass
  never touched — rigour's adaptive baseline, not the change. Zero findings
  attributable to the pass.
- **Code read by hand:** `useModalA11y` (focus-in, capture-phase document Escape,
  Tab trap both ends plus the escaped-focus case, restore), the rename/delete focus
  transitions (ref + mount effect, safe default on No, restore through a consumed ref
  after the remount), and the roving set (one `roveRef` per card covering both rows;
  `cardRef` is the only `tabIndex=0`).

## What is NOT verified here

- **Focus behaviour in a live browser.** The harness has no real `document`, no layout
  and stubs `useEffect`, so focus-in, the trap, document Escape, focus restore and the
  roving keys are not unit-tested and are not claimed to be. They need a headless
  render and the Captain's G15 walk.
- **The word labels' layout.** Words are longer than glyphs; the settings row must
  still lay out at the narrow breakpoint. Unverified on screen.
