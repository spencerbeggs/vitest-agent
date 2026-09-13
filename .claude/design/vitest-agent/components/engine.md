---
status: current
module: vitest-agent
category: architecture
created: 2026-09-13
updated: 2026-09-13
last-synced: 2026-09-13
completeness: 92
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ../schemas.md
  - ../file-structure.md
  - ./sdk.md
  - ./plugin.md
  - ./cli.md
  - ./mcp.md
dependencies: []
---

# Engine package (`@vitest-agent/engine`)

The platform half of the former `@vitest-agent/sdk`, split out under
issue #412 (Decision 70 in [../decisions.md](../decisions.md)). Owns everything
that touches a filesystem, SQLite or an environment map: the Effect
services and their Live / Test layers, the data layer (`DataStore` /
`DataReader`), the SQLite client + migrator stack and the migrations, the
XDG path-resolution stack, the one platform composite (`PlatformLive`),
the one project-directory resolver (`resolveProjectDir`), the hook-driven
programs the CLI commands wrap and the MCP server calls, and the
`./testing` presets. The platform-free core it sits on — schemas,
contracts, errors, pure formatters and utils — stays in
[./sdk.md](./sdk.md).

**npm name:** `@vitest-agent/engine`
**Location:** `packages/engine/`
**Rank:** 3 (Decision 70)
**Internal dependencies:** `@vitest-agent/sdk` only
**Consumers:** `@vitest-agent/cli`, `@vitest-agent/mcp`, `@vitest-agent/plugin`
(`reporter`, `ui` and the sidecar children never import it)
**Entry points:** two — `.` (the main barrel) and `./testing` (in-process
SQLite test infrastructure)

**Key external dependencies:**

- `@effect/platform-node` — `NodeServices.layer` (FileSystem | Path |
  ChildProcessSpawner | Crypto | Stdio | Terminal), re-exported as
  `NodePlatformLayer`
- `@effect/sql-sqlite-node` — the v4 driver on Node's built-in
  `node:sqlite`; `SqliteClient.layer` and `SqliteMigrator`
- `@effected/xdg` — `AppDirs.layer({ namespace, fallbackDir? })` over
  `Xdg.layer`
- `@effected/config-file` (+ its `@effected/{jsonc,toml,walker,yaml}` codec
  peers) — TOML config resolution for `vitest-agent.config.toml`
- `@effected/workspaces` — `WorkspaceDiscovery`, `WorkspaceRoot`,
  `WorkspaceRootNotFoundError`, plus the sync helpers the plugin's
  config-load path uses
- `std-env` — `isAgent` / `agent` for four-environment detection
- `effect` (v4, `catalog:effect`)

## Rule: no `process` reads anywhere under `src/`

`packages/engine/__test__/boundaries.test.ts` walks every `.ts` under
`src/` through the shared comment-stripping scanner
(`__test__/utils/boundaries.ts`) and asserts that **no file** references
`process.` — there is no allowlist — and that no file imports
`@vitest-agent/cli`, `@vitest-agent/mcp`, `@vitest-agent/plugin`,
`@vitest-agent/reporter` or `@vitest-agent/ui`. The single exemption is the
exact token `process.env.__PACKAGE_VERSION__`, a compile-time literal the
bundler substitutes, which may appear only in `src/version.ts`; the test
asserts the token's user list is exactly `["version.ts"]`.

The consequence is that every ambient input a program needs is a
parameter: `env` (the front end passes `process.env`), `cwd`
(`process.cwd()`), `homeDir` (`env.HOME ?? env.USERPROFILE`). Layers that
used to read `process.env` at construction are factories —
`EnvironmentDetectorLive(env)`, `RunContextLive(env)`,
`OutputPipelineLive(env)`, `LoggerLive(logLevel?, logFile?)` with
`resolveLogLevel(env)` / `resolveLogFile(env)` — and the XDG root is read
from the injected `env` by installing it as the `ConfigProvider` under
`Xdg.layer` (see *Hook paths* below). Two reads the textual scanner cannot
see are recorded as follow-ups in Decision 70: `std-env` evaluates
`process.env` at module load, and the scanner does not match
`process["env"]`.

Core types and pure helpers come in only through
`import … from "@vitest-agent/sdk"` — never by relative path across the
package boundary. Three names (`ArtifactKind`, `ArtifactSuite`, `Phase`)
are exported from both barrels because `services/DataStore.ts` re-exports
them from the core's `validate-phase-transition`; import them from sdk.

## `PlatformLive` — the one platform composite

`packages/engine/src/platform.ts`. Replaces the per-front-end `CliLive` /
`McpLive` composites and the plugin's inline SQLite assembly.

```ts
export const PlatformLive = (options: PlatformOptions): Layer.Layer<PlatformServices, MigrationError | SqlError> => {
 const { SqliteLayer, MigratorLayer } = makeSqliteStack(options.dbPath);
 return Layer.mergeAll(ProjectDiscoveryLive, HistoryTrackerLive, OutputPipelineLive(options.env)).pipe(
  Layer.provideMerge(DataReaderLive),
  Layer.provideMerge(DataStoreLive),
  Layer.provideMerge(MigratorLayer),
  Layer.provideMerge(SqliteLayer),
  Layer.provideMerge(NodePlatformLayer),
  Layer.provideMerge(LoggerLive(options.logLevel, options.logFile)),
 );
};
```

`PlatformOptions` is `{ dbPath, env, logLevel?, logFile? }`.
`PlatformServices` is the full union the merge provides — `DataReader |
DataStore | ProjectDiscovery | HistoryTracker | EnvironmentDetector |
ExecutorResolver | FormatSelector | DetailResolver | OutputRenderer |
NodeServices | SqliteClient | SqlClient` — because cli, mcp and the plugin
all rely on the five pipeline services, not only `OutputRenderer`. The
merge order is the old `CliLive`'s (the superset). `PlatformLive` is a
factory, so each call mints a fresh layer reference; the CLI's `main.ts`,
the MCP `main.ts` and the plugin's `ReporterLive` each call it exactly
once per process.

`makeSqliteStack(filename, migrations = PROJECT_MIGRATIONS)` is the shared
builder underneath: `{ SqliteLayer, MigratorLayer }` where the migrator is
`SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(migrations) })`
already fed its `SqlClient` and the Node platform services. Its callers
are `PlatformLive`, `ensureMigrated`, `testing/layers.ts#makeTestLayer`
and `programs/platform-sidecar.ts` (three stacks: project / session-map /
registry, each with its own migration record). `NodePlatformLayer` is
`NodeServices.layer`.

The plugin's `ReporterLive(options: PlatformOptions)` is
`CoverageAnalyzerLive.pipe(Layer.provideMerge(PlatformLive(options)))` —
the plugin-only `CoverageAnalyzer` stays in the plugin (see
[./plugin.md](./plugin.md)).

## `resolveProjectDir` — the one project-directory resolver

`packages/engine/src/project-dir.ts`. Pure:

```ts
resolveProjectDir({ env, cwd }): string
```

Precedence: `VITEST_AGENT_PROJECT_DIR` (the hook-driven override the
plugin's shared hook lib exports from `CLAUDE_PROJECT_DIR`) →
`VITEST_AGENT_REPORTER_PROJECT_DIR` (the plugin loader's hand-off to the
spawned MCP server) → `CLAUDE_PROJECT_DIR` → `cwd`. An empty string counts
as unset. Both front ends call it from `main.ts`; before this the CLI
honored only `VITEST_AGENT_PROJECT_DIR` and the MCP server only the other
two, so a hook running from a sub-package cwd could resolve a different
`data.db` than the MCP server and silently split TDD evidence across two
databases. In every deployed path the hook lib sets
`VITEST_AGENT_PROJECT_DIR`, so the resolved directory is unchanged.

## Programs (`src/programs/`)

The hook-driven programs the CLI's `agent` commands wrap and the MCP
server calls. They moved here from `packages/cli/src/lib/` and
`packages/mcp/src/session-env.ts` so both front ends are thin wrappers
and the logic is process-free.

| File | Exports | Notes |
| --- | --- | --- |
| `hook-paths.ts` | `resolveHookPaths({ env, projectKey })`, `resolveSessionMapPath(env)`, `DATA_DB_FILENAME` / `SESSIONS_DB_FILENAME` / `REGISTRY_DB_FILENAME`, `HookEnv`, `HookPaths`, `HookPathsError` | Resolves all three sidecar store paths (`{ dataRoot, projectDataDir, perProjectDbPath, registryDbPath, sessionMapDbPath }`) and creates every directory. Effect-shaped, `R = FileSystem \| Path`. See *Hook paths* below |
| `platform-sidecar.ts` | `SidecarPlatformLive(paths, env)`, `SidecarPaths` | The three-database composite for the sidecar subcommands: per-project `data.db` (`DataStoreLive`, `DataReaderLive`), per-client `sessions.db` (`PerClientSessionMapLive`), global `registry.db` (`DiscoveryRegistryLive`), each on its own `makeSqliteStack` with its own migration record and uniquely-tagged client, plus `RunContextLive(env)`. `SidecarPaths` is a structural subset of `HookPaths` |
| `register-agent.ts` | `registerAgentEffect(input)`, `RegisterAgentProgramInput` / `RegisterAgentProgramOutput` | Maps host session id + transcript path to canonical conversation / agent ids, captures git context, writes session-map rows, and is the sole writer of `sessions.conversation_id` (insert-time field plus the `setSessionConversationIdIfNull` backstop). The `Program*` type names avoid a barrel collision with `DataStore`'s `RegisterAgentInput` |
| `end-agent.ts` | `endAgentEffect`, `EndAgentInput` | Sets `agents.ended_at`; with a host session id also `session_map.ended_at` |
| `record-session.ts` | `recordSessionStart`, `recordSessionEnd` | `sessions` insert / `ended_at` + `end_reason` update |
| `record-turn.ts` | `parseAndValidateTurnPayload`, `recordTurnEffect` | Decodes the JSON payload against the `TurnPayload` union, resolves the session, writes the turn (fanout handled by `DataStore.writeTurn`). `cwd` required |
| `record-tdd-artifact.ts` | `recordTddArtifactEffect`, `recordTddArtifactByTaskIdEffect`, `dispatchRecordTddArtifactEffect` | The only write path for `tdd_artifacts` (D7). `cwd` required; `R` adds `FileSystem`. See [./cli.md](./cli.md) for the `--chat-id` / `--tdd-task-id` dispatch |
| `record-workspace-changes.ts` | unchanged | Idempotent `commits` insert + `run_changed_files` rows |
| `resolve-session-for-recording.ts` | `resolveSessionForRecording` | Walks `sessions.parent_session_id` so writes land under the canonical `sessions.id` even after a `chat_id` rotation. `cwd` required (was `?? process.cwd()`); reads `package.json#name` through `FileSystem.readFileString` + `Effect.try`, any failure → `"unknown"` |
| `session-env.ts` | `SessionContext`, `parseSessionEnvExports`, `recoverSessionContextFromSessionEnv({ projectDir, homeDir })` | The MCP server's lazy session recovery: reads the newest `<homeDir>/.claude/session-env/<chat_id>/vitest-agent-hook.sh` whose exports match `projectDir`. Still synchronous (the session ref's recover thunk is sync), so `node:fs` / `node:path` stay here. `SessionContext` is declared here and re-exported by `@vitest-agent/mcp` |

The CLI's `commands/agent.ts` calls `resolveHookPaths({ env: process.env,
projectKey })` and provides `SidecarPlatformLive(paths, process.env)`; its
`commands/record.ts` passes `process.cwd()` when `--cwd` is absent. The
MCP `main.ts` passes `homeDir = env.HOME ?? env.USERPROFILE ?? ""` to the
recover thunk. Exit codes are unchanged: the new `XdgEnvError` /
`AppDirsError` / `PlatformError` tags map to 5 through `exitCodeForTag`,
the code the old synchronous `mkdirSync` defect produced.

### Hook paths

`hook-paths.ts` no longer hand-rolls `XDG_DATA_HOME ?? ~/.local/share`. It
builds `AppDirs.layer({ namespace: APP_NAMESPACE, fallbackDir:
".local/share/vitest-agent" })` over `Xdg.layer` and installs the caller's
`env` map as the ambient `ConfigProvider`
(`ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))`) so `Xdg.layer`
reads `HOME` / `XDG_DATA_HOME` from the argument, never from `process.env`.
`USERPROFILE` is copied into `HOME` before the provider is built (Windows
parity with the old `homedir()` read); `fromEnvRecord` treats empty
strings as unset. `ensureData` creates the root; `FileSystem.makeDirectory`
creates the project and session-map dirs. The session-map rung
(`CLAUDE_PLUGIN_DATA` → `VITEST_AGENT_SESSION_MAP_DIR` → `~/.vitest-agent`)
is not XDG and stays a direct read of the injected `env` with the same
precedence and the same `ProjectIdentityNotResolvableError.tried` list.
The layer is provided locally inside `resolveHookPaths` (it is
parameterized by `env`, so it cannot be a module-level const), leaving
only `FileSystem | Path` in `R` for the command to supply via
`NodeServices.layer`.

One behavioral edge: the XDG rung requires `HOME` or `USERPROFILE` in the
env map (`XdgEnvError` → exit 5) where `os.homedir()` never failed. Hook
environments always carry `HOME`. And one pre-existing divergence became
visible: `PathResolutionLive` (below) passes no `fallbackDir`, so with
`XDG_DATA_HOME` unset the reporter / MCP `data.db` resolves to
`~/.vitest-agent/<key>/` (`@effected/xdg` rung 5) while the hook paths
resolve to `~/.local/share/vitest-agent/<key>/`. Preserved as-is; see the
follow-ups under Decision 70.

## Effect services

`packages/engine/src/services/`. Each service is a `Context.Service` (the v4
rename of `Context.Tag`) with a typed interface. Live implementations use the
core `effect` `FileSystem` (absorbed from `@effect/platform` on v4) and
`@effect/sql-sqlite-node` for I/O; test implementations use mock state
containers. The domain shapes the services speak (schemas, errors) are
imported from `@vitest-agent/sdk`.

The engine owns the services every runtime needs:

- **DataStore** — writes test data to SQLite. See *DataStore* below.
- **DataReader** — reads test data from SQLite. See *DataReader* below.
- **EnvironmentDetector** — four-environment detection (`agent-shell`,
  `terminal`, `ci-github`, `ci-generic`). `EnvironmentDetectorLive(env)`
  takes the env map; the pure `classifyEnvironment(env, agentShell)` is
  exported so tests exercise the real branch with the `std-env` agent
  probe forced on or off.
- **ExecutorResolver** — maps environment to executor role (`human`,
  `agent`, `ci`). Simplified to env-only mapping when the per-executor
  console matrix landed; the plugin's `configureVitest` computes the
  same mapping inline to avoid spinning up an Effect runtime, and the
  service is kept for downstream callers that already run inside one.
- **FormatSelector** — selects output format from executor role and any
  explicit override. The optional `environment` parameter exists for the
  `ci-github` branch alone (auto-selecting `ci-annotations`).
- **DetailResolver** — determines output detail level from executor role
  and run health (`hasFailures`, `belowTargets`, `hasTargets`).
- **OutputRenderer** — renders `AgentReport` arrays through the selected
  formatter.
- **ProjectDiscovery** — glob-based test file discovery. Used by the CLI;
  has no SQLite dependency.
- **HistoryTracker** — classifies test outcomes against stored history (see
  *Failure history & classification* below).
- **VitestAgentReporterConfigFile** — typed `Context.Service` for the loaded
  TOML config, a `@effected/config-file` `ConfigFile.Service`; live layer is
  `ConfigLive(projectDir)`.

`CoverageAnalyzer` is the one service that lives outside this package — it
stays with the plugin because only the lifecycle class consumes istanbul
data. See [./plugin.md](./plugin.md).

### Agent-agnostic taxonomy services

Five services in `packages/engine/src/services/` back the agent-attribution model:

- **ProjectIdentity** — 5-source fallback resolver for the canonical
  per-project identity (`{ projectKey, projectDir, source }`).
  Sources tried in order: explicit option, `vitest-agent.config.toml`
  `projectKey`, `git config remote.origin.url` (canonicalized),
  `package.json#repository.url` (parsed and canonicalized), normalized
  `package.json#name`. Fails with `ProjectIdentityNotResolvableError`
  listing every source attempted. The CLI's `agent` sidecar subcommands
  call this against `--cwd` to compute the per-project data store directory.
- **RunContext** — `RunContextLive(env)`; captures `{ branch, commitSha,
  dirty, upstream, worktreeDir }` via `git rev-parse` calls. Used by the reporter at
  test-run time to stamp the seven `git_*` and three `host_*` columns
  on every `test_runs` row, and by `agent register-agent` to
  capture the agent's inherited `start_git_*` context at registration.
  Detached-HEAD state surfaces as literal `'HEAD'` for `branch` with
  `commit_sha` as the reliable identifier.
- **PerClientSessionMap** — read/write surface over the per-client
  `sessions.db`. Two table families: `conversation_map`
  (`transcript_path` → canonical UUID) and `session_map` (host
  `session_id` → `conversation_id`, `project_dir`, `main_agent_id`).
  Hot path is `lookupByProjectDir(projectDir)` which uses the partial
  index on `WHERE ended_at IS NULL` to find the active main agent in
  this project. Used as the dev / test fallback when
  `CLAUDE_ENV_FILE` env injection isn't available.
- **DiscoveryRegistry** — read/write surface over the global
  `registry.db`. Single STRICT `known_projects` table; the registrar
  upserts on `register-agent`. Used by cross-project tooling
  (planned) to list every project the user has ever run
  vitest-agent against without scanning the filesystem.
- **idempotency** — module-level helper functions
  (`deriveIdempotencyKey`, `IdempotencyHit`) that compose with
  `DataStore.registerAgent` (they use `node:crypto`, which is why they
  live here rather than in the core). Same SHA-256 base32(26) algorithm
  everywhere; the MCP server's `withIdempotency` combinator has its own
  key registry.

### Taxonomy schemas and pure helpers

The `Agent.ts` / `Identity.ts` schemas and the pure helpers the taxonomy
services call (`canonicalize-git-url`, `match-vitest-command`,
`probe-host-metadata`, `detect-non-default-discover-strategy`) stayed in the
core — see [./sdk.md](./sdk.md). The one taxonomy util that moved here is
`utils/resolve-project-key-from-cwd.ts`, a thin convenience over
`ProjectIdentity.resolve` plus `normalizeWorkspaceKey` for callers that
want only the path-safe `projectKey` string.

## Effect layers

`packages/engine/src/layers/`. Live and test implementations for the shared
services. The only composites are the engine's own `PlatformLive` (above)
and `OutputPipelineLive(env)`; the plugin wraps `PlatformLive` as
`ReporterLive`, and the sidecar composite is `programs/platform-sidecar.ts`.

- One-to-one live layers per service. The env-reading ones are factories:
  `EnvironmentDetectorLive(env)`, `RunContextLive(env)`.
- `LoggerLive(logLevel?, logFile?)` — structured NDJSON logging factory.
  See *LoggerLive* below.
- `OutputPipelineLive(env)` — composite of `EnvironmentDetectorLive(env)` +
  `ExecutorResolverLive` + `FormatSelectorLive` + `DetailResolverLive` +
  `OutputRendererLive`. A function because `EnvironmentDetectorLive` is.
- `ConfigLive(projectDir)` — TOML config loader anchored at `projectDir`
  (never `process.cwd()`) so the plugin-spawned MCP server sees the right
  config when invoked from elsewhere.
- `PathResolutionLive(projectDir)` — composite of the `AppDirs` / `Xdg`
  layer, `ConfigLive`, and the `WorkspaceDiscovery` / `WorkspaceRoot`
  layers. Exports `APP_NAMESPACE`, the one place the `vitest-agent` XDG
  namespace is spelled. See *XDG path resolution* below.

Test layers exist for `DataStore`, `EnvironmentDetector`,
`ProjectDiscovery`, and `HistoryTracker`.

## DataStore

`packages/engine/src/services/DataStore.ts`. The write side of the data layer.
Methods cover every persistence concern: settings/runs/modules/suites/test
cases/errors/coverage/history/baselines/trends, the source-to-test mapping,
notes CRUD, sessions and turn fanout, idempotent MCP responses, hypothesis
records and validations, the TDD session/goal/behavior/phase/artifact
surface, commit metadata and per-run changed files, session pruning, and a
test-case-to-turn backfill.

The non-obvious pieces:

- **Three coverage-policy writers, one table.** `writeBaselines`,
  `writeThresholds` and `writeTargets` all upsert into `coverage_baselines`,
  distinguished by the `kind` column (`'baseline'` / `'threshold'` /
  `'target'`) and keyed `ON CONFLICT (project, kind, metric, pattern)`.
  `writeThresholds` / `writeTargets` share a private `writeCoveragePolicy`
  helper and take a `ResolvedThresholds` (global metrics plus
  `[pattern, metrics][]`), skipping non-finite values the same way
  `writeBaselines` does (issue #130). The split exists so the ratcheted
  high-water mark can never be mistaken for the enforced bar or the
  aspirational one — see Decision 58 in [../decisions.md](../decisions.md)
  (issue #237).
- **Annotation and artifact writers.** `writeAnnotations(runId, inputs)` and
  `writeArtifacts(runId, inputs)` persist Vitest 5 test annotations and test
  artifacts, each followed by its attachment rows in the shared `attachments`
  table (`annotation_id` XOR `artifact_id`). Location files go through the
  same `ensureFile` dedup as every other path. `runId` is for log
  correlation only — the rows are reachable through `test_cases`. An inline
  attachment `body` is stored only when
  `max(Buffer.byteLength(body), byteSize) <= INLINE_ATTACHMENT_BODY_CAP_BYTES`
  (64 KiB, exported from `services/DataStore.ts`); `byte_size` is recorded
  verbatim either way and no file is ever copied — Vitest already put file
  attachments in `.vitest/attachments/`. See Decision 68 in
  [../decisions.md](../decisions.md).
- **Turn fanout.** `writeTurn` writes to `turns` and, for `file_edit` and
  `tool_result` payload types, also fans out to per-turn detail tables
  (`file_edits`, `tool_invocations`) inside the same SQL transaction via
  `sql.withTransaction`. Other payload types write only to `turns`.
- **MCP tool-name normalization.** For `tool_result` turns, the live layer
  strips the Claude Code MCP prefix before inserting into
  `tool_invocations`. Claude Code sends tool names in the form
  `mcp__<server>__<name>`; only the bare `<name>` suffix is stored (e.g.
  `note_create` rather than `mcp__plugin_vitest-agent_mcp__note_create`).
  Any name that does not start with `mcp__` is stored as-is.
- **Tool-pair caveat.** `tool_invocations` rows derive from `tool_result`
  turns, **not** from `tool_call` turns. Consumers needing strict
  request/response pairing must join through `payload.tool_use_id`.
- **`turn_no` is auto-assigned.** When omitted, the live layer computes
  `MAX(turn_no)+1` per session inside the same transaction.
- **Failure signature upsert.** `writeFailureSignature` is idempotent on
  `signature_hash`. New rows record `first_seen_run_id` and stamp
  `last_seen_at = first_seen_at`; on conflict, `occurrence_count`
  increments and `last_seen_at` refreshes to the new sighting.
- **Goal/behavior ordinal allocation.** `createGoal` and `createBehavior`
  use single-statement allocation (`INSERT ... SELECT
  COALESCE(MAX(ordinal), -1) + 1 ... WHERE session_id = ?`) so concurrent
  inserts under one session never collide without `BEGIN IMMEDIATE`.
- **Status validation at the DataStore boundary, not in SQL triggers.**
  Closed-lifecycle transitions (`pending → in_progress → done|abandoned`,
  terminal states cannot transition further) raise typed
  `IllegalStatusTransitionError`. Triggers would surface as raw `SqlError`
  and lose the typed-error contract.
- **`tdd_artifacts` are hook-only.** Per [D7](../decisions.md), the
  artifact write path is the `record tdd-artifact` CLI subcommand. The
  agent never writes its own evidence. `writeTddArtifact` persists
  `WriteTddArtifactInput.suite` into the `suite` column (issue #363),
  defaulting to `'vitest'` when the caller omits it; the column's CHECK
  constraint rejects anything but `'vitest'` / `'bats'`.
- **Phase-transition transactional invariant.** `writeTddPhase` opens a
  new phase row **and closes the prior open phase in the same transaction**
  so the per-session phase ledger is always consistent.
- **Idempotent response persistence is best-effort.**
  `recordIdempotentResponse` uses `INSERT ... ON CONFLICT DO NOTHING`. The
  MCP `withIdempotency` combinator swallows persistence errors — a
  transient DB failure must not surface as a tool error — and, because
  the insert never updates, a corrupt row is a permanent cache miss rather
  than something the combinator can heal (Decision 71 follow-up).
- **Pruning preserves session rows.** `pruneSessions(keepRecent)` drops the
  *turn log* of older sessions; the `sessions` rows themselves remain. The
  return shape's `affectedSessions` counts sessions whose turn-log was
  dropped, not sessions deleted.
- **`SettingsInput` lives here, not in the plugin's `capture-settings.ts`.**
  DataStore owns its full input contract; the plugin's util produces values
  matching this shape. This avoids a circular import between plugin and
  SDK.
- **`registerAgent` is idempotency-aware.** `DataStore.registerAgent`
  composes `deriveIdempotencyKey(agentType, parentOrSentinel,
  clientNonce)` then performs an upsert against the
  `(session_id, idempotency_key)` UNIQUE index. Returns either a
  fresh `Agent` or an `IdempotencyHit` carrying the already-registered
  row. The `agent register-agent` CLI surface forwards the hit
  state back to the SessionStart hook through the JSON output so the
  hook can short-circuit re-export of env without re-writing
  rows.
- **`upsertSession` and parent-walking reads.** `DataStore.upsertSession`
  is idempotent on `chat_id` and sets `parent_session_id` on
  insert. `DataReader.findSessionsByChatPrefix` and
  `DataReader.listTddTasksForSession({ walkParents })` traverse
  the `parent_session_id` chain so artifact/turn writes always land
  under the correct canonical `sessions.id` even when Claude Code
  rotates `chat_id` mid-window. See `programs/resolve-session-for-recording.ts` for the consumer side.
- **`sessions.conversation_id` write path (issue #144).** `SessionInput`
  carries an optional `conversationId`, which `writeSession` /
  `upsertSession` persist at INSERT time. Because the SessionStart hook
  inserts the row before the canonical conversation id exists,
  `DataStore.setSessionConversationIdIfNull({ sessionId, conversationId })`
  backfills it later with an `UPDATE … WHERE conversation_id IS NULL` —
  idempotent and race-safe, and the only update the relaxed
  `trg_sessions_conv_id_immutable` trigger permits (null → value once;
  value → different value still aborts). `SessionDetail` now exposes
  `conversationId`, and every session-row `SELECT` in `DataReaderLive`
  projects the column. The engine's `programs/register-agent.ts` is the sole
  caller of both the insert-time field and the backstop.
- **`listTddTasksForSession({ walkConversation })` — detached-session
  fallback (issue #144).** After the `walkParents` ancestor chain is
  collected, `walkConversation: true` reads the session's own
  `conversation_id` and, when non-null, adds every other session sharing
  it to the lookup set. The result is ordered `agent_kind = 'main'`
  first, then `started_at DESC`, so the dispatcher's task wins when more
  than one open task exists across the conversation. A null
  `conversation_id` never triggers the fallback — two unrelated sessions
  cannot be joined by accident. `record tdd-artifact` passes both flags;
  see [../decisions.md](../decisions.md) D21.
- **Per-run git + host context on `test_runs`.** The reporter calls
  `RunContext.capture` and `probeHostMetadata` immediately before
  `writeRun`, and `DataStore.writeRun` accepts the seven `git_*` and
  three `host_*` columns. Detached-HEAD state surfaces as literal
  `'HEAD'` for `git_branch`.
- **Action-table attribution.** `writeRun`, `writeHypothesis`,
  `writeNote`, and `writeTddPhase` accept `actor_type` / `agent_id` /
  `conversation_id`. The DataStore boundary upholds the SQL CHECK
  constraints (`agent_id` non-NULL iff `actor_type='agent'`,
  `conversation_id` NULL when `actor_type != 'agent'`).

## DataReader

`packages/engine/src/services/DataReader.ts`. The read side. Reads compose into
domain types via assembler functions in `sql/assemblers.ts`. Used by every
runtime: the plugin's classification path, the CLI's read commands, the MCP
tools' query paths.

The non-obvious pieces:

- **`getManifest` resolves cacheDir from SQLite metadata.** It calls
  `PRAGMA database_list` and picks the file path of the `"main"` database.
  In-memory databases report empty.
- **Annotation and artifact reads are latest-run scoped.**
  `getAnnotationsForTest(project, fullName, { modulePath? })` and
  `getArtifactsForTest(...)` resolve the project's most recent
  `test_runs` row and return the rows hanging off that run's test case, each
  with its attachments ordered by id — the same latest-run semantics as
  `getErrors`. `modulePath` disambiguates a `full_name` present in more than
  one module (Decision D20). `PersistedAttachment.byteSize` is nullable
  because rows written before migration 0002 carry no size.
- **Coverage fall-back.** `getCoverage` and `getFileCoverage` only return
  `Option.none()` when **both** `file_coverage` and `coverage_trends` are
  empty. The reporter only writes per-file rows for files below a bar, so a
  passing project with full coverage produces zero per-file rows; in that
  case the query falls back to `coverage_trends` totals.
- **`getCoverage` reads three distinct policy facets.** A private
  `getCoveragePolicy(kind, project)` helper queries `coverage_baselines`
  for one `kind` and returns `Option.none()` when that kind was never
  persisted — so "never configured" is distinguishable from "configured
  with zero metrics". `getBaselines` is `getCoveragePolicy("baseline", …)`.
  `getCoverage` calls it three times (`threshold`, `target`, `baseline`)
  and assembles `CoverageReport.thresholds` (`global: {}` when absent —
  **no** fallback to the baseline), `targets` (omitted when absent) and
  `baselines`. The per-file rows are split by the persisted
  `file_coverage.tier`: `below_threshold` rows become `lowCoverage`,
  `below_target` rows become `belowTarget` / `belowTargetFiles` (omitted
  when empty). Before this the reader returned the baseline under the
  `thresholds` label and folded every per-file row into `lowCoverage`,
  which is how an agent came to treat the aspirational target as the CI
  gate (issue #237; Decision 58).
- **`getTestsForFile` deduplicates.** Uses `SELECT DISTINCT ... ORDER BY
  f.path` because `source_test_map` accumulates a row per run.
- **`getTddTaskById` materializes the full tree in one round-trip.** It
  pre-rolls every join (sessions → goals → behaviors → phases → artifacts)
  via batched IN-clause joins so `tdd_task({ action: "get" })` returns
  the entire three-tier tree without N+1 reads.
- **`resolveGoalIdForBehavior` is best-effort.** Used by `tdd_progress_push`
  to resolve `goalId` (and transitively `sessionId`) server-side from a
  `behaviorId` for behavior-scoped channel events. Returns `Option.none()`
  if the behavior was deleted; the channel event then falls through with
  the original payload.
- **`getCurrentTddPhase` returns the open phase.** That is, the most recent
  `tdd_phases` row whose `ended_at` is NULL. Used both as the source for
  phase-transition validation and to identify which prior phase to close
  in `writeTddPhase`'s same-transaction roll-over.
- **`getTddArtifactWithContext` reconstructs the D2 evidence-binding
  context.** Joins `tdd_artifacts` with `test_cases`, `turns`, `tdd_phases`,
  and `sessions` so the validator's `CitedArtifact` input is a single read.
  Projects `a.suite` onto `CitedArtifactRow.suite` (issue #363) so
  `validatePhaseTransition` can branch on the runner marker without a
  second read.
- **`validatePhaseTransition` accepts bats run-level artifacts.**
  `utils/validate-phase-transition.ts` exports `ArtifactSuite`
  (`"vitest" | "bats"`) alongside `ArtifactKind` and `Phase`. Rule 1's
  "must carry a `test_case_id`" check carves out
  `test_case_id === null && suite === "bats"`: that branch keeps the
  #245 phase-window check (artifact `phase_id` vs `current_phase_id`,
  extended to `test_passed_run`) and skips the authored-in-session
  check, which has no test case to consult. A vitest run-level artifact
  is still denied with `missing_artifact_evidence`; see
  [../decisions.md](../decisions.md) D11 and D22.
- **Acceptance metrics are derived, not stored.** `computeAcceptanceMetrics`
  computes the four spec-Annex-A ratios (phase-evidence integrity,
  compliance-hook responsiveness, orientation usefulness, anti-pattern
  detection rate) on demand from the row history. Metric 2
  (compliance-hook responsiveness) counts `hook_fire` turns whose
  `hook_kind` is `'SessionEnd'`, `'PreCompact'`, **or `'Stop'`** — the
  `Stop` kind is included because the session-end-record hook fires before
  the session-end write and records a `hook_fire` turn regardless of the
  triggering event.
- **`listTddArtifactsForTask` + `walkParents`.** The new reader
  drives the `tdd_artifact_list` MCP tool. With
  `{ walkParents: true }` it follows the `sessions.parent_session_id`
  chain so the orchestrator finds artifact ids even when
  `chat_id` rotated mid-cycle. Returns the most recent matching
  artifact first so phase-transition auto-resolve can pick the head
  without sorting. Each `TddArtifactRow` carries `suite` (issue #363),
  read from `a.suite`.
- **`countRecentArtifactsInOtherSessionsOfConversation({ tddTaskId, sinceIso })`.**
  Diagnostic reader behind the `missing_artifact_evidence` denial
  (issue #144). Resolves the task's owning session and its
  `conversation_id`, then counts `tdd_artifacts` rows (via
  `tdd_phases` → `tdd_tasks` → `sessions`) recorded at or after
  `sinceIso` under sessions of that conversation *other than* the
  owner. Returns `0` when the task is unknown or its session's
  `conversation_id` is null, so the gate never reports a cross-session
  signal it cannot back. The MCP tool uses a 10-minute window.
- **`findActiveSubagentSession` resolves per-call subagent identity.** Returns the most-recently-started subagent session whose `parent_session_id` matches the supplied parent id and whose `ended_at IS NULL`. The MCP server's boot context names only the main agent; this reader call is how the `hypothesis (action: record)` handler attributes writes to the active `tdd-task` subagent instead of the main session — the context-based fallback when the caller supplies no `tddTaskId`.
- **`getSessionByTddTaskId` resolves a task's binding session.** Returns the `sessions` row whose `id` equals `tdd_tasks.session_id` for the supplied task id, `Option.none` when the task (or its session) does not exist. This is the deterministic head of the `hypothesis (action: record)` resolution precedence: the orchestrator holds an unambiguous `tddTaskId` from `tdd_task (action: start)`, so binding through it sidesteps the fragile recovered host context entirely (see [./mcp.md](./mcp.md) "Hypothesis session binding").
- **Flaky classification requires a fail-after-pass.** The `listFlakyTests` reader query (backing `HistoryTracker.classify`) changed to require that at least one failure occurred at or after the earliest pass — `MAX(timestamp WHERE failed) >= MIN(timestamp WHERE passed)`. A monotonic red-to-green cycle (all failures precede all passes) classifies as `recovered`, not `flaky`. Timestamps are ISO-8601 strings and compare lexicographically.
- **History reads are file-qualified.** `getHistory`, `getFlaky` and `getPersistentFailures` group and partition by the composite `(project, module_path, full_name)` and return `modulePath` on each `TestHistory` / `FlakyTest` / `PersistentFailure`. This mirrors the file-qualified write identity (Decision D20) and fixes read-side conflation where a persistent failure could hide behind a same-named passing test in another file. `HistoryTrackerLive.classify` keys its `testMap` and returned classifications by the `historyKey(modulePath, fullName)` helper.
- **`getHistory` takes optional `HistoryQueryOptions`.** The second arg is `{ testName?, modulePath?, limit? }` (exported as a type from the package root and the `testing/` subpath). `testName` and `modulePath` are exact-match predicates on `full_name` / `module_path`; both are pushed into SQL as `(${value} IS NULL OR col = ${value})` guards so one query shape serves the scoped and unscoped calls. `limit` (default 20) is a **per-test** run cap implemented with a `ROW_NUMBER() OVER (PARTITION BY module_path, full_name ORDER BY timestamp DESC)` window, not a flat row `LIMIT`: a project has many tests, and a flat limit would return the first few tests' full series and starve every later test in the `(module_path, full_name)` ordering instead of trimming each test's own history. No SQLite schema change — the existing `(project, module_path, full_name)` index already serves the added predicates. Callers: `test_history` (issue #212, an unfiltered read returned up to 334KB) and `test({ action: "get" })` (issue #241, which previously fetched the whole project and matched client-side on the non-file-qualified `fullName`). See [./mcp.md](./mcp.md) "History query narrowing".
- **The classification reads take the same narrowing.** `getFlaky` and `getPersistentFailures` accept an optional second arg typed `ClassificationQueryOptions` — `{ testName?, modulePath? }`, the narrowing half of `HistoryQueryOptions`, exported from the package root and the `testing/` subpath. Both push the values into their existing queries as the same `(${value} IS NULL OR col = ${value})` guards, so one query shape still serves the scoped and unscoped calls and no index changes. Motivation (issue #243): `test_history` narrowed only `getHistory`, so a call scoped to one test still received the whole project's flaky/persistent sets — and the tool's `hasData` flag, derived from all three reads, reported `true` for a test that had never run.
- **`getTestByFullName` takes `TestLookupOptions` and orders deterministically.** The optional third arg is `{ modulePath? }`. Because `full_name` is not file-qualified (Decision D20), one name can exist in several modules of a run; the predicate picks a named variant, and a new `ORDER BY f.path ASC, tc.id ASC` ahead of the `LIMIT 1` makes the unfiltered case stable instead of returning whichever row SQLite happened to visit first.
- **`getTestModulesByFullName` exposes the ambiguity itself.** Returns every distinct module path in the project's latest run carrying a test case with that exact `full_name`, ascending. A length greater than one means the name is ambiguous, which is what lets a caller refuse to guess rather than silently resolving to one variant — see [./mcp.md](./mcp.md) "History query narrowing" for the `test({ action: "get" })` side.

## XDG path resolution

The data path is a **function of workspace identity, not filesystem
layout**. Closes [issue #39](https://github.com/spencerbeggs/vitest-agent-reporter/issues/39).
See [../decisions.md](../decisions.md) D31.

`packages/engine/src/utils/resolve-data-path.ts` orchestrates resolution.
Precedence (highest first):

1. Programmatic `options.cacheDir`. Used by the reporter's `ensureDbPath`
   short-circuit when `reporter.cacheDir` is set — skips the heavy
   XDG/workspace layer stack entirely (since the `WorkspaceDiscovery` layer
   eagerly scans lockfiles and walks the package graph at layer construction).
2. `cacheDir` from `vitest-agent.config.toml`.
3. `projectKey` from the same TOML, used as the workspace-key segment under
   the XDG data root.
4. Workspace name from the root `package.json` `name`, resolved via
   `WorkspaceDiscovery`.
5. Fail with `WorkspaceRootNotFoundError`. **No silent fallback to a path
   hash.**

The XDG data root is `AppDirs.ensureData` from `@effected/xdg` with
`namespace: "vitest-agent"` (`AppDirs.layer({ namespace: APP_NAMESPACE })`
over `Xdg.layer`, bound to a `const` so the layer memoizes by reference).
`ensureData` creates the directory if missing so the SQLite driver can open
without a separate `mkdir`.

`normalizeWorkspaceKey` (`packages/sdk/src/utils/normalize-workspace-key.ts`)
is the path-segment normalizer: replaces `/` with `__` so `@org/pkg`
collapses to `@org__pkg`, replaces any character outside
`[A-Za-z0-9._@-]` with `_`, and collapses runs of underscores produced by
the second step.

`PathResolutionLive(projectDir)` composes the `AppDirs`/`Xdg` layer,
`ConfigLive(projectDir)`, and the `WorkspaceDiscovery`/`WorkspaceRoot`
layers (anchored at `projectDir`) in one shot. Callers still need to provide
`FileSystem` and `Path` (typically via `@effect/platform-node`'s
`NodeServices.layer`). Both front ends' `main.ts` run
`resolveDataPath(projectDir)` under `PathResolutionLive(projectDir)` +
`NodeServices.layer` before building `PlatformLive`.

Note the fallback asymmetry with the hook paths: this layer passes no
`fallbackDir`, so with `XDG_DATA_HOME` unset it resolves to
`~/.vitest-agent/<key>/` (the `@effected/xdg` default), whereas
`programs/hook-paths.ts` passes `fallbackDir: ".local/share/vitest-agent"`.
Recorded as a follow-up under Decision 70.

## TOML config file

Optional `vitest-agent.config.toml` lets users override the XDG default
without code changes. Both fields (`cacheDir`, `projectKey`) are optional.

`projectKey` is the override for the "two unrelated `my-app`s" collision
case, or when a stable key independent of `name` changes is needed.

`ConfigLive(projectDir)` builds a `@effected/config-file`
`ConfigFile.layer(...)` over the `VitestAgentConfigFile`
`ConfigFile.Service` with the `TomlCodec` and a
`MergeStrategy.firstMatch()` chain of
`ConfigResolver.workspaceRoot → gitRoot → upwardWalk` resolvers. When no
file is present, downstream callers use
`config.loadOrDefault(new VitestAgentConfig({}))` to get an empty config —
never an error.

## LoggerLive

`packages/engine/src/layers/LoggerLive.ts`. Effect-based structured logging
factory. NDJSON to stderr plus optional file logging via `Logger.zip`.
Configured by `logLevel`/`logFile` options; the env fallbacks are read by
the pure `resolveLogLevel(env, option?)` / `resolveLogFile(env, option?)`
helpers the front ends call with `process.env` (`""` counts as unset for
the level). With no level set the layer is `Logger.layer([])` — silent —
which is what keeps the MCP server's stderr empty on a clean session.

`Effect.logDebug` calls thread through every DataStore/DataReader method
for comprehensive I/O tracing.

## ensureMigrated

`packages/engine/src/utils/ensure-migrated.ts`. Process-level migration
coordinator that ensures the SQLite database at a given `dbPath` is
migrated **exactly once per process** before any reporter instance reads
or writes.

**Why this exists.** In multi-project Vitest configs, multiple
`AgentReporter` instances share the same `data.db`. On a fresh database,
two connections both starting deferred transactions and then upgrading to
write produced `SQLITE_BUSY` — SQLite's busy handler is not invoked for
write-write upgrade conflicts in deferred transactions. With migration
serialized through this coordinator, subsequent concurrent writes work
normally under WAL mode plus the SQLite driver's busy timeout. See D28.

**Why it lives on `globalThis`.** The cache (`Map<dbPath, Promise<void>>`)
is keyed by `Symbol.for("vitest-agent/migration-promises")`. Vite's
multi-project pipeline can load this module under separate module instances
within one process; a module-local Map would defeat the coordination.

The coordinator suppresses `unhandledRejection` on the cached promise
reference; callers await the returned promise and handle rejection
themselves.

## SQLite migrations and SQL helpers

`packages/engine/src/migrations/`. `PROJECT_MIGRATIONS` is the record
`makeSqliteStack` feeds to `@effect/sql-sqlite-node`'s `SqliteMigrator`
(WAL journal mode, foreign keys enabled).

The per-project data-store migration set is ordered and cumulative:

- **`0001_initial.ts`** — the whole pre-2.0 schema in one file. Frozen: it
  is the record of what already ran on every 2.0 install, not a canonical
  shape to rewrite.
- **`0002_test_artifacts.ts`** — gives the three dormant annotation /
  artifact / attachment tables their writers. Drops and recreates the dead
  `test_annotations` (losing the wrong `type` CHECK and the inline
  `attachment_*` columns), then `ALTER TABLE test_artifacts ADD COLUMN data
  TEXT`, `ALTER TABLE attachments ADD COLUMN byte_size INTEGER` and `ADD
  COLUMN body_encoding TEXT`. See Decision 66 in
  [../decisions.md](../decisions.md).

**One loader, one set.** `makeSqliteStack` defaults its `migrations`
argument to `PROJECT_MIGRATIONS`, and `PlatformLive`, `ensureMigrated` and
the testing layer at `src/testing/layers.ts` all build through it — so
adding a migration to `migrations/index.ts` reaches every consumer at once.
(Before the engine split three loaders each spelled the record and the
testing one sat silently at `0001` until 0002 landed.) The session-map and
registry stacks in `programs/platform-sidecar.ts` pass their own records.

Two additional migration files cover the per-client and registry
SQLite scopes for the agent-agnostic taxonomy:

- **`session_map_0001_initial.ts`** — `conversation_map`
  (`transcript_path` → canonical `conversation_id`) and `session_map`
  (host `session_id` → `conversation_id`, `project_dir`,
  `main_agent_id`) STRICT tables. Plus four indexes including the
  partial `(project_dir) WHERE ended_at IS NULL` for the
  `lookupByProjectDir` hot path. Lives at the per-client path
  `${CLAUDE_PLUGIN_DATA}/sessions.db`.
- **`registry_0001_initial.ts`** — single STRICT `known_projects`
  table indexed by `project_key`. Lives at the cross-project path
  `$XDG_DATA_HOME/vitest-agent/registry.db`. WAL plus
  `busy_timeout=5000`.

**Post-2.0 migration discipline.** Never edit `0001_initial.ts` in place.
Add a new `000N_*.ts`, register it in `PROJECT_MIGRATIONS`, and ALTER-plus-
backfill any table that holds data; only a table with no readers and no
writers may be dropped and recreated. See Decision D9 and Decision 66 in
[../decisions.md](../decisions.md).

`packages/engine/src/sql/rows.ts` defines `Schema.Struct` row shapes
(snake-case) for every table. `packages/engine/src/sql/assemblers.ts` joins
these rows into composite domain types (`AgentReport`, `CoverageReport`,
the TDD tree, etc.). The application-level (camelCase) shapes for the TDD
hierarchy live in `schemas/Tdd.ts`.

For the table inventory and column-level details see
[../schemas.md](../schemas.md).

## Testing subpath

`packages/engine/src/testing/` — exported via the `@vitest-agent/engine/testing`
subpath (`"./testing": "./src/testing/index.ts"` in `package.json`). The
subpath moved here from `@vitest-agent/sdk/testing` with the engine split;
the barrel re-exports the core's error and schema types so a test file
needs one import.

Provides in-process SQLite test infrastructure without requiring the full
Effect runtime. Two layers:

- **`makeTestLayer(filename)`** — builds a fully-migrated SQLite layer from
  a path or `:memory:`. Composes `DataStoreLive`, `DataReaderLive` and a
  `makeSqliteStack(filename)` (so it runs the whole `PROJECT_MIGRATIONS`
  set) over `NodePlatformLayer`. Note that `NodePlatformLayer` carries the
  real process `Stdio`, which is why the MCP harness provides its test
  Stdio innermost. Tests pass this as the `provide` argument to `Effect.runPromise`
  or as the layer in `it.effect`.
- **`DataStoreTestLayer`** — `makeTestLayer(":memory:")`. The shared in-memory
  convenience for tests that don't need a persistent file.

Five preset factories seed representative DB states for use across test
files. Each accepts `filename` and internally calls `makeTestLayer`, then
seeds data via `Layer.effectDiscard`:

| Factory | Seeds |
| ------- | ----- |
| `empty(filename)` | Migrated DB, no rows |
| `singlePassingRun(filename)` | One run, one module, three passing tests |
| `withFailures(filename)` | One run, one module, two failing tests |
| `flaky(filename)` | Two runs with opposing outcomes (flaky classification) |
| `withTddTask(filename)` | One session, one TDD session, one goal, two behaviors |

**When to use.** Import from `@vitest-agent/engine/testing`. The preset layers
remove boilerplate from per-test fixture setup. Use `empty` for tests that
need precise control; use the named presets when the scenario matches to
keep tests concise.

## Output pipeline

`packages/engine/src/layers/OutputPipelineLive.ts`. `OutputPipelineLive(env)`
merges the five output services (`EnvironmentDetectorLive(env)`,
`ExecutorResolverLive`, `FormatSelectorLive`, `DetailResolverLive`,
`OutputRendererLive`) into the one composite `PlatformLive` includes. See
the source for the exact merge.
