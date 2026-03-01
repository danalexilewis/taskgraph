import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { doltSql } from "../../src/db/connection";
import { syncBlockedStatusForTask } from "../../src/domain/blocked-status";
import { ErrorCode } from "../../src/domain/errors";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

// Serial: flaky under concurrency (DB-dependent; status transitions order-sensitive).
describe.serial("Blocked status materialized integration", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let blockerTaskId: string;
  let dependentTaskId: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });

    const planContent = `---
name: Blocked Status Test Plan
overview: "Plan with blockedBy to test materialized blocked status."
todos:
  - id: blocker
    content: "Blocker task"
    status: pending
  - id: dependent
    content: "Dependent task"
    blockedBy: [blocker]
    status: pending
---
`;
    fs.writeFileSync(
      path.join(plansDir, "blocked-status-plan.md"),
      planContent,
    );

    const { stdout: importOut } = await runTgCli(
      `import plans/blocked-status-plan.md --plan "Blocked Status Test Plan" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(importOut).toContain("Successfully imported");

    const { stdout: listOut } = await runTgCli(
      `plan list --json`,
      context.tempDir,
    );
    const plans = JSON.parse(listOut) as Array<{
      plan_id: string;
      title: string;
    }>;
    const plan = plans.find((p) => p.title === "Blocked Status Test Plan");
    expect(plan).toBeDefined();
    planId = plan?.plan_id;

    const tasksResult = await doltSql(
      `SELECT task_id, external_key, status FROM \`task\` WHERE plan_id = '${planId}' ORDER BY external_key`,
      context.doltRepoPath,
    );
    expect(tasksResult.isOk()).toBe(true);
    const tasks = tasksResult._unsafeUnwrap() as Array<{
      task_id: string;
      external_key: string;
      status: string;
    }>;
    expect(tasks.length).toBe(2);
    // external_key may include plan-scoped 6-char suffix
    const stableKey = (ek: string) => ek.replace(/-[0-9a-f]{6}$/i, "");
    const blockerRow = tasks.find(
      (t) => stableKey(t.external_key) === "blocker",
    );
    const dependentRow = tasks.find(
      (t) => stableKey(t.external_key) === "dependent",
    );
    expect(blockerRow).toBeDefined();
    expect(dependentRow).toBeDefined();
    blockerTaskId = blockerRow?.task_id;
    dependentTaskId = dependentRow?.task_id;
  }, 60000);

  afterAll(async () => {
    if (context) {
      await teardownIntegrationTest(context);
    }
  });

  it("import with blockedBy yields dependent task with status=blocked", async () => {
    if (!context) throw new Error("Context not initialized");
    const result = await doltSql(
      `SELECT status FROM \`task\` WHERE task_id = '${dependentTaskId}'`,
      context.doltRepoPath,
    );
    expect(result.isOk()).toBe(true);
    const rows = result._unsafeUnwrap() as Array<{ status: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("blocked");
  }, 20000);

  it("tg done on blocker moves dependent to todo", async () => {
    if (!context) throw new Error("Context not initialized");
    await runTgCli(`start ${blockerTaskId}`, context.tempDir);
    await runTgCli(
      `done ${blockerTaskId} --evidence "blocker completed"`,
      context.tempDir,
    );
    const result = await doltSql(
      `SELECT status FROM \`task\` WHERE task_id = '${dependentTaskId}'`,
      context.doltRepoPath,
    );
    expect(result.isOk()).toBe(true);
    const rows = result._unsafeUnwrap() as Array<{ status: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("todo");
  }, 20000);

  it("tg edge add blocks makes to_task status=blocked", async () => {
    if (!context) throw new Error("Context not initialized");
    const { stdout: newTaskOut } = await runTgCli(
      `task new "Extra blocker" --plan ${planId} --json`,
      context.tempDir,
    );
    const newTask = JSON.parse(newTaskOut) as { task_id: string };
    const extraBlockerId = newTask.task_id;

    await runTgCli(
      `edge add ${extraBlockerId} blocks ${dependentTaskId}`,
      context.tempDir,
    );
    const result = await doltSql(
      `SELECT status FROM \`task\` WHERE task_id = '${dependentTaskId}'`,
      context.doltRepoPath,
    );
    expect(result.isOk()).toBe(true);
    const rows = result._unsafeUnwrap() as Array<{ status: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("blocked");

    // Cancel the extra blocker so dependent becomes todo again (for test isolation)
    await runTgCli(
      `cancel ${extraBlockerId} --reason "test cleanup"`,
      context.tempDir,
    );
    const afterCancel = await doltSql(
      `SELECT status FROM \`task\` WHERE task_id = '${dependentTaskId}'`,
      context.doltRepoPath,
    );
    expect(afterCancel.isOk()).toBe(true);
    expect(
      (afterCancel._unsafeUnwrap() as Array<{ status: string }>)[0].status,
    ).toBe("todo");
  }, 20000);

  it("tg cancel on blocker unblocks dependent", async () => {
    if (!context) throw new Error("Context not initialized");
    // Re-create a blocker that is not done: add new task and edge
    const { stdout: newTaskOut } = await runTgCli(
      `task new "Blocker to cancel" --plan ${planId} --json`,
      context.tempDir,
    );
    const newTask = JSON.parse(newTaskOut) as { task_id: string };
    const cancelBlockerId = newTask.task_id;
    await runTgCli(
      `edge add ${cancelBlockerId} blocks ${dependentTaskId}`,
      context.tempDir,
    );
    let result = await doltSql(
      `SELECT status FROM \`task\` WHERE task_id = '${dependentTaskId}'`,
      context.doltRepoPath,
    );
    expect(result.isOk()).toBe(true);
    expect(
      (result._unsafeUnwrap() as Array<{ status: string }>)[0].status,
    ).toBe("blocked");

    await runTgCli(
      `cancel ${cancelBlockerId} --reason "test cancel unblock"`,
      context.tempDir,
    );
    result = await doltSql(
      `SELECT status FROM \`task\` WHERE task_id = '${dependentTaskId}'`,
      context.doltRepoPath,
    );
    expect(result.isOk()).toBe(true);
    expect(
      (result._unsafeUnwrap() as Array<{ status: string }>)[0].status,
    ).toBe("todo");
  }, 20000);
});

// Serial: flaky under concurrency (DB-dependent).
describe.serial("syncBlockedStatusForTask with seeded DB", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  const planId = "a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const taskTodoId = "b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const taskBlockedId = "c3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const blockerId = "d4eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  beforeAll(async () => {
    context = await setupIntegrationTest();

    (
      await doltSql(
        `INSERT INTO \`project\` (plan_id, title, intent, created_at, updated_at) VALUES (
        '${planId}', 'Sync Test Plan', 'Intent', NOW(), NOW()
      );`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES
        ('${blockerId}', '${planId}', 'Blocker', 'todo', NOW(), NOW()),
        ('${taskTodoId}', '${planId}', 'Todo with blocker', 'todo', NOW(), NOW()),
        ('${taskBlockedId}', '${planId}', 'Blocked task', 'blocked', NOW(), NOW());`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`edge\` (from_task_id, to_task_id, type) VALUES
        ('${blockerId}', '${taskTodoId}', 'blocks');`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();
  }, 60000);

  afterAll(async () => {
    if (context) {
      await teardownIntegrationTest(context);
    }
  });

  it("syncBlockedStatusForTask: task with unmet blockers becomes blocked", async () => {
    if (!context) throw new Error("Context not initialized");
    const result = await syncBlockedStatusForTask(
      context.doltRepoPath,
      taskTodoId,
    );
    expect(result.isOk()).toBe(true);
    const statusResult = await doltSql(
      `SELECT status FROM \`task\` WHERE task_id = '${taskTodoId}'`,
      context.doltRepoPath,
    );
    expect(statusResult.isOk()).toBe(true);
    const rows = statusResult._unsafeUnwrap() as Array<{ status: string }>;
    expect(rows[0].status).toBe("blocked");
  });

  it("syncBlockedStatusForTask: task that is blocked with all blockers cleared becomes todo", async () => {
    if (!context) throw new Error("Context not initialized");
    // taskBlockedId has no edges; sync should move it to todo
    const result = await syncBlockedStatusForTask(
      context.doltRepoPath,
      taskBlockedId,
    );
    expect(result.isOk()).toBe(true);
    const statusResult = await doltSql(
      `SELECT status FROM \`task\` WHERE task_id = '${taskBlockedId}'`,
      context.doltRepoPath,
    );
    expect(statusResult.isOk()).toBe(true);
    const rows = statusResult._unsafeUnwrap() as Array<{ status: string }>;
    expect(rows[0].status).toBe("todo");
  });

  it("syncBlockedStatusForTask returns TASK_NOT_FOUND for missing task", async () => {
    if (!context) throw new Error("Context not initialized");
    const result = await syncBlockedStatusForTask(
      context.doltRepoPath,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.TASK_NOT_FOUND);
  });
});
