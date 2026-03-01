/**
 * Sync task graph with a Dolt remote (push and/or pull).
 * Uses config.doltRepoPath and config.remoteUrl; ensures remote "origin" exists when remoteUrl is set.
 */

import type { Command } from "commander";
import { execa } from "execa";
import { ResultAsync } from "neverthrow";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { readConfig, rootOpts } from "./utils";

const REMOTE_NAME = "origin";
const doltPath = () => process.env.DOLT_PATH || "dolt";

function runDolt(
  args: string[],
  doltRepoPath: string,
): ResultAsync<{ stdout: string; stderr: string }, AppError> {
  return ResultAsync.fromPromise(
    execa(doltPath(), ["--data-dir", doltRepoPath, ...args], {
      cwd: doltRepoPath,
      env: { ...process.env, DOLT_READ_ONLY: "false" },
    }),
    (e) =>
      buildError(
        ErrorCode.DB_QUERY_FAILED,
        `Dolt ${args[0]} failed: ${(e as Error).message}`,
        e,
      ),
  );
}

function ensureRemote(
  doltRepoPath: string,
  remoteUrl: string,
): ResultAsync<void, AppError> {
  return runDolt(["remote", "-v"], doltRepoPath).andThen((result) => {
    const hasOrigin = new RegExp(`\\b${REMOTE_NAME}\\s+`).test(result.stdout);
    if (hasOrigin) {
      return ResultAsync.fromSafePromise(Promise.resolve(undefined));
    }
    return runDolt(["remote", "add", REMOTE_NAME, remoteUrl], doltRepoPath).map(
      () => undefined,
    );
  });
}

function getCurrentBranch(doltRepoPath: string): ResultAsync<string, AppError> {
  return runDolt(["branch", "--show-current"], doltRepoPath).map((result) => {
    const branch = (result.stdout || "").trim();
    return branch || "main";
  });
}

export function syncCommand(program: Command) {
  const _sync = program
    .command("sync")
    .description(
      "Push and/or pull the task graph Dolt repo with the configured remote (origin)",
    )
    .option("--push", "Push to remote only", false)
    .option("--pull", "Pull from remote only", false)
    .action(async (options, cmd) => {
      const configResult = readConfig();
      if (configResult.isErr()) {
        if (configResult.error.code === ErrorCode.CONFIG_NOT_FOUND) {
          console.error(configResult.error.message);
        } else {
          console.error(`Config error: ${configResult.error.message}`);
        }
        process.exit(1);
      }

      const config = configResult.value;
      const { doltRepoPath, remoteUrl } = config;
      const doPush = options.push || (!options.push && !options.pull);
      const doPull = options.pull || (!options.push && !options.pull);

      if (remoteUrl) {
        const ensureResult = await ensureRemote(doltRepoPath, remoteUrl);
        if (ensureResult.isErr()) {
          console.error(ensureResult.error.message);
          process.exit(1);
        }
      } else if (doPush || doPull) {
        console.error(
          "No remoteUrl in .taskgraph/config.json. Run 'tg init --remote-url <url>' or add remoteUrl to config to sync.",
        );
        process.exit(1);
      }

      const branchResult = await getCurrentBranch(doltRepoPath);
      if (branchResult.isErr()) {
        console.error(branchResult.error.message);
        process.exit(1);
      }
      const branch = branchResult.value;

      const json = rootOpts(cmd).json ?? false;
      const out: { pull?: string; push?: string; error?: string } = {};

      if (doPull) {
        const pullResult = await runDolt(
          ["pull", REMOTE_NAME, branch],
          doltRepoPath,
        );
        pullResult.match(
          (r) => {
            if (!json) console.log("Pull:", r.stdout || "ok");
            out.pull = r.stdout || "ok";
          },
          (e) => {
            if (!json) console.error("Pull failed:", e.message);
            out.error = e.message;
            process.exit(1);
          },
        );
      }

      if (doPush) {
        const pushResult = await runDolt(
          ["push", REMOTE_NAME, branch],
          doltRepoPath,
        );
        pushResult.match(
          (r) => {
            if (!json) console.log("Push:", r.stdout || "ok");
            out.push = r.stdout || "ok";
          },
          (e) => {
            if (!json) console.error("Push failed:", e.message);
            out.error = out.error ? `${out.error}; ${e.message}` : e.message;
            process.exit(1);
          },
        );
      }

      if (json) {
        console.log(JSON.stringify(out));
      }
    });
}
