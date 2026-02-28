import { beforeAll, describe, expect, it } from "vitest";
import {
  loadRegistry,
  matchDocsForTask,
  matchSkillsForTask,
  type RegistryEntry,
} from "../../src/domain/doc-skill-registry";

const REPO_ROOT = process.cwd();

describe("doc-skill-registry", () => {
  describe("loadRegistry", () => {
    it("reads trigger frontmatter from real docs/skills/ files", () => {
      const result = loadRegistry(REPO_ROOT);
      expect(result.isOk()).toBe(true);
      const entries = result._unsafeUnwrap();
      expect(entries.length).toBeGreaterThan(0);
      const docs = entries.filter((e) => e.type === "doc");
      const skills = entries.filter((e) => e.type === "skill");
      expect(docs.length).toBeGreaterThan(0);
      expect(skills.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.slug).toBeTruthy();
        expect(entry.type).toBe(entry.type === "doc" ? "doc" : "skill");
        expect(entry.triggers).toBeDefined();
        expect(Array.isArray(entry.triggers.files)).toBe(true);
        expect(Array.isArray(entry.triggers.change_types)).toBe(true);
        expect(Array.isArray(entry.triggers.keywords)).toBe(true);
      }
    });
  });

  describe("matchDocsForTask", () => {
    let registry: RegistryEntry[];

    beforeAll(() => {
      const result = loadRegistry(REPO_ROOT);
      if (!result.isOk()) throw new Error("loadRegistry failed");
      registry = result.value;
    });

    it("returns cli-reference and cli for file pattern src/cli/status.ts", () => {
      const slugs = matchDocsForTask(
        registry,
        ["src/cli/status.ts"],
        "modify",
        "Update status command",
      );
      expect(slugs).toContain("cli-reference");
      expect(slugs).toContain("cli");
      expect(slugs).toEqual([...slugs].sort());
    });

    it("returns empty array when no match", () => {
      const slugs = matchDocsForTask(
        registry,
        ["some/unmatched/path.ts"],
        null,
        "Anything",
      );
      expect(slugs).toEqual([]);
    });
  });

  describe("matchSkillsForTask", () => {
    let registry: RegistryEntry[];

    beforeAll(() => {
      const result = loadRegistry(REPO_ROOT);
      if (!result.isOk()) throw new Error("loadRegistry failed");
      registry = result.value;
    });

    it("returns cli-command-implementation for src/cli/foo.ts with changeType create", () => {
      const slugs = matchSkillsForTask(
        registry,
        ["src/cli/foo.ts"],
        "create",
        "Add foo command",
      );
      expect(slugs).toContain("cli-command-implementation");
    });

    it("returns integration-testing for __tests__/integration/foo.test.ts", () => {
      const slugs = matchSkillsForTask(
        registry,
        ["__tests__/integration/foo.test.ts"],
        "create",
        "Add integration test",
      );
      expect(slugs).toContain("integration-testing");
    });

    it("matches dolt-schema-migration by keyword when title contains migration and column", () => {
      const slugs = matchSkillsForTask(
        registry,
        ["src/db/migrate.ts"],
        null,
        "Add migration for new column",
      );
      expect(slugs).toContain("dolt-schema-migration");
    });

    it("returns empty array when no match", () => {
      const slugs = matchSkillsForTask(
        registry,
        ["some/unmatched/path.ts"],
        null,
        "Anything",
      );
      expect(slugs).toEqual([]);
    });
  });

  describe("registry only suggests", () => {
    it("manual doc/skill assignment is independent; registry suggests slugs only", () => {
      const result = loadRegistry(REPO_ROOT);
      expect(result.isOk()).toBe(true);
      const registry = result._unsafeUnwrap();
      const noFileMatch = matchDocsForTask(registry, [], null, "Some title");
      const noFileMatchSkills = matchSkillsForTask(
        registry,
        [],
        null,
        "Some title",
      );
      expect(noFileMatch).toEqual([]);
      expect(noFileMatchSkills).toEqual([]);
      // Calling again yields same result (no mutation)
      expect(matchDocsForTask(registry, [], null, "Some title")).toEqual([]);
    });
  });
});
