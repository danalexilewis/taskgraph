import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { doltSql } from "../../src/db/connection";
import {
  detectOrphanedTasks,
  detectStaleTasks,
  detectUnresolvedDependencies,
} from "../../src/skills/health-check";
import {
  setupIntegrationTest,
  teardownIntegrationTest,
} from "../integration/test-utils";

describe("Health-check detection functions", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  const planId = "h1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const staleTaskId = "s1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const orphanTaskId = "o1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const blockerTaskId = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const blockedTaskId = "b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  beforeAll(async () => {
    context = await setupIntegrationTest();

    // Create plan for all tests
    (
      await doltSql(
        `INSERT INTO \`plan\` (plan_id, title, intent, created_at, updated_at) VALUES (
          '${planId}', 'Health Check Test Plan', 'Intent', NOW(), NOW()
        );`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    // Stale task: doing + started event with no agent
    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES (
          '${staleTaskId}', '${planId}', 'Stale Task', 'doing', NOW(), NOW()
        );`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();
    (
      await doltSql(
        `INSERT INTO \`event\` (event_id, task_id, kind, body, created_at) VALUES (
          'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '${staleTaskId}', 'started', '{}', NOW()
        );`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    // Orphan task: has plan but no events (inserted directly, no events)
    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES (
          '${orphanTaskId}', '${planId}', 'Orphan Task', 'todo', NOW(), NOW()
        );`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    // Blocker and blocked for unresolved deps test
    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES
          ('${blockerTaskId}', '${planId}', 'Blocker Task', 'todo', NOW(), NOW()),
          ('${blockedTaskId}', '${planId}', 'Blocked Task', 'todo', NOW(), NOW());`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();
    (
      await doltSql(
        `INSERT INTO \`edge\` (from_task_id, to_task_id, type) VALUES (
          '${blockerTaskId}', '${blockedTaskId}', 'blocks'
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

  describe("detectStaleTasks", () => {
    it("returns tasks in doing with started event but no agent", async () => {
      if (!context) throw new Error("Context not initialized");
      const stale = await detectStaleTasks(context.doltRepoPath);
      expect(stale.length).toBeGreaterThanOrEqual(1);
      const found = stale.find((t) => t.task_id === staleTaskId);
      expect(found).toBeDefined();
      expect(found?.title).toBe("Stale Task");
      expect(found?.started_by).toBeNull();
    });
  });

  describe("detectOrphanedTasks", () => {
    it("returns tasks with no events", async () => {
      if (!context) throw new Error("Context not initialized");
      const orphans = await detectOrphanedTasks(context.doltRepoPath);
      expect(orphans.length).toBeGreaterThanOrEqual(1);
      const found = orphans.find((t) => t.task_id === orphanTaskId);
      expect(found).toBeDefined();
      expect(found?.title).toBe("Orphan Task");
    });
  });

  describe("detectUnresolvedDependencies", () => {
    it("returns blocked tasks with unmet_blockers when blocker is not done", async () => {
      if (!context) throw new Error("Context not initialized");
      const unresolved = await detectUnresolvedDependencies(
        context.doltRepoPath,
      );
      expect(unresolved.length).toBeGreaterThanOrEqual(1);
      const found = unresolved.find((t) => t.task_id === blockedTaskId);
      expect(found).toBeDefined();
      expect(found?.title).toBe("Blocked Task");
      expect(found?.unmet_blockers).toBe(1);
    });

    it("does not return blocked task after blocker is marked done", async () => {
      if (!context) throw new Error("Context not initialized");
      (
        await doltSql(
          `UPDATE \`task\` SET status = 'done', updated_at = NOW() WHERE task_id = '${blockerTaskId}';`,
          context.doltRepoPath,
        )
      )._unsafeUnwrap();

      const unresolved = await detectUnresolvedDependencies(
        context.doltRepoPath,
      );
      const found = unresolved.find((t) => t.task_id === blockedTaskId);
      expect(found).toBeUndefined();
    });
  });
});
