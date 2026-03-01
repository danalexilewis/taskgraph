import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";
import { writeConfig } from "../../src/cli/utils";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

const DOLT_PATH = process.env.DOLT_PATH || "dolt";

/**
 * Integration tests for tg sync with a file-based Dolt remote.
 * Uses describe.serial so setup, push, pull, and verify run in order.
 */
describe.serial("Dolt sync with file-based remote", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let remoteDir: string;
  let planId: string;
  const planTitle = "Sync Test Plan";

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const tempDir = context.tempDir;

    // File-based remote: another Dolt repo on disk
    remoteDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "tg-integration-remote-"),
    );
    await execa(DOLT_PATH, ["init"], {
      cwd: remoteDir,
      env: { ...process.env, DOLT_PATH },
    });

    const remoteUrl = `file://${path.resolve(remoteDir).replace(/\\/g, "/")}`;
    writeConfig(
      { doltRepoPath: context.doltRepoPath, remoteUrl },
      tempDir,
    )._unsafeUnwrap();

    const plansDir = path.join(tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planContent = `---
name: ${planTitle}
overview: "Plan for sync integration tests."
todos:
  - id: sync-1
    content: "Sync task 1"
    status: pending
---
`;
    fs.writeFileSync(path.join(plansDir, "sync-plan.md"), planContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/sync-plan.md --plan "${planTitle}" --format cursor`,
      tempDir,
    );
    expect(importOut).toContain("Successfully imported");

    const { stdout: listOut } = await runTgCli(`plan list --json`, tempDir);
    const plans = JSON.parse(listOut) as Array<{
      plan_id: string;
      title: string;
    }>;
    const plan = plans.find((p) => p.title === planTitle);
    expect(plan).toBeDefined();
    planId = plan?.plan_id;
  }, 60000);

  afterAll(async () => {
    if (context) {
      await teardownIntegrationTest(context);
    }
    if (remoteDir && fs.existsSync(remoteDir)) {
      fs.rmSync(remoteDir, { recursive: true, force: true });
    }
  });

  it("tg sync --push pushes to file remote; tg sync --pull pulls in second workspace", async () => {
    if (!context) throw new Error("Context not initialized");
    const tempDir = context.tempDir;

    const { exitCode: pushCode, stdout: pushOut } = await runTgCli(
      "sync --push --json",
      tempDir,
    );
    expect(pushCode).toBe(0);
    const pushData = JSON.parse(pushOut) as { push?: string; error?: string };
    expect(pushData.error).toBeUndefined();
    expect(pushData.push).toBeDefined();

    const { stdout: remoteBranches } = await execa(
      DOLT_PATH,
      ["branch", "-a"],
      {
        cwd: remoteDir,
        env: { ...process.env, DOLT_PATH },
      },
    );
    expect(remoteBranches).toContain("main");

    const remoteUrl = `file://${path.resolve(remoteDir).replace(/\\/g, "/")}`;
    const tempDir2 = fs.mkdtempSync(
      path.join(os.tmpdir(), "tg-integration-pull-"),
    );
    const cloneDoltPath = path.join(tempDir2, ".taskgraph", "dolt");
    fs.mkdirSync(path.dirname(cloneDoltPath), { recursive: true });
    await execa(DOLT_PATH, ["clone", remoteUrl, cloneDoltPath], {
      env: { ...process.env, DOLT_PATH },
    });
    writeConfig(
      { doltRepoPath: cloneDoltPath, remoteUrl },
      tempDir2,
    )._unsafeUnwrap();

    const { exitCode: pullCode, stderr: pullErr } = await runTgCli(
      "sync --pull",
      tempDir2,
    ).catch((e: { stderr?: string; exitCode?: number }) => ({
      exitCode: e.exitCode ?? 1,
      stdout: "",
      stderr: (e.stderr != null
        ? String(e.stderr)
        : (e as Error).message) as string,
    }));
    expect(pullCode, `sync --pull: ${pullErr}`).toBe(0);

    const { stdout: listOut2 } = await runTgCli(`plan list --json`, tempDir2);
    const plans2 = JSON.parse(listOut2) as Array<{
      plan_id: string;
      title: string;
    }>;
    const plan2 = plans2.find((p) => p.title === planTitle);
    expect(plan2).toBeDefined();
    expect(plan2?.plan_id).toBe(planId);

    await teardownIntegrationTest(tempDir2);
  }, 30000);
});
