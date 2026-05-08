---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-03-20
updated: 2026-05-07
last-synced: 2026-05-07
completeness: 90
related:
  - ./architecture.md
  - ./schemas.md
  - ./data-flows.md
  - ./file-structure.md
  - ./decisions.md
dependencies: []
---

# Data Structures — `vitest-agent`

System layout, persisted shapes, and end-to-end flows. This document is an
index — load the sub-file that matches your task.

**Parent document:** [./architecture.md](./architecture.md)

## Sub-files

| File | Load when working on |
| ---- | -------------------- |
| [./schemas.md](./schemas.md) | TypeScript types, Effect Schema definitions, the SQLite table inventory, the reporter contract types, turn payload union, channel events, DataStore/DataReader I/O types |
| [./data-flows.md](./data-flows.md) | tracing how data moves end-to-end (reporter lifecycle, AgentPlugin, CLI commands, MCP server, plugin spawn, record hooks, tRPC idempotency middleware) |
| [./file-structure.md](./file-structure.md) | navigating the repo, the XDG data-path resolution stack, project-name keying inside the DB, package-manager detection, the `vitest-agent.config.toml` shape |

Each sub-file is self-contained for its slice and cross-references
[./decisions.md](./decisions.md) and [./components/](./components/) where
the rationale or per-package implementation lives.
