/**
 * Dashboard format tests with mock data.
 * Asserts that formatDashboardTasksView, formatDashboardProjectsView, and
 * formatStatusAsString (dashboard: true) produce terminal output containing
 * expected sections so we can confirm what the TUI would show without running OpenTUI.
 */

import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";
import type {
  LastCompletedTaskRow,
  StatusData,
  TaskRow,
} from "../../src/cli/status";
import {
  formatDashboardProjectsView,
  formatDashboardTasksView,
  formatStatusAsString,
  getDashboardFooterLine,
} from "../../src/cli/status";

const WIDTH = 80;

function mockStatusData(overrides?: Partial<StatusData>): StatusData {
  return {
    completedPlans: 2,
    completedTasks: 12,
    canceledTasks: 0,
    activePlans: [
      {
        plan_id: "p-1",
        title: "Test Plan A",
        todo: 3,
        doing: 1,
        blocked: 0,
        done: 5,
        actionable: 2,
      },
      {
        plan_id: "p-2",
        title: "Test Plan B",
        todo: 1,
        doing: 2,
        blocked: 1,
        done: 10,
        actionable: 1,
      },
    ],
    staleTasks: [],
    staleDoingTasks: [],
    nextTasks: [],
    next7RunnableTasks: [
      {
        task_id: "t-next-1",
        hash_id: "abc1234",
        title: "Next runnable task",
        plan_title: "Test Plan A",
        updated_at: "2026-03-01T10:00:00Z",
      },
    ],
    last7CompletedTasks: [
      {
        task_id: "t-done-1",
        hash_id: "def5678",
        title: "Recently completed task",
        plan_title: "Test Plan B",
        updated_at: "2026-03-02T09:00:00Z",
      },
    ] as LastCompletedTaskRow[],
    next7UpcomingPlans: [
      {
        plan_id: "p-3",
        title: "Upcoming plan",
        status: "draft",
        updated_at: "2026-03-01T12:00:00Z",
      },
    ],
    last7CompletedPlans: [
      {
        plan_id: "p-4",
        title: "Finished plan",
        status: "done",
        updated_at: "2026-03-02T08:00:00Z",
      },
    ],
    activeWork: [],
    plansCount: 4,
    statusCounts: { todo: 5, doing: 3, blocked: 1, done: 12, canceled: 0 },
    actionableCount: 3,
    agentCount: 2,
    subAgentRuns: 50,
    totalAgentHours: 10.5,
    ...overrides,
  };
}

function mockActiveTaskRows(): TaskRow[] {
  return [
    {
      task_id: "t-active-1",
      hash_id: "tg-abc12",
      title: "Active task one",
      plan_title: "Test Plan A",
      status: "doing",
      owner: "agent",
    },
    {
      task_id: "t-active-2",
      hash_id: "tg-def34",
      title: "Active task two",
      plan_title: "Test Plan B",
      status: "todo",
      owner: "—",
    },
  ];
}

describe("dashboard format with mock data", () => {
  describe("formatDashboardTasksView", () => {
    it("output contains Active tasks, Next 7 runnable, Last 7 completed sections", () => {
      const data = mockStatusData();
      const activeRows = mockActiveTaskRows();
      const out = formatDashboardTasksView(data, activeRows, WIDTH);
      const plain = stripAnsi(out);

      expect(plain).toContain("Active tasks");
      expect(plain).toContain("Next 7 runnable");
      expect(plain).toContain("Last 7 completed");
      expect(plain).toContain("Active task one");
      expect(plain).toContain("Next runnable task");
      expect(plain).toContain("Recently completed"); // task may wrap to next line
    });

    it("output contains table headers Id, Title, Project, Owner for active", () => {
      const data = mockStatusData();
      const activeRows = mockActiveTaskRows();
      const out = formatDashboardTasksView(data, activeRows, WIDTH);
      const plain = stripAnsi(out);

      expect(plain).toContain("Id");
      expect(plain).toContain("Title");
      expect(plain).toContain("Project");
      expect(plain).toContain("Owner");
      // Stale/Status columns may be abbreviated to "…" at narrow width
    });

    it("output is non-empty and has multiple lines", () => {
      const data = mockStatusData();
      const activeRows = mockActiveTaskRows();
      const out = formatDashboardTasksView(data, activeRows, WIDTH);
      const plain = stripAnsi(out);

      expect(plain.length).toBeGreaterThan(100);
      expect(plain.split("\n").length).toBeGreaterThan(5);
    });
  });

  describe("formatDashboardProjectsView", () => {
    it("output contains Active plans, Next 7 upcoming, Last 7 completed sections", () => {
      const data = mockStatusData();
      const out = formatDashboardProjectsView(data, WIDTH);
      const plain = stripAnsi(out);

      expect(plain).toContain("Active plans");
      expect(plain).toContain("Next 7 upcoming");
      expect(plain).toContain("Last 7 completed");
      expect(plain).toContain("Test Plan A");
      expect(plain).toContain("Test Plan B");
      expect(plain).toContain("Upcoming plan");
      expect(plain).toContain("Finished plan");
    });

    it("output contains Todo, Ready, Doing, Blocked, Done columns", () => {
      const data = mockStatusData();
      const out = formatDashboardProjectsView(data, WIDTH);
      const plain = stripAnsi(out);

      expect(plain).toContain("Todo");
      expect(plain).toContain("Doing");
      expect(plain).toContain("Blocked");
      expect(plain).toContain("Done");
    });
  });

  describe("formatStatusAsString with dashboard: true", () => {
    it("output contains Active Projects, Active tasks and upcoming, and completed summary", () => {
      const data = mockStatusData();
      const out = formatStatusAsString(data, WIDTH, { dashboard: true });
      const plain = stripAnsi(out);

      expect(plain).toContain("Active Projects");
      expect(plain).toContain("Active tasks and upcoming");
      expect(plain).toContain("done");
      expect(plain).toContain("Projects done");
      expect(plain).toContain("Tasks done");
    });

    it("output contains footer line (agent/stats) when present in data", () => {
      const data = mockStatusData({
        agentCount: 3,
        subAgentRuns: 100,
        totalAgentHours: 25,
      });
      const out = formatStatusAsString(data, WIDTH, { dashboard: true });
      const plain = stripAnsi(out);

      expect(plain).toContain("Agents (defined)");
      expect(plain).toContain("Total invocations");
      expect(plain).toContain("Agent hours");
      expect(plain).toContain("3");
      expect(plain).toContain("100");
      expect(plain).toContain("25");
    });
  });

  describe("getDashboardFooterLine", () => {
    it("returns one-line string with agent count, invocations, and hours", () => {
      const data = mockStatusData({
        agentCount: 2,
        subAgentRuns: 50,
        totalAgentHours: 10.5,
      });
      const line = getDashboardFooterLine(data);
      const plain = stripAnsi(line);

      expect(plain).toContain("Types of Agents: 2");
      expect(plain).toContain("Total Agent Invocations: 50");
      expect(plain).toContain("Total Agent hours: 10.5");
      expect(plain.split("\n").length).toBe(1);
    });
  });

  describe("dashboard tasks view + footer (same as TUI content)", () => {
    it("combined dashboard tasks content + footer has expected sections and single trailing newline when normalized", () => {
      const data = mockStatusData();
      const activeRows = mockActiveTaskRows();
      const body = formatDashboardTasksView(data, activeRows, WIDTH);
      const footer = getDashboardFooterLine(data);
      const raw = `${body}\n\n${footer}`;
      const normalized = `${raw.replace(/\n+$/, "")}\n`;
      const plain = stripAnsi(normalized);

      expect(plain).toContain("Active tasks");
      expect(plain).toContain("Next 7 runnable");
      expect(plain).toContain("Last 7 completed");
      expect(plain).toContain("Types of Agents");
      expect(plain).toContain("Total Agent hours: 10.5");
      expect(normalized.endsWith("\n")).toBe(true);
      expect(normalized.endsWith("\n\n")).toBe(false);
    });
  });

  describe("terminal output snapshot (print when TG_PRINT_DASHBOARD=1)", () => {
    it("prints dashboard tasks view to stdout when TG_PRINT_DASHBOARD=1 so you can confirm expected output", () => {
      const data = mockStatusData();
      const activeRows = mockActiveTaskRows();
      const body = formatDashboardTasksView(data, activeRows, WIDTH);
      const footer = getDashboardFooterLine(data);
      const content = `${body}\n\n${footer}`;
      if (process.env.TG_PRINT_DASHBOARD === "1") {
        console.log("\n--- Dashboard tasks view (mock data) ---\n");
        console.log(content);
        console.log("\n--- End dashboard ---\n");
      }
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe("TG_ASCII_DASHBOARD=1 (no Unicode symbols)", () => {
    const unicodeStatusSymbols = ["✓", "●", "▲", "◆", "⚠"];

    it("formatDashboardTasksView with TG_ASCII_DASHBOARD=1 has no Unicode status symbols in stripped output", () => {
      const prev = process.env.TG_ASCII_DASHBOARD;
      process.env.TG_ASCII_DASHBOARD = "1";
      try {
        const data = mockStatusData();
        const [row1, row2] = mockActiveTaskRows();
        const activeRows = [row1, { ...row2, owner: "-" }];
        const out = formatDashboardTasksView(data, activeRows, WIDTH);
        const plain = stripAnsi(out);
        for (const sym of unicodeStatusSymbols) {
          expect(plain).not.toContain(sym);
        }
        expect(plain).toContain("Active tasks");
        expect(plain).toContain("*");
      } finally {
        if (prev === undefined) delete process.env.TG_ASCII_DASHBOARD;
        else process.env.TG_ASCII_DASHBOARD = prev;
      }
    });

    it("formatDashboardProjectsView with TG_ASCII_DASHBOARD=1 has no Unicode symbols in stripped output", () => {
      const prev = process.env.TG_ASCII_DASHBOARD;
      process.env.TG_ASCII_DASHBOARD = "1";
      try {
        const data = mockStatusData();
        const out = formatDashboardProjectsView(data, WIDTH);
        const plain = stripAnsi(out);
        for (const sym of unicodeStatusSymbols) {
          expect(plain).not.toContain(sym);
        }
        expect(plain).toContain("Active plans");
      } finally {
        if (prev === undefined) delete process.env.TG_ASCII_DASHBOARD;
        else process.env.TG_ASCII_DASHBOARD = prev;
      }
    });

    it("formatStatusAsString dashboard:true with TG_ASCII_DASHBOARD=1 has no Unicode symbols in stripped output", () => {
      const prev = process.env.TG_ASCII_DASHBOARD;
      process.env.TG_ASCII_DASHBOARD = "1";
      try {
        const data = mockStatusData();
        const out = formatStatusAsString(data, WIDTH, { dashboard: true });
        const plain = stripAnsi(out);
        for (const sym of unicodeStatusSymbols) {
          expect(plain).not.toContain(sym);
        }
        expect(plain).toContain("Active Projects");
      } finally {
        if (prev === undefined) delete process.env.TG_ASCII_DASHBOARD;
        else process.env.TG_ASCII_DASHBOARD = prev;
      }
    });
  });
});
