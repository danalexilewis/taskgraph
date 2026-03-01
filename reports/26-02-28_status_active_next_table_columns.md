# Rescope: tg status "Active & next" table layout

## Directive (from you)

For the second table in `tg status` (the **Active & next** table):

- **Id column:** Should be thin; the short hash is always under 10 characters, so this column must not be wide. The agent name must not appear in the Id column (it should appear only in the Agent column).
- **Task column:** Should be wider so task titles don’t wrap as much.
- **Plan column:** Should be truncated (e.g. ellipsis), not wrapped.
- **Agent column:** Should contain the agent (when present); the agent name belongs here, not in Id.

## Current state (assessed)

- **Table:** Built in `getMergedActiveNextContent()` in `src/cli/status.ts`. Rows are `[displayId, title, plan_title, status, agent]`. Headers: Id, Task, Plan, Status, Agent. `minWidths: [10, 12, 10, 6, 6]`.
- **Layout:** `renderTable()` in `src/cli/table.ts` treats **the first column (Id) as the flex column**: it gets all extra space when the table is under `maxWidth`, and it is the first column shrunk when over. So Id is currently the widest column when there’s room, which makes it look like it’s “holding” other content when the table wraps. With `wordWrap: true`, wrapped text in any column can wrap; if Id is wide, the visual alignment can make it look like the agent text is under the Id header.
- **Agent value:** For _doing_ tasks we set the 5th column to `body?.agent ?? "—"`. For _todo_ tasks we set it to `"—"` (no one has started). So the Agent column does contain the agent when the task is _doing_; for _todo_ it correctly shows a dash. The data is not being put in the Id column; the issue is column widths and flex.
- **Plan:** No truncation; `renderTable` only does word wrap, so long plan titles wrap onto multiple lines.

## Gaps and clarifications

- **Gap 1 — Id column too wide / agent appears under Id:** The first column is the global flex column, so Id gets extra width. That plus wrapping can make it look like the agent name is in the Id column. **Desired:** Id column is fixed and thin (e.g. max ~10 chars); only the hash (or truncated UUID) appears there.
- **Gap 2 — Task column too narrow:** Task is column 1 with minWidth 12; it doesn’t get flex space. **Desired:** Task column is wider (e.g. becomes the flex column or gets a larger share of space so titles don’t wrap as much).
- **Gap 3 — Plan wraps instead of truncating:** Plan uses the same wrap behavior as other columns. **Desired:** Plan column truncates long values with ellipsis (e.g. "Long Plan Name…") instead of wrapping.
- **Gap 4 — Agent column:** We already put the agent in the Agent column for _doing_ tasks; for _todo_ we show "—". **Clarification:** If you want the Agent column to show something else for _todo_ (e.g. `task.owner` or "—" is fine), that’s a product choice; current behavior is "—" for unstarted tasks.

## Recommended next steps

- [ ] **Option A (recommended):** Implement column-layout changes for the Active & next table only:
  1. **Id thin, Task flex:** Either (a) extend `renderTable` to accept an option like `flexColumnIndex: 1` (so Task is flex instead of Id), or (b) give this table a **max width for column 0** (e.g. `maxWidths: [10, …]`) and keep Id at 10 so Task gets the remaining space. Then set `minWidths` so Id is small (e.g. `[10, 20, 12, 6, 8]`) and Task has room to grow.
  2. **Plan truncated:** In `getMergedActiveNextContent`, truncate `plan_title` to a fixed length (e.g. 16–20 chars) with "…" before passing rows to `renderTable`, so Plan doesn’t wrap.
  3. **Agent:** No change if current semantics (agent for doing, "—" for todo) are correct; ensure Agent column has enough min width (e.g. 8) so the agent name doesn’t wrap badly.
- [ ] **Option B:** Broader change in `renderTable`: add optional `flexColumnIndex` and/or `maxWidths` so any status table can choose which column flexes and which stay fixed/capped. Then use that in the Active & next table and optionally in others.
- [ ] **Option C:** No code change; document the intended column behavior (Id thin, Task wide, Plan truncated, Agent shows agent) in `docs/cli-reference.md` and open a follow-up task for implementation.

**Implemented (Option B):** `renderTable` in `src/cli/table.ts` now accepts `flexColumnIndex` (default 0) and `maxWidths`. The Active & next table in `src/cli/status.ts` uses `flexColumnIndex: 1` (Task is flex), `maxWidths: [10]` (Id capped at 10), and truncates plan titles to 18 chars with "…". Existing renderTable and status tests pass.
