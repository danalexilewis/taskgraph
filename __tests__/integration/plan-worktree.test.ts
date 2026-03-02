import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import execa from "execa";

const execaSync = execa.sync;

import { doltSql } from "../../src/db/connection";
import { query } from "../../src/db/query";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

/**
 * Integration tests for plan-level worktree creation, reuse, commit flow, and plan-branch merge.
 * Raw git backend: plan branch plan-<hash_id>, per-task worktrees at .taskgraph/worktrees/<taskId>.
 */
describe("Plan-level worktree creation, reuse, commit flow, and plan-branch merge", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let taskId1: string;
  let taskId2: string;
  let taskId3: string;
  let planBranchName: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const tempDir = context.tempDir;

    await execa("git", ["init"], { cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, ".gitignore"), ".taskgraph/dolt\n");
    await execa("git", ["add", "."], { cwd: tempDir });
    await execa("git", ["commit", "-m", "initial"], { cwd: tempDir });
    await execa("git", ["branch", "-M", "main"], { cwd: tempDir });

    const configPath = path.join(tempDir, ".taskgraph", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    config.useWorktrunk = false;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const plansDir = path.join(tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planPath = path.join(plansDir, "plan-worktree-plan.md");
    const planContent = `---
name: Plan Worktree Test Plan
overview: "Plan for plan-level worktree integration tests."
todos:
  - id: pw-1
    content: "Plan worktree task 1"
    status: pending
  - id: pw-2
    content: "Plan worktree task 2"
    status: pending
  - id: pw-3
    content: "Plan worktree task 3"
    status: pending
---
`;
    fs.writeFileSync(planPath, planContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/plan-worktree-plan.md --plan "Plan Worktree Test Plan" --format cursor --no-commit`,
      tempDir,
    );
    expect(importOut).toContain("Successfully imported");

    const { stdout: listOut } = await runTgCli(`plan list --json`, tempDir);
    const plans = JSON.parse(listOut) as Array<{
      plan_id: string;
      title: string;
    }>;
    const plan = plans.find((p) => p.title === "Plan Worktree Test Plan");
    expect(plan).toBeDefined();
    planId = plan?.plan_id ?? "";

    const planHashId = `p-${planId.replace(/-/g, "").toLowerCase().slice(0, 6)}`;
    const q = query(context.doltRepoPath);
    const backfillResult = await q.update(
      "project",
      { hash_id: planHashId },
      { plan_id: planId },
    );
    if (backfillResult.isErr()) throw backfillResult.error;

    const { stdout: nextOut } = await runTgCli(
      `next --plan ${planId} --limit 5 --json`,
      tempDir,
    );
    const nextTasks = JSON.parse(nextOut) as Array<{
      task_id: string;
      title: string;
    }>;
    const t1 = nextTasks.find((t) => t.title === "Plan worktree task 1");
    const t2 = nextTasks.find((t) => t.title === "Plan worktree task 2");
    const t3 = nextTasks.find((t) => t.title === "Plan worktree task 3");
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t3).toBeDefined();
    taskId1 = t1?.task_id ?? "";
    taskId2 = t2?.task_id ?? "";
    taskId3 = t3?.task_id ?? "";
  }, 60000);

  afterAll(async () => {
    if (context) {
      await teardownIntegrationTest(context);
    }
  }, 60_000);

  function worktreeListJson(
    cwd: string,
  ): Promise<Array<{ path: string; branch?: string }>> {
    return runTgCli("worktree list --json", cwd).then((r) => {
      expect(r.exitCode).toBe(0);
      return JSON.parse(r.stdout) as Array<{
        path: string;
        branch?: string;
      }>;
    });
  }

  function gitBranches(cwd: string): string[] {
    const r = execaSync("git", ["branch", "--list"], { cwd });
    return r.stdout
      .trim()
      .split(/\n/)
      .map((s) =>
        s
          .replace(/^\*?\s*/, "")
          .replace(/^\+\s*/, "")
          .trim(),
      )
      .filter(Boolean);
  }

  async function getPlanHashId(pId: string): Promise<string | null> {
    const result = await doltSql(
      `SELECT hash_id FROM \`project\` WHERE plan_id = '${pId}'`,
      context?.doltRepoPath,
    );
    if (result.isErr() || result.value.length === 0) return null;
    const row = result.value[0] as { hash_id: string | null };
    return row.hash_id ?? null;
  }

  async function getPlanWorktreeRow(pId: string): Promise<{
    worktree_path: string;
    worktree_branch: string;
  } | null> {
    const result = await doltSql(
      `SELECT worktree_path, worktree_branch FROM \`plan_worktree\` WHERE plan_id = '${pId}'`,
      context?.doltRepoPath,
    );
    if (result.isErr() || result.value.length === 0) return null;
    const row = result.value[0] as {
      worktree_path: string;
      worktree_branch: string;
    };
    return row;
  }

  async function getStartedEventBody(
    tId: string,
  ): Promise<{ plan_branch?: string } | null> {
    const result = await doltSql(
      `SELECT body FROM \`event\` WHERE task_id = '${tId}' AND kind = 'started' ORDER BY created_at DESC LIMIT 1`,
      context?.doltRepoPath,
    );
    if (result.isErr() || result.value.length === 0) return null;
    const row = result.value[0] as { body: string | object };
    const raw = row.body;
    if (raw == null) return null;
    const parsed =
      typeof raw === "string" ? (JSON.parse(raw) as object) : (raw as object);
    const out = parsed as { plan_branch?: string };
    if (
      typeof out.plan_branch === "string" &&
      out.plan_branch.startsWith('"') &&
      out.plan_branch.endsWith('"')
    ) {
      try {
        out.plan_branch = JSON.parse(out.plan_branch) as string;
      } catch {
        out.plan_branch = out.plan_branch.slice(1, -1);
      }
    }
    return out;
  }

  it("(1) tg start --worktree on task 1: plan hash_id set, plan_worktree row exists, plan-<hash> branch created, per-task worktree from plan branch", async () => {
    if (!context) throw new Error("Context not initialized");
    const tempDir = context.tempDir;

    const hashBefore = await getPlanHashId(planId);
    expect(hashBefore).toBeTruthy();
    planBranchName = `plan-${hashBefore}`;

    const { exitCode: startCode } = await runTgCli(
      `start ${taskId1} --agent implementer-1 --worktree --no-commit`,
      tempDir,
    );
    expect(startCode).toBe(0);

    const hashAfter = await getPlanHashId(planId);
    expect(hashAfter).toBe(hashBefore);

    const pw = await getPlanWorktreeRow(planId);
    expect(pw).toBeDefined();
    expect(pw?.worktree_branch).toBe(planBranchName);
    expect(pw?.worktree_path).toBeTruthy();
    expect(fs.existsSync(pw?.worktree_path)).toBe(true);

    const branches = gitBranches(tempDir);
    expect(branches).toContain(planBranchName);

    const list = await worktreeListJson(tempDir);
    const task1Entry = list.find(
      (e) =>
        e.path.includes(".taskgraph/worktrees") && e.path.includes(taskId1),
    );
    expect(task1Entry).toBeDefined();
    expect(task1Entry?.branch).toBeTruthy();

    const startedBody = await getStartedEventBody(taskId1);
    expect(startedBody?.plan_branch).toBe(planBranchName);
  }, 30000);

  it("(2) tg start --worktree on task 2 of same plan: plan_worktree row exists, same plan branch in started event, fresh per-task worktree", async () => {
    if (!context) throw new Error("Context not initialized");
    const tempDir = context.tempDir;

    const pwBefore = await getPlanWorktreeRow(planId);
    expect(pwBefore).toBeDefined();
    expect(pwBefore?.worktree_branch).toBe(planBranchName);

    const { exitCode: startCode } = await runTgCli(
      `start ${taskId2} --agent implementer-1 --worktree --no-commit`,
      tempDir,
    );
    expect(startCode).toBe(0);

    const pwAfter = await getPlanWorktreeRow(planId);
    expect(pwAfter).toBeDefined();
    expect(pwAfter?.worktree_branch).toBe(planBranchName);

    const startedBody = await getStartedEventBody(taskId2);
    expect(startedBody?.plan_branch).toBe(planBranchName);

    const list = await worktreeListJson(tempDir);
    const task2Entry = list.find(
      (e) =>
        e.path.includes(".taskgraph/worktrees") && e.path.includes(taskId2),
    );
    expect(task2Entry).toBeDefined();
  }, 30000);

  it("(3) tg done (no --merge) on a mid-plan task: plan_worktree still exists, plan branch not removed", async () => {
    if (!context) throw new Error("Context not initialized");
    const tempDir = context.tempDir;

    const doneResult = await runTgCli(
      `done ${taskId1} --evidence "done without merge" --no-commit`,
      tempDir,
    ).catch((e) => ({
      exitCode: 1,
      stdout: "",
      stderr: e instanceof Error ? e.message : String(e),
    }));
    if (doneResult.exitCode !== 0) {
      // eslint-disable-next-line no-console
      console.log("tg done stderr:", doneResult.stderr);
      await execa(
        "git",
        ["worktree", "remove", "--force", `.taskgraph/worktrees/${taskId1}`],
        { cwd: tempDir },
      ).catch(() => {});
    }
    expect(doneResult.exitCode).toBe(0);

    const pw = await getPlanWorktreeRow(planId);
    expect(pw).toBeDefined();
    expect(pw?.worktree_branch).toBe(planBranchName);

    const branches = gitBranches(tempDir);
    expect(branches).toContain(planBranchName);
  }, 30000);

  it("(4) tg done --merge on a task: per-task branch merged into plan branch (not main), plan branch contains task commit", async () => {
    if (!context) throw new Error("Context not initialized");
    const tempDir = context.tempDir;

    const list = await worktreeListJson(tempDir);
    const task2Entry = list.find(
      (e) =>
        e.path.includes(".taskgraph/worktrees") && e.path.includes(taskId2),
    );
    expect(task2Entry).toBeDefined();
    const worktreePath = task2Entry?.path.startsWith("/")
      ? task2Entry?.path
      : path.join(tempDir, task2Entry?.path);
    if (!fs.existsSync(worktreePath)) {
      throw new Error(`Worktree path not found: ${worktreePath}`);
    }
    fs.writeFileSync(
      path.join(worktreePath, "task2-file.txt"),
      "task 2 commit",
    );
    await execa("git", ["add", "task2-file.txt"], { cwd: worktreePath });
    await execa("git", ["commit", "-m", "task 2 work"], {
      cwd: worktreePath,
    });

    const doneResult = await runTgCli(
      `done ${taskId2} --evidence "merge test" --merge --no-commit`,
      tempDir,
    ).catch((e) => ({ exitCode: 1, stdout: "", stderr: String(e) }));
    if (doneResult.exitCode !== 0) {
      console.error("TEST4 done --merge failed:", doneResult.stderr);
      await execa(
        "git",
        ["worktree", "remove", "--force", `.taskgraph/worktrees/${taskId2}`],
        { cwd: tempDir },
      ).catch(() => {});
    }
    expect(doneResult.exitCode).toBe(0);

    // The plan branch is checked out in the plan worktree — we cannot
    // git checkout to it from the main repo (git would error "already used
    // by worktree"). Read the log directly from the plan worktree path.
    const pw4 = await getPlanWorktreeRow(planId);
    expect(pw4).toBeDefined();
    const planWtPath4 = pw4?.worktree_path;
    const logOut = await execa("git", ["log", "--oneline", "-5"], {
      cwd: planWtPath4,
    });
    expect(logOut.stdout).toContain("task 2 work");
    const catOut = await execa("git", ["show", "HEAD:task2-file.txt"], {
      cwd: planWtPath4,
    });
    expect(catOut.stdout.trim()).toBe("task 2 commit");
  }, 30000);

  it("(5) tg done --merge on a second task: plan branch has both task commits", async () => {
    if (!context) throw new Error("Context not initialized");
    const tempDir = context.tempDir;

    const { exitCode: startCode } = await runTgCli(
      `start ${taskId3} --agent implementer-1 --worktree --no-commit`,
      tempDir,
    );
    expect(startCode).toBe(0);

    const list = await worktreeListJson(tempDir);
    const task3Entry = list.find(
      (e) =>
        e.path.includes(".taskgraph/worktrees") && e.path.includes(taskId3),
    );
    expect(task3Entry).toBeDefined();
    const worktreePath = task3Entry?.path.startsWith("/")
      ? task3Entry?.path
      : path.join(tempDir, task3Entry?.path);
    if (!fs.existsSync(worktreePath)) {
      throw new Error(`Worktree path not found: ${worktreePath}`);
    }
    fs.writeFileSync(
      path.join(worktreePath, "task3-file.txt"),
      "task 3 commit",
    );
    await execa("git", ["add", "task3-file.txt"], { cwd: worktreePath });
    await execa("git", ["commit", "-m", "task 3 work"], {
      cwd: worktreePath,
    });

    const doneResult = await runTgCli(
      `done ${taskId3} --evidence "merge test 2" --merge --no-commit`,
      tempDir,
    ).catch((e) => ({ exitCode: 1, stdout: "", stderr: String(e) }));
    if (doneResult.exitCode !== 0) {
      console.error("TEST5 done --merge failed:", doneResult.stderr);
      await execa(
        "git",
        ["worktree", "remove", "--force", `.taskgraph/worktrees/${taskId3}`],
        { cwd: tempDir },
      ).catch(() => {});
    }
    expect(doneResult.exitCode).toBe(0);

    // Read from the plan worktree directly (plan branch is locked there).
    const pw5 = await getPlanWorktreeRow(planId);
    expect(pw5).toBeDefined();
    const planWtPath5 = pw5?.worktree_path;
    const logOut = await execa("git", ["log", "--oneline", "-5"], {
      cwd: planWtPath5,
    });
    expect(logOut.stdout).toContain("task 3 work");
    expect(logOut.stdout).toContain("task 2 work");
    expect(fs.existsSync(path.join(planWtPath5, "task2-file.txt"))).toBe(true);
    expect(fs.existsSync(path.join(planWtPath5, "task3-file.txt"))).toBe(true);
  }, 30000);

  it("(6) Race: two sequential tg start --worktree for the same plan both succeed", async () => {
    if (!context) throw new Error("Context not initialized");
    const tempDir = context.tempDir;

    const plansDir = path.join(tempDir, "plans");
    const racePlanPath = path.join(plansDir, "plan-worktree-race.md");
    const racePlanContent = `---
name: Plan Worktree Race Plan
overview: "Plan for race test."
todos:
  - id: race-a
    content: "Race task A"
    status: pending
  - id: race-b
    content: "Race task B"
    status: pending
---
`;
    fs.writeFileSync(racePlanPath, racePlanContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/plan-worktree-race.md --plan "Plan Worktree Race Plan" --format cursor --no-commit`,
      tempDir,
    );
    expect(importOut).toContain("Successfully imported");

    const { stdout: listOut } = await runTgCli(`plan list --json`, tempDir);
    const plans = JSON.parse(listOut) as Array<{
      plan_id: string;
      title: string;
    }>;
    const racePlan = plans.find((p) => p.title === "Plan Worktree Race Plan");
    expect(racePlan).toBeDefined();
    const racePlanId = racePlan?.plan_id ?? "";

    const raceHashId = `p-${racePlanId.replace(/-/g, "").toLowerCase().slice(0, 6)}`;
    const q = query(context.doltRepoPath);
    const backfillRace = await q.update(
      "project",
      { hash_id: raceHashId },
      { plan_id: racePlanId },
    );
    if (backfillRace.isErr()) throw backfillRace.error;

    const { stdout: nextOut } = await runTgCli(
      `next --plan ${racePlanId} --limit 5 --json`,
      tempDir,
    );
    const nextTasks = JSON.parse(nextOut) as Array<{
      task_id: string;
      title: string;
    }>;
    const raceA = nextTasks.find((t) => t.title === "Race task A");
    const raceB = nextTasks.find((t) => t.title === "Race task B");
    expect(raceA).toBeDefined();
    expect(raceB).toBeDefined();
    const raceTaskIdA = raceA?.task_id ?? "";
    const raceTaskIdB = raceB?.task_id ?? "";

    const startA = await runTgCli(
      `start ${raceTaskIdA} --agent implementer-1 --worktree --no-commit`,
      tempDir,
    );
    expect(startA.exitCode).toBe(0);

    const startB = await runTgCli(
      `start ${raceTaskIdB} --agent implementer-1 --worktree --no-commit`,
      tempDir,
    );
    expect(startB.exitCode).toBe(0);

    const bodyA = await getStartedEventBody(raceTaskIdA);
    const bodyB = await getStartedEventBody(raceTaskIdB);
    expect(bodyA?.plan_branch).toBeTruthy();
    expect(bodyB?.plan_branch).toBe(bodyA?.plan_branch);

    const pw = await getPlanWorktreeRow(racePlanId);
    expect(pw).toBeDefined();

    await runTgCli(
      `done ${raceTaskIdA} --evidence "race cleanup" --no-commit`,
      tempDir,
    ).catch(() => {});
    await runTgCli(
      `done ${raceTaskIdB} --evidence "race cleanup" --no-commit`,
      tempDir,
    ).catch(() => {});
    await execa(
      "git",
      ["worktree", "remove", "--force", `.taskgraph/worktrees/${raceTaskIdA}`],
      { cwd: tempDir },
    ).catch(() => {});
    await execa(
      "git",
      ["worktree", "remove", "--force", `.taskgraph/worktrees/${raceTaskIdB}`],
      { cwd: tempDir },
    ).catch(() => {});
  }, 30000);
});
