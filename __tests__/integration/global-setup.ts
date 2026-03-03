import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import execa from "execa";
import { clearConfigCache } from "../../src/config";
import { applyMigrations, ensureMigrations } from "../../src/db/migrate";
import { recordDoltBaseline } from "./dolt-leak-check";

const DOLT_PATH = process.env.DOLT_PATH || "dolt";

/** Fixed path for the golden template (relative to .taskgraph). No env or path file — global setup generates it here. */
export const GOLDEN_TEMPLATE_DIR = path.resolve(
  __dirname,
  "../../.taskgraph/tg-golden-template",
);

/** Path file so worker processes can read the Dolt root path used during tests */
export const DOLT_ROOT_PATH_FILE = path.resolve(
  __dirname,
  "../../.taskgraph/tg-dolt-root-path.txt",
);

/** Port the golden template's dolt sql-server listens on. Override via TG_GOLDEN_SERVER_PORT (optional). */
const DEFAULT_GOLDEN_PORT = 13307;
const GOLDEN_SERVER_PORT = (() => {
  const raw = process.env.TG_GOLDEN_SERVER_PORT;
  if (raw == null || raw === "") return DEFAULT_GOLDEN_PORT;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 1 || n > 65535) return DEFAULT_GOLDEN_PORT;
  return n;
})();

/** Path file so workers can read the golden server port (optional; per-test servers set TG_DOLT_SERVER_PORT in-process). */
export const DOLT_SERVER_PORT_FILE = path.resolve(
  __dirname,
  "../../.taskgraph/tg-dolt-server-port.txt",
);

/** Path file for global-teardown to kill the golden dolt sql-server process */
export const GOLDEN_SERVER_PID_FILE = path.resolve(
  __dirname,
  "../../.taskgraph/tg-golden-server-pid.txt",
);

/** JSON file tracking PIDs of all per-test dolt servers spawned by test-utils.
 *  Written on spawn, cleaned on teardown. global-teardown kills any survivors.
 *  global-setup kills stale entries from a previous crashed run on startup. */
export const TEST_SERVER_PID_REGISTRY = path.resolve(
  __dirname,
  "../../.taskgraph/tg-test-server-pids.json",
);

/** Kill stale per-test server PIDs left by a previously crashed test run. */
function killStalePidRegistry(): void {
  if (!fs.existsSync(TEST_SERVER_PID_REGISTRY)) return;
  try {
    const pids: number[] = JSON.parse(
      fs.readFileSync(TEST_SERVER_PID_REGISTRY, "utf8"),
    );
    for (const pid of pids) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // already dead
      }
    }
    fs.unlinkSync(TEST_SERVER_PID_REGISTRY);
  } catch {
    // corrupt or missing — remove and continue
    try {
      fs.unlinkSync(TEST_SERVER_PID_REGISTRY);
    } catch {
      // ignore
    }
  }
}

/** Throw a clear error if dolt is missing. */
async function ensureDoltAvailable(): Promise<void> {
  try {
    await execa(DOLT_PATH, ["--version"]);
  } catch (e) {
    const msg =
      e && typeof (e as NodeJS.ErrnoException).code === "string"
        ? (e as NodeJS.ErrnoException).code === "ENOENT"
          ? `dolt not found (DOLT_PATH=${DOLT_PATH}). Install dolt (e.g. brew install dolt) or set DOLT_PATH.`
          : `dolt failed (${(e as NodeJS.ErrnoException).code}): ${DOLT_PATH}`
        : `dolt not found or failed: ${DOLT_PATH}. Install dolt (e.g. brew install dolt) or set DOLT_PATH.`;
    throw new Error(msg);
  }
}

/** Throw a clear error if the golden server port is already in use. */
function ensurePortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is already in use. Stop the process using it or change GOLDEN_SERVER_PORT.`,
          ),
        );
      } else {
        reject(err);
      }
    });
    server.once("listening", () => {
      server.close(() => resolve());
    });
    server.listen(port, "127.0.0.1");
  });
}

export default async function globalSetup(): Promise<void> {
  clearConfigCache();
  // Kill any stale per-test dolt servers from a previous crashed run
  killStalePidRegistry();

  // Ensure golden-template migrations always use the subprocess (execa) path, not any
  // externally-configured SQL server (which may point at the production DB and cause
  // migration checks to short-circuit against wrong tables).
  delete process.env.TG_DOLT_SERVER_PORT;
  delete process.env.TG_DOLT_SERVER_DATABASE;
  delete process.env.TG_DOLT_SERVER_USER;
  delete process.env.TG_DOLT_SERVER_PASSWORD;

  await ensureDoltAvailable();
  await ensurePortFree(GOLDEN_SERVER_PORT);

  // Generate golden template at fixed path under .taskgraph
  if (fs.existsSync(GOLDEN_TEMPLATE_DIR)) {
    fs.rmSync(GOLDEN_TEMPLATE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(GOLDEN_TEMPLATE_DIR, ".taskgraph", "dolt"), {
    recursive: true,
  });
  const doltRepoPath = path.join(GOLDEN_TEMPLATE_DIR, ".taskgraph", "dolt");

  // Isolate Dolt identity and eventsData under the template dir
  process.env.DOLT_ROOT_PATH = GOLDEN_TEMPLATE_DIR;
  const eventsDataPath = path.join(GOLDEN_TEMPLATE_DIR, "eventsData");
  fs.mkdirSync(eventsDataPath, { recursive: true });

  await execa(
    DOLT_PATH,
    ["config", "--global", "--add", "user.email", "integration@example.com"],
    { cwd: doltRepoPath },
  );
  await execa(
    DOLT_PATH,
    ["config", "--global", "--add", "user.name", "Integration Test"],
    { cwd: doltRepoPath },
  );
  await execa(DOLT_PATH, ["init"], {
    cwd: doltRepoPath,
    env: { ...process.env, DOLT_PATH },
  });

  try {
    (await applyMigrations(doltRepoPath))._unsafeUnwrap();
    (await ensureMigrations(doltRepoPath))._unsafeUnwrap();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Migration failed: ${message}`);
  }

  // Dolt root for test workers (isolated temp dir for eventsData etc.)
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tg-dolt-root-"));
  fs.mkdirSync(path.join(tempRoot, "eventsData"), { recursive: true });
  fs.writeFileSync(DOLT_ROOT_PATH_FILE, tempRoot, "utf8");

  // Start dolt sql-server on the golden template so a single server is available; per-test servers are started in test-utils
  const server = spawn(
    DOLT_PATH,
    [
      "sql-server",
      "--port",
      String(GOLDEN_SERVER_PORT),
      "--data-dir",
      doltRepoPath,
    ],
    {
      cwd: doltRepoPath,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, DOLT_PATH },
    },
  );
  server.unref();
  const pid = server.pid;
  if (pid === undefined) {
    throw new Error("Failed to start dolt sql-server: no PID");
  }
  fs.writeFileSync(DOLT_SERVER_PORT_FILE, String(GOLDEN_SERVER_PORT), "utf8");
  fs.writeFileSync(GOLDEN_SERVER_PID_FILE, String(pid), "utf8");
  process.env.TG_DOLT_SERVER_PORT = String(GOLDEN_SERVER_PORT);
  process.env.TG_DOLT_SERVER_DATABASE = "dolt";

  // Wait for server to accept TCP connections
  const maxAttempts = 30;
  const host = "127.0.0.1";
  for (let i = 0; i < maxAttempts; i++) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 1000);
      socket.on("connect", () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
      socket.connect(Number(GOLDEN_SERVER_PORT), host);
    });
    if (ok) break;
    if (i === maxAttempts - 1) {
      throw new Error(
        `dolt sql-server did not become ready on ${host}:${GOLDEN_SERVER_PORT} after ${maxAttempts} attempts`,
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Record dolt process count as baseline for global-teardown leak check
  recordDoltBaseline();
}
