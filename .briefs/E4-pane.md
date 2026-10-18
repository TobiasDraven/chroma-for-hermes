# E4 LANE 2 — CATEGORY MANAGEMENT, PANE HALF

Repo: C:\DEV\hermes-theme-picker   Branch: main   HEAD: 8f87e06

## Mission
Add category management to the Chroma desktop pane: create and delete user categories,
assign a skin to a category, and resolve a skin's effective category as
`override ?? measured`. Ship the UI and its tests.

## Files you own — and nothing else
- `desktop/plugin.template.js`   (the real edit target)
- `desktop/plugin.js`            (**generated — never hand-edit; regenerate it**)
- `tests/editor-categories.test.mjs`  (new)

Do NOT touch anything under `dashboard/`. Another lane owns those files.

## Read first, in this order
1. `desktop/plugin.template.js`:
   - `THEME_CATEGORIES` (:104) — the twelve built-in shelves, ids and titles.
   - `sceneCategory()` (:2077) — the MEASURED classifier. **Do not change it.**
   - `buildCategoryGroups()` (:2117) and `buildGroups()` (:2126).
   - `applyOverride()` (:2728) and `groupCards()` (:2750) — the effective-palette pattern.
   - the overrides fetch/state and the editor surface (grep `overrides`, `fetch(`,
     `editorModal`/`Editor`).
2. `tests/editor-packs.test.mjs` and `tests/editor-save.test.mjs` — the test style to
   match exactly (node:test + jsdom, importing the pane's exported helpers).

## The contract — the backend routes you call (the other lane is building these)
| Route | Request | Response |
|:--|:--|:--|
| `GET /categories` | — | `{ok, count, categories: [{id, title, order}]}` |
| `POST /categories` | `{id, title}` | `{ok, id, title, order}` |
| `DELETE /categories/{id}` | — | `{ok, id, removed}` |
| `PUT /skins/{name}` | gains `category: str` | the skin, with `category` |
| `GET /schema` | — | gains `categories: [12 built-in ids]` |

Code against these exactly. Use the pane's existing fetch helper and its error-surfacing
conventions — the same ones the packs UI already uses. Status codes to handle:
`409` duplicate/built-in, `400` malformed, `404` absent.

## What to build

### 1. `effectiveCategory(scene, userCategories)` — one helper, not inlined
Resolution order for a skin's category:
1. the skin's `category` field when non-empty — the per-skin override, else
2. a user category whose `names` list claims it (exact name, case-insensitive; first
   match in declaration order), else
3. the measured `sceneCategory(scene)` — the floor.
An override naming a **deleted** category must fall through to the measured shelf.
That fallback is exactly why the measured classifier stays the floor; say so in a comment.

### 2. Grouping
Extend `buildGroups()` / `buildCategoryGroups()` so the "by theme" lens renders user
categories as shelves **after** the built-ins. The existing caller already drops empty
groups — keep that, so an empty user shelf costs no vertical space. Built-in shelves keep
their current order and membership.

### 3. The UI
- **Category management section:** list user categories (title, order); create (id + title);
  delete with a confirmation that **names the category it will remove**.
- **Per-skin category control:** a select of `[measured shelf label] + built-ins + user
  categories`, with a **"Reset to measured"** choice that sends `""`.
- Built-in shelves are shown but **not deletable or renamable** — render them as such
  (disabled/absent affordances, not a hidden trap).
- Follow the pane's existing empty-state and a11y conventions: `aria-invalid` on a rejected
  input, and never commit an unreadable value.

### 4. The drift alarm
Extend the pane's existing schema-drift check to compare `GET /schema`'s `categories`
against `THEME_CATEGORIES`. A mismatch must surface the same way the role drift already
does. A category id the pane renders but the backend refuses is precisely the drift this
catches — say that in the comment.

## Tests — `tests/editor-categories.test.mjs` (new)
- `effectiveCategory`: override wins; `""` falls back to measured; an unknown override id
  falls back to measured.
- A user category's `names` list claims a skin by name.
- Grouping: a user category's skins land in the user shelf; an empty user shelf is dropped.
- The create / delete / assign handlers POST the exact routes and payloads above.
- A rejected create (`409` duplicate) surfaces an error and does NOT commit to local state.
- The schema-drift check fires on a category-id mismatch.

## Gates
- `node --test tests/*.test.mjs` — report the pass count. It must not regress the current
  **162** passing.
- Then regenerate: `python scripts/regenerate.py`. Confirm `plugin.js` changed only as
  expected. Report the **sha256** of `plugin.js`.

## Constraints
- One writer per file. The two desktop files and your new test are yours.
- Never hand-edit `plugin.js`. Regenerate it and commit both.
- Do not change `sceneCategory()`'s measured rules — it must not learn about user categories.
- Follow the pane's existing conventions for fetch, error display and tests.

## Report back
Files changed; the `node --test` command and count; the sha256 of `plugin.js`; the exact
routes and payloads you emit; and every decision the brief did not pin.
