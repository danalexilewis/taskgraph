"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const execa_1 = require("execa");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const CLI_PATH = "./dist/cli/index.js";
const TG_BIN = "pnpm run start --filter taskgraph -- "; // Adjust if 'tg' is globally linked
async function runTg(command, cwd, expectError = false) {
    try {
        const { stdout, stderr, exitCode } = await (0, execa_1.execa)(TG_BIN + command, {
            cwd,
            shell: true,
        });
        if (expectError && exitCode === 0) {
            throw new Error(`Expected command to fail but it succeeded. Output: ${stdout}, Error: ${stderr}`);
        }
        if (!expectError && exitCode !== 0) {
            throw new Error(`Command failed unexpectedly. Exit Code: ${exitCode}, Output: ${stdout}, Error: ${stderr}`);
        }
        return { stdout, stderr, exitCode: exitCode ?? 0 };
    }
    catch (error) {
        if (expectError) {
            return {
                stdout: error.stdout || "",
                stderr: error.stderr || error.message,
                exitCode: error.exitCode ?? 1,
            };
        }
        throw error;
    }
}
(0, vitest_1.describe)("Task Graph CLI E2E Tests", () => {
    let tempDir;
    let doltRepoPath;
    (0, vitest_1.beforeAll)(async () => {
        // Create a temporary directory for each test suite
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-e2e-"));
        doltRepoPath = path.join(tempDir, ".taskgraph", "dolt");
        // Ensure CLI is built
        await (0, execa_1.execa)("pnpm run build", {
            cwd: process.cwd(),
            shell: true,
        });
    }, 60000);
    (0, vitest_1.afterAll)(() => {
        // Clean up the temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("should initialize the task graph", async () => {
        const { stdout, exitCode } = await runTg("init", tempDir);
        (0, vitest_1.expect)(exitCode).toBe(0);
        (0, vitest_1.expect)(stdout).toContain("Task Graph initialized successfully.");
        (0, vitest_1.expect)(fs.existsSync(path.join(tempDir, ".taskgraph", "config.json"))).toBe(true);
        (0, vitest_1.expect)(fs.existsSync(path.join(doltRepoPath, ".dolt"))).toBe(true);
    });
    (0, vitest_1.it)("should create a new plan", async () => {
        const { stdout, exitCode } = await runTg('plan new \"Auth Feature\" --intent \"Implement authentication\"', tempDir);
        (0, vitest_1.expect)(exitCode).toBe(0);
        (0, vitest_1.expect)(stdout).toContain("Plan created with ID:");
        const planIdMatch = stdout.match(/Plan created with ID: (.*)/);
        (0, vitest_1.expect)(planIdMatch).not.toBeNull();
        const planId = planIdMatch[1].trim();
        // Verify plan exists in DB (basic check)
        const { stdout: jsonStdout } = await runTg(`plan new \"Temp Plan\" --json`, tempDir);
        const plans = JSON.parse(jsonStdout);
        (0, vitest_1.expect)(plans).toEqual(vitest_1.expect.arrayContaining([vitest_1.expect.objectContaining({ plan_id: planId })]));
    });
    let planId;
    let task1Id;
    let task2Id;
    let task3Id;
    (0, vitest_1.it)("should create tasks and establish a blocking dependency", async () => {
        const planResult = await runTg('plan new \"Core Flow Plan\" --json', tempDir);
        planId = JSON.parse(planResult.stdout).plan_id;
        const task1Result = await runTg(`task new \"Design API\" --plan ${planId} --feature auth --area backend --json`, tempDir);
        task1Id = JSON.parse(task1Result.stdout).task_id;
        (0, vitest_1.expect)(task1Id).toBeDefined();
        const task2Result = await runTg(`task new \"Implement API\" --plan ${planId} --feature auth --area backend --json`, tempDir);
        task2Id = JSON.parse(task2Result.stdout).task_id;
        (0, vitest_1.expect)(task2Id).toBeDefined();
        const edgeResult = await runTg(`edge add ${task1Id} blocks ${task2Id} --reason \"API must be designed first\"`, tempDir);
        (0, vitest_1.expect)(edgeResult.exitCode).toBe(0);
        (0, vitest_1.expect)(edgeResult.stdout).toContain(`Edge added: ${task1Id} blocks ${task2Id}`);
    });
    (0, vitest_1.it)("should show only runnable tasks, with blocked tasks excluded", async () => {
        const { stdout, exitCode } = await runTg(`next --plan ${planId}`, tempDir);
        (0, vitest_1.expect)(exitCode).toBe(0);
        (0, vitest_1.expect)(stdout).toContain(task1Id);
        (0, vitest_1.expect)(stdout).not.toContain(task2Id);
    });
    (0, vitest_1.it)("should show task details including blockers and dependents", async () => {
        const { stdout, exitCode } = await runTg(`show ${task2Id}`, tempDir);
        (0, vitest_1.expect)(exitCode).toBe(0);
        (0, vitest_1.expect)(stdout).toContain(`Task Details (ID: ${task2Id}):`);
        (0, vitest_1.expect)(stdout).toContain(`Title: Implement API`);
        (0, vitest_1.expect)(stdout).toContain(`Blockers:`);
        (0, vitest_1.expect)(stdout).toContain(`- Task ID: ${task1Id}`);
    });
    (0, vitest_1.it)("should start a runnable task", async () => {
        const { stdout, exitCode } = await runTg(`start ${task1Id}`, tempDir);
        (0, vitest_1.expect)(exitCode).toBe(0);
        (0, vitest_1.expect)(stdout).toContain(`Task ${task1Id} started.`);
        // Verify status update
        const { stdout: showOutput } = await runTg(`show ${task1Id}`, tempDir);
        (0, vitest_1.expect)(showOutput).toContain(`Status: doing`);
    });
    (0, vitest_1.it)("should not allow starting a blocked task", async () => {
        const { stdout, exitCode } = await runTg(`start ${task2Id}`, tempDir, true);
        (0, vitest_1.expect)(exitCode).toBe(1);
        (0, vitest_1.expect)(stdout).toContain(`Task ${task2Id} is not in 'todo' status. Current status: todo.`); // Should be caught by assertRunnable
    });
    (0, vitest_1.it)("should complete a task", async () => {
        const { stdout, exitCode } = await runTg(`done ${task1Id} --evidence \"API designed and spec'd\"`, tempDir);
        (0, vitest_1.expect)(exitCode).toBe(0);
        (0, vitest_1.expect)(stdout).toContain(`Task ${task1Id} marked as done.`);
        // Verify status update
        const { stdout: showOutput } = await runTg(`show ${task1Id}`, tempDir);
        (0, vitest_1.expect)(showOutput).toContain(`Status: done`);
    });
    (0, vitest_1.it)("should now show the previously blocked task as runnable", async () => {
        const { stdout, exitCode } = await runTg(`next --plan ${planId}`, tempDir);
        (0, vitest_1.expect)(exitCode).toBe(0);
        (0, vitest_1.expect)(stdout).toContain(task2Id);
        (0, vitest_1.expect)(stdout).not.toContain(task1Id);
    });
    (0, vitest_1.it)("should complete the second task", async () => {
        const { stdout, exitCode } = await runTg(`start ${task2Id}`, tempDir);
        (0, vitest_1.expect)(exitCode).toBe(0);
        const { stdout: doneOutput, exitCode: doneExitCode } = await runTg(`done ${task2Id} --evidence \"API implemented and tested\"`, tempDir);
        (0, vitest_1.expect)(doneExitCode).toBe(0);
        (0, vitest_1.expect)(doneOutput).toContain(`Task ${task2Id} marked as done.`);
    });
    (0, vitest_1.it)("should export a mermaid graph", async () => {
        const { stdout, exitCode } = await runTg(`export mermaid --plan ${planId}`, tempDir);
        (0, vitest_1.expect)(exitCode).toBe(0);
        (0, vitest_1.expect)(stdout).toContain("graph TD");
        (0, vitest_1.expect)(stdout).toContain(`${task1Id.replace(/[^a-zA-Z0-9]/g, "")}[\"Design API (done)\"]`);
        (0, vitest_1.expect)(stdout).toContain(`${task2Id.replace(/[^a-zA-Z0-9]/g, "")}[\"Implement API (done)\"]`);
        (0, vitest_1.expect)(stdout).toContain(`${task1Id.replace(/[^a-zA-Z0-9]/g, "")} --> ${task2Id.replace(/[^a-zA-Z0-9]/g, "")}`);
    });
    (0, vitest_1.it)("should handle error when running command before init", async () => {
        const newTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-e2e-err-"));
        const { stderr, exitCode } = await runTg('plan new \"Error Plan\"', newTempDir, true);
        (0, vitest_1.expect)(exitCode).toBe(1);
        (0, vitest_1.expect)(stderr).toContain("Config file not found");
        fs.rmSync(newTempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("should detect and prevent a blocking cycle", async () => {
        const cyclePlanResult = await runTg('plan new \"Cycle Test Plan\" --json', tempDir);
        const cyclePlanId = JSON.parse(cyclePlanResult.stdout).plan_id;
        const taskA_Result = await runTg(`task new \"Task A\" --plan ${cyclePlanId} --json`, tempDir);
        const taskA_Id = JSON.parse(taskA_Result.stdout).task_id;
        const taskB_Result = await runTg(`task new \"Task B\" --plan ${cyclePlanId} --json`, tempDir);
        const taskB_Id = JSON.parse(taskB_Result.stdout).task_id;
        await runTg(`edge add ${taskA_Id} blocks ${taskB_Id}`, tempDir);
        const { stderr, exitCode } = await runTg(`edge add ${taskB_Id} blocks ${taskA_Id}`, tempDir, true);
        (0, vitest_1.expect)(exitCode).toBe(1);
        (0, vitest_1.expect)(stderr).toContain("Blocking edge from" +
            ` ${taskB_Id} to ${taskA_Id} would create a cycle.`);
    });
    (0, vitest_1.it)("should split a task into multiple subtasks", async () => {
        const splitPlanResult = await runTg('plan new \"Split Test Plan\" --json', tempDir);
        const splitPlanId = JSON.parse(splitPlanResult.stdout).plan_id;
        const originalTaskResult = await runTg(`task new \"Original Task\" --plan ${splitPlanId} --json`, tempDir);
        const originalTaskId = JSON.parse(originalTaskResult.stdout).task_id;
        const { stdout, exitCode } = await runTg(`split ${originalTaskId} --into \"Subtask 1|Subtask 2\" --keep-original`, tempDir);
        (0, vitest_1.expect)(exitCode).toBe(0);
        (0, vitest_1.expect)(stdout).toContain(`Task ${originalTaskId} split into new tasks.`);
        (0, vitest_1.expect)(stdout).toContain(`- Subtask 1`);
        (0, vitest_1.expect)(stdout).toContain(`- Subtask 2`);
        // Verify new tasks exist and have a 'relates' edge from original
        const showOriginalResult = await runTg(`show ${originalTaskId}`, tempDir);
        (0, vitest_1.expect)(showOriginalResult.stdout).toContain(`Dependents:`);
        (0, vitest_1.expect)(showOriginalResult.stdout).toContain(`Type: relates`);
        // Get new task IDs from stdout to verify their existence
        const subtask1IdMatch = stdout.match(/- Subtask 1 \(ID: (.*)\)/);
        const subtask2IdMatch = stdout.match(/- Subtask 2 \(ID: (.*)\)/);
        (0, vitest_1.expect)(subtask1IdMatch).not.toBeNull();
        (0, vitest_1.expect)(subtask2IdMatch).not.toBeNull();
        const subtask1Id = subtask1IdMatch[1].trim();
        const subtask2Id = subtask2IdMatch[1].trim();
        const showSubtask1Result = await runTg(`show ${subtask1Id}`, tempDir);
        (0, vitest_1.expect)(showSubtask1Result.stdout).toContain(`Title: Subtask 1`);
        const showSubtask2Result = await runTg(`show ${subtask2Id}`, tempDir);
        (0, vitest_1.expect)(showSubtask2Result.stdout).toContain(`Title: Subtask 2`);
    });
});
