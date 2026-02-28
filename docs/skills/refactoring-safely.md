---
triggers:
  files: ["src/domain/**", "src/db/**", "src/cli/**", "src/plan-import/**", "src/export/**"]
  change_types: ["refactor"]
  keywords: ["refactor", "restructure", "rename"]
---

# Skill: Refactoring safely

## Purpose

Behavior-preserving changes; test before/after, small steps.

## Steps

1. Write tests to cover behavior.
2. Make incremental changes.

...