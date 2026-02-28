#!/usr/bin/env bun
/**
 * Reads file paths from stdin (one per line) or from argv and outputs
 * a newline-separated list of test paths to run (dirs or files under __tests__).
 * Used by cheap-gate.sh for targeted test runs. Empty output = no affected tests (skip).
 */
import { readFileSync } from "node:fs";

function readPaths(): string[] {
  if (process.argv.length > 2) {
    return process.argv.slice(2);
  }
  try {
    const raw = readFileSync(0, "utf-8");
    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function pathToTestPath(p: string): string | null {
  const norm = p.replace(/^\.\//, "");
  if (norm.startsWith("__tests__/")) {
    const rest = norm.slice("__tests__/".length);
    const seg = rest.split("/")[0];
    return seg ? `__tests__/${seg}` : "__tests__";
  }
  if (norm.startsWith("src/")) {
    const rest = norm.slice("src/".length);
    const seg = rest.split("/")[0];
    return seg ? `__tests__/${seg}` : null;
  }
  return null;
}

const paths = readPaths();
const seen = new Set<string>();
for (const p of paths) {
  const out = pathToTestPath(p);
  if (out) seen.add(out);
}
const ordered = Array.from(seen).sort();
for (const o of ordered) {
  console.log(o);
}
