import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("Plan import with agent and docs fields", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>>;
  let tempDir: string;
  let planId: string;
  let taskIds: Record<string, string>;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    tempDir = context.tempDir;
    const plansDir = path.join(tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });

    const plan = `---
name: Agent Docs Test Plan
overview: Test plan exercising agent and docs fields
todos:
  - id: with-agent
    content: Task assigned to explorer
    agent: explorer
    docs: [schema, cli]
    changeType: investigate
    status: pending
  - id: without-agent
    content: Task with no agent specified
    docs: [cli]
    status: pending
  - id: legacy-domain
    content: Task using legacy domain field
    domain: [schema]
    status: pending
isProject: false
---
`;
    fs.writeFileSync(path.join(plansDir, "agent-docs.md"), plan);

    const { stdout } = await runTgCli(
      `import plans/agent-docs.md --plan "Agent Docs Test Plan" --format cursor --no-commit`,
      tempDir,
    );
    expect(stdout).toContain("Successfully imported");

    const { stdout: listOut } = await runTgCli(`plan list --json`, tempDir);
    const plans = JSON.parse(listOut) as Array<{
      plan_id: string;
      title: string;
    }>;
    planId = plans.find((p) => p.title === "Agent Docs Test Plan")?.plan_id;

    const { stdout: nextOut } = await runTgCli(
      `next --plan "${planId}" --json --limit 10`,
      tempDir,
    );
    const tasks = JSON.parse(nextOut) as Array<{
      task_id: string;
      title: string;
    }>;

    taskIds = {};
    for (const t of tasks) {
      if (t.title === "Task assigned to explorer")
        taskIds["with-agent"] = t.task_id;
      if (t.title === "Task with no agent specified")
        taskIds["without-agent"] = t.task_id;
      if (t.title === "Task using legacy domain field")
        taskIds["legacy-domain"] = t.task_id;
    }
  }, 60000);

  afterAll(() => {
    if (context) teardownIntegrationTest(context.tempDir);
  });

  it("stores agent field on task and surfaces it in context", async () => {
    const { stdout } = await runTgCli(
      `context ${taskIds["with-agent"]} --json`,
      tempDir,
    );
    const data = JSON.parse(stdout);
    expect(data.agent).toBe("explorer");
  }, 15000);

  it("agent is null when not specified", async () => {
    const { stdout } = await runTgCli(
      `context ${taskIds["without-agent"]} --json`,
      tempDir,
    );
    const data = JSON.parse(stdout);
    expect(data.agent).toBeNull();
  }, 15000);

  it("stores docs field in task_doc junction and surfaces in context", async () => {
    const { stdout } = await runTgCli(
      `context ${taskIds["with-agent"]} --json`,
      tempDir,
    );
    const data = JSON.parse(stdout);
    expect(data.docs).toEqual(expect.arrayContaining(["schema", "cli"]));
    expect(data.doc_paths).toEqual(
      expect.arrayContaining(["docs/schema.md", "docs/cli.md"]),
    );
  }, 15000);

  it("backward compat: domain field maps to task_doc", async () => {
    const { stdout } = await runTgCli(
      `context ${taskIds["legacy-domain"]} --json`,
      tempDir,
    );
    const data = JSON.parse(stdout);
    expect(data.docs).toContain("schema");
    expect(data.doc_paths).toContain("docs/schema.md");
  }, 15000);
});
