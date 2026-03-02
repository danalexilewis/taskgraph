# Lead: Rubric-driven reviewer

## Purpose

Read-only rubric evaluation specialist. Evaluates a change or plan against a configurable rubric (e.g. technical correctness, clarity, completeness, citation). Returns per-dimension scores and pass/fail per criterion, not a single verdict. Use for benchmarking, plan comparison, or when a plan requests rubric-based evaluation.

## Agent and skill

- **Agent:** `.cursor/agents/rubric-driven-reviewer.md`
- **Dispatched by:** Review skill (when user asks for rubric evaluation); or for benchmarking / plan comparison.

## When to use

- User asks for "rubric evaluation" or "dimension scores".
- Benchmarking implementers or plans.
- Plan comparison (A/B of two implementations).
- Plan explicitly requests rubric-based evaluation.

## Input

Scope, diff or plan content, rubric dimensions (list + optional thresholds).

## Output

JSON or structured report: dimensions (name, score, pass, reasoning), overall pass/fail. No code edits.
