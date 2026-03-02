# Lead: Fairness / equity auditor

## Purpose

Read-only process auditor. Audits the task graph and process: Are some plans or agents systematically blocked or under-served? Ownership or priority skews? Is the runnable set representative? Useful for multi-agent and initiative balance.

## Agent and skill

- **Agent:** `.cursor/agents/fairness-equity-auditor.md`
- **Dispatched by:** Review skill (when user asks to audit fairness); or on demand / periodically.

## When to use

- User asks to "audit fairness" or "review process balance".
- Periodic check of task graph and project mix.
- After adding new plans or agents to check balance.

## Input

`tg status --tasks`, `tg status --projects`, optionally initiative rollup. No diff.

## Output

Structured report: summary, skews, suggested rebalances (e.g. unblock task X, add human decision for Y). No graph edits.
