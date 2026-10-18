# E4 LANE 1 — CATEGORY MANAGEMENT, BACKEND HALF

Repo: C:\DEV\hermes-theme-picker   Branch: main   HEAD: 8f87e06

## Mission
Add category management to the Chroma dashboard backend. A category is a named
container for skins. User categories are a managed list; a skin joins one by an
explicit per-skin assignment. Ship the store, three routes, the `category` field on
`PUT /skins/{name}`, and category creation during pack import.

## Files you own — and nothing else
- `dashboard/plugin_api.py`
- `tests/test_plugin_api.py`

Do NOT touch anything under `desktop/`. Another lane owns those files.

## Read first, in this order
1. The overrides store in `dashboard/plugin_api.py` — `_overrides_path()`,
   `_read_overrides()`, `_read_overrides_for_update()`, `_write_overrides()`,
   `_OVERRIDES_LOCK`, `IndexUnreadableError`, `_index_error()`. **This is the pattern
   to mirror exactly**: a lenient read for display routes, a strict read for writers,
   atomic writes, rollback on failure.
2. `_read_index_for_update()`, `_atomic_write_text()`, `_is_unsafe_name()`,
   `_slugify()`, `_editor_name()`, `_normalise_palette()`, `EDITABLE_SKIN_KEYS`,
   `CORE_NAMES`, `_restore_index()`.
3. `ScenePaletteRequest` (~:1110), `PUT /skins/{name}` (~:1159),
   `GET /skins/{name}` (~:1131).
4. `_validate_bundle_categories()` (~:1769) and `import_pack()` (~:1796).

## The contract — pin these exactly

### 1. The store
`categories.json`, beside `overrides.json` in the same directory as the index
(the `.chroma/` dir — use whatever helper the overrides path uses).

```json
{"categories": [{"id": "cyber-noir", "title": "Cyber Noir", "order": 12}]}
```

Mirror the overrides store's naming: `_categories_path()`, `_read_categories()`,
`_read_categories_for_update()`, `_write_categories()`, `_CATEGORIES_LOCK`.
A corrupt file must make a WRITER fail loudly — never silently reset to `{}`.
That is the `8a06221` defect class; E4 must not reopen it.

### 2. Built-in ids — the closed set a user may not take
```python
BUILTIN_CATEGORY_IDS = (
    "minimal", "pastels", "vibrant", "muted", "earth", "terminal",
    "nature", "warm", "orange", "gold", "cool", "violet",
)
```
These are the pane's `THEME_CATEGORIES` ids, in display order. The pane is the source
of truth for them; this tuple is the backend's copy so it can refuse a collision.
Comment that. A test must pin the two lists together (see Tests).

### 3. `GET /categories`
Returns USER categories only — the built-ins are the pane's to render.
```json
{"ok": true, "count": 2, "categories": [{"id": "...", "title": "...", "order": 0}]}
```
Sorted by `(order, id)`, deterministic.

### 4. `POST /categories`
Body model `CategoryCreateRequest(BaseModel)`: `id: str = ""`, `title: str = ""`.
- Normalise the id to a slug (lower-case, hyphens). An unsafe id → `400` naming the offence.
- Empty title after `.strip()` → `400`.
- id in `BUILTIN_CATEGORY_IDS` → `409`, naming it as a built-in category.
- id already in the store → `409`, naming it as already existing.
- Success: append with `order = len(BUILTIN_CATEGORY_IDS) + len(existing)`, write
  atomically, return `{"ok": true, "id": ..., "title": ..., "order": ...}`.
- A failed write → `500` naming the path and the reason. Do not leave a half-file.

### 5. `DELETE /categories/{id}`
`404` if absent. Otherwise remove, rewrite, return `{"ok": true, "id": ..., "removed": true}`.
Refuse a built-in id with `409` (it can never be in the store — name the refusal anyway).
**Never touch a skin file or the index.** The pane falls back to the measured shelf;
say that in the docstring, because it is why this route is safe.

### 6. `PUT /skins/{name}` — the per-skin assignment
Add `category: str = ""` to `ScenePaletteRequest`.
- `""` means **clear the override** → set the record's `category` to `""`.
- A non-empty value must be in `BUILTIN_CATEGORY_IDS` **or** present in the categories
  store, else `400` naming the value and listing what is valid.
- Persist it on the index record beside `label`/`editedAt`, through the existing strict path.
- **The "nothing to write" guard:** a request carrying only a category IS a write —
  a category assignment is an edit. Update the guard so `category` counts as content.
- Return `"category": updated.get("category") or ""` in the response.

### 7. `GET /skins/{name}`
Already returns `category` — keep it, and make sure it reads the record's value.

### 8. Pack import creates categories
`_validate_bundle_categories()` validates and ignores today. Change `import_pack()` so
it **creates** each category from the bundle, in the same transaction as the skins.
- Validation as today (non-empty string id), plus: an id colliding with a built-in → `400`;
  a malformed entry → `400` naming it. Keep refusing rather than dropping.
- Capture the prior `categories.json` bytes before writing. On any failure later in the
  import, restore them **exactly** (mirror `_restore_index`). A half-imported pack is
  the failure this rule exists to stop.
- Idempotent: an id already present with the same title is a no-op; a different title
  updates the title. Import never deletes a category.
- `dryRun` must not write.
- Return the created/updated category ids in the response so the pane can refresh.

### 9. `/schema`
Add `"categories": list(BUILTIN_CATEGORY_IDS)` and keep `"typography": []`.
Update the existing schema tests for the new key.

## Tests — add to `tests/test_plugin_api.py`, matching its existing style
(real ASGI transport, tmp tree, the same fixtures the packs tests use):
- create / list / delete round trip; `order` preserved and deterministic.
- refuse a built-in id on create (`409`) and on delete (`409`).
- refuse a duplicate id (`409`).
- refuse a non-slug id (`400`) and an empty title (`400`).
- `PUT /skins/{name}` with a valid category persists it on the index and returns it.
- `PUT /skins/{name}` with an unknown category → `400` naming it.
- `PUT /skins/{name}` with `""` clears a previously set category.
- **strict path:** a corrupt `categories.json` makes a create fail loudly rather than
  silently overwriting — the mirror of the index test.
- pack import creates the bundle's categories; a re-import is idempotent; a failed
  import leaves the store unchanged.
- a category delete leaves every skin file **byte-identical**.
- **the drift pin:** `BUILTIN_CATEGORY_IDS` equals the ids in the pane's
  `THEME_CATEGORIES`. Read them out of `desktop/plugin.template.js` in the test (read-only)
  so the two copies cannot drift silently. If the pane file cannot be read, skip with a
  clear reason rather than passing vacuously.

## Gates
- `python -m pytest tests/test_plugin_api.py -q` — report the count.
- `python -m pytest tests/ -q` — report the full backend count.

## Constraints
- One writer per file. `plugin_api.py` and `test_plugin_api.py` are yours; nothing else.
- Never unlink; never write a path; atomic replace; strict read on writers.
- Change no existing route's behaviour beyond what is listed here.
- If something is ambiguous, prefer the choice that matches the overrides store's
  existing behaviour, and say so in your report.

## Report back
Files changed; the exact pytest commands and counts; the route list with status codes;
the `categories.json` shape you settled on; and every decision the brief did not pin.
