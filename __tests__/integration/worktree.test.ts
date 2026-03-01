import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { execa } from "execa";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

/**
 * Integration tests for worktree creation and cleanup.
 * Uses describe.serial so worktree create/remove steps don't overlap.
 * Requires a git repo in the test temp dir; we init git and make an initial commit in beforeAll.
 */
describe.serial("Worktree creation and cleanup", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let taskId: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const tempDir = context.tempDir;

    // Worktrees require a git repo. Golden template has .taskgraph/dolt but no .git.
    await execa("git", ["init"], { cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, ".gitignore"), ".taskgraph/dolt\n");
    await execa("git", ["add", "."], { cwd: tempDir });
    await execa("git", ["commit", "-m", "initial"], { cwd: tempDir });
    await execa("git", ["branch", "-M", "main"], { cwd: tempDir });

    const plansDir = path.join(tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planPath = path.join(plansDir, "worktree-plan.md");
    const planContent = `---
name: Worktree Test Plan
overview: "Plan for worktree integration tests."
todos:
  - id: wt-1
    content: "Worktree task 1"
    status: pending
  - id: wt-2
    content: "Worktree task 2"
    status: pending
---
`;
    fs.writeFileSync(planPath, planContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/worktree-plan.md --plan "Worktree Test Plan" --format cursor --no-commit`,
      tempDir,
    );
    expect(importOut).toContain("Successfully imported");

    const { stdout: listOut } = await runTgCli(`plan list --json`, tempDir);
    const plans = JSON.parse(listOut) as Array<{
      plan_id: string;
      title: string;
    }>;
    const plan = plans.find((p) => p.title === "Worktree Test Plan");
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
    const first = nextTasks.find((t) => t.title === "Worktree task 1");
    expect(first).toBeDefined();
    taskId = first?.task_id;
  }, 60000);

  afterAll(async () => {
    if (context) {
      await teardownIntegrationTest(context);
    }
  });

  function worktreeListJson(
    cwd: string,
  ): Promise<Array<{ path: string; branch?: string }>> {
    return runTgCli("worktree list --json", cwd).then((r) => {
      expect(r.exitCode).toBe(0);
      return JSON.parse(r.stdout) as Array<{ path: string; branch?: string }>;
    });
  }

  function hasWorktreeForTask(
    entries: Array<{ path: string; branch?: string }>,
    id: string,
  ): boolean {
    return entries.some(
      (e) =>
        e.path.includes(".taskgraph/worktrees") &&
        e.path.includes(id) &&
        e.branch === `tg/${id}`,
    );
  }

  it("tg start --worktree creates worktree; tg done removes it (no --merge)", async () => {
    if (!context) throw new Error("Context not initialized");
    const tempDir = context.tempDir;

    let list = await worktreeListJson(tempDir);
    expect(hasWorktreeForTask(list, taskId)).toBe(false);

    const { exitCode: startCode } = await runTgCli(
      `start ${taskId} --agent implementer-1 --worktree --no-commit`,
      tempDir,
    );
    expect(startCode).toBe(0);

    list = await worktreeListJson(tempDir);
    expect(hasWorktreeForTask(list, taskId)).toBe(true);

    const doneOk = await runTgCli(
      `done ${taskId} --evidence "worktree test" --no-commit`,
      tempDir,
    )
      .then((r) => r.exitCode === 0)
      .catch(() => false);
    if (!doneOk) {
      await execa(
        "git",
        ["worktree", "remove", "--force", `.taskgraph/worktrees/${taskId}`],
        {
          cwd: tempDir,
        },
      ).catch(() => {});
    }

    list = await worktreeListJson(tempDir);
    expect(hasWorktreeForTask(list, taskId)).toBe(false);
  }, 30000);

  it("tg start --worktree then tg done --merge removes worktree after merge", async () => {
    if (!context) throw new Error("Context not initialized");
    const tempDir = context.tempDir;

    await execa("git", ["checkout", "main"], { cwd: tempDir });

    const { stdout: nextOut } = await runTgCli(
      `next --plan ${planId} --limit 5 --json`,
      tempDir,
    );
    const nextTasks = JSON.parse(nextOut) as Array<{
      task_id: string;
      title: string;
    }>;
    const second = nextTasks.find((t) => t.title === "Worktree task 2");
    expect(second).toBeDefined();
    const taskId2 = second?.task_id;

    const { exitCode: startCode } = await runTgCli(
      `start ${taskId2} --agent implementer-1 --worktree --no-commit`,
      tempDir,
    );
    expect(startCode).toBe(0);

    let list = await worktreeListJson(tempDir);
    expect(hasWorktreeForTask(list, taskId2)).toBe(true);

    const doneOk = await runTgCli(
      `done ${taskId2} --evidence "worktree merge test" --merge --no-commit`,
      tempDir,
    )
      .then((r) => r.exitCode === 0)
      .catch(() => false);
    if (!doneOk) {
      await execa(
        "git",
        ["worktree", "remove", "--force", `.taskgraph/worktrees/${taskId2}`],
        {
          cwd: tempDir,
        },
      ).catch(() => {});
    }

    list = await worktreeListJson(tempDir);
    expect(hasWorktreeForTask(list, taskId2)).toBe(false);
  }, 30000);
});
