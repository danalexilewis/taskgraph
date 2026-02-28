import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { doltSql } from "../../src/db/connection";
import { ErrorCode } from "../../src/domain/errors";
import { checkRunnable } from "../../src/domain/invariants";
import { setupIntegrationTest, teardownIntegrationTest } from "./test-utils";

describe("Invariants (DB Dependent) Integration Tests", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  const planId = "p1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const taskId1 = "t1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const taskId2 = "t2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const taskId3 = "t3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  beforeAll(async () => {
    context = await setupIntegrationTest();

    // Seed data: plan, tasks with different statuses, and blocking edges
    (
      await doltSql(
        `INSERT INTO \`plan\` (plan_id, title, intent, created_at, updated_at) VALUES (
        '${planId}', 
        'Test Plan for Invariants', 
        'Intent', 
        NOW(), NOW()
      );`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES (
        '${taskId1}', 
        '${planId}', 
        'Runnable Task', 
        'todo', 
        NOW(), NOW()
      );`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES (
        '${taskId2}', 
        '${planId}', 
        'Blocked Task', 
        'blocked', 
        NOW(), NOW()
      );`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES (
        '${taskId3}', 
        '${planId}', 
        'Blocking Task', 
        'todo', 
        NOW(), NOW()
      );`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`edge\` (from_task_id, to_task_id, type) VALUES (
        '${taskId3}', 
        '${taskId1}', 
        'blocks'
      );`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();
  }, 60000);

  afterAll(() => {
    if (context) {
      teardownIntegrationTest(context.tempDir);
    }
  });

  it("should return error if task is not found", async () => {
    if (!context) throw new Error("Context not initialized");
    const result = await checkRunnable(
      "non-existent-task",
      context.doltRepoPath,
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.TASK_NOT_FOUND);
  });

  it("should return error if task is not in 'todo' status", async () => {
    if (!context) throw new Error("Context not initialized");
    // taskId2 is 'blocked'
    const result = await checkRunnable(taskId2, context.doltRepoPath);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.INVALID_TRANSITION);
    expect(result._unsafeUnwrapErr().message).toContain(
      "is not in 'todo' status",
    );
  });

  it("should return error if task has unmet blockers", async () => {
    if (!context) throw new Error("Context not initialized");
    // taskId1 is blocked by taskId3 (which is 'todo')
    const result = await checkRunnable(taskId1, context.doltRepoPath);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.TASK_NOT_RUNNABLE);
    expect(result._unsafeUnwrapErr().message).toContain("has 1 unmet blockers");
  });

  it("should return ok if task is runnable", async () => {
    if (!context) throw new Error("Context not initialized");
    // Mark taskId3 as done so taskId1 becomes runnable
    (
      await doltSql(
        `UPDATE \`task\` SET status = 'done', updated_at = NOW() WHERE task_id = '${taskId3}';`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    const result = await checkRunnable(taskId1, context.doltRepoPath);
    expect(result.isOk()).toBe(true);
  });
});
