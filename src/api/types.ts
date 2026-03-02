/**
 * Typed result shapes for the Task Graph SDK.
 * Matches CLI `--json` output for next, context, and status.
 */

/** Single runnable task from `tg next` (--json). */
export interface NextTaskRow {
  task_id: string;
  hash_id: string | null;
  title: string;
  plan_title: string;
  risk: string;
  estimate_mins: number | null;
}

/** Result of `next()` — array of runnable tasks. */
export type NextResult = NextTaskRow[];

/** Blocker entry in context. */
export interface ContextBlocker {
  task_id: string;
  title: string;
  status: string;
  evidence?: string | null;
}

/** Context output shape (matches `tg context --json`). */
export interface ContextResult {
  task_id: string;
  title: string;
  agent: string | null;
  plan_name: string | null;
  plan_overview: string | null;
  docs: string[];
  skills: string[];
  change_type: string | null;
  suggested_changes: string | null;
  file_tree: string | null;
  risks: unknown;
  doc_paths: string[];
  skill_docs: string[];
  immediate_blockers: ContextBlocker[];
  /** Token estimate (chars/4 heuristic). */
  token_estimate: number;
}

/** Active plan row in status. */
export interface StatusActivePlan {
  plan_id: string;
  title: string;
  priority: number;
  todo: number;
  doing: number;
  blocked: number;
  done: number;
  actionable: number;
  initiative?: string | null;
}

/** Stale task row. */
export interface StatusStaleTask {
  task_id: string;
  hash_id: string | null;
  title: string;
}

/** Stale doing task row (with age). */
export interface StatusStaleDoingTask {
  task_id: string;
  hash_id: string | null;
  title: string;
  owner: string | null;
  age_hours: number;
}

/** Next/last task row in status. */
export interface StatusTaskRow {
  task_id: string;
  hash_id: string | null;
  title: string;
  plan_title: string;
  updated_at?: string | null;
}

/** Plan summary row. */
export interface StatusPlanRow {
  plan_id: string;
  title: string;
  status: string;
  priority?: number;
  updated_at: string | null;
}

/** Active work row. */
export interface StatusActiveWork {
  task_id: string;
  hash_id: string | null;
  title: string;
  plan_title: string;
  body: string | object | null;
  created_at: string | null;
}

/** Summary slice of status (matches tg status --json summary). */
export interface StatusSummary {
  not_done: number;
  in_progress: number;
  blocked: number;
  actionable: number;
}

/** Result of `status()` — matches `tg status --json`. */
export interface StatusResult {
  completedPlans: number;
  completedTasks: number;
  canceledTasks: number;
  activePlans: StatusActivePlan[];
  staleTasks: StatusStaleTask[];
  stale_tasks: StatusStaleDoingTask[];
  plansCount: number;
  statusCounts: Record<string, number>;
  actionableCount: number;
  nextTasks: StatusTaskRow[];
  next7RunnableTasks: StatusTaskRow[];
  last7CompletedTasks: StatusTaskRow[];
  next7UpcomingPlans: StatusPlanRow[];
  last7CompletedPlans: StatusPlanRow[];
  activeWork: StatusActiveWork[];
  agentCount: number;
  subAgentRuns: number;
  totalAgentHours: number;
  investigatorRuns: number;
  investigatorFixRate: number;
  subAgentTypesDefined: number;
  summary: StatusSummary;
}
