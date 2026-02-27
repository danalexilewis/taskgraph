import { doltSql } from "./connection";
import { doltCommit } from "./commit";
import * as fs from "fs";
import { execa } from "execa";
import { ResultAsync, ok } from "neverthrow";
import { AppError, buildError, ErrorCode } from "../domain/errors";

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS `plan` (plan_id CHAR(36) PRIMARY KEY, title VARCHAR(255) NOT NULL, intent TEXT NOT NULL, status ENUM(\'draft\',\'active\',\'paused\',\'done\',\'abandoned\') DEFAULT \'draft\', priority INT DEFAULT 0, source_path VARCHAR(512) NULL, source_commit VARCHAR(64) NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL);",
  "CREATE TABLE IF NOT EXISTS `task` (task_id CHAR(36) PRIMARY KEY, plan_id CHAR(36) NOT NULL, feature_key VARCHAR(64) NULL, title VARCHAR(255) NOT NULL, intent TEXT NULL, scope_in TEXT NULL, scope_out TEXT NULL, acceptance JSON NULL, status ENUM(\'todo\',\'doing\',\'blocked\',\'done\',\'canceled\') DEFAULT \'todo\', owner ENUM('human','agent') DEFAULT 'agent', area VARCHAR(64) NULL, risk ENUM('low','medium','high') DEFAULT 'low', estimate_mins INT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, external_key VARCHAR(128) NULL UNIQUE, FOREIGN KEY (plan_id) REFERENCES `plan`(plan_id));",
  "CREATE TABLE IF NOT EXISTS `edge` (from_task_id CHAR(36) NOT NULL, to_task_id CHAR(36) NOT NULL, type ENUM(\'blocks\',\'relates\') DEFAULT \'blocks\', reason TEXT NULL, PRIMARY KEY (from_task_id, to_task_id, type), FOREIGN KEY (from_task_id) REFERENCES `task`(task_id), FOREIGN KEY (to_task_id) REFERENCES `task`(task_id));",
  "CREATE TABLE IF NOT EXISTS `event` (event_id CHAR(36) PRIMARY KEY, task_id CHAR(36) NOT NULL, kind ENUM(\'created\',\'started\',\'progress\',\'blocked\',\'unblocked\',\'done\',\'split\',\'decision_needed\',\'note\') NOT NULL, body JSON NOT NULL, actor ENUM(\'human\',\'agent\') DEFAULT \'agent\', created_at DATETIME NOT NULL, FOREIGN KEY (task_id) REFERENCES `task`(task_id));",
  "CREATE TABLE IF NOT EXISTS `decision` (decision_id CHAR(36) PRIMARY KEY, plan_id CHAR(36) NOT NULL, task_id CHAR(36) NULL, summary VARCHAR(255) NOT NULL, context TEXT NOT NULL, options JSON NULL, decision TEXT NOT NULL, consequences TEXT NULL, source_ref VARCHAR(512) NULL, created_at DATETIME NOT NULL, FOREIGN KEY (plan_id) REFERENCES `plan`(plan_id), FOREIGN KEY (task_id) REFERENCES `task`(task_id));",
];

/** Returns true if the task table has the given column. */
function taskColumnExists(
  repoPath: string,
  columnName: string,
): ResultAsync<boolean, AppError> {
  const q = `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = '${columnName}' LIMIT 1`;
  return doltSql(q, repoPath).map((rows) => rows.length > 0);
}

/** Returns true if the plan table has the given column. */
function planColumnExists(
  repoPath: string,
  columnName: string,
): ResultAsync<boolean, AppError> {
  const q = `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plan' AND COLUMN_NAME = '${columnName}' LIMIT 1`;
  return doltSql(q, repoPath).map((rows) => rows.length > 0);
}

/** Add file_tree, risks, tests columns to plan table if missing (idempotent). */
export function applyPlanRichFieldsMigration(
  repoPath: string,
  noCommit: boolean = false,
): ResultAsync<void, AppError> {
  return planColumnExists(repoPath, "file_tree").andThen((hasFileTree) => {
    if (hasFileTree) return ResultAsync.fromSafePromise(Promise.resolve());
    const alter =
      "ALTER TABLE `plan` ADD COLUMN `file_tree` TEXT NULL, ADD COLUMN `risks` JSON NULL, ADD COLUMN `tests` JSON NULL";
    return doltSql(alter, repoPath)
      .map(() => undefined)
      .andThen(() =>
        doltCommit(
          "db: add plan rich fields (file_tree, risks, tests)",
          repoPath,
          noCommit,
        ),
      )
      .map(() => undefined);
  });
}

/** Add domain, skill, change_type columns to task table if missing (idempotent).
 * Skips if junction tables (task_domain or task_doc) already exist — those supersede inline columns. */
export function applyTaskDimensionsMigration(
  repoPath: string,
  noCommit: boolean = false,
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "task_domain").andThen((hasJunction) => {
    if (hasJunction) return ResultAsync.fromSafePromise(Promise.resolve());
    return tableExists(repoPath, "task_doc").andThen((hasDocTable) => {
      if (hasDocTable) return ResultAsync.fromSafePromise(Promise.resolve());
      return taskColumnExists(repoPath, "domain").andThen((hasDomain) => {
        if (hasDomain) return ResultAsync.fromSafePromise(Promise.resolve());
        const alter =
          "ALTER TABLE `task` ADD COLUMN `domain` VARCHAR(64) NULL, ADD COLUMN `skill` VARCHAR(64) NULL, ADD COLUMN `change_type` ENUM('create','modify','refactor','fix','investigate','test','document') NULL";
        return doltSql(alter, repoPath)
          .map(() => undefined)
          .andThen(() =>
            doltCommit(
              "db: add task dimensions (domain, skill, change_type)",
              repoPath,
              noCommit,
            ),
          )
          .map(() => undefined);
      });
    });
  });
}

/** Add suggested_changes column to task table if missing (idempotent). */
export function applyTaskSuggestedChangesMigration(
  repoPath: string,
  noCommit: boolean = false,
): ResultAsync<void, AppError> {
  return taskColumnExists(repoPath, "suggested_changes").andThen((hasCol) => {
    if (hasCol) return ResultAsync.fromSafePromise(Promise.resolve());
    const alter = "ALTER TABLE `task` ADD COLUMN `suggested_changes` TEXT NULL";
    return doltSql(alter, repoPath)
      .map(() => undefined)
      .andThen(() =>
        doltCommit("db: add task suggested_changes column", repoPath, noCommit),
      )
      .map(() => undefined);
  });
}

/** Returns true if the table exists. */
function tableExists(
  repoPath: string,
  tableName: string,
): ResultAsync<boolean, AppError> {
  const q = `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}' LIMIT 1`;
  return doltSql(q, repoPath).map((rows) => rows.length > 0);
}

/** Returns true if a trigger with the given name exists in the current schema. */
function triggerExists(
  repoPath: string,
  triggerName: string,
): ResultAsync<boolean, AppError> {
  const q = `SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = '${triggerName}' LIMIT 1`;
  return doltSql(q, repoPath).map((rows) => rows.length > 0);
}

const NO_DELETE_MESSAGE =
  "Hard deletes forbidden. Use tg cancel for soft-delete.";

const NO_DELETE_TRIGGERS_MIGRATION = "no_delete_triggers";

/** True if we have already attempted the no-delete triggers migration (so we don't retry on every command when Dolt doesn't support SIGNAL). */
function noDeleteTriggersMigrationApplied(
  repoPath: string,
): ResultAsync<boolean, AppError> {
  return tableExists(repoPath, "_taskgraph_migrations").andThen((exists) => {
    if (!exists) return ok(false);
    const q = `SELECT 1 FROM _taskgraph_migrations WHERE name = '${NO_DELETE_TRIGGERS_MIGRATION}' LIMIT 1`;
    return doltSql(q, repoPath).map((rows) => rows.length > 0);
  });
}

/** Add BEFORE DELETE triggers on plan, task, edge, event to block hard deletes. Idempotent.
 * If Dolt does not support SIGNAL in triggers (syntax error), we record that we attempted the migration
 * so we do not retry on every command; application-layer guard in connection.ts still blocks deletes.
 */
export function applyNoDeleteTriggersMigration(
  repoPath: string,
  noCommit: boolean = false,
): ResultAsync<void, AppError> {
  return noDeleteTriggersMigrationApplied(repoPath).andThen(
    (alreadyApplied) => {
      if (alreadyApplied) return ResultAsync.fromSafePromise(Promise.resolve());

      return ensureSentinelTable(repoPath).andThen(() => {
        const tables = ["plan", "task", "edge", "event"] as const;
        let chain: ResultAsync<void, AppError> = ResultAsync.fromSafePromise(
          Promise.resolve(undefined),
        );
        for (const table of tables) {
          const triggerName = `no_delete_${table}`;
          chain = chain.andThen(() =>
            triggerExists(repoPath, triggerName).andThen((exists) => {
              if (exists) return ResultAsync.fromSafePromise(Promise.resolve());
              const createTrigger = `CREATE TRIGGER \`${triggerName}\` BEFORE DELETE ON \`${table}\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${NO_DELETE_MESSAGE}'`;
              return doltSql(createTrigger, repoPath)
                .orElse(() => ok([]))
                .map(() => undefined);
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
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "task_domain").andThen((exists) => {
    if (exists) return ResultAsync.fromSafePromise(Promise.resolve());
    return tableExists(repoPath, "task_doc").andThen((hasDocTable) => {
      if (hasDocTable) return ResultAsync.fromSafePromise(Promise.resolve());
      return doltSql(
        `CREATE TABLE \`task_domain\` (task_id CHAR(36) NOT NULL, domain VARCHAR(64) NOT NULL, PRIMARY KEY (task_id, domain), FOREIGN KEY (task_id) REFERENCES \`task\`(task_id))`,
        repoPath,
      )
        .andThen(() =>
          doltSql(
            `CREATE TABLE \`task_skill\` (task_id CHAR(36) NOT NULL, skill VARCHAR(64) NOT NULL, PRIMARY KEY (task_id, skill), FOREIGN KEY (task_id) REFERENCES \`task\`(task_id))`,
            repoPath,
          ),
        )
        .andThen(() =>
          taskColumnExists(repoPath, "domain").andThen((hasDomain) => {
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
          taskColumnExists(repoPath, "domain").andThen((hasDomain) => {
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
): ResultAsync<void, AppError> {
  return tableExists(repoPath, "task_doc").andThen((hasTaskDoc) => {
    if (hasTaskDoc) return ResultAsync.fromSafePromise(Promise.resolve());
    return tableExists(repoPath, "task_domain").andThen((hasTaskDomain) => {
      if (!hasTaskDomain) {
        // Fresh install — create task_doc directly
        return doltSql(
          `CREATE TABLE \`task_doc\` (task_id CHAR(36) NOT NULL, doc VARCHAR(64) NOT NULL, PRIMARY KEY (task_id, doc), FOREIGN KEY (task_id) REFERENCES \`task\`(task_id))`,
          repoPath,
        )
          .andThen(() =>
            doltCommit("db: create task_doc table (fresh)", repoPath, noCommit),
          )
          .map(() => undefined);
      }
      // Upgrade path — copy data from task_domain into task_doc, then drop task_domain
      return doltSql(
        `CREATE TABLE \`task_doc\` (task_id CHAR(36) NOT NULL, doc VARCHAR(64) NOT NULL, PRIMARY KEY (task_id, doc), FOREIGN KEY (task_id) REFERENCES \`task\`(task_id))`,
        repoPath,
      )
        .andThen(() =>
          doltSql(
            "INSERT INTO `task_doc` (task_id, doc) SELECT task_id, domain FROM `task_domain`",
            repoPath,
          ),
        )
        .andThen(() => doltSql("DROP TABLE `task_domain`", repoPath))
        .andThen(() =>
          doltCommit("db: rename task_domain to task_doc", repoPath, noCommit),
        )
        .map(() => undefined);
    });
  });
}

/** Add agent column to task table if missing (idempotent). */
export function applyTaskAgentMigration(
  repoPath: string,
  noCommit: boolean = false,
): ResultAsync<void, AppError> {
  return taskColumnExists(repoPath, "agent").andThen((hasCol) => {
    if (hasCol) return ResultAsync.fromSafePromise(Promise.resolve());
    const alter = "ALTER TABLE `task` ADD COLUMN `agent` VARCHAR(64) NULL";
    return doltSql(alter, repoPath)
      .map(() => undefined)
      .andThen(() =>
        doltCommit("db: add task agent column", repoPath, noCommit),
      )
      .map(() => undefined);
  });
}

/** Chains all idempotent migrations. Safe to run on every command. */
export function ensureMigrations(
  repoPath: string,
  noCommit: boolean = false,
): ResultAsync<void, AppError> {
  return applyPlanRichFieldsMigration(repoPath, noCommit)
    .andThen(() => applyTaskDimensionsMigration(repoPath, noCommit))
    .andThen(() => applyTaskSuggestedChangesMigration(repoPath, noCommit))
    .andThen(() => applyTaskDomainSkillJunctionMigration(repoPath, noCommit))
    .andThen(() => applyDomainToDocRenameMigration(repoPath, noCommit))
    .andThen(() => applyTaskAgentMigration(repoPath, noCommit))
    .andThen(() => applyNoDeleteTriggersMigration(repoPath, noCommit))
    .map(() => undefined);
}

export function applyMigrations(
  repoPath: string,
  noCommit: boolean = false,
): ResultAsync<void, AppError> {
  return ResultAsync.fromPromise(
    (async () => {
      for (const statement of SCHEMA) {
        const tempSqlFile = `${repoPath}/temp_migration.sql`;
        fs.writeFileSync(tempSqlFile, statement);
        const res = await ResultAsync.fromPromise(
          execa(
            process.env.DOLT_PATH || "dolt",
            ["--data-dir", repoPath, "sql"],
            {
              cwd: repoPath,
              shell: true,
              input: fs.readFileSync(tempSqlFile, "utf8"),
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
        fs.unlinkSync(tempSqlFile);
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
}
