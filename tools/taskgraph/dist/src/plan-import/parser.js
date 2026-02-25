"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePlanMarkdown = parsePlanMarkdown;
const fs_1 = require("fs");
const neverthrow_1 = require("neverthrow");
const errors_1 = require("../domain/errors");
function parsePlanMarkdown(filePath) {
    try {
        const content = (0, fs_1.readFileSync)(filePath, "utf-8");
        const lines = content.split("\n");
        let planTitle = null;
        let planIntent = null;
        const tasks = [];
        let currentTask = null;
        let inAcceptanceBlock = false;
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (line.startsWith("# ")) {
                planTitle = line.substring(2).trim();
            }
            else if (line.startsWith("INTENT:")) {
                planIntent = line.substring("INTENT:".length).trim();
            }
            else if (trimmedLine.startsWith("TASK:")) {
                if (currentTask && currentTask.stableKey) {
                    tasks.push(currentTask);
                }
                currentTask = {
                    stableKey: trimmedLine.substring("TASK:".length).trim(),
                    blockedBy: [],
                    acceptance: [],
                };
                inAcceptanceBlock = false;
            }
            else if (currentTask && trimmedLine.startsWith("TITLE:")) {
                currentTask.title = trimmedLine.substring("TITLE:".length).trim();
                inAcceptanceBlock = false;
            }
            else if (currentTask && trimmedLine.startsWith("FEATURE:")) {
                currentTask.feature = trimmedLine.substring("FEATURE:".length).trim();
                inAcceptanceBlock = false;
            }
            else if (currentTask && trimmedLine.startsWith("AREA:")) {
                currentTask.area = trimmedLine.substring("AREA:".length).trim();
                inAcceptanceBlock = false;
            }
            else if (currentTask && trimmedLine.startsWith("BLOCKED_BY:")) {
                const blockers = trimmedLine
                    .substring("BLOCKED_BY:".length)
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                currentTask.blockedBy = [...(currentTask.blockedBy || []), ...blockers];
                inAcceptanceBlock = false;
            }
            else if (currentTask && trimmedLine.startsWith("ACCEPTANCE:")) {
                inAcceptanceBlock = true;
            }
            else if (currentTask &&
                inAcceptanceBlock &&
                trimmedLine.startsWith("-")) {
                currentTask.acceptance = [
                    ...(currentTask.acceptance || []),
                    trimmedLine.substring(1).trim(),
                ];
            }
            else {
                inAcceptanceBlock = false;
            }
        }
        if (currentTask && currentTask.stableKey) {
            tasks.push(currentTask);
        }
        return (0, neverthrow_1.ok)({ planTitle, planIntent, tasks });
    }
    catch (e) {
        return (0, neverthrow_1.err)((0, errors_1.buildError)(errors_1.ErrorCode.FILE_READ_FAILED, `Failed to read or parse markdown file at ${filePath}`, e));
    }
}
