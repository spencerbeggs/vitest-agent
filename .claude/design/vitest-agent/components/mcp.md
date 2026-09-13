---
status: current
module: vitest-agent
category: architecture
created: 2026-05-06
updated: 2026-09-13
last-synced: 2026-09-13
completeness: 93
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ../schemas.md
  - ../data-flows.md
  - ../testing-strategy.md
  - ./sdk.md
  - ./engine.md
  - ./cli.md
  - ./plugin-claude.md
dependencies: []
---

# MCP package (`@vitest-agent/mcp`)

The Model Context Protocol server (`vitest-agent-mcp` bin) exposing the
action-keyed tool surface to LLM agents over stdio. Built on Effect's native
`McpServer` (`effect/unstable/ai`, rc.115): the 30 tools are `Tool.make`
values assembled into one `Toolkit`, registered under a strict-input
contract, and served alongside six framing-only prompts as a single Effect
`Layer` over `McpServer.layerStdio`. There is no MCP SDK, no tRPC and no
zod — the wire protocol, JSON Schema generation and input validation all
come from `effect` (Decision 71 in [../decisions.md](../decisions.md)).

**npm name:** `@vitest-agent/mcp`
**Bin:** `vitest-agent-mcp`
**Location:** `packages/mcp/`
**Rank:** 4 (Decision 70)
**Internal dependencies:** `@vitest-agent/engine`, `@vitest-agent/sdk`
**Entry points:** `.` (side-effect-free barrel), `./main` (the assembled
program that owns the process)

A separate package for module-boundary reasons and so the MCP tool
surface can evolve on its own cadence — not for install-cost reasons.
The plugin declares `@vitest-agent/mcp` as an exact-pinned regular
`dependency` and ships the `vitest-agent-mcp` bin itself as a 4-line shim
over `@vitest-agent/mcp/main` (the carrier — see [./plugin.md](./plugin.md)),
so every plugin consumer installs it and has the bin in
`node_modules/.bin`; an MCP server that is downloaded but never started
costs a non-Claude-Code user only a download. The `effect/unstable/ai`
`McpServer` surface staying in its own package is a boundary decision
(that dependency is the MCP server's concern alone), and the boundary
test forbids importing `@vitest-agent/cli` (the two front ends never
import each other).

For the surfaces this package exposes to the Claude Code plugin, see
[./plugin-claude.md](./plugin-claude.md). For the data layer it reads from
and writes to, see [./engine.md](./engine.md); for the schemas,
[./sdk.md](./sdk.md).

For decisions: [../decisions.md](../decisions.md) D11/D12/D13 (TDD
hierarchy and capability-vs-scoping), D35 (framing-only prompts surface),
D7 (artifact write authority), 50 (strict tool inputs), 51 (post-connect
crash survival), 70 (entry contract, boundary allowlist), 71 (the
Effect-native server).

---

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
                         contract over McpServer.addTool
  session.ts          -- McpSession service: { cwd, currentSessionId,
                         sessionContext }; createCurrentSessionIdRef,
                         createSessionContextRef(initial, recover?),
                         sessionContextFromEnv(env); layer / layerTest
  idempotency.ts      -- idempotencyKeys registry + the withIdempotency
                         combinator write handlers wrap themselves in
  annotations.ts      -- RenderText: the per-tool markdown renderer
                         annotation the strict registrar reads
  tools/              -- one file per tool (30) plus the private
                         _tdd-error-envelope.ts and _project-groups.ts
  prompts/
    layer.ts          -- PromptsLayer = Layer.mergeAll(six McpServer.prompt)
    triage.ts, why-flaky.ts, regression-since-pass.ts,
    explain-failure.ts, tdd-resume.ts, wrapup.ts -- one pure factory each
  utils/
    crash-guards.ts   -- pure shouldExitOnUncaughtException(connected)
    safe-format-fatal-error.ts -- never-throwing fatal formatter for main.ts
    tool-error-envelope.ts -- buildUnexpectedToolErrorEnvelope(tool, err)
    replay-marker.ts  -- the `_idempotentReplay` marker schema
  version.ts          -- CURRENT_MCP_VERSION (build-time literal)
```

## Process boundary

`packages/mcp/__test__/boundaries.test.ts` allows `process` references only
in `bin.ts`, `main.ts`, `version.ts` and `tools/run-tests.ts` (the one tool
that must mutate `process.env.VITEST_AGENT_*` on the in-process Vitest so
the reporter attributes the run), asserts the `process.env.__PACKAGE_VERSION__`
token appears only in `version.ts`, and forbids importing
`@vitest-agent/cli`, `@vitest-agent/plugin`, `@vitest-agent/reporter`,
`@vitest-agent/ui`, `@modelcontextprotocol/sdk`, `@trpc/server` and `zod`
anywhere under `src/`. Ambient input reaches a tool through `McpSession`,
not `process.env`; `McpSession.layerTest({ cwd, … })` requires an explicit
`cwd` for the same reason.

## Server bootstrap (`main.ts`)

`packages/mcp/src/bin.ts` is the published shim (`#!/usr/bin/env node`,
`import { main } from "./main.js"; void main();`). `main.ts` owns the
process, in this order:

1. **Crash guards first.** `process.on("unhandledRejection")` (log to
   stderr, stay alive) and `process.on("uncaughtException")` (log; exit 1
   only while `shouldExitOnUncaughtException(transportConnected)` says no
   client session exists yet). Registered before anything else is
   evaluated — see *Crash resilience*.
2. **Dynamic imports, inside a `try`.** `main.ts` carries exactly one
   static import, the dependency-free `utils/crash-guards.ts`; `effect`,
   `@effect/platform-node`, `@vitest-agent/engine`, `./session.js`,
   `./server.js` and `./version.js` are `await import(...)`ed after the
   guards so a throw during module evaluation of the server graph is still
   reported on stderr. This is the one sanctioned dynamic-import site in
   the family (Decision 70). Anything that rejects here — an import, the
   layer graph — is caught and exits 1 with
   `vitest-agent-mcp: startup failed: …`; left to the `unhandledRejection`
   guard the event loop would drain to exit 0 with no server listening.
3. **Project directory and database.** `resolveProjectDir({ env, cwd:
   process.cwd() })` from the engine (`VITEST_AGENT_PROJECT_DIR` →
   `VITEST_AGENT_REPORTER_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → cwd), then
   `resolveDataPath(projectDir)` under `PathResolutionLive(projectDir)` +
   `NodeServices.layer`. If `dbPath` resolution fails the server must not
   start — it exits 1 so the loader can print install instructions.
4. **Session.** `McpSession.layer({ cwd: projectDir, initialSessionId,
   initialContext: sessionContextFromEnv(env), recover: () =>
   recoverSessionContextFromSessionEnv({ projectDir, homeDir }) })` where
   `initialSessionId` is the optional first positional argv (a Claude Code
   chat UUID; a literal `${...}` substitution is treated as absent) falling
   back to the recovered `chatId`, and `homeDir = env.HOME ?? env.USERPROFILE ?? ""`.
   See *MCP boot context recovery*.
5. **The layer graph.** `Main = ServerLayer({ version: CURRENT_MCP_VERSION })`
   provided with `Session`, `PlatformLive({ dbPath, env, logLevel:
   resolveLogLevel(env), logFile: resolveLogFile(env) })`, `NodeStdio.layer`
   and `Layer.succeed(Logger.LogToStderr, true)`. `Connected =
   Layer.effectDiscard(sync { transportConnected = true;
   scheduleTestCrashInjection() }).pipe(Layer.provide(Main))` — `Layer.provide`
   builds its dependency to completion before the dependent (`Layer.mergeAll`
   is concurrent, which is why the flag is not in a merge), and
   `layerStdio` reaches the stdio protocol through `Layer.provide` chains,
   so by the time the flag flips the server is reading stdin.
6. **Launch.** `NodeRuntime.runMain(Layer.launch(Connected).pipe(
   Effect.provideService(Logger.LogToStderr, true)), { teardown })` where
   the teardown maps `Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)`
   to `onExit(0)` and everything else to `Runtime.defaultTeardown`. Stdin
   EOF interrupts the fiber that built the stdio protocol; the default
   teardown would report that as 130, and a client disconnect is the
   ordinary end of every session. No `process.exit` is needed — with SQLite
   and the protocol scoped under `Main`, the process exits within ~0.3 s of
   EOF (the e2e asserts < 2 s). There is no startup banner: stderr is empty
   across `initialize` + `ping`.

`main.ts` also carries the env-gated, fires-once crash injector
(`VITEST_AGENT_MCP_TEST_INJECT_CRASH`) for the spawned-bin e2e suite.

`packages/mcp/src/index.ts` is the side-effect-free barrel: `ServerLayer`,
`Kit` / `toolHandlers` / `ToolsLayer`, `registerStrictToolkit`, `McpSession`
and the session-ref helpers, `PromptsLayer`, `withIdempotency` /
`idempotencyKeys`, `RenderText`, the `PingResult` / `HelpResult` schemas
and `CURRENT_MCP_VERSION`. It never imports `main.ts`, so a library
consumer's import graph never pulls in the process-owning module.

## `ServerLayer` (`server.ts`)

```ts
ServerLayer({ version }): Layer<never, never, Stdio | McpSession | DataReader | DataStore | ProjectDiscovery | OutputRenderer>
```

`Layer.mergeAll(registerStrictToolkit(Kit).pipe(Layer.provide(ToolsLayer)), PromptsLayer)`
provided with `McpServer.layerStdio({ name: "vitest-agent", version,
description, protocols })` and `Layer.succeed(Logger.LogToStderr, true)`,
then `Layer.orDie`. Three facts are load-bearing:

- **`protocols` is newest-first** — `[v2025_11_25, v2025_06_18,
  v2025_03_26]` — because the registry falls back to `protocols[0]` for a
  client offering an unknown version.
- **`Logger.LogToStderr` is set here and again in `main.ts`.** Effect's
  default logger writes to stdout unless this reference is true, and
  stdout is the JSON-RPC wire. Every tool defect is logged by the strict
  registrar and the stdio protocol logs stdin errors, so this is
  mandatory, not cosmetic; the harness's `consoleLogSoFar` must stay
  empty. The engine's `LoggerLive` with no `VITEST_AGENT_LOG_LEVEL` is
  `Logger.layer([])`, so nothing logs at info during a clean session.
- **`serverInfo.description` is the at-initialize orientation hook.**
  `instructions` cannot be set through `layerStdio` at rc.115, so the
  description is a one-line pointer to the `help` tool, which remains the
  full orientation surface. (A `2025-06-18` client does not receive
  `description` on the wire; `help` is still there.)

`registerStrictToolkit` and every `McpServer.prompt` each `Layer.provide`
the static `McpServer.layer`, the same memoized pattern `McpServer.toolkit`
uses, so tools and prompts register into one `McpServer` and the harness's
`Layer.mergeAll(ServerLayer, ...extraLayers)` shares a single transport.

## Strict tool registration (`register-toolkit.ts`)

Every served `inputSchema` is strict, at every object level (Decision 50).
Tools are registered through `registerStrictToolkit(kit)`, never
`McpServer.toolkit`: Effect's toolkit decodes arguments with the default
`onExcessProperty: "ignore"`, which strips a misspelled filter and runs a
*wider* query while reporting success (issues #200 / #243). The module is
adapted from Effect's own `registerToolkit` (`McpServer.ts`, rc.115) over
the public `McpServer.McpServer.addTool`, and per tool it:

1. **Serves a strictified schema.** `strictifyJsonSchema` takes
   `Tool.getJsonSchema(tool)`, inlines a `$ref` root and `$ref` members of
   a top-level `anyOf` / `oneOf` against `$defs` (what an `identifier`
   annotation produces — a `$ref` root fails `McpSchema.ToolJsonSchema`'s
   `type: "object"` requirement and would `orDie` at registration; `$defs`
   are retained for nested refs), sets `additionalProperties: false` on
   every object node (nodes with `properties` or bare objects, recursing
   through `properties`, `items`, `prefixItems`, `anyOf` / `oneOf` /
   `allOf` and `$defs`), and rewrites a top-level union whose members
   share a literal `action` / `kind` from `anyOf` to `type: "object"` +
   `oneOf` + `x-discriminator`. The synthesized union root carries no
   `additionalProperties: false` of its own — it declares no `properties`,
   so a strict validator would reject every key. The output schema goes
   through the same `$ref` inlining so identifier-annotated results list an
   `outputSchema` with `type: "object"`; union-rooted results (`inventory`,
   `test`, …) list no `outputSchema` because MCP requires `type: object`.
2. **Walks the raw payload before decoding.** `collectUnknownKeys(value,
   schema)` resolves refs, selects the union branch by the discriminant
   value, and reports every unknown key with its path and that level's
   accepted list. A hit fails `McpSchema.InvalidParams({ message:
   "Unrecognized parameter(s): tags.anyy. Accepted params: all, any, none" })`
   — path-qualified, nested-object, array-element and union-branch aware;
   empty-params tools say `Accepted params: (none)`; every echoed key is
   truncated to 200 characters so a hostile payload cannot balloon the
   error. A rejected call never reaches a `DataReader` / `DataStore` call.
   Effect's own schema-decode failure (`ToolParameterValidationError`)
   maps to `InvalidParams` as well. On protocol `2025-11-25` an
   `InvalidParams` surfaces as an `isError: true` text result; on
   `2025-06-18` and earlier as a JSON-RPC `-32602` — Effect's per-version
   mapping, pinned on both by `server-layer.test.ts`.
3. **Renders the dual channel.** `structuredContent` = the result encoded
   through the tool's `success` schema (objects only, per MCP);
   `content[0].text` = `RenderText(encoded)` when the tool annotated a
   markdown renderer, else `JSON.stringify(encoded)`.
4. **Maps failures.** A declared, `Error`-shaped failure
   (`Schema.is(tool.failureSchema)(err) && err instanceof Error`) becomes
   `{ isError: true, content: [{ text: err.message }] }` with no
   `structuredContent` — upstream parity, and unused here because every
   tool's `failure` is `Schema.Never`. An interrupt-only cause propagates
   untouched. Every other failure or defect is `Effect.logError`ed and
   returned as `{ isError: true, structuredContent:
   buildUnexpectedToolErrorEnvelope(name, err), content: [JSON] }` — the
   same `{ ok: false, error: { _tag: "UnexpectedToolError", tool, message,
   remediation } }` success-shape the TDD error envelope uses, so an
   in-boundary crash comes back in the same structured shape as every
   other tool error.

`ping` and `help` omit `parameters` (Effect's `Tool.EmptyParams` serves a
strict empty object); `parameters: Schema.Struct({})` would serialize to
`{ not: { type: "null" } }` and die at registration.

The regression guard is structural and table-driven at once:
`served-schema-strict.test.ts` walks every *served* schema over the
in-process harness asserting `additionalProperties: false` on every object
node, and an `it.each` of `(tool, minimal-valid-args)` calls every tool but
`run_tests` with a bogus extra key (rejected, naming the key) *and* with
only its documented params (never rejected at the parameter boundary),
with a guard test that the case list equals `tools/list` minus `run_tests`.
`run_tests`'s served schema and wire behavior are covered in
`tools-write.test.ts` and `run-tests-wire.e2e.test.ts`. `register-toolkit.test.ts`
unit-tests `strictifyJsonSchema`, `inlineRootRefs` and `collectUnknownKeys`
against `Tool.getJsonSchema` of real `Schema.Union`s.

## Tools and the toolkit

`packages/mcp/src/toolkit.ts` is the single source of truth for the served
tool list: `Kit = Toolkit.make(...)` over the 30 `Tool.make` values, the
`toolHandlers` record that must `satisfies Toolkit.HandlersFrom<typeof
Kit.tools>` (a tool without a handler, or a handler without a tool, is a
compile error), and `ToolsLayer = Kit.toLayer(toolHandlers)`. Each tool
declares `dependencies: [McpSession, DataReader, …]`, so the `Exclude<
Tool.HandlerServices, McpServerClient>` requirement flows into
`ServerLayer`'s `R` automatically (`Layer`'s `RIn` is covariant, so the
wider annotation is sound).

Every `tools/<name>.ts` exports the same shape: the Effect Schema
`parameters` and `success` (union results carry their discriminant tuple —
`TEST_ACTIONS`, `INVENTORY_KINDS`, `NOTE_ACTIONS`, `HYPOTHESIS_ACTIONS`,
`TDD_TASK_ACTIONS`, `TDD_GOAL_ACTIONS`, `TDD_BEHAVIOR_ACTIONS` — pinned to
the union by a two-way type assertion, Decision 60), the markdown
formatter, the `handle<Name>` `Effect` (error channel `never`;
`DataStoreError` is `orDie`d so an unexpected failure reaches the agent as
the `UnexpectedToolError` envelope), and the `Tool.make("<name>", {
description, parameters, success, dependencies })` value annotated with
`Tool.Title`, `Tool.Readonly`, `Tool.Destructive`, `Tool.OpenWorld`,
`Tool.Idempotent` and, for a markdown text channel, `RenderText`. Every
field the old zod `.describe()` documented carries the same `description`
annotation (pinned per variant by `served-enum-drift.test.ts`).

**Schema policy and the wire consequence.** Inputs use `Schema.optionalKey`
(not `optional`) so the served `required` list is right, and
`Schema.Finite` (not `Number`) for numeric fields. The old served side used
`z.coerce.number()`, so a numeric *string* was accepted; `"limit": "5"` and
`"timeout": "120"` are now rejected with a decode error everywhere except
`hypothesis record`'s `tddTaskId` / `sessionId`, whose
`Union([Finite, FiniteFromString])` is preserved and served as
`anyOf [number, string]`. `note list.scope` is served as the six-literal
enum. The `Toolkit` encoder strips undeclared result keys, so
`_idempotentReplay` is declared on the replayable success structs via
`IdempotentReplayMarker` (`utils/replay-marker.ts`) and advertised in those
tools' output schemas; the `tdd_goal` / `tdd_behavior` error-envelope
members describe the real envelope shape (`_tag`, an object `remediation`,
rest `Record<String, Unknown>`) — under the old bridge that member could
never have matched.

The 30 tools group into:

- **Meta.** `ping`, `help` (the orientation surface: tool groupings and
  the action-keyed families).
- **Read-only queries.** `test_status`, `test_overview`, `test_coverage`,
  `file_coverage`, `test_history`, `test_trends`, `test_errors`,
  `cache_health`, `settings_list`, `turn_search`, `failure_signature_get`,
  `acceptance_metrics`, `commit_changes`, `configure`. Markdown through
  `RenderText` / `OutputRenderer`.
- **Action-keyed consolidated tools.** Each per-CRUD family collapses to
  one tool discriminated on an `action` (or `kind`) literal and dispatched
  via `Match.discriminatorsExhaustive`: `inventory` (`kind:
  project|module|suite|session|tag`), `test` (`action:
  list|get|for_file|for_tag|annotations|artifacts`), `note`
  (`create|list|get|update|delete|search`; `list` / `search` return
  markdown, the rest JSON), `hypothesis` (`record|validate|list`),
  `tdd_task` (`start|end|get|resume`; the underlying tables keep the
  `tdd_tasks` naming), `tdd_goal` and `tdd_behavior`
  (`create|update|delete|get|list`).
- **Standalone TDD tools.** `tdd_phase_transition_request` (the headline
  write — see *Phase-transition guards*), `tdd_artifact_list` (every row
  carries `suite: "vitest" | "bats"`, issue #363; its description
  disambiguates it from `test({ action: "artifacts" })`),
  `tdd_progress_push` (see *Progress push*).
- **Agent registration.** `register_agent` wraps `DataStore.registerAgent`;
  validates that `agentType` begins with `${hostKind}-`; returns `{ ok:
  true, agentId, conversationId, idempotencyKey }` or `{ ok: false, error:
  { code, ... } }` on `AGENT_ALREADY_REGISTERED` (carries
  `existingAgentId`), `PARENT_AGENT_NOT_FOUND`, `SESSION_NOT_FOUND`,
  `INVALID_AGENT_TYPE_PREFIX` (carries `expectedPrefix`). The `ok: false`
  result no longer sets `isError` (the strict registrar has no per-tool
  hook for it; consumers read `structuredContent.ok`).
- **Triage / wrapup.** `triage_brief` and `wrapup_prompt` delegate verbatim
  to the engine's `formatTriageEffect` / `formatWrapupEffect`
  (`packages/engine/src/lib/`), shared with the CLI so outputs are
  byte-identical.
- **Mutation.** `run_tests` runs Vitest in-process via `createVitest` from
  `vitest/node`, resolved from the run's root (Decision 55). Mutates
  `process.env` from `McpSession.sessionContext` before `createVitest` so
  the in-process reporter sees current attribution — the one tool on the
  `process` allowlist. The per-call timeout is an `Effect.timeout` around
  `localVitest.start(...)`, recovered with `Effect.catchTag("TimeoutError")`
  into the `timeout` result variant (Decision 63). Accepts a structured
  `tags` filter (served as `$ref: "#/$defs/TagFilter"`, strict through the
  ref) and a per-call `passWithNoTests` override; emits a `no-match`
  discriminator variant when the resolved filter set matches zero tests,
  and echoes the filter set it actually ran under on `RunTestsOk.scope`.
  The `reason` it computes from module states is preliminary —
  `buildAgentReport` self-corrects it to `"failed"` when the walk finds
  failed files or unhandled errors. After the run it walks
  `localVitest.state.getFiles()` through the core's
  `collectConsoleLeakEntries` / `buildConsoleLeaks` and attaches
  `report.consoleLeaks`, partitioned by test outcome (Decision 57). Also
  accepts an optional, validated `projectRoot` that overrides
  `McpSession.cwd` for one call and always echoes the root it ran under —
  see *Caller-declared project root*, *Config-anchored default root* and
  *Per-invocation coverage directory*.

Both `set_current_session_id` and `get_current_session_id` are **removed**.
`McpSession.sessionContext` populates from `process.env.VITEST_AGENT_*` at
boot (see *MCP boot context recovery*) and `run_tests` reads the ref before
each Vitest invocation.

**Adding a tool.** Create `tools/<name>.ts` with the schemas, the
`Tool.make` value and the `handle<Name>` Effect; add both to `toolkit.ts`;
add the name to the Claude Code plugin's allowlist
(`plugins/claude-code/hooks/lib/safe-mcp-vitest-agent-ops.txt` — omit
destructive tools so they prompt; consider `pre-tool-use/tdd-restricted.sh`
if the TDD orchestrator must not call it); extend
`served-schema-strict.test.ts`'s case list; update `tools/help.ts`. Wrap a
write handler in `withIdempotency("<name>", handler)` and register its key
in `idempotency.ts` when a replay must be safe.

## `McpSession`

`packages/mcp/src/session.ts`. The one per-process service tool handlers
read for `cwd` and the host session:

```ts
class McpSession extends Context.Service<McpSession, {
  readonly cwd: string;
  readonly currentSessionId: CurrentSessionIdRef;
  readonly sessionContext: SessionContextRef;
}>()("@vitest-agent/mcp/McpSession")
```

`McpSession.layer({ cwd, initialSessionId, initialContext, recover? })`
is built once in `main.ts`; `McpSession.layerTest({ cwd, ...overrides })`
is the test form and requires `cwd` because the module is process-free.
`createCurrentSessionIdRef`, `createSessionContextRef(initial, recover?)`
and `sessionContextFromEnv(env)` (env now a required argument) live here
and are re-exported from the barrel. The `SessionContext` type itself is
declared in the engine's `programs/session-env.ts` and re-exported.
`McpSession` replaced the tRPC `McpContext`; the 18 read-only tools
declare it but do not read it today.

## TDD error envelope

`packages/mcp/src/tools/_tdd-error-envelope.ts`. Catches the five tagged
TDD errors (from `@vitest-agent/sdk`'s `TddErrors`) at the MCP boundary
and surfaces them as success-shape `{ ok: false, error: { _tag, ...,
remediation: { suggestedTool, suggestedArgs, humanHint } } }` responses.
This matches the `tdd_phase_transition_request` `{ accepted: false,
denialReason, remediation }` precedent. Domain errors with remediation
hints come through the success-shape envelope so the agent's tool-result
handling stays uniform; the `failure` channel of every tool is
`Schema.Never` (Decision 71), and only an unexpected defect takes the
`UnexpectedToolError` path.

## Idempotency combinator

`packages/mcp/src/idempotency.ts`. Idempotency is a combinator, not
middleware:

```ts
withIdempotency(path, handler)(params): Effect<R | (R & { _idempotentReplay: true }), never, S | DataReader | DataStore>
```

**Flow.** Look up the registered `IdempotencyKeySpec` for `path` and derive
the key from the decoded params (strictly registered, so no key can have
been stripped); a `null` key or an unregistered path runs the handler
every time and persists nothing. Otherwise
`DataReader.findIdempotentResponse(path, key)`: on a hit, `Effect.try`
the `JSON.parse` of `result_json` and return it with
`_idempotentReplay: true` merged onto an object result (a non-object
round-trips unchanged); on a miss, run the handler and persist via
`DataStore.recordIdempotentResponse` best-effort.

**Failure posture.** Three things are deliberately a *miss*, never a
failure: a `findIdempotentResponse` read failure, a corrupt cached row
(the parse is wrapped in `Effect.try` → `Option.none()`), and a persist
failure (swallowed). The combinator's error channel is `never`; a cache
problem must not fail a tool whose write may already have succeeded, and
the worst case is a duplicate write. **Rows never self-heal:**
`recordIdempotentResponse` is `INSERT … ON CONFLICT(procedure_path, key)
DO NOTHING`, so re-persisting after a corrupt-row miss is a guaranteed
no-op and the key stays a permanent miss until something with `DELETE` /
`UPDATE` access clears it. An engine-level upsert is a recorded follow-up
(Decision 71). `idempotency-combinator.test.ts` pins every branch,
including a seeded non-JSON row.

**What is and isn't idempotent.** `hypothesis`'s `validate` action
(`validate:<id>:<outcome>`), `tdd_task`'s `start` / `end`, and the `create`
actions inside `tdd_goal` and `tdd_behavior` derive a key. `hypothesis`'s
`record` action does **not** — a hypothesis is an append-only observation
whose binding session is resolved server-side (see *Hypothesis session
binding*), leaving no safe per-call discriminator. `register_agent`'s
idempotency is `DataStore.registerAgent`'s own `(session_id,
idempotency_key)` upsert. `tdd_phase_transition_request`, every `update` /
`delete` / `get` / `list` action, and `tdd_progress_push` are intentionally
not registered — state-dependent reads, intentional state transitions and
destructive ops are not idempotent in the cache-replay sense. Each spec's
`deriveKey` returns `null` for non-idempotent actions, branching on
`input.action`.

**`tdd_task` idempotency key (action: `start`).** Derived from `runId`
when present: `sid:<sessionId>:run:<runId>` or `cc:<chatId>:run:<runId>`.
When `runId` is absent (legacy callers) the key falls back to goal text:
`sid:<sessionId>:<goal>` or `cc:<chatId>:<goal>`. `runId`-based keying
lets the same goal be retried within one CC session (the main agent
generates a fresh `runId` per dispatch) without triggering the replay.

**`tdd_task({ action: "start" })` accepts `runId`.** Forwarded to
`DataStore.writeTddTask`; when provided, `run_id` is stored and the
partial unique index on `(session_id, run_id)` gives database-level
deduplication. When omitted, `run_id` is NULL, the partial index does not
cover the row, and only the goal-text cache key provides idempotency.

## Progress push (`tdd_progress_push`)

Validates the payload against the `ChannelEvent` discriminated union from
`@vitest-agent/sdk`, then for behavior-scoped events resolves `goalId` and
`sessionId` **server-side** from `behaviorId` (via
`DataReader.resolveGoalIdForBehavior` and the goals → sessions FK) so a
stale orchestrator context cannot push the wrong tree coordinates.
Resolution is best-effort — malformed JSON forwards the raw string, a DB
read failure forwards the decoded event — and every path returns
`{ ok: true }`.

**Wire method (Decision 71).** Effect's `McpServer` has no custom-notification
surface, so the old `notifications/claude/channel` frame is gone. The
enriched event is emitted through
`server.notifications["notifications/message"]({ level: "info", logger:
"vitest-agent/channel", data })` inside `Effect.ignore` — a standard
logging-message notification broadcast to every initialized client. Nothing
consumed the old method (verified before the switch); the `tdd` skill
treats the push as best-effort, narration is primary, and every event is
persisted and readable via `tdd_task({ action: "get" })` — see
[./plugin-claude.md](./plugin-claude.md) for the consumer side.

## Crash resilience

Issue #191, sub-item A; [../decisions.md](../decisions.md) Decision 51.
Two independent layers, addressing two different failure modes — do not
conflate them.

**Process-level guards (`main.ts`).** Under Node >= 15 an unhandled promise
rejection anywhere outside a tool call's own await chain — a
fire-and-forgotten fiber, a background timer — kills the process, closing
the stdio transport and silently deregistering every tool from the
client's perspective mid-session, with no recovery path. `main.ts`
registers `unhandledRejection` (log to stderr, stay alive) and
`uncaughtException` handlers **before any other module is evaluated** (the
dynamic-import ordering above), so they also cover the `dbPath` resolution
and layer-build phase.

The `uncaughtException` policy is a deliberate departure from Node's "do
not resume normal operation" guidance, isolated in the pure
`shouldExitOnUncaughtException(transportConnected)` predicate
(`packages/mcp/src/utils/crash-guards.ts`) so the judgment call is testable
and documented in one place: exit before the transport connects (no client
session exists to preserve, and spinning in a half-initialized state is
worse than failing loudly), survive after. Surviving is acceptable because
this process holds no long-lived mutable state outside SQLite's own
transactions — every `DataStore` / `DataReader` call is self-contained —
so a throw that escapes even the registrar's per-call catch cannot leave
the *next* call's bookkeeping half-mutated.

**The crash handler must not be crashable (issue #243).** The handlers go
through `safeFormatFatalError` (`utils/safe-format-fatal-error.ts`), which
try/catches the core's `formatFatalError` and falls back to the exported
`UNFORMATTABLE_ERROR_TEXT` constant — that formatter introspects the value
it is handed (`Symbol.for(...) in reason`, `instanceof Error`,
`JSON.stringify`) and every one of those is hijackable by a `Proxy` trap
that throws, and a throw inside an `uncaughtException` handler is fatal
with no second chance. Because `safeFormatFatalError` imports the core
barrel, `main.ts` starts with a dependency-free `describe` fallback and
swaps it in once the dynamic import resolves.

**Structured envelope for handler defects (`register-toolkit.ts`).**
Defense in depth, not the primary fix: a throw or defect *inside* a tool
call is caught at the registration boundary and returned as
`buildUnexpectedToolErrorEnvelope(name, err)` (`utils/tool-error-envelope.ts`)
with `isError: true`. The envelope builder coerces the thrown value
defensively inside one try/catch — `err instanceof Error` walks the
prototype chain and `String(err)` invokes `Symbol.toPrimitive`, both
hijackable — stringifies a non-string `.message`, and returns a constant as
the last resort.

The guards are proved against a real spawned bin over a real stdio
transport — `packages/mcp/__test__/bin-crash-resilience.e2e.test.ts` uses the
env-gated injector and asserts the injected kind is on stderr *before*
`ping` is sent, then that `ping` still answers `pong`.

## Hypothesis session binding

`hypothesis (action: record)` resolves its binding session server-side rather than trusting a caller-guessed `sessionId`. Resolution precedence:

1. **`tddTaskId` (preferred, deterministic).** The orchestrator always holds the unambiguous id returned by `tdd_task (action: start)`; the server resolves the session the task was opened under via `DataReader.getSessionByTddTaskId`, ignoring the recovered host context entirely. An unknown `tddTaskId` is a hard typed failure, not a silent misattribution. The input accepts a number **or a numeric string** (`Schema.Union([Finite, FiniteFromString])`, served as `anyOf [number, string]`) because LLM callers routinely stringify numeric tool inputs — a bare number schema silently dropped the deterministic branch. It is the one numeric field in the surface that still coerces a string (Decision 71). `FiniteFromString` is deliberate over `NumberFromString`: a genuinely non-numeric string still fails validation instead of coercing to `NaN`.
2. **Recovered host context.** The long-lived MCP server's context always names the main agent's `chatId`; the server resolves the main session via `DataReader.getSessionByChatId`, then attributes to the active (un-ended) subagent child from `DataReader.findActiveSubagentSession` when one exists, else the main session.
3. **Caller-supplied `sessionId`**, honored only when no host context was recovered (dev / test paths).

The tool description on the `Tool.make` value is part of this contract — it is the text the model actually reads, and the earlier description steered callers toward `sessionId`. It now steers toward `tddTaskId` and explicitly warns against passing a `tddTaskId` value under the `sessionId` key. The dual-registration hand-sync failure that once made the `tddTaskId` branch unreachable (a field declared on the handler's schema but not on the served one) is the motivating case for testing through the served schema — the harness serves exactly what `Tool.make` declares, so the class of bug cannot recur.

**`action: "validate"` timestamps itself.** `validatedAt` is
`Schema.optionalKey` on the `validate` variant, and the handler defaults an
omitted value to `new Date().toISOString()`; an explicitly supplied value
is honored verbatim. Under the old dual registration the Effect schema
required the field while the served zod schema advertised it as optional,
so a caller that believed the served schema got its call rejected
(issue #246) — the same hand-sync hazard as the `tddTaskId` case, now impossible
because there is one schema. The `format-wrapup` nudge and the `help`
tool text were updated to stop telling callers to synthesize a timestamp.

## Phase-transition guards

`tdd_phase_transition_request` is the headline TDD write. The MCP layer
wraps the pure `validatePhaseTransition` function from the SDK with three
pre-checks performed before the validator runs:

1. Goal status check (rejects if the goal isn't `in_progress`).
2. Behavior membership check (rejects if a `behaviorId` doesn't belong to
   the requested goal).
3. The existing D2 evidence-binding rules — applied via the pure
   validator. The tool threads the open phase row's id from
   `getCurrentTddPhase` into the context as `current_phase_id` (`null`
   when no phase row exists yet) so rule 1's window check can compare it
   against the cited artifact's own `phase_id` (issue #245); the
   synthetic artifact built for the auto-resolve fallback carries
   `phase_id: -1` and never reaches that check.

The validator's own source-phase guards run ahead of artifact
resolution, so the MCP tool never resolves evidence for a transition
that is structurally illegal: `green` is only reachable from `red` /
`red.triangulate` / `green.fake-it` (`wrong_source_phase`), and
`refactor` is only reachable from `green` / `green.fake-it`
(issue #361). A `red→refactor`, `red.triangulate→refactor`, or
`spike→refactor` request is denied with `refactor_without_passing_run` and a remediation
of `{ suggestedTool: "tdd_phase_transition_request", suggestedArgs:
{ requestedPhase: "green" } }` regardless of any cited or auto-resolved
`test_passed_run`. The tool needed no change for #361 — the denial
reason and remediation shape were already the ones it surfaces;
`packages/mcp/__test__/tool-handlers.test.ts` pins the end-to-end denial.

On accept with a `behaviorId`, the server **auto-promotes** the behavior
`pending → in_progress` in the same SQL transaction as `writeTddPhase` so
the phase ledger and behavior status never desync. The orchestrator is
only responsible for the final `done` transition via
`tdd_behavior({ action: "update" })`.

The `DenialReason` union covers both pre-check rejections and the
validator's existing reasons, so denials are uniform from the agent's
perspective.

**Cross-session diagnostic on `missing_artifact_evidence` (issue #144).**
When auto-resolve finds no artifact of the required kind for the task,
the denial's `remediation.humanHint` no longer stops at "no artifact has
been recorded". Before returning, the tool calls
`DataReader.countRecentArtifactsInOtherSessionsOfConversation({ tddTaskId,
sinceIso })` with a 10-minute lookback (`DIAGNOSTIC_WINDOW_MINUTES`). The
reader counts `tdd_artifacts` rows recorded since `sinceIso` under
sessions *other than* the one that opened the task but sharing that
session's non-null `conversation_id`; it returns `0` when the task is
unknown or its session's `conversation_id` is null, so the diagnostic
never fabricates a signal it cannot back. A non-zero count appends a
sentence to the hint — N artifacts were recorded under a different
session of this conversation in the last 10 minutes; the subagent's
hooks may be attributing to a detached session — and names the two
remedies: set `VITEST_AGENT_TDD_TASK_ID=<tddTaskId>` in the subagent's
environment (the explicit task-id escape hatch on `record tdd-artifact`,
see [./cli.md](./cli.md)) or re-dispatch as an unnamed background
subagent. The denial shape is unchanged — `denialReason`, `suggestedTool`
and `suggestedArgs` are as before — only the human-readable hint grows.
See [../decisions.md](../decisions.md) D21.

## Phase-transition auto-resolve

`tdd_phase_transition_request` accepts an optional `citedArtifactId`.
When omitted, the tool auto-resolves the most recent matching artifact
for the required-evidence rule of the target phase via
`DataReader.listTddArtifactsForTask({ walkParents: true })` (which
follows the `sessions.parent_session_id` chain so the resolver finds
artifacts written under a rotated `chat_id`). That lookup is
behavior-scoped — it passes `behaviorId` — only for `red→green` and
`green→refactor`, the transitions where the validator enforces
behavior-match (rule 2), gated by the shared
`transitionEnforcesBehaviorMatch` predicate from the SDK; it stays
unscoped for `red.triangulate→green` and `refactor→red` so the batch or
prior-behavior evidence those transitions rely on is still found
(issue #115). The auto-resolved artifact id is returned in the response
so the orchestrator can record what evidence was bound. Explicit
citation still wins when the agent supplies it.

The `tdd_artifact_list` tool exposes the same reader directly so the
orchestrator can list candidate artifacts before committing to a
phase transition — replacing the prior workflow of shelling out to
`sqlite3` from a hook script. Its `TddArtifactListRow` output schema
carries `suite` (`Schema.Literals(["vitest", "bats"])`, issue #363) and
the markdown formatter prints `suite=…` beside the phase on every row,
so the orchestrator can see that a run-level artifact (no `testCaseId`)
is a bats one — and therefore citable — before it requests the
transition. `tdd_phase_transition_request` threads the same field onto
the `CitedArtifact` it builds for the validator; its synthetic
no-artifact placeholder is `suite: "vitest"`, so the absence of evidence
is never mistaken for a bats carve-out.

## Project handling in discovery tools

The `inventory` tool's `module` / `suite` / `session_list` modes
enumerate every project from `DataReader.getRunsByProject()` when
`project` is unspecified, grouping output under per-project `###
project` headers. This is required because real multi-project Vitest
configs use names like `unit` and `integration` — there is no literal
`"default"` project to fall back to. The `test` tool's `list` and
`for_tag` modes follow the same pattern.

## History query narrowing

`test_history` used to take `project` alone and return the entire
project's history — 334KB of JSON for one real repro, most of it
irrelevant to the question being asked (issue #212). The input now accepts optional `testName`, `modulePath`,
and `limit`, pushed down to `DataReader.getHistory`'s
`HistoryQueryOptions` as SQL predicates rather than filtered
client-side. `limit` caps runs kept **per test** (default 20), not total
rows — see [./engine.md](./engine.md) for why a flat row LIMIT would starve
later tests instead of trimming each test's own series. The served tool
description states the default and tells the caller to omit all three
only when the whole project's history is genuinely wanted.

**The narrowing scopes the whole response, not just `history`**
(issue #243). `testName` / `modulePath` originally reached only
`getHistory`, while the tool's sibling `getFlaky` /
`getPersistentFailures` calls stayed project-wide — so a call scoped to
one test came back carrying every other test's flaky and persistent
classifications, and `hasData` (derived from all three reads) answered
`true` for a test that had never run. Both reads now take the same
values through the engine's `ClassificationQueryOptions`, and `hasData` is
therefore a statement about the requested scope.

`limit` is validated as a positive integer rather than accepted as a bare
number (`Schema.Int` checked greater-than-zero; a numeric string such as
`"5"` is rejected too since the served side no longer coerces). `0`,
`-1`, and `1.5` used to flow straight into the window query's
`rn <= limit` predicate and return an empty history — indistinguishable,
to the agent, from "this test has never run". A rejected input is the only
honest answer.

`test({ action: "get" })` consumes the same narrowing, and its fix is a
correctness bug rather than a payload-size one (issue #241): it used to
fetch the whole project's history and then `find` the matching entry
client-side by `fullName` alone. Since `fullName` is not file-qualified
(Decision D20), two same-named tests in different modules made that
`find` return whichever entry sorted first — potentially another file's
test. It now passes `{ testName, modulePath }` so the composite identity
is enforced in SQL.

The follow-up (issue #243) is that narrowing alone still let the tool
*guess*. `action: "get"` now accepts an optional `modulePath` and
resolves in two steps: `DataReader.getTestModulesByFullName` first, then
the lookup. When the name matches more than one module and no
`modulePath` was supplied, the tool returns its absent shape —
`found: false` with `ambiguous: true` and `candidateModules[]` — instead
of a plausible-looking record from an arbitrary file. The markdown
rendering spells out the re-run call with a `modulePath`, so the agent
recovers in one turn. `getTestByFullName` also gained a deterministic
`ORDER BY` for the case where a caller does pin a module; picking
consistently matters even when the answer is unique per module. The
`ambiguous` / `candidateModules` fields are optional on `TestGetMissing`
so a plain not-found result is unchanged.

## Tag filtering and tag introspection

Vitest's native tags are the way agents target test subsets
(`unit`, `int`, `e2e`, `slow`, etc.). The plugin's tag-injection
pipeline populates the `tags` / `test_case_tags` / `test_suite_tags`
tables; that data is surfaced on three MCP tools (`run_tests`,
`inventory`, `test`) via new input / output variants rather than a new
top-level tool.

**`run_tests` tag filter.** A new optional `tags` input carries a
`TagFilter` struct with three optional arrays: `all` (every listed tag
must be on the test), `any` (at least one), `none` (excludes any test
carrying a listed tag). The three sub-filters AND together with each
other and with `project` / `files` — strict AND across filters, no
silent override. The `none` axis covers all negation (no separate
`not_any` / `not_all`). The pure `composeTagExpression` helper in
`packages/mcp/src/tools/run-tests.ts` flattens a `TagFilter` to
Vitest's `tagsFilter` expression: `"int and slow"` for `all`,
`"(unit or int)"` for `any` with 2+ entries, `"not slow and not flaky"`
for `none`, three joined by ` and `. Returns `null` when every
sub-filter is empty. `sanitizeTestArgs` covers tag values with the
same `FORBIDDEN_CHARS` regex it applies to `files` and `project`.

Both `tags` and `passWithNoTests` were, until issue #200, declared on
the handler's input only — the served `inputSchema` never advertised or
forwarded them, so a real client's tag filter was silently stripped and
the run went wide. There is one schema now: `tools-write.test.ts` asserts
the served `run_tests` declaration (the seven declared keys, `tags`
resolved through `$defs` and `_sessionContext` both strict), and the
strict registrar turns the *next* misspelling — `{ tags: { anyy: [...] } }`
— into a rejection naming `tags.anyy` instead of a silent widening.

**`run_tests` `scope` echo.** `RunTestsOk` carries a required
`scope: { project: string | null, files: string[], tags: TagFilter | null }`
— the resolved filter set, verbatim. It is the cheap, positive
counterpart to `no-match`: an agent can tell "ran exactly what I asked"
apart from "a dropped or misspelled param ran everything" by reading one
field, instead of inferring it from summary counts. `no-match`'s
`filter` field remains the richer failure-side echo (it also carries the
composed `resolvedExpression`).

**`run_tests` `passWithNoTests` per-call override.** The tool input
accepts an optional `passWithNoTests` boolean that wins for that
invocation only over the project-level default the plugin captured
from Vitest's native `test.passWithNoTests` at `configureVitest` time
and forwarded onto `ResolvedReporterConfig`. No new
`AgentPluginOptions` field — users still configure it the normal
Vitest way. Controls pass/fail classification and CLI exit-code
semantics only; it does not reshape the MCP response shape.

**`run_tests` `no-match` discriminator.** `RunTestsNoMatch` joins
`ok | timeout | error` in `RunTestsResult` as the fourth variant on
the `kind` discriminator. Detection fires after `vitest.start` when
`testModules.length === 0` AND `unhandledErrors.length === 0` AND the
call carried any filter (`files`, `project`, or `tags`) — filter-driven,
not result-driven. A truly empty workspace with no filter still emits
`ok` with an empty report. The variant carries
`filter: { project, files, tags, resolvedExpression }` — the resolved
context echoes back verbatim plus the composed `tagsFilter` string for
transparency. `passWithNoTests` policy never reshapes the discriminator;
even with `passWithNoTests: true` a filtered empty selection still emits
`no-match`. `formatRunTestsMarkdown` dispatches to `formatNoMatchMarkdown`
on this branch, echoing the resolved filter and printing
tag-introspection / `for_file` / `project` remediation pointers.

**`run_tests` timeout (issue #320).** The run is bounded in the Effect
error channel, not by a hand-rolled race. `localVitest.start(...)` is
wrapped in `Effect.tryPromise({ try, catch: (cause) => cause })`, piped
through `Effect.timeout(timeoutMs)`, mapped to `{ outcome: "ok", value }`,
then `Effect.catchTag("TimeoutError", …)` yields
`{ outcome: "timeout" }` and a final `Effect.catch` yields
`{ outcome: "failed", cause }`. `Effect.runPromise` therefore always
resolves with a discriminated outcome: `timeout` returns
`{ kind: "timeout", timeoutSeconds }`, `failed` rethrows `cause` into the
tool's ordinary `{ kind: "error" }` envelope, and `ok` continues into
report building. This replaced a `Promise.race` against a `setTimeout`
that rejected with `new Error("VITEST_TIMEOUT")` plus an
`err.message === "VITEST_TIMEOUT"` probe in the catch handler — a string
sentinel that any ordinary error with that exact message could forge. An
error whose message is literally `VITEST_TIMEOUT` now yields
`{ kind: "error" }`. Two Effect v4 facts the implementation depends on:
`Effect.timeout` fails with `Cause.TimeoutError`, whose `_tag` is
`"TimeoutError"` (so `catchTag` matches exactly it), and the v4
catch-all is `Effect.catch` — there is no `Effect.catchAll`. Fiber
interruption cannot cancel an in-flight Promise, so on timeout the
Vitest run is still only best-effort abandoned and the `finally` block's
`vitest.close()` remains the real teardown. See
[../decisions.md](../decisions.md) Decision 63.

**`run_tests` `discoveryLastScannedAt` observability.** `RunTestsOk` carries an optional `discoveryLastScannedAt: string | null` — the ISO timestamp of the most recent real disk scan `discoverProjects()` performed in this process, or `null` when discovery has not scanned disk in this process (e.g. a config that never calls `AgentPlugin.discover()`). It lets an agent tell a stale-looking test count apart from a fresh scan (issue #100). The value is read via `readDiscoveryLastScannedAt()` in `packages/mcp/src/tools/run-tests.ts` from the process-global `Symbol.for("vitest-agent:discovery:last-scan-at")` slot that `@vitest-agent/plugin` writes on every real scan. The Symbol handshake exists because `@vitest-agent/mcp` cannot import `@vitest-agent/plugin` (the plugin depends on mcp, so a reverse import is circular); `createVitest` loads `vitest.config.ts` in-process, which calls `discoverProjects()`, so both sides observe the same slot by the time the result is built. Mirrors the `ensureMigrated` globalThis-keyed pattern (Decision 28). See [../decisions.md](../decisions.md) Decision 43.

**`run_tests` `scopedNote`.** `RunTestsOk` carries an optional
`scopedNote: string | null` (issue #160). When the call carried any filter
(`files`, `project`, or `tags`) the tool sets it to
`formatScopedCoverageNote(testModules.length, total)`, where `total` is a
best-effort `localVitest.globTestSpecifications().length` — a glob failure
degrades to a note with no "of M" rather than failing the call. `null` /
absent means the run was unscoped. `formatReportMarkdown` takes the note
as an optional third argument (mirroring `formatNoMatchMarkdown`'s
`filter`) and prints it after the project line, so the text summary and
the structured result agree that a filtered call's coverage verdict must
not be trusted: Vitest enforces `coverage.thresholds` against the
whole-project denominator no matter how many files ran, and the in-process
reporter has already suppressed the threshold check for the same reason
(see [./plugin.md](./plugin.md) *Partial-run detection*).

**`inventory({ kind: "tag" })`.** New input variant with an optional
`project` scope. The output union gains two distinct
`inventoryKind` literals to encode the asymmetric scoped vs unscoped
shapes — the input discriminator (`kind: "tag"`) does not match 1:1
with the output shape, mirroring the existing `session_detail` /
`session_list` precedent. `tag_scoped` (when `project` is supplied)
omits the per-project breakdown; `tag_unscoped` (when `project` is
omitted) carries a `byProject` array inline on every tag row with
per-project module + test counts. The MCP handler reads the SDK
reader's flat `(tag, project)` rows from `listTagInventory` and pivots
them by tag, aggregating module + test counts across projects in
alphabetical order. The `kind: "tag"` literal is served from the
`INVENTORY_KINDS` tuple the tool core exports (issue #335 — before
that the served `z.enum` omitted it and real clients could not reach
the variant; see *Server bootstrap*).

**`test({ action: "for_tag" })`.** Input variant that mirrors
`action: "for_file"`. Takes a `tag` plus optional `project`; returns
`TestRowSchema` rows grouped by project (one group per project carrying
the tag, or a single group when `project` is supplied). Delegates to
`DataReader.listTestsForTag`. Like `inventory`'s `tag` kind, the
`for_tag` literal and its `tag` field were handler-only until issue #335;
the served `oneOf` now derives from the union, and
`served-enum-drift.test.ts` asserts it against the exported `TEST_ACTIONS`
tuple.

## Test annotations and test artifacts

Vitest 5's `context.annotate` notes and `recordArtifact` payloads reach
agents through two `test` actions and one widened `test_errors` field.
Terminology matters here: a **test** artifact is not a **TDD** artifact —
see [../schemas.md](../schemas.md) *Vocabulary*. Both tool descriptions say
so explicitly, and `tdd_artifact_list`'s description points back at
`test({ action: "artifacts" })`, because the two are one word apart and an
agent picking the wrong one gets a plausible-looking empty result.

**`test({ action: "annotations" | "artifacts" })`.** Both take `fullName`
plus optional `project`, `modulePath` (disambiguating a `full_name` present
in more than one module) and `maxBytes`. Both delegate to
`DataReader.getAnnotationsForTest` / `getArtifactsForTest`, which are scoped
to the project's latest run, and default `project` to the most recent run's
project when omitted. Rows carry `id`, `type`, `message`, `location?` and
`attachments[]`; the artifact rows add the JSON `data` blob.

**Bodies are opt-in and budgeted.** `maxBytes` is a non-negative integer
total budget for **all** inline attachment bodies in one response and
defaults to `0`, so the default response is descriptors only —
`contentType`, `path`, `byteSize`. `applyBodyBudget` walks attachments in
order, charges each body its recorded `byteSize` (falling back to the stored
string's length for pre-0002 rows), and drops any body that would exceed the
budget along with its `bodyEncoding`; the descriptor half always survives,
so the row count and the shape of the response never depend on `maxBytes`.
See Decision 69 in [../decisions.md](../decisions.md).

**Markdown rendering.** Both actions render one table (Type / Message /
Location / Attachments). An artifact routinely carries its payload in `data`
and no message at all, so the message cell falls back to `data` rather than
printing an em dash over the row's only content. Cell values are flattened
(newlines to spaces, pipes escaped) and truncated at 200 characters — the
structured payload carries the untouched value.

**`test_errors` rows carry `annotations[]`.** Each row gains a projected
`{ type, message, location? }` list — the reader row's `id` and
`attachments` are deliberately dropped, because the `Toolkit` encoder
strips any key the `success` schema (`TestErrorRow`) does not declare. The handler reads once per distinct
`(testFullName, moduleFile)` pair and caches, since several errors routinely
share a test, and a non-test scope (`module` / `unhandled`) has no test to
annotate and gets an empty array without a query. The markdown formatter
prints an `**Annotations:**` list of `- [type] message` lines above the
cite-able IDs block.

## Caller-declared project root (`run_tests`)

The MCP server resolves its Vitest root **once, at boot** — `McpSession.cwd`,
from `main.ts`'s `resolveProjectDir` precedence — and one long-lived
server process serves every caller. In a git worktree that produced a false
green: an agent working in `../repo-feature` called `run_tests`, the server
ran the *other* tree, and the passing report came back with nothing in it
naming which tree it came from (issue #252).

**Optional, validated `projectRoot` input.** `run_tests` accepts an optional `projectRoot` that overrides `McpSession.cwd` for that call only. It is validated, not trusted, by `validateProjectRoot()` in `packages/mcp/src/tools/run-tests.ts`: the path must resolve to an existing directory, and it must share a git common directory with `McpSession.cwd`. A relative `projectRoot` resolves against `McpSession.cwd`, not the MCP server process's `cwd` — the server's cwd is a base the caller never chose and cannot see, so resolving against it would answer a question nobody asked. `resolveGitCommonDir()` shells `git rev-parse --git-common-dir`, which is identical across a repository and every worktree attached to it — unlike `--show-toplevel`, which differs per worktree and would reject exactly the sibling-worktree case the param exists for. Both candidates are then routed through `fs.promises.realpath`, because git prints a *relative* `.git` from a main worktree but an *absolute, symlink-resolved* path from a linked one; on macOS, where a tmpdir sits behind `/var` → `/private/var`, a genuine sibling worktree compared unequal without it. A path in a different repository, a non-existent path, or a non-directory returns the tool's `{ kind: "error" }` envelope naming **both** paths; `createVitest` is never reached. Omitting the param no longer resolves to `McpSession.cwd` unchanged: it anchors at the directory of the vitest/vite config Vitest would load anyway (see *Config-anchored default root* below). A supplied, validated `projectRoot` is used **verbatim** — explicit stays explicit, no anchoring applied.

**The root is always echoed.** `RunTestsOk` and `RunTestsNoMatch` both carry
a **required** `projectRoot`, populated whether or not the caller supplied
one, and `formatRunTestsMarkdown` renders a `Project root:` line on both
variants. This is the half that needs no new plumbing and no cooperating
client: even an agent that never passes `projectRoot` can see which tree
answered.

**Detect-and-refuse is deliberately not implemented.** The server cannot
observe the caller's cwd — it is one process, and nothing in the MCP call
carries it — so it has nothing to compare against and cannot tell a
worktree mismatch from a correct call. Supplying that signal is tracked in
issue #275: `_callerCwd` injected through the same
`hookSpecificOutput.updatedInput` channel
`plugins/claude-code/hooks/pre-tool-use/mcp-run-tests.sh` already uses for
`_sessionContext`. Two caveats are recorded there. It is unverified whether
a subagent's hook payload reports the subagent's cwd or the parent's. And
absence of the signal must mean *cannot tell* — not "proceed", not "refuse"
— because the MCP server is consumable without the Claude Code plugin, so a
missing `_callerCwd` is the normal case for a plugin-less client. See
[../decisions.md](../decisions.md) Decision 54.

## Config-anchored default root (`run_tests`)

Vitest finds the config *file* by walking UP from `root`, but resolves that config's relative `globalSetup` / `setupFiles` entries DOWNWARD from `resolved.root`. Those are independent inputs and `run_tests` let them diverge: `McpSession.cwd` was passed straight through as Vitest's `root`, so a server booted inside a monorepo package subtree loaded the repo-root `vitest.config.ts` while resolving that config's relative `globalSetup` against the subtree — a path that does not exist, and a run that collects zero tests (issue #259).

**Restated for Vitest 5.** Vitest 5's `findConfigFile(root)` (`node/config/resolveConfig.ts`) probes ONLY the given `root`; there is no ancestor walk any more. Under Vitest 4 a `root` pointing at a package subtree still found the repo-root config and then mis-resolved its relative `globalSetup` — the original #259 bug. Under Vitest 5 it finds NOTHING: the run boots on pure defaults, never loads `AgentPlugin`, writes no DB rows, and still reports success. The anchoring helpers therefore became *more* load-bearing, not less.

`resolveConfigAnchoredRoot(startDir)` in `packages/mcp/src/tools/run-tests.ts` closes the gap by walking up for the same config Vitest would load and returning the directory holding it: `vitest.config.*` before `vite.config.*` within each directory (Vitest's own preference order, across ts/mts/cts/js/mjs/cjs), first hit wins, bounded at the git root — `.git` is matched as a file *or* a directory so linked worktrees stop there too. Any miss, and anything that throws, returns `startDir` unchanged, so the degraded case is exactly the pre-fix behavior. It is wired into the `projectRoot === undefined` branch of `validateProjectRoot()` only.

A companion helper, `resolveAnchoredConfigFile(startDir)`, returns the config *path* from that same walk. The explicit-`projectRoot` branch — which must keep using the caller's root verbatim — passes that path as `createVitest`'s `config:` option, so an explicit root still gets the config Vitest 4 would have found for it. `config:` is populated end to end: every `run_tests` call now hands Vitest both a `root` and the anchored config path (or the supplied root's own config), rather than relying on Vitest to locate one.

**Caveat for callers.** An explicit `projectRoot` plus the anchored `config:` still resolves that config's relative `setupFiles` / `globalSetup` against the **supplied** root, not the config's own directory. Callers whose config uses relative setup paths should pass the directory that holds the config.

`McpSession.cwd` itself (from `main.ts`) was deliberately left alone: that value also keys the `data.db` path and other resolution, so anchoring it at the source would move far more than the Vitest root.

**Known limitation.** The nearest config wins. A package carrying a `vite.config.ts` purely for its library build would therefore capture the root even when the vitest config lives at the repo root. No package-level vite/vitest config like that exists in the repos this serves today, and an explicit `projectRoot` remains the escape hatch. See [../decisions.md](../decisions.md) Decision 56.

## Root-anchored `vitest/node` resolution

`run_tests` used to `await import("vitest/node")` with a bare specifier, which resolves relative to `@vitest-agent/mcp`'s OWN install location rather than the project under test. `vitest` is a peer dependency, and pnpm routinely materializes more than one *physical* instance of the same vitest version when peer-resolution hashes differ. Driving the wrong copy splits vitest's module-level `SnapshotClient` singleton: the runner calls `setup()` on copy A while `expect(...).toMatchSnapshot()` inside the test file reads copy B, so every snapshot assertion fails with `The snapshot state for '<file>' is not found` while every non-snapshot assertion passes (issue #303).

`resolveVitestNodeEntry(root)` resolves `vitest/node` through a `createRequire` anchored at the run's validated project root and returns a `file://` URL, falling back to the bare specifier when that throws (e.g. a project root with no local vitest install). The import goes through the `vitestLoader` indirection object rather than a bare `await import(...)`: vitest's vite-node only intercepts AST-literal `import("vitest/node")` call sites for `vi.mock`, so the computed specifier this fix requires bypasses mocking entirely and tests substitute `vitestLoader.load` by property assignment instead. See [../decisions.md](../decisions.md) Decision 55.

## Coverage facets in `test_coverage`

`packages/mcp/src/tools/coverage.ts` reads `DataReader.getCoverage` and
renders the three coverage-policy facets the reader now returns distinctly
(issue #237): the Totals table has a `Value` column, an **Enforced
threshold** column (the persisted Vitest `coverage.thresholds`; `—` when
the project never persisted any — no baseline is substituted) and, only
when targets were persisted, a **Target** column (the aspirational
`coverageTargets`). The pass/fail icon on each row keys off the enforced
threshold alone. Per-file output is split on the persisted
`file_coverage.tier`: **Coverage Gaps** lists `lowCoverage` ("files below
the enforced threshold (build-blocking)"), and a separate **Coverage
Improvements Needed** section lists `belowTarget` ("files below the
aspirational target (passing the enforced threshold)"), rendered by one
shared `renderFileCoverageTable` helper. `✅ All files meet coverage
thresholds.` is true against the enforced thresholds specifically — a file
can still appear under Improvements Needed. The previous single
`Threshold` column mislabeled whichever value the reader happened to
return, which is how an agent treated the target as the CI gate; see
Decision 58 in [../decisions.md](../decisions.md).

## Per-invocation coverage directory

`makeCoverageDirOverride()` in `packages/mcp/src/tools/run-tests.ts` gives
every `run_tests` invocation its own `mkdtemp` coverage
`reportsDirectory`, spread onto the `createVitest` overrides as a
field-level merge (`coverage: { reportsDirectory }`) so the user's
`coverage.enabled`, provider and thresholds all still apply.

**Why.** Vitest's v8 provider `rm -rf`s the shared `coverage/` reports
directory at run start (`clean: true` is the default). Two runs
concurrently in one checkout — an MCP `run_tests` alongside a Bash
`vitest run`, or two MCP calls — therefore delete each other's `.tmp`
files mid-flight and one of them dies with `ENOENT ... coverage-N.json`
(issues #159 / #191 / #194). A per-invocation directory removes the shared
resource entirely. The plain-CLI half of the same clobber — an agent's
Bash `vitest run` — is closed on the plugin side by
`resolveCoverageDirIsolation` in `AgentPlugin.configureVitest`, which
applies the same per-process `mkdtemp` rewrite for the `agent` executor
(see [./plugin.md](./plugin.md) *Coverage directory isolation* and
[../decisions.md](../decisions.md) Decision 62).

**Lifecycle.** The override is created *inside* the tool's `try`, not
before it, so a throwing `mkdtempSync` (full or read-only tmpdir) is caught
by the surrounding handler and returns the tool's normal
`{ kind: "error", message }` envelope instead of propagating raw out of the
handler. That handler is itself exception-safe — the
`err instanceof Error ? err.message : String(err)` read runs inside its
own `try`, falling back to `coerceErrorField(err, "message")` and a
`"<unserializable error>"` sentinel, so a hostile thrown value (a throwing
`message` getter) still produces the `{ kind: "error" }` envelope rather
than an `UnexpectedToolError` envelope. (The handler no longer probes for a timeout
sentinel — timeouts are classified upstream in the Effect pipeline; see
*`run_tests` timeout*.)
Cleanup is a best-effort `rmSync(..., { recursive: true, force: true })` in
`finally`; a failure there is swallowed and left to tmpdir reaping. The
`finally` nests — `await vitest?.close()` sits in an inner `try` whose own
`finally` destroys the null stream and removes the coverage tmpdir — so a
rejecting `close()` can no longer skip either cleanup and leak the
directory.

**Trade-off.** Final coverage artifacts (html, lcov) from MCP-driven runs
land in the throwaway directory rather than `./coverage`. That is
acceptable because the MCP path never reads coverage from disk:
`CoverageAnalyzer` consumes the in-memory `CoverageMap` via `onCoverage`
and persists to SQLite, which is what every MCP coverage tool reads.

## MCP boot context recovery

`main.ts` reads `process.env.VITEST_AGENT_*` at startup via `sessionContextFromEnv(env)` and seeds `McpSession.sessionContext` (a `SessionContextRef`). The `run_tests` tool reads from the ref before each Vitest invocation and mutates `process.env` so the spawned reporter inherits the canonical UUIDs.

The boot-time path works when Claude Code auto-sources `CLAUDE_ENV_FILE` into the MCP server child process — but that alone loses two races, both observed live: (a) on a fresh Claude Code launch the MCP child can spawn *before* the SessionStart hook writes `CLAUDE_ENV_FILE`, so even a full restart can boot with a null context; (b) `/reload-plugins` restarts the MCP mid-session with no session env at all. `createSessionContextRef(initial, recover)` therefore takes a lazy recovery thunk: when `get()` finds a null value it invokes the engine's `recoverSessionContextFromSessionEnv({ projectDir, homeDir })` (`packages/engine/src/programs/session-env.ts`; `homeDir` is `env.HOME ?? env.USERPROFILE` passed from `main.ts`) and caches the first non-null result. The recoverer reads the SessionStart hook's second, known-name surface — `~/.claude/session-env/<chat_id>/vitest-agent-hook.sh` — selecting the newest-mtime file whose `VITEST_AGENT_PROJECT_DIR` matches the server's `projectDir`. By first-tool-call time that file is reliably on disk. Recovery is best-effort and never throws; a null result falls through to the pre-existing null-context behavior.

**Accepted ambiguity:** two live Claude Code windows on the same project resolve to the newest session's exports. That is inherent to a per-project (not per-process) surface and is accepted — the alternative was no attribution at all.

The session map's `lookupByProjectDir` is the dev / test fallback when `CLAUDE_ENV_FILE` isn't available; the per-project `data.db` itself never reads from the session map at runtime. See [../data-flows.md](../data-flows.md) for the full attribution flow.

`register_agent` is the explicit-call recovery path: when boot-time
context recovery fails (no env vars set), the orchestrator can call
`register_agent` with its host metadata to establish the
`SessionContextRef` mid-session. This is the same flow the
SessionStart hook would have triggered via the `agent register-agent`
sidecar; the MCP tool reaches the same `DataStore.registerAgent` code path.

## MCP prompts

`packages/mcp/src/prompts/`. Framing-only prompts surface canonical
workflow primings as MCP prompts so a client can pick a workflow from a
menu and the agent receives the right framing without the user needing to
remember which tools to compose. Each prompt emits one or more templated
user messages.

**No tool data is pre-fetched on the server.** The prompt only orients
the agent; the agent then composes the tools (`triage_brief`,
`failure_signature_get`, `hypothesis`, etc.) as needed. This keeps the
server's prompt surface free of latency and side effects — prompt
selection on the client costs zero tool roundtrips, and the server never
reads the database while assembling a prompt response. The factories
(`triage.ts`, `why-flaky.ts`, `regression-since-pass.ts`,
`explain-failure.ts`, `tdd-resume.ts`, `wrapup.ts`) are pure and MUST NOT
call `DataReader` / `DataStore`.

**`PromptsLayer` (`prompts/layer.ts`)** is `Layer.mergeAll` of six
`McpServer.prompt({ name, description, parameters, content })` layers,
`Layer<never, never, McpSession>`. Prompt arguments are strings on the
wire, so every parameter is a `Schema.String`-based field annotated with
its `description` and wrapped in `Schema.optionalKey` when not required;
`McpServer.prompt` serves `required` from `SchemaAST.isOptional` and the
description from the field's annotation, so annotate the inner
`Schema.String` and then wrap it. `wrapup.kind` is
`Schema.Literals(WRAPUP_KINDS)` matching the `WrapupKind` variants the
engine's `format-wrapup` emits; an unknown kind is a `-32602` at prompt
selection. `content` maps each factory's `{ role: "user", content: { type:
"text", text } }` to `McpSchema.PromptMessage` via
`McpSchema.TextContent.make`. Each `McpServer.prompt` provides the static
`McpServer.layer` itself — the same memoized pattern
`registerStrictToolkit` uses — so all six share the registry the toolkit
registered into.

| Name | Args | Required | Server-side default |
| --- | --- | --- | --- |
| `triage` | `project` | — | none |
| `why-flaky` | `test`, `project` | `test` | — |
| `regression-since-pass` | `test`, `project` | `test` | — |
| `explain-failure` | `signature` | `signature` | — |
| `tdd-resume` | `sessionId` | — | `McpSession.sessionContext.get()?.chatId ?? McpSession.currentSessionId.get()`; both null → the factory's "inferred from recovered SessionContext" wording |
| `wrapup` | `kind`, `since` | — | `kind` → `user_prompt_nudge` |

`tdd-resume`'s session default is the one server-side input. Prompt
`title` cannot be set at rc.115 (`McpServer.prompt` constructs the `Prompt`
with only `name` / `description` / `arguments`), so the six lost their
titles on the wire; Claude Code surfaces prompts by name.
`prompts-layer.test.ts` pins the exact name list, per-prompt args and
`required` flags, the argument descriptions on the wire, the factory text
equivalence, and the `tdd-resume` default via `HarnessOptions.session`.

## Testing surface

`__test__/utils/harness.ts` builds the REAL `ServerLayer` over
`Stdio.layerTest` queues — no child process — so a test sees the exact
served schemas and wire results: `initialize(protocolVersion)`,
`listTools`, `callTool(name, args)`, `sendRequest(method, params)` (for
`prompts/list`, `prompts/get`), `sendNotification`, `seed` (populates the
same in-memory store the server reads), `session` (pins an `McpSession` —
a fixture `cwd`, a recovered context), `extraLayers`, and
`stderrSoFar` / `consoleLogSoFar` / `rawStdoutSoFar`. Two facts a
harness user must know: the test Stdio has to be provided *innermost*
because `DataStoreTestLayer` carries `NodeServices.layer`, whose real
process `Stdio` would otherwise win the merge and leave the server
listening on the vitest worker's stdin; and Effect's default logger writes
via `console`, never via the `Stdio` service, so the harness routes
logging into its stderr buffer (`References.CurrentLoggers`) — a "nothing
on stderr" assertion through `Stdio.layerTest` alone is vacuous.

`__test__/utils/caller.ts`'s `makeCaller(runtime, session?)` decodes params
through the tool's schema and invokes `toolHandlers[name]` directly for
handler-level assertions with full type narrowing (`tool-handlers.test.ts`
carries the ~110 handler cases: `run_tests` mkdtemp fault injection,
hypothesis binding precedence, the phase-transition validator matrix).
`utils/mcp-process.ts` (`spawnMcp`, `makeScratchProject`, `handshake`)
spawns the built bin for `server-lifecycle.e2e.test.ts` (handshake,
empty stderr, exit 0 within 2 s of stdin close, startup failure → exit 1)
and `bin-crash-resilience.e2e.test.ts` — rebuild `dist/dev` first. Tests
use plain vitest + `Effect.runPromise(Effect.scoped(...))`;
`@effect/vitest` is not a dependency. See
[../testing-strategy.md](../testing-strategy.md).
