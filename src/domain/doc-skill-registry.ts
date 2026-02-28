import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { minimatch } from "minimatch";
import { err, ok, type Result } from "neverthrow";
import { type AppError, buildError, ErrorCode } from "./errors";

export interface TriggerMetadata {
  files: string[];
  change_types: string[];
  keywords: string[];
}

export interface RegistryEntry {
  slug: string;
  type: "doc" | "skill";
  triggers: TriggerMetadata;
}

function parseFrontmatterTriggers(content: string): TriggerMetadata | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    const parsed = yaml.load(match[1]) as { triggers?: TriggerMetadata } | null;
    return parsed?.triggers ?? null;
  } catch (_e: unknown) {
    return null;
  }
}

export function loadRegistry(
  repoRoot: string,
): Result<RegistryEntry[], AppError> {
  try {
    const docsDir = join(repoRoot, "docs");
    const domainsMd = readFileSync(join(docsDir, "domains.md"), "utf8");
    const domainRegex = /\|\s*`([^`]+)`\s*\|\s*\[([^\]]+)\]\(/g;
    const domains: Array<{ slug: string; file: string }> = [];
    for (const m of domainsMd.matchAll(domainRegex)) {
      domains.push({ slug: m[1], file: m[2] });
    }

    const skillsReadme = readFileSync(
      join(docsDir, "skills", "README.md"),
      "utf8",
    );
    const skillRegex = /\|\s*\[([^\]]+)\]\(([^)]+\.md)\)/g;
    const skills: Array<{ slug: string; file: string }> = [];
    for (const m of skillsReadme.matchAll(skillRegex)) {
      skills.push({ slug: m[1], file: m[2] });
    }

    const entries: RegistryEntry[] = [];
    // load doc entries
    for (const { slug, file } of domains) {
      const fullPath = join(docsDir, file);
      let content: string;
      try {
        content = readFileSync(fullPath, "utf8");
      } catch (e: unknown) {
        return err(
          buildError(
            ErrorCode.FILE_READ_FAILED,
            `Failed to read doc file: ${file}`,
            e,
          ),
        );
      }
      const triggers = parseFrontmatterTriggers(content);
      if (!triggers) {
        return err(
          buildError(
            ErrorCode.PARSE_FAILED,
            `Missing or invalid triggers in doc file: ${file}`,
          ),
        );
      }
      entries.push({ slug, type: "doc", triggers });
    }
    // load skill entries
    for (const { slug, file } of skills) {
      const fullPath = join(docsDir, "skills", file);
      let content: string;
      try {
        content = readFileSync(fullPath, "utf8");
      } catch (e: unknown) {
        return err(
          buildError(
            ErrorCode.FILE_READ_FAILED,
            `Failed to read skill file: ${file}`,
            e,
          ),
        );
      }
      const triggers = parseFrontmatterTriggers(content);
      if (!triggers) {
        return err(
          buildError(
            ErrorCode.PARSE_FAILED,
            `Missing or invalid triggers in skill file: ${file}`,
          ),
        );
      }
      entries.push({ slug, type: "skill", triggers });
    }

    return ok(entries);
  } catch (e: unknown) {
    return err(
      buildError(ErrorCode.UNKNOWN_ERROR, "Failed to load registry", e),
    );
  }
}

export function matchDocsForTask(
  registry: RegistryEntry[],
  filePatterns: string[],
  changeType: string | null,
  title: string,
): string[] {
  const matches = new Set<string>();
  const titleLower = title.toLowerCase();
  for (const entry of registry) {
    if (entry.type !== "doc") continue;
    const fileMatch = entry.triggers.files.some((pattern) =>
      filePatterns.some((path) => minimatch(path, pattern)),
    );
    if (!fileMatch) continue;
    const secondSignal =
      (changeType && entry.triggers.change_types.includes(changeType)) ||
      entry.triggers.keywords.some((kw) =>
        titleLower.includes(kw.toLowerCase()),
      );
    if (secondSignal) {
      matches.add(entry.slug);
    }
  }
  return Array.from(matches).sort();
}

export function matchSkillsForTask(
  registry: RegistryEntry[],
  filePatterns: string[],
  changeType: string | null,
  title: string,
): string[] {
  const matches = new Set<string>();
  const titleLower = title.toLowerCase();
  for (const entry of registry) {
    if (entry.type !== "skill") continue;
    const fileMatch = entry.triggers.files.some((pattern) =>
      filePatterns.some((path) => minimatch(path, pattern)),
    );
    if (!fileMatch) continue;
    const secondSignal =
      (changeType && entry.triggers.change_types.includes(changeType)) ||
      entry.triggers.keywords.some((kw) =>
        titleLower.includes(kw.toLowerCase()),
      );
    if (secondSignal) {
      matches.add(entry.slug);
    }
  }
  return Array.from(matches).sort();
}
