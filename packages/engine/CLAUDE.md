# @vitest-agent/engine

The platform half of the #412 core/engine split: Effect services and their
Live/Test layers, the SQLite client + migrator assembly, the migrations, XDG
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
                         MigratorLayer }; NodePlatformLayer (= NodeServices.layer);
                         PlatformLive({ dbPath, env, logLevel?, logFile? }) -- the
                         one merged layer (DataReader | DataStore | ProjectDiscovery
                         | HistoryTracker | output pipeline | Sqlite | Node)
  project-dir.ts      -- resolveProjectDir({ env, cwd }): VITEST_AGENT_PROJECT_DIR
                         -> VITEST_AGENT_REPORTER_PROJECT_DIR -> CLAUDE_PROJECT_DIR
                         -> cwd; both front ends call it
  version.ts          -- CURRENT_ENGINE_VERSION (the one sanctioned
                         process.env.__PACKAGE_VERSION__ read)
  services/           -- 14 Context.Service tags (DataStore, DataReader,
                         ProjectDiscovery, HistoryTracker, RunContext,
                         ProjectIdentity, PerClientSessionMap, DiscoveryRegistry,
                         EnvironmentDetector, ExecutorResolver, FormatSelector,
                         DetailResolver, OutputRenderer, Config) + idempotency.ts
  layers/             -- *Live.ts / *Test.ts per service; PathResolutionLive
                         (XDG + config + workspaces; exports APP_NAMESPACE),
                         OutputPipelineLive(env), LoggerLive(level?, file?) +
                         resolveLogLevel(env, option?) / resolveLogFile(env, option?)
  sql/                -- row shapes + row-to-domain assemblers
  migrations/         -- PROJECT_MIGRATIONS record (0001_initial,
                         0002_test_artifacts) + registry / session-map sets
  programs/           -- hook-driven bodies: hook-paths.ts
                         (resolveHookPaths({ env, projectKey }),
                         resolveSessionMapPath(env), *_DB_FILENAME),
                         register-agent.ts, end-agent.ts, record-session.ts,
                         record-tdd-artifact.ts, record-turn.ts,
                         record-workspace-changes.ts,
                         resolve-session-for-recording.ts, session-env.ts
                         (SessionContext, parseSessionEnvExports,
                         recoverSessionContextFromSessionEnv({ projectDir, homeDir })),
                         platform-sidecar.ts (SidecarPlatformLive(paths, env))
  lib/                -- formatTriageEffect / formatWrapupEffect (CLI + MCP)
  utils/              -- resolveDataPath, ensureMigrated,
                         resolveProjectKeyFromCwd, resolveWorkspaceKey,
                         computeFailureSignature (node:crypto)
  testing/            -- the @vitest-agent/engine/testing subpath:
                         makeTestLayer(filename), DataStoreTestLayer
                         (":memory:"), five preset factories
```

## Rules

- **No `process` reads anywhere under `src/`, no allowlist.** Enforced by
  `__test__/boundaries.test.ts` (comments stripped before scanning). The one
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
- **One SQLite assembly.** `PlatformLive`, `ensureMigrated`,
  `SidecarPlatformLive` (three stacks: project / session-map / registry) and
  `testing/layers.ts` all build through `makeSqliteStack`. Don't hand-roll a
  `SqliteClient.layer` + migrator pair elsewhere.
- **Migrations are append-only post-2.0.** New files register in
  `migrations/index.ts`'s `PROJECT_MIGRATIONS`; never edit `0001_initial.ts`.
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

## Known discrepancy

With `XDG_DATA_HOME` unset, `resolveDataPath` (via `PathResolutionLive`'s
bare `AppDirs.layer({ namespace })`) resolves under `~/.vitest-agent/<key>/`
while `resolveHookPaths` passes `fallbackDir: ".local/share/vitest-agent"` and
resolves under `~/.local/share/vitest-agent/<key>/`. Pre-existing, preserved
on purpose (aligning it moves real installs' data), tracked as a follow-up.

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

- `@./.claude/design/vitest-agent/components/engine.md`
  Load when working on services, layers, migrations, programs, or the
  platform assembly.
- `@./.claude/design/vitest-agent/architecture.md`
  Load for the package diagram and the rank rule.
- `@./.claude/design/vitest-agent/schemas.md`
  Load when touching SQLite tables or the row assemblers.
- `@./.claude/design/vitest-agent/file-structure.md`
  Load when touching `resolveDataPath`, `PathResolutionLive`, hook paths,
  or workspace-key normalization.
- `@./.claude/design/vitest-agent/decisions.md`
  Load for D28 (`ensureMigrated`), D31 (path resolution), D9 (migration
  policy), D10 (failure signatures).
