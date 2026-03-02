import { describe, expect, it } from "bun:test";
import yaml from "js-yaml";

const REQUIRED_SECTIONS = [
  "Project Landscape",
  "Workload Snapshot",
  "Cross-Plan Analysis",
  "Health and Risks",
  "Formation",
  "Suggested Work Order",
];

function hasRequiredSections(markdown: string): boolean {
  const body = markdown.replace(/^---[\s\S]*?---\s*\n?/, "");
  for (const name of REQUIRED_SECTIONS) {
    if (
      !new RegExp(
        `^##\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        "m",
      ).test(body)
    )
      return false;
  }
  return true;
}

function parseFrontmatter(markdown: string): {
  type?: string;
  generated_at?: string;
} {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  try {
    const parsed = yaml.load(match[1]) as Record<string, unknown>;
    return {
      type: typeof parsed?.type === "string" ? parsed.type : undefined,
      generated_at:
        typeof parsed?.generated_at === "string"
          ? parsed.generated_at
          : undefined,
    };
  } catch {
    return {};
  }
}

function isSitrepStale(
  generatedAtIso: string,
  now: Date = new Date(),
): boolean {
  const generated = new Date(generatedAtIso);
  if (Number.isNaN(generated.getTime())) return true;
  return now.getTime() - generated.getTime() > 60 * 60 * 1000;
}

function formationEntriesHaveRequiredFields(markdown: string): boolean {
  const body = markdown.replace(/^---[\s\S]*?---\s*\n?/, "");
  const formationMatch = body.match(
    /formation:\s*\n([\s\S]*?)(?=\n##|\n\n##|$)/i,
  );
  if (!formationMatch) return false;
  try {
    const block = `formation:\n${formationMatch[1]}`;
    const parsed = yaml.load(block) as {
      formation?: Array<Record<string, unknown>>;
    };
    const entries = parsed?.formation;
    if (!Array.isArray(entries) || entries.length === 0) return false;
    for (const entry of entries) {
      if (typeof entry.role !== "string") return false;
      if (
        typeof entry.cardinality !== "string" &&
        typeof entry.cardinality !== "number"
      )
        return false;
      if (
        typeof entry.suggested !== "number" &&
        typeof entry.suggested !== "string"
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

describe("Sitrep validation", () => {
  const validSitrep = `---
type: sitrep
generated_at: "2026-03-02T14:30:00Z"
generated_by: "orchestrator"
---

## Project Landscape
Active plans: A, B.

## Workload Snapshot
Doing: 2. Runnable: 5.

## Cross-Plan Analysis
No file conflicts.

## Health and Risks
Gate green.

## Formation
formation:
  - role: execution-lead
    cardinality: 1-3
    suggested: 2
  - role: overseer
    cardinality: 0-1
    suggested: 1

## Suggested Work Order
1. Plan A — execution-lead
`;

  it("hasRequiredSections returns true when all required sections exist", () => {
    expect(hasRequiredSections(validSitrep)).toBe(true);
  });

  it("hasRequiredSections returns false when a section is missing", () => {
    const missing = validSitrep.replace("## Formation\n", "## Other\n");
    expect(hasRequiredSections(missing)).toBe(false);
  });

  it("parseFrontmatter extracts type and generated_at", () => {
    const fm = parseFrontmatter(validSitrep);
    expect(fm.type).toBe("sitrep");
    expect(fm.generated_at).toBe("2026-03-02T14:30:00Z");
  });

  it("parseFrontmatter returns empty when no frontmatter", () => {
    expect(parseFrontmatter("## Only body")).toEqual({});
  });

  it("isSitrepStale returns true when generated_at is more than 1 hour ago", () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(isSitrepStale(old)).toBe(true);
  });

  it("isSitrepStale returns false when generated_at is less than 1 hour ago", () => {
    const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(isSitrepStale(recent)).toBe(false);
  });

  it("formationEntriesHaveRequiredFields returns true when formation has role, cardinality, suggested", () => {
    expect(formationEntriesHaveRequiredFields(validSitrep)).toBe(true);
  });

  it("formationEntriesHaveRequiredFields returns false when formation entry missing role", () => {
    const bad = validSitrep.replace(
      "role: execution-lead",
      "name: execution-lead",
    );
    expect(formationEntriesHaveRequiredFields(bad)).toBe(false);
  });
});
