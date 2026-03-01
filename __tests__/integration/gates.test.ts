import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

/**
 * Integration tests for gate lifecycle: create task, create gate blocking it,
 * verify task blocked, resolve gate, verify task unblocked.
 * Uses describe.serial and a single sequential it() so steps run in order.
 */
describe.serial("Gate lifecycle", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let taskId: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const tempDir = context.tempDir;

    const plansDir = path.join(tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planContent = `---
name: Gate Lifecycle Test Plan
overview: "Plan for gate lifecycle integration tests."
todos:
  - id: gate-1
    content: "Task blocked by gate"
    status: pending
---
`;
    fs.writeFileSync(
      path.join(plansDir, "gate-lifecycle-plan.md"),
      planContent,
    );

    const { stdout: importOut } = await runTgCli(
      `import plans/gate-lifecycle-plan.md --plan "Gate Lifecycle Test Plan" --format cursor --no-commit`,
      tempDir,
    );
    expect(importOut).toContain("Successfully imported");

    const { stdout: listOut } = await runTgCli(`plan list --json`, tempDir);
    const plans = JSON.parse(listOut) as Array<{
      plan_id: string;
      title: string;
    }>;
    const plan = plans.find((p) => p.title === "Gate Lifecycle Test Plan");
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
    const first = nextTasks.find((t) => t.title === "Task blocked by gate");
    expect(first).toBeDefined();
    taskId = first?.task_id;
  }, 60000);

  afterAll(() => {
    if (context) {
      teardownIntegrationTest(context.tempDir);
    }
  });

  it("create gate blocking task, verify blocked, resolve gate, verify unblocked", async () => {
    if (!context) throw new Error("Context not initialized");
    const tempDir = context.tempDir;

    // Create gate blocking the task
    const { stdout: createOut, exitCode: createCode } = await runTgCli(
      `gate create "Test gate" --task ${taskId} --json`,
      tempDir,
    );
    expect(createCode).toBe(0);
    const createData = JSON.parse(createOut) as {
      gate_id: string;
      name: string;
      task_id: string;
      status: string;
    };
    expect(createData.task_id).toBe(taskId);
    expect(createData.status).toBe("pending");
    const gateId = createData.gate_id;

    // Verify task is blocked
    const { stdout: showBlocked } = await runTgCli(
      `show ${taskId} --json`,
      tempDir,
    );
    const blockedData = JSON.parse(showBlocked) as {
      taskDetails: { status: string };
    };
    expect(blockedData.taskDetails.status).toBe("blocked");

    // Resolve the gate
    const { exitCode: resolveCode } = await runTgCli(
      `gate resolve ${gateId} --no-commit`,
      tempDir,
    );
    expect(resolveCode).toBe(0);

    // Verify task is unblocked
    const { stdout: showUnblocked } = await runTgCli(
      `show ${taskId} --json`,
      tempDir,
    );
    const unblockedData = JSON.parse(showUnblocked) as {
      taskDetails: { status: string };
    };
    expect(unblockedData.taskDetails.status).toBe("todo");
  }, 30000);
});
