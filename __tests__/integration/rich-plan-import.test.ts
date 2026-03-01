import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { doltSql } from "../../src/db/connection";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("Rich plan import integration", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let taskIdWithSuggested: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });

    const planContent = `---
name: Rich Test Plan
overview: "Plan with fileTree, risks, tests, and per-task intent/suggestedChanges."
fileTree: |
  src/foo.ts    (modify)
  src/bar.ts    (create)
risks:
  - description: Something could break
    severity: medium
    mitigation: Add tests
tests:
  - "Verify file_tree stored on plan"
  - "Verify suggested_changes on task"
todos:
  - id: rich-task-a
    content: "Task with suggested changes"
    domain: schema
    skill: sql-migration
    changeType: modify
    intent: "Add a nullable column to the plan table."
    suggestedChanges: "ALTER TABLE plan ADD COLUMN file_tree TEXT NULL;"
    status: pending
  - id: rich-task-b
    content: "Another task"
    status: pending
---
`;
    fs.writeFileSync(path.join(plansDir, "rich.md"), planContent);

    const { stdout: importStdout } = await runTgCli(
      `import plans/rich.md --plan "Rich Test Plan" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(importStdout).toContain("Successfully imported");

    const { stdout: listStdout } = await runTgCli(
      `plan list --json`,
      context.tempDir,
    );
    const plans = JSON.parse(listStdout) as Array<{
      plan_id: string;
      title: string;
    }>;
    const plan = plans.find((p) => p.title === "Rich Test Plan");
    expect(plan).toBeDefined();
    planId = plan?.plan_id;

    const { stdout: nextStdout } = await runTgCli(
      `next --plan ${planId} --limit 5 --json`,
      context.tempDir,
    );
    const nextTasks = JSON.parse(nextStdout) as Array<{
      task_id: string;
      title: string;
    }>;
    const suggestedTask = nextTasks.find(
      (t) => t.title === "Task with suggested changes",
    );
    expect(suggestedTask).toBeDefined();
    const id = suggestedTask?.task_id;
    if (id == null) throw new Error("expected suggested task task_id");
    taskIdWithSuggested = id;
  }, 60000);

  afterAll(async () => {
    if (context) {
      await teardownIntegrationTest(context);
    }
  });

  it("should store suggested_changes and intent on task row", async () => {
    if (!context) throw new Error("Context not initialized");
    const result = await doltSql(
      `SELECT intent, suggested_changes FROM task WHERE task_id = '${taskIdWithSuggested}'`,
      context.doltRepoPath,
    );
    expect(result.isOk()).toBe(true);
    const rows = result._unsafeUnwrap();
    expect(rows.length).toBe(1);
    const row = rows[0] as {
      intent: string | null;
      suggested_changes: string | null;
    };
    expect(row.intent).toContain("nullable column");
    expect(row.suggested_changes).toContain("ADD COLUMN file_tree");
  });

  it("should output suggested_changes (and plan file_tree/risks when present) in tg context", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `context ${taskIdWithSuggested} --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as {
      suggested_changes: string | null;
      file_tree?: string | null;
      risks?: unknown;
    };
    expect(data.suggested_changes).toBeTruthy();
    expect(data.suggested_changes).toContain("ADD COLUMN file_tree");
    if (data.file_tree) {
      expect(data.file_tree).toContain("src/foo.ts");
    }
    if (data.risks != null && Array.isArray(data.risks)) {
      expect(
        (data.risks as Array<{ description?: string }>).length,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});
