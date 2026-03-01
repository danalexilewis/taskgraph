import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { doltSql } from "../../src/db/connection";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe.serial("template apply integration", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let templatePath: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    templatePath = path.join(context.tempDir, "feature-rollout.yaml");
    const templateContent = `
name: "{{feature}} rollout"
overview: "Implement {{feature}} in {{area}}."
todos:
  - id: task-1
    content: "Add {{feature}} API in {{area}}"
    changeType: create
  - id: task-2
    content: "Wire {{feature}} into UI"
    blockedBy: [task-1]
    docs: [backend]
`;
    fs.writeFileSync(templatePath, templateContent);
  }, 60000);

  afterAll(async () => {
    if (context) {
      await teardownIntegrationTest(context);
    }
  });

  it("should apply template with variable substitution and create plan and tasks", async () => {
    if (!context) throw new Error("Context not initialized");

    const templateFile = "feature-rollout.yaml";
    const { exitCode, stdout } = await runTgCli(
      `template apply ${templateFile} --plan "Auth rollout" --var feature=Auth --var area=backend --no-commit`,
      context.tempDir,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Successfully applied template");
    expect(stdout).toContain("Auth rollout");

    const plansResult = await doltSql(
      `SELECT plan_id, title, intent FROM \`plan\` WHERE title = 'Auth rollout'`,
      context.doltRepoPath,
    );
    expect(plansResult.isOk()).toBe(true);
    const plans = plansResult._unsafeUnwrap();
    expect(plans.length).toBe(1);
    expect((plans[0] as { intent: string }).intent).toContain("Auth");
    expect((plans[0] as { intent: string }).intent).toContain("backend");

    const tasksResult = await doltSql(
      `SELECT task_id, external_key, title FROM \`task\` WHERE plan_id = (SELECT plan_id FROM \`project\` WHERE title = 'Auth rollout') ORDER BY external_key`,
      context.doltRepoPath,
    );
    expect(tasksResult.isOk()).toBe(true);
    const tasks = tasksResult._unsafeUnwrap() as Array<{
      task_id: string;
      external_key: string;
      title: string;
    }>;
    expect(tasks.length).toBe(2);
    // external_key may include plan-scoped 6-char suffix
    const stableKey = (ek: string) => ek.replace(/-[0-9a-f]{6}$/i, "");
    const byKey = Object.fromEntries(
      tasks.map((t) => [stableKey(t.external_key), t]),
    );
    expect(byKey["task-1"].title).toBe("Add Auth API in backend");
    expect(byKey["task-2"].title).toBe("Wire Auth into UI");

    const task1Id = byKey["task-1"].task_id;
    const task2Id = byKey["task-2"].task_id;

    const edgesResult = await doltSql(
      `SELECT from_task_id, to_task_id, type FROM \`edge\` WHERE type = 'blocks'`,
      context.doltRepoPath,
    );
    expect(edgesResult.isOk()).toBe(true);
    const edges = edgesResult._unsafeUnwrap() as Array<{
      from_task_id: string;
      to_task_id: string;
      type: string;
    }>;
    const blockEdge = edges.find(
      (e) => e.from_task_id === task1Id && e.to_task_id === task2Id,
    );
    expect(blockEdge).toBeDefined();
    expect(blockEdge?.type).toBe("blocks");

    const taskDocResult = await doltSql(
      `SELECT task_id, doc FROM \`task_doc\` WHERE task_id = '${task2Id}'`,
      context.doltRepoPath,
    );
    expect(taskDocResult.isOk()).toBe(true);
    const taskDocs = taskDocResult._unsafeUnwrap() as Array<{
      task_id: string;
      doc: string;
    }>;
    expect(taskDocs.map((r) => r.doc)).toContain("backend");
  }, 30000);
});
