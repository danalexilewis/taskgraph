import type { Mock } from "vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { query, now, jsonObj, JsonObj } from "../../src/db/query";
import { doltSql } from "../../src/db/connection";
import { ResultAsync, ok, okAsync } from "neverthrow";

vi.mock("../../src/db/connection", () => ({
  doltSql: vi.fn(),
}));

describe("query builder", () => {
  const repoPath = "./test_repo";
  const mockDoltSql = doltSql as Mock;

  beforeEach(() => {
    mockDoltSql.mockClear();
    mockDoltSql.mockImplementation((sql: string) => {
      console.log("MOCKED DOLT SQL:", sql);
      if (sql.startsWith("SELECT COUNT(*)")) {
        return okAsync([{ "COUNT(*)": 0 }]); // Default count to 0 unless overridden
      }
      return okAsync([]);
    });
  });

  it("should format now() correctly", () => {
    const date = new Date("2026-02-25T10:00:00.000Z");
    vi.setSystemTime(date);
    expect(now()).toBe("2026-02-25 10:00:00");
  });

  it("should correctly format a simple INSERT statement", async () => {
    const q = query(repoPath);
    await q.insert("test_table", { id: 1, name: "test" });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "INSERT INTO `test_table` (`id`, `name`) VALUES (1, 'test')",
      repoPath,
    );
  });

  it("should handle NULL values in INSERT", async () => {
    const q = query(repoPath);
    await q.insert("test_table", { id: 2, name: null });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "INSERT INTO `test_table` (`id`, `name`) VALUES (2, NULL)",
      repoPath,
    );
  });

  it("should handle boolean values in INSERT", async () => {
    const q = query(repoPath);
    await q.insert("test_table", { id: 3, active: true });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "INSERT INTO `test_table` (`id`, `active`) VALUES (3, true)",
      repoPath,
    );
  });

  it("should handle JSON_OBJECT in INSERT", async () => {
    const q = query(repoPath);
    const data = { key: "value" };
    await q.insert("test_table", { id: 4, metadata: jsonObj({ val: data }) });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "INSERT INTO `test_table` (`id`, `metadata`) VALUES (4, JSON_OBJECT('val', '{\"key\":\"value\"}'))",
      repoPath,
    );
  });

  it("should correctly format a simple UPDATE statement", async () => {
    const q = query(repoPath);
    await q.update("test_table", { name: "updated" }, { id: 1 });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "UPDATE `test_table` SET `name` = 'updated' WHERE `id` = 1",
      repoPath,
    );
  });

  it("should handle NULL in UPDATE set clause", async () => {
    const q = query(repoPath);
    await q.update("test_table", { name: null }, { id: 1 });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "UPDATE `test_table` SET `name` = NULL WHERE `id` = 1",
      repoPath,
    );
  });

  it("should handle JSON_OBJECT in UPDATE set clause", async () => {
    const q = query(repoPath);
    const data = { new_key: "new_value" };
    await q.update(
      "test_table",
      { metadata: jsonObj({ val: data }) },
      { id: 4 },
    );
    expect(mockDoltSql).toHaveBeenCalledWith(
      "UPDATE `test_table` SET `metadata` = JSON_OBJECT('val', '{\"new_key\":\"new_value\"}') WHERE `id` = 4",
      repoPath,
    );
  });

  it("should handle complex WHERE clauses in UPDATE", async () => {
    const q = query(repoPath);
    await q.update("test_table", { name: "complex" }, { id: 1, type: "A" });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "UPDATE `test_table` SET `name` = 'complex' WHERE `id` = 1 AND `type` = 'A'",
      repoPath,
    );
  });

  it("should handle WHERE with operators", async () => {
    const q = query(repoPath);
    await q.update(
      "test_table",
      { name: "complex" },
      { id: { op: ">", value: 1 } },
    );
    expect(mockDoltSql).toHaveBeenCalledWith(
      "UPDATE `test_table` SET `name` = 'complex' WHERE `id` > 1",
      repoPath,
    );
  });

  it("should correctly format a simple SELECT statement", async () => {
    const q = query(repoPath);
    await q.select("test_table", { columns: ["id", "name"] });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "SELECT `id`, `name` FROM `test_table`",
      repoPath,
    );
  });

  it("should select all columns if not specified", async () => {
    const q = query(repoPath);
    await q.select("test_table");
    expect(mockDoltSql).toHaveBeenCalledWith(
      "SELECT * FROM `test_table`",
      repoPath,
    );
  });

  it("should handle WHERE clause in SELECT", async () => {
    const q = query(repoPath);
    await q.select("test_table", { where: { id: 1 } });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "SELECT * FROM `test_table` WHERE `id` = 1",
      repoPath,
    );
  });

  it("should handle ORDER BY in SELECT", async () => {
    const q = query(repoPath);
    await q.select("test_table", { orderBy: "name DESC" });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "SELECT * FROM `test_table` ORDER BY name DESC",
      repoPath,
    );
  });

  it("should handle LIMIT in SELECT", async () => {
    const q = query(repoPath);
    await q.select("test_table", { limit: 10 });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "SELECT * FROM `test_table` LIMIT 10",
      repoPath,
    );
  });

  it("should handle OFFSET in SELECT", async () => {
    const q = query(repoPath);
    await q.select("test_table", { offset: 5 });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "SELECT * FROM `test_table` OFFSET 5",
      repoPath,
    );
  });

  it("should handle GROUP BY in SELECT", async () => {
    const q = query(repoPath);
    await q.select("test_table", { groupBy: ["category"] });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "SELECT * FROM `test_table` GROUP BY `category`",
      repoPath,
    );
  });

  it("should handle HAVING in SELECT", async () => {
    const q = query(repoPath);
    await q.select("test_table", {
      groupBy: ["category"],
      having: "COUNT(*) > 1",
    });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "SELECT * FROM `test_table` GROUP BY `category` HAVING COUNT(*) > 1",
      repoPath,
    );
  });

  it("should correctly format a COUNT statement", async () => {
    const q = query(repoPath);
    mockDoltSql.mockImplementationOnce(() => okAsync([{ count: 5 }]));
    const count = await q.count("test_table", { status: "active" });
    expect(mockDoltSql).toHaveBeenCalledWith(
      "SELECT COUNT(*) AS count FROM `test_table` WHERE `status` = 'active'",
      repoPath,
    );
    expect(count.unwrapOr(0)).toBe(5);
  });

  it("should call doltSql for raw queries", async () => {
    const q = query(repoPath);
    const rawSql = "SELECT * FROM `users` WHERE `id` = 1";
    await q.raw(rawSql);
    expect(mockDoltSql).toHaveBeenCalledWith(rawSql, repoPath);
  });
});
