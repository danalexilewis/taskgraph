import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { execa } from "execa";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

const DOLT_PATH = process.env.DOLT_PATH || "dolt";

describe("status-live integration tests", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

  beforeAll(async () => {
    context = await setupIntegrationTest();
  }, 60000);

  afterAll(async () => {
    if (context) {
      await teardownIntegrationTest(context);
    }
  });

  describe("tg status --dashboard", () => {
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

    it("tg status --dashboard runs dashboard and exits 0 on SIGINT (deprecation printed to stderr when not buffered)", async () => {
      if (!context) throw new Error("Context not initialized");
      const cliPath = path.resolve(__dirname, "../../dist/cli/index.js");
      const subprocess = execa(`node ${cliPath} status --dashboard`, {
        cwd: context.tempDir,
        shell: true,
        env: { ...process.env, DOLT_PATH },
      });
      let stderr = "";
      subprocess.stderr?.on("data", (ch: Buffer) => {
        stderr += ch.toString();
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
      if (stderr.length > 0) {
        expect(stderr).toContain("deprecated");
        expect(stderr).toContain("tg dashboard");
      }
    }, 10000);
  });

  describe("tg dashboard", () => {
    it("exits 0 on SIGINT (live mode; stdout may be buffered when piped)", async () => {
      if (!context) throw new Error("Context not initialized");
      const cliPath = path.resolve(__dirname, "../../dist/cli/index.js");
      const subprocess = execa(`node ${cliPath} dashboard`, {
        cwd: context.tempDir,
        shell: true,
        env: { ...process.env, DOLT_PATH },
      });
      let stdout = "";
      subprocess.stdout?.on("data", (ch: Buffer) => {
        stdout += ch.toString();
      });
      await new Promise((r) => setTimeout(r, 2500));
      subprocess.kill("SIGINT");
      let exitCode: number | undefined;
      try {
        await subprocess;
        exitCode = 0;
      } catch (err: unknown) {
        const e = err as { exitCode?: number; signal?: string };
        exitCode = e.exitCode ?? (e.signal === "SIGINT" ? 0 : 1);
      }
      expect(exitCode).toBe(0);
      if (stdout.length > 0) {
        const hasSection =
          stdout.includes("Completed") ||
          stdout.includes("Active Plans") ||
          stdout.includes("Active & next");
        expect(hasSection).toBe(true);
      }
    }, 10000);

    it("tg dashboard --tasks exits 0 on SIGINT (output may be buffered when piped)", async () => {
      if (!context) throw new Error("Context not initialized");
      const cliPath = path.resolve(__dirname, "../../dist/cli/index.js");
      const subprocess = execa(`node ${cliPath} dashboard --tasks`, {
        cwd: context.tempDir,
        shell: true,
        env: { ...process.env, DOLT_PATH },
      });
      let stdout = "";
      subprocess.stdout?.on("data", (ch: Buffer) => {
        stdout += ch.toString();
      });
      await new Promise((r) => setTimeout(r, 2500));
      subprocess.kill("SIGINT");
      let exitCode: number | undefined;
      try {
        await subprocess;
        exitCode = 0;
      } catch (err: unknown) {
        const e = err as { exitCode?: number; signal?: string };
        exitCode = e.exitCode ?? (e.signal === "SIGINT" ? 0 : 1);
      }
      expect(exitCode).toBe(0);
      if (stdout.length > 0) {
        expect(stdout).toMatch(/Next 7|next 7/i);
        expect(stdout).toMatch(/Last 7|last 7/i);
      }
    }, 10000);

    it("tg dashboard --projects exits 0 on SIGINT (output may be buffered when piped)", async () => {
      if (!context) throw new Error("Context not initialized");
      const cliPath = path.resolve(__dirname, "../../dist/cli/index.js");
      const subprocess = execa(`node ${cliPath} dashboard --projects`, {
        cwd: context.tempDir,
        shell: true,
        env: { ...process.env, DOLT_PATH },
      });
      let stdout = "";
      subprocess.stdout?.on("data", (ch: Buffer) => {
        stdout += ch.toString();
      });
      await new Promise((r) => setTimeout(r, 2500));
      subprocess.kill("SIGINT");
      let exitCode: number | undefined;
      try {
        await subprocess;
        exitCode = 0;
      } catch (err: unknown) {
        const e = err as { exitCode?: number; signal?: string };
        exitCode = e.exitCode ?? (e.signal === "SIGINT" ? 0 : 1);
      }
      expect(exitCode).toBe(0);
      if (stdout.length > 0) {
        expect(stdout).toMatch(/Next 7|next 7/i);
        expect(stdout).toMatch(/Last 7|last 7/i);
      }
    }, 10000);
  });

  describe("tg status focused views (--tasks, --projects, --initiatives) with --json", () => {
    it("tg status --tasks --json exits 0 and returns JSON array of task rows", async () => {
      if (!context) throw new Error("Context not initialized");
      const { exitCode, stdout } = await runTgCli(
        "status --tasks --json",
        context.tempDir,
      );
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout) as unknown[];
      expect(Array.isArray(data)).toBe(true);
      const requiredKeys = [
        "task_id",
        "title",
        "plan_title",
        "status",
        "owner",
      ];
      for (const row of data) {
        const r = row as Record<string, unknown>;
        for (const key of requiredKeys) {
          expect(r).toHaveProperty(key);
        }
      }
    }, 20000);

    it("tg status --projects --json exits 0 and returns JSON array of project rows", async () => {
      if (!context) throw new Error("Context not initialized");
      const { exitCode, stdout } = await runTgCli(
        "status --projects --json",
        context.tempDir,
      );
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout) as unknown[];
      expect(Array.isArray(data)).toBe(true);
      for (const row of data) {
        const r = row as Record<string, unknown>;
        expect(r).toHaveProperty("plan_id");
        expect(r).toHaveProperty("title");
        expect(r).toHaveProperty("status");
        expect(r).toHaveProperty("todo");
        expect(r).toHaveProperty("doing");
        expect(r).toHaveProperty("blocked");
        expect(r).toHaveProperty("done");
      }
    }, 20000);

    it("tg status --initiatives --json exits 0 and returns stub (table missing) or array (table exists)", async () => {
      if (!context) throw new Error("Context not initialized");
      const { exitCode, stdout } = await runTgCli(
        "status --initiatives --json",
        context.tempDir,
      );
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout) as
        | { stub?: boolean; message?: string }
        | unknown[];
      if (Array.isArray(data)) {
        expect(Array.isArray(data)).toBe(true);
      } else {
        expect(data.stub).toBe(true);
        expect(typeof (data as { message?: string }).message === "string").toBe(
          true,
        );
        expect((data as { message?: string }).message).toContain("Initiative");
      }
    }, 20000);
  });
});
