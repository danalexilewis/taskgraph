"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const invariants_1 = require("../../src/domain/invariants");
const types_1 = require("../../src/domain/types");
const errors_1 = require("../../src/domain/errors");
(0, vitest_1.describe)("invariants", () => {
    (0, vitest_1.describe)("checkValidTransition", () => {
        // Valid transitions
        (0, vitest_1.it)("should allow todo -> doing", () => {
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.todo, types_1.TaskStatusSchema.enum.doing).isOk()).toBe(true);
        });
        (0, vitest_1.it)("should allow todo -> blocked", () => {
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.todo, types_1.TaskStatusSchema.enum.blocked).isOk()).toBe(true);
        });
        (0, vitest_1.it)("should allow todo -> canceled", () => {
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.todo, types_1.TaskStatusSchema.enum.canceled).isOk()).toBe(true);
        });
        (0, vitest_1.it)("should allow doing -> done", () => {
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.doing, types_1.TaskStatusSchema.enum.done).isOk()).toBe(true);
        });
        (0, vitest_1.it)("should allow doing -> blocked", () => {
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.doing, types_1.TaskStatusSchema.enum.blocked).isOk()).toBe(true);
        });
        (0, vitest_1.it)("should allow doing -> canceled", () => {
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.doing, types_1.TaskStatusSchema.enum.canceled).isOk()).toBe(true);
        });
        (0, vitest_1.it)("should allow blocked -> todo", () => {
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.blocked, types_1.TaskStatusSchema.enum.todo).isOk()).toBe(true);
        });
        (0, vitest_1.it)("should allow blocked -> canceled", () => {
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.blocked, types_1.TaskStatusSchema.enum.canceled).isOk()).toBe(true);
        });
        // Invalid transitions
        (0, vitest_1.it)("should not allow todo -> done", () => {
            const result = (0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.todo, types_1.TaskStatusSchema.enum.done);
            (0, vitest_1.expect)(result.isErr()).toBe(true);
            (0, vitest_1.expect)(result._unsafeUnwrapErr().code).toBe(errors_1.ErrorCode.INVALID_TRANSITION);
        });
        (0, vitest_1.it)("should not allow done -> any", () => {
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.done, types_1.TaskStatusSchema.enum.todo).isErr()).toBe(true);
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.done, types_1.TaskStatusSchema.enum.doing).isErr()).toBe(true);
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.done, types_1.TaskStatusSchema.enum.blocked).isErr()).toBe(true);
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.done, types_1.TaskStatusSchema.enum.canceled).isErr()).toBe(true);
        });
        (0, vitest_1.it)("should not allow canceled -> any", () => {
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.canceled, types_1.TaskStatusSchema.enum.todo).isErr()).toBe(true);
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.canceled, types_1.TaskStatusSchema.enum.doing).isErr()).toBe(true);
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.canceled, types_1.TaskStatusSchema.enum.blocked).isErr()).toBe(true);
            (0, vitest_1.expect)((0, invariants_1.checkValidTransition)(types_1.TaskStatusSchema.enum.canceled, types_1.TaskStatusSchema.enum.done).isErr()).toBe(true);
        });
    });
    (0, vitest_1.describe)("checkNoBlockerCycle", () => {
        (0, vitest_1.it)("should return ok for no cycle", () => {
            const edges = [
                {
                    from_task_id: "task1",
                    to_task_id: "task2",
                    type: "blocks",
                    reason: null,
                },
                {
                    from_task_id: "task2",
                    to_task_id: "task3",
                    type: "blocks",
                    reason: null,
                },
            ];
            (0, vitest_1.expect)((0, invariants_1.checkNoBlockerCycle)("task3", "task4", edges).isOk()).toBe(true);
        });
        (0, vitest_1.it)("should return err for a direct cycle", () => {
            const edges = [
                {
                    from_task_id: "task1",
                    to_task_id: "task2",
                    type: "blocks",
                    reason: null,
                },
            ];
            const result = (0, invariants_1.checkNoBlockerCycle)("task2", "task1", edges);
            (0, vitest_1.expect)(result.isErr()).toBe(true);
            (0, vitest_1.expect)(result._unsafeUnwrapErr().code).toBe(errors_1.ErrorCode.CYCLE_DETECTED);
        });
        (0, vitest_1.it)("should return err for a transitive cycle", () => {
            const edges = [
                {
                    from_task_id: "task1",
                    to_task_id: "task2",
                    type: "blocks",
                    reason: null,
                },
                {
                    from_task_id: "task2",
                    to_task_id: "task3",
                    type: "blocks",
                    reason: null,
                },
            ];
            const result = (0, invariants_1.checkNoBlockerCycle)("task3", "task1", edges);
            (0, vitest_1.expect)(result.isErr()).toBe(true);
            (0, vitest_1.expect)(result._unsafeUnwrapErr().code).toBe(errors_1.ErrorCode.CYCLE_DETECTED);
        });
        (0, vitest_1.it)("should ignore 'relates' edges", () => {
            const edges = [
                {
                    from_task_id: "task1",
                    to_task_id: "task2",
                    type: "relates",
                    reason: null,
                },
                {
                    from_task_id: "task2",
                    to_task_id: "task1",
                    type: "relates",
                    reason: null,
                },
            ];
            (0, vitest_1.expect)((0, invariants_1.checkNoBlockerCycle)("task3", "task4", edges).isOk()).toBe(true);
        });
        (0, vitest_1.it)("should return err for a self-blocking task", () => {
            const edges = [
                {
                    from_task_id: "task1",
                    to_task_id: "task2",
                    type: "blocks",
                    reason: null,
                },
            ];
            const result = (0, invariants_1.checkNoBlockerCycle)("task1", "task1", edges);
            (0, vitest_1.expect)(result.isErr()).toBe(true);
            (0, vitest_1.expect)(result._unsafeUnwrapErr().code).toBe(errors_1.ErrorCode.CYCLE_DETECTED);
        });
    });
});
