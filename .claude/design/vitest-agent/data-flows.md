---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-07
last-synced: 2026-05-07
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

onCoverage(coverage)
  +-- stash as this.coverage

async onTestRunEnd(testModules, unhandledErrors, reason)
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
  +-- Build Effect program over DataStore | DataReader |
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
  |     -> RenderedOutput[]
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

- `EnvironmentDetector.detect()` -> environment;
  `ExecutorResolver.resolve(env, mode)` -> executor role.
- Resolve `cacheDir` from `options.reporter.cacheDir` ??
  `outputFile["vitest-agent-reporter"]` (otherwise `undefined`, leaving XDG
  resolution to `AgentReporter.ensureDbPath`).
- Resolve coverage thresholds + targets; disable Vitest's native `autoUpdate`
  if targets are set.
- In agent/own mode, set `coverage.reporter = []` to suppress Vitest's text
  table.
- Resolve the `VitestAgentReporterFactory` from `options.reporterFactory`
  (default `defaultReporter`) and pass it through to the internal
  `AgentReporter` so the factory is invoked once per run with the resolved
  `ReporterKit` (Flow 1).
- Push a new `AgentReporter` (with `projectFilter: project.name` and
  `reporter: <resolved factory>`) into `vitest.config.reporters`.

## Flow 3: CLI commands

Owned by `vitest-agent-cli`. See [./components/cli.md](./components/cli.md).

- `bin.ts` resolves `dbPath` via `resolveDataPath(cwd)` under
  `PathResolutionLive(projectDir) + NodeContext.layer`.
- Provides `CliLive(dbPath, logLevel?, logFile?)` to the `@effect/cli`
  `Command.run` effect; executes via `NodeRuntime.runMain`.
- Each read-side subcommand (`status`, `overview`, `coverage`, `history`,
  `trends`, `cache`, `doctor`) is a thin wrapper over a `lib/format-*`
  function: query `DataReader` (and `ProjectDiscovery` for `overview`),
  render via `OutputRenderer`, write to stdout.
- `cache path` prints the deterministic XDG path. `cache clean` removes the
  data directory.
- The `record` subcommand has six sub-subcommands driven by the plugin hooks
  (Flow 6): `turn`, `session-start`, `session-end`, `tdd-artifact`,
  `run-workspace-changes`, `test-case-turns`.
  - `record turn --cc-session-id <id> <payload-json>` decodes the payload
    via `Schema.decodeUnknown(TurnPayload)`, resolves the session via
    `DataReader.getSessionByCcId`, then writes the turn via
    `DataStore.writeTurn` (omitting `turnNo` for auto-assignment).
  - `record test-case-turns` runs `DataStore.backfillTestCaseTurns(ccSessionId)`
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
| `SessionStart` | `session-start.sh` | calls `triage` for orientation context, then `record session-start --triage-was-non-empty <bool>`; emits triage markdown via `hookSpecificOutput.additionalContext` |
| `UserPromptSubmit` | `user-prompt-submit-record.sh` | `UserPromptPayload` via `record turn`; calls `wrapup --kind=user_prompt_nudge` and emits the result via `hookSpecificOutput.additionalContext` |
| `PreToolUse` | `pre-tool-use-record.sh` | `ToolCallPayload` via `record turn` (record-only; fires too often to inject prompts) |
| `PostToolUse` (every result) | `post-tool-use-record.sh` | `ToolResultPayload` via `record turn`; for `Edit`/`Write`/`MultiEdit` an additional `FileEditPayload` (with diff and added/removed line counts) |
| `PostToolUse` (Bash test run) | `post-test-run.sh` | writes the `run-trigger` row, then calls `record test-case-turns` best-effort so `test_cases.created_turn_id` is populated for Bash-initiated runs |
| `PreCompact` | `pre-compact-record.sh` | `HookFirePayload` via `record turn`; calls `wrapup --kind=pre_compact` and emits via top-level `systemMessage` |
| `Stop` | `stop-record.sh` | `hook_fire` turn; calls `wrapup --kind=stop` and emits via top-level `systemMessage` |
| `SessionEnd` | `session-end-record.sh` | `record session-end` to update `sessions.ended_at` / `sessions.end_reason`; calls `wrapup --kind=session_end` and emits via `systemMessage` |
| `SubagentStart` (TDD) | `subagent-start-tdd.sh` | scoped via `lib/match-tdd-agent.sh`; writes `sessions` with `agent_kind='subagent'`, `parent_session_id` set |
| `SubagentStop` (TDD) | `subagent-stop-tdd.sh` | `record session-end` with `end_reason="subagent_stop"`; generates a `wrapup --kind=tdd_handoff` note and records it as a turn on the parent session |
| `PostToolUse` (TDD-scoped) | `post-tool-use-tdd-artifact.sh` | records `test_failed_run` / `test_passed_run` from Bash test runs and `test_written` / `code_written` from Edit/Write outcomes via `record tdd-artifact` |
| `PostToolUse` (TDD-scoped) | `post-tool-use-test-quality.sh` | scans test-file edits for escape-hatch tokens and records `test_weakened` artifacts |
| `PostToolUse` (repo-scoped, `git commit`/`git push`) | `post-tool-use-git-commit.sh` | parses git metadata and shells to `record run-workspace-changes`, which writes `commits` (idempotent on `sha`) and `run_changed_files` |

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
