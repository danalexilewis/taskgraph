# OpenTUI Dashboard Compatibility Investigation

**Date:** 2026-03-02  
**Scope:** Whether OpenTUI supports the dashboard stack and what “passing in stuff raw” referred to on another branch.  
**Produced by:** Orchestrator analysis (codebase + @opentui/core inspection).

---

## Scope

User asked if OpenTUI supports the other libraries we use (boxen, cli-table3, chalk) and recalled that another branch had to do something about “passing in stuff raw” to OpenTUI. This report documents how content flows into OpenTUI and whether any special raw handling is needed.

## Files examined

| Location | Purpose |
|----------|---------|
| `src/cli/tui/live-opentui.ts` | Dashboard OpenTUI path: `Text({ content: newContent })` with pre-rendered string from `formatStatusAsString` |
| `src/cli/status.ts` | `formatStatusAsString`, boxen, cli-table3, chalk — single string with ANSI + Unicode |
| `node_modules/@opentui/core/renderables/Text.d.ts` | `TextOptions.content?: StyledText \| string` |
| `node_modules/@opentui/core/lib/styled-text.d.ts` | `stringToStyledText(content: string): StyledText` |
| `node_modules/@opentui/core/index.js` (lines 4258, 4285) | String content passed through `stringToStyledText(value)` before assignment |
| `node_modules/@opentui/core/index-qr7b6cvh.js.map` | Source map: `stringToStyledText` implementation |

## Root cause analysis

- **Current flow:** Dashboard builds one string (boxen + table + chalk ANSI + Unicode), passes it to OpenTUI as `Text({ content: newContent })`. OpenTUI does **not** parse or strip ANSI; it wraps the entire string in a single `StyledText` chunk and renders that.
- **Evidence:** In the bundled source (from the map), `stringToStyledText` is:
  ```ts
  const chunk = { __isChunk: true as const, text: content };
  return new StyledText([chunk]);
  ```
  So the string is passed through as one opaque chunk; the terminal receives our ANSI and Unicode unchanged.
- **Garbled rendering** (box-drawing as diamonds/dots) was traced to terminal/font Unicode support, not to OpenTUI altering the string. `TG_ASCII_DASHBOARD=1` was added to use ASCII borders and table chars; status symbols (✓ ● ▲ ◆) are not yet ASCII-safe when that env is set.

## Hypothesis evidence

| Claim | Evidence |
|-------|----------|
| OpenTUI does not parse ANSI in string content | `stringToStyledText` only wraps `content` in one chunk; no ANSI parsing in styled-text or Text path. |
| We are effectively “passing raw” already | Same pre-rendered string is used for both OpenTUI and fallback; OpenTUI does not transform it. |
| “Raw” on another branch may differ | No code in this repo strips ANSI for OpenTUI or writes directly to stdout for dashboard; plan text (26-02-28) only mentions “ANSI clear between redraws” and “shared snapshot render.” |

## Gaps found

- No in-repo implementation of a different “raw” path (e.g. direct stdout, or stripping ANSI before OpenTUI). The recollection may refer to another branch or a different feature.
- OpenTUI’s `ansi.d.ts` only exports VT helpers (alternate screen, cursor, etc.); no “raw text” or “passthrough” option was found in the Text/TextBuffer API.
- Status symbols (✓ ● ▲ ◆ — ⚠) are not yet replaced with ASCII when `TG_ASCII_DASHBOARD=1`.

## Recommendations

1. **No change required for “raw”** — Current approach (one string into `Text({ content })`) is already passthrough; no extra raw handling needed for OpenTUI compatibility with boxen/cli-table3/chalk output.
2. **Optional: ASCII symbols when `TG_ASCII_DASHBOARD=1`** — In status formatting, when `useAsciiBorders()` is true, map symbols to ASCII (e.g. ✓→`[x]`, ●→`*`, ▲→`^`, ◆→`-`, ⚠→`!`) so the OpenTUI dashboard matches the fallback in poor terminal/font setups.
3. **Optional: Document `TG_ASCII_DASHBOARD`** — Add to `docs/cli-reference.md` or `docs/infra.md` so users know to set it when the dashboard renders garbled.

---

## Summary

OpenTUI is compatible with the current stack: string content is wrapped in a single StyledText chunk and not parsed, so ANSI and Unicode are passed through. The “passing in stuff raw” memory likely refers to another branch or a different approach; no such path exists in the current dashboard code. Garbled output is addressed by `TG_ASCII_DASHBOARD` for borders/tables; extending that to status symbols would complete ASCII-safe rendering.
