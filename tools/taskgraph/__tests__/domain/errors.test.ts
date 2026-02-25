import { describe, it, expect } from "vitest";
import { AppError, buildError, ErrorCode } from "../../src/domain/errors";

describe("Error Module", () => {
  it("should create an AppError with the correct properties", () => {
    const error: AppError = buildError(
      ErrorCode.TASK_NOT_FOUND,
      "Task was not found",
    );
    expect(error.code).toBe(ErrorCode.TASK_NOT_FOUND);
    expect(error.message).toBe("Task was not found");
    expect(error.cause).toBeUndefined();
  });

  it("should create an AppError with a cause", () => {
    const originalError = new Error("Something went wrong");
    const error: AppError = buildError(
      ErrorCode.DB_QUERY_FAILED,
      "Database query failed",
      originalError,
    );
    expect(error.code).toBe(ErrorCode.DB_QUERY_FAILED);
    expect(error.message).toBe("Database query failed");
    expect(error.cause).toBe(originalError);
  });

  it("should have all expected ErrorCodes defined", () => {
    const expectedErrorCodes = Object.values(ErrorCode);
    expect(expectedErrorCodes).toEqual([
      "DB_QUERY_FAILED",
      "DB_COMMIT_FAILED",
      "DB_PARSE_FAILED",
      "TASK_NOT_FOUND",
      "PLAN_NOT_FOUND",
      "INVALID_TRANSITION",
      "TASK_NOT_RUNNABLE",
      "CYCLE_DETECTED",
      "EDGE_EXISTS",
      "CONFIG_NOT_FOUND",
      "CONFIG_PARSE_FAILED",
      "FILE_READ_FAILED",
      "PARSE_FAILED",
      "VALIDATION_FAILED",
      "UNKNOWN_ERROR",
    ]);
  });
});
