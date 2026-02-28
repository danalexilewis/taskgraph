---
name: Cheap Gate Typecheck Hygiene
overview: Implement recommendations from docs/research/cheap-gate-typecheck-lint-failures.md — document OpenTUI/tsconfig isolation, remove redundant @types/minimatch, and verify gate resilience.
fileTree: |
  docs/
  ├── research/
  │   └── cheap-gate-typecheck-lint-failures.md   (existing — source of truth)
  └── testing.md                                  (modify — add Typecheck section)
  package.json                                    (modify — remove @types/minimatch)
risks:
  - description: Removing @types/minimatch breaks typecheck
    severity: low
    mitigation: minimatch v10 ships built-in types; pnpm lock marks @types/minimatch deprecated; verify with pnpm typecheck:all after removal
  - description: New doc conflicts with memory
    severity: low
    mitigation: Keep doc minimal; point to research doc; memory remains primary for dev/tooling quirks
tests:
  - "Gate passes after changes (pnpm gate and pnpm gate:full)"
todos:
  - id: opentui-tsconfig-doc
    content: Add Typecheck and OpenTUI section to docs/testing.md
    agent: implementer
    intent: |
      Add a short section to docs/testing.md documenting that OpenTUI is Bun-only and must stay out of type scope.
      tsconfig already isolates it (include: src/**/*.ts, exclude: node_modules, types: ["node"]).
      Reference docs/research/cheap-gate-typecheck-lint-failures.md for full rationale.
      No code changes — doc only.
    changeType: document
  - id: remove-types-minimatch
    content: Remove @types/minimatch from devDependencies
    agent: implementer
    intent: |
      Remove @types/minimatch from devDependencies in package.json.
      minimatch v10.2.4 provides its own types (dist/commonjs/index.d.ts).
      Run pnpm install after removal; verify pnpm typecheck and pnpm typecheck:all pass.
    suggestedChanges: |
      In package.json devDependencies, delete the line:
        "@types/minimatch": "^6.0.0"
    changeType: modify
  - id: verify-gate
    content: Run gate and gate:full; confirm both pass
    agent: implementer
    intent: |
      After tasks opentui-tsconfig-doc and remove-types-minimatch complete, run:
        pnpm gate
        pnpm gate:full
      If both pass, mark done. If either fails, capture the exact error and fix (or escalate).
      This validates that doc and dep changes did not introduce regressions.
    blockedBy: [opentui-tsconfig-doc, remove-types-minimatch]
    changeType: modify
---

## Dependency graph

```
Parallel start (2 unblocked):
  ├── opentui-tsconfig-doc
  └── remove-types-minimatch

After both:
  └── verify-gate
```

## Context

Research in `docs/research/cheap-gate-typecheck-lint-failures.md` identified:

1. **OpenTUI/bun:ffi** — OpenTUI is Bun-only; our tsconfig already isolates it. Document this so future changes don't add bun-types.
2. **minimatch** — @types/minimatch is redundant; minimatch v10 ships its own types. Removing it reduces risk of type conflicts.
3. **context/crossplan/table** — No errors observed in current run; no action unless concrete failures reappear.

## Scope

- Doc-only for OpenTUI; no tsconfig changes.
- Single dep removal for minimatch.
- Verification step to confirm gate still passes.

<original_prompt>Review findings from docs/research/cheap-gate-typecheck-lint-failures.md and write up a plan to implement the recommendations.</original_prompt>
