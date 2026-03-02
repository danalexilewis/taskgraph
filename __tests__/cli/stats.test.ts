import { Command } from "commander";
import execa from "execa";
import { statsCommand } from "../../src/cli/stats";

describe("stats command", () => {
  it("includes --benchmark option in help", async () => {
    const { stdout } = await execa("node", [
      "dist/cli/index.js",
      "stats",
      "--help",
    ]);
    expect(stdout).toContain("--benchmark");
  });

  it("stats command has --benchmark option registered", () => {
    const program = new Command();
    statsCommand(program);
    const statsCmd = program.commands.find((c) => c.name() === "stats");
    expect(statsCmd).toBeDefined();
    const hasBenchmark = statsCmd?.options.some(
      (opt) => opt.long === "--benchmark",
    );
    expect(hasBenchmark).toBe(true);
  });

  it("help description for --benchmark describes filtering", async () => {
    const { stdout } = await execa("node", [
      "dist/cli/index.js",
      "stats",
      "--help",
    ]);
    expect(stdout).toContain("Filter benchmark projects");
  });

  it("stats command has both --benchmark and --timeline options", () => {
    const program = new Command();
    statsCommand(program);
    const statsCmd = program.commands.find((c) => c.name() === "stats");
    expect(statsCmd).toBeDefined();
    const hasTimeline = statsCmd?.options.some(
      (opt) => opt.long === "--timeline",
    );
    const hasBenchmark = statsCmd?.options.some(
      (opt) => opt.long === "--benchmark",
    );
    expect(hasTimeline).toBe(true);
    expect(hasBenchmark).toBe(true);
  });

  it("stats command has both --benchmark and --plan options", () => {
    const program = new Command();
    statsCommand(program);
    const statsCmd = program.commands.find((c) => c.name() === "stats");
    expect(statsCmd).toBeDefined();
    const hasPlan = statsCmd?.options.some((opt) => opt.long === "--plan");
    const hasBenchmark = statsCmd?.options.some(
      (opt) => opt.long === "--benchmark",
    );
    expect(hasPlan).toBe(true);
    expect(hasBenchmark).toBe(true);
  });
});
