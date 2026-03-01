---
triggers:
  files: ["src/**", "api/**", "docs/backend.md"]
  change_types: ["create", "modify"]
  keywords: ["backend", "api", "domain"]
---

# Backend

This doc is a **template stub**. Project-specific content has not been added. Tasks with `domain: backend` point here (`docs/backend.md`).

## Purpose

- What this domain owns
- What it explicitly does *not* own

## Key entrypoints

- `src/...`
- `api/...`

## Data + invariants

- Storage model, important tables/collections
- Cross-service contracts

## Local dev

- How to run the backend locally
- Required env vars / secrets handling

## Testing

- Unit/integration/e2e strategy
- Where tests live and how to run them

## Decisions / gotchas

- Important constraints and historical context

