---
name: AgentDex and Agents (discovered)
overview: AgentDex in Dolt for discovered and researched agent profiles; dashboard label Agents (discovered) with count from dex or events; research-agents skill to add profiles to dex.
fileTree: |
  src/
  ├── db/
  │   └── migrate.ts                    (modify — new migration)
  ├── cli/
  │   ├── status.ts                     (modify — label, count source)
  │   └── dex.ts                        (create — tg dex add)
  docs/
  ├── schema.md                         (modify — agent_dex table)
  ├── cli-tables.md                     (modify — footer label)
  ├── cli-reference.md                  (modify — dex command, footer)
  └── agent-dex.md                      (create — purpose, usage)
  .cursor/skills/
  └── research-agents/
      └── SKILL.md                      (create)
  __tests__/
  ├── cli/
  │   └── dashboard-format.test.ts      (modify — expect "Agents (discovered)")
  └── integration/
  └── agent-dex.test.ts                 (create — optional)
risks:
  - description: Dex could be confused with source of truth for live agent definitions
    severity: low
    mitigation: Document clearly that .cursor/agents and available-agents remain authoritative; dex is context and research hoard only.
  - description: Dashboard test expects "Types of Agents" in some places; code currently says "Agents (defined)"
    severity: low
    mitigation: Align all footer labels to "Agents (discovered)" and update tests in same task.
tests:
  - "Dashboard footer shows Agents (discovered) and count; dashboard-format.test.ts asserts new label"
  - "agent_dex table exists after migration; optional integration test for dex add"
todos:
  - id: schema-agent-dex
    content: Add agent_dex table and migration in Dolt
    agent: implementer
    intent: |
      Add idempotent migration applyAgentDexMigration: create table agent_dex with columns
      profile_id CHAR(36) PRIMARY KEY, name VARCHAR(128) NOT NULL, source ENUM('observed','researched')
      DEFAULT 'observed', profile_json JSON NULL, first_seen_at DATETIME NOT NULL, updated_at DATETIME NOT NULL.
      Create unique index on name for upserts. Append to MIGRATION_CHAIN and ensureMigrations.
      Follow existing pattern in migrate.ts (tableExists, then CREATE TABLE IF NOT EXISTS; cache clear; doltCommit only when changed).
    changeType: modify
  - id: dashboard-agents-discovered
    content: Rename "Agents (defined)" to "Agents (discovered)" and source count from dex or events
    agent: implementer
    intent: |
      In src/cli/status.ts: (1) Change label "Agents (defined)" to "Agents (discovered)" in
      getDashboardFooterLine, getDashboardFooterContent, and any JSON output. (2) Source the count:
      if agent_dex table exists, use SELECT COUNT(*) FROM agent_dex; else keep current
      agentMetricsSql distinct-agent count from event WHERE kind='started'. (3) Keep
      "Sub-agents (defined)" and SUB_AGENT_TYPES_DEFINED unchanged. Update
      __tests__/cli/dashboard-format.test.ts to expect "Agents (discovered)" instead of
      "Types of Agents" or "Agents (defined)". Update docs/cli-tables.md footer KPI list.
    changeType: modify
  - id: populate-dex-from-events
    content: Populate agent_dex from distinct started.body.agent in event table
    agent: implementer
    blockedBy: [schema-agent-dex]
    intent: |
      On a path that runs when status/dashboard data is fetched (or a one-off backfill):
      from event WHERE kind='started' AND body.agent IS NOT NULL, get distinct agent names;
      for each, INSERT INTO agent_dex (profile_id, name, source, first_seen_at, updated_at)
      ON DUPLICATE KEY UPDATE updated_at = NOW() (or equivalent upsert by name). Use
      existing query pattern; avoid N+1. Prefer running once per fetchStatusData or
      once at CLI startup when agent_dex exists; or dedicated tg dex sync command.
    changeType: create
  - id: cli-dex-add
    content: Add tg dex add command to insert researched agent profiles
    agent: implementer
    blockedBy: [schema-agent-dex]
    intent: |
      New command tg dex add --name <slug> --source researched [--profile-json <path|inline>].
      Reads config, opens Dolt, INSERT into agent_dex (generate profile_id UUID, set
      first_seen_at/updated_at). Validates name and source. Enables research-agents
      skill to add entries without raw SQL. Add to Commander in index.ts; document in
      docs/cli-reference.md.
    changeType: create
  - id: skill-research-agents
    content: Create research-agents skill that researches agent profiles and adds to dex
    agent: implementer
    blockedBy: [cli-dex-add]
    intent: |
      Create .cursor/skills/research-agents/SKILL.md. Skill purpose: research external
      agent profiles (repos, docs, blog posts, patterns), summarize findings, and add
      entries to AgentDex via tg dex add. Document that dex is context-only (not
      source of live .cursor/agents). Include steps: discover sources, extract
      profile/spec, add with tg dex add --source researched. Add entry to
      docs/skills/README.md. Optional triggers frontmatter for assignment.
    changeType: create
  - id: docs-agent-dex
    content: Document AgentDex schema, purpose, and footer label in docs
    agent: implementer
    intent: |
      (1) docs/schema.md: add table agent_dex with column table and note in Decisions
      that dex is a knowledge graph for discovered/researched profiles. (2) Create
      docs/agent-dex.md: purpose (context and research hoard; not source of live
      definitions), how event sync and research-agents populate it, how to query/consult.
      (3) docs/cli-tables.md and docs/cli-reference.md: footer label "Agents (discovered)"
      and tg dex add. (4) docs/glossary.md or domains: agent profile vs sub-agent types
      defined.
    changeType: modify
isProject: false
---

# AgentDex and Agents (discovered)

## Analysis

- **Current state:** Dashboard footer shows "Agents (defined)" (count = distinct `body.agent` from `event` where `kind = 'started'`) and "Sub-agents (defined)" (constant 12). The former is a runtime-derived count; the latter is the number of defined sub-agent types in the repo.
- **Goal:** (1) Rename to "Agents (discovered)" and treat the count as distinct agent **profiles** the system has discovered or evolved. (2) Introduce an **AgentDex** in Dolt: a knowledge graph of observed and researched agent profiles, so we can hoard research and copy patterns without polluting `.cursor/agents` and skills. (3) Add a **research-agents** skill that researches external agent profiles and adds them to the dex. (4) Dashboard "Agents (discovered)" count can come from event-derived distinct at first, then from `COUNT(*)` on the dex table once it exists and is populated.

**Existing data:** `event.body.agent` for `kind = 'started'` already gives distinct agent names. The dex adds a durable store and allows "researched" profiles (external) alongside "observed" (from events). No new event capture required.

**Dependency minimization:** Schema first; dashboard can ship with event-derived count then switch to dex count when table exists. Populate dex and CLI `tg dex add` both depend only on schema. Skill depends on `tg dex add` so implementers can add entries. Docs can be written in parallel with schema/dashboard.

## Dependency graph

```
Parallel start (3 unblocked):
  ├── schema-agent-dex
  ├── dashboard-agents-discovered
  └── docs-agent-dex

After schema-agent-dex:
  ├── populate-dex-from-events
  └── cli-dex-add

After cli-dex-add:
  └── skill-research-agents
```

## Proposed changes

### agent_dex table

| Column        | Type         | Constraints        | Description                                 |
| ------------- | ------------ | ------------------ | ------------------------------------------- |
| profile_id    | CHAR(36)     | PRIMARY KEY        | UUID                                        |
| name          | VARCHAR(128) | NOT NULL, UNIQUE   | Agent profile name/slug (upsert key)        |
| source        | ENUM         | DEFAULT 'observed' | 'observed' or 'researched'                  |
| profile_json  | JSON         | NULL               | Optional structured profile (traits, links) |
| first_seen_at | DATETIME     | NOT NULL           | First observation or add                    |
| updated_at    | DATETIME     | NOT NULL           | Last update                                 |

No FK to `event`; dex is a separate knowledge graph. "Observed" rows are populated from distinct `event.body.agent`; "researched" rows are added via `tg dex add --source researched`.

### Dashboard

- Replace label "Agents (defined)" with "Agents (discovered)" everywhere (footer line, footer box grid, JSON).
- Count: if `agent_dex` table exists, use `SELECT COUNT(*) FROM agent_dex`; else keep current `COUNT(DISTINCT body.agent)` from `event` where `kind = 'started'`.
- Tests: `dashboard-format.test.ts` currently expects "Types of Agents" in some assertions; update to "Agents (discovered)".

### research-agents skill

- Invocation: user says "research agents", "research agent profiles", or invokes skill by name.
- Steps: (1) Discover sources (repos, docs, posts). (2) Extract profile/spec (name, capabilities, when to use). (3) Add to dex with `tg dex add --name <slug> --source researched [--profile-json ...]`.
- Clarify in SKILL.md: the dex is for context and pattern hoarding; live definitions stay in `.cursor/agents` and available-agents.

## Open questions

- **Backfill:** Populate dex from events once at migration time, or lazily on first status fetch? Lazy keeps migrations simple; backfill can be a one-off script or part of "populate-dex-from-events" (e.g. run once when table is empty and events exist).
- **profile_json shape:** Leave flexible (arbitrary JSON) for now; document optional fields (e.g. `source_url`, `traits`, `when_to_use`) in docs/agent-dex.md so research-agents can use a consistent shape.

## Original prompt

<original_prompt>
agents defined should become Agents (discovered) and it should be a count of distinct Agent profiles that the system has discovered/evolved. We likely need something like a AgentDex where we keep a log of all agents observed and used. this will enable us to quickly copy other agentic patterns into our system, without poluting the agentic and skill definiitons we have. the dex is just more context to consult and hoard research findings.

We can also create a skill called research-agents which goes out and researches great agent profiles and adds to oru dex.

I guess the dex is another knowledege graph in dolt. makes sense to add it there.

/plan
</original_prompt>
