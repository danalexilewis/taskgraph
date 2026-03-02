/**
 * One-off: set a plan (project) status to active by plan ID or title.
 * Run with: pnpm exec tsx scripts/set-plan-active.ts <planIdOrTitle>
 */

import { readConfig } from "../src/cli/utils";
import { doltCommit } from "../src/db/commit";
import { now, query } from "../src/db/query";

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i;

async function main() {
  const planIdOrTitle = process.argv[2];
  if (!planIdOrTitle) {
    console.error(
      "Usage: pnpm exec tsx scripts/set-plan-active.ts <planIdOrTitle>",
    );
    process.exit(1);
  }

  const configResult = await readConfig();
  if (configResult.isErr()) {
    console.error(configResult.error.message);
    process.exit(1);
  }
  const repo = configResult.value.doltRepoPath;
  const q = query(repo);

  const where = UUID_REGEX.test(planIdOrTitle)
    ? { plan_id: planIdOrTitle }
    : { title: planIdOrTitle };

  const selectResult = await q.select<{ plan_id: string; status: string }>(
    "project",
    { columns: ["plan_id", "status"], where },
  );
  if (selectResult.isErr()) {
    console.error(selectResult.error.message);
    process.exit(1);
  }
  const rows = selectResult.value;
  if (rows.length === 0) {
    console.error(`No plan found for '${planIdOrTitle}'`);
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error(`Multiple plans matched '${planIdOrTitle}'`);
    process.exit(1);
  }

  const { plan_id: planId, status: currentStatus } = rows[0];
  if (currentStatus === "active") {
    console.log(`Plan ${planId} is already active.`);
    return;
  }

  const updateResult = await q.update(
    "project",
    { status: "active", updated_at: now() },
    { plan_id: planId },
  );
  if (updateResult.isErr()) {
    console.error(updateResult.error.message);
    process.exit(1);
  }

  const commitResult = await doltCommit(
    "plan: set active (user requested)",
    repo,
  );
  if (commitResult.isErr()) {
    console.error(commitResult.error.message);
    process.exit(1);
  }

  console.log(`Plan ${planId} set to active.`);
}

main();
