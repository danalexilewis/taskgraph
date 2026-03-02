# Review: OpenTUI Dashboard vs Ecosystem Usage

**Date:** 2026-03-02  
**Scope:** How others use OpenTUI vs how we use it for the dashboard, and what we need to do so the dashboard looks great with our TUI libraries (boxen, cli-table3, chalk).  
**Produced by:** Orchestrator review (OpenTUI docs, codebase, @opentui/core API).

---

## Scope

Review was requested because the dashboard still looks bad. This report compares OpenTUI’s intended usage (docs, examples) with our current implementation and recommends changes so the dashboard looks great while keeping or adapting our existing TUI libraries.

## How others use OpenTUI

From [Getting started](https://opentui.com/docs/getting-started/), [Constructs](https://opentui.com/docs/core-concepts/constructs/), [Layout](https://opentui.com/docs/core-concepts/layout/), [Text](https://opentui.com/docs/components/text/), [Box](https://opentui.com/docs/components/box/):

| Aspect | Typical usage |
|--------|----------------|
| **Structure** | Compose UI from **OpenTUI components**: `Box( props, ...children )`, `Text( { content, fg, bg } )`. Children are separate nodes, not one big string. |
| **Layout** | **Yoga flexbox**: `flexDirection`, `justifyContent`, `alignItems`, `padding`, `gap`, `width`/`height` (fixed or `"100%"`). Box is the flex container; layout is driven by the component tree. |
| **Borders** | **Box only**: `border: true`, `borderStyle: "single" | "double" | "rounded" | "heavy"`, optional `title` / `titleAlignment`. No pre-drawn borders in text. |
| **Colors** | **OpenTUI-native**: `Text({ content: "...", fg: "#00FF00" })` or the `t` template: `t\`${bold(fg("#FFFF00")("text"))}\``. StyledText / TextChunk for rich inline styling. |
| **Tables** | **TextTableRenderable**: `content: TextTableContent` (array of rows of TextChunk[]). Built-in borders, column sizing (`columnWidthMode`, `columnFitter`), selection. |
| **Rendering** | Each Text holds plain or StyledText content. No single blob of pre-rendered ANSI from other libs. |

So the ecosystem pattern is: **build the tree from OpenTUI primitives and let OpenTUI handle layout, borders, and colors**.

## How we use OpenTUI

| Aspect | Our usage |
|--------|-----------|
| **Structure** | **One Box** (root) containing **one Text** node. The Text’s `content` is a single string: the full output of `formatStatusAsString()`. |
| **Content** | `formatStatusAsString()` uses **boxen** (section boxes), **cli-table3** (table chars), **chalk** (ANSI colors). Result is one pre-rendered string with embedded ANSI and Unicode box-drawing. |
| **Layout** | We pass `width: getTerminalWidth()` and `height: "auto"` on the root Box. No flex children, no gap/padding between sections — everything is one Text blob, so OpenTUI does not do section-level layout. |
| **Borders** | **Double borders**: (1) Our string already contains **boxen** boxes (`borderStyle: "double"`). (2) We wrap that in an OpenTUI **Box** with `border: true`, `borderStyle: "round"`. So we see our box-drawing plus their outer border. |
| **Tables** | We use **cli-table3** (and our `renderTable()` wrapper) to produce table *strings*. Those strings are concatenated into the one big string. We do not use OpenTUI’s TextTable. |
| **Styling** | All styling is chalk ANSI inside the string. We do not use OpenTUI’s `fg`/`bg` or `t` template; we rely on ANSI passthrough. |

So our pattern is: **one pre-rendered ANSI string from boxen + cli-table3 + chalk, dropped into a single Text inside one bordered Box**.

## Findings by area

### 1. Double borders and visual noise

- **Evidence:** `live-opentui.ts` builds `rootBox = Box({ borderStyle: "round", border: true, width: w, ... }, Text({ content: newContent }))`. `newContent` is from `formatStatusAsString(..., { dashboard: true })`, which calls `boxedSection()` multiple times (`status.ts`). Each `boxedSection()` uses boxen with `borderStyle: "double"` (or ASCII when `TG_ASCII_DASHBOARD=1`).
- **Result:** The terminal shows an outer rounded OpenTUI border around content that already has inner boxen double borders. That looks busy and can misalign or clip.

### 2. No use of OpenTUI layout

- **Evidence:** Root has one child (Text). Sections (Active Projects, Active tasks and upcoming, footer) are not separate Box or Text nodes; they are newline-separated substrings inside one content string.
- **Result:** We don’t get OpenTUI’s flex layout, padding, or gap. Resize and alignment are driven by our string width (we pass `w` into `formatStatusAsString` and boxen), not by OpenTUI’s layout engine. Wrapping/measuring can differ from OpenTUI’s native behavior.

### 3. Mixed styling model

- **Evidence:** Colors and emphasis come from chalk in `status.ts` (e.g. `chalk.cyan`, `chalk.yellow`). OpenTUI’s Text supports `fg`, `bg`, and StyledText/`t` for colors and attributes.
- **Result:** We’re not using OpenTUI’s theme or `renderer.themeMode`. In terminals that don’t handle ANSI well, or if OpenTUI ever normalizes/strips ANSI, our colors could change or disappear. One consistent model (either all ANSI or all OpenTUI) would be more predictable.

### 4. Tables: string vs native

- **Evidence:** Tables are built with `renderTable()` (cli-table3) and concatenated into the dashboard string. OpenTUI exposes `TextTableRenderable` with `content: TextTableContent` (rows of TextChunk[]), `showBorders`, `borderStyle`, etc.
- **Result:** We get no selection, no OpenTUI-driven column sizing, and table borders are our Unicode/ASCII chars inside the blob. Font/encoding issues (e.g. replacement glyphs) affect our table chars; native TextTable would use OpenTUI’s drawing.

### 5. Unicode and ASCII fallback

- **Evidence:** We added `TG_ASCII_DASHBOARD` for boxen and table chars. Status still uses Unicode symbols (✓ ● ▲ ◆ — ⚠) in the formatted string.
- **Result:** In poor terminal/font setups, the dashboard can still look bad because of those symbols. A single “ASCII mode” that also replaces symbols would make the OpenTUI and fallback outputs consistently readable.

---

## Risk summary

| Risk | Level | Note |
|------|--------|------|
| Visual quality / “looks bad” | **High** | Double borders, single-blob layout, and Unicode/symbols directly cause the current poor look. |
| Regression if we refactor | **Medium** | Moving to native OpenTUI layout and tables touches status formatting and live-opentui; fallback path must stay in sync. |
| Dependency on ANSI passthrough | **Low** | OpenTUI currently passes our string through; if a future version parses or strips ANSI, we’d need to switch to OpenTUI styling. |

---

## Recommendations

Ranked by impact vs effort so the dashboard can “look great” with our TUI libs.

1. **Remove double border (quick win)**  
   - In `live-opentui.ts`, set the root Box to **`border: false`** (or omit border) so we don’t draw an OpenTUI border around content that already has boxen borders.  
   - **Effect:** One set of borders (ours), less noise.  
   - **Effort:** One prop change.

2. **Optional: OpenTUI-only border (no boxen in OpenTUI path)**  
   - When rendering with OpenTUI, build the dashboard from **multiple Box + Text** nodes: one Box per section (e.g. “Active Projects”, “Active tasks and upcoming”, footer) with `borderStyle: "rounded"`, `title`, `padding`, and a single **Text** child whose `content` is the *plain* section content (no boxen).  
   - Keep using `renderTable()` for the table *string* per section so we don’t rewrite table logic yet; only remove boxen for the OpenTUI path.  
   - **Effect:** Consistent OpenTUI borders and padding; layout can use `flexDirection: "column"`, `gap`, and `padding`.  
   - **Effort:** Medium (split `formatStatusAsString` into section content + structure, or add an OpenTUI-specific builder that uses the same data and table formatting).

3. **Use OpenTUI TextTable for dashboard tables (larger refactor)**  
   - Replace table *strings* in the OpenTUI path with OpenTUI’s **TextTableRenderable**: build `TextTableContent` (rows of TextChunk[]) from the same data we use for `renderTable()`.  
   - Use OpenTUI’s `fg`/`bg` or StyledText for header vs body styling.  
   - **Effect:** Native table borders and layout, consistent with OpenTUI, and better behavior in odd terminals.  
   - **Effort:** Higher (data → TextChunk[][] adapter, possibly shared with fallback for structure but not rendering).

4. **Unified ASCII/symbol fallback**  
   - When `TG_ASCII_DASHBOARD=1` (or `useAsciiBorders()`), also replace status symbols (✓ → `[x]`, ● → `*`, ▲ → `^`, ◆ → `-`, ⚠ → `!`, — → `-`) in the formatted string.  
   - **Effect:** Readable dashboard in all terminals; same behavior for OpenTUI and fallback.  
   - **Effort:** Low (symbol mapping in status formatting).

5. **Document `TG_ASCII_DASHBOARD`**  
   - Add to `docs/cli-reference.md` or `docs/infra.md`: when the dashboard looks garbled (boxes/symbols as replacement glyphs), set `TG_ASCII_DASHBOARD=1`.  
   - **Effort:** Trivial.

6. **Longer term: OpenTUI-native styling**  
   - For the OpenTUI path only, stop using chalk in the dashboard string; build StyledText or use `Text({ content: "...", fg: "..." })` (and optionally `renderer.themeMode`) so all color and emphasis come from OpenTUI.  
   - **Effect:** One styling model in OpenTUI, theme-aware, no ANSI dependency.  
   - **Effort:** Medium–high (section-by-section migration, or a small adapter from our data to OpenTUI Text/Box/TextTable).

---

## Summary

Others use OpenTUI by composing Box and Text (and TextTable) with native layout and styling; we currently put one big boxen+cli-table3+chalk string into a single Text inside a bordered Box, which causes double borders and no real use of OpenTUI layout or tables. To make the dashboard look great: (1) remove the outer OpenTUI border for a quick win; (2) optionally move to multiple OpenTUI Boxes per section and drop boxen in the OpenTUI path; (3) consider OpenTUI TextTable and native styling for a cleaner, consistent TUI. Completing ASCII/symbol fallback and documenting `TG_ASCII_DASHBOARD` will help in poor terminal environments.
