/**
 * Public SDK entrypoint for programmatic Task Graph access.
 * Use TgClient for next, context, status (and future start, done, note, block)
 * without spawning the CLI.
 */

export { TgClient, type NextOptions } from "./client.js";
export type {
  ContextBlocker,
  ContextResult,
  NextResult,
  NextTaskRow,
  StatusResult,
} from "./types.js";
