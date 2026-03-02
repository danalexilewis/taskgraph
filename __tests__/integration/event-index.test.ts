import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { query } from "../../src/db/query";
import { setupIntegrationTest, teardownIntegrationTest } from "./test-utils";

describe("event kind index migration", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>>;

  beforeAll(async () => {
    context = await setupIntegrationTest();
  }, 60_000);

  afterAll(async () => {
    await teardownIntegrationTest(context);
  }, 30_000);

  it("creates idx_event_kind_task_id index on event table after migrations", async () => {
    const q = query(context.doltRepoPath);
    const result = await q.raw<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event' AND INDEX_NAME = 'idx_event_kind_task_id'`,
    );
    expect(result.isOk()).toBe(true);
    expect(Number(result._unsafeUnwrap()[0]?.cnt ?? 0)).toBeGreaterThan(0);
  });
});
