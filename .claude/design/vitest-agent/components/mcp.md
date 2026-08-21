---
status: current
module: vitest-agent
category: architecture
created: 2026-05-06
updated: 2026-08-21
last-synced: 2026-08-21
completeness: 93
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ../schemas.md
  - ./sdk.md
  - ./cli.md
  - ./plugin-claude.md
dependencies: []
---

# MCP package (`@vitest-agent/mcp`)

Model Context Protocol server providing tool and prompt surfaces for agent
integration. Uses `@modelcontextprotocol/sdk` over stdio transport. Tool
routing goes through tRPC; prompts register directly with the MCP SDK
alongside the tRPC router.

**npm name:** `@vitest-agent/mcp`
**Bin:** `vitest-agent-mcp`
**Location:** `packages/mcp/`
**Internal dependencies:** `@vitest-agent/sdk`

A separate package for module-boundary reasons and so the MCP tool
surface can evolve on its own cadence — not for install-cost reasons.
The plugin declares `@vitest-agent/mcp` as an exact-pinned regular
`dependency`, so every plugin consumer installs
it; an MCP server that is downloaded but never started costs a
non-Claude-Code user only a download. The `@modelcontextprotocol/sdk` /
tRPC / zod stack staying in its own package is a boundary decision
(those dependencies are the MCP server's concern alone), not an opt-out
for users who skip the server.

For the surfaces this package exposes to the Claude Code plugin, see
[./plugin-claude.md](./plugin-claude.md). For the data layer it reads from
and writes to, see [./sdk.md](./sdk.md).

For decisions: [../decisions.md](../decisions.md) D11/D12/D13 (TDD
hierarchy and capability-vs-scoping), D35 (framing-only prompts surface),
D7 (artifact write authority), 50 (strict tool inputs), 51 (post-connect
crash survival).

---

## Server bootstrap

`packages/mcp/src/bin.ts`. Resolves the user's `projectDir` via the
precedence: `VITEST_AGENT_REPORTER_PROJECT_DIR` (set by the plugin loader)
→ `CLAUDE_PROJECT_DIR` → `process.cwd()`. Then resolves `dbPath` via
`resolveDataPath(projectDir)` under `PathResolutionLive(projectDir) +
NodeServices.layer`, creates `ManagedRuntime.make(McpLive(dbPath, ...))`,
and calls `startMcpServer({ runtime, cwd: projectDir })`.

`packages/mcp/src/index.ts` exports `CURRENT_MCP_VERSION` (inlined from `process.env.__PACKAGE_VERSION__` via the package's `rslib.config.ts` `define`), part of the public API. Under the earlier lockstep design the bin compared it against `CURRENT_SDK_VERSION` inside `main()` and warned on mismatch; that drift check (and its `bin-version-drift.test.ts` coverage) was removed with the move to independent per-package versioning, so the bin now boots straight into `ManagedRuntime.make`. See D36 in [../decisions.md](../decisions.md).

The `VITEST_AGENT_REPORTER_PROJECT_DIR` precedence is load-bearing: Claude
Code does not reliably propagate `CLAUDE_PROJECT_DIR` to MCP server
subprocesses, so the plugin loader passes it through this dedicated env
var. See [./plugin-claude.md](./plugin-claude.md) for the loader side.

`server.ts` splits the bootstrap in two: `buildMcpServer(ctx)` constructs the fully-registered `McpServer` — all tRPC-backed tools registered with the MCP SDK using zod input schemas, then `registerAllPrompts(server)` — without connecting a transport; `startMcpServer(ctx)` builds via `buildMcpServer` and connects `StdioServerTransport`. Both are exported from `index.ts` (alongside `parseSessionEnvExports` / `recoverSessionContextFromSessionEnv`, see *MCP boot context recovery* below).

The split is a testability seam with a hard-won rationale: **every tool input is registered twice** — the tRPC input schema in `tools/<name>.ts` and the MCP-SDK `inputSchema` in `server.ts`, hand-synced. A missed sync is invisible to router-level caller tests: a field the SDK registration never declares or forwards is simply unreachable from a real MCP client even though the tRPC procedure handles it (this is exactly how the `hypothesis` `tddTaskId` binding shipped dead on arrival, and how `run_tests`'s `tags` / `passWithNoTests` inputs stayed unreachable until issue #200). `buildMcpServer` lets tests connect the identical server to an `InMemoryTransport` client and assert the *served* tool schemas and descriptions — see `packages/mcp/__test__/server-hypothesis-schema.test.ts` and the served-schema pattern in [../testing-strategy.md](../testing-strategy.md).

## Strict tool input schemas

Every `registerTool` `inputSchema` in `server.ts` is built by the local
`strict(shape)` helper rather than passed as a bare zod raw shape. The
helper wraps the shape in `z.strictObject` with a custom
`unrecognized_keys` error message that names both the offending key(s)
and the full accepted-param list.

**Why (issue #200).** A bare raw shape is non-strict: the MCP SDK
silently strips any key the schema does not declare. An agent that
misspells a parameter, or passes one the served schema forgot to
declare, therefore gets a *successful* result computed from a
different, wider filter set than it asked for — `run_tests` would run
the whole workspace and report green while the agent believed it had
scoped the run. Failing loudly is strictly better than a silently
widened query, and naming the accepted params in the error lets the
agent self-correct without re-reading the tool description.

The rule is all-or-nothing on purpose: a partially strict surface
teaches agents that unknown-key rejection is per-tool luck. All 26
parameterized tools go through the helper, including `acceptance_metrics`
whose shape is empty (`strict({})`); the four that declare no
`inputSchema` at all (`help`, `cache_health`, `settings_list`, `ping`)
have nothing to strip and stay as they are.

**Strictness applies at every nesting level, not just the top one
(issue #243).** The first pass wrapped only the outermost shape, which
left the same hole one level down: `run_tests` declared its `tags` and
`_sessionContext` sub-shapes as plain `z.object`s, and a plain
`z.object` strips unknown keys exactly like a bare raw shape. A
misspelled nested key — `{ tags: { anyy: ["unit"] } }` — decoded to
`{ tags: {} }`, the filter vanished, and the run went wide across the
whole workspace while the top-level strict wrapper reported nothing
wrong. That is the identical failure mode issue #200 fixed, one level
deeper, and it is worse for being invisible to a top-level rejection
test. Nested shapes now go through the same `strict` helper.

The regression guard for that is structural rather than table-driven:
`server-strict-schemas.test.ts` lists the tools over a real
`InMemoryTransport` client and walks each *served* JSON Schema —
recursing through `properties`, `anyOf` / `oneOf` / `allOf` /
`prefixItems`, `items`, and `$defs`, since zod wraps optionals and
arrays rather than inlining the object node — asserting
`additionalProperties: false` on every object node it finds. It reports
the offending paths rather than a bare boolean. Two reasons for the
sweep over more table rows: it covers tools a unit suite cannot safely
*call* (`run_tests` actually runs tests), and it keeps covering nested
shapes added later without anyone remembering to extend a case list.
The four no-`inputSchema` tools are the documented carve-out — the SDK
synthesizes a bare `{ type: "object" }` for them, which has no declared
params to strip.

Validation happens inside the MCP SDK's `validateToolInput` step, which
throws before the tool handler runs — a rejected call never reaches a
`DataReader` / `DataStore` call. Coverage lives in
`packages/mcp/__test__/server-strict-schemas.test.ts`: a table of
`(tool, minimal-valid-args)` pairs driven through a real
`InMemoryTransport` client, asserting twice per tool — that a bogus extra
key is rejected with an error naming that key, and that the same call
*without* the bogus key is not rejected on schema shape. The second
assertion is the guard against over-correcting: a strictness pass that
starts rejecting documented params is a worse bug than the one it fixed.
`run_tests` has its own served-schema e2e suite and is covered there. See
[../decisions.md](../decisions.md) Decision 50.

## Crash resilience

Issue #191, sub-item A; [../decisions.md](../decisions.md) Decision 51.
Two independent layers, addressing two different failure modes — do not
conflate them.

**Process-level guards (`bin.ts`).** The bin was a bare
`main().catch(...)`. Under Node >= 15 an unhandled promise rejection
anywhere outside a tool call's own await chain — a fire-and-forgotten
Effect fiber, a background timer — kills the process, closing the stdio
transport and silently deregistering every tool from the client's
perspective mid-session, with no recovery path. `bin.ts` now registers
`unhandledRejection` (log to stderr, stay alive) and
`uncaughtException` handlers at **module scope**, before any async work
in `main()`, so they also cover the `dbPath` resolution /
`ManagedRuntime` construction phase.

The `uncaughtException` policy is a deliberate departure from Node's
"do not resume normal operation" guidance, isolated in the pure
`shouldExitOnUncaughtException(transportConnected)` predicate
(`packages/mcp/src/utils/crash-guards.ts`) so the judgment call is
testable and documented in one place: exit before the transport
connects (no client session exists to preserve, and spinning in a
half-initialized state is worse than failing loudly), survive after.
Surviving is acceptable because this process holds no long-lived
mutable state outside SQLite's own transactions — every
`DataStore` / `DataReader` call is self-contained through the shared
`ManagedRuntime` — so a throw that escapes even the SDK's per-call
try/catch cannot leave the *next* call's bookkeeping half-mutated. The
alternative, silent process death mid-TDD-session, is the exact bug
being fixed.

**The crash handler must not be crashable (issue #243).** The handlers
originally called the SDK's `formatFatalError` directly, which reopened
the hole they exist to close: that formatter *introspects* the value it
is handed — `Symbol.for(...) in reason`, `err instanceof Error`,
`JSON.stringify(err)` — and every one of those is hijackable by a
`Proxy` whose `has` / `getPrototypeOf` / `get` trap throws. A throw
inside an `uncaughtException` handler is fatal with no second chance to
report it, so a hostile (or merely exotic) thrown value would kill the
session the guard was protecting. All three call sites in `bin.ts` now
go through `safeFormatFatalError`
(`packages/mcp/src/utils/safe-format-fatal-error.ts`), which try/catches
the formatter and falls back to the exported `UNFORMATTABLE_ERROR_TEXT`
constant. The fallback is a constant on purpose: anything derived from
the offending value could throw again on the recovery path.

`bin.ts` also carries an env-gated, fires-once test hook
(`VITEST_AGENT_MCP_TEST_INJECT_CRASH`, accepting `unhandledRejection`
or `uncaughtException`) scheduled on the event-loop turn after the
transport connects. A crash in the test's own process is not something
a unit test can safely simulate, so the guards are proved against a
real spawned bin over a real stdio transport — see
`packages/mcp/__test__/bin-crash-resilience.e2e.test.ts`.

**Structured envelope for resolver throws (`server.ts`).** Defense in
depth, not the primary fix: the MCP SDK's own `CallToolRequestSchema`
handler already try/catches every tool resolution, so an in-boundary
throw was never going to crash the process — it just degraded to the
SDK's bare, untyped `createToolError` text. `buildMcpServer` shadows
the `McpServer` **instance's** `registerTool` with a wrapper that
catches resolver throws and returns
`buildUnexpectedToolErrorEnvelope(name, err)` from
`packages/mcp/src/utils/tool-error-envelope.ts` — the same
`{ ok: false, error: { _tag: "UnexpectedToolError", tool, message,
remediation } }` success-shape used by the TDD error envelope below —
with `isError: true` set, which is also what lets the envelope skip the
SDK's `validateToolOutput` check so it never has to match each tool's
own `outputSchema`.

Shadowing the instance property (rather than declaring a typed wrapper
function) is intentional: the SDK's `ZodRawShapeCompat | AnySchema`
registration union is not part of its public export surface, so
reproducing that signature would be guesswork. A property assigned on
the instance changes runtime behavior for every subsequent call while
TypeScript still checks each call site against the unshadowed
`McpServer` type — zero loss of per-tool `inputSchema` / `outputSchema`
inference. The envelope builder coerces the thrown value defensively
(a getter-backed `.message` can itself throw), mirroring the SDK's
`coerceErrorField`.

That coercion is hardened the same way as the crash handlers: the
*outer* guard matters as much as the inner one, because `err instanceof
Error` walks the prototype chain (hijackable by a `getPrototypeOf`
trap) and `String(err)` invokes `Symbol.toPrimitive` / `toString`
(hijackable too) — a throw from either escapes the envelope builder
entirely and the agent gets nothing structured back, the exact
degradation this module exists to prevent. The whole coercion body now
sits inside one try/catch, a non-string `.message` is stringified
rather than returned as-is, and the last-resort return is a constant.

## tRPC router and tools

The router (`router.ts`) aggregates every tool procedure. The context
(`context.ts`) carries a `ManagedRuntime` so procedures can call Effect
services via `ctx.runtime.runPromise(effect)`. The context module also
exports the underlying `t` instance (`middleware`, `router`,
`publicProcedure`) so the idempotency middleware can share it rather than
constructing a parallel `t`.

Tools are organized by surface area in `packages/mcp/src/tools/` — one
file per tool — and broadly group into:

- **Read-only queries.** The test-landscape and diagnostic tools (status,
  overview, coverage, history, trends, errors, file-coverage, ping,
  turn-search, failure signatures, acceptance metrics, commit changes,
  settings). Schema-driven structured outputs (see below). One file per
  tool in `packages/mcp/src/tools/`.
- **Action-keyed consolidated tools.** Each per-CRUD family collapses
  to one tool, discriminated on an `action` (or `kind`) literal:
  - `inventory` — replaces `project_list` / `module_list` /
    `suite_list` / `session_list` / `session_get`. `action`
    discriminates on `inventoryKind`.
  - `test` — replaces `test_list` / `test_get` / `test_for_file`.
  - `note` — replaces `note_create` / `note_list` / `note_get` /
    `note_update` / `note_delete` / `note_search`.
  - `hypothesis` — replaces `hypothesis_record` /
    `hypothesis_validate` / `hypothesis_list`.
  - `tdd_task` — replaces `tdd_session_start` / `tdd_session_end` /
    `tdd_session_get` / `tdd_session_resume`.
  - `tdd_goal` — replaces `tdd_goal_create` / `tdd_goal_update` /
    `tdd_goal_delete` / `tdd_goal_get` / `tdd_goal_list`.
  - `tdd_behavior` — replaces `tdd_behavior_create` /
    `tdd_behavior_update` / `tdd_behavior_delete` /
    `tdd_behavior_get` / `tdd_behavior_list`.
- **Standalone TDD tools.** `tdd_phase_transition_request` (the
  headline write — see *Phase-transition guards* below),
  `tdd_artifact_list` (used by the orchestrator to find artifact ids
  without shelling out to sqlite3 — see *Phase-transition
  auto-resolve*).
- **Agent registration.** `register_agent` is invoked by the MCP
  client (the orchestrator) once at boot when SessionContext recovery
  from env produces a no-op (e.g., MCP running without
  `CLAUDE_ENV_FILE` auto-source). Goes through the idempotency
  middleware.
- **Triage / wrapup.** `triage_brief` and `wrapup_prompt` delegate
  verbatim to the shared `format-triage` / `format-wrapup` generators
  in `packages/sdk/src/lib/`. CLI and MCP outputs are byte-identical.
- **Mutations.** `run_tests` runs Vitest in-process via `createVitest`
  from `vitest/node`. Mutates `process.env` from the `SessionContextRef`
  before `createVitest` so the in-process reporter sees current
  attribution. Accepts a structured `tags` filter and a per-call
  `passWithNoTests` override; emits a fourth `no-match` discriminator
  variant when the resolved filter set matches zero tests, and echoes
  the filter set it actually ran under on `RunTestsOk.scope`. The `reason`
  it computes from module states is preliminary — `buildAgentReport`
  self-corrects it to `"failed"` when the walk finds failed files or
  unhandled errors, so a hook-only or collection-only failure cannot
  report green. Also accepts an optional, validated `projectRoot` that
  overrides the boot-time `ctx.cwd` for one call, and always echoes the
  root it actually ran under. See *Tag filtering and tag introspection*
  below, *Caller-declared project root* for the worktree case, and
  *Per-invocation coverage directory* for the temp-dir isolation.

Both `set_current_session_id` and `get_current_session_id` are
**removed**. The MCP server's `SessionContextRef` populates from
`process.env.VITEST_AGENT_*` at boot (see *MCP boot context recovery*
in [../data-flows.md](../data-flows.md)) and `run_tests` reads from
the ref before each Vitest invocation. The orchestrator no longer
needs to push session ids back through MCP — env propagation does
the work.

## Schema-driven structured outputs

Most tools emit `structuredContent` per MCP 2025-06-18 spec, with
`outputSchema` declared via an Effect Schema → JSON Schema → zod bridge at
`packages/mcp/src/utils/effect-to-zod.ts`. The bridge:

1. Runs `Schema.toJsonSchemaDocument(EffectSchema)` against the tool's output
   type (the v4 JSON-Schema emitter; it returns
   `{ dialect, schema, definitions }`).
2. Inlines all `$ref`s from `definitions` before handing the result to
   zod 4's `z.fromJSONSchema` (the SDK's object-only requirement does not
   accept refs, and zod's experimental `fromJSONSchema` does not resolve them
   either).
3. Wraps non-object zod roots in `z.object({}).catchall(z.unknown())`
   so `Schema.Union` outputs (e.g., the discriminated-action tool
   results) pass through.

A `structuredResult` helper provides dual-channel output: the tool
returns Markdown for the `content` field (the human-friendly path)
and the same data as `structuredContent` (the agent-readable path).
The Markdown formatter is co-located in each tool file (e.g.,
`formatTddTaskMarkdown(data)`).

Effect schemas carry `title`, `description`, and `examples`
annotations so the generated JSON Schema is informative without an
extra OpenAPI layer.

The `help` tool surfaces these groupings to clients.

The MCP server exposes tools for every major surface area of the data
layer; the per-tool details (parameters, output shape) are read directly
from each `tools/<name>.ts` source file rather than catalogued here.

## TDD error envelope

`packages/mcp/src/tools/_tdd-error-envelope.ts`. Catches the typed TDD
errors (from `@vitest-agent/sdk`'s `TddErrors`) at the MCP boundary and
surfaces them as success-shape `{ ok: false, error: { _tag, ...,
remediation: { suggestedTool, suggestedArgs, humanHint } } }` responses.
This matches the existing `tdd_phase_transition_request` `{ accepted:
false, denialReason, remediation }` precedent.

tRPC `TRPCError` envelopes are reserved for transport-level failures.
Domain errors with remediation hints come through the success-shape
envelope so the agent's tool-result handling stays uniform.

## Idempotency middleware

`packages/mcp/src/middleware/idempotency.ts`. tRPC middleware that wraps a
mutation procedure and makes duplicate calls a no-op at the database
layer. An MCP agent that retries a write tool (network blip, restarted
client, partial delivery) gets the cached result back instead of
double-writing.

**Flow:**

1. Look up the input-derived key in
   `DataReader.findIdempotentResponse(procedurePath, key)`.
2. If a cached `result_json` exists, parse and return it with
   `_idempotentReplay: true` attached so callers can distinguish replays
   for telemetry without the tool surface changing.
3. Otherwise call `next()`, then persist the result via
   `DataStore.recordIdempotentResponse` (`INSERT ... ON CONFLICT DO
   NOTHING` so a parallel insert race resolves to a no-op).
4. Persistence errors are **swallowed**. A transient DB failure during the
   write step must not surface as a tool error to the agent. The cached
   row will simply not exist on the next call, and the procedure will run
   again — worst case is two idempotent writes instead of one cache hit.

`idempotentProcedure` is a drop-in for `publicProcedure` with the
middleware pre-applied. New mutation tools that should be idempotent
declare with `idempotentProcedure` and register a per-procedure
`derive(input) => string` in `idempotencyKeys`.

The middleware uses the **same** tRPC instance as `publicProcedure` (via
the `middleware` export from `context.ts`) rather than constructing a
parallel `t`. Sharing the instance keeps the context type aligned.

**What is and isn't idempotent.** `register_agent`, `hypothesis`'s `validate` action, `tdd_task`'s `start` / `end` actions and the `create` actions inside `tdd_goal` and `tdd_behavior` derive a key. `hypothesis`'s `record` action does **not** — a hypothesis is an append-only observation whose binding session is resolved server-side (see *Hypothesis session binding* below), leaving no safe per-call discriminator. The `tdd_phase_transition_request` tool, every `update` / `delete` / `get` / `list` action, and `tdd_progress_push` are intentionally **not** registered — see [../decisions.md](../decisions.md). State-dependent reads, intentional state transitions, and destructive ops are not idempotent in the cache-replay sense. The `idempotencyKeys` registry's per-procedure `deriveKey` returns null for non-idempotent actions, branching on `input.action`.

**`tdd_task` idempotency key (action: `start`).** Derived from
`runId` when present: `sid:<sessionId>:run:<runId>` or
`cc:<chatId>:run:<runId>`. When `runId` is absent (legacy callers),
the key falls back to goal text: `sid:<sessionId>:<goal>` or
`cc:<chatId>:<goal>`. The `runId`-based keying lets the same goal
be retried within the same CC session (the main agent generates a fresh
`runId` at each dispatch) without triggering the cache replay.

**`tdd_task({ action: "start" })` accepts `runId`.** The tool's
optional `runId` input is forwarded to `DataStore.writeTddTask`.
When provided, `run_id` is stored in `tdd_tasks` and the partial
unique index on `(session_id, run_id)` gives database-level
deduplication. When omitted, `run_id` is stored as NULL; the partial
index does not cover NULL rows, so only the middleware goal-text
cache (`cc:<chatId>:<goal>`) provides idempotency. The tool
returns `runId: undefined` when the caller did not supply one.

## Hypothesis session binding

`hypothesis (action: record)` resolves its binding session server-side rather than trusting a caller-guessed `sessionId`. Resolution precedence:

1. **`tddTaskId` (preferred, deterministic).** The orchestrator always holds the unambiguous id returned by `tdd_task (action: start)`; the server resolves the session the task was opened under via `DataReader.getSessionByTddTaskId`, ignoring the recovered host context entirely. An unknown `tddTaskId` is a hard typed failure, not a silent misattribution. Both registration sides accept a number **or a numeric string** (a `Schema.Number | FiniteFromString` union on the tRPC side, `z.coerce.number` on the MCP SDK side) because LLM callers routinely stringify numeric tool inputs — a bare number schema silently dropped the deterministic branch. `FiniteFromString` is deliberate over `NumberFromString`: a genuinely non-numeric string still fails validation instead of coercing to `NaN`.
2. **Recovered host context.** The long-lived MCP server's context always names the main agent's `chatId`; the server resolves the main session via `DataReader.getSessionByChatId`, then attributes to the active (un-ended) subagent child from `DataReader.findActiveSubagentSession` when one exists, else the main session.
3. **Caller-supplied `sessionId`**, honored only when no host context was recovered (dev / test paths).

The served tool description in `server.ts` is part of this contract — it is the text the model actually reads, and the earlier description steered callers toward `sessionId`. It now steers toward `tddTaskId` and explicitly warns against passing a `tddTaskId` value under the `sessionId` key. The dual-registration hand-sync failure that made the `tddTaskId` branch unreachable is the motivating case for the `buildMcpServer` served-schema tests (see *Server bootstrap*).

**`action: "validate"` timestamps itself.** `validatedAt` is
`Schema.optional` on the tRPC variant and `z.optional` on the served
schema, and the handler defaults an omitted value to
`new Date().toISOString()`; an explicitly supplied value is honored
verbatim. The two registrations had drifted the other way — the Effect
schema required the field while the served zod schema advertised it as
optional, so a caller that believed the served schema got its call rejected
after the bridge coerced the missing value with `as string` (issue #246).
This is the same dual-registration hazard as the `tddTaskId` case, caught
one layer lower. The `format-wrapup` nudge in `@vitest-agent/sdk` and the
`help` tool text were updated to stop telling callers to synthesize a
timestamp.

`tdd_progress_push` is registered directly with the MCP SDK because it
forwards to a Claude Code notification channel rather than returning data
through the tRPC tool path. The MCP server validates the payload against
the `ChannelEvent` discriminated union from `@vitest-agent/sdk`, then for
behavior-scoped events resolves `goalId` and `sessionId` **server-side**
from `behaviorId` (via `DataReader.resolveGoalIdForBehavior` and the
goals→sessions FK).

This server-side resolution exists so that a stale orchestrator context
cannot push the wrong tree coordinates. Even if the orchestrator's mental
model of the goal/behavior hierarchy drifts, the MCP server resolves
coordinates from the database. Resolution is best-effort; malformed JSON
or DB read failures fall through with the original payload.

Best-effort delivery: the tool returns `{ ok: true }` regardless of
whether channels are active.

## Phase-transition guards

`tdd_phase_transition_request` is the headline TDD write. The MCP layer
wraps the pure `validatePhaseTransition` function from the SDK with three
pre-checks performed before the validator runs:

1. Goal status check (rejects if the goal isn't `in_progress`).
2. Behavior membership check (rejects if a `behaviorId` doesn't belong to
   the requested goal).
3. The existing D2 evidence-binding rules — applied via the pure
   validator.

On accept with a `behaviorId`, the server **auto-promotes** the behavior
`pending → in_progress` in the same SQL transaction as `writeTddPhase` so
the phase ledger and behavior status never desync. The orchestrator is
only responsible for the final `done` transition via
`tdd_behavior({ action: "update" })`.

The `DenialReason` union covers both pre-check rejections and the
validator's existing reasons, so denials are uniform from the agent's
perspective.

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
`sqlite3` from a hook script.

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
irrelevant to the question being asked (issue #212). The served schema
and the tRPC input now both accept optional `testName`, `modulePath`,
and `limit`, pushed down to `DataReader.getHistory`'s
`HistoryQueryOptions` as SQL predicates rather than filtered
client-side. `limit` caps runs kept **per test** (default 20), not total
rows — see [./sdk.md](./sdk.md) for why a flat row LIMIT would starve
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
values through the SDK's `ClassificationQueryOptions`, and `hasData` is
therefore a statement about the requested scope.

`limit` is validated as a positive integer on both registrations rather
than accepted as a bare number: `Schema.Int` checked greater-than-zero
on the tRPC input, `z.coerce.number().int().positive()` on the served
schema. `0`, `-1`, and `1.5` used to flow straight into the window
query's `rn <= limit` predicate and return an empty history —
indistinguishable, to the agent, from "this test has never run". A
rejected input is the only honest answer.

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

Vitest 4.1 native tags are the way agents target test subsets
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
the tRPC input only — the served MCP `inputSchema` never advertised or
forwarded them, so a real client's tag filter was silently stripped and
the run went wide. Both are now declared in `server.ts` and forwarded to
the caller; the served-schema tests
(`packages/mcp/__test__/server-run-tests-schema.e2e.test.ts`) assert the
declaration, and the strict-schema layer above turns the *next*
misspelling into a rejection instead of a silent widening.

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

**`run_tests` `discoveryLastScannedAt` observability.** `RunTestsOk` carries an optional `discoveryLastScannedAt: string | null` — the ISO timestamp of the most recent real disk scan `discoverProjects()` performed in this process, or `null` when discovery has not scanned disk in this process (e.g. a config that never calls `AgentPlugin.discover()`). It lets an agent tell a stale-looking test count apart from a fresh scan (issue #100). The value is read via `readDiscoveryLastScannedAt()` in `packages/mcp/src/tools/run-tests.ts` from the process-global `Symbol.for("vitest-agent:discovery:last-scan-at")` slot that `@vitest-agent/plugin` writes on every real scan. The Symbol handshake exists because `@vitest-agent/mcp` cannot import `@vitest-agent/plugin` (the plugin depends on mcp, so a reverse import is circular); `createVitest` loads `vitest.config.ts` in-process, which calls `discoverProjects()`, so both sides observe the same slot by the time the result is built. Mirrors the `ensureMigrated` globalThis-keyed pattern (Decision 28). See [../decisions.md](../decisions.md) Decision 43.

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
alphabetical order.

**`test({ action: "for_tag" })`.** New input variant that mirrors
`action: "for_file"`. Takes a `tag` plus optional `project`; returns
`TestRowSchema` rows grouped by project (one group per project carrying
the tag, or a single group when `project` is supplied). Delegates to
`DataReader.listTestsForTag`.

## Caller-declared project root (`run_tests`)

The MCP server resolves its Vitest root **once, at boot** — `ctx.cwd`, from
`packages/mcp/src/bin.ts`'s `projectDir` precedence — and one long-lived
server process serves every caller. In a git worktree that produced a false
green: an agent working in `../repo-feature` called `run_tests`, the server
ran the *other* tree, and the passing report came back with nothing in it
naming which tree it came from (issue #252).

**Optional, validated `projectRoot` input.** `run_tests` accepts an optional
`projectRoot` that overrides `ctx.cwd` for that call only. It is validated,
not trusted, by `validateProjectRoot()` in
`packages/mcp/src/tools/run-tests.ts`: the path must resolve to an existing
directory, and it must share a git common directory with `ctx.cwd`. A
relative `projectRoot` resolves against `ctx.cwd`, not the MCP server
process's `cwd` — the server's cwd is a base the caller never chose and
cannot see, so resolving against it would answer a question nobody asked.
`resolveGitCommonDir()` shells `git rev-parse --git-common-dir`, which is
identical across a repository and every worktree attached to it — unlike
`--show-toplevel`, which differs per worktree and would reject exactly the
sibling-worktree case the param exists for. Both candidates are then routed
through `fs.promises.realpath`, because git prints a *relative* `.git` from a
main worktree but an *absolute, symlink-resolved* path from a linked one; on
macOS, where a tmpdir sits behind `/var` → `/private/var`, a genuine sibling
worktree compared unequal without it. A path in a different repository, a
non-existent path, or a non-directory returns the tool's `{ kind: "error" }`
envelope naming **both** paths; `createVitest` is never reached. Omitting the
param resolves to `ctx.cwd` unchanged — the historical behavior, never
inferred and never silently redirected.

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
`plugin/hooks/pre-tool-use/mcp-run-tests.sh` already uses for
`_sessionContext`. Two caveats are recorded there. It is unverified whether
a subagent's hook payload reports the subagent's cwd or the parent's. And
absence of the signal must mean *cannot tell* — not "proceed", not "refuse"
— because the MCP server is consumable without the Claude Code plugin, so a
missing `_callerCwd` is the normal case for a plugin-less client. See
[../decisions.md](../decisions.md) Decision 54.

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
resource entirely.

**Lifecycle.** The override is created *inside* the tool's `try`, not
before it, so a throwing `mkdtempSync` (full or read-only tmpdir) is caught
by the surrounding handler and returns the tool's normal
`{ kind: "error", message }` envelope instead of propagating raw out of the
tRPC resolver. That handler is itself exception-safe — the `err instanceof
Error && err.message` timeout probe runs inside its own `try`, falling back
to `coerceErrorField(err, "message")` and a `"<unserializable error>"`
sentinel, so a hostile thrown value (a throwing `message` getter) still
produces the `{ kind: "error" }` envelope rather than a raw tRPC rejection.
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

The MCP server entry (`packages/mcp/src/bin.ts`) reads `process.env.VITEST_AGENT_*` at startup via `sessionContextFromEnv` and populates `McpContext.sessionContext` (a `SessionContextRef`). The `run_tests` tool reads from the ref before each Vitest invocation and mutates `process.env` so the spawned reporter inherits the canonical UUIDs.

The boot-time path works when Claude Code auto-sources `CLAUDE_ENV_FILE` into the MCP server child process — but that alone loses two races, both observed live: (a) on a fresh Claude Code launch the MCP child can spawn *before* the SessionStart hook writes `CLAUDE_ENV_FILE`, so even a full restart can boot with a null context; (b) `/reload-plugins` restarts the MCP mid-session with no session env at all. `createSessionContextRef(initial, recover)` therefore takes a lazy recovery thunk: when `get()` finds a null value it invokes `recoverSessionContextFromSessionEnv({ projectDir })` (`packages/mcp/src/session-env.ts`) and caches the first non-null result. The recoverer reads the SessionStart hook's second, known-name surface — `~/.claude/session-env/<chat_id>/vitest-agent-hook.sh` — selecting the newest-mtime file whose `VITEST_AGENT_PROJECT_DIR` matches the server's `projectDir`. By first-tool-call time that file is reliably on disk. Recovery is best-effort and never throws; a null result falls through to the pre-existing null-context behavior.

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
`failure_signature_get`, `hypothesis_record`, etc.) as needed. This keeps
the server's prompt surface free of latency and side effects — prompt
selection on the client costs zero tool roundtrips, and the server never
reads the database while assembling a prompt response.

The prompt set covers triage, flaky-test diagnosis, regression-since-pass
investigation, failure-class explanation, TDD-resume orientation, and
session wrap-up. Each prompt advertises in its description the tools it
expects the agent to compose.

The `wrapup` prompt's `kind` argument is a closed `z.enum([...])` matching
the `WrapupKind` variants the `format-wrapup` library generator emits;
the registrar narrows `args.kind` before forwarding to the factory.

## McpLive composition layer

`packages/mcp/src/layers/McpLive.ts`. Composes `DataReaderLive`,
`DataStoreLive`, `ProjectDiscoveryLive`, `OutputPipelineLive`,
`SqliteClient`, `SqliteMigrator`, and `NodeServices` (the v4 aggregate that
subsumes the old `NodeContext` + `NodeFileSystem` — FileSystem | Path |
ChildProcessSpawner | Crypto | Stdio | Terminal), plus
`LoggerLive`. The bin uses `ManagedRuntime` to execute against this
composite. The runtime is held for the process lifetime; database
connections persist for the long-running MCP server process.
