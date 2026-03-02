import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import type { Command } from "commander";
import execa from "execa";
import type { Config } from "./utils";

export interface ServerMeta {
  port: number;
  pid: number;
  dataDir: string;
}

export function serverMetaPath(configDir: string): string {
  return path.join(configDir, "tg-server.json");
}

export function readServerMeta(configDir: string): ServerMeta | null {
  const p = serverMetaPath(configDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ServerMeta;
  } catch {
    return null;
  }
}

export function writeServerMeta(configDir: string, meta: ServerMeta): void {
  writeFileSync(
    serverMetaPath(configDir),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
}

/**
 * Attempt a TCP connection to the given port on localhost.
 * Resolves if the connection succeeds within `timeoutMs`; rejects otherwise.
 */
function probePort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timeout"));
    }, timeoutMs);
    socket.connect(port, "127.0.0.1", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * Returns true if the process with the given PID is alive and (when port is
 * provided) is accepting TCP connections on that port.
 *
 * Distinguishes EPERM (process alive but owned by a different UID — common in
 * Docker / multi-user Linux) from ESRCH (process does not exist). On EPERM we
 * fall through to the TCP probe; on ESRCH we return false immediately.
 */
export async function isServerAlive(
  pid: number,
  port?: number,
): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code !== "EPERM") return false;
    // EPERM: process is alive but owned by a different UID — fall through to TCP probe
  }
  // PID is alive; verify it is Dolt by probing the port when one is known
  if (port == null) return true;
  return probePort(port, 500)
    .then(() => true)
    .catch(() => false);
}

/** Binds temporarily to port 0 to let the OS allocate a free port, then releases it. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Could not determine free port"));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/**
 * Spawn `dolt sql-server` as a detached background process, wait for it to
 * accept TCP connections, and return the PID.
 */
export async function startDoltServerProcess(
  doltRepoPath: string,
  port: number,
): Promise<{ pid: number }> {
  const doltPath = process.env.DOLT_PATH || "dolt";

  // Preflight: verify dolt binary exists and is executable
  try {
    await execa(doltPath, ["version"], { timeout: 3000 });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(
        `dolt binary not found at "${doltPath}". ` +
          `Install dolt: https://docs.dolthub.com/getting-started/installation ` +
          `or set the DOLT_PATH environment variable to the dolt binary path.`,
      );
    }
    throw err;
  }

  const server = spawn(
    doltPath,
    ["sql-server", "--port", String(port), "--data-dir", doltRepoPath],
    {
      cwd: doltRepoPath,
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    },
  );
  server.unref();
  const pid = server.pid;
  if (pid === undefined) {
    throw new Error("Failed to start dolt sql-server: no PID returned");
  }

  // Poll until the server accepts TCP connections (up to 15s)
  const host = "127.0.0.1";
  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i++) {
    const ready = await new Promise<boolean>((resolve) => {
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
      socket.connect(port, host);
    });
    if (ready) return { pid };
    await new Promise((r) => setTimeout(r, 300));
  }
  // If we reach here, kill the spawned process and report failure
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // already dead
  }
  throw new Error(
    `dolt sql-server did not become ready on ${host}:${port} after ${maxAttempts} attempts`,
  );
}

/**
 * If a live tg server is running for this repo, set TG_DOLT_SERVER_PORT and
 * TG_DOLT_SERVER_DATABASE so all subsequent doltSql calls use the fast pool path.
 * No-op when TG_DOLT_SERVER_PORT is already set (explicit override wins).
 */
export async function detectAndApplyServerPort(config: Config): Promise<void> {
  if (process.env.TG_DOLT_SERVER_PORT) return;
  const configDir = path.dirname(config.doltRepoPath);
  const meta = readServerMeta(configDir);
  if (!meta) return;
  if (!(await isServerAlive(meta.pid, meta.port))) {
    // Clean up stale meta — server is dead, don't leave orphaned state
    try {
      rmSync(serverMetaPath(configDir), { force: true });
      console.error("[tg] Removed stale server state (server not running)");
    } catch {
      // ignore cleanup errors
    }
    return;
  }
  if (path.resolve(meta.dataDir) !== path.resolve(config.doltRepoPath)) return;
  process.env.TG_DOLT_SERVER_PORT = String(meta.port);
  // The database name in dolt sql-server matches the directory name of the repo
  process.env.TG_DOLT_SERVER_DATABASE =
    process.env.TG_DOLT_SERVER_DATABASE ?? path.basename(config.doltRepoPath);
}

export function serverCommand(program: Command): void {
  const server = program
    .command("server")
    .description("Manage the background dolt sql-server for fast tg commands");

  server
    .command("start")
    .description("Start the dolt sql-server in the background")
    .action(async () => {
      const { readConfig } = await import("./utils.js");
      const configResult = readConfig();
      if (configResult.isErr()) {
        console.error("Error: no tg config found. Run `tg init` first.");
        process.exit(1);
      }
      const config = configResult.value;
      const configDir = path.dirname(config.doltRepoPath);
      const doltRepoPath = config.doltRepoPath;

      if (!existsSync(doltRepoPath)) {
        console.error(`Error: Dolt repo not found at ${doltRepoPath}`);
        process.exit(1);
      }

      // Idempotent: if already running for this repo, report and exit
      const existing = readServerMeta(configDir);
      if (existing && (await isServerAlive(existing.pid, existing.port))) {
        if (path.resolve(existing.dataDir) === path.resolve(doltRepoPath)) {
          console.log(
            `tg server already running (pid ${existing.pid}, port ${existing.port})`,
          );
          return;
        }
      }

      let port: number;
      try {
        port = await findFreePort();
      } catch {
        console.error("Error: could not find a free port");
        process.exit(1);
      }

      let pid: number;
      try {
        ({ pid } = await startDoltServerProcess(doltRepoPath, port));
      } catch (e) {
        console.error(`Error: failed to start dolt sql-server: ${e}`);
        process.exit(1);
      }

      writeServerMeta(configDir, { port, pid, dataDir: doltRepoPath });
      console.log(`tg server started (pid ${pid}, port ${port})`);
    });

  server
    .command("stop")
    .description("Stop the background dolt sql-server")
    .action(async () => {
      const { readConfig } = await import("./utils.js");
      const configResult = readConfig();
      if (configResult.isErr()) {
        console.error("Error: no tg config found.");
        process.exit(1);
      }
      const configDir = path.dirname(configResult.value.doltRepoPath);
      const meta = readServerMeta(configDir);
      if (!meta) {
        console.log("tg server is not running (no meta file found)");
        return;
      }
      if (!(await isServerAlive(meta.pid, meta.port))) {
        rmSync(serverMetaPath(configDir), { force: true });
        console.log("tg server was not running (stale meta removed)");
        return;
      }
      try {
        process.kill(-meta.pid, "SIGTERM");
      } catch {
        try {
          process.kill(meta.pid, "SIGTERM");
        } catch {
          // already dead
        }
      }
      // Wait up to 3 s for graceful exit, then escalate to SIGKILL
      const killDeadline = Date.now() + 3_000;
      while ((await isServerAlive(meta.pid)) && Date.now() < killDeadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (await isServerAlive(meta.pid)) {
        try {
          process.kill(-meta.pid, "SIGKILL");
        } catch {
          try {
            process.kill(meta.pid, "SIGKILL");
          } catch {
            // already dead
          }
        }
      }
      rmSync(serverMetaPath(configDir), { force: true });
      console.log(`tg server stopped (pid ${meta.pid})`);
    });

  server
    .command("status")
    .description("Show the status of the background dolt sql-server")
    .action(async () => {
      const { readConfig } = await import("./utils.js");
      const configResult = readConfig();
      if (configResult.isErr()) {
        console.log("stopped (no config)");
        return;
      }
      const configDir = path.dirname(configResult.value.doltRepoPath);
      const meta = readServerMeta(configDir);
      if (!meta) {
        console.log("stopped");
        return;
      }
      if (await isServerAlive(meta.pid, meta.port)) {
        console.log(`running (pid ${meta.pid}, port ${meta.port})`);
      } else {
        rmSync(serverMetaPath(configDir), { force: true });
        console.log("stopped (stale meta cleaned up)");
      }
    });
}
