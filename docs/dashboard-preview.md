# Dashboard preview

The image **dashboard-preview.png** in this folder is a mockup of the dashboard layout.

**To view the image:** open `docs/dashboard-preview.png` in Finder, your editor, or any image viewer.

**Dashboard layout:** `tg dashboard` (default) shows **three stacked sections**:

1. **Active Projects** — plan table (Plan, Todo, Blocked, Ready, Doing, Done) plus Total row.
2. **Active tasks** — tasks in “doing” only (Id, Task, Project, Stale, Status, Agent). When none: one row “No tasks being worked on atm”.
3. **Stats** — footer with KPIs (Projects done, Tasks done, agents, invocations, agent hours, etc.).

Row counts are capped from terminal height so the screen does not scroll. Run `pnpm build` then `tg dashboard`.

**TUI behaviour:** When OpenTUI is available (e.g. Bun), the dashboard uses it and updates content in place (only changed pixels redraw). When OpenTUI is unavailable or init fails (e.g. Node), the implementation falls back to a minimal TUI: setInterval, ANSI diff, and boxen-wrapped sections. See [CLI tables — Dashboard TUI](cli-tables.md#dashboard-tui-architecture-and-intent) for architecture and intent.
