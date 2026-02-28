# Research: Integration Test taskId Undefined (next Output Format)

## Root cause

**`tg next` human-readable output** now shows **hash_id** when present (`next.ts` line 108: `const id = task.hash_id ?? task.task_id`). Integration tests were written to parse a **UUID** from that line:

- **task-dimensions.test.ts:** `nextStdout.match(/ID: ([0-9a-f-]{36}), Title: Schema task/)`
- **rich-plan-import.test.ts:** `nextStdout.match(/ID: ([0-9a-f-]{36}), Title: Task with suggested changes/)`

After the **Short Hash Task IDs** work, imported tasks get a `hash_id` (e.g. `tg-e1dfd9`). So the line printed is `ID: tg-e1dfd9, Title: Schema task, ...`, which does **not** match the 36-character UUID regex. The match is `null`, so `taskIdWithDimensions` / `taskIdWithSuggested` stay **undefined**. Later, `tg context ${taskIdWithSuggested}` becomes `tg context undefined` → "Task undefined not found". The **rich-plan-import** test also uses the same id in a raw SQL `WHERE task_id = '${taskIdWithSuggested}'`, so 0 rows when undefined.

## Why context still needs task_id

`context` command looks up by **task_id** only (`context.ts`: `where: { task_id: taskId }`). It does not use `resolveTaskId`, so it does not accept hash_id. So tests must obtain the **UUID** for `tg context` and for any direct SQL.

## Fix (adopted)

**Use `tg next --plan <id> --limit 5 --json`** and parse the JSON. The JSON output includes both `task_id` (UUID) and `hash_id`. Find the task with the expected title and use `task.task_id`. This:

- Decouples tests from the human-readable format (ID line).
- Works whether we show hash_id or task_id in the future.
- Supplies the UUID required by `context` and by raw SQL.

## Changes made

1. **task-dimensions.test.ts** — In beforeAll, call `next --plan ${planId} --limit 5 --json`, parse JSON, find task with `title === "Schema task"`, set `taskIdWithDimensions = task.task_id`.
2. **rich-plan-import.test.ts** — Same: call `next ... --json`, find task with `title === "Task with suggested changes"`, set `taskIdWithSuggested = task.task_id`.

No CLI changes. Tests now robust to display format.

## Remaining work

The **context** command (and other commands that take a task ID: start, done, show, block, note, split) still look up by **task_id** only; they do not use `resolveTaskId`, so they do **not** accept hash_id (e.g. `tg context tg-e1dfd9` will fail until resolved). The **Short Hash Task IDs** plan includes a task **"Update all CLI commands to use resolveTaskId for task ID arguments"** which will add `resolveTaskId` to context and the others. Once that task is done, `tg context <hash_id>` and the rest will work.

---

_Research date: 2026-02-28. Source: src/cli/next.ts, context.ts, integration test beforeAll regex._
