#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

interface Result {
  command: string;
  durationMs: number;
  exitCode: number;
}

interface SuiteTaskResult {
  task: string;
  durationMs: number;
  exitCode: number;
}

const BENCHMARK_ROOT = ".benchmark";
const CUSTOM_PROBLEMS_DIR = join(BENCHMARK_ROOT, "problems", "custom");
const RESULTS_DIR = join(BENCHMARK_ROOT, "results");

function discoverCustomTasks(repoRoot: string): string[] {
  const customPath = join(repoRoot, CUSTOM_PROBLEMS_DIR);
  if (!existsSync(customPath)) return [];
  const entries = readdirSync(customPath, { withFileTypes: true });
  const tasks: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const runSh = join(customPath, e.name, "run.sh");
    if (existsSync(runSh)) tasks.push(e.name);
  }
  return tasks.sort();
}

function runCustomSuite(repoRoot: string): SuiteTaskResult[] {
  const tasks = discoverCustomTasks(repoRoot);
  const results: SuiteTaskResult[] = [];
  const customPath = join(repoRoot, CUSTOM_PROBLEMS_DIR);
  for (const task of tasks) {
    const taskDir = join(customPath, task);
    const runSh = join(taskDir, "run.sh");
    const start = performance.now();
    const proc = spawnSync("bash", [runSh], {
      cwd: taskDir,
      stdio: "pipe",
    });
    const durationMs = Math.round(performance.now() - start);
    results.push({
      task,
      durationMs,
      exitCode: proc.status ?? -1,
    });
  }
  return results;
}

function writeSuiteResults(repoRoot: string, results: SuiteTaskResult[]): void {
  const resultsPath = join(repoRoot, RESULTS_DIR);
  mkdirSync(resultsPath, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = `custom-${timestamp}`;

  const jsonPath = join(resultsPath, `${slug}.json`);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      { timestamp: new Date().toISOString(), results },
      null,
      2,
    ),
  );

  const csvPath = join(resultsPath, `${slug}.csv`);
  const csvLines = ["task,durationMs,exitCode", ...results.map((r) => `${r.task},${r.durationMs},${r.exitCode}`)];
  writeFileSync(csvPath, csvLines.join("\n") + "\n");

  console.log("Wrote", jsonPath);
  console.log("Wrote", csvPath);
}

function main() {
  const args = process.argv.slice(2);
  const repoRoot = process.cwd();

  const runSuite = args.length === 0 || args[0] === "--suite" || args[0] === "--custom";
  if (runSuite) {
    const results = runCustomSuite(repoRoot);
    writeSuiteResults(repoRoot, results);
    const failed = results.filter((r) => r.exitCode !== 0);
    if (failed.length > 0) {
      console.error("Failed tasks:", failed.map((r) => r.task).join(", "));
      process.exit(1);
    }
    return;
  }

  const csv = args[0] === "--csv" || args[0] === "-c";
  const commands = csv ? args.slice(1) : args;
  if (commands.length < 1) {
    console.error(
      "Usage: run-benchmark.ts [--suite|--custom] | [--csv|-c] <command> [<command>...]",
    );
    process.exit(1);
  }
  const results: Result[] = [];
  for (const cmd of commands) {
    const parts = cmd.split(" ");
    const start = performance.now();
    const proc = spawnSync(parts[0], parts.slice(1), { stdio: "ignore" });
    const durationMs = Math.round(performance.now() - start);
    results.push({
      command: cmd,
      durationMs,
      exitCode: proc.status ?? -1,
    });
  }
  if (csv) {
    console.log("command,durationMs,exitCode");
    for (const r of results) {
      console.log(`${r.command},${r.durationMs},${r.exitCode}`);
    }
  } else {
    console.log(JSON.stringify(results, null, 2));
  }
}

main();
