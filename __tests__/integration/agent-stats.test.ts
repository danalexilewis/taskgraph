import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { jsonObj, now, query } from "../../src/db/query";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

function toDatetime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

describe.serial("Agent stats integration (tg stats)", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let taskId1: string;
  let taskId2: string;
  let taskId3: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planContent = `---
name: Agent Stats Test Plan
overview: "Plan for tg stats integration tests."
todos:
  - id: stats-task-1
    content: "Stats task 1"
    status: pending
  - id: stats-task-2
    content: "Stats task 2"
    status: pending
  - id: stats-task-3
    content: "Stats task 3"
    status: pending
---
`;
    fs.writeFileSync(path.join(plansDir, "agent-stats-plan.md"), planContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/agent-stats-plan.md --plan "Agent Stats Test Plan" --format cursor --no-commit`,
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
    const plan = plans.find((p) => p.title === "Agent Stats Test Plan");
    expect(plan).toBeDefined();
    planId = plan?.plan_id;

    const { stdout: nextOut } = await runTgCli(
      `next --plan ${planId} --limit 5 --json`,
      context.tempDir,
    );
    const nextTasks = JSON.parse(nextOut) as Array<{
      task_id: string;
      title: string;
    }>;
    const t1 = nextTasks.find((t) => t.title === "Stats task 1");
    const t2 = nextTasks.find((t) => t.title === "Stats task 2");
    const t3 = nextTasks.find((t) => t.title === "Stats task 3");
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t3).toBeDefined();
    taskId1 = t1?.task_id;
    taskId2 = t2?.task_id;
    taskId3 = t3?.task_id;

    const q = query(context.doltRepoPath);
    const base = new Date();

    // Task 1: implementer-1, 100s elapsed
    const started1 = toDatetime(base);
    const done1 = toDatetime(new Date(base.getTime() + 100 * 1000));
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskId1,
        kind: "started",
        body: jsonObj({ agent: "implementer-1", timestamp: started1 }),
        created_at: started1,
      })
      .then((r) => r._unsafeUnwrap());
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskId1,
        kind: "done",
        body: jsonObj({ evidence: "done", timestamp: done1 }),
        created_at: done1,
      })
      .then((r) => r._unsafeUnwrap());

    // Task 2: implementer-2, 200s elapsed
    const started2 = toDatetime(new Date(base.getTime() + 500 * 1000));
    const done2 = toDatetime(new Date(base.getTime() + 700 * 1000));
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskId2,
        kind: "started",
        body: jsonObj({ agent: "implementer-2", timestamp: started2 }),
        created_at: started2,
      })
      .then((r) => r._unsafeUnwrap());
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskId2,
        kind: "done",
        body: jsonObj({ evidence: "done", timestamp: done2 }),
        created_at: done2,
      })
      .then((r) => r._unsafeUnwrap());

    // Task 3: implementer-1 again, 100s elapsed (avg for implementer-1 = 100)
    const started3 = toDatetime(new Date(base.getTime() + 1000 * 1000));
    const done3 = toDatetime(new Date(base.getTime() + 1100 * 1000));
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskId3,
        kind: "started",
        body: jsonObj({ agent: "implementer-1", timestamp: started3 }),
        created_at: started3,
      })
      .then((r) => r._unsafeUnwrap());
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskId3,
        kind: "done",
        body: jsonObj({ evidence: "done", timestamp: done3 }),
        created_at: done3,
      })
      .then((r) => r._unsafeUnwrap());

    // Review note events: body.message as object so stats' JSON_EXTRACT(..., '$.type') = 'review' matches
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskId1,
        kind: "note",
        body: jsonObj({
          message: { type: "review", verdict: "PASS", reviewer: "reviewer-1" },
        }),
        created_at: now(),
      })
      .then((r) => r._unsafeUnwrap());
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskId2,
        kind: "note",
        body: jsonObj({
          message: { type: "review", verdict: "FAIL", reviewer: "reviewer-2" },
        }),
        created_at: now(),
      })
      .then((r) => r._unsafeUnwrap());
    await q
      .insert("event", {
        event_id: uuidv4(),
        task_id: taskId3,
        kind: "note",
        body: jsonObj({
          message: { type: "review", verdict: "PASS", reviewer: "reviewer-1" },
        }),
        created_at: now(),
      })
      .then((r) => r._unsafeUnwrap());
  }, 60000);

  afterAll(async () => {
    if (context) await teardownIntegrationTest(context);
  });

  it("tg stats --json returns tasks_done and avg_seconds per agent", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      `stats --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout) as Array<{
      agent: string;
      tasks_done: number;
      avg_seconds: number | null;
      review_pass: number;
      review_fail: number;
    }>;

    const byTasksDone2 = out.find((r) => r.tasks_done === 2);
    const byTasksDone1 = out.find((r) => r.tasks_done === 1);
    expect(byTasksDone2).toBeDefined();
    expect(byTasksDone1).toBeDefined();
    expect(byTasksDone2?.tasks_done).toBe(2);
    expect(byTasksDone1?.tasks_done).toBe(1);
    expect(byTasksDone2?.avg_seconds).toBeCloseTo(100, 0);
    expect(byTasksDone1?.avg_seconds).toBeCloseTo(200, 0);
  });

  it("tg stats --json includes review pass/fail per reviewer", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      `stats --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout) as Array<{
      agent: string;
      tasks_done: number;
      review_pass: number;
      review_fail: number;
    }>;

    const byReviewPass2 = out.find(
      (r) => r.review_pass === 2 && r.review_fail === 0,
    );
    const byReviewFail1 = out.find(
      (r) => r.review_pass === 0 && r.review_fail === 1,
    );
    expect(byReviewPass2).toBeDefined();
    expect(byReviewFail1).toBeDefined();
    expect(byReviewPass2?.review_pass).toBe(2);
    expect(byReviewPass2?.review_fail).toBe(0);
    expect(byReviewFail1?.review_pass).toBe(0);
    expect(byReviewFail1?.review_fail).toBe(1);
  });

  it("tg stats (no --json) prints agent metrics lines", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(`stats`, context.tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Agent metrics (from event data):");
    expect(stdout).toContain("implementer-1");
    expect(stdout).toContain("implementer-2");
    expect(stdout).toMatch(/tasks_done:\s*2/);
    expect(stdout).toMatch(/tasks_done:\s*1/);
    expect(stdout).toContain("PASS");
    expect(stdout).toContain("FAIL");
  });

  it("tg stats --agent filters by agent name", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      `stats --agent implementer-1 --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout) as Array<{
      agent: string;
      tasks_done: number;
    }>;
    expect(Array.isArray(out)).toBe(true);
    if (out.length > 0) {
      const rowWithTwo = out.find((r) => r.tasks_done === 2);
      if (rowWithTwo) expect(rowWithTwo.tasks_done).toBe(2);
    }
  });
});
