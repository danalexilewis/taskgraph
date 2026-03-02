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

describe("tg stats --plan --benchmark filter", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>>;
  let planIdBench: string;
  let planIdNonBench: string;
  const benchTitle = "Benchmark Plan Stats Test";
  const nonBenchTitle = "Regular Plan Stats Test";

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });

    // Import benchmark plan with flag
    const benchPlanContent = `---
name: ${benchTitle}
overview: "Benchmark plan for stats plan mode."
benchmark: true
todos:
  - id: bench-stats-task1
    content: "Benchmark stats task 1"
    status: pending
---`;
    fs.writeFileSync(path.join(plansDir, "bench-plan.md"), benchPlanContent);
    let res = await runTgCli(
      `import plans/bench-plan.md --plan "${benchTitle}" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(res.exitCode).toBe(0);

    const listOut1 = await runTgCli(`plan list --json`, context.tempDir);
    const plans1 = JSON.parse(listOut1.stdout) as Array<{
      plan_id: string;
      title: string;
    }>;
    planIdBench = plans1.find((p) => p.title === benchTitle)?.plan_id;

    // Add events to the benchmark plan so planSummary is non-null
    const { stdout: nextBench } = await runTgCli(
      `next --plan ${planIdBench} --limit 1 --json`,
      context.tempDir,
    );
    const benchTasks = JSON.parse(nextBench) as Array<{ task_id: string }>;
    if (benchTasks.length > 0) {
      const taskId = benchTasks[0].task_id;
      const q = query(context.doltRepoPath);
      const base = new Date();
      const s = toDatetime(base);
      const d = toDatetime(new Date(base.getTime() + 90_000));
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

    // Import non-benchmark plan without flag
    const nonBenchContent = `---
name: ${nonBenchTitle}
overview: "Regular plan for stats plan mode."
todos:
  - id: regular-stats-task2
    content: "Regular stats task 2"
    status: pending
---`;
    fs.writeFileSync(path.join(plansDir, "nonbench-plan.md"), nonBenchContent);
    res = await runTgCli(
      `import plans/nonbench-plan.md --plan "${nonBenchTitle}" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(res.exitCode).toBe(0);

    const listOut2 = await runTgCli(`plan list --json`, context.tempDir);
    const plans2 = JSON.parse(listOut2.stdout) as Array<{
      plan_id: string;
      title: string;
    }>;
    planIdNonBench = plans2.find((p) => p.title === nonBenchTitle)?.plan_id;
  }, 60_000);

  afterAll(async () => {
    await teardownIntegrationTest(context);
  }, 60_000);

  it("returns data for benchmark plan with --plan --benchmark --json", async () => {
    const { exitCode, stdout } = await runTgCli(
      `stats --plan ${planIdBench} --benchmark --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout) as {
      planSummary: { title: string; task_count: number } | null;
      tasks: unknown[];
    };
    expect(out.planSummary).not.toBeNull();
    expect(out.planSummary?.title).toBe(benchTitle);
    expect(Array.isArray(out.tasks)).toBe(true);
  });

  it("returns empty data for non-benchmark plan with --plan --benchmark --json", async () => {
    const { exitCode, stdout } = await runTgCli(
      `stats --plan ${planIdNonBench} --benchmark --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout) as {
      planSummary: unknown | null;
      tasks: unknown[];
    };
    expect(out.planSummary).toBeNull();
    expect(Array.isArray(out.tasks)).toBe(true);
    expect(out.tasks.length).toBe(0);
  });

  it("prints 'Plan is not marked as benchmark' for non-benchmark plan in plain mode", async () => {
    const { exitCode, stdout } = await runTgCli(
      `stats --plan "${nonBenchTitle}" --benchmark`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Plan is not marked as benchmark");
  });
});
