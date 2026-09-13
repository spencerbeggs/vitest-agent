---
status: current
module: vitest-agent
category: testing
created: 2026-04-29
updated: 2026-09-13
last-synced: 2026-09-13
completeness: 95
related:
  - ./architecture.md
  - ./components.md
  - ./components/discover.md
  - ./components/ui.md
  - ./components/engine.md
  - ./components/mcp.md
  - ./components/plugin.md
dependencies: []
---

# Testing Strategy -- vitest-agent

Testing approach, patterns, and coverage targets for the monorepo.

**Parent document:** [architecture.md](./architecture.md)

---

## Test Layout

Tests live in flat `packages/<name>/__test__/` directories. The
root `vitest.config.ts` uses `AgentPlugin.discover()` to auto-generate
one Vitest project per package from the workspace layout; `__test__/`
files are picked up alongside `src/**/*.test.ts` files by the scanner.
The bulk of the suite lives in `packages/sdk/` (the pure core) and
`packages/engine/` (services, layers, migrations, programs), with the
plugin, mcp and ui packages carrying the next-largest sets; `cli`,
`reporter` and `sidecar` carry a handful each — the CLI's former lib tests
moved to the engine with the programs they exercise.

The `@vitest-agent/ui` tests are layered:

- Reducer unit tests — pure synchronous fixture folds, no React, no Ink.
- Agent renderer snapshots — inline assertions plus golden snapshots
  under `__test__/__snapshots__/`.
- Ink component snapshots — per-component plus an `App` integration test,
  all pinning `columns: 80` and stripping ANSI for snapshot stability.

See [./components/ui.md](./components/ui.md) for the full per-granularity
breakdown.

All four coverage metrics (statements, branches, functions, lines)
are above 80%. The root `vitest.config.ts` `coverage.exclude` list
uses `**/`-prefixed globs to skip bin entries, command glue,
layer composition factories, and types-only modules that are not
separately testable.

---

## Test Patterns

### Pattern 1: Effect Test Layer Composition

Each Effect service test follows the state-container pattern. Live
layers swap the core `effect` `FileSystem` (absorbed from `@effect/platform`
on v4) and the `effect/unstable/sql` `SqlClient` (backed by
`@effect/sql-sqlite-node`) for in-memory mocks; the test program runs
against the test layer instead of the live layer.

```typescript
const writeState = { runs: [], modules: [], testCases: [] };

const TestReporterLive = Layer.mergeAll(
  DataStoreTest.layer(writeState),
  CoverageAnalyzerTest.layer(),
  HistoryTrackerTest.layer(),
);

const run = <A, E>(effect: Effect.Effect<A, E, DataStore>) =>
  Effect.runPromise(Effect.provide(effect, TestReporterLive));

const writeRun = (input: TestRunInput) =>
  Effect.flatMap(DataStore, (svc) => svc.writeRun(input));
```

Test layers exist for:

- `DataStoreTest` -- accumulates writes into a mutable state container
- `EnvironmentDetectorTest` -- accepts a fixed environment value
- `CoverageAnalyzerTest` -- returns canned coverage data
- `ProjectDiscoveryTest` -- returns canned discovery results
- `HistoryTrackerTest` -- returns canned classifications

`DataReaderLive` and `DataStoreLive` are also exercised against a
real in-memory SQLite database (`@effect/sql-sqlite-node` with
`:memory:`) for assembler integration tests. The migrated in-memory
stack and the seeded presets come from `@vitest-agent/engine/testing`
(`makeTestLayer`, `DataStoreTestLayer`, `empty` / `singlePassingRun` /
`withFailures` / `flaky` / `withTddTask`) — see
[./components/engine.md](./components/engine.md).

### Pattern 2: In-Process MCP Harness and the Direct Caller

MCP tools are tested two ways, neither of which spawns a process.

**The harness (`packages/mcp/__test__/utils/harness.ts`)** builds the REAL
`ServerLayer` over `Stdio.layerTest` queues and speaks JSON-RPC to it:
`initialize(protocolVersion)`, `listTools`, `callTool(name, args)`,
`sendRequest(method, params)` (`prompts/list`, `prompts/get`),
`sendNotification`, plus `seed` (populate the same in-memory store the
server reads), `session` (pin an `McpSession` — a fixture `cwd`, a
recovered context), `extraLayers`, and `stderrSoFar` / `consoleLogSoFar`
/ `rawStdoutSoFar`. A test therefore sees the exact served schemas and
wire results a real client gets — the served-schema bug class (a field the
handler accepts but the served schema never declared) cannot exist because
there is one schema.

```typescript
const harness = yield* makeHarness({ seed: seedFixtureEffect, session: McpSession.layerTest({ cwd }) });
yield* harness.initialize("2025-11-25");
const tools = yield* harness.listTools;
const result = yield* harness.callTool("test", { action: "for_tag", tag: "unit" });
```

Two constraints ride along. The test Stdio must be provided *innermost*:
`DataStoreTestLayer` carries `NodeServices.layer`, whose real process
`Stdio` would otherwise win a `Layer.mergeAll` and leave the server
listening on the vitest worker's stdin (the symptom is every test timing
out). And Effect's default logger writes via `console`, never via the
`Stdio` service, so the harness routes logging into its stderr buffer
through `References.CurrentLoggers` — a "nothing on stderr" assertion
through `Stdio.layerTest` alone is vacuous.

**The direct caller (`packages/mcp/__test__/utils/caller.ts`)** —
`makeCaller(runtime, session?)` — decodes params through the tool's own
`parameters` schema and invokes `toolHandlers[name]` directly, for
handler-level assertions with full result-type narrowing and no wire
encoding (`tool-handlers.test.ts`: `run_tests` mkdtemp fault injection,
hypothesis binding precedence, the phase-transition validator matrix).
Use the harness when the served schema, the strict registrar, the dual
channel or a notification frame is the subject; use the caller when the
handler's logic is.

**Cross-tool invariants get a sweep and a table, and assert both
directions.** `packages/mcp/__test__/served-schema-strict.test.ts` walks
every served schema (recursing `properties`, `oneOf` / `anyOf` / `allOf`,
`items`, `prefixItems`, `$defs`) asserting `additionalProperties: false`
on every object node, and drives one `it.each` of `(tool, minimal-valid-args)`
pairs through the harness asserting each tool rejects a bogus extra key
(naming the key) *and* is not rejected at the parameter boundary without
it — the second half keeps the pass from overshooting into rejecting
documented params. A guard test asserts the case list equals `tools/list`
minus `run_tests`. Because the strict registrar fails before the handler
runs, the rejection cases never touch the database despite plausible ids.
`served-enum-drift.test.ts` is the same shape for the discriminant tuples:
each served `oneOf` must equal the tool's exported `*_ACTIONS` / `*_KINDS`.

Tests use plain vitest with `Effect.runPromise(Effect.scoped(...))`;
`@effect/vitest` is not a dependency.

### Pattern 2b: Spawned-Bin Crash Injection

Process-level `unhandledRejection` / `uncaughtException` guards cannot be exercised in-process — a real uncaught throw inside the Vitest worker is not something a test can safely simulate, and stubbing `process.on` proves only that a handler was registered, not that the process survives.

The pattern is to spawn the **built** bin as a real child (`packages/mcp/__test__/utils/mcp-process.ts`: `spawnMcp`, `makeScratchProject`, `handshake`, `readResponse`, with `XDG_DATA_HOME` pointed at a scratch dir), drive it over raw JSON-RPC on stdio, and make it crash itself on command via an env-gated, fires-once injection hook (`VITEST_AGENT_MCP_TEST_INJECT_CRASH`, accepting `unhandledRejection` or `uncaughtException`, scheduled on the event-loop turn after the transport connects so ordering is deterministic). The assertion is then the thing that actually matters: the injected kind appears on stderr *before* `ping` is sent, and `ping` still answers over the same transport. See `packages/mcp/__test__/bin-crash-resilience.e2e.test.ts` and the *Crash resilience* section of [./components/mcp.md](./components/mcp.md).

**Lifecycle e2e.** `server-lifecycle.e2e.test.ts` uses the same helper to pin the process contract from Decision 71: the handshake (`serverInfo.name === "vitest-agent"`, `protocolVersion === "2025-11-25"`, `tools/list` includes `ping`), stderr carrying no `jsonrpc` / `method` bytes AND being empty across `initialize` + `ping` (no banner), exit 0 within 2 s of stdin close, and a startup failure (`XDG_DATA_HOME` pointed at a regular file) exiting non-zero with a non-empty stderr. `run-tests-wire.e2e.test.ts` runs the real `run_tests` through the in-process harness against fixture projects and asserts the encoded report and markdown survive the wire.

Two constraints ride along. The hook must be env-gated so it can never fire in a normal install, and the file must be named `*.e2e.test.ts` — a plain `.test.ts` classifies as `unit` and gets a 5s timeout, which a real spawn plus handshake will exceed. The same naming rule applies to `packages/plugin/__test__/run-script-concurrency.e2e.test.ts`, which spawns competing processes to prove the `runScript` advisory lock serializes them; that suite drives the lock's `VITEST_AGENT_RUNSCRIPT_*` timing overrides so it can assert production behavior on millisecond-scale windows.

### Pattern 3: Duck-Typed Vitest Fixtures

`buildAgentReport()` and reporter integration tests use duck-typed
`VitestTestModule` / `VitestTestCase` interfaces (defined in
`packages/sdk/src/utils/build-report.ts`). Tests construct
plain object literals matching those interfaces rather than
mocking the Vitest runtime.

```typescript
const fakeModule: VitestTestModule = {
  moduleId: "/abs/path/to/file.test.ts",
  state: () => "passed",
  diagnostic: () => ({ duration: 42 }),
  errors: () => [],
  children: { allTests: () => fakeTests },
  project: { name: "unit" },
};
```

### Pattern 4: Process-Level Coordination Tests

`ensureMigrated` is tested with `_resetMigrationCacheForTesting`
between cases (the cache lives on `globalThis` via
`Symbol.for("vitest-agent/migration-promises")`). The
suite covers four scenarios:

1. Fresh DB migrates without error
2. Concurrent calls with the same `dbPath` share the same promise
3. Distinct `dbPath`s yield independent promises
4. Three concurrent callers serialize without `SQLITE_BUSY`

### Pattern 5: Pure Function Tests for Engine Programs and CLI Lib

CLI commands are not tested directly -- they are thin wrappers
around `effect/unstable/cli` `Command` definitions. The testable formatting
logic lives in `packages/cli/src/lib/format-*.ts` and is exercised
as plain pure functions taking domain inputs (e.g. `AgentReport`,
`CoverageReport`) and returning rendered strings.

### Pattern 4b: Boundary and Layering Guardrails

Three structural suites guard Decision 70's package contract and run as
ordinary unit tests:

- **Per-package boundary tests** (`packages/{sdk,engine,cli,mcp}/__test__/boundaries.test.ts`)
  over a shared comment-stripping scanner (`__test__/utils/boundaries.ts`:
  `walkTs`, `referencesProcess`, `importSpecifiers`; regex-literal aware,
  because a regex containing `/*` once swallowed the rest of a file). sdk:
  no `node:*` / `@effect/platform-node` / `@effect/sql-sqlite-node` /
  `@effected/*` imports and no `process.`; engine: no `process.` with no
  allowlist, no front-end or rendering imports; cli: `process` only in
  `bin.ts`, `main.ts`, `version.ts`, `commands/**`; mcp: only in `bin.ts`,
  `main.ts`, `version.ts`, `tools/run-tests.ts`, and no
  `@modelcontextprotocol/sdk` / `@trpc/server` / `zod`. Every suite asserts
  the `process.env.__PACKAGE_VERSION__` token appears only in `version.ts`.
  Known blind spots: `process["env"]` and a module-load read inside a
  dependency (`std-env`).
- **Workspace layering** (`packages/plugin/__test__/workspace-layering.test.ts`
  over `utils/workspace-graph.ts`): every workspace manifest has a rank in
  `LAYER_RANKS`, every dependency edge of any kind points to a strictly
  lower rank, `cli` and `mcp` never depend on each other, and a topological
  sort consumes every node. Lives in the carrier's tree because root-level
  tests are not discovered.
- **Packed install** (`packages/plugin/__test__/bins-packed-install.e2e.test.ts`):
  packs every family package from `dist/prod/npm/pkg`, installs a consumer
  that depends only on the plugin tarball (with tarball overrides) under
  npm, pnpm, yarn and bun, and asserts both bins are linked, `vitest-agent
  --version` exits 0, and `vitest-agent-mcp` answers `initialize` with
  empty stderr and exit 0. Skips without a prod build and on win32;
  requires network for vitest and the coverage peers.

### Pattern 6: Virtual Filesystem Instead of a Real Temp Tree

Filesystem-touching tests seed an `@effected/memfs` volume rather than `mkdtemp`-ing a real directory. It applies two ways, and the difference matters.

In `@vitest-agent/sdk`, services already read the filesystem through Effect's `FileSystem` service, so the swap is a layer swap: provide `MemoryFileSystem.layerWith(seed)` (plus `Path.layer`) where the test used to provide `NodeServices.layer` / `NodeFileSystem.layer` and drop the `writeFileSync` / `rmSync` scaffolding. `ConfigLive.test.ts` and `ProjectDiscoveryLive.test.ts` are the models.

In `@vitest-agent/plugin`, the discovery walkers are not Effect services — they take the `WalkerFileSystem` port described in [./components/discover.md](./components/discover.md). Tests pass an adapter over a memfs volume (`packages/plugin/__test__/utils/memfs-walker.ts`, with the `withMemfsWalker` helper) instead of a layer. The adapter is built on the volume's *inspection view*, not its `syncFileSystem` port, because the view is literal about symlinks and the walkers must not follow them; Decision 53 in [./decisions.md](./decisions.md) has the full boundary. The adapter also answers `mtimeMs` from the volume's own `mtime`, which is what makes the discovery cache's signature-invalidation path testable without touching disk (`find-test-files-memfs.test.ts`, `discover-projects-signature-memfs.test.ts`).

Seeding a volume also makes the awkward cases cheap and deterministic: symlink loops, unreadable directories, and an exact modification time no `utimes` call has to produce.

### Pattern 7: A Mutable Loader Object When `vi.mock` Cannot Reach the Import

`run_tests` imports `vitest/node` through a *computed* specifier so it can drive the physical vitest copy installed at the project under test (Decision 55 in [./decisions.md](./decisions.md)). That import is unmockable by construction: vitest's own vite-node externalizes the vitest package for every importer and only special-cases AST-literal `import("vitest/node")` call sites for `vi.mock` interception, so a `vi.mock("vitest/node", ...)` silently no-ops and the real module loads — a test that "passes" while exercising nothing.

The seam is a plain exported object, `vitestLoader`, whose `load` property holds the dynamic import. Tests assign over `vitestLoader.load` and restore it afterwards, asserting on the specifier the tool computed. When a module boundary is outside the mocking framework's reach, an exported mutable holder is the seam — not a deeper mock. See `packages/mcp/__test__/resolve-vitest-node-entry.test.ts` and `packages/mcp/__test__/run-tests-project-root.test.ts`.

---

## Coverage Targets

The root `vitest.config.ts` enforces these coverage thresholds via
the v8 provider:

| Metric | Target |
| --- | --- |
| Statements | 80% |
| Branches | 80% |
| Functions | 80% |
| Lines | 80% |

The config also sets `excludeAfterRemap: true`, so the exclude list is
applied to the **remapped** (original-source) paths rather than to the
instrumented output. Under Vitest 5 that is what makes a source-file
exclude land at all: without it, v8 filters before the source map is
applied and the excluded modules reappear in the report under their
transformed identities. It is also why the entries are `**/`-prefixed
rather than `packages/`-prefixed — coverage `include` / `exclude` match a
root-relative path, and under a `--project` filter the coverage root
becomes the selected project's own `config.root`, so a `packages/`-anchored
pattern silently stops matching.

The `coverage.exclude` list targets the per-package
layout. Excluded paths:

- Bin entries (`packages/{cli,mcp}/src/bin.ts`, the carrier shims under
  `packages/plugin/src/bin/`) and the process-owning `main.ts` files
  (covered by the spawned-bin e2e suites instead)
- Command glue (thin wrappers over lib functions)
- Layer composition factories that only merge other layers
- Types-only modules with no runtime behavior

`pool` is `forks` (not threads) for broader compatibility with the
SQLite driver (on v4, `@effect/sql-sqlite-node` over Node's built-in
`node:sqlite`). CI sets `CI=true` and enables the v8 coverage provider
via `pnpm run ci:test`.

---

## Integration Test Targets

Integration tests verify behavior that unit tests can't reach:

- **End-to-end reporter behavior** -- run actual Vitest test runs
  through `AgentReporter` and assert on the resulting `data.db`
  contents and console output. The `playground` package is
  the canonical integration target
- **Multi-project DB writes** -- a Vitest config with multiple
  projects sharing one `data.db` and assertions that the `project`
  column is populated correctly per workspace package, and that
  per-tag aggregates land on `AgentReport.tagCounts`
- **GFM output** -- mock `GITHUB_STEP_SUMMARY` to a temp file and
  assert the reporter's appended content
- **Reporter injection via `AgentPlugin`** -- exercise
  `configureVitest` with a fake Vitest plugin context and assert
  on the final reporters array
- **Tag-prelude collection semantics** -- `packages/plugin/__test__/inject-tags-prelude.e2e.test.ts` spawns real `vitest run --reporter=json` subprocesses against a self-contained fixture project (`__test__/fixtures/tag-prelude-project/`) whose `vitest.config.ts` wires `injectTags` into a bare inline Vite plugin. It proves the file-level tag prelude across declaration forms the old per-call rewrite corrupted or missed (wrapper testers, numeric-timeout calls, user-declared tags), with positive and negative `--tags-filter` runs (issue #133). Subprocess-spawning tests must use the `.e2e.test.ts` suffix so the classifier grants the e2e timeout budget
- **CLI bin invocation** -- spawn the bin against a populated
  `data.db` and assert on stdout
- **MCP tool invocations** -- via the in-process harness (wire) and the
  direct caller (handler) against a seeded test runtime (Pattern 2); the
  spawned bin only for crash guards, lifecycle and packed installs

---

## Test Discovery

Project configuration is driven by `AgentPlugin.discover()`. For the full
algorithm, file classification rules, override system, and glob construction,
see [components/discover.md](./components/discover.md). The root
`vitest.config.ts` uses the canonical async-export pattern documented there.

Tests that need real SQLite databases use `:memory:` rather than
disk-backed DBs to avoid concurrent-test isolation issues.
