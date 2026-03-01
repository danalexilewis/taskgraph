import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { err, type Result } from "neverthrow";
import type { ParsedPlan } from "../plan-import/parser";
import { frontmatterToParsedPlan } from "../plan-import/parser";
import { type AppError, buildError, ErrorCode } from "./errors";

/** Substitute {{key}} in a string with vars[key]; leaves unknown placeholders as-is. */
export function substituteVars(
  s: string,
  vars: Record<string, string>,
): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/** Recursively substitute {{key}} in strings within objects, arrays, and primitives. */
export function substituteInValue(
  value: unknown,
  vars: Record<string, string>,
): unknown {
  if (typeof value === "string") {
    return substituteVars(value, vars);
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteInValue(item, vars));
  }
  if (value != null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substituteInValue(v, vars);
    }
    return out;
  }
  return value;
}

/**
 * Load a template YAML file, substitute variables, and convert to ParsedPlan.
 * Template format matches Cursor plan frontmatter (name, overview, todos, fileTree, risks, tests)
 * with optional {{varName}} placeholders in any string.
 */
export function loadAndSubstituteTemplate(
  filePath: string,
  vars: Record<string, string>,
): Result<ParsedPlan, AppError> {
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = yaml.load(content);
    const substituted = substituteInValue(parsed, vars);
    return frontmatterToParsedPlan(substituted, filePath);
  } catch (e) {
    const causeMessage =
      e instanceof Error ? e.message : String(e ?? "unknown error");
    return err(
      buildError(
        ErrorCode.FILE_READ_FAILED,
        `Failed to load or parse template at ${filePath}: ${causeMessage}`,
        e,
      ),
    );
  }
}
