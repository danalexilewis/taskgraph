# Evolve: TUI docs and intent — 2026-03-02

**Scope:** Recent dashboard/OpenTUI work (merged on main). No plan branch available; evolution focused on documenting current state and clarifying intent.

## Summary

The TUI work is in a good place: OpenTUI is the primary path under Bun (multi-Box layout, TextTable, themed panels), with a reliable ansi-diff fallback when OpenTUI is unavailable. This evolve pass updated docs so that "what we want" and how the dashboard behaves are explicit for future changes.

## Changes made

### 1. docs/dashboard-preview.md

- Corrected layout description: **two** stacked tables → **three** stacked sections (Active Projects, Active tasks and upcoming, Stats).
- Added short description of each section.
- Added **TUI behaviour**: OpenTUI when available (in-place updates), fallback to minimal TUI (setInterval + ANSI diff + boxen), with link to cli-tables.md § Dashboard TUI.

### 2. docs/cli-tables.md

- **New section: "Dashboard TUI: architecture and intent"** — single source of truth for:
  - **What we want:** Responsive, stable live dashboard; in-place updates when possible; three sections; reliable fallback.
  - **Primary path (OpenTUI):** Bun, `live-opentui.ts`, root Box + three child Boxes, TextTable for Projects/Tasks, Stats as Text; in-place updates via `updateDefaultDashboardSections`.
  - **Fallback path:** Node or init failure → setInterval, ANSI clear, same content via `formatStatusAsString`, ansi-diff to minimise flicker.
  - **Do not simplify or remove** the three sections.
  - **Timeouts:** 3000 ms (import), 2000 ms (renderer init); do not reduce (see memory.md).
  - **ASCII-safe:** `TG_ASCII_DASHBOARD=1` (infra.md); status symbols may still be Unicode.
  - **Typecheck:** OpenTUI Bun-only, out of Node typecheck scope (testing.md, research).
- **Triggers:** Added `src/cli/tui/live-opentui.ts` and keywords `dashboard`, `OpenTUI` so doc-skill-registry assigns this doc when TUI code changes.

## Findings (no plan-branch diff)

No formal anti-pattern review was run (plan branch no longer exists; TUI work already merged). No new learnings were appended to implementer.md or quality-reviewer.md from this pass. The work was documentation-only to capture intent and current behaviour.

## Durable patterns (suggest doc update)

- **Done.** Dashboard TUI intent and architecture are now in `docs/cli-tables.md`. Timeouts and env are documented there and in `docs/infra.md` / `.cursor/memory.md`.

## Related

- Plan (merged): `26-03-02_opentui-dashboard-normalise.md`
- Reports: `review-opentui-dashboard-vs-ecosystem-2026-03-02.md`, `opentui-dashboard-compatibility-2026-03-02.md`
- Memory: OpenTUI/ghostty-opentui startup timeout (3000/2000 ms)
