---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-18
last-synced: 2026-05-18
completeness: 90
related:
  - ./architecture.md
  - ./data-structures.md
  - ./schemas.md
  - ./decisions.md
  - ./components/plugin.md
  - ./components/cli.md
  - ./components/mcp.md
  - ./components/plugin-claude.md
  - ./components/ui.md
dependencies: []
---

# Data Flows — vitest-agent

End-to-end paths data takes through the system. Each flow names the package
that owns the orchestration; the per-package designs live under
[./components/](./components/).

The flows do not duplicate the reporter contract or the schemas. For type
shapes see [./schemas.md](./schemas.md). For the rationale behind individual
choices see [./decisions.md](./decisions.md).

## Flow 1: AgentReporter lifecycle

Owned by `vitest-agent-plugin` (see
[./components/plugin.md](./components/plugin.md)). The internal
`AgentReporter` class drives Vitest's reporter API and dispatches rendering
to a user-supplied `VitestAgentReporterFactory`.

```text
async onInit(vitest)
  +-- store vitest as this._vitest
  +-- await ensureDbPath()
  |     +-- if memoized: return
  |     +-- options.cacheDir set:
  |     |     mkdirSync recursive; this.dbPath = `${cacheDir}/data.db`
  |     +-- else:
  |           resolveDataPath(cwd) under PathResolutionLive +
  |             NodeContext.layer
  |           (XDG-keyed by workspace identity)

Streaming hooks (always active; emit to plugin-internal live Ink mount
when consoleMode === "ink" plus the user-supplied onRunEvent tap when set)
  onTestRunStart        -> RunStarted     -> emit(event)
  onTestModuleQueued    -> ModuleQueued   -> emit(event)
  onTestModuleStart     -> ModuleStarted  -> emit(event)
  onTestCaseResult      -> TestFinished   -> emit(event)
  onTestModuleEnd       -> ModuleFinished -> emit(event)
  emit() catches throwing user callbacks and logs to stderr; the
  internal live mount and persistence never break because a user tap
  has a bug. T6 removed the pre-2.0 gating that suppressed the tap on
  every mode except ink.

onCoverage(coverage)
  +-- stash as this.coverage

async onTestRunEnd(testModules, unhandledErrors, reason)
  |
  +-- Fire RunFinished -> emit() before persistence so the live mount
  |   and any onRunEvent tap see end-of-run before the heavy work runs
  |
  +-- dbPath = await ensureDbPath()  (defensive — tests can bypass onInit)
  |     on rejection: stderr.write(formatFatalError(err)) and return
  |
  +-- mkdirSync(dirname(dbPath), recursive: true)  (defensive no-op)
  |
  +-- await ensureMigrated(dbPath)
  |     on rejection: stderr.write(formatFatalError(err)) and return early
  |     migration cached on a globalThis Symbol so concurrent reporter
  |     instances share one promise
  |
  +-- Filter testModules by projectFilter if set
  |
  +-- UI-only short-circuit (opts.coverageMode === "ui-only"):
  |     skip ensureMigrated, DataStore, DataReader, CoverageAnalyzer,
  |     HistoryTracker entirely. Build in-memory AgentReports via
  |     buildAgentReport, run a tiny OutputPipelineLive +
  |     NodeContext.layer program to resolve env / executor / format /
  |     detail, call opts.reporter(kit), and route the RenderedOutput[].
  |     Classifications are empty; trendSummary is undefined. The
  |     streaming taps and the RunFinished event above still fire.
  |
  +-- Full mode: build Effect program over DataStore | DataReader |
  |   CoverageAnalyzer | HistoryTracker | OutputRenderer
  |     +-- captureSettings(vitestConfig, vitestVersion) -> settings
  |     +-- hashSettings(settings) -> settingsHash
  |     +-- captureEnvVars(process.env) -> envVars
  |     +-- DataStore.writeSettings (idempotent INSERT OR IGNORE)
  |
  +-- Group testModules by project.name
  +-- CoverageAnalyzer.process / processScoped -> Option<CoverageReport>
  +-- DataReader.getBaselines(project) -> Option<CoverageBaselines>
  |
  +-- For each project group:
  |     buildAgentReport(modules, errors, reason, options, name)
  |     attach unhandledErrors and coverage
  |     aggregate per-tag pass/fail/skip counts via TestReport.tags
  |     attach as report.tagCounts (Record<tag, { passed, failed, skipped }>)
  |     HistoryTracker.classify(project, outcomes, ts)
  |       -> { history, classifications }
  |     attach classifications to TestReport.classification
  |     DataStore.writeRun -> runId
  |     DataStore.writeModules / writeSuites / writeTestCases
  |     For each error:
  |       processFailure(error, options) -> { frames, signatureHash }
  |       DataStore.writeFailureSignature
  |     DataStore.writeErrors (carries signatureHash + frames)
  |     DataStore.writeCoverage / writeHistory / writeSourceMap
  |     If full (non-scoped) run:
  |       computeTrend() -> DataStore.writeTrends
  |
  +-- Compute updated baselines (ratchet up, capped at targets)
  +-- DataStore.writeBaselines
  |
  +-- DataReader.getTrends -> trendSummary
  +-- Resolve env / executor / format / detail via SDK pipeline services
  +-- Aggregate per-project classifications into a flat
  |   Map<fullName, TestClassification>
  +-- buildReporterKit(...) -> ReporterKit
  |     stdOsc8 enabled when !noColor &&
  |       (env === "terminal" || env === "agent-shell")
  +-- opts.reporter(kit) -> normalizeReporters() -> reporter[]
  +-- For each reporter: render({reports, classifications, trendSummary?})
  |     The built-in _defaultReporter from vitest-agent-ui folds
  |     input.reports through synthesizeFromAgentReport + the reducer,
  |     classifies (RunShape, RunOutcome), assembles DispatchInputs,
  |     and calls dispatch(inputs, opts) for the agent-mode stdout
  |     entry. Adds a github-summary RenderedOutput when
  |     kit.config.githubActions is true.
  +-- Concatenate all RenderedOutput[] in order
  +-- For each: routeRenderedOutput(out, { githubSummaryFile? })
  |     stdout         -> process.stdout
  |     github-summary -> append to summary file
  |     file           -> reserved (no-op)
  |
  +-- Effect.runPromise(program.pipe(Effect.provide(ReporterLive(dbPath))))
```

**No standalone GFM write path.** Under GitHub Actions the default reporter
emits a `RenderedOutput` with `target: "github-summary"` as a normal entry;
the router appends it to `GITHUB_STEP_SUMMARY`. The plugin no longer carries
a `shouldWriteGfm` block.

## Flow 2: AgentPlugin.configureVitest

Owned by `vitest-agent-plugin`. Async, runs before reporters are
instantiated. See [./components/plugin.md](./components/plugin.md).

- `EnvironmentDetector.detect()` -> environment; `envToExecutor(env)`
  maps to the executor role (`human` / `agent` / `ci`). The plugin
  computes the mapping inline (instead of going through
  `ExecutorResolver`) so `configureVitest` does not have to spin up an
  Effect runtime for the lookup; the `ExecutorResolverLive` service is
  retained in the SDK at a simplified env-only shape for downstream
  callers that already run inside an Effect program.
- Resolve `consoleMode` from `options.console.{executor}` with per-slot
  defaults (`human → passthrough`, `agent → agent`, `ci → passthrough`).
  Compute `format` for the legacy bundled reporters from `consoleMode`.
- Resolve `cacheDir` from `options.reporterOptions.cacheDir` ??
  `outputFile["vitest-agent"]` (otherwise `undefined`, leaving XDG
  resolution to `AgentReporter.ensureDbPath`).
- Resolve `coverageMode` ("full" if Vitest's native `coverage.enabled`
  is truthy, "ui-only" otherwise) and thread it onto
  `ResolvedReporterConfig`. Read `coverage.thresholds` and `coverageTargets`
  via the `ConfigValidation` Effect service — its starter rule registry
  catches mismatches (`TARGET_WITHOUT_THRESHOLD`,
  `TARGET_BELOW_THRESHOLD`, `INVALID_TARGET_VALUE`, `PERFILE_ON_TARGETS`,
  …) and emits warnings to stderr via the `[vitest-agent:plugin]`
  prefix or throws via `formatFatalError`. Auto-ratchet is delegated to
  Vitest's native `coverage.thresholds.autoUpdate`; users opt in by
  passing one of the `AgentPlugin.COVERAGE_AUTOUPDATE` tolerance
  functions.
- When `consoleMode !== "passthrough"` (the plugin owns stdout): strip
  Vitest's built-in console reporters AND set `coverage.reporter = []`
  to suppress Vitest's text coverage table. Otherwise the chain is left
  intact and the plugin contributes only persistence-driven side
  channels.
- Resolve `githubSummary` (default on under GHA when `consoleMode !==
  "silent"`); the plugin emits a `RenderedOutput` for the Step Summary
  file independent of the console mode.
- Resolve the `VitestAgentReporterFactory` from `options.reporter`
  (default `_defaultReporter` from `vitest-agent-ui`; user-supplied
  factories replace the built-in entirely — there is no composition
  slot). Pass it through to the internal `AgentReporter` so the factory
  is invoked once per run with the resolved `ReporterKit` (Flow 1).
- Forward `options.onRunEvent` to the reporter unconditionally — the
  T6 rewrite removed the gating that suppressed the tap on every mode
  except `ink`. The plugin instantiates the internal live Ink mount
  itself when `consoleMode === "ink"`; the user callback is a separate
  read-only tee subscriber.
- Push a new `AgentReporter` (with `projectFilter: project.name`,
  `reporter: <resolved factory>`, optional `onRunEvent`, and
  `consoleMode`) into `vitest.config.reporters`. A `WeakSet` keyed on
  the Vitest reference ensures exactly one aggregating reporter per
  Vitest run even when `configureVitest` fires once per project.

## Flow 3: CLI commands

Owned by `vitest-agent-cli`. See [./components/cli.md](./components/cli.md).

- `bin.ts` resolves `dbPath` via `resolveDataPath(cwd)` under
  `PathResolutionLive(projectDir) + NodeContext.layer`.
- Provides `CliLive(dbPath, logLevel?, logFile?)` to the `@effect/cli`
  `Command.run` effect; executes via `NodeRuntime.runMain`.
- The top-level tree is exactly three commands: `doctor`, `db`, `agent`.
  The T8 restructure deleted the six reporting commands (`status`,
  `overview`, `coverage`, `history`, `trends`, `show`) and their
  `lib/format-*` formatters — for 2.0 the CLI is utility-only and MCP
  (Flow 4) is the data path for test-landscape queries.
- `db path` prints the deterministic XDG path. `db prune --keep-recent N`
  drops old sessions' turn rows (default N=30). `db reset` wipes the DB
  (human-only; agent-blocked via the `VITEST_AGENT_AGENT_ID` / TTY gate).
  `db query <sql>` runs a single read-only SQL statement through a
  read-only `SqliteClient`; SQLite enforces no-write, so mutations
  surface as exit code 3 driver errors.
- The `agent` namespace (replacing the hidden `_internal` group) carries
  the hook-driven `triage`, `wrapup`, `record`, and the three sidecar
  subcommands. The `record` subcommand has six sub-subcommands driven by
  the plugin hooks (Flow 6): `turn`, `session-start`, `session-end`,
  `tdd-artifact`, `run-workspace-changes`, `test-case-turns`.
  - `record turn --cc-session-id <id> <payload-json>` decodes the payload
    via `Schema.decodeUnknown(TurnPayload)`, resolves the session via
    `DataReader.getSessionByChatId`, then writes the turn via
    `DataStore.writeTurn` (omitting `turnNo` for auto-assignment).
  - `record test-case-turns` runs `DataStore.backfillTestCaseTurns(chatId)`
    (suffix-match UPDATE on `test_cases`) then
    `DataReader.getLatestTestCaseForSession`. Outputs `{ updated: N,
    latestTestCaseId: <id|null> }`.
- All `record` paths use `CliLive`, which includes `DataStoreLive` in
  addition to `DataReaderLive`.

## Flow 4: MCP server

Owned by `vitest-agent-mcp`. See [./components/mcp.md](./components/mcp.md).

- `bin.ts` resolves `projectDir` from `VITEST_AGENT_PROJECT_DIR` (set by the
  plugin loader) ?? `CLAUDE_PROJECT_DIR` ?? `process.cwd()`.
- Resolve `dbPath` via `resolveDataPath(projectDir)` under
  `PathResolutionLive(projectDir) + NodeContext.layer`.
- Create `ManagedRuntime.make(McpLive(dbPath, logLevel?, logFile?))`,
  call `startMcpServer({ runtime, cwd: projectDir })`.
- `StdioServerTransport` connects; tool invocations route through tRPC via
  `createCallerFactory(appRouter)`. Each procedure calls
  `ctx.runtime.runPromise(effect)` against `DataReader`, `DataStore`,
  `ProjectDiscovery`, or `OutputRenderer`.
- `server.ts` calls `registerAllResources(server)` and
  `registerAllPrompts(server)` before constructing `StdioServerTransport`,
  so tool / resource / prompt surfaces are registered as one unit.
- `run_tests` uses `spawnSync("npx vitest run", ...)` with timeout — it
  shells out rather than embedding Vitest because the MCP server is a
  long-lived stdio process and a child run keeps blast radius bounded.

## Flow 5: Plugin → MCP server spawn

Owned by the file-based Claude Code plugin at `plugin/`. See
[./components/plugin-claude.md](./components/plugin-claude.md) and
[./decisions.md](./decisions.md) D30.

- `plugin/bin/start-mcp.sh` (zero-deps POSIX shell) reads
  `CLAUDE_PROJECT_DIR` (or falls back to `pwd`).
- Detect PM: `packageManager` field in root `package.json`, else lockfile
  (`pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `yarn.lock`,
  `package-lock.json`), else default `npm`.
- `exec`-replaces itself with `<pm-exec> vitest-agent-mcp` (`pnpm exec`,
  `npx --no-install`, `yarn run`, or `bun x`) with `VITEST_AGENT_REPORTER_PROJECT_DIR`
  set so the spawned bin sees the right project root (Flow 4).
- After exec, Claude Code's direct child is the PM process; no wrapper hangs around.
  Print PM-specific install instructions and exit non-zero if the bin is missing.

The loader is a thin spawner because Claude Code's MCP integration runs the
configured command as a child process and the plugin can't assume the user
has the npm packages installed globally.

## Flow 6: Plugin record hooks → CLI → DataStore

The `*-record.sh` hook scripts shell out to the user's installed
`vitest-agent` CLI via the same PM detection pattern as the MCP loader
(Flow 5). The hooks own the Claude Code event taxonomy; the CLI owns the
schema decode and the DataStore write.

| Hook event | Script | What it records |
| ---------- | ------ | --------------- |
| `SessionStart` | `session/start.sh` | calls `triage` for orientation context, then `record session-start --triage-was-non-empty <bool>`; emits triage markdown via `hookSpecificOutput.additionalContext` |
| `UserPromptSubmit` | `user-prompt-submit/record.sh` | `UserPromptPayload` via `record turn`; calls `wrapup --kind=user_prompt_nudge` and emits the result via `hookSpecificOutput.additionalContext` |
| `PreToolUse` | `pre-tool-use/record.sh` | `ToolCallPayload` via `record turn` (record-only; fires too often to inject prompts) |
| `PostToolUse` (every result) | `post-tool-use/record.sh` | `ToolResultPayload` via `record turn`; for `Edit`/`Write`/`MultiEdit` an additional `FileEditPayload` (with diff and added/removed line counts) |
| `PostToolUse` (Bash test run) | `post-tool-use/test-run.sh` | writes the `run-trigger` row, then calls `record test-case-turns` best-effort so `test_cases.created_turn_id` is populated for Bash-initiated runs |
| `PreCompact` | `pre-compact/record.sh` | `HookFirePayload` via `record turn`; calls `wrapup --kind=pre_compact` and emits via top-level `systemMessage` |
| `Stop` | `stop/record.sh` | `hook_fire` turn; calls `wrapup --kind=stop` and emits via top-level `systemMessage` |
| `SessionEnd` | `session/end-record.sh` | `record session-end` to update `sessions.ended_at` / `sessions.end_reason`; calls `wrapup --kind=session_end` and emits via `systemMessage` |
| `SubagentStart` (TDD) | `subagent/start-tdd.sh` | scoped via `lib/match-tdd-agent.sh`; writes `sessions` with `agent_kind='subagent'`, `parent_session_id` set |
| `SubagentStop` (TDD) | `subagent/stop-tdd.sh` | `record session-end` with `end_reason="subagent_stop"`; generates a `wrapup --kind=tdd_handoff` note and records it as a turn on the parent session |
| `PostToolUse` (TDD-scoped) | `post-tool-use/tdd-artifact.sh` | records `test_failed_run` / `test_passed_run` from Bash test runs and `test_written` / `code_written` from Edit/Write outcomes via `record tdd-artifact` |
| `PostToolUse` (TDD-scoped) | `post-tool-use/test-quality.sh` | scans test-file edits for escape-hatch tokens and records `test_weakened` artifacts |
| `PostToolUse` (repo-scoped, `git commit`/`git push`) | `post-tool-use/git-commit.sh` | parses git metadata and shells to `record run-workspace-changes`, which writes `commits` (idempotent on `sha`) and `run_changed_files` |

**Why hooks call the CLI rather than the DataStore directly.** Hooks are
shell scripts. The CLI owns the Effect runtime, the schema decode, and the
migration check. Going through the CLI keeps the hook scripts thin and
shell-portable while preserving the `Schema.decodeUnknown(TurnPayload)`
contract on every write path.

**Hook output channel rules.** Claude Code's hook output schema only permits
`hookSpecificOutput.additionalContext` on `PreToolUse`, `UserPromptSubmit`,
`PostToolUse`, and `PostToolBatch`. `Stop` / `SessionEnd` / `PreCompact`
must use top-level fields like `systemMessage` instead. The hook scripts
encode this rule.

## Flow 7: tRPC idempotency middleware

Owned by `vitest-agent-mcp`. The middleware sits between the tRPC input
parser and the procedure body for any tool wired with `idempotentProcedure`
(currently `hypothesis_record` and `hypothesis_validate`). See
[./decisions.md](./decisions.md) for why these tools are idempotent and
[./schemas.md](./schemas.md) for `mcp_idempotent_responses`.

```text
incoming MCP request
  |
  +-- derive idempotency key from input via the per-procedure function in
  |   idempotencyKeys (e.g. `${input.sessionId}:${input.content}` for
  |   hypothesis_record)
  |
  +-- DataReader.findIdempotentResponse(procedurePath, key)
  |     +-- Option.some(resultJson):
  |     |     JSON.parse the cached response
  |     |     attach _idempotentReplay: true
  |     |     return without calling next() — the inner procedure body
  |     |     does NOT run, so the DataStore write does NOT run
  |     +-- Option.none():
  |           call next() (the inner procedure body, which runs
  |           DataStore.writeHypothesis or DataStore.validateHypothesis)
  |
  +-- after next() resolves successfully:
  |     DataStore.recordIdempotentResponse({ procedurePath, key,
  |       resultJson: JSON.stringify(result), createdAt: now })
  |     errors here are SWALLOWED — best-effort persistence; the worst
  |     case is a re-run on the next call, which is itself idempotent
```

The composite PK `(procedure_path, key)` plus `INSERT ... ON CONFLICT DO
NOTHING` semantics mean a parallel insert race resolves to a no-op — both
branches "see" the same cached value, which is the correct behavior.

This is why the middleware is safe under concurrent calls: the cache miss /
write race produces the same observable result as a cache hit. The
DataStore is the synchronization point; the middleware does not need its
own lock.

## Error handling across flows

Errors flow back through Effect's `Cause` channel. Each tagged error
(`DataStoreError`, `DiscoveryError`, `PathResolutionError`, `TddErrors`)
sets a derived `message` of the form `[operation entity] reason` so
`Cause.pretty()` produces useful stderr output.

The reporter (Flow 1) prints `formatFatalError(err)` to stderr and returns
early on migration or DB-write failures rather than crashing the test run —
a busted DB should not block the user from seeing their test results.

The MCP server (Flow 4) catches tagged TDD errors at the boundary via the
`_tdd-error-envelope.ts` helper and surfaces them as success-shape
`{ ok: false, error: { _tag, ..., remediation } }` responses so the
orchestrator can recover without seeing a tRPC-level failure.

The idempotency middleware (Flow 7) deliberately swallows errors on the
cache write (not the procedure body) because re-running an idempotent
procedure is itself safe.

## Agent-agnostic taxonomy flows (Phases 1–4)

### Attribution flow (env-injection canonical path)

Three-step propagation chain:

1. **SessionStart hook** writes the canonical UUIDs to `${CLAUDE_ENV_FILE}`:

   ```sh
   export VITEST_AGENT_CHAT_ID="..."
   export VITEST_AGENT_CONVERSATION_ID="..."
   export VITEST_AGENT_MAIN_AGENT_ID="..."
   export VITEST_AGENT_AGENT_ID="..."
   ```

2. **Claude Code auto-sources `CLAUDE_ENV_FILE`** into Bash tool
   subprocesses and the MCP server child. (Hook subprocesses do NOT get
   auto-sourcing — non-SessionStart hooks call
   `lib/source-session-env.sh "$session_id"` to self-source.)

3. **Reporter / MCP / sidecar** read `process.env.VITEST_AGENT_*` at
   startup. The reporter records `actor_type='agent'` plus the canonical
   UUIDs on every `test_runs` row; the MCP server's `SessionContextRef`
   populates from env at boot and `run_tests` mutates `process.env` from the
   ref before `createVitest` so the in-process reporter sees current
   attribution.

**Subagent override**: when the active actor for a Bash call is a subagent
(e.g., `tdd-task`), the PreToolUse Bash hook sources the session-env dir,
computes the override prefix from the active agent context, and rewrites
`tool_input.command` to prepend `VITEST_AGENT_AGENT_ID=<subagent_id>
VITEST_AGENT_PARENT_AGENT_ID=<main_agent_id> ...`. The POSIX env-prefix
scope is the immediately-following process only — main-agent env stays
intact for subsequent calls.

**Pass-through (no agent context)**: a direct `pnpm vitest run` typed by a
human at a terminal, with no Claude window open against this project, runs
without the env vars set. The reporter records `actor_type='system'` and
NULL `agent_id`.

### Sidecar registration flow (SessionStart)

```text
SessionStart hook (bash)
  → vitest-agent agent register-agent
       --host-kind claude-code --agent-type claude-code-main
       --host-session-id $session_id --transcript-path $transcript_path --cwd $cwd
  → SidecarLive composes 3 SQLite scopes:
       per-project data.db, per-client sessions.db, registry.db
  → registerAgentEffect:
       1. mapConversation(transcript_path) — get/create canonical conversation_id
       2. mapSession(host_session_id, conversation_id, projectKey, projectDir) — get/create main_agent_id
       3. ensure sessions row exists (writeSession idempotent on chat_id)
       4. captureAgentContext(cwd) — git rev-parse for branch/sha/worktree
       5. deriveIdempotencyKey + DataStore.registerAgent (returns Agent or IdempotencyHit)
  → JSON output { agentId, conversationId, mainAgentId, idempotencyKey, idempotencyHit }
SessionStart hook parses with jq, writes 4 export lines to CLAUDE_ENV_FILE.
```

### PreToolUse Bash interception flow

The `pre-tool-use/bash.sh` hook fires on every Bash tool call, so since
workstream T9.2 it gates the `inject-env` work behind a three-layer
prefilter — Layer 0 and Layer 1 short-circuit ~98% of Bash calls before any
sidecar runs. See [./components/plugin-claude.md](./components/plugin-claude.md)
for the layer rationale and [./decisions.md](./decisions.md) Decision 42.

```text
PreToolUse hook (bash, matcher: Bash)
  → Layer 0: match raw command against SIDECAR_PREFILTER_RE (bash builtin
       [[ =~ ]], no fork). No vitest/test-script shape → emit noop, exit.
  → source lib/source-session-env.sh $session_id (gain VITEST_AGENT_* exports)
  → Layer 1: if VITEST_AGENT_AGENT_ID == VITEST_AGENT_MAIN_AGENT_ID
       (active actor is the main agent, env already correct) → emit noop,
       exit. Falls through when either var is unset.
  → Layer 2: command -v vitest-agent-sidecar (cheap builtin probe)
       binary present  → vitest-agent-sidecar inject-env --command "$cmd" --cwd $cwd
       binary absent    → <pm-exec> vitest-agent agent inject-env --command "$cmd" --cwd $cwd
  → injectEnv (same logic on both Layer 2 paths, byte-identical output):
       1. read VITEST_AGENT_CONVERSATION_ID, AGENT_ID, optional PARENT_AGENT_ID from env
          (return original command on miss — no agent context to attribute)
       2. read package.json#scripts from cwd
       3. detectVitestScripts (one-hop indirection)
       4. rewriteBashCommand: match against 5 Vitest patterns, prepend env prefix on match
  → returns rewritten or original command on stdout
PreToolUse hook returns hookSpecificOutput.updatedInput.command (and echoes
description/timeout/run_in_background unchanged).
```

### MCP boot context recovery

MCP server entry (`packages/mcp/src/bin.ts`) reads
`process.env.VITEST_AGENT_*` at startup via `sessionContextFromEnv` and
populates `McpContext.sessionContext` (a `SessionContextRef`). The
`run_tests` tool reads from the ref before each Vitest invocation.
This works because Claude Code auto-sources `CLAUDE_ENV_FILE` into the
MCP server child process — the SessionStart hook's exports flow
naturally into the MCP server's `process.env` without any explicit
session-map lookup.

The session map's `lookupByProjectDir` is the dev / test fallback when
`CLAUDE_ENV_FILE` isn't available; the per-project `data.db` itself
never reads from the session map at runtime.
