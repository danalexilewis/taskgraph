"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const errors_1 = require("../../src/domain/errors");
(0, vitest_1.describe)("Error Module", () => {
    (0, vitest_1.it)("should create an AppError with the correct properties", () => {
        const error = (0, errors_1.buildError)(errors_1.ErrorCode.TASK_NOT_FOUND, "Task was not found");
        (0, vitest_1.expect)(error.code).toBe(errors_1.ErrorCode.TASK_NOT_FOUND);
        (0, vitest_1.expect)(error.message).toBe("Task was not found");
        (0, vitest_1.expect)(error.cause).toBeUndefined();
    });
    (0, vitest_1.it)("should create an AppError with a cause", () => {
        const originalError = new Error("Something went wrong");
        const error = (0, errors_1.buildError)(errors_1.ErrorCode.DB_QUERY_FAILED, "Database query failed", originalError);
        (0, vitest_1.expect)(error.code).toBe(errors_1.ErrorCode.DB_QUERY_FAILED);
        (0, vitest_1.expect)(error.message).toBe("Database query failed");
        (0, vitest_1.expect)(error.cause).toBe(originalError);
    });
    (0, vitest_1.it)("should have all expected ErrorCodes defined", () => {
        const expectedErrorCodes = Object.values(errors_1.ErrorCode);
        (0, vitest_1.expect)(expectedErrorCodes).toEqual([
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
