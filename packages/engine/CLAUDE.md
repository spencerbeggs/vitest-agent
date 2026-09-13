# @vitest-agent/engine

Platform-dependent half of the former `@vitest-agent/sdk` split (issue 412): Effect services,
layers, the SQLite data layer, migrations, and platform resolution. `@vitest-agent/sdk` keeps
the platform-free core (schemas, contracts, pure utilities); this package holds everything that
touches a filesystem, a process, or SQLite. Both `@vitest-agent/cli` and `@vitest-agent/mcp`
import it.

Layout (`src/`): `services/` (Context tags), `layers/` (Live/Test layers),
`sql/` (row shapes + assemblers), `migrations/` (`PROJECT_MIGRATIONS` and the
registry / session-map sets), `lib/` (`formatTriageEffect` / `formatWrapupEffect`),
`utils/` (`ensureMigrated`, `resolveDataPath`, `resolveProjectKeyFromCwd`,
`resolveWorkspaceKey`, `computeFailureSignature`), `programs/` (the hook-driven
programs the CLI commands wrap and the MCP server calls — `hook-paths.ts`
(`resolveHookPaths({ env, projectKey })` / `resolveSessionMapPath(env)` on
`@effected/xdg`, plus the `*_DB_FILENAME` constants), `register-agent.ts`,
`end-agent.ts`, `record-session.ts`, `record-tdd-artifact.ts`, `record-turn.ts`,
`record-workspace-changes.ts`, `resolve-session-for-recording.ts`,
`session-env.ts` (`SessionContext`, `parseSessionEnvExports`,
`recoverSessionContextFromSessionEnv({ projectDir, homeDir })`) and
`platform-sidecar.ts` (`SidecarPlatformLive(paths, env)`, the three-DB sidecar
layer built from `makeSqliteStack`)), and `testing/` (the
`@vitest-agent/engine/testing` subpath: `makeTestLayer`, `DataStoreTestLayer`,
preset factories). Core types come in only through `import … from "@vitest-agent/sdk"`
— never by relative path across the package boundary.

**Rule: no `process` reads anywhere under `src/`.** No allowlist —
enforced by `__test__/boundaries.test.ts`. Platform reads go through
injected Effect services/ports, never a direct `process.env` /
`process.argv` / `process.cwd()` call in source. Every ambient input a
program needs (`env`, `cwd`, `homeDir`) is a parameter the front end
passes (`process.env`, `process.cwd()`, `os.homedir()`); the XDG root is
read from the injected `env` map by installing it as the `ConfigProvider`
under `@effected/xdg`'s `Xdg.layer` (see `programs/hook-paths.ts`).
