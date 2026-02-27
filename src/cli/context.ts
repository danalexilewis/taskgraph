import { Command } from "commander";
import { readConfig, Config, rootOpts } from "./utils";
import { ResultAsync, errAsync } from "neverthrow";
import { AppError, buildError, ErrorCode } from "../domain/errors";
import { query } from "../db/query";
import { sqlEscape } from "../db/escape";

export function contextCommand(program: Command) {
  program
    .command("context")
    .description(
      "Output doc paths, skill guide paths, and related done tasks for a task (run before starting work)",
    )
    .argument("<taskId>", "Task ID")
    .action(async (taskId, options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
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
            where: { task_id: taskId },
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
              .select<{ file_tree: string | null; risks: string | null }>(
                "plan",
                {
                  columns: ["file_tree", "risks"],
                  where: { plan_id: task.plan_id },
                },
              )
              .andThen((planRows) => {
                const plan = planRows[0];
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
                    where: { task_id: taskId },
                  })
                  .andThen((docRows) =>
                    q
                      .select<{ skill: string }>("task_skill", {
                        columns: ["skill"],
                        where: { task_id: taskId },
                      })
                      .map((skillRows) => ({
                        task,
                        file_tree,
                        risks,
                        docs: docRows.map((r) => r.doc),
                        skills: skillRows.map((r) => r.skill),
                      })),
                  );
              });
          })
          .andThen(({ task, file_tree, risks, docs, skills }) => {
            const doc_paths = docs.map((d) => `docs/${d}.md`);
            const skill_docs = skills.map((s) => `docs/skills/${s}.md`);

            const relatedByDocSql =
              docs.length > 0
                ? `SELECT DISTINCT t.task_id, t.title, t.plan_id FROM \`task\` t JOIN \`task_doc\` td ON t.task_id = td.task_id WHERE t.status = 'done' AND t.task_id != '${sqlEscape(taskId)}' AND td.doc IN (${docs.map((d) => `'${sqlEscape(d)}'`).join(",")}) ORDER BY t.updated_at DESC LIMIT 5`
                : null;
            const relatedBySkillSql =
              skills.length > 0
                ? `SELECT DISTINCT t.task_id, t.title, t.plan_id FROM \`task\` t JOIN \`task_skill\` ts ON t.task_id = ts.task_id WHERE t.status = 'done' AND t.task_id != '${sqlEscape(taskId)}' AND ts.skill IN (${skills.map((s) => `'${sqlEscape(s)}'`).join(",")}) ORDER BY t.updated_at DESC LIMIT 5`
                : null;

            const runDoc = relatedByDocSql
              ? q.raw<{ task_id: string; title: string; plan_id: string }>(
                  relatedByDocSql,
                )
              : ResultAsync.fromSafePromise(Promise.resolve([]));
            const runSkill = relatedBySkillSql
              ? q.raw<{ task_id: string; title: string; plan_id: string }>(
                  relatedBySkillSql,
                )
              : ResultAsync.fromSafePromise(Promise.resolve([]));

            return runDoc.andThen((relatedByDoc) =>
              runSkill.map((relatedBySkill) => ({
                task_id: task.task_id,
                title: task.title,
                agent: task.agent ?? null,
                docs,
                skills,
                change_type: task.change_type ?? null,
                suggested_changes: task.suggested_changes ?? null,
                file_tree,
                risks,
                doc_paths,
                skill_docs,
                related_done_by_doc: relatedByDoc,
                related_done_by_skill: relatedBySkill,
              })),
            );
          });
      });

      result.match(
        (data: unknown) => {
          const d = data as {
            task_id: string;
            title: string;
            agent: string | null;
            docs: string[];
            skills: string[];
            change_type: string | null;
            suggested_changes: string | null;
            file_tree: string | null;
            risks: unknown;
            doc_paths: string[];
            skill_docs: string[];
            related_done_by_doc: Array<{
              task_id: string;
              title: string;
              plan_id: string;
            }>;
            related_done_by_skill: Array<{
              task_id: string;
              title: string;
              plan_id: string;
            }>;
          };
          if (rootOpts(cmd).json) {
            console.log(JSON.stringify(d, null, 2));
            return;
          }
          console.log(`Task: ${d.title} (${d.task_id})`);
          if (d.agent) console.log(`Agent: ${d.agent}`);
          if (d.change_type) console.log(`Change type: ${d.change_type}`);
          d.doc_paths.forEach((path) => console.log(`Doc: ${path}`));
          d.skill_docs.forEach((doc) => console.log(`Skill guide: ${doc}`));
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
              }) =>
                console.log(
                  `  - ${r.severity ?? "?"}: ${r.description ?? ""} (${r.mitigation ?? ""})`,
                ),
            );
          }
          if (d.related_done_by_doc.length > 0) {
            console.log(`Related done (same doc):`);
            d.related_done_by_doc.forEach((t) =>
              console.log(`  ${t.task_id}  ${t.title}`),
            );
          }
          if (d.related_done_by_skill.length > 0) {
            console.log(`Related done (same skill):`);
            d.related_done_by_skill.forEach((t) =>
              console.log(`  ${t.task_id}  ${t.title}`),
            );
          }
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
