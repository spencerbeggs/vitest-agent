---
type: Decision
title: SQLite over JSON Files
description: The data layer is one normalized SQLite database per cache directory, not per-run JSON files, for atomicity, concurrent access, and cross-project queries.
status: stable
tags:
  - architecture
  - performance
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 80a55ef55f9a30adf04b6ff6f94e08e8e8dd8aa3240d9064bf8ccdd15e07f1cb
sources:
  - id: engine-platform
    resource: ../../packages/engine/src/platform.ts
  - id: engine-migration-0001
    resource: ../../packages/engine/src/migrations/0001_initial.ts
  - id: engine-migrations-index
    resource: ../../packages/engine/src/migrations/index.ts
  - id: engine-package-json
    resource: ../../packages/engine/package.json
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# SQLite over JSON Files

## Context

The data layer needs to survive concurrent writers (a monorepo's Vitest
projects each instantiate their own reporter against the same cache
directory), answer queries across projects (history, trends, coverage
baselines), and evolve its schema over time without breaking consumers
who already have data on disk. The rejected starting point was inspecting
Vite's own cache JSON files for analytics data directly, which turned out
to be unworkable: the JSON had no strong typing, suffered race conditions
under parallel reads and writes, and was routinely wiped by ordinary
package-manager operations that touch Vite's cache directory.

## Decision

The data layer is a normalized schema in a single SQLite file per cache
directory, at an XDG-derived path. SQLite provides everything JSON files
could not: ACID transactions, concurrent reads via WAL journal mode,
efficient queries across projects and runs, relational integrity via
foreign keys, FTS5 for note search, and migration-based schema evolution
that lets the same `data.db` survive being read by an old and a new
version of the tooling during a rollout.

The one composition layer both front ends and the plugin share is the
engine's `makeSqliteStack(filename, migrations?)`, which builds the
`SqliteClient` layer and a `SqliteMigrator` layer fed by
`SqliteMigrator.fromRecord(migrations)`, defaulting to the project's
`PROJECT_MIGRATIONS` record.[^engine-platform] `PlatformLive`, the one
platform composite the CLI, MCP server, and plugin's `ReporterLive` all
build from, wraps this stack with the data layer and the output pipeline
on top.[^engine-platform] The very first migration statement sets the
database's operating mode before any table exists: `PRAGMA
journal_mode=WAL` followed by `PRAGMA foreign_keys=ON`, so every
subsequent connection to the file inherits concurrent-read semantics and
enforced referential integrity from the start.[^engine-migration-0001]
`PROJECT_MIGRATIONS` is the single source of truth for the project
database's migration set — every consumer that calls
`SqliteMigrator.fromRecord` without overriding the default reaches the
same schema.[^engine-migrations-index]

On Effect v4 the SQL core (`SqlClient`, `SqlError`, `Statement`) lives in
`effect/sql`, and the driver, `@effect/sql-sqlite-node`, now runs
on Node's built-in `node:sqlite` (`DatabaseSync`) rather than a native
`better-sqlite3` binding — the engine's dependency list carries
`@effect/sql-sqlite-node` and no native SQLite addon at
all.[^engine-package-json] That removal matters operationally: no
compiled native binding means no per-platform prebuild step and no
node-gyp rebuild on a Node version bump for this dependency specifically.

## Alternatives rejected

**Continuing to read Vite's own cache JSON files.** The starting point,
and the reason this decision exists at all: no strong typing on the JSON
shape, race conditions under concurrent reader/writer access with no
transactional guarantee, and routine loss whenever a package manager
operation touched Vite's cache directory. None of the three problems is
fixable by changing how the JSON is read; they are properties of the
storage format itself.

**Per-run JSON files under the cache directory (one file per test run or
per project).** Would avoid single-file contention at the cost of
file-proliferation in a monorepo with many packages and many runs, no
transactional cross-file guarantee (a crash mid-write could leave a
project's history and its trend file disagreeing), and no efficient way
to query across projects or runs without reading and parsing every file.

**A native SQLite binding (`better-sqlite3`) instead of `node:sqlite`.**
Superseded once Node's built-in `node:sqlite` module reached the
functionality `@effect/sql-sqlite-node`'s v4 driver needs; keeping the
native binding would have meant carrying prebuilt platform binaries for
this dependency in addition to the ones the family already ships for the
sidecar SEA binaries.

## Consequences

Every consumer that wants project data goes through the engine's
`DataStore`/`DataReader` services rather than reading files directly, so
the storage format is free to evolve behind that interface. Schema
changes are append-only migrations rather than in-place edits — a
published package's users may hold a `data.db` from an older schema
version, so `0001_initial.ts` and every migration after it is treated as
frozen once shipped, with backfills and `ALTER` statements in new
migration files instead. The cost is the migration discipline itself:
adding a column to an existing table with data is a multi-step ALTER +
backfill rather than a one-line schema edit, and `WAL` mode means the
cache directory carries `-wal`/`-shm` sidecar files that a naive `rm
data.db` leaves behind, corrupting the next open. See
[DataModel: sqlite-schema](../models/sqlite-schema.md) for the table
inventory this schema produces, and
[Runbook: add-a-migration](../runbooks/add-a-migration.md) for the
step-by-step append-only procedure.

[^engine-platform]: `../../packages/engine/src/platform.ts` (`makeSqliteStack`), `../../packages/engine/src/platform.ts` (`PlatformLive`)
[^engine-migration-0001]: `../../packages/engine/src/migrations/0001_initial.ts`
[^engine-migrations-index]: `../../packages/engine/src/migrations/index.ts`
[^engine-package-json]: `../../packages/engine/package.json`
