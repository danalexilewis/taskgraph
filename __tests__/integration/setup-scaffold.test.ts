import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

describe("tg setup integration", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;

  beforeAll(async () => {
    context = await setupIntegrationTest();
  }, 60000);

  afterAll(() => {
    if (context) teardownIntegrationTest(context.tempDir);
  });

  it("should scaffold docs and cursor rules by default", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli("setup", context.tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("TaskGraph scaffold complete.");

    const expectedPaths = [
      "docs/backend.md",
      "docs/frontend.md",
      "docs/infra.md",
      "docs/skills/README.md",
      "docs/skills/taskgraph-lifecycle-execution.md",
      "docs/skills/plan-authoring.md",
      "docs/skills/refactoring-safely.md",
      ".cursor/memory.md",
      ".cursor/rules/session-start.mdc",
      ".cursor/rules/taskgraph-workflow.mdc",
      ".cursor/rules/plan-authoring.mdc",
      ".cursor/rules/memory.mdc",
      "AGENT.md",
    ];

    for (const p of expectedPaths) {
      expect(fs.existsSync(path.join(context.tempDir, p))).toBe(true);
    }
  });

  it("should skip existing files on a second run", async () => {
    if (!context) throw new Error("Context not initialized");

    const { exitCode, stdout } = await runTgCli("setup", context.tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Skipped (already exists):");
  });

  it("should overwrite files with --force", async () => {
    if (!context) throw new Error("Context not initialized");

    const markerPath = path.join(context.tempDir, "docs/backend.md");
    fs.appendFileSync(markerPath, "\nMARKER_LINE\n");
    expect(fs.readFileSync(markerPath, "utf8")).toContain("MARKER_LINE");

    const { exitCode } = await runTgCli("setup --force", context.tempDir);
    expect(exitCode).toBe(0);
    expect(fs.readFileSync(markerPath, "utf8")).not.toContain("MARKER_LINE");
  });
});
