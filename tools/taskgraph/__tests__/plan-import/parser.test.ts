import { describe, it, expect } from "vitest";
import { parsePlanMarkdown } from "../../src/plan-import/parser";
import { AppError, ErrorCode } from "../../src/domain/errors";
import { writeFileSync, unlinkSync } from "fs";
import * as path from "path";

describe("parsePlanMarkdown", () => {
  const testFilePath = path.join(__dirname, "test-plan.md");

  it("should parse a well-formed markdown file with multiple tasks and BLOCKED_BY references", () => {
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
    writeFileSync(testFilePath, markdownContent);

    const result = parsePlanMarkdown(testFilePath);

    expect(result.isOk()).toBe(true);
    const { planTitle, planIntent, tasks } = result._unsafeUnwrap();

    expect(planTitle).toBe("My Feature Plan");
    expect(planIntent).toBe("To implement a new authentication system.");
    expect(tasks.length).toBe(3);

    expect(tasks[0]).toEqual({
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

    expect(tasks[1]).toEqual({
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

    expect(tasks[2]).toEqual({
      stableKey: "auth-logout",
      title: "Implement Logout Functionality",
      feature: "auth",
      area: "backend",
      blockedBy: ["auth-api-login"],
      acceptance: [],
    });
    unlinkSync(testFilePath);
  });

  it("should parse markdown with missing TITLE", () => {
    const markdownContent = `
TASK: no-title-task
FEATURE: missing
`;
    writeFileSync(testFilePath, markdownContent);

    const result = parsePlanMarkdown(testFilePath);
    expect(result.isOk()).toBe(true);
    const { tasks } = result._unsafeUnwrap();
    expect(tasks.length).toBe(1);
    expect(tasks[0]).toEqual({
      stableKey: "no-title-task",
      title: undefined,
      feature: "missing",
      area: undefined,
      blockedBy: [],
      acceptance: [],
    });
    unlinkSync(testFilePath);
  });

  it("should return error for non-existent file", () => {
    const result = parsePlanMarkdown("/non/existent/path/to/file.md");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.FILE_READ_FAILED);
  });

  it("should return empty tasks for an empty file", () => {
    writeFileSync(testFilePath, "");
    const result = parsePlanMarkdown(testFilePath);
    expect(result.isOk()).toBe(true);
    const { tasks } = result._unsafeUnwrap();
    expect(tasks.length).toBe(0);
    unlinkSync(testFilePath);
  });

  it("should return empty tasks for a file with no TASK blocks", () => {
    const markdownContent = `
# Just a title
INTENT: No tasks here.
`;
    writeFileSync(testFilePath, markdownContent);

    const result = parsePlanMarkdown(testFilePath);
    expect(result.isOk()).toBe(true);
    const { tasks } = result._unsafeUnwrap();
    expect(tasks.length).toBe(0);
    unlinkSync(testFilePath);
  });

  it("should correctly parse acceptance list with multiple items", () => {
    const markdownContent = `
TASK: accept-task
TITLE: Task with Acceptance
ACCEPTANCE:
- First check
- Second check
- Third check
`;
    writeFileSync(testFilePath, markdownContent);

    const result = parsePlanMarkdown(testFilePath);
    expect(result.isOk()).toBe(true);
    const { tasks } = result._unsafeUnwrap();
    expect(tasks.length).toBe(1);
    expect(tasks[0].acceptance).toEqual([
      "First check",
      "Second check",
      "Third check",
    ]);
    unlinkSync(testFilePath);
  });
});
