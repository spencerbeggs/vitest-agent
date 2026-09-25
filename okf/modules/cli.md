---
type: Module
title: "@vitest-agent/cli"
description: A utility-only bin for LLM agents and humans — database management plus the hook-driven recording subcommands that populate SQLite with session/turn, TDD evidence, and workspace-history rows.
kind: package
layer: L4
resource: ../../packages/cli
tags: [architecture, effect, dx]
status: stable
sources:
  - id: main-ts
    resource: ../../packages/cli/src/main.ts
  - id: bin-ts
    resource: ../../packages/cli/src/bin.ts
  - id: index-ts
    resource: ../../packages/cli/src/index.ts
  - id: db-ts
    resource: ../../packages/cli/src/commands/db.ts
  - id: agent-ts
    resource: ../../packages/cli/src/commands/agent.ts
  - id: record-ts
    resource: ../../packages/cli/src/commands/record.ts
  - id: triage-ts
    resource: ../../packages/cli/src/commands/triage.ts
  - id: wrapup-ts
    resource: ../../packages/cli/src/commands/wrapup.ts
  - id: doctor-ts
    resource: ../../packages/cli/src/commands/doctor.ts
  - id: boundaries-test
    resource: ../../packages/cli/__test__/boundaries.test.ts
  - id: version-formatter
    resource: ../../packages/cli/src/lib/version-formatter.ts
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: 51e504fb46ef3cb298caa96a978837d7b296ecbe8ceccb67ef2960516ba3c871
---

# @vitest-agent/cli

## Purpose

`@vitest-agent/cli` is a utility-only bin (`vitest-agent`) for LLM agents and
humans: database management plus the hook-driven recording subcommands that
populate the SQLite database with session/turn, TDD evidence, and
workspace-history rows. It does not run tests and does not call AI
providers, and it carries no read/reporting surface of its own — the
test-landscape queries (status, overview, coverage, history, trends) that a
1.x-shaped CLI would have answered now live behind the MCP server's tools
(see [the MCP module](mcp.md)). What remains is a small human-facing utility
surface (`doctor`, `db`) plus a discoverable namespace for hook-driven
plumbing (`agent`).

CLI commands are directory-bound: workspace identity is resolved from the
nearest root `package.json`, the `data.db` path is derived from that
identity (XDG-rooted), and every command that reaches into
`$XDG_DATA_HOME/vitest-agent/` starts by resolving which workspace's data
directory to use.

## Boundary

Rank 4 in the workspace's ranked layering (see
[Ranked Layering](../invariants/ranked-layering.md)). Its workspace runtime
dependencies are `@vitest-agent/engine`, `@vitest-agent/sdk`, and
`@vitest-agent/sidecar`; it never imports `@vitest-agent/mcp` — the two
front ends never import each other, enforced by
`packages/cli/__test__/boundaries.test.ts`[^boundaries-test], which runs
`@effected/workspaces/testing`'s `SourceBoundary.scan`. The same test
allows `process` references only in `main.ts` and `commands/**` (`bin.ts`
reads nothing; the version token is exempt), asserts the `process.env.__PACKAGE_VERSION__` token appears
only in `version.ts`, and forbids importing `@vitest-agent/mcp`,
`@vitest-agent/plugin`, `@vitest-agent/reporter`, or `@vitest-agent/ui`
anywhere under `src/`. See
[Package Boundaries](../invariants/package-boundaries.md) for the invariant
this test enforces across every package, not only this one. `lib/` stays
process-free: commands thread `env` / `cwd` in.

`@vitest-agent/plugin` declares the CLI as an exact-pinned regular
`dependency` and ships the `vitest-agent` bin itself as a shim over
`@vitest-agent/cli/main` that passes its own identity as `distribution`
(the carrier), so installing the plugin pulls the
CLI along and lands the bin in the consumer's `node_modules/.bin` under
every package manager; the Claude Code plugin's hook scripts resolve it
`.bin`-first (see [the Claude Code plugin module](claude-code-plugin.md)).
The CLI stays a separate package for module-boundary reasons — the
`effect/unstable/cli` surface is its own concern — and it is a thin command
layer: every hook program it wraps lives in the engine's `programs/`
directory (see [the engine module](engine.md)).

## Entry contract

Follows the
[front-end entry contract](../conventions/front-end-entry-contract.md):

- `src/bin.ts` is the published bin shim and nothing else: `#!/usr/bin/env
  node`, `import { main } from "./main.js"; main();`[^bin-ts].
- `src/main.ts` owns the process and is published as the `./main` subpath
  (what the carrier's `packages/plugin/src/bin/vitest-agent.ts`
  imports)[^main-ts]. `main()` reads `process.env` once, resolves
  `logLevel` / `logFile` through the engine's `resolveLogLevel(env)` /
  `resolveLogFile(env)`, resolves `projectDir = resolveProjectDir({ env,
  cwd: process.cwd() })` (the engine's four-name precedence —
  `VITEST_AGENT_PROJECT_DIR` → `VITEST_AGENT_REPORTER_PROJECT_DIR` →
  `CLAUDE_PROJECT_DIR` → cwd — so a hook-driven invocation from a
  sub-package cwd resolves the SAME `data.db` the MCP server
  uses)[^main-ts], then runs `resolveDataPath(projectDir)` under
  `PathResolutionLive(projectDir) + NodeServices.layer` and provides the
  engine's `PlatformLive({ dbPath, env, logLevel, logFile })`, merged with
  the `--version` formatter layer, as the `platform` of `@effected/cli`'s
  `CliRuntime.main` around the `effect/unstable/cli` `Command.run` effect
  (built from `Command.make("vitest-agent")` +
  `Command.withSubcommands([dbCommand, doctorCommand,
  agentCommand])`)[^main-ts]. Because the platform is inside failure
  reporting, a failure resolving the data path, opening SQLite or
  running migrations prints one line on stderr instead of a runtime
  report. `renderFailure` prints a tagged failure as `vitest-agent:
  <Tag>: <message>` and anything else as `vitest-agent:
  ${formatFatalError(error)}`. Exit codes are the kit's: `0` success,
  `64` usage error, `1` any other reported failure; a command's own
  `process.exit` code still wins. `main(options?)` takes an optional
  `distribution` and provides it as `@effected/engine`'s
  `CurrentDistribution` outermost, so the `--version` formatter
  (`lib/version-formatter.ts`, `CliColor.formatterLayer` with only
  `formatVersion` overridden) prints `vitest-agent <version>` plus
  `via @vitest-agent/plugin <version>` when the carrier launched
  it[^version-formatter]. Help and parse-error colour follow `CliColor`
  (stdout a TTY and `NO_COLOR` unset or empty).
- `src/index.ts` is a side-effect-free barrel that never imports `main.ts`,
  so a library consumer's import graph never pulls in the process-owning
  module[^index-ts]. It exports only `CURRENT_CLI_VERSION` (from
  `src/version.ts`, inlined from `process.env.__PACKAGE_VERSION__` at build
  time). The sidecar layer, hook-path resolver, and register/end-agent
  programs live in `@vitest-agent/engine` as of the rank-3/4 engine split;
  `dispatch` / `injectEnv` / `exitCodeForTag` ship from the platform-free
  `@vitest-agent/sdk/dispatch` entry (see
  [the sdk-dispatch interface](../interfaces/sdk-dispatch.md)).

The top-level command tree is exactly three children, wired in `main.ts`'s
`withSubcommands`: `doctor` (human, 5-point health diagnostic, `--format
markdown|json`), `db` (human, database management), and `agent` (agents /
hooks, namespace for hook-driven plumbing).

## The `db` command group

`packages/cli/src/commands/db.ts`. The `db` parent carries four
subcommands[^db-ts]:

- `path` — prints the resolved XDG `data.db` path. The path is a function of
  identity, not artifact presence — it prints even when no DB has been
  written yet.
- `prune --keep-recent N` — turn-history retention (default `N=30`). Calls
  `DataStore.pruneSessions(n)`: finds the cutoff at the `(n+1)`-th most
  recent session by `started_at` and deletes turn rows for older sessions.
  FK CASCADE handles `tool_invocations` and `file_edits`. **The `sessions`
  rows themselves are retained** — only the turn log is pruned. Idempotent.
- `reset` — wipes `data.db` plus its `-shm` / `-wal` companions; human-only,
  agent-blocked.
- `query <sql>` — a single read-only SQL statement.

`db reset` enforces a refusal gate, evaluated in order: (1)
`VITEST_AGENT_AGENT_ID` set in the environment → refuse, exit code 4
("agent context"); (2) non-TTY stdout without `--yes` → refuse, exit code 5
("non-interactive without consent"); (3) TTY without `--yes` → interactive
`Wipe <path>? [y/N]:` prompt, empty / `n` / `N` aborts with exit 0 and
`aborted` on stdout; (4) `--yes` skips the prompt unconditionally (still
subject to gate 1)[^db-ts]. On success it removes `data.db` and the
`-shm` / `-wal` sidecars via `FileSystem.FileSystem`, each wrapped in
`Effect.catch(() => Effect.void)` (the v4 rename of `Effect.catchAll`) so a
missing file is success-equivalent — the operation is idempotent.

`db query <sql>` opens the connection through `@effect/sql-sqlite-node`'s
`SqliteClient` with the `readonly` flag — SQLite enforces the no-write
invariant at the engine level, so mutations surface as the driver's
readonly error rather than parse-time SQL validation[^db-ts]. Exit codes:
`2` for empty / whitespace-only SQL, `3` for any driver error (syntax errors
and readonly violations alike are grouped here). `describeError` flattens
the `Error.cause` chain so the driver's `attempt to write a readonly
database` text surfaces regardless of which layer wrapped it. Output is
formatted by `lib/format-db-query.ts`: `--format table` (default) renders
column headers plus whitespace-padded rows with `(0 rows)` for an empty
result set, `--format json` emits a JSON array of row objects keyed by
column name (`[]` when empty). Schema introspection works out of the box via
`SELECT name FROM sqlite_master WHERE type='table'`.

## The `agent` namespace

`packages/cli/src/commands/agent.ts`. The `agent` parent is a discoverable
namespace: its `Command.withDescription` carries a warning header —
*"Commands intended for agents and hook scripts — humans typically don't
invoke these directly."* — that `effect/unstable/cli`'s help formatter
renders above the subcommand list[^agent-ts]. The group composes eight
subcommands: `triage` (SessionStart hook, emits the W3 orientation brief),
`wrapup` (Stop / SessionEnd / PreCompact / UserPromptSubmit hooks, emits the
W5 wrap-up prompt, `--kind` selects the lifecycle variant), `record`
(plugin hooks, session/turn capture — see below), `register-agent`
(SessionStart / SubagentStart hooks, wraps the engine's
`registerAgentEffect`), `end-agent` (SessionEnd / SubagentStop hooks, wraps
`endAgentEffect`), `inject-env` (PreToolUse Bash hook, pure command-rewriter
— the JS fallback the sidecar binary shadows), `sidecar-path` (SessionStart
hook once per session, prints the resolved sidecar binary path), and
`check-test-path` (PreToolUse test-location hook, classifies a test-file
path).

`triage` and `wrapup` keep their `--format markdown|json|silent` axis (the
only commands that do — `db query` has its own `--format table|json` axis,
everything else emits plain stdout text by convention). `triage` and
`wrapup` call `formatTriageEffect` / `formatWrapupEffect` from
`@vitest-agent/engine`, shared verbatim with the MCP tools `triage_brief`
and `wrapup_prompt`, so CLI and MCP outputs are byte-identical.

**Dependency relationship with the sidecar package.** `@vitest-agent/cli`
depends on `@vitest-agent/sidecar` (not the reverse): the sidecar package
exports `resolveSidecarBinaryPath`, and the CLI's `agent sidecar-path`
subcommand calls it to resolve the binary's absolute path. The dispatch core
the SEA binary actually runs — the pure `dispatch(argv, io)` / `DispatchIo`
/ `DispatchResult`, `injectEnv` / `InjectEnvInput`, `exitCodeForTag` — lives
in `@vitest-agent/sdk` and is reached through the dedicated
`@vitest-agent/sdk/dispatch` entry point; the per-platform sidecar children
declare `@vitest-agent/sdk` as their only workspace `devDependency` and
import `dispatch` from there. They do not depend on `@vitest-agent/cli` —
the closing edge of the workspace graph is `sidecar-<platform> → sdk`, a
true leaf (see [the sidecar module](sidecar.md)). `register-agent` stays
JS-only — its native SQLite binding cannot be bundled into a SEA.

**`check-test-path` fails open on non-default discovery.**
`classifyTestPath` encodes the *default* `DiscoverStrategy`'s layout rule
and nothing else, so a workspace with a custom `discoverStrategy`
(including `discoverStrategy: false`), an `AgentPlugin.discover()`
custom-project chain, or a class implementing `DiscoverStrategy` can
legitimately collect a path the default rule calls `invalid` — and the hook
would deny a `Write` there with confident, wrong advice. Before
classifying, the command finds the workspace's first Vitest/Vite config
(`vitest.config.{ts,mts,js,mjs}`, then `vitest.workspace.*`, then
`vite.config.*` — the order Vitest itself prefers), reads its source text,
and runs the SDK's pure `detectNonDefaultDiscoverStrategy(source)` over it.
A detected marker, a missing config, and an unreadable config all take the
same exit-1-no-stdout path: none of the three lets the command rule out a
non-default strategy, and no verdict is safer than a wrong one. The scan is
lexical (a comment-stripped regex pass), never a config load — the command
sits on the hook hot path, and booting the consumer's `vitest.config.ts`
through Vite on every test-shaped `Read`/`Write`/`Edit` is out of scope by
design[^agent-ts].

The sidecar subcommands return plain text on stdout for the bash hooks to
parse, and structured error info on stderr in the shape `<exit_code>
<error_tag>: <message>`. Exit codes follow a fixed contract: `0` success,
`1` registration conflict, `2` sidecar timeout, `3` database error, `4`
`ProjectIdentityNotResolvableError`, `5` unexpected defect (the engine's
`XdgEnvError` / `AppDirsError` / `PlatformError` tags map here too, via the
core's `exitCodeForTag`). Both `register-agent` and `end-agent` call the
engine's `resolveHookPaths({ env: process.env, projectKey })` — which
resolves all three SQLite store paths (per-project `data.db`, per-client
`sessions.db`, registry `registry.db`) from the injected env and creates
every parent dir — and provide `SidecarPlatformLive(paths, process.env)`.
Path resolution does not depend on workspace discovery, so the sidecar works
in non-pnpm-workspace project shapes.

## The `record` subcommand

`vitest-agent agent record <action>` is the load-bearing surface for the
plugin's session/turn capture, TDD evidence binding, and workspace-history
pipeline. Hooks fire dozens of times per session and shell out to it rather
than performing SQL writes themselves — POSIX shell hooks plus a single
`vitest-agent` invocation are faster than re-running an Effect runtime per
fire, the CLI's startup cost is paid once per fire in one short-lived
process, and `record turn` validates JSON-stringified payloads against the
`TurnPayload` Effect Schema discriminated union before writing so hooks
pre-stringify the payload while the CLI is the schema gate. `record
tdd-artifact` is the **only** path by which TDD evidence artifacts are
written — the agent never writes its own evidence — which the CLI surface
makes enforceable from the hook layer[^record-ts].

Seven actions compose the group[^record-ts]: `turn` (inserts a `turns`
row, with fanout to `file_edits` or `tool_invocations` depending on payload
type), `session-start` (inserts a `sessions` row), `session-end` (updates
`sessions.ended_at`/`end_reason`), `tdd-artifact` (resolves the active TDD
phase and writes a `tdd_artifacts` row; takes `--chat-id` — session-resolved
— **or** `--tdd-task-id` — the explicit escape hatch, wins when both are
present — plus `--suite vitest|bats` to mark which runner produced a run
artifact), `run-workspace-changes` (idempotent `commits` insert plus
per-file `run_changed_files` rows), `run-trigger` (associates the latest
test run with the current session), and `test-case-turns` (backfills
`test_cases.created_turn_id` for the current session and reports the latest
linked test-case id).

**`tdd-artifact` task resolution and the `--tdd-task-id` escape hatch.** The
engine's `programs/record-tdd-artifact.ts` exposes three effects
(`commands/record.ts` is the flag-parsing wrapper and passes
`process.cwd()` when `--cwd` is absent). `recordTddArtifactEffect` is the
normal path: resolve the session from `--chat-id` via
`resolveSessionForRecording`, then
`DataReader.listTddTasksForSession(session.id, { walkParents: true,
walkConversation: true })` and take the first open task. `walkParents`
follows `parent_session_id` (the unnamed-subagent and rotated-`chat_id`
cases); `walkConversation` is the detached-session fallback — when the
parent walk finds nothing and the session's `conversation_id` is non-null,
open tasks owned by any other session of the same conversation are
considered, main-session tasks first.
`recordTddArtifactByTaskIdEffect` bypasses session resolution entirely:
given `--tdd-task-id` it verifies the task exists and is still open (both
failures are loud — writing under a closed task's phase would corrupt the
evidence trail) and writes under its current open phase.
`dispatchRecordTddArtifactEffect` is the thin command-facing switch:
`tddTaskId` wins when supplied, else `chatId`, else an error naming both
flags. Both paths share `writeArtifactUnderOpenPhase`, which auto-opens a
`spike` phase when the task has none yet. The hook sets the flag from
`VITEST_AGENT_TDD_TASK_ID` (see
[the Claude Code plugin module](claude-code-plugin.md)).

`test-case-turns` is the linkage that makes `tdd-artifact` correctly cite
the test case that was just authored: hooks call it before each `record
tdd-artifact`, capture the returned `latestTestCaseId`, and pass it as
`--test-case-id`. This closes the gap that would otherwise leave
`tdd_artifacts.test_case_id` unset for hook-driven artifact rows.

## Platform layers

The CLI composes no layers of its own. `main.ts` provides the engine's
`PlatformLive({ dbPath, env, logLevel, logFile })` — SQLite + migrator +
Node platform services + logger with `DataReader`, `DataStore`,
`ProjectDiscovery`, `HistoryTracker` and the output pipeline over them —
which backs `doctor`, `triage`, `wrapup`, `db` and the `record` group. The
sidecar subcommands provide the engine's `SidecarPlatformLive(paths, env)` —
three SQLite scopes on three uniquely-tagged clients so the databases do not
contend on one connection. See [the engine module](engine.md).

## Hook-driven recording: `resolveSessionForRecording`

The engine's `programs/resolve-session-for-recording.ts` is the shared
session-resolution helper for hook-driven recording paths; it takes a
required `cwd` (the command passes `process.cwd()`). Claude Code can rotate
`chat_id` mid-window (compaction, resume, network blip), and the same
subagent invocation can produce `tdd_artifact` records spread across two
cc-session prefixes. The helper walks parents — given any `chat_id`, it
follows the `sessions.parent_session_id` chain until it finds the main row
for the agent, so artifact and turn writes always land under the correct
canonical `sessions.id`. Used by `record turn`, `record tdd-artifact`, and
the `test-case-turns` backfill. Note the division of labour: this helper
resolves the *session*; the *task* lookup that follows in `record
tdd-artifact` adds the conversation-tree fallback described above, and
`--tdd-task-id` skips both.

## CLI flag naming

The `record` subcommand family uses `--chat-id` (the host chat UUID) and
`--parent-chat-id` to align with the agent-taxonomy nomenclature. The
`wrapup` command's integer FK form is `--row-id`, freeing `--chat-id` for
the host UUID. The plugin hook scripts under
`plugins/claude-code/hooks/**/*.sh` call the `vitest-agent agent …` and
`vitest-agent db …` paths; see
[the Claude Code plugin module](claude-code-plugin.md) for the hook layer
and [the CLI interface](../interfaces/cli.md) for the full command/flag
contract from the consumer's side.

## Choices absorbed here

**CLI-First Overview.** The CLI once generated overview/status data
on-demand rather than the reporter producing it on every test run —
overview generation requires filesystem discovery (globbing, reading source
files) that would slow down every test run, and on-demand generation suited
discovery data that changes infrequently while keeping the reporter lean.
That surface later moved wholesale to the MCP server's test-landscape tools
(`test_status`, `inventory`, `test_overview`, `test_history`, `test_trends`,
`test_coverage`, `file_coverage`) once "MCP is the data path" superseded the
CLI-first split, leaving the CLI utility-only as described above.

[^boundaries-test]: `../../packages/cli/__test__/boundaries.test.ts`
[^version-formatter]: `../../packages/cli/src/lib/version-formatter.ts`
[^main-ts]: `../../packages/cli/src/main.ts:42` (`main`), `../../packages/cli/src/main.ts:57` (`projectDir`), `../../packages/cli/src/main.ts:31` (`rootCommand`)
[^bin-ts]: `../../packages/cli/src/bin.ts:10`
[^index-ts]: `../../packages/cli/src/index.ts:21`
[^db-ts]: `../../packages/cli/src/commands/db.ts:192` (`db` parent), `../../packages/cli/src/commands/db.ts:194` (`dbCommand`), `../../packages/cli/src/commands/db.ts:52` (`reset`), `../../packages/cli/src/commands/db.ts:153` (`query`)
[^agent-ts]: `../../packages/cli/src/commands/agent.ts:333` (`agentParent`), `../../packages/cli/src/commands/agent.ts:339` (`agentCommand`), `../../packages/cli/src/commands/agent.ts:296` (`check-test-path`)
[^record-ts]: `../../packages/cli/src/commands/record.ts:303`
