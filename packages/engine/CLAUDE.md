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
`resolveWorkspaceKey`, `computeFailureSignature`), and `testing/` (the
`@vitest-agent/engine/testing` subpath: `makeTestLayer`, `DataStoreTestLayer`,
preset factories). Core types come in only through `import … from "@vitest-agent/sdk"`
— never by relative path across the package boundary.

**Rule: no `process` reads anywhere under `src/`.** No allowlist —
enforced by a boundary test added later. Platform reads go through
injected Effect services/ports, never a direct `process.env` /
`process.argv` / `process.cwd()` call in source.
