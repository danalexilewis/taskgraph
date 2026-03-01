import type { Command } from "commander";
import { errAsync, ResultAsync } from "neverthrow";
import { sqlEscape } from "../db/escape";
import { query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import {
  type ContextOutput,
  compactContext,
  estimateJsonTokens,
} from "../domain/token-estimate";
import { type Config, readConfig, resolveTaskId, rootOpts } from "./utils";

export function contextCommand(program: Command) {
  program
    .command("context")
    .description(
      "Output doc paths, skill guide paths, and related done tasks for a task (run before starting work)",
    )
    .argument("<taskId>", "Task ID")
    .action(async (taskId, _options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) =>
        resolveTaskId(taskId, config.doltRepoPath).andThen((resolved) => {
          const q = query(config.doltRepoPath);
          return q
            .select<{
              task_id: string;
              title: string;
              change_type: string | null;
              plan_id: string;
              suggested_changes: string | null;
              agent: string | null;
            }>("task", {
              columns: [
                "task_id",
                "title",
                "change_type",
                "plan_id",
                "suggested_changes",
                "agent",
              ],
              where: { task_id: resolved },
            })
            .andThen((taskRows) => {
              if (taskRows.length === 0) {
                return errAsync(
                  buildError(
                    ErrorCode.TASK_NOT_FOUND,
                    `Task ${taskId} not found`,
                  ),
                );
              }
              const task = taskRows[0];
              return q
                .select<{
                  title: string | null;
                  overview: string | null;
                  file_tree: string | null;
                  risks: string | null;
                }>("project", {
                  columns: ["title", "overview", "file_tree", "risks"],
                  where: { plan_id: task.plan_id },
                })
                .andThen((planRows) => {
                  const plan = planRows[0];
                  const plan_name = plan?.title ?? null;
                  const plan_overview = plan?.overview ?? null;
                  const file_tree = plan?.file_tree ?? null;
                  let risks: unknown = null;
                  if (plan?.risks != null && typeof plan.risks === "string") {
                    try {
                      risks = JSON.parse(plan.risks);
                    } catch {
                      risks = null;
                    }
                  }
                  return q
                    .select<{ doc: string }>("task_doc", {
                      columns: ["doc"],
                      where: { task_id: resolved },
                    })
                    .andThen((docRows) =>
                      q
                        .select<{ skill: string }>("task_skill", {
                          columns: ["skill"],
                          where: { task_id: resolved },
                        })
                        .map((skillRows) => ({
                          task,
                          plan_name,
                          plan_overview,
                          file_tree,
                          risks,
                          docs: docRows.map((r) => r.doc),
                          skills: skillRows.map((r) => r.skill),
                        })),
                    );
                });
            })
            .andThen(
              ({
                task,
                plan_name,
                plan_overview,
                file_tree,
                risks,
                docs,
                skills,
              }) => {
                const doc_paths = docs.map((d) => `docs/${d}.md`);
                const skill_docs = skills.map((s) => `docs/skills/${s}.md`);

                return q
                  .raw<{ task_id: string; title: string; status: string }>(
                    `SELECT e.from_task_id AS task_id, t.title, t.status FROM \`edge\` e JOIN \`task\` t ON e.from_task_id = t.task_id WHERE e.to_task_id = '${sqlEscape(resolved)}' AND e.type = 'blocks'`,
                  )
                  .andThen((blockerRows) => {
                    const doneBlockerIds = blockerRows
                      .filter((b) => b.status === "done")
                      .map((b) => b.task_id);
                    const evidenceQuery =
                      doneBlockerIds.length > 0
                        ? q.raw<{ task_id: string; body: string }>(
                            `SELECT task_id, body FROM \`event\` WHERE kind = 'done' AND task_id IN (${doneBlockerIds.map((id) => `'${sqlEscape(id)}'`).join(",")}) ORDER BY created_at DESC`,
                          )
                        : ResultAsync.fromSafePromise(
                            Promise.resolve(
                              [] as Array<{ task_id: string; body: string }>,
                            ),
                          );

                    return evidenceQuery.map((evidenceRows) => {
                      const evidenceByTaskId = new Map<string, string>();
                      for (const ev of evidenceRows) {
                        if (!evidenceByTaskId.has(ev.task_id)) {
                          try {
                            const parsed = JSON.parse(ev.body) as {
                              evidence?: string;
                            };
                            evidenceByTaskId.set(
                              ev.task_id,
                              parsed.evidence ?? "",
                            );
                          } catch {
                            evidenceByTaskId.set(ev.task_id, "");
                          }
                        }
                      }

                      const immediate_blockers = blockerRows.map((b) => ({
                        task_id: b.task_id,
                        title: b.title,
                        status: b.status,
                        evidence: evidenceByTaskId.get(b.task_id) ?? null,
                      }));

                      const data: ContextOutput = {
                        task_id: task.task_id,
                        title: task.title,
                        agent: task.agent ?? null,
                        plan_name,
                        plan_overview,
                        docs,
                        skills,
                        change_type: task.change_type ?? null,
                        suggested_changes: task.suggested_changes ?? null,
                        file_tree,
                        risks,
                        doc_paths,
                        skill_docs,
                        immediate_blockers,
                      };
                      const budget = config.context_token_budget;
                      if (
                        budget != null &&
                        budget > 0 &&
                        estimateJsonTokens(data) > budget
                      ) {
                        return compactContext(data, budget);
                      }
                      return data;
                    });
                  });
              },
            );
        }),
      );

      result.match(
        (data: unknown) => {
          const d = data as ContextOutput;
          const json = JSON.stringify(
            { ...d, token_estimate: estimateJsonTokens(d) },
            null,
            2,
          );
          const charCount = json.length;
          const tokenCount = estimateJsonTokens(d);
          if (rootOpts(cmd).json) {
            console.log(
              JSON.stringify({ ...d, token_estimate: tokenCount }, null, 2),
            );
            return;
          }
          console.log(`Task: ${d.title} (${d.task_id})`);
          if (d.agent) console.log(`Agent: ${d.agent}`);
          if (d.change_type) console.log(`Change type: ${d.change_type}`);
          if (d.plan_name) {
            const overviewSnippet = d.plan_overview
              ? ` — ${d.plan_overview.split("\n")[0].slice(0, 120)}`
              : "";
            console.log(`Plan: ${d.plan_name}${overviewSnippet}`);
          }
          d.doc_paths.forEach((p) => {
            console.log(`Doc: ${p}`);
          });
          d.skill_docs.forEach((doc) => {
            console.log(`Skill guide: ${doc}`);
          });
          if (d.suggested_changes) {
            console.log(`Suggested changes:`);
            console.log(d.suggested_changes);
          }
          if (d.file_tree) {
            console.log(`Plan file tree:`);
            console.log(d.file_tree);
          }
          if (d.risks != null && Array.isArray(d.risks) && d.risks.length > 0) {
            console.log(`Plan risks:`);
            d.risks.forEach(
              (r: {
                description?: string;
                severity?: string;
                mitigation?: string;
              }) => {
                console.log(
                  `  - ${r.severity ?? "?"}: ${r.description ?? ""} (${r.mitigation ?? ""})`,
                );
              },
            );
          }
          if (d.immediate_blockers.length > 0) {
            console.log(`Immediate blockers:`);
            d.immediate_blockers.forEach((b) => {
              const ev = b.evidence ? ` [evidence: ${b.evidence}]` : "";
              console.log(`  ${b.task_id}  ${b.title} (${b.status})${ev}`);
            });
          }
          console.log(`[context: ~${charCount} chars, ~${tokenCount} tokens]`);
        },
        (error: AppError) => {
          console.error(`Error: ${error.message}`);
          if (rootOpts(cmd).json) {
            console.log(
              JSON.stringify(
                { status: "error", message: error.message },
                null,
                2,
              ),
            );
          }
          process.exit(1);
        },
      );
    });
}
