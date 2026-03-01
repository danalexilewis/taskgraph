/**
 * Unit tests for MCP tool handlers (tg_status, tg_context, tg_next, tg_show, tg_start, tg_done, tg_note, tg_block).
 * Mocks DB/query layer and CLI modules so handlers can be tested without a real Dolt repo.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { err, errAsync, ok, okAsync } from "neverthrow";
import { buildError, ErrorCode } from "../../src/domain/errors.js";

const FAKE_REPO = "/fake/repo";

// --- Mocks: state we can set per test
const mockFetchStatusData = mock(() => okAsync(mockStatusData()));
const mockResolveTaskId = mock((id: string) => okAsync(id));
const mockGetStartedEventBranch = mock(() => okAsync(null));
const mockStartOne = mock((_config: unknown, taskId: string) =>
  okAsync({ task_id: taskId, status: "doing" as const }),
);
const mockDoltCommit = mock(() => okAsync(undefined));
const mockMergeBranch = mock(() => okAsync(undefined));
const mockSyncBlocked = mock(() => okAsync(undefined));
const mockCheckNoCycle = mock(() => ok(undefined));
const mockCheckTransition = mock(() => ok(undefined));
const mockAutoComplete = mock(() => okAsync(false));

function mockStatusData() {
  return {
    completedPlans: 0,
    completedTasks: 0,
    canceledTasks: 0,
    activePlans: [],
    staleTasks: [],
    plansCount: 0,
    statusCounts: { todo: 1, doing: 0, done: 0, blocked: 0, canceled: 0 },
    actionableCount: 1,
    nextTasks: [],
    next7RunnableTasks: [],
    last7CompletedTasks: [],
    next7UpcomingPlans: [],
    last7CompletedPlans: [],
    activeWork: [],
  };
}

// Query mock: methods return ResultAsync; use queues so multiple calls get correct results
let selectResults: ReturnType<typeof okAsync<Record<string, unknown>[]>>[] = [];
let rawResults: ReturnType<typeof okAsync<Record<string, unknown>[]>>[] = [];
let insertResult = okAsync(undefined);
let updateResult = okAsync(undefined);
let countResult = okAsync(0);

function mockQuery(_repoPath: string) {
  return {
    select: () => selectResults.shift() ?? okAsync([]),
    raw: () => rawResults.shift() ?? okAsync([]),
    insert: () => insertResult,
    update: () => updateResult,
    count: () => countResult,
  };
}

function mockNow() {
  return "2026-02-28 12:00:00";
}

function mockJsonObj(value: Record<string, unknown>) {
  return { _type: "json" as const, value };
}

// Register mocks before importing tools
mock.module("../../src/cli/status.js", () => ({
  fetchStatusData: (...args: unknown[]) =>
    mockFetchStatusData(...(args as [unknown, unknown])),
}));

mock.module("../../src/cli/utils.js", () => ({
  resolveTaskId: (...args: unknown[]) =>
    mockResolveTaskId(...(args as [string, string])),
  getStartedEventBranch: (...args: unknown[]) =>
    mockGetStartedEventBranch(...(args as [string, string])),
}));

mock.module("../../src/db/query.js", () => ({
  query: mockQuery,
  now: mockNow,
  jsonObj: mockJsonObj,
}));

mock.module("../../src/cli/start.js", () => ({
  startOne: (...args: unknown[]) =>
    mockStartOne(
      ...(args as [unknown, string, string, boolean, undefined, boolean]),
    ),
}));

mock.module("../../src/db/commit.js", () => ({
  doltCommit: (...args: unknown[]) =>
    mockDoltCommit(...(args as [string, string, boolean])),
}));

mock.module("../../src/db/branch.js", () => ({
  mergeAgentBranchIntoMain: (...args: unknown[]) =>
    mockMergeBranch(...(args as [string, string, string])),
}));

mock.module("../../src/domain/blocked-status.js", () => ({
  syncBlockedStatusForTask: (...args: unknown[]) =>
    mockSyncBlocked(...(args as [string, string])),
}));

mock.module("../../src/domain/invariants.js", () => ({
  checkNoBlockerCycle: (...args: unknown[]) =>
    mockCheckNoCycle(...(args as [string, string, unknown[]])),
  checkValidTransition: (...args: unknown[]) =>
    mockCheckTransition(...(args as [string, string])),
}));

mock.module("../../src/domain/plan-completion.js", () => ({
  autoCompletePlanIfDone: (...args: unknown[]) =>
    mockAutoComplete(...(args as [string, string])),
}));

const { registerTools } = await import("../../src/mcp/tools.js");

const handlers: Record<string, (args: unknown) => Promise<unknown>> = {};
const mockServer = {
  registerTool(
    name: string,
    _schema: unknown,
    handler: (args: unknown) => Promise<unknown>,
  ) {
    handlers[name] = handler;
  },
};

const config = { doltRepoPath: FAKE_REPO };
// biome-ignore lint/suspicious/noExplicitAny: test mock; McpServer interface is partial
registerTools(mockServer as any, config);

function parseContent(result: {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}) {
  const text = result.content[0]?.text ?? "";
  try {
    return { parsed: JSON.parse(text) as Record<string, unknown>, raw: text };
  } catch {
    return { parsed: null, raw: text };
  }
}

beforeEach(() => {
  mockFetchStatusData.mockClear();
  mockResolveTaskId.mockClear();
  mockGetStartedEventBranch.mockClear();
  mockStartOne.mockClear();
  mockDoltCommit.mockClear();
  mockMergeBranch.mockClear();
  mockSyncBlocked.mockClear();
  mockCheckNoCycle.mockClear();
  mockCheckTransition.mockClear();
  mockAutoComplete.mockClear();
  selectResults = [];
  rawResults = [];
  insertResult = okAsync(undefined);
  updateResult = okAsync(undefined);
  countResult = okAsync(0);
});

afterEach(() => {});

describe("MCP tool handlers", () => {
  describe("tg_status", () => {
    it("calls fetchStatusData with repo and optional plan and returns summary", async () => {
      const res = (await handlers.tg_status({})) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(res.isError).toBeUndefined();
      expect(mockFetchStatusData).toHaveBeenCalledTimes(1);
      expect(mockFetchStatusData).toHaveBeenCalledWith(
        { doltRepoPath: FAKE_REPO },
        { plan: undefined },
      );
      const { parsed } = parseContent(res);
      expect(parsed).not.toBeNull();
      expect(parsed?.summary).toBeDefined();
      expect(parsed?.statusCounts).toBeDefined();
    });

    it("passes plan filter to fetchStatusData", async () => {
      await handlers.tg_status({ plan: "My Plan" });
      expect(mockFetchStatusData).toHaveBeenCalledWith(
        { doltRepoPath: FAKE_REPO },
        { plan: "My Plan" },
      );
    });

    it("returns MCP error content when fetchStatusData fails", async () => {
      mockFetchStatusData.mockImplementationOnce(() =>
        errAsync(buildError(ErrorCode.DB_QUERY_FAILED, "DB failed")),
      );
      const res = (await handlers.tg_status({})) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(res.isError).toBe(true);
      const { parsed } = parseContent(res);
      expect(parsed?.status).toBe("error");
      expect(parsed?.code).toBe(ErrorCode.DB_QUERY_FAILED);
      expect(parsed?.message).toBe("DB failed");
    });
  });

  describe("tg_context", () => {
    it("resolves taskId and calls query layer, returns context with doc_paths", async () => {
      const taskId = "a1b2c3d4-0000-4000-8000-000000000001";
      selectResults = [
        okAsync([
          {
            task_id: taskId,
            title: "A task",
            change_type: "feature",
            plan_id: "p1",
            suggested_changes: null,
            agent: "impl-1",
          },
        ]),
        okAsync([{ file_tree: "tree", risks: null }]),
        okAsync([{ doc: "cli-reference" }]),
        okAsync([{ skill: "plan" }]),
      ];
      rawResults = [okAsync([]), okAsync([])]; // relatedByDoc, relatedBySkill
      const res = (await handlers.tg_context({ taskId })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(mockResolveTaskId).toHaveBeenCalledWith(taskId, FAKE_REPO);
      const { parsed } = parseContent(res);
      if (parsed && !res.isError) {
        expect(parsed.task_id).toBe(taskId);
        expect(parsed.title).toBe("A task");
        expect(parsed.doc_paths).toBeDefined();
      }
    });

    it("returns MCP error when resolveTaskId fails", async () => {
      mockResolveTaskId.mockImplementationOnce(() =>
        errAsync(buildError(ErrorCode.VALIDATION_FAILED, "Invalid id")),
      );
      const res = (await handlers.tg_context({ taskId: "bad" })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(res.isError).toBe(true);
      const { parsed } = parseContent(res);
      expect(parsed?.status).toBe("error");
      expect(parsed?.code).toBe(ErrorCode.VALIDATION_FAILED);
    });
  });

  describe("tg_next", () => {
    it("calls query raw with limit and returns next tasks", async () => {
      rawResults = [
        okAsync([
          {
            task_id: "t1",
            hash_id: "tg-abc",
            title: "Next task",
            plan_title: "Plan",
            risk: null,
            estimate_mins: null,
            unmet_blockers: 0,
          },
        ]),
      ];
      const res = (await handlers.tg_next({ limit: 5 })) as {
        content: Array<{ type: string; text: string }>;
      };
      expect(res.content[0].text).toContain("Next task");
      const { parsed } = parseContent(res);
      expect(Array.isArray(parsed)).toBe(true);
      expect((parsed as unknown[])[0]).toMatchObject({
        task_id: "t1",
        title: "Next task",
      });
    });

    it("passes planId and limit through", async () => {
      rawResults = [okAsync([])];
      const res = (await handlers.tg_next({
        planId: "My Plan",
        limit: 2,
      })) as {
        content: Array<{ type: string; text: string }>;
      };
      expect(res.content).toHaveLength(1);
      expect(res.content[0].type).toBe("text");
    });

    it("returns MCP error when query fails", async () => {
      rawResults = [
        errAsync(buildError(ErrorCode.DB_QUERY_FAILED, "Query failed")),
      ];
      const res = (await handlers.tg_next({})) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(res.isError).toBe(true);
      const { parsed } = parseContent(res);
      expect(parsed?.status).toBe("error");
      expect(parsed?.code).toBe(ErrorCode.DB_QUERY_FAILED);
    });
  });

  describe("tg_show", () => {
    it("resolves taskId and returns task details", async () => {
      const taskId = "a1b2c3d4-0000-4000-8000-000000000002";
      mockResolveTaskId.mockImplementationOnce(() => okAsync(taskId));
      rawResults = [
        okAsync([
          {
            task_id: taskId,
            title: "Show task",
            status: "doing",
            plan_title: "Plan",
            plan_id: "p1",
          },
        ]),
        okAsync([]),
        okAsync([]),
        okAsync([]),
        okAsync([]),
        okAsync([]),
        okAsync([]),
      ];
      selectResults = [okAsync([]), okAsync([])];
      const res = (await handlers.tg_show({ taskId })) as {
        content: Array<{ type: string; text: string }>;
      };
      expect(mockResolveTaskId).toHaveBeenCalledWith(taskId, FAKE_REPO);
      const { parsed } = parseContent(res);
      expect(parsed?.taskDetails).toBeDefined();
      expect((parsed?.taskDetails as { task_id: string }).task_id).toBe(taskId);
    });

    it("returns MCP error when task not found", async () => {
      mockResolveTaskId.mockImplementationOnce(() => okAsync("some-uuid"));
      rawResults = [okAsync([])];
      const res = (await handlers.tg_show({ taskId: "some-uuid" })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(res.isError).toBe(true);
      const { parsed } = parseContent(res);
      expect(parsed?.code).toBe(ErrorCode.TASK_NOT_FOUND);
    });
  });

  describe("tg_start", () => {
    it("calls resolveTaskId and startOne with taskId and agent", async () => {
      const taskId = "a1b2c3d4-0000-4000-8000-000000000003";
      const res = (await handlers.tg_start({
        taskId,
        agent: "implementer-1",
      })) as { content: Array<{ type: string; text: string }> };
      expect(mockResolveTaskId).toHaveBeenCalledWith(taskId, FAKE_REPO);
      expect(mockStartOne).toHaveBeenCalledWith(
        { doltRepoPath: FAKE_REPO },
        taskId,
        "implementer-1",
        false,
        undefined,
        false,
      );
      const { parsed } = parseContent(res);
      expect(parsed?.task_id).toBe(taskId);
      expect(parsed?.status).toBe("doing");
    });

    it("uses default agent when not provided", async () => {
      await handlers.tg_start({ taskId: "uuid" });
      expect(mockStartOne).toHaveBeenCalledWith(
        expect.any(Object),
        "uuid",
        "default",
        false,
        undefined,
        false,
      );
    });

    it("returns MCP error when startOne fails", async () => {
      mockStartOne.mockImplementationOnce(() =>
        errAsync(buildError(ErrorCode.TASK_ALREADY_CLAIMED, "Already claimed")),
      );
      const res = (await handlers.tg_start({ taskId: "uuid" })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(res.isError).toBe(true);
      const { parsed } = parseContent(res);
      expect(parsed?.code).toBe(ErrorCode.TASK_ALREADY_CLAIMED);
    });
  });

  describe("tg_done", () => {
    it("calls resolveTaskId, query select/update/insert, commit, and returns task_id and status", async () => {
      const taskId = "a1b2c3d4-0000-4000-8000-000000000004";
      mockResolveTaskId.mockImplementation(() => okAsync(taskId));
      selectResults = [
        okAsync([{ status: "doing", plan_id: "p1" }]),
        okAsync([{ to_task_id: "other" }]),
      ];
      updateResult = okAsync(undefined);
      insertResult = okAsync(undefined);
      const res = (await handlers.tg_done({
        taskId,
        evidence: "Done it",
      })) as { content: Array<{ type: string; text: string }> };
      const { parsed } = parseContent(res);
      expect(parsed?.task_id).toBe(taskId);
      expect(parsed?.status).toBe("done");
    });

    it("returns MCP error when task not found for done", async () => {
      mockResolveTaskId.mockImplementationOnce(() => okAsync("missing-uuid"));
      selectResults = [okAsync([])];
      const res = (await handlers.tg_done({
        taskId: "missing-uuid",
        evidence: "x",
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(res.isError).toBe(true);
      const { parsed } = parseContent(res);
      expect(parsed?.code).toBe(ErrorCode.TASK_NOT_FOUND);
    });
  });

  describe("tg_note", () => {
    it("calls resolveTaskId, query select/insert, commit, returns task_id and status ok", async () => {
      const taskId = "a1b2c3d4-0000-4000-8000-000000000005";
      mockResolveTaskId.mockImplementation(() => okAsync(taskId));
      selectResults = [okAsync([{ task_id: taskId }])];
      insertResult = okAsync(undefined);
      const res = (await handlers.tg_note({
        taskId,
        message: "A note",
        agent: "agent-1",
      })) as { content: Array<{ type: string; text: string }> };
      const { parsed } = parseContent(res);
      expect(parsed?.task_id).toBe(taskId);
      expect(parsed?.status).toBe("ok");
    });

    it("returns MCP error when task not found for note", async () => {
      mockResolveTaskId.mockImplementationOnce(() => okAsync("nope"));
      selectResults = [okAsync([])];
      const res = (await handlers.tg_note({
        taskId: "nope",
        message: "x",
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(res.isError).toBe(true);
      const { parsed } = parseContent(res);
      expect(parsed?.code).toBe(ErrorCode.TASK_NOT_FOUND);
    });
  });

  describe("tg_block", () => {
    it("calls resolveTaskId for both task and blocker, checkNoBlockerCycle, then insert/sync/commit", async () => {
      const taskId = "a1b2c3d4-0000-4000-8000-000000000006";
      const blockerId = "a1b2c3d4-0000-4000-8000-000000000007";
      mockResolveTaskId
        .mockImplementationOnce(() => okAsync(taskId))
        .mockImplementationOnce(() => okAsync(blockerId));
      selectResults = [okAsync([])];
      countResult = okAsync(0);
      insertResult = okAsync(undefined);
      const res = (await handlers.tg_block({
        taskId,
        blockerTaskId: blockerId,
        reason: "Blocked by other",
      })) as { content: Array<{ type: string; text: string }> };
      expect(mockResolveTaskId).toHaveBeenCalledWith(taskId, FAKE_REPO);
      expect(mockResolveTaskId).toHaveBeenCalledWith(blockerId, FAKE_REPO);
      expect(mockCheckNoCycle).toHaveBeenCalled();
      const { parsed } = parseContent(res);
      expect(parsed?.task_id).toBe(taskId);
      expect(parsed?.blocker_task_id).toBe(blockerId);
      expect(parsed?.status).toBe("blocked");
    });

    it("returns MCP error when cycle detected", async () => {
      mockResolveTaskId
        .mockImplementationOnce(() => okAsync("t1"))
        .mockImplementationOnce(() => okAsync("t2"));
      mockCheckNoCycle.mockImplementationOnce(() =>
        err(buildError(ErrorCode.CYCLE_DETECTED, "Cycle")),
      );
      selectResults = [okAsync([])];
      const res = (await handlers.tg_block({
        taskId: "t1",
        blockerTaskId: "t2",
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(res.isError).toBe(true);
      const { parsed } = parseContent(res);
      expect(parsed?.code).toBe(ErrorCode.CYCLE_DETECTED);
    });
  });
});
