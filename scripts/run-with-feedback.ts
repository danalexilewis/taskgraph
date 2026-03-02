/**
 * Runs a command with visual feedback: spinner + elapsed time.
 * Use for long-running scripts (e.g. gate:full) when you want dynamic feedback.
 *
 * Usage:
 *   bun run scripts/run-with-feedback.ts "gate:full" -- pnpm gate:full
 *   bun run scripts/run-with-feedback.ts "tests" -- pnpm gate:full > /tmp/out.txt 2>&1
 *
 * With output redirected, only the spinner line is shown until the command exits.
 * Without redirect, command output streams below the spinner line.
 */

import { spawn } from "node:child_process";
import ora from "ora";

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${min}m ${s}s` : `${min}m`;
}

function parseArgs(argv: string[]): { label: string; command: string[] } {
  const dashDash = argv.indexOf("--");
  if (dashDash === -1) {
    console.error("Usage: run-with-feedback.ts <label> -- <command> [args...]");
    process.exit(1);
  }
  const label = argv[dashDash - 1];
  if (!label || label.startsWith("-")) {
    console.error("Missing or invalid label before --");
    process.exit(1);
  }
  const command = argv.slice(dashDash + 1);
  if (command.length === 0) {
    console.error("Missing command after --");
    process.exit(1);
  }
  return { label, command };
}

async function main(): Promise<void> {
  const { label, command } = parseArgs(process.argv.slice(2));
  const fullCmd = command.join(" ");
  const shell = process.env.SHELL || "bash";

  const spinner = ora({
    text: `Running ${label}... 0s`,
    stream: process.stderr,
  }).start();

  const start = Date.now();
  const tick = setInterval(() => {
    spinner.text = `Running ${label}... ${formatElapsed(Date.now() - start)}`;
  }, 1000);

  const child = spawn(shell, ["-c", fullCmd], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  let exitCode = 0;
  await new Promise<void>((resolve) => {
    child.on("close", (code, signal) => {
      clearInterval(tick);
      exitCode = code ?? (signal ? 128 : 0);
      const elapsed = Date.now() - start;
      const elapsedStr = formatElapsed(elapsed);
      if (code === 0) {
        spinner.succeed(`Finished ${label} in ${elapsedStr}`);
      } else {
        spinner.fail(
          `Finished ${label} in ${elapsedStr} (exit ${code ?? signal ?? "?"})`,
        );
      }
      resolve();
    });
  });

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("run-with-feedback failed:", err);
  process.exit(1);
});
