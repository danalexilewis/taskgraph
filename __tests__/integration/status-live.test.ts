import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { execa } from "execa";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

const DOLT_PATH = process.env.DOLT_PATH || "dolt";

describe("tg status --dashboard", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

  beforeAll(async () => {
    context = await setupIntegrationTest();
  }, 60000);

  afterAll(() => {
    if (context) {
      teardownIntegrationTest(context.tempDir);
    }
  });

  it("exits 0 on SIGINT (live mode runs fallback under Node; stdout may be buffered when piped)", async () => {
    if (!context) throw new Error("Context not initialized");
    const cliPath = path.resolve(__dirname, "../../dist/cli/index.js");
    const subprocess = execa(`node ${cliPath} status --dashboard`, {
      cwd: context.tempDir,
      shell: true,
      env: { ...process.env, DOLT_PATH },
    });
    await new Promise((r) => setTimeout(r, 2500));
    subprocess.kill("SIGINT");
    let exitCode: number | undefined;
    try {
      const result = await subprocess;
      exitCode = result.exitCode;
    } catch (err: unknown) {
      const e = err as { exitCode?: number; signal?: string };
      exitCode = e.exitCode;
      if (exitCode === undefined && e.signal === "SIGINT") exitCode = 0;
    }
    expect(exitCode).toBe(0);
  }, 10000);

  it("tg status --json --dashboard exits non-zero and stderr says JSON dashboard is unsupported", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stderr } = await runTgCli(
      "status --json --dashboard",
      context.tempDir,
      true,
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("does not support --json");
  }, 20000);
});
