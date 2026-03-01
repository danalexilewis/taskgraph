import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("Task dimensions integration", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let taskIdWithDimensions: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planContent = `---
name: Dimensions Test Plan
overview: "Plan with domain, skill, changeType on todos."
todos:
  - id: dim-schema
    content: "Schema task"
    domain: schema
    skill: sql-migration
    changeType: modify
    status: pending
  - id: dim-cli
    content: "CLI task"
    domain: cli
    skill: cli-command
    changeType: create
    status: pending
  - id: dim-done
    content: "Already done task"
    domain: schema
    skill: sql-migration
    changeType: refactor
    status: completed
---
`;
    fs.writeFileSync(path.join(plansDir, "dimensions.md"), planContent);

    const { stdout: importStdout } = await runTgCli(
      `import plans/dimensions.md --plan "Dimensions Test Plan" --format cursor --no-commit`,
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
    const plan = plans.find((p) => p.title === "Dimensions Test Plan");
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
    const schemaTask = nextTasks.find((t) => t.title === "Schema task");
    expect(schemaTask).toBeDefined();
    const id = schemaTask?.task_id;
    if (id == null) throw new Error("expected schema task task_id");
    taskIdWithDimensions = id;
  }, 60000);

  afterAll(async () => {
    if (context) {
      await teardownIntegrationTest(context);
    }
  });

  it("should store domain, skill, change_type on import", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `context ${taskIdWithDimensions} --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as {
      docs: string[];
      skills: string[];
      change_type: string | null;
      doc_paths: string[];
      skill_docs: string[];
    };
    expect(data.docs).toContain("schema");
    expect(data.skills).toContain("sql-migration");
    expect(data.change_type).toBe("modify");
    expect(data.doc_paths).toContain("docs/schema.md");
    expect(data.skill_docs).toContain("docs/skills/sql-migration.md");
  });

  it("should filter tg next by --domain", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `next --plan ${planId} --domain schema --limit 5`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Schema task");
    expect(stdout).not.toContain("CLI task");
  });

  it("should filter tg next by --skill", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `next --plan ${planId} --skill cli-command --limit 5`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("CLI task");
    expect(stdout).not.toContain("Schema task");
  });

  it("should return related_done_by_doc and related_done_by_skill in tg context", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `context ${taskIdWithDimensions} --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as {
      related_done_by_doc: Array<{ task_id: string; title: string }>;
      related_done_by_skill: Array<{ task_id: string; title: string }>;
    };
    expect(Array.isArray(data.related_done_by_doc)).toBe(true);
    expect(Array.isArray(data.related_done_by_skill)).toBe(true);
    // dim-done is done and has doc schema, skill sql-migration; may appear in related
    expect(data.related_done_by_doc.some((t) => t.title.includes("done"))).toBe(
      true,
    );
    expect(
      data.related_done_by_skill.some((t) => t.title.includes("done")),
    ).toBe(true);
  });
});
