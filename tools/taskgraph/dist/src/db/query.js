"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonObj = jsonObj;
exports.now = now;
exports.query = query;
const connection_1 = require("./connection");
const escape_1 = require("./escape");
function jsonObj(value) {
    return { _type: "json", value };
}
function now() {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
}
function formatValue(value) {
    if (value === null) {
        return "NULL";
    }
    if (typeof value === "boolean" || typeof value === "number") {
        return String(value);
    }
    if (typeof value === "string") {
        return `'${(0, escape_1.sqlEscape)(value)}'`;
    }
    if (value._type === "json") {
        const jsonPairs = Object.entries(value.value)
            .map(([key, val]) => {
            return `'${(0, escape_1.sqlEscape)(key)}', '${(0, escape_1.sqlEscape)(JSON.stringify(val))}'`;
        })
            .join(", ");
        return `JSON_OBJECT(${jsonPairs})`;
    }
    // Should not happen with SqlValue type
    return `'${(0, escape_1.sqlEscape)(String(value))}'`;
}
function backtickWrap(name) {
    return `\`${name}\``;
}
function buildWhereClause(where) {
    const parts = [];
    for (const [key, val] of Object.entries(where)) {
        if (typeof val === "object" && val !== null && "op" in val) {
            parts.push(`${backtickWrap(key)} ${val.op} ${formatValue(val.value)}`);
        }
        else {
            parts.push(`${backtickWrap(key)} = ${formatValue(val)}`);
        }
    }
    return parts.join(" AND ");
}
function query(repoPath) {
    return {
        insert: (table, data) => {
            const cols = Object.keys(data).map(backtickWrap).join(", ");
            const vals = Object.values(data).map(formatValue).join(", ");
            const sql = `INSERT INTO ${backtickWrap(table)} (${cols}) VALUES (${vals})`;
            return (0, connection_1.doltSql)(sql, repoPath);
        },
        update: (table, data, where) => {
            const setParts = Object.entries(data)
                .map(([key, val]) => `${backtickWrap(key)} = ${formatValue(val)}`)
                .join(", ");
            const whereClause = buildWhereClause(where);
            const sql = `UPDATE ${backtickWrap(table)} SET ${setParts} WHERE ${whereClause}`;
            return (0, connection_1.doltSql)(sql, repoPath);
        },
        select: (table, options) => {
            let sql = `SELECT ${options?.columns?.map(backtickWrap).join(", ") ?? "*"} FROM ${backtickWrap(table)}`;
            if (options?.where) {
                sql += ` WHERE ${buildWhereClause(options.where)}`;
            }
            if (options?.groupBy && options.groupBy.length > 0) {
                sql += ` GROUP BY ${options.groupBy.map(backtickWrap).join(", ")}`;
            }
            if (options?.having) {
                sql += ` HAVING ${options.having}`;
            }
            if (options?.orderBy) {
                sql += ` ORDER BY ${options.orderBy}`; // orderBy expected to be already escaped/formatted
            }
            if (options?.limit) {
                sql += ` LIMIT ${options.limit}`;
            }
            if (options?.offset) {
                sql += ` OFFSET ${options.offset}`;
            }
            return (0, connection_1.doltSql)(sql, repoPath);
        },
        count: (table, where) => {
            let sql = `SELECT COUNT(*) AS count FROM ${backtickWrap(table)}`;
            if (where) {
                sql += ` WHERE ${buildWhereClause(where)}`;
            }
            return (0, connection_1.doltSql)(sql, repoPath).map((res) => res[0]?.count ?? 0);
        },
        raw: (sql) => {
            return (0, connection_1.doltSql)(sql, repoPath);
        },
    };
}
