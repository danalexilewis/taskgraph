import yaml from "js-yaml";
import { errAsync, type ResultAsync } from "neverthrow";
import { type Config, readConfig } from "../cli/utils";
import { sqlEscape } from "../db/escape";
import { query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";

interface PlanRow {
  plan_id: string;
  title: string;
  intent: string;
}

interface TaskRow {
  task_id: string;
  external_key: string | null;
  title: string;
  status: string;
}

interface EdgeRow {
  from_task_id: string;
  to_task_id: string;
  type: string;
}

/** Generates Cursor-format markdown from plan and tasks. */
export function generateMarkdown(
  planId: string,
  basePath?: string,
): ResultAsync<string, AppError> {
  return readConfig(basePath).asyncAndThen((config: Config) => {
    const q = query(config.doltRepoPath);

    return q
      .select<PlanRow>("plan", {
        columns: ["plan_id", "title", "intent"],
        where: { plan_id: planId },
      })
      .andThen((plans) => {
        if (plans.length === 0) {
          return errAsync(
            buildError(ErrorCode.PLAN_NOT_FOUND, `Plan ${planId} not found`),
          );
        }
        const plan = plans[0];

        return q
          .select<TaskRow>("task", {
            columns: ["task_id", "external_key", "title", "status"],
            where: { plan_id: planId },
          })
          .andThen((tasks) => {
            const taskIds = tasks.map((t) => t.task_id);
            return q
              .raw<{ task_id: string; doc: string }>(
                taskIds.length > 0
                  ? `SELECT task_id, doc FROM \`task_doc\` WHERE task_id IN (${taskIds.map((id) => `'${sqlEscape(id)}'`).join(",")})`
                  : "SELECT task_id, doc FROM `task_doc` WHERE 1=0",
              )
              .andThen((docRows) =>
                q
                  .raw<{
                    task_id: string;
                    skill: string;
                  }>(
                    taskIds.length > 0
                      ? `SELECT task_id, skill FROM \`task_skill\` WHERE task_id IN (${taskIds.map((id) => `'${sqlEscape(id)}'`).join(",")})`
                      : "SELECT task_id, skill FROM `task_skill` WHERE 1=0",
                  )
                  .map((skillRows) => {
                    const docsByTask = new Map<string, string[]>();
                    docRows.forEach((r) => {
                      const arr = docsByTask.get(r.task_id) ?? [];
                      arr.push(r.doc);
                      docsByTask.set(r.task_id, arr);
                    });
                    const skillsByTask = new Map<string, string[]>();
                    skillRows.forEach((r) => {
                      const arr = skillsByTask.get(r.task_id) ?? [];
                      arr.push(r.skill);
                      skillsByTask.set(r.task_id, arr);
                    });
                    return { docsByTask, skillsByTask };
                  }),
              )
              .andThen(({ docsByTask, skillsByTask }) =>
                q
                  .raw<EdgeRow>(
                    "SELECT from_task_id, to_task_id, type FROM `edge` WHERE type = 'blocks'",
                  )
                  .map((edges) => {
                    const taskIdToKey = new Map<string, string>();
                    tasks.forEach((t) => {
                      if (t.external_key) {
                        taskIdToKey.set(t.task_id, t.external_key);
                      }
                    });

                    const blockedByMap = new Map<string, string[]>();
                    edges.forEach((e) => {
                      if (
                        e.to_task_id &&
                        taskIdToKey.has(e.from_task_id) &&
                        taskIdToKey.has(e.to_task_id)
                      ) {
                        const key = taskIdToKey.get(e.to_task_id);
                        const blockerKey = taskIdToKey.get(e.from_task_id);
                        if (key !== undefined && blockerKey !== undefined) {
                          if (!blockedByMap.has(key)) {
                            blockedByMap.set(key, []);
                          }
                          blockedByMap.get(key)?.push(blockerKey);
                        }
                      }
                    });

                    const todos = tasks
                      .filter((t) => t.external_key)
                      .map((t) => {
                        const extKey = t.external_key as string;
                        const status =
                          t.status === "done" ? "completed" : "pending";
                        const blockedBy = blockedByMap.get(extKey) ?? [];
                        const docs = docsByTask.get(t.task_id);
                        const skills = skillsByTask.get(t.task_id);
                        return {
                          id: extKey,
                          content: t.title,
                          status,
                          ...(blockedBy.length > 0 && { blockedBy }),
                          ...(docs && docs.length > 0 && { docs: docs }),
                          ...(skills && skills.length > 0 && { skill: skills }),
                        };
                      });

                    const frontmatter = {
                      name: plan.title,
                      overview: plan.intent || "",
                      todos,
                      isProject: false,
                    };

                    const yamlStr = yaml.dump(frontmatter, { lineWidth: -1 });
                    return `---
${yamlStr}---
`;
                  }),
              );
          });
      });
  });
}
