/**
 * Integration tests: SDK (TgClient) and CLI --json produce the same output shapes
 * for next, context, and status.
 * Requires Bun (describe.serial).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type ContextResult,
  type NextTaskRow,
  type StatusResult,
  TgClient,
} from "../../src/api";
import {
  runTgCli,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

const NEXT_KEYS: (keyof NextTaskRow)[] = [
  "task_id",
  "hash_id",
  "title",
  "plan_title",
  "risk",
  "estimate_mins",
];

const CONTEXT_KEYS: (keyof ContextResult)[] = [
  "task_id",
  "title",
  "agent",
  "plan_name",
  "plan_overview",
  "docs",
  "skills",
  "change_type",
  "suggested_changes",
  "file_tree",
  "risks",
  "doc_paths",
  "skill_docs",
  "immediate_blockers",
  "token_estimate",
];

const STATUS_KEYS: (keyof StatusResult)[] = [
  "completedPlans",
  "completedTasks",
  "canceledTasks",
  "activePlans",
  "staleTasks",
  "stale_tasks",
  "plansCount",
  "statusCounts",
  "actionableCount",
  "nextTasks",
  "next7RunnableTasks",
  "last7CompletedTasks",
  "next7UpcomingPlans",
  "last7CompletedPlans",
  "activeWork",
  "agentCount",
  "subAgentRuns",
  "totalAgentHours",
  "investigatorRuns",
  "investigatorFixRate",
  "subAgentTypesDefined",
  "summary",
];

function sameKeys<T extends Record<string, unknown>>(
  expected: (keyof T)[],
  obj: Record<string, unknown>,
): boolean {
  const actual = Object.keys(obj).sort();
  const expectedSet = new Set(expected as string[]);
  if (actual.length !== expectedSet.size) return false;
  for (const k of actual) {
    if (!expectedSet.has(k)) return false;
  }
  return true;
}

describe.serial("SDK vs CLI --json parity", () => {
  let context: Awaited<ReturnType<typeof setupIntegrationTest>> | undefined;
  let planId: string;
  let taskId: string;

  beforeAll(async () => {
    context = await setupIntegrationTest();
    if (!context) throw new Error("setup failed");

    const plansDir = path.join(context.tempDir, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const planContent = `---
name: SDK Parity Plan
overview: Plan for SDK vs CLI shape parity tests.
todos:
  - id: parity-1
    content: "Parity task 1"
    status: pending
  - id: parity-2
    content: "Parity task 2"
    status: pending
---
`;
    fs.writeFileSync(path.join(plansDir, "sdk-parity.md"), planContent);

    const { stdout: importOut } = await runTgCli(
      `import plans/sdk-parity.md --plan "SDK Parity Plan" --format cursor --no-commit`,
      context.tempDir,
    );
    expect(importOut).toContain("Successfully imported");

    const { stdout: listOut } = await runTgCli(
      `plan list --json`,
      context.tempDir,
    );
    const plans = JSON.parse(listOut) as Array<{
      plan_id: string;
      title: string;
    }>;
    const plan = plans.find((p) => p.title === "SDK Parity Plan");
    expect(plan).toBeDefined();
    planId = plan?.plan_id ?? "";

    const { stdout: nextOut } = await runTgCli(
      `next --plan ${planId} --limit 5 --json`,
      context.tempDir,
    );
    const nextTasks = JSON.parse(nextOut) as NextTaskRow[];
    const first = nextTasks.find((t) => t.title === "Parity task 1");
    expect(first).toBeDefined();
    taskId = first?.task_id ?? "";
  }, 60000);

  afterAll(async () => {
    if (context) await teardownIntegrationTest(context);
  }, 60_000);

  it("next: SDK and CLI --json produce same shape", async () => {
    const { stdout: cliOut } = await runTgCli(
      `next --plan ${planId} --limit 5 --json`,
      context?.tempDir,
    );
    const cliArr = JSON.parse(cliOut) as NextTaskRow[];

    const client = new TgClient({ doltRepoPath: context?.doltRepoPath });
    const sdkResult = await client.next({ plan: planId, limit: 5 });
    expect(sdkResult.isOk()).toBe(true);
    const sdkArr = sdkResult.isOk() ? sdkResult.value : [];

    expect(Array.isArray(cliArr)).toBe(true);
    expect(Array.isArray(sdkArr)).toBe(true);
    expect(sdkArr.length).toBe(cliArr.length);

    for (let i = 0; i < sdkArr.length; i++) {
      expect(
        sameKeys(NEXT_KEYS, sdkArr[i] as unknown as Record<string, unknown>),
      ).toBe(true);
      expect(
        sameKeys(NEXT_KEYS, cliArr[i] as unknown as Record<string, unknown>),
      ).toBe(true);
      for (const k of NEXT_KEYS) {
        expect((sdkArr[i] as Record<string, unknown>)[k]).toEqual(
          (cliArr[i] as Record<string, unknown>)[k],
        );
      }
    }
  });

  it("context: SDK and CLI --json produce same shape", async () => {
    const { stdout: cliOut } = await runTgCli(
      `context ${taskId} --json`,
      context?.tempDir,
    );
    const cliObj = JSON.parse(cliOut) as ContextResult;

    const client = new TgClient({ doltRepoPath: context?.doltRepoPath });
    const sdkResult = await client.context(taskId);
    expect(sdkResult.isOk()).toBe(true);
    const sdkObj = sdkResult.isOk() ? sdkResult.value : ({} as ContextResult);

    expect(
      sameKeys(CONTEXT_KEYS, sdkObj as unknown as Record<string, unknown>),
    ).toBe(true);
    expect(
      sameKeys(CONTEXT_KEYS, cliObj as unknown as Record<string, unknown>),
    ).toBe(true);
    for (const k of CONTEXT_KEYS) {
      const s = (sdkObj as Record<string, unknown>)[k];
      const c = (cliObj as Record<string, unknown>)[k];
      if (k === "immediate_blockers" && Array.isArray(s) && Array.isArray(c)) {
        expect(s.length).toBe(c.length);
        for (let i = 0; i < s.length; i++) {
          expect((s[i] as Record<string, unknown>).task_id).toEqual(
            (c[i] as Record<string, unknown>).task_id,
          );
          expect((s[i] as Record<string, unknown>).title).toEqual(
            (c[i] as Record<string, unknown>).title,
          );
          expect((s[i] as Record<string, unknown>).status).toEqual(
            (c[i] as Record<string, unknown>).status,
          );
        }
      } else {
        expect(s).toEqual(c);
      }
    }
  });

  it("status: SDK and CLI --json produce same shape", async () => {
    const { stdout: cliOut } = await runTgCli(
      `status --json`,
      context?.tempDir,
    );
    const cliObj = JSON.parse(cliOut) as StatusResult;

    const client = new TgClient({ doltRepoPath: context?.doltRepoPath });
    const sdkResult = await client.status();
    expect(sdkResult.isOk()).toBe(true);
    const sdkObj = sdkResult.isOk() ? sdkResult.value : ({} as StatusResult);

    expect(
      sameKeys(STATUS_KEYS, sdkObj as unknown as Record<string, unknown>),
    ).toBe(true);
    expect(
      sameKeys(STATUS_KEYS, cliObj as unknown as Record<string, unknown>),
    ).toBe(true);
    for (const k of STATUS_KEYS) {
      expect((sdkObj as Record<string, unknown>)[k]).toEqual(
        (cliObj as Record<string, unknown>)[k],
      );
    }
  });
});
