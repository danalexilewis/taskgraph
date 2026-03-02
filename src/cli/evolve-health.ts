/**
 * Baseline dashboard query for evolve health.
 * Reports scorecard metrics and optional backfilled baseline for the /evolve skill and dashboard.
 */
import { Command } from "commander";
import { ResultAsync } from "neverthrow";
import { tableExists } from "../db/migrate";
import { query } from "../db/query";
import type { AppError } from "../domain/errors";
import { readConfig, rootOpts } from "./utils";
import type { Config } from "./utils";

function bt(name: string): string {
  return `\`${name}\``;
}

/** Scorecard metrics derived from current DB (task, event, project). */
export interface EvolveHealthMetrics {
  completed_plans: number;
  completed_tasks: number;
  canceled_tasks: number;
  done_events_total: number;
  /** Done events whose evidence indicates gate:full passed (or human-run full suite). */
  done_events_gate_pass: number;
  /** Done events whose evidence indicates gate:full failed. */
  done_events_gate_fail: number;
}

/** Optional baseline snapshot for comparison (e.g. backfilled). Same shape as metrics. */
export interface EvolveHealthBaseline {
  completed_plans: number;
  completed_tasks: number;
  canceled_tasks: number;
  done_events_total: number;
  done_events_gate_pass: number;
  done_events_gate_fail: number;
}

export interface EvolveHealthData {
  metrics: EvolveHealthMetrics;
  /** When available, baseline to compare metrics against (e.g. backfilled snapshot). */
  baseline: EvolveHealthBaseline | null;
}

interface CountRow {
  count: number;
}

interface GateEvidenceRow {
  gate_pass: number;
  gate_fail: number;
}

/**
 * Fetches evolve health data: scorecard metrics from current state and optional baseline.
 * Uses project/plan table existence for env compatibility (see agent-field-guide).
 */
export function fetchEvolveHealth(
  config: Config,
): ResultAsync<EvolveHealthData, AppError> {
  return tableExists(config.doltRepoPath, "project")
    .andThen((exists) => {
      const projectTable = exists ? "project" : "plan";
      const q = query(config.doltRepoPath);

      const completedPlansSql = `SELECT COUNT(*) AS count FROM ${bt(projectTable)} WHERE status = 'done'`;
      const completedTasksSql = `SELECT COUNT(*) AS count FROM ${bt("task")} WHERE status = 'done'`;
      const canceledTasksSql = `SELECT COUNT(*) AS count FROM ${bt("task")} WHERE status = 'canceled'`;
      const doneTotalSql = `SELECT COUNT(*) AS count FROM ${bt("event")} WHERE kind = 'done'`;
      // Evidence in event.body: gate pass = "gate:full passed" or "gate:full run by human"; fail = "gate:full failed"
      const gateEvidenceSql = `
        SELECT
          (SELECT COUNT(*) FROM ${bt("event")} WHERE kind = 'done'
            AND (JSON_UNQUOTE(JSON_EXTRACT(body, '$.evidence')) LIKE '%gate:full passed%'
                 OR JSON_UNQUOTE(JSON_EXTRACT(body, '$.evidence')) LIKE '%gate:full run by human%')) AS gate_pass,
          (SELECT COUNT(*) FROM ${bt("event")} WHERE kind = 'done'
            AND JSON_UNQUOTE(JSON_EXTRACT(body, '$.evidence')) LIKE '%gate:full failed%') AS gate_fail
      `;

      return ResultAsync.combine([
        q.raw<CountRow>(completedPlansSql),
        q.raw<CountRow>(completedTasksSql),
        q.raw<CountRow>(canceledTasksSql),
        q.raw<CountRow>(doneTotalSql),
        q.raw<GateEvidenceRow>(gateEvidenceSql),
      ] as const).map(([cp, ct, can, done, gate]) => {
        const metrics: EvolveHealthMetrics = {
          completed_plans: Number(cp[0]?.count ?? 0),
          completed_tasks: Number(ct[0]?.count ?? 0),
          canceled_tasks: Number(can[0]?.count ?? 0),
          done_events_total: Number(done[0]?.count ?? 0),
          done_events_gate_pass: Number(gate[0]?.gate_pass ?? 0),
          done_events_gate_fail: Number(gate[0]?.gate_fail ?? 0),
        };
        return {
          metrics,
          baseline: null,
        } as EvolveHealthData;
      });
    });
}

function evolveHealthSubcommand(): Command {
  return new Command("health")
    .description(
      "Report evolve health scorecard metrics and baseline (for dashboard)",
    )
    .action(async (_options, cmd) => {
      const configResult = readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const json = rootOpts(cmd).json ?? false;

      const result = await fetchEvolveHealth(configResult.value);
      result.match(
        (data) => {
          if (json) {
            console.log(JSON.stringify(data, null, 2));
            return;
          }
          const m = data.metrics;
          const passRate =
            m.done_events_total > 0
              ? Math.round(
                  (m.done_events_gate_pass / m.done_events_total) * 100,
                )
              : null;
          console.log("Evolve health (baseline dashboard)");
          console.log("  Plans done:      " + m.completed_plans);
          console.log("  Tasks done:      " + m.completed_tasks);
          console.log("  Tasks canceled:  " + m.canceled_tasks);
          console.log("  Done events:     " + m.done_events_total);
          console.log(
            "  Gate pass / fail: " +
              m.done_events_gate_pass +
              " / " +
              m.done_events_gate_fail +
              (passRate != null ? " (" + passRate + "% pass)" : ""),
          );
          if (data.baseline) {
            console.log("  (baseline present)");
          }
        },
        (e: AppError) => {
          console.error(e.message);
          if (json) {
            console.log(
              JSON.stringify({ status: "error", message: e.message }, null, 2),
            );
          }
          process.exit(1);
        },
      );
    });
}

export function evolveCommand(program: Command): void {
  program
    .command("evolve")
    .description("Evolve health and baseline dashboard query")
    .addCommand(evolveHealthSubcommand());
}
