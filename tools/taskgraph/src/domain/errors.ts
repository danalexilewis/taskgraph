import { ResultAsync, Result, ok, err } from "neverthrow";

export enum ErrorCode {
  // DB errors
  DB_QUERY_FAILED = "DB_QUERY_FAILED",
  DB_COMMIT_FAILED = "DB_COMMIT_FAILED",
  DB_PARSE_FAILED = "DB_PARSE_FAILED",

  // Domain errors
  TASK_NOT_FOUND = "TASK_NOT_FOUND",
  PLAN_NOT_FOUND = "PLAN_NOT_FOUND",
  INVALID_TRANSITION = "INVALID_TRANSITION",
  TASK_NOT_RUNNABLE = "TASK_NOT_RUNNABLE",
  CYCLE_DETECTED = "CYCLE_DETECTED",
  EDGE_EXISTS = "EDGE_EXISTS",

  // Config errors
  CONFIG_NOT_FOUND = "CONFIG_NOT_FOUND",
  CONFIG_PARSE_FAILED = "CONFIG_PARSE_FAILED",

  // Import errors
  FILE_READ_FAILED = "FILE_READ_FAILED",
  PARSE_FAILED = "PARSE_FAILED",

  // Validation
  VALIDATION_FAILED = "VALIDATION_FAILED",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

export interface AppError {
  code: ErrorCode;
  message: string;
  cause?: unknown;
}

export const buildError = (
  code: ErrorCode,
  message: string,
  cause?: unknown,
): AppError => ({
  code,
  message,
  cause,
});
