## Agent system

Sub-agent architecture: the **orchestrator** (main Cursor agent in a chat) interprets user intent, invokes **skills** when triggered, and coordinates **leads** and **workers**. **Leads** are orchestration patterns created by skills: they dispatch workers, collect results, and synthesize. **Workers** are task-level executors (implementer, reviewer, etc.) that do bounded work; they do not orchestrate other agents.

- **Orchestrator** — Chooses skills (e.g. `/plan`, `/work`, `/investigate`), dispatches leads and workers, coordinates only; does not perform implementation except as fallback after a worker has failed twice on the same task.
- **Leads** — Created when a skill runs. A lead receives a directive, dispatches workers, and synthesizes outcomes. Defined by skills and documented in [docs/leads/](docs/leads/).
- **Workers** — Execute single tasks or reviews; prompts live in `.cursor/agents/`.

See [docs/agent-strategy.md](docs/agent-strategy.md) for the full decision tree and [docs/leads/README.md](docs/leads/README.md) for the lead registry.

### Skills

| Skill | Trigger | Description |
|-------|---------|-------------|
| plan | "plan", "make a plan", "/plan", or describes a feature to plan | Create a rich project plan with codebase analysis, file trees, risks, tests, and structured tasks. |
| work | "work", "go", "execute", "grind", or wants tasks completed autonomously | Autonomous task execution loop; grinds through plan tasks via sub-agent dispatch. |
| investigate | /investigate or wants to investigate next steps from recent tasks/failures | Quick investigation from chat and docs; creates plan and tasks; dispatches investigator sub-agent. |
| review | "review", "health check", "code health", "system health", or evaluate a feature idea | Read-only code and system health review using sub-agents; includes optional risk assessment. |
| debug | /debug or unclear root cause (e.g. failing test with unknown cause) | Systematic debugging: 4-phase process (investigate, pattern, hypothesis, implement); escalate after 3 failed fix attempts. |
| risk | Evaluating a feature proposal, implementation plans, or asks about risk/impact/safety | Assess risk profile of code changes or proposed features using the project's 8-metric risk model. |
| meta | Multiple plans; wants to surface file conflicts, domain clusters, or execution ordering | Enrich the task graph with cross-plan and cross-project edges and notes (writes only after user approval). |
| rescope | "rescope", clarifies requirements, or how the system should behave after tasks are done | Clarify desired functionality when shipped behavior does not match intent; PM role; may dispatch explorer, spec-reviewer, quality-reviewer, planner-analyst. |
| report | "report", "write it up", "capture this", or findings to persist to reports/ | Write a structured report from the conversation context (research, investigation, review, benchmarks). |
| review-tests | "review tests", "audit test coverage", "improve testing strategy", "assess test health" | Audit testing approach, coverage, quality, and infrastructure; dispatches test scanners; orchestrator synthesizes and produces a plan. |
| create-hook | "create a hook", "add a hook", "lifecycle hook", or automate on agent stop / afterFileEdit / etc. | Create or add Cursor agent lifecycle hooks in `.cursor/hooks/`; registered in `.cursor/hooks.json`. |

<details>
<summary>Lead registry (from docs/leads/README.md)</summary>

| Lead | Skill | Agent file(s) | Purpose |
|------|-------|---------------|---------|
| investigator | /investigate | investigator.md | Read-only investigation; dispatches investigator sub-agent with tactical directives. |
| planner-analyst | /plan | planner-analyst.md | Pre-plan analysis; gathers codebase context before plan creation. |
| execution | /work | implementer.md, reviewer.md | Task execution loop; implementer does work, reviewer evaluates; orchestrator coordinates. |
| test-review | /test-review | test-quality-auditor, test-infra-mapper, test-coverage-scanner | Audits tests; dispatches scanner sub-agents; orchestrator synthesizes findings and plan. |
| review | /review | investigator.md | Read-only code health, system health, and optional risk assessment. |
| rescope | /rescope | explorer.md, spec-reviewer.md, quality-reviewer.md, planner-analyst.md | PM-role lead that clarifies desired functionality vs shipped behavior. |
| risk | /risk | (none; orchestrator direct) | Read-only risk assessment using 8-metric model across plans. |
| meta | /meta | (none; orchestrator direct) | Cross-plan and cross-project edge enrichment; writes only after user approval. |
| debug | /debug | investigator.md, implementer.md (optional) | Systematic debugging: 4-phase process; escalate after 3 failed fix attempts. |

</details>

<details>
<summary>Workers (agent files in .cursor/agents/)</summary>

- **implementer** — Execute a single task (tg start → work → tg done).
- **reviewer** — Evaluate an implementation against the task spec.
- **documenter** — Documentation-only tasks (README, CHANGELOG, docs/).
- **explorer** — Codebase exploration and context gathering (quick / medium / thorough).
- **planner-analyst** — Pre-plan codebase analysis for the planning model.
- **investigator** — Read-only investigation; files, function chains, architecture, schemas.
- **spec-reviewer** — Spec compliance check (PASS/FAIL): intent, scope, suggested_changes.
- **quality-reviewer** — Code quality check (PASS/FAIL): patterns, tests, errors.
- **test-quality-auditor** — Audit test quality and suggest improvements.
- **test-infra-mapper** — Map and document test infrastructure.
- **test-coverage-scanner** — Scan test coverage and highlight gaps.
- **debugger** — Systematic debugging; hypothesis-driven investigation.
- **fixer** — Escalation; resolves tasks after implementer/reviewer failure (stronger model).

</details>
