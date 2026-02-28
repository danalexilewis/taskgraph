import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("Export markdown integration", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planContent = `---
name: Round Trip Test
overview: "Test plan for import/export round-trip."
todos:
  - id: rt-task-1
    content: "First task"
    status: pending
  - id: rt-task-2
    content: "Second task"
    blockedBy: [rt-task-1]
    status: pending
isProject: false
---
`;
    fs.writeFileSync(path.join(plansDir, "round-trip.md"), planContent);

    const { stdout: importStdout } = await runTgCli(
      `import plans/round-trip.md --plan "Round Trip Test" --format cursor --no-commit`,
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
    const plan = plans.find((p) => p.title === "Round Trip Test");
    expect(plan).toBeDefined();
    planId = plan?.plan_id;
  }, 60000);

  afterAll(() => {
    if (context) {
      teardownIntegrationTest(context.tempDir);
    }
  });

  it("should export markdown to exports/ by default", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `export markdown --plan ${planId} --no-commit`,
      context.tempDir,
    );

    expect(exitCode).toBe(0);
    const exportPath = path.join(context.tempDir, "exports", `${planId}.md`);
    expect(stdout).toContain(exportPath);
    expect(fs.existsSync(exportPath)).toBe(true);

    const content = fs.readFileSync(exportPath, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("name: Round Trip Test");
    expect(content).toContain("overview:");
    expect(content).toContain("rt-task-1");
    expect(content).toContain("rt-task-2");
    expect(content).toContain("blockedBy");
  });

  it("should produce valid YAML that parses", async () => {
    if (!context) throw new Error("Context not initialized");
    await runTgCli(
      `export markdown --plan ${planId} --no-commit`,
      context.tempDir,
    );

    const exportPath = path.join(context.tempDir, "exports", `${planId}.md`);
    const content = fs.readFileSync(exportPath, "utf-8");
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    expect(match).not.toBeNull();
    const parsed = yaml.load(match?.[1]) as Record<string, unknown>;
    expect(parsed.name).toBe("Round Trip Test");
    const todos = parsed.todos as Array<{
      id: string;
      content: string;
      blockedBy?: string[];
    }>;
    expect(todos.length).toBe(2);
    expect(todos.find((t) => t.id === "rt-task-2")?.blockedBy).toEqual([
      "rt-task-1",
    ]);
  });

  it("should reject --out under plans/", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stderr } = await runTgCli(
      `export markdown --plan ${planId} --out plans/foo.md --no-commit`,
      context.tempDir,
      true,
    );

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("cannot write to plans/");
  });
});
