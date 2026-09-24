# @vitest-agent/engine

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
