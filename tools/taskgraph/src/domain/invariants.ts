import { TaskStatus, EdgeType, Edge } from "./types";
import { Result, ResultAsync, ok, err } from "neverthrow";
import { AppError, ErrorCode, buildError } from "./errors";
import { query } from "../db/query";
import { sqlEscape } from "../db/escape";

// Helper for cycle detection (DFS)
function hasCycleDFS(
  start: string,
  current: string,
  graph: Map<string, string[]>,
  visited: Set<string>,
  recursionStack: Set<string>,
): boolean {
  visited.add(current);
  recursionStack.add(current);

  const neighbors = graph.get(current) || [];
  for (const neighbor of neighbors) {
    if (!visited.has(neighbor)) {
      if (hasCycleDFS(start, neighbor, graph, visited, recursionStack)) {
        return true;
      }
    } else if (recursionStack.has(neighbor)) {
      return true; // Cycle detected
    }
  }

  recursionStack.delete(current);
  return false;
}

export function checkNoBlockerCycle(
  fromTaskId: string,
  toTaskId: string,
  existingEdges: Edge[],
): Result<void, AppError> {
  const allEdges = [
    ...existingEdges,
    {
      from_task_id: fromTaskId,
      to_task_id: toTaskId,
      type: "blocks",
      reason: null,
    },
  ];
  const graph = new Map<string, string[]>();

  for (const edge of allEdges) {
    if (edge.type === "blocks") {
      if (!graph.has(edge.from_task_id)) {
        graph.set(edge.from_task_id, []);
      }
      graph.get(edge.from_task_id)?.push(edge.to_task_id);
    }
  }

  // Check for cycles starting from each node
  for (const node of graph.keys()) {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    if (hasCycleDFS(node, node, graph, visited, recursionStack)) {
      return err(
        buildError(
          ErrorCode.CYCLE_DETECTED,
          `Blocking edge from ${fromTaskId} to ${toTaskId} would create a cycle.`,
        ),
      );
    }
  }
  return ok(undefined);
}

export function checkRunnable(
  taskId: string,
  repoPath: string,
): ResultAsync<void, AppError> {
  const q = query(repoPath);
  return q
    .select<{ status: TaskStatus }>("task", {
      columns: ["status"],
      where: { task_id: taskId },
    })
    .andThen((taskResult) => {
      if (taskResult.length === 0) {
        return err(
          buildError(
            ErrorCode.TASK_NOT_FOUND,
            `Task with ID ${taskId} not found.`,
          ),
        );
      }
      const taskStatus = taskResult[0].status;

      if (taskStatus !== "todo") {
        return err(
          buildError(
            ErrorCode.INVALID_TRANSITION,
            `Task ${taskId} is not in 'todo' status. Current status: ${taskStatus}.`,
          ),
        );
      }

      const unmetBlockersQuery = `
        SELECT COUNT(*)
        FROM \`edge\` e
        JOIN \`task\` bt ON e.from_task_id = bt.task_id
        WHERE e.to_task_id = '${sqlEscape(taskId)}'
          AND e.type = 'blocks'
          AND bt.status NOT IN ('done','canceled');
      `;
      return q.raw<{ "COUNT(*)": number }[]>(unmetBlockersQuery);
    })
    .andThen((blockerCountResult: Array<{"COUNT(*)": number}>) => {
      const unmetBlockers = blockerCountResult[0]["COUNT(*)"];
      if (unmetBlockers > 0) {
        return err(
          buildError(
            ErrorCode.TASK_NOT_RUNNABLE,
            `Task ${taskId} has ${unmetBlockers} unmet blockers and is not runnable.`,
          ),
        );
      }
      return ok(undefined);
    });
}

export function checkValidTransition(
  currentStatus: TaskStatus,
  nextStatus: TaskStatus,
): Result<void, AppError> {
  const validTransitions: Record<TaskStatus, TaskStatus[]> = {
    todo: ["doing", "blocked", "canceled"],
    doing: ["done", "blocked", "canceled"],
    blocked: ["todo", "canceled"], // Can only go to todo when unblocked, or canceled
    done: [], // Terminal state
    canceled: [], // Terminal state
  };

  if (!validTransitions[currentStatus].includes(nextStatus)) {
    return err(
      buildError(
        ErrorCode.INVALID_TRANSITION,
        `Invalid task status transition from '${currentStatus}' to '${nextStatus}'.`,
      ),
    );
  }
  return ok(undefined);
}
