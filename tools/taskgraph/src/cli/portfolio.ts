import { Command } from "commander";
import { readConfig, Config } from "./utils"; // Import Config
import { ResultAsync, ok, err, errAsync } from "neverthrow";
import { AppError, buildError, ErrorCode } from "../domain/errors";
import { query } from "../db/query";

export function portfolioCommand(program: Command) {
  program
    .command("portfolio")
    .description("Analyze portfolio views")
    .addCommand(portfolioOverlapsCommand())
    .addCommand(portfolioHotspotsCommand());
}

interface OverlapResult {
  task_id: string;
  title: string;
  feature_key: string;
  related_features: string;
  feature_count: number;
}

interface HotspotResult {
  area: string;
  task_count: number;
  features_in_area: string;
  feature_key_count: number;
}

function portfolioOverlapsCommand(): Command {
  return new Command("overlaps")
    .description("Find tasks shared by multiple feature_key")
    .option("--min <count>", "Minimum number of features for overlap", "2")
    .action(async (options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        const q = query(config.doltRepoPath);
        const minFeatures = parseInt(options.min, 10);
        if (isNaN(minFeatures) || minFeatures <= 0) {
          return errAsync(
            buildError(
              ErrorCode.VALIDATION_FAILED,
              `Invalid min count: ${options.min}. Must be a positive integer.`,
            ),
          );
        }

        const relatesOverlapsQuery = `
          SELECT
            t1.task_id, t1.title, t1.feature_key,
            GROUP_CONCAT(DISTINCT t2.feature_key ORDER BY t2.feature_key) as related_features,
            COUNT(DISTINCT t2.feature_key) as feature_count
          FROM \`task\` t1
          JOIN \`edge\` e ON t1.task_id = e.from_task_id AND e.type = 'relates'
          JOIN \`task\` t2 ON e.to_task_id = t2.task_id
          WHERE t1.feature_key IS NOT NULL AND t2.feature_key IS NOT NULL AND t1.feature_key != t2.feature_key
          GROUP BY t1.task_id, t1.title, t1.feature_key
          HAVING feature_count >= ${minFeatures} -1;
        `;

        const areaHotspotQuery = `
          SELECT
            area,
            COUNT(DISTINCT task_id) as task_count,
            GROUP_CONCAT(DISTINCT feature_key ORDER BY feature_key) as features_in_area,
            COUNT(DISTINCT feature_key) as feature_key_count
          FROM \`task\`
          WHERE area IS NOT NULL
          GROUP BY area
          HAVING feature_key_count >= ${minFeatures};
        `;

        return q.raw<OverlapResult[]>(relatesOverlapsQuery).andThen(
          (relatesOverlapsResult) => {
            const relatesOverlaps = relatesOverlapsResult;
            return q.raw<HotspotResult[]>(areaHotspotQuery).map(
              (areaHotspotsResult) => {
                const areaHotspots = areaHotspotsResult;
                return { relatesOverlaps, areaHotspots };
              },
            );
          },
        );
      });

      result.match(
        (data: unknown) => {
          const resultData = data as {
            relatesOverlaps: OverlapResult[];
            areaHotspots: HotspotResult[];
          };
          if (!cmd.parent?.opts().json) {
            if (resultData.relatesOverlaps.length > 0) {
              console.log(
                `\nTasks with explicit 'relates' overlaps (min ${options.min} features):`,
              );
              resultData.relatesOverlaps.forEach((overlap) => {
                console.log(
                  `  - Task ID: ${overlap.task_id}, Title: ${overlap.title}, Features: ${overlap.feature_key}, ${overlap.related_features}`,
                );
              });
            }

            if (resultData.areaHotspots.length > 0) {
              console.log(
                `\nAreas with tasks from multiple features (min ${options.min} features):`,
              );
              resultData.areaHotspots.forEach((hotspot) => {
                console.log(
                  `  - Area: ${hotspot.area}, Tasks: ${hotspot.task_count}, Features: ${hotspot.features_in_area}`,
                );
              });
            }

            if (
              resultData.relatesOverlaps.length === 0 &&
              resultData.areaHotspots.length === 0
            ) {
              console.log("No overlaps found based on current criteria.");
            }
          } else {
            console.log(JSON.stringify(resultData, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error fetching portfolio overlaps: ${error.message}`);
          if (cmd.parent?.opts().json) {
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

interface TasksPerAreaResult {
  area: string;
  task_count: number;
}

interface MultiFeatureTaskResult {
  task_id: string;
  title: string;
  features: string;
}

function portfolioHotspotsCommand(): Command {
  return new Command("hotspots")
    .description(
      "Counts tasks per area, plus tasks touched by multiple features",
    )
    .action(async (options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        const q = query(config.doltRepoPath);
        const tasksPerAreaQuery = `
          SELECT area, COUNT(*) as task_count
          FROM \`task\`
          WHERE area IS NOT NULL
          GROUP BY area
          ORDER BY task_count DESC;
        `;
        const multiFeatureTasksQuery = `
          SELECT task_id, title, GROUP_CONCAT(DISTINCT feature_key) as features
          FROM \`task\`
          WHERE feature_key IS NOT NULL
          GROUP BY task_id, title
          HAVING COUNT(DISTINCT feature_key) > 1;
        `;

        return q.raw<TasksPerAreaResult[]>(tasksPerAreaQuery).andThen(
          (tasksPerAreaResult) => {
            const tasksPerArea = tasksPerAreaResult;
            return q.raw<MultiFeatureTaskResult[]>(multiFeatureTasksQuery).map(
              (multiFeatureTasksResult) => {
                const multiFeatureTasks =
                  multiFeatureTasksResult;
                return { tasksPerArea, multiFeatureTasks };
              },
            );
          },
        );
      });

      result.match(
        (data: unknown) => {
          const resultData = data as {
            tasksPerArea: TasksPerAreaResult[];
            multiFeatureTasks: MultiFeatureTaskResult[];
          };
          if (!cmd.parent?.opts().json) {
            if (resultData.tasksPerArea.length > 0) {
              console.log("\nTasks per Area:");
              resultData.tasksPerArea.forEach((item) => {
                console.log(
                  `  - Area: ${item.area}, Tasks: ${item.task_count}`,
                );
              });
            }

            if (resultData.multiFeatureTasks.length > 0) {
              console.log("\nTasks touched by multiple features:");
              resultData.multiFeatureTasks.forEach((item) => {
                console.log(
                  `  - Task ID: ${item.task_id}, Title: ${item.title}, Features: ${item.features}`,
                );
              });
            }

            if (
              resultData.tasksPerArea.length === 0 &&
              resultData.multiFeatureTasks.length === 0
            ) {
              console.log("No hotspots found.");
            }
          } else {
            console.log(JSON.stringify(resultData, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error fetching portfolio hotspots: ${error.message}`);
          if (cmd.parent?.opts().json) {
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
