---
name: Dashboard Command and Status Snapshot
overview: Add tg dashboard as a live-updating TUI command; tg status becomes snapshot-only (same component, one-shot). No tg status --dashboard.
fileTree: |
  package.json                         (modify — add boxen, @opentui/core)
  src/
  └── cli/
      ├── index.ts                     (modify — register dashboard)
      ├── dashboard.ts                 (create)
      ├── status.ts                    (modify — remove --dashboard and live path)
      └── tui/                         (modify — OpenTUI live renderer, boxen helpers)
  __tests__/
  ├── cli/
  │   └── status.test.ts               (modify)
  └── integration/
      ├── status-live.test.ts          (modify → dashboard.test.ts or keep, test tg dashboard)
      └── dashboard.test.ts            (create if not renaming)
  docs/
  └── cli-reference.md                 (modify)
risks:
  - description: OpenTUI (@opentui/core) is Bun-oriented; Node support may be limited
    severity: medium
    mitigation: When OpenTUI init fails (e.g. Node), fall back to setInterval + ANSI clear + shared snapshot render. Document that best experience is bun run tg dashboard.
  - description: Raw mode and interval cleanup must run so terminal is not left broken
    severity: medium
    mitigation: Reuse same cleanup path for OpenTUI exit and fallback; test SIGINT and "q" for each.
  - description: Initiative table does not exist yet; --initiatives view must stub gracefully
    severity: low
    mitigation: When initiative table is missing, show clear message and exit 0; when present, show initiatives table.
tests:
  - "tg dashboard shows same sections as tg status and exits 0 on SIGINT"
  - "tg status is snapshot only (no live path); one-shot output"
  - "tg status --tasks/--projects/--initiatives one-shot render single table; --filter active/upcoming"
  - "Shared snapshot render: dashboard fallback and status use same component (Completed, Active Plans, Active Work, Next Runnable)"
  - "tg dashboard does not support --json (exits non-zero with message)"
todos:
  - id: tui-stack
    content: Add boxen for section boxes; OpenTUI live renderer with fallback
    agent: implementer
    intent: |
      1. Dependencies: Add boxen and @opentui/core (pnpm add boxen @opentui/core). Boxen is Node-friendly; OpenTUI is Bun-oriented — when createCliRenderer or OpenTUI init fails (e.g. under Node), fall back to setInterval + ANSI clear + shared snapshot render.
      2. Boxen: Wrap the current section headers in status output with boxen boxes. Each section (Completed, Active Plans, Active Work, Next Runnable) in a boxen box. Factor a helper in src/cli/tui/ or status.ts that builds a boxed section (title + content). Use getTerminalWidth().
      3. OpenTUI: In src/cli/tui/, create a live view renderer that when available uses createCliRenderer() and renders the dashboard content; 2s refresh; "q" and SIGINT tear down. When OpenTUI is not available, the caller (dashboard command) will use setInterval + ANSI clear + the same snapshot render function that status uses.
      4. Export or share a single "render status snapshot" function (e.g. printHumanStatus or renderStatusSnapshot(StatusData)) so both tg status (one-shot) and tg dashboard (fallback loop) use it. Status one-shot path uses boxen for sections after this task.
    suggestedChanges: |
      import boxen from 'boxen';
      Section boxes: boxen(sectionContent, { padding: 1, width: getTerminalWidth(), borderStyle: 'round' });
      Ensure status.ts exports or exposes the snapshot render for dashboard fallback to call.
    changeType: modify
    docs: [cli-reference, architecture]
    skill: cli-command-implementation

  - id: add-dashboard-command
    content: Add tg dashboard command (live TUI, same content as status snapshot)
    agent: implementer
    blockedBy: [tui-stack]
    intent: |
      Create src/cli/dashboard.ts and register it in index.ts as a top-level command: tg dashboard.

      Behavior: tg dashboard runs the live-updating TUI showing the same content as tg status (Completed, Active Plans, Active Work, Next Runnable). Accept the same filters as status: --plan, --domain, --skill, --change-type, --all. No --json support: if --json is passed, print to stderr that tg dashboard does not support --json and process.exit(1).

      Implementation: Read config, build StatusOptions from CLI options, then try OpenTUI live renderer (from tui-stack); on failure use fallback: setInterval(2000), each tick fetchStatusData(config, options) and call the shared snapshot render (same function status uses), with ANSI clear between redraws. Raw mode and "q"/SIGINT/SIGTERM cleanup. Initial draw before starting the interval.

      Reuse fetchStatusData and the shared human-status render from status.ts (export them if needed). Do not add any live path to status.ts — status remains snapshot-only.
    suggestedChanges: |
      In dashboard.ts: program.command('dashboard').description('Live-updating status dashboard (2s refresh; q or Ctrl+C to quit)').option('--plan ...').option('--domain ...') etc. Action: readConfig, build statusOptions, if rootOpts(cmd).json then exit 1 with message; try runOpenTUILiveDashboard(config, statusOptions); catch { useFallbackLoop(config, statusOptions) } using setInterval + fetchStatusData + shared render. In index.ts: import { dashboardCommand } from './dashboard'; dashboardCommand(program);
    changeType: create
    docs: [cli-reference, cli]
    skill: cli-command-implementation

  - id: status-snapshot-only
    content: Remove --dashboard and live path from tg status; status is snapshot only
    agent: implementer
    blockedBy: [tui-stack]
    intent: |
      In src/cli/status.ts, remove the --dashboard option and all code paths that run the live TUI (useLive, OpenTUI try/catch, fallback setInterval loop, raw mode for status). Status becomes snapshot-only: one-shot full view (Completed, Active Plans, Active Work, Next Runnable) or one-shot focused view (--tasks, --projects, --initiatives). Same filters (--plan, --domain, --skill, --change-type, --all) and --filter active/upcoming for focused views. JSON output unchanged (one-shot only). Use boxen for section boxes in the one-shot human output (from tui-stack). No live path in status.ts.
    suggestedChanges: |
      Delete .option('--dashboard', ...). Delete const useLive = options.dashboard and all branches that check useLive and run the live loop or OpenTUI. Keep only one-shot branches: full snapshot (fetchStatusData then printHumanStatus) and focused views (--tasks, --projects, --initiatives) one-shot. Ensure printHumanStatus (or shared render) is used for the full snapshot and is the same function dashboard fallback uses.
    changeType: modify
    docs: [cli-reference, cli]
    skill: cli-command-implementation

  - id: tasks-view
    content: Add tg status --tasks and --filter active (one-shot single table)
    agent: implementer
    blockedBy: [tui-stack]
    intent: |
      Add tg status --tasks. When set, show a single table of tasks (columns: task id or hash, title, plan title, status, optional owner). Reuse --plan, --domain, --skill, --change-type, --all. Add --filter active: restrict to task status IN (todo, doing, blocked). One-shot only: print single table in a boxen box and exit. Mutual exclusion: only one of --tasks, --projects, --initiatives. Implement fetchTasksTableData(config, options); status action branches on options.tasks to fetch and print this table instead of full snapshot.
    suggestedChanges: |
      StatusOptions: add optional filter?: string. Parse --filter; for tasks "active" => status IN (todo, doing, blocked). fetchTasksTableData: task+plan join with status/dim filters. One-shot print with boxen.
    changeType: modify
    docs: [schema, cli-reference]
    skill: cli-command-implementation

  - id: projects-view
    content: Add tg status --projects and --filter active (one-shot single table)
    agent: implementer
    blockedBy: [tui-stack]
    intent: |
      Add tg status --projects. Single table of projects (plan table: plan_id, title, status, task counts). Use "Project" in headers. Reuse --plan, --domain, --skill, --all. --filter active: plan status NOT IN (done, abandoned). One-shot only, boxen-wrapped table. Mutual exclusion with --tasks and --initiatives. fetchProjectsTableData; status branches on options.projects.
    suggestedChanges: |
      Reuse activePlansSql pattern. Columns: Project (title), Status, Todo, Doing, Blocked, Done. --filter active => WHERE status NOT IN ('done','abandoned').
    changeType: modify
    docs: [schema, cli-reference]
    skill: cli-command-implementation

  - id: initiatives-view
    content: Add tg status --initiatives and --filter upcoming (one-shot or stub)
    agent: implementer
    blockedBy: [tui-stack]
    intent: |
      Add tg status --initiatives. When initiative table does not exist: print stub message and exit 0. When it exists: fetch initiatives, --filter upcoming: status = 'draft' OR cycle_start > CURDATE(). One-shot boxen-wrapped table. fetchInitiativesTableData; tableExists('initiative') check.
    suggestedChanges: |
      tableExists('initiative'); if !exists print stub and exit; else fetchInitiativesTableData and render table.
    changeType: modify
    docs: [schema, cli-reference]
    skill: cli-command-implementation

  - id: docs-and-tests
    content: Document tg dashboard and status (snapshot only); add integration tests
    agent: implementer
    blockedBy:
      [
        add-dashboard-command,
        status-snapshot-only,
        tasks-view,
        projects-view,
        initiatives-view,
      ]
    intent: |
      1. docs/cli-reference.md: Add section for tg dashboard (live TUI; same content as status; --plan, --domain, etc.; no --json). Update tg status section: snapshot only, no --dashboard; document --tasks, --projects, --initiatives and --filter. Boxen sections for both.
      2. Integration tests: Test tg dashboard (SIGINT exits 0; same sections as status; --json exits non-zero). Test tg status is one-shot (no live path). Tests for --tasks, --projects, --initiatives one-shot and --filter. Rename or keep status-live.test.ts as dashboard.test.ts for tg dashboard tests.
    changeType: document
    docs: [cli-reference, testing]
    skill: documentation-sync, integration-testing
isProject: false
---

## Analysis

**tg dashboard** is a separate command for the live-updating TUI. **tg status** is snapshot-only: it renders the same component (Completed, Active Plans, Active Work, Next Runnable) once and exits. No `tg status --dashboard` — the dashboard is its own command.

- **tg dashboard:** Live TUI; same data and layout as status snapshot. OpenTUI when available, else setInterval + ANSI clear + shared snapshot render. Filters: --plan, --domain, --skill, --change-type, --all. No --json.
- **tg status:** One-shot only. Full view (same sections as dashboard content) or focused views (--tasks, --projects, --initiatives) with --filter. Uses boxen for section boxes. No live path.
- **Shared component:** One function (e.g. renderStatusSnapshot(StatusData) or printHumanStatus) used by status one-shot and by dashboard fallback so the UI is identical.

## Dependency graph

```text
Parallel start (1 unblocked):
  └── tui-stack

After tui-stack (parallel):
  ├── add-dashboard-command
  ├── status-snapshot-only
  ├── tasks-view
  ├── projects-view
  └── initiatives-view

After add-dashboard-command, status-snapshot-only, tasks-view, projects-view, initiatives-view:
  └── docs-and-tests
```

## Proposed changes

- **package.json:** Add boxen, @opentui/core.
- **src/cli/dashboard.ts:** New command; fetchStatusData + OpenTUI or fallback loop; shared snapshot render.
- **src/cli/status.ts:** Remove --dashboard and all live paths; snapshot only; boxen sections; keep --tasks, --projects, --initiatives one-shot.
- **src/cli/tui/:** Boxen helpers; OpenTUI live renderer; fallback uses same render as status.
- **src/cli/index.ts:** Register dashboardCommand(program).
- **Tests:** tg dashboard (SIGINT, no --json); tg status snapshot and focused views.
- **cli-reference.md:** tg dashboard section; tg status snapshot-only, no --dashboard.

## Mermaid

```mermaid
flowchart LR
  A[tg status] --> B[one-shot full]
  A --> C[--tasks]
  A --> D[--projects]
  A --> E[--initiatives]
  B --> F[same component]
  C --> G[one-shot table]
  D --> G
  E --> G
  H[tg dashboard] --> I[live TUI]
  I --> F
```

## Related plans

- **Status Live TUI** (26-02-27_status_live_tui.md) is retired. Live TUI is now tg dashboard.

## Original prompt

<original_prompt>
we dont even need tg status --dashboard if tg dashboard exists.
tg dashboard = live TUI. status = snapshot (similar component, not live).
Update the plan to include tasks for this.
</original_prompt>
