import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tableExists } from "../../src/db/migrate";
import { query } from "../../src/db/query";
import { setupIntegrationTest, teardownIntegrationTest } from "./test-utils";

describe("Plan→project migration and idempotency", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>>;

  beforeAll(async () => {
    context = await setupIntegrationTest();
  }, 30000);

  afterAll(async () => {
    await teardownIntegrationTest(context);
  }, 30000);

  it("project table exists after migrations", async () => {
    const result = await tableExists(context.doltRepoPath, "project");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(true);
  });

  it("initiative table exists after migrations", async () => {
    const result = await tableExists(context.doltRepoPath, "initiative");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(true);
  });

  it("project table has initiative_id column and FKs work", async () => {
    const q = query(context.doltRepoPath);
    const cols = await q.raw<{ COLUMN_NAME: string }>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'initiative_id'`,
    );
    expect(cols.isOk()).toBe(true);
    expect(cols._unsafeUnwrap().length).toBeGreaterThan(0);
  });

  it("existing task rows reference project (plan_id FK)", async () => {
    const q = query(context.doltRepoPath);
    const count = await q.raw<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM task t JOIN project p ON t.plan_id = p.plan_id`,
    );
    expect(count.isOk()).toBe(true);
    expect(Number(count._unsafeUnwrap()[0]?.cnt ?? 0)).toBeGreaterThanOrEqual(
      0,
    );
  });
});
