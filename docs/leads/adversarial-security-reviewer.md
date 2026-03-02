# Lead: Adversarial / security reviewer

## Purpose

Read-only security specialist. Actively looks for misuse, injection/escape risks, and abuse potential in a change set. Red-team style; distinct from spec (intent) and quality (patterns).

## Agent and skill

- **Agent:** `.cursor/agents/adversarial-security-reviewer.md`
- **Dispatched by:** Review skill (when scope is security-sensitive or user asks for security review); or on demand for a given task/plan.

## When to use

- After spec + quality pass for security-sensitive areas (CLI, MCP, plan-import, db layer).
- User asks for "security review" or "adversarial review".
- High-risk surface: user input, Dolt data, or task-graph commands (e.g. `tg done` without doing work).

## Input

Scope, diff (change set), optionally file context and task intent.

## Output

VERDICT: PASS / CONCERNS / FAIL with specific risks and severity (low/medium/high). No code edits.
