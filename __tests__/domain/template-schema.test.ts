import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadAndSubstituteTemplate,
  substituteInValue,
  substituteVars,
} from "../../src/domain/template-schema";

describe("template-schema", () => {
  describe("substituteVars", () => {
    it("replaces {{key}} with vars value", () => {
      expect(substituteVars("Hello {{name}}", { name: "World" })).toBe(
        "Hello World",
      );
    });

    it("leaves unknown placeholders as-is", () => {
      expect(substituteVars("Hello {{name}}", { other: "x" })).toBe(
        "Hello {{name}}",
      );
    });

    it("replaces multiple occurrences", () => {
      expect(substituteVars("{{x}} and {{x}}", { x: "a" })).toBe("a and a");
    });

    it("handles empty vars", () => {
      expect(substituteVars("{{a}}", {})).toBe("{{a}}");
    });

    it("uses only word chars in placeholder names", () => {
      expect(
        substituteVars("{{key1}} {{key_2}}", {
          key1: "v1",
          key_2: "v2",
        }),
      ).toBe("v1 v2");
    });
  });

  describe("substituteInValue", () => {
    it("substitutes in string", () => {
      expect(substituteInValue("{{x}}", { x: "y" })).toBe("y");
    });

    it("recursively substitutes in array", () => {
      expect(substituteInValue(["{{a}}", "{{b}}"], { a: "1", b: "2" })).toEqual(
        ["1", "2"],
      );
    });

    it("recursively substitutes in object", () => {
      expect(
        substituteInValue(
          { name: "{{n}}", nested: { t: "{{n}}" } },
          { n: "Plan" },
        ),
      ).toEqual({ name: "Plan", nested: { t: "Plan" } });
    });

    it("leaves non-strings unchanged", () => {
      expect(substituteInValue(42, { x: "y" })).toBe(42);
      expect(substituteInValue(null, { x: "y" })).toBe(null);
    });
  });

  describe("loadAndSubstituteTemplate", () => {
    it("loads YAML and substitutes vars into ParsedPlan", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-template-"));
      const file = path.join(dir, "t.yaml");
      fs.writeFileSync(
        file,
        `
name: "{{planName}}"
overview: "Overview for {{feature}}."
todos:
  - id: task-1
    content: "Implement {{feature}}"
  - id: task-2
    content: "Test {{feature}}"
    blockedBy: [task-1]
`,
      );
      try {
        const result = loadAndSubstituteTemplate(file, {
          planName: "Auth Plan",
          feature: "Auth",
        });
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const plan = result.value;
          expect(plan.planTitle).toBe("Auth Plan");
          expect(plan.planIntent).toBe("Overview for Auth.");
          expect(plan.tasks).toHaveLength(2);
          expect(plan.tasks[0].title).toBe("Implement Auth");
          expect(plan.tasks[1].blockedBy).toEqual(["task-1"]);
        }
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("returns error for missing file", () => {
      const result = loadAndSubstituteTemplate(
        path.join(os.tmpdir(), "nonexistent-tg-template-12345.yaml"),
        {},
      );
      expect(result.isErr()).toBe(true);
    });

    it("returns error when todos is not an array", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-template-"));
      const file = path.join(dir, "bad.yaml");
      fs.writeFileSync(file, "name: only\ntodos: not-an-array\n");
      try {
        const result = loadAndSubstituteTemplate(file, {});
        expect(result.isErr()).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });
  });
});
