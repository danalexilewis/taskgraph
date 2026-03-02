import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { v4 as uuidv4 } from "uuid";
import { recoverStaleTasks } from "../../src/cli/recover";
import { doltSql } from "../../src/db/connection";
import {
  runTgCliInProcess,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("tg recover integration", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

  const planId = "r0ebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  beforeAll(async () => {
    context = await setupIntegrationTest();

    await doltSql(
      `INSERT INTO \`project\` (plan_id, title, intent, created_at, updated_at)
       VALUES ('${planId}', 'Recover Test Plan', 'Intent', NOW(), NOW())`,
      context.doltRepoPath,
    ).then((r) => r._unsafeUnwrap());
  }, 60000);

  afterAll(async () => {
    if (context) await teardownIntegrationTest(context);
  }, 60000);

  async function insertDoingTask(
    taskId: string,
    title: string,
    startedHoursAgo: number,
    repoPath: string,
  ): Promise<void> {
    const eventId = uuidv4();
    await doltSql(
      `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at)
       VALUES ('${taskId}', '${planId}', '${title}', 'doing', NOW(), NOW())`,
      repoPath,
    ).then((r) => r._unsafeUnwrap());

    await doltSql(
      `INSERT INTO \`event\` (event_id, task_id, kind, body, actor, created_at)
       VALUES ('${eventId}', '${taskId}', 'started', '{"agent":"test"}', 'agent',
               DATE_SUB(NOW(), INTERVAL ${startedHoursAgo} HOUR))`,
      repoPath,
    ).then((r) => r._unsafeUnwrap());
  }

  async function getTaskStatus(
    taskId: string,
    repoPath: string,
  ): Promise<string> {
    const rows = await doltSql(
      `SELECT status FROM \`task\` WHERE task_id = '${taskId}'`,
      repoPath,
    ).then((r) => r._unsafeUnwrap() as Array<{ status: string }>);
    return rows[0]?.status ?? "not_found";
  }

  it("recovers a doing task that has been idle longer than threshold", async () => {
    if (!context) throw new Error("Context not initialized");

    const taskId = uuidv4();
    await insertDoingTask(taskId, "Stale Task", 3, context.doltRepoPath);

    const result = await recoverStaleTasks(context.doltRepoPath, 1);
    expect(result.isOk()).toBe(true);

    const recovered = result._unsafeUnwrap();
    const ids = recovered.map((t) => t.task_id);
    expect(ids).toContain(taskId);

    const status = await getTaskStatus(taskId, context.doltRepoPath);
    expect(status).toBe("todo");

    // Verify a recovery note event was inserted
    const events = await doltSql(
      `SELECT body FROM \`event\` WHERE task_id = '${taskId}' AND kind = 'note'`,
      context.doltRepoPath,
    ).then((r) => r._unsafeUnwrap() as Array<{ body: string }>);
    expect(events.length).toBeGreaterThan(0);
    const body = JSON.parse(events[0].body) as { type?: string };
    expect(body.type).toBe("recovery");
  });

  it("does not recover a doing task that is below threshold", async () => {
    if (!context) throw new Error("Context not initialized");

    const taskId = uuidv4();
    // Started only 1 hour ago, threshold is 5 hours
    await insertDoingTask(taskId, "Fresh Task", 1, context.doltRepoPath);

    const result = await recoverStaleTasks(context.doltRepoPath, 5);
    expect(result.isOk()).toBe(true);

    const recovered = result._unsafeUnwrap();
    const ids = recovered.map((t) => t.task_id);
    expect(ids).not.toContain(taskId);

    const status = await getTaskStatus(taskId, context.doltRepoPath);
    expect(status).toBe("doing");
  });

  it("--dry-run shows candidates without changing task status", async () => {
    if (!context) throw new Error("Context not initialized");

    const taskId = uuidv4();
    await insertDoingTask(taskId, "Dry Run Task", 3, context.doltRepoPath);

    const { stdout, exitCode } = await runTgCliInProcess(
      "recover --threshold 1 --dry-run",
      context.tempDir,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Dry run");

    // Status must be unchanged
    const status = await getTaskStatus(taskId, context.doltRepoPath);
    expect(status).toBe("doing");

    // No recovery note event should exist for this task
    const events = await doltSql(
      `SELECT body FROM \`event\` WHERE task_id = '${taskId}' AND kind = 'note'
       AND JSON_EXTRACT(body, '$.type') = 'recovery'`,
      context.doltRepoPath,
    ).then((r) => r._unsafeUnwrap() as Array<{ body: string }>);
    expect(events.length).toBe(0);
  });
});
