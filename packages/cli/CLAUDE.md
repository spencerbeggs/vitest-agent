# vitest-agent-cli

The `@effect/cli`-based bin (`vitest-agent`) for on-demand test
landscape queries. Reads cached test data from SQLite via `DataReader`;
never runs tests or calls AI providers. Required as a peerDependency by
the plugin package.

## Layout

```text
src/
  bin.ts              -- bin entry: resolves dbPath via resolveDataPath,
                         provides CliLive(dbPath, logLevel?, logFile?)
                         to Command.run, runs via NodeRuntime.runMain
  index.ts            -- runCli() re-export for programmatic invocation
  commands/           -- thin @effect/cli Command wrappers
    status.ts overview.ts coverage.ts history.ts trends.ts
    cache.ts doctor.ts show.ts record.ts triage.ts wrapup.ts
    internal.ts        -- hidden `_internal` group (register-agent,
                          end-agent, inject-env) used by plugin hooks
  lib/                -- pure formatting logic (where tests live)
    format-status.ts format-overview.ts format-coverage.ts
    format-history.ts format-trends.ts format-doctor.ts
    format-show.ts
  layers/
    CliLive.ts        -- (dbPath, logLevel?, logFile?) composition:
                         DataReader + ProjectDiscovery + HistoryTracker
                         + OutputPipeline + SqliteClient + Migrator
                         + NodeContext + NodeFileSystem + Logger
```

## Key files

| File | Purpose |
| ---- | ------- |
| `bin.ts` | Bin entry. Pipeline: `resolveDataPath(cwd)` -> provide `PathResolutionLive(projectDir) + NodeContext.layer` -> provide `CliLive(dbPath, ...)` -> `cli(process.argv)` |
| `commands/cache.ts` | `cache path` prints the deterministic XDG path (no probing); `cache clean` deletes the directory |
| `commands/doctor.ts` | 5-point health diagnostic (manifest assembly, latest-run integrity, staleness check) |
| `commands/show.ts` | `vitest-agent show --project <name> --format auto\|agent\|human\|json` renders the latest cached run through the shared event-sourced renderer. Pulls `DataReader.getLatestRun`, passes the `AgentReport` to `formatShow` which routes through `synthesizeFromAgentReport` + `renderRun`. The `auto` format picks `human` for TTY stdout, `agent` otherwise |
| `lib/format-show.ts` | Pure formatter for the show command. Calls into `vitest-agent-ui` for the agent and human render paths; `json` returns the raw `AgentReport` dump |
| `lib/format-*.ts` | Pure formatting functions tested as plain functions; `commands/*.ts` are thin `@effect/cli` wrappers around these |
| `layers/CliLive.ts` | Composition layer for the CLI runtime |

## Conventions

- **`@effect/cli` command pattern.** Each command in `commands/` is an
  `@effect/cli` `Command.make(...)` that delegates to a pure function
  in `lib/`. Tests live next to the lib functions, not the commands
  (commands are too thin to test meaningfully).
- **`--format` on every command.** All user-facing subcommands accept
  `--format <markdown|json|silent|vitest-bypass>` (plus `show`'s
  additional `auto|agent|human` formats). The `OutputPipeline` and
  `OutputRenderer` services from `vitest-agent-sdk` handle dispatch;
  the lib functions produce `RenderedOutput[]`.
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

- Adding a subcommand: create `commands/<name>.ts` (the `@effect/cli`
  glue), `lib/format-<name>.ts` (the pure formatter), and
  `lib/format-<name>.test.ts`. Wire into the root `Command` group in
  `bin.ts`.
- `record test-case-turns --chat-id <id>` is the canonical
  pattern for subcommands that call multiple `DataStore`/`DataReader`
  methods and return JSON to stdout (not markdown). It calls
  `DataStore.backfillTestCaseTurns(chatId)` then
  `DataReader.getLatestTestCaseForSession(chatId)` and outputs
  `{ "updated": N, "latestTestCaseId": <id|null> }`. Follow this
  pattern for any subcommand that needs to both mutate and read back
  a result.
- Need a new `DataReader` query: add it to `vitest-agent-sdk`'s `DataReader`
  service, then consume it from `lib/format-*.ts`. Don't reach into
  SQLite directly from the CLI.
- `cache path` returns the resolved XDG path even when no DB has been
  written yet -- the path is a function of identity, not artifact
  presence. The pre-2.0 `node_modules/.vite/...` probing is gone.
- `--format=vitest-bypass` and `--format=silent` are valid; don't
  assume markdown output in lib functions.
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
  Load when tracing the CLI query pipeline (Flow 3: read-only landscape
  queries; Flow 6: `record test-case-turns` mutate-and-read flow).
- `@./.claude/design/vitest-agent/schemas.md`
  Load when adding a new `DataReader` query or working with output
  formatter types.

## Agent-agnostic taxonomy additions (Phases 2 + 4)

**Sidecar `_internal` subcommand group** (`commands/internal.ts`):

- `_internal register-agent` — composes projectKey resolution, RunContext git capture, PerClientSessionMapWriter, and DataStore.registerAgent end-to-end. Emits JSON to stdout with `agentId`, `conversationId`, `mainAgentId`, `idempotencyKey`, `idempotencyHit`. Hook scripts parse via `jq -r '.agentId'`.
- `_internal end-agent` — sets `agents.ended_at` and optionally `session_map.ended_at` when `--host-session-id` is passed. SubagentStop omits the latter.
- `_internal inject-env` — pure pattern matcher. Reads `VITEST_AGENT_*` from env and `package.json#scripts` from cwd; rewrites the command with the env prefix on Vitest match, returns the original on no-match.

**SidecarLive layer** (`layers/SidecarLive.ts`) composes three SQLite scopes — per-project `data.db`, per-client `sessions.db`, registry `registry.db` — plus the platform context. Each store gets its own `SqlClient` connection.

**Sidecar resolves data paths** from `XDG_DATA_HOME` plus normalized `projectKey` directly (does not depend on workspace-discovery), so it works in non-pnpm-workspace project shapes.

**CLI flag rename** (Phase 4 + 2026-05 chatId/sessionId/tddTaskId): `--cc-session-id` → `--chat-id`, `--parent-cc-session-id` → `--parent-chat-id` across `record` subcommands. The `wrapup` command's integer FK form moved to `--row-id` to free `--chat-id` for the host chat UUID. Plugin hook scripts updated to match.
