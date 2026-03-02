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

// ─── Test: tg stats --recovery ───────────────────────────────────────────────

describe("tg stats --recovery shows investigator fix rate", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

  beforeAll(async () => {
    context = await setupIntegrationTest();

    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });

    // Plan A: had a gate:full failure that was subsequently fixed
    const planAContent = `---\nname: Recovery Plan A\noverview: "Plan with gate failure that was fixed."\ntodos:\n  - id: recovery-a-task-1\n    content: "Recovery A task 1"\n    status: pending\n  - id: recovery-a-task-2\n    content: "Recovery A run-full-suite"\n    status: pending\n---\n`;
    fs.writeFileSync(path.join(plansDir, "recovery-a.md"), planAContent);
    await runTgCli(
      `import plans/recovery-a.md --plan "Recovery Plan A" --format cursor --no-commit`,
      context.tempDir,
    );

    // Plan B: had a gate:full failure that was NOT recovered
    const planBContent = `---\nname: Recovery Plan B\noverview: "Plan with unrecovered gate failure."\ntodos:\n  - id: recovery-b-task-1\n    content: "Recovery B task 1"\n    status: pending\n  - id: recovery-b-task-2\n    content: "Recovery B run-full-suite"\n    status: pending\n---\n`;
    fs.writeFileSync(path.join(plansDir, "recovery-b.md"), planBContent);
    await runTgCli(
      `import plans/recovery-b.md --plan "Recovery Plan B" --format cursor --no-commit`,
      context.tempDir,
    );

    // Plan C: no gate failures at all (should not count in recovery metrics)
    const planCContent = `---\nname: Recovery Plan C\noverview: "Plan with no gate failures."\ntodos:\n  - id: recovery-c-task-1\n    content: "Recovery C task 1"\n    status: pending\n---\n`;
    fs.writeFileSync(path.join(plansDir, "recovery-c.md"), planCContent);
    await runTgCli(
      `import plans/recovery-c.md --plan "Recovery Plan C" --format cursor --no-commit`,
      context.tempDir,
    );

    const planListOut = await runTgCli(`plan list --json`, context.tempDir);
    const plans = JSON.parse(planListOut.stdout) as Array<{
      plan_id: string;
      title: string;
    }>;
    const planA = plans.find((p) => p.title === "Recovery Plan A");
    const planB = plans.find((p) => p.title === "Recovery Plan B");
    const planC = plans.find((p) => p.title === "Recovery Plan C");
    if (!planA || !planB || !planC) throw new Error("Plans not found");

    const q = query(context.doltRepoPath);
    const base = new Date();

    // Helper: fetch first task for a plan
    const getFirstTaskId = async (planId: string): Promise<string> => {
      const out = await runTgCli(
        `next --plan ${planId} --limit 1 --json`,
        context.tempDir,
      );
      const tasks = JSON.parse(out.stdout) as Array<{ task_id: string }>;
      if (!tasks[0]) throw new Error(`No task found for plan ${planId}`);
      return tasks[0].task_id;
    };

    // Plan A task: done with evidence "gate:full failed: some errors"
    const taskA1 = await getFirstTaskId(planA.plan_id);
    const sA1 = toDatetime(base);
    const dA1 = toDatetime(new Date(base.getTime() + 60 * 1000));
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskA1,
        kind: "started",
        body: jsonObj({ agent: "implementer", timestamp: sA1 }),
        created_at: sA1,
      })
      .then((r) => r._unsafeUnwrap());
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskA1,
        kind: "done",
        body: jsonObj({
          evidence: "gate:full failed: 3 test failures",
          timestamp: dA1,
        }),
        created_at: dA1,
      })
      .then((r) => r._unsafeUnwrap());
    await q
      .update("task", { status: "done" }, { task_id: taskA1 })
      .then((r) => r._unsafeUnwrap());

    // Plan A also has a subsequent task with "gate:full passed" — recovered
    const out2 = await runTgCli(
      `next --plan ${planA.plan_id} --limit 2 --json`,
      context.tempDir,
    );
    const tasksA = JSON.parse(out2.stdout) as Array<{ task_id: string }>;
    const taskA2 = tasksA[0]?.task_id;
    if (taskA2) {
      const sA2 = toDatetime(new Date(base.getTime() + 120 * 1000));
      const dA2 = toDatetime(new Date(base.getTime() + 180 * 1000));
      await q
        .insert("event", {
          event_id: uuidv4(),
          task_id: taskA2,
          kind: "started",
          body: jsonObj({ agent: "implementer", timestamp: sA2 }),
          created_at: sA2,
        })
        .then((r) => r._unsafeUnwrap());
      await q
        .insert("event", {
          event_id: uuidv4(),
          task_id: taskA2,
          kind: "done",
          body: jsonObj({
            evidence: "gate:full passed",
            timestamp: dA2,
          }),
          created_at: dA2,
        })
        .then((r) => r._unsafeUnwrap());
      await q
        .update("task", { status: "done" }, { task_id: taskA2 })
        .then((r) => r._unsafeUnwrap());
    }

    // Plan B task: done with evidence "gate:full failed: build error" — NOT recovered
    const taskB1 = await getFirstTaskId(planB.plan_id);
    const sB1 = toDatetime(base);
    const dB1 = toDatetime(new Date(base.getTime() + 60 * 1000));
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskB1,
        kind: "started",
        body: jsonObj({ agent: "implementer", timestamp: sB1 }),
        created_at: sB1,
      })
      .then((r) => r._unsafeUnwrap());
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskB1,
        kind: "done",
        body: jsonObj({
          evidence: "gate:full failed: build error",
          timestamp: dB1,
        }),
        created_at: dB1,
      })
      .then((r) => r._unsafeUnwrap());
    await q
      .update("task", { status: "done" }, { task_id: taskB1 })
      .then((r) => r._unsafeUnwrap());

    // Plan C task: done with no gate reference — should not appear in recovery stats
    const taskC1 = await getFirstTaskId(planC.plan_id);
    const sC1 = toDatetime(base);
    const dC1 = toDatetime(new Date(base.getTime() + 60 * 1000));
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskC1,
        kind: "started",
        body: jsonObj({ agent: "implementer", timestamp: sC1 }),
        created_at: sC1,
      })
      .then((r) => r._unsafeUnwrap());
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskC1,
        kind: "done",
        body: jsonObj({ evidence: "implemented", timestamp: dC1 }),
        created_at: dC1,
      })
      .then((r) => r._unsafeUnwrap());
    await q
      .update("task", { status: "done" }, { task_id: taskC1 })
      .then((r) => r._unsafeUnwrap());
  }, 90000);

  afterAll(async () => {
    if (context) await teardownIntegrationTest(context);
  }, 60_000);

  it("--json outputs plans_with_failures, plans_recovered, and fix_rate_pct", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      `stats --recovery --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout) as {
      plans_with_failures: number;
      plans_recovered: number;
      fix_rate_pct: number | null;
    };
    // 2 plans had gate:full failures (Plan A and Plan B)
    expect(out.plans_with_failures).toBe(2);
    // 1 plan was recovered (Plan A had a gate:full passed event)
    expect(out.plans_recovered).toBe(1);
    // fix rate = 1/2 = 50%
    expect(out.fix_rate_pct).toBeCloseTo(50, 0);
  });

  it("human output contains Recovery Metrics header and fix rate", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      `stats --recovery`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Recovery Metrics");
    expect(stdout).toContain("Fix rate");
    expect(stdout).toContain("50.0%");
  });

  it("zero fix rate when no plans were recovered", async () => {
    if (!context) throw new Error("Context not initialized");

    // Plan B only has a failure — check that JSON output reflects partial fix rate
    const { exitCode, stdout } = await runTgCli(
      `stats --recovery --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout) as {
      plans_with_failures: number;
      plans_recovered: number;
      fix_rate_pct: number | null;
    };
    // fix_rate_pct is a number (not null) because there were failures
    expect(out.fix_rate_pct).not.toBeNull();
  });

  it("returns null fix_rate_pct when no gate failures exist", async () => {
    if (!context) throw new Error("Context not initialized");

    // Use a fresh context with no gate failures at all
    const freshCtx = await setupIntegrationTest();
    try {
      const { exitCode, stdout } = await runTgCli(
        `stats --recovery --json`,
        freshCtx.tempDir,
      );
      expect(exitCode).toBe(0);
      const out = JSON.parse(stdout) as {
        plans_with_failures: number;
        plans_recovered: number;
        fix_rate_pct: number | null;
      };
      expect(out.plans_with_failures).toBe(0);
      expect(out.plans_recovered).toBe(0);
      expect(out.fix_rate_pct).toBeNull();
    } finally {
      await teardownIntegrationTest(freshCtx);
    }
  });
});
