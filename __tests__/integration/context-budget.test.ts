import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { writeConfig } from "../../src/cli/utils";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("Context token budget and compaction", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let taskId: string;
  const BUDGET = 800;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    if (!context) throw new Error("setup failed");

    writeConfig(
      { doltRepoPath: context.doltRepoPath, context_token_budget: BUDGET },
      context.tempDir,
    )._unsafeUnwrap();

    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });

    const longFileTree =
      "fileTree: |\n" +
      Array(80)
        .fill(`  src/very/long/path/to/file-${"x".repeat(40)}.ts (modify)`)
        .join("\n");

    const planContent = `---
name: Context Budget Test Plan
overview: Plan with large file_tree to exercise context compaction
${longFileTree}
todos:
  - id: budget-task
    content: Task for context budget test
    status: pending
---
`;
    fs.writeFileSync(path.join(plansDir, "budget.md"), planContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/budget.md --plan "Context Budget Test Plan" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(importOut).toContain("Successfully imported");

    const { stdout: listOut } = await runTgCli(
      `plan list --json`,
      context.tempDir,
    );
    const plans = JSON.parse(listOut) as Array<{
      plan_id: string;
      title: string;
    }>;
    const planId = plans.find(
      (p) => p.title === "Context Budget Test Plan",
    )?.plan_id;
    expect(planId).toBeDefined();

    const { stdout: nextOut } = await runTgCli(
      `next --plan ${planId} --json --limit 5`,
      context.tempDir,
    );
    const tasks = JSON.parse(nextOut) as Array<{
      task_id: string;
      title: string;
    }>;
    const task = tasks.find((t) => t.title === "Task for context budget test");
    expect(task).toBeDefined();
    if (!task) throw new Error("task not found");
    taskId = task.task_id;
  }, 60000);

  afterAll(async () => {
    if (context) await teardownIntegrationTest(context);
  });

  it("reads context_token_budget and returns token_estimate; compacts related lists when over budget", async () => {
    if (!context) throw new Error("context not set");
    const { stdout } = await runTgCli(
      `context ${taskId} --json`,
      context.tempDir,
    );
    const data = JSON.parse(stdout) as {
      token_estimate?: number;
      related_done_by_doc?: Array<{
        task_id?: string;
        title?: string;
        plan_id?: string;
      }>;
      related_done_by_skill?: Array<{
        task_id?: string;
        title?: string;
        plan_id?: string;
      }>;
    };
    expect(data.token_estimate).toBeDefined();
    expect(typeof data.token_estimate).toBe("number");
    const est = data.token_estimate as number;
    // Large file_tree in plan guarantees context exceeds budget; compaction is applied
    expect(est).toBeGreaterThan(BUDGET);
    // Compaction: related_done slim to ≤3 items, { task_id, title } only (no plan_id)
    expect(data.related_done_by_doc?.length ?? 0).toBeLessThanOrEqual(3);
    expect(data.related_done_by_skill?.length ?? 0).toBeLessThanOrEqual(3);
    for (const t of data.related_done_by_doc ?? []) {
      expect(t).not.toHaveProperty("plan_id");
    }
    for (const t of data.related_done_by_skill ?? []) {
      expect(t).not.toHaveProperty("plan_id");
    }
  }, 15000);

  it("returns token_estimate in context --json when under budget (no compaction)", async () => {
    if (!context) throw new Error("context not set");
    // Same task; token_estimate is always present. With high budget we stay under and get full shape.
    const highBudget = 500_000;
    writeConfig(
      { doltRepoPath: context.doltRepoPath, context_token_budget: highBudget },
      context.tempDir,
    )._unsafeUnwrap();
    const { stdout } = await runTgCli(
      `context ${taskId} --json`,
      context.tempDir,
    );
    const data = JSON.parse(stdout) as { token_estimate?: number };
    expect(data.token_estimate).toBeDefined();
    expect(typeof data.token_estimate).toBe("number");
    expect(data.token_estimate as number).toBeLessThanOrEqual(highBudget);
  }, 15000);
});
