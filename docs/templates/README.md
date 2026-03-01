# Plan Templates

Templates are YAML files in the same shape as [Cursor plan frontmatter](plan-format.md) (e.g. `name`, `overview`, `todos`, `fileTree`, `risks`, `tests`), with optional **variable placeholders** `{{varName}}` in any string. Use `tg template apply` to substitute variables and create a plan and tasks in Dolt.

## Usage

```bash
tg template apply <file> --plan "<planName>" [--var key=value]...
```

- **&lt;file&gt;** — Path to the template YAML file.
- **--plan &lt;name&gt;** — Plan name for the created plan (or existing plan to add tasks to). If a plan with this title/ID does not exist, a new one is created.
- **--var &lt;pairs...&gt;** — Variable substitutions as `key=value`. Example: `--var feature=auth --var area=backend`.

After substitution, the result is treated like an import: the same plan/task creation and upsert logic as `tg import --format cursor` is used.

## Template format

The file must be valid YAML and contain at least a `todos` array. All fields from the Cursor plan format are supported; any string value may contain `{{varName}}` placeholders (alphanumeric names). Placeholders not provided via `--var` are left as literal `{{varName}}` in the output.

Example template:

```yaml
name: "{{feature}} rollout"
overview: "Implement {{feature}} in {{area}}."
todos:
  - id: task-1
    content: "Add {{feature}} API in {{area}}"
    changeType: create
  - id: task-2
    content: "Wire {{feature}} into UI"
    blockedBy: [task-1]
```

Apply with:

```bash
tg template apply docs/templates/feature-rollout.yaml --plan "Auth rollout" --var feature=Auth --var area=backend
```

This creates a plan titled "Auth rollout" (or appends to an existing plan with that name) with two tasks whose titles and overview use the substituted values.

## Relation to import

- **`tg import &lt;file&gt; --plan X --format cursor`** — Imports a **markdown** file whose **frontmatter** is YAML (the rest is a markdown body). No variable substitution.
- **`tg template apply &lt;file&gt; --plan X --var k=v`** — Imports a **YAML-only** file (no markdown wrapper), **substitutes** `{{key}}` from `--var`, then uses the same plan/task creation and upsert logic as cursor import.

Use templates when you want to reuse the same plan structure with different names or areas (e.g. per-feature or per-module); use import when you have a one-off Cursor plan file.

## Example templates

| File | Purpose |
|------|--------|
| **feature.yaml** | Standard feature: schema/types, implementation, tests, docs. Variables: `feature`. |
| **bugfix.yaml** | Bug investigation and fix: reproduce and root-cause, then fix, then verify. Variables: `bug`. |
| **refactor.yaml** | Safe refactoring: tests first (lock behavior), then refactor, then run full suite. Variables: `scope`. |

Each uses Cursor plan frontmatter (`name`, `overview`, `todos`, optional `fileTree`, `risks`, `tests`) and supports `{{varName}}` placeholders. Apply with `tg template apply docs/templates/<file> --plan "..." --var key=value`.
