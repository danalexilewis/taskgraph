import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readServerMeta, serverMetaPath } from "../../src/cli/server";
import {
  type IntegrationTestContext,
  runTgCliInProcess,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

/** Wait until a TCP port accepts connections (polls every 200ms up to maxMs). */
async function waitForPort(
  port: number,
  maxMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 300);
      socket.on("connect", () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
      socket.connect(port, "127.0.0.1");
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** Kill any server process recorded in the meta file, then remove the file. */
function cleanupTestServer(configDir: string): void {
  const metaFile = serverMetaPath(configDir);
  if (!fs.existsSync(metaFile)) return;
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as {
      pid: number;
    };
    try {
      process.kill(-meta.pid, "SIGKILL");
    } catch {
      try {
        process.kill(meta.pid, "SIGKILL");
      } catch {
        // already dead
      }
    }
  } catch {
    // corrupt meta — still remove
  }
  fs.rmSync(metaFile, { force: true });
}

describe("tg server lifecycle", () => {
  let ctx: IntegrationTestContext;

  beforeEach(async () => {
    ctx = await setupIntegrationTest();
  }, 60_000);

  afterEach(async () => {
    // Always clean up any tg-server server before tearing down the temp dir
    const configDir = path.dirname(ctx.doltRepoPath);
    cleanupTestServer(configDir);
    await teardownIntegrationTest(ctx);
  }, 60_000);

  it("tg server start creates meta file and server accepts TCP", async () => {
    const { stdout, exitCode } = await runTgCliInProcess(
      "server start",
      ctx.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/tg server started/);

    const configDir = path.dirname(ctx.doltRepoPath);
    const meta = readServerMeta(configDir);
    expect(meta).not.toBeNull();
    expect(meta!.port).toBeGreaterThan(0);
    expect(meta!.pid).toBeGreaterThan(0);

    // The server should already be up (startDoltServerProcess polls for ready)
    const listening = await waitForPort(meta!.port, 5_000);
    expect(listening).toBe(true);
  }, 60_000);

  it("tg server status shows running after start", async () => {
    await runTgCliInProcess("server start", ctx.tempDir);

    const { stdout, exitCode } = await runTgCliInProcess(
      "server status",
      ctx.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/running/);
  }, 60_000);

  it("tg server stop cleans up meta file and closes port", async () => {
    await runTgCliInProcess("server start", ctx.tempDir);
    const configDir = path.dirname(ctx.doltRepoPath);
    const meta = readServerMeta(configDir);
    expect(meta).not.toBeNull();

    const { stdout, exitCode } = await runTgCliInProcess(
      "server stop",
      ctx.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/stopped/);

    // Meta file should be removed
    expect(readServerMeta(configDir)).toBeNull();

    // Port should no longer accept connections
    const stillListening = await waitForPort(meta!.port, 2_000);
    expect(stillListening).toBe(false);
  }, 60_000);

  it("tg server status shows stopped after stop", async () => {
    await runTgCliInProcess("server start", ctx.tempDir);
    await runTgCliInProcess("server stop", ctx.tempDir);

    const { stdout, exitCode } = await runTgCliInProcess(
      "server status",
      ctx.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/stopped/);
  }, 60_000);

  it("tg server start is idempotent on double start", async () => {
    const { stdout: first } = await runTgCliInProcess(
      "server start",
      ctx.tempDir,
    );
    const configDir = path.dirname(ctx.doltRepoPath);
    const meta1 = readServerMeta(configDir);

    const { stdout: second } = await runTgCliInProcess(
      "server start",
      ctx.tempDir,
    );
    const meta2 = readServerMeta(configDir);

    expect(first).toMatch(/tg server started/);
    // Second start reports already running, no new server
    expect(second).toMatch(/already running/);
    // Same PID and port
    expect(meta2!.pid).toBe(meta1!.pid);
    expect(meta2!.port).toBe(meta1!.port);
  }, 60_000);

  it("tg server status shows stopped when no server has been started", async () => {
    const { stdout, exitCode } = await runTgCliInProcess(
      "server status",
      ctx.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/stopped/);
  }, 60_000);

  it("tg server stop is a no-op when not running", async () => {
    const { stdout, exitCode } = await runTgCliInProcess(
      "server stop",
      ctx.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/not running/);
  }, 60_000);
});
