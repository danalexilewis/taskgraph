import type { ResultAsync } from "neverthrow";
import { okAsync } from "neverthrow";
import type { AppError } from "../domain/errors";
import type { QueryCache } from "./cache";
import type { DoltSqlOptions } from "./connection";
import { query, type SqlValue } from "./query";

type WhereClause = Record<string, SqlValue | { op: string; value: SqlValue }>;

interface SelectOptions {
  columns?: string[];
  where?: WhereClause;
  orderBy?: string;
  limit?: number;
  offset?: number;
  groupBy?: string[];
  having?: string;
}

const READ_SQL_RE = /^\s*(SELECT|WITH|EXPLAIN)\b/i;
const TABLE_FROM_RE = /\bFROM\s+`?(\w+)`?/i;
const TABLE_INTO_RE = /\bINTO\s+`?(\w+)`?/i;

function extractReadTable(sql: string): string | undefined {
  return sql.match(TABLE_FROM_RE)?.[1];
}

function extractWriteTable(sql: string): string | undefined {
  return sql.match(TABLE_INTO_RE)?.[1];
}

export function cachedQuery(
  repoPath: string,
  cache: QueryCache,
  ttlMs: number,
  connectionOptions?: DoltSqlOptions,
) {
  const q = query(repoPath, connectionOptions);

  if (ttlMs === 0) {
    return q;
  }

  return {
    insert: <T>(
      table: string,
      data: Record<string, SqlValue>,
    ): ResultAsync<T[], AppError> => {
      return q.insert<T>(table, data).map((result) => {
        cache.invalidateTable(table);
        return result;
      });
    },

    update: <T>(
      table: string,
      data: Record<string, SqlValue>,
      where: WhereClause,
    ): ResultAsync<T[], AppError> => {
      return q.update<T>(table, data, where).map((result) => {
        cache.invalidateTable(table);
        return result;
      });
    },

    select: <T>(
      table: string,
      options?: SelectOptions,
    ): ResultAsync<T[], AppError> => {
      const key = `select:${table}:${JSON.stringify(options?.where ?? {})}:${options?.orderBy ?? ""}:${options?.limit ?? ""}:${options?.offset ?? ""}:${JSON.stringify(options?.groupBy ?? [])}:${options?.having ?? ""}:${JSON.stringify(options?.columns ?? [])}`;
      const cached = cache.get<T[]>(key);
      if (cached !== undefined) {
        return okAsync(cached);
      }
      return q.select<T>(table, options).map((result) => {
        cache.set(key, result, ttlMs, [table]);
        return result;
      });
    },

    count: (
      table: string,
      where?: WhereClause,
    ): ResultAsync<number, AppError> => {
      const key = `count:${table}:${JSON.stringify(where ?? {})}`;
      const cached = cache.get<number>(key);
      if (cached !== undefined) {
        return okAsync(cached);
      }
      return q.count(table, where).map((result) => {
        cache.set(key, result, ttlMs, [table]);
        return result;
      });
    },

    raw: <T>(sql: string): ResultAsync<T[], AppError> => {
      const isRead = READ_SQL_RE.test(sql);

      if (isRead) {
        const key = `raw:${sql}`;
        const cached = cache.get<T[]>(key);
        if (cached !== undefined) {
          return okAsync(cached);
        }
        const table = extractReadTable(sql);
        return q.raw<T>(sql).map((result) => {
          cache.set(key, result, ttlMs, table ? [table] : []);
          return result;
        });
      }

      const table = extractWriteTable(sql);
      return q.raw<T>(sql).map((result) => {
        if (table) cache.invalidateTable(table);
        return result;
      });
    },
  };
}
