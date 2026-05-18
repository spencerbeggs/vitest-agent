---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-18
last-synced: 2026-05-18
completeness: 92
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ./sdk.md
  - ./mcp.md
  - ./plugin-claude.md
  - ./sidecar.md
  - ./ui.md
dependencies: []
---

# CLI package (`vitest-agent-cli`)

A utility-only bin for LLM agents and humans: database management plus the hook-driven recording subcommands that populate the SQLite database with session/turn, TDD evidence, and workspace-history rows. Does not run tests or call AI providers.

**npm name:** `vitest-agent-cli`
**Bin:** `vitest-agent`
**Location:** `packages/cli/`
**Internal dependencies:** `vitest-agent-sdk`, `vitest-agent-sidecar`

The plugin declares the CLI as a required `peerDependency`, so installing the plugin pulls the CLI along with it (npm 7+ and pnpm auto-install required peers, landing the `vitest-agent` bin at the consumer's top level where the Claude Code plugin's hook scripts resolve it). The CLI stays a separate package for module-boundary reasons — the `@effect/cli` surface is the CLI's own concern.

CLI commands are directory-bound. Vitest is itself directory-bound, and the CLI operates in the context of the working directory — workspace identity is resolved from the nearest root `package.json`, the database path is derived from that identity (XDG-rooted), and every command that reaches into `$XDG_DATA_HOME/vitest-agent/` starts by resolving which workspace's data directory to use.

## Current role (2.0: utility-only)

The T8 CLI restructure narrowed the bin to a utility-only surface for 2.0. The pre-2.0 CLI carried ten read commands (`status`, `overview`, `coverage`, `history`, `trends`, `show`, plus auxiliaries) on the assumption that humans and agents both consume the CLI as a primary data path. The 2.0 decision: **MCP is the data path for test-landscape queries; the CLI is utility-only.** The six reporting commands and their `lib/format-*` formatters were deleted outright — no deprecated stubs. Test-landscape data now flows through the MCP tools `test_status`, `inventory`, `test_overview`, `test_history`, `test_trends`, `test_coverage`, and `file_coverage`. Interactive human-facing reporting is slated to return in 2.x as a proper Ink TUI once dogfood feedback shows what humans want at the CLI level.

What remains is a small human-facing utility surface (`doctor`, `db`) plus a discoverable namespace for hook-driven plumbing (`agent`).

---

## Bin and command surface

`packages/cli/src/bin.ts`. The bin resolves `dbPath` via `resolveDataPath(process.cwd())` under `PathResolutionLive(projectDir) + NodeContext.layer`, then provides `CliLive(dbPath, logLevel, logFile)` to the `@effect/cli` `Command.run` effect. Defects print `formatFatalError(cause)` to stderr.

Immediately before `Command.run`, the bin compares `CURRENT_CLI_VERSION` against `CURRENT_SDK_VERSION` and writes one stderr line on mismatch (`[vitest-agent-cli] version drift: … Reinstall vitest-agent-* packages so versions match.`). The check is observation-only — invocation continues, and the `"0.0.0"` dev-build sentinel skips it. `packages/cli/src/index.ts` exports `CURRENT_CLI_VERSION` (inlined from `process.env.__PACKAGE_VERSION__` via the package's `rslib.config.ts` `define`). The `doctor` subcommand is unrelated to this check — it covers database health, not cross-package version invariants. Integration coverage: `packages/cli/__test__/bin-version-drift.test.ts` mocks `CURRENT_SDK_VERSION` to assert the warning shape; see D36 in [../decisions.md](../decisions.md).

The top-level command tree is exactly three children, wired in `bin.ts`'s `withSubcommands`:

| Command | Audience | Purpose |
| --- | --- | --- |
| `doctor` | human | 5-point health diagnostic. Keeps `--format markdown\|json`. |
| `db` | human | Database management — `path`, `prune`, `reset`, `query`. |
| `agent` | agents / hooks | Namespace for hook-driven plumbing — see below. |

## The `db` command group

`packages/cli/src/commands/db.ts`. The `db` parent (renamed from the pre-2.0 `cache` group) carries four subcommands:

| Subcommand | Purpose |
| --- | --- |
| `path` | Prints the resolved XDG `data.db` path. The path is a function of identity, not artifact presence — it prints even when no DB has been written yet. |
| `prune --keep-recent N` | Turn-history retention; default `N=30`. Calls `DataStore.pruneSessions(n)`: finds the cutoff at the `(n+1)`-th most recent session by `started_at` and deletes turn rows for older sessions. FK CASCADE handles `tool_invocations` and `file_edits`. **The `sessions` rows themselves are retained** — only the turn log is pruned. Idempotent. |
| `reset` | Wipes `data.db` plus its `-shm` / `-wal` companions; human-only, agent-blocked (see below). |
| `query <sql>` | Single read-only SQL statement (see below). |

The pre-2.0 `cache clean` subcommand was dropped — its destructive role is now `db reset` with the agent guard, while `db prune` covers the non-destructive retention case.

### `db reset` agent-blocking gate

`db reset` enforces a refusal gate, evaluated in order:

1. `VITEST_AGENT_AGENT_ID` set in the environment → refuse, exit code 4 ("agent context").
2. Non-TTY stdout without `--yes` → refuse, exit code 5 ("non-interactive without consent").
3. TTY without `--yes` → interactive `Wipe <path>? [y/N]:` prompt; empty / `n` / `N` aborts with exit 0 and `aborted` on stdout.
4. `--yes` skips the prompt unconditionally (still subject to gate 1).

On success it removes `data.db` and the `-shm` / `-wal` sidecars via `FileSystem.FileSystem`, each wrapped in `Effect.catchAll(() => Effect.void)` so a missing file is success-equivalent — the operation is idempotent. The deletion path provides `NodeContext.layer` locally.

### `db query` semantics

`db query <sql>` runs a single read-only SQL statement against `data.db`. The connection is opened through `@effect/sql-sqlite-node`'s `SqliteClient` with the `readonly` flag — SQLite enforces the no-write invariant at the engine level, so mutations surface as the driver's readonly error rather than parse-time SQL validation. There is no grammar re-implementation in the CLI.

Exit codes: `2` for empty / whitespace-only SQL, `3` for any driver error (syntax errors and readonly violations alike are grouped here). On error, `describeError` flattens the `Error.cause` chain so the driver's `attempt to write a readonly database` text surfaces regardless of which layer wrapped it.

Output is formatted by `lib/format-db-query.ts` — a pure helper, the one new `lib/format-*` file the restructure added. `--format table` (default) renders column headers plus whitespace-padded rows, with `(0 rows)` for an empty result set; `--format json` emits a JSON array of row objects keyed by column name (`[]` when empty). Schema introspection works out of the box via `SELECT name FROM sqlite_master WHERE type='table'`.

## The `agent` namespace

`packages/cli/src/commands/agent.ts`. The `agent` parent replaces the pre-2.0 hidden `_internal` group — `commands/internal.ts` was deleted and folded in here. Unlike the old hidden group, `agent` is a discoverable namespace: its `Command.withDescription` carries a warning header — *"Commands intended for agents and hook scripts — humans typically don't invoke these directly."* — that `@effect/cli`'s help formatter renders above the subcommand list.

The group composes seven subcommands:

| Subcommand | Driven by | Purpose |
| --- | --- | --- |
| `triage` | SessionStart hook | Emits the W3 orientation brief; the hook pipes it into Claude Code's `additionalContext`. |
| `wrapup` | Stop / SessionEnd / PreCompact / UserPromptSubmit hooks | Emits the W5 wrap-up prompt; `--kind` selects the lifecycle variant. |
| `record` | plugin hooks | Session/turn capture, TDD evidence binding, workspace-history — see below. |
| `register-agent` | SessionStart / SubagentStart hooks | Maps host session id and transcript path to canonical conversation/agent ids, captures git context, writes session-map rows. Emits JSON for the hook to parse with `jq`. |
| `end-agent` | SessionEnd / SubagentStop hooks | Sets `agents.ended_at`; with `--host-session-id` also sets `session_map.ended_at`. |
| `inject-env` | PreToolUse Bash hook | Pure command-rewriter — prepends the `VITEST_AGENT_*` env prefix when the command invokes Vitest, echoes it unchanged otherwise. |
| `sidecar-path` | SessionStart hook (once per session) | Calls `resolveSidecarBinaryPath()` from `vitest-agent-sidecar` and prints the absolute path to stdout (exit 0), or exits non-zero when the binary is not resolvable. The SessionStart hook captures this path and exports it as `VITEST_AGENT_SIDECAR_BIN`. |

`triage` and `wrapup` keep their `--format markdown|json|silent` axis (the only commands that do — `db query` has its own `--format table|json` axis, everything else emits plain stdout text by convention). `record` and the three sidecar subcommands (`register-agent`, `end-agent`, `inject-env`) relocated under `agent` without body changes. `agent inject-env` now imports `exitCodeForTag` and `injectEnv` from `vitest-agent-sdk/dispatch` — the `injectEnv` core moved to the SDK so the SEA binary can import it without reaching through the CLI. The `lib/format-triage.ts` and `lib/format-wrapup.ts` formatters are shared verbatim with the MCP tools `triage_brief` and `wrapup_prompt`, so CLI and MCP outputs are byte-identical.

**Dependency relationship with the sidecar package.** Workstream T9.2 added `vitest-agent-sidecar`, a native binary that runs `inject-env` on the per-Bash hot path (see [./sidecar.md](./sidecar.md)). `vitest-agent-cli` depends on `vitest-agent-sidecar` (not the reverse): the sidecar package exports `resolveSidecarBinaryPath`, and the CLI's `agent sidecar-path` subcommand calls it to resolve the binary's absolute path. The dispatch core the SEA binary actually runs — `dispatch` / `DispatchResult`, `injectEnv` / `InjectEnvInput`, `exitCodeForTag` — lives in `vitest-agent-sdk` and is reached through the dedicated `vitest-agent-sdk/dispatch` entry point (see [./sdk.md](./sdk.md)); the per-platform children declare `vitest-agent-sdk` as their only workspace `devDependency` and import `dispatch` from `vitest-agent-sdk/dispatch`. They no longer depend on `vitest-agent-cli` at all — the closing edge of the workspace graph is now `sidecar-<platform> → sdk`, a true leaf. `packages/cli/src/index.ts` re-exports `CliLive`, `SidecarLive`, `registerAgentEffect` and the `lib/sidecar-paths.ts` path helpers (`resolveProjectDataDir`, `resolveRegistryDir`, `resolveSessionMapPath`, the `*_DB_FILENAME` constants); it deliberately does **not** re-export `dispatch` / `injectEnv` / `exitCodeForTag` — those are sidecar machinery that now belongs to the SDK and nothing outside the project imported them from the CLI. `register-agent` stays JS-only — its native SQLite binding cannot be bundled into a SEA.

The sidecar subcommands return plain text on stdout for the bash hooks to parse, and structured error info on stderr in the shape `<exit_code> <error_tag>: <message>`. Exit codes follow a fixed contract: `0` success, `1` registration conflict, `2` sidecar timeout, `3` database error, `4` `ProjectIdentityNotResolvableError`, `5` unexpected defect. They resolve all three SQLite store paths from env at invocation time (per-project `data.db`, per-client `sessions.db`, registry `registry.db`) and `mkdirSync` every parent dir before SQLite opens. Path resolution does not depend on workspace-discovery, so the sidecar works in non-pnpm-workspace project shapes.

> **Help-rendering quirk.** `@effect/cli`'s root `--help` renders the four-level-nested `agent record <sub>` entries with a doubled `agent agent record <sub>` prefix. This is an upstream help-formatter artifact only — the actual invocation path `vitest-agent agent record <sub>` works correctly.

## The `record` subcommand

The `record` subcommand (now `vitest-agent agent record <action>`) is the load-bearing surface for the plugin's session/turn capture, TDD evidence binding, and workspace-history pipeline. Hooks fire dozens of times per session and shell out to it rather than performing SQL writes themselves.

Why this layering exists:

- **Speed.** POSIX shell hooks plus a single `vitest-agent` invocation are faster than re-running an Effect runtime per fire from scratch — the CLI's startup cost is paid once per fire, in one short-lived process.
- **Validation.** `record turn` validates JSON-stringified payloads against the `TurnPayload` Effect Schema discriminated union before writing. Hooks pre-stringify the payload; the CLI is the schema gate.
- **Single write path.** Per [D7](../decisions.md), `record tdd-artifact` is the **only** path by which TDD evidence artifacts are written. The agent never writes its own evidence. The CLI surface makes that invariant enforceable from the hook layer.

| Action | Drives |
| ------ | ------ |
| `turn` | Inserts a `turns` row (with optional fanout to `file_edits` or `tool_invocations` based on payload type) |
| `session-start` | Inserts a `sessions` row |
| `session-end` | Updates `sessions.ended_at`/`end_reason` |
| `tdd-artifact` | Resolves the active TDD phase and writes a `tdd_artifacts` row |
| `run-workspace-changes` | Idempotent `commits` insert + per-file `run_changed_files` rows |
| `test-case-turns` | Backfills `test_cases.created_turn_id` for the current session and reports the latest linked test-case id |

The `test-case-turns` action is the linkage that makes `tdd-artifact` correctly cite the test case that was just authored: hooks call it before each `record tdd-artifact`, capture the returned `latestTestCaseId`, and pass it as `--test-case-id`. This closes the gap that would otherwise leave `tdd_artifacts.test_case_id` unset for hook-driven artifact rows.

## CliLive composition layer

`packages/cli/src/layers/CliLive.ts`. Composes `DataReaderLive`, `DataStoreLive`, `ProjectDiscoveryLive`, `HistoryTrackerLive`, `OutputPipelineLive`, `SqliteClient`, `Migrator`, `NodeContext`, `NodeFileSystem`, and `LoggerLive`. The bin uses `NodeRuntime.runMain` to execute against this composite. The layer was unchanged by the T8 restructure — `DataReader` etc. continue to back `doctor`, `triage`, `wrapup`, and the `record` group.

## `SidecarLive` composition layer

`packages/cli/src/layers/SidecarLive.ts`. Composes three SQLite scopes for the sidecar subcommands: per-project `data.db` (`DataStoreLive`, `DataReaderLive`), per-client `sessions.db` (`PerClientSessionMapLive`), and the global registry `registry.db` (`DiscoveryRegistryLive`). Each store gets its own `SqlClient` connection via three uniquely-tagged Sqlite client tags so the three DBs do not contend on a single connection. The layer was unchanged by the T8 restructure — it now backs the sidecar subcommands in their new home under `agent`.

## Hook-driven recording: `resolveSessionForRecording`

`packages/cli/src/lib/resolve-session-for-recording.ts`. Shared session-resolution helper for hook-driven recording paths. Background: Claude Code can rotate `chat_id` mid-window (compaction, resume, network blip), and the same subagent invocation can produce `tdd_artifact` records spread across two cc-session prefixes. The helper walks parents — given any `chat_id`, it follows the `sessions.parent_session_id` chain until it finds the main row for the agent, so artifact and turn writes always land under the correct canonical `sessions.id`. Used by `record turn`, `record tdd-artifact`, and the `test-case-turns` backfill.

## CLI flag rename (Phase 4)

The `record` subcommand family renamed `--cc-session-id` to `--chat-id` and `--parent-cc-session-id` to `--parent-chat-id` to align with the agent-taxonomy nomenclature. The `wrapup` command's prior integer FK form moved to `--row-id` to free `--chat-id` for the host UUID.

## Cross-workstream dependency: T9.1 hook cascade

T8 lands the CLI restructure but breaks the plugin hook scripts. Roughly 14 scripts under `plugin/hooks/**/*.sh` still call the old command names — `vitest-agent _internal …`, `vitest-agent record …`, `vitest-agent triage`, `vitest-agent wrapup`, `vitest-agent cache …` — and will fail until **T9.1** rewrites them to the new `vitest-agent agent …` and `vitest-agent db …` paths. T9.1 is a separate Wave 3 workstream and cannot land until T8 ships. See [./plugin-claude.md](./plugin-claude.md) for the hook layer.
