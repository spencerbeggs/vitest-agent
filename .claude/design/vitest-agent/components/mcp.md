---
status: current
module: vitest-agent
category: architecture
created: 2026-05-06
updated: 2026-06-12
last-synced: 2026-06-12
completeness: 92
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

Model Context Protocol server providing tool, resource, and prompt surfaces
for agent integration. Uses `@modelcontextprotocol/sdk` over stdio
transport. Tool routing goes through tRPC; resources and prompts register
directly with the MCP SDK alongside the tRPC router.

**npm name:** `@vitest-agent/mcp`
**Bin:** `vitest-agent-mcp`
**Location:** `packages/mcp/`
**Internal dependencies:** `@vitest-agent/sdk`

A separate package for module-boundary reasons and so the MCP tool
surface can evolve on its own cadence — not for install-cost reasons.
The plugin declares `@vitest-agent/mcp` as a required `peerDependency`,
which npm 7+ and pnpm auto-install, so every plugin consumer installs
it; an MCP server that is downloaded but never started costs a
non-Claude-Code user only a download. The `@modelcontextprotocol/sdk` /
tRPC / zod stack staying in its own package is a boundary decision
(those dependencies are the MCP server's concern alone), not an opt-out
for users who skip the server.

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

Inside `main()`, before `ManagedRuntime.make`, the bin compares
`CURRENT_MCP_VERSION` against `CURRENT_SDK_VERSION` and writes one
stderr line on mismatch
(`[@vitest-agent/mcp] version drift: @vitest-agent/mcp@<a> with
@vitest-agent/sdk@<b>. Reinstall @vitest-agent/* packages so versions
match.`). The check is observation-only — the server boot continues.
`packages/mcp/src/index.ts` exports `CURRENT_MCP_VERSION` (inlined
from `process.env.__PACKAGE_VERSION__` via the package's
`rslib.config.ts` `define`). Integration coverage:
`packages/mcp/__test__/bin-version-drift.test.ts` mocks
`CURRENT_SDK_VERSION` to assert the warning shape; see D36 in
[../decisions.md](../decisions.md).

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
- **Mutations.** `run_tests` executes `vitest run` via `spawnSync`.
  Mutates `process.env` from the `SessionContextRef` before
  `createVitest` so the in-process reporter sees current attribution.
  Accepts a structured `tags` filter and a per-call `passWithNoTests`
  override; emits a fourth `no-match` discriminator variant when the
  resolved filter set matches zero tests. See *Tag filtering and tag
  introspection* below.

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

1. Runs `JSONSchema.make(EffectSchema)` against the tool's output type.
2. Inlines all `$ref`s before handing the result to `z.fromJSONSchema`
   (the SDK's object-only requirement does not accept refs).
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

**What is and isn't idempotent.** `register_agent`, `hypothesis`'s
`validate` action, `tdd_task`'s `start` / `end` actions and the `create`
actions inside `tdd_goal` and `tdd_behavior` derive a key. `hypothesis`'s
`record` action does **not** — a hypothesis is an append-only observation
whose binding session is resolved server-side (and so absent from the
input), leaving no safe per-call discriminator. The
`tdd_phase_transition_request` tool, every `update` / `delete` / `get` /
`list` action, and `tdd_progress_push` are intentionally **not** registered
— see [../decisions.md](../decisions.md). State-dependent reads, intentional
state transitions, and destructive ops are not idempotent in the
cache-replay sense. The `idempotencyKeys` registry's per-procedure
`deriveKey` returns null for non-idempotent actions, branching on
`input.action`.

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

## Channel-event resolution

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
artifacts written under a rotated `chat_id`). The
auto-resolved artifact id is returned in the response so the
orchestrator can record what evidence was bound. Explicit citation
still wins when the agent supplies it.

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

## MCP boot context recovery

The MCP server entry (`packages/mcp/src/bin.ts`) reads
`process.env.VITEST_AGENT_*` at startup via `sessionContextFromEnv`
and populates `McpContext.sessionContext` (a `SessionContextRef`).
The `run_tests` tool reads from the ref before each Vitest invocation
and mutates `process.env` so the spawned reporter inherits the
canonical UUIDs.

This works because Claude Code auto-sources `CLAUDE_ENV_FILE` into
the MCP server child process — the SessionStart hook's exports flow
naturally into the MCP server's `process.env` without any explicit
session-map lookup. The session map's `lookupByProjectDir` is the
dev / test fallback when `CLAUDE_ENV_FILE` isn't available; the
per-project `data.db` itself never reads from the session map at
runtime. See [../data-flows.md](../data-flows.md) for the full
attribution flow.

`register_agent` is the explicit-call recovery path: when boot-time
context recovery fails (no env vars set), the orchestrator can call
`register_agent` with its host metadata to establish the
`SessionContextRef` mid-session. This is the same flow the
SessionStart hook would have triggered via the `agent register-agent`
sidecar; the MCP tool reaches the same `DataStore.registerAgent` code path.

## MCP resources

`packages/mcp/src/resources/`. The MCP resources surface exposes content
under two URI schemes:

- `vitest://docs/` — the vendored upstream Vitest documentation snapshot
  at `packages/mcp/src/vendor/vitest-docs/`.
- `vitest-agent://patterns/` — the curated testing-patterns library at
  `packages/mcp/src/patterns/`.

Each scheme has an index URI and a per-page template URI. Both per-page
templates register a `list` callback that decodes the source manifest
(`vitest_docs_page` reads `manifest.json` validated against
`UpstreamManifest`; `vitest_agent_pattern` reads `_meta.json` validated
against `PatternsManifest`) and emits per-page `{ name, uri, title,
description, mimeType, annotations? }`. Clients show the "load when"
descriptions in their resource picker; the optional `annotations` field
carries MCP 2025-11-25 `audience` and `priority` so clients can rank or
filter before pulling content into context. The path-prefix → priority
bands are owned by `annotations-heuristic.ts` (see *Snapshot maintenance
pipeline*). The authored per-page descriptions remain the headline reason
the manifest carries metadata at all — mechanical title extraction is not
enough.

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

`UpstreamManifest`'s `pages: ReadonlyArray<{ path, title, description,
annotations? }>` field is **optional** in the schema so the registrar's
`list` callback can fall back gracefully during a transitional
pre-skill-run state (skip enumeration, return empty `resources: []`).
The per-page `annotations` field is also optional so a partially
annotated manifest decodes cleanly during an editorial pass. The
`validate-snapshot.ts` script enforces non-empty `pages[]` as a quality
gate before commit, so in normal operation the field is always
populated; partial annotation coverage produces a non-fatal warning
that the editorial pass is incomplete.

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

The pipeline splits the lifecycle so the
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
  drives the agent through rewriting each one. The script also seeds
  every page's `annotations` (`audience: ["assistant"]` + a priority
  band) by calling into `annotations-heuristic.ts` so a fresh snapshot
  starts with reasonable defaults that the editorial pass then tightens.
- **`annotations-heuristic.ts`** — single source of truth for the
  path-prefix → `priority` mapping (API reference 0.85–0.95, coverage
  0.85, core guide 0.75–0.85, experimental browser-mode 0.55, migration
  0.45). Pure module, no I/O; both `build-snapshot.ts` and
  `apply-annotations.ts` consume the same function so the seeded values
  stay consistent.
- **`apply-annotations.ts`** — idempotent one-shot bootstrap for an
  existing manifest. Re-runs `annotations-heuristic.ts` against every
  page in the current `manifest.json`, writes only the entries that
  changed, and is safe to re-invoke against an already-annotated
  manifest (no diff produced). Used when bootstrapping annotations onto
  a snapshot that was generated before the heuristic existed, without
  re-fetching from upstream.
- **`validate-snapshot.ts`** — quality gate. Decodes `manifest.json`
  against `UpstreamManifest`, asserts `pages[]` is non-empty, checks
  every committed `.md` has a manifest entry and every entry resolves to
  a real file, refuses any description still carrying the `[TODO`
  marker, enforces a 30-character minimum description length, rejects
  empty `annotations.audience` arrays and out-of-range `priority` values,
  and warns when only a subset of pages carry annotations so partial
  editorial coverage is visible at commit time.

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
problem, declared in `packages/mcp/rslib.config.ts` (`[{ from:
"src/vendor", to: "vendor" }, { from: "src/patterns", to: "patterns" }]`).
`dist/<env>/vendor/` and `dist/<env>/patterns/` sit as siblings of the
compiled `resources/` directory, so the runtime path resolution in
`resources/index.ts` works post-build.

**Adding a resource.** Drop markdown into `src/vendor/vitest-docs/`
(vendored upstream — managed by the snapshot pipeline) or `src/patterns/`
(curated content — author directly + update `_meta.json`). For the
vendored tree, every page MUST have a corresponding entry in
`manifest.json`'s `pages[]` array (path, title, description) — the
registrar's `list` callback in `resources/index.ts` reads it to emit
the per-page resource list. The existing template URIs
(`vitest://docs/{+path}`, `vitest-agent://patterns/{slug}`) automatically
address the file itself; no registrar change unless adding a new URI
scheme.

**Adding a new content tree** (e.g., `vitest-agent://decisions/`): add
the source directory under `src/` as a sibling of `src/vendor/` and
`src/patterns/`, extend `copyPatterns` in `rslib.config.ts` with another
`{ from, to }` entry to mirror it into `dist/<env>/`, register the new
scheme in `resources/index.ts`, add a reader file using the
path-traversal-safe root resolution, and resolve the new root from
`import.meta.url` using the same dev/post-build dual-path pattern.

## McpLive composition layer

`packages/mcp/src/layers/McpLive.ts`. Composes `DataReaderLive`,
`DataStoreLive`, `ProjectDiscoveryLive`, `OutputPipelineLive`,
`SqliteClient`, `Migrator`, `NodeContext`, `NodeFileSystem`, and
`LoggerLive`. The bin uses `ManagedRuntime` to execute against this
composite. The runtime is held for the process lifetime; database
connections persist for the long-running MCP server process.
