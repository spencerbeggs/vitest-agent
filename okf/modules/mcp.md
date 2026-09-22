---
type: Module
title: "@vitest-agent/mcp"
description: "The Model Context Protocol server (vitest-agent-mcp bin) exposing the action-keyed tool surface to LLM agents over stdio, built on Effect's native McpServer with no MCP SDK, tRPC, or zod."
kind: package
layer: L4
resource: ../../packages/mcp
status: stable
tags:
  - architecture
  - effect
  - mcp
  - tdd
  - observability
generated:
  by: okfit/claude-code
  at: 2026-09-22T19:35:29Z
  body_sha256: 97fb8578fdefcd7e19157035f4f377b4ab088c38f8100ff6e9f8f70c0020cd76
---

# @vitest-agent/mcp

## Purpose

`@vitest-agent/mcp` is the Model Context Protocol server exposing the
action-keyed tool surface to LLM agents over stdio (the `vitest-agent-mcp`
bin). It is built on Effect's native `McpServer`
(`effect/unstable/ai`)[^server-ts]: the 30 tools are `Tool.make` values
assembled into one `Toolkit`, registered under a strict-input contract, and
served alongside six framing-only prompts as a single Effect `Layer` over
`McpServer.layerStdio`. There is no MCP SDK, no tRPC, and no zod — the wire
protocol, JSON Schema generation, and input validation all come from
`effect`.

A separate package from `@vitest-agent/cli` for module-boundary reasons and
so the MCP tool surface can evolve on its own release cadence, not for
install-cost reasons: `@vitest-agent/plugin` declares `@vitest-agent/mcp` as
an exact-pinned regular `dependency` and ships the `vitest-agent-mcp` bin
itself as a four-line shim over `@vitest-agent/mcp/main`, so every plugin
consumer installs it whether or not they run Claude Code — an MCP server
that is downloaded but never started costs a non-Claude-Code user only a
download.

## Boundary

Rank 4 in the workspace's ranked layering. Its only workspace runtime
dependencies are `@vitest-agent/engine` and `@vitest-agent/sdk`; it never
imports `@vitest-agent/cli` — the two front ends never import each other —
nor `@vitest-agent/plugin`, `@vitest-agent/reporter`, or `@vitest-agent/ui`.
`packages/mcp/__test__/boundaries.test.ts` enforces both halves of the
contract with one comment-stripping scanner over every `.ts` file under
`src/`[^boundaries-test]:

- **Forbidden imports.** `@vitest-agent/cli`, `@vitest-agent/plugin`,
  `@vitest-agent/reporter`, `@vitest-agent/ui`, and the three retired
  dependencies this package replaced — `@modelcontextprotocol/sdk`,
  `@trpc/server`, `zod` — may not appear anywhere under `src/`.
- **`process` allowlist.** Only `bin.ts`, `main.ts`, `version.ts`, and
  `tools/run-tests.ts` may reference `process`; the test asserts the
  offender list is empty and that the
  `process.env.__PACKAGE_VERSION__` compile-time literal's user list is
  exactly `["version.ts"]`. `run-tests.ts` is on the allowlist because it
  mutates `process.env.VITEST_AGENT_*` on the in-process Vitest run so the
  reporter attributes it to the active agent — see *`run_tests` boot
  context* below. Every other tool reaches ambient input through
  `McpSession`, never `process.env`; `McpSession.layerTest({ cwd, … })`
  requires an explicit `cwd` for the same reason. See
  [Package Boundaries](../invariants/package-boundaries.md) for the
  invariant this test enforces across every package, not only this one.

## Public surface

Two entry points: `.` (the side-effect-free programmatic barrel —
`ServerLayer` / `SERVER_INSTRUCTIONS`, `Kit` / `toolHandlers` /
`ToolsLayer`, `registerStrictToolkit`, `McpSession` and its ref helpers, `PromptsLayer`,
`withIdempotency` / `idempotencyKeys`, the `@deprecated` no-op `RenderText`, the `PingResult` /
`HelpResult` schemas, and `CURRENT_MCP_VERSION`) and `./main` (the assembled
program that owns the process, published so the plugin's carrier bin can
ship the same function). `index.ts` never imports `main.ts`, so a library
consumer's import graph never pulls in the process-owning module.

## Key files

- `src/bin.ts` — the published shim: `#!/usr/bin/env node`, `void main()`,
  nothing else.
- `src/main.ts` — the assembled program that owns the process: crash guards,
  `projectDir` / `dbPath` resolution, boot-time session recovery,
  `PlatformLive` (engine), `NodeStdio`, `NodeRuntime.runMain`.
- `src/server.ts` — `ServerLayer({ version })` and `SERVER_INSTRUCTIONS`[^server-ts].
- `src/toolkit.ts` — `Kit = Toolkit.make(<30 tools>)`, `toolHandlers`, and
  `ToolsLayer = Kit.toLayer(toolHandlers)`.
- `src/register-toolkit.ts` — `registerStrictToolkit(kit)`, the strict
  registration contract over `McpServer.addTool`.
- `src/session.ts` — the `McpSession` service and its ref
  constructors[^session-ts].
- `src/idempotency.ts` — the `idempotencyKeys` registry and the
  `withIdempotency` combinator.
- `src/annotations.ts` — `RenderText`, a `@deprecated` no-op annotation
  nothing reads any more (it once rendered a markdown `content[0].text`);
  kept exported until the next major.
- `src/tools/` — one file per tool (30) plus the private
  `_tdd-error-envelope.ts` and `_project-groups.ts` — see
  [MCP Tools](../interfaces/mcp-tools.md) for the full tool table.
- `src/prompts/` — `layer.ts` (`PromptsLayer`) plus one pure factory per
  prompt.
- `src/utils/` — `crash-guards.ts`, `safe-format-fatal-error.ts`,
  `tool-error-envelope.ts`, `replay-marker.ts`.
- `src/version.ts` — `CURRENT_MCP_VERSION`.

## Process boundary and server bootstrap (`main.ts`)

`main.ts` carries exactly one static import — the dependency-free
`utils/crash-guards.ts` — and registers the `unhandledRejection` /
`uncaughtException` process handlers before anything else is
evaluated[^main-ts]. Every other module (`effect`, `@effect/platform-node`,
`@vitest-agent/engine`, `./session.js`, `./server.js`, `./version.js`) is
`await import(...)`ed inside a `try` after the guards, so a throw during
evaluation of the server graph is still reported on stderr instead of
crashing silently — this is the one sanctioned dynamic-import site in the
family. Anything that rejects during startup — an import, `dbPath`
resolution, the layer graph — is caught and exits 1 with
`vitest-agent-mcp: startup failed: …`; left to the `unhandledRejection`
guard the event loop would drain to exit 0 with no server listening.

Boot order after the guards[^main-ts]: resolve `projectDir` via
`resolveProjectDir({ env, cwd: process.cwd() })` (precedence
`VITEST_AGENT_PROJECT_DIR` → `VITEST_AGENT_REPORTER_PROJECT_DIR` →
`CLAUDE_PROJECT_DIR` → cwd), resolve `dbPath` via `resolveDataPath` under
`PathResolutionLive(projectDir)` + `NodeServices.layer` (a failure here must
not start the server — it exits 1 so the loader can print install
instructions), build `McpSession.layer` with the recovered boot context,
build `Main = ServerLayer({ version }).pipe(Layer.provide(Session),
Layer.provide(PlatformLive(...)), Layer.provide(NodeStdio.layer),
Layer.provide(Layer.succeed(Logger.LogToStderr, true)))`, derive a
`Connected` layer that flips `transportConnected = true` strictly after
`Main`'s stdio protocol is reading stdin (`Layer.provide` builds its
dependency to completion before the dependent, unlike the concurrent
`Layer.mergeAll`), and launch under `NodeRuntime.runMain(Layer.launch(...),
{ teardown })` where the teardown maps a success or an interrupts-only exit
(stdin EOF) to exit 0 rather than the default 130 — a client disconnect is
the ordinary end of every session. No `process.exit` call is needed on that
path: with SQLite and the protocol scoped under `Main`, the process exits
within a fraction of a second of stdin EOF.

## `ServerLayer` (`server.ts`)

`ServerLayer({ version })` is `Layer.mergeAll(registerStrictToolkit(Kit).pipe(
Layer.provide(ToolsLayer)), PromptsLayer)` provided with
`McpServer.layerStdio({ name: "vitest-agent", version, description,
instructions, protocols })` and `Layer.succeed(Logger.LogToStderr, true)`,
then `Layer.orDie`[^server-ts]. Three facts are load-bearing:

- **`protocols` order is load-bearing** — `[v2026_07_28, v2025_11_25,
  v2025_06_18]`. `2026-07-28` is the stateless revision (SEP-2575): no
  `initialize`, no session; a client discovers with `server/discover` and
  every request carries `params._meta["io.modelcontextprotocol/protocolVersion"]`,
  and every result (including `tools/call`) comes back wrapped in the
  stateless frame (`_meta["io.modelcontextprotocol/serverInfo"]`,
  `resultType: "complete"`, …). rc.116's runtime
  (`effect/unstable/ai/internal/mcpRuntime.ts`) routes a request carrying
  that `_meta` to its adapter, matches `initialize` against the stateful
  adapters only, and sends anything else with no session to
  `protocols[0]`, so the stateless adapter is listed first. The two
  stateful adapters must stay: every shipping client (Claude Code's
  default stdio session, Copilot, Cursor, the Inspector) opens with
  `initialize`, which a server offering only `2026-07-28` answers with
  `METHOD_NOT_FOUND`. Measured with Claude Code 2.1.278: the default and
  `MCP_PROTOCOL_NEGOTIATION=legacy` open `initialize` on `2025-11-25`;
  `MCP_PROTOCOL_NEGOTIATION=auto` opens `server/discover` then
  `subscriptions/listen` on `2026-07-28`. `server/discover` advertises
  every listed adapter in `supportedVersions`
  (`["2026-07-28", "2025-11-25", "2025-06-18"]`). At most one stateless
  adapter is allowed — a second fails the layer with
  `Cause.IllegalArgumentError`, which is why the error channel is
  `orDie`d: `protocols` is a static literal, so a failure there is an
  implementer-time defect.
- **`Logger.LogToStderr` is set here and again in `main.ts`.** Effect's
  default logger writes to stdout unless this reference is true, and
  stdout is the JSON-RPC wire; every tool defect is logged by the strict
  registrar and the stdio protocol logs stdin errors, so this is
  mandatory, not cosmetic.
- **`instructions` is the agent-facing orientation.** `server.ts` exports
  `SERVER_INSTRUCTIONS` — what the server is for, call `help` first, the
  strict-input rule, the `structuredContent` / `content[0].text` dual
  channel, and how an expected domain error (an `ok: false`
  success-shaped envelope) differs from an `isError` result — and passes
  it as `instructions`, a first-class `McpServer.layerStdio` option since
  rc.116. It surfaces in both the `initialize` result and the
  `server/discover` result. `serverInfo.description` is just the one-line
  human summary.

`registerStrictToolkit` and every `McpServer.prompt` each `Layer.provide`
the static `McpServer.layer`, the same memoized pattern `McpServer.toolkit`
uses, so tools and prompts register into one `McpServer`.

## Strict tool registration

Every served `inputSchema` is strict, at every object level. Tools are
registered through `registerStrictToolkit(kit)`, never `McpServer.toolkit`:
Effect's toolkit decodes arguments with the default `onExcessProperty:
"ignore"` unless a tool is annotated `Tool.Strict`, which strips a
misspelled filter and runs a *wider* query while reporting success; and
rc.116's strict path rejects with only the first excess key and no
accepted-params list. `registerStrictToolkitEffect` is a line-for-line
port of rc.116's `McpServer.registerToolkit` over the public
`McpServer.McpServer.addTool`, with its deviations listed in the file
header and re-checked on every rc bump: every tool treated as strict
plus the pre-decode unknown-key walk; the served input built by
`servedInputJsonSchema` (Effect's own strict document, which closes
every object node) and reshaped only at the root by
`objectRootedInputSchema` (`$ref` roots inlined, a top-level `action` /
`kind` union rewritten to `oneOf` + `x-discriminator`); the
`UnexpectedToolError` envelope for internal failures instead of rc.116's
scrubbed text; `outputSchema` served only when object-rooted, because
`@modelcontextprotocol/sdk`'s `ToolSchema` still requires
`outputSchema.type === "object"` (fixed upstream by Effect-TS/effect#8326
in rc.117, not yet adopted); and no `structuredContent` for a non-object
encoded result. The former markdown-text deviation is retired: every
successful result sends the encoded object as `structuredContent` and
the same object as JSON in `content[0].text`, exactly as upstream does,
because Claude Code forwards only `structuredContent` to the model when
a result carries it. Input schemas decode through `McpSchema.ToolJson`
(object root required) and output schemas through
`McpSchema.ToolOutputJson`; `addTool`'s handler requirement is
`McpSchema.McpRequestContext`. The unknown-key walk runs *before*
decoding and fails `InvalidParams` naming every unknown key's path and
the accepted params at that level; the native strict decode stays behind
it as a backstop. Every unexpected failure or defect maps to the
`UnexpectedToolError` envelope rather than propagating a bare error. See
[Strict MCP Tool Inputs](../decisions/50-strict-mcp-tool-inputs.md) and
[Strict Tool Inputs](../invariants/strict-tool-inputs.md) for the
enforcement mechanism and the regression guard.

## Tools and the toolkit

`toolkit.ts` is the single source of truth for the served tool list:
`Kit = Toolkit.make(...)` over the 30 `Tool.make` values, `toolHandlers`
(which must `satisfies Toolkit.HandlersFrom<typeof Kit.tools>` — a tool
without a handler, or a handler without a tool, is a compile error), and
`ToolsLayer = Kit.toLayer(toolHandlers)`. Each tool declares its Effect
service dependencies (`McpSession`, `DataReader`, …), so `ServerLayer`'s `R`
requirement is assembled automatically from the tool list rather than
hand-maintained. The full grouped tool table — meta, read-only queries,
action-keyed consolidated families, standalone TDD tools, agent
registration, triage/wrapup, and the `run_tests` mutation — belongs to
[MCP Tools](../interfaces/mcp-tools.md), written from the consumer's side.

## `McpSession`

The one per-process service tool handlers read for `cwd` and the host
session[^session-ts]:

```ts
class McpSession extends Context.Service<McpSession, {
  readonly cwd: string;
  readonly currentSessionId: CurrentSessionIdRef;
  readonly sessionContext: SessionContextRef;
}>()("@vitest-agent/mcp/McpSession")
```

`McpSession.layer({ cwd, initialSessionId, initialContext, recover? })` is
built once in `main.ts`; `McpSession.layerTest({ cwd, ...overrides })` is
the test form and requires `cwd` because the module is process-free. The
`SessionContext` type is declared in the engine's `programs/session-env.ts`
and re-exported here so the MCP barrel keeps its own public name.

## TDD error envelope

`tools/_tdd-error-envelope.ts` catches the five tagged TDD errors (from
`@vitest-agent/sdk`'s `TddErrors`) at the MCP boundary and surfaces them as
success-shape `{ ok: false, error: { _tag, ..., remediation: {
suggestedTool, suggestedArgs, humanHint } } }` responses, matching the
`tdd_phase_transition_request` `{ accepted: false, denialReason, remediation
}` precedent. Domain errors with remediation hints come through the
success-shape envelope so the agent's tool-result handling stays uniform;
the `failure` channel of every tool is `Schema.Never`, and only an
unexpected defect takes the `UnexpectedToolError` path.

## Idempotency combinator

`idempotency.ts`'s `withIdempotency(path, handler)` is a combinator, not
middleware: `withIdempotency(path, handler)(params)` looks up the
registered `IdempotencyKeySpec` for `path`, derives the key from the
already-decoded params (strictly registered, so no key can have been
stripped), and either replays a persisted result via
`DataReader.findIdempotentResponse` (marking it `_idempotentReplay: true`
when the result is an object) or runs the handler and persists via
`DataStore.recordIdempotentResponse` best-effort on a miss. Three things
are deliberately a *miss*, never a failure: a `findIdempotentResponse` read
failure, a corrupt cached row (parse wrapped in `Effect.try` →
`Option.none()`), and a persist failure (swallowed) — the combinator's
error channel is `never`, because a cache problem must not fail a tool
whose write may already have succeeded. Rows never self-heal:
`recordIdempotentResponse` is `INSERT … ON CONFLICT(procedure_path, key) DO
NOTHING`, so re-persisting after a corrupt-row miss is a guaranteed no-op
and the key stays a permanent miss until something with `DELETE` /
`UPDATE` access clears it — an engine-level upsert is a recorded
follow-up.

The registered mutation surfaces are `register_agent`, `hypothesis`'s
`validate` action, `tdd_task`'s `start` / `end` actions, and the `create`
actions inside `tdd_goal` and `tdd_behavior`. `tdd_phase_transition_request`
is deliberately excluded: the accept/deny is a deterministic function of
artifact-log state at the moment of the request, and caching a denial would
replay it against changed state at a later call — the validator is itself
the source of idempotency, a pure function of database state plus the
cited artifact id. `hypothesis`'s `record` action is excluded too: it is an
append-only observation whose binding session is resolved server-side (see
*Hypothesis session binding*), leaving no safe per-call discriminator.
`update` / `delete` / `get` / `list` actions are excluded across the board
— state-dependent reads and intentional state transitions cannot be cached
without inverting the caller's expectation, and destructive ops are guarded
at the hook and permission-prompt layer instead.

## Progress push (`tdd_progress_push`)

Validates the payload against the `ChannelEvent` discriminated union from
`@vitest-agent/sdk`, then for behavior-scoped events resolves `goalId` and
`sessionId` **server-side** from `behaviorId` (via
`DataReader.resolveGoalIdForBehavior` and the goals → sessions FK) so a
stale orchestrator context cannot push the wrong tree coordinates.
Resolution is best-effort and every path returns `{ ok: true }`. Effect's
`McpServer` has no custom-notification surface, so the event is emitted
through the standard `server.notifications["notifications/message"]({
level: "info", logger: "vitest-agent/channel", data })` frame inside
`Effect.ignore` — a logging-message notification broadcast to every
initialized client, not a bespoke channel method.

## Crash resilience

Two independent layers address two different failure modes, and neither
substitutes for the other. **Process-level guards (`main.ts`)** register
`unhandledRejection` (log to stderr, stay alive) and `uncaughtException`
(log; exit 1 only while `shouldExitOnUncaughtException(transportConnected)`
says no client session exists yet — `packages/mcp/src/utils/crash-guards.ts`)
before any other module is evaluated. Under Node, an unhandled promise
rejection anywhere outside a tool call's own await chain otherwise kills
the process, silently deregistering every tool mid-session with no recovery
path. Surviving after connect is acceptable because this process holds no
long-lived mutable state outside SQLite's own transactions — every
`DataStore` / `DataReader` call is self-contained — so a throw that escapes
even the registrar's per-call catch cannot leave the *next* call's
bookkeeping half-mutated. **The crash handler must not itself be
crashable**: the handlers go through `safeFormatFatalError`, which
try/catches the core's `formatFatalError` and falls back to a constant,
because that formatter introspects the value it is handed and every
introspection point is hijackable by a `Proxy` trap that throws — and a
throw inside an `uncaughtException` handler is fatal with no second chance.
**Structured envelope for handler defects (`register-toolkit.ts`)** is
defense in depth, not the primary fix: a throw or defect *inside* a tool
call is caught at the registration boundary and returned as
`buildUnexpectedToolErrorEnvelope(name, err)` with `isError: true`. See
[The MCP Server Survives Post-Connect Crashes](../decisions/51-the-mcp-server-survives-post-connect-crashes.md).

## Hypothesis session binding

`hypothesis`'s `record` action resolves its binding session server-side
rather than trusting a caller-guessed `sessionId`, in precedence order:
`tddTaskId` (preferred and deterministic — resolved via
`DataReader.getSessionByTddTaskId`; an unknown id is a hard typed failure,
not a silent misattribution), the recovered host context (the main
session, or the active un-ended subagent child when one exists), then a
caller-supplied `sessionId` honored only when no host context was
recovered (dev / test paths). `tddTaskId` accepts a number or a numeric
string (`Schema.Union([Finite, FiniteFromString])`) because LLM callers
routinely stringify numeric tool inputs — the one field in the surface that
still coerces a string, and deliberately `FiniteFromString` rather than
`NumberFromString` so a genuinely non-numeric string still fails validation
instead of coercing to `NaN`.

## Phase-transition guards and auto-resolve

`tdd_phase_transition_request` is the headline TDD write. The MCP layer
wraps the pure `validatePhaseTransition` function from the SDK with a goal
status check, a behavior-membership check, and the evidence-binding rules
applied via the pure validator; the tool threads the open phase row's id
into the validator's context so the artifact-binding window check can
compare it against the cited artifact's own `phase_id`. On accept with a
`behaviorId`, the server auto-promotes the behavior `pending →
in_progress` in the same SQL transaction as writing the phase row, so the
phase ledger and behavior status never desync. When `citedArtifactId` is
omitted, the tool auto-resolves the most recent matching artifact for the
required-evidence rule of the target phase, scoped by `behaviorId` only for
the transitions where the validator enforces a behavior match. See
[TDD Phase-Transition Evidence Binding](../decisions/d11-tdd-phase-transition-evidence-binding.md)
and [Phase Transition Is Not Idempotent](../gotchas/phase-transition-not-idempotent.md).

## Project handling and history narrowing

The `inventory` tool's `module` / `suite` / `session_list` modes and the
`test` tool's `list` / `for_tag` modes enumerate every project from
`DataReader.getRunsByProject()` when `project` is unspecified, grouping
output under per-project headers — real multi-project Vitest configs have
no literal `"default"` project to fall back to. `test_history` accepts
optional `testName`, `modulePath`, and `limit`, pushed down to
`DataReader.getHistory`'s `HistoryQueryOptions` as SQL predicates rather
than filtered client-side; the narrowing scopes the whole response, not
just the history array — `getFlaky` and `getPersistentFailures` take the
same values, so `hasData` is a statement about the requested scope, not the
whole project. `limit` is validated as a positive integer, because a bare
numeric field previously let `0` / negative / fractional values flow
straight into the window query and return an empty history
indistinguishable from "this test has never run."

## Tag filtering and annotations/artifacts

`run_tests`, `inventory`, and `test` surface Vitest's native tags (the way
agents target test subsets) via input/output variants rather than a new
top-level tool. `run_tests`'s `tags` input carries a `TagFilter` struct
(`all` / `any` / `none`, ANDed together and with `project` / `files`); the
pure `composeTagExpression` helper flattens it to Vitest's `tagsFilter`
expression. `test({ action: "annotations" | "artifacts" })` surfaces
Vitest 5's `context.annotate` notes and `recordArtifact` payloads; bodies
are opt-in and budgeted through `maxBytes`, a non-negative total charged
against `applyBodyBudget`, defaulting to `0` so the default response is
descriptors only. See
[Cap Inline Attachment Bodies on Stored Bytes](../decisions/68-cap-inline-attachment-bodies-on-stored-bytes.md)
and
[MCP Attachment Bodies Are Opt-In and Budgeted](../decisions/69-mcp-attachment-bodies-are-opt-in-and-budgeted.md).

## `run_tests` root handling

The server resolves its Vitest root **once, at boot** — `McpSession.cwd` —
and one long-lived process serves every caller, which produced a false
green when an agent working in a git worktree called `run_tests` and the
server silently ran a different tree. `run_tests` accepts an optional,
validated `projectRoot` that overrides `McpSession.cwd` for one call: the
path must resolve to an existing directory sharing a git common directory
with `McpSession.cwd` (`git rev-parse --git-common-dir`, identical across a
repository and every attached worktree, unlike `--show-toplevel`), with
both candidates routed through `realpath` so a macOS tmpdir behind a
symlink still compares equal. The resolved root is always echoed on
`RunTestsOk` and `RunTestsNoMatch` as a required `projectRoot` field, so
even a caller that never passes the param can see which tree answered.
Detect-and-refuse is deliberately not implemented: the server cannot
observe the caller's cwd from inside one MCP call, so a missing trust
signal must mean *cannot tell*, never a default to either interpretation.

When `projectRoot` is omitted, the tool anchors the root at the directory
of the config Vitest would load anyway (`resolveConfigAnchoredRoot`,
`vitest.config.*` before `vite.config.*`, first hit wins, bounded at the
git root) rather than passing `McpSession.cwd` straight through as
Vitest's `root` — Vitest finds the config file by walking up from `root`
but resolves that config's relative `globalSetup` / `setupFiles` downward
from the resolved root, so those two independent inputs previously
diverged when the server booted inside a monorepo subtree. An explicit,
validated `projectRoot` is used verbatim, with no anchoring applied — a
caller whose config uses relative setup paths should pass the directory
holding the config. `run_tests` then resolves `vitest/node` through a
`createRequire` anchored at the run's validated project root rather than
the bare specifier, because `vitest` is a peer dependency and pnpm
routinely materializes more than one physical copy of the same version;
driving the wrong copy split vitest's module-level `SnapshotClient`
singleton and made every snapshot assertion fail while every other
assertion passed.

`run_tests` blocks the long-lived stdio server for the run's duration —
acceptable because agents wait for results before proceeding — bounded by
an `Effect.timeout` around `localVitest.start(...)`, folded into an `ok |
timeout | failed` outcome so a timeout can only come from a real
`Cause.TimeoutError`, never from an ordinary error whose message happens to
match a sentinel string. Historically this tool ran Vitest out-of-process
via `spawnSync`; it now runs `createVitest` in-process for the same reason
(the handler already blocks until Vitest completes) with richer result
access (`state.getFiles()` for console-leak collection, direct
`AgentReport` construction) than a spawned process's stdout would allow.
See [run_tests Timeout as a Typed Effect Error](../decisions/63-run-tests-timeout-as-a-typed-effect-error.md).

## Coverage facets in `test_coverage`

`tools/coverage.ts` reads `DataReader.getCoverage` and renders the three
coverage-policy facets distinctly: Totals, an **Enforced threshold**
column (the persisted Vitest `coverage.thresholds`; blank when the project
never persisted any), and, only when targets were persisted, a **Target**
column (the aspirational `coverageTargets`). The pass/fail icon on each row
keys off the enforced threshold alone, and per-file output is split on the
persisted `file_coverage.tier` into build-blocking gaps and aspirational
improvements. See
[Persist Thresholds, Targets and Baselines as Three Facets](../decisions/58-persist-thresholds-targets-and-baselines-as-three-facets.md).

## Per-invocation coverage directory

`makeCoverageDirOverride()` gives every `run_tests` invocation its own
`mkdtemp` coverage `reportsDirectory`, spread onto the `createVitest`
overrides as a field-level merge so the user's `coverage.enabled`,
provider, and thresholds still apply. Vitest's v8 provider deletes the
shared `coverage/` reports directory at run start by default; two runs
concurrently in one checkout otherwise delete each other's in-flight
files. Final coverage artifacts from MCP-driven runs land in the throwaway
directory rather than `./coverage`, which is acceptable because the MCP
path never reads coverage from disk — `CoverageAnalyzer` consumes the
in-memory `CoverageMap` and persists to SQLite, which every MCP coverage
tool reads. See
[Per-Invocation Coverage Directory for MCP Runs](../decisions/49-per-invocation-coverage-directory-for-mcp-runs.md).

## MCP boot context recovery

`main.ts` reads `process.env.VITEST_AGENT_*` at startup and seeds
`McpSession.sessionContext`; `run_tests` reads the ref before each Vitest
invocation and mutates `process.env` so the spawned reporter inherits the
canonical UUIDs. Boot-time recovery alone loses two races: a fresh Claude
Code launch can spawn the MCP child before the SessionStart hook writes the
env file, and `/reload-plugins` restarts the MCP process mid-session with
no session env at all. `createSessionContextRef(initial, recover)`
therefore takes a lazy recovery thunk: when `get()` finds a null value it
invokes the engine's `recoverSessionContextFromSessionEnv`, which reads the
newest-mtime `~/.claude/session-env/<chat_id>/vitest-agent-hook.sh` file
whose exports match this server's `projectDir`, and caches the first
non-null result. Recovery is best-effort and never throws.
`register_agent` is the explicit-call recovery path when boot-time
recovery fails entirely: an orchestrator can call it with host metadata to
establish the session mid-session, reaching the same
`DataStore.registerAgent` code path the SessionStart hook's sidecar call
would have.

## MCP prompts

`prompts/`. Framing-only prompts surface canonical workflow primings as MCP
prompts so a client can pick a workflow from a menu without the agent
needing to remember which tools to compose. **No tool data is pre-fetched
on the server** — the prompt only orients the agent; the agent then
composes the tools itself. This keeps the server's prompt surface free of
latency and side effects: prompt selection on the client costs zero tool
roundtrips, and the server never reads the database while assembling a
prompt response. The six factories are pure and must not call `DataReader`
/ `DataStore`. `PromptsLayer` is `Layer.mergeAll` of six
`McpServer.prompt(...)` layers, each serving a human-readable `title`
(rc.116's `McpServer.prompt` accepts one; pinned by
`prompts-layer.test.ts`); prompt arguments are strings on the wire,
so every parameter is a `Schema.String`-based field wrapped in
`Schema.optionalKey` when not required. `tdd-resume`'s session id default
is the one server-side input — it defaults to the recovered
`McpSession.sessionContext.get()?.chatId ?? McpSession.currentSessionId.get()`.
See [Framing-Only MCP Prompts](../decisions/35-framing-only-mcp-prompts.md).

## Testing surface

`__test__/utils/harness.ts` builds the REAL `ServerLayer` over
`Stdio.layerTest` queues — no child process — so a test sees the exact
served schemas and wire results: `initialize`, `listTools`, `callTool`,
`sendRequest` (for `prompts/list`, `prompts/get`), `sendNotification`,
`discover` (`server/discover`), `seed` (populates the same in-memory store
the server reads), `session` (pins an `McpSession`), `extraLayers`,
`stateless: true` (speaks `2026-07-28`: the protocol `_meta` is injected
on every request), and `stderrSoFar` / `consoleLogSoFar` /
`rawStdoutSoFar`. `server-protocols.test.ts` pins `server/discover`
(`supportedVersions`, instructions identity, `serverInfo` under `_meta`),
`tools/list` with no handshake, a revision × outcome matrix
(`2026-07-28` / `2025-11-25` / `2025-06-18` × success / declared failure /
invalid params — invalid params is a JSON-RPC `-32602` on `2025-06-18`
and an `isError` result on the two newer revisions), and a
strict-plus-lenient fixture. The test `Stdio` must be provided
*innermost* because the test data-store layer carries the real Node
platform services, whose real process `Stdio` would otherwise win the
merge and leave the server listening on the vitest worker's own stdin.
`__test__/utils/caller.ts`'s `makeCaller(runtime, session?)` decodes params
through a tool's schema and invokes `toolHandlers[name]` directly for
handler-level assertions with full type narrowing. Only crash-guard
behavior and process lifecycle need the real spawned bin — see
[The spawnSync-to-createVitest e2e Gap](../limitations/spawn-sync-e2e-gap.md).
See [Test Patterns](../conventions/test-patterns.md) for the house testing
conventions this harness follows.

## Choices absorbed here

### `spawnSync` for `run_tests`, superseded by in-process `createVitest`

The tool originally shelled out to `npx vitest run` via `spawnSync` with a
configurable timeout, on the reasoning that MCP tool handlers are already
async and blocking on a synchronous spawn keeps the implementation simple:
the tool blocks until Vitest completes, then returns the result, and the
server cannot process other tool requests meanwhile — acceptable because
agents typically wait for results before proceeding. That blocking
posture is unchanged today, but the mechanism moved to `createVitest` (from
`vitest/node`) run in-process, because the in-process API gives direct
access to `state.getFiles()` for console-leak collection and to build the
`AgentReport` without re-parsing a spawned process's stdout, and it is the
same process that later needed root-anchored `vitest/node` resolution
(below) — a resolution problem `spawnSync`, launching a fresh `npx`
process, never had.

### Caller-declared `projectRoot` over server-side worktree detection

The `projectRoot` validation, echo, and config-anchoring behavior described
above under *`run_tests` root handling* is one coherent choice split across
three problems that arrived separately: an unnamed tree answering silently
(fixed by validating a caller-supplied root and always echoing whichever
root ran), an unsupplied root diverging from the config Vitest would
actually load in a monorepo subtree (fixed by anchoring at the config
directory rather than the boot cwd), and a peer-duplicated `vitest/node`
splitting a module-level singleton (fixed by resolving that import from
the validated root rather than this package's own install location). All
three share one general rule: when a tool derives a value the downstream
system also derives, deriving it differently is a bug waiting for the
first caller whose cwd is not the repo root, and when the system truly
cannot tell what the caller meant it reports what it used rather than
guessing.

[^server-ts]: `../../packages/mcp/src/server.ts:71`
[^main-ts]: `../../packages/mcp/src/main.ts:94`
[^session-ts]: `../../packages/mcp/src/session.ts:133`
[^boundaries-test]: `../../packages/mcp/__test__/boundaries.test.ts:31`
