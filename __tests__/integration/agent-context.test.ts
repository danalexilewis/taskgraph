/**
 * Integration tests for the agent-context collector and query script.
 * Requires scripts/collect-agent-events.ts and scripts/query-agent-events.ts.
 * Run from repo root so scripts/ and src/ resolve.
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "../..");
const COLLECT_SCRIPT = path.join(
  PROJECT_ROOT,
  "scripts/collect-agent-events.ts",
);
const QUERY_SCRIPT = path.join(PROJECT_ROOT, "scripts/query-agent-events.ts");

const POLL_INTERVAL_MS = 100;
const MAX_POLL_RETRIES = 20;
const COLLECTOR_STARTED_MARKER = "[collector] Started";

function boundedPoll<T>(
  fn: () => T | Promise<T>,
  predicate: (value: T) => boolean,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const run = async () => {
      try {
        const value = await Promise.resolve(fn());
        if (predicate(value)) {
          resolve(value);
          return;
        }
      } catch (e) {
        reject(e);
        return;
      }
      attempts++;
      if (attempts >= MAX_POLL_RETRIES) {
        reject(
          new Error(
            `Bounded poll failed after ${MAX_POLL_RETRIES} attempts (${attempts * POLL_INTERVAL_MS}ms)`,
          ),
        );
        return;
      }
      setTimeout(run, POLL_INTERVAL_MS);
    };
    run();
  });
}

function countRows(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .query<{ count: number }>("SELECT COUNT(*) AS count FROM agent_events")
      .get();
    return row?.count ?? 0;
  } finally {
    db.close();
  }
}

function getEvents(
  dbPath: string,
): Array<{ kind: string; agent: string; task_id: string | null }> {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .query<{ kind: string; agent: string; task_id: string | null }>(
        "SELECT kind, agent, task_id FROM agent_events",
      )
      .all();
    return rows;
  } finally {
    db.close();
  }
}

describe("Agent context collector and query integration", () => {
  let tmpDir: string;
  let terminalsDir: string;
  let dbPath: string;
  let _collectorPid: number | undefined;
  let pidFilePath: string;
  const envVarsSet: string[] = [];

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-agent-context-"));
    terminalsDir = path.join(tmpDir, "terminals");
    dbPath = path.join(tmpDir, "agent_context.db");
    pidFilePath = path.join(tmpDir, "collector.pid");
    fs.mkdirSync(terminalsDir, { recursive: true });

    const child = spawn(
      "bun",
      [
        COLLECT_SCRIPT,
        "--dir",
        terminalsDir,
        "--db",
        dbPath,
        "--interval",
        "100",
      ],
      {
        cwd: PROJECT_ROOT,
        stdio: "pipe",
        detached: true,
        env: { ...process.env },
      },
    );

    const pid = child.pid;
    if (pid === undefined) {
      throw new Error("Collector spawn failed: no PID");
    }
    _collectorPid = pid;
    child.unref();

    fs.writeFileSync(pidFilePath, String(pid), "utf8");

    let stdoutAccum = "";
    (child.stdout as NodeJS.ReadableStream).on(
      "data",
      (chunk: Buffer | string) => {
        stdoutAccum +=
          typeof chunk === "string" ? chunk : chunk.toString("utf8");
      },
    );
    await boundedPoll(
      () => Promise.resolve(stdoutAccum),
      (out) => out.includes(COLLECTOR_STARTED_MARKER),
    );
  }, 15_000);

  afterAll(async () => {
    if (pidFilePath && fs.existsSync(pidFilePath)) {
      try {
        const pid = Number.parseInt(
          fs.readFileSync(pidFilePath, "utf8").trim(),
          10,
        );
        if (Number.isFinite(pid)) {
          try {
            process.kill(-pid, "SIGTERM");
          } catch {
            // already dead
          }
          await new Promise((r) => setTimeout(r, 500));
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            // already dead
          }
        }
      } catch {
        // best-effort
      }
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    for (const key of envVarsSet) {
      delete process.env[key];
    }
  }, 10_000);

  it("collector inserts [tg:event] line; poll db and assert kind/agent/taskId", async () => {
    const terminalFile = path.join(terminalsDir, "1.txt");
    const event = {
      kind: "tg_start",
      agent: "implementer-a",
      taskId: "task-111",
      ts: Date.now(),
    };
    fs.appendFileSync(
      terminalFile,
      `[tg:event] ${JSON.stringify(event)}\n`,
      "utf8",
    );

    await boundedPoll(
      () => countRows(dbPath),
      (count) => count >= 1,
    );

    const events = getEvents(dbPath);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const inserted = events.find(
      (e) => e.kind === "tg_start" && e.agent === "implementer-a",
    );
    expect(inserted).toBeDefined();
    expect(inserted?.task_id).toBe("task-111");
  }, 10_000);

  it("collector ignores non-[tg:event] lines; assert 0 new rows after 2 poll cycles", async () => {
    const terminalFile = path.join(terminalsDir, "2.txt");
    const before = countRows(dbPath);
    fs.appendFileSync(terminalFile, "plain stdout line\n", "utf8");
    fs.appendFileSync(terminalFile, "another line without marker\n", "utf8");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS * 2));
    const after = countRows(dbPath);
    expect(after).toBe(before);
  }, 5_000);

  it("offset: write 3 events, wait, write 3 more; assert 6 rows", async () => {
    const terminalFile = path.join(terminalsDir, "3.txt");
    const base = countRows(dbPath);
    for (let i = 0; i < 3; i++) {
      fs.appendFileSync(
        terminalFile,
        `[tg:event] ${JSON.stringify({ kind: "custom", agent: "agent-3", ts: Date.now() + i })}\n`,
        "utf8",
      );
    }
    await boundedPoll(
      () => countRows(dbPath),
      (count) => count >= base + 3,
    );
    for (let i = 3; i < 6; i++) {
      fs.appendFileSync(
        terminalFile,
        `[tg:event] ${JSON.stringify({ kind: "custom", agent: "agent-3", ts: Date.now() + i })}\n`,
        "utf8",
      );
    }
    await boundedPoll(
      () => countRows(dbPath),
      (count) => count >= base + 6,
    );
    expect(countRows(dbPath)).toBeGreaterThanOrEqual(base + 6);
  }, 15_000);

  it("two terminal files, different agents; assert both in db", async () => {
    const fileA = path.join(terminalsDir, "4a.txt");
    const fileB = path.join(terminalsDir, "4b.txt");
    fs.appendFileSync(
      fileA,
      `[tg:event] ${JSON.stringify({ kind: "tg_done", agent: "agent-alpha", taskId: "t-a", ts: Date.now() })}\n`,
      "utf8",
    );
    fs.appendFileSync(
      fileB,
      `[tg:event] ${JSON.stringify({ kind: "tg_done", agent: "agent-beta", taskId: "t-b", ts: Date.now() + 1 })}\n`,
      "utf8",
    );

    await boundedPoll(
      () => {
        const events = getEvents(dbPath);
        const hasAlpha = events.some((e) => e.agent === "agent-alpha");
        const hasBeta = events.some((e) => e.agent === "agent-beta");
        return hasAlpha && hasBeta;
      },
      (ok) => ok,
    );

    const events = getEvents(dbPath);
    expect(events.some((e) => e.agent === "agent-alpha")).toBe(true);
    expect(events.some((e) => e.agent === "agent-beta")).toBe(true);
  }, 10_000);

  it("query script --since: events at ts 1000..5000, query --since 3000, assert 2 results", async () => {
    const terminalFile = path.join(terminalsDir, "5.txt");
    const timestamps = [1000, 2000, 3000, 4000, 5000];
    for (const ts of timestamps) {
      fs.appendFileSync(
        terminalFile,
        `[tg:event] ${JSON.stringify({ kind: "custom", agent: "query-test", ts })}\n`,
        "utf8",
      );
    }
    await boundedPoll(
      () => countRows(dbPath),
      (count) => count >= 5,
    );

    const execaModule = await import("execa");
    const execa = execaModule.default;
    const result = await execa(
      "bun",
      [QUERY_SCRIPT, "--db", dbPath, "--since", "3000"],
      {
        cwd: PROJECT_ROOT,
      },
    );
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout) as {
      agent_events?: Array<{ ts?: number; timestamp?: number }>;
    };
    const events = out.agent_events ?? [];
    // --since 3000 returns events strictly after 3000, so 4000 and 5000
    expect(events.length).toBe(2);
  }, 15_000);
});
