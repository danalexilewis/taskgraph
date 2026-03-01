import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";
import {
  applyDomainToDocRenameMigration,
  applyHashIdMigration,
  applyMigrations,
  applyPlanRichFieldsMigration,
  applyTaskAgentMigration,
  applyTaskDimensionsMigration,
  applyTaskDomainSkillJunctionMigration,
  applyTaskSuggestedChangesMigration,
} from "../../src/db/migrate";

const DOLT_PATH = process.env.DOLT_PATH || "dolt";

/** Path file so worker processes can read the template path (globalSetup runs in a separate process). Use project-relative path so Bun workers with different TMPDIR still find it. */
export const GOLDEN_TEMPLATE_PATH_FILE = path.resolve(
  __dirname,
  "../../.taskgraph/tg-golden-template-path.txt",
);

/** Path file so worker processes can read the Dolt root path used during tests */
export const DOLT_ROOT_PATH_FILE = path.resolve(
  __dirname,
  "../../.taskgraph/tg-dolt-root-path.txt",
);

/** Port the golden template's dolt sql-server listens on */
const GOLDEN_SERVER_PORT = 13307;

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

export default async function globalSetup(): Promise<void> {
  // Clean default eventsData directory to avoid polluting user data
  const defaultDoltRoot =
    process.env.DOLT_ROOT_PATH || path.join(os.homedir(), ".dolt");
  const eventsDataPath = path.join(defaultDoltRoot, "eventsData");
  if (fs.existsSync(eventsDataPath)) {
    fs.rmSync(eventsDataPath, { recursive: true, force: true });
  }

  // Create a fresh temp directory for Dolt root and isolate eventsData there
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-golden-template-"));
  process.env.DOLT_ROOT_PATH = tempDir;
  fs.mkdirSync(path.join(tempDir, "eventsData"), { recursive: true });

  // Prepare a new Dolt repo for the golden template
  const doltRepoPath = path.join(tempDir, ".taskgraph", "dolt");
  fs.mkdirSync(doltRepoPath, { recursive: true });

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

  (await applyMigrations(doltRepoPath))._unsafeUnwrap();
  (await applyTaskDimensionsMigration(doltRepoPath))._unsafeUnwrap();
  (await applyTaskDomainSkillJunctionMigration(doltRepoPath))._unsafeUnwrap();
  (await applyDomainToDocRenameMigration(doltRepoPath))._unsafeUnwrap();
  (await applyTaskAgentMigration(doltRepoPath))._unsafeUnwrap();
  (await applyPlanRichFieldsMigration(doltRepoPath))._unsafeUnwrap();
  (await applyTaskSuggestedChangesMigration(doltRepoPath))._unsafeUnwrap();
  (await applyHashIdMigration(doltRepoPath))._unsafeUnwrap();

  // Expose paths for test runners (project-relative so all Bun workers see the same file)
  fs.mkdirSync(path.dirname(GOLDEN_TEMPLATE_PATH_FILE), { recursive: true });
  process.env.TG_GOLDEN_TEMPLATE = tempDir;
  fs.writeFileSync(GOLDEN_TEMPLATE_PATH_FILE, tempDir, "utf8");
  fs.writeFileSync(DOLT_ROOT_PATH_FILE, tempDir, "utf8");

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
  process.env.TG_DOLT_SERVER_DATABASE = path.basename(doltRepoPath);

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
}
