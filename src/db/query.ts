import type { ResultAsync } from "neverthrow";
import type { AppError } from "../domain/errors";
import { type DoltSqlOptions, doltSql } from "./connection";
import { sqlEscape } from "./escape";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export interface JsonObj {
  _type: "json";
  value: Record<string, JsonValue>;
}

export function jsonObj(value: Record<string, JsonValue>): JsonObj {
  return { _type: "json", value };
}

export type SqlValue = string | number | boolean | null | JsonObj;

export function now(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function formatValue(value: SqlValue): string {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return `'${sqlEscape(value)}'`;
  }
  if (value._type === "json") {
    const jsonPairs = Object.entries(value.value)
      .map(([key, val]) => {
        return `'${sqlEscape(key)}', '${sqlEscape(JSON.stringify(val))}'`;
      })
      .join(", ");
    return `JSON_OBJECT(${jsonPairs})`;
  }
  // Should not happen with SqlValue type
  return `'${sqlEscape(String(value))}'`;
}

function backtickWrap(name: string): string {
  return `\`${name}\``;
}

interface WhereClause {
  [key: string]: SqlValue | { op: string; value: SqlValue };
}

function buildWhereClause(where: WhereClause): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(where)) {
    if (typeof val === "object" && val !== null && "op" in val) {
      parts.push(`${backtickWrap(key)} ${val.op} ${formatValue(val.value)}`);
    } else {
      parts.push(`${backtickWrap(key)} = ${formatValue(val as SqlValue)}`);
    }
  }
  return parts.join(" AND ");
}

interface SelectOptions {
  columns?: string[];
  where?: WhereClause;
  orderBy?: string;
  limit?: number;
  offset?: number;
  groupBy?: string[];
  having?: string;
}

export function query(repoPath: string, connectionOptions?: DoltSqlOptions) {
  return {
    insert: <T>(
      table: string,
      data: Record<string, SqlValue>,
    ): ResultAsync<T[], AppError> => {
      const cols = Object.keys(data).map(backtickWrap).join(", ");
      const vals = Object.values(data).map(formatValue).join(", ");
      const sql = `INSERT INTO ${backtickWrap(table)} (${cols}) VALUES (${vals})`;
      return doltSql(sql, repoPath, connectionOptions).map((res) => res as T[]);
    },

    update: <T>(
      table: string,
      data: Record<string, SqlValue>,
      where: WhereClause,
    ): ResultAsync<T[], AppError> => {
      const setParts = Object.entries(data)
        .map(([key, val]) => `${backtickWrap(key)} = ${formatValue(val)}`)
        .join(", ");
      const whereClause = buildWhereClause(where);
      const sql = `UPDATE ${backtickWrap(table)} SET ${setParts} WHERE ${whereClause}`;
      return doltSql(sql, repoPath, connectionOptions).map((res) => res as T[]);
    },

    select: <T>(
      table: string,
      options?: SelectOptions,
    ): ResultAsync<T[], AppError> => {
      let sql = `SELECT ${options?.columns?.map(backtickWrap).join(", ") ?? "*"} FROM ${backtickWrap(table)}`;
      const whereClause =
        options?.where && Object.keys(options.where).length > 0
          ? buildWhereClause(options.where)
          : "";
      if (whereClause) {
        sql += ` WHERE ${whereClause}`;
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
      return doltSql(sql, repoPath, connectionOptions).map((res) => res as T[]);
    },

    count: (
      table: string,
      where?: WhereClause,
    ): ResultAsync<number, AppError> => {
      let sql = `SELECT COUNT(*) AS count FROM ${backtickWrap(table)}`;
      if (where) {
        sql += ` WHERE ${buildWhereClause(where)}`;
      }
      return doltSql(sql, repoPath, connectionOptions).map(
        (res) => (res as { count: number }[])[0]?.count ?? 0,
      );
    },

    raw: <T>(sql: string): ResultAsync<T[], AppError> => {
      return doltSql(sql, repoPath, connectionOptions).map((res) => res as T[]);
    },
  };
}
