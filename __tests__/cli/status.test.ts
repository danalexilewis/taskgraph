import * as fs from "node:fs";
import * as path from "node:path";
import stripAnsi from "strip-ansi";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchStatusData } from "../../src/cli/status";
import { renderTable } from "../../src/cli/table";
import type { Config } from "../../src/cli/utils";
import { doltSql } from "../../src/db/connection";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "../integration/test-utils";

describe("renderTable responsive layout", () => {
  const headers = ["Plan", "Todo", "Doing", "Blocked", "Done", "Ready"];
  const rows = [
    ["Context Budget and Compaction", "5", "0", "0", "2", "3"],
    ["Docs and Skills Auto-Assignment Pipeline", "2", "4", "0", "1", "0"],
  ];
  const minWidths = [12, 4, 5, 7, 4, 5];

  it("table lines do not exceed maxWidth at 80 columns", () => {
    const output = renderTable({ headers, rows, maxWidth: 80, minWidths });
    const plain = stripAnsi(output);
    for (const line of plain.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it("table shrinks flex column at narrow width", () => {
    const output = renderTable({ headers, rows, maxWidth: 50, minWidths });
    const plainNarrow = stripAnsi(output);
    const plainWide = stripAnsi(
      renderTable({ headers, rows, maxWidth: 120, minWidths }),
    );
    const narrowLineWidth = Math.max(
      ...plainNarrow
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => l.length),
    );
    const wideLineWidth = Math.max(
      ...plainWide
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => l.length),
    );
    expect(narrowLineWidth).toBeLessThan(wideLineWidth);
  });

  it("2-column table fits within maxWidth", () => {
    const twoColHeaders = ["Task", "Plan"];
    const twoColRows = [
      [
        "Add resolveTaskId utility that accepts UUID or short hash",
        "Short Hash Task IDs",
      ],
      [
        "Update subagent-dispatch.mdc with two-stage review flow",
        "Two-Stage Review",
      ],
    ];
    const output = renderTable({
      headers: twoColHeaders,
      rows: twoColRows,
      maxWidth: 60,
      minWidths: [12, 10],
    });
    const plain = stripAnsi(output);
    for (const line of plain.split("\n").filter((l) => l.length > 0)) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });

  it("wraps long plan names at narrow width", () => {
    const output = renderTable({ headers, rows, maxWidth: 50, minWidths });
    const plain = stripAnsi(output);
    const lines = plain.split("\n").filter((l) => l.includes("Context"));
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it("table headers include yellow ANSI styling when chalk is enabled", () => {
    // chalk v5+ disables colors in non-TTY; force it on for this test
    const { default: chalkImport } = require("chalk") as {
      default: typeof import("chalk")["default"];
    };
    const origLevel = chalkImport.level;
    chalkImport.level = 1;
    try {
      const output = renderTable({ headers, rows, maxWidth: 80, minWidths });
      expect(output).not.toBe(stripAnsi(output));
    } finally {
      chalkImport.level = origLevel;
    }
  });
});

describe("Enhanced status output", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let planIdB: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });

    // Plan A: active plan with runnable tasks
    const planAContent = `---
name: Status Test Plan A
overview: "Plan for status output tests."
todos:
  - id: st-a1
    content: "Runnable task 1"
    status: pending
  - id: st-a2
    content: "Runnable task 2"
    status: pending
isProject: false
---
`;
    fs.writeFileSync(path.join(plansDir, "plan-a.md"), planAContent);

    // Plan B: second plan for --plan filter test
    const planBContent = `---
name: Status Test Plan B
overview: "Second plan for filter test."
todos:
  - id: st-b1
    content: "Plan B task"
    status: pending
isProject: false
---
`;
    fs.writeFileSync(path.join(plansDir, "plan-b.md"), planBContent);

    const { stdout: importA } = await runTgCli(
      `import plans/plan-a.md --plan "Status Test Plan A" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(importA).toContain("Successfully imported");

    const { stdout: importB } = await runTgCli(
      `import plans/plan-b.md --plan "Status Test Plan B" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(importB).toContain("Successfully imported");

    const plansList = await runTgCli(`plan list --json`, context.tempDir);
    const plans = JSON.parse(plansList.stdout) as Array<{
      plan_id: string;
      title: string;
    }>;
    const planA = plans.find((p) => p.title === "Status Test Plan A");
    const planB = plans.find((p) => p.title === "Status Test Plan B");
    expect(planA).toBeDefined();
    expect(planB).toBeDefined();
    planId = planA?.plan_id;
    planIdB = planB?.plan_id;
  }, 120000);

  afterAll(() => {
    if (context) {
      teardownIntegrationTest(context.tempDir);
    }
  });

  it("tg status outputs Completed section with plan and task counts", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli("status", context.tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Completed");
    expect(stdout).toMatch(/Plans: \d+ done/);
    expect(stdout).toMatch(/Tasks: \d+ done/);
    expect(stdout).toMatch(/Canceled: \d+/);
  }, 30000);

  it("tg status outputs Active Plans table with Todo, Doing, Done, Blocked, Actionable columns", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli("status", context.tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Active Plans");
    expect(stdout).toContain("Status Test Plan A");
    expect(stdout).toContain("Todo");
    expect(stdout).toContain("Doing");
    expect(stdout).toContain("Done");
    expect(stdout).toContain("Blocked");
    expect(stdout).toContain("Ready");
  }, 30000);

  it("tg status outputs Next Runnable table with tasks", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli("status", context.tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Next Runnable");
    expect(stdout).toContain("Runnable task 1");
    expect(stdout).toContain("Status Test Plan A");
  }, 30000);

  it("tg status --json returns JSON with completedPlans, completedTasks, canceledTasks, activePlans, staleTasks, nextTasks fields", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      "status --json",
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("completedPlans");
    expect(data).toHaveProperty("completedTasks");
    expect(data).toHaveProperty("canceledTasks");
    expect(data).toHaveProperty("activePlans");
    expect(data).toHaveProperty("staleTasks");
    expect(data).toHaveProperty("nextTasks");
    expect(Array.isArray(data.activePlans)).toBe(true);
    expect(Array.isArray(data.staleTasks)).toBe(true);
    expect(Array.isArray(data.nextTasks)).toBe(true);
  }, 30000);

  it("tg status --plan <planId> filters to a specific plan", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      `status --plan ${planId} --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.activePlans.length).toBe(1);
    expect(data.activePlans[0].plan_id).toBe(planId);
    expect(data.activePlans[0].title).toBe("Status Test Plan A");

    // Next tasks should only be from plan A
    for (const t of data.nextTasks) {
      expect(t.task_id).toBeDefined();
      expect(t.plan_title).toBe("Status Test Plan A");
    }

    // Filtering by plan B should show only plan B
    const { stdout: stdoutB } = await runTgCli(
      `status --plan ${planIdB} --json`,
      context.tempDir,
    );
    const dataB = JSON.parse(stdoutB);
    expect(dataB.activePlans.length).toBe(1);
    expect(dataB.activePlans[0].plan_id).toBe(planIdB);
    expect(dataB.activePlans[0].title).toBe("Status Test Plan B");
  }, 30000);

  it("completed plans are hidden from Active Plans table", async () => {
    if (!context) throw new Error("Context not initialized");

    // Create and import a plan with one task
    const plansDir = path.join(context.tempDir, "plans");
    const planCContent = `---
name: Status Test Plan C (To Complete)
overview: "Plan to complete and verify it is hidden."
todos:
  - id: st-c1
    content: "Single task to complete"
    status: pending
isProject: false
---
`;
    fs.writeFileSync(path.join(plansDir, "plan-c-complete.md"), planCContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/plan-c-complete.md --plan "Status Test Plan C (To Complete)" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(importOut).toContain("Successfully imported");

    const plansList = await runTgCli(`plan list --json`, context.tempDir);
    const plans = JSON.parse(plansList.stdout) as Array<{
      plan_id: string;
      title: string;
    }>;
    const planC = plans.find(
      (p) => p.title === "Status Test Plan C (To Complete)",
    );
    expect(planC).toBeDefined();
    const planIdC = planC?.plan_id;

    const tasksResult = await doltSql(
      `SELECT task_id FROM \`task\` WHERE plan_id = '${planIdC}'`,
      context.doltRepoPath,
    );
    expect(tasksResult.isOk()).toBe(true);
    const taskRows = tasksResult._unsafeUnwrap() as Array<{
      task_id: string;
    }>;
    expect(taskRows.length).toBe(1);
    const taskIdC = taskRows[0].task_id;

    await runTgCli(
      `done ${taskIdC} --evidence "completed" --force`,
      context.tempDir,
    );

    const updateResult = await doltSql(
      `UPDATE \`plan\` SET \`status\` = 'done' WHERE plan_id = '${planIdC}'`,
      context.doltRepoPath,
    );
    expect(updateResult.isOk()).toBe(true);

    const { exitCode, stdout } = await runTgCli("status", context.tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("Status Test Plan C (To Complete)");
  }, 30000);

  it("tg status Active Work section shows table with Task, Plan, Agent columns", async () => {
    if (!context) throw new Error("Context not initialized");

    const tasksResult = await doltSql(
      `SELECT task_id FROM \`task\` WHERE plan_id = '${planId}' ORDER BY external_key LIMIT 1`,
      context.doltRepoPath,
    );
    expect(tasksResult.isOk()).toBe(true);
    const taskRows = tasksResult._unsafeUnwrap() as Array<{
      task_id: string;
    }>;
    expect(taskRows.length).toBeGreaterThan(0);
    const taskId = taskRows[0].task_id;

    await runTgCli(`start ${taskId} --agent implementer-3`, context.tempDir);

    const { exitCode, stdout } = await runTgCli("status", context.tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Active Work");
    expect(stdout).toContain("Task");
    expect(stdout).toContain("Plan");
    expect(stdout).toContain("Agent");
    expect(stdout).toContain("│");
  }, 30000);

  it("tg status --projects shows single Projects table with Project, Status, Todo, Doing, Blocked, Done", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      "status --projects",
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Projects");
    expect(stdout).toContain("Project");
    expect(stdout).toContain("Status");
    expect(stdout).toContain("Todo");
    expect(stdout).toContain("Doing");
    expect(stdout).toContain("Blocked");
    expect(stdout).toContain("Done");
    expect(stdout).toContain("Status Test Plan A");
  }, 30000);

  it("tg status --projects --json returns array of project rows with plan_id, title, status, todo, doing, blocked, done", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      "status --projects --json",
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const rows = JSON.parse(stdout);
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      const first = rows[0];
      expect(first).toHaveProperty("plan_id");
      expect(first).toHaveProperty("title");
      expect(first).toHaveProperty("status");
      expect(first).toHaveProperty("todo");
      expect(first).toHaveProperty("doing");
      expect(first).toHaveProperty("blocked");
      expect(first).toHaveProperty("done");
    }
  }, 30000);

  it("tg status --projects --filter active excludes done and abandoned plans", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      "status --projects --filter active --json",
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const rows = JSON.parse(stdout);
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      expect(["draft", "active", "paused"]).toContain(row.status);
      expect(row.status).not.toBe("done");
      expect(row.status).not.toBe("abandoned");
    }
  }, 30000);

  it("tg status --tasks shows single Tasks table with Id, Title, Plan, Status, Owner", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      "status --tasks",
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Tasks");
    expect(stdout).toContain("Id");
    expect(stdout).toContain("Title");
    expect(stdout).toContain("Plan");
    expect(stdout).toContain("Status");
    expect(stdout).toContain("Owner");
    expect(stdout).toContain("Status Test Plan A");
  }, 30000);

  it("tg status --tasks --json returns array of task rows with task_id, hash_id, title, plan_title, status, owner", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      "status --tasks --json",
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const rows = JSON.parse(stdout);
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      const first = rows[0];
      expect(first).toHaveProperty("task_id");
      expect(first).toHaveProperty("title");
      expect(first).toHaveProperty("plan_title");
      expect(first).toHaveProperty("status");
      expect(first).toHaveProperty("owner");
    }
  }, 30000);

  it("tg status --tasks --filter active returns only todo, doing, blocked tasks", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      "status --tasks --filter active --json",
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const rows = JSON.parse(stdout);
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      expect(["todo", "doing", "blocked"]).toContain(row.status);
    }
  }, 30000);

  it("tg status with both --tasks and --projects exits non-zero with mutual exclusion message", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stderr } = await runTgCli(
      "status --tasks --projects",
      context.tempDir,
      true,
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("only one of");
  }, 10000);

  it("tg status Next Runnable section shows at most 3 tasks", async () => {
    if (!context) throw new Error("Context not initialized");

    const plansDir = path.join(context.tempDir, "plans");
    const planDContent = `---
name: Status Test Plan D (Five Tasks)
overview: "Plan with 5 runnable tasks to verify 3-item limit."
todos:
  - id: st-d1
    content: "Plan D task 1"
    status: pending
  - id: st-d2
    content: "Plan D task 2"
    status: pending
  - id: st-d3
    content: "Plan D task 3"
    status: pending
  - id: st-d4
    content: "Plan D task 4"
    status: pending
  - id: st-d5
    content: "Plan D task 5"
    status: pending
isProject: false
---
`;
    fs.writeFileSync(path.join(plansDir, "plan-d-five-tasks.md"), planDContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/plan-d-five-tasks.md --plan "Status Test Plan D (Five Tasks)" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(importOut).toContain("Successfully imported");

    const { exitCode, stdout } = await runTgCli("status", context.tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Next Runnable");

    const { stdout: jsonOut } = await runTgCli(
      "status --json",
      context.tempDir,
    );
    const data = JSON.parse(jsonOut);
    expect(data.nextTasks.length).toBeLessThanOrEqual(3);
  }, 30000);
});

describe("fetchStatusData", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

  beforeAll(async () => {
    context = await setupIntegrationTest();
  }, 60000);

  afterAll(() => {
    if (context) {
      teardownIntegrationTest(context.tempDir);
    }
  });

  it("returns Result whose value has StatusData shape (integration DB)", async () => {
    if (!context) throw new Error("Context not initialized");
    const config: Config = { doltRepoPath: context.doltRepoPath };
    const result = await fetchStatusData(config, {});

    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data).toHaveProperty("completedPlans");
    expect(data).toHaveProperty("completedTasks");
    expect(data).toHaveProperty("canceledTasks");
    expect(data).toHaveProperty("activePlans");
    expect(data).toHaveProperty("staleTasks");
    expect(data).toHaveProperty("nextTasks");
    expect(data).toHaveProperty("activeWork");
    expect(data).toHaveProperty("plansCount");
    expect(data).toHaveProperty("statusCounts");
    expect(data).toHaveProperty("actionableCount");
    expect(typeof data.completedPlans).toBe("number");
    expect(typeof data.completedTasks).toBe("number");
    expect(typeof data.canceledTasks).toBe("number");
    expect(Array.isArray(data.activePlans)).toBe(true);
    expect(Array.isArray(data.staleTasks)).toBe(true);
    expect(Array.isArray(data.nextTasks)).toBe(true);
    expect(Array.isArray(data.activeWork)).toBe(true);
    expect(typeof data.plansCount).toBe("number");
    expect(
      data.statusCounts !== null && typeof data.statusCounts === "object",
    ).toBe(true);
    expect(typeof data.actionableCount).toBe("number");
  }, 20000);
});
