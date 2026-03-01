import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { doltSql } from "../../src/db/connection";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("Multi-agent integration", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let taskId: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planContent = `---
name: Multi-Agent Test Plan
overview: "Test plan for multi-agent features."
todos:
  - id: ma-task-1
    content: "Task 1"
    status: pending
isProject: false
---
`;
    fs.writeFileSync(path.join(plansDir, "multi-agent-test.md"), planContent);
    const { exitCode } = await runTgCli(
      `import plans/multi-agent-test.md --plan "Multi-Agent Test Plan" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    // external_key includes plan-scoped 6-char suffix (e.g. ma-task-1-abc123)
    const tasksResult = await doltSql(
      `SELECT task_id FROM \`task\` WHERE external_key LIKE 'ma-task-1-%' LIMIT 1`,
      context.doltRepoPath,
    );
    expect(tasksResult.isOk()).toBe(true);
    taskId = (tasksResult._unsafeUnwrap() as { task_id: string }[])[0].task_id;
  }, 60000);

  afterAll(async () => {
    if (context) await teardownIntegrationTest(context);
  });

  it("should record agent_id in started event body", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode } = await runTgCli(
      `start ${taskId} --agent alice --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);

    const eventsResult = await doltSql(
      `SELECT body FROM \`event\` WHERE task_id = '${taskId}' AND kind = 'started' ORDER BY created_at DESC LIMIT 1`,
      context.doltRepoPath,
    );
    expect(eventsResult.isOk()).toBe(true);
    const rows = eventsResult._unsafeUnwrap() as { body: string | object }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const raw = rows[0].body;
    const body =
      typeof raw === "string" ? JSON.parse(raw) : (raw as { agent?: string });
    let agentVal = body.agent;
    if (typeof agentVal === "string" && agentVal.startsWith('"')) {
      agentVal = JSON.parse(agentVal);
    }
    expect(agentVal).toBe("alice");
  }, 15000);

  it("should reject tg start when task is already doing (TASK_ALREADY_CLAIMED)", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stderr } = await runTgCli(
      `start ${taskId} --agent bob --no-commit`,
      context.tempDir,
      true,
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("alice");
    expect(stderr).toContain("--force");
  }, 15000);

  it("should allow --force to override claim", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode } = await runTgCli(
      `start ${taskId} --agent bob --force --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);

    const eventsResult = await doltSql(
      `SELECT body FROM \`event\` WHERE task_id = '${taskId}' AND kind = 'started' ORDER BY created_at DESC LIMIT 1`,
      context.doltRepoPath,
    );
    const rows = eventsResult._unsafeUnwrap() as { body: string }[];
    const raw = rows[0].body;
    const body = typeof raw === "string" ? JSON.parse(raw) : raw;
    let agent = (body as { agent?: string }).agent;
    if (typeof agent === "string" && agent.startsWith('"')) {
      agent = JSON.parse(agent);
    }
    expect(agent).toBe("bob");
  }, 15000);

  it("should show doing tasks with agent in tg status", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli("status", context.tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Active & next");
    expect(stdout).toContain("bob");
  }, 15000);

  it("should create note events via tg note", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode } = await runTgCli(
      `note ${taskId} --msg "Heads up: changed parser signature" --agent alice --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);

    const eventsResult = await doltSql(
      `SELECT kind, body FROM \`event\` WHERE task_id = '${taskId}' AND kind = 'note'`,
      context.doltRepoPath,
    );
    expect(eventsResult.isOk()).toBe(true);
    const rows = eventsResult._unsafeUnwrap() as {
      kind: string;
      body: string | object;
    }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const raw = rows[0].body;
    const body = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
      message?: string;
      agent?: string;
    };
    let message = body.message;
    let agent = body.agent;
    if (typeof message === "string" && message.startsWith('"')) {
      message = JSON.parse(message);
    }
    if (typeof agent === "string" && agent.startsWith('"')) {
      agent = JSON.parse(agent);
    }
    expect(String(message ?? "")).toContain(
      "Heads up: changed parser signature",
    );
    expect(agent).toBe("alice");
  }, 15000);

  it("should display notes in tg show", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      `show ${taskId}`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Recent Notes:");
    expect(stdout).toContain("Heads up: changed parser signature");
  }, 15000);
});
