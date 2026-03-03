import { describe, expect, it } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import {
  frontmatterToParsedPlan,
  parseCursorPlan,
} from "../../src/plan-import/parser";

const testFilePath = path.join(__dirname, "test-multi-project-parser.md");

describe("parseCursorPlan single-project regression", () => {
  it("returns single plan when frontmatter has only top-level todos (no projects key)", () => {
    const content = `---
name: Single Plan
overview: "One project, top-level todos."
todos:
  - id: a
    content: "Task A"
    status: pending
  - id: b
    content: "Task B"
    blockedBy: [a]
    status: pending
---
`;
    writeFileSync(testFilePath, content);

    const result = parseCursorPlan(testFilePath);

    expect(result.isOk()).toBe(true);
    const plan = result._unsafeUnwrap();
    expect(plan.planTitle).toBe("Single Plan");
    expect(plan.tasks.length).toBe(2);
    expect(plan.tasks[0].stableKey).toBe("a");
    expect(plan.tasks[1].blockedBy).toEqual(["a"]);
    unlinkSync(testFilePath);
  });

  it("frontmatterToParsedPlan with todos only yields ParsedPlan with tasks", () => {
    const raw = {
      name: "Parsed Single",
      overview: "From raw object",
      todos: [
        { id: "t1", content: "First", status: "pending" },
        { id: "t2", content: "Second", status: "completed" },
      ],
    };

    const result = frontmatterToParsedPlan(raw);

    expect(result.isOk()).toBe(true);
    const plan = result._unsafeUnwrap();
    expect(plan.planTitle).toBe("Parsed Single");
    expect(plan.tasks.length).toBe(2);
    expect(plan.tasks[0].stableKey).toBe("t1");
    expect(plan.tasks[0].status).toBe("todo");
    expect(plan.tasks[1].stableKey).toBe("t2");
    expect(plan.tasks[1].status).toBe("done");
  });
});

describe("parseCursorPlan multi-project", () => {
  it("when projects key is absent, parses as single plan from top-level todos", () => {
    const content = `---
name: No Projects Key
overview: "Classic single-plan."
todos:
  - id: only
    content: "Only task"
    status: pending
---
`;
    writeFileSync(testFilePath, content);

    const result = parseCursorPlan(testFilePath);

    expect(result.isOk()).toBe(true);
    const plan = result._unsafeUnwrap();
    expect(plan.tasks.length).toBe(1);
    expect(plan.tasks[0].stableKey).toBe("only");
    unlinkSync(testFilePath);
  });

  it("when frontmatter has projects key but no todos, frontmatterToParsedPlan returns plan with empty tasks", () => {
    // Current parser only handles top-level todos; projects array is not yet consumed.
    const raw = {
      name: "Strategic",
      overview: "Multi-project format.",
      projects: [
        {
          name: "P1",
          todos: [{ id: "p1-a", content: "P1 Task", status: "pending" }],
        },
        {
          name: "P2",
          todos: [{ id: "p2-a", content: "P2 Task", status: "pending" }],
        },
      ],
    };

    const result = frontmatterToParsedPlan(raw);

    expect(result.isOk()).toBe(true);
    const plan = result._unsafeUnwrap();
    expect(plan.planTitle).toBe("Strategic");
    expect(plan.tasks).toEqual([]);
  });
});
