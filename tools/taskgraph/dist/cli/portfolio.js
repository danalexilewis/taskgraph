"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.portfolioCommand = portfolioCommand;
const commander_1 = require("commander");
const connection_1 = require("../db/connection");
const utils_1 = require("./utils"); // Import Config
const neverthrow_1 = require("neverthrow");
const errors_1 = require("../domain/errors");
function portfolioCommand(program) {
    program
        .command("portfolio")
        .description("Analyze portfolio views")
        .addCommand(portfolioOverlapsCommand())
        .addCommand(portfolioHotspotsCommand());
}
function portfolioOverlapsCommand() {
    return new commander_1.Command("overlaps")
        .description("Find tasks shared by multiple feature_key")
        .option("--min <count>", "Minimum number of features for overlap", "2")
        .action(async (options, cmd) => {
        const result = await (0, utils_1.readConfig)().asyncAndThen((config) => {
            // Removed async, added type
            const minFeatures = parseInt(options.min, 10);
            if (isNaN(minFeatures) || minFeatures <= 0) {
                return (0, neverthrow_1.errAsync)((0, errors_1.buildError)(errors_1.ErrorCode.VALIDATION_FAILED, `Invalid min count: ${options.min}. Must be a positive integer.`));
            }
            const relatesOverlapsQuery = `
          SELECT
            t1.task_id, t1.title, t1.feature_key,
            GROUP_CONCAT(DISTINCT t2.feature_key ORDER BY t2.feature_key) as related_features,
            COUNT(DISTINCT t2.feature_key) as feature_count
          FROM task t1
          JOIN edge e ON t1.task_id = e.from_task_id AND e.type = 'relates'
          JOIN task t2 ON e.to_task_id = t2.task_id
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
          FROM task
          WHERE area IS NOT NULL
          GROUP BY area
          HAVING feature_key_count >= ${minFeatures};
        `;
            return (0, connection_1.doltSql)(relatesOverlapsQuery, config.doltRepoPath).andThen((relatesOverlapsResult) => {
                const relatesOverlaps = relatesOverlapsResult;
                return (0, connection_1.doltSql)(areaHotspotQuery, config.doltRepoPath).map((areaHotspotsResult) => {
                    const areaHotspots = areaHotspotsResult;
                    return { relatesOverlaps, areaHotspots };
                });
            });
        });
        result.match((data) => {
            const resultData = data;
            if (!cmd.parent?.opts().json) {
                if (resultData.relatesOverlaps.length > 0) {
                    console.log(`\nTasks with explicit 'relates' overlaps (min ${options.min} features):`);
                    resultData.relatesOverlaps.forEach((overlap) => {
                        console.log(`  - Task ID: ${overlap.task_id}, Title: ${overlap.title}, Features: ${overlap.feature_key}, ${overlap.related_features}`);
                    });
                }
                if (resultData.areaHotspots.length > 0) {
                    console.log(`\nAreas with tasks from multiple features (min ${options.min} features):`);
                    resultData.areaHotspots.forEach((hotspot) => {
                        console.log(`  - Area: ${hotspot.area}, Tasks: ${hotspot.task_count}, Features: ${hotspot.features_in_area}`);
                    });
                }
                if (resultData.relatesOverlaps.length === 0 &&
                    resultData.areaHotspots.length === 0) {
                    console.log("No overlaps found based on current criteria.");
                }
            }
            else {
                console.log(JSON.stringify(resultData, null, 2));
            }
        }, (error) => {
            console.error(`Error fetching portfolio overlaps: ${error.message}`);
            if (cmd.parent?.opts().json) {
                console.log(JSON.stringify({
                    status: "error",
                    code: error.code,
                    message: error.message,
                    cause: error.cause,
                }));
            }
            process.exit(1);
        });
    });
}
function portfolioHotspotsCommand() {
    return new commander_1.Command("hotspots")
        .description("Counts tasks per area, plus tasks touched by multiple features")
        .action(async (options, cmd) => {
        const result = await (0, utils_1.readConfig)().asyncAndThen((config) => {
            // Removed async, added type
            const tasksPerAreaQuery = `
          SELECT area, COUNT(*) as task_count
          FROM task
          WHERE area IS NOT NULL
          GROUP BY area
          ORDER BY task_count DESC;
        `;
            const multiFeatureTasksQuery = `
          SELECT task_id, title, GROUP_CONCAT(DISTINCT feature_key) as features
          FROM task
          WHERE feature_key IS NOT NULL
          GROUP BY task_id, title
          HAVING COUNT(DISTINCT feature_key) > 1;
        `;
            return (0, connection_1.doltSql)(tasksPerAreaQuery, config.doltRepoPath).andThen((tasksPerAreaResult) => {
                const tasksPerArea = tasksPerAreaResult;
                return (0, connection_1.doltSql)(multiFeatureTasksQuery, config.doltRepoPath).map((multiFeatureTasksResult) => {
                    const multiFeatureTasks = multiFeatureTasksResult;
                    return { tasksPerArea, multiFeatureTasks };
                });
            });
        });
        result.match((data) => {
            const resultData = data;
            if (!cmd.parent?.opts().json) {
                if (resultData.tasksPerArea.length > 0) {
                    console.log("\nTasks per Area:");
                    resultData.tasksPerArea.forEach((item) => {
                        console.log(`  - Area: ${item.area}, Tasks: ${item.task_count}`);
                    });
                }
                if (resultData.multiFeatureTasks.length > 0) {
                    console.log("\nTasks touched by multiple features:");
                    resultData.multiFeatureTasks.forEach((item) => {
                        console.log(`  - Task ID: ${item.task_id}, Title: ${item.title}, Features: ${item.features}`);
                    });
                }
                if (resultData.tasksPerArea.length === 0 &&
                    resultData.multiFeatureTasks.length === 0) {
                    console.log("No hotspots found.");
                }
            }
            else {
                console.log(JSON.stringify(resultData, null, 2));
            }
        }, (error) => {
            console.error(`Error fetching portfolio hotspots: ${error.message}`);
            if (cmd.parent?.opts().json) {
                console.log(JSON.stringify({
                    status: "error",
                    code: error.code,
                    message: error.message,
                    cause: error.cause,
                }));
            }
            process.exit(1);
        });
    });
}
