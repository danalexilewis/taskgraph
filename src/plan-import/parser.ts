import { readFileSync } from "fs";
import yaml from "js-yaml";
import { Result, ok, err } from "neverthrow";
import { AppError, ErrorCode, buildError } from "../domain/errors";

export interface ParsedTask {
  stableKey: string;
  title: string;
  feature?: string;
  area?: string;
  blockedBy: string[];
  acceptance: string[];
  /** Mapped from Cursor todo status: completed→done, pending/other→todo */
  status?: "todo" | "done";
  /** Maps to docs/<doc>.md; multiple allowed. Renamed from domains. */
  docs?: string[];
  /** Maps to docs/skills/<skill>.md; multiple allowed. */
  skills?: string[];
  /** How to approach the work: create, modify, refactor, fix, investigate, test, document */
  changeType?:
    | "create"
    | "modify"
    | "refactor"
    | "fix"
    | "investigate"
    | "test"
    | "document";
  /** Detailed intent; maps to task.intent */
  intent?: string;
  /** Suggested code changes; maps to task.suggested_changes */
  suggestedChanges?: string;
  /** Sub-agent to execute this task; maps to task.agent */
  agent?: string;
}

export interface ParsedPlan {
  planTitle: string | null;
  planIntent: string | null;
  tasks: ParsedTask[];
  /** File tree (rich planning); maps to plan.file_tree */
  fileTree?: string | null;
  /** Risks array (rich planning); maps to plan.risks */
  risks?: Array<{
    description: string;
    severity: string;
    mitigation: string;
  }> | null;
  /** Tests to create (rich planning); maps to plan.tests */
  tests?: string[] | null;
  /** Markdown body below frontmatter (for display/export) */
  body?: string | null;
}

const CHANGE_TYPES = [
  "create",
  "modify",
  "refactor",
  "fix",
  "investigate",
  "test",
  "document",
] as const;
function isChangeType(s: unknown): s is (typeof CHANGE_TYPES)[number] {
  return (
    typeof s === "string" &&
    CHANGE_TYPES.includes(s as (typeof CHANGE_TYPES)[number])
  );
}

export function parsePlanMarkdown(
  filePath: string,
): Result<ParsedPlan, AppError> {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    let planTitle: string | null = null;
    let planIntent: string | null = null;
    const tasks: ParsedTask[] = [];
    let currentTask: Partial<ParsedTask> | null = null;
    let inAcceptanceBlock = false;

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (line.startsWith("# ")) {
        planTitle = line.substring(2).trim();
      } else if (line.startsWith("INTENT:")) {
        planIntent = line.substring("INTENT:".length).trim();
      } else if (trimmedLine.startsWith("TASK:")) {
        if (currentTask && currentTask.stableKey) {
          tasks.push(currentTask as ParsedTask);
        }
        currentTask = {
          stableKey: trimmedLine.substring("TASK:".length).trim(),
          blockedBy: [],
          acceptance: [],
        };
        inAcceptanceBlock = false;
      } else if (currentTask && trimmedLine.startsWith("TITLE:")) {
        currentTask.title = trimmedLine.substring("TITLE:".length).trim();
        inAcceptanceBlock = false;
      } else if (currentTask && trimmedLine.startsWith("FEATURE:")) {
        currentTask.feature = trimmedLine.substring("FEATURE:".length).trim();
        inAcceptanceBlock = false;
      } else if (currentTask && trimmedLine.startsWith("AREA:")) {
        currentTask.area = trimmedLine.substring("AREA:".length).trim();
        inAcceptanceBlock = false;
      } else if (currentTask && trimmedLine.startsWith("DOMAIN:")) {
        const parts = trimmedLine
          .substring("DOMAIN:".length)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        currentTask.docs = [...(currentTask.docs || []), ...parts];
        inAcceptanceBlock = false;
      } else if (currentTask && trimmedLine.startsWith("DOCS:")) {
        const parts = trimmedLine
          .substring("DOCS:".length)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        currentTask.docs = [...(currentTask.docs || []), ...parts];
        inAcceptanceBlock = false;
      } else if (currentTask && trimmedLine.startsWith("AGENT:")) {
        currentTask.agent = trimmedLine.substring("AGENT:".length).trim();
        inAcceptanceBlock = false;
      } else if (currentTask && trimmedLine.startsWith("SKILL:")) {
        const parts = trimmedLine
          .substring("SKILL:".length)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        currentTask.skills = [...(currentTask.skills || []), ...parts];
        inAcceptanceBlock = false;
      } else if (currentTask && trimmedLine.startsWith("CHANGE_TYPE:")) {
        const val = trimmedLine.substring("CHANGE_TYPE:".length).trim();
        if (isChangeType(val)) currentTask.changeType = val;
        inAcceptanceBlock = false;
      } else if (currentTask && trimmedLine.startsWith("BLOCKED_BY:")) {
        const blockers = trimmedLine
          .substring("BLOCKED_BY:".length)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        currentTask.blockedBy = [...(currentTask.blockedBy || []), ...blockers];
        inAcceptanceBlock = false;
      } else if (currentTask && trimmedLine.startsWith("ACCEPTANCE:")) {
        inAcceptanceBlock = true;
      } else if (
        currentTask &&
        inAcceptanceBlock &&
        trimmedLine.startsWith("-")
      ) {
        currentTask.acceptance = [
          ...(currentTask.acceptance || []),
          trimmedLine.substring(1).trim(),
        ];
      } else {
        inAcceptanceBlock = false;
      }
    }

    if (currentTask && currentTask.stableKey) {
      tasks.push(currentTask as ParsedTask);
    }

    return ok({ planTitle, planIntent, tasks });
  } catch (e) {
    return err(
      buildError(
        ErrorCode.FILE_READ_FAILED,
        `Failed to read or parse markdown file at ${filePath}`,
        e,
      ),
    );
  }
}

interface CursorTodo {
  id: string;
  content: string;
  status?: string;
  blockedBy?: string[];
  docs?: string | string[];
  /** @deprecated Use docs for new plans; kept for backward compatibility. */
  domain?: string | string[];
  skill?: string | string[];
  changeType?: string;
  intent?: string;
  suggestedChanges?: string;
  agent?: string;
}

interface CursorFrontmatter {
  name?: string;
  overview?: string;
  todos?: CursorTodo[];
  fileTree?: string;
  risks?: Array<{
    description?: string;
    severity?: string;
    mitigation?: string;
  }>;
  tests?: string[];
}

/** Normalize risks from frontmatter to { description, severity, mitigation }[]. */
function normalizeRisks(raw: CursorFrontmatter["risks"]): ParsedPlan["risks"] {
  if (!raw || !Array.isArray(raw)) return null;
  return raw
    .filter(
      (r): r is { description: string; severity: string; mitigation: string } =>
        r != null &&
        typeof r === "object" &&
        typeof (r as { description?: unknown }).description === "string" &&
        typeof (r as { severity?: unknown }).severity === "string" &&
        typeof (r as { mitigation?: unknown }).mitigation === "string",
    )
    .map((r) => ({
      description: r.description,
      severity: r.severity,
      mitigation: r.mitigation,
    }));
}

/** Parses a Cursor Plan file (YAML frontmatter with todos). */
export function parseCursorPlan(
  filePath: string,
): Result<ParsedPlan, AppError> {
  try {
    const content = readFileSync(filePath, "utf-8");
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return err(
        buildError(
          ErrorCode.FILE_READ_FAILED,
          `File ${filePath} does not have YAML frontmatter (--- ... ---)`,
        ),
      );
    }

    const body = content.slice(frontmatterMatch[0].length).trim() || null;

    const parsed = yaml.load(frontmatterMatch[1]) as CursorFrontmatter | null;
    if (!parsed || typeof parsed !== "object") {
      return err(
        buildError(
          ErrorCode.FILE_READ_FAILED,
          `Invalid YAML frontmatter in ${filePath}`,
        ),
      );
    }

    const todos = parsed.todos ?? [];
    if (!Array.isArray(todos)) {
      return err(
        buildError(
          ErrorCode.FILE_READ_FAILED,
          `Expected 'todos' to be an array in ${filePath}`,
        ),
      );
    }

    const tasks: ParsedTask[] = todos
      .filter(
        (t): t is CursorTodo =>
          t != null &&
          typeof t === "object" &&
          typeof t.id === "string" &&
          typeof t.content === "string",
      )
      .map((t) => {
        const status =
          t.status === "completed" ? ("done" as const) : ("todo" as const);
        const changeType =
          t.changeType != null && isChangeType(t.changeType)
            ? t.changeType
            : undefined;
        const rawDocs = t.docs ?? t.domain;
        const docs =
          rawDocs === undefined
            ? undefined
            : Array.isArray(rawDocs)
              ? rawDocs.filter((x): x is string => typeof x === "string")
              : typeof rawDocs === "string"
                ? [rawDocs]
                : undefined;
        const skills =
          t.skill === undefined
            ? undefined
            : Array.isArray(t.skill)
              ? t.skill.filter((x): x is string => typeof x === "string")
              : typeof t.skill === "string"
                ? [t.skill]
                : undefined;
        return {
          stableKey: t.id,
          title: t.content,
          blockedBy: Array.isArray(t.blockedBy) ? t.blockedBy : [],
          acceptance: [],
          status,
          docs: docs?.length ? docs : undefined,
          skills: skills?.length ? skills : undefined,
          changeType,
          intent: typeof t.intent === "string" ? t.intent : undefined,
          suggestedChanges:
            typeof t.suggestedChanges === "string"
              ? t.suggestedChanges
              : undefined,
          agent: typeof t.agent === "string" ? t.agent : undefined,
        };
      });

    const fileTree =
      typeof parsed.fileTree === "string" ? parsed.fileTree : null;
    const risks = normalizeRisks(parsed.risks);
    const tests =
      Array.isArray(parsed.tests) &&
      parsed.tests.every((x) => typeof x === "string")
        ? parsed.tests
        : null;

    return ok({
      planTitle: parsed.name ?? null,
      planIntent: parsed.overview ?? null,
      tasks,
      fileTree: fileTree ?? undefined,
      risks: risks ?? undefined,
      tests: tests ?? undefined,
      body: body ?? undefined,
    });
  } catch (e) {
    const causeMessage =
      e instanceof Error ? e.message : String(e ?? "unknown error");
    return err(
      buildError(
        ErrorCode.FILE_READ_FAILED,
        `Failed to read or parse Cursor plan at ${filePath}: ${causeMessage}`,
        e,
      ),
    );
  }
}
