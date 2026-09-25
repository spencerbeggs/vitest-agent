# @vitest-agent/mcp

The Model Context Protocol server (`vitest-agent-mcp` bin) exposing the action-keyed tool surface to LLM agents over stdio. Built on Effect's native `McpServer` (`effect/unstable/ai`) through the `@effected/mcp` front-end kit: the 30 tools (23 `Tool.make`, seven union-parameter `Tool.dynamic`) are assembled into one `Toolkit`, registered strict-by-default with `McpToolkit.layer`, and served alongside six framing-only prompts as a single Effect `Layer` over `McpStdio.layer`. There is no MCP SDK, no tRPC and no zod — the wire protocol, JSON Schema generation and input validation all come from `effect`. A regular `dependency` of the plugin package, so every plugin consumer installs it. It stays a separate package for module-boundary clarity and an independent tool-surface release cadence.

## Layout

```text
src/
  bin.ts              -- bin entry: `void main()`, nothing else
  main.ts             -- the assembled program that OWNS the process:
                         main(options?: MainOptions { distribution? }),
                         McpGuard.run (crash guards) whose load() does
                         projectDir / dbPath resolution, boot-time session
                         recovery, PlatformLive (engine),
                         CurrentDistribution and NodeStdio, returning the
                         layer + NodeRuntime.runMain for the guard to
                         launch under McpStdio.launch / McpStdio.teardown. Every `process`
                         read for the server lives here. Published as the
                         `./main` subpath so the plugin can ship the same bin
  index.ts            -- programmatic barrel; never imports main.ts
  server.ts           -- ServerLayer({ version }): McpToolkit.layer(Kit)
                         + PromptsLayer over McpStdio.layer (LogToStderr,
                         the stdin guard, McpStdio.protocols)
  toolkit.ts          -- Kit = Toolkit.make(<30 tools>); toolHandlers (the
                         30-entry handler record, `satisfies HandlersFrom`;
                         the seven union tools wrapped in
                         McpToolkit.unionHandler);
                         ToolsLayer = Kit.toLayer(toolHandlers)
  session.ts          -- McpSession service: { cwd, currentSessionId,
                         sessionContext }; createCurrentSessionIdRef,
                         createSessionContextRef(initial, recover?),
                         sessionContextFromEnv(env); layer / layerTest
  idempotency.ts      -- idempotencyKeys registry (hypothesis, tdd_task,
                         tdd_goal, tdd_behavior) + the withIdempotency
                         combinator write handlers wrap themselves in
  annotations.ts      -- RenderText: deprecated no-op (#487); nothing
                         reads it, removed at the next major
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
    safe-format-fatal-error.ts -- never-throwing fatal formatter for main.ts
    replay-marker.ts  -- the `_idempotentReplay` marker schema
  version.ts          -- CURRENT_MCP_VERSION (build-time literal)
```

## Key files

| File | Purpose |
| ---- | ------- |
| `main.ts` | `main(options?: MainOptions)` is `McpGuard.run` (`@effected/mcp/guard`, label `vitest-agent-mcp`, policy `{ onUncaught: "exitBeforeConnect", onRejection: "log" }`, `format: safeFormatFatalError`): the guards are registered FIRST, then `load()` dynamically imports everything else (see Conventions). `resolveProjectDir` (engine, over `LaunchContext.projectDir`) precedence: `VITEST_AGENT_PROJECT_DIR` -> `VITEST_AGENT_REPORTER_PROJECT_DIR` -> `CLAUDE_PROJECT_DIR` -> cwd; the optional argv chat-id seed drops a `LaunchContext.isUnsubstituted` placeholder. Builds `McpSession.layer` from `sessionContextFromEnv(process.env)` plus the engine's lazy `recoverSessionContextFromSessionEnv` thunk, provides `PlatformLive({ dbPath, env, ... })`, `CurrentDistribution` (from `options.distribution`; the carrier's shim passes `@vitest-agent/plugin` and its version) and `NodeStdio.layer`, and returns `{ layer: Main, runMain: NodeRuntime.runMain }`; the guard launches it with `McpStdio.launch` / `McpStdio.teardown` (launch failures reported on stderr; stdin EOF exits 0; a `load()` rejection is `startup failed`, exit 1). Passes the env-gated `VITEST_AGENT_MCP_TEST_INJECT_CRASH` as the guard's `injectCrashAfterConnect` (`[injected] <kind>` on a `setTimeout(0)` once serving) for the spawned-bin e2e suite |
| `server.ts` | `ServerLayer({ version })` and `SERVER_INSTRUCTIONS`. `McpStdio.layer` serves `McpStdio.protocols` (`[v2026_07_28, v2025_11_25, v2025_06_18]`: the stateless adapter first, then the two newest stateful ones — pinned in `server-protocols.test.ts`), provides `LogToStderr`, and answers a malformed stdin line with `-32700` / `-32600` instead of wedging. `instructions` (agent orientation, surfaced in both `initialize` and `server/discover`) is `SERVER_INSTRUCTIONS`; `serverInfo.description` is the one-line human summary |
| `tools/<union tool>.ts` | A top-level union can be neither a `Tool.make` `parameters` schema (core dies at registration) nor an `outputSchema` root (the stateful revisions drop it). The seven action-keyed tools are `McpToolkit.unionTool(name, { description, parameters, success, failure: ToolRefusal })` (a `Tool.dynamic` served with Effect's strict document for the union, object-rooted to `oneOf` + `x-discriminator`, byte-identical to the pre-kit served schema — pinned in `union-tools-wire.test.ts`); declare services with `.addDependency`. `toolkit.ts` wraps each handler in `McpToolkit.unionHandler(tool, handler)`. `McpToolkit.layer` rejects an unknown key (named per level) or a bad value as `InvalidParams`: JSON-RPC `-32602` on `2025-06-18`, `isError` on the later revisions, like any `Tool.make` tool. Every union success schema is wrapped in `ToolOutputSchema.objectRooted` (order against `.annotate({ identifier })` does not matter) |
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

## Conventions

- **`main.ts` carries NO static imports of the server graph.** The crash
  guards must be registered before `NodeRuntime`, the engine platform or
  `ServerLayer` are evaluated, so a throw during module evaluation is
  still reported on stderr instead of crashing silently. Everything after
  the guards is a dynamic `import()` inside `McpGuard.run`'s `load`, whose
  rejection the guard reports as `startup failed` and exits 1 (left to the
  log-only `unhandledRejection` guard the process would drain to exit 0
  with no server listening). `@effected/mcp/guard` is the one static
  import: it has no static runtime imports of its own (the launch half is
  a dynamic chunk). Adding a static import defeats the design.
- **Every served `inputSchema` is strict, at every object level.** Tools are
  registered through `McpToolkit.layer` (strict `"all"` by default), never
  `McpServer.toolkit` (Effect's default decode is `onExcessProperty:
  "ignore"`, which strips a misspelled filter and runs a WIDER query —
  issues #200 / #243). An unknown key is rejected with `Unrecognized
  parameter(s): …. Accepted params: ….` naming the level it was found at,
  including inside nested objects, array elements and the union branch a
  discriminant selects — by `McpToolkit`'s pre-check for a `Tool.make` tool,
  by the same decorator re-decoding the union for a `McpToolkit.unionTool`.
  `served-schema-strict.test.ts` walks every served schema for
  `additionalProperties: false`, runs `McpToolAudit` (object-rooted
  `outputSchema`, title and hints on every tool) on both revisions, AND
  calls every tool with a bogus key and with only its documented params.
- **Union shapes go through the kit.** A new action-keyed tool uses
  `McpToolkit.unionTool` + `McpToolkit.unionHandler`; a new union success
  schema is wrapped in `ToolOutputSchema.objectRooted` so its `outputSchema`
  is served.
- **Every log line goes to stderr.** stdout is the JSON-RPC wire.
  `McpStdio.layer` provides `LogToStderr` to everything it provides and
  `McpStdio.launch` provides it around the whole launch (a layer-build
  failure is reported outside the layer). Never `console.log` in a tool; the
  harness's `consoleLogSoFar` must stay empty, and `McpHarness` dies the
  wait on any stdout line that is not JSON-RPC.
- **The MCP process must survive a stray throw.** Never remove the
  `McpGuard.run` in `main.ts`, loosen its policy, or collapse it into a bare
  `main().catch()`; a
  killed process deregisters every tool mid-session. A handler defect
  becomes core's scrubbed `isError` text (`Tool execution failed due to an
  internal server error.`) with the cause logged on stderr — so a failure
  the agent must act on belongs in the success shape (`ok: false` /
  `kind: "error"`) where the tool has one, else a declared `ToolRefusal`
  (`ToolRefusal.refuse(reason, remediation)` from `@effected/mcp`, the
  `@effected/engine` `Remediation` folded into the message by
  `ToolFailure.message`; the union tools declare it), never a defect.
  `hypothesis` (unknown `tddTaskId` / `sessionId` / hypothesis id, no
  session) and `tdd_task` `start` (unknown `sessionId` / `chatId`, neither,
  blank `runId`) refuse this way; pinned in `tools-write.test.ts`.
- **Source boundary.** `boundaries.test.ts` runs `SourceBoundary.scan`
  (`@effected/workspaces/testing`, with `verifyFixtures`): `process` reads
  only in `main.ts` and `tools/run-tests.ts`, the build-time
  `process.env.__PACKAGE_VERSION__` token only in `version.ts` (a
  `forbidTokens` rule waived for that one file), `stdout.write` only in `tools/run-tests.ts` (its
  per-run stdout sink), no `console` stdout methods, and no import of
  `@vitest-agent/cli`, `@vitest-agent/plugin`, `@vitest-agent/reporter`,
  `@vitest-agent/ui`, `@modelcontextprotocol/sdk`, `@trpc/server` or `zod`
  under `src/`; the exact waived set is asserted. Ambient input reaches a
  tool through `McpSession`, not `process.env`.
- **Effect Schema end to end.** Tool inputs (`parameters`), outputs
  (`success`) and prompt arguments are Effect `Schema` values; the served
  JSON Schema is generated from them. There is no second schema language
  to keep in sync.
- **Tool output conventions:** `structuredContent` is always the encoded
  `success` value — the one channel agents read (Claude Code forwards only
  `structuredContent` when present, Effect-TS/effect#8316). Core also puts
  the same JSON in `content[0].text`; never document or rely on it. Put
  anything the agent must read in a declared result field.
  The encoded `success` value is what ships — an undeclared result key is STRIPPED by the
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
  dependencies })` value — or `McpToolkit.unionTool(...)` plus
  `.addDependency` for a union `parameters`, wrapped in
  `McpToolkit.unionHandler` in `toolkit.ts` —
  (annotate `Tool.Title`, `Tool.Readonly`, `Tool.Destructive`,
  `Tool.OpenWorld`, `Tool.Idempotent`; `Tool.Strict` is implied by
  `McpToolkit.layer`) and the `handle<Name>` Effect; add both to
  `toolkit.ts`; add the name to the plugin's
  `safe-mcp-vitest-agent-ops.txt` (omit destructive tools so they prompt;
  consider `pre-tool-use/tdd-restricted.sh` if the TDD orchestrator must
  not call it); extend `served-schema-strict.test.ts`'s case list; update
  `tools/help.ts` — `help-drift.test.ts` pins the `help` text to the served
  toolkit and prompt layer, so a new tool or prompt that `help` does not
  mention fails that test until it does. Wrap a write handler in `withIdempotency("<name>", handler)`
  and register its key in `idempotency.ts` when a replay must be safe. For
  tools surfacing the five TDD tagged errors use `_tdd-error-envelope.ts`.
- Adding a prompt: create `prompts/<slug>.ts` exporting a pure factory, then
  add an `McpServer.prompt({...})` to `prompts/layer.ts` with string-based
  parameters (`Schema.optionalKey` for optional args) and extend
  `prompts-layer.test.ts`'s expected name list.
- Testing tools: `__test__/utils/harness.ts` wraps `@effected/mcp/testing`'s
  `McpHarness` over the REAL `ServerLayer` — no child process — so a test
  sees the exact served schemas and wire results. Use `listTools` /
  `callTool` / `sendRequest` (`prompts/list`, `prompts/get`) /
  `awaitNotification`, `protocol` / `stateless` to pick the revision, `seed`
  to populate the same in-memory store the server reads, `session` to pin an
  `McpSession` (a fixture `cwd`, a recovered context), and `distribution` to
  provide `CurrentDistribution`. For handler-level
  assertions with full type narrowing, `__test__/utils/caller.ts`'s
  `makeCaller(runtime, session?)` decodes params through the tool's schema
  and invokes `toolHandlers[name]` directly (`tool-handlers.test.ts`).
  Crash-guard behavior needs the real spawned bin
  (`bin-crash-resilience.e2e.test.ts`, `server-lifecycle.e2e.test.ts` via
  `utils/mcp-process.ts`, over the kit's `McpProcess`) — rebuild `dist/dev`
  first.
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
- `test_coverage` passes `getCoverage` through unchanged: the enforced
  Vitest `thresholds` (build-blocking) and the aspirational
  `coverageTargets` are distinct fields (`thresholds` / `lowCoverage` vs
  `targets` / `belowTarget`; the split is pinned in the engine's
  `DataReaderLive.test.ts`).
- `run_tests` returns `scopedNote` (nullable) alongside the report for a
  partial run, so an agent never reads scoped coverage as whole-project
  coverage.
- Narrowing history: push `testName` / `modulePath` / `limit` into
  `DataReader.getHistory` (and `getFlaky` / `getPersistentFailures`) instead
  of fetching a project and filtering in the tool. `fullName` is not
  file-qualified (Decision D20).
- If `dbPath` resolution fails at boot, the server must not start — `main.ts`
  writes the diagnostic to stderr and exits 1 so the loader can print
  install instructions.

## Design references

- [`../../okf/modules/mcp.md`](../../okf/modules/mcp.md)
  Load when working on tool implementations, strict registration,
  prompts, or `run_tests` (which runs `createVitest` in-process now, not
  `spawnSync`).
- [`../../okf/interfaces/mcp-tools.md`](../../okf/interfaces/mcp-tools.md)
  Load when tracing tool dispatch or idempotency, or working with tool
  input/output shapes.
- [`../../okf/models/sqlite-schema.md`](../../okf/models/sqlite-schema.md)
  Load when working with the idempotency registry or the TDD goal/behavior
  tables.
- [`../../okf/decisions/35-framing-only-mcp-prompts.md`](../../okf/decisions/35-framing-only-mcp-prompts.md),
  [`../../okf/decisions/71-effect-native-mcp-server.md`](../../okf/decisions/71-effect-native-mcp-server.md)
  Load for rationale on the framing-only prompts and the Effect-native
  server rebuild (no MCP SDK, tRPC, or zod).
- [`../../okf/decisions/72-adopt-the-effected-front-end-kit.md`](../../okf/decisions/72-adopt-the-effected-front-end-kit.md)
  Load for why the server runs on `@effected/mcp` (`McpToolkit` +
  `McpStdio`), why the union tools are `Tool.dynamic`, and the failure
  shapes (`ToolRefusal`, scrubbed internal errors).

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
