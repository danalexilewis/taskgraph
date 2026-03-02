# Lead: Risk / preparedness reviewer

## Purpose

Read-only change-level risk specialist. For a given change or plan: what could go wrong in deployment, ops, or rollback? Rate impact and likelihood; suggest mitigations. Distinct from the risk skill (proposal-level); this is change-set-focused.

## Agent and skill

- **Agent:** `.cursor/agents/risk-preparedness-reviewer.md`
- **Dispatched by:** Review skill (when scope is high-impact or user asks for scorecard); or before merge/release gate.

## When to use

- Before merging high-impact work (schema, CLI contract, worktree lifecycle).
- As part of a release gate.
- User asks for "risk scorecard" or "preparedness review".

## Input

Scope, diff or plan pointer, optionally plan overview.

## Output

Scorecard (Critical/High/Medium/Low per category: correctness, ops, rollback, data) + 2–3 top mitigations. No code edits.
