# Reprioritise report

**Date:** 2026-03-03

## Are these the right projects?

**Yes, with focus.** The active set mixes gate/quality (Gate Full Triage, Gate Full Root Cause Fixes), infrastructure (Dolt, integration-test isolation, perf audit), and product (Initiative-Project-Task Hierarchy, Status/Dashboard cache, Strategic Planning). That’s a reasonable spread. Prioritising gate and Dolt first keeps the suite and data safe; then hierarchy and cache improve daily use and CLI responsiveness. Draft plans (Doc Review Benchmark, Custom Benchmark, Review Next Docs, Dolt Data Loss Hardening) add runnable work without overloading the board—keep them in the list but below active gate/infra/product work.

## Prioritised project list

1. **Gate Full Triage** — Get gate green; 2 runnable (fix pre-existing assertions, then run gate:full).
2. **Gate Full Root Cause Fixes** — One runnable (run gate:full and verify); unblock confidence in main.
3. **Dolt Service Hardening and Dashboard Fix** — One runnable (gate:full); 1 task doing; finish before other Dolt work.
4. **Initiative-Project-Task Hierarchy** — 5 runnable in next 20; core product model (initiative/project/plan terminology).
5. **Status and Dashboard Cache Integration** — 2 runnable; improves status/dashboard speed (memoize tableExists, clear cache on mutations).
6. **Integration Test Isolation Improvements** — 2 runnable (migrations warning, batch migration checks); 4 blocked; runnable tasks move test infra forward.
7. **Strategic Planning Implementation** — 2 runnable (plan-format/plan-import docs, product analyst lead); 6 blocked.
8. **Perf Audit Remediation — Test Infra, Schema Indexes, CLI Speed** — 1 runnable (PID registry for per-test Dolt servers); 5 blocked.
9. **Doc Review Benchmark** — 3 runnable (accuracy summary, cli-reference review, benchmarking.md verify); draft.
10. **Custom Benchmark Suite (Option C)** — 1 runnable (.benchmark structure and README); draft; 5 blocked.
11. **Review Next Read-Only and Write-Command Docs** — 2 runnable; draft; 1 blocked.
12. **Dolt Data Loss Hardening** — 1 runnable (.gitattributes for noms); draft.

**Dashboard alignment:** The Projects board shows a maximum of 5 projects. The top 5 above (Gate Full Triage → Status and Dashboard Cache Integration) are the ones that should appear first when the dashboard is limited to 5.

## Ready count

- **Before:** 20 runnable (from `tg next --json --limit 50`).
- **Target:** ≥ 10.
- **After:** 20 runnable.

No change needed; Ready count already meets the target.

## Actions taken

- **None.** No reordering or activation was required. Ready ≥ 10; the mix of active and draft plans with runnable work is sufficient.
