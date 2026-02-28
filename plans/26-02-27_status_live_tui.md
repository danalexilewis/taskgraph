---
name: Status Live TUI
overview: Retired. tg status --live has been removed from the codebase; use tg status --dashboard for the live TUI. No tasks to execute.
fileTree: ""
risks: []
tests: []
todos: []
isProject: false
---

## Status: Retired

**tg status --live** has been removed from the codebase. The live-updating status TUI is **tg status --dashboard** only.

- **Code:** `--live` option and `options.live` usage were removed from `src/cli/status.ts`. Error messages now reference `--dashboard` only.
- **Docs:** `docs/cli-reference.md` documents only `--dashboard` for the live TUI.
- **Tests:** `__tests__/integration/status-live.test.ts` uses `--dashboard` (describe and cases updated).

There is **nothing left for this plan to execute**. Use this plan file only as a record that the former "Status Live TUI" scope (minimal --live, then follow-up after dashboard) is closed.

## Original prompt

<original_prompt>
Can we make a plan for a new tg status --live that shows a TUI that live updates?
</original_prompt>

**Resolution:** The dashboard plan (26-02-28) adds `tg dashboard` as the live TUI command; `tg status` is snapshot-only. This plan is retired with no tasks.
