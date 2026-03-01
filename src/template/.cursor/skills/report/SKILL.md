---
name: report
description: Write a structured report from the immediate conversation context — research findings, investigation results, review conclusions, benchmarks, or analysis. Use when the user says "report", "write it up", "capture this", or when a skill or sub-agent has produced findings that should be persisted to reports/.
---

# Report

**Type:** Utility skill (procedural, no agentic lead or sub-agents).

## When to use

- After an investigation, review, risk assessment, research, or analysis that produced findings worth persisting.
- When the user says `/report`, "write a report", "capture this", "write it up".
- When a sub-agent returns structured findings that should be saved beyond the chat.

## Workflow

### 1. Identify the source material

Scan the **immediate conversation context** — the current chat, not external files. The report captures what was just discussed, analyzed, or discovered. Sources include:

- Sub-agent reports (investigator, reviewer, scanner findings)
- Research synthesis (web search results, reference project analysis)
- Risk assessments or review conclusions
- Benchmark data or test results
- Any structured analysis produced in this session

### 2. Determine report type

| Context                   | Report type              | Sections                                                                                                       |
| ------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Investigation / debugging | **Investigation report** | Scope, Files examined, Root cause analysis, Hypothesis evidence, Gaps found, Recommendations                   |
| Review / health check     | **Review report**        | Scope, Current state, Findings (by area), Risk summary, Recommendations                                        |
| Risk assessment           | **Risk report**          | Scope, Per-scope analysis (metrics table), Cross-plan interactions, Mitigation strategies, Prioritized summary |
| Benchmarks / performance  | **Benchmark report**     | Scope, Benchmark summary (table), Why it's slow/fast, Infrastructure state, Recommendations                    |
| Research / ecosystem      | **Research report**      | Scope, Per-project/pattern findings, Gap analysis, Recommendations (ranked by impact/effort)                   |
| General analysis          | **Analysis report**      | Scope, Findings, Implications, Recommendations                                                                 |

### 3. Write the report

**File path:** `reports/<topic>-<YYYY-MM-DD>.md`

**Structure:**

```markdown
# <Title>

**Date:** YYYY-MM-DD
**Scope:** One-line description of what was analyzed and why.
**Produced by:** Who/what generated the findings (e.g. "Investigator sub-agent", "Research skill", "Orchestrator analysis").

---

## <Sections per report type>

(Body — see section guidance below)

---

## Summary

(2-4 sentence synthesis of the key takeaway)
```

**Section rules:**

- **Tables over prose** for structured data (metrics, benchmarks, file lists, comparisons).
- **Evidence over opinion** — cite specific files, line numbers, counts, measurements. "237,419 files in eventsData" not "a lot of files".
- **Ranked recommendations** — every report ends with actionable next steps, ordered by impact or priority.
- **Sub-agent reports verbatim** — if a sub-agent produced structured findings, include them as-is per the subagent-reports rule. Add orchestrator commentary only when it adds new information.

### 4. Present to user

After writing the file, tell the user:

- Where the report was saved
- A 2-3 sentence summary of the key finding
- Whether the findings suggest a follow-up action (plan, investigation, fix)

Do NOT re-summarize the full report in chat — the file is the artifact.

## Constraints

- **Read-only skill** — the report captures findings; it does not execute changes.
- **No sub-agents** — the orchestrator writes the report directly from conversation context.
- **No fabrication** — only include information that appeared in the current session. If data is missing, note the gap rather than filling it.
- **Depth matches content** — a quick investigation gets a 30-line report. A multi-hour research session gets a 150-line report. Don't pad.
