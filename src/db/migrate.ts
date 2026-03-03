import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join as pathJoin } from "node:path";
import execa from "execa";
import { ok, ResultAsync } from "neverthrow";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { generateUniqueHashId } from "../domain/hash-id";
import { QueryCache } from "./cache";
import { doltCommit } from "./commit";
import { doltSql } from "./connection";
import { sqlEscape } from "./escape";

const CACHE_TTL_MS = 60_000;

/**
 * Ordered list of migration function names. SHA1 of this list is the
 * MIGRATION_VERSION written to .tg-migration-version after a full run.
 * Adding any migration here (or reordering) increments the version and
 * forces a fresh probe on the next `tg` invocation.
 */
export const MIGRATION_CHAIN = [
  "applyPlanRichFieldsMigration",
  "applyTaskDimensionsMigration",
  "applyTaskSuggestedChangesMigration",
  "applyTaskDomainSkillJunctionMigration",
  "applyDomainToDocRenameMigration",
  "applyTaskAgentMigration",
  "applyHashIdMigration",
  "applyNoDeleteTriggersMigration",
  "applyGateTableMigration",
  "applyInitiativeMigration",
  "applyPlanToProjectRenameMigration",
  "applyPlanViewMigration",
  "applyPlanHashIdMigration",
  "applyDefaultInitiativeMigration",
  "applyCycleMigration",
  "applyInitiativeCycleIdMigration",
  "applyPlanWorktreeMigration",
  "applyIndexMigration",
  "applyEventKindIndex",
  "applyTaskFootprintMigration",
  "applyIsBenchmarkMigration",
  "applyEvolveRunQualityMigration",
  "applyLearningRecurrenceMigration",
] as const;

const MIGRATION_VERSION = createHash("sha1")
  .update(MIGRATION_CHAIN.join(","))
  .digest("hex")
  .slice(0, 8);

function getSentinelPath(repoPath: string): string {
  return pathJoin(repoPath, "..", ".tg-migration-version");
}

function readSentinel(repoPath: string): string | null {
  const p = getSentinelPath(repoPath);
  try {
    return existsSync(p) ? readFileSync(p, "utf8").trim() : null;
  } catch {
    return null;
  }
}

function writeSentinel(repoPath: string): void {
  try {
    writeFileSync(getSentinelPath(repoPath), `${MIGRATION_VERSION}\n`, "utf8");
  } catch {
    // Non-fatal: sentinel write failure just means next run re-probes.
  }
}

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS `plan` (plan_id CHAR(36) PRIMARY KEY, title VARCHAR(255) NOT NULL, intent TEXT NOT NULL, status ENUM('draft','active','paused','done','abandoned') DEFAULT 'draft', priority INT DEFAULT 0, source_path VARCHAR(512) NULL, source_commit VARCHAR(64) NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL);",
  "CREATE TABLE IF NOT EXISTS `task` (task_id CHAR(36) PRIMARY KEY, plan_id CHAR(36) NOT NULL, feature_key VARCHAR(64) NULL, title VARCHAR(255) NOT NULL, intent TEXT NULL, scope_in TEXT NULL, scope_out TEXT NULL, acceptance JSON NULL, status ENUM('todo','doing','blocked','done','canceled') DEFAULT 'todo', owner ENUM('human','agent') DEFAULT 'agent', area VARCHAR(64) NULL, risk ENUM('low','medium','high') DEFAULT 'low', estimate_mins INT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, external_key VARCHAR(128) NULL UNIQUE, FOREIGN KEY (plan_id) REFERENCES `plan`(plan_id));",
  "CREATE TABLE IF NOT EXISTS `edge` (from_task_id CHAR(36) NOT NULL, to_task_id CHAR(36) NOT NULL, type ENUM('blocks','relates') DEFAULT 'blocks', reason TEXT NULL, PRIMARY KEY (from_task_id, to_task_id, type), FOREIGN KEY (from_task_id) REFERENCES `task`(task_id), FOREIGN KEY (to_task_id) REFERENCES `task`(task_id));",
  "CREATE TABLE IF NOT EXISTS `event` (event_id CHAR(36) PRIMARY KEY, task_id CHAR(36) NOT NULL, kind ENUM('created','started','progress','blocked','unblocked','done','split','decision_needed','note') NOT NULL, body JSON NOT NULL, actor ENUM('human','agent') DEFAULT 'agent', created_at DATETIME NOT NULL, FOREIGN KEY (task_id) REFERENCES `task`(task_id));",
  "CREATE TABLE IF NOT EXISTS `decision` (decision_id CHAR(36) PRIMARY KEY, plan_id CHAR(36) NOT NULL, task_id CHAR(36) NULL, summary VARCHAR(255) NOT NULL, context TEXT NOT NULL, options JSON NULL, decision TEXT NOT NULL, consequences TEXT NULL, source_ref VARCHAR(512) NULL, created_at DATETIME NOT NULL, FOREIGN KEY (plan_id) REFERENCES `plan`(plan_id), FOREIGN KEY (task_id) REFERENCES `task`(task_id));",
];

/** Returns true if the table exists. Exported for CLI views that depend on optional tables (e.g. initiative). */
export function tableExists(
  repoPath: string,
  tableName: string,
  cache?: QueryCache,
): ResultAsync<boolean, AppError> {
  const q = `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}' LIMIT 1`;
  const key = `tableExists:${repoPath}:${tableName}`;
  if (cache) {
    const hit = cache.get<boolean>(key);
    if (hit !== undefined)
      return ResultAsync.fromSafePromise(Promise.resolve(hit));
  }
  return doltSql(q, repoPath).map((rows) => {
    const result = rows.length > 0;
    cache?.set(key, result, CACHE_TTL_MS, [tableName]);
    return result;
  });
}

/** Returns true if the column exists on the table. */
function columnExists(
  repoPath: string,
  tableName: string,
  columnName: string,
  cache?: QueryCache,
): ResultAsync<boolean, AppError> {
  const q = `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}' AND COLUMN_NAME = '${columnName}' LIMIT 1`;
  const key = `columnExists:${repoPath}:${tableName}:${columnName}`;
  if (cache) {
    const hit = cache.get<boolean>(key);
    if (hit !== undefined)
      return ResultAsync.fromSafePromise(Promise.resolve(hit));
  }
  return doltSql(q, repoPath).map((rows) => {
    const result = rows.length > 0;
    cache?.set(key, result, CACHE_TTL_MS, [tableName]);
    return result;
  });
}

/** Returns true if the task table has the given column. */
function taskColumnExists(
  repoPath: string,
  columnName: string,
  cache?: QueryCache,
): ResultAsync<boolean, AppError> {
  return columnExists(repoPath, "task", columnName, cache);
}

/** Returns true if the plan table has the given column. */
function planColumnExists(
  repoPath: string,
  columnName: string,
  cache?: QueryCache,
): ResultAsync<boolean, AppError> {
  return columnExists(repoPath, "plan", columnName, cache);
}

/** Returns true if a view with the given name exists. */
function viewExists(
  repoPath: string,
  viewName: string,
  cache?: QueryCache,
): ResultAsync<boolean, AppError> {
  const q = `SELECT 1 FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${viewName}' LIMIT 1`;
  const key = `viewExists:${repoPath}:${viewName}`;
  if (cache) {
    const hit = cache.get<boolean>(key);
    if (hit !== undefined)
      return ResultAsync.fromSafePromise(Promise.resolve(hit));
  }
  return doltSql(q, repoPath).map((rows) => {
    const result = rows.length > 0;
    cache?.set(key, result, CACHE_TTL_MS, [viewName]);
    return result;
  });
}

/** Returns true if a trigger with the given name exists in the current schema. */
function triggerExists(
  repoPath: string,
  triggerName: string,
  cache?: QueryCache,
): ResultAsync<boolean, AppError> {
  const q = `SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = '${triggerName}' LIMIT 1`;
  const key = `triggerExists:${repoPath}:${triggerName}`;
  if (cache) {
    const hit = cache.get<boolean>(key);
    if (hit !== undefined)
      return ResultAsync.fromSafePromise(Promise.resolve(hit));
  }
  return doltSql(q, repoPath).map((rows) => {
    const result = rows.length > 0;
    cache?.set(key, result, CACHE_TTL_MS, [triggerName]);
    return result;
  });
}

const NO_DELETE_MESSAGE =
  "Hard deletes forbidden. Use tg cancel for soft-delete.";

const NO_DELETE_TRIGGERS_MIGRATION = "no_delete_triggers";

/** True if we have already attempted the no-delete triggers migration (so we don't retry on every command when Dolt doesn't support SIGNAL). */
function noDeleteTriggersMigrationApplied(
  repoPath: string,
  cache?: QueryCache,
): ResultAsync<boolean, AppError> {
  return tableExists(repoPath, "_taskgraph_migrations", cache).andThen(
    (exists) => {
      if (!exists) return ok(false);
      const q = `SELECT 1 FROM _taskgraph_migrations WHERE name = '${NO_DELETE_TRIGGERS_MIGRATION}' LIMIT 1`;
      return doltSql(q, repoPath).map((rows) => rows.length > 0);
    },
  );
}

/** Returns true if project.initiative_id is nullable (IS_NULLABLE = 'YES'). */
function projectInitiativeIdNullable(
  repoPath: string,
  cache?: QueryCache,
): ResultAsync<boolean, AppError> {
  const q = `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'initiative_id' AND IS_NULLABLE = 'YES' LIMIT 1`;
  const key = `projectInitiativeIdNullable:${repoPath}`;
  if (cache) {
    const hit = cache.get<boolean>(key);
    if (hit !== undefined)
      return ResultAsync.fromSafePromise(Promise.resolve(hit));
  }
  return doltSql(q, repoPath).map((rows) => {
    const result = rows.length > 0;
    cache?.set(key, result, CACHE_TTL_MS, ["project"]);
    return result;
  });
}

/** Add file_tree, risks, tests columns to plan table if missing (idempotent).
 * Skips when table has been renamed to project (plan no longer exists); those columns are already on project.
 */
export function applyPlanRichFieldsMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "project", cache).andThen((hasProject) => {
    if (hasProject) return ResultAsync.fromSafePromise(Promise.resolve());
    return planColumnExists(repoPath, "file_tree", cache).andThen(
      (hasFileTree) => {
        if (hasFileTree) return ResultAsync.fromSafePromise(Promise.resolve());
        const alter =
          "ALTER TABLE `plan` ADD COLUMN `file_tree` TEXT NULL, ADD COLUMN `risks` JSON NULL, ADD COLUMN `tests` JSON NULL";
        return doltSql(alter, repoPath)
          .map(() => {
            cache?.clear();
            return undefined;
          })
          .andThen(() =>
            doltCommit(
              "db: add plan rich fields (file_tree, risks, tests)",
              repoPath,
              noCommit,
            ),
          )
          .map(() => undefined);
      },
    );
  });
}

/** Add domain, skill, change_type columns to task table if missing (idempotent).
 * Skips if junction tables (task_domain or task_doc) already exist — those supersede inline columns. */
export function applyTaskDimensionsMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "task_domain", cache).andThen((hasJunction) => {
    if (hasJunction) return ResultAsync.fromSafePromise(Promise.resolve());
    return tableExists(repoPath, "task_doc", cache).andThen((hasDocTable) => {
      if (hasDocTable) return ResultAsync.fromSafePromise(Promise.resolve());
      return taskColumnExists(repoPath, "domain", cache).andThen(
        (hasDomain) => {
          if (hasDomain) return ResultAsync.fromSafePromise(Promise.resolve());
          const alter =
            "ALTER TABLE `task` ADD COLUMN `domain` VARCHAR(64) NULL, ADD COLUMN `skill` VARCHAR(64) NULL, ADD COLUMN `change_type` ENUM('create','modify','refactor','fix','investigate','test','document') NULL";
          return doltSql(alter, repoPath)
            .map(() => {
              cache?.clear();
              return undefined;
            })
            .andThen(() =>
              doltCommit(
                "db: add task dimensions (domain, skill, change_type)",
                repoPath,
                noCommit,
              ),
            )
            .map(() => undefined);
        },
      );
    });
  });
}

/** Add suggested_changes column to task table if missing (idempotent). */
export function applyTaskSuggestedChangesMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return taskColumnExists(repoPath, "suggested_changes", cache).andThen(
    (hasCol) => {
      if (hasCol) return ResultAsync.fromSafePromise(Promise.resolve());
      const alter =
        "ALTER TABLE `task` ADD COLUMN `suggested_changes` TEXT NULL";
      return doltSql(alter, repoPath)
        .map(() => {
          cache?.clear();
          return undefined;
        })
        .andThen(() =>
          doltCommit(
            "db: add task suggested_changes column",
            repoPath,
            noCommit,
          ),
        )
        .map(() => undefined);
    },
  );
}

/** Add BEFORE DELETE triggers on plan, task, edge, event to block hard deletes. Idempotent.
 * If Dolt does not support SIGNAL in triggers (syntax error), we record that we attempted the migration
 * so we do not retry on every command; application-layer guard in connection.ts still blocks deletes.
 */
export function applyNoDeleteTriggersMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return noDeleteTriggersMigrationApplied(repoPath, cache).andThen(
    (alreadyApplied) => {
      if (alreadyApplied) return ResultAsync.fromSafePromise(Promise.resolve());

      return ensureSentinelTable(repoPath).andThen(() => {
        cache?.clear();
        const tables = ["plan", "task", "edge", "event"] as const;
        let chain: ResultAsync<void, AppError> = ResultAsync.fromSafePromise(
          Promise.resolve(undefined),
        );
        for (const table of tables) {
          const triggerName = `no_delete_${table}`;
          chain = chain.andThen(() =>
            triggerExists(repoPath, triggerName, cache).andThen((exists) => {
              if (exists) return ResultAsync.fromSafePromise(Promise.resolve());
              const createTrigger = `CREATE TRIGGER \`${triggerName}\` BEFORE DELETE ON \`${table}\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${NO_DELETE_MESSAGE}'`;
              return doltSql(createTrigger, repoPath)
                .orElse(() => ok([]))
                .map(() => {
                  cache?.clear();
                  return undefined;
                });
            }),
          );
        }
        return chain
          .andThen(() => markNoDeleteTriggersApplied(repoPath))
          .andThen(() =>
            doltCommit(
              "db: add BEFORE DELETE triggers (no hard deletes)",
              repoPath,
              noCommit,
            ),
          )
          .map(() => undefined);
      });
    },
  );
}

function ensureSentinelTable(repoPath: string): ResultAsync<void, AppError> {
  const create =
    "CREATE TABLE IF NOT EXISTS _taskgraph_migrations (name VARCHAR(64) PRIMARY KEY, applied_at DATETIME NOT NULL)";
  return doltSql(create, repoPath).map(() => undefined);
}

function markNoDeleteTriggersApplied(
  repoPath: string,
): ResultAsync<void, AppError> {
  const insert = `INSERT IGNORE INTO _taskgraph_migrations (name, applied_at) VALUES ('${NO_DELETE_TRIGGERS_MIGRATION}', NOW())`;
  return doltSql(insert, repoPath).map(() => undefined);
}

/** Replace task.domain/task.skill with task_domain and task_skill junction tables; migrate data and drop columns. */
export function applyTaskDomainSkillJunctionMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "task_domain", cache).andThen((exists) => {
    if (exists) return ResultAsync.fromSafePromise(Promise.resolve());
    return tableExists(repoPath, "task_doc", cache).andThen((hasDocTable) => {
      if (hasDocTable) return ResultAsync.fromSafePromise(Promise.resolve());
      return doltSql(
        `CREATE TABLE \`task_domain\` (task_id CHAR(36) NOT NULL, domain VARCHAR(64) NOT NULL, PRIMARY KEY (task_id, domain), FOREIGN KEY (task_id) REFERENCES \`task\`(task_id))`,
        repoPath,
      )
        .map(() => {
          cache?.clear();
          return undefined;
        })
        .andThen(() =>
          doltSql(
            `CREATE TABLE \`task_skill\` (task_id CHAR(36) NOT NULL, skill VARCHAR(64) NOT NULL, PRIMARY KEY (task_id, skill), FOREIGN KEY (task_id) REFERENCES \`task\`(task_id))`,
            repoPath,
          ),
        )
        .andThen(() =>
          taskColumnExists(repoPath, "domain", cache).andThen((hasDomain) => {
            if (!hasDomain)
              return ResultAsync.fromSafePromise(Promise.resolve());
            return doltSql(
              "INSERT INTO `task_domain` (task_id, domain) SELECT task_id, domain FROM `task` WHERE domain IS NOT NULL",
              repoPath,
            ).andThen(() =>
              doltSql(
                "INSERT INTO `task_skill` (task_id, skill) SELECT task_id, skill FROM `task` WHERE skill IS NOT NULL",
                repoPath,
              ),
            );
          }),
        )
        .andThen(() =>
          taskColumnExists(repoPath, "domain", cache).andThen((hasDomain) => {
            if (!hasDomain)
              return ResultAsync.fromSafePromise(Promise.resolve());
            return doltSql(
              "ALTER TABLE `task` DROP COLUMN `domain`, DROP COLUMN `skill`",
              repoPath,
            );
          }),
        )
        .andThen(() =>
          doltCommit(
            "db: task_domain/task_skill junction tables; drop task.domain/task.skill",
            repoPath,
            noCommit,
          ),
        )
        .map(() => undefined);
    });
  });
}

/** Rename task_domain → task_doc (idempotent). Runs after junction migration. */
export function applyDomainToDocRenameMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "task_doc", cache).andThen((hasTaskDoc) => {
    if (hasTaskDoc) return ResultAsync.fromSafePromise(Promise.resolve());
    return tableExists(repoPath, "task_domain", cache).andThen(
      (hasTaskDomain) => {
        if (!hasTaskDomain) {
          // Fresh install — create task_doc directly.
          // IF NOT EXISTS guards against concurrent migration runs racing to create the table.
          return doltSql(
            `CREATE TABLE IF NOT EXISTS \`task_doc\` (task_id CHAR(36) NOT NULL, doc VARCHAR(64) NOT NULL, PRIMARY KEY (task_id, doc), FOREIGN KEY (task_id) REFERENCES \`task\`(task_id))`,
            repoPath,
          )
            .map(() => {
              cache?.clear();
              return undefined;
            })
            .andThen(() =>
              doltCommit(
                "db: create task_doc table (fresh)",
                repoPath,
                noCommit,
              ),
            )
            .map(() => undefined);
        }
        // Upgrade path — copy data from task_domain into task_doc, then drop task_domain.
        // IF NOT EXISTS / INSERT IGNORE / DROP IF EXISTS guard against concurrent migration runs.
        return doltSql(
          `CREATE TABLE IF NOT EXISTS \`task_doc\` (task_id CHAR(36) NOT NULL, doc VARCHAR(64) NOT NULL, PRIMARY KEY (task_id, doc), FOREIGN KEY (task_id) REFERENCES \`task\`(task_id))`,
          repoPath,
        )
          .map(() => {
            cache?.clear();
            return undefined;
          })
          .andThen(() =>
            tableExists(repoPath, "task_domain", cache).andThen(
              (domainStillExists) => {
                if (!domainStillExists)
                  return ResultAsync.fromSafePromise(Promise.resolve([]));
                return doltSql(
                  "INSERT IGNORE INTO `task_doc` (task_id, doc) SELECT task_id, domain FROM `task_domain`",
                  repoPath,
                );
              },
            ),
          )
          .andThen(() =>
            tableExists(repoPath, "task_domain", cache).andThen(
              (domainStillExists) => {
                if (!domainStillExists)
                  return ResultAsync.fromSafePromise(Promise.resolve([]));
                return doltSql("DROP TABLE `task_domain`", repoPath);
              },
            ),
          )
          .andThen(() =>
            doltCommit(
              "db: rename task_domain to task_doc",
              repoPath,
              noCommit,
            ),
          )
          .map(() => undefined);
      },
    );
  });
}

/** Add hash_id column to task table and backfill existing rows (idempotent). */
export function applyHashIdMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return taskColumnExists(repoPath, "hash_id", cache).andThen((hasCol) => {
    if (hasCol) return ResultAsync.fromSafePromise(Promise.resolve());
    const alter =
      "ALTER TABLE `task` ADD COLUMN `hash_id` VARCHAR(10) NULL UNIQUE";
    return doltSql(alter, repoPath)
      .map(() => {
        cache?.clear();
        return undefined;
      })
      .andThen(() =>
        doltSql(
          "SELECT `task_id` FROM `task` ORDER BY `created_at` ASC",
          repoPath,
        ),
      )
      .andThen((rows: { task_id: string }[]) => {
        const usedIds = new Set<string>();
        let chain: ResultAsync<void, AppError> = ResultAsync.fromSafePromise(
          Promise.resolve(undefined),
        );
        for (const row of rows) {
          chain = chain.andThen(() => {
            const hashId = generateUniqueHashId(row.task_id, usedIds);
            usedIds.add(hashId);
            return doltSql(
              `UPDATE \`task\` SET \`hash_id\` = '${sqlEscape(hashId)}' WHERE \`task_id\` = '${sqlEscape(row.task_id)}'`,
              repoPath,
            ).map(() => undefined);
          });
        }
        return chain;
      })
      .andThen(() =>
        doltCommit(
          "db: add task hash_id column and backfill",
          repoPath,
          noCommit,
        ),
      )
      .map(() => undefined);
  });
}

/** Add agent column to task table if missing (idempotent). */
export function applyTaskAgentMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return taskColumnExists(repoPath, "agent", cache).andThen((hasCol) => {
    if (hasCol) return ResultAsync.fromSafePromise(Promise.resolve());
    const alter = "ALTER TABLE `task` ADD COLUMN `agent` VARCHAR(64) NULL";
    return doltSql(alter, repoPath)
      .map(() => {
        cache?.clear();
        return undefined;
      })
      .andThen(() =>
        doltCommit("db: add task agent column", repoPath, noCommit),
      )
      .map(() => undefined);
  });
}

/** Create gate table if missing (idempotent). Columns match Gate schema: gate_id, name, gate_type, status, task_id, resolved_at, created_at. */
export function applyGateTableMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "gate", cache).andThen((exists) => {
    if (exists) return ResultAsync.fromSafePromise(Promise.resolve());
    const create =
      "CREATE TABLE IF NOT EXISTS `gate` (gate_id CHAR(36) PRIMARY KEY, name VARCHAR(255) NOT NULL, gate_type ENUM('human','ci','webhook') NOT NULL, status ENUM('pending','resolved','expired') DEFAULT 'pending', task_id CHAR(36) NOT NULL, resolved_at DATETIME NULL, created_at DATETIME NOT NULL, FOREIGN KEY (task_id) REFERENCES `task`(task_id))";
    return doltSql(create, repoPath)
      .map(() => {
        cache?.clear();
        return undefined;
      })
      .andThen(() => doltCommit("db: add gate table", repoPath, noCommit))
      .map(() => undefined);
  });
}

/** Create initiative table if missing (idempotent). */
export function applyInitiativeMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "initiative", cache).andThen((exists) => {
    if (exists) return ResultAsync.fromSafePromise(Promise.resolve());
    const create =
      "CREATE TABLE IF NOT EXISTS `initiative` (initiative_id CHAR(36) PRIMARY KEY, title VARCHAR(255) NOT NULL, description TEXT NOT NULL, status ENUM('draft','active','paused','done','abandoned') DEFAULT 'draft', cycle_start DATE NULL, cycle_end DATE NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)";
    return doltSql(create, repoPath)
      .map(() => {
        cache?.clear();
        return undefined;
      })
      .andThen(() => doltCommit("db: add initiative table", repoPath, noCommit))
      .map(() => undefined);
  });
}

/** FK constraint row from information_schema when querying references to a table. */
interface FkConstraintRow {
  CONSTRAINT_NAME: string;
  TABLE_NAME: string;
}

/** Get FK constraint names that reference the given table (for dropping by name). One row per constraint. */
function getFkConstraintsReferencing(
  repoPath: string,
  referencedTable: string,
): ResultAsync<FkConstraintRow[], AppError> {
  const q = `SELECT DISTINCT CONSTRAINT_NAME, TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = '${referencedTable}' AND REFERENCED_TABLE_SCHEMA = DATABASE()`;
  return doltSql(q, repoPath).map((rows) => rows as FkConstraintRow[]);
}

/** Fixed UUID for the default "Unassigned" initiative. Used by applyDefaultInitiativeMigration. */
const UNASSIGNED_INITIATIVE_ID = "00000000-0000-4000-8000-000000000000";

/** Create default Unassigned initiative; backfill project.initiative_id; make initiative_id NOT NULL. Idempotent. */
export function applyDefaultInitiativeMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "project", cache).andThen((projectExists) => {
    if (!projectExists) return ResultAsync.fromSafePromise(Promise.resolve());

    return tableExists(repoPath, "initiative", cache).andThen(
      (initiativeExists) => {
        if (!initiativeExists)
          return ResultAsync.fromSafePromise(Promise.resolve());

        type InitiativeRow = { initiative_id: string };
        const findUnassigned = `SELECT initiative_id FROM \`initiative\` WHERE initiative_id = '${UNASSIGNED_INITIATIVE_ID}' OR title = 'Unassigned' LIMIT 1`;
        return doltSql(findUnassigned, repoPath).andThen(
          (rows: InitiativeRow[]) => {
            const unassignedId =
              rows.length > 0
                ? rows[0].initiative_id
                : UNASSIGNED_INITIATIVE_ID;
            const didInsert = rows.length === 0;
            let didAlter = false;

            let chain: ResultAsync<void, AppError> =
              ResultAsync.fromSafePromise(Promise.resolve(undefined));

            if (rows.length === 0) {
              chain = chain.andThen(() =>
                doltSql(
                  `INSERT INTO \`initiative\` (initiative_id, title, description, status, created_at, updated_at) VALUES ('${UNASSIGNED_INITIATIVE_ID}', 'Unassigned', 'Projects not yet linked to an initiative.', 'active', NOW(), NOW())`,
                  repoPath,
                ).map(() => undefined),
              );
            }

            return chain
              .andThen(() =>
                doltSql(
                  `UPDATE \`project\` SET initiative_id = '${sqlEscape(unassignedId)}' WHERE initiative_id IS NULL`,
                  repoPath,
                ),
              )
              .map(() => undefined)
              .andThen(() => projectInitiativeIdNullable(repoPath, cache))
              .andThen((nullable) => {
                if (!nullable)
                  return ResultAsync.fromSafePromise(Promise.resolve());
                didAlter = true;
                return doltSql(
                  `ALTER TABLE \`project\` MODIFY COLUMN initiative_id CHAR(36) NOT NULL DEFAULT '${UNASSIGNED_INITIATIVE_ID}'`,
                  repoPath,
                ).map(() => {
                  cache?.clear();
                  return undefined;
                });
              })
              .andThen(() => {
                if (!didInsert && !didAlter)
                  return ResultAsync.fromSafePromise(Promise.resolve());
                return doltCommit(
                  "db: default Unassigned initiative; project.initiative_id NOT NULL",
                  repoPath,
                  noCommit,
                );
              })
              .map(() => undefined);
          },
        );
      },
    );
  });
}

/** Rename plan table to project; add initiative_id, overview, objectives, outcomes, outputs; recreate no_delete trigger. Idempotent: skip if project already exists. */
export function applyPlanToProjectRenameMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "project", cache).andThen((projectExists) => {
    if (projectExists) return ResultAsync.fromSafePromise(Promise.resolve());

    return getFkConstraintsReferencing(repoPath, "plan").andThen((fks) => {
      let chain: ResultAsync<void, AppError> = ResultAsync.fromSafePromise(
        Promise.resolve(undefined),
      );
      for (const row of fks) {
        chain = chain.andThen(() =>
          doltSql(
            `ALTER TABLE \`${row.TABLE_NAME}\` DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``,
            repoPath,
          ).map(() => undefined),
        );
      }
      return chain
        .andThen(() =>
          doltSql("DROP TRIGGER IF EXISTS `no_delete_plan`", repoPath),
        )
        .map(() => undefined)
        .andThen(() => doltSql("RENAME TABLE `plan` TO `project`", repoPath))
        .map(() => {
          cache?.clear();
          return undefined;
        })
        .andThen(() =>
          doltSql(
            "ALTER TABLE `project` ADD COLUMN initiative_id CHAR(36) NULL, ADD COLUMN overview TEXT NULL, ADD COLUMN objectives JSON NULL, ADD COLUMN outcomes JSON NULL, ADD COLUMN outputs JSON NULL, ADD CONSTRAINT fk_project_initiative FOREIGN KEY (initiative_id) REFERENCES initiative(initiative_id)",
            repoPath,
          ),
        )
        .map(() => undefined)
        .andThen(() =>
          doltSql(
            "ALTER TABLE `task` ADD CONSTRAINT task_plan_id_fk FOREIGN KEY (plan_id) REFERENCES project(plan_id)",
            repoPath,
          ),
        )
        .map(() => undefined)
        .andThen(() =>
          doltSql(
            "ALTER TABLE `decision` ADD CONSTRAINT decision_plan_id_fk FOREIGN KEY (plan_id) REFERENCES project(plan_id)",
            repoPath,
          ),
        )
        .map(() => undefined)
        .andThen(() =>
          triggerExists(repoPath, "no_delete_project", cache).andThen(
            (exists) => {
              if (exists) return ResultAsync.fromSafePromise(Promise.resolve());
              const createTrigger = `CREATE TRIGGER \`no_delete_project\` BEFORE DELETE ON \`project\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${NO_DELETE_MESSAGE}'`;
              return doltSql(createTrigger, repoPath)
                .orElse(() => ok([]))
                .map(() => undefined);
            },
          ),
        )
        .andThen(() =>
          doltSql(
            "CREATE OR REPLACE VIEW `plan` AS SELECT * FROM `project`",
            repoPath,
          ).map(() => undefined),
        )
        .andThen(() =>
          doltCommit(
            "db: rename plan to project; add initiative_id, overview, objectives, outcomes, outputs; no_delete_project trigger; plan view",
            repoPath,
            noCommit,
          ),
        )
        .map(() => undefined);
    });
  });
}

/** Create view `plan` as SELECT * FROM project so existing code that references `plan` keeps working. Idempotent. */
export function applyPlanViewMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "project", cache).andThen((hasProject) => {
    if (!hasProject) return ResultAsync.fromSafePromise(Promise.resolve());
    return viewExists(repoPath, "plan", cache).andThen((hasView) => {
      if (hasView) return ResultAsync.fromSafePromise(Promise.resolve());
      return doltSql("CREATE VIEW `plan` AS SELECT * FROM `project`", repoPath)
        .map(() => {
          cache?.clear();
          return undefined;
        })
        .andThen(() =>
          doltCommit("db: add plan view for compatibility", repoPath, noCommit),
        )
        .map(() => undefined);
    });
  });
}

/** Create cycle table if missing (idempotent). */
export function applyCycleMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "cycle", cache).andThen((exists) => {
    if (exists) return ResultAsync.fromSafePromise(Promise.resolve());
    const create =
      "CREATE TABLE IF NOT EXISTS `cycle` (cycle_id CHAR(36) PRIMARY KEY, name VARCHAR(255) NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)";
    return doltSql(create, repoPath)
      .map(() => {
        cache?.clear();
        return undefined;
      })
      .andThen(() => doltCommit("db: add cycle table", repoPath, noCommit))
      .map(() => undefined);
  });
}

/** Add initiative.cycle_id FK to cycle if missing (idempotent). Run after applyCycleMigration. */
export function applyInitiativeCycleIdMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return columnExists(repoPath, "initiative", "cycle_id", cache).andThen(
    (exists) => {
      if (exists) return ResultAsync.fromSafePromise(Promise.resolve());
      return doltSql(
        "ALTER TABLE `initiative` ADD COLUMN cycle_id CHAR(36) NULL, ADD CONSTRAINT fk_initiative_cycle FOREIGN KEY (cycle_id) REFERENCES `cycle`(cycle_id)",
        repoPath,
      )
        .map(() => {
          cache?.clear();
          return undefined;
        })
        .andThen(() =>
          doltCommit(
            "db: add initiative.cycle_id FK to cycle",
            repoPath,
            noCommit,
          ),
        )
        .map(() => undefined);
    },
  );
}

/** Add hash_id column to plan/project and backfill (idempotent). Branch name basis: plan-<hash_id>. */
export function applyPlanHashIdMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return planColumnExists(repoPath, "hash_id", cache).andThen((hasCol) => {
    if (hasCol) return ResultAsync.fromSafePromise(Promise.resolve());
    return tableExists(repoPath, "project", cache).andThen((hasProject) => {
      const table = hasProject ? "project" : "plan";
      return doltSql(
        `ALTER TABLE \`${table}\` ADD COLUMN \`hash_id\` VARCHAR(20) NULL`,
        repoPath,
      )
        .map(() => {
          cache?.clear();
          return undefined;
        })
        .andThen(() =>
          doltSql(
            `UPDATE \`${table}\` SET hash_id = CONCAT('p-', LOWER(SUBSTR(HEX(plan_id), 1, 6))) WHERE hash_id IS NULL OR hash_id = ''`,
            repoPath,
          ),
        )
        .map(() => undefined)
        .andThen(() =>
          doltCommit(
            "db: add plan hash_id column and backfill",
            repoPath,
            noCommit,
          ),
        )
        .map(() => undefined);
    });
  });
}

/** Create plan_worktree table if missing (idempotent). */
export function applyPlanWorktreeMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "plan_worktree", cache).andThen((exists) => {
    if (exists) return ResultAsync.fromSafePromise(Promise.resolve());
    const create =
      "CREATE TABLE IF NOT EXISTS `plan_worktree` (plan_id CHAR(36) PRIMARY KEY, worktree_path VARCHAR(512) NOT NULL, worktree_branch VARCHAR(128) NOT NULL, created_at DATETIME NOT NULL)";
    return doltSql(create, repoPath)
      .map(() => {
        cache?.clear();
        return undefined;
      })
      .andThen(() =>
        doltCommit("db: add plan_worktree table", repoPath, noCommit),
      )
      .map(() => undefined);
  });
}

/** Returns true when the named index exists on a table (using information_schema). */
function indexExists(
  repoPath: string,
  table: string,
  indexName: string,
  cache?: QueryCache,
): ResultAsync<boolean, AppError> {
  const sql = `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND INDEX_NAME = '${indexName}'`;
  return doltSql(sql, repoPath, undefined).map((rows) => {
    cache?.clear();
    const cnt = Number(rows?.[0]?.cnt ?? 0);
    return cnt > 0;
  });
}

/** Add secondary indexes on hot FK/filter columns (idempotent). */
export function applyIndexMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  // gate must come first: Dolt validates all FK backing-indexes when any
  // CREATE INDEX runs, so idx_gate_task_id must exist before we create
  // indexes on other tables that would trigger that validation.
  const indexes: Array<{ table: string; name: string; cols: string }> = [
    { table: "gate", name: "idx_gate_task_id", cols: "task_id" },
    { table: "task", name: "idx_task_plan_id", cols: "plan_id" },
    { table: "task", name: "idx_task_status", cols: "status" },
    { table: "event", name: "idx_event_task_id", cols: "task_id" },
    { table: "edge", name: "idx_edge_from_task_id", cols: "from_task_id" },
  ];

  // Run sequentially: Dolt revalidates all FK backing-indexes on each CREATE
  // INDEX, so parallel execution would see idx_gate_task_id missing while
  // creating idx_event_task_id and throw ER_UNKNOWN_ERROR.
  const sequential = indexes.reduce(
    (acc, { table, name, cols }) =>
      acc.andThen(() =>
        indexExists(repoPath, table, name, cache).andThen((exists) => {
          if (exists) return ResultAsync.fromSafePromise(Promise.resolve());
          return doltSql(
            `CREATE INDEX \`${name}\` ON \`${table}\`(\`${cols}\`)`,
            repoPath,
          ).map(() => undefined);
        }),
      ),
    ResultAsync.fromSafePromise<void, AppError>(Promise.resolve()),
  );

  return sequential
    .andThen(() =>
      doltCommit(
        "db: add secondary indexes for hot FK/filter columns",
        repoPath,
        noCommit,
      ),
    )
    .map(() => undefined);
}

/** Add composite index on event(kind, task_id) if missing (idempotent). */
export function applyEventKindIndex(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return indexExists(
    repoPath,
    "event",
    "idx_event_kind_task_id",
    cache,
  ).andThen((exists) => {
    if (exists) return ResultAsync.fromSafePromise(Promise.resolve());
    return doltSql(
      "CREATE INDEX `idx_event_kind_task_id` ON `event`(kind, task_id)",
      repoPath,
    )
      .map(() => undefined)
      .andThen(() =>
        doltCommit(
          "db: add idx_event_kind_task_id index on event(kind, task_id)",
          repoPath,
          noCommit,
        ),
      )
      .map(() => undefined);
  });
}

/** Add started_at and ended_at columns to task table if missing (idempotent). */
export function applyTaskFootprintMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return taskColumnExists(repoPath, "started_at", cache).andThen((hasCol) => {
    if (hasCol) return ResultAsync.fromSafePromise(Promise.resolve());
    const alter =
      "ALTER TABLE `task` ADD COLUMN `started_at` DATETIME NULL, ADD COLUMN `ended_at` DATETIME NULL";
    return doltSql(alter, repoPath)
      .map(() => {
        cache?.clear();
        return undefined;
      })
      .andThen(() =>
        doltCommit(
          "db: add task footprint columns started_at, ended_at",
          repoPath,
          noCommit,
        ),
      )
      .map(() => undefined);
  });
}

/** Add is_benchmark column to project and task tables (idempotent). */
export function applyIsBenchmarkMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return columnExists(repoPath, "project", "is_benchmark", cache).andThen(
    (projectHas) => {
      const addToProject = projectHas
        ? ResultAsync.fromSafePromise<void, AppError>(Promise.resolve())
        : doltSql(
            "ALTER TABLE `project` ADD COLUMN `is_benchmark` TINYINT NOT NULL DEFAULT 0",
            repoPath,
          ).map(() => {
            cache?.clear();
            return undefined;
          });

      return addToProject.andThen(() =>
        columnExists(repoPath, "task", "is_benchmark", cache).andThen(
          (taskHas) => {
            const addToTask = taskHas
              ? ResultAsync.fromSafePromise<void, AppError>(Promise.resolve())
              : doltSql(
                  "ALTER TABLE `task` ADD COLUMN `is_benchmark` TINYINT NOT NULL DEFAULT 0",
                  repoPath,
                ).map(() => {
                  cache?.clear();
                  return undefined;
                });

            return addToTask.andThen(() =>
              doltCommit(
                "db: add is_benchmark column to project and task",
                repoPath,
                noCommit,
              ).map(() => undefined),
            );
          },
        ),
      );
    },
  );
}

/** Create evolve_run_quality table for evolve skill run-quality scorecards (idempotent). */
export function applyEvolveRunQualityMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "evolve_run_quality", cache).andThen(
    (exists) => {
      if (exists) return ResultAsync.fromSafePromise(Promise.resolve());
      const create =
        "CREATE TABLE IF NOT EXISTS `evolve_run_quality` (run_id CHAR(36) PRIMARY KEY, plan_id CHAR(36) NULL, sample_size INT NOT NULL, confidence DECIMAL(5,4) NULL, recurrence INT NULL, created_at DATETIME NOT NULL)";
      return doltSql(create, repoPath)
        .map(() => {
          cache?.clear();
          return undefined;
        })
        .andThen(() =>
          doltCommit(
            "db: add evolve_run_quality table for evolve scorecards",
            repoPath,
            noCommit,
          ),
        )
        .map(() => undefined);
    },
  );
}

/** Create learning table for recurrence tracker: links new findings to prior learnings (seen_again, caught, escaped). */
export function applyLearningRecurrenceMigration(
  repoPath: string,
  noCommit: boolean = false,
  cache?: QueryCache,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "learning", cache).andThen((exists) => {
    if (exists) return ResultAsync.fromSafePromise(Promise.resolve());
    const create = [
      "CREATE TABLE IF NOT EXISTS `learning` (",
      "learning_id CHAR(36) PRIMARY KEY,",
      "fingerprint VARCHAR(64) NOT NULL,",
      "directive_summary TEXT NOT NULL,",
      "category VARCHAR(64) NULL,",
      "source ENUM('evolve','learnings') NOT NULL,",
      "outcome ENUM('new','seen_again','caught','escaped') NOT NULL,",
      "prior_learning_id CHAR(36) NULL,",
      "plan_id CHAR(36) NULL,",
      "run_id CHAR(36) NULL,",
      "created_at DATETIME NOT NULL,",
      "INDEX idx_learning_fingerprint (fingerprint),",
      "INDEX idx_learning_outcome (outcome),",
      "INDEX idx_learning_created (created_at)",
      ")",
    ].join(" ");
    return doltSql(create, repoPath)
      .map(() => {
        cache?.clear();
        return undefined;
      })
      .andThen(() =>
        doltCommit(
          "db: add learning table for recurrence tracker",
          repoPath,
          noCommit,
        ),
      )
      .map(() => undefined);
  });
}

/** Chains all idempotent migrations. Safe to run on every command.
 *
 * Fast path: if `.tg-migration-version` in the parent of repoPath already
 * matches MIGRATION_VERSION and the `project` table exists, all probes are
 * skipped. If the sentinel matches but `project` is missing (e.g. DB restored
 * from backup with old schema), the sentinel is cleared and migrations run.
 */
export function ensureMigrations(
  repoPath: string,
  noCommit: boolean = false,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "project").andThen((projectExists) => {
    if (projectExists && readSentinel(repoPath) === MIGRATION_VERSION) {
      return ResultAsync.fromSafePromise(Promise.resolve(undefined));
    }
    if (!projectExists) {
      try {
        const p = getSentinelPath(repoPath);
        if (existsSync(p)) unlinkSync(p);
      } catch {
        // Non-fatal; migrations will run
      }
    }
    console.error("[tg] Running migrations…");
    const cache = new QueryCache();
    return applyPlanRichFieldsMigration(repoPath, noCommit, cache)
      .andThen(() => applyTaskDimensionsMigration(repoPath, noCommit, cache))
      .andThen(() =>
        applyTaskSuggestedChangesMigration(repoPath, noCommit, cache),
      )
      .andThen(() =>
        applyTaskDomainSkillJunctionMigration(repoPath, noCommit, cache),
      )
      .andThen(() => applyDomainToDocRenameMigration(repoPath, noCommit, cache))
      .andThen(() => applyTaskAgentMigration(repoPath, noCommit, cache))
      .andThen(() => applyHashIdMigration(repoPath, noCommit, cache))
      .andThen(() => applyNoDeleteTriggersMigration(repoPath, noCommit, cache))
      .andThen(() => applyGateTableMigration(repoPath, noCommit, cache))
      .andThen(() => applyInitiativeMigration(repoPath, noCommit, cache))
      .andThen(() =>
        applyPlanToProjectRenameMigration(repoPath, noCommit, cache),
      )
      .andThen(() => applyPlanViewMigration(repoPath, noCommit, cache))
      .andThen(() => applyPlanHashIdMigration(repoPath, noCommit, cache))
      .andThen(() => applyDefaultInitiativeMigration(repoPath, noCommit, cache))
      .andThen(() => applyCycleMigration(repoPath, noCommit, cache))
      .andThen(() => applyInitiativeCycleIdMigration(repoPath, noCommit, cache))
      .andThen(() => applyPlanWorktreeMigration(repoPath, noCommit, cache))
      .andThen(() => applyIndexMigration(repoPath, noCommit, cache))
      .andThen(() => applyEventKindIndex(repoPath, noCommit, cache))
      .andThen(() => applyTaskFootprintMigration(repoPath, noCommit, cache))
      .andThen(() => applyIsBenchmarkMigration(repoPath, noCommit, cache))
      .andThen(() => applyEvolveRunQualityMigration(repoPath, noCommit, cache))
      .andThen(() =>
        applyLearningRecurrenceMigration(repoPath, noCommit, cache),
      )
      .map(() => {
        writeSentinel(repoPath);
        return undefined;
      });
  });
}

export function applyMigrations(
  repoPath: string,
  noCommit: boolean = false,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "plan").andThen((planExists) => {
    if (planExists) {
      return ResultAsync.fromSafePromise(Promise.resolve(undefined));
    }
    return ResultAsync.fromPromise(
      (async () => {
        for (const statement of SCHEMA) {
          const res = await ResultAsync.fromPromise(
            execa(
              process.env.DOLT_PATH || "dolt",
              ["--data-dir", repoPath, "sql"],
              {
                cwd: repoPath,
                shell: true,
                input: statement,
                env: { ...process.env, DOLT_READ_ONLY: "false" },
              },
            ),
            (e) =>
              buildError(
                ErrorCode.DB_QUERY_FAILED,
                `Dolt SQL query failed for statement: ${statement}`,
                e,
              ),
          );
          if (res.isErr()) {
            console.error("Migration failed:", statement, res.error);
            throw res.error;
          }
        }
        return undefined;
      })(),
      (e) =>
        buildError(
          ErrorCode.DB_QUERY_FAILED,
          "Failed to apply schema migrations",
          e,
        ),
    )
      .andThen(() =>
        doltCommit("db: apply schema migrations", repoPath, noCommit),
      )
      .map(() => undefined);
  });
}
