import { Command } from "commander";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { sqlEscape } from "../db/escape";
import { tableExists } from "../db/migrate";
import { now, query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { renderTable } from "./table";
import { getTerminalWidth } from "./terminal";
import { boxedSection, getBoxInnerWidth } from "./tui/boxen";
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

const UNASSIGNED_INITIATIVE_ID = "00000000-0000-4000-8000-000000000000";

/** plan_id -> initiative title for backfill. Exact match first; keyword fallback for the rest. */
const BACKFILL_PLAN_TO_THEME: Record<string, string> = {
  "cc0a0604-2cbe-47e0-9881-19d7045a7e91": "Core Foundation",
  "9e440a8a-ac9a-4212-9b1c-c7c79ad37861": "Core Foundation",
  "edc50e28-d1c0-46af-b2da-0c156f404716": "Core Foundation",
  "c41e7989-b00e-4427-bd72-b292ebb21b8f": "Core Foundation",
  "30bceb27-2a13-4b2d-a7c9-689fc38ddf32": "Core Foundation",
  "74847034-f13c-41b6-8ea7-091da031d096": "Core Foundation",
  "ec60f9fd-8afc-488b-8a0e-95187e153a37": "Core Foundation",
  "605d6d06-a82f-4d90-82c1-72862f057f33": "Core Foundation",
  "fdd78a98-becc-420f-81d3-2441cf58bdd4": "Core Foundation",
  "bed9394d-85eb-4439-a933-9f715af4235f": "Core Foundation",
  "45ed6826-a4e3-48f1-af62-d0ee46a941a2": "Core Foundation",
  "f377f032-10b8-4612-9167-a66f961ffa9a": "Core Foundation",
  "fb02d9f1-2143-402d-b16a-e578b7d96d85": "Core Foundation",
  "3137e4f4-230b-4f51-b38d-a225dd616309": "Planning and Import",
  "87ab79b2-1035-4cb0-8062-45e8d8ec6e69": "Planning and Import",
  "fa65b577-b7dc-47e8-ba2c-7edc857b0724": "Planning and Import",
  "a7cdac0c-43ab-4917-b8af-7a3113305957": "Planning and Import",
  "05f4e74c-40b7-41a7-aab1-d8c4b127a526": "Planning and Import",
  "1aaf6f67-e72d-490a-9d2f-237451f8a2b0": "Planning and Import",
  "d3314a8d-7078-4d22-841f-6b5cf421a48a": "Planning and Import",
  "7f7a063a-4e4a-404e-85ec-9abc40677873": "Planning and Import",
  "3cf8e2e2-7cbc-4d07-95a0-bf4871e780bf": "Planning and Import",
  "6dbadd46-a0a6-4033-897d-e259cecb8af1": "Planning and Import",
  "f28e4d6a-e919-4d07-b894-d37ed67d4c32": "Planning and Import",
  "2e445031-90bb-4595-aa90-6f467a5e2248": "Agent Workflow",
  "88d81073-8d0a-4f29-a2c5-9799333ddd1b": "Agent Workflow",
  "26b5fdf4-8f6f-40e1-833c-638206315d3f": "Agent Workflow",
  "0433a59c-ae6a-4ec5-9bbe-95cdaff5f662": "Agent Workflow",
  "c0ba7aa3-6ba2-40c0-9f33-a17d1ba7e647": "Agent Workflow",
  "f99cbb4b-ba78-48ae-bd63-993845f138fd": "Agent Workflow",
  "051d9cb7-91b4-4573-9f7a-1e78b5c06085": "Agent Workflow",
  "de1f4893-7a91-4dc9-b1da-a69021334ae7": "Agent Workflow",
  "194506b8-1a9a-4c9b-8968-9b0df86af292": "Agent Workflow",
  "afee9764-730e-4b4b-a6a3-15c3ab50d1e9": "Agent Workflow",
  "541818b6-4999-4b51-99de-c29fb6b912ee": "Agent Workflow",
  "78881d03-d45f-43d5-9ed3-bec72a906b84": "Agent Workflow",
  "35a97ede-ddc6-4193-a1b3-d96d95e9f6b6": "Agent Workflow",
  "febb3e44-43f7-4b50-b2af-d4b827643332": "Status and CLI",
  "04a7b378-6616-4e03-a536-622902a4f90d": "Status and CLI",
  "035c91ce-44e7-4647-908a-92138e073cdf": "Status and CLI",
  "077578ba-6dcf-42c9-9166-4214a70f0e1e": "Status and CLI",
  "4f260606-17f1-43d7-9376-4fb59141c935": "Status and CLI",
  "cb9b5ea9-88e8-4737-a084-877933ee9690": "Status and CLI",
  "1aeea234-a819-4b67-831b-ce8061e4e670": "Status and CLI",
  "ad793a72-3931-4b29-b1bf-aa6d72edbf70": "Status and CLI",
  "0aa75f28-6f0a-413c-80f5-4602c0ad2cf2": "Status and CLI",
  "26a0c3a1-2445-412b-9b7f-b62fd0b7435e": "Status and CLI",
  "02d720b2-5273-49f5-bdd8-c55dc459e79a": "Platform and DX",
  "1bb54c3f-c0b2-48e5-a375-55015450dbc1": "Platform and DX",
  "16e51429-cb51-4fe0-864e-da7ee249cecf": "Platform and DX",
  "f1d4114b-b459-4c19-ac44-4bb859d186e7": "Platform and DX",
  "a945775e-e947-412b-acc3-76c4a7bbc6e4": "Platform and DX",
  "e3cd8e2a-c286-4857-9f65-f1607c3a9000": "Platform and DX",
  "5555005d-80fd-4239-bee4-e52012f0864c": "Platform and DX",
  "4b08965d-b17a-4be7-8806-025147b0d83d": "Platform and DX",
  "33aef644-4376-464a-9653-7e2ec8650eca": "Platform and DX",
  "7e2fa7f1-8199-4448-91e9-564c44abe5e7": "Platform and DX",
  "386dfde0-c8dd-45bf-91ea-1cec70a40df7": "Platform and DX",
  "323d15fd-5cf4-4921-9bae-3e89a229fe89": "Platform and DX",
  "9c4e5030-e0b4-4bdb-bd45-59efff7b8b46": "Platform and DX",
};

const BACKFILL_THEMES = [
  "Core Foundation",
  "Planning and Import",
  "Agent Workflow",
  "Status and CLI",
  "Platform and DX",
] as const;

function keywordToTheme(title: string): string {
  const t = title.toLowerCase();
  if (/status|dashboard|tui|cli|batch/.test(t)) return "Status and CLI";
  if (/agent|review|dispatch|orchestrat|skill/.test(t)) return "Agent Workflow";
  if (/plan|import|template|dimension/.test(t)) return "Planning and Import";
  if (/dolt|schema|migration|fix|type|test/.test(t)) return "Core Foundation";
  return "Platform and DX";
}

export function initiativeCommand(program: Command) {
  program
    .command("initiative")
    .description("Manage initiatives (strategic containers for projects)")
    .addCommand(initiativeNewCommand())
    .addCommand(initiativeListCommand())
    .addCommand(initiativeAssignProjectCommand())
    .addCommand(initiativeBackfillCommand());
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
    .option(
      "--cycle <cycleId>",
      "Link to a strategic cycle (sets cycle_id and derives cycle_start/cycle_end)",
    )
    .option(
      "--cycle-start <date>",
      "Cycle start date (YYYY-MM-DD); overrides value from --cycle",
    )
    .option(
      "--cycle-end <date>",
      "Cycle end date (YYYY-MM-DD); overrides value from --cycle",
    )
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
            const q = query(config.doltRepoPath);
            type CycleRow = {
              cycle_id: string;
              start_date: string;
              end_date: string;
            };
            const loadCycle = () => {
              if (!options.cycle) return okAsync<CycleRow[]>([]);
              return tableExists(config.doltRepoPath, "cycle").andThen(
                (cycleExists) => {
                  if (!cycleExists) {
                    return errAsync(
                      buildError(
                        ErrorCode.DB_QUERY_FAILED,
                        "Cycle table does not exist. Run tg init so the cycle table is created.",
                      ),
                    );
                  }
                  return q
                    .raw<CycleRow>(
                      `SELECT cycle_id, start_date, end_date FROM \`cycle\` WHERE cycle_id = '${sqlEscape(options.cycle)}' LIMIT 1`,
                    )
                    .andThen((rows) => {
                      if (rows.length === 0) {
                        return errAsync(
                          buildError(
                            ErrorCode.VALIDATION_FAILED,
                            `Cycle not found: ${options.cycle}. Run \`tg cycle list\` to see existing cycles.`,
                          ),
                        );
                      }
                      return okAsync(rows);
                    });
                },
              );
            };
            const toDateStr = (
              d: string | Date | null | undefined,
            ): string | null =>
              d == null
                ? null
                : typeof d === "string"
                  ? d.slice(0, 10)
                  : new Date(d).toISOString().slice(0, 10);
            return loadCycle().andThen((cycleRows) => {
              const cycleRow = cycleRows.length > 0 ? cycleRows[0] : null;
              const cycleStart =
                parseDate(options.cycleStart) ??
                toDateStr(cycleRow?.start_date ?? null);
              const cycleEnd =
                parseDate(options.cycleEnd) ??
                toDateStr(cycleRow?.end_date ?? null);
              const initiative_id = uuidv4();
              const currentTimestamp = now();
              const insertPayload: Record<string, string | null> = {
                initiative_id,
                title,
                description: options.description ?? "",
                status,
                cycle_start: cycleStart,
                cycle_end: cycleEnd,
                created_at: currentTimestamp,
                updated_at: currentTimestamp,
              };
              return q
                .raw<{ "1": number }>(
                  "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'initiative' AND COLUMN_NAME = 'cycle_id' LIMIT 1",
                )
                .andThen((colRows) => {
                  if (colRows.length > 0 && options.cycle && cycleRow) {
                    insertPayload.cycle_id = options.cycle;
                  }
                  return q
                    .insert("initiative", insertPayload)
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
                      ...(options.cycle && cycleRow
                        ? { cycle_id: options.cycle }
                        : {}),
                    }));
                });
            });
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

interface InitiativeListRow {
  initiative_id: string;
  title: string;
  status: string;
  cycle_start: string | null;
  cycle_end: string | null;
  cycle_id?: string | null;
  cycle_name?: string | null;
  created_at: string;
}

function formatCycleColumn(row: InitiativeListRow): string {
  if (row.cycle_name) return row.cycle_name;
  if (row.cycle_start && row.cycle_end)
    return `${row.cycle_start} – ${row.cycle_end}`;
  return "—";
}

function initiativeListCommand(): Command {
  return new Command("list")
    .description("List initiatives (newest first)")
    .option("--json", "Output full rows as JSON array")
    .action(async (_options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) =>
        tableExists(config.doltRepoPath, "initiative").andThen((exists) => {
          if (!exists) {
            return errAsync(
              buildError(
                ErrorCode.DB_QUERY_FAILED,
                "Initiative table does not exist. Run tg init (or ensure migrations have run) so the initiative table is created.",
              ),
            );
          }
          const q = query(config.doltRepoPath);
          const baseSql =
            "SELECT initiative_id, title, status, cycle_start, cycle_end, created_at FROM `initiative` ORDER BY created_at DESC";
          const withCycleSql = `SELECT i.initiative_id, i.title, i.status, i.cycle_start, i.cycle_end, i.cycle_id, c.name AS cycle_name, i.created_at FROM \`initiative\` i LEFT JOIN \`cycle\` c ON i.cycle_id = c.cycle_id ORDER BY i.created_at DESC`;
          return tableExists(config.doltRepoPath, "cycle").andThen(
            (cycleExists) => {
              if (!cycleExists) return q.raw<InitiativeListRow>(baseSql);
              return q
                .raw<{ "1": number }>(
                  "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'initiative' AND COLUMN_NAME = 'cycle_id' LIMIT 1",
                )
                .andThen((colRows) =>
                  colRows.length > 0
                    ? q.raw<InitiativeListRow>(withCycleSql)
                    : q.raw<InitiativeListRow>(baseSql),
                );
            },
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
            r.initiative_id.slice(0, 8),
            r.title,
            r.status,
            formatCycleColumn(r),
          ]);
          const table = renderTable({
            headers: ["Id", "Title", "Status", "Cycle"],
            rows:
              tableRows.length > 0
                ? tableRows
                : [["—", "No initiatives", "—", "—"]],
            maxWidth: innerW,
            minWidths: [8, 10, 8, 10],
          });
          console.log(`\n${boxedSection("Initiatives", table, w)}\n`);
        },
        (error: AppError) => {
          console.error(`Error listing initiatives: ${error.message}`);
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

function initiativeAssignProjectCommand(): Command {
  return new Command("assign-project")
    .description("Assign a project (plan) to an initiative")
    .argument("<initiativeId>", "Initiative ID")
    .argument("<planId>", "Plan (project) ID")
    .option("--json", "Output { ok, planId, initiativeId }")
    .action(async (initiativeId, planId, _options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        const q = query(config.doltRepoPath);
        return tableExists(config.doltRepoPath, "initiative")
          .andThen((initExists) => {
            if (!initExists) {
              return errAsync(
                buildError(
                  ErrorCode.DB_QUERY_FAILED,
                  "Initiative table does not exist. Run tg init (or ensure migrations have run) so the initiative table is created.",
                ),
              );
            }
            return q
              .raw<{ initiative_id: string; title: string }>(
                `SELECT initiative_id, title FROM \`initiative\` WHERE initiative_id = '${sqlEscape(initiativeId)}' LIMIT 1`,
              )
              .andThen((rows) => {
                if (rows.length === 0) {
                  return errAsync(
                    buildError(
                      ErrorCode.VALIDATION_FAILED,
                      `Initiative not found: ${initiativeId}. Run \`tg initiative list\` to see existing initiatives.`,
                    ),
                  );
                }
                return okAsync(rows[0]);
              });
          })
          .andThen((initiative) =>
            q
              .raw<{ plan_id: string }>(
                `SELECT plan_id FROM \`project\` WHERE plan_id = '${sqlEscape(planId)}' LIMIT 1`,
              )
              .andThen((planRows) => {
                if (planRows.length === 0) {
                  return errAsync(
                    buildError(
                      ErrorCode.VALIDATION_FAILED,
                      `Project (plan) not found: ${planId}. Run \`tg plan list\` to see existing plans.`,
                    ),
                  );
                }
                return okAsync(initiative);
              }),
          )
          .andThen((initiative) =>
            q
              .update(
                "project",
                { initiative_id: initiativeId, updated_at: now() },
                { plan_id: planId },
              )
              .andThen(() =>
                doltCommit(
                  `initiative: assign project ${planId} to initiative ${initiativeId}`,
                  config.doltRepoPath,
                  rootOpts(cmd).noCommit,
                ),
              )
              .map(() => ({ initiative, planId, initiativeId })),
          );
      });

      result.match(
        (data) => {
          if (rootOpts(cmd).json) {
            console.log(
              JSON.stringify({
                ok: true,
                planId: data.planId,
                initiativeId: data.initiativeId,
              }),
            );
          } else {
            console.log(
              `Project ${data.planId} assigned to initiative '${data.initiative.title}' (${data.initiativeId})`,
            );
          }
        },
        (error: AppError) => {
          console.error(`Error assigning project: ${error.message}`);
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

function initiativeBackfillCommand(): Command {
  return new Command("backfill")
    .description(
      "Create 5 themed initiatives for a cycle and assign all projects (idempotent: skips if initiatives already exist)",
    )
    .requiredOption("--cycle <cycleId>", "Cycle ID to link initiatives to")
    .option("--dry-run", "Print what would happen without writing to DB")
    .option("--json", "Output array of { initiative, assignedCount }")
    .action(async (options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        const q = query(config.doltRepoPath);
        return tableExists(config.doltRepoPath, "initiative")
          .andThen((initExists) => {
            if (!initExists) {
              return errAsync(
                buildError(
                  ErrorCode.DB_QUERY_FAILED,
                  "Initiative table does not exist. Run tg init.",
                ),
              );
            }
            return tableExists(config.doltRepoPath, "cycle").andThen(
              (cycleExists) => {
                if (!cycleExists) {
                  return errAsync(
                    buildError(
                      ErrorCode.DB_QUERY_FAILED,
                      "Cycle table does not exist. Run tg init, then tg cycle new.",
                    ),
                  );
                }
                return q
                  .raw<{ count: number }>(
                    `SELECT COUNT(*) AS count FROM \`initiative\` WHERE initiative_id != '${UNASSIGNED_INITIATIVE_ID}' AND title != 'Unassigned'`,
                  )
                  .andThen((rows) => {
                    const realCount = Number(rows[0]?.count ?? 0);
                    if (realCount > 0) {
                      return errAsync(
                        buildError(
                          ErrorCode.VALIDATION_FAILED,
                          "Real initiatives already exist. Backfill only runs when no initiatives (other than Unassigned) exist. Skip.",
                        ),
                      );
                    }
                    return okAsync(undefined);
                  });
              },
            );
          })
          .andThen(() =>
            q
              .raw<{ cycle_id: string }>(
                `SELECT cycle_id FROM \`cycle\` WHERE cycle_id = '${sqlEscape(options.cycle)}' LIMIT 1`,
              )
              .andThen((rows) => {
                if (rows.length === 0) {
                  return errAsync(
                    buildError(
                      ErrorCode.VALIDATION_FAILED,
                      `Cycle not found: ${options.cycle}. Run \`tg cycle list\`.`,
                    ),
                  );
                }
                return okAsync(options.cycle as string);
              }),
          )
          .andThen((cycleId) => {
            if (options.dryRun) {
              return okAsync({
                dryRun: true,
                cycleId,
                wouldCreate: BACKFILL_THEMES.length,
                message: "Would create 5 initiatives and assign projects.",
              });
            }
            type CycleRow = { start_date: string; end_date: string };
            return q
              .raw<CycleRow>(
                `SELECT start_date, end_date FROM \`cycle\` WHERE cycle_id = '${sqlEscape(cycleId)}' LIMIT 1`,
              )
              .andThen((cycleRows) => {
                const cycle = cycleRows[0];
                if (!cycle)
                  return errAsync(
                    buildError(
                      ErrorCode.DB_QUERY_FAILED,
                      "Cycle row not found",
                    ),
                  );
                const toDateStr = (d: string | Date): string =>
                  typeof d === "string"
                    ? d.slice(0, 10)
                    : new Date(d).toISOString().slice(0, 10);
                const startStr = toDateStr(cycle.start_date);
                const endStr = toDateStr(cycle.end_date);
                const initiativeIds: string[] = [];
                let chain: ResultAsync<void, AppError> = okAsync(undefined);
                for (const title of BACKFILL_THEMES) {
                  const id = uuidv4();
                  initiativeIds.push(id);
                  const payload: Record<string, string> = {
                    initiative_id: id,
                    title,
                    description: "",
                    status: "active",
                    cycle_start: startStr,
                    cycle_end: endStr,
                    created_at: now(),
                    updated_at: now(),
                  };
                  if (options.cycle) payload.cycle_id = cycleId;
                  chain = chain.andThen(() =>
                    q.insert("initiative", payload).map(() => undefined),
                  );
                }
                return chain.andThen(() =>
                  q
                    .raw<{ plan_id: string; title: string }>(
                      `SELECT plan_id, title FROM \`project\``,
                    )
                    .andThen((projects) => {
                      const themeToId = new Map<string, string>();
                      for (let i = 0; i < BACKFILL_THEMES.length; i++)
                        themeToId.set(BACKFILL_THEMES[i], initiativeIds[i]);
                      const planIdsByTheme = new Map<string, string[]>();
                      for (const t of BACKFILL_THEMES)
                        planIdsByTheme.set(t, []);
                      for (const p of projects) {
                        const theme =
                          BACKFILL_PLAN_TO_THEME[p.plan_id] ??
                          keywordToTheme(p.title);
                        const list = planIdsByTheme.get(theme);
                        if (list) list.push(p.plan_id);
                      }
                      let updateChain: ResultAsync<void, AppError> =
                        okAsync(undefined);
                      const assigned: Array<{
                        initiative: string;
                        count: number;
                      }> = [];
                      for (const theme of BACKFILL_THEMES) {
                        const ids = planIdsByTheme.get(theme) ?? [];
                        assigned.push({ initiative: theme, count: ids.length });
                        const initId = themeToId.get(theme);
                        if (initId === undefined) continue;
                        if (ids.length > 0) {
                          const inList = ids
                            .map((id) => `'${sqlEscape(id)}'`)
                            .join(",");
                          updateChain = updateChain.andThen(() =>
                            q
                              .raw(
                                `UPDATE \`project\` SET initiative_id = '${sqlEscape(initId)}', updated_at = '${sqlEscape(now())}' WHERE plan_id IN (${inList})`,
                              )
                              .map(() => undefined),
                          );
                        }
                      }
                      return updateChain.andThen(() =>
                        doltCommit(
                          "initiative: backfill 5 initiatives and assign projects",
                          config.doltRepoPath,
                          rootOpts(cmd).noCommit,
                        ).map(() => ({ assigned })),
                      );
                    }),
                );
              });
          });
      });

      result.match(
        (data) => {
          if (data && typeof data === "object" && "dryRun" in data) {
            if (rootOpts(cmd).json) {
              console.log(JSON.stringify(data));
            } else {
              console.log((data as { message: string }).message);
            }
            return;
          }
          const out = data as {
            assigned: Array<{ initiative: string; count: number }>;
          };
          if (rootOpts(cmd).json) {
            console.log(
              JSON.stringify(
                out.assigned.map((a) => ({
                  initiative: a.initiative,
                  assignedCount: a.count,
                })),
              ),
            );
          } else {
            for (const a of out.assigned) {
              console.log(
                `Created initiative: ${a.initiative} (assigned ${a.count} projects)`,
              );
            }
            console.log(
              "Backfill complete. Run `tg status --initiatives` to review.",
            );
          }
        },
        (error: AppError) => {
          if (error.message.includes("already exist")) {
            console.warn("Warning:", error.message);
            process.exit(0);
          }
          console.error(`Error: ${error.message}`);
          if (rootOpts(cmd).json) {
            console.log(
              JSON.stringify({
                status: "error",
                code: error.code,
                message: error.message,
              }),
            );
          }
          process.exit(1);
        },
      );
    });
}
