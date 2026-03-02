# Assessment Specialists Proposal — 2026-03-02

**Goal:** Suggest new assessment specialist roles that add perspective value, inspired by OpenAI, Anthropic, and Google evaluation frameworks. These complement existing reviewers (spec-reviewer, quality-reviewer, reviewer, test-quality-auditor).

---

## Current assessment roles (brief)

| Role | Focus | When used |
|------|--------|-----------|
| **spec-reviewer** | Did the implementation match task intent and acceptance criteria? | Two-stage review, stage 1 |
| **quality-reviewer** | Code quality: error handling, style, patterns, tests | Two-stage review, stage 2 |
| **reviewer** | General PASS/FAIL or research (findings, no verdict) | Single-stage review or /investigate |
| **test-quality-auditor** | Test quality and improvement suggestions | Audit of test approach |
| **test-infra-mapper** | Map and document test infrastructure | Discovery |
| **test-coverage-scanner** | Coverage gaps | Discovery |

---

## Lab practices mapped to Task-Graph

| Source | Practice | Task-Graph analogue |
|--------|----------|----------------------|
| **OpenAI** | Preparedness (capability × risk); scorecards (Critical/High/Medium/Low); evals for jailbreaks, hallucinations, instruction hierarchy | Risk/preparedness assessor; factuality vs spec |
| **Anthropic** | Red-team scaffold (suspicion, attack selection, plan synthesis, execution, subtlety); sabotage evals (code sabotage, sandbagging, undermining oversight); reasoning faithfulness | Adversarial/security reviewer; traceability reviewer |
| **Google** | Responsibility lifecycle (Research, Design, Govern, Share); Govern/Map/Measure/Manage; fairness and factuality in toolkit; LLM Comparator (side-by-side) | Fairness/equity auditor; risk governance reviewer |
| **LLM evals (general)** | Factuality, safety, security, code quality, fairness; rubric-based (technical, argumentative, explanation); citation, clarity, completeness | Factuality specialist; security reviewer; rubric-driven reviewer |

---

## Proposed new specialists (prioritised)

### 1. **Adversarial / security reviewer** (red-team style)

**Inspired by:** Anthropic red teaming and sabotage evals; OpenAI jailbreak resistance; Google SAIF.

**Purpose:** Read-only. Actively look for misuse, injection/escape risks, and subtle harmful behaviors in the change set. Questions: Could this code path be triggered by malicious input? Are there unescaped user/Dolt values? Could an agent or user game the task graph (e.g. mark done without doing work)?

**Adds value:** Spec and quality reviewers check “correct and clean”; this one checks “safe and hard to abuse.” Distinct perspective.

**Dispatch when:** After spec + quality pass for security-sensitive areas (CLI, MCP, plan-import, db layer); or on demand for a given task/plan.

**Output:** VERDICT: PASS / CONCERNS / FAIL with specific risks and severity (low/medium/high). No code edits.

---

### 2. **Risk / preparedness reviewer** (scorecard style)

**Inspired by:** OpenAI Preparedness Framework and scorecards; Google Govern/Measure/Manage.

**Purpose:** Read-only. For a given change or plan: what could go wrong in deployment, ops, or rollback? Rate impact and likelihood; suggest mitigations. Focus on “if we ship this, what breaks or degrades?”

**Adds value:** Complements the existing **risk** skill (which is plan/proposal-focused). This specialist is change-set-focused: “given this diff and this plan, what’s the risk scorecard?”

**Dispatch when:** Before merging high-impact work (schema, CLI contract, worktree lifecycle); or as part of a release gate.

**Output:** Short scorecard (e.g. Critical/High/Medium/Low per category: correctness, ops, rollback, data) + 2–3 top mitigations. No code edits.

---

### 3. **Factuality / traceability reviewer** (claims vs reality)

**Inspired by:** OpenAI hallucination evals; Anthropic reasoning faithfulness; Google factuality in Responsible AI Toolkit; LLM-Rubric factuality dimension.

**Purpose:** Read-only. Check that implementation and docs stay aligned with facts: do code comments and docs match behavior? Do task intent and suggested_changes trace to the diff? Are domain rules (e.g. schema, glossary) reflected in the change?

**Adds value:** Spec-reviewer asks “did you do what was asked?”; this one asks “do the claims in code and docs match reality and the rest of the system?” Catches drift and doc/comment hallucination.

**Dispatch when:** After spec pass for doc-heavy or domain-touching tasks; or for any change that touches `docs/` or critical comments.

**Output:** PASS / FAIL with specific inconsistencies (e.g. “Comment says X; code does Y” or “docs/schema.md says Z; migration does not enforce Z”). No code edits.

---

### 4. **Fairness / equity auditor** (task-graph and process)

**Inspired by:** Google fairness in Responsible AI; rubric fairness dimensions.

**Purpose:** Read-only. Audit the **task graph and process**, not a single diff. Are some plans or agents systematically blocked or under-served? Are there ownership or priority skews? Is the runnable set representative of intended work?

**Adds value:** No current role looks at system-wide fairness of the workflow. Useful for multi-agent and initiative balance.

**Dispatch when:** On demand (e.g. “audit fairness of current projects”) or periodically; input = `tg status --tasks`, `tg status --projects`, optionally initiative rollup.

**Output:** Structured report: summary, skews, suggested rebalances (e.g. unblock task X, or add human decision for Y). No graph edits.

---

### 5. **Rubric-driven reviewer** (dimension scoring)

**Inspired by:** LLM-Rubric multidimensional calibrated evaluation; Promptfoo llm-rubric; PEARL (technical, argumentative, explanation rubrics).

**Purpose:** Read-only. Evaluate a change (or plan) against a **configurable rubric**: e.g. technical correctness, clarity of explanation, completeness, citation of docs. Return per-dimension scores (e.g. 0–1) and pass/fail per criterion, not a single PASS/FAIL.

**Adds value:** When you want granular, explainable scores (e.g. for benchmarking implementers or plans) rather than a single verdict. Can be used for A/B comparison (Google-style “comparator”) of two implementations.

**Dispatch when:** Benchmarking, plan comparison, or when a plan explicitly requests rubric-based evaluation.

**Output:** JSON or structured report: `{ dimensions: [ { name, score, pass, reasoning } ], overall: pass|fail }`. No code edits.

---

## Summary table

| Specialist | Main question | Lab inspiration | Distinct from existing? |
|------------|----------------|------------------|---------------------------|
| **Adversarial / security** | Is this safe and hard to abuse? | Anthropic red team, sabotage; OpenAI jailbreaks | Yes — no one does adversarial by default |
| **Risk / preparedness** | What could go wrong if we ship this? | OpenAI scorecards; Google Govern/Measure | Yes — risk skill is proposal-level; this is change-level |
| **Factuality / traceability** | Do claims in code/docs match reality? | OpenAI hallucinations; Anthropic reasoning faithfulness; Google factuality | Yes — spec checks intent; this checks consistency of facts |
| **Fairness / equity** | Is the task graph and process balanced? | Google fairness | Yes — no system-wide process auditor |
| **Rubric-driven** | How does this score on each dimension? | LLM-Rubric; Promptfoo; PEARL | Yes — others give single verdict; this gives multi-dimension scores |

---

## Suggested rollout

1. **First:** Add **adversarial/security reviewer** and **factuality/traceability reviewer** — highest leverage and clear boundaries with spec/quality.
2. **Second:** Add **risk/preparedness reviewer** — reuse risk skill concepts at change level.
3. **Third:** Add **fairness/equity auditor** and **rubric-driven reviewer** — when you need process audit or benchmark-style evals.

Each needs: a lead doc in `docs/leads/`, an agent template in `.cursor/agents/`, and an entry in `.cursor/rules/available-agents.mdc`. Optionally a skill (e.g. `/review-security`) that dispatches the right specialist.
