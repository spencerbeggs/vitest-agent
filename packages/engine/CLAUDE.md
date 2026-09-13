# @vitest-agent/engine

Platform-dependent half of the former `@vitest-agent/sdk` split (issue 412): Effect services,
layers, the SQLite data layer, migrations, and platform resolution. `@vitest-agent/sdk` keeps
the platform-free core (schemas, contracts, pure utilities); this package holds everything that
touches a filesystem, a process, or SQLite. Both `@vitest-agent/cli` and `@vitest-agent/mcp`
import it.

Currently a scaffold — this task only stands up the package shape (build,
typecheck, test discovery, docs-model slot); a later task moves the
actual services/layers/migrations code over from `@vitest-agent/sdk`.

**Rule: no `process` reads anywhere under `src/`.** No allowlist —
enforced by a boundary test added later. Platform reads go through
injected Effect services/ports, never a direct `process.env` /
`process.argv` / `process.cwd()` call in source.
