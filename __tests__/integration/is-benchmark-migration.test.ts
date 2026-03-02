import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { query } from "../../src/db/query";
import { setupIntegrationTest, teardownIntegrationTest } from "./test-utils";

describe("is_benchmark migration", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>>;

  beforeAll(async () => {
    context = await setupIntegrationTest();
  }, 30000);

  afterAll(async () => {
    await teardownIntegrationTest(context);
  }, 30000);

  it("adds is_benchmark column to task table after migrations", async () => {
    const q = query(context.doltRepoPath);
    const result = await q.raw<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'is_benchmark'`,
    );
    expect(result.isOk()).toBe(true);
    expect(Number(result._unsafeUnwrap()[0]?.cnt ?? 0)).toBeGreaterThan(0);
  });

  it("adds is_benchmark column to project table after migrations", async () => {
    const q = query(context.doltRepoPath);
    const result = await q.raw<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'is_benchmark'`,
    );
    expect(result.isOk()).toBe(true);
    expect(Number(result._unsafeUnwrap()[0]?.cnt ?? 0)).toBeGreaterThan(0);
  });
});
