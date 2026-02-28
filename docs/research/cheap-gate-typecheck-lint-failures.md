# Research: Cheap-Gate Typecheck/Lint Failures

Structured investigation of the reported gate failures: OpenTUI/bun:ffi, minimatch, and context/crossplan/table typecheck or lint errors. Goal: identify root causes and actionable fixes.

---

## 1. Current state (repro)

- **Lint:** `pnpm lint` (biome check) — **passes** (82 files, no fixes).
- **Typecheck (default):** `pnpm typecheck` runs `scripts/typecheck.sh` — only **changed** `src/**/*.ts` vs HEAD. With no changed src files, it skips; with current repo state it **passes**.
- **Typecheck (full):** `pnpm typecheck:all` (tsc --noEmit) — **passes**.
- **Gate:** `bash scripts/cheap-gate.sh` — lint + typecheck (changed files) + affected tests. No typecheck or lint failures observed in this run; gate can fail on **tests** (e.g. timeout) or when **changed files** include the reported paths.

So the “existing” typecheck/lint failures are likely **conditional**: they appear when (a) different tsconfig/types are in scope (e.g. Bun), (b) different git state (those files changed), or (c) CI/IDE typechecking with different options.

---

## 2. OpenTUI and bun:ffi

**What it is:** `@opentui/core` is a Bun-only TUI library (Zig core, TypeScript bindings). It depends on **bun-ffi-structs** and is built for Bun; Node/Deno support is in progress.

**Relevance:** We use OpenTUI only behind a **dynamic import** in `src/cli/tui/live-opentui.ts` with a short timeout; on failure we fall back to a minimal TUI. We never statically import `@opentui/core` in our `src/` tree.

**Why bun:ffi can appear:**

- If TypeScript (or the IDE) ever type-checks inside `node_modules` (e.g. when resolving types from `@opentui/core`), it can pull in Bun/FFI types. That fails in a **Node-only** environment (no `bun` or `bun-types`).
- Our **tsconfig** keeps this at bay: `"include": ["src/**/*.ts"]`, `"exclude": ["node_modules","dist"]`, `"types": ["node"]`, `skipLibCheck: true`. So we don’t type-check OpenTUI or its deps, and we don’t load Bun types.

**Gaps it fills:** N/A — we’re not missing a feature; we’re avoiding type-checking a Bun-only dependency in a Node-focused build.

**Adoption cost:** N/A for “fixing” — the fix is to **keep** the current isolation (no Bun types in tsconfig, no typecheck of node_modules for this package).

**Recommendations:**

- **Keep** `"types": ["node"]` and **do not** add `bun-types` to the main app tsconfig used by `tsc` and the gate. (See also `.cursor/memory.md` → Typecheck (tsconfig).)
- If the gate or CI ever runs with Bun’s type checker or a tsconfig that includes `node_modules`/Bun types, **restrict typecheck to our code**: same as today (include only `src/**/*.ts`, exclude node_modules, skipLibCheck). Optionally document in a short “Typecheck and OpenTUI” note under `docs/` or memory that OpenTUI is Bun-only and must not be in the type-check scope for the Node-based gate.

---

## 3. Minimatch

**What it is:** We use `minimatch` (v10.2.4) in `src/domain/doc-skill-registry.ts` for glob matching. We also have `@types/minimatch` (v6) in devDependencies.

**Relevance:** Minimatch v10 **ships its own types** (`dist/commonjs/index.d.ts`). `@types/minimatch` v6 is a **stub** that defers to the package’s built-in types. Having both is redundant but should not cause a type error unless an older or conflicting version is resolved.

**Usage:** We call `minimatch(path, pattern)`; the built-in signature is `(p: string, pattern: string, options?)`, so usage is correct.

**Gaps it fills:** N/A — no functional gap; only risk is duplicate/conflicting type sources.

**Adoption cost:** **Low.** Remove `@types/minimatch` from devDependencies and rely on minimatch’s built-in types to avoid any chance of conflict. If something else in the tree (or a different tool) depends on `@types/minimatch`, we can leave it; current setup typechecks successfully.

**Recommendations:**

- Prefer **dropping** `@types/minimatch` and using minimatch’s built-in types only.
- If gate or IDE ever reports minimatch-related errors, confirm that resolved minimatch is v10+ and that no other package is forcing an older `@types/minimatch` (e.g. via resolutions/overrides).

---

## 4. context.ts / crossplan.ts / table.ts

**What they are:** `src/cli/context.ts`, `src/cli/crossplan.ts`, and `src/cli/table.ts` are core CLI modules. The user reported typecheck/lint failures for “context/crossplan/table” in the same breath as OpenTUI/minimatch.

**Relevance:** No linter or typecheck errors were observed in these files in the current run (lint clean, `tsc --noEmit` pass). Failures are likely **state-dependent**: e.g. only when these files are in the “changed” set and some past edit introduced an error that’s since been fixed, or when a different tool (Bun, different tsc, or stricter config) runs.

**Recommendations:**

- Treat these as **same as rest of repo**: ensure typecheck runs over `src/**/*.ts` with the same tsconfig (node types, skipLibCheck, no node_modules). No special handling needed unless a concrete error reappears.
- If an error **does** reappear: capture the exact command (e.g. `pnpm typecheck` vs `pnpm typecheck:all` vs `bun test`), the full error message, and the tsconfig in use; then fix the offending file or adjust the script/tsconfig so the gate stays Node-only and src-only.

---

## 5. Summary and recommendations (by impact/effort)

| Priority | Action                                                                                                                                                    | Impact                                                               | Effort          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------- |
| 1        | Keep tsconfig Node-only (`"types": ["node"]`), no typecheck of node_modules for OpenTUI. Document if needed.                                              | Prevents bun:ffi and OpenTUI-related type failures in gate/CI.       | None / doc-only |
| 2        | Remove `@types/minimatch` and rely on minimatch’s built-in types.                                                                                         | Reduces risk of minimatch type conflicts.                            | Low             |
| 3        | If gate fails again: run `pnpm typecheck:all` and `pnpm lint` and capture exact errors; fix or narrow typecheck to changed-files-only with same tsconfig. | Addresses any reappearing context/crossplan/table (or other) errors. | As needed       |

**Vendor/ecosystem notes:**

- **OpenTUI:** Bun-exclusive; uses `bun-ffi-structs`. We intentionally isolate it via dynamic import and do not type-check it in the Node-based gate.
- **minimatch:** v10+ has built-in types; `@types/minimatch` is redundant; removing it is a small hygiene improvement.
- **Bun:** If you ever want to run the gate (or typecheck) under Bun, keep a separate tsconfig for that which either (a) still only includes `src/**/*.ts` and excludes node_modules, or (b) uses Bun’s defaults but accepts that OpenTUI’s deps may pull in ffi types — and document the choice.

---

_Research date: 2026-02-28. Sources: repo tsconfig, typecheck.sh, cheap-gate.sh, package.json, OpenTUI npm page, Bun/TS docs, minimatch type definitions._
