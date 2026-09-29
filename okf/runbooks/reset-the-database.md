---
type: Runbook
title: Reset the local vitest-agent database
description: How to wipe or locate a project's data.db after a schema-affecting source edit or a SQLite disk I/O error, including db reset's exact confirmation gates and the delete-the-sidecars-too caveat.
resource: ../../packages/cli/src/commands/db.ts
tags: [dx, architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-29T05:22:58Z
  body_sha256: 7c0200d4944a1bcd43b8631c3f3060649b9ff1db346f45a005ec7dd06a1706b6
sources:
  - id: db-ts
    resource: ../../packages/cli/src/commands/db.ts
  - id: doctor-ts
    resource: ../../packages/cli/src/commands/doctor.ts
  - id: resolve-data-path
    resource: ../../packages/engine/src/utils/resolve-data-path.ts
---

# Reset the local vitest-agent database

## Trigger

Any of:

- A change under `packages/*/src` or a new migration file was just built,
  and a stale local `data.db` may not reflect the new schema.
- The MCP server, or a `run_tests` call, reports a schema mismatch or a
  `SQLite disk I/O error`.

## Steps

1. **Rebuild first.** `pnpm build` — a schema or engine-code change is not
   live in a running CLI or MCP process until the compiled output is
   regenerated.
2. **Locate the database.** `vitest-agent db path` prints the resolved
   absolute path to `data.db` and always exits `0`, even before the file
   exists — the path is a function of workspace identity (the
   `resolveDataPath` precedence: a programmatic `cacheDir`, then
   `vitest-agent.config.toml`'s `cacheDir`, then its `projectKey`, then the
   normalized workspace `name`), not of file presence.[^resolve-data-path]
3. **Reset via the CLI, when running from a human terminal.**
   `vitest-agent db reset [--yes]` wipes `data.db` and its `-wal`/`-shm`
   companions.[^db-ts] Its confirmation gates run in this exact order:
   - **Gate 1 — agent-context block.** If `VITEST_AGENT_AGENT_ID` is set in
     the environment, the command refuses outright and exits `4` with
     `db reset is human-only; use db prune or run from a human
     terminal` on stderr — this command is deliberately unavailable to an
     agent session.[^db-ts]
   - **Gate 2 — non-interactive without `--yes`.** If stdout is not a TTY
     and `--yes` was not passed, it exits `5` with `db reset requires
     --yes when stdout is not a TTY` on stderr.[^db-ts]
   - **Gate 3 — interactive confirmation.** If stdout is a TTY and
     `--yes` was not passed, it prompts `Wipe <dbPath>? [y/N]:`; any
     answer other than `y`/`Y` prints `aborted` and exits `0` without
     touching the file.[^db-ts]
   - Only past all three gates does it delete `data.db`, then
     `data.db-shm`, then `data.db-wal`, tolerating a missing file at each
     step, and prints `Deleted database at <dbPath>`.[^db-ts]
4. **Or delete the files directly**, when scripting outside a human
   terminal is unavoidable: remove `data.db` **and** its `-wal` and `-shm`
   sidecars together. Deleting `data.db` alone while an MCP server (or any
   other process) still holds the file open for its WAL-mode connection
   produces a `SQLite disk I/O error` on the next read or write, because
   the connection's WAL/SHM state now points at a missing base file.
5. **Restart whatever holds the old connection open.** Restart the MCP
   server process (or the whole Claude Code session, since the plugin's
   MCP loader spawns the server once per session) so the next connection
   opens fresh against the now-absent (or freshly recreated) file.

## Observable end state

`vitest-agent doctor` reports its five checks clean against the
recreated database (starting from "no test run data found" immediately
after a wipe, which is the expected state until the next
run),[^doctor-ts] or the first subsequent `run_tests` / hook-driven write
recreates `data.db` from `PROJECT_MIGRATIONS` at its current schema
version with no I/O error.

## Related

- [Interface: cli](../interfaces/cli.md)
- [Gotcha: legacy reporter data root](../gotchas/legacy-reporter-data-root.md)
- [Module: engine](../modules/engine.md)
- [Runbook: Add a migration](add-a-migration.md)

[^db-ts]: `../../packages/cli/src/commands/db.ts:16-114`
[^doctor-ts]: `../../packages/cli/src/commands/doctor.ts:23-50`
[^resolve-data-path]: `../../packages/engine/src/utils/resolve-data-path.ts:29-49`
