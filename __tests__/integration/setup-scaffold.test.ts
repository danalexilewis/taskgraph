import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  runTgCliSubprocess,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("tg setup integration", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

  beforeAll(async () => {
    context = await setupIntegrationTest();
  }, 60000);

  afterAll(async () => {
    if (context) await teardownIntegrationTest(context);
  });

  it("should scaffold only docs by default (no .cursor)", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCliSubprocess(
      "setup",
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("TaskGraph scaffold complete.");
    expect(stdout).toContain("pnpm tg setup --cursor");

    const docsOnlyPaths = [
      "docs/backend.md",
      "docs/frontend.md",
      "docs/infra.md",
      "docs/skills/README.md",
      "docs/skills/taskgraph-lifecycle-execution.md",
      "docs/skills/plan-authoring.md",
      "docs/skills/refactoring-safely.md",
      "docs/leads/README.md",
      "docs/leads/execution.md",
      "docs/recommended-packages.md",
    ];
    for (const p of docsOnlyPaths) {
      expect(fs.existsSync(path.join(context.tempDir, p))).toBe(true);
    }
    // Minimal rule so the system knows how to use tg
    expect(
      fs.existsSync(path.join(context.tempDir, ".cursor/rules/tg-usage.mdc")),
    ).toBe(true);
    // Full .cursor and AGENT.md only with --cursor
    expect(fs.existsSync(path.join(context.tempDir, ".cursor/memory.md"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(context.tempDir, "AGENT.md"))).toBe(false);
  });

  it("should scaffold .cursor and AGENT.md when --cursor is passed", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCliSubprocess(
      "setup --cursor",
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("TaskGraph scaffold complete.");

    const cursorPaths = [
      ".cursor/rules/tg-usage.mdc",
      ".cursor/memory.md",
      ".cursor/agents/debugger.md",
      ".cursor/agents/documenter.md",
      ".cursor/agents/fixer.md",
      ".cursor/agents/investigator.md",
      ".cursor/rules/session-start.mdc",
      ".cursor/rules/taskgraph-workflow.mdc",
      ".cursor/rules/plan-authoring.mdc",
      ".cursor/rules/memory.mdc",
      ".cursor/rules/code-guidelines.mdc",
      ".cursor/rules/no-hard-deletes.mdc",
      ".cursor/rules/subagent-reports.mdc",
      ".cursor/skills/plan/SKILL.md",
      ".cursor/skills/work/SKILL.md",
      "AGENT.md",
    ];
    for (const p of cursorPaths) {
      expect(fs.existsSync(path.join(context.tempDir, p))).toBe(true);
    }
  });

  it("should skip existing files on a second run", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCliSubprocess(
      "setup",
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Skipped (already exists):");
  });

  it("should overwrite files with --force", async () => {
    if (!context) throw new Error("Context not initialized");

    const markerPath = path.join(context.tempDir, "docs/backend.md");
    fs.appendFileSync(markerPath, "\nMARKER_LINE\n");
    expect(fs.readFileSync(markerPath, "utf8")).toContain("MARKER_LINE");

    const { exitCode } = await runTgCliSubprocess(
      "setup --force",
      context.tempDir,
    );
    expect(exitCode).toBe(0);
    expect(fs.readFileSync(markerPath, "utf8")).not.toContain("MARKER_LINE");
  });
});
