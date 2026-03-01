import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { execa } from "execa";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

const DOLT_PATH = process.env.DOLT_PATH || "dolt";
const doltEnv = () => ({
  ...process.env,
  DOLT_PATH: DOLT_PATH ?? process.env.DOLT_PATH,
  DOLT_READ_ONLY: "false",
});

function agentBranchName(taskId: string): string {
  return `agent-${taskId.slice(0, 8)}`;
}

async function doltBranchList(doltRepoPath: string): Promise<string[]> {
  const { stdout } = await execa(
    DOLT_PATH,
    ["--data-dir", doltRepoPath, "branch", "-a"],
    { cwd: doltRepoPath, env: doltEnv() },
  );
  return stdout
    .trim()
    .split(/\n/)
    .map((s) => s.replace(/^\*?\s*/, "").trim())
    .filter(Boolean);
}

async function doltMainHead(doltRepoPath: string): Promise<string> {
  const { stdout } = await execa(
    DOLT_PATH,
    ["--data-dir", doltRepoPath, "log", "main", "-n", "1", "--oneline"],
    { cwd: doltRepoPath, env: doltEnv() },
  );
  const firstLine = stdout.trim().split("\n")[0] ?? "";
  const hash = firstLine.split(/\s+/)[0];
  if (!hash) throw new Error(`Could not parse main HEAD from: ${stdout}`);
  return hash;
}

/**
 * Integration tests for Dolt branch lifecycle (tg start --branch, tg done merge, rollback).
 * Uses describe.serial so branch create/checkout/merge/delete don't overlap with other tests.
 */
describe.serial("Dolt branch lifecycle", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let taskId: string;
  let taskIdRollback: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const tempDir = context.tempDir;

    const plansDir = path.join(tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planContent = `---
name: Dolt Branch Test Plan
overview: Plan for Dolt branch lifecycle integration tests.
todos:
  - id: dolt-branch-a
    content: "Dolt branch happy path task"
    status: pending
  - id: dolt-branch-b
    content: "Dolt branch rollback task"
    status: pending
---
`;
    fs.writeFileSync(path.join(plansDir, "dolt-branch-plan.md"), planContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/dolt-branch-plan.md --plan "Dolt Branch Test Plan" --format cursor`,
      tempDir,
    );
    expect(importOut).toContain("Successfully imported");

    const { stdout: listOut } = await runTgCli(`plan list --json`, tempDir);
    const plans = JSON.parse(listOut) as Array<{
      plan_id: string;
      title: string;
    }>;
    const plan = plans.find((p) => p.title === "Dolt Branch Test Plan");
    expect(plan).toBeDefined();
    planId = plan?.plan_id;

    const { stdout: nextOut } = await runTgCli(
      `next --plan ${planId} --limit 5 --json`,
      tempDir,
    );
    const nextTasks = JSON.parse(nextOut) as Array<{
      task_id: string;
      title: string;
    }>;
    const first = nextTasks.find(
      (t) => t.title === "Dolt branch happy path task",
    );
    const second = nextTasks.find(
      (t) => t.title === "Dolt branch rollback task",
    );
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    taskId = first?.task_id;
    taskIdRollback = second?.task_id;
  }, 60000);

  afterAll(() => {
    if (context) {
      teardownIntegrationTest(context.tempDir);
    }
  });

  it("happy path then rollback: branch lifecycle and abandon", async () => {
    if (!context) throw new Error("Context not initialized");
    const tempDir = context.tempDir;
    const doltRepoPath = context.doltRepoPath;

    // --- Happy path: start with branch, verify branch, make changes, done with merge, verify on main, branch deleted ---
    let branches = await doltBranchList(doltRepoPath);
    expect(branches).not.toContain(agentBranchName(taskId));

    const { exitCode: startCode } = await runTgCli(
      `start ${taskId} --agent implementer-1 --branch`,
      tempDir,
    );
    expect(startCode).toBe(0);

    branches = await doltBranchList(doltRepoPath);
    expect(branches).toContain(agentBranchName(taskId));

    await runTgCli(
      `note ${taskId} --msg "branch lifecycle test note"`,
      tempDir,
    );

    const { exitCode: doneCode } = await runTgCli(
      `done ${taskId} --evidence "branch lifecycle test"`,
      tempDir,
    );
    expect(doneCode).toBe(0);

    branches = await doltBranchList(doltRepoPath);
    expect(branches).not.toContain(agentBranchName(taskId));

    const showOut = await runTgCli(`show ${taskId} --json`, tempDir);
    expect(showOut.exitCode).toBe(0);
    const showData = JSON.parse(showOut.stdout) as {
      taskDetails?: { status: string };
      events?: Array<{ kind: string }>;
    };
    expect(showData.taskDetails?.status).toBe("done");
    const hasNote = showData.events?.some((e) => e.kind === "note");
    expect(hasNote).toBe(true);

    // --- Rollback: start with branch, make changes, delete branch without merge, verify main unchanged ---
    const mainHeadBefore = await doltMainHead(doltRepoPath);

    const { exitCode: startCode2 } = await runTgCli(
      `start ${taskIdRollback} --agent implementer-1 --branch`,
      tempDir,
    );
    expect(startCode2).toBe(0);

    await runTgCli(
      `note ${taskIdRollback} --msg "rollback test note"`,
      tempDir,
    );

    const branchName = agentBranchName(taskIdRollback);
    await execa(DOLT_PATH, ["--data-dir", doltRepoPath, "checkout", "main"], {
      cwd: doltRepoPath,
      env: doltEnv(),
    });
    await execa(
      DOLT_PATH,
      ["--data-dir", doltRepoPath, "branch", "-D", branchName],
      {
        cwd: doltRepoPath,
        env: doltEnv(),
      },
    );

    const mainHeadAfter = await doltMainHead(doltRepoPath);
    expect(mainHeadAfter).toBe(mainHeadBefore);

    const branchesAfter = await doltBranchList(doltRepoPath);
    expect(branchesAfter).not.toContain(branchName);
  }, 60000);
});
