import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { doltSql } from "../../src/db/connection";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

// Serial: flaky under concurrency (DB-dependent; edge creation order-sensitive).
describe.serial("Cursor format import integration", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planFilePath: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    planFilePath = path.join(plansDir, "cursor-test.md");

    // All pending so --replace test can cancel them (done→canceled is invalid).
    const planContent = `---
name: Cursor Import Test
overview: "Integration test for Cursor format import."
todos:
  - id: cursor-task-a
    content: "Task A"
    status: pending
  - id: cursor-task-b
    content: "Task B"
    status: pending
  - id: cursor-task-c
    content: "Task C depends on A"
    blockedBy: [cursor-task-a]
isProject: false
---
`;
    fs.writeFileSync(planFilePath, planContent);
  }, 60000);

  afterAll(async () => {
    if (context) {
      await teardownIntegrationTest(context);
    }
  });

  it("should import Cursor plan with --format cursor", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      `import plans/cursor-test.md --plan "Cursor Import Test" --format cursor --no-commit`,
      context.tempDir,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Successfully imported");

    // Verify tasks in DB (filter by plan in case other tests share state)
    const tasksResult = await doltSql(
      `SELECT task_id, external_key, title, status FROM \`task\` WHERE plan_id = (SELECT plan_id FROM \`project\` WHERE title = 'Cursor Import Test') ORDER BY external_key`,
      context.doltRepoPath,
    );
    expect(tasksResult.isOk()).toBe(true);
    const tasks = tasksResult._unsafeUnwrap();
    expect(tasks.length).toBe(3);

    type TaskRow = {
      task_id: string;
      external_key: string;
      title: string;
      status: string;
    };
    // external_key may include plan-scoped 6-char suffix (e.g. cursor-task-a-abc123)
    const stableKey = (ek: string) => ek.replace(/-[0-9a-f]{6}$/i, "");
    const byKey = Object.fromEntries(
      (tasks as TaskRow[]).map((t) => [stableKey(t.external_key), t]),
    ) as Record<string, TaskRow>;
    expect(byKey["cursor-task-a"].title).toBe("Task A");
    expect(byKey["cursor-task-a"].status).toBe("todo");
    expect(byKey["cursor-task-b"].title).toBe("Task B");
    expect(byKey["cursor-task-b"].status).toBe("todo");
    expect(byKey["cursor-task-c"].title).toBe("Task C depends on A");
  }, 30000);

  it("should create blocking edge from blockedBy", async () => {
    if (!context) throw new Error("Context not initialized");

    const edgesResult = await doltSql(
      `SELECT from_task_id, to_task_id, type FROM \`edge\``,
      context.doltRepoPath,
    );
    expect(edgesResult.isOk()).toBe(true);
    const edges = edgesResult._unsafeUnwrap();
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(
      edges.some((e: Record<string, unknown>) => e.type === "blocks"),
    ).toBe(true);
  });

  it("re-import same plan with changed todo ids: no flag → non-zero exit and stderr warning", async () => {
    if (!context) throw new Error("Context not initialized");

    const planContentChangedIds = `---
name: Cursor Import Test
overview: "Integration test for Cursor format import."
todos:
  - id: cursor-task-a-renamed
    content: "Task A"
    status: pending
  - id: cursor-task-b-renamed
    content: "Task B"
    status: pending
  - id: cursor-task-c-renamed
    content: "Task C depends on A"
    blockedBy: [cursor-task-a-renamed]
isProject: false
---
`;
    fs.writeFileSync(planFilePath, planContentChangedIds);

    const { exitCode, stderr } = await runTgCli(
      `import plans/cursor-test.md --plan "Cursor Import Test" --format cursor --no-commit`,
      context.tempDir,
      true,
    );

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("unmatched");
    expect(stderr).toContain("--force");
  }, 30000);

  it("same changed-ids file with --force: exit 0, task count increases (duplicates)", async () => {
    if (!context) throw new Error("Context not initialized");

    const countBeforeResult = await doltSql(
      `SELECT COUNT(*) as n FROM \`task\` WHERE plan_id = (SELECT plan_id FROM \`project\` WHERE title = 'Cursor Import Test')`,
      context.doltRepoPath,
    );
    expect(countBeforeResult.isOk()).toBe(true);
    const countBefore = (
      countBeforeResult._unsafeUnwrap() as { n: number }[]
    )[0].n;

    const { exitCode } = await runTgCli(
      `import plans/cursor-test.md --plan "Cursor Import Test" --format cursor --force --no-commit`,
      context.tempDir,
    );

    expect(exitCode).toBe(0);

    const countAfterResult = await doltSql(
      `SELECT COUNT(*) as n FROM \`task\` WHERE plan_id = (SELECT plan_id FROM \`project\` WHERE title = 'Cursor Import Test')`,
      context.doltRepoPath,
    );
    expect(countAfterResult.isOk()).toBe(true);
    const countAfter = (countAfterResult._unsafeUnwrap() as { n: number }[])[0]
      .n;
    expect(countAfter).toBeGreaterThan(countBefore);
  }, 30000);

  it("same with --replace: exit 0, non-canceled count = parsed count, canceled have old external_keys", async () => {
    if (!context) throw new Error("Context not initialized");

    const parsedCount = 3;

    const { exitCode } = await runTgCli(
      `import plans/cursor-test.md --plan "Cursor Import Test" --format cursor --replace --no-commit`,
      context.tempDir,
    );

    expect(exitCode).toBe(0);

    type TaskRow = { task_id: string; external_key: string; status: string };
    const tasksResult = await doltSql(
      `SELECT task_id, external_key, status FROM \`task\` WHERE plan_id = (SELECT plan_id FROM \`project\` WHERE title = 'Cursor Import Test')`,
      context.doltRepoPath,
    );
    expect(tasksResult.isOk()).toBe(true);
    const tasks = tasksResult._unsafeUnwrap() as TaskRow[];

    const nonCanceled = tasks.filter((t) => t.status !== "canceled");
    expect(nonCanceled.length).toBe(parsedCount);

    const canceled = tasks.filter((t) => t.status === "canceled");
    const stableKey = (ek: string) => ek.replace(/-[0-9a-f]{6}$/i, "");
    const canceledStableKeys = canceled.map((t) => stableKey(t.external_key));
    expect(canceledStableKeys).toContain("cursor-task-a");
    expect(canceledStableKeys).toContain("cursor-task-b");
    expect(canceledStableKeys).toContain("cursor-task-c");
  }, 30000);
});
