import type { Command } from "commander";
import { ResultAsync } from "neverthrow";
import { TgClient } from "../api";
import { sqlEscape } from "../db/escape";
import { query } from "../db/query";
import type { AppError } from "../domain/errors";
import { buildError, ErrorCode } from "../domain/errors";
import type { HiveSnapshot, HiveTaskEntry } from "../domain/hive";
import { readConfig, rootOpts, shouldUseJson } from "./utils";

interface DoingTaskRow {
  task_id: string;
  title: string;
  change_type: string | null;
  plan_title: string | null;
  started_body: string | null;
  started_at: string | null;
}

interface HeartbeatRow {
  task_id: string;
  heartbeat_body: string | null;
  heartbeat_at: string | null;
}

interface NoteRow {
  task_id: string;
  body: string | null;
  created_at: string | null;
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

/**
 * Query function: returns a HiveSnapshot of all doing tasks with agent, phase, files, and recent notes.
 * If there are no doing tasks, query 3 (recent notes) is skipped and tasks array is empty.
 */
export async function getHiveSnapshot(
  doltRepoPath: string,
): Promise<HiveSnapshot> {
  const q = query(doltRepoPath);
  const asOf = new Date().toISOString();
  const doingTasksSql = `
    SELECT t.task_id, t.title, t.change_type, p.title AS plan_title,
      e.body AS started_body, e.created_at AS started_at
    FROM task t
    JOIN project p ON t.plan_id = p.plan_id
    LEFT JOIN event e ON e.event_id = (
      SELECT e2.event_id FROM event e2
      WHERE e2.task_id = t.task_id AND e2.kind = 'started'
      ORDER BY e2.created_at DESC LIMIT 1
    )
    WHERE t.status = 'doing' AND p.status != 'abandoned'
    ORDER BY e.created_at DESC
  `;

  const doingResult = await q.raw<DoingTaskRow>(doingTasksSql);
  if (doingResult.isErr()) {
    throw doingResult.error;
  }
  const doingRows = doingResult.value;

  if (doingRows.length === 0) {
    return { as_of: asOf, doing_count: 0, tasks: [] };
  }

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

  const taskIds = doingRows.map((r) => r.task_id);
  const inList = taskIds
    .map((id) => `'${sqlEscape(id)}'`)
    .join(", ");
  const recentNotesSql = `
    SELECT task_id, body, created_at
    FROM event
    WHERE kind = 'note' AND task_id IN (${inList})
    ORDER BY created_at DESC
  `;

  const [heartbeatResult, notesResult] = await Promise.all([
    q.raw<HeartbeatRow>(heartbeatSql),
    q.raw<NoteRow>(recentNotesSql),
  ]);

  if (heartbeatResult.isErr()) throw heartbeatResult.error;
  if (notesResult.isErr()) throw notesResult.error;

  const heartbeatMap = new Map<string, HeartbeatRow>();
  for (const row of heartbeatResult.value) {
    heartbeatMap.set(row.task_id, row);
  }

  const notesByTask = new Map<string, HiveTaskEntry["recent_notes"]>();
  const maxNotesPerTask = 5;
  for (const row of notesResult.value) {
    const list = notesByTask.get(row.task_id) ?? [];
    if (list.length >= maxNotesPerTask) continue;
    let bodyText = "";
    let agent: string | null = null;
    if (row.body) {
      try {
        const b =
          typeof row.body === "string"
            ? (JSON.parse(row.body) as Record<string, unknown>)
            : (row.body as Record<string, unknown>);
        const msg = b.message;
        bodyText =
          typeof msg === "string"
            ? msg
            : msg && typeof msg === "object" && (msg as { type?: string }).type === "heartbeat"
              ? "[heartbeat]"
              : JSON.stringify(msg ?? "");
        agent = b.agent != null ? String(b.agent) : null;
      } catch {
        bodyText = String(row.body).slice(0, 200);
      }
    }
    list.push({
      body_text: bodyText,
      agent,
      created_at: row.created_at != null ? String(row.created_at) : "",
    });
    notesByTask.set(row.task_id, list);
  }

  const taskMap = new Map<string, HiveTaskEntry>();
  for (const row of doingRows) {
    const hb = heartbeatMap.get(row.task_id);
    const { phase, files } = hb
      ? parseHeartbeatBody(
          hb.heartbeat_body != null ? String(hb.heartbeat_body) : null,
        )
      : { phase: null, files: [] };
    taskMap.set(row.task_id, {
      task_id: row.task_id,
      title: row.title,
      agent_name: parseStartedBody(
        row.started_body != null ? String(row.started_body) : null,
      ),
      plan_name: row.plan_title ?? null,
      change_type: row.change_type ?? null,
      started_at: row.started_at != null ? String(row.started_at) : null,
      heartbeat_phase: phase,
      heartbeat_files: files,
      recent_notes: notesByTask.get(row.task_id) ?? [],
    });
  }

  return {
    as_of: asOf,
    doing_count: taskMap.size,
    tasks: Array.from(taskMap.values()),
  };
}

export function contextCommand(program: Command) {
  program
    .command("context")
    .description(
      "Output doc paths, skill guide paths, and related done tasks for a task (run before starting work). With --hive, output HiveSnapshot of all doing tasks.",
    )
    .argument("[taskId]", "Task ID (required unless --hive)")
    .option("--hive", "Output HiveSnapshot of all active agent activity")
    .action(async (taskId, options, cmd) => {
      const json = shouldUseJson(cmd);
      const hive = options.hive === true;

      if (hive) {
        const configResult = readConfig();
        if (configResult.isErr()) {
          console.error(configResult.error.message);
          process.exit(1);
        }
        const config = configResult.value;
        const result = await ResultAsync.fromPromise(
          getHiveSnapshot(config.doltRepoPath),
          (e): AppError =>
            buildError(
              ErrorCode.UNKNOWN_ERROR,
              e instanceof Error ? e.message : String(e),
              e,
            ),
        );
        result.match(
          (snapshot) => {
            if (json) {
              console.log(JSON.stringify(snapshot, null, 2));
              return;
            }
            console.log(
              `Hive snapshot (${snapshot.doing_count} doing task(s), as of ${snapshot.as_of})`,
            );
            for (const e of snapshot.tasks) {
              console.log(
                `  ${e.task_id}  ${e.title}  ${e.agent_name ?? "—"}  ${e.heartbeat_phase ?? "—"}  ${e.heartbeat_files?.length ?? 0} file(s)`,
              );
              if (e.recent_notes?.length) {
                for (const n of e.recent_notes) {
                  console.log(`    note: ${n.body_text.slice(0, 80)}${n.body_text.length > 80 ? "…" : ""}`);
                }
              }
            }
          },
          (error: AppError) => {
            console.error(`Error: ${error.message}`);
            if (json) {
              console.log(
                JSON.stringify(
                  { status: "error", message: error.message },
                  null,
                  2,
                ),
              );
            }
            process.exit(1);
          },
        );
        return;
      }

      if (taskId == null || String(taskId).trim() === "") {
        console.error("Task ID is required (or use --hive for hive snapshot).");
        process.exit(1);
      }

      const client = new TgClient();
      const result = await client.context(String(taskId).trim());

      result.match(
        (d) => {
          const tokenCount = d.token_estimate;
          const charCount = JSON.stringify(d).length;
          if (json) {
            console.log(JSON.stringify(d, null, 2));
            return;
          }
          console.log(`Task: ${d.title} (${d.task_id})`);
          if (d.agent) console.log(`Agent: ${d.agent}`);
          if (d.change_type) console.log(`Change type: ${d.change_type}`);
          if (d.plan_name) {
            const overviewSnippet = d.plan_overview
              ? ` — ${d.plan_overview.split("\n")[0].slice(0, 120)}`
              : "";
            console.log(`Project: ${d.plan_name}${overviewSnippet}`);
          }
          d.doc_paths.forEach((p) => {
            console.log(`Doc: ${p}`);
          });
          d.skill_docs.forEach((doc) => {
            console.log(`Skill guide: ${doc}`);
          });
          if (d.suggested_changes) {
            console.log(`Suggested changes:`);
            console.log(d.suggested_changes);
          }
          if (d.file_tree) {
            console.log(`Project file tree:`);
            console.log(d.file_tree);
          }
          if (d.risks != null && Array.isArray(d.risks) && d.risks.length > 0) {
            console.log(`Project risks:`);
            d.risks.forEach(
              (r: {
                description?: string;
                severity?: string;
                mitigation?: string;
              }) => {
                console.log(
                  `  - ${r.severity ?? "?"}: ${r.description ?? ""} (${r.mitigation ?? ""})`,
                );
              },
            );
          }
          if (d.immediate_blockers.length > 0) {
            console.log(`Immediate blockers:`);
            d.immediate_blockers.forEach((b) => {
              const ev = b.evidence ? ` [evidence: ${b.evidence}]` : "";
              console.log(`  ${b.task_id}  ${b.title} (${b.status})${ev}`);
            });
          }
          console.log(`[context: ~${charCount} chars, ~${tokenCount} tokens]`);
        },
        (error: AppError) => {
          console.error(`Error: ${error.message}`);
          if (json) {
            console.log(
              JSON.stringify(
                { status: "error", message: error.message },
                null,
                2,
              ),
            );
          }
          process.exit(1);
        },
      );
    });
}
