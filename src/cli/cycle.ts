import { Command } from "commander";
import { errAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { tableExists } from "../db/migrate";
import { now, query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { renderTable } from "./table";
import { getTerminalWidth } from "./terminal";
import { boxedSection, getBoxInnerWidth } from "./tui/boxen";
import { type Config, readConfig, rootOpts } from "./utils";

function parseDate(s: string | undefined): string | null {
  if (s == null || s === "") return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Add n weeks to a YYYY-MM-DD date string; returns YYYY-MM-DD. */
function addWeeks(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

export function cycleCommand(program: Command) {
  program
    .command("cycle")
    .description("Manage strategic cycles (time-bounded planning periods)")
    .addCommand(cycleNewCommand())
    .addCommand(cycleListCommand());
}

function cycleNewCommand(): Command {
  return new Command("new")
    .description("Create a new cycle")
    .argument("<name>", "Display name for the cycle")
    .option("--start-date <YYYY-MM-DD>", "Cycle start date (required)")
    .option("--end-date <YYYY-MM-DD>", "Cycle end date")
    .option("--weeks <n>", "Cycle length in weeks (alternative to --end-date)")
    .action(async (name, options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        const startDate = parseDate(options.startDate);
        if (!startDate) {
          return errAsync(
            buildError(
              ErrorCode.VALIDATION_FAILED,
              "Missing or invalid --start-date (use YYYY-MM-DD).",
            ),
          );
        }
        const endFromOption = parseDate(options.endDate);
        const weeks = options.weeks != null ? Number(options.weeks) : NaN;
        let endDate: string | null = endFromOption;
        if (endDate == null && !Number.isNaN(weeks) && weeks >= 0) {
          endDate = addWeeks(startDate, weeks);
        }
        if (!endDate) {
          return errAsync(
            buildError(
              ErrorCode.VALIDATION_FAILED,
              "Provide either --end-date <YYYY-MM-DD> or --weeks <n>.",
            ),
          );
        }
        if (endDate < startDate) {
          return errAsync(
            buildError(
              ErrorCode.VALIDATION_FAILED,
              "End date must be on or after start date.",
            ),
          );
        }
        return tableExists(config.doltRepoPath, "cycle").andThen((exists) => {
          if (!exists) {
            return errAsync(
              buildError(
                ErrorCode.DB_QUERY_FAILED,
                "Cycle table does not exist. Run tg init (or ensure migrations have run) so the cycle table is created.",
              ),
            );
          }
          const cycle_id = uuidv4();
          const currentTimestamp = now();
          const q = query(config.doltRepoPath);
          return q
            .insert("cycle", {
              cycle_id,
              name,
              start_date: startDate,
              end_date: endDate,
              created_at: currentTimestamp,
              updated_at: currentTimestamp,
            })
            .andThen(() =>
              doltCommit(
                `cycle: create ${cycle_id} - ${name}`,
                config.doltRepoPath,
                rootOpts(cmd).noCommit,
              ),
            )
            .map(() => ({
              cycle_id,
              name,
              start_date: startDate,
              end_date: endDate,
            }));
        });
      });

      result.match(
        (data) => {
          if (!rootOpts(cmd).json) {
            console.log(
              `Cycle '${data.name}' created (id: ${data.cycle_id}, ${data.start_date} – ${data.end_date})`,
            );
          } else {
            console.log(JSON.stringify(data, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error creating cycle: ${error.message}`);
          if (rootOpts(cmd).json) {
            console.log(
              JSON.stringify({
                status: "error",
                code: error.code,
                message: error.message,
                cause: error.cause,
              }),
            );
          }
          process.exit(1);
        },
      );
    });
}

interface CycleRow {
  cycle_id: string;
  name: string;
  start_date: string;
  end_date: string;
}

function cycleStatus(
  startDate: string,
  endDate: string,
): "Active" | "Upcoming" | "Past" {
  const today = new Date().toISOString().slice(0, 10);
  if (today < startDate) return "Upcoming";
  if (today > endDate) return "Past";
  return "Active";
}

function cycleListCommand(): Command {
  return new Command("list")
    .description("List cycles (newest first)")
    .option("--json", "Output full rows as JSON array")
    .action(async (_options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) =>
        tableExists(config.doltRepoPath, "cycle").andThen((exists) => {
          if (!exists) {
            return errAsync(
              buildError(
                ErrorCode.DB_QUERY_FAILED,
                "Cycle table does not exist. Run tg init (or ensure migrations have run) so the cycle table is created.",
              ),
            );
          }
          const q = query(config.doltRepoPath);
          return q.raw<CycleRow>(
            "SELECT cycle_id, name, start_date, end_date FROM `cycle` ORDER BY start_date DESC",
          );
        }),
      );

      result.match(
        (rows) => {
          if (rootOpts(cmd).json) {
            console.log(JSON.stringify(rows, null, 2));
            return;
          }
          const w = getTerminalWidth();
          const innerW = getBoxInnerWidth(w);
          const tableRows = rows.map((r) => [
            r.cycle_id.slice(0, 8),
            r.name,
            r.start_date,
            r.end_date,
            cycleStatus(r.start_date, r.end_date),
          ]);
          const table = renderTable({
            headers: ["Id", "Name", "Start", "End", "Status"],
            rows:
              tableRows.length > 0
                ? tableRows
                : [["—", "No cycles", "—", "—", "—"]],
            maxWidth: innerW,
            minWidths: [8, 10, 10, 10, 8],
          });
          console.log(`\n${boxedSection("Cycles", table, w)}\n`);
        },
        (error: AppError) => {
          console.error(`Error listing cycles: ${error.message}`);
          if (rootOpts(cmd).json) {
            console.log(
              JSON.stringify({
                status: "error",
                code: error.code,
                message: error.message,
                cause: error.cause,
              }),
            );
          }
          process.exit(1);
        },
      );
    });
}
