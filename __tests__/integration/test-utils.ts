import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { CommanderError } from "commander";
import { type ExecaError, execa } from "execa";
import { createProgram } from "../../src/cli/index";
import { writeConfig } from "../../src/cli/utils";
import { closeServerPool } from "../../src/db/connection";
import { ensureMigrations } from "../../src/db/migrate";
import { DOLT_ROOT_PATH_FILE, GOLDEN_TEMPLATE_PATH_FILE } from "./global-setup";

// Load .env.local from project root so single-file integration runs work (bun test does not auto-load it)
const projectRoot = path.resolve(__dirname, "..", "..");
const envLocalPath = path.join(projectRoot, ".env.local");
if (fs.existsSync(envLocalPath)) {
  const content = fs.readFileSync(envLocalPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.replace(/#.*$/, "").trim();
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) {
      const value = m[2].replace(/^["']|["']$/g, "").trim();
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  }
}

export interface IntegrationTestContext {
  tempDir: string;
  doltRepoPath: string;
  cliPath: string;
  /** Set when per-test dolt sql-server is started; used by teardown to kill and close pool */
  serverPid?: number;
  serverPort?: string;
}

/** Per-worker counter for unique per-test server ports (13310 + offset) */
let perTestPortCounter = 0;
const PER_TEST_PORT_BASE = 13310;
const PER_TEST_PORT_RANGE = 90;

const DOLT_PATH = process.env.DOLT_PATH || "dolt";
if (!process.env.DOLT_PATH) process.env.DOLT_PATH = DOLT_PATH;

function getGoldenTemplatePath(): string {
  if (process.env.TG_GOLDEN_TEMPLATE) return process.env.TG_GOLDEN_TEMPLATE;
  if (!fs.existsSync(GOLDEN_TEMPLATE_PATH_FILE)) {
    throw new Error(
      "TG_GOLDEN_TEMPLATE not set and golden template path file not found. Run integration tests via vitest with integration config (globalSetup creates the template).",
    );
  }
  return fs.readFileSync(GOLDEN_TEMPLATE_PATH_FILE, "utf8").trim();
}

function getDoltRootPath(): string {
  if (process.env.DOLT_ROOT_PATH) return process.env.DOLT_ROOT_PATH;
  if (!fs.existsSync(DOLT_ROOT_PATH_FILE)) {
    throw new Error(
      "DOLT_ROOT_PATH not set and dolt root path file not found. Run integration global setup first.",
    );
  }
  return fs.readFileSync(DOLT_ROOT_PATH_FILE, "utf8").trim();
}

/** Start dolt sql-server on repo path and port; wait for TCP ready. Returns PID. */
async function startDoltServer(
  doltRepoPath: string,
  port: number,
): Promise<number> {
  const server = spawn(
    DOLT_PATH,
    ["sql-server", "--port", String(port), "--data-dir", doltRepoPath],
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
  const host = "127.0.0.1";
  const maxAttempts = 30;
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
      socket.connect(port, host);
    });
    if (ok) return pid;
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore
  }
  throw new Error(
    `dolt sql-server did not become ready on ${host}:${port} after ${maxAttempts} attempts`,
  );
}

export async function setupIntegrationTest(): Promise<IntegrationTestContext> {
  // Ensure Dolt root path is isolated
  const doltRootPath = getDoltRootPath();
  process.env.DOLT_ROOT_PATH = doltRootPath;

  const templatePath = getGoldenTemplatePath();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-integration-"));
  const doltRepoPath = path.join(tempDir, ".taskgraph", "dolt");
  const cliPath = path.resolve(__dirname, "../../dist/cli/index.js");

  fs.cpSync(templatePath, tempDir, { recursive: true });
  writeConfig({ doltRepoPath }, tempDir)._unsafeUnwrap();

  const port =
    PER_TEST_PORT_BASE +
    (((process.pid ?? 0) + perTestPortCounter++) % PER_TEST_PORT_RANGE);
  const serverPid = await startDoltServer(doltRepoPath, port);
  process.env.TG_DOLT_SERVER_PORT = String(port);
  process.env.TG_DOLT_SERVER_DATABASE = path.basename(doltRepoPath);
  (await ensureMigrations(doltRepoPath))._unsafeUnwrap();

  return {
    tempDir,
    doltRepoPath,
    cliPath,
    serverPid,
    serverPort: String(port),
  };
}

export async function teardownIntegrationTest(
  contextOrTempDir: IntegrationTestContext | string,
): Promise<void> {
  const context: Partial<IntegrationTestContext> & { tempDir: string } =
    typeof contextOrTempDir === "string"
      ? { tempDir: contextOrTempDir }
      : contextOrTempDir;
  if (context.serverPort) {
    try {
      await closeServerPool(context.serverPort);
    } catch {
      // Pool may already be closed
    }
  }
  if (context.serverPid !== undefined) {
    try {
      process.kill(context.serverPid, "SIGTERM");
    } catch {
      // Process may already be dead
    }
  }
  if (fs.existsSync(context.tempDir)) {
    fs.rmSync(context.tempDir, { recursive: true, force: true });
  }
}

/** Thrown when a CLI handler calls process.exit(code) during in-process run. */
class ProcessExitError extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`);
    this.name = "ProcessExitError";
  }
}

/** Run CLI in-process (no subprocess). Captures stdout/stderr via console intercept. */
export async function runTgCliInProcess(
  command: string,
  cwd: string,
  expectError = false,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const savedCwd = process.cwd();
  const savedLog = console.log;
  const savedError = console.error;
  const savedWarn = console.warn;
  const savedExit = process.exit;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const origEnv = { ...process.env };
  try {
    process.chdir(cwd);
    process.env.TG_SKIP_MIGRATE = "1";
    process.env.DOLT_ROOT_PATH = getDoltRootPath();
    console.log = (...args: unknown[]) =>
      stdoutChunks.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) =>
      stderrChunks.push(args.map(String).join(" "));
    console.warn = (...args: unknown[]) =>
      stderrChunks.push(args.map(String).join(" "));
    // CLI handlers call process.exit(1) on error; override so we capture and return instead of killing the test process
    process.exit = ((code?: number) => {
      throw new ProcessExitError(typeof code === "number" ? code : 0);
    }) as typeof process.exit;

    // Parse command preserving quoted strings so e.g. --evidence "foo bar" stays one arg
    const parts =
      command
        .trim()
        .match(/("([^"]*)"|'([^']*)'|\S+)/g)
        ?.map((s) => s.replace(/^["']|["']$/g, "")) ?? [];
    const hasNoCommit = parts.includes("--no-commit");
    const argv = ["node", "tg", ...parts];
    if (!hasNoCommit) argv.push("--no-commit");

    const program = createProgram();
    program.exitOverride();
    let exitCode = 0;
    try {
      await program.parseAsync(argv);
    } catch (err) {
      if (err instanceof ProcessExitError) {
        exitCode = err.exitCode;
        if (!expectError && exitCode !== 0) {
          const stderr = stderrChunks.join("");
          throw new Error(
            `Command failed unexpectedly. Exit Code: ${exitCode}, stderr: ${stderr}`,
          );
        }
      } else if (err instanceof CommanderError) {
        exitCode = err.exitCode ?? 1;
        if (!expectError && exitCode !== 0) {
          const stderr = stderrChunks.join("");
          throw new Error(
            `Command failed unexpectedly. Exit Code: ${exitCode}, stderr: ${stderr}`,
          );
        }
      } else {
        throw err;
      }
    }
    if (expectError && exitCode === 0) {
      throw new Error(
        `Expected command to fail but it succeeded. stdout: ${stdoutChunks.join("")}`,
      );
    }
    return {
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
      exitCode,
    };
  } finally {
    process.exit = savedExit;
    process.chdir(savedCwd);
    process.env.TG_SKIP_MIGRATE = origEnv.TG_SKIP_MIGRATE;
    process.env.DOLT_ROOT_PATH = origEnv.DOLT_ROOT_PATH;
    console.log = savedLog;
    console.error = savedError;
    console.warn = savedWarn;
  }
}

/** Run CLI via subprocess (node dist/cli). Use for cursor-import and setup-scaffold. */
export async function runTgCliSubprocess(
  command: string,
  cwd: string,
  expectError = false,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cliPath = path.resolve(__dirname, "../../dist/cli/index.js");
  const finalCommand = command.includes("--no-commit")
    ? command
    : `${command} --no-commit`;
  const TG_BIN = `node ${cliPath} `;
  try {
    const result = await execa(TG_BIN + finalCommand, {
      cwd,
      shell: true,
      env: { ...process.env, DOLT_PATH, TG_SKIP_MIGRATE: "1" },
    });
    const exitCode = result.exitCode ?? 0;
    if (expectError && exitCode === 0) {
      throw new Error(
        `Expected command to fail but it succeeded. Output: ${result.stdout}, Error: ${result.stderr}`,
      );
    }
    if (!expectError && exitCode !== 0) {
      throw new Error(
        `Command failed unexpectedly. Exit Code: ${exitCode}, Output: ${result.stdout}, Error: ${result.stderr}`,
      );
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode };
  } catch (error: unknown) {
    const execaError = error as ExecaError;
    if (expectError) {
      return {
        stdout: execaError.stdout?.toString() || "",
        stderr: execaError.stderr?.toString() || execaError.message,
        exitCode: execaError.exitCode ?? 1,
      };
    }
    throw error;
  }
}

// Default: in-process unless TG_IN_PROCESS_CLI === '0'
export async function runTgCli(
  command: string,
  cwd: string,
  expectError = false,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (process.env.TG_IN_PROCESS_CLI === "0") {
    return runTgCliSubprocess(command, cwd, expectError);
  }
  return runTgCliInProcess(command, cwd, expectError);
}
