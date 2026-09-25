# @vitest-agent/cli

The `effect/unstable/cli`-based bin (`vitest-agent`) for utility functions, database management, and hook plumbing. For 2.0 the CLI is utility-only — MCP is the data path for test-landscape queries. The top-level tree is exactly three commands: `doctor`, `db`, and `agent`. Reads cached test data from SQLite via `DataReader`; never runs tests or calls AI providers. Rank 4 in the workspace layering: depends on `@vitest-agent/engine`, `@vitest-agent/sdk`, and `@vitest-agent/sidecar`; never on `@vitest-agent/mcp`. An exact-pinned regular dependency of the plugin package, which also re-ships this bin through its carrier shim (`packages/plugin/src/bin/vitest-agent.ts` → `@vitest-agent/cli/main`).

## Layout

```text
src/
  bin.ts              -- shebang shim: `import { main } from "./main.js"; main();`
  main.ts             -- OWNS the process (published at `./main`):
                         main({ distribution? }) ->
                         resolveLogLevel/resolveLogFile(process.env),
                         resolveProjectDir({ env, cwd: process.cwd() }),
                         resolveDataPath -> PlatformLive({ dbPath, env, logLevel,
                         logFile }) as CliRuntime.main's `platform` around
                         Command.run(rootCommand, { version }) ->
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
    version-formatter.ts -- CliColor.formatterLayer with formatVersion
                            overridden (the `via <carrier>` suffix)
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
| `main.ts` | The assembled program. `resolveProjectDir` (engine) honors `VITEST_AGENT_PROJECT_DIR` → `VITEST_AGENT_REPORTER_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → cwd so hook-driven invocations from a sub-package cwd resolve the SAME `data.db` the MCP server uses. v4 `Command.run` takes no `name` (it comes from `Command.make`) and reads argv from the Stdio service. Runs through `@effected/cli`'s `CliRuntime.main` with the platform layer inside failure reporting: exit `0` success, `64` usage/parse error, `1` any other reported failure (a platform build failure is one `vitest-agent: <Tag>: <message>` line on stderr). `--version` prints `vitest-agent <CURRENT_CLI_VERSION>` plus `via @vitest-agent/plugin <version>` when the carrier's shim passed `distribution` (provided as `CurrentDistribution` outermost, so the formatter layer reads it at build time) |
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
- **`CliRuntime.main` under `NodeRuntime.runMain` for the entry.** Failure
  rendering and exit codes are the kit's; `renderFailure` keys off the
  kit's `details.isDefect`: a typed failure is one line, a defect goes
  through `formatFatalError`. `helpOnUsageError: "stderr"` puts help plus
  the parse errors on stderr on a usage error (stdout empty, exit 64 —
  hooks pipe `agent *` stdout into jq); an explicit `--help` stays on
  stdout. Keep the
  platform layer inside `CliRuntime.main`'s `platform` (so its failures
  are reported, not dumped by `runMain`), and don't swap to
  `Effect.runPromise` at the top level.
- **Bin name vs package name.** Package `@vitest-agent/cli` publishes
  the bin `vitest-agent` (no `-cli` suffix). The plugin's "Next steps"
  output references this short name. The plugin carrier declares the same
  bin name over `@vitest-agent/cli/main`; under npm / yarn / bun the hoisted
  cli bin may win the `.bin` slot (same program, minus the `via
  @vitest-agent/plugin` `--version` suffix), under pnpm the carrier's shim
  does.
- **Boundary (`__test__/boundaries.test.ts`, `SourceBoundary.scan`).**
  `process` may be read only in `main.ts` and `commands/**` (the version
  token is exempt and pinned to `version.ts`); nothing under
  `src/` imports `@vitest-agent/mcp`, `plugin`, `reporter`, or `ui`. Keep
  `lib/` pure — thread `env` / `cwd` in from a command.

## When working in this package

- This package depends on `@vitest-agent/sidecar` (not the reverse). `resolveSidecarBinaryPath` is imported from `@vitest-agent/sidecar` to back the `agent sidecar-path` subcommand. The per-platform sidecar children no longer import the CLI — they bundle `dispatch` from `@vitest-agent/sdk/dispatch`. The old `cli → sidecar → sidecar-<platform> → cli` cycle is gone.
- Adding a subcommand: create or extend the `commands/<group>.ts`
  `effect/unstable/cli` glue and wire it into the relevant parent's
  `withSubcommands` (`db`, `agent`, or the root in `main.ts`). Only add
  a `lib/format-<name>.ts` + `.test.ts` pair when the command produces
  non-trivial structured output worth testing as a pure function;
  plain-text utility commands do not need a formatter.
- `record test-case-turns --chat-id <id>` is the canonical
  pattern for subcommands that call multiple `DataStore`/`DataReader`
  methods and return JSON to stdout (not markdown). It calls
  `DataStore.backfillTestCaseTurns(chatId)` then
  `DataReader.getLatestTestCaseForSession(chatId)` and outputs
  `{ "updated": N, "latestTestCaseId": <id|null> }`. Follow this
  pattern for any subcommand that needs to both mutate and read back
  a result.
- Need a new `DataReader` query: add it to `@vitest-agent/engine`'s `DataReader`
  service, then consume it from the command body. Don't reach into
  SQLite directly from the CLI — except `db query`, which opens
  `data.db` read-only by design.
- `db reset` is human-only: it refuses with exit code 4 when
  `VITEST_AGENT_AGENT_ID` is set, exit code 5 when stdout is not a TTY
  and `--yes` was not passed, and otherwise prompts `Wipe <path>?
  [y/N]:` on a TTY. It deletes `data.db` plus its `-shm` / `-wal`
  companions and is idempotent (a missing DB is success).
- `db query <sql>` opens the connection with the SqliteClient
  read-only flag so SQLite enforces no-write; mutation attempts and
  syntax errors surface as driver errors on stderr with exit code 3.
  Empty / whitespace-only SQL exits 2. Do not add parse-time SQL
  validation — engine enforcement is the contract.
- `db path` returns the resolved XDG path even when no DB has been
  written yet -- the path is a function of identity, not artifact
  presence. The pre-2.0 `node_modules/.vite/...` probing is gone.
- Adding a flag: `effect/unstable/cli` validates types at the `Command` layer
  but the lib function should still accept a typed options object.
  Keep the lib function callable without `effect/unstable/cli` for testing.
- Per-call layer construction is fine here (CLI is short-lived). The
  MCP server, by contrast, builds its layers once for the life of the
  process (`McpStdio.launch` over `Layer.launch`).

## Design references

- [`../../okf/modules/cli.md`](../../okf/modules/cli.md)
  Load when working on subcommands, the `lib/format-*` functions, or
  the `record` subcommand pattern.
- [`../../okf/interfaces/cli.md`](../../okf/interfaces/cli.md)
  Load when tracing the CLI's stable command/flag/exit-code contract, or
  the plugin record hooks → CLI → DataStore path (including the
  `record test-case-turns` mutate-and-read path).
- [`../../okf/decisions/72-adopt-the-effected-front-end-kit.md`](../../okf/decisions/72-adopt-the-effected-front-end-kit.md)
  Load for why `main.ts` runs on `@effected/cli`'s `CliRuntime.main` (exit
  codes, failure rendering, the carrier `--version` suffix).
- [`../../okf/limitations/spawn-sync-e2e-gap.md`](../../okf/limitations/spawn-sync-e2e-gap.md)
  Load when working on the `agent record session-start/turn/session-end`
  path.
- [`../../okf/models/sqlite-schema.md`](../../okf/models/sqlite-schema.md)
  Load when adding a new `DataReader` query or working with output
  formatter types.

## The `agent` namespace

`commands/agent.ts` is a discoverable parent — its `--help` opens with the warning header "Commands intended for agents and hook scripts — humans typically don't invoke these directly." It composes the hook-driven utilities `triage`, `wrapup`, and `record`, four sidecar subcommands, and the standalone `check-test-path` classifier:

- `agent register-agent` — composes projectKey resolution, RunContext git capture, PerClientSessionMapWriter, and DataStore.registerAgent end-to-end. Emits JSON to stdout with `agentId`, `conversationId`, `mainAgentId`, `idempotencyKey`, `idempotencyHit`. Also backfills `sessions.conversation_id` for the session row `record session-start` inserted earlier (the one NULL → value transition the immutability trigger allows). Hook scripts parse via `jq -r '.agentId'`.
- `agent end-agent` — sets `agents.ended_at` and optionally `session_map.ended_at` when `--host-session-id` is passed. SubagentStop omits the latter.
- `agent inject-env` — pure pattern matcher. Reads `VITEST_AGENT_*` from env and `package.json#scripts` from cwd; rewrites the command with the env prefix on Vitest match, returns the original on no-match.
- `agent sidecar-path` — calls `resolveSidecarBinaryPath()` from `@vitest-agent/sidecar` and prints the absolute path of the installed platform binary to stdout (exit 0), or exits non-zero when no platform binary is resolvable. The SessionStart hook captures this path and exports it as `VITEST_AGENT_SIDECAR_BIN`.
- `agent check-test-path <path>` — NOT a sidecar subcommand: it shares neither their exit-code taxonomy (where `1` means registration conflict) nor their stderr shape. Classifies a path via `classifyTestPath` from `@vitest-agent/sdk`. `<path>` is resolved to an absolute path relative to `VITEST_AGENT_PROJECT_DIR`/cwd when not already absolute, and it is only ever the file being classified — the workspace root is always resolved via `findWorkspaceRootSync` from `VITEST_AGENT_PROJECT_DIR`/cwd itself, never from `<path>`. Exits `1` with empty stdout whenever no verdict is rendered — no containing workspace, a workspace vitest/vite config that is unreadable or carries a non-default `DiscoverStrategy` marker (`detectNonDefaultDiscoverStrategy` from the SDK; the default-layout rule cannot speak for a custom strategy, issue #230), a `NON_DISCOVERABLE_DIRS` segment in the relative path, or a nested `package.json` between the owning package root and the file (a filesystem probe local to this command, since `classifyTestPath` is pure) — so hook callers fail open; on success prints `{ verdict, workspace, suggestedPath }` JSON to stdout. Powers the PreToolUse hook `plugins/claude-code/hooks/pre-tool-use/test-location.sh`.

The sidecar subcommand bodies (`registerAgentEffect`, `endAgentEffect`) live in `@vitest-agent/engine`'s `programs/register-agent.ts` / `programs/end-agent.ts`; the record bodies in `programs/record-*.ts`. `record turn` / `record tdd-artifact` pass `process.cwd()` when `--cwd` is absent — the engine programs take `cwd` as a required ambient input and never read `process` themselves.

**Barrel exports.** `src/index.ts` exports only `CURRENT_CLI_VERSION`. It deliberately does NOT re-export `dispatch`, `injectEnv`, or `exitCodeForTag` — those ship from the `@vitest-agent/sdk/dispatch` entry point — nor the sidecar layer / hook programs, which ship from `@vitest-agent/engine`. `commands/agent.ts` imports `exitCodeForTag` / `injectEnv` from `@vitest-agent/sdk/dispatch`, and the per-platform `@vitest-agent/sidecar-<platform>` SEAs import `dispatch` from there too. The dependency direction is one-way: `@vitest-agent/cli` depends on `@vitest-agent/sidecar` (to call `resolveSidecarBinaryPath` for the `agent sidecar-path` subcommand), not the reverse.

**Sidecar data paths** come from the engine's `resolveHookPaths` — `@effected/xdg` over the injected env (`XDG_DATA_HOME`, falling back to `~/.local/share`) plus the normalized `projectKey` (no workspace discovery), so it works in non-pnpm-workspace project shapes. `SidecarPlatformLive` opens three SQLite scopes — per-project `data.db`, per-client `sessions.db`, registry `registry.db` — each with its own `SqlClient`.

**CLI flags for agent-facing IDs.** `record` subcommands take `--chat-id` (host chat UUID) and `--parent-chat-id`. `record tdd-artifact` alternatively accepts `--tdd-task-id <int>`, which bypasses session resolution entirely and writes the artifact under that task's current phase (the `tdd-artifact.sh` hook forwards `VITEST_AGENT_TDD_TASK_ID` this way); one of `--chat-id` / `--tdd-task-id` is required. The `wrapup` command takes `--chat-id` (host chat UUID) or `--row-id` (internal integer FK, mostly for debugging).
