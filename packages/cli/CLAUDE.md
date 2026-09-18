# @vitest-agent/cli

The `effect/unstable/cli`-based bin (`vitest-agent`) for utility functions, database management, and hook plumbing. For 2.0 the CLI is utility-only — MCP is the data path for test-landscape queries. The top-level tree is exactly three commands: `doctor`, `db`, and `agent`. Reads cached test data from SQLite via `DataReader`; never runs tests or calls AI providers. Rank 4 in the workspace layering: depends on `@vitest-agent/engine`, `@vitest-agent/sdk`, and `@vitest-agent/sidecar`; never on `@vitest-agent/mcp`. An exact-pinned regular dependency of the plugin package, which also re-ships this bin through its carrier shim (`packages/plugin/src/bin/vitest-agent.ts` → `@vitest-agent/cli/main`).

## Layout

```text
src/
  bin.ts              -- shebang shim: `import { main } from "./main.js"; main();`
  main.ts             -- OWNS the process (published at `./main`):
                         resolveLogLevel/resolveLogFile(process.env),
                         resolveProjectDir({ env, cwd: process.cwd() }),
                         resolveDataPath -> PlatformLive({ dbPath, env, logLevel,
                         logFile }) -> Command.run(rootCommand, { version }) ->
                         NodeRuntime.runMain; withSubcommands is exactly
                         db / doctor / agent
  index.ts            -- side-effect-free barrel: exports only
                         CURRENT_CLI_VERSION; never imports main.ts
  version.ts          -- CURRENT_CLI_VERSION (the one process.env.__PACKAGE_VERSION__ read)
  commands/           -- thin effect/unstable/cli Command wrappers; the only
                         non-entry files allowed to read `process`
    doctor.ts          -- top-level `doctor` diagnostic
    db.ts              -- `db` parent: path / prune / reset / query
    agent.ts           -- `agent` namespace parent: triage, wrapup,
                          record, register-agent, end-agent, inject-env,
                          sidecar-path, check-test-path
    record.ts triage.ts wrapup.ts
                       -- subcommand bodies composed under `agent`
  lib/                -- pure formatting functions (where tests live)
    format-doctor.ts format-db-query.ts
```

There is no `layers/` and no `lib/internal-*.ts` / `record-*.ts` /
`sidecar-paths.ts`: the runtime layer is the engine's `PlatformLive`, the
sidecar layer is the engine's `SidecarPlatformLive(paths, env)`, and the hook
programs (`registerAgentEffect`, `endAgentEffect`, `record*`,
`resolveHookPaths`) live in `@vitest-agent/engine`'s `programs/`. Commands are
thin wrappers that pass `process.env` / `process.cwd()` into them.

## Key files

| File | Purpose |
| ---- | ------- |
| `main.ts` | The assembled program. `resolveProjectDir` (engine) honors `VITEST_AGENT_PROJECT_DIR` → `VITEST_AGENT_REPORTER_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → cwd so hook-driven invocations from a sub-package cwd resolve the SAME `data.db` the MCP server uses. v4 `Command.run` takes no `name` (it comes from `Command.make`) and reads argv from the Stdio service. `--version` prints `CURRENT_CLI_VERSION` (pinned by `__test__/bin/version.e2e.test.ts`) |
| `commands/db.ts` | `db` parent with four subcommands. `db path` prints the deterministic XDG path (no probing); `db prune --keep-recent N` drops old sessions' turn history (default N=30); `db reset` wipes the DB (human-only, agent-blocked); `db query <sql>` runs read-only SQL |
| `commands/doctor.ts` | 5-point health diagnostic (manifest assembly, latest-run integrity, staleness check). Keeps `--format markdown\|json` |
| `commands/agent.ts` | `agent` namespace parent. Carries a `Command.withDescription` warning header ("Commands intended for agents and hook scripts — humans typically don't invoke these directly.") rendered above the subcommand list. Composes `triageCommand`, `wrapupCommand`, `recordCommand`, the sidecar subcommands `register-agent`, `end-agent`, `inject-env`, `sidecar-path`, and — outside that family, with its own exit-code contract — `check-test-path`. The sidecar subcommands call `resolveHookPaths({ env: process.env, projectKey })` then provide `SidecarPlatformLive(paths, process.env)`; `inject-env` passes a `readFileSync` wrapper into the pure `injectEnv` |
| `lib/format-db-query.ts` | Pure tabular formatter for `db query` output: column headers, whitespace-padded rows, `(0 rows)` on empty; `--format json` emits a JSON array of row objects |
| `lib/format-doctor.ts` | Pure formatter for `doctor`; `format-triage` / `format-wrapup` live in engine's `lib/` and are shared with the MCP package |

## Conventions

- **`effect/unstable/cli` command pattern.** Each command in `commands/` is an
  `effect/unstable/cli` `Command.make(...)`. Commands with non-trivial output
  delegate to a pure function in `lib/`; utility commands emit plain
  stdout text inline. Tests live next to the lib functions, not the
  commands (commands are too thin to test meaningfully).
- **`--format` is scoped, not universal.** Only `agent triage` and
  `agent wrapup` keep `--format markdown|json|silent`. `db query` has
  its own `--format table|json` axis (default `table`). `doctor` keeps
  `--format markdown|json`. Everything else emits plain stdout text by
  convention — no `--format` flag.
- **Read-only by default.** The CLI reads data via `DataReader`; it
  does not write to the DB. Keep this property -- mutations belong in
  the reporter (during a test run) or the MCP server (`note_*`).
- **`NodeRuntime.runMain` for the entry.** Defects print
  `formatFatalError(cause)` to stderr. Don't swap to `Effect.runPromise`
  at the top level; `runMain` handles signals and exit codes correctly
  for a CLI process.
- **Bin name vs package name.** Package `@vitest-agent/cli` publishes
  the bin `vitest-agent` (no `-cli` suffix). The plugin's "Next steps"
  output references this short name. The plugin carrier declares the same
  bin name over `@vitest-agent/cli/main`; under npm / yarn / bun the hoisted
  cli bin wins the `.bin` slot, under pnpm the carrier's shim does — same
  program either way.
- **Boundary (`__test__/boundaries.test.ts`).** `process` may be referenced
  only in `bin.ts`, `main.ts`, `version.ts`, and `commands/**`; nothing under
  `src/` imports `@vitest-agent/mcp`, `plugin`, `reporter`, or `ui`. Keep
  `lib/` pure — thread `env` / `cwd` in from a command.

## Working here

Load the operational detail on demand instead of holding it in context:

- [`context/conventions.md`](context/conventions.md) — deeper
  conventions and the step-by-step recipes: adding a subcommand or
  flag, the `record test-case-turns` mutate-and-read pattern, adding a
  `DataReader` query, and the `db` subcommand contracts (reset / query
  / path).
- [`context/agent-namespace.md`](context/agent-namespace.md) — the
  `agent` namespace reference: sidecar subcommands, `check-test-path`
  exit-code contract, barrel/sidecar data paths, and the agent-facing
  ID flags.

## Design references

- [`../../okf/modules/cli.md`](../../okf/modules/cli.md)
  Load when working on subcommands, the `lib/format-*` functions, or
  the `record` subcommand pattern.
- [`../../okf/interfaces/cli.md`](../../okf/interfaces/cli.md)
  Load when tracing the CLI's stable command/flag/exit-code contract, or
  the plugin record hooks → CLI → DataStore path (including the
  `record test-case-turns` mutate-and-read path).
- [`../../okf/limitations/spawn-sync-e2e-gap.md`](../../okf/limitations/spawn-sync-e2e-gap.md)
  Load when working on the `agent record session-start/turn/session-end`
  path.
- [`../../okf/models/sqlite-schema.md`](../../okf/models/sqlite-schema.md)
  Load when adding a new `DataReader` query or working with output
  formatter types.
