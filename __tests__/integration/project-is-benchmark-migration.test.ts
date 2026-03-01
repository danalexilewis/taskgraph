import { setupIntegrationTest, teardownIntegrationTest } from "./test-utils";
import { execa } from "execa";

describe("Project is_benchmark migration", () => {
  test("adds is_benchmark column to project table", async () => {
    const context = await setupIntegrationTest();
    try {
      const { doltRepoPath } = context;
      const result = await execa(
        "dolt",
        ["--data-dir", doltRepoPath, "sql", "-q",
         "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='project' AND COLUMN_NAME='is_benchmark';"],
        { env: process.env }
      );
      const count = Number(result.stdout.trim());
      expect(count).toBe(1);
    } finally {
      await teardownIntegrationTest(context);
    }
  });
});
