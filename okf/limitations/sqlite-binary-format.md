---
type: Limitation
title: The persisted database is a binary SQLite file, not a human-readable cache
description: "data.db is not diffable in a text editor, not greppable, and not visible in a git diff; the escape hatch is the CLI's db query subcommand (a read-only SQL surface) or an ordinary sqlite3 client, not the file itself."
bounds: ../models/sqlite-schema.md
tags: [architecture, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
sources:
  - id: db-command
    resource: ../../packages/cli/src/commands/db.ts
integrity:
  generated:
    body: 071ca30e15ef4b73
---

# The persisted database is a binary SQLite file, not a human-readable cache

`data.db` stores every persisted table — test runs, errors, coverage
reports, failure history, TDD artifacts — as SQLite's own binary page
format. There is no parallel JSON cache and no plan to add one; SQLite is
the single source of truth this family writes to.

**Condition.** Any attempt to read, diff, or grep `data.db` directly —
opening it in a text editor, running `git diff` against it (it is not
tracked, but a human sometimes expects to inspect a cache file this way),
or `cat`-ing it in a terminal.

**Symptom.** The file is opaque: binary bytes, no line structure, no
diff-friendly format. A human who reaches for the habits that work on a
JSON cache — reading it directly, diffing two snapshots, grepping for a
string — gets nothing usable.

**Why this is acceptable.** SQLite buys ACID transactions, concurrent
reads across multiple `AgentReporter` instances and the MCP server,
efficient indexed queries, relational integrity via foreign keys, and
migration-based schema evolution — none of which a JSON file gets for
free. The CLI and MCP tool surface already cover every access pattern an
agent or a human needs without touching the file directly: `db query`
runs a read-only, arbitrary SQL statement against the database and
prints the result as a table or JSON,[^db-command] and the `doctor`
command surfaces higher-level health checks. A human who wants raw SQL
access outside that surface can always point an ordinary `sqlite3`
client at the resolved path from `db path`.

**What a fix would take.** Nothing planned — this is an accepted
trade-off, not a queued fix. A parallel export (e.g. `db query` writing
CSV/JSON to a file, or a dedicated dump command) would be additive
tooling on top of the existing read-only query surface rather than a
change to the storage format itself.

[^db-command]: `../../packages/cli/src/commands/db.ts:153-188`
