import { describe, expect, it } from "bun:test";
import { formatCauseForCLI } from "../../src/cli/utils";

describe("formatCauseForCLI", () => {
  it("formats Error cause as one short line (message only, no stack)", () => {
    const err = new Error("Worktrunk worktree create failed");
    expect(formatCauseForCLI(err)).toBe(" Cause: Worktrunk worktree create failed");
  });

  it("formats non-Error cause with String()", () => {
    expect(formatCauseForCLI("ENOENT: no such file")).toBe(
      " Cause: ENOENT: no such file",
    );
  });

  it("handles Error with empty message", () => {
    const err = new Error("");
    expect(formatCauseForCLI(err)).toBe(" Cause: ");
  });
});
