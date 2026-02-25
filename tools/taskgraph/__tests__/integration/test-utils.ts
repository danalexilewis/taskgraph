import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execa } from "execa";
import { applyMigrations } from "../../src/db/migrate";
import { writeConfig } from "../../src/cli/utils";
import { Config } from "../../src/cli/utils";
import { doltSql } from "../../src/db/connection";

export interface IntegrationTestContext {
  tempDir: string;
  doltRepoPath: string;
  cliPath: string;
}

export async function setupIntegrationTest(): Promise<IntegrationTestContext> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-integration-"));
  const doltRepoPath = path.join(tempDir, ".taskgraph", "dolt");
  const cliPath = "./dist/cli/index.js";

  // Create .taskgraph/dolt directory
  fs.mkdirSync(doltRepoPath, { recursive: true });

  // Initialize Dolt repo
  await execa("dolt", ["init"], { cwd: doltRepoPath }); // Reverted to "dolt"

  // Write config
  writeConfig({ doltRepoPath: doltRepoPath }, tempDir).unwrapOrThrow(); // Corrected signature

  // Apply migrations
  (await applyMigrations(doltRepoPath)).unwrapOrThrow();

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
  const TG_BIN = "pnpm run start --filter taskgraph -- ";
  try {
    const { stdout, stderr, exitCode } = await execa(TG_BIN + command, {
      cwd,
      shell: true,
    });
    if (expectError && exitCode === 0) {
      throw new Error(
        `Expected command to fail but it succeeded. Output: ${stdout}, Error: ${stderr}`,
      );
    }
    if (!expectError && exitCode !== 0) {
      throw new Error(
        `Command failed unexpectedly. Exit Code: ${exitCode}, Output: ${stdout}, Error: ${stderr}`,
      );
    }
    return { stdout, stderr, exitCode };
  } catch (error: any) {
    if (expectError) {
      return {
        stdout: error.stdout || "",
        stderr: error.stderr || error.message,
        exitCode: error.exitCode ?? 1,
      };
    }
    throw error;
  }
}
