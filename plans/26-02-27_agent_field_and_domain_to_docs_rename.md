---
name: Agent field and domain-to-docs rename
overview: |
  Add an agent field to tasks so plans can specify which sub-agent executes each task,
  create a sub-agent registry rule, and rename the domain concept to docs throughout
  the schema, parser, importer, context command, plan format, and rules.

fileTree: |
  .cursor/
  └── rules/
      └── available-agents.mdc              (create)
  src/
  ├── db/
  │   └── migrate.ts                        (modify)
  ├── domain/
  │   └── types.ts                          (modify)
  ├── plan-import/
  │   ├── parser.ts                         (modify)
  │   └── importer.ts                       (modify)
  ├── cli/
  │   └── context.ts                        (modify)
  └── template/
      ├── AGENT.md                          (modify)
      ├── .cursor/
      │   ├── agents/
      │   │   └── README.md                 (modify)
      │   └── rules/
      │       └── available-agents.mdc      (create)
      └── ...
  docs/
  ├── plan-format.md                        (modify)
  └── schema.md                             (modify)
  .cursor/
  ├── rules/
  │   ├── plan-authoring.mdc                (modify)
  │   └── subagent-dispatch.mdc             (modify)
  └── agents/
      └── README.md                         (modify)
  __tests__/
  └── integration/                          (modify)

risks:
  - description: Rename of task_domain table could fail on existing repos with data
    severity: medium
    mitigation: Idempotent migration creates task_doc first, copies data, drops task_domain only if task_doc exists and has data. Follow existing junction migration pattern.
  - description: Existing plans in the wild use domain field in YAML frontmatter
    severity: low
    mitigation: Parser accepts both domain and docs for backward compatibility. New plans use docs.
  - description: Context command output shape change (domains->docs) breaks existing orchestrator prompts
    severity: medium
    mitigation: Output both old and new keys during a transition period, or update all agent templates and dispatch rules in the same change set.

tests:
  - "Import plan with agent field on todos, verify stored on task row"
  - "Import plan with docs field (new name), verify stored in task_doc junction table"
  - "Import plan with domain field (old name), verify backward compat - stored in task_doc junction"
  - "tg context outputs agent, docs, and doc_paths fields"
  - "Migration renames task_domain to task_doc on existing repo with data"
  - "Migration adds agent column to task table"

todos:
  - id: create-agent-registry-rule
    content: Create available-agents.mdc rule documenting all sub-agents
    agent: implementer
    intent: |
      Create a new cursor rule at .cursor/rules/available-agents.mdc (and the template
      copy at src/template/.cursor/rules/available-agents.mdc) that serves as the
      canonical registry of available sub-agents. This rule is referenced by orchestrators
      and planners to know which agents exist and when to use each one.

      Current agents to document (from .cursor/agents/):
      - implementer: executes a single task (code changes, tg start/done). Default for most tasks.
      - explorer: codebase exploration and context gathering. No code writing. Use for investigation tasks.
      - reviewer: spec compliance and quality check after implementer. Always dispatched by orchestrator post-implementation; not assigned in plans.
      - planner-analyst: pre-plan codebase analysis. Dispatched before plan creation; not assigned in plans.

      For each agent, document: name, purpose/specialization, when to use it,
      constraints (e.g. reviewer is orchestrator-dispatched only), model (fast),
      and the template file path.

      Mark the rule as alwaysApply: false with description mentioning sub-agent selection
      and task planning. Also note that this file should be updated whenever a new agent
      template is added to .cursor/agents/.

      Include guidance on defaults: if no agent is specified on a task, the orchestrator
      uses implementer. Reviewer is always dispatched after implementer and should not
      be specified as a task agent.
    docs: [cli]
    changeType: create

  - id: schema-agent-and-docs-rename
    content: Add agent column to task table and rename task_domain to task_doc
    agent: implementer
    intent: |
      Two schema changes in src/db/migrate.ts, plus type updates in src/domain/types.ts.

      1. New migration function applyTaskAgentMigration():
         - Check if agent column exists on task table
         - If not: ALTER TABLE task ADD COLUMN agent VARCHAR(64) NULL
         - Record in _taskgraph_migrations

      2. New migration function applyDomainToDocRenameMigration():
         - Check if task_doc table already exists (idempotent guard)
         - If task_domain exists and task_doc does not:
           CREATE TABLE task_doc (task_id CHAR(36) NOT NULL, doc VARCHAR(64) NOT NULL, PRIMARY KEY (task_id, doc), FOREIGN KEY (task_id) REFERENCES task(task_id))
         - Copy data: INSERT INTO task_doc SELECT task_id, domain FROM task_domain
         - Drop old table: DROP TABLE task_domain
         - If task_domain does not exist and task_doc does not exist, just create task_doc fresh
         - Record in _taskgraph_migrations

      3. Wire both into ensureMigrations() chain.

      4. Update src/domain/types.ts:
         - Add agent field to TaskSchema: agent: z.string().max(64).nullable()
         - Rename TaskDomainSchema to TaskDocSchema, rename domain field to doc
         - Update TaskDomain type alias to TaskDoc

      Follow the existing migration patterns in migrate.ts (column existence check via
      SHOW COLUMNS, table existence via information_schema, idempotent with
      _taskgraph_migrations tracking).
    suggestedChanges: |
      In migrate.ts, add after applyTaskSuggestedChangesMigration:

      async function applyTaskAgentMigration(repoPath: string) {
        // check SHOW COLUMNS FROM task LIKE 'agent'
        // if not exists: ALTER TABLE task ADD COLUMN agent VARCHAR(64) NULL
      }

      async function applyDomainToDocRenameMigration(repoPath: string) {
        // check if task_doc exists via information_schema
        // check if task_domain exists
        // create task_doc, copy data, drop task_domain
      }

      In types.ts:
      - TaskSchema: add agent: z.string().max(64).nullable()
      - Rename TaskDomainSchema -> TaskDocSchema, field domain -> doc
    docs: [schema]
    changeType: modify

  - id: update-plan-format-docs
    content: Update plan-format.md and plan-authoring.mdc with agent field and domain-to-docs rename
    agent: implementer
    intent: |
      Update docs/plan-format.md:
      - Add agent to the Todo Fields table (type: string, stored in task.agent,
        description: sub-agent to execute this task, see available-agents.mdc)
      - Rename domain to docs in all examples, field tables, and descriptions
      - Update the "Base fields" reference to include agent
      - Add an example showing agent: explorer for an investigate task

      Update .cursor/rules/plan-authoring.mdc:
      - Add agent to the Todo Fields table
      - Rename domain to docs in the YAML example and field table
      - Note that domain is still accepted for backward compatibility
      - Add guidance: "Use agent to specify which sub-agent should execute the task.
        See .cursor/rules/available-agents.mdc for the registry. Default is implementer."

      Update docs/schema.md if it references task_domain or domain fields.
    docs: [cli]
    changeType: modify

  - id: update-parser-agent-and-docs
    content: Update parser.ts for agent field and domain-to-docs rename
    agent: implementer
    intent: |
      In src/plan-import/parser.ts:

      1. Add agent to ParsedTask interface: agent?: string
      2. Add agent to CursorTodo interface: agent?: string
      3. In parseCursorPlan(), map t.agent to the parsed task (typeof t.agent === 'string' ? t.agent : undefined)

      4. For the domain-to-docs rename in CursorTodo:
         - Add docs field: docs?: string | string[]
         - Keep domain field for backward compatibility
         - In the mapping logic, prefer docs over domain: use t.docs if present, fall back to t.domain
         - The output ParsedTask field stays as docs: string[] (rename from domains)

      5. For parsePlanMarkdown() (legacy format):
         - Keep DOMAIN: parsing but map to docs in ParsedTask
         - Rename the ParsedTask field from domains to docs

      6. Ensure backward compatibility: plans with domain: still parse correctly
         and produce the same docs array.
    suggestedChanges: |
      In CursorTodo:
        docs?: string | string[];
        domain?: string | string[];  // backward compat
        agent?: string;

      In ParsedTask:
        docs?: string[];  // renamed from domains
        agent?: string;

      In the mapping:
        const rawDocs = t.docs ?? t.domain;  // prefer new name, fall back to old
        const docs = rawDocs === undefined ? undefined
          : Array.isArray(rawDocs) ? rawDocs.filter(...)
          : typeof rawDocs === 'string' ? [rawDocs]
          : undefined;
    blockedBy: [schema-agent-and-docs-rename]
    docs: [cli]
    changeType: modify

  - id: update-importer-agent-and-docs
    content: Update importer.ts for agent field and domain-to-docs rename
    agent: implementer
    intent: |
      In src/plan-import/importer.ts:

      1. Add agent to the local ParsedTask interface: agent?: string
      2. In upsertTasksAndEdges(), when inserting/updating tasks:
         - Include agent: parsedTask.agent ?? null in both insert and update objects
      3. Rename junction table references:
         - Change task_domain to task_doc throughout
         - Change the domain column reference to doc
         - DELETE FROM task_doc WHERE task_id = ...
         - INSERT INTO task_doc (task_id, doc) VALUES ...
      4. Rename parsedTask.domains references to parsedTask.docs:
         - for (const doc of parsedTask.docs ?? [])
         - q.insert("task_doc", { task_id: taskId, doc })
      5. Remove the old task_domain references entirely (the migration handles the rename)
    blockedBy: [schema-agent-and-docs-rename]
    docs: [cli]
    changeType: modify

  - id: update-context-command
    content: Update context.ts for agent field and domain-to-docs rename
    agent: implementer
    intent: |
      In src/cli/context.ts:

      1. Add agent to the task SELECT columns list
      2. Change task_domain table queries to task_doc:
         - q.select<{ doc: string }>("task_doc", { columns: ["doc"], where: { task_id: taskId } })
      3. Rename output fields:
         - domains -> docs (array of doc slugs)
         - domain_docs -> doc_paths (array of resolved paths like docs/schema.md)
         - Add agent field to the output
      4. Update the related-done-by-domain SQL to use task_doc and doc column:
         - JOIN task_doc td ON t.task_id = td.task_id ... td.doc IN (...)
      5. Update console output labels:
         - "Domain doc:" -> "Doc:"
         - "Related done (same domain):" -> "Related done (same doc):"
         - Add "Agent: <agent>" line when agent is present
      6. Update the JSON output type annotation to match new field names

      The --json output shape changes: domains->docs, domain_docs->doc_paths, agent added.
      This is a breaking change for any code parsing the JSON. The dispatch rule and agent
      templates must be updated to use the new field names (handled in a separate task).
    blockedBy: [schema-agent-and-docs-rename]
    docs: [cli]
    changeType: modify

  - id: update-dispatch-and-templates
    content: Update subagent-dispatch rule, AGENT.md, and agent templates for new fields
    agent: implementer
    intent: |
      Update .cursor/rules/subagent-dispatch.mdc:
      - In "Building prompts from context JSON" section, update field names:
        domains->docs, domain_docs->doc_paths, add agent field
      - In Pattern 1 step 4, add: "Check task.agent from context; if set, use that
        agent template instead of defaulting to implementer. If agent is 'explorer',
        dispatch explorer instead."
      - Add reference to available-agents.mdc for the agent registry
      - Update the placeholder table: DOMAIN_DOCS -> DOC_PATHS (or keep both during transition)

      Update src/template/.cursor/rules/subagent-dispatch.mdc with the same changes.

      Update .cursor/agents/README.md and src/template/.cursor/agents/README.md:
      - Update the placeholder table to show docs/doc_paths instead of domain_docs
      - Add {{AGENT}} placeholder (the intended agent from the task)
      - Note that the orchestrator checks task.agent to choose which template to dispatch

      Update src/template/AGENT.md:
      - Reference the agent field in task assignment
      - Note that tg context now includes agent, docs, doc_paths

      Update .cursor/agents/implementer.md placeholder references if they use DOMAIN_DOCS.
      Update src/template/.cursor/agents/ templates similarly.
    blockedBy: [create-agent-registry-rule, update-context-command]
    docs: [cli]
    changeType: modify

  - id: integration-tests
    content: Add integration tests for agent field and domain-to-docs rename
    agent: implementer
    intent: |
      Add or update integration tests to cover:

      1. Plan import with agent field:
         - Create a test plan YAML with agent: explorer on one todo and agent: implementer on another
         - Import it, verify task rows have the correct agent column values
         - Verify a todo without agent has agent=NULL

      2. Plan import with docs field (new name):
         - Create a test plan YAML with docs: [schema, cli] on a todo
         - Import it, verify task_doc junction table has the correct rows
         - Verify doc_paths resolve correctly in tg context

      3. Backward compatibility - domain field still works:
         - Create a test plan YAML with domain: [schema] (old name)
         - Import it, verify task_doc junction table has the correct rows
         - This ensures existing plans still import correctly

      4. Migration tests:
         - If there's an existing test for the task_domain migration, update it
         - Verify applyTaskAgentMigration adds the column
         - Verify applyDomainToDocRenameMigration renames the table and preserves data

      5. Context command tests:
         - Verify tg context --json includes agent, docs, doc_paths fields
         - Verify related_done queries work with task_doc table

      Look at existing integration tests in __tests__/integration/ for patterns.
      Run pnpm build before pnpm test:integration.
    blockedBy:
      [
        update-parser-agent-and-docs,
        update-importer-agent-and-docs,
        update-context-command,
      ]
    docs: [cli]
    changeType: test
isProject: false
---

## Analysis

This plan addresses three related changes that reinforce each other:

### 1. Sub-agent registry rule

Currently, knowledge of which sub-agents exist is scattered across `.cursor/agents/README.md`, `subagent-dispatch.mdc`, and `AGENT.md`. A dedicated registry rule (`available-agents.mdc`) creates a single source of truth that planners and orchestrators reference when deciding which agent to assign to a task. This rule ships in the template so consuming projects get it too.

### 2. Agent field on tasks

The `agent` field gives plan authors explicit control over which sub-agent executes each task. Currently the orchestrator always defaults to the implementer, with explorer used only when the orchestrator judges it appropriate. With an explicit field:

- `changeType: investigate` tasks can be assigned `agent: explorer`
- Custom agents (e.g. test-coverage-scanner) can be assigned directly
- The orchestrator still falls back to `implementer` when agent is not specified

The field is stored on the task row (VARCHAR(64) NULL) so `tg context` can surface it and the dispatch logic can use it.

### 3. Domain → docs rename

The `domain` concept maps to `docs/<slug>.md` files. Calling it "docs" aligns with the actual folder name and is more adaptable — a doc slug doesn't have to represent a "domain" in the DDD sense. The rename touches:

- DB: `task_domain` table → `task_doc` table, `domain` column → `doc`
- Types: `TaskDomainSchema` → `TaskDocSchema`
- Parser: accepts both `docs` (new) and `domain` (backward compat) in YAML
- Importer: writes to `task_doc` table
- Context: outputs `docs` and `doc_paths` instead of `domains` and `domain_docs`
- Plan format docs and authoring rules

### Backward compatibility

The parser accepts both `domain` and `docs` in plan YAML. The migration handles both fresh installs (create `task_doc` from scratch) and upgrades (rename from `task_domain`). The context output shape changes (breaking for JSON consumers), but all consumers (dispatch rule, agent templates) are updated in the same plan.

## Dependency graph

```
Parallel start (3 unblocked):
  ├── create-agent-registry-rule
  ├── schema-agent-and-docs-rename (migration + types)
  └── update-plan-format-docs (docs + authoring rule)

After schema-agent-and-docs-rename:
  ├── update-parser-agent-and-docs
  ├── update-importer-agent-and-docs
  └── update-context-command

After create-agent-registry-rule + update-context-command:
  └── update-dispatch-and-templates

After update-parser + update-importer + update-context:
  └── integration-tests
```

```mermaid
graph TD
  A[create-agent-registry-rule] --> G[update-dispatch-and-templates]
  B[schema-agent-and-docs-rename] --> D[update-parser-agent-and-docs]
  B --> E[update-importer-agent-and-docs]
  B --> F[update-context-command]
  F --> G
  D --> H[integration-tests]
  E --> H
  F --> H
  C[update-plan-format-docs]
```

<original_prompt>
I have realised that when we break a plan down into tasks we have a good opportunity to specify the sub-agent we want to execute a task.

this will require a new sub-agent rule for using tg this rule would be updated over time so that any orchistrator/query knows what sub-agents are available to use generally. We should capture what the purpose/specialisation of each sub agent is and any constraints it is meant to operate within.

the planning rule will then need to be updated as well to use this so that when it specifies tasks it identifies the agent to be used.

for this to work we are going to have to change the schema of our tasks and the frontmatter of our plans.

While we are doing this I also realised that I would like to change the name domain to docs inside of the task schema. Its what we call it at the folder level and it is more adaptable.

make me a plan for these changes
</original_prompt>
