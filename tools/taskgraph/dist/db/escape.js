"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sqlEscape = sqlEscape;
function sqlEscape(value) {
    return value.replace(/'/g, "''");
}
