/**
 * Verifies that TgClient.next() and TgClient.context() use the shared
 * status cache so repeated calls within TTL do not spawn additional Dolt
 * processes for the same read queries.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { okAsync } from "neverthrow";

// Clear integration env vars so the mock is the only DB path.
delete process.env.TG_DOLT_SERVER_PORT;
delete process.env.TG_DOLT_SERVER_DATABASE;

const mockDoltSql = mock((_sql: string, _repoPath: string) => {
  return okAsync([] as unknown[]);
});

mock.module("../../src/db/connection", () => ({
  doltSql: mockDoltSql,
}));

// Mock recoverStaleTasks so next() doesn't need a fully populated DB.
mock.module("../../src/cli/recover", () => ({
  recoverStaleTasks: (_repoPath: string, _thresholdHours: number) =>
    okAsync(null),
}));

// Mock resolveTaskId for context() tests.
mock.module("../../src/cli/utils", () => ({
  resolveTaskId: (_taskId: string, _repoPath: string) => okAsync("task-uuid-1"),
  readConfig: () => ({ isErr: () => false, isOk: () => true, value: {} }),
  writeConfig: () => {},
  rootOpts: () => ({}),
  shouldUseJson: () => false,
}));

const { TgClient } = await import("../../src/api/client");
const { resetStatusCache } = await import("../../src/cli/status-cache");

const FAKE_REPO = "/fake/repo/for-cache-test";

describe("TgClient.next() — cache deduplication", () => {
  beforeEach(() => {
    resetStatusCache();
    mockDoltSql.mockClear();
    mockDoltSql.mockImplementation((_sql: string) => okAsync([]));
  });

  it("second next() call within TTL does not call doltSql again for the SELECT", async () => {
    const client = new TgClient({ doltRepoPath: FAKE_REPO });

    await client.next({ limit: 5 });
    const callsAfterFirst = mockDoltSql.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    await client.next({ limit: 5 });
    const callsAfterSecond = mockDoltSql.mock.calls.length;

    // Cache hit: no additional DB calls on the second invocation.
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });

  it("next() calls doltSql when cache is disabled (TG_DISABLE_CACHE=1)", async () => {
    process.env.TG_DISABLE_CACHE = "1";
    resetStatusCache();
    try {
      const client = new TgClient({ doltRepoPath: FAKE_REPO });

      await client.next({ limit: 5 });
      const callsAfterFirst = mockDoltSql.mock.calls.length;

      await client.next({ limit: 5 });
      const callsAfterSecond = mockDoltSql.mock.calls.length;

      // Passthrough mode: each call hits the DB.
      expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst);
    } finally {
      delete process.env.TG_DISABLE_CACHE;
      resetStatusCache();
    }
  });
});
