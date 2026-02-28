import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { doltSql } from "../../src/db/connection";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("Batch CLI: done with multiple IDs", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let taskIds: string[] = [];

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planPath = path.join(plansDir, "batch-cli-plan.md");
    const planContent = `---
name: Batch CLI Test Plan
overview: "Plan for batch done/start integration tests."
todos:
  - id: batch-1
    content: "Batch task 1"
    status: pending
  - id: batch-2
    content: "Batch task 2"
    status: pending
  - id: batch-3
    content: "Batch task 3"
    status: pending
  - id: batch-4
    content: "Batch task 4"
    status: pending
  - id: batch-5
    content: "Single task"
    status: pending
  - id: batch-6
    content: "Valid for error test"
    status: pending
isProject: false
---
`;
    fs.writeFileSync(planPath, planContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/batch-cli-plan.md --plan "Batch CLI Test Plan" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(importOut).toContain("Successfully imported");

    const plansList = await runTgCli(`plan list --json`, context.tempDir);
    const plans = JSON.parse(plansList.stdout) as Array<{
      plan_id: string;
      title: string;
    }>;
    const plan = plans.find((p) => p.title === "Batch CLI Test Plan");
    expect(plan).toBeDefined();
    planId = plan?.plan_id;

    const tasksResult = await doltSql(
      `SELECT task_id FROM \`task\` WHERE plan_id = '${planId}' ORDER BY external_key`,
      context.doltRepoPath,
    );
    expect(tasksResult.isOk()).toBe(true);
    const rows = tasksResult._unsafeUnwrap() as Array<{ task_id: string }>;
    expect(rows.length).toBe(6);
    taskIds = rows.map((r) => r.task_id);
  }, 60000);

  afterAll(() => {
    if (context) {
      teardownIntegrationTest(context.tempDir);
    }
  });

  it("(a) tg done id1 id2 (space-separated) marks both done", async () => {
    if (!context) throw new Error("Context not initialized");
    const [id1, id2] = taskIds;
    await runTgCli(
      `start ${id1} ${id2} --agent test --no-commit`,
      context.tempDir,
    );
    const { exitCode } = await runTgCli(
      `done ${id1} ${id2} --evidence "batch" --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);

    for (const id of [id1, id2]) {
      const { stdout } = await runTgCli(`show ${id} --json`, context.tempDir);
      const data = JSON.parse(stdout) as { taskDetails: { status: string } };
      expect(data.taskDetails.status).toBe("done");
    }
  }, 30000);

  it('(b) tg done "id1,id2" (comma-separated) marks both done', async () => {
    if (!context) throw new Error("Context not initialized");
    const [, , id3, id4] = taskIds;
    await runTgCli(
      `start ${id3} ${id4} --agent test --no-commit`,
      context.tempDir,
    );
    const { exitCode } = await runTgCli(
      `done "${id3},${id4}" --evidence "batch" --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);

    for (const id of [id3, id4]) {
      const { stdout } = await runTgCli(`show ${id} --json`, context.tempDir);
      const data = JSON.parse(stdout) as { taskDetails: { status: string } };
      expect(data.taskDetails.status).toBe("done");
    }
  }, 30000);

  it("(c) single ID tg done still works", async () => {
    if (!context) throw new Error("Context not initialized");
    const id5 = taskIds[4];
    await runTgCli(`start ${id5} --agent test --no-commit`, context.tempDir);
    const { exitCode } = await runTgCli(
      `done ${id5} --evidence "single" --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);

    const { stdout } = await runTgCli(`show ${id5} --json`, context.tempDir);
    const data = JSON.parse(stdout) as { taskDetails: { status: string } };
    expect(data.taskDetails.status).toBe("done");
  }, 30000);

  it("(d) tg done with one invalid ID returns exit 1 and per-id error in --json", async () => {
    if (!context) throw new Error("Context not initialized");
    const id6 = taskIds[5];
    const invalidUuid = "00000000-0000-0000-0000-000000000000";
    await runTgCli(`start ${id6} --agent test --no-commit`, context.tempDir);

    const result = await runTgCli(
      `done ${id6} ${invalidUuid} --evidence "x" --no-commit --json`,
      context.tempDir,
      true,
    );
    expect(result.exitCode).toBe(1);

    const results = JSON.parse(result.stdout) as Array<{
      id: string;
      status?: string;
      error?: string;
    }>;
    expect(results.length).toBe(2);
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(byId[id6]).toBeDefined();
    expect(byId[id6].status).toBe("done");
    expect(byId[invalidUuid]).toBeDefined();
    expect(byId[invalidUuid].error).toBeDefined();
    expect(String(byId[invalidUuid].error)).toMatch(/not found|invalid/i);
  }, 30000);
});
