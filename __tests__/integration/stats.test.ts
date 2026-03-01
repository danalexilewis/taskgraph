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

async function importPlan(
  context: Awaited<ReturnType<typeof setupIntegrationTest>>,
  planName: string,
  tasks: Array<{ id: string; content: string }>,
): Promise<void> {
  const plansDir = path.join(context.tempDir, "plans");
  fs.mkdirSync(plansDir, { recursive: true });
  const todos = tasks
    .map(
      (t) =>
        `  - id: ${t.id}\n    content: "${t.content}"\n    status: pending`,
    )
    .join("\n");
  const planContent = `---\nname: ${planName}\noverview: "Plan for stats integration tests."\ntodos:\n${todos}\n---\n`;
  const fileName = `${planName.toLowerCase().replace(/\s+/g, "-")}.md`;
  fs.writeFileSync(path.join(plansDir, fileName), planContent);

  const { stdout } = await runTgCli(
    `import plans/${fileName} --plan "${planName}" --format cursor --no-commit`,
    context.tempDir,
  );
  expect(stdout).toContain("Successfully imported");
}

async function getPlanId(
  context: Awaited<ReturnType<typeof setupIntegrationTest>>,
  planName: string,
): Promise<string> {
  const { stdout } = await runTgCli(`plan list --json`, context.tempDir);
  const plans = JSON.parse(stdout) as Array<{ plan_id: string; title: string }>;
  const plan = plans.find((p) => p.title === planName);
  if (!plan) throw new Error(`Plan not found: ${planName}`);
  return plan.plan_id;
}

async function getTaskIds(
  context: Awaited<ReturnType<typeof setupIntegrationTest>>,
  planId: string,
  taskTitles: string[],
): Promise<Record<string, string>> {
  const { stdout } = await runTgCli(
    `next --plan ${planId} --limit 20 --json`,
    context.tempDir,
  );
  const tasks = JSON.parse(stdout) as Array<{ task_id: string; title: string }>;
  const result: Record<string, string> = {};
  for (const title of taskTitles) {
    const task = tasks.find((t) => t.title === title);
    if (!task) throw new Error(`Task not found: ${title}`);
    result[title] = task.task_id;
  }
  return result;
}

// ─── Test 1: tg stats --plan ────────────────────────────────────────────────

describe.serial(
  "tg stats --plan shows plan summary and per-task elapsed table",
  () => {
    let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
    let planId: string;
    let taskId1: string;
    let taskId2: string;

    beforeAll(async () => {
      context = await setupIntegrationTest();

      await importPlan(context, "Stats Plan View Test", [
        { id: "spv-task-1", content: "Plan view task 1" },
        { id: "spv-task-2", content: "Plan view task 2" },
      ]);

      planId = await getPlanId(context, "Stats Plan View Test");
      const ids = await getTaskIds(context, planId, [
        "Plan view task 1",
        "Plan view task 2",
      ]);
      taskId1 = ids["Plan view task 1"];
      taskId2 = ids["Plan view task 2"];

      const q = query(context.doltRepoPath);
      const base = new Date();

      // Task 1: started 0s, done after 120s
      const s1 = toDatetime(base);
      const d1 = toDatetime(new Date(base.getTime() + 120 * 1000));
      await q
        .insert("event", {
          event_id: uuidv4(),
          task_id: taskId1,
          kind: "started",
          body: jsonObj({ agent: "impl-a", timestamp: s1 }),
          created_at: s1,
        })
        .then((r) => r._unsafeUnwrap());
      await q
        .insert("event", {
          event_id: uuidv4(),
          task_id: taskId1,
          kind: "done",
          body: jsonObj({ evidence: "done task 1", timestamp: d1 }),
          created_at: d1,
        })
        .then((r) => r._unsafeUnwrap());
      await q
        .update("task", { status: "done" }, { task_id: taskId1 })
        .then((r) => r._unsafeUnwrap());

      // Task 2: started 200s later, done after 60s
      const s2 = toDatetime(new Date(base.getTime() + 200 * 1000));
      const d2 = toDatetime(new Date(base.getTime() + 260 * 1000));
      await q
        .insert("event", {
          event_id: uuidv4(),
          task_id: taskId2,
          kind: "started",
          body: jsonObj({ agent: "impl-a", timestamp: s2 }),
          created_at: s2,
        })
        .then((r) => r._unsafeUnwrap());
      await q
        .insert("event", {
          event_id: uuidv4(),
          task_id: taskId2,
          kind: "done",
          body: jsonObj({ evidence: "done task 2", timestamp: d2 }),
          created_at: d2,
        })
        .then((r) => r._unsafeUnwrap());
      await q
        .update("task", { status: "done" }, { task_id: taskId2 })
        .then((r) => r._unsafeUnwrap());
    }, 60000);

    afterAll(async () => {
      if (context) await teardownIntegrationTest(context);
    }, 60_000);

    it("human output contains plan title, duration info, and task rows", async () => {
      if (!context) throw new Error("Context not initialized");

      const { exitCode, stdout } = await runTgCli(
        `stats --plan ${planId}`,
        context.tempDir,
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Stats Plan View Test");
      expect(stdout).toContain("Duration:");
      expect(stdout).toContain("Tasks:");
      // Should show both task rows in the per-task table
      expect(stdout).toContain("Plan view task 1");
      expect(stdout).toContain("Plan view task 2");
    });

    it("--json outputs planSummary with title and tasks array", async () => {
      if (!context) throw new Error("Context not initialized");

      const { exitCode, stdout } = await runTgCli(
        `stats --plan ${planId} --json`,
        context.tempDir,
      );
      expect(exitCode).toBe(0);
      const out = JSON.parse(stdout) as {
        planSummary: {
          title: string;
          task_count: number;
          total_elapsed_s: number | null;
        };
        tasks: Array<{
          hash_id: string;
          title: string;
          elapsed_s: number | null;
        }>;
      };
      expect(out.planSummary).toBeDefined();
      expect(out.planSummary.title).toBe("Stats Plan View Test");
      expect(out.planSummary.task_count).toBe(2);
      expect(Array.isArray(out.tasks)).toBe(true);
      expect(out.tasks.length).toBe(2);
      // Sorted by elapsed DESC: task 1 (120s) first, task 2 (60s) second
      expect(out.tasks[0].elapsed_s).toBeGreaterThanOrEqual(
        out.tasks[1].elapsed_s ?? 0,
      );
    });

    it("--plan also works with plan title (not just ID)", async () => {
      if (!context) throw new Error("Context not initialized");

      const { exitCode, stdout } = await runTgCli(
        `stats --plan "Stats Plan View Test" --json`,
        context.tempDir,
      );
      expect(exitCode).toBe(0);
      const out = JSON.parse(stdout) as {
        planSummary: { title: string } | null;
        tasks: unknown[];
      };
      expect(out.planSummary?.title).toBe("Stats Plan View Test");
    });
  },
);

// ─── Test 2: tg stats --timeline ─────────────────────────────────────────────

describe.serial(
  "tg stats --timeline shows cross-plan execution history",
  () => {
    let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

    beforeAll(async () => {
      context = await setupIntegrationTest();

      // Create two plans with completed tasks each
      await importPlan(context, "Timeline Plan Alpha", [
        { id: "tl-alpha-1", content: "Timeline alpha task 1" },
      ]);
      await importPlan(context, "Timeline Plan Beta", [
        { id: "tl-beta-1", content: "Timeline beta task 1" },
      ]);

      const planAlphaId = await getPlanId(context, "Timeline Plan Alpha");
      const planBetaId = await getPlanId(context, "Timeline Plan Beta");

      const alphaIds = await getTaskIds(context, planAlphaId, [
        "Timeline alpha task 1",
      ]);
      const betaIds = await getTaskIds(context, planBetaId, [
        "Timeline beta task 1",
      ]);

      const q = query(context.doltRepoPath);
      const base = new Date();

      for (const taskId of [
        alphaIds["Timeline alpha task 1"],
        betaIds["Timeline beta task 1"],
      ]) {
        const s = toDatetime(base);
        const d = toDatetime(new Date(base.getTime() + 90 * 1000));
        await q
          .insert("event", {
            event_id: uuidv4(),
            task_id: taskId,
            kind: "started",
            body: jsonObj({ agent: "impl-b", timestamp: s }),
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
    }, 60_000);

    it("human output shows a Plan Timeline header with plan titles", async () => {
      if (!context) throw new Error("Context not initialized");

      const { exitCode, stdout } = await runTgCli(
        `stats --timeline`,
        context.tempDir,
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Plan Timeline");
      expect(stdout).toContain("Timeline Plan Alpha");
      expect(stdout).toContain("Timeline Plan Beta");
    });

    it("--json outputs array of plan entries with expected fields", async () => {
      if (!context) throw new Error("Context not initialized");

      const { exitCode, stdout } = await runTgCli(
        `stats --timeline --json`,
        context.tempDir,
      );
      expect(exitCode).toBe(0);
      const out = JSON.parse(stdout) as Array<{
        plan_id: string;
        title: string;
        status: string;
        task_count: number;
        done_count: number;
        total_elapsed_s: number | null;
      }>;
      expect(Array.isArray(out)).toBe(true);
      expect(out.length).toBeGreaterThanOrEqual(2);

      const alpha = out.find((p) => p.title === "Timeline Plan Alpha");
      const beta = out.find((p) => p.title === "Timeline Plan Beta");
      expect(alpha).toBeDefined();
      expect(beta).toBeDefined();
      expect(alpha?.task_count).toBe(1);
      expect(beta?.task_count).toBe(1);
      // Each plan entry has the expected keys
      expect(alpha).toHaveProperty("plan_id");
      expect(alpha).toHaveProperty("started_at");
    });
  },
);

// ─── Test 3: tg stats with self-report token data ────────────────────────────

describe.serial(
  "tg stats shows Token Usage section when self-report data exists",
  () => {
    let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

    beforeAll(async () => {
      context = await setupIntegrationTest();

      await importPlan(context, "Token Stats Test Plan", [
        { id: "tok-task-1", content: "Token stats task 1" },
      ]);
      const planId = await getPlanId(context, "Token Stats Test Plan");
      const ids = await getTaskIds(context, planId, ["Token stats task 1"]);
      const taskId = ids["Token stats task 1"];

      // Start the task directly via event insertion so we can control the agent
      const q = query(context.doltRepoPath);
      const s = toDatetime(new Date());
      await q
        .insert("event", {
          event_id: uuidv4(),
          task_id: taskId,
          kind: "started",
          body: jsonObj({ agent: "impl-token", timestamp: s }),
          created_at: s,
        })
        .then((r) => r._unsafeUnwrap());
      await q
        .update("task", { status: "doing" }, { task_id: taskId })
        .then((r) => r._unsafeUnwrap());

      // Done with token self-report flags
      const { exitCode } = await runTgCli(
        `done ${taskId} --evidence "token test" --tokens-in 1000 --tokens-out 200 --tool-calls 15 --no-commit`,
        context.tempDir,
      );
      expect(exitCode).toBe(0);
    }, 60000);

    afterAll(async () => {
      if (context) await teardownIntegrationTest(context);
    }, 60_000);

    it("human output contains Token Usage section", async () => {
      if (!context) throw new Error("Context not initialized");

      const { exitCode, stdout } = await runTgCli(`stats`, context.tempDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Token Usage");
      expect(stdout).toContain("avg_tokens_in");
      expect(stdout).toContain("avg_tokens_out");
    });

    it("--json output includes token_usage array with expected fields", async () => {
      if (!context) throw new Error("Context not initialized");

      const { exitCode, stdout } = await runTgCli(
        `stats --json`,
        context.tempDir,
      );
      expect(exitCode).toBe(0);
      const out = JSON.parse(stdout) as {
        agent_metrics: unknown[];
        token_usage?: Array<{
          agent: string;
          avg_tokens_in: number | null;
          avg_tokens_out: number | null;
          total_tokens_in: number | null;
          total_tokens_out: number | null;
        }>;
      };
      expect(Array.isArray(out.token_usage)).toBe(true);
      expect((out.token_usage ?? []).length).toBeGreaterThan(0);
      const row = out.token_usage?.[0];
      expect(row).toBeDefined();
      expect(row?.avg_tokens_in).toBeCloseTo(1000, 0);
      expect(row?.avg_tokens_out).toBeCloseTo(200, 0);
      expect(row?.total_tokens_in).toBeCloseTo(1000, 0);
    });
  },
);

// ─── Test 4: tg stats with no self-report data ───────────────────────────────

describe.serial(
  "tg stats does NOT show Token Usage section when no self-report data",
  () => {
    let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

    beforeAll(async () => {
      context = await setupIntegrationTest();

      await importPlan(context, "No Token Stats Plan", [
        { id: "notok-task-1", content: "No token task 1" },
      ]);
      const planId = await getPlanId(context, "No Token Stats Plan");
      const ids = await getTaskIds(context, planId, ["No token task 1"]);
      const taskId = ids["No token task 1"];

      // Insert start + done events WITHOUT token self-report fields
      const q = query(context.doltRepoPath);
      const base = new Date();
      const s = toDatetime(base);
      const d = toDatetime(new Date(base.getTime() + 60 * 1000));
      await q
        .insert("event", {
          event_id: uuidv4(),
          task_id: taskId,
          kind: "started",
          body: jsonObj({ agent: "impl-c", timestamp: s }),
          created_at: s,
        })
        .then((r) => r._unsafeUnwrap());
      await q
        .insert("event", {
          event_id: uuidv4(),
          task_id: taskId,
          kind: "done",
          body: jsonObj({ evidence: "done no tokens", timestamp: d }),
          created_at: d,
        })
        .then((r) => r._unsafeUnwrap());
      await q
        .update("task", { status: "done" }, { task_id: taskId })
        .then((r) => r._unsafeUnwrap());
    }, 60000);

    afterAll(async () => {
      if (context) await teardownIntegrationTest(context);
    }, 60_000);

    it("human output does NOT contain Token Usage section", async () => {
      if (!context) throw new Error("Context not initialized");

      const { exitCode, stdout } = await runTgCli(`stats`, context.tempDir);
      expect(exitCode).toBe(0);
      expect(stdout).not.toContain("Token Usage");
    });

    it("--json output does NOT include token_usage key", async () => {
      if (!context) throw new Error("Context not initialized");

      const { exitCode, stdout } = await runTgCli(
        `stats --json`,
        context.tempDir,
      );
      expect(exitCode).toBe(0);
      const out = JSON.parse(stdout) as {
        agent_metrics: unknown[];
        token_usage?: unknown[];
      };
      // token_usage should be absent or empty when no self-report data
      const hasTokenUsage =
        "token_usage" in out &&
        Array.isArray(out.token_usage) &&
        out.token_usage.length > 0;
      expect(hasTokenUsage).toBe(false);
    });
  },
);
