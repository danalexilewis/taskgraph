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

describe("tg stats --benchmark filter without timeline", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>>;
  let benchmarkPlanId: string;
  let normalPlanId: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    // Create benchmark plan with benchmark: true
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const benchPlan = `---
name: Benchmark Plan True
overview: Plan with benchmark flag true.
benchmark: true
todos:
  - id: b1
    content: "Task B1"
    status: pending
---
`;
    fs.writeFileSync(path.join(plansDir, "benchmark-true.md"), benchPlan);
    await runTgCli(
      `import plans/benchmark-true.md --plan "Benchmark Plan True" --format cursor`,
      context.tempDir,
    );
    // Create normal plan without benchmark
    const normalPlan = `---
name: Normal Plan
overview: Plan without benchmark flag.
todos:
  - id: n1
    content: "Task N1"
    status: pending
---
`;
    fs.writeFileSync(path.join(plansDir, "normal.md"), normalPlan);
    await runTgCli(
      `import plans/normal.md --plan "Normal Plan" --format cursor`,
      context.tempDir,
    );
    // Get plan IDs
    const listOut = await runTgCli(`plan list --json`, context.tempDir);
    const plans = JSON.parse(listOut.stdout);
    benchmarkPlanId = plans.find(
      (p: { title: string }) => p.title === "Benchmark Plan True",
    ).plan_id;
    normalPlanId = plans.find(
      (p: { title: string }) => p.title === "Normal Plan",
    ).plan_id;
    // Mark tasks done for each plan
    for (const planId of [benchmarkPlanId, normalPlanId]) {
      const next = await runTgCli(
        `next --plan ${planId} --limit 10 --json`,
        context.tempDir,
      );
      const taskId = JSON.parse(next.stdout)[0].task_id;
      // Insert start and done events
      const q = query(context.doltRepoPath);
      const s = new Date().toISOString().slice(0, 19).replace("T", " ");
      const d = new Date(Date.now() + 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      await q
        .insert("event", {
          event_id: uuidv4(),
          task_id: taskId,
          kind: "started",
          body: jsonObj({ agent: "impl-test", timestamp: s }),
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
  }, 60000);

  afterAll(async () => {
    if (context) await teardownIntegrationTest(context);
  }, 60000);

  it("filters to only benchmark plan in JSON output", async () => {
    const { stdout, exitCode } = await runTgCli(
      `stats --benchmark --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout);
    expect(Array.isArray(out)).toBe(true);
    // Should include only the benchmark plan
    const titles = out.map((p: { title: string }) => p.title);
    expect(titles).toEqual(["Benchmark Plan True"]);
  });

  it("without --benchmark, tg stats --json returns agent_metrics (not plan list)", async () => {
    const { stdout, exitCode } = await runTgCli(
      `stats --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout);
    // Default stats mode returns agent_metrics, not a plan list
    expect(out).toHaveProperty("agent_metrics");
  });
});
