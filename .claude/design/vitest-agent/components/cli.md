---
status: current
module: vitest-agent
category: architecture
created: 2026-05-06
updated: 2026-09-13
last-synced: 2026-09-13
completeness: 92
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ./sdk.md
  - ./engine.md
  - ./mcp.md
  - ./plugin-claude.md
  - ./sidecar.md
  - ./ui.md
dependencies: []
---

# CLI package (`@vitest-agent/cli`)

A utility-only bin for LLM agents and humans: database management plus the hook-driven recording subcommands that populate the SQLite database with session/turn, TDD evidence, and workspace-history rows. Does not run tests or call AI providers.

**npm name:** `@vitest-agent/cli`
**Bin:** `vitest-agent`
**Location:** `packages/cli/`
**Rank:** 4 (Decision 70 in [../decisions.md](../decisions.md))
**Internal dependencies:** `@vitest-agent/engine`, `@vitest-agent/sdk`, `@vitest-agent/sidecar`
**Entry points:** `.` (side-effect-free barrel), `./main` (the assembled program that owns the process)

The plugin declares the CLI as an exact-pinned regular `dependency` and ships the `vitest-agent` bin itself as a 4-line shim over `@vitest-agent/cli/main` (the carrier — see [./plugin.md](./plugin.md)), so installing the plugin pulls the CLI along and lands the bin in the consumer's `node_modules/.bin` under every package manager; the Claude Code plugin's hook scripts resolve it `.bin`-first. The CLI stays a separate package for module-boundary reasons — the `effect/unstable/cli` surface is the CLI's own concern — and its boundary test forbids importing `@vitest-agent/mcp` (the two front ends never import each other). The CLI is a thin command layer: every hook program it wraps lives in the engine's `programs/` directory.

CLI commands are directory-bound. Vitest is itself directory-bound, and the CLI operates in the context of the working directory — workspace identity is resolved from the nearest root `package.json`, the database path is derived from that identity (XDG-rooted), and every command that reaches into `$XDG_DATA_HOME/vitest-agent/` starts by resolving which workspace's data directory to use.

## Current role (utility-only)

The bin is a utility-only surface: **MCP is the data path for test-landscape queries; the CLI is utility-only.** There are no read/reporting commands — test-landscape data flows through the MCP tools (`test_status`, `inventory`, `test_overview`, `test_history`, `test_trends`, `test_coverage`, `file_coverage`). What remains is a small human-facing utility surface (`doctor`, `db`) plus a discoverable namespace for hook-driven plumbing (`agent`).

---

## Entry contract: `bin.ts` / `main.ts` / `index.ts`

The front-end entry contract from Decision 70:

- **`packages/cli/src/bin.ts`** is the published bin shim and nothing else: `#!/usr/bin/env node`, `import { main } from "./main.js"; main();`.
- **`packages/cli/src/main.ts`** owns the process and is published as the `./main` subpath (what the carrier's `packages/plugin/src/bin/vitest-agent.ts` imports). `main()` reads `process.env` once, resolves `logLevel` / `logFile` through the engine's `resolveLogLevel(env)` / `resolveLogFile(env)`, resolves `projectDir = resolveProjectDir({ env, cwd: process.cwd() })` (the engine's four-name precedence — `VITEST_AGENT_PROJECT_DIR` → `VITEST_AGENT_REPORTER_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → cwd — so a hook-driven invocation from a sub-package cwd resolves the SAME `data.db` the MCP server uses), then runs `resolveDataPath(projectDir)` under `PathResolutionLive(projectDir) + NodeServices.layer` and provides `PlatformLive({ dbPath, env, logLevel, logFile })` to the `effect/unstable/cli` `Command.run` effect (built from `Command.make("vitest-agent")` + `Command.withSubcommands([dbCommand, doctorCommand, agentCommand])`; on v4 `Command.run` takes an options object, sourcing argv from the `Stdio` service). A cause carrying a defect prints `vitest-agent: ${formatFatalError(cause)}` to stderr before re-failing; `NodeRuntime.runMain` owns exit codes.
- **`packages/cli/src/index.ts`** is a side-effect-free barrel that never imports `main.ts`, so a library consumer's import graph never pulls in the process-owning module. It exports only `CURRENT_CLI_VERSION` (from `src/version.ts`, inlined from `process.env.__PACKAGE_VERSION__` at build time). The former re-exports — `CliLive`, `SidecarLive`, `registerAgentEffect`, `resolveProjectDataDir`, `resolveRegistryDir`, `resolveSessionMapPath`, the `*_DB_FILENAME` constants — moved to `@vitest-agent/engine` with the #412 split; import them from there.

**Process boundary.** `packages/cli/__test__/boundaries.test.ts` allows `process` references only in `bin.ts`, `main.ts`, `version.ts` and `commands/**` — the thin `effect/unstable/cli` wrappers that read `process.env` / `process.cwd()` to thread ambient input into the engine's pure programs — asserts the `process.env.__PACKAGE_VERSION__` token appears only in `version.ts`, and forbids importing `@vitest-agent/mcp`, `@vitest-agent/plugin`, `@vitest-agent/reporter` or `@vitest-agent/ui` anywhere under `src/`. `lib/` (`format-db-query.ts` and friends) is process-free.

Under the earlier lockstep design the bin compared `CURRENT_CLI_VERSION` against `CURRENT_SDK_VERSION` before `Command.run` and warned on mismatch; that drift check was removed with independent per-package versioning. The `doctor` subcommand covers database health, not cross-package version invariants. See D36 in [../decisions.md](../decisions.md).

The top-level command tree is exactly three children, wired in `main.ts`'s `withSubcommands`:

| Command | Audience | Purpose |
| --- | --- | --- |
| `doctor` | human | 5-point health diagnostic. Keeps `--format markdown\|json`. |
| `db` | human | Database management — `path`, `prune`, `reset`, `query`. |
| `agent` | agents / hooks | Namespace for hook-driven plumbing — see below. |

## The `db` command group

`packages/cli/src/commands/db.ts`. The `db` parent carries four subcommands:

| Subcommand | Purpose |
| --- | --- |
| `path` | Prints the resolved XDG `data.db` path. The path is a function of identity, not artifact presence — it prints even when no DB has been written yet. |
| `prune --keep-recent N` | Turn-history retention; default `N=30`. Calls `DataStore.pruneSessions(n)`: finds the cutoff at the `(n+1)`-th most recent session by `started_at` and deletes turn rows for older sessions. FK CASCADE handles `tool_invocations` and `file_edits`. **The `sessions` rows themselves are retained** — only the turn log is pruned. Idempotent. |
| `reset` | Wipes `data.db` plus its `-shm` / `-wal` companions; human-only, agent-blocked (see below). |
| `query <sql>` | Single read-only SQL statement (see below). |

### `db reset` agent-blocking gate

`db reset` enforces a refusal gate, evaluated in order:

1. `VITEST_AGENT_AGENT_ID` set in the environment → refuse, exit code 4 ("agent context").
2. Non-TTY stdout without `--yes` → refuse, exit code 5 ("non-interactive without consent").
3. TTY without `--yes` → interactive `Wipe <path>? [y/N]:` prompt; empty / `n` / `N` aborts with exit 0 and `aborted` on stdout.
4. `--yes` skips the prompt unconditionally (still subject to gate 1).

On success it removes `data.db` and the `-shm` / `-wal` sidecars via `FileSystem.FileSystem`, each wrapped in `Effect.catch(() => Effect.void)` (the v4 rename of `Effect.catchAll`) so a missing file is success-equivalent — the operation is idempotent. The deletion path provides `NodeServices.layer` locally.

### `db query` semantics

`db query <sql>` runs a single read-only SQL statement against `data.db`. The connection is opened through `@effect/sql-sqlite-node`'s `SqliteClient` with the `readonly` flag — SQLite enforces the no-write invariant at the engine level, so mutations surface as the driver's readonly error rather than parse-time SQL validation. There is no grammar re-implementation in the CLI.

Exit codes: `2` for empty / whitespace-only SQL, `3` for any driver error (syntax errors and readonly violations alike are grouped here). On error, `describeError` flattens the `Error.cause` chain so the driver's `attempt to write a readonly database` text surfaces regardless of which layer wrapped it.

Output is formatted by `lib/format-db-query.ts`. `--format table` (default) renders column headers plus whitespace-padded rows, with `(0 rows)` for an empty result set; `--format json` emits a JSON array of row objects keyed by column name (`[]` when empty). Schema introspection works out of the box via `SELECT name FROM sqlite_master WHERE type='table'`.

## The `agent` namespace

`packages/cli/src/commands/agent.ts`. The `agent` parent is a discoverable namespace: its `Command.withDescription` carries a warning header — *"Commands intended for agents and hook scripts — humans typically don't invoke these directly."* — that `effect/unstable/cli`'s help formatter renders above the subcommand list.

The group composes eight subcommands:

| Subcommand | Driven by | Purpose |
| --- | --- | --- |
| `triage` | SessionStart hook | Emits the W3 orientation brief; the hook pipes it into Claude Code's `additionalContext`. |
| `wrapup` | Stop / SessionEnd / PreCompact / UserPromptSubmit hooks | Emits the W5 wrap-up prompt; `--kind` selects the lifecycle variant. |
| `record` | plugin hooks | Session/turn capture, TDD evidence binding, workspace-history — see below. |
| `register-agent` | SessionStart / SubagentStart hooks | Wraps the engine's `registerAgentEffect`: maps host session id and transcript path to canonical conversation/agent ids, captures git context, writes session-map rows, and is the sole point that populates `sessions.conversation_id` (see below). Emits JSON for the hook to parse with `jq`. |
| `end-agent` | SessionEnd / SubagentStop hooks | Wraps `endAgentEffect`: sets `agents.ended_at`; with `--host-session-id` also sets `session_map.ended_at`. |
| `inject-env` | PreToolUse Bash hook | Pure command-rewriter — prepends the `VITEST_AGENT_*` env prefix when the command invokes Vitest, echoes it unchanged otherwise. Calls the core's pure `injectEnv` with `process.cwd()`, `process.env` and a `readFileSync` wrapper — the JS fallback the sidecar binary shadows. |
| `sidecar-path` | SessionStart hook (once per session) | Calls `resolveSidecarBinaryPath()` from `@vitest-agent/sidecar` and prints the absolute path to stdout (exit 0), or exits non-zero when the binary is not resolvable. The SessionStart hook captures this path and exports it as `VITEST_AGENT_SIDECAR_BIN`. |
| `check-test-path` | PreToolUse test-location hook | Classifies a test-file path against the default discovery layout via `classifyTestPath` and prints a JSON verdict (`valid` / `invalid` / `excluded` plus `suggestedPath`). Exits 1 with **no stdout** — no verdict — whenever it cannot stand behind one; the hook turns that into a silent noop. |

`triage` and `wrapup` keep their `--format markdown|json|silent` axis (the only commands that do — `db query` has its own `--format table|json` axis, everything else emits plain stdout text by convention). `agent inject-env` imports `exitCodeForTag` and `injectEnv` from `@vitest-agent/sdk/dispatch` — the `injectEnv` core lives in the SDK so the SEA binary can import it without reaching through the CLI. `triage` and `wrapup` call `formatTriageEffect` / `formatWrapupEffect` from `@vitest-agent/engine` (`packages/engine/src/lib/format-triage.ts`, `format-wrapup.ts`), shared verbatim with the MCP tools `triage_brief` and `wrapup_prompt`, so CLI and MCP outputs are byte-identical.

**Dependency relationship with the sidecar package.** `@vitest-agent/cli` depends on `@vitest-agent/sidecar` (not the reverse): the sidecar package exports `resolveSidecarBinaryPath`, and the CLI's `agent sidecar-path` subcommand calls it to resolve the binary's absolute path. The dispatch core the SEA binary actually runs — the pure `dispatch(argv, io)` / `DispatchIo` / `DispatchResult`, `injectEnv` / `InjectEnvInput`, `exitCodeForTag` — lives in `@vitest-agent/sdk` and is reached through the dedicated `@vitest-agent/sdk/dispatch` entry point (see [./sdk.md](./sdk.md)); the per-platform children declare `@vitest-agent/sdk` as their only workspace `devDependency` and import `dispatch` from there. They do not depend on `@vitest-agent/cli` — the closing edge of the workspace graph is `sidecar-<platform> → sdk`, a true leaf. `packages/cli/src/index.ts` exports only `CURRENT_CLI_VERSION`; the sidecar platform layer and the hook-path helpers are engine exports, and `dispatch` / `injectEnv` / `exitCodeForTag` belong to the core. `register-agent` stays JS-only — its native SQLite binding cannot be bundled into a SEA.

**`check-test-path` fails open on non-default discovery (issue #230).** `classifyTestPath` encodes the *default* `DiscoverStrategy`'s layout rule and nothing else, so a workspace with a custom `discoverStrategy` (including `discoverStrategy: false`), an `AgentPlugin.discover().addProject(...)` chain, or a class extending `DefaultDiscoverStrategy` / implementing `DiscoverStrategy` can legitimately collect a path the default rule calls `invalid` — and the hook would deny a `Write` there with confident, wrong advice. Before classifying, the command therefore finds the workspace's first Vitest/Vite config (`vitest.config.{ts,mts,js,mjs}`, then `vitest.workspace.*`, then `vite.config.*` — the order Vitest itself prefers), reads its source text, and runs the SDK's pure `detectNonDefaultDiscoverStrategy(source)` over it. A detected marker, a missing config, and an unreadable config all take the same exit-1-no-stdout path: none of the three lets the command rule out a non-default strategy, and no verdict is safer than a wrong one. The scan is lexical (a comment-stripped regex pass), never a config load — the command sits on the hook hot path, and booting the consumer's `vitest.config.ts` through Vite on every test-shaped `Read`/`Write`/`Edit` is out of scope by design. See [../decisions.md](../decisions.md) Decision 61 and the plugin-side opt-out in [./plugin-claude.md](./plugin-claude.md).

**`register-agent` populates `sessions.conversation_id` (issue #144).** The Claude Code SessionStart payload carries no conversation id, so `record session-start` (which runs first) inserts the `sessions` row with a null `conversation_id`; the canonical id is minted later in `registerAgentEffect` step 1 (`mapConversation(transcript_path)`). Step 3 now passes `conversationId` on a fresh `writeSession` insert and, for a pre-existing row, calls `DataStore.setSessionConversationIdIfNull` unconditionally — the `WHERE conversation_id IS NULL` guard makes it idempotent, and the relaxed `trg_sessions_conv_id_immutable` trigger permits exactly that one null → value transition (see [../schemas.md](../schemas.md)). Before this the column was never populated in production, which silently disabled every consumer of it — most visibly the conversation-tree fallback below.

The sidecar subcommands return plain text on stdout for the bash hooks to parse, and structured error info on stderr in the shape `<exit_code> <error_tag>: <message>`. Exit codes follow a fixed contract: `0` success, `1` registration conflict, `2` sidecar timeout, `3` database error, `4` `ProjectIdentityNotResolvableError`, `5` unexpected defect (the engine's `XdgEnvError` / `AppDirsError` / `PlatformError` tags map here too, via the core's `exitCodeForTag`). Both subcommands call the engine's `resolveHookPaths({ env: process.env, projectKey })` — which resolves all three SQLite store paths (per-project `data.db`, per-client `sessions.db`, registry `registry.db`) from the injected env and creates every parent dir — and provide `SidecarPlatformLive(paths, process.env)`. Path resolution does not depend on workspace-discovery, so the sidecar works in non-pnpm-workspace project shapes. See [./engine.md](./engine.md) *Programs*.

> **Help-rendering quirk.** `effect/unstable/cli`'s root `--help` renders the four-level-nested `agent record <sub>` entries with a doubled `agent agent record <sub>` prefix. This is an upstream help-formatter artifact only — the actual invocation path `vitest-agent agent record <sub>` works correctly.

## The `record` subcommand

`vitest-agent agent record <action>` is the load-bearing surface for the plugin's session/turn capture, TDD evidence binding, and workspace-history pipeline. Hooks fire dozens of times per session and shell out to it rather than performing SQL writes themselves.

Why this layering exists:

- **Speed.** POSIX shell hooks plus a single `vitest-agent` invocation are faster than re-running an Effect runtime per fire from scratch — the CLI's startup cost is paid once per fire, in one short-lived process.
- **Validation.** `record turn` validates JSON-stringified payloads against the `TurnPayload` Effect Schema discriminated union before writing. Hooks pre-stringify the payload; the CLI is the schema gate.
- **Single write path.** Per [D7](../decisions.md), `record tdd-artifact` is the **only** path by which TDD evidence artifacts are written. The agent never writes its own evidence. The CLI surface makes that invariant enforceable from the hook layer.

| Action | Drives |
| ------ | ------ |
| `turn` | Inserts a `turns` row (with optional fanout to `file_edits` or `tool_invocations` based on payload type) |
| `session-start` | Inserts a `sessions` row |
| `session-end` | Updates `sessions.ended_at`/`end_reason` |
| `tdd-artifact` | Resolves the active TDD phase and writes a `tdd_artifacts` row. Takes `--chat-id` (session-resolved) **or** `--tdd-task-id` (explicit escape hatch, wins when both are present), plus `--suite vitest\|bats` (default `vitest`) to mark which runner produced a run artifact |
| `run-workspace-changes` | Idempotent `commits` insert + per-file `run_changed_files` rows |
| `test-case-turns` | Backfills `test_cases.created_turn_id` for the current session and reports the latest linked test-case id |

**`tdd-artifact` task resolution and the `--tdd-task-id` escape hatch (issue #144).** The engine's `programs/record-tdd-artifact.ts` exposes three effects (`commands/record.ts` is the flag-parsing wrapper and passes `process.cwd()` when `--cwd` is absent). `recordTddArtifactEffect` is the normal path: resolve the session from `--chat-id` via `resolveSessionForRecording`, then `DataReader.listTddTasksForSession(session.id, { walkParents: true, walkConversation: true })` and take the first open task. `walkParents` follows `parent_session_id` (the unnamed-subagent and rotated-`chat_id` cases); `walkConversation` is the detached-session fallback — when the parent walk finds nothing and the session's `conversation_id` is non-null, open tasks owned by any other session of the same conversation are considered, main-session tasks first. `recordTddArtifactByTaskIdEffect` bypasses session resolution entirely: given `--tdd-task-id` it verifies the task exists and is still open (both failures are loud — writing under a closed task's phase would corrupt the evidence trail) and writes under its current open phase. `dispatchRecordTddArtifactEffect` is the thin command-facing switch: `tddTaskId` wins when supplied, else `chatId`, else an error naming both flags; `commands/record.ts` stays a flag-parsing wrapper. Both paths share `writeArtifactUnderOpenPhase`, which auto-opens a `spike` phase when the task has none yet. The hook sets the flag from `VITEST_AGENT_TDD_TASK_ID` (see [./plugin-claude.md](./plugin-claude.md)); [../decisions.md](../decisions.md) D21 covers why the hatch is a diagnosed-split override rather than a default.

The `test-case-turns` action is the linkage that makes `tdd-artifact` correctly cite the test case that was just authored: hooks call it before each `record tdd-artifact`, capture the returned `latestTestCaseId`, and pass it as `--test-case-id`. This closes the gap that would otherwise leave `tdd_artifacts.test_case_id` unset for hook-driven artifact rows.

**`--suite vitest|bats` (issue #363).** A `Flag.choice` defaulting to `vitest`. `record.ts` passes it as `suite` through all three engine `record-tdd-artifact.ts` effects (`RecordTddArtifactInput`, `RecordTddArtifactByTaskIdInput`, `DispatchRecordTddArtifactInput` all carry an optional `suite?: ArtifactSuite`) and `writeArtifactUnderOpenPhase` forwards it onto `WriteTddArtifactInput.suite`, so the stored `tdd_artifacts.suite` column reflects which runner the hook actually matched. The flag exists because a bats run has no `test_cases` row and therefore no `--test-case-id`; without an explicit marker the validator could not tell a legitimately run-level bats artifact from a vitest run-level artifact it must reject. The hook sets `--suite bats` only on a bats match (see [./plugin-claude.md](./plugin-claude.md)); omitting the flag keeps the vitest default.

## Platform layers

The CLI composes no layers of its own. `main.ts` provides the engine's `PlatformLive({ dbPath, env, logLevel, logFile })` — SQLite + migrator + Node platform services + logger with `DataReader`, `DataStore`, `ProjectDiscovery`, `HistoryTracker` and the output pipeline over them — which backs `doctor`, `triage`, `wrapup`, `db` and the `record` group. The former `packages/cli/src/layers/CliLive.ts` was the same composite spelled locally; it was deleted when `PlatformLive` landed (Decision 70). The sidecar subcommands provide the engine's `SidecarPlatformLive(paths, env)` (formerly the CLI's `SidecarLive`) — three SQLite scopes on three uniquely-tagged clients so the databases do not contend on one connection. See [./engine.md](./engine.md).

## Hook-driven recording: `resolveSessionForRecording`

The engine's `programs/resolve-session-for-recording.ts` (formerly `packages/cli/src/lib/`). Shared session-resolution helper for hook-driven recording paths; takes a required `cwd` (the command passes `process.cwd()`). Background: Claude Code can rotate `chat_id` mid-window (compaction, resume, network blip), and the same subagent invocation can produce `tdd_artifact` records spread across two cc-session prefixes. The helper walks parents — given any `chat_id`, it follows the `sessions.parent_session_id` chain until it finds the main row for the agent, so artifact and turn writes always land under the correct canonical `sessions.id`. Used by `record turn`, `record tdd-artifact`, and the `test-case-turns` backfill. Note the division of labour: this helper resolves the *session*; the *task* lookup that follows in `record tdd-artifact` adds the conversation-tree fallback described above, and `--tdd-task-id` skips both.

## CLI flag naming

The `record` subcommand family uses `--chat-id` (the host chat UUID) and `--parent-chat-id` to align with the agent-taxonomy nomenclature. The `wrapup` command's integer FK form is `--row-id`, freeing `--chat-id` for the host UUID. The plugin hook scripts under `plugins/claude-code/hooks/**/*.sh` call the `vitest-agent agent …` and `vitest-agent db …` paths; see [./plugin-claude.md](./plugin-claude.md) for the hook layer.
