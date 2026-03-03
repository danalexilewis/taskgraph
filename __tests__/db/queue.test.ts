import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { openQueue, type WriteQueue } from "../../src/db/queue";

function makeTempPath(): string {
  return path.join(os.tmpdir(), `tg-queue-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("WriteQueue", () => {
  let queuePath: string;
  let q: WriteQueue;

  beforeEach(() => {
    queuePath = makeTempPath();
    q = openQueue(queuePath);
  });

  afterEach(() => {
    q.close();
    try {
      fs.unlinkSync(queuePath);
    } catch {
      // ignore if already removed
    }
  });

  describe("append", () => {
    it("inserts a pending item and returns its id", () => {
      const result = q.append("note", JSON.stringify({ taskId: "t1", message: "hello", repoPath: "/repo" }));
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(typeof result.value).toBe("number");
        expect(result.value).toBeGreaterThan(0);
      }
    });

    it("inserted item appears in peek with status pending", () => {
      q.append("start", JSON.stringify({ taskId: "t1", agentName: "agent1", repoPath: "/repo" }));
      const peekResult = q.peek(10);
      expect(peekResult.isOk()).toBe(true);
      if (peekResult.isOk()) {
        expect(peekResult.value).toHaveLength(1);
        expect(peekResult.value[0].command_type).toBe("start");
        expect(peekResult.value[0].status).toBe("pending");
      }
    });

    it("idempotency key prevents duplicate append — returns same id", () => {
      const payload = JSON.stringify({ taskId: "t1", message: "msg", repoPath: "/repo" });
      const first = q.append("note", payload, "key-abc");
      const second = q.append("note", payload, "key-abc");

      expect(first.isOk()).toBe(true);
      expect(second.isOk()).toBe(true);
      if (first.isOk() && second.isOk()) {
        expect(first.value).toBe(second.value);
      }

      // Only one row should exist
      const peekResult = q.peek(10);
      expect(peekResult.isOk()).toBe(true);
      if (peekResult.isOk()) {
        expect(peekResult.value).toHaveLength(1);
      }
    });

    it("appends without idempotency key allows duplicates", () => {
      const payload = JSON.stringify({ taskId: "t1", message: "msg", repoPath: "/repo" });
      q.append("note", payload);
      q.append("note", payload);

      const peekResult = q.peek(10);
      expect(peekResult.isOk()).toBe(true);
      if (peekResult.isOk()) {
        expect(peekResult.value).toHaveLength(2);
      }
    });
  });

  describe("peek", () => {
    it("returns items in insertion order", () => {
      q.append("note", JSON.stringify({ taskId: "t1", message: "first", repoPath: "/repo" }));
      q.append("start", JSON.stringify({ taskId: "t2", agentName: "a", repoPath: "/repo" }));
      q.append("cancel", JSON.stringify({ taskId: "t3", reason: "test", repoPath: "/repo" }));

      const result = q.peek(10);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const types = result.value.map((r) => r.command_type);
        expect(types).toEqual(["note", "start", "cancel"]);
      }
    });

    it("respects the limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        q.append("note", JSON.stringify({ taskId: `t${i}`, message: "msg", repoPath: "/repo" }));
      }
      const result = q.peek(3);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(3);
      }
    });

    it("excludes non-pending items", () => {
      q.append("note", JSON.stringify({ taskId: "t1", message: "a", repoPath: "/repo" }));
      q.append("note", JSON.stringify({ taskId: "t2", message: "b", repoPath: "/repo" }));

      const peekBefore = q.peek(10);
      expect(peekBefore.isOk() && peekBefore.value.length).toBe(2);

      // ack the first item
      if (peekBefore.isOk()) {
        q.ack(peekBefore.value[0].id);
      }

      const peekAfter = q.peek(10);
      expect(peekAfter.isOk()).toBe(true);
      if (peekAfter.isOk()) {
        expect(peekAfter.value).toHaveLength(1);
        expect(peekAfter.value[0].command_type).toBe("note");
      }
    });
  });

  describe("ack", () => {
    it("marks an item as applied and removes it from pending", () => {
      q.append("done", JSON.stringify({ taskId: "t1", evidence: "ok", repoPath: "/repo" }));
      const peek1 = q.peek(10);
      expect(peek1.isOk() && peek1.value.length).toBe(1);

      if (peek1.isOk()) {
        const ackResult = q.ack(peek1.value[0].id);
        expect(ackResult.isOk()).toBe(true);
      }

      const peek2 = q.peek(10);
      expect(peek2.isOk()).toBe(true);
      if (peek2.isOk()) {
        expect(peek2.value).toHaveLength(0);
      }
    });
  });

  describe("markFailed", () => {
    it("marks an item as failed with an error message", () => {
      q.append("block", JSON.stringify({ taskId: "t1", blockedBy: "t0", reason: "dep", repoPath: "/repo" }));
      const peek = q.peek(10);

      if (peek.isOk() && peek.value.length > 0) {
        const item = peek.value[0];
        const failResult = q.markFailed(item.id, "Dolt connection refused");
        expect(failResult.isOk()).toBe(true);
      }

      // Failed item should not appear in peek (pending only)
      const afterPeek = q.peek(10);
      expect(afterPeek.isOk()).toBe(true);
      if (afterPeek.isOk()) {
        expect(afterPeek.value).toHaveLength(0);
      }
    });

    it("marks an item as failed without an error message", () => {
      q.append("note", JSON.stringify({ taskId: "t1", message: "msg", repoPath: "/repo" }));
      const peek = q.peek(10);

      if (peek.isOk() && peek.value.length > 0) {
        const failResult = q.markFailed(peek.value[0].id);
        expect(failResult.isOk()).toBe(true);
      }

      const afterPeek = q.peek(10);
      expect(afterPeek.isOk() && afterPeek.value.length).toBe(0);
    });
  });
});
