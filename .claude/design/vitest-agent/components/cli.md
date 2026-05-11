---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-11
last-synced: 2026-05-11
completeness: 92
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ./sdk.md
  - ./mcp.md
  - ./plugin-claude.md
dependencies: []
---

# CLI package (`vitest-agent-cli`)

On-demand test landscape queries for LLM agents, plus the hook-driven
recording subcommands that populate the SQLite database with session/turn,
TDD evidence, and workspace-history rows. Reads cached test data from the
SQLite database and project structure. Does not run tests or call AI
providers.

**npm name:** `vitest-agent-cli`
**Bin:** `vitest-agent`
**Location:** `packages/cli/`
**Internal dependencies:** `vitest-agent-sdk`

The plugin declares the CLI as a required `peerDependency`, so installing
the plugin pulls the CLI along with it. A separate package keeps the
`@effect/cli` dependency out of the runtime install for users who only
want the reporter or MCP server.

CLI commands are directory-bound. Vitest is itself directory-bound, and
the CLI operates in the context of the working directory — workspace
identity is resolved from the nearest root `package.json`, the database
path is derived from that identity (XDG-rooted), and even the read-only
commands that reach into `$XDG_DATA_HOME/vitest-agent/` start by resolving
which workspace's data directory to use.

## Current role

The CLI is in a transitional state. It was originally designed as the
human interface to persisted test data — `status`, `coverage`, `trends`,
`history` for direct inspection. In the current shape it also serves as
an escape hatch for agent ↔ MCP data handoff in flows where direct MCP
calls are impractical: the `record` subcommand is the prominent example,
driven by the plugin's POSIX-shell hooks because hooks must start fast and
cannot easily speak the MCP protocol. The long-term intent is agents
reach data exclusively through MCP and humans use the CLI for management;
a future iteration may wrap the read commands in React Ink for a richer
TUI.

---

## Bin and command surface

`packages/cli/src/bin.ts`. The bin resolves `dbPath` via
`resolveDataPath(process.cwd())` under
`PathResolutionLive(projectDir) + NodeContext.layer`, then provides
`CliLive(dbPath, logLevel, logFile)` to the `@effect/cli` `Command.run`
effect. Defects print `formatFatalError(cause)` to stderr.

Commands fall into two functional groups:

**Read commands** — query cached data from the SQLite database. `status`,
`overview`, `coverage`, `history`, `trends`, `cache` (with `path`,
`clean`, `prune` subcommands), `doctor`, `triage`, `wrapup`. All support
`--format` for output format selection. Each command file under
`commands/` is a thin wrapper over the matching `lib/format-*.ts`
function — the formatting logic is testable in isolation without the
`@effect/cli` runtime.

**Record commands** — write data, driven by plugin hook scripts. The
`record` subcommand dispatches to `turn`, `session-start`, `session-end`,
`tdd-artifact`, `run-workspace-changes`, and `test-case-turns` actions.
Each action's library function lives under `lib/record-*.ts`.

For the formatter library that powers `triage` and `wrapup` — shared
verbatim between CLI and MCP — see [./sdk.md](./sdk.md). For the hook
scripts that drive the `record` subcommands, see
[./plugin-claude.md](./plugin-claude.md).

## The `record` subcommand

The `record` subcommand is the load-bearing surface for the plugin's
session/turn capture, TDD evidence binding, and workspace-history pipeline.
Hooks fire dozens of times per session and shell out to `vitest-agent
record <action>` rather than performing SQL writes themselves.

Why this layering exists:

- **Speed.** Hooks must start fast; a Node-based hook pays a startup cost
  per fire. POSIX shell hooks plus a single `vitest-agent` invocation are
  faster than re-running an Effect runtime per fire from scratch — but the
  CLI's startup cost is paid once per fire, in one short-lived process,
  not per row.
- **Validation.** `record turn` validates JSON-stringified payloads
  against the `TurnPayload` Effect Schema discriminated union before
  writing. Hooks pre-stringify the payload; the CLI is the schema gate.
- **Single write path.** Per [D7](../decisions.md), `record tdd-artifact`
  is the **only** path by which TDD evidence artifacts are written. The
  agent never writes its own evidence. The CLI surface is what makes that
  invariant enforceable from the hook layer.

Each record action follows the same shape:

| Action | Drives |
| ------ | ------ |
| `turn` | Inserts a `turns` row (with optional fanout to `file_edits` or `tool_invocations` based on payload type) |
| `session-start` | Inserts a `sessions` row |
| `session-end` | Updates `sessions.ended_at`/`end_reason` |
| `tdd-artifact` | Resolves the active TDD phase and writes a `tdd_artifacts` row |
| `run-workspace-changes` | Idempotent `commits` insert + per-file `run_changed_files` rows |
| `test-case-turns` | Backfills `test_cases.created_turn_id` for the current session and reports the latest linked test-case id |

The `test-case-turns` action is the linkage that makes `tdd-artifact`
correctly cite the test case that was just authored: hooks call it before
each `record tdd-artifact`, capture the returned `latestTestCaseId`, and
pass it as `--test-case-id`. This closes the gap that would otherwise
leave `tdd_artifacts.test_case_id` unset for hook-driven artifact rows.

## Triage and wrapup

The `triage` and `wrapup` commands delegate to the shared `format-triage`
and `format-wrapup` generators in `packages/sdk/src/lib/`. The same
generators back the matching MCP tools (`triage_brief`, `wrapup_prompt`),
so CLI and MCP outputs are byte-identical.

`triage` is invoked by the SessionStart hook; the hook writes the output
into Claude Code's `hookSpecificOutput.additionalContext`. `wrapup` is
invoked by the four interpretive hooks (Stop, SessionEnd, PreCompact,
UserPromptSubmit) — each picks a `--kind` variant matching the lifecycle
event.

Per Claude Code's hook schema, `additionalContext` is only valid for a
subset of events; `Stop`, `SessionEnd`, and `PreCompact` must use top-
level `systemMessage` instead. The hooks know the constraint; the CLI's
output is identical regardless.

## Cache pruning

`cache prune --keep-recent <n>` calls `DataStore.pruneSessions(n)`. The
non-obvious behaviour: it finds the cutoff at the `(n+1)`-th most recent
session by `started_at` and deletes turn rows for older sessions. FK
CASCADE handles `tool_invocations` and `file_edits`. **The `sessions`
rows themselves are retained** — only the turn log is pruned. Idempotent.

## CliLive composition layer

`packages/cli/src/layers/CliLive.ts`. Composes `DataReaderLive`,
`DataStoreLive`, `ProjectDiscoveryLive`, `HistoryTrackerLive`,
`OutputPipelineLive`, `SqliteClient`, `Migrator`, `NodeContext`,
`NodeFileSystem`, and `LoggerLive`. The bin uses `NodeRuntime.runMain` to
execute against this composite.

## `_internal` sidecar subcommand group

`packages/cli/src/commands/internal.ts`. Hidden subcommand namespace
invoked by the Claude Code plugin's POSIX-shell hooks. Not user-facing
— every subcommand prints plain text on stdout that the bash hooks
parse, and structured error info on stderr in the shape
`<exit_code> <error_tag>: <message>`.

Three subcommands:

| Subcommand | Driven by | Purpose |
| --- | --- | --- |
| `register-agent` | SessionStart / SubagentStart hooks | Maps host session id and transcript path to canonical `conversation_id`/`main_agent_id`, captures git context via `RunContext`, calls `DataStore.registerAgent`, writes session-map rows. Emits JSON `{ agentId, conversationId, mainAgentId, idempotencyKey, idempotencyHit }` for the hook to parse with `jq` and re-export as `VITEST_AGENT_*` env. |
| `end-agent` | SessionEnd / SubagentStop hooks | Sets `agents.ended_at`. When `--host-session-id` is passed, also sets `session_map.ended_at`; SubagentStop omits that flag to leave the main agent's session-map row open. |
| `inject-env` | PreToolUse Bash hook | Pure command-rewriter. Reads `VITEST_AGENT_CONVERSATION_ID`/`_AGENT_ID`/optional `_PARENT_AGENT_ID` from env and `package.json#scripts` from cwd, runs `detectVitestScripts` (one-hop indirection), then `rewriteBashCommand` against five Vitest patterns. On match, prepends the canonical env prefix; on miss, echoes the original command unchanged. |

Exit codes follow a fixed contract:

- `0` — success
- `1` — registration conflict
- `2` — sidecar timeout
- `3` — database error
- `4` — `ProjectIdentityNotResolvableError` (no project identity from
  any of the five fallback sources)
- `5` — unexpected defect

The sidecar resolves all three SQLite store paths from env at
invocation time (per-project `data.db` under `$XDG_DATA_HOME`, per-client
`sessions.db` under `${CLAUDE_PLUGIN_DATA}`, registry `registry.db` under
`$XDG_DATA_HOME`) and uses `mkdirSync(..., { recursive: true })` to
ensure every parent dir exists before SQLite opens the file. Path
resolution does NOT depend on workspace-discovery, so the sidecar
works in non-pnpm-workspace project shapes.

## `SidecarLive` composition layer

`packages/cli/src/layers/SidecarLive.ts`. Composes three SQLite scopes
for the sidecar subcommands: per-project `data.db` (`DataStoreLive`,
`DataReaderLive`), per-client `sessions.db`
(`PerClientSessionMapLive`), and the global registry `registry.db`
(`DiscoveryRegistryLive`). Each store gets its own `SqlClient`
connection via three uniquely-tagged Sqlite client tags so the three
DBs do not contend on a single connection. The bin's `runSidecar`
helper wraps `Effect.provide(effect, SidecarLive(paths))` and
`NodeRuntime.runMain`, sharing exit-code mapping logic across all
three subcommands.

## Hook-driven recording: `resolveSessionForRecording`

`packages/cli/src/lib/resolve-session-for-recording.ts`. Shared
session-resolution helper for hook-driven recording paths. Background:
Claude Code can rotate `chat_id` mid-window (compaction, resume,
network blip), and the same subagent invocation can produce
`tdd_artifact` records spread across two cc-session prefixes. The
helper walks parents — given any `chat_id`, it follows the
`sessions.parent_session_id` chain until it finds the main row for
the agent, so artifact and turn writes always land under the correct
canonical `sessions.id`. Used by `record turn`, `record tdd-artifact`,
and the `test-case-turns` backfill.

## CLI flag rename (Phase 4)

The `record` subcommand family renamed `--cc-session-id` to
`--chat-id` and `--parent-cc-session-id` to `--parent-chat-id`
to align with the agent-taxonomy nomenclature. The `wrapup` command's
prior integer FK form moved to `--row-id` to free `--chat-id` for
the host UUID. All plugin hook scripts (14 files) were updated in
lockstep — pre-2.0 break, no shims.
