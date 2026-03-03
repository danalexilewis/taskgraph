import { beforeEach, describe, expect, it, mock } from "bun:test";
import { errAsync, okAsync } from "neverthrow";

// Prevent leftover integration env from causing real pool use when mock does not apply
delete process.env.TG_DOLT_SERVER_PORT;
delete process.env.TG_DOLT_SERVER_DATABASE;

const mockDoltSql = mock((_sql: string, _repoPath: string) => okAsync([]));

mock.module("../../src/db/connection", () => ({
  doltSql: mockDoltSql,
}));

const {
  normalizeDirective,
  fingerprintDirective,
  recordFinding,
  listRecurrences,
} = await import("../../src/db/recurrence");
import { buildError, ErrorCode } from "../../src/domain/errors";

const REPO_PATH = "./test_repo";
const CONFIG = { doltRepoPath: REPO_PATH };

describe("normalizeDirective", () => {
  it("trims and collapses internal whitespace (happy path)", () => {
    expect(normalizeDirective("  trim  me  ")).toBe("trim me");
    expect(normalizeDirective("one   two\t\nthree")).toBe("one two three");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeDirective("   ")).toBe("");
    expect(normalizeDirective("")).toBe("");
  });

  it("leaves single word unchanged except trim", () => {
    expect(normalizeDirective("directive")).toBe("directive");
  });
});

describe("fingerprintDirective", () => {
  it("returns deterministic SHA256 hex for same normalized input", () => {
    const a = fingerprintDirective("same directive");
    const b = fingerprintDirective("same directive");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces same fingerprint for text that normalizes identically", () => {
    const a = fingerprintDirective("  a  b  c  ");
    const b = fingerprintDirective("a b c");
    expect(a).toBe(b);
  });

  it("produces different fingerprints for different content", () => {
    expect(fingerprintDirective("one")).not.toBe(fingerprintDirective("two"));
  });
});

describe("recordFinding", () => {
  beforeEach(() => {
    mockDoltSql.mockClear();
    mockDoltSql.mockImplementation(() => okAsync([]));
  });

  it("inserts learning with outcome 'new' when no prior exists (happy path)", async () => {
    mockDoltSql.mockImplementation((sql: string) => {
      if (sql.startsWith("SELECT")) return okAsync([]);
      return okAsync([]);
    });

    const result = await recordFinding(CONFIG, {
      directive_summary: "Use jsonObj for JSON columns",
      category: "db",
      source: "evolve",
    });

    expect(result.isOk()).toBe(true);
    result.match(
      (v) => {
        expect(v.outcome).toBe("new");
        expect(v.learning_id).toBeDefined();
        expect(typeof v.learning_id).toBe("string");
      },
      () => {},
    );
    expect(mockDoltSql).toHaveBeenCalledTimes(2);
  });

  it("inserts learning with outcome 'seen_again' when prior exists", async () => {
    const priorId = "00000000-0000-4000-8000-000000000001";
    mockDoltSql.mockImplementation((sql: string) => {
      if (sql.startsWith("SELECT"))
        return okAsync([{ learning_id: priorId, outcome: "new" }]);
      return okAsync([]);
    });

    const result = await recordFinding(CONFIG, {
      directive_summary: "Same directive",
      category: null,
      source: "learnings",
    });

    expect(result.isOk()).toBe(true);
    result.match(
      (v) => {
        expect(v.outcome).toBe("seen_again");
        expect(v.learning_id).toBeDefined();
      },
      () => {},
    );
  });

  it("returns error when select fails (error path)", async () => {
    const dbError = buildError(
      ErrorCode.DB_QUERY_FAILED,
      "connection refused",
      new Error("connection refused"),
    );
    mockDoltSql.mockImplementation(() => errAsync(dbError));

    const result = await recordFinding(CONFIG, {
      directive_summary: "any",
      category: null,
      source: "evolve",
    });

    expect(result.isErr()).toBe(true);
    result.match(
      () => {},
      (e) => {
        expect(e.code).toBe(ErrorCode.DB_QUERY_FAILED);
        expect(e.message).toContain("connection refused");
      },
    );
  });
});

describe("listRecurrences", () => {
  beforeEach(() => {
    mockDoltSql.mockClear();
    mockDoltSql.mockImplementation(() => okAsync([]));
  });

  it("returns rows from learning table (happy path)", async () => {
    const rows = [
      {
        learning_id: "lid-1",
        fingerprint: "fp1",
        directive_summary: "summary",
        category: "cat",
        source: "evolve",
        outcome: "new",
        prior_learning_id: null,
        plan_id: null,
        run_id: null,
        created_at: "2026-03-01 10:00:00",
      },
    ];
    mockDoltSql.mockImplementation(() => okAsync(rows));

    const result = await listRecurrences(CONFIG, { limit: 10 });

    expect(result.isOk()).toBe(true);
    result.match(
      (list) => {
        expect(list).toHaveLength(1);
        expect(list[0].learning_id).toBe("lid-1");
        expect(list[0].outcome).toBe("new");
      },
      () => {},
    );
  });

  it("returns error when select fails (error path)", async () => {
    const dbError = buildError(
      ErrorCode.DB_QUERY_FAILED,
      "table missing",
      new Error("table missing"),
    );
    mockDoltSql.mockImplementation(() => errAsync(dbError));

    const result = await listRecurrences(CONFIG, {});

    expect(result.isErr()).toBe(true);
    result.match(
      () => {},
      (e) => {
        expect(e.code).toBe(ErrorCode.DB_QUERY_FAILED);
        expect(e.message).toContain("table missing");
      },
    );
  });
});
