"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const test_utils_1 = require("./test-utils");
const invariants_1 = require("../../src/domain/invariants");
const connection_1 = require("../../src/db/connection");
const errors_1 = require("../../src/domain/errors");
(0, vitest_1.describe)("Invariants (DB Dependent) Integration Tests", () => {
    let context;
    const planId = "p1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const taskId1 = "t1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const taskId2 = "t2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const taskId3 = "t3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    (0, vitest_1.beforeAll)(async () => {
        context = await (0, test_utils_1.setupIntegrationTest)();
        // Seed data: plan, tasks with different statuses, and blocking edges
        await (0, connection_1.doltSql)(`INSERT INTO plan (plan_id, title, intent, created_at, updated_at) VALUES (
        '${planId}', 
        'Test Plan for Invariants', 
        'Intent', 
        NOW(), NOW()
      );`, context.doltRepoPath).unwrapOrThrow();
        await (0, connection_1.doltSql)(`INSERT INTO task (task_id, plan_id, title, status, created_at, updated_at) VALUES (
        '${taskId1}', 
        '${planId}', 
        'Runnable Task', 
        'todo', 
        NOW(), NOW()
      );`, context.doltRepoPath).unwrapOrThrow();
        await (0, connection_1.doltSql)(`INSERT INTO task (task_id, plan_id, title, status, created_at, updated_at) VALUES (
        '${taskId2}', 
        '${planId}', 
        'Blocked Task', 
        'blocked', 
        NOW(), NOW()
      );`, context.doltRepoPath).unwrapOrThrow();
        await (0, connection_1.doltSql)(`INSERT INTO task (task_id, plan_id, title, status, created_at, updated_at) VALUES (
        '${taskId3}', 
        '${planId}', 
        'Blocking Task', 
        'todo', 
        NOW(), NOW()
      );`, context.doltRepoPath).unwrapOrThrow();
        await (0, connection_1.doltSql)(`INSERT INTO edge (from_task_id, to_task_id, type) VALUES (
        '${taskId3}', 
        '${taskId1}', 
        'blocks'
      );`, context.doltRepoPath).unwrapOrThrow();
    }, 60000);
    (0, vitest_1.afterAll)(() => {
        if (context) {
            (0, test_utils_1.teardownIntegrationTest)(context.tempDir);
        }
    });
    (0, vitest_1.it)("should return error if task is not found", async () => {
        if (!context)
            throw new Error("Context not initialized");
        const result = await (0, invariants_1.checkRunnable)("non-existent-task", context.doltRepoPath);
        (0, vitest_1.expect)(result.isErr()).toBe(true);
        (0, vitest_1.expect)(result.unwrapErrOrThrow().code).toBe(errors_1.ErrorCode.TASK_NOT_FOUND);
    });
    (0, vitest_1.it)("should return error if task is not in 'todo' status", async () => {
        if (!context)
            throw new Error("Context not initialized");
        // taskId2 is 'blocked'
        const result = await (0, invariants_1.checkRunnable)(taskId2, context.doltRepoPath);
        (0, vitest_1.expect)(result.isErr()).toBe(true);
        (0, vitest_1.expect)(result.unwrapErrOrThrow().code).toBe(errors_1.ErrorCode.INVALID_TRANSITION);
        (0, vitest_1.expect)(result.unwrapErrOrThrow().message).toContain("is not in 'todo' status");
    });
    (0, vitest_1.it)("should return error if task has unmet blockers", async () => {
        if (!context)
            throw new Error("Context not initialized");
        // taskId1 is blocked by taskId3 (which is 'todo')
        const result = await (0, invariants_1.checkRunnable)(taskId1, context.doltRepoPath);
        (0, vitest_1.expect)(result.isErr()).toBe(true);
        (0, vitest_1.expect)(result.unwrapErrOrThrow().code).toBe(errors_1.ErrorCode.TASK_NOT_RUNNABLE);
        (0, vitest_1.expect)(result.unwrapErrOrThrow().message).toContain("has 1 unmet blockers");
    });
    (0, vitest_1.it)("should return ok if task is runnable", async () => {
        if (!context)
            throw new Error("Context not initialized");
        // Mark taskId3 as done so taskId1 becomes runnable
        await (0, connection_1.doltSql)(`UPDATE task SET status = 'done', updated_at = NOW() WHERE task_id = '${taskId3}';`, context.doltRepoPath).unwrapOrThrow();
        const result = await (0, invariants_1.checkRunnable)(taskId1, context.doltRepoPath);
        (0, vitest_1.expect)(result.isOk()).toBe(true);
    });
});
