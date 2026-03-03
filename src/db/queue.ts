/// <reference types="bun-types" />
import { Database } from "bun:sqlite";
import * as path from "node:path";
import { ok, err, type Result } from "neverthrow";
import type { Config } from "../config";
import { type AppError, buildError, ErrorCode } from "../domain/errors";

export interface QueueRow {
  id: number;
  command_type: string;
  payload_json: string;
  idempotency_key: string | null;
  status: "pending" | "applied" | "failed";
  error: string | null;
  created_at: string;
  updated_at: string;
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS write_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    idempotency_key TEXT UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('pending', 'applied', 'failed')) DEFAULT 'pending',
    error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

export interface WriteQueue {
  append(
    commandType: string,
    payloadJson: string,
    idempotencyKey?: string,
  ): Result<number, AppError>;
  peek(limit: number): Result<QueueRow[], AppError>;
  ack(id: number): Result<void, AppError>;
  markFailed(id: number, error?: string): Result<void, AppError>;
  close(): void;
}

/**
 * Derives the write queue SQLite path from the config's doltRepoPath.
 * Places queue.db as a sibling of the dolt directory inside .taskgraph/.
 */
export function getQueuePath(config: Config): string {
  return path.join(path.dirname(config.doltRepoPath), "queue.db");
}

/**
 * Opens (or creates) the write queue SQLite database at the given path
 * and returns a WriteQueue with append/peek/ack/markFailed operations.
 * Call .close() when done to release file handles (important in tests).
 */
export function openQueue(queuePath: string): WriteQueue {
  const db = new Database(queuePath);
  db.run(CREATE_TABLE_SQL);

  return {
    append(
      commandType: string,
      payloadJson: string,
      idempotencyKey?: string,
    ): Result<number, AppError> {
      try {
        const now = new Date().toISOString();

        if (idempotencyKey !== undefined) {
          const existing = db
            .query<{ id: number }, [string]>(
              "SELECT id FROM write_queue WHERE idempotency_key = ?",
            )
            .get(idempotencyKey);
          if (existing) {
            return ok(existing.id);
          }
        }

        const stmt = db.prepare(
          "INSERT INTO write_queue (command_type, payload_json, idempotency_key, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)",
        );
        const result = stmt.run(
          commandType,
          payloadJson,
          idempotencyKey ?? null,
          now,
          now,
        );
        return ok(result.lastInsertRowid as number);
      } catch (e) {
        if (
          e instanceof Error &&
          e.message.includes("UNIQUE constraint failed")
        ) {
          // Race: another process inserted the same key between our check and insert
          if (idempotencyKey !== undefined) {
            const existing = db
              .query<{ id: number }, [string]>(
                "SELECT id FROM write_queue WHERE idempotency_key = ?",
              )
              .get(idempotencyKey);
            if (existing) return ok(existing.id);
          }
        }
        return err(
          buildError(
            ErrorCode.DB_QUERY_FAILED,
            `Failed to append to write queue: ${e instanceof Error ? e.message : String(e)}`,
            e,
          ),
        );
      }
    },

    peek(limit: number): Result<QueueRow[], AppError> {
      try {
        const rows = db
          .query<QueueRow, [number]>(
            "SELECT * FROM write_queue WHERE status = 'pending' ORDER BY id ASC LIMIT ?",
          )
          .all(limit);
        return ok(rows);
      } catch (e) {
        return err(
          buildError(
            ErrorCode.DB_QUERY_FAILED,
            `Failed to peek write queue: ${e instanceof Error ? e.message : String(e)}`,
            e,
          ),
        );
      }
    },

    ack(id: number): Result<void, AppError> {
      try {
        const now = new Date().toISOString();
        db.run(
          "UPDATE write_queue SET status = 'applied', error = NULL, updated_at = ? WHERE id = ?",
          [now, id],
        );
        return ok(undefined);
      } catch (e) {
        return err(
          buildError(
            ErrorCode.DB_QUERY_FAILED,
            `Failed to ack write queue item ${id}: ${e instanceof Error ? e.message : String(e)}`,
            e,
          ),
        );
      }
    },

    markFailed(id: number, error?: string): Result<void, AppError> {
      try {
        const now = new Date().toISOString();
        db.run(
          "UPDATE write_queue SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
          [error ?? null, now, id],
        );
        return ok(undefined);
      } catch (e) {
        return err(
          buildError(
            ErrorCode.DB_QUERY_FAILED,
            `Failed to mark write queue item ${id} as failed: ${e instanceof Error ? e.message : String(e)}`,
            e,
          ),
        );
      }
    },

    close(): void {
      db.close();
    },
  };
}
