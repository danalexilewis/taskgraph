import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { query } from "../../src/db/query";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("Benchmark plan import", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>>;

  beforeAll(async () => {
    context = await setupIntegrationTest();
  }, 30000);

  afterAll(async () => {
    await teardownIntegrationTest(context);
  }, 30000);

  it("imports CLI Benchmark Small plan and sets project.is_benchmark to 1", async () => {
    const { tempDir, doltRepoPath } = context;
    const plansDir = path.join(tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planFile = path.join(plansDir, "26-03-02_benchmark_cli_small.md");
    fs.writeFileSync(
      planFile,
      `---
name: CLI Benchmark Small
overview: Fixed-scope CLI smoke benchmark.
benchmark: true
todos:
  - id: cli-smoke-1
    content: Run tg status and verify exit code 0
---`,
    );
    const importCmd = `import plans/26-03-02_benchmark_cli_small.md --plan "CLI Benchmark Small" --format cursor --no-commit`;
    const { exitCode } = await runTgCli(importCmd, tempDir);
    expect(exitCode).toBe(0);

    const q = query(doltRepoPath);
    const result = await q.raw<{ is_benchmark: number }>(
      `SELECT is_benchmark FROM project WHERE title = 'CLI Benchmark Small'`,
    );
    expect(result.isOk()).toBe(true);
    const rows = result._unsafeUnwrap();
    expect(rows.length).toBe(1);
    expect(Number(rows[0].is_benchmark)).toBe(1);
  });
});
