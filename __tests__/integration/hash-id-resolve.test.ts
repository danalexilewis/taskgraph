import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("Hash ID resolution end-to-end", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let taskUuid: string;
  let taskHashId: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    if (!context) throw new Error("setup failed");

    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });

    const planContent = `---
name: Hash Resolve Test Plan
overview: Plan for testing resolveTaskId with short hash and UUID.
todos:
  - id: resolve-a
    content: "Task for hash resolution (context/show)"
    status: pending
  - id: resolve-b
    content: "Task for done with hash_id"
    status: pending
---
`;
    fs.writeFileSync(path.join(plansDir, "hash-resolve.md"), planContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/hash-resolve.md --plan "Hash Resolve Test Plan" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(importOut).toContain("Successfully imported");

    const { stdout: listOut } = await runTgCli(
      `plan list --json`,
      context.tempDir,
    );
    const plans = JSON.parse(listOut) as Array<{
      plan_id: string;
      title: string;
    }>;
    const plan = plans.find((p) => p.title === "Hash Resolve Test Plan");
    expect(plan).toBeDefined();
    const pid = plan?.plan_id;
    if (pid == null) throw new Error("expected plan_id");
    planId = pid;

    const { stdout: nextOut } = await runTgCli(
      `next --plan ${planId} --json --limit 5`,
      context.tempDir,
    );
    const tasks = JSON.parse(nextOut) as Array<{
      task_id: string;
      hash_id: string | null;
      title: string;
    }>;
    const taskA = tasks.find(
      (t) => t.title === "Task for hash resolution (context/show)",
    );
    expect(taskA).toBeDefined();
    const tid = taskA?.task_id;
    const hid = taskA?.hash_id;
    if (tid == null || hid == null)
      throw new Error("expected task_id and hash_id");
    taskUuid = tid;
    taskHashId = hid;
  }, 60000);

  afterAll(async () => {
    if (context) await teardownIntegrationTest(context);
  });

  it("resolves short hash_id in tg context and returns same result as UUID", async () => {
    if (!context) throw new Error("context not set");

    const { stdout: byUuid } = await runTgCli(
      `context ${taskUuid} --json`,
      context.tempDir,
    );
    const { stdout: byHash } = await runTgCli(
      `context ${taskHashId} --json`,
      context.tempDir,
    );

    const dataUuid = JSON.parse(byUuid) as { task_id?: string };
    const dataHash = JSON.parse(byHash) as { task_id?: string };
    expect(dataHash.task_id).toBe(dataUuid.task_id);
    expect(dataHash.task_id).toBe(taskUuid);
  }, 15000);

  it("resolves short hash_id in tg show", async () => {
    if (!context) throw new Error("context not set");

    const { exitCode, stdout } = await runTgCli(
      `show ${taskHashId}`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Task for hash resolution (context/show)");
  }, 15000);

  it("resolves short hash_id in tg start and tg done", async () => {
    if (!context) throw new Error("context not set");

    const { stdout: nextOut } = await runTgCli(
      `next --plan ${planId} --json --limit 5`,
      context.tempDir,
    );
    const tasks = JSON.parse(nextOut) as Array<{
      task_id: string;
      hash_id: string | null;
      title: string;
    }>;
    const taskB = tasks.find((t) => t.title === "Task for done with hash_id");
    expect(taskB).toBeDefined();
    const hashB = taskB?.hash_id;
    if (hashB == null) throw new Error("expected hash_id for task B");

    const { exitCode: startCode } = await runTgCli(
      `start ${hashB} --agent implementer-1`,
      context.tempDir,
    );
    expect(startCode).toBe(0);

    const { exitCode, stdout } = await runTgCli(
      `done ${hashB} --evidence "hash-id-resolve integration test"`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Task .+ done/i);
  }, 15000);

  it("resolves full UUID in tg context (idempotent resolution)", async () => {
    if (!context) throw new Error("context not set");

    const { exitCode, stdout } = await runTgCli(
      `context ${taskUuid} --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as { task_id: string };
    expect(data.task_id).toBe(taskUuid);
  }, 15000);
});
