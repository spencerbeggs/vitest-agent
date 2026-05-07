---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-07
last-synced: 2026-05-07
completeness: 90
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ../data-structures.md
  - ./sdk.md
  - ./cli.md
  - ./plugin-claude.md
dependencies: []
---

# MCP package (`vitest-agent-mcp`)

Model Context Protocol server providing tool, resource, and prompt surfaces
for agent integration. Uses `@modelcontextprotocol/sdk` over stdio
transport. Tool routing goes through tRPC; resources and prompts register
directly with the MCP SDK alongside the tRPC router.

**npm name:** `vitest-agent-mcp`
**Bin:** `vitest-agent-mcp`
**Location:** `packages/mcp/`
**Internal dependencies:** `vitest-agent-sdk`

A separate package because the MCP tool surface evolves on a different
cadence than the reporter, and the transitive dependency footprint
(MCP SDK, tRPC, zod) is large enough that users who don't run an MCP
server should not pay for it. The plugin declares this package as a
required `peerDependency`, giving lockfile-level coordination without
bundling the dependency tree.

For the surfaces this package exposes to the Claude Code plugin, see
[./plugin-claude.md](./plugin-claude.md). For the data layer it reads from
and writes to, see [./sdk.md](./sdk.md).

For decisions: [../decisions.md](../decisions.md) D11/D12/D13 (TDD
hierarchy and capability-vs-scoping), D33 (resources + prompts surface),
D7 (artifact write authority).

---

## Server bootstrap

`packages/mcp/src/bin.ts`. Resolves the user's `projectDir` via the
precedence: `VITEST_AGENT_REPORTER_PROJECT_DIR` (set by the plugin loader)
→ `CLAUDE_PROJECT_DIR` → `process.cwd()`. Then resolves `dbPath` via
`resolveDataPath(projectDir)` under `PathResolutionLive(projectDir) +
NodeContext.layer`, creates `ManagedRuntime.make(McpLive(dbPath, ...))`,
and calls `startMcpServer({ runtime, cwd: projectDir })`.

The `VITEST_AGENT_REPORTER_PROJECT_DIR` precedence is load-bearing: Claude
Code does not reliably propagate `CLAUDE_PROJECT_DIR` to MCP server
subprocesses, so the plugin loader passes it through this dedicated env
var. See [./plugin-claude.md](./plugin-claude.md) for the loader side.

`server.ts` registers all tRPC tools with the MCP SDK using zod input
schemas (the MCP SDK side; tRPC inputs are also zod, kept in sync between
the two registrations), then calls `registerAllResources(server)` and
`registerAllPrompts(server)` before constructing `StdioServerTransport`.

## tRPC router and tools

The router (`router.ts`) aggregates every tool procedure. The context
(`context.ts`) carries a `ManagedRuntime` so procedures can call Effect
services via `ctx.runtime.runPromise(effect)`. The context module also
exports the underlying `t` instance (`middleware`, `router`,
`publicProcedure`) so the idempotency middleware can share it rather than
constructing a parallel `t`.

Tools are organized by surface area in `packages/mcp/src/tools/` — one
file per tool — and broadly group into:

- **Read-only queries.** Status, overview, coverage, history, trends,
  errors, file-coverage, test-by-file, test-get, configure, cache health.
  Markdown output.
- **Discovery.** Project list, test list, module list, suite list,
  settings list. Markdown output.
- **Notes CRUD.** Create, list, get, update, delete, search.
- **Sessions / turns / TDD reads.** Session list, session get, turn
  search, failure-signature get, TDD-session get, hypothesis list,
  acceptance metrics. JSON output. All read-only.
- **Triage / wrapup reads.** Markdown output. Delegate verbatim to the
  shared `format-triage` / `format-wrapup` generators in
  `packages/sdk/src/lib/`, so MCP and CLI surfaces produce identical
  output.
- **Hypothesis writes.** `hypothesis_record`, `hypothesis_validate`. JSON
  output. Both go through the idempotency middleware.
- **TDD session lifecycle.** Start, end, resume, phase-transition request.
- **TDD goal CRUD** and **TDD behavior CRUD**. The two-tier surface that
  decomposes objectives into goals and goals into behaviors.
- **TDD progress push** (`tdd_progress_push`). Registered directly with
  the MCP SDK rather than via tRPC because it forwards to a Claude Code
  notification channel. See *Channel-event resolution* below.
- **Workspace history reads.** `commit_changes` returns commit metadata
  joined with `run_changed_files`.
- **Mutations.** `run_tests` executes `vitest run` via `spawnSync`.

The `help` tool surfaces these groupings to clients.

The MCP server exposes tools for every major surface area of the data
layer; the per-tool details (parameters, output shape) are read directly
from each `tools/<name>.ts` source file rather than catalogued here.

## TDD error envelope

`packages/mcp/src/tools/_tdd-error-envelope.ts`. Catches the typed TDD
errors (from `vitest-agent-sdk`'s `TddErrors`) at the MCP boundary and
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

**What is and isn't idempotent.** Hypothesis records, hypothesis
validations, TDD-session start/end, and goal/behavior creation are
registered. The phase-transition tool, every `*_update`/`*_delete`/
`*_get`/`*_list`, and `tdd_progress_push` are intentionally **not**
registered — see [../decisions.md](../decisions.md). State-dependent
reads, intentional state transitions, and destructive ops are not
idempotent in the cache-replay sense.

**`tdd_session_start` idempotency key.** The key is derived from
`runId` when present: `sid:<sessionId>:run:<runId>` or
`cc:<ccSessionId>:run:<runId>`. When `runId` is absent (legacy callers),
the key falls back to goal text: `sid:<sessionId>:<goal>` or
`cc:<ccSessionId>:<goal>`. The `runId`-based keying lets the same goal
be retried within the same CC session (the main agent generates a fresh
`runId` at each dispatch) without triggering the cache replay.

**`tdd_session_start` accepts `runId`.** The tool's optional `runId`
input is forwarded to `DataStore.writeTddSession`. When provided,
`run_id` is stored in `tdd_sessions` and the partial unique index on
`(session_id, run_id)` gives database-level deduplication. When omitted,
`run_id` is stored as NULL; the partial index does not cover NULL rows,
so only the middleware goal-text cache (`cc:<ccSessionId>:<goal>`)
provides idempotency. The tool returns `runId: undefined` when the caller
did not supply one.

## Channel-event resolution

`tdd_progress_push` is registered directly with the MCP SDK because it
forwards to a Claude Code notification channel rather than returning data
through the tRPC tool path. The MCP server validates the payload against
the `ChannelEvent` discriminated union from `vitest-agent-sdk`, then for
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
only responsible for the final `done` transition via `tdd_behavior_update`.

The `DenialReason` union covers both pre-check rejections and the
validator's existing reasons, so denials are uniform from the agent's
perspective.

## Project handling in discovery tools

`module_list`, `suite_list`, and `test_list` enumerate every project from
`DataReader.getRunsByProject()` when `project` is unspecified, grouping
output under per-project `### project` headers. This is required because
real multi-project Vitest configs use names like `unit` and `integration`
— there is no literal `"default"` project to fall back to.

## MCP resources

`packages/mcp/src/resources/`. The MCP resources surface exposes content
under two URI schemes:

- `vitest://docs/` — the vendored upstream Vitest documentation snapshot
  at `packages/mcp/src/vendor/vitest-docs/`.
- `vitest-agent://patterns/` — the curated testing-patterns library at
  `packages/mcp/src/patterns/`.

Each scheme has an index URI and a per-page template URI. The
`vitest_docs_page` template registers with a `list` callback that decodes
`manifest.json` (validated against the `UpstreamManifest` Effect Schema)
and emits per-page `{ name, uri, title, description, mimeType }` so MCP
clients show "load when" descriptions in their resource picker. The
authored per-page descriptions are the headline reason the manifest
carries metadata at all — mechanical title extraction is not enough.

The `vitest_agent_pattern` template uses `{ list: undefined }` because the
patterns index URI already serves the enumeration role and the patterns
library is small enough that explicit per-page enumeration is unnecessary.

**Why two URI schemes:**

- `vitest://` carries vendored upstream content — a snapshot of
  `vitest-dev/vitest`'s `docs/` tree at a pinned tag. The scheme name
  signals provenance.
- `vitest-agent://` carries content authored *for* this project — opinions
  about testing Effect services, testing schemas, authoring a custom
  reporter. Splitting the schemes makes it impossible to conflate
  vendored content with curated guidance, even at a glance.

**Path-traversal guarding.** `paths.ts`'s `resolveResourcePath` enforces
three invariants: no null bytes, no absolute paths, and the resolved path
must stay within the resource root. Naïve `join(root, relative)` would let
`vitest://docs/../../etc/passwd` escape the vendored tree. The MCP server
runs as a long-lived process and resource URIs come from clients, so this
guard is not optional.

**Vendor + patterns layout.** Both content trees live under `src/` so
turbo treats edits as build-affecting. They are mirrored into
`dist/<env>/` by rslib's `copyPatterns` config — `vendor/` and `patterns/`
end up at `dist/<env>/vendor/` and `dist/<env>/patterns/`, siblings of
the compiled bundle. The registrar resolves the right layout at runtime
via `existsSync` fallback.

`UpstreamManifest`'s `pages: ReadonlyArray<{ path, title, description }>`
field is **optional** in the schema so the registrar's `list` callback
can fall back gracefully during a transitional pre-skill-run state (skip
enumeration, return empty `resources: []`). The `validate-snapshot.ts`
script enforces non-empty `pages[]` as a quality gate before commit, so
in normal operation the field is always populated.

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

## Snapshot maintenance pipeline

`packages/mcp/lib/scripts/`. The `lib/` convention (not `src/`) is the
repo convention for Effect-based, turbo-cache-affecting TypeScript that
lives outside the published bundle — matching the `lib/configs/`
directory at the repo root. Maintenance code is not part of the published
bundle. Putting it under `src/` would pull it into the rslib build entry
list.

Three scripts split the lifecycle so the
`.claude/skills/update-vitest-snapshot/` skill can pause for the agent
to author per-page descriptions between scaffolding and validation:

- **`fetch-upstream-docs.ts`** — sparse-clones `vitest-dev/vitest` at the
  requested tag (`--depth 1 --filter=blob:none --sparse --branch <tag>`,
  `sparse-checkout set docs`) and writes the cloned tree to a gitignored
  work area at `lib/vitest-docs-raw/`. Records `.upstream-info.json`
  validated against the `UpstreamManifest` Effect Schema.
- **`build-snapshot.ts`** — reads the raw tree, applies a denylist (drops
  VitePress meta files like `.vitepress/`, `index.md`, `team.md`,
  `todo.md`, `blog.md`, `blog/`, `public/`), strips VitePress YAML
  frontmatter, derives mechanical titles from each page's H1, and writes
  the cleaned tree to `src/vendor/vitest-docs/` plus a schema-validated
  `manifest.json`. The `pages[]` entries land with placeholder
  descriptions marked `[TODO: replace with load-when signal]` — the skill
  drives the agent through rewriting each one.
- **`validate-snapshot.ts`** — quality gate. Decodes `manifest.json`
  against `UpstreamManifest`, asserts `pages[]` is non-empty, checks
  every committed `.md` has a manifest entry and every entry resolves to
  a real file, refuses any description still carrying the `[TODO`
  marker, and enforces a 30-character minimum description length.

**Why `execFileSync`, not `execSync`.** The fetcher takes the tag as a
CLI argument and passes it to `git`. Building a shell command string and
passing to `execSync` (`git clone ... --branch ${tag} ...`) opens a
shell-injection hole at the exact boundary where the input is least
trusted. `execFileSync("git", [..., "--branch", tag, ...], { cwd })`
invokes git directly without spawning a shell, so `tag` is treated
verbatim as one argv element regardless of its contents.

**Build-time copy.** `rslib` only knows how to build TypeScript sources.
The vendor tree and patterns tree are runtime data, not source. Bundling
them through a build plugin would either inline the markdown into the JS
bundle (wasteful for resources clients fetch by URI) or require a custom
loader. rslib's `copyPatterns` is the rsbuild-native answer to the same
problem, declared in `packages/mcp/rslib.config.ts`.

## McpLive composition layer

`packages/mcp/src/layers/McpLive.ts`. Composes `DataReaderLive`,
`DataStoreLive`, `ProjectDiscoveryLive`, `OutputPipelineLive`,
`SqliteClient`, `Migrator`, `NodeContext`, `NodeFileSystem`, and
`LoggerLive`. The bin uses `ManagedRuntime` to execute against this
composite. The runtime is held for the process lifetime; database
connections persist for the long-running MCP server process.
