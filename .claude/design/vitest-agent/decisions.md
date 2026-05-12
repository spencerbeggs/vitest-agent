---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-03-20
updated: 2026-05-12
last-synced: 2026-05-12
completeness: 100
related:
  - ./architecture.md
  - ./components/sdk.md
  - ./components/plugin.md
  - ./components/reporter.md
  - ./components/cli.md
  - ./components/mcp.md
  - ./components/plugin-claude.md
  - ./components/ui.md
  - ./data-structures.md
  - ./decisions-retired.md
dependencies: []
---

# Decisions — vitest-agent

Active architectural decisions describing the system as it works now. Each
entry captures what the decision is, why it has this shape rather than the
obvious alternatives, and any load-bearing constraint that would not be
obvious from reading the source.

For decisions that have been superseded, see
[./decisions-retired.md](./decisions-retired.md).

**Parent document:** [architecture.md](./architecture.md)

---

## Architectural Decisions

### Decision 1: Dual Output Strategy (Markdown + JSON)

LLM agents need both human-readable context (for reasoning) and
machine-parseable data (for programmatic analysis of failures). Markdown is
natural for LLM reasoning; JSON enables persistence across runs and the
manifest-first read pattern. Each format serves a distinct purpose the
other cannot.

### Decision 2: Reporter-Native Project Grouping

Monorepo users need per-project output. The Reporter API provides project
info natively via `TestProject`, so grouping happens in the reporter via
`testModule.project.name` — no Vite plugin and no `:ai` mirror projects.
The `project` column stores `testModule.project.name` verbatim — one row
per workspace package. Test-kind differentiation moved to Vitest tags
(see Decision 23). Zero configuration; works identically in monorepos
and single repos with one reporter instance.

### Decision 3: Four-Environment Detection

`EnvironmentDetector` distinguishes `agent-shell`, `terminal`, `ci-github`,
and `ci-generic`. `ExecutorResolver` then maps these to three executor
roles (`human`, `agent`, `ci`) for output behavior. The CI split enables
GFM-specific behavior under GitHub Actions without conflating all CI
environments. The two-stage pipeline (fact-finding → behavior decisions)
keeps detection separate from policy.

### Decision 4: Duck-typed Istanbul Interface

Coverage integration must work with both `@vitest/coverage-v8` and
`@vitest/coverage-istanbul`. The `onCoverage` hook receives an istanbul
`CoverageMap`; both providers normalize to the same interface, so we
duck-type at runtime via `isIstanbulCoverageMap()` and avoid forcing a
specific coverage provider as a peer dependency. Istanbul interfaces stay
TypeScript interfaces, not schemas.

### Decision 5: Effect Schema Data Structures

Report and manifest data must be type-safe in TypeScript and serializable
to/from JSON. Effect Schema definitions live under
`packages/sdk/src/schemas/`. TypeScript types derive via
`typeof Schema.Type`; JSON encode/decode via `Schema.decodeUnknown` /
`Schema.encodeUnknown`. Schemas compose with Effect services without
bridging.

`zod` is a runtime dependency only for tRPC procedure input validation in
the MCP server. Effect Schema remains the source of truth for data
structures; Zod is scoped to MCP tool input schemas where `@trpc/server`
requires it.

### Decision 6: Effect Services over Plain Functions

The reporter, CLI, and MCP server share functionality (cache reading,
coverage processing). All three need testable I/O without mocking Node
APIs directly. The output pipeline needed distinct stages
(detect → resolve → select → resolve detail → render) to be individually
testable. The data layer split (`DataStore` writes, `DataReader` reads)
enables different composition in different contexts (reporter writes,
CLI/MCP read).

Live layers use `@effect/platform` `FileSystem` and
`@effect/sql-sqlite-node`; test layers swap in mock implementations.

### Decision 7: Scoped `Effect.runPromise` in Reporter

Vitest instantiates the reporter class — we don't control construction.
Each lifecycle hook (`onTestRunEnd`) builds a scoped effect and runs it
with `Effect.runPromise`, providing the `ReporterLive(dbPath)` layer
inline. The layer is lightweight (SQLite + pure services), so per-call
construction is acceptable and avoids `ManagedRuntime` lifecycle concerns
(no resource leak, no disposal). The MCP server uses `ManagedRuntime`
because it is a long-running process where per-call construction would be
wasteful.

### Decision 8: CLI-First Overview

The CLI generates overview/status data on-demand rather than the reporter
producing it on every test run. Overview generation requires filesystem
discovery (globbing, reading source files) that would slow down every test
run. On-demand generation is more appropriate for discovery data that
changes infrequently and keeps the reporter lean.

### Decision 9: Hybrid Console Strategy (Retired)

**Superseded by:** Decision 37 — Per-Executor Console Matrix (see below).

See [./decisions-retired.md](./decisions-retired.md) for the retired
entry. The pre-2.0 `strategy: "complement" | "own"` option was removed
when the per-executor console matrix landed; the `complement` mode (let
Vitest render and only persist) is expressible today as
`console.{slot}: "passthrough"`, and `own` mode collapses into any of the
non-`passthrough` `ConsoleMode` values.

### Decision 10: GFM Output for GitHub Actions

`AgentPlugin` auto-detects `process.env.GITHUB_ACTIONS` and appends GFM to
`process.env.GITHUB_STEP_SUMMARY`, with override via the `githubSummary`
option. The same data structures serve local and CI output — conditional
formatting is simpler than a separate reporter class. The Step Summary
path is independent of `consoleMode`: it defaults on under GHA when the
resolved console mode is not `silent`, and can be forced on or off
regardless of the console slot.

### Decision 12: Compact Console Output

LLM agents have limited context. Console output maximizes signal-to-noise:

- Single-line header with pass/fail counts and duration
- No summary tables (counts in the header)
- No coverage totals table; only files below threshold with uncovered
  lines
- "Next steps" with specific re-run commands (or MCP tools when
  `mcp: true`)
- Relative file paths throughout
- No redundant "All tests passed" line; no cache-file-pointer line

### Decision 13: History Always-On

`DataStore.writeHistory` runs unconditionally for each test case in
`onTestRunEnd`. History rows are small; the write cost is negligible
relative to test execution. An opt-in toggle would add API surface
without meaningful benefit. Agents always have classification data with
no configuration required.

### Decision 14: Vitest-Native Threshold Format

`coverageThresholds` accepts the full Vitest thresholds shape
(`Record<string, unknown>`) — per-metric thresholds, per-glob patterns,
negative numbers for relative thresholds, `100` shorthand, and `perFile`
mode. `resolveThresholds()` parses it into a typed `ResolvedThresholds`
structure. Aligning with Vitest's format means users who already
configure Vitest thresholds get the same shape.

### Decision 15: Three-Level Coverage Model

Users need both hard enforcement (fail the build) and aspirational goals
(track progress toward 100%). Three levels:

1. **Thresholds** (`coverageThresholds`) — enforced minimums
2. **Targets** (`coverageTargets`) — aspirational goals
3. **Baselines** — auto-ratcheting high-water marks in the
   `coverage_baselines` table

A single threshold serves one purpose; the three-level model lets one
project carry "must not regress" and "still climbing" simultaneously.

### Decision 16: Coverage Trend Tracking

Per-project trend tracking with a 50-entry sliding window in the
`coverage_trends` table. Only recorded on full (non-scoped) test runs.
Target change detection via hash comparison resets trend history when
targets change — comparing against the new target shape from the start
keeps the trend semantically meaningful.

### Decision 17: Tiered Console Output

Three tiers based on run health:

- **Green** (all pass, targets met): one-line summary
- **Yellow** (pass but below targets): improvements needed + CLI hint
- **Red** (failures/threshold violations/regressions): full detail + CLI
  hints

Implemented in the markdown formatter and controlled by `DetailResolver`,
which maps `(executor, runHealth)` to a `DetailLevel` enum. Progressive
disclosure keeps green runs quiet without losing detail when problems
accumulate.

### Decision 18: SQLite over JSON Files

The data layer is a normalized schema in a single SQLite file per cache
directory. JSON files create issues with concurrent access, atomicity,
querying across projects, and file proliferation in monorepos. SQLite
provides ACID transactions, concurrent reads via WAL, efficient queries
across projects, relational integrity via foreign keys, FTS5 for note
search, and migration-based schema evolution.

The rejected alternative was inspecting Vite's own cache JSON files for
analytics — unworkable in practice because the JSON had no strong typing,
suffered race conditions under parallel reads/writes, and was wiped by
routine package-manager operations. SQLite at an XDG-derived path resolves
all three.

The migration story uses `@effect/sql-sqlite-node`'s `SqliteMigrator`
with WAL journal mode. Composition layers (`ReporterLive`, `CliLive`,
`McpLive`) are functions of `dbPath` that construct the `SqliteClient`
layer inline.

### Decision 19: tRPC for MCP Routing

The MCP server exposes one tool per tRPC procedure. tRPC gives type-safe
procedures, `createCallerFactory` for testing without MCP transport,
middleware support, input validation via Zod, and clean separation of
routing from transport. The `createCallerFactory` pattern enables unit
testing of tool procedures without starting the MCP server, which a
direct MCP SDK handler approach could not match.

tRPC context carries a `ManagedRuntime` for Effect service access. Each
procedure calls `ctx.runtime.runPromise(effect)` to execute Effect
programs. Zod is used only for MCP tool input schemas.

### Decision 20: File-Based Claude Code Plugin

The Claude Code plugin lives in `plugin/` (NOT a pnpm workspace) as a
collection of static files: `.claude-plugin/plugin.json` manifest,
`.mcp.json` for MCP server registration, shell-based hooks, markdown
skill files, and markdown command files. Claude Code's plugin system
discovers plugins via filesystem conventions, so no compilation or
runtime is needed. Hooks use shell scripts for broad compatibility. The
plugin has no dependencies, no build step, and no tests, so a pnpm
workspace would add unnecessary configuration overhead.

### Decision 21: `spawnSync` for `run_tests`

The `run_tests` MCP tool uses `spawnSync` with a configurable timeout
(default 120s) to execute `npx vitest run`. MCP tool handlers are already
async (tRPC procedures return Promises), so blocking the handler with
`spawnSync` keeps the implementation simple — the tool blocks until
Vitest completes, then returns the result. The timeout prevents runaway
test runs from blocking the MCP server.

The MCP server cannot process other tool requests while `run_tests`
executes. Acceptable: agents typically wait for test results before
proceeding.

### Decision 22: Output Pipeline Architecture

Five chained Effect services form the output pipeline:

1. **`EnvironmentDetector`** — what environment are we in?
2. **`ExecutorResolver`** — what role does this environment imply?
3. **`FormatSelector`** — what output format should we use?
4. **`DetailResolver`** — how much detail should we show?
5. **`OutputRenderer`** — render reports using the selected formatter

Each stage has a single responsibility and is independently testable.
Explicit overrides (e.g. `--format` flag) can short-circuit any stage's
automatic selection. New formatters can be added without modifying the
pipeline services.

### Decision 23: Vitest-Native Tag Classification

Test-kind differentiation (`unit`, `int`, `e2e`) uses Vitest 4.1's native
tag system rather than per-kind project splitting or filename-driven
project names. `discoverProjects()` emits one project per workspace
package; the plugin installs a Vite `transform` hook (see
`packages/plugin/src/utils/inject-tags.ts`) that rewrites every `test()`
and `it()` call's options argument with a tags array derived from
filename classification (`*.e2e.test.ts` → `["e2e"]`, etc.). `TagStrategy`
in `vitest-agent-plugin` exposes the classifier and tag declarations;
`AgentPlugin.discover()` returns `{ projects, tags }` so the tag list
flows directly into `test.tags`.

Storage uses one `project` column keyed by package name. Per-tag
pass/fail/skip aggregates are computed by the plugin reporter and
attached to `AgentReport.tagCounts` for terminal rendering. Filtering at
the command line uses Vitest's standard tag-expression syntax. Replaces
the legacy `splitProject()` / `(project, subProject)` design from 1.x;
see [./decisions-retired.md](./decisions-retired.md) for why the colon
suffix was retired.

### Decision 24: Effect-Based Structured Logging

`LoggerLive` uses `Logger.structuredLogger` for NDJSON format with five
levels (`Debug`, `Info`, `Warning`, `Error`, `None`). Optional `logFile`
for file output via `Logger.zip`. Env var fallback
(`VITEST_REPORTER_LOG_LEVEL`, `VITEST_REPORTER_LOG_FILE`) enables
logging without config changes — useful for CI debugging.
Case-insensitive level names via `resolveLogLevel`. Effect's native
`Logger` integrates directly with `Effect.logDebug` calls used
throughout the service layer; NDJSON is parseable by log aggregation
tools.

### Decision 25: Per-Project Reporter Instances

Vitest calls `configureVitest` per project, giving each project its own
reporter instance. The plugin passes the project name from the
`configureVitest` context as `projectFilter` on `AgentReporter`. Each
reporter instance filters `testModules` to only modules matching its
project. Filtering at the reporter level is simpler than coordinating
between instances. Coverage dedup: only the first project alphabetically
processes global coverage data — deterministic and requires no shared
state.

### Decision 26: Native Coverage Table Suppression

Whenever the resolved `consoleMode` owns stdout (any value other than
`passthrough`), the plugin sets `coverage.reporter = []` to suppress
Vitest's built-in text coverage table, which duplicates the reporter's
own compact coverage output and wastes context window tokens for LLM
agents. Setting `coverage.reporter` to an empty array is the cleanest
suppression mechanism without affecting coverage data collection. In
`passthrough` mode the suppression is skipped so Vitest's reporters can
render their normal output, including the coverage table.

### Decision 27: `consoleStrategy` Renamed to `strategy` (Retired)

**Superseded by:** Decision 37 — Per-Executor Console Matrix (see below).

See [./decisions-retired.md](./decisions-retired.md) for the retired
entry. Both `consoleStrategy` and its rename `strategy` are gone; the
console behavior is now controlled by the per-executor `console` matrix.

### Decision 28: Process-Level Migration Coordination via globalThis Cache

In multi-project Vitest configurations sharing a single `data.db`, each
`AgentReporter` instance ran SQLite migrations through its own
`SqliteClient` connection. With a fresh database, two connections would
both start deferred transactions and then attempt to upgrade to write,
producing `SQLITE_BUSY`. SQLite's busy handler is not invoked for
write-write upgrade conflicts on deferred transactions, so
better-sqlite3's busy_timeout did not help.

The fix is `ensureMigrated(dbPath, logLevel?, logFile?)` in
`packages/sdk/src/utils/ensure-migrated.ts`. A promise cache keyed at
`Symbol.for("vitest-agent/migration-promises")` on `globalThis` ensures
migration runs exactly once per `dbPath` and concurrent reporter
instances share the same in-flight promise. The `globalThis` key
matters: Vite's multi-project pipeline can load our plugin module under
separate module instances within the same process, so a module-local
`Map` would produce independent caches per project and defeat
coordination.

`AgentReporter.onTestRunEnd` awaits `ensureMigrated` before the main
`Effect.runPromise`; on rejection it prints `formatFatalError(err)` to
stderr and returns. After the migration completes, normal reads/writes
work under WAL + `busy_timeout`. The fix lives at the call site — the
migrator's transaction boundaries are not ours to rewrite.

### Decision 30: Plugin MCP Loader as PM-Detect + Exec

`plugin/bin/start-mcp.sh` is a zero-deps POSIX shell PM-detect + exec loader:

1. Resolve `projectDir` from `CLAUDE_PROJECT_DIR` (or `pwd`).
2. Detect the user's package manager via `packageManager` field in
   `<projectDir>/package.json`, then by lockfile presence
   (`pnpm-lock.yaml` → pnpm, `bun.lock`/`bun.lockb` → bun, `yarn.lock`
   → yarn, `package-lock.json` → npm). Default `npm`.
3. `exec`-replace the shell with `<pm-exec> vitest-agent-mcp`, exporting
   `VITEST_AGENT_REPORTER_PROJECT_DIR=projectDir`. PM commands are
   `pnpm exec`, `npx --no-install`, `yarn run`, `bun x`.
4. Print PM-specific install instructions and exit 1 if the bin is missing.

The `exec` is load-bearing — after startup, Claude Code's direct child is
the PM process; there is no shell wrapper. A Node.js fallback loader
(`start-mcp.mjs`) exists for debugging but is not the active loader unless
`plugin.json` is changed to reference it.

**Why this shape:** the MCP server is its own package
(`vitest-agent-mcp`) with its own bin. The user's PM already knows how
to find and execute project bins; re-implementing that resolution in
the loader is the wrong layer. A missing peer dep surfaces as a
PM-level error with PM-native install instructions, not "couldn't find
./mcp export". `npx --no-install` (not plain `npx`) prevents npx from
silently downloading from the registry and exceeding Claude Code's MCP
startup window.

**`VITEST_AGENT_REPORTER_PROJECT_DIR` env passthrough:** the spawned MCP
subprocess uses this env var as the highest-precedence source for
`projectDir`. Claude Code sets `CLAUDE_PROJECT_DIR` for hook scripts
but does not reliably propagate it to MCP server subprocesses; this
passthrough ensures the MCP server sees the same project root the
loader resolved.

**Trade-off:** the loader knows about four PMs and their `exec`
syntaxes. Keeping that table current is a small maintenance cost.
PM-specific peer-dep enforcement varies (npm warns, pnpm errors, yarn
berry strict, bun varies); the README documents this so install UX
surprises are mitigated.

### Decision 31: Deterministic XDG Path Resolution

The data path is a deterministic function of the workspace's identity:

`$XDG_DATA_HOME/vitest-agent/<workspaceKey>/data.db`

`<workspaceKey>` is the root `package.json` `name` normalized via
`normalizeWorkspaceKey` (`@org/pkg` → `@org__pkg`). Without
`XDG_DATA_HOME`, falls back to
`~/.local/share/vitest-agent/<workspaceKey>/data.db` per `xdg-effect`'s
`AppDirs` semantics. An optional `vitest-agent.config.toml` lets users
override the `<workspaceKey>` segment (`projectKey` field) or the
entire data directory (`cacheDir` field). The plugin's programmatic
`reporter.cacheDir` option is highest precedence. See
[components/sdk.md](./components/sdk.md) for the full precedence table.

**Why XDG:** the DB is workspace-scoped state, not
project-build-output — it doesn't belong under `node_modules` (wiped
by `rm -rf node_modules`) or in the project tree (clutters git
status). XDG's "user data" category is the right semantic match and
`xdg-effect` honors `XDG_DATA_HOME` cross-platform with a sensible
fallback.

**Why workspace-name keying (vs path hash):** worktree consistency
(two checkouts of the same repo share history; path hashing would
diverge them), disk-move resilience (the DB follows project identity,
not filesystem coordinates), human-readability
(`ls ~/.local/share/vitest-agent/` shows package names, not opaque
hashes — useful for manual inspection, `cache clean`, and debugging),
and graceful fork behavior (a fork that renames its package gets its
own DB; a fork that keeps the same `name` shares the DB — opt out via
`projectKey`).

**Why fail-loud on missing workspace identity:** the default config
(no TOML override, no workspace `name`) raises
`WorkspaceRootNotFoundError` instead of falling back to a path hash.
Silent fallbacks make the DB location depend on filesystem layout
instead of identity. Anyone hitting this error has a one-line fix
(set `projectKey` in the config TOML or add `name` to their root
`package.json`).

**Why TOML for the config file:** TOML's distinction between strings
and identifiers reads more naturally for path-like config than
JSON's everything-is-a-string, `config-file-effect`'s `TomlCodec`
integrates cleanly with Effect Schema decoding, and TOML is familiar
from Cargo and Python tooling.

**Trade-off:** workspace-name collisions — two unrelated projects
sharing the same root `name` resolve to the same `<workspaceKey>` and
share a DB. Mitigations: the `projectKey` config override, the
human-readable XDG layout makes collisions discoverable on
inspection, and the README documents the behavior.

### Decision 32: Keep `ensureMigrated` Instead of `xdg-effect`'s `SqliteState.Live`

`xdg-effect` ships a `SqliteState.Live` that combines an XDG-resolved
path, a SQLite client, and a migrator into a single layer. We keep
`ensureMigrated` and our existing migrator setup instead.

**Why:**

- `SqliteState.Live` constructs migrations as part of layer
  construction, with no process-level coordination across independent
  layer instances. In multi-project Vitest configs each reporter
  instance constructs its own runtime (Decision 25), so multiple
  migrations would race on a fresh DB and reintroduce the SQLITE_BUSY
  issue Decision 28 fixes.
- The migration tracking tables differ: `xdg-effect` uses
  `_xdg_migrations`, `@effect/sql-sqlite-node`'s `SqliteMigrator` uses
  `effect_sql_migrations`. Reconciling them would be a bootstrap path
  with real test cost.
- `ensureMigrated`'s `globalThis`-keyed promise cache is small (~50
  LOC) and the maintenance cost is approximately zero.

Decision 28 remains in force as the canonical fix for the SQLITE_BUSY
race.

### Decision 33: Five-Package Split

**Amendment (2026-05-12):** the event-sourced renderer landed as a
sixth opt-in package, `vitest-agent-ui`. The five-package contract
this decision describes (mandatory peers for plugin + reporter + cli +
mcp built on top of sdk) is unchanged — `vitest-agent-ui` participates
in the same lockstep release cycle and depends only on
`vitest-agent-sdk`, but it is *not* a required peer of
`vitest-agent-plugin`. Hosts that want the React Ink mount or the
`eventSourcedReporter` factory pull it in directly. See
[./components/ui.md](./components/ui.md) for the package's contents.

The system ships as six pnpm workspaces under `packages/`:

| Package | Role |
| --- | --- |
| `vitest-agent-sdk` | data layer, schemas, services, formatters, utilities, XDG path stack — no internal deps |
| `vitest-agent-plugin` | `AgentPlugin`, internal `AgentReporter`, `ReporterLive`, `CoverageAnalyzer`; declares reporter, cli, mcp as required peers |
| `vitest-agent-reporter` | named `VitestAgentReporterFactory` implementations only (no Vitest-API code) |
| `vitest-agent-ui` | event-sourced renderer family (reducer, agent string, Ink tree, `eventSourcedReporter`, `createLiveInk`). Opt-in peer of consumers, not the plugin |
| `vitest-agent-cli` | `vitest-agent` bin |
| `vitest-agent-mcp` | `vitest-agent-mcp` bin |

All six release in lockstep via changesets `linked` config. The plugin
declares the reporter, CLI, and MCP packages as **required**
`peerDependencies` so installing the plugin still pulls the agent
tooling with it. `vitest-agent-ui` is *not* a required peer — it is an
optional add-on for hosts that want live rendering or the
event-sourced final-frame.

**Why this split:** the shared package boundary is determined by "what
does more than one runtime package need". The data layer, output
pipeline, and path-resolution stack are all needed by more than one
runtime, so they live in `vitest-agent-sdk` — circular imports are
impossible by construction. The CLI/MCP split is justified by
dependency footprint: `@effect/cli` is heavy and only the CLI needs
it; the MCP SDK + tRPC + zod stack is heavy and only MCP needs it.
Co-located, every install would pay for both.

**Why required peer deps (vs optional or full deps):** optional peers
would let users install only the plugin without the CLI/MCP, but
they'd silently lose the bin invocations the reporter's "Next steps"
output suggests and the MCP server the Claude Code plugin needs.
Direct deps would tie the plugin's lockfile to the CLI/MCP versions
and prevent independent upgrades. Required peers give lockstep version
coordination without bundling the dependency graph.

**Trade-offs:** six `private: true` package.jsons (rslib-builder
transforms each on publish), and consumers importing schemas use
`from "vitest-agent-sdk"`.

### Decision 34: Plugin/Reporter Split

`vitest-agent-plugin` (`packages/plugin/`) owns the Vitest plugin, the
internal `AgentReporter` Vitest-API class, `CoverageAnalyzer`,
`ReporterLive`, and reporter-side utilities. It constructs a
`ReporterKit`, calls the user-supplied factory, concatenates
`RenderedOutput[]`, and routes by target.

`vitest-agent-reporter` (`packages/reporter/`) contains named
`VitestAgentReporterFactory` implementations only (`defaultReporter`,
`markdownReporter`, `terminalReporter`, `jsonReporter`,
`silentReporter`, `ciAnnotationsReporter`, `githubSummaryReporter`)
plus a private `_kit-context.ts` helper.

Contract types in `vitest-agent-sdk`
(`packages/sdk/src/contracts/reporter.ts`):
`ResolvedReporterConfig`, `ReporterKit`, `ReporterRenderInput`,
`VitestAgentReporter` (single sync `render(input)` method returning
`RenderedOutput[]`), and `VitestAgentReporterFactory` (returns one
reporter or an array).

**Why "reporter as renderer-only" beats "reporter as Vitest-lifecycle
handler":** the Vitest Reporter API is a low-level surface that needs
careful integration with persistence, classification, baselines, and
trend computation — non-negotiable work every consumer needs. Output
decisions on top are highly opinionated and per-consumer. Pulling
rendering into a small synchronous contract means custom reporters
are one factory function (no Vitest Reporter subclass), the contract
has no Effect requirements / no lifecycle / no I/O, and persistence
runs exactly once per run regardless of how many reporters the
factory returns.

**Why the factory returns
`VitestAgentReporter | ReadonlyArray<VitestAgentReporter>`:** Vitest's
own multi-reporter pattern (`reporters: ['default', 'github-actions']`)
is the obvious shape for "multiple outputs from one run". Modeling it
directly means `defaultReporter` can return
`[primary, githubSummaryReporter]` under GitHub Actions without a
separate "composite reporter" abstraction. Each reporter sees the
same `ReporterKit` and `ReporterRenderInput`; their `RenderedOutput[]`
results are concatenated in factory-declaration order before routing.

**Why the default reporter lives in `vitest-agent-reporter` (not in
the plugin):** the plugin owns the Vitest lifecycle and the contract
glue, which rarely change. Opinions about what output goes where
change more often and should be forkable without touching the plugin.
Putting `defaultReporter` in the reporter package makes "fork the
default" mean "fork the reporter package" — one boundary, not two.

The Claude Code plugin manifest at
`plugin/.claude-plugin/plugin.json` keeps the identity
`vitest-agent-reporter` (a separate identity from the npm packages).
Hook scripts call the CLI bin `vitest-agent`.

### Decision 35: MCP Resources and Prompts (Two URI Schemes, Framing-Only Prompts)

The MCP server exposes two non-tool surfaces alongside the tRPC tool
router. **Resources under two URI schemes:** `vitest://docs/` exposes
the vendored upstream Vitest documentation snapshot at
`packages/mcp/src/vendor/vitest-docs/`; `vitest-agent://patterns/`
exposes the curated patterns library at `packages/mcp/src/patterns/`.
Each scheme registers an index resource and a page template
(`{+path}` or `{slug}`). All return `text/markdown`. **Framing-only
prompts:** `triage`, `why-flaky`, `regression-since-pass`,
`explain-failure`, `tdd-resume`, `wrapup`. Each takes a zod-validated
argument set and returns user-role messages that orient the agent
toward the right tool composition — no tool data is pre-fetched on the
server.

Registrars (`packages/mcp/src/resources/index.ts` and
`packages/mcp/src/prompts/index.ts`) are called from `server.ts`
immediately before `StdioServerTransport` is constructed.

**Why two URI schemes:** the schemes carry content with different
provenance. `vitest://` is vendored upstream content (a snapshot of
`vitest-dev/vitest`'s `docs/` tree at a pinned tag, MIT-licensed,
attributed in `ATTRIBUTION.md` + `manifest.json`).
`vitest-agent://` is content authored *for* this project (curated
guidance about testing Effect, schemas, and reporters). Splitting the
schemes makes provenance visible at a glance, a client UI can render
the two trees differently, an agent can cite the right source without
inspecting path prefixes, and a future "trust this source for X but
not Y" policy becomes expressible at the URI-scheme level.

**Why vendor the Vitest docs (vs fetch on demand):** the MCP server is
called from agent loops that may have no network egress (sandbox
policies, airgapped CI, offline dev). A network-fetching handler would
intermittently fail and agents would interpret it as "the docs are
gone". `manifest.json` records the exact upstream tag + commit SHA +
capture timestamp + source URL; `ATTRIBUTION.md` carries the MIT
license notice. Provenance is verifiable without trusting the build
pipeline. The Effect-based maintenance scripts under
`packages/mcp/lib/scripts/`, driven by the project-local
`.claude/skills/update-vitest-snapshot/` skill, make "bump the Vitest
docs we ship" a deliberate operation that goes through code review.

**Why `execFileSync` with array args for the snapshot fetcher:** the
fetcher takes a tag string from the CLI and passes it to `git`.
Building a shell command and passing it to `execSync` opens a
shell-injection hole; a malicious upstream tag like
`v4.0.0; rm -rf $HOME` would execute as written.
`execFileSync("git", [..., "--branch", tag, ...], { cwd })` invokes
git directly without spawning a shell.

**Why path-traversal guarding in `paths.ts`:** resource URI template
variables come from clients. A naïve `join(vendorRoot, relative)`
would let `vitest://docs/../../etc/passwd` escape the vendored tree.
`resolveResourcePath` enforces three invariants: no null bytes, no
absolute paths, and the resolved path must start with `<root><sep>`
(or equal `root` for empty input). Reader functions
(`upstream-docs.ts`, `patterns.ts`) must call `resolveResourcePath`
before any `readFile` — the helper is the security boundary, not a
performance optimization.

**Why "framing-only" prompts (vs pre-fetching tool data):**
pre-fetching would invert the cost model — `triage` would call
`triage_brief` server-side just to emit one templated message, paying
the database read twice. Pre-fetching also couples the prompt result
to database state at prompt-selection time, which is one or two agent
turns earlier than when the agent uses the data; by then it's stale.
Framing-only prompts compose with existing tools: `triage` orients
the agent toward `triage_brief` + `failure_signature_get` +
`hypothesis_record`, and the agent calls those tools at the right
time. Argument validation lives in the prompt (zod), so failures show
up at prompt selection rather than several turns later in tool calls.

**Why direct SDK registration (vs tRPC):** tRPC is the right
abstraction for tools (input validation + typed context + caller
factory for testing). Resources are URI-addressable reads; prompts are
templated message emitters. Both are well-served by the SDK's native
`registerResource` / `registerPrompt` APIs, which understand URI
templates and argument schemas natively. Forcing resources through
tRPC would mean inventing a procedure-per-resource convention and
re-implementing URI template matching in the router. The two surfaces
share the same `McpServer` instance, the same stdio transport, and
the same `ManagedRuntime` indirectly.

**Vendor + patterns under `src/`.** Turbo's build-cache input includes
`src/` by convention, so snapshot refreshes show up as build-affecting
deterministically. The dist layout
(`dist/<env>/vendor/` and `dist/<env>/patterns/`) is produced by
rslib's `copyPatterns` config in `packages/mcp/rslib.config.ts`. The
build/copy pair is atomic by construction.

**Snapshot lifecycle is split across three Effect-based scripts.**
Under `packages/mcp/lib/scripts/`: `fetch-upstream-docs.ts`
(sparse-clone into a gitignored `lib/vitest-docs-raw/`),
`build-snapshot.ts` (denylist + strip frontmatter + scaffold
`manifest.json` with placeholder descriptions marked
`[TODO: replace with load-when signal]`), and
`validate-snapshot.ts` (schema-decodes the manifest, asserts `pages[]`
non-empty, refuses any `[TODO` description, enforces a 30-character
minimum description length). The split gives the refresh skill a
place to insert the description-authoring step between scaffolding
and the gate. Scripts share Effect Schema types
(`UpstreamManifest` in `src/resources/manifest-schema.ts`) with the
runtime.

**Maintenance scripts live under `lib/scripts/`, not `src/scripts/`.**
They are not part of the published bundle. `lib/` is the repo
convention for build-affecting TypeScript that lives outside the
bundle, matching the `lib/configs/` directory at the repo root.

**Per-page metadata via SDK `list` callback.** The `vitest_docs_page`
`ResourceTemplate` is registered with a `list` callback that decodes
`manifest.json` against the `UpstreamManifest` Effect Schema and emits
per-page `{ name, uri, title, description, mimeType }` for every
entry in `pages[]`. Registering each page as its own
`server.registerResource` call would tightly couple the registrar to
content, force a code change for every snapshot refresh, and lose the
schema-validated single source of truth. `pages[]` is optional in the
schema so the registrar can fall back gracefully (return
`resources: []`) during transitional pre-skill-run states; the
`validate-snapshot.ts` script enforces non-empty `pages[]` as a
commit-time quality gate.

**The `update-vitest-snapshot` skill is repo-internal.** Located at
`.claude/skills/update-vitest-snapshot/`, never plugin-shipped. It is
a 5-phase interactive workflow: fetch → inventory and prune →
scaffold → **agent rewrites each manifest entry's description as a
"load when" signal one entry at a time** → validate. Phase 4 is the
reason the skill exists: per-page `title` and `description` drive
what MCP clients display in their resource picker, so they directly
determine discoverability.

**Trade-offs:** the MCP package's release artifact ships markdown
trees (`vendor/` + `patterns/`) alongside compiled JS. Vendored
snapshots get stale, but a stale snapshot is still useful and the
explicit refresh path makes staleness visible in the changelog.
Prompts cannot dynamically discover tools — a future "this prompt
should expand to whatever tools are currently registered" need would
require server-side enumeration the framing-only design doesn't
support. The maintenance scripts depend on workspace `node_modules`
(`tsx`, Effect Schema); the gain is sharing the `UpstreamManifest`
schema with the runtime.

### Decision 36: Lockstep Release with Build-Inlined Version

The six npm packages release in lockstep — a version bump to any one
bumps all six — and every bundle carries its release version as a
build-time string constant `process.env.__PACKAGE_VERSION__`, inlined
by `rslib-builder` from the source `package.json` at build time. The
Claude Code plugin versions independently; it can lag the npm packages
by one or more releases, and is the only piece of the system permitted
to do so.

The runtime invariant is that the packages running in the same process
must share the same `__PACKAGE_VERSION__` value. The CLI's `doctor`
command and the MCP server's startup checks compare the inlined values
across the SDK, plugin, reporter, CLI, MCP, and (when present) the
optional `vitest-agent-ui` package; a mismatch produces a structured
error pointing at the peer-dep that drifted.

**Why build-inlined (vs runtime `package.json` read):** the inlined
constant has no I/O cost, no path-resolution failure mode, and no
ambiguity about *which* `package.json` is read (the package's own,
the consumer's hoisted copy, a pnpm symlink target). It also makes
mismatch detectable in environments where `package.json` files are
not on disk at runtime (bundled, packaged binaries). The trade-off is
that the build is the source of truth for the version string — but
that is already the case for everything else `rslib-builder`
produces.

**Why lockstep (vs independent semver per package):** the npm
packages share types and runtime contracts at the SDK boundary
(`DataStore`, `DataReader`, the reporter contract types, the schemas).
A consumer hitting any cross-package type mismatch sees an opaque
TypeScript or runtime error rather than a "you upgraded the plugin
but not the reporter" diagnostic. Required `peerDependencies` (D33)
make installation lockstep on the consumer's side; build-inlined
version comparison makes drift detectable at runtime if the lockfile
ever lies (npm's looser peer-dep enforcement, manual `npm install`
patterns, monorepo hoist surprises).

**Why the Claude Code plugin can lag:** the plugin is a file-based
distribution through the Claude marketplace (D20). Its release cadence
is decoupled from npm's. The plugin's loader (D30) shells out to the
user's package manager to spawn the MCP server — whichever version
of `vitest-agent-mcp` the consumer's lockfile resolves is what the
plugin gets. The MCP server's startup version check is the gate that
catches plugin-vs-MCP drift if it happens.

**Trade-off:** every package release is the size of the smallest
useful change times six. A docs-only fix in the SDK still bumps the
plugin, reporter, ui, CLI, and MCP. Acceptable in exchange for the
runtime sync guarantee.

**Cross-references:** D33 (Five-Package Split — establishes the
required-peer-deps shape this decision protects) and D30 (Plugin MCP
Loader — describes why the MCP runs from the consumer's installation
context, which is what makes the build-inlined version a meaningful
sync check).

### Decision 37: Per-Executor Console Matrix + Streaming Reporter Tap

The plugin replaces the pre-2.0 `mode` (`"agent" | "human" | "ci"`) +
`strategy` (`"own" | "complement"`) options with a single
**per-executor console matrix**: `AgentPluginOptions.console: { human?,
agent?, ci? }`. Each slot accepts only the modes valid for that executor
— `human` can be `passthrough | silent | ink | agent`; `agent` can be
`passthrough | silent | agent`; `ci` can be `passthrough | silent |
ci-annotations`. The plugin auto-detects the executor via
`EnvironmentDetector`, looks up the matching slot, and resolves a single
`ConsoleMode` value that flows through `ReporterKit.config.consoleMode`
into every reporter.

Two derived behaviors fall out of the resolved mode:

1. **Stdout ownership.** Any non-`passthrough` value strips Vitest's
   built-in console reporters AND zeroes `coverage.reporter` so the
   plugin owns stdout for the run.
2. **Live-tap gating.** The optional `onRunEvent: (event: RunEvent) =>
   void` callback is forwarded to `AgentReporter` only when
   `consoleMode === "ink"`. Other modes either render statically
   (`agent`, `ci-annotations`) or asked for silence (`passthrough`,
   `silent`); forwarding the tap regardless would leak a live Ink
   mount into channels the user explicitly opted out of.

Alongside the option-shape change, `AgentReporter` now implements
Vitest's streaming hooks (`onTestRunStart`, `onTestModuleQueued`,
`onTestModuleStart`, `onTestCaseResult`, `onTestModuleEnd`) and fires a
matching `RunEvent` from each. `vitest-agent-ui`'s `createLiveInk()`
consumes the events through `onRunEvent` to drive a live React Ink
mount that re-renders on every beat.

**Why a per-executor matrix beats a single `mode` enum:** humans,
agents, and CI runners want different visible behavior from the same
config file. The pre-2.0 `mode` enum forced one global choice; users
debugging a CI failure locally had to flip the option (or set an
environment variable) just to change rendering. The matrix lets one
`vitest.config.ts` declare "live Ink for humans, markdown final-frame
for agents, GHA annotations on CI" simultaneously and the plugin picks
the right slot based on where it is running. Each slot's legal-mode
set is narrowed at the type level: it is impossible to ask for an Ink
mount on a CI run, or for GitHub annotations on a human terminal.

**Why a callback rather than putting live rendering on the factory
contract:** the `VitestAgentReporterFactory.render(input)` contract is
deliberately a single synchronous batch call (one frame per project,
end of run). Adding `start` / `event` / `stop` lifecycle methods to the
factory would couple every reporter to the streaming surface even when
it only needs the final frame. The callback model lets one host opt
into live rendering by wiring `onRunEvent: live.event` while every
other reporter — including all of `defaultReporter`'s named factories
— stays a pure `render`-only consumer.

**Why retire `strategy` ("complement" / "own"):** the two states were
"let Vitest's reporters run AND persist" vs. "strip Vitest's reporters
AND emit our own". Both are now expressible as `console.{slot}` values
(`passthrough` for the former, any of the other modes for the latter)
without a redundant top-level toggle. The matrix subsumes the strategy
flag and gives finer control along the way.

**Cross-references:** D34 (Plugin/Reporter Split — the reporter
contract that this decision threads `consoleMode` through), and the
retired entries D9 / D27 / the old D12 prose in
[./decisions-retired.md](./decisions-retired.md).

### Decision D9: Last Drop-and-Recreate Migration

**Amendment (pre-2.0 policy).** Before 2.0 ships to npm, the canonical
schema lives in a single consolidated `0001_initial.ts`. The prior
`0002_comprehensive.ts` was folded back into `0001_initial.ts` and
deleted; developers wipe `data.db` on every breaking schema change.
The "no future drop-and-recreate" invariant below applies once 2.0
ships and users have published data. Until then, edit
`0001_initial.ts` directly.

`0002_comprehensive` (now folded back into `0001_initial`) is a
drop-and-recreate. After 2.0 ships, **no future migration is allowed
to drop and recreate**. 2.0.x and beyond are ALTER-only; for any
breaking schema shape that ALTER cannot express, ship a one-shot
export/import path on a major bump rather than dropping data.

**Why drop-and-recreate for `0002`:**

- Prior data was already lost when the DB location changed to the XDG
  workspace-keyed path (Decision 31, intentionally no-migration).
  Adding a preserving migration would help only a small pre-release
  audience.
- The schema diff is large. Per-column ALTER scripts (notably the
  `test_errors.signature_hash` FK requiring `failure_signatures` to
  exist first, the `stack_frames` source-map columns, the trigger
  rewrite for `notes_fts`) would be meaningful test-code volume for
  marginal value.
- The drop ordering is paid once: drop children before parents, drop
  FTS triggers before `notes`/`notes_fts` so cascading triggers don't
  fire against an already-dropped virtual table.

**Why ALTER-only forever after:**

- Drop-and-recreate is never a free choice once users have data in
  the schema. Every subsequent drop-and-recreate would be data loss.
  Calling out "this is the last one" in the design contract makes the
  no-data-loss invariant enforceable in code review.
- For migrations that need a new shape ALTER cannot express (e.g.
  splitting a JSON column into a relational subtree), the right
  escape hatch is a one-shot export/import on a major bump.

**Trade-off:** future major bumps that need a non-ALTER shape change
require an export/import script in the SDK; the cost is deferred until
needed.

### Decision D10: Stable Failure Signatures via AST Function Boundary

The failure signature is a 16-char `sha256` hex prefix of `(error_name |
normalized assertion shape | top non-framework function name |
function-boundary line)`, computed by `computeFailureSignature` in
`packages/sdk/src/utils/failure-signature.ts`. The function-boundary
line comes from `findFunctionBoundary` in
`packages/sdk/src/utils/function-boundary.ts`, which parses the source
via `acorn` and walks the AST for the smallest enclosing function whose
`loc` range contains the failing line. The function's *start* line
becomes the signature's spatial coordinate. The assertion shape is
normalized via `normalizeAssertionShape`, which strips matcher arguments
to type tags (`<number>`, `<string>`, `<boolean>`, `<null>`,
`<undefined>`, `<object>`, `<expr>`).

**Why the function boundary (vs raw line):** insertions, deletions,
comment edits, formatter changes, and unrelated assertions inside the
same function don't move the function's start line as long as the
function definition itself doesn't move. A new function inserted
*before* the failing function does shift the boundary line, which is
correct: the failure is now structurally located somewhere different
in the file. Tied to the parsed AST, the boundary survives
whitespace-only reformatting that defeats text-based heuristics.

**Why type-tag assertion normalization:** `expect(42).toBe(43)` and
`expect(7).toBe(8)` produce the same signature — they're the same
failure shape with different literals. Different *shapes* still produce
different signatures: `toBe(<number>)` vs `toBe(<string>)` vs
`toEqual(<object>)`. Value churn collapses while structural intent is
preserved.

**Why a 10-line raw-line fallback bucket:** when `findFunctionBoundary`
returns null (parse error, top-level code outside any function), the
signature falls back to `raw:<floor(line/10)*10>`. It loses some
stability but doesn't churn on every single-line edit. When even the
raw line is unknown, falls back to `raw:?`, which collapses all such
failures to one signature — intentional, since we have no better
discriminator.

**Why acorn:** zero-deps on the parser side, returns AST nodes with
`loc` data, throws cleanly on syntax errors. Extended with
`acorn-typescript` via `Parser.extend(tsPlugin())` so TypeScript
sources with type annotations, generics, decorators, and `as` casts
parse without throwing.

**Trade-offs:**

- Re-parsing source on every signature computation is moderately
  expensive (microseconds per parse). Bounded by failure count, not
  assertion count. If this becomes a bottleneck we can cache parses
  by `(file, mtime)`.
- The boundary line shifts when the function definition itself moves.
  Correct behavior — the failures are structurally different
  post-refactor.

### Decision D11: TDD Phase-Transition Evidence Binding

Evidence binding is encoded in three rules, enforced by the pure
`validatePhaseTransition` function in
`packages/sdk/src/utils/validate-phase-transition.ts`. The function
takes a `PhaseTransitionContext` (current phase, requested phase, cited
artifact, requested behavior) and returns a discriminated
`PhaseTransitionResult` — either acceptance or a denial with a typed
reason and a remediation hint.

**The three D2 binding rules:**

1. **Evidence in phase window AND session.** The cited test must have
   been authored in the current phase window
   (`test_case_created_turn_at >= phase_started_at`) AND in the
   current session (`test_case_authored_in_session === true`).
   Prevents citing a test written before the phase started or in
   another session.
2. **Behavior match.** When the orchestrator requests a transition for
   a specific behavior, the cited artifact's `behavior_id` must equal
   the `requested_behavior_id`. Prevents citing the right kind of
   evidence but for the wrong behavior.
3. **Test wasn't already failing.** For `red → green` transitions
   where the cited evidence is a `test_failed_run`, the test's
   `test_first_failure_run_id` must equal the cited `test_run_id`.
   Prevents citing a test that was *already* failing on main as proof
   of "I just put it in red".

**Artifact-kind precondition:** `red → green` requires
`test_failed_run`, `green → refactor` requires `test_passed_run`,
`refactor → red` requires `test_passed_run` (refactor must end with
all tests still passing).

**Source-phase guard for `green`:** `validatePhaseTransition` enforces
that `green` may only be entered from `red`, `red.triangulate`, or
`green.fake-it`. Requesting `green` from any other phase returns
`{ accepted: false, denialReason: "wrong_source_phase" }` with a
remediation pointing at the missing `→ red` step. Skipping the named
red phase entirely would leave the `tdd_phases` table without a
`phase="red"` row, breaking the phase-evidence integrity metric.

All remaining transitions are evidence-free and accepted
unconditionally — including `spike → red` (the entry point for every
TDD cycle), `red.triangulate → red`, `green.fake-it → refactor`, and
`refactor → red`.

**Why a pure function (vs Effect service):** the function takes a
context object and returns a result. No I/O, no async. Effect service
wrapping would be ceremony for no testability gain. The orchestrator
loads binding context (cited artifact details, session info) via
`DataReader` Effect calls and passes the resolved context to
`validatePhaseTransition` as plain data.

**Why typed denial reasons + remediation:** `DenialReason` is a closed
union the orchestrator surfaces back to the agent in structured form,
not free-text. The agent can match on the reason and recover
programmatically. Each denial carries a `Remediation` with a
`suggestedTool`, `suggestedArgs`, and `humanHint` so the agent has an
obvious next step.

**Trade-off:** the validator only enforces binding rules; it does not
verify the cited artifact actually exists, that the session is still
open, or that the goal is started. Those are pre-validator
responsibilities of the orchestrator, which already needs the artifact
details for the context object.

### Decision D12: Three-Tier Objective→Goal→Behavior Hierarchy

The TDD ledger is a three-tier hierarchy with first-class storage and
CRUD for goals and behaviors:

```text
Objective  (tdd_tasks.goal)
  └── Goal 1  (tdd_session_goals)
        ├── Behavior 1.1  (tdd_session_behaviors)
        └── Behavior 1.2
  └── Goal 2
        └── Behavior 2.1
```

Each tier has its own row-level identity, status lifecycle (closed:
`pending → in_progress → done|abandoned`), and CRUD surface. The
orchestrator decomposes via LLM reasoning and creates each entity
individually through `tdd_goal({ action: "create" })` /
`tdd_behavior({ action: "create" })` actions on the consolidated
tools. The server stores what it's told and validates referential
integrity through tagged errors at the DataStore boundary; it does
not linguistically interpret goal text.

**Why LLM-driven decomposition (vs server-side splitting):** the right
abstraction layer for "what counts as one behavior" is the LLM itself,
not a string-splitter. LLM-driven decomposition has full access to
context (goal text, acceptance criteria, codebase patterns) the server
does not. The server retains hard guarantees through schema
constraints (FKs, CHECK on status, junction-table validation): the
LLM cannot invent behavior ids, cannot create a behavior under a
closed goal, cannot depend on a behavior in a different goal.

**Why goals are first-class storage (rather than text in
`tdd_tasks.goal`):** goals are addressable in their own right —
status transitions, ordinal allocation, dependency junction-table
references, channel events keyed on goal id, phase-transition
pre-checks ("is the cited behavior's parent goal `in_progress`?"). The
`(session_id, id)` covering index supports cheap behavior→goal→session
join paths so we don't denormalize `session_id` onto behaviors.
Goal-level lifecycle events need a stable id to address; storing them
as session metadata would collide on duplicate goal text.

**Why `dependsOnBehaviorIds` is a junction table:** see Decision D14.

**Trade-offs:**

- Two more tables (`tdd_session_goals`, `tdd_behavior_dependencies`).
  Index footprint is minimal.
- The state machine remains per-behavior (8 phases). Goal-level
  iteration is workflow code in the orchestrator, not a state in
  `tdd_phases`.

### Decision D13: MCP Permits, Agent Restricts (Capability vs Scoping)

Capability lives on the MCP surface; scoping lives at the agent + hook
layer:

1. The orchestrator's `tools[]` frontmatter array enumerates only
   non-destructive goal/behavior tools — `tdd_goal_delete` and
   `tdd_behavior_delete` are absent (documentation, not enforcement).
2. `pre-tool-use/tdd-restricted.sh` is a `PreToolUse` hook scoped to
   the orchestrator subagent (via `lib/match-tdd-agent.sh`) that
   returns `permissionDecision: "deny"` with a remediation hint
   pointing at `status: 'abandoned'` if the orchestrator tries to
   call either delete tool. **This is the runtime gate.** It also
   reaffirms denial of `tdd_artifact_record` (per Decision D7) for
   defense-in-depth.
3. The main-agent allowlist (`safe-mcp-vitest-agent-ops.txt`) omits
   the two delete tools. Main-agent calls to deletes fall through to
   Claude Code's standard permission prompt, so the user sees a
   confirmation dialog before any cascade.

**Why this split (vs adding the deletes as restricted tools on the MCP
server itself):** the MCP server has no agent-identity. It can't tell
"main agent" from "orchestrator subagent"; it sees stdio bytes.
Identity lives one layer up, in the Claude Code hook envelope's
`agent_type` field. Putting agent-scoping in the server would require
shipping agent-aware authentication into a tool-routing layer, which
is more surface than the problem warrants.

**Why two layers of denial (`tools[]` + hook):** `tools[]` is the
documentation surface — it's how the orchestrator system prompt knows
what's available. The hook is the runtime gate. If a future Claude
Code update starts ignoring `tools[]`, or if a misconfigured override
enables more tools, the hook still denies. Defense-in-depth.

**Relationship to Decision D7:** D7 keeps `tdd_artifact_record`
*entirely off* the MCP surface — hooks observe what the agent did, the
agent never writes evidence about itself. D13 is a related but
distinct pattern: the delete tools **exist** on the MCP surface (for
the main agent under user confirmation) but are denied to the
orchestrator at the hook layer. Together they describe the full "MCP
permits, agent restricts" doctrine.

**Trade-off:** a misconfigured orchestrator (e.g., a fork that adds
delete tools back to `tools[]` and disables the hook) could call
deletes. Acceptable because both gates would have to fail
simultaneously.

### Decision D14: Junction Table for Behavior Dependencies

Dependencies live in a dedicated `tdd_behavior_dependencies` junction
table with composite PK `(behavior_id, depends_on_id)` and
`ON DELETE CASCADE` on both endpoints. A `CHECK (behavior_id !=
depends_on_id)` prevents self-dependencies. A reverse-lookup index on
`depends_on_id` enables "what depends on X" queries.

**Why a junction table (over JSON-in-TEXT):**

- **FK enforcement.** Both endpoints reference
  `tdd_session_behaviors(id)`. The DB rejects orphan ids the
  orchestrator might supply by mistake, surfacing as
  `BehaviorNotFoundError` at the DataStore boundary.
- **Recursive CTE walks.** Common-table-expression queries can
  traverse the dependency graph without parsing JSON in SQL.
- **CASCADE semantics.** Deleting a behavior cleanly removes both
  sides of every dependency edge. With JSON, deleting a behavior
  would orphan ids in other behaviors' arrays.
- **Same-goal validation.** `createBehavior` validates that every
  `dependsOnBehaviorIds` entry resolves to a behavior under the same
  goal — a relational query.

**Why CHECK on `behavior_id != depends_on_id`:** self-dependencies are
always logically wrong (a behavior blocking itself can never resolve);
cheaper to enforce in DDL than discover later in the recursive walker.

**Trade-off:** updates to dependencies replace the entire set in one
transaction (`updateBehavior` deletes old rows, inserts new). Slightly
more SQL than overwriting a JSON column, but bundled in
`sql.withTransaction` so it's atomic.

### Decision D15: `tdd_phases.behavior_id` Cascade

`tdd_phases.behavior_id` FK action is `ON DELETE CASCADE`. Deleting a
behavior erases its entire phase ledger and (transitively, via
`tdd_artifacts.behavior_id` also `ON DELETE CASCADE`) its evidence.

The delete-vs-abandon distinction:

- **Delete = "this never existed."** Used to clean up duplicates the
  orchestrator created by mistake. Removes all evidence — there is
  nothing to attribute.
- **Abandon (status = `abandoned`) = "we tried but didn't finish,
  preserve evidence."** This is the orchestrator's only way to drop
  work. Keeps the phase ledger and artifacts available for downstream
  metrics (`acceptance_metrics`), failure-signature recurrence
  tracking, and post-hoc analysis.

**Why CASCADE:** `tdd_phases` rows without a `behavior_id` cannot be
reasoned about by the binding-rule validator, the channel-event
renderer, or the metrics computation. Keeping rows around with NULL
`behavior_id` is data leak, not preservation. The orchestrator is
denied delete tools by `pre-tool-use/tdd-restricted.sh` (Decision
D13), so cascade delete only happens via main-agent calls under
explicit user confirmation. Abandon-via-status preserves the rows
when preservation is semantically appropriate.

---

## Agent-Agnostic Taxonomy (planned for 2.0 — Phase 1.5 spike outcomes)

These decisions emerged from the four Phase 1.5 spikes for the
agent-agnostic-taxonomy refactor (plan at `.claude/plans/agent-agnostic-taxonomy.md`).
They document Claude Code runtime behavior we discovered empirically
and the design responses. All four spikes are closed; Phase 1 starts
from these conclusions.

### Decision D16: Sidecar CLI over `mcp_tool` Hooks for Hook→MCP Communication

Phase 1.5 Spike 2 ruled out the `mcp_tool` hook event type for the
`register_agent` flow. The hook's `input` field accepts only
`${path}` substitutions from the triggering event's JSON payload —
it cannot carry caller-supplied values like `clientNonce`,
`startGitBranch`, `startGitCommitSha`, or `startWorktreeDir`, all of
which are generated or computed in the hook itself.

The plan pivoted to a **sidecar CLI pattern**: every hook that
needs to call `register_agent` (or peers) shells out to
`${CLAUDE_PLUGIN_ROOT}/bin/vitest-agent _internal register-agent`,
which runs Node, captures git context via the Effect-side
`RunContext` service, generates `clientNonce`, and writes through to
both the per-project `data.db` and the per-client session map in a
single process.

The sidecar binary is a hidden subcommand namespace of the existing
`vitest-agent-cli` package — no separate distribution, no separate
release. The plugin's `bin/vitest-agent` is a shim into the
installed CLI.

**Performance constraint:** Node cold-start (≈150ms) is acceptable
for SessionStart and SubagentStart (one-shot per session/subagent)
but unacceptable for PreToolUse Bash interception (fires on every
Bash tool call). PreToolUse uses a **long-running daemon** transport
that the SessionStart hook launches; PreToolUse hooks contact it via
a Unix-domain socket. The daemon socket lives in a per-instance
coordination directory (see Decision D18).

### Decision D17: `CLAUDE_ENV_FILE` Auto-Source + Hook Self-Source Bridge

Phase 1.5 Spike 5 mapped Claude Code's env-propagation surface
empirically. The model:

- **SessionStart** (and Setup, CwdChanged, FileChanged) hooks have
  `${CLAUDE_ENV_FILE}` available and write `export KEY=VAL` lines
  to it. Files land at
  `~/.claude/session-env/<session_id>/sessionstart-hook-N.sh`, one
  file per plugin.
- **Bash tool subprocesses and the MCP server child** inherit
  the union of all plugins' exports automatically — Claude Code
  sources the directory when spawning these.
- **Other hook subprocesses** (PreToolUse, SubagentStart, etc.) do
  NOT auto-receive the sourcing. Per the docs: "CLAUDE_ENV_FILE is
  available for SessionStart, Setup, CwdChanged, and FileChanged
  hooks. Other hook types do not have access to this variable."

To bridge the hook gap, vitest-agent ships
`plugin/hooks/lib/source-session-env.sh`. Every non-SessionStart
hook starts with:

```bash
payload=$(cat)
session_id=$(echo "$payload" | jq -r '.session_id')
. "$(dirname "$0")/lib/source-session-env.sh" "$session_id"
```

The helper walks `~/.claude/session-env/${session_id}/*hook*.sh`
and sources each file. After self-sourcing, hooks read identifiers
from env just like the reporter, sidecar, and MCP server do —
unifying the access story.

**Implementation parity:** the helper mirrors
`EnvLoader.loadSessionEnvFiles` from `claude-binary-plugin`
(`packages/src/layers/EnvLoaderLive.ts`) — same directory walk,
same `*hook*.sh` filter. Already battle-tested by another shipped
plugin against the same Claude Code surface.

**`export` is mandatory.** Bare `KEY=VAL` lines are sourced as
shell-script locals and do not propagate. Documented as a hook
invariant.

### Decision D18: Per-Instance Coordination Directory under `${CLAUDE_PLUGIN_DATA}/sessions/`

Phase 1.5 Spike 4 confirmed that Claude Code does NOT export any
per-Claude-instance directory env var (`CLAUDE_SESSION_ENV_DIR`,
`CLAUDE_CONVERSATION_DIR`, etc. — every candidate name returned
unset in the empirical PreToolUse dump). What's documented and
exported is `${CLAUDE_PLUGIN_DATA}` (per-plugin install) and the
`session_id` field in every hook's stdin payload.

The canonical coordination directory is therefore
`${CLAUDE_PLUGIN_DATA}/sessions/${session_id}/`. The composition is
unambiguous, per-Claude-instance (since `session_id` is unique per
running Claude Code window), and uses only documented surfaces.

Contents:

- `sidecar.sock` — Unix-domain socket the daemon listens on
- `sidecar.sock-path` — sentinel file containing the absolute
  socket path (so the MCP server and PreToolUse hooks can resolve
  it via filesystem lookup, not just env)
- `daemon.pid` — daemon's PID for SessionEnd cleanup

SessionStart creates the dir, launches the daemon, and writes the
sentinel files. SessionEnd kills the daemon, removes the socket
file, and removes the per-instance subdir. If Claude crashes
without firing SessionEnd, the next SessionStart sees a stale
subdir and removes-and-relaunches.

### Decision D19: Effect Schema at the MCP Boundary via `setRequestHandler`

Phase 1.5 review surfaced that the MCP TypeScript SDK v1's
high-level surfaces (`registerTool`, `server.tool(name, shape, …)`)
expect a Zod-shape object and run `zod-to-json-schema` internally.
There is no public overload that accepts an arbitrary JSON Schema
literal.

To use **Effect Schema** at the MCP boundary (consistent with the
rest of the SDK), drop down to
`server.setRequestHandler(ListToolsRequestSchema, …)` and
`setRequestHandler(CallToolRequestSchema, …)`. The `tools/list`
handler returns `JSONSchema.make(EffectSchema)` per tool;
`tools/call` validates incoming payloads via
`Schema.decodeUnknown(EffectSchema)`. Resources and prompts stay on
the SDK's high-level `registerResource` / `registerPrompt` API —
mixing the two layers is supported and preserves the SDK's auto-
registration of `resources/*`, `prompts/*`, `ping`, and
`notifications/*` handlers.

**Brand schemas use `Schema.UUID`** as the base
(`Schema.UUID.pipe(Schema.brand("AgentId"))`) so `JSONSchema.make`
reliably emits `{ type: "string", format: "uuid", pattern: <rfc-4122> }`
across Effect versions. The historical `Schema.pattern` chained
after `Schema.brand` has had emission inconsistencies; `Schema.UUID`
avoids them.

**Tagged unions emit `anyOf`, not `oneOf` + discriminator.**
Effect's `JSONSchema.make` produces JSON Schema `anyOf` for
discriminated unions; JSON Schema 2020-12 has no `discriminator`
keyword (that's an OpenAPI extension). A small post-processing step
rewrites the top-level `anyOf` to `oneOf` and adds
`x-discriminator: "action"` for consolidated tools, improving
model-side tool-use accuracy without changing functional dispatch.

---

## Notes

### Note N1: tRPC idempotency middleware persist-failure handling

The `hypothesis_record` and `hypothesis_validate` MCP mutation tools are
wrapped by the tRPC idempotency middleware. The middleware **swallows**
persist errors rather than surfacing them as tool errors. The procedure
already succeeded; surfacing a cache-write failure as a tool error
inverts the success/failure signal: the agent sees "error" and retries,
but the underlying write already succeeded, creating a duplicate. Worst
case after a swallowed persist failure: the next call re-runs `next()`
— mild data hygiene cost (possibly two rows), no correctness issue.
The composite PK on `mcp_idempotent_responses` is
`(procedure_path, key)` with `INSERT ... ON CONFLICT DO NOTHING`, so a
parallel insert race resolves to a no-op.

### Note N2: `tdd_phase_transition_request` is NOT in the idempotency-key registry

The idempotency-registered mutation surfaces are `register_agent`,
the `record` / `validate` actions inside `hypothesis`, the `start`
/ `end` actions inside `tdd_task`, and the `create` actions inside
`tdd_goal` and `tdd_behavior`. `tdd_phase_transition_request` and
every `update` / `delete` / `get` / `list` action are intentionally
excluded.

**Why `tdd_phase_transition_request` is excluded:** the accept/deny is
a deterministic function of artifact-log state at the moment of the
request. Identical inputs at different times can legitimately produce
different results (at T0 a transition is denied because the test was
already failing on main; at T1 the agent records a new failing test
and the same transition is accepted). Caching the T0 deny would replay
it against the changed state at T1 — wrong. The validator is itself
the source of idempotency: a pure function of database state plus the
cited artifact id, so identical retries before any state change
produce the same answer naturally.

**Why `update` / `delete` / `get` / `list` actions are excluded:**
state-dependent reads (`get` / `list`) and intentional state
transitions (`update`) cannot be cached without inverting the
caller's expectation. Destructive ops (`delete`) are guarded at the
hook + permission-prompt layer (Decision D13), not via cache replay.

**Why the registered mutation actions get cached:**

- `tdd_task({ action: "start" })` — key is
  `sid:<sessionId>:run:<runId>` (or `cc:<chatId>:run:<runId>`)
  when `runId` is present; falls back to
  `sid:<sessionId>:<goal>` (or `cc:<chatId>:<goal>`) for legacy
  callers that omit `runId`. The `runId`-based key lets the main agent
  retry a dispatch with a fresh `runId` without hitting the cache — opening
  the same session with the same `runId` twice is the no-op.
- `tdd_task({ action: "end" })` (key: `${tddTaskId}:${outcome}`) —
  closing the same session twice is a no-op
- `tdd_goal({ action: "create" })` (key: `${sessionId}:${goal}`) —
  creating the same goal under the same session twice is a no-op
  (returns the existing row)
- `tdd_behavior({ action: "create" })` (key:
  `${goalId}:${behavior}`) — same shape, scoped per-goal so identical
  behavior text under different goals creates separate rows
- `register_agent` (key: SHA-256 base32(26) over
  `(agentType, parentOrSentinel, clientNonce)`) — the
  `DataStore.registerAgent` boundary maps duplicate registrations to
  `IdempotencyHit`, returning the already-registered agent row
  rather than producing a conflict

### Note N3: D7 load-bearing constraint — `tdd_artifact_record` is CLI-only

The TDD lifecycle MCP tools (`tdd_task`, `tdd_phase_transition_request`,
plus the non-destructive actions on `tdd_goal` and `tdd_behavior`) are
accessible to the orchestrator. Recording an artifact under a phase
(`tdd_artifacts.artifact_kind`) is **deliberately not** an MCP tool.
It is only writable through the `record tdd-artifact` CLI subcommand,
driven by hooks (`post-tool-use/tdd-artifact.sh` and
`post-tool-use/test-quality.sh`). The new `tdd_artifact_list` MCP
tool is read-only — it surfaces the existing artifact rows so the
orchestrator can find an id without shelling out to `sqlite3`, but
does not write.

This is Decision D7: hooks observe what the agent did so the agent never
writes evidence about itself.

**Why load-bearing:** the anti-pattern detection scheme depends on
`tdd_artifacts(kind='test_weakened')` rows being credible. If the agent
could write its own artifacts, it could omit them — and the metric
collapses. The evidence-binding validator depends on artifacts being
timestamped at the moment the side effect happened. The orchestrator's
`tools:` array intentionally excludes any artifact-write tool; the
subagent has no Bash tool in scope and there is no MCP wrapper.

### Note N4: `writeTurn` fans out to `tool_invocations` and `file_edits`

`DataStore.writeTurn` wraps its inserts in `sql.withTransaction(...)`
and fans out for two of the seven payload discriminators:

- `file_edit` payloads → one `file_edits` row per turn. `file_id`
  resolved via `ensureFile(payload.file_path)`; `edit_kind`,
  `lines_added`, `lines_removed`, `diff` carried verbatim.
- `tool_result` payloads → one `tool_invocations` row per turn.
  `tool_name`, `result_summary`, `duration_ms`, `success` carried
  verbatim. `params_hash` is intentionally NULL pending future
  cross-reference of the matching `tool_call` turn's `tool_input`.
- `tool_call`, `user_prompt`, `hypothesis`, `hook_fire`, `note`
  payloads → `turns` insert only.

**Why `tool_invocations` is keyed on `tool_result`:** a tool_call
without a corresponding tool_result is in-flight or failed. Keying on
`tool_result` gives a "completed invocations" projection without
joining two turn rows. Consumers needing strict request/response
pairing pair via `payload.tool_use_id`.

**Why `params_hash` is NULL:** the matching `tool_call` turn was
inserted earlier and is not in scope when `writeTurn` processes the
`tool_result`. Leaving it NULL is preferable to inventing a placeholder.

### Note N5: `failure_signatures.last_seen_at` recurrence tracking

`failure_signatures` carries `first_seen_run_id`, `first_seen_at`,
`occurrence_count`, and `last_seen_at` (nullable).
`writeFailureSignature` sets `last_seen_at = firstSeenAt` on insert and
refreshes it via the `ON CONFLICT(signature_hash) DO UPDATE` clause on
recurrence alongside the `occurrence_count` increment.
`getFailureSignatureByHash` surfaces `lastSeenAt: string | null`.

**Why nullable (no backfill):** rows present before the column was
added have no last-sighting timestamp that can be legitimately
assigned. Setting it to NULL is honest and forces consumers to handle
the legacy-data case explicitly. The field becomes non-null
asymptotically as signatures recur.

### Note N6: `FailureSignatureWriteInput` vs `FailureSignatureInput`

`DataStore.writeFailureSignature` persists computed failure signatures.
The natural input name is `FailureSignatureInput`, but that name is
already taken by `packages/sdk/src/utils/failure-signature.ts` — the
**compute-time** input to `computeFailureSignature` (the un-hashed
`error_name` / `assertion_message` / `top_frame_*` fields that get
hashed *into* the signature). The persistence-time input is named
`FailureSignatureWriteInput`. Both types live in the SDK; only one is
exported from each module.

**Why the `*WriteInput` qualifier:** matches the existing DataStore
input convention (`TestRunInput`, `ModuleInput`, `TestCaseInput`,
`TestErrorInput`, `SessionInput`, `TurnInput`, `StackFrameInput`). The
`Write` qualifier disambiguates persistence inputs from the
compute-time input. The two inputs have nothing in common — one is
the inputs to a hash, the other is the metadata stored alongside the
hash. Forced unions would obscure intent.

### Note N7: `spawnSync` E2E Test Gap

An end-to-end test that builds the CLI bin to disk and spawns it via
`spawnSync` against a clean test database is not part of `pnpm test`.
The unit tests for `parseAndValidateTurnPayload`, `recordTurnEffect`,
`recordSessionStart`, and `recordSessionEnd` exercise the lib functions
against an in-memory `SqliteClient`. The bin's wiring is thin
(`bin.ts` resolves `dbPath`, builds `CliLive`, hands the
`Command.run` effect to `@effect/cli`).

**Why acceptable:** the build-and-spawn loop would add the rslib
production build to the critical path of `pnpm test` and bring up a
fresh Node process per test case. The hook scripts — the CLI's
real-world callers — exercise the bin via the hook driver, which is a
more realistic e2e. The `@effect/cli` command tree breaking silently
is the main risk; manual smoke testing through hook scripts catches
command-tree wiring.

### Note N8: Single-statement ordinal allocation

Goals and behaviors carry `ordinal` columns that are monotonically
increasing under their parent (session for goals, goal for behaviors).
Ordinals are allocated in a single SQL statement:

```sql
INSERT INTO tdd_session_goals (session_id, ordinal, goal)
SELECT ?, COALESCE(MAX(ordinal), -1) + 1, ?
FROM tdd_session_goals
WHERE session_id = ?
RETURNING id, session_id, ordinal, goal, status, created_at;
```

The same pattern is used for behaviors with `goal_id`. The single
statement holds its lock for the duration of the read-and-insert, so
two concurrent inserters serialize on the unique constraint without
needing `BEGIN IMMEDIATE` or application-level retry.

**Why ordinals start at 0:** internal artifact; applications use them
only for ordering. Starting at 0 keeps `COALESCE(MAX(ordinal), -1) + 1`
symmetric (the empty-table case yields 0). Channel events and the
orchestrator's `[G<n>.B<m>]` labels are 1-based for human readability —
that's a presentation-layer concern, not the DB's.

### Note N9: `tdd_artifacts.behavior_id` for behavior-scoped queries

`tdd_artifacts` carries `behavior_id INTEGER REFERENCES
tdd_session_behaviors(id) ON DELETE CASCADE` plus
`idx_tdd_artifacts_behavior` on it. This denormalizes the behavior
reference one level so behavior-scoped queries are single-hop instead
of joining `tdd_artifacts → tdd_phases → behavior_id`.

**Why CASCADE:** consistent with Decision D15 — when a behavior is
deleted (main-agent under user confirmation), all its evidence goes
too.

---

## Design Patterns Used

### Pattern: Manifest-First Read

- **Where used:** DataReader (derived manifest view)
- **Why used:** Agents and CLI commands can quickly assess project
  states before fetching detailed data
- **Implementation:** `DataReader.getManifest()` assembles a
  `CacheManifest` on-the-fly from the latest test run per project in
  the `test_runs` table. The manifest is a derived view, not a primary
  on-disk data structure

### Pattern: Range Compression

- **Where used:** Coverage output (both console and JSON)
- **Why used:** Compact representation of uncovered lines for LLM
  consumption
- **Implementation:** `compressLines()` converts `[1,2,3,5,10,11,12]`
  to `"1-3,5,10-12"`

### Pattern: Project-Keyed Accumulation

- **Where used:** `AgentReporter.onTestRunEnd` result collection
- **Why used:** Group test results by `TestProject.name` during the
  run, then emit per-project outputs
- **Implementation:** `Map<string, VitestTestModule[]>` keyed by
  `testModule.project.name` and stored verbatim as the `project`
  column. Test-kind differentiation is by Vitest tag (set per-test by
  the plugin's transform hook), not by project name suffix

### Pattern: Duck-Typed External APIs

- **Where used:** Istanbul CoverageMap, Vitest TestModule/TestCase
- **Why used:** Avoid hard dependencies on external types that may
  change
- **Implementation:** Structural interfaces checked at runtime via
  type guards; formatters use duck-typed Vitest interfaces

### Pattern: Effect Service / Layer Separation

- **Where used:** All Effect services
- **Why used:** Clean separation between service interface
  (`Context.Tag`) and implementation (Layer). Enables swapping live
  I/O for test mocks
- **Implementation:** Service tags in `packages/sdk/src/services/`
  (plus `packages/plugin/src/services/CoverageAnalyzer.ts`), live and
  test layers in `packages/sdk/src/layers/` (plus the
  plugin-package-local `CoverageAnalyzerLive` /
  `CoverageAnalyzerTest`), merged composition layers
  (`ReporterLive`, `CliLive`, `McpLive`, `OutputPipelineLive`)

### Pattern: Scoped `Effect.runPromise`

- **Where used:** `AgentReporter` lifecycle hooks, `AgentPlugin`
  `configureVitest`
- **Why used:** Bridge between imperative Vitest class API and Effect
  service architecture without `ManagedRuntime` lifecycle concerns
- **Implementation:** Each hook builds a self-contained effect,
  provides the layer inline, and runs via `Effect.runPromise`

### Pattern: `ManagedRuntime` for Long-Lived Processes

- **Where used:** MCP server
- **Why used:** The MCP server is a long-running stdio process where
  per-call layer construction would be wasteful
- **Implementation:** `ManagedRuntime.make(McpLive(dbPath))` creates
  a shared runtime. tRPC context carries the runtime so procedures
  call `ctx.runtime.runPromise(effect)`. Database connection is held
  for the process lifetime

### Pattern: Hash-Based Change Detection

- **Where used:** Coverage trend tracking (target change detection)
- **Why used:** Detect when coverage targets have changed between
  runs, invalidating historical trend data
- **Implementation:** `hashTargets()` serializes `ResolvedThresholds`
  to JSON string, stored as `targetsHash` on each trend entry. When
  the hash differs, trend history is reset

### Pattern: Pipeline Architecture

- **Where used:** Output pipeline
- **Why used:** Each stage of output determination has a single
  responsibility and is independently testable
- **Implementation:** Five chained services: detect → resolve
  executor → select format → resolve detail → render. Explicit
  overrides can short-circuit automatic selection at any stage

---

## Constraints and Trade-offs

### Constraint: Vitest >= 4.1.0

- **Description:** Requires the Vitest 4 Reporter API with
  `TestProject`, `TestModule`, and `TestCase`
- **Impact:** Limits adoption to Vitest 4.1+
- **Mitigation:** Vitest 4.1+ is current stable; peer dep is explicit

### Trade-off: `onCoverage` Ordering

- **What we gained:** Clean integration with coverage data
- **What we sacrificed:** Must stash coverage as instance state
  (fires before `onTestRunEnd`)
- **Why it's worth it:** Simple pattern; coverage and results merge
  in one output pass

### Trade-off: Per-Call Layer Construction (Reporter)

- **What we gained:** No `ManagedRuntime` lifecycle concerns, no
  resource leaks, no disposal needed
- **What we sacrificed:** Layer constructed on each `onTestRunEnd`
  call
- **Why it's acceptable:** The layer is lightweight. Construction
  cost is negligible compared to test run duration. SQLite
  connections are fast to establish

### Trade-off: Convention-Based Source Mapping

- **What we gained:** Simple, predictable file-to-test mapping for
  scoped coverage
- **What we sacrificed:** Cannot detect tests that cover source files
  with non-matching names
- **Why it's acceptable:** Convention covers the vast majority of
  cases. The `source_test_map` table supports multiple mapping types
  for future expansion

### Trade-off: Zod for tRPC

- **What we gained:** tRPC integration with type-safe procedures and
  testable caller factory
- **What we sacrificed:** Added Zod as a runtime dependency
  alongside Effect Schema
- **Why it's acceptable:** Zod is scoped to MCP tool input schemas
  only. Effect Schema remains the source of truth for all domain
  data structures. tRPC requires Zod for input validation; there is
  no Effect Schema adapter for tRPC procedures

### Trade-off: SQLite Binary Format

- **What we gained:** ACID transactions, concurrent reads, efficient
  queries, relational integrity, FTS5, migration-based schema
  evolution
- **What we sacrificed:** Human-readable cache files (JSON)
- **Why it's acceptable:** The CLI and MCP tools provide all the
  access patterns agents need. Humans who need to inspect data can
  use `sqlite3` CLI or the `doctor` command. The benefits of
  relational storage far outweigh readability concerns
