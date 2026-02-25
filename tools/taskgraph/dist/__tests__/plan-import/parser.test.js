"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const parser_1 = require("../../src/plan-import/parser");
const errors_1 = require("../../src/domain/errors");
const fs_1 = require("fs");
const path = __importStar(require("path"));
(0, vitest_1.describe)("parsePlanMarkdown", () => {
    const testFilePath = path.join(__dirname, "test-plan.md");
    (0, vitest_1.it)("should parse a well-formed markdown file with multiple tasks and BLOCKED_BY references", () => {
        const markdownContent = `
# My Feature Plan
INTENT: To implement a new authentication system.

TASK: auth-api-login
TITLE: Implement Auth API Login Endpoint
FEATURE: auth
AREA: backend
ACCEPTANCE:
- User can log in with valid credentials
- Invalid credentials return 401

TASK: auth-ui-login
TITLE: Implement Auth UI Login Component
FEATURE: auth
AREA: frontend
BLOCKED_BY: auth-api-login
ACCEPTANCE:
- Login form displays correctly
- Submits credentials to API
- Handles API responses

TASK: auth-logout
TITLE: Implement Logout Functionality
FEATURE: auth
AREA: backend
BLOCKED_BY: auth-api-login
`;
        (0, fs_1.writeFileSync)(testFilePath, markdownContent);
        const result = (0, parser_1.parsePlanMarkdown)(testFilePath);
        (0, vitest_1.expect)(result.isOk()).toBe(true);
        const { planTitle, planIntent, tasks } = result._unsafeUnwrap();
        (0, vitest_1.expect)(planTitle).toBe("My Feature Plan");
        (0, vitest_1.expect)(planIntent).toBe("To implement a new authentication system.");
        (0, vitest_1.expect)(tasks.length).toBe(3);
        (0, vitest_1.expect)(tasks[0]).toEqual({
            stableKey: "auth-api-login",
            title: "Implement Auth API Login Endpoint",
            feature: "auth",
            area: "backend",
            blockedBy: [],
            acceptance: [
                "User can log in with valid credentials",
                "Invalid credentials return 401",
            ],
        });
        (0, vitest_1.expect)(tasks[1]).toEqual({
            stableKey: "auth-ui-login",
            title: "Implement Auth UI Login Component",
            feature: "auth",
            area: "frontend",
            blockedBy: ["auth-api-login"],
            acceptance: [
                "Login form displays correctly",
                "Submits credentials to API",
                "Handles API responses",
            ],
        });
        (0, vitest_1.expect)(tasks[2]).toEqual({
            stableKey: "auth-logout",
            title: "Implement Logout Functionality",
            feature: "auth",
            area: "backend",
            blockedBy: ["auth-api-login"],
            acceptance: [],
        });
        (0, fs_1.unlinkSync)(testFilePath);
    });
    (0, vitest_1.it)("should parse markdown with missing TITLE", () => {
        const markdownContent = `
TASK: no-title-task
FEATURE: missing
`;
        (0, fs_1.writeFileSync)(testFilePath, markdownContent);
        const result = (0, parser_1.parsePlanMarkdown)(testFilePath);
        (0, vitest_1.expect)(result.isOk()).toBe(true);
        const { tasks } = result._unsafeUnwrap();
        (0, vitest_1.expect)(tasks.length).toBe(1);
        (0, vitest_1.expect)(tasks[0]).toEqual({
            stableKey: "no-title-task",
            title: undefined,
            feature: "missing",
            area: undefined,
            blockedBy: [],
            acceptance: [],
        });
        (0, fs_1.unlinkSync)(testFilePath);
    });
    (0, vitest_1.it)("should return error for non-existent file", () => {
        const result = (0, parser_1.parsePlanMarkdown)("/non/existent/path/to/file.md");
        (0, vitest_1.expect)(result.isErr()).toBe(true);
        (0, vitest_1.expect)(result._unsafeUnwrapErr().code).toBe(errors_1.ErrorCode.FILE_READ_FAILED);
    });
    (0, vitest_1.it)("should return empty tasks for an empty file", () => {
        (0, fs_1.writeFileSync)(testFilePath, "");
        const result = (0, parser_1.parsePlanMarkdown)(testFilePath);
        (0, vitest_1.expect)(result.isOk()).toBe(true);
        const { tasks } = result._unsafeUnwrap();
        (0, vitest_1.expect)(tasks.length).toBe(0);
        (0, fs_1.unlinkSync)(testFilePath);
    });
    (0, vitest_1.it)("should return empty tasks for a file with no TASK blocks", () => {
        const markdownContent = `
# Just a title
INTENT: No tasks here.
`;
        (0, fs_1.writeFileSync)(testFilePath, markdownContent);
        const result = (0, parser_1.parsePlanMarkdown)(testFilePath);
        (0, vitest_1.expect)(result.isOk()).toBe(true);
        const { tasks } = result._unsafeUnwrap();
        (0, vitest_1.expect)(tasks.length).toBe(0);
        (0, fs_1.unlinkSync)(testFilePath);
    });
    (0, vitest_1.it)("should correctly parse acceptance list with multiple items", () => {
        const markdownContent = `
TASK: accept-task
TITLE: Task with Acceptance
ACCEPTANCE:
- First check
- Second check
- Third check
`;
        (0, fs_1.writeFileSync)(testFilePath, markdownContent);
        const result = (0, parser_1.parsePlanMarkdown)(testFilePath);
        (0, vitest_1.expect)(result.isOk()).toBe(true);
        const { tasks } = result._unsafeUnwrap();
        (0, vitest_1.expect)(tasks.length).toBe(1);
        (0, vitest_1.expect)(tasks[0].acceptance).toEqual([
            "First check",
            "Second check",
            "Third check",
        ]);
        (0, fs_1.unlinkSync)(testFilePath);
    });
});
