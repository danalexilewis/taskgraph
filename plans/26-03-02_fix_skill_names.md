---
name: Fix Skill Name Consolidation
overview: Rename assess-risk to risk and pattern-tasks to meta; update docs and references.
fileTree: |
  .cursor/skills/
  ├── assess-risk/    (rename to risk)
  ├── risk/           (new)
  ├── pattern-tasks/  (rename to meta)
  ├── meta/           (new)
  ├── review/         (unchanged)
  └── ...
  docs/leads/
  ├── assess-risk.md  (rename to risk.md)
  ├── risk.md         (new)
  ├── pattern-tasks.md (rename to meta.md)
  ├── meta.md         (new)
  └── README.md       (update registry)
risks:
  - description: Rename may break links to SKILL.md paths
    severity: medium
    mitigation: update all references in SKILL.md and docs
tests:
  - "Verify .cursor/skills/risk/SKILL.md exists and has correct name frontmatter"
  - "Verify .cursor/skills/meta/SKILL.md exists and has correct name frontmatter"
  - "Verify docs/leads/risk.md and docs/leads/meta.md exist with updated titles"
  - "Verify docs/leads/README.md registry entries updated"
todos:
  - id: rename-assess-risk-to-risk
    content: "Rename assess-risk directory and docs to risk"
    agent: implementer
    intent: |
      Move `.cursor/skills/assess-risk/` to `.cursor/skills/risk/`. Update `SKILL.md` frontmatter `name: risk`. Rename `docs/leads/assess-risk.md` to `docs/leads/risk.md` and update its title.
  - id: rename-pattern-tasks-to-meta
    content: "Rename pattern-tasks directory and docs to meta"
    agent: implementer
    intent: |
      Move `.cursor/skills/pattern-tasks/` to `.cursor/skills/meta/`. Update `SKILL.md` frontmatter `name: meta`. Rename `docs/leads/pattern-tasks.md` to `docs/leads/meta.md` and update its title.
  - id: update-references
    content: "Update references to assess-risk and pattern-tasks across docs and SKILL.md files"
    agent: implementer
    intent: |
      In all `.md` files under `.cursor/skills/` and `docs/`, replace `/assess-risk` with `/risk` and `/pattern-tasks` with `/meta`. Ensure links to lead docs are updated accordingly.
isProject: false
---
