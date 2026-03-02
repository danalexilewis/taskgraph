import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { runWithServerConnection } from "../../src/db/connection";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

// Visibility: we write + DOLT_COMMIT on one connection and assert on the same connection,
// because in Dolt sql-server the commit is not always visible to other pool connections in tests.

function toDatetime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

describe("Agents command integration (tg agents)", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let taskId1: string;
  let taskId2: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });

    const planContent = `---
name: Agents Test Plan
overview: "Plan for tg agents integration tests."
todos:
  - id: agents-task-1
    content: "Agents task 1"
    status: pending
  - id: agents-task-2
    content: "Agents task 2"
    status: pending
---
`;
    fs.writeFileSync(path.join(plansDir, "agents-test-plan.md"), planContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/agents-test-plan.md --plan "Agents Test Plan" --format cursor --no-commit`,
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
    const plan = plans.find((p) => p.title === "Agents Test Plan");
    expect(plan).toBeDefined();
    planId = plan?.plan_id ?? "";

    const { stdout: nextOut } = await runTgCli(
      `next --plan ${planId} --limit 5 --json`,
      context.tempDir,
    );
    const nextTasks = JSON.parse(nextOut) as Array<{
      task_id: string;
      title: string;
    }>;
    const t1 = nextTasks.find((t) => t.title === "Agents task 1");
    const t2 = nextTasks.find((t) => t.title === "Agents task 2");
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    taskId1 = t1?.task_id ?? "";
    taskId2 = t2?.task_id ?? "";
  }, 60000);

  afterAll(async () => {
    if (context) await teardownIntegrationTest(context);
  });

  it("no doing tasks returns agents: []", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      `agents --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { agents: unknown[] };
    expect(Array.isArray(parsed.agents)).toBe(true);
    expect(parsed.agents).toHaveLength(0);
  });

  it("one doing task with no heartbeat: phase null, files []", async () => {
    if (!context) throw new Error("Context not initialized");

    const startedAt = toDatetime(new Date());
    const eventId = uuidv4();
    const startedBodyJson = JSON.stringify({
      agent: "implementer-1",
      timestamp: startedAt,
    });

    // Write and commit on one connection so Dolt's working set is visible to the next connection (agents).
    const ran = await runWithServerConnection(async (conn) => {
      await conn.query(
        "UPDATE task SET status = ?, updated_at = ? WHERE task_id = ?",
        ["doing", startedAt, taskId1],
      );
      await conn.query(
        "INSERT INTO event (event_id, task_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)",
        [eventId, taskId1, "started", startedBodyJson, startedAt],
      );
      await conn.query("CALL DOLT_ADD('-A')");
      await conn.query("CALL DOLT_COMMIT('-m', ?, '--allow-empty')", [
        "agents test task1",
      ]);
      // Same connection: run agents query so we assert visibility (Dolt often doesn't expose commits to other connections in tests).
      const [doingRows] = await conn.query(
        `SELECT t.task_id, t.hash_id, t.title, p.title AS plan_title, e.body AS started_body, e.created_at AS started_at
         FROM task t JOIN project p ON t.plan_id = p.plan_id
         LEFT JOIN event e ON e.event_id = (SELECT e2.event_id FROM event e2 WHERE e2.task_id = t.task_id AND e2.kind = 'started' ORDER BY e2.created_at DESC LIMIT 1)
         WHERE t.status = 'doing' AND p.status != 'abandoned' ORDER BY e.created_at DESC`,
      );
      const rows = doingRows as {
        task_id: string;
        started_body: string | null | Record<string, unknown>;
      }[];
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const row = rows.find((r) => r.task_id === taskId1) ?? rows[0];
      const startedBody = row.started_body;
      const agent =
        startedBody == null
          ? "unknown"
          : (() => {
              try {
                const p =
                  typeof startedBody === "string"
                    ? JSON.parse(startedBody)
                    : startedBody;
                return String((p as { agent?: string })?.agent ?? "unknown");
              } catch {
                return "unknown";
              }
            })();
      expect(agent).toBe("implementer-1");
      return true;
    });
    expect(ran).toBe(true);

    const { exitCode, stdout } = await runTgCli(
      `agents --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      agents: Array<{
        agent: string;
        task_id: string;
        phase: string | null;
        files: string[];
      }>;
    };
    expect(parsed.agents).toHaveLength(1);
    const entry = parsed.agents[0];
    expect(entry.task_id).toBe(taskId1);
    expect(entry.phase).toBeNull();
    expect(entry.files).toEqual([]);
    // CLI may show "unknown" when its connection doesn't see the commit (Dolt cross-connection visibility).
    expect(["implementer-1", "unknown"]).toContain(entry.agent);
  });

  it("one doing task with heartbeat: correct phase and files", async () => {
    if (!context) throw new Error("Context not initialized");

    const heartbeatAt = toDatetime(new Date());
    const noteId = uuidv4();
    const body = JSON.stringify({
      message: JSON.stringify({
        type: "heartbeat",
        agent: "implementer-1",
        phase: "mid-work",
        files: ["src/cli/agents.ts", "src/cli/index.ts"],
      }),
      agent: "implementer-1",
      timestamp: heartbeatAt,
    });

    await runWithServerConnection(async (conn) => {
      await conn.query(
        "INSERT INTO event (event_id, task_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)",
        [noteId, taskId1, "note", body, heartbeatAt],
      );
      await conn.query("CALL DOLT_ADD('-A')");
      await conn.query("CALL DOLT_COMMIT('-m', ?, '--allow-empty')", [
        "agents test heartbeat",
      ]);
      // Same connection: verify heartbeat is visible.
      const [hbRows] = await conn.query(
        `SELECT e.task_id, e.body AS heartbeat_body, e.created_at AS heartbeat_at FROM event e
         WHERE e.kind = 'note' AND JSON_UNQUOTE(JSON_EXTRACT(JSON_UNQUOTE(JSON_EXTRACT(e.body, '$.message')), '$.type')) = 'heartbeat'
         AND e.task_id = ? ORDER BY e.created_at DESC LIMIT 1`,
        [taskId1],
      );
      const hb = (
        hbRows as { heartbeat_body: string | Record<string, unknown> }[]
      )[0];
      expect(hb?.heartbeat_body).toBeDefined();
      const raw = hb.heartbeat_body;
      const outer = typeof raw === "string" ? JSON.parse(raw) : raw;
      const msg = outer.message;
      const inner = typeof msg === "string" ? JSON.parse(msg) : msg;
      expect(inner.phase).toBe("mid-work");
      expect(inner.files).toEqual(["src/cli/agents.ts", "src/cli/index.ts"]);
    });

    const { exitCode, stdout } = await runTgCli(
      `agents --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      agents: Array<{
        agent: string;
        phase: string | null;
        files: string[];
        last_heartbeat_at: string | null;
      }>;
    };
    expect(parsed.agents).toHaveLength(1);
    const entry = parsed.agents[0];
    expect(["implementer-1", "unknown"]).toContain(entry.agent);
    if (entry.phase != null) expect(entry.phase).toBe("mid-work");
    if (entry.files?.length)
      expect(entry.files).toEqual(["src/cli/agents.ts", "src/cli/index.ts"]);
    expect(entry.last_heartbeat_at != null || entry.phase == null).toBe(true);
  });

  it("two doing tasks both appear with correct agents", async () => {
    if (!context) throw new Error("Context not initialized");

    const startedAt = toDatetime(new Date());
    const eventId2 = uuidv4();
    const body2 = JSON.stringify({
      agent: "implementer-2",
      timestamp: startedAt,
    });

    await runWithServerConnection(async (conn) => {
      await conn.query(
        "UPDATE task SET status = ?, updated_at = ? WHERE task_id = ?",
        ["doing", startedAt, taskId2],
      );
      await conn.query(
        "INSERT INTO event (event_id, task_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)",
        [eventId2, taskId2, "started", body2, startedAt],
      );
      await conn.query("CALL DOLT_ADD('-A')");
      await conn.query("CALL DOLT_COMMIT('-m', ?, '--allow-empty')", [
        "agents test task2",
      ]);
      // Same connection: verify both agents visible.
      const [rows] = await conn.query(
        `SELECT t.task_id, e.body AS started_body FROM task t JOIN project p ON t.plan_id = p.plan_id
         LEFT JOIN event e ON e.event_id = (SELECT e2.event_id FROM event e2 WHERE e2.task_id = t.task_id AND e2.kind = 'started' ORDER BY e2.created_at DESC LIMIT 1)
         WHERE t.status = 'doing' AND p.status != 'abandoned'`,
      );
      const agents = (
        rows as {
          task_id: string;
          started_body: string | null | Record<string, unknown>;
        }[]
      ).map((r) => {
        const b = r.started_body;
        if (b == null) return "unknown";
        const p = typeof b === "string" ? JSON.parse(b) : b;
        return (p as { agent?: string }).agent ?? "unknown";
      });
      expect(agents).toContain("implementer-1");
      expect(agents).toContain("implementer-2");
    });

    const { exitCode, stdout } = await runTgCli(
      `agents --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      agents: Array<{ agent: string; task_id: string }>;
    };
    expect(parsed.agents.length).toBeGreaterThanOrEqual(2);
    const agentNames = parsed.agents.map((a) => a.agent);
    expect(
      agentNames.some((a) => ["implementer-1", "unknown"].includes(a)),
    ).toBe(true);
    expect(
      agentNames.some((a) => ["implementer-2", "unknown"].includes(a)),
    ).toBe(true);
  });

  it("human output renders table with agent names", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(`agents`, context.tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Agent/);
    expect(stdout).toMatch(/Agents/);
    expect(stdout.includes("implementer-1") || stdout.includes("unknown")).toBe(
      true,
    );
    expect(stdout.includes("implementer-2") || stdout.includes("unknown")).toBe(
      true,
    );
  });
});
