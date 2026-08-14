# @vitest-agent/mcp

The Model Context Protocol server (`vitest-agent-mcp` bin) exposing the action-keyed tool surface to LLM agents over stdio via `@modelcontextprotocol/sdk`. Routes tool calls through a tRPC router; runs as a long-lived process with a `ManagedRuntime`. Also surfaces six framing-only prompts registered directly with the MCP SDK alongside the tRPC tool router. A regular `dependency` of the plugin package, so every plugin consumer installs it. It stays a separate package for module-boundary clarity and an independent tool-surface release cadence — not for install-cost reasons (the MCP SDK + tRPC + zod footprint ships with every plugin install).

## Layout

```text
src/
  bin.ts              -- bin entry: registers the module-scope
                         unhandledRejection / uncaughtException guards,
                         resolves projectDir, dbPath, builds
                         ManagedRuntime.make(McpLive(dbPath, ...)), wires
                         the session refs (with the lazy recover thunk
                         from session-env.ts), calls startMcpServer(ctx)
  index.ts            -- programmatic entry; also exports buildMcpServer,
                         parseSessionEnvExports,
                         recoverSessionContextFromSessionEnv
  context.ts          -- tRPC McpContext: { runtime, cwd,
                         currentSessionId, sessionContext };
                         createSessionContextRef(initial, recover?)
  session-env.ts      -- lazy call-time SessionContext recovery: reads
                         the newest ~/.claude/session-env/<chat_id>/
                         vitest-agent-hook.sh whose exports match this
                         server's projectDir
  router.ts           -- tRPC router aggregating all tool procedures
  server.ts           -- buildMcpServer(): constructs the server and
                         registers all tools (every inputSchema wrapped
                         by the local strict() helper), then
                         registerAllPrompts, transport-free
                         (served-schema tests); also shadows the
                         instance's registerTool to catch resolver
                         throws; startMcpServer(): buildMcpServer +
                         connects a StdioServerTransport
  tools/              -- tool implementations (see design docs for the
                         full inventory); plus the private
                         _tdd-error-envelope.ts helper. Per-CRUD families
                         (`tdd_task`, `tdd_goal`, `tdd_behavior`, `note`,
                         `hypothesis`, `inventory`, `test`) live in one
                         file per family and dispatch on an `action`
                         (or `kind`) discriminator via
                         `Match.discriminatorsExhaustive`. The 1.x
                         decompose-goal-into-behaviors tool was removed
                         in 2.0
  prompts/            -- six framing-only prompts:
    index.ts          -- registerAllPrompts(server); wires zod arg
                         schemas + factory functions + a toMessages
                         adapter that narrows user-only message shape
                         to SDK-permitted role: "user" | "assistant"
    triage.ts, why-flaky.ts, regression-since-pass.ts,
    explain-failure.ts, tdd-resume.ts, wrapup.ts -- one file per prompt
  middleware/
    idempotency.ts    -- idempotentProcedure drop-in + idempotencyKeys
                         registry (5 entries: hypothesis, tdd_task,
                         tdd_goal, tdd_behavior, plus the
                         _legacy_hypothesis_validate compat shim).
                         Key derivation considers the `action`
                         discriminator first
  utils/
    crash-guards.ts   -- pure shouldExitOnUncaughtException(connected):
                         exit before the transport connects, survive after
    tool-error-envelope.ts -- buildUnexpectedToolErrorEnvelope(tool, err):
                         success-shape { ok: false, error: {
                         _tag: "UnexpectedToolError", ... } } + isError
  layers/
    McpLive.ts        -- (dbPath, logLevel?, logFile?) composition:
                         DataReader + DataStore + ProjectDiscovery +
                         OutputPipeline + SqliteClient + Migrator +
                         NodeServices + Logger
```

## Key files

| File | Purpose |
| ---- | ------- |
| `bin.ts` | `resolveProjectDir()` precedence: `VITEST_AGENT_REPORTER_PROJECT_DIR` -> `CLAUDE_PROJECT_DIR` -> `process.cwd()`. Resolves `dbPath` via `resolveDataPath(projectDir)` then constructs the `ManagedRuntime`. Registers `unhandledRejection` / `uncaughtException` handlers at module scope (before any async work) so a stray rejection cannot silently kill a live session; the exit-vs-survive judgment lives in `utils/crash-guards.ts`. Also carries the env-gated fires-once crash injector `VITEST_AGENT_MCP_TEST_INJECT_CRASH` (`unhandledRejection` \| `uncaughtException`) that the spawned-bin e2e suite uses |
| `context.ts` | tRPC `McpContext` carrying the `ManagedRuntime` so procedures call `ctx.runtime.runPromise(effect)` |
| `router.ts` | Aggregates all tool procedures; testable via `createCallerFactory(appRouter)` without starting the MCP server |
| `tools/run-tests.ts` | In-process `createVitest` (`vitest/node`) + `localVitest.start()` with configurable timeout (default 120s); overrides `coverage.reportsDirectory` with a per-invocation `mkdtemp` dir (removed in `finally`) so concurrent runs don't `rm -rf` each other's coverage `.tmp` files — everything else about coverage still comes from the user's config, and MCP consumers read coverage from SQLite, not disk artifacts; builds the `AgentReport` from `result.testModules` and folds `consoleLeaks` from the post-run `state.getFiles()` task-tree walk. `RunTestsOk` carries `scope: { project, files, tags }` — the resolved filter set echoed verbatim, so an agent can tell "ran exactly what I asked" from "a dropped param ran everything" — plus `discoveryLastScannedAt: string \| null`, read via the internal `readDiscoveryLastScannedAt()` helper from the `Symbol.for("vitest-agent:discovery:last-scan-at")` process-global the plugin's `discoverProjects()` writes (issue #100 — mcp cannot import the plugin, so the shared symbol slot is the handshake) |
| `tools/history.ts` | `test_history` — accepts optional `testName` / `modulePath` / `limit` alongside `project` and forwards them to `DataReader.getHistory`'s `HistoryQueryOptions`. `limit` caps runs kept **per test** (default 20), not total rows |
| `utils/crash-guards.ts` | Pure `shouldExitOnUncaughtException(transportConnected)`: exit while no client session exists, survive after connect. The one place the departure from Node's "do not resume" guidance is stated and tested |
| `utils/tool-error-envelope.ts` | `buildUnexpectedToolErrorEnvelope(tool, err)` — the `{ ok: false, error: { _tag: "UnexpectedToolError", tool, message, remediation } }` success-shape returned with `isError: true` when a resolver throws. Coerces the thrown value defensively (a getter-backed `.message` can itself throw) |
| `tools/note.ts` | Single action-keyed tool covering all six note operations (`create`/`list`/`get`/`update`/`delete`/`search`) via the `action` discriminator |
| `tools/tdd-task.ts` | Action-keyed `tdd_task` tool with `start`/`end`/`get`/`resume` (replaces the 1.x `tdd_session_*` family; the underlying SQLite columns retain the `tdd_tasks` naming). `start` and `end` are idempotent via the middleware registry |
| `tools/tdd-goal.ts`, `tools/tdd-behavior.ts` | Action-keyed CRUD for the Objective→Goal→Behavior hierarchy. `create` actions are idempotent on `(sessionId, goal)` / `(goalId, behavior)`. The `delete` action is denied to the orchestrator at the plugin's `pre-tool-use/tdd-restricted.sh` hook (the `tool_input.action` matcher); the consolidated tools are listed in `safe-mcp-vitest-agent-ops.txt` so non-delete actions auto-allow |
| `tools/tdd-artifact.ts` | `tdd_artifact_list` (read-only listing). Artifact writes happen only via the plugin's `post-tool-use/tdd-artifact.sh` hook calling the CLI |
| `tools/hypothesis.ts` | Action-keyed `hypothesis` tool. `record` resolves the binding session server-side with precedence: `tddTaskId` (deterministic — the session the task was opened under, via `DataReader.getSessionByTddTaskId`; accepts a number or numeric string, and an unknown id is a hard typed failure) → recovered host context (main session → active subagent child) → caller `sessionId` only when no host context is recovered (dev/tests). The MCP-SDK-side registration in `server.ts` must declare AND forward `tddTaskId` — it is hand-synced with this tRPC input |
| `tools/register-agent.ts` | Wraps `DataStore.registerAgent`; validates `agentType` prefix; returns the documented success / `{ ok: false, error: { code } }` envelope |
| `tools/_tdd-error-envelope.ts` | Private 2.0 helper that catches the five tagged TDD errors (`GoalNotFoundError`, `BehaviorNotFoundError`, `TddTaskNotFoundError`, `TddTaskAlreadyEndedError`, `IllegalStatusTransitionError`) and surfaces them as success-shape `{ ok: false, error: { _tag, ..., remediation } }` responses |
| `tools/tdd-phase-transition-request.ts` | 2.0: `goalId` is now required; the tool pre-checks goal status and behavior membership before running the D2 binding-rule validator. On accept with a `behaviorId`, auto-promotes the behavior `pending → in_progress` in the same SQL transaction as `writeTddPhase`. The validator also rejects `spike→green` and `refactor→green` with `wrong_source_phase` — the red phase must be entered explicitly first |

## Conventions

- **`ManagedRuntime`, not per-call `Effect.runPromise`.** The MCP
  server is long-lived; per-call layer construction would re-open
  SQLite on every tool invocation. tRPC procedures call
  `ctx.runtime.runPromise(effect)` against the shared runtime.
- **Every served `inputSchema` is strict.** Register tool inputs in
  `server.ts` through the local `strict(shape)` helper — never a bare
  zod raw shape. The helper wraps the shape in `z.strictObject` with an
  `unrecognized_keys` message naming the offending key AND the full
  accepted-param list, so a misspelled param fails loudly instead of
  being silently stripped and running a wider query than the agent
  asked for. The rule is all-or-nothing: `strict({})` for empty shapes
  (`acceptance_metrics`); only the four tools with no `inputSchema` at
  all (`help`, `cache_health`, `settings_list`, `ping`) stay bare.
- **The MCP process must survive a stray throw.** Never remove the
  module-scope crash guards in `bin.ts` or replace them with a bare
  `main().catch()`; a killed process deregisters every tool mid-session
  with no recovery path. Resolver throws return the
  `UnexpectedToolError` envelope rather than propagating.
- **Three external runtime deps unique here:**
  `@modelcontextprotocol/sdk`, `@trpc/server`, `zod`. zod is for
  tRPC tool input schemas only -- domain data structures still use
  Effect Schema (from `@vitest-agent/sdk`). Don't conflate the two.
- **Tool output conventions:**
  - Meta + read-only + discovery tools: return markdown via
    `OutputRenderer`.
  - `run_tests`: returns text (raw vitest output).
  - `note`: `list`/`search` actions return markdown;
    `create`/`get`/`update`/`delete` actions return JSON.
- **One router, one allowlist.** New tools register in `server.ts` AND
  `router.ts`. The Claude Code plugin's allowlist
  (`plugin/hooks/lib/safe-mcp-vitest-agent-ops.txt`) must
  also be updated for auto-allow to work without a permission prompt.
  Destructive `delete` actions on `tdd_goal` / `tdd_behavior` are
  denied to the orchestrator at the runtime hook layer
  (`pre-tool-use/tdd-restricted.sh` matches the tool name and reads
  `tool_input.action`); main-agent `delete` calls fall through to the
  standard permission prompt.
- **Prompts use the SDK's native APIs, not tRPC.** tRPC owns the tool
  surface; prompts go through `server.registerPrompt`. Both surfaces
  share the same `McpServer` instance, the same stdio transport, and
  the same process. Don't try to bridge prompts through the tRPC
  router.
- **Prompts are framing-only.** Each prompt's factory returns
  templated user messages that orient the agent toward the right
  tools. The factories MUST NOT call into `DataReader` /
  `DataStore` to pre-fetch tool data on the server — selection
  cost is zero tool roundtrips by design, and the agent fetches
  data via tools after the prompt orients it.
- **`run_tests` runs Vitest in-process via `createVitest`.** It imports
  `createVitest` from `vitest/node`, awaits `localVitest.start(...)`, and
  reads results (including `localVitest.state.getFiles()`, which the
  `consoleLeaks` task-tree walk depends on) before the call returns. The
  in-process run blocks the MCP server for its duration; this is acceptable
  because agents wait for results before proceeding. See Decision 21.

## When working in this package

- `projectDir` resolution: the plugin loader sets
  `VITEST_AGENT_REPORTER_PROJECT_DIR` because Claude Code does not
  reliably propagate `CLAUDE_PROJECT_DIR` to MCP subprocesses. Don't
  drop the env var fallback.
- Adding a tool: define a tRPC procedure in `tools/<name>.ts`, add
  to `router.ts`, register the SDK handler in `server.ts` with its
  `inputSchema` wrapped in `strict(...)` AND every declared field
  forwarded to the caller, update
  `tools/help.ts`'s tool list, and add the suffix to the plugin's
  `safe-mcp-vitest-agent-ops.txt` allowlist (omit destructive tools
  intentionally so they prompt; consider whether the new tool also
  needs a denial in `pre-tool-use/tdd-restricted.sh` if it should
  not be callable by the TDD orchestrator). For tools surfacing the
  five TDD tagged errors, use the `_tdd-error-envelope.ts` helper
  to wrap the catch.
- Testing tools: use `createCallerFactory(appRouter)` with a mock
  context. See `router.test.ts` and `tools/run-tests.test.ts` for
  the pattern -- don't start the MCP server in tests. To assert the
  *served* (MCP-SDK-side) tool schemas, connect `buildMcpServer(ctx)`
  to an `InMemoryTransport` pair instead — see
  `server-hypothesis-schema.test.ts`. The `server.ts` registrations
  are hand-synced with the tRPC inputs, and a missed sync (a field
  never declared or forwarded) is invisible to router-level tests —
  that is exactly how `run_tests`'s `tags` / `passWithNoTests` shipped
  unreachable (issue #200). `server-strict-schemas.test.ts` asserts
  twice per tool: a bogus key is rejected, and the same call without
  it is not — the second assertion guards against over-correcting into
  rejecting documented params. Crash-guard behavior needs a real
  spawned bin over stdio (`bin-crash-resilience.e2e.test.ts`); a unit
  test cannot safely crash its own process.
- Tool input validation uses zod (tRPC requirement). Keep zod
  schemas minimal -- they're just for argument shape, not domain
  validation. Domain validation happens in the underlying
  `DataReader`/`DataStore` calls.
- The consolidated `inventory` tool (`kind: project|module|suite|session`)
  and `test` tool (`action: list|get|for_file`) enumerate every project
  from `getRunsByProject()` when `project` is unspecified. Don't default
  to a literal `"default"` (post-2.0 bug fix).
- Narrowing history: push `testName` / `modulePath` / `limit` into
  `DataReader.getHistory` instead of fetching a project and filtering
  in the tool. `fullName` is not file-qualified (Decision D20), so a
  client-side `find` can match another module's same-named test — the
  `test({ action: "get" })` bug in issue #241.
- The MCP server's runtime is constructed once at startup. If
  `dbPath` resolution fails at boot, the server should not start --
  surface the error via stderr and exit non-zero so the loader can
  print install instructions.
- Adding a prompt: create `prompts/<slug>.ts` exporting a factory
  that returns one or more user-role messages. Add a zod arg schema
  and register the prompt in `prompts/index.ts`. Keep the factory
  pure — no `DataReader` / `DataStore` calls. If the prompt has a
  closed enum argument, mirror the pattern in `wrapup.ts` where the
  `WrapupKind` union is re-exported and the registrar coerces
  `args.kind` through it.

## Design references

- `@./.claude/design/vitest-agent/components/mcp.md`
  Load when working on tool implementations, the tRPC router, or prompts.
- `@./.claude/design/vitest-agent/data-flows.md`
  Load when tracing MCP runtime flows (Flow 4: MCP server / tRPC tool
  dispatch over `ManagedRuntime`; Flow 7: tRPC idempotency middleware).
- `@./.claude/design/vitest-agent/schemas.md`
  Load when working with tRPC tool input/output shapes, the idempotency
  registry, or the TDD goal/behavior tables.
- `@./.claude/design/vitest-agent/decisions.md`
  Load for rationale (especially D19 tRPC routing, D35 prompts, and the
  idempotency middleware).

## Action-keyed tool surface

Per-CRUD families collapse into single action-keyed tools that dispatch
via `Match.discriminatorsExhaustive` on an `action` (or `kind`)
discriminator: `hypothesis`, `note`, `inventory`, `test`, `tdd_task`,
`tdd_goal`, and `tdd_behavior`. The `tdd_task` actions replace the
`tdd_session_*` family (the underlying SQLite columns retain the
`tdd_tasks` naming). The `help` tool surfaces these groupings to
clients; for the per-tool variant inventory, load `components/mcp.md`.

**`register_agent`** wraps `DataStore.registerAgent`.
Validates that `agentType` begins with `${hostKind}-`. Returns
`{ ok: true, agentId, conversationId, idempotencyKey }` on insert or
`{ ok: false, error: { code, ... } }` on the four documented codes:
`AGENT_ALREADY_REGISTERED` (carries `existingAgentId`),
`PARENT_AGENT_NOT_FOUND`, `SESSION_NOT_FOUND`,
`INVALID_AGENT_TYPE_PREFIX` (carries `expectedPrefix`).

**Removed**: `set_current_session_id` and `get_current_session_id` (the
elicitation flow that depended on them is gone too). The MCP server
recovers the host session id at boot from `process.env`
(`VITEST_AGENT_CHAT_ID`, `_CONVERSATION_ID`, `_MAIN_AGENT_ID` —
written by SessionStart hook to `CLAUDE_ENV_FILE` and auto-sourced
into the MCP child). Boot recovery loses both the fresh-launch race
(the MCP child can spawn before SessionStart writes the env file) and
the `/reload-plugins` restart (fresh environment, no exports), so
`session-env.ts` also recovers lazily: at the first `get()` that
finds a null context it reads the newest
`~/.claude/session-env/<chat_id>/vitest-agent-hook.sh` whose exports
match this server's `projectDir`.

**`McpContext.sessionContext: SessionContextRef`** holds the recovered
context; `createSessionContextRef(initial, recover?)` invokes the
recover thunk while the held value is null and caches the first
non-null result. `run_tests` mutates `process.env.VITEST_AGENT_*` from
this ref before calling `createVitest`, so the in-process reporter
attributes the run to the active agent.

**Idempotency middleware** spec registry updated for the consolidated
procedure paths: `hypothesis` (record/validate), `tdd_task`
(start/end), `tdd_goal` (create), `tdd_behavior` (create). Key
derivation considers the `action` discriminator first.

## Tag filtering and tag introspection

The `run_tests` tool's input carries a structured `tags` filter
(`{ all?, any?, none? }`) and a per-call `passWithNoTests` override.
Both must stay declared in `server.ts` and forwarded to the caller —
they were tRPC-only until issue #200, so a real client's tag filter was
stripped and the run went wide.
The three sub-filters AND together with each other and with `project` /
`files`; `none` covers all negation. The pure `composeTagExpression`
helper flattens a `TagFilter` to Vitest's native tag expression
(`"int and slow"` for `all`, `"(unit or int)"` for `any` with 2+
entries, `"not slow and not flaky"` for `none`, three joined by
` and `). Returns `null` when every sub-filter is empty.

`RunTestsResult` carries a `kind: "no-match"` discriminator
variant. The MCP server emits `no-match` (rather than `ok` with an
empty report) after `vitest.start` when `testModules.length === 0`
AND `unhandledErrors.length === 0` AND any filter (`files`,
`project`, or `tags`) was supplied. Detection is filter-driven, not
result-driven; `passWithNoTests` policy never reshapes the
discriminator. The variant carries the resolved filter context
(`project`, `files`, `tags`, plus the composed `resolvedExpression`
string) verbatim so the agent can decide whether to broaden the
filter or treat the empty set as a finding. `sanitizeTestArgs`
covers tag values with the same `FORBIDDEN_CHARS` regex it applies
to `files` and `project`.

`RunTestsOk.scope` is the positive counterpart to `no-match`: the
resolved `{ project, files, tags }` echoed back on success.

No new `AgentPluginOptions` field for `passWithNoTests`. The plugin
reads Vitest's native `test.passWithNoTests` from the resolved
config at `configureVitest` time and threads it onto
`ResolvedReporterConfig.passWithNoTests`. The `run_tests` per-call
override wins for that invocation only.
