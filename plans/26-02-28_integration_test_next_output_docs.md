---
name: Integration Test Next Output Docs
overview: Document remaining work from integration-test-next-output-format research and add testing guideline so future tests use next --json for task IDs.
fileTree: |
  docs/
  ├── research/
  │   └── integration-test-next-output-format.md   (modify — add Remaining work)
  └── skills/
      └── integration-testing.md                   (modify — add task ID guideline)
risks:
  - description: Duplicate scope with Short Hash plan
    severity: low
    mitigation: This plan is doc-only; Short Hash task "Update all CLI commands to use resolveTaskId" owns code. We only document the link.
tests: []
todos:
  - id: research-remaining-work
    content: Add Remaining work subsection to integration-test-next-output-format.md
    agent: implementer
    intent: |
      In docs/research/integration-test-next-output-format.md add a short "Remaining work" subsection after "Changes made".
      State: context (and other task-ID-taking commands) do not yet accept hash_id; they look up by task_id only.
      The Short Hash Task IDs plan has a task "Update all CLI commands to use resolveTaskId for task ID arguments" which will add resolveTaskId to context, start, done, show, block, note, split. Once that is done, tg context <hash_id> will work.
      No code changes in this task — doc only.
    changeType: document
  - id: integration-testing-guideline
    content: Add task ID guideline to integration-testing skill
    agent: implementer
    intent: |
      In docs/skills/integration-testing.md add a guideline (e.g. under "Gotchas" or a new "Task IDs" section).
      When integration tests need a task ID from the repo, use "tg next --json" (or equivalent) and take task_id from the parsed JSON; do not parse the human-readable "ID: ..." line. That keeps tests robust to display format (hash_id vs UUID). Reference docs/research/integration-test-next-output-format.md.
      No code changes — doc only.
    changeType: document
isProject: false
---

## Dependency graph

```
Parallel start (2 unblocked):
  ├── research-remaining-work
  └── integration-testing-guideline
```

## Context

The research doc `docs/research/integration-test-next-output-format.md` explains why integration tests broke (next shows hash_id; tests parsed UUID from human output) and the fix applied (use next --json, take task_id). It also notes that **context** does not use resolveTaskId, so it does not accept hash_id yet. The **Short Hash Task IDs** plan already includes a task to update all CLI commands (including context) to use resolveTaskId. This plan only documents that remaining work and adds a testing guideline so future tests use next --json for task IDs and do not regress when display format changes.

## Scope

- Doc-only. No CLI or test code changes.
- Overlap: Short Hash plan owns resolveTaskId in context; we document the link.

<original_prompt>
/plan based on docs/research/integration-test-next-output-format.md
</original_prompt>
