# @vitest-agent/engine

The platform half of the #412 core/engine split: Effect services and their
Live/Test layers, the SQLite assembly (on `@effected/store` / `@effected/app`),
the migrations, XDG
path resolution, the hook-driven programs the CLI commands wrap, boot-time
session recovery, and the one `PlatformLive` layer both front ends provide.
Rank 3 in the workspace layering; its only workspace dependency is
`@vitest-agent/sdk` (the platform-free core). Consumed by `@vitest-agent/cli`,
`@vitest-agent/mcp`, and `@vitest-agent/plugin` (`ReporterLive` wraps
`PlatformLive`). `ui`, `reporter`, and the sidecar packages never import it.

## Layout

```text
src/
  index.ts            -- barrel: every service, layer, program, migration
                         record and utility below, plus CURRENT_ENGINE_VERSION
  platform.ts         -- makeSqliteStack(filename, migrations?) -> { SqliteLayer,
                         MigratorLayer } (Store.layer over our SqliteClient);
                         PlatformLiveError (= SqlError | StoreError |
                         StoreMigrationError);
                         NodePlatformLayer (= NodeServices.layer);
                         PlatformLive({ dbPath, env, logLevel?, logFile?, logger? })
                         (logger: false skips LoggerLive for a caller-owned
                         logger set, as the CLI's CliLog) -- the
                         one merged layer (DataReader | DataStore | ProjectDiscovery
                         | HistoryTracker | output pipeline | Sqlite | Node)
  stores.ts           -- internal: MigrationRecord (re-exported via platform.ts),
                         toStoreMigrations (effect/sql key parse), LEDGER_OPTIONS,
                         keyed store tags RegistryStore / SessionMapStore
  project-dir.ts      -- resolveProjectDir({ env, cwd }): VITEST_AGENT_PROJECT_DIR
                         -> VITEST_AGENT_REPORTER_PROJECT_DIR -> CLAUDE_PROJECT_DIR
                         -> cwd, via @effected/engine's LaunchContext.projectDir
                         (values trimmed; blank or unsubstituted `${...}` =
                         unset); both front ends call it
  version.ts          -- CURRENT_ENGINE_VERSION (the one sanctioned
                         process.env.__PACKAGE_VERSION__ read)
  services/           -- 12 Context.Service tags (DataStore, DataReader,
                         ProjectDiscovery, HistoryTracker, RunContext,
                         ProjectIdentity, PerClientSessionMap, DiscoveryRegistry,
                         EnvironmentDetector, ExecutorResolver, DetailResolver,
                         Config) + idempotency.ts
  layers/             -- *Live.ts / *Test.ts per service; PathResolutionLive
                         (XDG + config + workspaces; exports APP_NAMESPACE),
                         OutputPipelineLive(env), EnvironmentDetectorLive(env)
                         over @effected/env's CurrentRuntimeEnv.layerFrom(env)
                         (exhaustive CiName table), LoggerLive(level?, file?, env?)
                         over @effected/cli's CliLog in diagnostics-only mode
                         ({ format: "json", plainLogger: false, level, file });
                         env -> CurrentRuntimeEnv so records are neutralized
                         under GitHub Actions (PlatformLive passes options.env,
                         ensureMigrated takes an optional env) +
                         resolveLogLevel(env, option?) / resolveLogFile(env, option?)
  sql/                -- row shapes + row-to-domain assemblers
  migrations/         -- PROJECT_MIGRATIONS record (0001_initial,
                         0002_test_artifacts) + registry / session-map sets
  programs/           -- hook-driven bodies: hook-paths.ts
                         (resolveHookPaths({ env, projectKey }),
                         resolveSessionMapPath(env), *_DB_FILENAME,
                         REGISTRY_STORE_OPTIONS),
                         register-agent.ts, end-agent.ts, record-session.ts,
                         record-tdd-artifact.ts, record-turn.ts,
                         record-workspace-changes.ts,
                         resolve-session-for-recording.ts, session-env.ts
                         (SessionContext, parseSessionEnvExports,
                         recoverSessionContextFromSessionEnv({ projectDir, homeDir,
                         fileSystem? })),
                         platform-sidecar.ts (SidecarPlatformLive(paths, env))
  lib/                -- formatTriageEffect / formatWrapupEffect (CLI + MCP)
  utils/              -- resolveDataPath, ensureMigrated,
                         resolveProjectKeyFromCwd (+ FileSystem-backed
                         resolveProjectKeyFromCwdEffect), resolveWorkspaceKey,
                         computeFailureSignature (node:crypto)
  testing/            -- the @vitest-agent/engine/testing subpath:
                         makeTestLayer(filename), DataStoreTestLayer
                         (":memory:"), five preset factories
```

## Rules

- **No `process` reads anywhere under `src/`, no allowlist.** Enforced by
  `__test__/boundaries.test.ts` (`SourceBoundary.scan` from
  `@effected/workspaces/testing`; comments blanked before scanning). The one
  exemption is the literal token `process.env.__PACKAGE_VERSION__`, allowed
  only in `src/version.ts`. Every ambient input a program needs (`env`,
  `cwd`, `homeDir`) is a parameter the front end passes from its `main.ts`
  / commands. The XDG root is read from the injected `env` by installing it
  as the `ConfigProvider` under `@effected/xdg`'s `Xdg.layer`
  (`programs/hook-paths.ts`); `USERPROFILE` is copied into `HOME` first.
- **Never import a front end.** The same test forbids `@vitest-agent/cli`,
  `mcp`, `plugin`, `reporter`, `ui`. Core types come in only via
  `import … from "@vitest-agent/sdk"`, never a relative path across the
  package boundary.
- **Every database is an `@effected/store` store with `LEDGER_OPTIONS`.**
  `data.db` goes through `makeSqliteStack` (`Store.layer` over our own
  `SqliteClient.layer`), used by `PlatformLive`, `ensureMigrated`,
  `testing/layers.ts`, and `SidecarPlatformLive`'s project store.
  `sessions.db` (`Store.layerSqliteAs(SessionMapStore, …)`) and `registry.db`
  (`Store.layerSqliteAs(RegistryStore, { filename: paths.registryDbPath,
  migrations: REGISTRY_STORE_OPTIONS.migrations, … })`) are keyed stores
  opened only in `SidecarPlatformLive`, each at the path it is given; their
  Live layers get the bare `SqlClient` from `Store.sqlClient(tag)`.
  `@effected/app` is used only for `AppStore.location` in `hook-paths.ts`,
  which derives `registryDbPath`. Never hand-roll a `SqliteMigrator`, and
  never open a store without `LEDGER_OPTIONS` (adopt a 2.x
  `effect_sql_migrations` ledger once): skipping it re-runs every migration
  on an upgraded file. There is no mirror back into `effect_sql_migrations`,
  and an older vitest-agent opening a file this version created is not
  supported. `PlatformLiveError` is the public error alias; dependents name
  it instead of importing `@effected/store`.
- **Migrations are append-only post-2.0.** New files register in
  `migrations/index.ts`'s `PROJECT_MIGRATIONS` (or the session-map /
  registry record), keyed `NNNN_name`; never rename a shipped key and never
  edit `0001_initial.ts`.
- **Load-bearing deps no `src/` file imports:** `@effected/jsonc`,
  `@effected/toml`, `@effected/walker`, `@effected/yaml` are declared
  because they are peers of `@effected/config-file`; keep them in
  `dependencies` even though a grep finds no import.
- **Breaking signatures from the split** (majors are owed, not free edits):
  `OutputPipelineLive(env)`, `EnvironmentDetectorLive(env)`,
  `RunContextLive(env)`, `resolveLogLevel` / `resolveLogFile(env, option?)`,
  `resolveSessionMapPath(env)`, `recordTurn` / `recordTddArtifact` /
  `resolveSessionForRecording` take a required `cwd`, and the register-agent
  program's types are `RegisterAgentProgramInput` / `-Output` (the bare names
  belong to `DataStore`).

## XDG fallback

`PathResolutionLive` (reporter/MCP) and `resolveHookPaths` (hook/sidecar)
both pass `DATA_FALLBACK_DIR` from `layers/PathResolutionLive.ts` to
`AppDirs`, so with `XDG_DATA_HOME` unset both resolve under
`~/.local/share/vitest-agent/<key>/` (pinned by
`__test__/xdg-fallback-alignment.test.ts`). Any new `AppDirs.layer` must pass
it too. Legacy `~/.vitest-agent/<key>/data.db` files are not migrated;
`~/.vitest-agent/sessions.db` (the session map) is unrelated and still lives
there.

## When working in this package

- Adding a `DataStore` / `DataReader` method: update the service tag and the
  Live layer, add `Effect.logDebug`, use `extractSqlReason(e)` (from sdk) in
  `mapError`; export any new options interface from both `index.ts` and
  `testing/index.ts`.
- Adding a program: put the body in `programs/`, take `env` / `cwd` as
  parameters, keep `FileSystem` / `Path` in `R` for the front end to supply
  via `NodePlatformLayer`; the CLI command in `packages/cli/src/commands/`
  is a thin wrapper.
- Tests live in `__test__/` (flat; `integration/` for `.int.test.ts`);
  filesystem-touching tests mount `@effected/memfs`.
- The build's API Extractor pass flags every public export without a
  release tag — tag new exports `@public` (or `@internal`).

## Design references

- [`../../okf/modules/engine.md`](../../okf/modules/engine.md)
  Load when working on services, layers, migrations, programs, or the
  platform assembly.
- [`../../okf/invariants/ranked-layering.md`](../../okf/invariants/ranked-layering.md)
  Load for the package diagram and the rank rule.
- [`../../okf/models/sqlite-schema.md`](../../okf/models/sqlite-schema.md)
  Load when touching SQLite tables or the row assemblers.
- [`../../okf/interfaces/config-toml.md`](../../okf/interfaces/config-toml.md),
  [`../../okf/gotchas/legacy-reporter-data-root.md`](../../okf/gotchas/legacy-reporter-data-root.md)
  Load when touching `resolveDataPath`, hook paths, or workspace-key
  normalization.
- [`../../okf/decisions/28-process-level-migration-coordination-via-globalthis-cache.md`](../../okf/decisions/28-process-level-migration-coordination-via-globalthis-cache.md),
  [`../../okf/decisions/31-deterministic-xdg-path-resolution.md`](../../okf/decisions/31-deterministic-xdg-path-resolution.md),
  [`../../okf/decisions/d9-single-pre-2-0-migration-incremental-after.md`](../../okf/decisions/d9-single-pre-2-0-migration-incremental-after.md),
  [`../../okf/decisions/d10-stable-failure-signatures-via-ast-function-boundary.md`](../../okf/decisions/d10-stable-failure-signatures-via-ast-function-boundary.md)
  Load for `ensureMigrated`, path resolution, migration policy, and failure
  signatures respectively.
- [`../../okf/decisions/76-adopt-effected-store-with-an-adopt-only-ledger.md`](../../okf/decisions/76-adopt-effected-store-with-an-adopt-only-ledger.md),
  [`../../okf/limitations/older-installs-cannot-open-newer-databases.md`](../../okf/limitations/older-installs-cannot-open-newer-databases.md)
  Load before touching store assembly, `LEDGER_OPTIONS`, or
  `toStoreMigrations`.
- [`../../okf/runbooks/add-a-migration.md`](../../okf/runbooks/add-a-migration.md)
  Load before adding a new schema migration.
