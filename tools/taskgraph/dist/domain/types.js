"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DecisionSchema = exports.EventSchema = exports.EdgeSchema = exports.TaskSchema = exports.PlanSchema = exports.ActorSchema = exports.EventKindSchema = exports.EdgeTypeSchema = exports.RiskSchema = exports.OwnerSchema = exports.TaskStatusSchema = exports.PlanStatusSchema = void 0;
const zod_1 = require("zod");
// Enums
exports.PlanStatusSchema = zod_1.z.enum([
    "draft",
    "active",
    "paused",
    "done",
    "abandoned",
]);
exports.TaskStatusSchema = zod_1.z.enum([
    "todo",
    "doing",
    "blocked",
    "done",
    "canceled",
]);
exports.OwnerSchema = zod_1.z.enum(["human", "agent"]);
exports.RiskSchema = zod_1.z.enum(["low", "medium", "high"]);
exports.EdgeTypeSchema = zod_1.z.enum(["blocks", "relates"]);
exports.EventKindSchema = zod_1.z.enum([
    "created",
    "started",
    "progress",
    "blocked",
    "unblocked",
    "done",
    "split",
    "decision_needed",
    "note",
]);
exports.ActorSchema = zod_1.z.enum(["human", "agent"]);
// Schemas
exports.PlanSchema = zod_1.z.object({
    plan_id: zod_1.z.string().uuid(),
    title: zod_1.z.string().max(255),
    intent: zod_1.z.string(),
    status: exports.PlanStatusSchema.default("draft"),
    priority: zod_1.z.number().int().default(0),
    source_path: zod_1.z.string().max(512).nullable(),
    source_commit: zod_1.z.string().max(64).nullable(),
    created_at: zod_1.z.string().datetime(),
    updated_at: zod_1.z.string().datetime(),
});
exports.TaskSchema = zod_1.z.object({
    task_id: zod_1.z.string().uuid(),
    plan_id: zod_1.z.string().uuid(),
    feature_key: zod_1.z.string().max(64).nullable(),
    title: zod_1.z.string().max(255),
    intent: zod_1.z.string().nullable(),
    scope_in: zod_1.z.string().nullable(),
    scope_out: zod_1.z.string().nullable(),
    acceptance: zod_1.z.array(zod_1.z.string()).nullable(), // Assuming acceptance is an array of strings
    status: exports.TaskStatusSchema.default("todo"),
    owner: exports.OwnerSchema.default("agent"),
    area: zod_1.z.string().max(64).nullable(),
    risk: exports.RiskSchema.default("low"),
    estimate_mins: zod_1.z.number().int().nullable(),
    created_at: zod_1.z.string().datetime(),
    updated_at: zod_1.z.string().datetime(),
    external_key: zod_1.z.string().max(128).nullable(),
});
exports.EdgeSchema = zod_1.z.object({
    from_task_id: zod_1.z.string().uuid(),
    to_task_id: zod_1.z.string().uuid(),
    type: exports.EdgeTypeSchema.default("blocks"),
    reason: zod_1.z.string().nullable(),
});
exports.EventSchema = zod_1.z.object({
    event_id: zod_1.z.string().uuid(),
    task_id: zod_1.z.string().uuid(),
    kind: exports.EventKindSchema,
    body: zod_1.z.record(zod_1.z.any()), // JSON type in Dolt maps to a generic record
    actor: exports.ActorSchema.default("agent"),
    created_at: zod_1.z.string().datetime(),
});
exports.DecisionSchema = zod_1.z.object({
    decision_id: zod_1.z.string().uuid(),
    plan_id: zod_1.z.string().uuid(),
    task_id: zod_1.z.string().uuid().nullable(),
    summary: zod_1.z.string().max(255),
    context: zod_1.z.string(),
    options: zod_1.z.array(zod_1.z.string()).nullable(), // Assuming options is an array of strings
    decision: zod_1.z.string(),
    consequences: zod_1.z.string().nullable(),
    source_ref: zod_1.z.string().max(512).nullable(),
    created_at: zod_1.z.string().datetime(),
});
