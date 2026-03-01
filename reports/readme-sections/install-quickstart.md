## Installation

**Prerequisites**

- **Node.js** ≥ 18
- **Dolt** — install via Homebrew: `brew install dolt`
- **Bun** (optional) — for running the CLI with Bun

Install the Task Graph CLI as a dev dependency:

```bash
pnpm add -D @danalexilewis/taskgraph
```

Run commands with `pnpm tg` or `npx tg`:

```bash
pnpm tg init
pnpm tg setup   # optional: scaffold docs and Cursor rules
```

---

## Quick Start

End-to-end workflow with concrete commands:

```bash
# 1. Install
pnpm add -D @danalexilewis/taskgraph

# 2. Initialize the task graph in this repo
pnpm tg init

# 3. (Optional) Scaffold docs and Cursor conventions
pnpm tg setup

# 4. Create a plan file (e.g. plans/my-plan.md in Cursor format)
# Then import it:
pnpm tg import plans/my-plan.md --plan "My Plan" --format cursor

# 5. See runnable tasks
pnpm tg next --plan "My Plan"

# 6. Start a task (replace <taskId> with a task from next)
pnpm tg start <taskId> --agent my-agent

# 7. After doing the work, mark it done
pnpm tg done <taskId> --evidence "Implemented X; ran pnpm gate"

# 8. Check status
pnpm tg status --tasks
```

For full command and option details, see [docs/cli-reference.md](../docs/cli-reference.md).
