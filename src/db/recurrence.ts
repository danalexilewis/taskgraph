/**
 * Recurrence tracker: links new findings (from evolve or learnings) to prior learnings
 * for closed-loop verification (new, seen_again, caught, escaped).
 */
import { createHash } from "node:crypto";
import type { ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import type { Config } from "../cli/utils";
import type { AppError } from "../domain/errors";
import type { LearningOutcome, LearningSource } from "../domain/types";
import { now, query } from "./query";

/** Normalize directive text for fingerprint: trim and collapse internal whitespace. */
export function normalizeDirective(directive: string): string {
  return directive.trim().replace(/\s+/g, " ");
}

/** SHA256 hex fingerprint of normalized directive. */
export function fingerprintDirective(directive: string): string {
  return createHash("sha256")
    .update(normalizeDirective(directive))
    .digest("hex");
}

export interface RecordFindingInput {
  directive_summary: string;
  category: string | null;
  source: LearningSource;
  /** If not set: 'new' when no prior, 'seen_again' when prior exists. */
  outcome?: LearningOutcome;
  plan_id?: string | null;
  run_id?: string | null;
}

export interface LearningRow {
  learning_id: string;
  fingerprint: string;
  directive_summary: string;
  category: string | null;
  source: string;
  outcome: string;
  prior_learning_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  created_at: string;
}

/** Record a finding; links to prior learning by fingerprint and sets outcome. */
export function recordFinding(
  config: Config,
  input: RecordFindingInput,
): ResultAsync<{ learning_id: string; outcome: LearningOutcome }, AppError> {
  const fp = fingerprintDirective(input.directive_summary);
  const q = query(config.doltRepoPath);

  return q
    .select<LearningRow>("learning", {
      columns: ["learning_id", "outcome"],
      where: { fingerprint: fp },
      orderBy: "`created_at` ASC",
      limit: 1,
    })
    .andThen((rows) => {
      const prior = rows[0];
      const outcome: LearningOutcome =
        input.outcome ?? (prior ? "seen_again" : "new");
      const prior_learning_id = prior?.learning_id ?? null;
      const learning_id = uuidv4();
      return q
        .insert("learning", {
          learning_id,
          fingerprint: fp,
          directive_summary: input.directive_summary,
          category: input.category,
          source: input.source,
          outcome,
          prior_learning_id,
          plan_id: input.plan_id ?? null,
          run_id: input.run_id ?? null,
          created_at: now(),
        })
        .map(() => ({ learning_id, outcome }));
    });
}

export interface ListRecurrencesInput {
  outcome?: LearningOutcome | null;
  limit?: number;
}

/** List recorded learnings, optionally filtered by outcome, newest first. */
export function listRecurrences(
  config: Config,
  input: ListRecurrencesInput,
): ResultAsync<LearningRow[], AppError> {
  const q = query(config.doltRepoPath);
  const where = input.outcome ? { outcome: input.outcome } : undefined;
  return q.select<LearningRow>("learning", {
    columns: [
      "learning_id",
      "fingerprint",
      "directive_summary",
      "category",
      "source",
      "outcome",
      "prior_learning_id",
      "plan_id",
      "run_id",
      "created_at",
    ],
    where,
    orderBy: "`created_at` DESC",
    limit: input.limit ?? 50,
  });
}
