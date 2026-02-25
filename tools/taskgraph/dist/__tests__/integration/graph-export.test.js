"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const test_utils_1 = require("./test-utils");
const mermaid_1 = require("../../src/export/mermaid");
const dot_1 = require("../../src/export/dot");
const connection_1 = require("../../src/db/connection");
(0, vitest_1.describe)("Graph Export Integration Tests", () => {
    let context;
    (0, vitest_1.beforeAll)(async () => {
        context = await (0, test_utils_1.setupIntegrationTest)();
        // Seed some data
        await (0, connection_1.doltSql)(`INSERT INTO plan (plan_id, title, intent, created_at, updated_at) VALUES (
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
        'Test Plan', 
        'An intent for the test plan', 
        NOW(), NOW()
      );`, context.doltRepoPath).unwrapOrThrow();
        await (0, connection_1.doltSql)(`INSERT INTO task (task_id, plan_id, title, status, created_at, updated_at) VALUES (
        'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
        'Task 1', 
        'todo', 
        NOW(), NOW()
      );`, context.doltRepoPath).unwrapOrThrow();
        await (0, connection_1.doltSql)(`INSERT INTO task (task_id, plan_id, title, status, created_at, updated_at) VALUES (
        'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
        'Task 2', 
        'doing', 
        NOW(), NOW()
      );`, context.doltRepoPath).unwrapOrThrow();
        await (0, connection_1.doltSql)(`INSERT INTO edge (from_task_id, to_task_id, type) VALUES (
        'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
        'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
        'blocks'
      );`, context.doltRepoPath).unwrapOrThrow();
    }, 60000);
    (0, vitest_1.afterAll)(() => {
        if (context) {
            (0, test_utils_1.teardownIntegrationTest)(context.tempDir);
        }
    });
    (0, vitest_1.it)("should generate a mermaid graph from real Dolt data", async () => {
        if (!context)
            throw new Error("Context not initialized");
        const result = await (0, mermaid_1.generateMermaidGraph)(undefined, undefined, context.tempDir);
        (0, vitest_1.expect)(result.isOk()).toBe(true);
        const mermaidGraph = result._unsafeUnwrap();
        (0, vitest_1.expect)(mermaidGraph).toContain("graph TD");
        (0, vitest_1.expect)(mermaidGraph).toContain('b0eebc999c0b4ef8bb6d6bb9bd380a11["Task 1 (todo)"]');
        (0, vitest_1.expect)(mermaidGraph).toContain('c0eebc999c0b4ef8bb6d6bb9bd380a11["Task 2 (doing)"]');
        (0, vitest_1.expect)(mermaidGraph).toContain("b0eebc999c0b4ef8bb6d6bb9bd380a11 --> c0eebc999c0b4ef8bb6d6bb9bd380a11");
    });
    (0, vitest_1.it)("should generate a DOT graph from real Dolt data", async () => {
        if (!context)
            throw new Error("Context not initialized");
        const result = await (0, dot_1.generateDotGraph)(undefined, undefined, context.tempDir);
        (0, vitest_1.expect)(result.isOk()).toBe(true);
        const dotGraph = result._unsafeUnwrap();
        (0, vitest_1.expect)(dotGraph).toContain("digraph TaskGraph {");
        (0, vitest_1.expect)(dotGraph).toContain('\"b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11\" [label=\"Task 1 (todo)\"];');
        (0, vitest_1.expect)(dotGraph).toContain('\"c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11\" [label=\"Task 2 (doing)\"];');
        (0, vitest_1.expect)(dotGraph).toContain('\"b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11\" -> \"c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11\" [label=\"blocks\"];');
    });
});
