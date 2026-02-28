# Code Risk Assessment Framework (Greg's Framework)

Reference document for structured risk assessment of code changes and proposed features. Use this when applying the assess-risk skill or when evaluating risk manually.

---

## Risk Metrics

Rate each metric **Low**, **Medium**, or **High** per plan (or per change set).

| Metric | Low | Medium | High |
|--------|-----|--------|------|
| **Entropy** | Localized change; few files, clear boundaries | Multiple modules or layers touched | Broad, scattered changes; many files or subsystems |
| **Surface Area** | Small API/surface change; few call sites | Moderate surface; several entry points or configs | Large surface; public APIs, many integrations |
| **Backwards Compat** | Additive only or internal; no breaking changes | Some behavior change; documented migration | Breaking changes; contract or schema changes |
| **Reversibility** | Easy rollback; feature flags or isolated deploy | Rollback possible with some effort or data migration | Hard to reverse; data or schema committed |
| **Complexity Concentration** | Logic spread or well-isolated | Some hotspots; a few critical paths | Heavy concentration in one area or file; many plans touching same file |
| **Testing Surface** | Well-covered area; tests exist and are updated | Partial coverage; new paths need tests | Large untested surface or hard-to-test code |
| **Performance Risk** | No perf-critical paths | Some hot paths or scaling concerns | Critical path, high traffic, or resource-sensitive |
| **Blast Radius** | Failure contained to one feature or service | Failure affects a bounded set of users or flows | Failure affects many users, core flows, or multiple services |

---

## Assessment Process

1. **Identify scope** — What is being changed? (plans, tasks, files, domains.) Use `tg crossplan summary --json` to get plans, tasks, file_tree overlaps, and domains.
2. **Rate each metric** — For each plan (or change set), assign Low/Medium/High for all 8 metrics. Use cross-plan data: e.g. two plans modifying the same file elevates **Complexity Concentration**.
3. **Determine overall risk** — Combine metrics into an overall risk level (e.g. majority High → High overall; mix of Medium/High → Medium-High).
4. **Propose mitigations** — For each High (and material Medium) metric, suggest concrete mitigations (tests, feature flags, rollout order, monitoring).

---

## Output Template

Produce a risk report in this structure (markdown):

```markdown
## Risk Assessment Report

### Summary

| Plan / Scope | Entropy | Surface Area | Backwards Compat | Reversibility | Complexity Concentration | Testing Surface | Performance Risk | Blast Radius | Overall |
|--------------|---------|--------------|------------------|---------------|---------------------------|-----------------|------------------|--------------|---------|
| ...         | L/M/H   | L/M/H        | L/M/H            | L/M/H         | L/M/H                     | L/M/H           | L/M/H            | L/M/H        | L/M/H   |

### Cross-Plan Interactions

- File overlaps: [which plans touch the same files]
- Domain/skill clusters: [where concentration or ordering matters]
- Impact on Complexity Concentration / ordering: [narrative]

### Overall Risk

[One paragraph: overall risk level and main drivers.]

### Mitigation Strategies

- [Per metric or per plan: specific mitigations]
- [Testing, rollout, feature flags, monitoring]

### Key Risks to Monitor

- [Top 3–5 risks to watch during and after execution]

### Prioritized Risk Summary & Recommended Execution Order

- [Order plans/tasks to reduce risk: e.g. lower blast radius first, or unblock high-complexity work by doing foundational work first.]
```

---

## When to Assess

- Before committing to a large or multi-plan execution.
- When the user says "assess risk", "run risk assessment", or asks about risk/impact/safety of changes.
- When evaluating a feature proposal or reviewing implementation plans.
- After loading plans into the task graph (`tg import`) and before starting execution.

---

## Cross-Plan Considerations

- **File overlap**: Two or more plans modifying the same file → elevate **Complexity Concentration** for those plans and consider execution order (one plan should typically go first).
- **Domain/skill clusters**: Many tasks in the same domain across plans → ordering and batching may reduce friction.
- **Blast radius + reversibility**: Higher blast radius plans benefit from higher reversibility (e.g. feature flags) or from running after lower-risk foundational work.

This framework is advisory; output is not automated. Apply judgment and document assumptions.
