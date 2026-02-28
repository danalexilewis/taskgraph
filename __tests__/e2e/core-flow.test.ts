import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";

const CLI_PATH = path.resolve(__dirname, "../../dist/cli/index.js");
const TG_BIN = `node ${CLI_PATH} `;
const DOLT_PATH = process.env.DOLT_PATH || "/usr/local/bin/dolt";

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runTg(
  command: string,
  cwd: string,
  expectError = false,
  env?: Record<string, string>,
): Promise<CliResult> {
  try {
    const { stdout, stderr, exitCode } = await execa(TG_BIN + command, {
      cwd,
      shell: true,
      env: { ...process.env, DOLT_PATH, ...env },
    });
    if (expectError && exitCode === 0) {
      throw new Error(
        `Expected command to fail but it succeeded. Output: ${stdout}, Error: ${stderr}`,
      );
    }
    if (!expectError && exitCode !== 0) {
      throw new Error(
        `Command failed unexpectedly. Exit Code: ${exitCode}, Output: ${stdout}, Error: ${stderr}`,
      );
    }
    return { stdout, stderr, exitCode: exitCode ?? 0 };
  } catch (error: unknown) {
    if (expectError) {
      const e = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
        exitCode?: number;
      };
      return {
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? e.message ?? "",
        exitCode: e.exitCode ?? 1,
      };
    }
    throw error;
  }
}

describe("Task Graph CLI E2E Tests", () => {
  let tempDir: string;
  let _doltRepoPath: string;

  beforeAll(async () => {
    // Create a temporary directory for each test suite
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-e2e-"));
    _doltRepoPath = path.join(tempDir, ".taskgraph", "dolt");

    // Ensure CLI is built (run from package root)
    await execa("pnpm run build", {
      cwd: path.resolve(__dirname, "../.."),
      shell: true,
    });

    // Initialize the task graph once for the suite
    const { exitCode: initExitCode, stderr: initStderr } = await runTg(
      "init",
      tempDir,
    );
    if (initExitCode !== 0) {
      throw new Error(
        `Failed to initialize task graph in beforeAll: ${initStderr}`,
      );
    }
  }, 60000);

  afterAll(() => {
    // Clean up the temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should create a new plan", async () => {
    const { stdout, exitCode } = await runTg(
      'plan new "Auth Feature" --intent "Implement authentication"',
      tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Plan created with ID:");

    const planIdMatch = stdout.match(/Plan created with ID: (.*)/);
    expect(planIdMatch).not.toBeNull();
    const _planId = planIdMatch?.[1].trim();

    // Verify plan new --json returns valid output (basic check)
    const { stdout: jsonStdout } = await runTg(
      `plan new "Temp Plan" --json`,
      tempDir,
    );
    const planObj = JSON.parse(jsonStdout);
    expect(planObj).toHaveProperty("plan_id");
    expect(planObj.title).toBe("Temp Plan");
  });

  let planId: string;
  let task1Id: string;
  let task2Id: string;
  let _task3Id: string;

  it("should create tasks and establish a blocking dependency", async () => {
    const planResult = await runTg('plan new "Core Flow Plan" --json', tempDir);
    planId = JSON.parse(planResult.stdout).plan_id;

    const task1Result = await runTg(
      `task new "Design API" --plan ${planId} --feature auth --area backend --json`,
      tempDir,
    );
    task1Id = JSON.parse(task1Result.stdout).task_id;
    expect(task1Id).toBeDefined();

    const task2Result = await runTg(
      `task new "Implement API" --plan ${planId} --feature auth --area backend --json`,
      tempDir,
    );
    task2Id = JSON.parse(task2Result.stdout).task_id;
    expect(task2Id).toBeDefined();

    const edgeResult = await runTg(
      `edge add ${task1Id} blocks ${task2Id} --reason "API must be designed first"`,
      tempDir,
    );
    expect(edgeResult.exitCode).toBe(0);
    expect(edgeResult.stdout).toContain(
      `Edge added: ${task1Id} blocks ${task2Id}`,
    );
  });

  it("should show only runnable tasks, with blocked tasks excluded", async () => {
    const { stdout, exitCode } = await runTg(`next --plan ${planId}`, tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(task1Id);
    expect(stdout).not.toContain(task2Id);
  });

  it("should show task details including blockers and dependents", async () => {
    const { stdout, exitCode } = await runTg(`show ${task2Id}`, tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Task Details (ID: ${task2Id}):`);
    expect(stdout).toContain(`Title: Implement API`);
    expect(stdout).toContain(`Blockers:`);
    expect(stdout).toContain(`- Task ID: ${task1Id}`);
  });

  it("should start a runnable task", async () => {
    const { stdout, exitCode } = await runTg(`start ${task1Id}`, tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Task ${task1Id} started.`);

    // Verify status update
    const { stdout: showOutput } = await runTg(`show ${task1Id}`, tempDir);
    expect(showOutput).toContain(`Status: doing`);
  });

  it("should not allow starting a blocked task", async () => {
    const { stdout, stderr, exitCode } = await runTg(
      `start ${task2Id}`,
      tempDir,
      true,
    );
    expect(exitCode).toBe(1);
    const errOutput = stderr || stdout;
    expect(errOutput).toContain(task2Id);
    expect(errOutput).toMatch(/not runnable|unmet blockers|not in 'todo'/);
  });

  it("should complete a task", async () => {
    const { stdout, exitCode } = await runTg(
      `done ${task1Id} --evidence "API designed and spec'd"`,
      tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Task ${task1Id} marked as done.`);

    // Verify status update
    const { stdout: showOutput } = await runTg(`show ${task1Id}`, tempDir);
    expect(showOutput).toContain(`Status: done`);
  });

  it("should now show the previously blocked task as runnable", async () => {
    const { stdout, exitCode } = await runTg(`next --plan ${planId}`, tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(task2Id);
    expect(stdout).not.toContain(task1Id);
  });

  it("should complete the second task", async () => {
    const { exitCode } = await runTg(`start ${task2Id}`, tempDir);
    expect(exitCode).toBe(0);

    const { stdout: doneOutput, exitCode: doneExitCode } = await runTg(
      `done ${task2Id} --evidence "API implemented and tested"`,
      tempDir,
    );
    expect(doneExitCode).toBe(0);
    expect(doneOutput).toContain(`Task ${task2Id} marked as done.`);
  });

  it("should export a mermaid graph", async () => {
    const { stdout, exitCode } = await runTg(
      `export mermaid --plan ${planId}`,
      tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("graph TD");
    expect(stdout).toContain(
      `${task1Id.replace(/[^a-zA-Z0-9]/g, "")}["Design API (done)"]`,
    );
    expect(stdout).toContain(
      `${task2Id.replace(/[^a-zA-Z0-9]/g, "")}["Implement API (done)"]`,
    );
    expect(stdout).toContain(
      `${task1Id.replace(/[^a-zA-Z0-9]/g, "")} --> ${task2Id.replace(/[^a-zA-Z0-9]/g, "")}`,
    );
  });

  it("should handle error when running command before init", async () => {
    const newTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-e2e-err-"));
    const { stderr, exitCode } = await runTg(
      'plan new "Error Plan"',
      newTempDir,
      true,
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Config file not found");
    fs.rmSync(newTempDir, { recursive: true, force: true });
  });

  it("should detect and prevent a blocking cycle", async () => {
    const cyclePlanResult = await runTg(
      'plan new "Cycle Test Plan" --json',
      tempDir,
    );
    const cyclePlanId = JSON.parse(cyclePlanResult.stdout).plan_id;

    const taskA_Result = await runTg(
      `task new "Task A" --plan ${cyclePlanId} --json`,
      tempDir,
    );
    const taskA_Id = JSON.parse(taskA_Result.stdout).task_id;

    const taskB_Result = await runTg(
      `task new "Task B" --plan ${cyclePlanId} --json`,
      tempDir,
    );
    const taskB_Id = JSON.parse(taskB_Result.stdout).task_id;

    await runTg(`edge add ${taskA_Id} blocks ${taskB_Id}`, tempDir);

    const { stderr, exitCode } = await runTg(
      `edge add ${taskB_Id} blocks ${taskA_Id}`,
      tempDir,
      true,
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      "Blocking edge from" +
        ` ${taskB_Id} to ${taskA_Id} would create a cycle.`,
    );
  });

  it("should split a task into multiple subtasks", async () => {
    const splitPlanResult = await runTg(
      'plan new "Split Test Plan" --json',
      tempDir,
    );
    const splitPlanId = JSON.parse(splitPlanResult.stdout).plan_id;

    const originalTaskResult = await runTg(
      `task new "Original Task" --plan ${splitPlanId} --json`,
      tempDir,
    );
    const originalTaskId = JSON.parse(originalTaskResult.stdout).task_id;

    const { stdout, exitCode } = await runTg(
      `split ${originalTaskId} --into "Subtask 1|Subtask 2" --keep-original`,
      tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Task ${originalTaskId} split into new tasks.`);
    expect(stdout).toContain(`- Subtask 1`);
    expect(stdout).toContain(`- Subtask 2`);

    // Verify new tasks exist and have a 'relates' edge from original
    const showOriginalResult = await runTg(`show ${originalTaskId}`, tempDir);
    expect(showOriginalResult.stdout).toContain(`Dependents:`);
    expect(showOriginalResult.stdout).toContain(`Type: relates`);

    // Get new task IDs from stdout to verify their existence
    const subtask1IdMatch = stdout.match(/- Subtask 1 \(ID: (.*)\)/);
    const subtask2IdMatch = stdout.match(/- Subtask 2 \(ID: (.*)\)/);
    expect(subtask1IdMatch).not.toBeNull();
    expect(subtask2IdMatch).not.toBeNull();
    const subtask1Id = subtask1IdMatch?.[1].trim();
    const subtask2Id = subtask2IdMatch?.[1].trim();

    const showSubtask1Result = await runTg(`show ${subtask1Id}`, tempDir);
    expect(showSubtask1Result.stdout).toContain(`Title: Subtask 1`);

    const showSubtask2Result = await runTg(`show ${subtask2Id}`, tempDir);
    expect(showSubtask2Result.stdout).toContain(`Title: Subtask 2`);
  });
});
