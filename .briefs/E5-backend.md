# E5 LANE 1 — TYPOGRAPHY, BACKEND HALF

Repo: C:\DEV\hermes-theme-picker   Branch: main

## Mission
Let a user's font choice ride the EXISTING overrides store. A typography edit is an
override exactly like a colour edit (\u00a717), so it needs no new store, no new file and no
transport minting \u2014 the CLI renders colours, not fonts.

## Files you own \u2014 and nothing else
- `dashboard/plugin_api.py`
- `tests/test_plugin_api.py`

Do NOT touch anything under `desktop/`. Another lane owns those files.

## Read first
- The overrides store: `_read_overrides()`, `_read_overrides_for_update()`,
  `_write_overrides()`, `_OVERRIDES_LOCK`, `_overrides_path()`.
- `OverrideRequest` (~:1120), `PUT /overrides/{scene}` (~:1273),
  `DELETE /overrides/{scene}` (~:1351), `_effective_roles()`.
- The `/schema` response (~:1079) \u2014 it currently carries `"typography": []`, a stub.

## The contract \u2014 pin these exactly

### 1. The request
`OverrideRequest` gains `typography: dict[str, str] = {}`.
Keys are `fontSans` and `fontMono` only \u2014 the two the theme object carries. An unknown key
is a `400` naming it and listing the valid keys. Do not silently drop it.

### 2. The record
The override record gains `"typography": {...}` holding ONLY the keys the user set (the same
"record what the user set, not what they cleared" rule the colour half already follows).
Absent or empty means "no font override". Keep `light`/`dark`/`authored`/`at` exactly as they are.

### 3. `PUT /overrides/{scene}`
- Accept `typography` alongside `light`/`dark`.
- **The "at least one role" guard must widen:** an override that sets ONLY typography is a valid
  edit. Today the guard rejects it. A request that changes neither a role nor a font is still a `400`.
- Store the typography on the record. **Do NOT mint a transport skin for a typography-only change**
  \u2014 there is no font in a skin YAML, and minting would be a lie about what the CLI received.
  When colours DID change, mint as today.
- Return the typography in the response: `"typography": record.get("typography") or {}`.

### 4. Validation \u2014 hostile by default
A font stack is a CSS value the pane will paste into a CSS custom property. Validate it:
- must be a non-empty string after `.strip()`;
- cap the length (200 chars is generous for a stack);
- reject anything that could break out of a CSS declaration or a URL: `;`, `{`, `}`, `<`, `>`,
  `\n`, `\r`, and the substring `url(` \u2014 each a `400` naming the value and the offending character.
  Allow the characters a real stack uses: letters, digits, spaces, commas, quotes, hyphens,
  underscores, dots and parens.
Write the rejection as a small named helper so the test can pin each rule.

### 5. `DELETE /overrides/{scene}` \u2014 unchanged in spirit
Dropping the record drops the typography with it. There is nothing to restore: the authored
font lives in the pane's `SCENE_TYPOGRAPHY`, which the pane already holds. Say that in the
docstring so the next reader does not go looking for an authored snapshot that does not exist.

### 6. `/schema`
Replace `"typography": []` with the two editable keys, in a stable order:
```json
"typography": [{"id": "fontSans", "label": "Sans"}, {"id": "fontMono", "label": "Mono"}]
```
Update the existing schema tests.

### 7. Packs \u2014 out of scope, but say so
A pack bundle's skins do not carry typography in v1. Do not add it. If a bundle carries an
unknown field the existing validators already ignore it; leave that behaviour alone.

## Tests \u2014 add to `tests/test_plugin_api.py`
- a typography-only override is accepted (the widened guard) and stored on the record.
- an override that changes neither a role nor a font is refused (`400`).
- an unknown typography key is refused (`400`) naming it.
- each validation rule refuses: empty string, over-long stack, and one case per forbidden
  character / substring \u2014 pin them so a later loosening cannot pass silently.
- a typography-only override **does not touch the transport skins** \u2014 assert the transport
  files are byte-identical after the call. This is the test that proves the "no minting" rule.
- a colour+typography override stores both and still mints.
- `DELETE /overrides/{scene}` removes the typography with the record.
- `/schema` returns the two typography keys in order.

## Gates
- `python -m pytest tests/test_plugin_api.py -q`
- `python -m pytest tests/ -q`
Report both counts. Do not regress the suite as it stands after the E4 lane lands (it may be
higher than 120 when you start \u2014 report what you find, and never edit another lane's tests).

## Constraints
- One writer per file. `plugin_api.py` and `test_plugin_api.py` are yours; nothing else.
- Mirror the overrides store's existing design exactly. Never unlink; atomic replace;
  strict read on writers; rollback on failure.
- If something is ambiguous, prefer the choice that matches the colour half's behaviour and
  say so in your report.

## Report back
Files changed; exact pytest commands and counts; the record shape you settled on; every
validation rule as implemented; and every decision the brief did not pin.
