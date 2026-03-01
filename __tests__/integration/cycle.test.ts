import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("tg cycle", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    if (!context) throw new Error("setup failed");
  }, 60000);

  afterAll(async () => {
    if (context) await teardownIntegrationTest(context);
  });

  it("tg cycle new 'Sprint 1' --start-date 2026-02-24 --end-date 2026-03-09 exits 0 and prints cycle id", async () => {
    if (!context) throw new Error("context not set");
    const { exitCode, stdout } = await runTgCli(
      `cycle new "Sprint 1" --start-date 2026-02-24 --end-date 2026-03-09 --no-commit`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Cycle 'Sprint 1' created \(id:/);
    expect(stdout).toMatch(/2026-02-24.*2026-03-09/);
  }, 15000);

  it("tg cycle list returns the created cycle in human mode", async () => {
    if (!context) throw new Error("context not set");
    const { exitCode, stdout } = await runTgCli(`cycle list`, context.tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Sprint 1");
    expect(stdout).toMatch(/Active|Upcoming|Past/);
  }, 15000);

  it("tg cycle list --json returns array of cycles", async () => {
    if (!context) throw new Error("context not set");
    const { exitCode, stdout } = await runTgCli(
      `cycle list --json`,
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{
      cycle_id: string;
      name: string;
      start_date: string;
      end_date: string;
    }>;
    expect(Array.isArray(data)).toBe(true);
    const sprint = data.find((c) => c.name === "Sprint 1");
    expect(sprint).toBeDefined();
    expect(sprint?.start_date).toContain("2026-02-24");
    expect(sprint?.end_date).toContain("2026-03-09");
  }, 15000);

  it("tg cycle new without required flags exits non-zero with helpful error", async () => {
    if (!context) throw new Error("context not set");
    const { exitCode, stderr } = await runTgCli(
      `cycle new "NoDates" --no-commit`,
      context.tempDir,
      true,
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/start-date|end-date|weeks|required/i);
  }, 15000);
});
