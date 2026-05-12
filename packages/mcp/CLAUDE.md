# vitest-agent-mcp

The Model Context Protocol server (`vitest-agent-mcp` bin)
exposing 29 tools to LLM agents over stdio via `@modelcontextprotocol/sdk`.
Routes tool calls through a tRPC router; runs as a long-lived process with
a `ManagedRuntime`. Also surfaces four MCP resources under two URI schemes
(vendored Vitest docs + curated patterns; per-page titles and
descriptions come from `manifest.json`, which the registrar's `list`
callback decodes via an Effect Schema) and six framing-only prompts
registered directly with the MCP SDK alongside the tRPC tool router.
Required as a peerDependency by the plugin package.

## Layout

```text
src/
  bin.ts              -- bin entry: resolves projectDir, dbPath, builds
                         ManagedRuntime.make(McpLive(dbPath, ...)),
                         calls startMcpServer({ runtime, cwd: projectDir })
  index.ts            -- programmatic entry
  context.ts          -- tRPC McpContext: { runtime, cwd }
  router.ts           -- tRPC router aggregating all 29 procedures
  server.ts           -- startMcpServer(): registers all tools, then
                         calls registerAllResources(server) and
                         registerAllPrompts(server) BEFORE constructing
                         StdioServerTransport
  tools/              -- 29 tool implementations (see design docs for the
                         full inventory); plus the private
                         _tdd-error-envelope.ts helper. Per-CRUD families
                         (`tdd_task`, `tdd_goal`, `tdd_behavior`, `note`,
                         `hypothesis`, `inventory`, `test`) live in one
                         file per family and dispatch on an `action`
                         (or `kind`) discriminator via
                         `Match.discriminatorsExhaustive`. The 1.x
                         decompose-goal-into-behaviors tool was removed
                         in 2.0
  resources/          -- four MCP resources surfaced under two URI schemes:
    index.ts          -- registerAllResources(server); resolves vendorRoot
                         and patternsRoot from import.meta.url so the
                         same code works in dev (sources at
                         packages/mcp/src/<vendor|patterns>/) and
                         post-build (mirrored to
                         dist/<env>/<vendor|patterns>/ by rslib's
                         copyPatterns). The vitest_docs_page
                         ResourceTemplate's list callback decodes
                         manifest.json via manifest-schema.ts and
                         emits per-page { name, uri, title,
                         description, mimeType } so MCP clients see
                         real titles and "load when" descriptions in
                         their resource picker
    manifest-schema.ts -- Effect Schema describing the manifest.json
                         shape: { tag, commitSha, capturedAt, source,
                         pages?: Array<{ path, title, description }> }
    paths.ts          -- resolveResourcePath: rejects null bytes,
                         absolute paths, and any resolved path that
                         escapes <root>. The security boundary -- ALWAYS
                         call this before any readFile in the readers
    upstream-docs.ts  -- vitest://docs/{+path} reader (vendored snapshot)
    patterns.ts       -- vitest-agent://patterns/{slug} reader
    indexes.ts        -- renderUpstreamIndex / renderPatternsIndex for
                         the two static index URIs (vitest://docs/
                         and vitest-agent://patterns/)
  vendor/vitest-docs/  -- vendored upstream Vitest docs snapshot
  patterns/           -- curated testing patterns library
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
  layers/
    McpLive.ts        -- (dbPath, logLevel?, logFile?) composition:
                         DataReader + DataStore + ProjectDiscovery +
                         OutputPipeline + SqliteClient + Migrator +
                         NodeContext + NodeFileSystem + Logger

lib/scripts/          -- snapshot-maintenance TS pipeline (fetch /
                         build / validate). Refresh via the
                         update-vitest-snapshot skill; see
                         components/mcp.md for script internals.
```

## Key files

| File | Purpose |
| ---- | ------- |
| `bin.ts` | `resolveProjectDir()` precedence: `VITEST_AGENT_REPORTER_PROJECT_DIR` -> `CLAUDE_PROJECT_DIR` -> `process.cwd()`. Resolves `dbPath` via `resolveDataPath(projectDir)` then constructs the `ManagedRuntime` |
| `context.ts` | tRPC `McpContext` carrying the `ManagedRuntime` so procedures call `ctx.runtime.runPromise(effect)` |
| `router.ts` | Aggregates all 29 tool procedures; testable via `createCallerFactory(appRouter)` without starting the MCP server |
| `tools/run-tests.ts` | `spawnSync("vitest run", ...)` with configurable timeout (default 120s) |
| `tools/note.ts` | Single action-keyed tool covering all six note operations (`create`/`list`/`get`/`update`/`delete`/`search`) via the `action` discriminator |
| `tools/tdd-task.ts` | Action-keyed `tdd_task` tool with `start`/`end`/`get`/`resume` (replaces the 1.x `tdd_session_*` family; the underlying SQLite columns retain the `tdd_tasks` naming). `start` and `end` are idempotent via the middleware registry |
| `tools/tdd-goal.ts`, `tools/tdd-behavior.ts` | Action-keyed CRUD for the Objective→Goal→Behavior hierarchy. `create` actions are idempotent on `(sessionId, goal)` / `(goalId, behavior)`. The `delete` action is denied to the orchestrator at the plugin's `pre-tool-use/tdd-restricted.sh` hook (the `tool_input.action` matcher); the consolidated tools are listed in `safe-mcp-vitest-agent-ops.txt` so non-delete actions auto-allow |
| `tools/tdd-artifact.ts` | `tdd_artifact_list` (read-only listing). Artifact writes happen only via the plugin's `post-tool-use/tdd-artifact.sh` hook calling the CLI |
| `tools/register-agent.ts` | Wraps `DataStore.registerAgent`; validates `agentType` prefix; returns the documented success / `{ ok: false, error: { code } }` envelope |
| `tools/_tdd-error-envelope.ts` | Private 2.0 helper that catches the five tagged TDD errors (`GoalNotFoundError`, `BehaviorNotFoundError`, `TddTaskNotFoundError`, `TddTaskAlreadyEndedError`, `IllegalStatusTransitionError`) and surfaces them as success-shape `{ ok: false, error: { _tag, ..., remediation } }` responses |
| `tools/tdd-phase-transition-request.ts` | 2.0: `goalId` is now required; the tool pre-checks goal status and behavior membership before running the D2 binding-rule validator. On accept with a `behaviorId`, auto-promotes the behavior `pending → in_progress` in the same SQL transaction as `writeTddPhase`. The validator also rejects `spike→green` and `refactor→green` with `wrong_source_phase` — the red phase must be entered explicitly first |

## Conventions

- **`ManagedRuntime`, not per-call `Effect.runPromise`.** The MCP
  server is long-lived; per-call layer construction would re-open
  SQLite on every tool invocation. tRPC procedures call
  `ctx.runtime.runPromise(effect)` against the shared runtime.
- **Three external runtime deps unique here:**
  `@modelcontextprotocol/sdk`, `@trpc/server`, `zod`. zod is for
  tRPC tool input schemas only -- domain data structures still use
  Effect Schema (from `vitest-agent-sdk`). Don't conflate the two.
- **Tool output conventions:**
  - Meta + read-only + discovery tools: return markdown via
    `OutputRenderer`.
  - `run_tests`: returns text (raw vitest output).
  - `note`: `list`/`search` actions return markdown;
    `create`/`get`/`update`/`delete` actions return JSON.
- **29 tools, 1 router.** New tools register in `server.ts` AND
  `router.ts`. The Claude Code plugin's allowlist
  (`plugin/hooks/lib/safe-mcp-vitest-agent-ops.txt`) must
  also be updated for auto-allow to work without a permission prompt.
  Destructive `delete` actions on `tdd_goal` / `tdd_behavior` are
  denied to the orchestrator at the runtime hook layer
  (`pre-tool-use/tdd-restricted.sh` matches the tool name and reads
  `tool_input.action`); main-agent `delete` calls fall through to the
  standard permission prompt.
- **Resources and prompts use the SDK's native APIs, not tRPC.**
  tRPC owns the tool surface; resources go through
  `server.registerResource` (with `ResourceTemplate` + `{ list:
  undefined }` for the page templates so the SDK doesn't enumerate
  every page on `resources/list` — the index URIs serve that role)
  and prompts go through `server.registerPrompt`. Both surfaces
  share the same `McpServer` instance, the same stdio transport,
  and the same process. Don't try to bridge resources/prompts
  through the tRPC router.
- **Two URI schemes for resources.** `vitest://` is vendored
  upstream content (provenance: vitest-dev/vitest at a pinned tag,
  MIT-licensed via `ATTRIBUTION.md`); `vitest-agent://` is content
  authored for this project. Splitting the schemes is load-bearing
  for licensing/provenance clarity — don't conflate them.
- **Prompts are framing-only.** Each prompt's factory returns
  templated user messages that orient the agent toward the right
  tools. The factories MUST NOT call into `DataReader` /
  `DataStore` to pre-fetch tool data on the server — selection
  cost is zero tool roundtrips by design, and the agent fetches
  data via tools after the prompt orients it.
- **Vendor snapshot is checked in.** The `src/vendor/vitest-docs/`
  tree ships in git. Don't fetch on demand at runtime — the MCP
  server often runs without network egress. The snapshot is
  refreshed through an explicit human action (the project-local
  `.claude/skills/update-vitest-snapshot/` skill + the
  `lib/scripts/` TS pipeline), not silently between server starts.
  Living under `src/` is load-bearing for turbo cache invalidation:
  refreshes correctly show up as build-affecting.
- **`fetch-upstream-docs.ts` uses `execFileSync` only.** The
  fetcher takes a tag argument and passes it to `git`. Building a
  shell command with `execSync` and string interpolation opens a
  shell-injection hole; the array-args form treats the tag verbatim
  as one argv element. The new TS script preserves this invariant
  inherited from the 1.x `update-vitest-snapshot.mjs`. Don't regress
  this when editing the script.
- **`run_tests` uses `spawnSync` deliberately.** The MCP server
  cannot process other tool requests during a test run; this is
  acceptable because agents wait for results before proceeding.
  See Decision 21.

## When working in this package

- `projectDir` resolution: the plugin loader sets
  `VITEST_AGENT_REPORTER_PROJECT_DIR` because Claude Code does not
  reliably propagate `CLAUDE_PROJECT_DIR` to MCP subprocesses. Don't
  drop the env var fallback.
- Adding a tool: define a tRPC procedure in `tools/<name>.ts`, add
  to `router.ts`, register the SDK handler in `server.ts`, update
  `tools/help.ts`'s tool list, and add the suffix to the plugin's
  `safe-mcp-vitest-agent-ops.txt` allowlist (omit destructive tools
  intentionally so they prompt; consider whether the new tool also
  needs a denial in `pre-tool-use/tdd-restricted.sh` if it should
  not be callable by the TDD orchestrator). For tools surfacing the
  five TDD tagged errors, use the `_tdd-error-envelope.ts` helper
  to wrap the catch.
- Testing tools: use `createCallerFactory(appRouter)` with a mock
  context. See `router.test.ts` and `tools/run-tests.test.ts` for
  the pattern -- don't start the MCP server in tests.
- Tool input validation uses zod (tRPC requirement). Keep zod
  schemas minimal -- they're just for argument shape, not domain
  validation. Domain validation happens in the underlying
  `DataReader`/`DataStore` calls.
- The consolidated `inventory` tool (`kind: project|module|suite|session`)
  and `test` tool (`action: list|get|for_file`) enumerate every project
  from `getRunsByProject()` when `project` is unspecified. Don't default
  to a literal `"default"` (post-2.0 bug fix).
- The MCP server's runtime is constructed once at startup. If
  `dbPath` resolution fails at boot, the server should not start --
  surface the error via stderr and exit non-zero so the loader can
  print install instructions.
- Vendor mirrors into `dist/<env>/` via `copyPatterns`; load
  `components/mcp.md` before adding a new content tree or
  build-pipeline change.
- Adding a prompt: create `prompts/<slug>.ts` exporting a factory
  that returns one or more user-role messages. Add a zod arg schema
  and register the prompt in `prompts/index.ts`. Keep the factory
  pure — no `DataReader` / `DataStore` calls. If the prompt has a
  closed enum argument, mirror the pattern in `wrapup.ts` where the
  `WrapupKind` union is re-exported and the registrar coerces
  `args.kind` through it.
- Refreshing the vendored Vitest docs: invoke the project-local
  `.claude/skills/update-vitest-snapshot/SKILL.md` skill, which
  walks through fetch → prune → scaffold → enrich → validate with
  explicit user checkpoints. Commit the rewritten
  `src/vendor/vitest-docs/` tree as a single change.

## Design references

- `@./.claude/design/vitest-agent/components/mcp.md`
  Load when working on tool implementations, the tRPC router, resources,
  prompts, or the vendor-snapshot pipeline.
- `@./.claude/design/vitest-agent/data-flows.md`
  Load when tracing MCP runtime flows (Flow 4: tRPC tool dispatch over
  `ManagedRuntime`; Flow 7: TDD goal/behavior + phase-transition flow).
- `@./.claude/design/vitest-agent/schemas.md`
  Load when working with tRPC tool input/output shapes, the idempotency
  registry, or the TDD goal/behavior tables.
- `@./.claude/design/vitest-agent/decisions.md`
  Load for rationale (especially D19 tRPC routing, D35 resources and
  prompts, and the idempotency middleware).

## Agent-agnostic taxonomy additions (Phase 3)

The MCP tool surface was consolidated. Per-CRUD families are now
single action-keyed tools that dispatch via
`Match.discriminatorsExhaustive("action")` (or `"kind"` for
`inventory`):

| Tool | Variants |
| ---- | -------- |
| `hypothesis` | `record`, `validate`, `list` |
| `note` | `create`, `list`, `get`, `update`, `delete`, `search` |
| `inventory` | `kind: project`, `kind: module`, `kind: suite`, `kind: session` (with optional `id` for single-row lookup) |
| `test` | `list`, `get`, `for_file` |
| `tdd_task` | `start`, `end`, `get`, `resume` (replaces `tdd_session_*`; the underlying SQLite columns retain the `tdd_tasks` naming) |
| `tdd_goal` | `create`, `update`, `delete`, `get`, `list` |
| `tdd_behavior` | `create`, `update`, `delete`, `get`, `list_by_goal`, `list_by_tdd_task` |

**`register_agent`** is a new tool that wraps `DataStore.registerAgent`.
Validates that `agentType` begins with `${hostKind}-`. Returns
`{ ok: true, agentId, conversationId, idempotencyKey }` on insert or
`{ ok: false, error: { code, ... } }` on the four documented codes:
`AGENT_ALREADY_REGISTERED` (carries `existingAgentId`),
`PARENT_AGENT_NOT_FOUND`, `SESSION_NOT_FOUND`,
`INVALID_AGENT_TYPE_PREFIX` (carries `expectedPrefix`).

**Removed**: `set_current_session_id` and `get_current_session_id` (the
elicitation flow that depended on them is gone too). The MCP server
now recovers the host session id at boot from `process.env`
(`VITEST_AGENT_CHAT_ID`, `_CONVERSATION_ID`, `_MAIN_AGENT_ID` —
written by SessionStart hook to `CLAUDE_ENV_FILE` and auto-sourced
into the MCP child).

**`McpContext.sessionContext: SessionContextRef`** holds the recovered
context. `run_tests` mutates `process.env.VITEST_AGENT_*` from this
ref before calling `createVitest`, so the in-process reporter
attributes the run to the active agent.

**Idempotency middleware** spec registry updated for the consolidated
procedure paths: `hypothesis` (record/validate), `tdd_task`
(start/end), `tdd_goal` (create), `tdd_behavior` (create). Key
derivation considers the `action` discriminator first.
