---
type: Module
title: "@vitest-agent/engine"
description: "The platform half of the sdk/engine split: Effect services and Live/Test layers, the SQLite client and migrator stack, XDG path resolution, hook-driven programs, and the one PlatformLive layer both front ends provide."
kind: package
layer: L3
resource: ../../packages/engine
status: stable
tags:
  - architecture
  - effect
  - observability
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: 81e5eac9146fb54cca483d337bd117f8f9ff045c24822201f45d7db5976ba924
---

# @vitest-agent/engine

## Purpose

`@vitest-agent/engine` is the platform half of the former `@vitest-agent/sdk`:
everything that touches a filesystem, SQLite, or an environment map. It owns
the Effect services and their Live/Test layers, the data layer (`DataStore` /
`DataReader`), the SQLite client and migrator stack plus the migrations, the
XDG path-resolution stack, the one platform composite (`PlatformLive`), the
one project-directory resolver (`resolveProjectDir`), the hook-driven
programs the CLI commands wrap and the MCP server calls, and the `./testing`
presets. The platform-free core it sits on — schemas, contracts, errors,
pure formatters and utils — stays in `@vitest-agent/sdk`.

## Boundary

Rank 3 in the workspace's ranked layering[^boundaries-test]. Its only
workspace runtime dependency is `@vitest-agent/sdk`; every core type and pure
helper comes in through `import … from "@vitest-agent/sdk"`, never a
relative path across the package boundary. Consumers are
`@vitest-agent/cli`, `@vitest-agent/mcp`, and `@vitest-agent/plugin`
(`ReporterLive` wraps `PlatformLive`); `@vitest-agent/reporter`,
`@vitest-agent/ui`, and the sidecar packages never import it.

**No `process` reads anywhere under `src/`, with no allowlist.**
`packages/engine/__test__/boundaries.test.ts` runs
`@effected/workspaces/testing`'s `SourceBoundary.scan` over every `.ts`
file under `src/` and asserts no file references
`process`[^boundaries-test]. The one exemption is the exact token
`process.env.__PACKAGE_VERSION__`, a compile-time literal the bundler
substitutes, permitted only in `src/version.ts`; the test asserts that
token's user list is exactly `["version.ts"]`. The same test forbids
importing `@vitest-agent/cli`, `mcp`, `plugin`, `reporter`, or `ui`. The
consequence: every ambient input a program needs is a parameter — `env`
(the front end passes `process.env`), `cwd` (`process.cwd()`), `homeDir`
(`env.HOME ?? env.USERPROFILE`). Layers that would otherwise read
`process.env` at construction are factories instead —
`EnvironmentDetectorLive(env)`, `RunContextLive(env)`,
`OutputPipelineLive(env)`, `LoggerLive(logLevel?, logFile?)` with
`resolveLogLevel(env)` / `resolveLogFile(env)`. See
[Package Boundaries](../invariants/package-boundaries.md) for the invariant
this test enforces across every package, not only this one.

## Public surface

Two entry points: `.` (the main barrel — every service, layer, program,
migration record, and utility, plus `CURRENT_ENGINE_VERSION`) and
`./testing` (in-process SQLite test infrastructure, exported as
`@vitest-agent/engine/testing`).

## Key files

- `src/platform.ts` — `makeSqliteStack(filename, migrations?)`,
  `NodePlatformLayer`, `PlatformLive(options)`[^platform-ts].
- `src/project-dir.ts` — `resolveProjectDir({ env, cwd })`[^project-dir-ts].
- `src/services/` — fourteen `Context.Service` tags plus `idempotency.ts`.
- `src/layers/` — one Live/Test pair per service, plus `PathResolutionLive`,
  `OutputPipelineLive(env)`, `LoggerLive`.
- `src/sql/` — row shapes and row-to-domain assemblers.
- `src/migrations/` — `PROJECT_MIGRATIONS` plus the registry and
  session-map migration sets.
- `src/programs/` — the hook-driven program bodies.
- `src/utils/` — `resolveDataPath`, `ensureMigrated`,
  `resolveProjectKeyFromCwd`, `resolveWorkspaceKey`, `computeFailureSignature`.
- `src/testing/` — `makeTestLayer`, `DataStoreTestLayer`, five preset
  factories.

### `PlatformLive` — the one platform composite

`packages/engine/src/platform.ts`. Replaces what were once per-front-end
composites and the plugin's inline SQLite assembly. `PlatformLive` is a
factory taking `PlatformOptions` (`{ dbPath, env, logLevel?, logFile? }`) and
returning a `Layer.Layer<PlatformServices, MigrationError | SqlError>`
merging `ProjectDiscoveryLive`, `HistoryTrackerLive`, and
`OutputPipelineLive(options.env)`, then provide-merging `DataReaderLive`,
`DataStoreLive`, the migrator layer, the SQLite layer, `NodePlatformLayer`,
and `LoggerLive(options.logLevel, options.logFile)`[^platform-ts].
`PlatformServices` is the full union the merge provides — `DataReader |
DataStore | ProjectDiscovery | HistoryTracker | EnvironmentDetector |
ExecutorResolver | FormatSelector | DetailResolver | OutputRenderer |
NodeServices | SqliteClient | SqlClient` — because the CLI, the MCP server,
and the plugin all rely on the five output-pipeline services, not only
`OutputRenderer`. Being a factory, each call mints a fresh layer reference;
the CLI's `main.ts`, the MCP `main.ts`, and the plugin's `ReporterLive` each
call it exactly once per process.

`makeSqliteStack(filename, migrations = PROJECT_MIGRATIONS)` is the shared
builder underneath: it returns `{ SqliteLayer, MigratorLayer }`, the migrator
already fed its `SqlClient` and the Node platform services. Its callers are
`PlatformLive`, `ensureMigrated`, `testing/layers.ts#makeTestLayer`, and
`programs/platform-sidecar.ts` (three separate stacks — project,
session-map, registry — each with its own migration record).
`NodePlatformLayer` is `NodeServices.layer`. The plugin's
`ReporterLive(options)` is `CoverageAnalyzerLive.pipe(Layer.provideMerge(PlatformLive(options)))`
— `CoverageAnalyzer` is the one service that lives outside this package,
because only the plugin's lifecycle class consumes istanbul data.

### `resolveProjectDir` — the one project-directory resolver

`packages/engine/src/project-dir.ts`. A pure function,
`resolveProjectDir({ env, cwd }): string`[^project-dir-ts], with precedence
`VITEST_AGENT_PROJECT_DIR` (the hook-driven override) →
`VITEST_AGENT_REPORTER_PROJECT_DIR` (the plugin loader's hand-off to the
spawned MCP server) → `CLAUDE_PROJECT_DIR` → `cwd`. It delegates to
`@effected/engine`'s `LaunchContext.projectDir`: each value is trimmed,
and an empty or whitespace-only value, or one a plugin host left as a
literal unsubstituted `${...}` placeholder, counts as unset. Both front ends call it from `main.ts` so a hook running from a
sub-package cwd and the MCP server it drives always resolve the same
`data.db`.

### Effect services and layers

Every service in `packages/engine/src/services/` is a `Context.Service` (the
v4 rename of `Context.Tag`) with a typed interface; Live implementations use
the core `effect` `FileSystem` and `@effect/sql-sqlite-node` for I/O, test
implementations use mock state containers. Domain shapes (schemas, errors)
come from `@vitest-agent/sdk`.

- **DataStore** / **DataReader** — the write and read sides of the data
  layer; see below.
- **EnvironmentDetector** — four-environment detection (`agent-shell`,
  `terminal`, `ci-github`, `ci-generic`); `EnvironmentDetectorLive(env)`
  takes the env map, and the pure `classifyEnvironment(env, agentShell)` is
  exported so tests exercise the real branch with the `std-env` agent probe
  forced on or off.
- **ExecutorResolver** — maps environment to executor role (`human`,
  `agent`, `ci`).
- **FormatSelector** — selects output format from executor role and any
  explicit override.
- **DetailResolver** — determines output detail level from executor role and
  run health.
- **OutputRenderer** — renders `AgentReport` arrays through the selected
  formatter.
- **ProjectDiscovery** — glob-based test file discovery, no SQLite
  dependency.
- **HistoryTracker** — classifies test outcomes against stored history.
- **VitestAgentReporterConfigFile** — the loaded TOML config as a typed
  `Context.Service`; live layer is `ConfigLive(projectDir)`. See
  [TOML config file](../interfaces/config-toml.md) for the contract.
- **ProjectIdentity**, **RunContext**, **PerClientSessionMap**,
  **DiscoveryRegistry**, and the `idempotency` helper module — the
  agent-agnostic taxonomy services (identity resolution, git/host context
  capture, per-client and cross-project SQLite scopes, idempotency-key
  derivation).

`packages/engine/src/layers/` holds one Live layer per service (the
env-reading ones are factories: `EnvironmentDetectorLive(env)`,
`RunContextLive(env)`), plus three composites of its own:
`LoggerLive(logLevel?, logFile?)`, `OutputPipelineLive(env)` (composing
`EnvironmentDetectorLive` + `ExecutorResolverLive` + `FormatSelectorLive` +
`DetailResolverLive` + `OutputRendererLive` into the pipeline `PlatformLive`
includes), and `PathResolutionLive(projectDir)` (composing the XDG/config
layer with `WorkspaceDiscovery` / `WorkspaceRoot`; see *XDG path resolution*
below). Test layers exist for `DataStore`, `EnvironmentDetector`,
`ProjectDiscovery`, and `HistoryTracker`.

### DataStore

`packages/engine/src/services/DataStore.ts`. The write side. Methods cover
every persistence concern: settings/runs/modules/suites/test
cases/errors/coverage/history/baselines/trends, the source-to-test mapping,
notes CRUD, sessions and turn fanout, idempotent MCP responses, hypothesis
records and validations, the TDD session/goal/behavior/phase/artifact
surface, commit metadata and per-run changed files, session pruning, and a
test-case-to-turn backfill.

`writeTurn` wraps its inserts in a SQL transaction and fans out for two of
the seven payload discriminators: `file_edit` payloads produce one
`file_edits` row per turn, and `tool_result` payloads produce one
`tool_invocations` row per turn; `tool_call`, `user_prompt`, `hypothesis`,
`hook_fire`, and `note` payloads write only to `turns`[^data-store-live].
`tool_invocations` is keyed on `tool_result` rather than `tool_call` because
a call without a matching result is still in-flight or failed — keying on
the result gives a "completed invocations" projection without joining two
turn rows; a consumer needing strict request/response pairing joins through
`payload.tool_use_id`. The row's `params_hash` column is left `NULL`,
intentionally: the matching `tool_call` turn was inserted earlier and is out
of scope by the time `writeTurn` processes the `tool_result`, and a
placeholder would be worse than an honest gap.

`writeFailureSignature` is idempotent on `signature_hash`: a new row records
`first_seen_run_id` and stamps `last_seen_at = first_seen_at`; on conflict,
`occurrence_count` increments and `last_seen_at` refreshes to the new
sighting[^data-store-live]. `last_seen_at` is nullable because rows written
before the column existed have no legitimately assignable last-sighting
timestamp — `NULL` is the honest state, and the field becomes non-null
asymptotically as signatures recur, rather than being backfilled with a
guess.

The persistence-time input to `writeFailureSignature` is
`FailureSignatureWriteInput`, deliberately distinct from
`FailureSignatureInput` — the name already taken by
`packages/engine/src/utils/failure-signature.ts`'s compute-time input to
`computeFailureSignature` (the un-hashed `error_name` / `assertion_message`
/ `top_frame_*` fields that get hashed into the signature). Both live in the
SDK; only one is exported from each module. The `Write` qualifier matches
the existing `DataStore` input convention (`TestRunInput`, `ModuleInput`,
`TestCaseInput`, and so on) and keeps the two inputs — one feeding a hash,
the other describing metadata stored alongside it — from being forced into
one union that would obscure intent.

`createGoal` and `createBehavior` allocate their `ordinal` columns with a
single SQL statement (`INSERT ... SELECT COALESCE(MAX(ordinal), -1) + 1 ...
WHERE session_id = ?`)[^data-store-live], so concurrent inserts under one
session serialize on the unique constraint without needing `BEGIN
IMMEDIATE` or application-level retry; the same pattern allocates behavior
ordinals under a goal. Ordinals start at 0 because they are an internal
ordering artifact — `COALESCE(MAX(ordinal), -1) + 1` is symmetric for the
empty-table case. The 1-based `[G<n>.B<m>]` labels an orchestrator renders
for humans are a presentation-layer concern built on top, not the database's.

`tdd_artifacts` carries a `behavior_id` column referencing
`tdd_session_behaviors(id) ON DELETE CASCADE`, plus an index on
it[^migration-behavior-id]. This denormalizes the behavior reference one
level so behavior-scoped queries are single-hop instead of joining
`tdd_artifacts → tdd_phases → behavior_id`. `ON DELETE CASCADE` matches the
same cascade rule the behaviors table itself uses: when a behavior is
deleted (a main-agent action under user confirmation), all its evidence
goes with it.

### DataReader

`packages/engine/src/services/DataReader.ts`. The read side. Reads compose
into domain types via assembler functions in `sql/assemblers.ts`. Used by
the plugin's classification path, the CLI's read commands, and the MCP
tools' query paths.

## XDG path resolution

The data path is a function of workspace identity, not filesystem layout
(see [Deterministic XDG Path Resolution](../decisions/31-deterministic-xdg-path-resolution.md)).
`packages/engine/src/utils/resolve-data-path.ts` orchestrates resolution in
precedence order[^resolve-data-path]:

1. Programmatic `options.cacheDir` — the plugin's `reporter.cacheDir` option
   flows through here; skips the XDG/workspace layer stack entirely.
2. `cacheDir` from `vitest-agent.config.toml`.
3. `projectKey` from the same config, normalized as the workspace-key
   segment under the XDG data root.
4. Workspace name from the root `package.json`, resolved via
   `WorkspaceDiscovery` and normalized.
5. Fail with `WorkspaceRootNotFoundError` — no silent fallback to a path
   hash.

The XDG data root is `AppDirs.ensureData` from `@effected/xdg` with
`namespace: "vitest-agent"`, the one place the namespace string is
spelled[^path-resolution-live]. `normalizeWorkspaceKey`
(`packages/sdk/src/utils/normalize-workspace-key.ts`) replaces `/` with `__`
so `@org/pkg` collapses to `@org__pkg`, replaces any character outside
`[A-Za-z0-9._@-]` with `_`, and collapses the resulting underscore runs.
`PathResolutionLive(projectDir)` composes the XDG/`Xdg` layer,
`ConfigLive(projectDir)`, and the `WorkspaceDiscovery`/`WorkspaceRoot` layers
in one shot; callers still supply `FileSystem` and `Path`, typically via
`NodeServices.layer`.

`hook-paths.ts` builds its own `AppDirs.layer` with a `fallbackDir` of
`.local/share/vitest-agent`, while `PathResolutionLive` passes no
`fallbackDir` at all[^hook-paths]. With `XDG_DATA_HOME` unset this is a real
observable split between the reporter/MCP data path and the hook-driven
sidecar path; see [XDG Fallback Split](../gotchas/xdg-fallback-split.md) for
what it looks like from the outside rather than restating it here.

## TOML config

Optional `vitest-agent.config.toml` lets a consumer override the XDG default
without code changes; `ConfigLive(projectDir)` loads it anchored at
`projectDir`, never `process.cwd()`, so a plugin-spawned MCP server invoked
from elsewhere still resolves the caller's config. See
[TOML config file](../interfaces/config-toml.md) for the field-level
contract.

## LoggerLive

`packages/engine/src/layers/LoggerLive.ts`. An Effect-based structured
logging factory: NDJSON to stderr plus optional file logging via
`Logger.zip`, five levels (`Debug`, `Info`, `Warning`, `Error`, `None`),
configured by `logLevel`/`logFile` options with env-var fallback resolved by
the pure `resolveLogLevel(env, option?)` / `resolveLogFile(env, option?)`
helpers the front ends call with `process.env`. With no level set the layer
is `Logger.layer([])` — silent — which is what keeps the MCP server's stderr
empty on a clean session. Effect's native `Logger` integrates directly with
the `Effect.logDebug` calls threaded through every `DataStore`/`DataReader`
method, so NDJSON output is comprehensive I/O tracing that is also parseable
by log-aggregation tooling without a bespoke format.

## ensureMigrated

`packages/engine/src/utils/ensure-migrated.ts`. A process-level migration
coordinator ensuring the SQLite database at a given `dbPath` is migrated
exactly once per process before any reporter instance reads or writes. In
multi-project Vitest configs, multiple reporter instances share one
`data.db`; on a fresh database, two connections both starting deferred
transactions and then upgrading to write produced `SQLITE_BUSY`, because
SQLite's busy handler is not invoked for write-write upgrade conflicts in
deferred transactions. Serializing migration through this coordinator lets
subsequent concurrent writes proceed normally under WAL mode plus the SQLite
driver's busy timeout.

The cache is a `Map<dbPath, Promise<void>>` keyed by
`Symbol.for("vitest-agent/migration-promises")` on `globalThis`, not a
module-local `Map`[^ensure-migrated] — Vite's multi-project pipeline can
load this module under separate module instances within one process, and
only a `globalThis`-keyed cache is shared across those instances. The
coordinator suppresses `unhandledRejection` on the cached promise reference;
callers await the returned promise and handle rejection themselves.

## Migrations and SQL helpers

`packages/engine/src/migrations/`. `PROJECT_MIGRATIONS` is the record
`makeSqliteStack` feeds to the SQLite migrator (WAL journal mode, foreign
keys enabled)[^migrations-index]. `makeSqliteStack` defaults its
`migrations` argument to `PROJECT_MIGRATIONS`, and `PlatformLive`,
`ensureMigrated`, and the testing layer all build through it, so a migration
added to `migrations/index.ts` reaches every consumer at once. The
session-map and registry stacks in `programs/platform-sidecar.ts` pass their
own separate records.

Migration files are append-only post-2.0: never edit `0001_initial.ts` in
place; a table with data is ALTERed and backfilled in a new
`000N_*.ts`, and only a table with no readers and no writers may be dropped
and recreated. See [Add a Migration](../runbooks/add-a-migration.md) for the
step-by-step procedure and
[Schema Migrations](../conventions/schema-migrations.md) for the rule as a
standing convention. `packages/engine/src/sql/rows.ts` defines row shapes
for every table; `packages/engine/src/sql/assemblers.ts` joins them into
composite domain types. See
[SQLite Schema](../models/sqlite-schema.md) for the table inventory.

## Testing subpath

`packages/engine/src/testing/`, exported as `@vitest-agent/engine/testing`.
Provides in-process SQLite test infrastructure without requiring the full
Effect runtime: `makeTestLayer(filename)` builds a fully-migrated SQLite
layer from a path or `:memory:` (composing `DataStoreLive`, `DataReaderLive`,
and a full `makeSqliteStack(filename)` over `NodePlatformLayer`), and
`DataStoreTestLayer` is `makeTestLayer(":memory:")` for tests that need no
persistent file. Five preset factories (`empty`, `singlePassingRun`,
`withFailures`, `flaky`, `withTddTask`) seed representative database states,
each accepting `filename` and internally calling `makeTestLayer` before
seeding data via `Layer.effectDiscard`.

## Output pipeline

`packages/engine/src/layers/OutputPipelineLive.ts`. `OutputPipelineLive(env)`
merges the five output services (`EnvironmentDetectorLive(env)`,
`ExecutorResolverLive`, `FormatSelectorLive`, `DetailResolverLive`,
`OutputRendererLive`) into the one composite `PlatformLive` includes: a
pipeline of detect → resolve executor → select format → resolve detail →
render, where each stage is independently testable and an explicit override
can short-circuit automatic selection at any stage.

## Choices absorbed here

### Effect Services over Plain Functions

The reporter, CLI, and MCP server share functionality — cache reading,
coverage processing — and all three need testable I/O without mocking Node
APIs directly. The output pipeline needed distinct stages (detect → resolve
→ select → resolve detail → render) to be individually testable, and the
data-layer split (`DataStore` writes, `DataReader` reads) enables different
composition in different contexts (the reporter writes, the CLI and MCP
server read). On Effect v4 the service tag constructor is `Context.Service`
(the v3 `Context.Tag` rename); Live layers use the core `effect`
`FileSystem` and `@effect/sql-sqlite-node`, test layers swap in mock
implementations. This choice is recorded in full as
[Effect Services over Plain Functions](../decisions/6-effect-services-over-plain-functions.md).

### Effect-Based Structured Logging

`LoggerLive` was built on `Logger.structuredLogger` rather than a bespoke
formatter specifically so NDJSON output integrates directly with the
`Effect.logDebug` calls already threaded through every service method, and
so the env-var fallback (`VITEST_REPORTER_LOG_LEVEL`,
`VITEST_REPORTER_LOG_FILE`) enables logging without a config change — useful
for CI debugging without a redeploy.

### Effect Service / Layer Separation (pattern)

Used across every Effect service in this package (plus the plugin-local
`CoverageAnalyzer`): a clean separation between the service interface
(`Context.Service`) and its implementation (a `Layer`) is what lets a live
I/O layer swap for a test mock without touching a caller. Service tags live
in `src/services/`, Live and test layers in `src/layers/`, and the merged
composition layers are `PlatformLive`, `ReporterLive`, `SidecarPlatformLive`,
and `OutputPipelineLive`.

### One Launched Layer for Long-Lived Processes (pattern)

The MCP server is a long-running stdio process where per-call layer
construction would be wasteful, unlike the reporter's per-hook
`Effect.runPromise`. `main.ts` builds `ServerLayer` provided with
`McpSession`, this package's `PlatformLive`, and `NodeStdio.layer`, then runs
`Layer.launch` under `NodeRuntime.runMain`. Tool handlers are Effects that
declare their services as `Tool.make` dependencies; the SQLite connection
and the stdio protocol are scoped to the launched layer and released
together when stdin closes.

### Manifest-First Read (pattern)

`DataReader.getManifest()` assembles a `CacheManifest` on the fly from the
latest test run per project in the `test_runs` table, rather than
maintaining a manifest as a primary on-disk structure. This lets an agent or
CLI command quickly assess a project's state before fetching detailed data,
at the cost of recomputing the view on every call instead of reading it
directly.

### Hash-Based Change Detection (pattern)

Coverage trend tracking needs to detect when coverage targets change
between runs, since a changed target invalidates historical trend data as a
point of comparison. `hashTargets()` serializes `ResolvedThresholds` to a
JSON string, stored as `targetsHash` on each trend entry; when the hash
differs from the prior entry, trend history resets rather than comparing
against a target that no longer applies.

[^boundaries-test]: `../../packages/engine/__test__/boundaries.test.ts`
[^platform-ts]: `../../packages/engine/src/platform.ts:56` (`NodePlatformLayer`), `../../packages/engine/src/platform.ts:69` (`makeSqliteStack`), `../../packages/engine/src/platform.ts:123` (`PlatformLive`)
[^project-dir-ts]: `../../packages/engine/src/project-dir.ts:23`
[^data-store-live]: `../../packages/engine/src/layers/DataStoreLive.ts:646` (`writeTurn`), `../../packages/engine/src/layers/DataStoreLive.ts:761` (`writeFailureSignature`), `../../packages/engine/src/layers/DataStoreLive.ts:977` (ordinal allocation)
[^migration-behavior-id]: `../../packages/engine/src/migrations/0001_initial.ts:743`
[^resolve-data-path]: `../../packages/engine/src/utils/resolve-data-path.ts:38`
[^path-resolution-live]: `../../packages/engine/src/layers/PathResolutionLive.ts:11`
[^hook-paths]: `../../packages/engine/src/programs/hook-paths.ts:58`
[^ensure-migrated]: `../../packages/engine/src/utils/ensure-migrated.ts:7`
[^migrations-index]: `../../packages/engine/src/migrations/index.ts:20`
