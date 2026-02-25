"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.doltSql = doltSql;
const execa_1 = require("execa");
const neverthrow_1 = require("neverthrow");
const errors_1 = require("../domain/errors");
function doltSql(query, repoPath) {
    return neverthrow_1.ResultAsync.fromPromise((0, execa_1.execa)("dolt", ["sql", "-q", query, "-r", "json"], { cwd: repoPath }), (e) => (0, errors_1.buildError)(errors_1.ErrorCode.DB_QUERY_FAILED, `Dolt SQL query failed: ${query}`, e)).andThen((result) => {
        try {
            return (0, neverthrow_1.ok)(JSON.parse(result.stdout)?.rows ?? []);
        }
        catch (e) {
            return (0, neverthrow_1.err)((0, errors_1.buildError)(errors_1.ErrorCode.DB_PARSE_FAILED, `Failed to parse Dolt SQL output: ${result.stdout}`, e));
        }
    });
}
