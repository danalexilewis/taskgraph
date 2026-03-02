import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { jsonObj, query } from "../../src/db/query";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

function toDatetime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

describe("tg stats --timeline --benchmark filter", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>>;
  const benchTitle = "Benchmark Timeline Plan";
  const nonBenchTitle = "Regular Timeline Plan";

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });

    // Import benchmark plan (with benchmark: true frontmatter flag)
    const benchPlanContent = `---
name: ${benchTitle}
overview: "Benchmark plan for timeline filter test."
benchmark: true
todos:
  - id: bmark-task-1
    content: "Benchmark task 1"
    status: pending
---`;
    fs.writeFileSync(
      path.join(plansDir, "bench-timeline.md"),
      benchPlanContent,
    );
    const benchRes = await runTgCli(
      `import plans/bench-timeline.md --plan "${benchTitle}" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(benchRes.exitCode).toBe(0);

    // Import non-benchmark plan
    const nonBenchContent = `---
name: ${nonBenchTitle}
overview: "Regular plan for timeline filter test."
todos:
  - id: regular-task-1
    content: "Regular task 1"
    status: pending
---`;
    fs.writeFileSync(
      path.join(plansDir, "nonbench-timeline.md"),
      nonBenchContent,
    );
    const nonBenchRes = await runTgCli(
      `import plans/nonbench-timeline.md --plan "${nonBenchTitle}" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(nonBenchRes.exitCode).toBe(0);

    // Add started/done events so both plans appear in timeline queries
    const { stdout: listOut } = await runTgCli(
      `plan list --json`,
      context.tempDir,
    );
    const plans = JSON.parse(listOut) as Array<{
      plan_id: string;
      title: string;
    }>;
    const benchPlan = plans.find((p) => p.title === benchTitle);
    const nonBenchPlan = plans.find((p) => p.title === nonBenchTitle);
    if (!benchPlan || !nonBenchPlan) throw new Error("Plans not found");

    for (const planId of [benchPlan.plan_id, nonBenchPlan.plan_id]) {
      const { stdout: nextOut } = await runTgCli(
        `next --plan ${planId} --limit 1 --json`,
        context.tempDir,
      );
      const tasks = JSON.parse(nextOut) as Array<{ task_id: string }>;
      if (tasks.length === 0) continue;
      const taskId = tasks[0].task_id;
      const q = query(context.doltRepoPath);
      const base = new Date();
      const s = toDatetime(base);
      const d = toDatetime(new Date(base.getTime() + 60_000));
      await q
        .insert("event", {
          event_id: uuidv4(),
          task_id: taskId,
          kind: "started",
          body: jsonObj({ agent: "impl-bench", timestamp: s }),
          created_at: s,
        })
        .then((r) => r._unsafeUnwrap());
      await q
        .insert("event", {
          event_id: uuidv4(),
          task_id: taskId,
          kind: "done",
          body: jsonObj({ evidence: "done", timestamp: d }),
          created_at: d,
        })
        .then((r) => r._unsafeUnwrap());
      await q
        .update("task", { status: "done" }, { task_id: taskId })
        .then((r) => r._unsafeUnwrap());
    }
  }, 60_000);

  afterAll(async () => {
    await teardownIntegrationTest(context);
  }, 60_000);

  it("--timeline --benchmark --json returns only benchmark plans", async () => {
    const { exitCode, stdout } = await runTgCli(
      `stats --timeline --benchmark --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout) as Array<{ title: string }>;
    expect(Array.isArray(out)).toBe(true);
    const titles = out.map((p) => p.title);
    expect(titles).toContain(benchTitle);
    expect(titles).not.toContain(nonBenchTitle);
  });

  it("--timeline (no --benchmark) returns all plans", async () => {
    const { exitCode, stdout } = await runTgCli(
      `stats --timeline --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout) as Array<{ title: string }>;
    expect(Array.isArray(out)).toBe(true);
    const titles = out.map((p) => p.title);
    expect(titles).toContain(benchTitle);
    expect(titles).toContain(nonBenchTitle);
  });
});
