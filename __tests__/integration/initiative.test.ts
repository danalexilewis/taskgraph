import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("tg initiative", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let cycleId: string;
  let initiativeId: string;
  let planId: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    if (!context) throw new Error("setup failed");

    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planPath = path.join(plansDir, "initiative-test-plan.md");
    const planContent = `---
name: Initiative Test Plan
overview: "Plan for initiative integration tests."
todos:
  - id: i1
    content: "Initiative task 1"
    status: pending
---
`;
    fs.writeFileSync(planPath, planContent);
    await runTgCli(
      `import plans/initiative-test-plan.md --plan "Initiative Test Plan" --format cursor`,
      context.tempDir,
    );

    const { stdout: cycleOut } = await runTgCli(
      `cycle new "Sprint 1" --start-date 2026-02-24 --end-date 2026-03-09 --no-commit`,
      context.tempDir,
    );
    const idMatch = cycleOut.match(/id:\s*([a-f0-9-]{36})/i);
    expect(idMatch).toBeDefined();
    cycleId = idMatch?.[1] ?? "";
    if (!cycleId) throw new Error("expected cycle id from cycle new output");

    const { stdout: planListOut } = await runTgCli(
      `plan list --json`,
      context.tempDir,
    );
    const plans = JSON.parse(planListOut) as Array<{
      plan_id: string;
      title?: string;
    }>;
    const plan = plans.find((p) => p.title === "Initiative Test Plan");
    planId = plan?.plan_id ?? plans[0]?.plan_id ?? "";
  }, 60000);

  afterAll(async () => {
    if (context) await teardownIntegrationTest(context);
  });

  it("tg initiative backfill --dry-run prints plan without writing", async () => {
    if (!context) throw new Error("context not set");
    const { exitCode, stdout } = await runTgCli(
      `initiative backfill --cycle ${cycleId} --dry-run`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Would create|dry-run|5 initiatives/i);
  }, 15000);

  it("tg initiative backfill --cycle <cycleId> creates 5 initiatives and assigns projects", async () => {
    if (!context) throw new Error("context not set");
    const { exitCode, stdout } = await runTgCli(
      `initiative backfill --cycle ${cycleId} --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(
      /Core Foundation|Planning and Import|Agent Workflow|Status and CLI|Platform and DX/,
    );
    expect(stdout).toMatch(/Backfill complete|assigned|Created initiative/);
  }, 20000);

  it("tg initiative new 'Feature Work' --cycle <cycleId> sets cycle_id", async () => {
    if (!context) throw new Error("context not set");
    const { exitCode, stdout } = await runTgCli(
      `initiative new "Feature Work" --cycle ${cycleId} --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const idMatch = stdout.match(/([a-f0-9-]{36})/);
    initiativeId = idMatch?.[1] ?? "";
    const listRes = await runTgCli(`initiative list --json`, context.tempDir);
    const list = JSON.parse(listRes.stdout) as Array<{
      initiative_id: string;
      title: string;
      cycle_id: string | null;
    }>;
    const feat = list.find((i) => i.title === "Feature Work");
    expect(feat).toBeDefined();
    expect(feat?.cycle_id).toBe(cycleId);
  }, 15000);

  it("tg initiative list shows the initiative with cycle context", async () => {
    if (!context) throw new Error("context not set");
    const { exitCode, stdout } = await runTgCli(
      `initiative list`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Feature Work");
    expect(stdout).toMatch(/Sprint 1|cycle|2026/);
  }, 15000);

  it("tg initiative assign-project <initiativeId> <planId> updates project row", async () => {
    if (!context) throw new Error("context not set");
    if (!planId) {
      const { stdout } = await runTgCli(
        `plan new "Test Plan" --no-commit`,
        context.tempDir,
      );
      const m = stdout.match(/([a-f0-9-]{36})/);
      planId = m?.[1] ?? "";
    }
    if (!planId || !initiativeId) return;
    const { exitCode, stdout } = await runTgCli(
      `initiative assign-project ${initiativeId} ${planId} --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("assigned");
    expect(stdout).toContain(planId);
  }, 15000);

  it("tg status --initiatives shows project_count > 0 after backfill", async () => {
    if (!context) throw new Error("context not set");
    const { exitCode, stdout } = await runTgCli(
      `status --initiatives`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/\d+/);
  }, 15000);

  it("tg status default view shows cycle banner when a current cycle exists", async () => {
    if (!context) throw new Error("context not set");
    const { exitCode, stdout } = await runTgCli(`status`, context.tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Cycle:|Sprint 1|initiatives|Active Plans/);
  }, 15000);
});

describe("tg initiative commands without init", () => {
  it("initiative list without init errors with run tg init message", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "no-init-"));
    const { exitCode, stdout } = await runTgCli(
      `initiative list`,
      tempDir,
    );
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/run tg init/i);
  });

  it("initiative show without init errors with run tg init message", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "no-init-"));
    const { exitCode, stdout } = await runTgCli(
      `initiative show 00000000-0000-0000-0000-000000000000`,
      tempDir,
    );
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/run tg init/i);
  });
});
