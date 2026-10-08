# @vitest-agent/engine

## 1.0.0

### Breaking Changes

- Removed the unused `FormatSelector` service and its `FormatSelectorLive` layer. `PlatformServices` and `OutputPipelineLive` no longer include it, so a program that provided or required `FormatSelector` must drop it.

- `PlatformLiveError` and `SqliteStack.SqliteLayer` now include `SqlError` in their error channel, because `@effect/sql-sqlite-node` 4.0.2 types opening the database as fallible. Code that exhaustively handles those errors needs to account for it. [#575][#575]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | ^4.0.0 | ^4.0.2 |
| @effect/sql-sqlite-node | dependency | updated | ^4.0.0 | ^4.0.2 |
| @effected/app | dependency | updated | ^0.21.1 | ^0.21.2 |
| @effected/cli | dependency | updated | ^0.12.0 | ^0.15.0 |
| @effected/engine | dependency | updated | ^0.3.0 | ^0.4.0 |
| @effected/jsonc | dependency | updated | ^0.15.0 | ^0.15.1 |
| @effected/store | dependency | updated | ^0.13.0 | ^0.13.1 |
| @effected/toml | dependency | updated | ^0.11.0 | ^0.11.1 |
| @effected/workspaces | dependency | updated | ^0.31.0 | ^0.32.0 |
| @effected/yaml | dependency | updated | ^0.19.0 | ^0.19.1 |
| @vitest-agent/sdk | dependency | updated | 6.1.0 | 7.0.0 |
| effect | dependency | updated | ^4.0.0 | ^4.0.2 |

[#575][#575]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#575]: https://github.com/spencerbeggs/vitest-agent/pull/575

## 0.6.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/sdk | dependency | updated | 6.0.0 | 6.1.0 |

## 0.6.0

### Features

#### SQLite assembly on `@effected/store`

- All three databases (`data.db`, `sessions.db`, `registry.db`) now open through `@effected/store`, which adopts effect/sql's existing `effect_sql_migrations` ledger on first open.

- Existing 2.x databases keep their migration history and nothing is re-run.

- The ledger is not mirrored back, so an older vitest-agent opening a database this version created is not supported.

- New public type alias `PlatformLiveError` (`StoreError | StoreMigrationError`) is now the error type of `PlatformLive` and of `makeSqliteStack`'s `MigratorLayer`. It is exported from the package barrel and from `./testing`.

- `resolveHookPaths` now derives `registryDbPath` with `@effected/app`'s `AppStore.location`, and `SidecarPlatformLive` opens every path in `SidecarPaths` as given.

- `MigrationRecord` now types each migration's error as `SqlError` (previously `unknown`). A custom record passed to `makeSqliteStack` whose migrations fail with another error type no longer typechecks.

- Migration debug records now come from the store. [#563][#563]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/config-file | dependency | updated | ^0.14.0 | ^0.14.2 |
| @effected/app | dependency | added | — | ^0.21.1 |
| @effected/store | dependency | added | — | ^0.13.0 |

[#563][#563]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#563]: https://github.com/spencerbeggs/vitest-agent/pull/563

## 0.5.0

### Breaking Changes

- Removed the unused `OutputRenderer` service and `OutputRendererLive` layer. `OutputPipelineLive` and `PlatformLive` no longer provide `OutputRenderer`. [#557][#557]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/sdk | dependency | updated | 5.2.0 | 6.0.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#557]: https://github.com/spencerbeggs/vitest-agent/pull/557

## 0.4.0

### Breaking Changes

- `classifyEnvironment` now takes a `RuntimeEnv` snapshot from `@effected/env` instead of an env record plus a separate agent-shell flag.

```typescript
import { RuntimeEnv } from "@effected/env";

// before
classifyEnvironment(process.env, isAgentShell);
// after
classifyEnvironment(RuntimeEnv.fromRecord(process.env));
```

- Agent detection now comes from the same snapshot, so the separate flag is gone. Callers of the packaged `EnvironmentDetectorLive` layer are unaffected.

### Features

- `PlatformOptions` gains `logger?: boolean` (default `true`). Pass `false` when the host already owns the logger set, for example under `@effected/cli`'s `CliRuntime.main`; `logLevel` and `logFile` are then ignored.
- CI detection is broader: `CI=1`, `CONTINUOUS_INTEGRATION`, and `GITHUB_ACTIONS` are recognised, and `GITHUB_ACTIONS` wins even when `CI=false`.
- Under GitHub Actions the logger is neutralized so log lines cannot inject workflow commands.

### Bug Fixes

- Agent detection is now driven by the injected environment rather than `std-env`, so tests and embedders see consistent results. `std-env` is no longer a dependency.
- Log-file lines now match the NDJSON shape written to stderr, and file writes are asynchronous. [#539][#539]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| std-env | dependency | removed | ^4.2.0 | — |
| @effect/platform-node | dependency | updated | 4.0.0-rc.118 | ^4.0.0 |
| @effect/sql-sqlite-node | dependency | updated | 4.0.0-rc.118 | ^4.0.0 |
| @effected/config-file | dependency | updated | ^0.13.1 | ^0.14.0 |
| @effected/engine | dependency | updated | ^0.2.0 | ^0.3.0 |
| @effected/glob | dependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/jsonc | dependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/toml | dependency | updated | ^0.10.0 | ^0.11.0 |
| @effected/walker | dependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/workspaces | dependency | updated | ^0.30.3 | ^0.31.0 |
| @effected/xdg | dependency | updated | ^0.8.2 | ^0.9.0 |
| @effected/yaml | dependency | updated | ^0.18.0 | ^0.19.0 |
| @vitest-agent/sdk | dependency | updated | 5.1.3 | 5.2.0 |
| effect | dependency | updated | 4.0.0-rc.118 | ^4.0.0 |
| @effected/cli | dependency | added | — | ^0.11.0 |
| @effected/env | dependency | added | — | ^0.1.0 |

[#539][#539]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#539]: https://github.com/spencerbeggs/vitest-agent/pull/539

## 0.3.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/workspaces | dependency | updated | ^0.30.2 | ^0.30.3 |

[#537][#537]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#537]: https://github.com/spencerbeggs/vitest-agent/pull/537

## 0.3.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/xdg | dependency | updated | ^0.8.1 | ^0.8.2 |

[#530][#530]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#530]: https://github.com/spencerbeggs/vitest-agent/pull/530

## 0.3.0

### Features

- Added `resolveProjectKeyFromCwdEffect(cwd)`, an Effect form of `resolveProjectKeyFromCwd` that reads `package.json` through the ambient `FileSystem` service. It follows the same rules and never fails.
- Added the `SessionEnvFileSystem` interface and an optional `fileSystem` option on `recoverSessionContextFromSessionEnv`, so session-env recovery can read from a source other than the real disk. The default is unchanged. [#527][#527]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#527]: https://github.com/spencerbeggs/vitest-agent/pull/527

## 0.2.11

### Bug Fixes

- With `XDG_DATA_HOME` unset, the reporter and MCP server now store `data.db` under `~/.local/share/vitest-agent/<workspaceKey>/`, the same directory the Claude Code hooks and sidecar use. Previously they fell back to `~/.vitest-agent/<workspaceKey>/`, so the two halves could write to different databases. Closes #422.
- Upgrade note: an existing `~/.vitest-agent/<workspaceKey>/data.db` is not migrated and is no longer read, so history starts fresh at the new location. Move `data.db` (plus its `-wal` and `-shm` files) by hand to keep it. Users who set `XDG_DATA_HOME` are unaffected.
- The fallback directory is now exported as `DATA_FALLBACK_DIR` alongside `APP_NAMESPACE`. [#521][#521]

### Performance

- `DataReader` now reads a test's annotation and artifact attachments with one query per call instead of one query per annotation or artifact, so a test that records many annotations no longer multiplies database round trips (#395). [#521][#521]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | ^0.13.0 | ^0.13.1 |
| @effected/walker | dependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/workspaces | dependency | updated | ^0.30.1 | ^0.30.2 |
| @effected/xdg | dependency | updated | ^0.8.0 | ^0.8.1 |

[#521][#521]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#521]: https://github.com/spencerbeggs/vitest-agent/pull/521

## 0.2.10

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/workspaces | dependency | updated | ^0.30.0 | ^0.30.1 |

[#519][#519]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#519]: https://github.com/spencerbeggs/vitest-agent/pull/519

## 0.2.9

### Bug Fixes

- Fixes runtime incompatibility with `effect` `4.0.0-rc.118` and the current `@effected` kit. Published `0.2.8` pins `effect`/`@effect/platform-node`/`@effect/sql-sqlite-node` to `4.0.0-rc.117` and older `@effected` package ranges; installed next to a consumer on `rc.118` this fails at import time. This release moves the dependency range to `4.0.0-rc.118` and the matching `@effected/*` ranges, and renames every `effect/unstable/*` import (including inside the SQLite migrations) to its `effect/*` equivalent to match. No public API or schema changes. [#514][#514]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.117 | 4.0.0-rc.118 |
| @effect/sql-sqlite-node | dependency | updated | 4.0.0-rc.117 | 4.0.0-rc.118 |
| @effected/config-file | dependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/engine | dependency | updated | ^0.1.0 | ^0.2.0 |
| @effected/glob | dependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/jsonc | dependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/toml | dependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/walker | dependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/workspaces | dependency | updated | ^0.28.0 | ^0.30.0 |
| @effected/xdg | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/yaml | dependency | updated | ^0.17.0 | ^0.18.0 |
| @vitest-agent/sdk | dependency | updated | 5.1.2 | 5.1.3 |
| effect | dependency | updated | 4.0.0-rc.117 | 4.0.0-rc.118 |

[#514][#514]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#514]: https://github.com/spencerbeggs/vitest-agent/pull/514

## 0.2.8

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/workspaces | dependency | updated | ^0.27.0 | ^0.28.0 |

[#506][#506]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#506]: https://github.com/spencerbeggs/vitest-agent/pull/506

## 0.2.7

### Bug Fixes

- `resolveProjectDir` now treats blank/whitespace-only values and unsubstituted `${...}` placeholders in `LaunchContext` as unset, instead of resolving them as a literal directory. [#502][#502]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/workspaces | dependency | updated | ^0.26.0 | ^0.27.0 |
| @effected/engine | dependency | added | — | ^0.1.0 |

[#502][#502]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#502]: https://github.com/spencerbeggs/vitest-agent/pull/502

## 0.2.6

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/workspaces | dependency | updated | ^0.25.0 | ^0.26.0 |

[#497][#497]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#497]: https://github.com/spencerbeggs/vitest-agent/pull/497

## 0.2.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.116 | 4.0.0-rc.117 |
| @effect/sql-sqlite-node | dependency | updated | 4.0.0-rc.116 | 4.0.0-rc.117 |
| @effected/config-file | dependency | updated | ^0.11.1 | ^0.12.0 |
| @effected/glob | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/jsonc | dependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/toml | dependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/walker | dependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/workspaces | dependency | updated | ^0.24.1 | ^0.25.0 |
| @effected/xdg | dependency | updated | ^0.6.1 | ^0.7.0 |
| @effected/yaml | dependency | updated | ^0.16.0 | ^0.17.0 |
| @vitest-agent/sdk | dependency | updated | 5.1.1 | 5.1.2 |
| effect | dependency | updated | 4.0.0-rc.116 | 4.0.0-rc.117 |

[#491][#491]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#491]: https://github.com/spencerbeggs/vitest-agent/pull/491

## 0.2.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | ^0.11.0 | ^0.11.1 |
| @effected/walker | dependency | updated | ^0.10.0 | ^0.11.0 |
| @effected/workspaces | dependency | updated | ^0.24.0 | ^0.24.1 |
| @effected/xdg | dependency | updated | ^0.6.0 | ^0.6.1 |

[#482][#482]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#482]: https://github.com/spencerbeggs/vitest-agent/pull/482

## 0.2.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/workspaces | dependency | updated | ^0.23.0 | ^0.24.0 |

[#480][#480]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#480]: https://github.com/spencerbeggs/vitest-agent/pull/480

## 0.2.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| @effect/sql-sqlite-node | dependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| @effected/config-file | dependency | updated | ^0.10.1 | ^0.11.0 |
| @effected/glob | dependency | updated | ^0.6.1 | ^0.7.0 |
| @effected/jsonc | dependency | updated | ^0.11.1 | ^0.12.0 |
| @effected/toml | dependency | updated | ^0.7.1 | ^0.8.0 |
| @effected/walker | dependency | updated | ^0.9.1 | ^0.10.0 |
| @effected/workspaces | dependency | updated | ^0.22.1 | ^0.23.0 |
| @effected/xdg | dependency | updated | ^0.5.3 | ^0.6.0 |
| @effected/yaml | dependency | updated | ^0.15.2 | ^0.16.0 |
| @vitest-agent/sdk | dependency | updated | 5.1.0 | 5.1.1 |
| effect | dependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |

[#476][#476]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#476]: https://github.com/spencerbeggs/vitest-agent/pull/476

## 0.2.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | ^0.10.0 | ^0.10.1 |
| @effected/glob | dependency | updated | ^0.6.0 | ^0.6.1 |
| @effected/jsonc | dependency | updated | ^0.11.0 | ^0.11.1 |
| @effected/toml | dependency | updated | ^0.7.0 | ^0.7.1 |
| @effected/walker | dependency | updated | ^0.9.0 | ^0.9.1 |
| @effected/workspaces | dependency | updated | ^0.22.0 | ^0.22.1 |
| @effected/xdg | dependency | updated | ^0.5.2 | ^0.5.3 |
| @effected/yaml | dependency | updated | ^0.15.1 | ^0.15.2 |

[#470][#470]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#470]: https://github.com/spencerbeggs/vitest-agent/pull/470

## 0.2.0

### Bug Fixes

- fixes pnpm 12 closure issues

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/sdk | dependency | updated | 5.0.1 | 5.1.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.3

### Bug Fixes

- Fixed `DataStore.recordIdempotentResponse` inserting with `ON CONFLICT DO NOTHING`, which left a corrupt cached row in place forever — a corrupt row now gets replaced by the handler's fresh result on retry instead of causing every subsequent call to re-execute the write tool [#460][#460]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/sdk | dependency | updated | 5.0.0 | 5.0.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#460]: https://github.com/spencerbeggs/vitest-agent/pull/460

## 0.1.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/sdk | dependency | updated | 4.0.0 | 5.0.0 |

## 0.1.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/xdg | dependency | updated | ^0.5.1 | ^0.5.2 |

[#443][#443]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#443]: https://github.com/spencerbeggs/vitest-agent/pull/443

## 0.1.0

### Features

#### Initial release

- `@vitest-agent/engine` is the platform half of the vitest-agent family, split out of `@vitest-agent/sdk`. It owns every Effect service and Live layer, the SQLite client and migrator, the migrations, and the hook programs that the CLI, MCP server, and Vitest plugin share.

- **Services and layers** — `DataStore`, `DataReader`, `Config`, `RunContext`, `ProjectIdentity`, `ProjectDiscovery`, `HistoryTracker`, `DetailResolver`, `FormatSelector`, `OutputRenderer`, `ExecutorResolver`, `DiscoveryRegistry`, `PerClientSessionMap`, `EnvironmentDetector`, each with its `*Live` layer (and `*Test` layers where they exist).

- **`makeSqliteStack(filename, migrations?)`** — the SQLite client plus migrator, fed by the `PROJECT_MIGRATIONS` record. Migrations `0001_initial` and `0002_test_artifacts` ship here.

- **`PlatformLive({ dbPath, env, logLevel?, logFile? })`** — the single platform layer both front ends provide.

- **`resolveProjectDir({ env, cwd })`** — resolves the project directory with precedence `VITEST_AGENT_PROJECT_DIR` → `VITEST_AGENT_REPORTER_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → `cwd`.

- **Environment-driven layers** — `EnvironmentDetectorLive(env)`, `RunContextLive(env)`, `OutputPipelineLive(env)`, `SidecarPlatformLive(paths, env)`, plus `resolveLogLevel(env, option?)` and `resolveLogFile(env, option?)`. Ambient input is always a parameter; the engine never reads `process`.

- **Hook programs** — `registerAgent`, `endAgent`, `recordSession`, `recordTurn`, `recordTddArtifact`, `recordWorkspaceChanges`, `resolveSessionForRecording`, `resolveHookPaths({ env, projectKey })`, and `recoverSessionContextFromSessionEnv({ projectDir, homeDir })`.

- **`./testing` subpath** — `makeTestLayer(":memory:")`, `DataStoreTestLayer`, and the preset factories (`empty`, `singlePassingRun`, `withFailures`, `flaky`, `withTddTask`).

- **`CURRENT_ENGINE_VERSION`** — inlined at build time for version introspection.

```ts
import { PlatformLive, resolveProjectDir } from "@vitest-agent/engine";

const projectDir = resolveProjectDir({ env: process.env, cwd: process.cwd() });
const platform = PlatformLive({ dbPath: "/path/to/data.db", env: process.env });
```

- Release note: `@vitest-agent/engine` must be published before `@vitest-agent/plugin`, which depends on it. [#420][#420]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | added | — | 4.0.0-rc.115 |
| @effect/sql-sqlite-node | dependency | added | — | 4.0.0-rc.115 |
| @effected/config-file | dependency | added | — | ^0.9.0 |
| @effected/jsonc | dependency | added | — | ^0.11.0 |
| @effected/toml | dependency | added | — | ^0.7.0 |
| @effected/walker | dependency | added | — | ^0.9.0 |
| @effected/workspaces | dependency | added | — | ^0.21.1 |
| @effected/xdg | dependency | added | — | ^0.5.1 |
| @effected/yaml | dependency | added | — | ^0.15.1 |
| @vitest-agent/sdk | dependency | added | — | 4.0.0 |
| effect | dependency | added | — | 4.0.0-rc.115 |
| std-env | dependency | added | — | ^4.2.0 |

[#420][#420]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#420]: https://github.com/spencerbeggs/vitest-agent/pull/420
