import { describe, expect, it } from "vitest";
import { computeDesiredBlockedStatus } from "../../src/domain/blocked-status";
import { TaskStatusSchema } from "../../src/domain/types";

describe("blocked-status", () => {
  describe("computeDesiredBlockedStatus", () => {
    const todo = TaskStatusSchema.enum.todo;
    const doing = TaskStatusSchema.enum.doing;
    const blocked = TaskStatusSchema.enum.blocked;
    const done = TaskStatusSchema.enum.done;
    const canceled = TaskStatusSchema.enum.canceled;

    it("returns to_blocked when unmetBlockersCount > 0 and status is todo", () => {
      const result = computeDesiredBlockedStatus(todo, 1);
      expect(result).not.toBeNull();
      expect(result?.nextStatus).toBe("blocked");
      expect(result?.transition).toBe("to_blocked");
    });

    it("returns to_blocked when unmetBlockersCount > 0 and status is doing", () => {
      const result = computeDesiredBlockedStatus(doing, 2);
      expect(result).not.toBeNull();
      expect(result?.nextStatus).toBe("blocked");
      expect(result?.transition).toBe("to_blocked");
    });

    it("returns to_todo when unmetBlockersCount === 0 and status is blocked", () => {
      const result = computeDesiredBlockedStatus(blocked, 0);
      expect(result).not.toBeNull();
      expect(result?.nextStatus).toBe("todo");
      expect(result?.transition).toBe("to_todo");
    });

    it("returns null when unmetBlockersCount > 0 but status is already blocked", () => {
      const result = computeDesiredBlockedStatus(blocked, 1);
      expect(result).toBeNull();
    });

    it("returns null when unmetBlockersCount > 0 but status is done", () => {
      const result = computeDesiredBlockedStatus(done, 1);
      expect(result).toBeNull();
    });

    it("returns null when unmetBlockersCount > 0 but status is canceled", () => {
      const result = computeDesiredBlockedStatus(canceled, 1);
      expect(result).toBeNull();
    });

    it("returns null when unmetBlockersCount === 0 and status is todo", () => {
      const result = computeDesiredBlockedStatus(todo, 0);
      expect(result).toBeNull();
    });

    it("returns null when unmetBlockersCount === 0 and status is doing", () => {
      const result = computeDesiredBlockedStatus(doing, 0);
      expect(result).toBeNull();
    });

    it("returns null when unmetBlockersCount === 0 and status is done", () => {
      const result = computeDesiredBlockedStatus(done, 0);
      expect(result).toBeNull();
    });

    it("returns null when unmetBlockersCount === 0 and status is canceled", () => {
      const result = computeDesiredBlockedStatus(canceled, 0);
      expect(result).toBeNull();
    });
  });
});
