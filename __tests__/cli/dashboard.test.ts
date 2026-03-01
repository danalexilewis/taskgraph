import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { execa } from "execa";
import {
  setupIntegrationTest,
  teardownIntegrationTest,
} from "../integration/test-utils";

const DOLT_PATH = process.env.DOLT_PATH || "dolt";

/**
 * Run a live dashboard command (tg dashboard or tg dashboard --tasks/--projects),
 * wait for first frame, capture stdout, send SIGINT, assert exit 0.
 * Returns { exitCode, stdout, stderr }.
 */
async function runLiveDashboard(
  command: string,
  cwd: string,
  waitMs = 2500,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cliPath = path.resolve(__dirname, "../../dist/cli/index.js");
  const subprocess = execa(`node ${cliPath} ${command}`, {
    cwd,
    shell: true,
    env: { ...process.env, DOLT_PATH },
  });
  let stdout = "";
  let stderr = "";
  subprocess.stdout?.on("data", (ch: Buffer) => {
    stdout += ch.toString();
  });
  subprocess.stderr?.on("data", (ch: Buffer) => {
    stderr += ch.toString();
  });
  await new Promise((r) => setTimeout(r, waitMs));
  subprocess.kill("SIGINT");
  let exitCode: number | undefined;
  try {
    const result = await subprocess;
    exitCode = result.exitCode ?? 0;
  } catch (err: unknown) {
    const e = err as { exitCode?: number; signal?: string };
    exitCode = e.exitCode;
    if (exitCode === undefined && e.signal === "SIGINT") exitCode = 0;
  }
  return { exitCode: exitCode ?? 1, stdout, stderr };
}

describe("tg dashboard", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

  beforeAll(async () => {
    context = await setupIntegrationTest();
  }, 60000);

  afterAll(() => {
    if (context) {
      teardownIntegrationTest(context.tempDir);
    }
  });

  it("exits 0 on SIGINT (live mode; stdout may be buffered when piped)", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runLiveDashboard(
      "dashboard",
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    if (stdout.length > 0) {
      const hasSection =
        stdout.includes("Completed") ||
        stdout.includes("Active Projects") ||
        stdout.includes("Active tasks and upcoming");
      expect(hasSection).toBe(true);
    }
  }, 10000);

  it("tg dashboard --tasks exits 0 on SIGINT (output may include Next 7 and Last 7 when not buffered)", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runLiveDashboard(
      "dashboard --tasks",
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    if (stdout.length > 0) {
      expect(stdout).toMatch(/Next 7|next 7/i);
      expect(stdout).toMatch(/Last 7|last 7/i);
    }
  }, 10000);

  it("tg dashboard --projects exits 0 on SIGINT (output may include Next 7 and Last 7 when not buffered)", async () => {
    if (!context) throw new Error("Context not initialized");
    const { exitCode, stdout } = await runLiveDashboard(
      "dashboard --projects",
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    if (stdout.length > 0) {
      expect(stdout).toMatch(/Next 7|next 7/i);
      expect(stdout).toMatch(/Last 7|last 7/i);
    }
  }, 10000);
});
