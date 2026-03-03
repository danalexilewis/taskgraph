import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { ErrorCode } from "../../src/domain/errors";

// Force execa path (no server pool)
delete process.env.TG_DOLT_SERVER_PORT;
delete process.env.TG_DOLT_SERVER_DATABASE;

// Set short timeout before connection module loads so timeout message uses it
const TEST_TIMEOUT_MS = 50;
process.env.DOLT_EXECA_TIMEOUT_MS = String(TEST_TIMEOUT_MS);

const mockExeca = mock(
  (
    _cmd: string,
    _args: string[],
    _opts?: { timeout?: number; cwd?: string; env?: Record<string, string> },
  ) => {
    return Promise.resolve({ stdout: '{"rows":[]}', stderr: "" });
  },
);

mock.module("execa", () => ({
  default: mockExeca,
}));

const { doltSql } = await import("../../src/db/connection");

const REPO_PATH = "/tmp/tg-connection-test-repo";
const SANDBOX_MESSAGE =
  "Dolt could not run: operation not permitted. Run tg from an environment that allows reading .taskgraph/ and spawning the dolt binary, or fix permissions.";

describe("doltSql (execa path)", () => {
  beforeEach(() => {
    mockExeca.mockClear();
    mockExeca.mockImplementation(
      (_cmd: string, _args: string[], _opts?: { timeout?: number }) =>
        Promise.resolve({ stdout: '{"rows":[]}', stderr: "" }),
    );
  });

  afterEach(() => {
    mockExeca.mockRestore();
  });

  describe("timeout", () => {
    it("passes timeout option to execa and uses DOLT_EXECA_TIMEOUT_MS", async () => {
      mockExeca.mockImplementation(() =>
        Promise.resolve({ stdout: '{"rows":[]}', stderr: "" }),
      );

      const result = await doltSql("SELECT 1", REPO_PATH);

      expect(result.isOk()).toBe(true);
      expect(mockExeca).toHaveBeenCalledTimes(1);
      const call = mockExeca.mock.calls[0];
      expect(call).toBeDefined();
      const opts = call?.[2];
      expect(opts).toBeDefined();
      expect(
        typeof opts === "object" && opts !== null && "timeout" in opts,
      ).toBe(true);
      expect((opts as { timeout: number }).timeout).toBe(TEST_TIMEOUT_MS);
    });

    it("maps execa timedOut rejection to AppError with timeout message", async () => {
      const err = Object.assign(new Error("Timed out"), { timedOut: true });
      mockExeca.mockImplementation(() => Promise.reject(err));

      const result = await doltSql("SELECT 1", REPO_PATH);

      expect(result.isErr()).toBe(true);
      result.match(
        () => {},
        (e) => {
          expect(e.code).toBe(ErrorCode.DB_QUERY_FAILED);
          expect(e.message).toContain("timed out");
          expect(e.message).toContain(`${TEST_TIMEOUT_MS / 1000} s`);
        },
      );
    });

    it("rejects within timeout + margin when execa hangs (simulated)", async () => {
      const err = Object.assign(new Error("Timed out"), { timedOut: true });
      const marginMs = 100;
      mockExeca.mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(err), TEST_TIMEOUT_MS);
          }),
      );

      const start = Date.now();
      const result = await doltSql("SELECT 1", REPO_PATH);
      const elapsed = Date.now() - start;

      expect(result.isErr()).toBe(true);
      result.match(
        () => {},
        (e) => {
          expect(e.code).toBe(ErrorCode.DB_QUERY_FAILED);
          expect(e.message).toContain("timed out");
          expect(e.message).toContain(`${TEST_TIMEOUT_MS / 1000} s`);
        },
      );
      expect(elapsed).toBeGreaterThanOrEqual(TEST_TIMEOUT_MS - 5);
      expect(elapsed).toBeLessThanOrEqual(TEST_TIMEOUT_MS + marginMs);
    });
  });

  describe("EPERM and operation not permitted", () => {
    it("maps EPERM code to user-facing sandbox AppError", async () => {
      const err = Object.assign(new Error("operation not permitted"), {
        code: "EPERM",
      });
      mockExeca.mockImplementation(() => Promise.reject(err));

      const result = await doltSql("SELECT 1", REPO_PATH);

      expect(result.isErr()).toBe(true);
      result.match(
        () => {},
        (e) => {
          expect(e.code).toBe(ErrorCode.DB_QUERY_FAILED);
          expect(e.message).toBe(SANDBOX_MESSAGE);
        },
      );
    });

    it("maps message containing 'operation not permitted' to sandbox AppError", async () => {
      const err = new Error("Operation not permitted");
      mockExeca.mockImplementation(() => Promise.reject(err));

      const result = await doltSql("SELECT 1", REPO_PATH);

      expect(result.isErr()).toBe(true);
      result.match(
        () => {},
        (e) => {
          expect(e.code).toBe(ErrorCode.DB_QUERY_FAILED);
          expect(e.message).toBe(SANDBOX_MESSAGE);
        },
      );
    });
  });
});
