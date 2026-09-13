# @vitest-agent/engine

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
