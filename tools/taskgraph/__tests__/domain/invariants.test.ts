import { describe, it, expect } from "vitest";
import {
  checkNoBlockerCycle,
  checkValidTransition,
} from "../../src/domain/invariants";
import { TaskStatusSchema, Edge } from "../../src/domain/types";
import { ErrorCode } from "../../src/domain/errors";

describe("invariants", () => {
  describe("checkValidTransition", () => {
    // Valid transitions
    it("should allow todo -> doing", () => {
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.todo,
          TaskStatusSchema.enum.doing,
        ).isOk(),
      ).toBe(true);
    });
    it("should allow todo -> blocked", () => {
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.todo,
          TaskStatusSchema.enum.blocked,
        ).isOk(),
      ).toBe(true);
    });
    it("should allow todo -> canceled", () => {
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.todo,
          TaskStatusSchema.enum.canceled,
        ).isOk(),
      ).toBe(true);
    });
    it("should allow doing -> done", () => {
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.doing,
          TaskStatusSchema.enum.done,
        ).isOk(),
      ).toBe(true);
    });
    it("should allow doing -> blocked", () => {
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.doing,
          TaskStatusSchema.enum.blocked,
        ).isOk(),
      ).toBe(true);
    });
    it("should allow doing -> canceled", () => {
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.doing,
          TaskStatusSchema.enum.canceled,
        ).isOk(),
      ).toBe(true);
    });
    it("should allow blocked -> todo", () => {
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.blocked,
          TaskStatusSchema.enum.todo,
        ).isOk(),
      ).toBe(true);
    });
    it("should allow blocked -> canceled", () => {
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.blocked,
          TaskStatusSchema.enum.canceled,
        ).isOk(),
      ).toBe(true);
    });

    // Invalid transitions
    it("should not allow todo -> done", () => {
      const result = checkValidTransition(
        TaskStatusSchema.enum.todo,
        TaskStatusSchema.enum.done,
      );
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.INVALID_TRANSITION);
    });
    it("should not allow done -> any", () => {
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.done,
          TaskStatusSchema.enum.todo,
        ).isErr(),
      ).toBe(true);
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.done,
          TaskStatusSchema.enum.doing,
        ).isErr(),
      ).toBe(true);
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.done,
          TaskStatusSchema.enum.blocked,
        ).isErr(),
      ).toBe(true);
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.done,
          TaskStatusSchema.enum.canceled,
        ).isErr(),
      ).toBe(true);
    });
    it("should not allow canceled -> any", () => {
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.canceled,
          TaskStatusSchema.enum.todo,
        ).isErr(),
      ).toBe(true);
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.canceled,
          TaskStatusSchema.enum.doing,
        ).isErr(),
      ).toBe(true);
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.canceled,
          TaskStatusSchema.enum.blocked,
        ).isErr(),
      ).toBe(true);
      expect(
        checkValidTransition(
          TaskStatusSchema.enum.canceled,
          TaskStatusSchema.enum.done,
        ).isErr(),
      ).toBe(true);
    });
  });

  describe("checkNoBlockerCycle", () => {
    it("should return ok for no cycle", () => {
      const edges: Edge[] = [
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
      expect(checkNoBlockerCycle("task3", "task4", edges).isOk()).toBe(true);
    });

    it("should return err for a direct cycle", () => {
      const edges: Edge[] = [
        {
          from_task_id: "task1",
          to_task_id: "task2",
          type: "blocks",
          reason: null,
        },
      ];
      const result = checkNoBlockerCycle("task2", "task1", edges);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.CYCLE_DETECTED);
    });

    it("should return err for a transitive cycle", () => {
      const edges: Edge[] = [
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
      const result = checkNoBlockerCycle("task3", "task1", edges);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.CYCLE_DETECTED);
    });

    it("should ignore 'relates' edges", () => {
      const edges: Edge[] = [
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
      expect(checkNoBlockerCycle("task3", "task4", edges).isOk()).toBe(true);
    });

    it("should return err for a self-blocking task", () => {
      const edges: Edge[] = [
        {
          from_task_id: "task1",
          to_task_id: "task2",
          type: "blocks",
          reason: null,
        },
      ];
      const result = checkNoBlockerCycle("task1", "task1", edges);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.CYCLE_DETECTED);
    });
  });
});
