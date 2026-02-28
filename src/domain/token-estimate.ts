/**
 * Token estimation using chars/4 heuristic (rough approximation for LLM context).
 */
export function estimateTokens(text: string): number {
  return Math.floor(text.length / 4);
}

/**
 * Estimates tokens for JSON-serializable values by stringifying then applying chars/4.
 */
export function estimateJsonTokens(obj: unknown): number {
  if (obj === null || obj === undefined) {
    return 0;
  }
  return estimateTokens(JSON.stringify(obj));
}
