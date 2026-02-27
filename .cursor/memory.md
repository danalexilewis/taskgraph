# Persistent Memory

## Plan import

- Task **title** (from todo `content`) is stored in `task.title` (VARCHAR(255)). Keep plan todo titles under 255 characters or import will fail.

## tg context

- Context command reads domain/skill from **task_domain** and **task_skill** junction tables (when present). Repos that have run the full migration suite use these; older repos may have `task.domain` / `task.skill` columns instead.

## Using tg in another repo

- No script in package.json needed: `pnpm tg` runs the CLI from node_modules/.bin. Same for `npx tg` with npm.

## CLI scaffolding (`tg setup`)

- Commander `--no-<flag>` options default to `true`; don’t pass `false` as the default value or you’ll invert behavior (setup will do nothing).
- Package entrypoints should match build output: `package.json` `bin`/`main` point at `dist/cli/index.js`.
- `tg setup` resolves templates from `path.join(__dirname, '..', 'template')`: at runtime dist/cli → dist/template; in dev (tsx) src/cli → src/template. Templates live in `src/template/` and are copied to `dist/template/` by the build.

## Dolt JSON columns

- `event.body` may be returned as object or string by doltSql depending on driver. Handle both: `typeof raw === 'string' ? JSON.parse(raw) : raw`.

## DAL writable (read-only errors)

- All Dolt invocations use `--data-dir <repoPath>` so the repo is explicit (avoids wrong cwd or connecting to a server). They pass `DOLT_READ_ONLY=false` in env so Dolt treats the session as writable when the repo allows it. `commit.ts` uses `process.env.DOLT_PATH || "dolt"` for consistency with connection/migrate.

## Migration idempotency

- `applyTaskDimensionsMigration` must skip when `task_domain` exists (junction migration has run and dropped domain/skill from task). Otherwise re-adding columns conflicts with existing `change_type`.
- **No-delete triggers:** Dolt does not support `SIGNAL SQLSTATE` inside triggers (syntax error at SIGNAL). The no-delete migration creates triggers when supported; on failure it records the attempt in `_taskgraph_migrations` so we don’t retry every command. Application-layer guard in `connection.ts` still blocks DELETE on protected tables.

## Plan authoring (user correction)

- **Always use rich planning.** Plans must include fileTree, risks, tests, per-task intent, suggestedChanges when helpful, and markdown body ending with `<original_prompt>`. See docs/plan-format.md and .cursor/rules/plan-authoring.mdc. When creating plans, follow the rule — do not default to minimal/spartan format.

## Plan creation — planner-analyst required

- **Planning MUST use the planner-analyst sub-agent first.** AGENT.md and plan-authoring.mdc state this explicitly. Skipping the analyst when the user asks for a plan is a critical failure. The agent in consuming projects gets AGENT.md from the template; it must see the mandatory two-step flow (1. dispatch analyst, 2. write plan from analyst output).

## Execution — sub-agents mandatory, max 3

- **Task execution MUST use implementer (and reviewer) sub-agents.** AGENT.md and subagent-dispatch.mdc require it; max 3 tasks in flight. Direct execution only after 2 sub-agent failures or when task is explicitly exploratory. Skipping dispatch during execution is a critical failure.

## Dispatch mechanisms (choose by environment)

- **In-IDE / terminal**: Task tool or `agent` CLI (see docs/cursor-agent-cli.md). **This environment** (no Task tool): use **mcp_task** with the same built prompt and short description (e.g. "Implement task: &lt;title&gt;"); subagent_type generalPurpose or explore. Same prompt and workflow; only invocation differs. Do not skip dispatch because the Task tool is not visible — use mcp_task.

## Plan filename convention

- Plan filenames: `yy-mm-dd_the_file_name.md` (e.g. `26-02-26_restructure_src_npm_layout.md`). Two-digit year, date, then underscore and slug. See plan-authoring.mdc.

## Memory rule (for agents)

- memory.mdc includes an explicit trigger list and a "Before you consider your response complete" checklist. If any trigger applied (bug fix, pattern/rule change, user correction, tooling quirk), the last edit in that response must be to .cursor/memory.md — do not skip.

## Orchestrator plan-creation patterns (learned)

- **Don't transcribe analyst output verbatim.** The planner-analyst gathers facts; the orchestrator must critically evaluate dependencies, define vague metrics concretely, and ensure tasks are specific enough for fast sub-agents.
- **Existing data first.** Before designing new data capture (e.g. token flags), check what's derivable from existing data (timestamps give elapsed time, event counts give friction signals, etc.).
- **Minimize serial dependencies.** Ask "can this task work without the upstream?" for each blockedBy. Decouple capture from consumption (e.g. report command shouldn't block on token capture — it works without it).
- **Resolve open questions in the plan.** Don't leave "same command or separate?" for implementers — decide in the plan or create an investigate task.
- **Assign tests to tasks.** Plan-level `tests` array without a task that owns them means nobody writes them.

## Learning mode

- Toggle: `"learningMode": true` in `.taskgraph/config.json`. Orchestrator reads this before running the review protocol.

## Build and on-stop hook

- **Rebuild when src/ changes:** An on-stop hook (`.cursor/hooks/rebuild-if-src-changed.js`) runs at end of turn. If `git status` shows any changes under `src/`, it runs `pnpm build` so `dist/` is not stale for the next session or for integration tests. Rule: we rebuild when changes are detected in src at the end of a session/operation sequence; the hook implements that.
- New hooks go in `.cursor/hooks/` and are registered in `.cursor/hooks.json`. Use the create-hook skill (`.cursor/skills/create-hook/SKILL.md`) to add or document hooks.

## Plan re-import (Dolt read-only)

- During bulk plan import, Dolt can report "cannot update manifest: database is read only", causing partial imports. If that happens, prefer **restoring from Dolt history** (or git): the DB is versioned in git (.taskgraph/dolt is committed). Use `dolt log -n 50` to find a commit before the loss (e.g. "plan-import: upsert tasks and edges" after the last plan create), then `dolt checkout <commit> -b restore_xxx`, `dolt checkout main`, `dolt reset --hard restore_xxx`, `dolt branch -d restore_xxx` to make that state main.

## tg export markdown

- Export writes to **exports/** by default (exports/<planId>.md). It **never** writes into plans/ — writing to plans/ is blocked to avoid overwriting plan files.
- The exported content is frontmatter-only (todos + statuses); it is not a full round-trip of fileTree, risks, or body. Use exports/ as the destination; keep plan files in plans/ as the source of truth.
- Review triggers after implementer, explorer, or planner-analyst completes — not after reviewer.
- Learnings go in each agent's `## Learnings` section, injected as `{{LEARNINGS}}` placeholder. Consolidate into prompt template when >10 entries.

## Skills

- Test-review skill: produces a report and a Cursor-format plan with tasks; each task has an `agent` field so execution uses `tg start <taskId> --agent <agent>`. Plan format supports optional todo field `agent` (docs/plan-format.md, plan-authoring.mdc).
