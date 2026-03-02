import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { query } from "../../src/db/query";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("Import sample benchmark plans", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>>;

  beforeAll(async () => {
    context = await setupIntegrationTest();
  });

  afterAll(async () => {
    await teardownIntegrationTest(context);
  });

  it("imports Import Benchmark Plan with benchmark frontmatter", async () => {
    const { tempDir, doltRepoPath } = context;
    const plansDir = path.join(tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planFile = path.join(plansDir, "26-03-02_import_benchmark_plan.md");
    const content = `---
name: Import Benchmark Plan
overview: "Fixed-scope plan for import benchmarking."
benchmark: true
todos:
  - id: import-task
    content: "Import the plan"
---`;
    fs.writeFileSync(planFile, content);
    const importCmd = `import plans/26-03-02_import_benchmark_plan.md --plan "Import Benchmark Plan" --format cursor --no-commit`;
    const res = await runTgCli(importCmd, tempDir);
    expect(res.exitCode).toBe(0);
    const q = query(doltRepoPath);
    const result = await q.raw<{ is_benchmark: number }>(
      `SELECT is_benchmark FROM project WHERE title = 'Import Benchmark Plan'`,
    );
    expect(result.isOk()).toBe(true);
    const rows = result._unsafeUnwrap();
    expect(rows.length).toBe(1);
    expect(Number(rows[0].is_benchmark)).toBe(1);
  });

  it("imports Stats Benchmark Plan with benchmark frontmatter", async () => {
    const { tempDir, doltRepoPath } = context;
    const plansDir = path.join(tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planFile = path.join(plansDir, "26-03-02_stats_benchmark_plan.md");
    const content = `---
name: Stats Benchmark Plan
overview: "Fixed-scope plan for stats benchmarking."
benchmark: true
todos:
  - id: stats-task
    content: "Run stats on benchmark plan"
---`;
    fs.writeFileSync(planFile, content);
    const importCmd = `import plans/26-03-02_stats_benchmark_plan.md --plan "Stats Benchmark Plan" --format cursor --no-commit`;
    const res = await runTgCli(importCmd, tempDir);
    expect(res.exitCode).toBe(0);
    const q = query(doltRepoPath);
    const result = await q.raw<{ is_benchmark: number }>(
      `SELECT is_benchmark FROM project WHERE title = 'Stats Benchmark Plan'`,
    );
    expect(result.isOk()).toBe(true);
    const rows = result._unsafeUnwrap();
    expect(rows.length).toBe(1);
    expect(Number(rows[0].is_benchmark)).toBe(1);
  });
});
