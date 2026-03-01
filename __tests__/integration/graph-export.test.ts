import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { doltSql } from "../../src/db/connection";
import { generateDotGraph } from "../../src/export/dot";
import { generateMermaidGraph } from "../../src/export/mermaid";
import { setupIntegrationTest, teardownIntegrationTest } from "./test-utils";

describe("Graph Export Integration Tests", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    // Seed some data
    (
      await doltSql(
        `INSERT INTO \`project\` (plan_id, title, intent, created_at, updated_at) VALUES (
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
        'Test Plan', 
        'An intent for the test plan', 
        NOW(), NOW()
      );`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();
    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES (
        'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
        'Task 1', 
        'todo', 
        NOW(), NOW()
      );`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();
    (
      await doltSql(
        `INSERT INTO \`task\` (task_id, plan_id, title, status, created_at, updated_at) VALUES (
        'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
        'Task 2', 
        'doing', 
        NOW(), NOW()
      );`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();
    (
      await doltSql(
        `INSERT INTO \`edge\` (from_task_id, to_task_id, type) VALUES (
        'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
        'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
        'blocks'
      );`,
        context.doltRepoPath,
      )
    )._unsafeUnwrap();
  }, 60000);

  afterAll(async () => {
    if (context) {
      await teardownIntegrationTest(context);
    }
  });

  it("should generate a mermaid graph from real Dolt data", async () => {
    if (!context) throw new Error("Context not initialized");
    const result = await generateMermaidGraph(
      undefined,
      undefined,
      context.tempDir,
    );
    expect(result.isOk()).toBe(true);
    const mermaidGraph = result._unsafeUnwrap();
    expect(mermaidGraph).toContain("graph TD");
    expect(mermaidGraph).toContain(
      'b0eebc999c0b4ef8bb6d6bb9bd380a11["Task 1 (todo)"]',
    );
    expect(mermaidGraph).toContain(
      'c0eebc999c0b4ef8bb6d6bb9bd380a11["Task 2 (doing)"]',
    );
    expect(mermaidGraph).toContain(
      "b0eebc999c0b4ef8bb6d6bb9bd380a11 --> c0eebc999c0b4ef8bb6d6bb9bd380a11",
    );
  });

  it("should generate a DOT graph from real Dolt data", async () => {
    if (!context) throw new Error("Context not initialized");
    const result = await generateDotGraph(
      undefined,
      undefined,
      context.tempDir,
    );
    expect(result.isOk()).toBe(true);
    const dotGraph = result._unsafeUnwrap();
    expect(dotGraph).toContain("digraph TaskGraph {");
    expect(dotGraph).toContain(
      '"b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" [label="Task 1 (todo)"];',
    );
    expect(dotGraph).toContain(
      '"c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" [label="Task 2 (doing)"];',
    );
    expect(dotGraph).toContain(
      '"b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" -> "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" [label="blocks"];',
    );
  });
});
