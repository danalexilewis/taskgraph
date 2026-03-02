import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { doltSql } from "../../src/db/connection";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("Import benchmark flag", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>>;

  beforeAll(async () => {
    context = await setupIntegrationTest();
  });

  afterAll(async () => {
    await teardownIntegrationTest(context);
  });

  it("imports plan without benchmark frontmatter but with --benchmark flag", async () => {
    const { tempDir, doltRepoPath } = context;
    const plansDir = path.join(tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planFile = path.join(plansDir, "flag-plan.md");
    const content = `---
name: Flag Benchmark Plan
overview: "Plan without benchmark frontmatter but using CLI flag."
todos:
  - id: task-flag
    content: "Flagged task"
---
`;
    fs.writeFileSync(planFile, content);
    const importCmd = `import plans/flag-plan.md --plan "Flag Benchmark Plan" --format cursor --benchmark --no-commit`;
    const res = await runTgCli(importCmd, tempDir);
    expect(res.exitCode).toBe(0);
    const result = await doltSql(
      `SELECT is_benchmark FROM project WHERE title = 'Flag Benchmark Plan'`,
      doltRepoPath,
    );
    expect(result.isOk()).toBe(true);
    const rows = result._unsafeUnwrap();
    expect(rows.length).toBe(1);
    expect(rows[0].is_benchmark).toBe(1);
  });
});
