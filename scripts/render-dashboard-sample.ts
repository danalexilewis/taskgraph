/**
 * One-off script to render dashboard output with mock data for layout review.
 * Run: pnpm build && node -e "require('./dist/cli/status.js').then(m => ...)" or use tsx.
 * We require from dist so we only need formatStatusAsString.
 */

import * as fs from "node:fs";
import { formatStatusAsString, type StatusData } from "../src/cli/status";

const mockData: StatusData = {
  completedPlans: 12,
  completedTasks: 89,
  canceledTasks: 2,
  activePlans: [
    {
      plan_id: "p1",
      title: "Dashboard polish",
      todo: 2,
      doing: 1,
      blocked: 0,
      done: 5,
      actionable: 1,
    },
    {
      plan_id: "p2",
      title: "Agent sync improvements",
      todo: 0,
      doing: 0,
      blocked: 0,
      done: 8,
      actionable: 0,
    },
    {
      plan_id: "p3",
      title: "Status dashboard focused views",
      todo: 3,
      doing: 0,
      blocked: 1,
      done: 4,
      actionable: 2,
    },
  ],
  staleTasks: [],
  staleDoingTasks: [
    {
      hash_id: "tg-abc12",
      title: "Add side-by-side layout for Active Plans and Stale",
      owner: "implementer",
      age_hours: 3,
    },
  ],
  nextTasks: [
    {
      task_id: "t1",
      hash_id: "tg-xyz99",
      title: "Run gate:full and fix any failures",
      plan_title: "Dashboard polish",
    },
    {
      task_id: "t2",
      hash_id: null,
      title: "Update docs for minimal redraw",
      plan_title: "Dashboard polish",
    },
  ],
  next7RunnableTasks: [],
  last7CompletedTasks: [],
  next7UpcomingPlans: [],
  last7CompletedPlans: [],
  activeWork: [
    {
      task_id: "t0",
      hash_id: "tg-def45",
      title: "Improve data refresh (no full redraw)",
      plan_title: "Dashboard polish",
      body: { agent: "implementer" },
      created_at: null,
    },
  ],
  plansCount: 15,
  statusCounts: { todo: 5, doing: 1, blocked: 1, done: 90, canceled: 2 },
  actionableCount: 3,
  currentCycle: {
    name: "Sprint 1",
    start_date: "2026-03-01",
    end_date: "2026-03-14",
    initiative_count: 2,
  },
};

const width = 100;
const out = formatStatusAsString(mockData, width, { dashboard: true });
const path = "scripts/dashboard-sample-output.txt";
fs.writeFileSync(path, out, "utf8");
console.log("Wrote", path);
console.log("\n--- Rendered output ---\n");
console.log(out);
