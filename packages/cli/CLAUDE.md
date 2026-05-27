# vitest-agent-cli

The `@effect/cli`-based bin (`vitest-agent`) for utility functions, database management, and hook plumbing. For 2.0 the CLI is utility-only — MCP is the data path for test-landscape queries. The top-level tree is exactly three commands: `doctor`, `db`, and `agent`. Reads cached test data from SQLite via `DataReader`; never runs tests or calls AI providers. Required as a peerDependency by the plugin package.

## Layout

```text
src/
  bin.ts              -- bin entry: resolves dbPath via resolveDataPath,
                         provides CliLive(dbPath, logLevel?, logFile?)
                         to Command.run, runs via NodeRuntime.runMain;
                         withSubcommands is exactly doctor / db / agent
  index.ts            -- programmatic barrel: re-exports CliLive,
                         SidecarLive, registerAgentEffect, and the
                         lib/sidecar-paths.ts path helpers. Does NOT
                         re-export dispatch / injectEnv / exitCodeForTag —
                         those moved to vitest-agent-sdk/dispatch
  commands/           -- thin @effect/cli Command wrappers
    doctor.ts          -- top-level `doctor` diagnostic
    db.ts              -- `db` parent: path / prune / reset / query
    agent.ts           -- `agent` namespace parent: triage, wrapup,
                          record, register-agent, end-agent, inject-env,
                          sidecar-path
    record.ts triage.ts wrapup.ts
                       -- subcommand bodies composed under `agent`
  lib/                -- pure formatting + sidecar logic (where tests live)
    format-doctor.ts format-db-query.ts
    format-triage.ts format-wrapup.ts
    internal-register-agent.ts internal-end-agent.ts
    internal-inject-env.ts
    sidecar-paths.ts   -- path-resolution helpers + *_DB_FILENAME
                          constants; re-exported from src/index.ts.
                          exitCodeForTag moved to vitest-agent-sdk
  layers/
    CliLive.ts        -- (dbPath, logLevel?, logFile?) composition:
                         DataReader + ProjectDiscovery + HistoryTracker
                         + OutputPipeline + SqliteClient + Migrator
                         + NodeContext + NodeFileSystem + Logger
    SidecarLive.ts    -- per-project / per-client / registry SQLite scopes
                         backing the three sidecar subcommands
```

## Key files

| File | Purpose |
| ---- | ------- |
| `bin.ts` | Bin entry. Pipeline: `resolveDataPath(cwd)` -> provide `PathResolutionLive(projectDir) + NodeContext.layer` -> provide `CliLive(dbPath, ...)` -> `cli(process.argv)`. `withSubcommands` is `[dbCommand, doctorCommand, agentCommand]` |
| `commands/db.ts` | `db` parent with four subcommands. `db path` prints the deterministic XDG path (no probing); `db prune --keep-recent N` drops old sessions' turn history (default N=30); `db reset` wipes the DB (human-only, agent-blocked); `db query <sql>` runs read-only SQL |
| `commands/doctor.ts` | 5-point health diagnostic (manifest assembly, latest-run integrity, staleness check). Keeps `--format markdown\|json` |
| `commands/agent.ts` | `agent` namespace parent. Carries a `Command.withDescription` warning header ("Commands intended for agents and hook scripts — humans typically don't invoke these directly.") rendered above the subcommand list. Composes `triageCommand`, `wrapupCommand`, `recordCommand` plus the sidecar subcommands `register-agent`, `end-agent`, `inject-env` |
| `lib/format-db-query.ts` | Pure tabular formatter for `db query` output: column headers, whitespace-padded rows, `(0 rows)` on empty; `--format json` emits a JSON array of row objects |
| `lib/format-doctor.ts`, `lib/format-triage.ts`, `lib/format-wrapup.ts` | Pure formatting functions tested as plain functions; `format-triage` / `format-wrapup` are shared with the MCP package |
| `lib/sidecar-paths.ts` | Path-resolution helpers (`resolveProjectDataDir`, `resolveRegistryDir`, `resolveSessionMapPath`, the `*_DB_FILENAME` constants). Re-exported from `src/index.ts`. The dispatch core (`dispatch`, `injectEnv`, `exitCodeForTag`) moved to `vitest-agent-sdk/dispatch`; `agent.ts` imports `exitCodeForTag` / `injectEnv` from there |
| `layers/CliLive.ts` | Composition layer for the CLI runtime |
| `layers/SidecarLive.ts` | Composition layer backing the three sidecar subcommands under `agent` |

## Conventions

- **`@effect/cli` command pattern.** Each command in `commands/` is an
  `@effect/cli` `Command.make(...)`. Commands with non-trivial output
  delegate to a pure function in `lib/`; utility commands emit plain
  stdout text inline. Tests live next to the lib functions, not the
  commands (commands are too thin to test meaningfully).
- **`--format` is scoped, not universal.** Only `agent triage` and
  `agent wrapup` keep `--format markdown|json|silent`. `db query` has
  its own `--format table|json` axis (default `table`). `doctor` keeps
  `--format markdown|json`. Everything else emits plain stdout text by
  convention — no `--format` flag.
- **Read-only by default.** The CLI reads data via `DataReader`; it
  does not write to the DB. Keep this property -- mutations belong in
  the reporter (during a test run) or the MCP server (`note_*`).
- **`NodeRuntime.runMain` for the entry.** Defects print
  `formatFatalError(cause)` to stderr. Don't swap to `Effect.runPromise`
  at the top level; `runMain` handles signals and exit codes correctly
  for a CLI process.
- **Bin name vs package name.** Package `vitest-agent-cli` publishes
  the bin `vitest-agent` (no `-cli` suffix). The plugin's "Next steps"
  output references this short name.

## When working in this package

- This package depends on `vitest-agent-sidecar` (not the reverse). `resolveSidecarBinaryPath` is imported from `vitest-agent-sidecar` to back the `agent sidecar-path` subcommand. The per-platform sidecar children no longer import the CLI — they bundle `dispatch` from `vitest-agent-sdk/dispatch`. The old `cli → sidecar → sidecar-<platform> → cli` cycle is gone.
- Adding a subcommand: create or extend the `commands/<group>.ts`
  `@effect/cli` glue and wire it into the relevant parent's
  `withSubcommands` (`db`, `agent`, or the root in `bin.ts`). Only add
  a `lib/format-<name>.ts` + `.test.ts` pair when the command produces
  non-trivial structured output worth testing as a pure function;
  plain-text utility commands do not need a formatter.
- `record test-case-turns --chat-id <id>` is the canonical
  pattern for subcommands that call multiple `DataStore`/`DataReader`
  methods and return JSON to stdout (not markdown). It calls
  `DataStore.backfillTestCaseTurns(chatId)` then
  `DataReader.getLatestTestCaseForSession(chatId)` and outputs
  `{ "updated": N, "latestTestCaseId": <id|null> }`. Follow this
  pattern for any subcommand that needs to both mutate and read back
  a result.
- Need a new `DataReader` query: add it to `vitest-agent-sdk`'s `DataReader`
  service, then consume it from the command body. Don't reach into
  SQLite directly from the CLI — except `db query`, which opens
  `data.db` read-only by design.
- `db reset` is human-only: it refuses with exit code 4 when
  `VITEST_AGENT_AGENT_ID` is set, exit code 5 when stdout is not a TTY
  and `--yes` was not passed, and otherwise prompts `Wipe <path>?
  [y/N]:` on a TTY. It deletes `data.db` plus its `-shm` / `-wal`
  companions and is idempotent (a missing DB is success).
- `db query <sql>` opens the connection with the SqliteClient
  read-only flag so SQLite enforces no-write; mutation attempts and
  syntax errors surface as driver errors on stderr with exit code 3.
  Empty / whitespace-only SQL exits 2. Do not add parse-time SQL
  validation — engine enforcement is the contract.
- `db path` returns the resolved XDG path even when no DB has been
  written yet -- the path is a function of identity, not artifact
  presence. The pre-2.0 `node_modules/.vite/...` probing is gone.
- Adding a flag: `@effect/cli` validates types at the `Command` layer
  but the lib function should still accept a typed options object.
  Keep the lib function callable without `@effect/cli` for testing.
- Per-call layer construction is fine here (CLI is short-lived); only
  MCP uses `ManagedRuntime`.

## Design references

- `@./.claude/design/vitest-agent/components/cli.md`
  Load when working on subcommands, the `lib/format-*` functions, or
  the `record` subcommand pattern.
- `@./.claude/design/vitest-agent/data-flows.md`
  Load when tracing the CLI pipeline (Flow 3: CLI commands; Flow 6:
  plugin record hooks → CLI → DataStore, including the
  `record test-case-turns` mutate-and-read path).
- `@./.claude/design/vitest-agent/schemas.md`
  Load when adding a new `DataReader` query or working with output
  formatter types.

## The `agent` namespace

`commands/agent.ts` is a discoverable parent — its `--help` opens with the warning header "Commands intended for agents and hook scripts — humans typically don't invoke these directly." It composes the hook-driven utilities `triage`, `wrapup`, and `record` plus four sidecar subcommands:

- `agent register-agent` — composes projectKey resolution, RunContext git capture, PerClientSessionMapWriter, and DataStore.registerAgent end-to-end. Emits JSON to stdout with `agentId`, `conversationId`, `mainAgentId`, `idempotencyKey`, `idempotencyHit`. Hook scripts parse via `jq -r '.agentId'`.
- `agent end-agent` — sets `agents.ended_at` and optionally `session_map.ended_at` when `--host-session-id` is passed. SubagentStop omits the latter.
- `agent inject-env` — pure pattern matcher. Reads `VITEST_AGENT_*` from env and `package.json#scripts` from cwd; rewrites the command with the env prefix on Vitest match, returns the original on no-match.
- `agent sidecar-path` — calls `resolveSidecarBinaryPath()` from `vitest-agent-sidecar` and prints the absolute path of the installed platform binary to stdout (exit 0), or exits non-zero when no platform binary is resolvable. The SessionStart hook captures this path and exports it as `VITEST_AGENT_SIDECAR_BIN`.

The sidecar subcommand bodies live in `lib/internal-*.ts`.

**Barrel exports.** `src/index.ts` re-exports `CliLive`, `SidecarLive`, `registerAgentEffect`, and the `lib/sidecar-paths.ts` path helpers (`resolveProjectDataDir`, `resolveRegistryDir`, `resolveSessionMapPath`, the `*_DB_FILENAME` constants). It deliberately does NOT re-export `dispatch`, `injectEnv`, or `exitCodeForTag` — those ship from the `vitest-agent-sdk/dispatch` entry point. `commands/agent.ts` imports `exitCodeForTag` / `injectEnv` from `vitest-agent-sdk/dispatch`, and the per-platform `vitest-agent-sidecar-<platform>` SEAs import `dispatch` from there too. The dependency direction is one-way: `vitest-agent-cli` depends on `vitest-agent-sidecar` (to call `resolveSidecarBinaryPath` for the `agent sidecar-path` subcommand), not the reverse.

**SidecarLive layer** (`layers/SidecarLive.ts`) composes three SQLite scopes — per-project `data.db`, per-client `sessions.db`, registry `registry.db` — plus the platform context. Each store gets its own `SqlClient` connection.

**Sidecar resolves data paths** from `XDG_DATA_HOME` plus normalized `projectKey` directly (does not depend on workspace-discovery), so it works in non-pnpm-workspace project shapes.

**CLI flags for agent-facing IDs.** `record` subcommands take `--chat-id` (host chat UUID) and `--parent-chat-id`. The `wrapup` command takes `--chat-id` (host chat UUID) or `--row-id` (internal integer FK, mostly for debugging).
