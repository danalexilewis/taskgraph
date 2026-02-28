import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type ExecaError, execa } from "execa";
import { writeConfig } from "../../src/cli/utils";
import { GOLDEN_TEMPLATE_PATH_FILE } from "./global-setup";

export interface IntegrationTestContext {
  tempDir: string;
  doltRepoPath: string;
  cliPath: string;
}

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

export async function setupIntegrationTest(): Promise<IntegrationTestContext> {
  const templatePath = getGoldenTemplatePath();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-integration-"));
  const doltRepoPath = path.join(tempDir, ".taskgraph", "dolt");
  const cliPath = path.resolve(__dirname, "../../dist/cli/index.js");

  fs.cpSync(templatePath, tempDir, { recursive: true });
  writeConfig({ doltRepoPath }, tempDir)._unsafeUnwrap();

  return { tempDir, doltRepoPath, cliPath };
}

export function teardownIntegrationTest(tempDir: string) {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// Helper to run CLI commands in the integration test context
export async function runTgCli(
  command: string,
  cwd: string,
  expectError = false,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cliPath = path.resolve(__dirname, "../../dist/cli/index.js");
  const TG_BIN = `node ${cliPath} `;
  try {
    const result = await execa(TG_BIN + command, {
      cwd,
      shell: true,
      env: { ...process.env, DOLT_PATH },
    });
    const stdout = result.stdout;
    const stderr = result.stderr;
    const exitCode = result.exitCode ?? 0; // Explicit handling
    if (expectError && exitCode === 0) {
      throw new Error(
        `Expected command to fail but it succeeded. Output: ${stdout}, Error: ${stderr}`,
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
