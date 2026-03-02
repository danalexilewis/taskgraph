import type { Command } from "commander";
import { ResultAsync } from "neverthrow";
import { sqlEscape } from "../db/escape";
import { query } from "../db/query";
import type { AppError } from "../domain/errors";
import { buildError, ErrorCode } from "../domain/errors";
import { renderTable } from "./table";
import { getTerminalWidth } from "./terminal";
import { boxedSection, getBoxInnerWidth } from "./tui/boxen";
import { readConfig, rootOpts } from "./utils";

interface DoingTaskRow {
  task_id: string;
  hash_id: string;
  title: string;
  plan_title: string;
  started_body: string | null;
  started_at: string | null;
}

interface HeartbeatRow {
  task_id: string;
  heartbeat_body: string | null;
  heartbeat_at: string | null;
}

interface AgentEntry {
  agent: string;
  task_id: string;
  hash_id: string;
  task_title: string;
  plan_title: string;
  phase: string | null;
  files: string[];
  started_at: string | null;
  last_heartbeat_at: string | null;
}

function parseStartedBody(body: string | null): string {
  if (!body) return "unknown";
  try {
    const parsed =
      typeof body === "string"
        ? JSON.parse(body)
        : (body as Record<string, unknown>);
    return String(parsed.agent ?? "unknown");
  } catch {
    return "unknown";
  }
}

function parseHeartbeatBody(body: string | null): {
  phase: string | null;
  files: string[];
} {
  if (!body) return { phase: null, files: [] };
  try {
    const outer =
      typeof body === "string"
        ? JSON.parse(body)
        : (body as Record<string, unknown>);
    const msgRaw = outer.message;
    const inner =
      typeof msgRaw === "string"
        ? (JSON.parse(msgRaw) as Record<string, unknown>)
        : (msgRaw as Record<string, unknown>);
    const phase = inner.phase != null ? String(inner.phase) : null;
    const files = Array.isArray(inner.files)
      ? (inner.files as unknown[]).map(String)
      : [];
    return { phase, files };
  } catch {
    return { phase: null, files: [] };
  }
}

export function agentsCommand(program: Command) {
  program
    .command("agents")
    .description(
      "Show all active agents: doing tasks with their latest heartbeat status",
    )
    .option("--plan <planId>", "Filter by plan ID or title")
    .action(async (options, cmd) => {
      const configResult = readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;
      const json = rootOpts(cmd).json ?? false;
      const q = query(config.doltRepoPath);

      const planFilter = (() => {
        if (options.plan == null || String(options.plan).trim() === "")
          return "";
        const raw = sqlEscape(String(options.plan).trim());
        const isUUID =
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(
            String(options.plan),
          );
        return isUUID ? `AND p.plan_id = '${raw}'` : `AND p.title = '${raw}'`;
      })();

      const doingTasksSql = `
        SELECT t.task_id, t.hash_id, t.title, p.title AS plan_title,
          e.body AS started_body, e.created_at AS started_at
        FROM task t
        JOIN project p ON t.plan_id = p.plan_id
        LEFT JOIN event e ON e.event_id = (
          SELECT e2.event_id FROM event e2
          WHERE e2.task_id = t.task_id AND e2.kind = 'started'
          ORDER BY e2.created_at DESC LIMIT 1
        )
        WHERE t.status = 'doing' AND p.status != 'abandoned'
        ${planFilter}
        ORDER BY e.created_at DESC
      `;

      const heartbeatSql = `
        SELECT e.task_id, e.body AS heartbeat_body, e.created_at AS heartbeat_at
        FROM event e
        WHERE e.kind = 'note'
          AND JSON_UNQUOTE(JSON_EXTRACT(
                JSON_UNQUOTE(JSON_EXTRACT(e.body, '$.message')), '$.type'
              )) = 'heartbeat'
          AND e.created_at = (
            SELECT MAX(e2.created_at) FROM event e2
            WHERE e2.task_id = e.task_id AND e2.kind = 'note'
            AND JSON_UNQUOTE(JSON_EXTRACT(
                  JSON_UNQUOTE(JSON_EXTRACT(e2.body, '$.message')), '$.type'
                )) = 'heartbeat'
          )
      `;

      const result = await ResultAsync.combine([
        q.raw<DoingTaskRow>(doingTasksSql),
        q.raw<HeartbeatRow>(heartbeatSql),
      ] as const).mapErr(
        (e): AppError =>
          buildError(
            ErrorCode.UNKNOWN_ERROR,
            e instanceof Error ? e.message : String(e),
            e,
          ),
      );

      result.match(
        ([doingRows, heartbeatRows]) => {
          const heartbeatMap = new Map<string, HeartbeatRow>();
          for (const row of heartbeatRows) {
            heartbeatMap.set(row.task_id, row);
          }

          const agents: AgentEntry[] = doingRows.map((row) => {
            const agentName = parseStartedBody(
              row.started_body != null ? String(row.started_body) : null,
            );
            const hb = heartbeatMap.get(row.task_id);
            const { phase, files } = hb
              ? parseHeartbeatBody(
                  hb.heartbeat_body != null ? String(hb.heartbeat_body) : null,
                )
              : { phase: null, files: [] };
            return {
              agent: agentName,
              task_id: row.task_id,
              hash_id: row.hash_id,
              task_title: row.title,
              plan_title: row.plan_title,
              phase,
              files,
              started_at:
                row.started_at != null ? String(row.started_at) : null,
              last_heartbeat_at:
                hb?.heartbeat_at != null ? String(hb.heartbeat_at) : null,
            };
          });

          if (json) {
            console.log(JSON.stringify({ agents }, null, 2));
            return;
          }

          if (agents.length === 0) {
            console.log("No active agents.");
            return;
          }

          const w = getTerminalWidth();
          const innerWidth = getBoxInnerWidth(w);
          const tableRows = agents.map((a) => [
            a.agent,
            `${a.hash_id} ${a.task_title}`,
            a.plan_title,
            a.phase ?? "—",
            a.files.length > 0 ? a.files.join(", ") : "—",
            a.started_at ?? "—",
          ]);
          const table = renderTable({
            headers: ["Agent", "Task", "Plan", "Phase", "Files", "Started"],
            rows: tableRows,
            maxWidth: innerWidth,
            flexColumnIndex: 1,
          });
          console.log(boxedSection("Active Agents", table, w));
        },
        (e: AppError) => {
          console.error(`Error fetching agents: ${e.message}`);
          if (json) {
            console.log(
              JSON.stringify({
                status: "error",
                code: e.code,
                message: e.message,
              }),
            );
          }
          process.exit(1);
        },
      );
    });
}
