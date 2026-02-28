import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";
import {
  applyDomainToDocRenameMigration,
  applyMigrations,
  applyPlanRichFieldsMigration,
  applyTaskAgentMigration,
  applyTaskDimensionsMigration,
  applyTaskDomainSkillJunctionMigration,
  applyTaskSuggestedChangesMigration,
} from "../../src/db/migrate";

const DOLT_PATH = process.env.DOLT_PATH || "dolt";

/** Path file so worker processes can read the template path (globalSetup runs in a separate process). */
export const GOLDEN_TEMPLATE_PATH_FILE = path.join(
  os.tmpdir(),
  "tg-golden-template-path.txt",
);

export default async function globalSetup(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-golden-template-"));
  const doltRepoPath = path.join(tempDir, ".taskgraph", "dolt");

  fs.mkdirSync(doltRepoPath, { recursive: true });

  await execa(DOLT_PATH, ["init"], {
    cwd: doltRepoPath,
    env: { ...process.env, DOLT_PATH },
  });

  (await applyMigrations(doltRepoPath))._unsafeUnwrap();
  (await applyTaskDimensionsMigration(doltRepoPath))._unsafeUnwrap();
  (await applyTaskDomainSkillJunctionMigration(doltRepoPath))._unsafeUnwrap();
  (await applyDomainToDocRenameMigration(doltRepoPath))._unsafeUnwrap();
  (await applyTaskAgentMigration(doltRepoPath))._unsafeUnwrap();
  (await applyPlanRichFieldsMigration(doltRepoPath))._unsafeUnwrap();
  (await applyTaskSuggestedChangesMigration(doltRepoPath))._unsafeUnwrap();

  process.env.TG_GOLDEN_TEMPLATE = tempDir;
  fs.writeFileSync(GOLDEN_TEMPLATE_PATH_FILE, tempDir, "utf8");
}
