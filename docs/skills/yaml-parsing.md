---
triggers:
  files: ["src/plan-import/parser.ts", "src/plan-import/**"]
  change_types: ["create", "modify"]
  keywords: ["YAML", "parse", "frontmatter", "js-yaml"]
---

# Skill: YAML parsing

## Purpose

Parse YAML frontmatter (e.g. in Cursor plan files) and map fields into domain types without throwing; use Result/neverthrow for errors.

## Examples

- Use `js-yaml`’s `load()` on the frontmatter string; match `---\s*\n([\s\S]*?)\n---` to extract it.
- Validate shape (e.g. `todos` is an array, each item has `id` and `content`) and return `err(buildError(...))` on failure.
- Map optional fields (e.g. `changeType`) with type guards (e.g. `isChangeType(val)`) so only valid enum values are accepted.

## Gotchas

- YAML can produce unexpected types (e.g. numbers, booleans); use `typeof x === "string"` and explicit checks.
- Keep frontmatter parsing in the parser layer; persist mapped values in the importer.
