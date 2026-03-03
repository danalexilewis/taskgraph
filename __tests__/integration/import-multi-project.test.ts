import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { doltSql } from "../../src/db/connection";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("import single-project regression and multi-project", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });

    const singlePlanContent = `---
name: Single Project Regression
overview: "Regression: one plan, one file."
todos:
  - id: reg-1
    content: "Regression task 1"
    status: pending
  - id: reg-2
    content: "Regression task 2"
    blockedBy: [reg-1]
    status: pending
---
`;
    fs.writeFileSync(
      path.join(plansDir, "single-regression.md"),
      singlePlanContent,
    );

    const planA = `---
name: Multi Plan A
overview: "First plan."
todos:
  - id: a1
    content: "A1"
    status: pending
---
`;
    const planB = `---
name: Multi Plan B
overview: "Second plan."
todos:
  - id: b1
    content: "B1"
    status: pending
  - id: b2
    content: "B2"
    status: pending
---
`;
    fs.writeFileSync(path.join(plansDir, "plan-a.md"), planA);
    fs.writeFileSync(path.join(plansDir, "plan-b.md"), planB);
  }, 60000);

  afterAll(async () => {
    if (context) {
      await teardownIntegrationTest(context);
    }
  });

  it("single-project regression: imports one cursor plan and creates one project with tasks", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli(
      `import plans/single-regression.md --plan "Single Project Regression" --format cursor --no-commit`,
      context.tempDir,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Successfully imported");

    const projectsResult = await doltSql(
      `SELECT plan_id, title FROM \`project\` WHERE title = 'Single Project Regression'`,
      context.doltRepoPath,
    );
    expect(projectsResult.isOk()).toBe(true);
    const projects = projectsResult._unsafeUnwrap();
    expect(projects.length).toBe(1);

    const tasksResult = await doltSql(
      `SELECT task_id, external_key, title FROM \`task\` WHERE plan_id = (SELECT plan_id FROM \`project\` WHERE title = 'Single Project Regression') ORDER BY external_key`,
      context.doltRepoPath,
    );
    expect(tasksResult.isOk()).toBe(true);
    const tasks = tasksResult._unsafeUnwrap();
    expect(tasks.length).toBe(2);
  });

  it("multi-project: importing two separate plan files creates two projects with correct task counts", async () => {
    if (!context) throw new Error("Context not initialized");

    const runA = await runTgCli(
      `import plans/plan-a.md --plan "Multi Plan A" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(runA.exitCode).toBe(0);

    const runB = await runTgCli(
      `import plans/plan-b.md --plan "Multi Plan B" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(runB.exitCode).toBe(0);

    const projectsResult = await doltSql(
      `SELECT plan_id, title FROM \`project\` WHERE title IN ('Multi Plan A', 'Multi Plan B') ORDER BY title`,
      context.doltRepoPath,
    );
    expect(projectsResult.isOk()).toBe(true);
    const projects = projectsResult._unsafeUnwrap();
    expect(projects.length).toBe(2);

    const countAResult = await doltSql(
      `SELECT COUNT(*) as n FROM \`task\` WHERE plan_id = (SELECT plan_id FROM \`project\` WHERE title = 'Multi Plan A')`,
      context.doltRepoPath,
    );
    const countBResult = await doltSql(
      `SELECT COUNT(*) as n FROM \`task\` WHERE plan_id = (SELECT plan_id FROM \`project\` WHERE title = 'Multi Plan B')`,
      context.doltRepoPath,
    );
    expect(countAResult.isOk() && countBResult.isOk()).toBe(true);
    expect((countAResult._unsafeUnwrap() as { n: number }[])[0].n).toBe(1);
    expect((countBResult._unsafeUnwrap() as { n: number }[])[0].n).toBe(2);
  });
});
