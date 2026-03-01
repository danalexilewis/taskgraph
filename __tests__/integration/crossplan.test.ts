import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

/**
 * Integration tests for tg crossplan: plans, domains, skills, files, summary.
 * Uses describe.serial so steps run in order against the same Dolt repo.
 */
describe.serial("Crossplan integration", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });

    const planA = `---
name: Crossplan Plan A
overview: "Plan A with shared domain and file."
todos:
  - id: a1
    content: "Task A1"
    domain: cli
    skill: cli-command
    status: pending
  - id: a2
    content: "Task A2"
    domain: cli
    skill: cli-command
    status: pending
fileTree: |
  src/cli/start.ts (modify)
  src/cli/crossplan.ts (create)
---
`;
    const planB = `---
name: Crossplan Plan B
overview: "Plan B with shared domain and file."
todos:
  - id: b1
    content: "Task B1"
    domain: cli
    skill: cli-command
    status: pending
fileTree: |
  src/cli/start.ts (modify)
  src/other.ts (create)
---
`;
    fs.writeFileSync(path.join(plansDir, "plan-a.md"), planA);
    fs.writeFileSync(path.join(plansDir, "plan-b.md"), planB);

    await runTgCli(
      `import plans/plan-a.md --plan "Crossplan Plan A" --format cursor --no-commit`,
      context.tempDir,
    );
    await runTgCli(
      `import plans/plan-b.md --plan "Crossplan Plan B" --format cursor --no-commit`,
      context.tempDir,
    );
  }, 60000);

  afterAll(() => {
    if (context) {
      teardownIntegrationTest(context.tempDir);
    }
  });

  it("crossplan plans --json returns plan summary with task counts by status", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `crossplan plans --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{
      plan_id: string;
      title: string;
      status: string;
      task_count: number;
      todo: number;
      doing: number;
      blocked: number;
      done: number;
      canceled: number;
    }>;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(2);
    const row = data.find((r) => r.title === "Crossplan Plan A");
    expect(row).toBeDefined();
    expect(typeof row?.plan_id).toBe("string");
    expect(typeof row?.title).toBe("string");
    expect(typeof row?.status).toBe("string");
    expect(typeof row?.task_count).toBe("number");
    expect(typeof row?.todo).toBe("number");
    expect(typeof row?.doing).toBe("number");
    expect(typeof row?.blocked).toBe("number");
    expect(typeof row?.done).toBe("number");
    expect(typeof row?.canceled).toBe("number");
  });

  it("crossplan domains --json returns domains shared across plans", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `crossplan domains --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{
      domain: string;
      plan_count: number;
      task_count: number;
      plan_titles: string[];
    }>;
    expect(Array.isArray(data)).toBe(true);
    const cliRow = data.find((r) => r.domain === "cli");
    expect(cliRow).toBeDefined();
    expect(cliRow?.plan_count).toBeGreaterThanOrEqual(2);
    expect(cliRow?.plan_titles).toContain("Crossplan Plan A");
    expect(cliRow?.plan_titles).toContain("Crossplan Plan B");
  });

  it("crossplan skills --json returns skills shared across plans", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `crossplan skills --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{
      skill: string;
      plan_count: number;
      task_count: number;
      plan_titles: string[];
    }>;
    expect(Array.isArray(data)).toBe(true);
    const skillRow = data.find((r) => r.skill === "cli-command");
    expect(skillRow).toBeDefined();
    expect(skillRow?.plan_count).toBeGreaterThanOrEqual(2);
  });

  it("crossplan files --json returns files touched by multiple plans", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `crossplan files --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{
      file: string;
      plan_count: number;
      plan_titles: string[];
    }>;
    expect(Array.isArray(data)).toBe(true);
    const startTs = data.find((r) => r.file === "src/cli/start.ts");
    expect(startTs).toBeDefined();
    expect(startTs?.plan_count).toBe(2);
    expect(startTs?.plan_titles).toContain("Crossplan Plan A");
    expect(startTs?.plan_titles).toContain("Crossplan Plan B");
  });

  it("crossplan edges --dry-run --json returns proposed edges and does not write", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `crossplan edges --dry-run --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as {
      proposed: Array<{
        type: string;
        from_task_id: string;
        to_task_id: string;
        reason?: string;
      }>;
      added: unknown[];
    };
    expect(Array.isArray(data.proposed)).toBe(true);
    expect(Array.isArray(data.added)).toBe(true);
    expect(data.added.length).toBe(0);
  });

  it("crossplan edges without --dry-run writes edges to Dolt", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `crossplan edges --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as {
      proposed: Array<{
        type: string;
        from_task_id: string;
        to_task_id: string;
        reason?: string;
      }>;
      added: Array<{ type: string; from_task_id: string; to_task_id: string }>;
    };
    expect(Array.isArray(data.proposed)).toBe(true);
    expect(Array.isArray(data.added)).toBe(true);
    expect(data.added.length).toBeGreaterThan(0);
  }, 30000);

  it("crossplan summary --json returns domains, skills, files, proposed_edges", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runTgCli(
      `crossplan summary --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as {
      domains: unknown[];
      skills: unknown[];
      files: Array<{ file: string; plan_count: number; plan_titles: string[] }>;
      proposed_edges: unknown[];
    };
    expect(Array.isArray(data.domains)).toBe(true);
    expect(Array.isArray(data.skills)).toBe(true);
    expect(Array.isArray(data.files)).toBe(true);
    expect(Array.isArray(data.proposed_edges)).toBe(true);
    const startTs = data.files.find((r) => r.file === "src/cli/start.ts");
    expect(startTs).toBeDefined();
    expect(startTs?.plan_count).toBe(2);
  });
});
