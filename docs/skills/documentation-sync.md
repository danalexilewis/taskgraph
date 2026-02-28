---
triggers:
  files: ["docs/**", "AGENT.md", ".cursor/rules/**"]
  change_types: ["document", "modify"]
  keywords: ["docs", "documentation", "sync", "cli-reference", "schema.md"]
---

# Skill: Documentation sync

## Purpose

Keep docs aligned with code and agent behavior so AGENT.md, cli-reference, schema, and related docs stay the source of truth. Update the right doc in the same change that introduces the behavior.

## Inputs

- The change you made (new CLI command, workflow update, schema change, etc.)
- `.cursor/rules/docs-sync.mdc` (sources of truth, triggers)
- `AGENT.md`, `docs/cli-reference.md`, `docs/schema.md`, `docs/agent-contract.md`, `docs/plan-import.md`, `docs/architecture.md`

## Steps

1. Identify which doc(s) are affected using the triggers: new CLI option/command → cli-reference; agent workflow change → AGENT.md and agent-contract; import/plan format → plan-import; schema/architecture → schema.md or architecture.md.
2. Update the doc in the same PR/change as the code. Prefer a single commit that includes both code and doc edits.
3. For cli-reference: add or update the command section (syntax, options, output, example). Match the actual flags and behavior.
4. For AGENT.md: keep it short (tables, bullets); put longer narrative in agent-contract.md and link if needed.

## Gotchas

- Don’t defer doc updates to “later”; they get forgotten. Same change = same PR.
- cli-reference is the canonical CLI surface; keep options and examples in sync with the code.
- AGENT.md is the contract the agent follows; workflow changes (e.g. “run tg context after start”) must be reflected there and in taskgraph-workflow.mdc.

## Definition of done

- Every user- or agent-facing change has a corresponding doc update.
- Sources of truth (AGENT.md, cli-reference.md, schema.md) match current behavior.
- New docs (skills, domains) are listed in the index (skills/README, domains.md).
