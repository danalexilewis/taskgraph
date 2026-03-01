/**
 * CLI for agent-context: collect (spawn collector), query (spawn query script), status (one-shot last 5 min).
 * Spawns Bun scripts; wraps subprocess errors in AppError and uses standard CLI error handling.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import type { Command } from "commander";
import { execa } from "execa";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { renderTable } from "./table";
import { type Config, readConfig, rootOpts } from "./utils";

const DEFAULT_AGENT_CONTEXT_DB = ".taskgraph/agent_context.db";
const COLLECT_SCRIPT = "scripts/collect-agent-events.ts";
const QUERY_SCRIPT = "scripts/query-agent-events.ts";

function getAgentContextDbPath(config: Config): string {
  const raw = config.agentContextDbPath ?? DEFAULT_AGENT_CONTEXT_DB;
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

/** Spawn collector in foreground; stdio inherit. Resolves on exit; rejects on spawn error or non-zero exit. */
function runCollect(dbPath: string): ResultAsync<void, AppError> {
  return ResultAsync.fromPromise(
    new Promise<void>((resolve, reject) => {
      const child = spawn("bun", [COLLECT_SCRIPT, "--db", dbPath], {
        cwd: process.cwd(),
        stdio: "inherit",
      });
      child.on("error", (e) => reject(e));
      child.on("exit", (code, signal) => {
        if (code === 0) resolve();
        else if (signal) reject(new Error(`Collector killed: ${signal}`));
        else reject(new Error(`Collector exited with code ${code}`));
      });
    }),
    (e) =>
      buildError(
        ErrorCode.UNKNOWN_ERROR,
        `Failed to run collector: ${(e as Error).message}`,
        e,
      ),
  );
}

/** Query script output shape. */
interface QueryOutput {
  agent_events?: AgentEventRow[];
  error?: string;
}

interface AgentEventRow {
  id?: number;
  agent?: string;
  task_id?: string;
  kind?: string;
  timestamp?: number;
  [key: string]: unknown;
}

/** Run query script with args; capture stdout and parse JSON. */
function runQuery(
  dbPath: string,
  args: { since?: number; agent?: string; task?: string; limit?: number },
): ResultAsync<QueryOutput, AppError> {
  const argv = [QUERY_SCRIPT, "--db", dbPath];
  if (args.since != null) argv.push("--since", String(args.since));
  if (args.agent) argv.push("--agent", args.agent);
  if (args.task) argv.push("--task", args.task);
  if (args.limit != null) argv.push("--limit", String(args.limit));

  return ResultAsync.fromPromise(
    execa("bun", argv, { cwd: process.cwd() }),
    (e) =>
      buildError(
        ErrorCode.UNKNOWN_ERROR,
        `Query script failed: ${(e as Error).message}`,
        e,
      ),
  ).andThen((result) => {
    try {
      const out = JSON.parse(result.stdout) as QueryOutput;
      if (out.error) {
        return errAsync(buildError(ErrorCode.UNKNOWN_ERROR, out.error));
      }
      return okAsync(out);
    } catch (e) {
      return errAsync(
        buildError(
          ErrorCode.DB_PARSE_FAILED,
          `Failed to parse query output: ${(e as Error).message}`,
          e,
        ),
      );
    }
  });
}

/** Map agent_events to table rows (headers + string rows). */
function eventsToTableRows(events: AgentEventRow[]): {
  headers: string[];
  rows: string[][];
} {
  if (events.length === 0) {
    return { headers: ["agent", "task_id", "kind", "timestamp"], rows: [] };
  }
  const headers = ["agent", "task_id", "kind", "timestamp"];
  const rows = events.map((e) => [
    String(e.agent ?? "—"),
    String(e.task_id ?? "—"),
    String(e.kind ?? "—"),
    e.timestamp != null ? new Date(e.timestamp).toISOString() : "—",
  ]);
  return { headers, rows };
}

export function agentContextCommand(program: Command) {
  const agentContext = program
    .command("agent-context")
    .description("Agent context: collect events, query, or show status");

  agentContext
    .command("collect")
    .description("Start the agent events collector (foreground)")
    .action(async () => {
      const configResult = readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;
      const dbPath = getAgentContextDbPath(config);
      console.log(`Starting collector, watching ... (db: ${dbPath})`);
      const result = await runCollect(dbPath);
      result.match(
        () => {},
        (e: AppError) => {
          console.error(`Error: ${e.message}`);
          process.exit(1);
        },
      );
    });

  agentContext
    .command("query")
    .description("Query agent events (spawns query script)")
    .option("--since <ms>", "Unix ms; only events after this", parseInt)
    .option("--agent <id>", "Filter by agent")
    .option("--task <id>", "Filter by task ID")
    .option("--limit <n>", "Max events to return", parseInt, 100)
    .action(async (opts, cmd) => {
      const configResult = readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;
      const dbPath = getAgentContextDbPath(config);
      const json = rootOpts(cmd).json ?? false;
      const result = await runQuery(dbPath, {
        since: opts.since,
        agent: opts.agent,
        task: opts.task,
        limit: opts.limit,
      });
      result.match(
        (out) => {
          const events = out.agent_events ?? [];
          if (json) {
            console.log(JSON.stringify({ agent_events: events }, null, 2));
          } else {
            const { headers, rows } = eventsToTableRows(events);
            if (rows.length > 0) {
              console.log(renderTable({ headers, rows }));
            } else {
              console.log("No agent events.");
            }
          }
        },
        (e: AppError) => {
          console.error(`Error: ${e.message}`);
          if (json) {
            console.log(
              JSON.stringify({ status: "error", message: e.message }),
            );
          }
          process.exit(1);
        },
      );
    });

  agentContext
    .command("status")
    .description(
      "One-shot: events per agent in last 5 min, most recent per agent",
    )
    .action(async (opts, cmd) => {
      const configResult = readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;
      const dbPath = getAgentContextDbPath(config);
      const json = rootOpts(cmd).json ?? false;
      const since = Date.now() - 5 * 60 * 1000;
      const result = await runQuery(dbPath, { since, limit: 1000 });
      result.match(
        (out) => {
          const events = out.agent_events ?? [];
          const byAgent = new Map<string, AgentEventRow[]>();
          for (const e of events) {
            const agent = e.agent ?? "—";
            if (!byAgent.has(agent)) byAgent.set(agent, []);
            byAgent.get(agent)!.push(e);
          }
          const statusRows: { agent: string; count: number; latest: string }[] =
            [];
          for (const [agent, list] of byAgent.entries()) {
            const sorted = [...list].sort(
              (a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0),
            );
            const latest = sorted[0];
            const latestStr =
              latest?.timestamp != null
                ? new Date(latest.timestamp).toISOString()
                : "—";
            statusRows.push({
              agent,
              count: list.length,
              latest: latestStr,
            });
          }
          statusRows.sort((a, b) => b.count - a.count);
          if (json) {
            console.log(JSON.stringify(statusRows, null, 2));
          } else {
            const headers = ["Agent", "Count", "Latest"];
            const rows = statusRows.map((r) => [
              r.agent,
              String(r.count),
              r.latest,
            ]);
            if (rows.length > 0) {
              console.log(renderTable({ headers, rows }));
            } else {
              console.log("No agent events in the last 5 minutes.");
            }
          }
        },
        (e: AppError) => {
          console.error(`Error: ${e.message}`);
          if (json) {
            console.log(
              JSON.stringify({ status: "error", message: e.message }),
            );
          }
          process.exit(1);
        },
      );
    });
}
