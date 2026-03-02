# Lead: Factuality / traceability reviewer

## Purpose

Read-only factuality specialist. Checks that implementation and docs stay aligned: do code comments and docs match behavior? Do task intent and suggested_changes trace to the diff? Are domain rules reflected? Distinct from spec-reviewer (intent); this checks consistency of claims vs reality.

## Agent and skill

- **Agent:** `.cursor/agents/factuality-traceability-reviewer.md`
- **Dispatched by:** Review skill (when scope is doc-heavy or domain-touching); or after spec pass for tasks that touch `docs/` or critical comments.

## When to use

- After spec pass for doc-heavy or domain-touching tasks.
- Any change that touches `docs/` or critical comments.
- User asks for "factuality check" or "traceability review".

## Input

Diff, task intent, optionally suggested_changes and doc snippets (e.g. schema, glossary).

## Output

PASS / FAIL with specific inconsistencies (e.g. "Comment says X; code does Y"). No code edits.
