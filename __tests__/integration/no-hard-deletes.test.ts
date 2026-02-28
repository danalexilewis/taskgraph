import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { doltSql } from "../../src/db/connection";
import { ErrorCode } from "../../src/domain/errors";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("No hard deletes: guard and cancel", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let taskId1: string;
  let taskId2: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planPath = path.join(plansDir, "no-hard-deletes-plan.md");
    const planContent = `---
name: No Hard Deletes Test Plan
overview: "Plan for guard and cancel integration tests."
todos:
  - id: nd-task-a
    content: "Task A"
    domain: cli
    status: pending
  - id: nd-task-b
    content: "Task B"
    domain: cli
    status: pending
isProject: false
---
`;
    fs.writeFileSync(planPath, planContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/no-hard-deletes-plan.md --plan "No Hard Deletes Test Plan" --format cursor --no-commit`,
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
      status: string;
    }>;
    const plan = plans.find((p) => p.title === "No Hard Deletes Test Plan");
    expect(plan).toBeDefined();
    planId = plan?.plan_id;

    const tasksResult = await doltSql(
      `SELECT task_id, external_key FROM \`task\` WHERE plan_id = '${planId}' ORDER BY external_key`,
      context.doltRepoPath,
    );
    expect(tasksResult.isOk()).toBe(true);
    const tasks = tasksResult._unsafeUnwrap() as Array<{
      task_id: string;
      external_key: string;
    }>;
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    taskId1 = tasks[0].task_id;
    taskId2 = tasks[1].task_id;
  }, 60000);

  afterAll(() => {
    if (context) {
      teardownIntegrationTest(context.tempDir);
    }
  });

  it("1) raw DELETE FROM plan returns VALIDATION_FAILED", async () => {
    if (!context) throw new Error("Context not initialized");
    const result = await doltSql(
      "DELETE FROM plan WHERE 1=0",
      context.doltRepoPath,
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("2) raw DROP TABLE task returns VALIDATION_FAILED", async () => {
    if (!context) throw new Error("Context not initialized");
    const result = await doltSql("DROP TABLE task", context.doltRepoPath);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("3) re-import with task_domain DELETE succeeds (whitelisted)", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode } = await runTgCli(
      `import plans/no-hard-deletes-plan.md --plan "No Hard Deletes Test Plan" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
  }, 30000);

  it("4) tg cancel <planId> sets plan status to abandoned", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode } = await runTgCli(
      `cancel ${planId} --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);

    const { stdout } = await runTgCli(`plan list --json`, context.tempDir);
    const plans = JSON.parse(stdout) as Array<{
      plan_id: string;
      status: string;
    }>;
    const plan = plans.find((p) => p.plan_id === planId);
    expect(plan).toBeDefined();
    expect(plan?.status).toBe("abandoned");
  }, 30000);

  it("5) tg cancel <taskId> sets task status to canceled", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode } = await runTgCli(
      `cancel ${taskId1} --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);

    const { stdout } = await runTgCli(
      `show ${taskId1} --json`,
      context.tempDir,
    );
    const data = JSON.parse(stdout) as { taskDetails: { status: string } };
    expect(data.taskDetails.status).toBe("canceled");
  }, 30000);

  it("6) tg cancel on done task fails", async () => {
    if (!context) throw new Error("Context not initialized");
    await runTgCli(
      `start ${taskId2} --agent test --no-commit`,
      context.tempDir,
    );
    await runTgCli(`done ${taskId2} --no-commit`, context.tempDir);

    const result = await runTgCli(
      `cancel ${taskId2} --no-commit`,
      context.tempDir,
      true,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/terminal state|Invalid|refusing/i);
  }, 30000);

  it("7) tg status excludes canceled/abandoned by default", async () => {
    if (!context) throw new Error("Context not initialized");
    const { stdout } = await runTgCli(`status --json`, context.tempDir);
    const data = JSON.parse(stdout) as {
      statusCounts: Record<string, number>;
      nextTasks: Array<{ task_id: string }>;
    };
    // Default view filters out canceled; canceled count may be 0 or absent
    const canceledCount = data.statusCounts.canceled ?? 0;
    expect(canceledCount).toBe(0);
    // Next runnable should not include the canceled task
    const nextIds = (data.nextTasks || []).map((t) => t.task_id);
    expect(nextIds).not.toContain(taskId1);
  });

  it("8) tg status --all includes canceled/abandoned", async () => {
    if (!context) throw new Error("Context not initialized");
    const { stdout } = await runTgCli(`status --all --json`, context.tempDir);
    const data = JSON.parse(stdout) as {
      statusCounts: Record<string, number>;
      plansCount: number;
    };
    expect(data.statusCounts.canceled).toBeGreaterThanOrEqual(1);
    // With --all, abandoned plan is included so plansCount >= 1
    expect(data.plansCount).toBeGreaterThanOrEqual(1);
  });
});
