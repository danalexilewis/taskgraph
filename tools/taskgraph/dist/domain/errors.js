"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildError = exports.ErrorCode = void 0;
var ErrorCode;
(function (ErrorCode) {
    // DB errors
    ErrorCode["DB_QUERY_FAILED"] = "DB_QUERY_FAILED";
    ErrorCode["DB_COMMIT_FAILED"] = "DB_COMMIT_FAILED";
    ErrorCode["DB_PARSE_FAILED"] = "DB_PARSE_FAILED";
    // Domain errors
    ErrorCode["TASK_NOT_FOUND"] = "TASK_NOT_FOUND";
    ErrorCode["PLAN_NOT_FOUND"] = "PLAN_NOT_FOUND";
    ErrorCode["INVALID_TRANSITION"] = "INVALID_TRANSITION";
    ErrorCode["TASK_NOT_RUNNABLE"] = "TASK_NOT_RUNNABLE";
    ErrorCode["CYCLE_DETECTED"] = "CYCLE_DETECTED";
    ErrorCode["EDGE_EXISTS"] = "EDGE_EXISTS";
    // Config errors
    ErrorCode["CONFIG_NOT_FOUND"] = "CONFIG_NOT_FOUND";
    ErrorCode["CONFIG_PARSE_FAILED"] = "CONFIG_PARSE_FAILED";
    // Import errors
    ErrorCode["FILE_READ_FAILED"] = "FILE_READ_FAILED";
    ErrorCode["PARSE_FAILED"] = "PARSE_FAILED";
    // Validation
    ErrorCode["VALIDATION_FAILED"] = "VALIDATION_FAILED";
    ErrorCode["UNKNOWN_ERROR"] = "UNKNOWN_ERROR";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
const buildError = (code, message, cause) => ({
    code,
    message,
    cause,
});
exports.buildError = buildError;
