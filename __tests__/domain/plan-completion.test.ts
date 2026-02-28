import { v4 as uuidv4 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { doltSql } from "../../src/db/connection";
import { autoCompletePlanIfDone } from "../../src/domain/plan-completion";
import {
  setupIntegrationTest,
  teardownIntegrationTest,
} from "../integration/test-utils";

describe("autoCompletePlanIfDone integration tests", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

  beforeAll(async () => {
    context = await setupIntegrationTest();
  }, 60000);

  afterAll(() => {
    if (context) {
      teardownIntegrationTest(context.tempDir);
    }
  });

  it("all tasks done -> plan marked done, returns true", async () => {
    if (!context) throw new Error("Context not initialized");
    const planId = uuidv4();
    const taskId1 = uuidv4();
    const taskId2 = uuidv4();

    (
      await doltSql(
        `INSERT INTO \`plan\` (plan_id, title, intent, status, priority, created_at, updated_at) VALUES ('${planId}', 'Test Plan', 'test', 'draft', 0, NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES ('${taskId1}', '${planId}', 'Task 1', 'done', NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES ('${taskId2}', '${planId}', 'Task 2', 'done', NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    const result = await autoCompletePlanIfDone(planId, context.doltRepoPath);
    expect(result._unsafeUnwrap()).toBe(true);

    const rows = (
      await doltSql(
        `SELECT status FROM \`plan\` WHERE plan_id = '${planId}'`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();
    expect(rows[0].status).toBe("done");
  }, 30000);

  it("mix of done and todo -> not marked done, returns false", async () => {
    if (!context) throw new Error("Context not initialized");
    const planId = uuidv4();
    const taskId1 = uuidv4();
    const taskId2 = uuidv4();

    (
      await doltSql(
        `INSERT INTO \`plan\` (plan_id, title, intent, status, priority, created_at, updated_at) VALUES ('${planId}', 'Test Plan', 'test', 'draft', 0, NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES ('${taskId1}', '${planId}', 'Task 1', 'done', NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES ('${taskId2}', '${planId}', 'Task 2', 'todo', NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    const result = await autoCompletePlanIfDone(planId, context.doltRepoPath);
    expect(result._unsafeUnwrap()).toBe(false);

    const rows = (
      await doltSql(
        `SELECT status FROM \`plan\` WHERE plan_id = '${planId}'`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();
    expect(rows[0].status).toBe("draft");
  }, 30000);

  it("all tasks canceled (none done) -> not marked done", async () => {
    if (!context) throw new Error("Context not initialized");
    const planId = uuidv4();
    const taskId1 = uuidv4();
    const taskId2 = uuidv4();

    (
      await doltSql(
        `INSERT INTO \`plan\` (plan_id, title, intent, status, priority, created_at, updated_at) VALUES ('${planId}', 'Test Plan', 'test', 'draft', 0, NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES ('${taskId1}', '${planId}', 'Task 1', 'canceled', NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES ('${taskId2}', '${planId}', 'Task 2', 'canceled', NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    const result = await autoCompletePlanIfDone(planId, context.doltRepoPath);
    expect(result._unsafeUnwrap()).toBe(false);
  }, 30000);

  it("mix of done and canceled -> marked done", async () => {
    if (!context) throw new Error("Context not initialized");
    const planId = uuidv4();
    const taskId1 = uuidv4();
    const taskId2 = uuidv4();

    (
      await doltSql(
        `INSERT INTO \`plan\` (plan_id, title, intent, status, priority, created_at, updated_at) VALUES ('${planId}', 'Test Plan', 'test', 'draft', 0, NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES ('${taskId1}', '${planId}', 'Task 1', 'done', NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES ('${taskId2}', '${planId}', 'Task 2', 'canceled', NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    const result = await autoCompletePlanIfDone(planId, context.doltRepoPath);
    expect(result._unsafeUnwrap()).toBe(true);

    const rows = (
      await doltSql(
        `SELECT status FROM \`plan\` WHERE plan_id = '${planId}'`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();
    expect(rows[0].status).toBe("done");
  }, 30000);

  it("empty plan (no tasks) -> not marked done", async () => {
    if (!context) throw new Error("Context not initialized");
    const planId = uuidv4();

    (
      await doltSql(
        `INSERT INTO \`plan\` (plan_id, title, intent, status, priority, created_at, updated_at) VALUES ('${planId}', 'Test Plan', 'test', 'draft', 0, NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    const result = await autoCompletePlanIfDone(planId, context.doltRepoPath);
    expect(result._unsafeUnwrap()).toBe(false);
  }, 30000);
});
