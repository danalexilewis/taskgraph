"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.doltCommit = doltCommit;
const execa_1 = require("execa");
const neverthrow_1 = require("neverthrow");
const errors_1 = require("../domain/errors");
function doltCommit(msg, repoPath, noCommit = false) {
    if (noCommit) {
        return neverthrow_1.ResultAsync.fromPromise(Promise.resolve(), () => (0, errors_1.buildError)(errors_1.ErrorCode.DB_COMMIT_FAILED, "Dry run commit failed"));
    }
    return neverthrow_1.ResultAsync.fromPromise((0, execa_1.execa)("dolt", ["add", "-A"], { cwd: repoPath }), (e) => (0, errors_1.buildError)(errors_1.ErrorCode.DB_COMMIT_FAILED, `Dolt add failed before commit: ${msg}`, e))
        .andThen(() => {
        return neverthrow_1.ResultAsync.fromPromise((0, execa_1.execa)("dolt", ["commit", "-m", msg, "--allow-empty"], {
            cwd: repoPath,
        }), (e) => (0, errors_1.buildError)(errors_1.ErrorCode.DB_COMMIT_FAILED, `Dolt commit failed: ${msg}`, e));
    })
        .map(() => undefined);
}
