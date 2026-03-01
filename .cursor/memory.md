# Persistent Memory

## Plan import

- Task **title** (from todo `content`) is stored in `task.title` (VARCHAR(255)). Keep plan todo titles under 255 characters or import will fail.
- **INSERT/UPDATE plan data**: After the plan→project rename migration, `plan` is a view. Dolt does not allow INSERT into a view. Use table **`project`** (not `plan`) for `q.insert` and `q.update` in import and template apply. See `src/cli/import.ts` and `src/cli/template.ts`.

## tg context

- Context command reads doc/skill from **task_doc** and **task_skill** junction tables (when present). Output fields: `docs`, `doc_paths`, `agent`, `related_done_by_doc`, `related_done_by_skill`. Older repos may have `task_domain` (pre-rename) or `task.domain` / `task.skill` columns.

## Using tg in another repo

- No script in package.json needed: `pnpm tg` runs the CLI from node_modules/.bin. Same for `npx tg` with npm.

## CLI version (build)

- Reading version from package.json via `createRequire(import.meta.url)` in the CLI entrypoint causes the emitted CJS to reference `import.meta.url`, which is undefined in CommonJS. Node then throws "exports is not defined in ES module scope". Use a hardcoded version string (e.g. `"2.0.0"`) until the build is ESM or a CJS-safe method (e.g. readFileSync of package.json from \_\_dirname) is used.

## CLI scaffolding (`tg setup`)

- Commander `--no-<flag>` options default to `true`; don’t pass `false` as the default value or you’ll invert behavior (setup will do nothing).
- **.cursor is opt-in:** `tg setup` defaults to scaffolding only `docs/`. Use `--cursor` to also scaffold `.cursor/` (rules, agents, skills) and `AGENT.md`.
- Package entrypoints should match build output: `package.json` `bin`/`main` point at `dist/cli/index.js`.
- `tg setup` resolves templates from `path.join(__dirname, '..', 'template')`: at runtime dist/cli → dist/template; in dev (tsx) src/cli → src/template. Templates live in `src/template/` and are copied to `dist/template/` by the build.

## Dolt JSON columns

- `event.body` may be returned as object or string by doltSql depending on driver. Handle both: `typeof raw === 'string' ? JSON.parse(raw) : raw`.

## Integration tests under full concurrency

- Running `bun test __tests__/integration` with default concurrency can cause flakiness: different integration test files run in parallel and may hit "database is read only" or Dolt commit conflicts when sharing the golden template or temp dirs. Flaky integration describes were wrapped with `describe.serial()` and a "Serial: flaky under concurrency" comment (invariants-db, no-hard-deletes, blocked-status-materialized, cursor-import).

## Dolt identity in test setup

- Integration tests using Dolt require setting `user.name` and `user.email` before `dolt init` in global setup, otherwise `dolt init` fails with "Author identity unknown". Added configuration steps in `__tests__/integration/global-setup.ts`.

## DAL writable (read-only errors)

- All Dolt invocations use `--data-dir <repoPath>` so the repo is explicit (avoids wrong cwd or connecting to a server). They pass `DOLT_READ_ONLY=false` in env so Dolt treats the session as writable when the repo allows it. `commit.ts` uses `process.env.DOLT_PATH || "dolt"` for consistency with connection/migrate.

## Migration idempotency

- `applyTaskDimensionsMigration` must skip when `task_domain` exists (junction migration has run and dropped domain/skill from task). Otherwise re-adding columns conflicts with existing `change_type`.
- `applyPlanRichFieldsMigration` must skip when table `project` exists (plan was renamed to project); otherwise ALTER TABLE `plan` runs against a missing table. After rename, rich columns already exist on `project`.
- After plan→project rename, app code still references `plan`. Migration creates view `plan` AS SELECT \* FROM `project` (in rename step and via `applyPlanViewMigration` for DBs that already had project) so existing queries work.
- **No-delete triggers:** Dolt does not support `SIGNAL SQLSTATE` inside triggers (syntax error at SIGNAL). The no-delete migration creates triggers when supported; on failure it records the attempt in `_taskgraph_migrations` so we don’t retry every command. Application-layer guard in `connection.ts` still blocks DELETE on protected tables.

## Plan authoring (user correction)

- **Always use rich planning.** Plans must include fileTree, risks, tests, per-task intent, suggestedChanges when helpful, and markdown body ending with `<original_prompt>`. See docs/plan-format.md and .cursor/rules/plan-authoring.mdc. When creating plans, follow the rule — do not default to minimal/spartan format.

## Plan creation — planner-analyst required

- **Planning MUST use the planner-analyst sub-agent first.** AGENT.md and plan-authoring.mdc state this explicitly. Skipping the analyst when the user asks for a plan is a critical failure. The agent in consuming projects gets AGENT.md from the template; it must see the mandatory two-step flow (1. dispatch analyst, 2. write plan from analyst output).

## Execution — sub-agents mandatory, Cursor decides concurrency

- **Task execution MUST use implementer (and reviewer) sub-agents.** AGENT.md and subagent-dispatch.mdc require it. Feed all runnable non-conflicting tasks; Cursor decides how many run in parallel. Direct execution only after 2 sub-agent failures or when task is explicitly exploratory. Skipping dispatch during execution is a critical failure.

## Orchestrator and sub-agent orientation: tg status --tasks

- **Orchestrator** runs `tg status --tasks` (not plain `tg status`) so it sees the **full** active task list. Default `tg status` shows only 3 next runnable; the orchestrator should not infer "batch 3" from that. Session-start.mdc and taskgraph-workflow.mdc use `--tasks`.
- **Sub-agents** (implementer, reviewer, etc.) run `tg status --tasks` at start when they need to orient—not full `tg status`. They only need task-level context; the orchestrator handles plans and initiatives. Session-start.mdc and implementer.md state this.

## Task orchestration UI (sub-agent management)

- **Required:** (1) Call TodoWrite with the task list from tg next before dispatching sub-agents; update statuses via TodoWrite(merge=true) as tasks complete. (2) When dispatching a batch of N tg tasks, emit N Task (or mcp_task) calls in the same turn — do not dispatch one per turn. This triggers Cursor's orchestration panel and parallel execution. See subagent-dispatch.mdc, work skill, AGENT.md.

## Follow-up from sub-agent notes (orchestrator)

- When an implementer (or sub-agent) completes and reports environment limitations, gate failures, or suggested follow-up in their return message or via `tg note`, the **orchestrator** decides whether to investigate. If warranted: `tg task new "<title>" --plan <planId>` then delegate the new task(s). See subagent-dispatch.mdc → "Follow-up from notes/evidence". Implementers should leave a `tg note` when they hit issues they could not fix so the orchestrator can spawn follow-up tasks.

## Evidence-Grounded Scoped Planning (named pattern)

The strongest plans share these properties — apply all of them when writing plans:

1. **Evidence base**: Every plan should cite the investigation, report, or analysis that preceded it. Don't guess at the problem; know it from data. Reference specific failure counts, file names, root causes.
2. **Right-sized scope**: Plan what should be done _now_, not everything that _could_ be done. A good plan is completable in one session (3-10 tasks). Explicitly defer what's out of scope.
3. **Intent as specification**: Each task's intent should tell the implementer what to do, _why_, the boundaries, and what _not_ to do. An implementer should be able to execute the task without asking a single question.
4. **Optional work labeled**: If a task is conditional ("only if flakiness persists"), label it optional and state the condition. Don't mix required and optional work without distinction.
5. **Out of scope section**: Explicitly state what was considered and deferred. This prevents scope creep during execution.
6. **Analysis section**: Document current state, tradeoffs, and architectural decisions made. The plan is a decision document, not just a task list.
7. **Dependency graph as parallel waves**: Use tree-format showing what runs in parallel and what gates. Mermaid supplements but doesn't replace the text tree.
8. **Depth matches complexity**: Simple renames get thin plans. Multi-system changes get 500-line specs. Don't over-document trivial work or under-document complex work.

Counter-pattern (early plans): thin intent, no evidence citation, scope-heavy (plan everything possible), no "out of scope", analysis absent or brief. These produce plans that are structurally valid but don't give implementers enough to execute autonomously.

## Notes as cross-dimensional communication (named pattern)

Notes (`tg note`) are the boundary-crossing mechanism between two agent perspectives:

- **Introspective** (implementer): sees one task, writes notes when it discovers something beyond its scope — conflicts, fragility, patterns, warnings.
- **Connective** (orchestrator, future implementers): sees many tasks, reads notes to detect cross-task phenomena — repeated failures, architectural drift, file conflicts.

Notes are stored task-scoped (event table, kind='note') but their _value_ is cross-task. A note written introspectively on task A about `migrate.ts` fragility is relevant to every task touching that file. Surfacing notes in `tg context` for related tasks completes the circuit — lets the connective dimension read what the introspective dimension wrote. Without cross-task surfacing, notes are trapped in the task that wrote them.

## Plan → project table (application code)

- After the schema migration renames `plan` to `project`, all application code must query/insert/update the `project` table (not `plan`). Status, next, show, cancel, import, plan, template, context, crossplan, MCP tools, export/markdown, and plan-completion were updated to use `"project"` as the table name. Column names (`plan_id`, `plan_title` alias) are unchanged. PROTECTED_TABLES includes both `plan` (view) and `project`.

## .env.local for integration tests

- `.env.local` values `DOLT_ROOT_PATH` and `TG_GOLDEN_TEMPLATE` must be **empty** (or set to the actual temp directory path, not to the `.taskgraph/tg-*.txt` path files). Bun auto-loads `.env.local`; if these point to the path files instead of the directories they contain, `getGoldenTemplatePath()` returns a file path, and `fs.cpSync(file, dir, {recursive:true})` fails with EISDIR. The `.env.local.example` correctly shows empty values.

## Pre-commit anti-pattern hook

- `.cursor/hooks/pre-commit-check.sh` enforces agent MUST NOT DO (as any, @ts-ignore, empty catch). Opt-in: install by copying or symlinking to `.git/hooks/pre-commit` (or use your git hooks manager). Script is executable; Cursor hooks.json has no pre-commit event, so this is git-level only.
