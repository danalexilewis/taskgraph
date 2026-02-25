"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkNoBlockerCycle = checkNoBlockerCycle;
exports.checkRunnable = checkRunnable;
exports.checkValidTransition = checkValidTransition;
const neverthrow_1 = require("neverthrow");
const errors_1 = require("./errors");
const connection_1 = require("../db/connection");
// Helper for cycle detection (DFS)
function hasCycleDFS(start, current, graph, visited, recursionStack) {
    visited.add(current);
    recursionStack.add(current);
    const neighbors = graph.get(current) || [];
    for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
            if (hasCycleDFS(start, neighbor, graph, visited, recursionStack)) {
                return true;
            }
        }
        else if (recursionStack.has(neighbor)) {
            return true; // Cycle detected
        }
    }
    recursionStack.delete(current);
    return false;
}
function checkNoBlockerCycle(fromTaskId, toTaskId, existingEdges) {
    const allEdges = [
        ...existingEdges,
        {
            from_task_id: fromTaskId,
            to_task_id: toTaskId,
            type: "blocks",
            reason: null,
        },
    ];
    const graph = new Map();
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
        const visited = new Set();
        const recursionStack = new Set();
        if (hasCycleDFS(node, node, graph, visited, recursionStack)) {
            return (0, neverthrow_1.err)((0, errors_1.buildError)(errors_1.ErrorCode.CYCLE_DETECTED, `Blocking edge from ${fromTaskId} to ${toTaskId} would create a cycle.`));
        }
    }
    return (0, neverthrow_1.ok)(undefined);
}
function checkRunnable(taskId, repoPath) {
    const taskStatusQuery = `SELECT status FROM task WHERE task_id = '${taskId}';`;
    return (0, connection_1.doltSql)(taskStatusQuery, repoPath)
        .andThen((taskResult) => {
        if (taskResult.length === 0) {
            return (0, neverthrow_1.err)((0, errors_1.buildError)(errors_1.ErrorCode.TASK_NOT_FOUND, `Task with ID ${taskId} not found.`));
        }
        const taskStatus = taskResult[0].status;
        if (taskStatus !== "todo") {
            return (0, neverthrow_1.err)((0, errors_1.buildError)(errors_1.ErrorCode.INVALID_TRANSITION, `Task ${taskId} is not in 'todo' status. Current status: ${taskStatus}.`));
        }
        const unmetBlockersQuery = `
        SELECT COUNT(*)
        FROM edge e
        JOIN task bt ON e.from_task_id = bt.task_id
        WHERE e.to_task_id = '${taskId}'
          AND e.type = 'blocks'
          AND bt.status NOT IN ('done','canceled');
      `;
        return (0, connection_1.doltSql)(unmetBlockersQuery, repoPath);
    })
        .andThen((blockerCountResult) => {
        const unmetBlockers = blockerCountResult[0]["COUNT(*)"];
        if (unmetBlockers > 0) {
            return (0, neverthrow_1.err)((0, errors_1.buildError)(errors_1.ErrorCode.TASK_NOT_RUNNABLE, `Task ${taskId} has ${unmetBlockers} unmet blockers and is not runnable.`));
        }
        return (0, neverthrow_1.ok)(undefined);
    });
}
function checkValidTransition(currentStatus, nextStatus) {
    const validTransitions = {
        todo: ["doing", "blocked", "canceled"],
        doing: ["done", "blocked", "canceled"],
        blocked: ["todo", "canceled"], // Can only go to todo when unblocked, or canceled
        done: [], // Terminal state
        canceled: [], // Terminal state
    };
    if (!validTransitions[currentStatus].includes(nextStatus)) {
        return (0, neverthrow_1.err)((0, errors_1.buildError)(errors_1.ErrorCode.INVALID_TRANSITION, `Invalid task status transition from '${currentStatus}' to '${nextStatus}'.`));
    }
    return (0, neverthrow_1.ok)(undefined);
}
