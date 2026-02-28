import { describe, expect, it } from "bun:test";
import {
  ActorSchema,
  DecisionSchema,
  EdgeSchema,
  EdgeTypeSchema,
  EventKindSchema,
  EventSchema,
  OwnerSchema,
  PlanSchema,
  PlanStatusSchema,
  RiskSchema,
  TaskSchema,
  TaskStatusSchema,
} from "../../src/domain/types";

describe("types Zod schemas", () => {
  const now = new Date().toISOString();

  describe("PlanSchema", () => {
    it("should parse a valid plan", () => {
      const validPlan = {
        plan_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        title: "Test Plan",
        intent: "This is a test plan intent.",
        status: "draft",
        priority: 0,
        source_path: null,
        source_commit: null,
        created_at: now,
        updated_at: now,
        file_tree: null,
        risks: null,
        tests: null,
      };
      expect(PlanSchema.parse(validPlan)).toEqual(validPlan);
    });

    it("should not parse an invalid plan (missing title)", () => {
      const invalidPlan = {
        plan_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        intent: "This is a test plan intent.",
        created_at: now,
        updated_at: now,
      };
      expect(() => PlanSchema.parse(invalidPlan)).toThrow();
    });
  });

  describe("TaskSchema", () => {
    it("should parse a valid task", () => {
      const validTask = {
        task_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        plan_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        feature_key: null,
        title: "Test Task",
        intent: null,
        scope_in: null,
        scope_out: null,
        acceptance: null,
        status: "todo",
        owner: "agent",
        area: null,
        risk: "low",
        estimate_mins: null,
        created_at: now,
        updated_at: now,
        external_key: null,
        change_type: null,
        suggested_changes: null,
      };
      expect(TaskSchema.parse(validTask)).toEqual(validTask);
    });

    it("should not parse an invalid task (missing plan_id)", () => {
      const invalidTask = {
        task_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        title: "Test Task",
        created_at: now,
        updated_at: now,
      };
      expect(() => TaskSchema.parse(invalidTask)).toThrow();
    });
  });

  describe("EdgeSchema", () => {
    it("should parse a valid edge", () => {
      const validEdge = {
        from_task_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        to_task_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        type: "blocks",
        reason: null,
      };
      expect(EdgeSchema.parse(validEdge)).toEqual(validEdge);
    });

    it("should not parse an invalid edge (missing from_task_id)", () => {
      const invalidEdge = {
        to_task_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", // Needs a valid UUID
        type: "blocks",
      };
      expect(() => EdgeSchema.parse(invalidEdge)).toThrow();
    });
  });

  describe("EventSchema", () => {
    it("should parse a valid event", () => {
      const validEvent = {
        event_id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        task_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        kind: "created",
        body: { title: "Task created" },
        created_at: now,
      };
      expect(EventSchema.parse(validEvent)).toEqual({
        ...validEvent,
        actor: "agent",
      });
    });

    it("should not parse an invalid event (missing kind)", () => {
      const invalidEvent = {
        event_id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        task_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        body: { title: "Task created" },
        created_at: now,
      };
      expect(() => EventSchema.parse(invalidEvent)).toThrow();
    });
  });

  describe("DecisionSchema", () => {
    it("should parse a valid decision", () => {
      const validDecision = {
        decision_id: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        plan_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        task_id: null,
        summary: "Choose technology",
        context: "Which framework to use?",
        options: null,
        decision: "React",
        consequences: null,
        source_ref: null,
        created_at: now,
      };
      expect(DecisionSchema.parse(validDecision)).toEqual(validDecision);
    });

    it("should not parse an invalid decision (missing summary)", () => {
      const invalidDecision = {
        decision_id: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        plan_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        context: "Which framework to use?",
        decision: "React",
        created_at: now,
      };
      expect(() => DecisionSchema.parse(invalidDecision)).toThrow();
    });
  });

  describe("Enums", () => {
    it("should parse valid PlanStatus values", () => {
      expect(PlanStatusSchema.parse("draft")).toBe("draft");
      expect(PlanStatusSchema.parse("active")).toBe("active");
    });
    it("should not parse invalid PlanStatus values", () => {
      expect(() => PlanStatusSchema.parse("invalid")).toThrow();
    });

    it("should parse valid TaskStatus values", () => {
      expect(TaskStatusSchema.parse("todo")).toBe("todo");
      expect(TaskStatusSchema.parse("done")).toBe("done");
    });
    it("should not parse invalid TaskStatus values", () => {
      expect(() => TaskStatusSchema.parse("invalid")).toThrow();
    });

    it("should parse valid Owner values", () => {
      expect(OwnerSchema.parse("human")).toBe("human");
      expect(OwnerSchema.parse("agent")).toBe("agent");
    });

    it("should parse valid Risk values", () => {
      expect(RiskSchema.parse("low")).toBe("low");
      expect(RiskSchema.parse("high")).toBe("high");
    });

    it("should parse valid EdgeType values", () => {
      expect(EdgeTypeSchema.parse("blocks")).toBe("blocks");
      expect(EdgeTypeSchema.parse("relates")).toBe("relates");
    });

    it("should parse valid EventKind values", () => {
      expect(EventKindSchema.parse("created")).toBe("created");
      expect(EventKindSchema.parse("done")).toBe("done");
    });

    it("should parse valid Actor values", () => {
      expect(ActorSchema.parse("human")).toBe("human");
      expect(ActorSchema.parse("agent")).toBe("agent");
    });
  });
});
