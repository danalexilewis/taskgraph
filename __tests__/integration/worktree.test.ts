import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import execa from "execa";

const execaSync = execa.sync;

import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

let wtAvailable = false;
try {
  execaSync("wt", ["--version"]);
  wtAvailable = true;
} catch {
  // wt not on PATH
}

/**
 * Integration tests for worktree creation and cleanup.
 * Uses describe.serial so worktree create/remove steps don't overlap.
 * Requires a git repo in the test temp dir; we init git and make an initial commit in beforeAll.
 *
 * Raw git backend: worktrees at .taskgraph/worktrees/<taskId>, branch tg/<taskId>.
 */
describe("Worktree creation and cleanup (raw git backend)", () => {
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

    // Force raw git backend so auto-detection doesn't pick up wt
    const configPath = path.join(tempDir, ".taskgraph", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    config.useWorktrunk = false;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

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
  }, 60_000);

  function worktreeListJson(
    cwd: string,
  ): Promise<Array<{ path: string; branch?: string }>> {
    return runTgCli("worktree list --json", cwd).then((r) => {
      expect(r.exitCode).toBe(0);
      return JSON.parse(r.stdout) as Array<{ path: string; branch?: string }>;
    });
  }

  /** Raw git backend: path is .taskgraph/worktrees/<taskId>, branch is tg/<taskId> or tg-<hashId>. */
  function hasWorktreeForTask(
    entries: Array<{ path: string; branch?: string }>,
    id: string,
  ): boolean {
    return entries.some(
      (e) =>
        e.path.includes(".taskgraph/worktrees") &&
        e.path.includes(id) &&
        (e.branch === `tg/${id}` || (e.branch?.startsWith("tg-") ?? false)),
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

/**
 * Worktrunk backend tests. Skipped when wt is not on PATH.
 * Worktrees are created via wt (path wherever wt puts it), branch tg-<hashId>.
 */
describe.skipIf(!wtAvailable)("Worktree with Worktrunk backend", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let taskId: string;
  let taskId2: string;
  let taskId3: string;

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
    config.useWorktrunk = true;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const plansDir = path.join(tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planPath = path.join(plansDir, "worktree-wt-plan.md");
    const planContent = `---
name: Worktree Worktrunk Plan
overview: "Plan for Worktrunk backend tests."
todos:
  - id: wt-1
    content: "Worktrunk task 1"
    status: pending
  - id: wt-2
    content: "Worktrunk task 2"
    status: pending
  - id: wt-3
    content: "Worktrunk task 3"
    status: pending
---
`;
    fs.writeFileSync(planPath, planContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/worktree-wt-plan.md --plan "Worktree Worktrunk Plan" --format cursor --no-commit`,
      tempDir,
    );
    expect(importOut).toContain("Successfully imported");

    const { stdout: listOut } = await runTgCli(`plan list --json`, tempDir);
    const plans = JSON.parse(listOut) as Array<{
      plan_id: string;
      title: string;
    }>;
    const plan = plans.find((p) => p.title === "Worktree Worktrunk Plan");
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
    const first = nextTasks.find((t) => t.title === "Worktrunk task 1");
    const second = nextTasks.find((t) => t.title === "Worktrunk task 2");
    const third = nextTasks.find((t) => t.title === "Worktrunk task 3");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    taskId = first?.task_id;
    taskId2 = second?.task_id;
    taskId3 = third?.task_id;
  }, 60000);

  afterAll(async () => {
    if (context) {
      await teardownIntegrationTest(context);
    }
  }, 60_000);

  function wtListJson(cwd: string): Array<{ path: string; branch?: string }> {
    const result = execaSync("wt", ["list", "--format", "json", "-C", cwd], {
      cwd,
    });
    return JSON.parse(result.stdout) as Array<{
      path: string;
      branch?: string;
    }>;
  }

  it("tg start --worktree creates worktree via wt; tg done removes it", async () => {
    if (!context) throw new Error("Context not initialized");
    const tempDir = context.tempDir;

    let list = wtListJson(tempDir);
    const branchBefore = list.find((e) => e.branch?.startsWith("tg-"));
    expect(branchBefore).toBeUndefined();

    const { exitCode: startCode } = await runTgCli(
      `start ${taskId} --agent implementer-1 --worktree --no-commit`,
      tempDir,
    );
    expect(startCode).toBe(0);

    list = wtListJson(tempDir);
    const entry = list.find((e) => e.branch?.startsWith("tg-"));
    expect(entry).toBeDefined();
    expect(entry?.branch).toBeDefined();
    expect(entry?.branch?.startsWith("tg-")).toBe(true);
    expect(entry?.branch?.startsWith("tg/")).toBe(false);
    expect(entry?.path).not.toContain(".taskgraph/worktrees/");

    const { stdout: tgListOut } = await runTgCli(
      "worktree list --json",
      tempDir,
    );
    const tgEntries = JSON.parse(tgListOut) as Array<{
      path: string;
      branch?: string;
    }>;
    const tgEntry = tgEntries.find((e) => e.branch?.startsWith("tg-"));
    expect(tgEntry).toBeDefined();
    expect(tgEntry?.path).not.toContain(".taskgraph/worktrees/");
    expect(tgEntry?.branch).toMatch(/^tg-/);

    const doneResult = await runTgCli(
      `done ${taskId} --evidence "worktree wt test" --no-commit`,
      tempDir,
    ).catch((e) => ({ stdout: "", stderr: String(e), exitCode: 1 }));
    if (doneResult.exitCode !== 0) {
      throw new Error(
        `tg done failed: exitCode=${doneResult.exitCode}\nstderr: ${doneResult.stderr}\nstdout: ${doneResult.stdout}`,
      );
    }

    list = wtListJson(tempDir);
    const branchAfter = list.find((e) => e.branch?.startsWith("tg-"));
    expect(branchAfter).toBeUndefined();
  }, 30000);

  it("copy-ignored: after start, worktree contains copied ignored content when source has it", async () => {
    if (!context) throw new Error("Context not initialized");
    const tempDir = context.tempDir;

    const gitignorePath = path.join(tempDir, ".gitignore");
    const existing = fs.readFileSync(gitignorePath, "utf-8");
    if (!existing.includes("test-ignored")) {
      fs.writeFileSync(gitignorePath, existing.trimEnd() + "\ntest-ignored\n");
    }
    const ignoredDir = path.join(tempDir, "test-ignored");
    fs.mkdirSync(ignoredDir, { recursive: true });
    fs.writeFileSync(path.join(ignoredDir, "stub.txt"), "copied");

    const { exitCode: startCode, stdout: startStdout } = await runTgCli(
      `start ${taskId3} --agent implementer-1 --worktree --no-commit --json`,
      tempDir,
    );
    expect(startCode).toBe(0);
    const startResults = JSON.parse(startStdout) as Array<{
      id: string;
      status: string;
      worktree_path?: string;
    }>;
    expect(startResults.length).toBe(1);
    expect(startResults[0].status).toBe("doing");
    expect(startResults[0].worktree_path).toBeDefined();
    expect(typeof startResults[0].worktree_path).toBe("string");
    expect((startResults[0].worktree_path as string).length).toBeGreaterThan(0);
    const worktreePath = path.isAbsolute(startResults[0].worktree_path as string)
      ? (startResults[0].worktree_path as string)
      : path.resolve(tempDir, startResults[0].worktree_path as string);

    const copiedStub = path.join(worktreePath, "test-ignored", "stub.txt");
    expect(fs.existsSync(copiedStub)).toBe(true);
    expect(fs.readFileSync(copiedStub, "utf-8")).toBe("copied");

    const doneResult = await runTgCli(
      `done ${taskId3} --evidence "copy-ignored test" --no-commit`,
      tempDir,
    ).catch((e) => ({ stdout: "", stderr: String(e), exitCode: 1 }));
    if (doneResult.exitCode !== 0) {
      throw new Error(
        `tg done failed: exitCode=${doneResult.exitCode}\nstderr: ${doneResult.stderr}`,
      );
    }
  }, 30000);

  it("tg start --worktree then tg done --merge merges and removes via wt", async () => {
    if (!context) throw new Error("Context not initialized");
    const tempDir = context.tempDir;

    await execa("git", ["checkout", "main"], { cwd: tempDir });

    const { exitCode: startCode } = await runTgCli(
      `start ${taskId2} --agent implementer-1 --worktree --no-commit`,
      tempDir,
    );
    expect(startCode).toBe(0);

    let list = wtListJson(tempDir);
    const entryBefore = list.find((e) => e.branch?.startsWith("tg-"));
    expect(entryBefore).toBeDefined();
    expect(entryBefore?.path).not.toContain(".taskgraph/worktrees/");

    const doneResult2 = await runTgCli(
      `done ${taskId2} --evidence "worktree merge wt test" --merge --no-commit`,
      tempDir,
    ).catch((e) => ({ stdout: "", stderr: String(e), exitCode: 1 }));
    if (doneResult2.exitCode !== 0) {
      throw new Error(
        `tg done --merge failed: exitCode=${doneResult2.exitCode}\nstderr: ${doneResult2.stderr}\nstdout: ${doneResult2.stdout}`,
      );
    }

    list = wtListJson(tempDir);
    const branchAfter = list.find((e) => e.branch?.startsWith("tg-"));
    expect(branchAfter).toBeUndefined();
  }, 30000);
});
