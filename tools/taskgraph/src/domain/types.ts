import { z } from "zod";

// Enums
export const PlanStatusSchema = z.enum([
  "draft",
  "active",
  "paused",
  "done",
  "abandoned",
]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const TaskStatusSchema = z.enum([
  "todo",
  "doing",
  "blocked",
  "done",
  "canceled",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const OwnerSchema = z.enum(["human", "agent"]);
export type Owner = z.infer<typeof OwnerSchema>;

export const RiskSchema = z.enum(["low", "medium", "high"]);
export type Risk = z.infer<typeof RiskSchema>;

export const EdgeTypeSchema = z.enum(["blocks", "relates"]);
export type EdgeType = z.infer<typeof EdgeTypeSchema>;

export const EventKindSchema = z.enum([
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
export type EventKind = z.infer<typeof EventKindSchema>;

export const ActorSchema = z.enum(["human", "agent"]);
export type Actor = z.infer<typeof ActorSchema>;

// Schemas
export const PlanSchema = z.object({
  plan_id: z.string().uuid(),
  title: z.string().max(255),
  intent: z.string(),
  status: PlanStatusSchema.default("draft"),
  priority: z.number().int().default(0),
  source_path: z.string().max(512).nullable(),
  source_commit: z.string().max(64).nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const TaskSchema = z.object({
  task_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  feature_key: z.string().max(64).nullable(),
  title: z.string().max(255),
  intent: z.string().nullable(),
  scope_in: z.string().nullable(),
  scope_out: z.string().nullable(),
  acceptance: z.array(z.string()).nullable(), // Assuming acceptance is an array of strings
  status: TaskStatusSchema.default("todo"),
  owner: OwnerSchema.default("agent"),
  area: z.string().max(64).nullable(),
  risk: RiskSchema.default("low"),
  estimate_mins: z.number().int().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  external_key: z.string().max(128).nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

export const EdgeSchema = z.object({
  from_task_id: z.string().uuid(),
  to_task_id: z.string().uuid(),
  type: EdgeTypeSchema.default("blocks"),
  reason: z.string().nullable(),
});
export type Edge = z.infer<typeof EdgeSchema>;

export const EventSchema = z.object({
  event_id: z.string().uuid(),
  task_id: z.string().uuid(),
  kind: EventKindSchema,
  body: z.record(z.any()), // JSON type in Dolt maps to a generic record
  actor: ActorSchema.default("agent"),
  created_at: z.string().datetime(),
});
export type Event = z.infer<typeof EventSchema>;

export const DecisionSchema = z.object({
  decision_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  task_id: z.string().uuid().nullable(),
  summary: z.string().max(255),
  context: z.string(),
  options: z.array(z.string()).nullable(), // Assuming options is an array of strings
  decision: z.string(),
  consequences: z.string().nullable(),
  source_ref: z.string().max(512).nullable(),
  created_at: z.string().datetime(),
});
export type Decision = z.infer<typeof DecisionSchema>;
