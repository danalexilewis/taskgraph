---
name: assess-risk
description: Assess the risk profile of code changes or proposed features using the project's risk model (Greg's framework). Use when evaluating a feature proposal, reviewing implementation plans, or when the user asks about risk, impact, or safety of changes.
---

# Assess Risk

This skill is **read-only**: it uses task-graph data (and optionally `tg crossplan summary --json` when available) and reads plan files. It does not modify the database or write any data.

## When to use

- User says "assess risk", "run risk assessment", or asks about risk/impact/safety of changes.
- Before committing to multi-plan execution.
- When evaluating a feature proposal or reviewing implementation plans.

## Workflow

1. **Gather scope data**  
   If `tg crossplan summary --json` is available, run it to get plans, tasks, domains, skills, file overlaps, and proposed edges.  
   If the crossplan command is not yet available, use `tg status --tasks`, `tg next --plan <planId> --json`, and plan files under `plans/` to infer scope (active plans, tasks per plan, file trees from plan frontmatter).

2. **Read plan files**  
   For each plan in scope, read the plan markdown (e.g. under `plans/`) to get `fileTree`, `risks`, and task intents.

3. **Rate the 8 risk metrics per plan**  
   For each plan, rate **Entropy**, **Surface Area**, **Backwards Compat**, **Reversibility**, **Complexity Concentration**, **Testing Surface**, **Performance Risk**, and **Blast Radius** as **Low**, **Medium**, or **High**. Use the definitions in **CODE_RISK_ASSESSMENT.md** in this directory.

4. **Account for cross-plan interactions**
   - If two or more plans modify the same file(s), elevate **Complexity Concentration** for those plans and note the overlap.
   - Use domain/skill clusters and file overlaps to inform **recommended execution order**.

5. **Produce the report**  
   Use the output template below (same as in CODE_RISK_ASSESSMENT.md). End with a **Prioritized Risk Summary** and **Recommended Execution Order** (which plans/tasks to run first to minimize risk and friction).

## Risk metrics (quick reference)

| Metric                       | Low                  | Medium               | High                                         |
| ---------------------------- | -------------------- | -------------------- | -------------------------------------------- |
| **Entropy**                  | Localized; few files | Multiple modules     | Broad, scattered                             |
| **Surface Area**             | Small API/surface    | Moderate surface     | Large surface                                |
| **Backwards Compat**         | Additive only        | Some behavior change | Breaking changes                             |
| **Reversibility**            | Easy rollback        | Rollback with effort | Hard to reverse                              |
| **Complexity Concentration** | Spread or isolated   | Some hotspots        | Heavy concentration; many plans on same file |
| **Testing Surface**          | Well covered         | Partial coverage     | Large untested surface                       |
| **Performance Risk**         | No critical paths    | Some hot paths       | Critical path / high traffic                 |
| **Blast Radius**             | Contained            | Bounded impact       | Wide impact                                  |

## Output template

Produce markdown in this structure:

```markdown
## Risk Assessment Report

### Summary

| Plan / Scope | Entropy | Surface Area | Backwards Compat | Reversibility | Complexity Concentration | Testing Surface | Performance Risk | Blast Radius | Overall |
| ------------ | ------- | ------------ | ---------------- | ------------- | ------------------------ | --------------- | ---------------- | ------------ | ------- |
| ...          | L/M/H   | L/M/H        | L/M/H            | L/M/H         | L/M/H                    | L/M/H           | L/M/H            | L/M/H        | L/M/H   |

### Cross-Plan Interactions

- File overlaps: [which plans touch the same files]
- Domain/skill clusters: [where concentration or ordering matters]
- Impact on Complexity Concentration / ordering: [narrative]

### Overall Risk

[One paragraph: overall risk level and main drivers.]

### Mitigation Strategies

- [Per metric or per plan: specific mitigations]

### Key Risks to Monitor

- [Top 3–5 risks to watch during and after execution]

### Prioritized Risk Summary & Recommended Execution Order

- [Order plans/tasks to reduce risk; which to run first and why.]
```

## Reference

For the full framework (detailed metric definitions, process, and template), see **CODE_RISK_ASSESSMENT.md** in this directory.
