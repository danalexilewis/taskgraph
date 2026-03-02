import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { doltSql } from "../../src/db/connection";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("Import benchmark frontmatter", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>>;

  beforeAll(async () => {
    context = await setupIntegrationTest();
  });

  afterAll(async () => {
    await teardownIntegrationTest(context);
  });

  it("imports plan with benchmark frontmatter without --benchmark flag", async () => {
    const { tempDir, doltRepoPath } = context;
    const plansDir = path.join(tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planFile = path.join(plansDir, "frontmatter-plan.md");
    const content = `---
name: Frontmatter Benchmark Plan
overview: "Plan with benchmark frontmatter."
benchmark: true
todos:
  - id: task-front
    content: "Frontmatter task"
---
`;
    fs.writeFileSync(planFile, content);
    const importCmd = `import plans/frontmatter-plan.md --plan "Frontmatter Benchmark Plan" --format cursor --no-commit`;
    const res = await runTgCli(importCmd, tempDir);
    expect(res.exitCode).toBe(0);
    const result = await doltSql(
      `SELECT is_benchmark FROM project WHERE title = 'Frontmatter Benchmark Plan'`,
      doltRepoPath,
    );
    expect(result.isOk()).toBe(true);
    const rows = result._unsafeUnwrap();
    expect(rows.length).toBe(1);
    expect(rows[0].is_benchmark).toBe(1);
  });
});
