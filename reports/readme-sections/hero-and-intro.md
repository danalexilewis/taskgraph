# TaskGraph

**Dolt-backed CLI for centaur development.**

[![npm version](https://img.shields.io/npm/v/@danalexilewis/taskgraph.svg)](https://www.npmjs.com/package/@danalexilewis/taskgraph)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![GitHub stars](https://img.shields.io/github/stars/danalexilewis/Task-Graph?style=social)](https://github.com/danalexilewis/Task-Graph)

TaskGraph is inspired by ideas from Beads and Gastown but stays minimal and local-first. It gives you and your AI agents a shared task graph: plans, tasks, dependencies, and execution state—all stored in Dolt and driven from the CLI. It’s built for Cursor workflows where humans and agents collaborate on the same graph without heavy orchestration.

## What This Is

- **CLI + Dolt** for plans, tasks, dependencies, and execution state—versioned and queryable.
- **Multi-agent friendly**: 2–3 agents plus a human can work the same graph with clear ownership and coordination.
- **Rich plan format**: structured plans (YAML frontmatter, todos) that import cleanly and drive task execution.
- **MCP server**: `tg-mcp` exposes task graph operations to Cursor and other MCP clients.
- **Sub-agent architecture**: skills, leads, and workers so the orchestrator can dispatch specialized agents (implementer, reviewer, investigator, etc.) per task.

## What This Isn't

- **Not Gastown-style orchestration**—no full pipeline or convoy control; TaskGraph is a shared task store and CLI, not an execution conductor.
- **No convoys or swarms**—you run agents (e.g. in Cursor); TaskGraph tracks what to do and who’s doing it.
- **Not a project management tool**—it’s a **development execution tool**: same repo, same tasks, human and agents moving work to done.
