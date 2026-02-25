"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const query_1 = require("../../src/db/query");
const connection_1 = require("../../src/db/connection");
const neverthrow_1 = require("neverthrow");
vitest_1.vi.mock("../../src/db/connection", () => ({
    doltSql: vitest_1.vi.fn(),
}));
(0, vitest_1.describe)("query builder", () => {
    const repoPath = "./test_repo";
    const mockDoltSql = connection_1.doltSql;
    (0, vitest_1.beforeEach)(() => {
        mockDoltSql.mockClear();
        mockDoltSql.mockImplementation((sql) => {
            console.log("MOCKED DOLT SQL:", sql);
            if (sql.startsWith("SELECT COUNT(*)")) {
                return (0, neverthrow_1.okAsync)([{ "COUNT(*)": 0 }]); // Default count to 0 unless overridden
            }
            return (0, neverthrow_1.okAsync)([]);
        });
    });
    (0, vitest_1.it)("should format now() correctly", () => {
        const date = new Date("2026-02-25T10:00:00.000Z");
        vitest_1.vi.setSystemTime(date);
        (0, vitest_1.expect)((0, query_1.now)()).toBe("2026-02-25 10:00:00");
    });
    (0, vitest_1.it)("should correctly format a simple INSERT statement", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.insert("test_table", { id: 1, name: "test" });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("INSERT INTO `test_table` (`id`, `name`) VALUES (1, 'test')", repoPath);
    });
    (0, vitest_1.it)("should handle NULL values in INSERT", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.insert("test_table", { id: 2, name: null });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("INSERT INTO `test_table` (`id`, `name`) VALUES (2, NULL)", repoPath);
    });
    (0, vitest_1.it)("should handle boolean values in INSERT", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.insert("test_table", { id: 3, active: true });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("INSERT INTO `test_table` (`id`, `active`) VALUES (3, true)", repoPath);
    });
    (0, vitest_1.it)("should handle JSON_OBJECT in INSERT", async () => {
        const q = (0, query_1.query)(repoPath);
        const data = { key: "value" };
        await q.insert("test_table", { id: 4, metadata: (0, query_1.jsonObj)({ val: data }) });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("INSERT INTO `test_table` (`id`, `metadata`) VALUES (4, JSON_OBJECT('val', '{\"key\":\"value\"}'))", repoPath);
    });
    (0, vitest_1.it)("should correctly format a simple UPDATE statement", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.update("test_table", { name: "updated" }, { id: 1 });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("UPDATE `test_table` SET `name` = 'updated' WHERE `id` = 1", repoPath);
    });
    (0, vitest_1.it)("should handle NULL in UPDATE set clause", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.update("test_table", { name: null }, { id: 1 });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("UPDATE `test_table` SET `name` = NULL WHERE `id` = 1", repoPath);
    });
    (0, vitest_1.it)("should handle JSON_OBJECT in UPDATE set clause", async () => {
        const q = (0, query_1.query)(repoPath);
        const data = { new_key: "new_value" };
        await q.update("test_table", { metadata: (0, query_1.jsonObj)({ val: data }) }, { id: 4 });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("UPDATE `test_table` SET `metadata` = JSON_OBJECT('val', '{\"new_key\":\"new_value\"}') WHERE `id` = 4", repoPath);
    });
    (0, vitest_1.it)("should handle complex WHERE clauses in UPDATE", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.update("test_table", { name: "complex" }, { id: 1, type: "A" });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("UPDATE `test_table` SET `name` = 'complex' WHERE `id` = 1 AND `type` = 'A'", repoPath);
    });
    (0, vitest_1.it)("should handle WHERE with operators", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.update("test_table", { name: "complex" }, { id: { op: ">", value: 1 } });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("UPDATE `test_table` SET `name` = 'complex' WHERE `id` > 1", repoPath);
    });
    (0, vitest_1.it)("should correctly format a simple SELECT statement", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.select("test_table", { columns: ["id", "name"] });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("SELECT `id`, `name` FROM `test_table`", repoPath);
    });
    (0, vitest_1.it)("should select all columns if not specified", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.select("test_table");
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("SELECT * FROM `test_table`", repoPath);
    });
    (0, vitest_1.it)("should handle WHERE clause in SELECT", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.select("test_table", { where: { id: 1 } });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("SELECT * FROM `test_table` WHERE `id` = 1", repoPath);
    });
    (0, vitest_1.it)("should handle ORDER BY in SELECT", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.select("test_table", { orderBy: "name DESC" });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("SELECT * FROM `test_table` ORDER BY name DESC", repoPath);
    });
    (0, vitest_1.it)("should handle LIMIT in SELECT", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.select("test_table", { limit: 10 });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("SELECT * FROM `test_table` LIMIT 10", repoPath);
    });
    (0, vitest_1.it)("should handle OFFSET in SELECT", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.select("test_table", { offset: 5 });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("SELECT * FROM `test_table` OFFSET 5", repoPath);
    });
    (0, vitest_1.it)("should handle GROUP BY in SELECT", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.select("test_table", { groupBy: ["category"] });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("SELECT * FROM `test_table` GROUP BY `category`", repoPath);
    });
    (0, vitest_1.it)("should handle HAVING in SELECT", async () => {
        const q = (0, query_1.query)(repoPath);
        await q.select("test_table", {
            groupBy: ["category"],
            having: "COUNT(*) > 1",
        });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("SELECT * FROM `test_table` GROUP BY `category` HAVING COUNT(*) > 1", repoPath);
    });
    (0, vitest_1.it)("should correctly format a COUNT statement", async () => {
        const q = (0, query_1.query)(repoPath);
        mockDoltSql.mockImplementationOnce(() => (0, neverthrow_1.okAsync)([{ count: 5 }]));
        const count = await q.count("test_table", { status: "active" });
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith("SELECT COUNT(*) AS count FROM `test_table` WHERE `status` = 'active'", repoPath);
        (0, vitest_1.expect)(count.unwrapOr(0)).toBe(5);
    });
    (0, vitest_1.it)("should call doltSql for raw queries", async () => {
        const q = (0, query_1.query)(repoPath);
        const rawSql = "SELECT * FROM `users` WHERE `id` = 1";
        await q.raw(rawSql);
        (0, vitest_1.expect)(mockDoltSql).toHaveBeenCalledWith(rawSql, repoPath);
    });
});
