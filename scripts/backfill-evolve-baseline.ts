/**
 * One-off script: parse recent evolve reports in reports/*evolve*.md and write
 * a baseline metrics JSON for Evolve v2 P1. Metrics are derived from the
 * structured report sections: Findings (table rows), Learnings written, Durable patterns.
 *
 * Usage: bun run scripts/backfill-evolve-baseline.ts
 * Output: reports/evolve-baseline-metrics.json
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPORTS_DIR = path.join(process.cwd(), "reports");
const BASELINE_OUT = path.join(process.cwd(), "reports", "evolve-baseline-metrics.json");

interface EvolveReportMetrics {
  report_file: string;
  date: string;
  findings_count: number;
  learnings_entries_count: number;
  durable_patterns_noted: boolean;
  severity_breakdown?: { critical?: number; high?: number; medium?: number; low?: number };
}

function extractDate(content: string, filename: string): string {
  const dateLine = content.match(/\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/);
  if (dateLine) return dateLine[1];
  const fromName = filename.match(/(\d{2})-(\d{2})-(\d{2})_/);
  if (fromName)
    return `20${fromName[1]}-${fromName[2]}-${fromName[3]}`;
  return "";
}

function countFindings(content: string): number {
  const inventoryMatch = content.match(/Anti-pattern inventory\s*\((\d+)\s*closed\)/i);
  if (inventoryMatch) return Number(inventoryMatch[1]);

  const findingsSection = content.match(/## Findings\s*([\s\S]*?)(?=^\s*##\s+\S|$)/m);
  if (!findingsSection) return 0;
  const section = findingsSection[1];
  const lines = section.split("\n").filter((l) => /^\|.+\|/.test(l.trim()));
  const dataRows = lines.filter((l) => !l.trim().match(/^\|---/));
  return dataRows.length;
}

function countLearnings(content: string): number {
  const learningsSection = content.match(/## Learnings written\s*([\s\S]*?)(?=^\s*##\s+\S|$)/m);
  if (!learningsSection) return 0;
  const section = learningsSection[1];
  let total = 0;
  const entryMatches = section.matchAll(/(\d+)\s*entr(?:y|ies)\s*(?:added)?/gi);
  for (const m of entryMatches) total += Number(m[1]);
  if (total > 0) return total;
  const bullets = section.match(/^-\s+/gm);
  return bullets ? bullets.length : 0;
}

function hasDurablePatterns(content: string): boolean {
  const section = content.match(/## Durable patterns[\s\S]*?(?=^\s*##\s+\S|$)/m);
  if (!section) return false;
  const body = section[0].replace(/## Durable patterns\s*/i, "").trim();
  return body.length > 0 && !/^[-*]\s*\(none\)\s*$/im.test(body);
}

function extractSeverityBreakdown(content: string): EvolveReportMetrics["severity_breakdown"] {
  const section = content.match(/## Findings[\s\S]*?(?=^\s*##\s+\S|$)/m);
  if (!section) return undefined;
  const text = section[0];
  const critical = (text.match(/\|\s*CRITICAL\s*\|/gi) || []).length;
  const high = (text.match(/\|\s*HIGH\s*\|/gi) || []).length;
  const medium = (text.match(/\|\s*MEDIUM\s*\|/gi) || []).length;
  const low = (text.match(/\|\s*LOW\s*\|/gi) || []).length;
  if (critical + high + medium + low === 0) return undefined;
  return { critical, high, medium, low };
}

function main(): void {
  const files = fs.readdirSync(REPORTS_DIR).filter((f) => f.includes("evolve") && f.endsWith(".md"));
  const metrics: EvolveReportMetrics[] = [];

  for (const file of files.sort()) {
    const filePath = path.join(REPORTS_DIR, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const date = extractDate(content, file);
    const findings_count = countFindings(content);
    const learnings_entries_count = countLearnings(content);
    const durable_patterns_noted = hasDurablePatterns(content);
    const severity_breakdown = extractSeverityBreakdown(content);

    metrics.push({
      report_file: file,
      date,
      findings_count,
      learnings_entries_count,
      durable_patterns_noted,
      ...(severity_breakdown && { severity_breakdown }),
    });
  }

  const baseline = {
    generated_at: new Date().toISOString(),
    source: "reports/*evolve*.md",
    purpose: "Baseline for Evolve v2 P1 — run-quality metrics from structured report sections",
    reports: metrics,
    totals: {
      reports_count: metrics.length,
      findings_total: metrics.reduce((s, r) => s + r.findings_count, 0),
      learnings_total: metrics.reduce((s, r) => s + r.learnings_entries_count, 0),
    },
  };

  fs.mkdirSync(path.dirname(BASELINE_OUT), { recursive: true });
  fs.writeFileSync(BASELINE_OUT, JSON.stringify(baseline, null, 2), "utf-8");
  console.log(`Wrote ${BASELINE_OUT} (${metrics.length} reports)`);
}

main();
