import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import execa from "execa";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

let wtAvailable = false;
try {
  execa.sync("wt", ["--version"]);
  wtAvailable = true;
} catch {
  // wt not on PATH
}

/**
 * When tg start --worktree fails with a worktree/Worktrunk error that has an
 * underlying cause (e.g. wt not on PATH), the CLI should surface that cause
 * in stderr (human output) and in the JSON error object when --json is set.
 */
describe.skipIf(wtAvailable)(
  "tg start surfaces error cause when worktree fails (wt not on PATH)",
  () => {
    let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
    let taskId: string;

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
      const planPath = path.join(plansDir, "start-cause-plan.md");
      fs.writeFileSync(
        planPath,
        `---
name: Start Error Cause Plan
overview: Plan for start error cause test.
todos:
  - id: cause-1
    content: "Task for cause test"
    status: pending
---
`,
      );

      await runTgCli(
        `import plans/start-cause-plan.md --plan "Start Error Cause Plan" --format cursor --no-commit`,
        tempDir,
      );
      const { stdout: listOut } = await runTgCli(`plan list --json`, tempDir);
      const plans = JSON.parse(listOut) as Array<{ plan_id: string; title: string }>;
      const planId = plans.find((p) => p.title === "Start Error Cause Plan")?.plan_id;
      expect(planId).toBeDefined();

      const { stdout: nextOut } = await runTgCli(
        `next --plan ${planId} --limit 1 --json`,
        tempDir,
      );
      const tasks = JSON.parse(nextOut) as Array<{ task_id: string; title: string }>;
      taskId = tasks[0]?.task_id;
      expect(taskId).toBeDefined();
    }, 60000);

    afterAll(async () => {
      if (context) await teardownIntegrationTest(context);
    }, 60_000);

    it("human output includes cause line when start fails with worktree error", async () => {
      if (!context) throw new Error("Context not initialized");
      const { exitCode, stderr } = await runTgCli(
        `start ${taskId} --worktree --no-commit`,
        context.tempDir,
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain(" Cause:");
    });

    it("JSON output includes cause when start fails with worktree error", async () => {
      if (!context) throw new Error("Context not initialized");
      const { exitCode, stdout } = await runTgCli(
        `start ${taskId} --worktree --json --no-commit`,
        context.tempDir,
      );
      expect(exitCode).toBe(1);
      const results = JSON.parse(stdout) as Array<{ id: string; error?: string; cause?: string }>;
      expect(results.length).toBeGreaterThanOrEqual(1);
      const errItem = results.find((r) => "error" in r && r.error);
      expect(errItem).toBeDefined();
      expect(errItem).toHaveProperty("cause");
      expect(typeof (errItem as { cause?: string }).cause).toBe("string");
    });
  },
);
