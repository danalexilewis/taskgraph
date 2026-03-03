import { z } from "zod";

// ---------------------------------------------------------------------------
// Per-command payload schemas
// ---------------------------------------------------------------------------

export const NotePayload = z.object({
  taskId: z.string(),
  message: z.string(),
  repoPath: z.string(),
});
export type NotePayload = z.infer<typeof NotePayload>;

export const StartPayload = z.object({
  taskId: z.string(),
  agentName: z.string(),
  repoPath: z.string(),
  worktreePath: z.string().optional(),
});
export type StartPayload = z.infer<typeof StartPayload>;

export const DonePayload = z.object({
  taskId: z.string(),
  evidence: z.string(),
  repoPath: z.string(),
  worktreePath: z.string().optional(),
  merge: z.boolean().optional(),
});
export type DonePayload = z.infer<typeof DonePayload>;

export const BlockPayload = z.object({
  taskId: z.string(),
  blockedBy: z.string(),
  reason: z.string(),
  repoPath: z.string(),
});
export type BlockPayload = z.infer<typeof BlockPayload>;

export const CancelPayload = z.object({
  taskId: z.string(),
  reason: z.string(),
  repoPath: z.string(),
});
export type CancelPayload = z.infer<typeof CancelPayload>;

export const GatePayload = z.object({
  taskId: z.string(),
  status: z.enum(["pass", "fail"]),
  summary: z.string().optional(),
  repoPath: z.string(),
});
export type GatePayload = z.infer<typeof GatePayload>;

export const SplitPayload = z.object({
  taskId: z.string(),
  subtasks: z.array(
    z.object({
      title: z.string(),
      description: z.string().optional(),
    }),
  ),
  repoPath: z.string(),
});
export type SplitPayload = z.infer<typeof SplitPayload>;

export const TaskNewPayload = z.object({
  title: z.string(),
  description: z.string().optional(),
  planId: z.string().optional(),
  agent: z.string().optional(),
  repoPath: z.string(),
});
export type TaskNewPayload = z.infer<typeof TaskNewPayload>;

export const EdgePayload = z.object({
  fromTaskId: z.string(),
  toTaskId: z.string(),
  repoPath: z.string(),
});
export type EdgePayload = z.infer<typeof EdgePayload>;

export const ImportPlanPayload = z.object({
  filePath: z.string(),
  planName: z.string().optional(),
  format: z.string().optional(),
  repoPath: z.string(),
});
export type ImportPlanPayload = z.infer<typeof ImportPlanPayload>;

export const PlanPayload = z.object({
  name: z.string(),
  overview: z.string().optional(),
  repoPath: z.string(),
});
export type PlanPayload = z.infer<typeof PlanPayload>;

export const RecoverPayload = z.object({
  taskId: z.string(),
  repoPath: z.string(),
});
export type RecoverPayload = z.infer<typeof RecoverPayload>;

export const CrossplanPayload = z.object({
  sourceTaskId: z.string(),
  targetTaskId: z.string(),
  reason: z.string().optional(),
  repoPath: z.string(),
});
export type CrossplanPayload = z.infer<typeof CrossplanPayload>;

export const CyclePayload = z.object({
  planId: z.string(),
  repoPath: z.string(),
});
export type CyclePayload = z.infer<typeof CyclePayload>;

export const InitiativePayload = z.object({
  title: z.string(),
  description: z.string().optional(),
  repoPath: z.string(),
});
export type InitiativePayload = z.infer<typeof InitiativePayload>;

export const TemplatePayload = z.object({
  name: z.string(),
  content: z.string(),
  repoPath: z.string(),
});
export type TemplatePayload = z.infer<typeof TemplatePayload>;

// ---------------------------------------------------------------------------
// Discriminated union of all command types
// ---------------------------------------------------------------------------

export const QueueCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("note"), payload: NotePayload }),
  z.object({ type: z.literal("start"), payload: StartPayload }),
  z.object({ type: z.literal("done"), payload: DonePayload }),
  z.object({ type: z.literal("block"), payload: BlockPayload }),
  z.object({ type: z.literal("cancel"), payload: CancelPayload }),
  z.object({ type: z.literal("gate"), payload: GatePayload }),
  z.object({ type: z.literal("split"), payload: SplitPayload }),
  z.object({ type: z.literal("task_new"), payload: TaskNewPayload }),
  z.object({ type: z.literal("edge"), payload: EdgePayload }),
  z.object({ type: z.literal("import_plan"), payload: ImportPlanPayload }),
  z.object({ type: z.literal("plan"), payload: PlanPayload }),
  z.object({ type: z.literal("recover"), payload: RecoverPayload }),
  z.object({ type: z.literal("crossplan"), payload: CrossplanPayload }),
  z.object({ type: z.literal("cycle"), payload: CyclePayload }),
  z.object({ type: z.literal("initiative"), payload: InitiativePayload }),
  z.object({ type: z.literal("template"), payload: TemplatePayload }),
]);
export type QueueCommand = z.infer<typeof QueueCommand>;

export type CommandType = QueueCommand["type"];

/** Narrow the payload type for a specific command type. */
export type PayloadFor<T extends CommandType> = Extract<
  QueueCommand,
  { type: T }
>["payload"];

/**
 * Parse a raw queue row's command_type + payload_json into a typed QueueCommand.
 * Returns null if the type is unknown or the payload fails validation.
 */
export function parseQueueCommand(
  commandType: string,
  payloadJson: string,
): QueueCommand | null {
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  const result = QueueCommand.safeParse({ type: commandType, payload });
  return result.success ? result.data : null;
}
