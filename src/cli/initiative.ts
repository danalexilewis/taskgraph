import { Command } from "commander";
import { errAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { tableExists } from "../db/migrate";
import { now, query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { type Config, readConfig, rootOpts } from "./utils";

const STATUS_VALUES = [
  "draft",
  "active",
  "paused",
  "done",
  "abandoned",
] as const;

function parseDate(s: string | undefined): string | null {
  if (s == null || s === "") return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function initiativeCommand(program: Command) {
  program
    .command("initiative")
    .description("Manage initiatives (strategic containers for projects)")
    .addCommand(initiativeNewCommand());
}

function initiativeNewCommand(): Command {
  return new Command("new")
    .description("Create a new initiative")
    .argument("<title>", "Title of the initiative")
    .option("--description <text>", "Description of the initiative", "")
    .option(
      "--status <status>",
      `Status: one of ${STATUS_VALUES.join(", ")}`,
      "draft",
    )
    .option("--cycle-start <date>", "Cycle start date (YYYY-MM-DD)")
    .option("--cycle-end <date>", "Cycle end date (YYYY-MM-DD)")
    .action(async (title, options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        const rawStatus = String(options.status ?? "draft").toLowerCase();
        if (!(STATUS_VALUES as readonly string[]).includes(rawStatus)) {
          return errAsync(
            buildError(
              ErrorCode.VALIDATION_FAILED,
              `Invalid status "${options.status}". Must be one of: ${STATUS_VALUES.join(", ")}`,
            ),
          );
        }
        const status = rawStatus as (typeof STATUS_VALUES)[number];
        const cycleStart = parseDate(options.cycleStart);
        const cycleEnd = parseDate(options.cycleEnd);
        return tableExists(config.doltRepoPath, "initiative").andThen(
          (exists) => {
            if (!exists) {
              return errAsync(
                buildError(
                  ErrorCode.DB_QUERY_FAILED,
                  "Initiative table does not exist. Run tg init (or ensure migrations have run) so the initiative table is created.",
                ),
              );
            }
            const initiative_id = uuidv4();
            const currentTimestamp = now();
            const q = query(config.doltRepoPath);
            return q
              .insert("initiative", {
                initiative_id,
                title,
                description: options.description ?? "",
                status,
                cycle_start: cycleStart,
                cycle_end: cycleEnd,
                created_at: currentTimestamp,
                updated_at: currentTimestamp,
              })
              .andThen(() =>
                doltCommit(
                  `initiative: create ${initiative_id} - ${title}`,
                  config.doltRepoPath,
                  rootOpts(cmd).noCommit,
                ),
              )
              .map(() => ({
                initiative_id,
                title,
                description: options.description ?? "",
                status,
                cycle_start: cycleStart,
                cycle_end: cycleEnd,
              }));
          },
        );
      });

      result.match(
        (data) => {
          if (!rootOpts(cmd).json) {
            console.log(`Initiative created: ${data.initiative_id}`);
            console.log(`  Title: ${data.title}`);
            if (data.description)
              console.log(`  Description: ${data.description}`);
            console.log(`  Status: ${data.status}`);
            if (data.cycle_start)
              console.log(`  Cycle start: ${data.cycle_start}`);
            if (data.cycle_end) console.log(`  Cycle end: ${data.cycle_end}`);
            console.log("View with: pnpm tg status --initiatives");
          } else {
            console.log(JSON.stringify(data, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error creating initiative: ${error.message}`);
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
