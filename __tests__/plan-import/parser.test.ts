import { describe, expect, it } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { ErrorCode } from "../../src/domain/errors";
import {
  parseCursorPlan,
  parsePlanMarkdown,
} from "../../src/plan-import/parser";

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

  it("should parse DOMAIN: lines into docs field", () => {
    const markdownContent = `
TASK: domain-task
TITLE: Task with domains
DOMAIN: schema, cli
ACCEPTANCE:
- First check
`;
    writeFileSync(testFilePath, markdownContent);
    const result = parsePlanMarkdown(testFilePath);
    expect(result.isOk()).toBe(true);
    const { tasks } = result._unsafeUnwrap();
    expect(tasks.length).toBe(1);
    expect(tasks[0].docs).toEqual(["schema", "cli"]);
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

describe("parseCursorPlan", () => {
  const testFilePath = path.join(__dirname, "test-cursor-plan.md");

  it("should parse Cursor format with YAML frontmatter and todos", () => {
    const content = `---
name: My Cursor Plan
overview: "A test plan in Cursor format."
todos:
  - id: task-1
    content: "First task"
    status: pending
  - id: task-2
    content: "Second task"
    status: completed
  - id: task-3
    content: "Third task"
    blockedBy: [task-1]
isProject: false
---

# Plan body (ignored)
`;
    writeFileSync(testFilePath, content);

    const result = parseCursorPlan(testFilePath);

    expect(result.isOk()).toBe(true);
    const { planTitle, planIntent, tasks } = result._unsafeUnwrap();

    expect(planTitle).toBe("My Cursor Plan");
    expect(planIntent).toBe("A test plan in Cursor format.");
    expect(tasks.length).toBe(3);

    expect(tasks[0]).toEqual({
      stableKey: "task-1",
      title: "First task",
      blockedBy: [],
      acceptance: [],
      status: "todo",
    });

    expect(tasks[1]).toEqual({
      stableKey: "task-2",
      title: "Second task",
      blockedBy: [],
      acceptance: [],
      status: "done",
    });

    expect(tasks[2]).toEqual({
      stableKey: "task-3",
      title: "Third task",
      blockedBy: ["task-1"],
      acceptance: [],
      status: "todo",
    });

    unlinkSync(testFilePath);
  });

  it("should return error when file has no frontmatter", () => {
    writeFileSync(testFilePath, "# No frontmatter here");
    const result = parseCursorPlan(testFilePath);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.FILE_READ_FAILED);
    unlinkSync(testFilePath);
  });

  it("should return error for non-existent file", () => {
    const result = parseCursorPlan("/non/existent/path/to/file.md");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.FILE_READ_FAILED);
  });

  it("should parse agent, docs, and domain (backward compat) on todos", () => {
    const content = `---
name: Agent and Docs Plan
overview: "Plan with agent, docs, domain."
todos:
  - id: task-docs
    content: "Task with docs"
    docs: [schema, cli]
    agent: explorer
    status: pending
  - id: task-domain
    content: "Task with domain (backward compat)"
    domain: cli
    status: pending
  - id: task-both
    content: "Task with both - docs wins"
    docs: schema
    domain: cli
    status: pending
---
`;
    writeFileSync(testFilePath, content);
    const result = parseCursorPlan(testFilePath);
    expect(result.isOk()).toBe(true);
    const { tasks } = result._unsafeUnwrap();
    expect(tasks.length).toBe(3);
    expect(tasks[0].docs).toEqual(["schema", "cli"]);
    expect(tasks[0].agent).toBe("explorer");
    expect(tasks[1].docs).toEqual(["cli"]);
    expect(tasks[1].agent).toBeUndefined();
    expect(tasks[2].docs).toEqual(["schema"]);
    unlinkSync(testFilePath);
  });

  it("should handle empty todos array", () => {
    const content = `---
name: Empty Plan
overview: "No tasks."
todos: []
---
`;
    writeFileSync(testFilePath, content);
    const result = parseCursorPlan(testFilePath);
    expect(result.isOk()).toBe(true);
    const { tasks } = result._unsafeUnwrap();
    expect(tasks).toEqual([]);
    unlinkSync(testFilePath);
  });

  it("should surface underlying YAML parse error in message when frontmatter is invalid", () => {
    const content = `---
name: Bad Plan
overview: "Unclosed quote
todos:
  - id: a
    content: "Task"
---
`;
    writeFileSync(testFilePath, content);
    const result = parseCursorPlan(testFilePath);
    expect(result.isErr()).toBe(true);
    const err = result._unsafeUnwrapErr();
    expect(err.code).toBe(ErrorCode.FILE_READ_FAILED);
    expect(err.message).toContain(testFilePath);
    expect(err.message).toMatch(/unclosed|quote|expected|line|column|YAML/i);
    unlinkSync(testFilePath);
  });
});
