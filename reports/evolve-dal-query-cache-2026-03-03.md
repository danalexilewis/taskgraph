# Evolve: Plan "DAL Query Cache" — 2026-03-03

## State Documentation

(Descriptive only; no routing. Use for instrumentation and context.)

### Metrics

| Field          | Value   | Description |
|----------------|---------|-------------|
| sample_size   | 7       | Number of tasks in the plan (squash commit). |
| diff_lines    | 1608    | Insertions + deletions from plan squash (3a0d9ef). |
| files_changed | 12      | Files in the squash. |
| confidence    | high    | Full plan squash + structured reviewer analysis; no follow-up fix notes (tg unavailable). |
| recurrence    | 5       | Distinct patterns with recurrence ≥ 2 or many (migrate clear vs invalidate). |

### What was done

- Plan: "DAL Query Cache", branch: already merged (no plan-* branch); used squash commit `3a0d9ef` on main.
- Tasks analysed: 7 (QueryCache, config TTL, cachedQuery, docs, status integration, migrate dedup, integration tests).
- Commit: `3a0d9ef` — 12 files changed, 1312 insertions(+), 296 deletions(-).

---

## Pattern Learnings

### Findings

| Category      | Pattern | File | Confidence | Routed to | Recurrence |
|---------------|---------|------|------------|-----------|------------|
| Type pattern  | Cache keys from option objects (JSON.stringify) not normalized; equal options can produce different keys. | src/db/cached-query.ts | high | implementer.md + quality-reviewer.md | 2 |
| SQL pattern   | Migrations call cache?.clear() after DDL instead of invalidateTable(tableName). | src/db/migrate.ts | medium | implementer.md + quality-reviewer.md | ~25 |
| SQL pattern   | indexExists accepts cache but never caches; only clears, so no dedup. | src/db/migrate.ts | high | implementer.md + quality-reviewer.md | 1 |
| Scope drift   | getSchemaFlags calls tableExists without passing status QueryCache; schema probes not deduplicated. | src/cli/status-cache.ts | medium | implementer.md | 1 |
| Process/tooling | Test asserts exact cache key shape / presence instead of behavior (DB call count). | __tests__/db/cached-query.test.ts | medium | implementer.md + quality-reviewer.md | 1 |
| Other         | Repeated get→query→set pattern in tableExists, columnExists, viewExists, triggerExists, projectInitiativeIdNullable; extract shared cachedProbe helper. | src/db/migrate.ts | medium | implementer.md | 5 |
| Other (positive) | Shared QueryCache + cachedQuery in status/dashboard for repeated reads. | src/cli/status.ts | high | implementer.md | 4 |
| Other (positive) | TTL=0 passthrough in cachedQuery so callers can disable cache. | src/db/cached-query.ts | high | implementer.md | 1 |
| Other (positive) | One QueryCache per ensureMigrations run passed through the chain. | src/db/migrate.ts | high | implementer.md | 1 |

### Learnings written

- `implementer.md ## Learnings`: 10 entries added (cache key normalization, invalidateTable vs clear, indexExists cache use, getSchemaFlags cache, test behavior not key shape, cachedProbe helper, cachedQuery for repeated reads, TTL=0 passthrough).
- `quality-reviewer.md ## Learnings`: 4 entries added (cache key normalization, migrate invalidateTable, indexExists cache, test assert behavior not key shape).

### Durable patterns (suggest doc update)

- **docs/performance.md** (or architecture): Already documents Query Result Cache. Consider one line in "Decisions / gotchas": "Cache keys for parameterized reads must use stable serialization (e.g. sort object keys) so semantically equal options produce the same key."
- **docs/skills/** (if a migration or DB skill exists): "After single-table DDL, use cache.invalidateTable(tableName); use cache.clear() only when the migration affects all tables or the cache scope is process-local and short-lived."

---

## Summary

Evolve ran on the merged "DAL Query Cache" plan (squash 3a0d9ef). The reviewer identified 5 anti-patterns/gaps (cache key stability, coarse DDL clear, indexExists not using cache, schema flags bypassing status cache, tests coupled to key format) and 3 positive patterns (shared cache + cachedQuery, TTL=0 passthrough, single cache per migration run). Ten learnings were appended to implementer.md and four to quality-reviewer.md. Optional doc follow-up: one-line note on cache key stability in performance/architecture; migration skill note on invalidateTable vs clear.
