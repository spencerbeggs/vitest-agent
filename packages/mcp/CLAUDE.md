# @vitest-agent/mcp

The Model Context Protocol server (`vitest-agent-mcp` bin) exposing the action-keyed tool surface to LLM agents over stdio. Built on Effect's native `McpServer` (`effect/unstable/ai`): the 30 tools are `Tool.make` values assembled into one `Toolkit`, registered under a strict-input contract, and served alongside six framing-only prompts as a single Effect `Layer` over `McpServer.layerStdio`. There is no MCP SDK, no tRPC and no zod — the wire protocol, JSON Schema generation and input validation all come from `effect`. A regular `dependency` of the plugin package, so every plugin consumer installs it. It stays a separate package for module-boundary clarity and an independent tool-surface release cadence.

## Layout

```text
src/
  bin.ts              -- bin entry: `void main()`, nothing else
  main.ts             -- the assembled program that OWNS the process:
                         crash guards, projectDir / dbPath resolution,
                         boot-time session recovery, PlatformLive (engine),
                         NodeStdio, NodeRuntime.runMain. Every `process`
                         read for the server lives here. Published as the
                         `./main` subpath so the plugin can ship the same bin
  index.ts            -- programmatic barrel; never imports main.ts
  server.ts           -- ServerLayer({ version }): registerStrictToolkit(Kit)
                         + PromptsLayer over McpServer.layerStdio, with
                         Logger.LogToStderr forced on (stdout is the wire)
  toolkit.ts          -- Kit = Toolkit.make(<30 tools>); toolHandlers (the
                         30-entry handler record, `satisfies HandlersFrom`);
                         ToolsLayer = Kit.toLayer(toolHandlers)
  register-toolkit.ts -- registerStrictToolkit(kit): the strict registration
                         contract (see Conventions) over McpServer.addTool
  session.ts          -- McpSession service: { cwd, currentSessionId,
                         sessionContext }; createCurrentSessionIdRef,
                         createSessionContextRef(initial, recover?),
                         sessionContextFromEnv(env); layer / layerTest
  idempotency.ts      -- idempotencyKeys registry (hypothesis, tdd_task,
                         tdd_goal, tdd_behavior) + the withIdempotency
                         combinator write handlers wrap themselves in
  annotations.ts      -- RenderText: the per-tool markdown renderer
                         annotation the strict registrar reads
  tools/              -- one file per tool: the parameters / success
                         Schemas, the `Tool.make` value, and the
                         `handle<Name>` Effect. Per-CRUD families
                         (`tdd_task`, `tdd_goal`, `tdd_behavior`, `note`,
                         `hypothesis`, `inventory`, `test`) dispatch on an
                         `action` (or `kind`) discriminator via
                         `Match.discriminatorsExhaustive`; plus the private
                         _tdd-error-envelope.ts and _project-groups.ts
  prompts/
    layer.ts          -- PromptsLayer = Layer.mergeAll(six McpServer.prompt)
                         — names, descriptions, string-based argument
                         schemas, and the PromptMessage mapping
    triage.ts, why-flaky.ts, regression-since-pass.ts,
    explain-failure.ts, tdd-resume.ts, wrapup.ts -- one pure factory each
  utils/
    crash-guards.ts   -- pure shouldExitOnUncaughtException(connected)
    safe-format-fatal-error.ts -- never-throwing fatal formatter for main.ts
    tool-error-envelope.ts -- buildUnexpectedToolErrorEnvelope(tool, err)
    replay-marker.ts  -- the `_idempotentReplay` marker schema
  version.ts          -- CURRENT_MCP_VERSION (build-time literal)
```

## Key files

| File | Purpose |
| ---- | ------- |
| `main.ts` | Registers the `unhandledRejection` / `uncaughtException` guards FIRST, then dynamically imports everything else (see Conventions). `resolveProjectDir` precedence: `VITEST_AGENT_PROJECT_DIR` -> `VITEST_AGENT_REPORTER_PROJECT_DIR` -> `CLAUDE_PROJECT_DIR` -> cwd. Builds `McpSession.layer` from `sessionContextFromEnv(process.env)` plus the engine's lazy `recoverSessionContextFromSessionEnv` thunk, provides `PlatformLive({ dbPath, env, ... })` and `NodeStdio.layer`, and launches under `NodeRuntime.runMain` with a teardown that maps an interrupts-only exit (stdin EOF) to 0. Carries the env-gated crash injector `VITEST_AGENT_MCP_TEST_INJECT_CRASH` for the spawned-bin e2e suite |
| `server.ts` | `ServerLayer({ version })`. `protocols` is newest-first (`2025-11-25`, `2025-06-18`, `2025-03-26`) because the registry falls back to `protocols[0]` for an unknown client version. `serverInfo.description` is the at-initialize orientation hook (`instructions` cannot be set through `layerStdio` at rc.115) |
| `register-toolkit.ts` | The strict contract: serves `additionalProperties: false` on every object node (a top-level `action` / `kind` union becomes `oneOf` + `x-discriminator`), inlines `$ref` roots, walks the raw payload against the served schema BEFORE decoding and fails `InvalidParams` naming the unknown key(s) and the accepted params at every level, renders the dual channel (`structuredContent` = encoded result, `content[0].text` = `RenderText` markdown or JSON), maps a declared `Error`-shaped failure to `isError` text (upstream parity) and every other failure or defect to the `UnexpectedToolError` envelope |
| `toolkit.ts` | `Kit` is the single source of truth for the served tool list; `toolHandlers` must satisfy `Toolkit.HandlersFrom<typeof Kit.tools>`, so a tool without a handler (or vice versa) is a compile error |
| `session.ts` | `McpSession` is the one per-process service tool handlers read for `cwd` and the host session; `layerTest({ cwd, ... })` requires an explicit `cwd` because this module is process-free (the boundary test enforces it) |
| `prompts/layer.ts` | Prompt arguments are strings on the wire, so every parameter is `Schema.String`-based with `optionalKey` for the non-required ones; `wrapup.kind` is `Schema.Literals(WRAPUP_KINDS)`. `tdd-resume` reads `McpSession` to default `sessionId` to the recovered chat id |
| `tools/run-tests.ts` | In-process `createVitest` (`vitest/node`) + `localVitest.start()` with configurable timeout (default 120s); overrides `coverage.reportsDirectory` with a per-invocation `mkdtemp` dir so concurrent runs don't clobber each other. Builds the `AgentReport` from `result.testModules` and folds `consoleLeaks` from the post-run `state.getFiles()` walk. `RunTestsOk` echoes `scope: { project, files, tags }` and `projectRoot` verbatim. `projectRoot` is validated against `McpSession.cwd` via `git rev-parse --git-common-dir` (same repo or worktree, else refused); omitted, `resolveConfigAnchoredRoot()` walks up from `cwd` for `vitest.config.*` / `vite.config.*` bounded at the git root (Decisions 54, 56). The ONE tool allowed to touch `process`: it mutates `process.env.VITEST_AGENT_*` from the session refs so the in-process reporter attributes the run. Resolves `vitest/node` from the run's root via `resolveVitestNodeEntry` (Decision 55) |
| `tools/history.ts` | `test_history` — `testName` / `modulePath` scope every section (history, flaky, persistent, `hasData`); `limit` caps runs kept per test (default 20) and must be a positive integer (issue #243) |
| `tools/test.ts` | Consolidated `test` tool. `action: "get"` refuses to guess an ambiguous `fullName` without `modulePath` (`ambiguous: true`, `candidateModules[]`) |
| `tools/hypothesis.ts` | `record` resolves the binding session server-side: `tddTaskId` (number or numeric string, unknown id is a hard failure) -> recovered host context (main session -> active subagent child) -> caller `sessionId` only when nothing is recovered. `validate`'s `validatedAt` is optional (server stamps now) |
| `tools/tdd-task.ts`, `tools/tdd-goal.ts`, `tools/tdd-behavior.ts` | Action-keyed lifecycle and CRUD; `start` / `end` / `create` actions are wrapped in `withIdempotency`. `delete` on goal / behavior is denied to the orchestrator at the plugin's `pre-tool-use/tdd-restricted.sh` hook |
| `tools/tdd-phase-transition-request.ts` | `goalId` required; pre-checks goal status and behavior membership before the D2 binding-rule validator; auto-promotes the behavior `pending -> in_progress` in the same transaction |
| `tools/tdd-progress-push.ts` | Emits a `notifications/message` frame (`logger: "vitest-agent/channel"`) carrying the enriched payload — the only custom-notification surface Effect's `McpServer` offers |
| `tools/_tdd-error-envelope.ts` | Catches the five tagged TDD errors and surfaces them as success-shape `{ ok: false, error: { _tag, ..., remediation } }` |
| `utils/crash-guards.ts` | Pure `shouldExitOnUncaughtException(transportConnected)`: exit while no client session exists, survive after connect. The one place the departure from Node's "do not resume" guidance is stated and tested |

## Conventions

- **`main.ts` carries NO static imports of the server graph.** The crash
  guards must be registered before `NodeRuntime`, the engine platform or
  `ServerLayer` are evaluated, so a throw during module evaluation is
  still reported on stderr instead of crashing silently. Everything after
  the guards is a dynamic `import()` inside a `try` that exits 1 with a
  diagnostic on rejection (left to the `unhandledRejection` guard the
  process would drain to exit 0 with no server listening). `crash-guards.ts`
  is the one dependency-free static import. Adding a static import defeats
  the design.
- **Every served `inputSchema` is strict, at every object level.** Tools are
  registered through `registerStrictToolkit`, never `McpServer.toolkit`
  (Effect's default decode is `onExcessProperty: "ignore"`, which strips a
  misspelled filter and runs a WIDER query — issues #200 / #243). The
  registrar rejects an unknown key with `Unrecognized parameter(s): …
  Accepted params: …` naming the level it was found at, including inside
  nested objects, array elements and the union branch a discriminant
  selects. `served-schema-strict.test.ts` walks every served schema for
  `additionalProperties: false` AND calls every tool with a bogus key and
  with only its documented params.
- **Every log line goes to stderr.** stdout is the JSON-RPC wire.
  `ServerLayer` provides `Logger.LogToStderr = true` and `main.ts` provides
  it again on the launched effect (a layer-build failure is reported outside
  the layer). Never `console.log` in a tool; the harness's
  `consoleLogSoFar` must stay empty.
- **The MCP process must survive a stray throw.** Never remove the crash
  guards in `main.ts` or collapse them into a bare `main().catch()`; a
  killed process deregisters every tool mid-session. A handler defect
  returns the `UnexpectedToolError` envelope rather than propagating.
- **`process` boundary.** `boundaries.test.ts` allows `process` references
  only in `bin.ts`, `main.ts`, `version.ts` and `tools/run-tests.ts`, and
  forbids importing `@vitest-agent/cli`, `@vitest-agent/plugin`,
  `@vitest-agent/reporter`, `@vitest-agent/ui`, `@modelcontextprotocol/sdk`,
  `@trpc/server` and `zod` anywhere under `src/`. Ambient input reaches a
  tool through `McpSession`, not `process.env`.
- **Effect Schema end to end.** Tool inputs (`parameters`), outputs
  (`success`) and prompt arguments are Effect `Schema` values; the served
  JSON Schema is generated from them. There is no second schema language
  to keep in sync.
- **Tool output conventions:** meta, read-only and discovery tools render
  markdown through `RenderText` / `OutputRenderer`; `run_tests` returns the
  typed report plus a markdown headline; `note` `list` / `search` return
  markdown, the other actions JSON. `structuredContent` is always the
  encoded `success` value — an undeclared result key is STRIPPED by the
  encoder, so a marker like `_idempotentReplay` must be declared on the
  success schema.
- **One toolkit, one allowlist.** New tools register in `toolkit.ts`
  (`Kit` + `toolHandlers`). The Claude Code plugin's allowlist
  (`plugins/claude-code/hooks/lib/safe-mcp-vitest-agent-ops.txt`) must
  also be updated for auto-allow to work without a permission prompt.
- **Prompts are framing-only.** Each factory returns templated user
  messages that orient the agent toward the right tools and MUST NOT call
  `DataReader` / `DataStore`; `prompts/layer.ts` only adds the wire
  adapter. `tdd-resume`'s session default is the one server-side input.
- **`run_tests` runs Vitest in-process via `createVitest`** and blocks the
  server for the run's duration (Decision 21). Resolve `vitest/node` from
  the run's root, never from this package (Decision 55; issue #303).

## When working in this package

- Adding a tool: create `tools/<name>.ts` with the parameters / success
  Schemas, the `Tool.make("<name>", { description, parameters, success,
  dependencies })` value (annotate `Tool.Title`, `Tool.Readonly`,
  `Tool.Destructive`, `Tool.OpenWorld`, `Tool.Idempotent`, and `RenderText`
  for a markdown text channel) and the `handle<Name>` Effect; add both to
  `toolkit.ts`; add the name to the plugin's
  `safe-mcp-vitest-agent-ops.txt` (omit destructive tools so they prompt;
  consider `pre-tool-use/tdd-restricted.sh` if the TDD orchestrator must
  not call it); extend `served-schema-strict.test.ts`'s case list; update
  `tools/help.ts`. Wrap a write handler in `withIdempotency("<name>", handler)`
  and register its key in `idempotency.ts` when a replay must be safe. For
  tools surfacing the five TDD tagged errors use `_tdd-error-envelope.ts`.
- Adding a prompt: create `prompts/<slug>.ts` exporting a pure factory, then
  add an `McpServer.prompt({...})` to `prompts/layer.ts` with string-based
  parameters (`Schema.optionalKey` for optional args) and extend
  `prompts-layer.test.ts`'s expected name list.
- Testing tools: `__test__/utils/harness.ts` builds the REAL `ServerLayer`
  over `Stdio.layerTest` queues — no child process — so a test sees the
  exact served schemas and wire results. Use `listTools` / `callTool` /
  `sendRequest` (`prompts/list`, `prompts/get`), `seed` to populate the
  same in-memory store the server reads, and `session` to pin an
  `McpSession` (a fixture `cwd`, a recovered context). For handler-level
  assertions with full type narrowing, `__test__/utils/caller.ts`'s
  `makeCaller(runtime, session?)` decodes params through the tool's schema
  and invokes `toolHandlers[name]` directly (`tool-handlers.test.ts`).
  Crash-guard behavior needs the real spawned bin
  (`bin-crash-resilience.e2e.test.ts`, `server-lifecycle.e2e.test.ts` via
  `utils/mcp-process.ts`) — rebuild `dist/dev` first.
- Served enums come from the tool cores: every consolidated tool exports
  its discriminant tuple (`TEST_ACTIONS`, `INVENTORY_KINDS`, `NOTE_ACTIONS`,
  `HYPOTHESIS_ACTIONS`, `TDD_TASK_ACTIONS`, `TDD_GOAL_ACTIONS`,
  `TDD_BEHAVIOR_ACTIONS`) and `served-enum-drift.test.ts` asserts the served
  `oneOf` members match it. Add a variant to the tuple and the `Match`
  branch together.
- `projectDir` resolution: the plugin loader sets
  `VITEST_AGENT_REPORTER_PROJECT_DIR` because Claude Code does not reliably
  propagate `CLAUDE_PROJECT_DIR` to MCP subprocesses. Don't drop the env
  var fallback.
- The consolidated `inventory` tool (`kind: project|module|suite|session|tag`)
  and `test` tool (`action: list|get|for_file|for_tag|annotations|artifacts`)
  enumerate every project from `getRunsByProject()` when `project` is
  unspecified. Don't default to a literal `"default"`.
- `test_coverage` renders two distinct bars from `getCoverage`: the enforced
  Vitest `thresholds` (build-blocking) and, when present, the aspirational
  `coverageTargets`.
- `run_tests` returns `scopedNote` (nullable) alongside the report and
  appends it to the markdown for a partial run, so an agent never reads
  scoped coverage as whole-project coverage.
- Narrowing history: push `testName` / `modulePath` / `limit` into
  `DataReader.getHistory` (and `getFlaky` / `getPersistentFailures`) instead
  of fetching a project and filtering in the tool. `fullName` is not
  file-qualified (Decision D20).
- If `dbPath` resolution fails at boot, the server must not start — `main.ts`
  writes the diagnostic to stderr and exits 1 so the loader can print
  install instructions.

## Design references

- `@./.claude/design/vitest-agent/components/mcp.md`
  Load when working on tool implementations, the strict registrar, or
  prompts.
- `@./.claude/design/vitest-agent/data-flows.md`
  Load when tracing MCP runtime flows (Flow 4: tool dispatch; Flow 7:
  idempotency).
- `@./.claude/design/vitest-agent/schemas.md`
  Load when working with tool input/output shapes, the idempotency
  registry, or the TDD goal/behavior tables.
- `@./.claude/design/vitest-agent/decisions.md`
  Load for rationale (D35 prompts, the idempotency combinator, Decisions
  21 / 54 / 55 / 56 for `run_tests`).

## Action-keyed tool surface

Per-CRUD families collapse into single action-keyed tools that dispatch
via `Match.discriminatorsExhaustive` on an `action` (or `kind`)
discriminator: `hypothesis`, `note`, `inventory`, `test`, `tdd_task`,
`tdd_goal`, and `tdd_behavior`. The `tdd_task` actions replace the
`tdd_session_*` family (the underlying SQLite columns retain the
`tdd_tasks` naming). The `help` tool surfaces these groupings to
clients; for the per-tool variant inventory, load `components/mcp.md`.

**`register_agent`** wraps `DataStore.registerAgent`. Validates that
`agentType` begins with `${hostKind}-`. Returns
`{ ok: true, agentId, conversationId, idempotencyKey }` on insert or
`{ ok: false, error: { code, ... } }` on the four documented codes:
`AGENT_ALREADY_REGISTERED` (carries `existingAgentId`),
`PARENT_AGENT_NOT_FOUND`, `SESSION_NOT_FOUND`,
`INVALID_AGENT_TYPE_PREFIX` (carries `expectedPrefix`).

**Session recovery.** The server recovers the host session at boot from
`process.env` (`VITEST_AGENT_CHAT_ID`, `_CONVERSATION_ID`,
`_MAIN_AGENT_ID` — written by the SessionStart hook to `CLAUDE_ENV_FILE`
and auto-sourced into the MCP child). Boot recovery loses both the
fresh-launch race and the `/reload-plugins` restart, so
`createSessionContextRef(initial, recover?)` also recovers lazily: the
first `get()` that finds a null context runs the engine's
`recoverSessionContextFromSessionEnv`, which reads the newest
`~/.claude/session-env/<chat_id>/vitest-agent-hook.sh` whose exports
match this server's `projectDir`, and caches the first non-null result.
`run_tests` mutates `process.env.VITEST_AGENT_*` from this ref before
calling `createVitest`, so the in-process reporter attributes the run to
the active agent.

**Idempotency** is a combinator, not middleware: `withIdempotency(path,
handler)(params)` looks up the registered key spec, replays a persisted
result (marking it `_idempotentReplay: true`) on a hit, and runs the
handler and persists on a miss. Registered paths: `hypothesis`
(validate), `tdd_task` (start/end), `tdd_goal` (create), `tdd_behavior`
(create). Key derivation considers the `action` discriminator first.

## Tag filtering and tag introspection

The `run_tests` tool's input carries a structured `tags` filter
(`{ all?, any?, none? }`) and a per-call `passWithNoTests` override.
The three sub-filters AND together with each other and with `project` /
`files`; `none` covers all negation. The pure `composeTagExpression`
helper flattens a `TagFilter` to Vitest's native tag expression
(`"int and slow"` for `all`, `"(unit or int)"` for `any` with 2+
entries, `"not slow and not flaky"` for `none`, three joined by
` and `). Returns `null` when every sub-filter is empty.

`RunTestsResult` carries a `kind: "no-match"` discriminator variant,
emitted after `vitest.start` when `testModules.length === 0` AND
`unhandledErrors.length === 0` AND any filter (`files`, `project`, or
`tags`) was supplied. Detection is filter-driven, not result-driven;
`passWithNoTests` policy never reshapes the discriminator. The variant
carries the resolved filter context (`project`, `files`, `tags`, plus the
composed `resolvedExpression` string) verbatim so the agent can decide
whether to broaden the filter or treat the empty set as a finding.
`sanitizeTestArgs` covers tag values with the same `FORBIDDEN_CHARS` regex
it applies to `files` and `project`.

`RunTestsOk.scope` is the positive counterpart to `no-match`: the
resolved `{ project, files, tags }` echoed back on success.

No new `AgentPluginOptions` field for `passWithNoTests`. The plugin reads
Vitest's native `test.passWithNoTests` from the resolved config at
`configureVitest` time and threads it onto
`ResolvedReporterConfig.passWithNoTests`. The `run_tests` per-call
override wins for that invocation only.
