---
name: add health-check skill and enhance status command
overview: >
  Add a health-check skill and enhance the `tg status` command to surface vanity metrics and health insights.
fileTree: |
  src/
  ├── cli/
  │   └── status.ts
  ├── skills/
  │   └── health-check/
  │       └── SKILL.md
  package.json
  tests/
    ├── cli/
    │   └── status.test.ts
    └── skills/
        └── health-check.test.ts
risks:
  - name: increased CLI startup time
    description: new health-check analysis may slow down `tg status` execution.
  - name: dependency conflicts
    description: adding `cli-table3` could conflict with existing dependencies.
tests:
  - description: verify vanity metrics output in `tg status`
    path: tests/cli/status.test.ts
  - description: verify tables format correctly
    path: tests/cli/status.test.ts
  - description: verify health-check detection logic (stale, orphaned, unresolved)
    path: tests/skills/health-check.test.ts
todos:
  - id: add-cli-table3-dep
    content: Add terminal formatting and reporting dependencies (cli-table3, chalk, log-symbols, jest-diff, strip-ansi, wrap-ansi, terminal-link) to `package.json`.
    intent: enable colorized output, symbols, aligned tables, diff summaries, ANSI stripping, wrapping, and clickable links in supporting terminals.
    dependencies: []
    suggestedChanges: |
      To add the dependencies, update package.json or run:
      ```bash
      pnpm install cli-table3 chalk log-symbols jest-diff strip-ansi wrap-ansi terminal-link
      ```
  - id: create-health-skill-module
    content: Create `src/skills/health-check/SKILL.md` with detection functions.
    intent: provide health-check capabilities.
    dependencies: [add-cli-table3-dep]
  - id: implement-stale-task-detection
    content: Implement function to detect stale tasks (`doing` with no active worker).
    intent: detect tasks needing attention.
    dependencies: [create-health-skill-module]
  - id: implement-orphaned-task-detection
    content: Implement function to detect orphaned tasks (no plan or engagement).
    intent: catch tasks not associated with active work.
    dependencies: [create-health-skill-module]
  - id: implement-unresolved-deps-detection
    content: Implement function to detect unresolved cross-plan dependencies.
    intent: surface blocking tasks across plans.
    dependencies: [create-health-skill-module]
  - id: enhance-status-command
    content: Update `src/cli/status.ts` to gather metrics, call health-check functions, and format output tables.
    intent: surface vanity metrics and health information.
    dependencies: [add-cli-table3-dep, create-health-skill-module]
    suggestedChanges: |
      In `src/cli/status.ts`, import and use the libraries:
      ```ts
      import chalk from 'chalk';
      import Table from 'cli-table3';
      import logSymbols from 'log-symbols';
      import { diffLines } from 'jest-diff';
      import stripAnsi from 'strip-ansi';
      import wrapAnsi from 'wrap-ansi';
      import terminalLink from 'terminal-link';

      // Vanity metrics section
      console.log(chalk.bold.green('✔ Total completed plans:'), completedPlans);
      console.log(chalk.bold.blue('ℹ Active plans:'), activePlanCount);

      // Table per active plan
      const planTable = new Table({ head: ['Plan ID', 'Title', 'Todo', 'Doing', 'Blocked', 'Actionable'] });
      plans.forEach(p => planTable.push([p.id, p.title, p.todo, p.doing, p.blocked, p.actionable]));
      console.log(planTable.toString());

      // Next runnable tasks table
      const taskTable = new Table({ head: ['Task ID', 'Title', 'Plan'] });
      nextTasks.forEach(t => taskTable.push([t.id, t.title, t.plan]));
      console.log(taskTable.toString());

      // Example of diff summary for failures
      console.log(logSymbols.error, chalk.red('Differences:'), diffLines(expectedOutput, actualOutput));

      // Wrap long lines and strip ANSI for logs
      const wrapped = wrapAnsi(chalk.yellow('Long message...'), process.stdout.columns || 80);
      console.log(stripAnsi(wrapped));

      // Clickable link to plan file
      console.log('See plan file:', terminalLink('Plan Document', `file://${planFilePath}`));
      ```
  - id: write-status-tests
    content: Write tests for enhanced status output in `tests/cli/status.test.ts`.
    intent: ensure `tg status` works as expected.
    dependencies: [enhance-status-command]
  - id: write-health-tests
    content: Write tests for health-check functions in `tests/skills/health-check.test.ts`.
    intent: validate health-check logic.
    dependencies:
      [
        implement-stale-task-detection,
        implement-orphaned-task-detection,
        implement-unresolved-deps-detection,
      ]
dependencyGraph: |
  start:
    - add-cli-table3-dep
    - create-health-skill-module
  after create-health-skill-module:
    - implement-stale-task-detection
    - implement-orphaned-task-detection
    - implement-unresolved-deps-detection
  after add-cli-table3-dep, create-health-skill-module:
    - enhance-status-command
  after enhance-status-command:
    - write-status-tests
  after implement-stale-task-detection, implement-orphaned-task-detection, implement-unresolved-deps-detection:
    - write-health-tests
---

## Analysis

1. **package.json**: Add `cli-table3` under `dependencies` and run `pnpm install`.
2. **Health-check skill**: Create `src/skills/health-check/SKILL.md` with detection functions:
   - `detectStaleTasks`: queries tasks with `doing` status and no assigned worker.
   - `detectOrphanedTasks`: finds tasks not linked to any plan or engagement events.
   - `detectUnresolvedDependencies`: identifies tasks blocked by tasks in other plans.
3. **Status command**: In `src/cli/status.ts`:
   - Import health-check functions.
   - Compute vanity metrics: total completed plans, tasks, and remaining tasks.
   - Use `cli-table3` to render:
     - Vanity metrics section.
     - Table per active plan with columns: plan ID, title, todo, doing, blocked, actionable counts.
     - Table of next runnable tasks (task ID, title, plan ID).
4. **Tests**: Under `tests/cli/status.test.ts` and `tests/skills/health-check.test.ts`, write unit tests covering:
   - Metrics accuracy.
   - Table formatting.
   - Detection logic edge cases (no active workers, tasks without plans, cross-plan blocks).

<original_prompt>
The user wants to improve the Task Graph CLI by adding a health-check skill for plans and tasks, and enhance the `tg status` command. Specifically:

1. Add a new skill that can detect stale tasks (status `doing` with no active worker), orphaned tasks (tasks with no plan or no engagement), and unresolved dependencies across plans.
2. Enhance `tg status` to display vanity metrics upfront: total completed plans, total completed tasks, total not done tasks.
3. Output a table per active plan (plans not yet complete) with columns: plan ID, plan title, counts of todo, doing, blocked, actionable tasks.
4. Output a second table listing the next runnable tasks across active plans, showing task ID, title, and associated plan.
5. Consider using a terminal table library like `cli-table3` or Node’s `console.table` for formatting.

Tasks to plan:

- Identify and update `src/cli/status.ts` to gather the new metrics and format them.
- Add a new skill module under `src/skills/health-check/SKILL.md` with functions to detect stale and orphaned tasks.
- Add dependencies (e.g., `cli-table3`) to package.json if needed and update imports.
- Write tests for the new status output and the health-check skill.

Please produce a rich Cursor-format plan (in `plans/`) with fields: `fileTree`, `risks`, `tests`, `todos` (with ids, content, intent, dependencies), dependency graph, and a markdown body with analysis and the original prompt.
</original_prompt>
