"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const types_1 = require("../../src/domain/types");
(0, vitest_1.describe)("types Zod schemas", () => {
    const now = new Date().toISOString();
    (0, vitest_1.describe)("PlanSchema", () => {
        (0, vitest_1.it)("should parse a valid plan", () => {
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
            };
            (0, vitest_1.expect)(types_1.PlanSchema.parse(validPlan)).toEqual(validPlan);
        });
        (0, vitest_1.it)("should not parse an invalid plan (missing title)", () => {
            const invalidPlan = {
                plan_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                intent: "This is a test plan intent.",
                created_at: now,
                updated_at: now,
            };
            (0, vitest_1.expect)(() => types_1.PlanSchema.parse(invalidPlan)).toThrow();
        });
    });
    (0, vitest_1.describe)("TaskSchema", () => {
        (0, vitest_1.it)("should parse a valid task", () => {
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
            };
            (0, vitest_1.expect)(types_1.TaskSchema.parse(validTask)).toEqual(validTask);
        });
        (0, vitest_1.it)("should not parse an invalid task (missing plan_id)", () => {
            const invalidTask = {
                task_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                title: "Test Task",
                created_at: now,
                updated_at: now,
            };
            (0, vitest_1.expect)(() => types_1.TaskSchema.parse(invalidTask)).toThrow();
        });
    });
    (0, vitest_1.describe)("EdgeSchema", () => {
        (0, vitest_1.it)("should parse a valid edge", () => {
            const validEdge = {
                from_task_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                to_task_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                type: "blocks",
                reason: null,
            };
            (0, vitest_1.expect)(types_1.EdgeSchema.parse(validEdge)).toEqual(validEdge);
        });
        (0, vitest_1.it)("should not parse an invalid edge (missing from_task_id)", () => {
            const invalidEdge = {
                to_task_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", // Needs a valid UUID
                type: "blocks",
            };
            (0, vitest_1.expect)(() => types_1.EdgeSchema.parse(invalidEdge)).toThrow();
        });
    });
    (0, vitest_1.describe)("EventSchema", () => {
        (0, vitest_1.it)("should parse a valid event", () => {
            const validEvent = {
                event_id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                task_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                kind: "created",
                body: { title: "Task created" },
                created_at: now,
            };
            (0, vitest_1.expect)(types_1.EventSchema.parse(validEvent)).toEqual({
                ...validEvent,
                actor: "agent",
            });
        });
        (0, vitest_1.it)("should not parse an invalid event (missing kind)", () => {
            const invalidEvent = {
                event_id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                task_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                body: { title: "Task created" },
                created_at: now,
            };
            (0, vitest_1.expect)(() => types_1.EventSchema.parse(invalidEvent)).toThrow();
        });
    });
    (0, vitest_1.describe)("DecisionSchema", () => {
        (0, vitest_1.it)("should parse a valid decision", () => {
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
            (0, vitest_1.expect)(types_1.DecisionSchema.parse(validDecision)).toEqual(validDecision);
        });
        (0, vitest_1.it)("should not parse an invalid decision (missing summary)", () => {
            const invalidDecision = {
                decision_id: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                plan_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                context: "Which framework to use?",
                decision: "React",
                created_at: now,
            };
            (0, vitest_1.expect)(() => types_1.DecisionSchema.parse(invalidDecision)).toThrow();
        });
    });
    (0, vitest_1.describe)("Enums", () => {
        (0, vitest_1.it)("should parse valid PlanStatus values", () => {
            (0, vitest_1.expect)(types_1.PlanStatusSchema.parse("draft")).toBe("draft");
            (0, vitest_1.expect)(types_1.PlanStatusSchema.parse("active")).toBe("active");
        });
        (0, vitest_1.it)("should not parse invalid PlanStatus values", () => {
            (0, vitest_1.expect)(() => types_1.PlanStatusSchema.parse("invalid")).toThrow();
        });
        (0, vitest_1.it)("should parse valid TaskStatus values", () => {
            (0, vitest_1.expect)(types_1.TaskStatusSchema.parse("todo")).toBe("todo");
            (0, vitest_1.expect)(types_1.TaskStatusSchema.parse("done")).toBe("done");
        });
        (0, vitest_1.it)("should not parse invalid TaskStatus values", () => {
            (0, vitest_1.expect)(() => types_1.TaskStatusSchema.parse("invalid")).toThrow();
        });
        (0, vitest_1.it)("should parse valid Owner values", () => {
            (0, vitest_1.expect)(types_1.OwnerSchema.parse("human")).toBe("human");
            (0, vitest_1.expect)(types_1.OwnerSchema.parse("agent")).toBe("agent");
        });
        (0, vitest_1.it)("should parse valid Risk values", () => {
            (0, vitest_1.expect)(types_1.RiskSchema.parse("low")).toBe("low");
            (0, vitest_1.expect)(types_1.RiskSchema.parse("high")).toBe("high");
        });
        (0, vitest_1.it)("should parse valid EdgeType values", () => {
            (0, vitest_1.expect)(types_1.EdgeTypeSchema.parse("blocks")).toBe("blocks");
            (0, vitest_1.expect)(types_1.EdgeTypeSchema.parse("relates")).toBe("relates");
        });
        (0, vitest_1.it)("should parse valid EventKind values", () => {
            (0, vitest_1.expect)(types_1.EventKindSchema.parse("created")).toBe("created");
            (0, vitest_1.expect)(types_1.EventKindSchema.parse("done")).toBe("done");
        });
        (0, vitest_1.it)("should parse valid Actor values", () => {
            (0, vitest_1.expect)(types_1.ActorSchema.parse("human")).toBe("human");
            (0, vitest_1.expect)(types_1.ActorSchema.parse("agent")).toBe("agent");
        });
    });
});
