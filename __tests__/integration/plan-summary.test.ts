import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { v4 as uuidv4 } from "uuid";
import { doltSql } from "../../src/db/connection";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("plan summary integration", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let taskId: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    planId = uuidv4();
    taskId = uuidv4();

    (
      await doltSql(
        `INSERT INTO \`project\` (plan_id, title, intent, status, priority, created_at, updated_at)
         VALUES ('${planId}', 'Summary Test Plan', 'Intent: verify plan summary output.', 'active', 0, NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at)
         VALUES ('${taskId}', '${planId}', 'Done task one', 'done', NOW(), NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    const doneEventId = uuidv4();
    const noteEventId = uuidv4();
    (
      await doltSql(
        `INSERT INTO \`event\` (event_id, task_id, kind, body, created_at)
         VALUES ('${doneEventId}', '${taskId}', 'done', '{"evidence":"Tests passed."}', NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();

    (
      await doltSql(
        `INSERT INTO \`event\` (event_id, task_id, kind, body, created_at)
         VALUES ('${noteEventId}', '${taskId}', 'note', '{"message":"Optional note event."}', NOW())`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();
  }, 60000);

  afterAll(async () => {
    if (context) {
      await teardownIntegrationTest(context);
      context = undefined;
    }
  });

  it("output contains subject and sections (What changed, Why, Key insights, Deliverables)", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `plan summary --plan ${planId} --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("plan: Summary Test Plan — 1 tasks");
    expect(stdout).toContain("## What changed");
    expect(stdout).toContain("## Why");
    expect(stdout).toContain("## Key insights");
    expect(stdout).toContain("## Deliverables");
    expect(stdout).toContain("Summary Test Plan");
    expect(stdout).toContain("- Done task one");
    expect(stdout).toContain("Intent: verify plan summary output.");
    expect(stdout).toContain("- Optional note event.");
    expect(stdout).toContain("Done task one: Tests passed.");
  });

  it("--format commit: first line is subject, then blank line, then body", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `plan summary --plan ${planId} --format commit --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const lines = stdout.split("\n");
    expect(lines[0]).toBe("plan: Summary Test Plan — 1 tasks");
    expect(lines[1]).toBe("");
    expect(lines.length).toBeGreaterThan(2);
    const body = lines.slice(2).join("\n");
    expect(body).toContain("## What changed");
    expect(body).toContain("## Why");
    expect(body).toContain("## Key insights");
    expect(body).toContain("## Deliverables");
  });
});
