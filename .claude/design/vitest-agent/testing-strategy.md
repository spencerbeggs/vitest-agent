---
status: current
module: vitest-agent-reporter
category: testing
created: 2026-04-29
updated: 2026-05-18
last-synced: 2026-05-18
completeness: 95
related:
  - ./architecture.md
  - ./components.md
  - ./components/discover.md
  - ./components/ui.md
dependencies: []
---

# Testing Strategy -- vitest-agent-reporter

Testing approach, patterns, and coverage targets for the six-package
monorepo.

**Parent document:** [architecture.md](./architecture.md)

---

## Test Layout

Tests live in flat `packages/<name>/__test__/` directories. The
root `vitest.config.ts` uses `AgentPlugin.discover()` to auto-generate
one Vitest project per package from the workspace layout; `__test__/`
files are picked up alongside `src/**/*.test.ts` files by the scanner.

| Package | `__test__/` files |
| --- | --- |
| `packages/sdk/` | 71 |
| `packages/plugin/` | 20 |
| `packages/cli/` | 14 |
| `packages/mcp/` | 20 |
| `packages/ui/` | 19 |
| `packages/reporter/` | 0 |
| **Total** | **144** |

The `vitest-agent-ui` tests are layered:

- Reducer unit tests — pure synchronous fixture folds, no React, no Ink.
- Agent renderer snapshots — inline assertions plus golden snapshots
  under `__test__/__snapshots__/`.
- Ink component snapshots — per-component plus an `App` integration test,
  all pinning `columns: 80` and stripping ANSI for snapshot stability.

See [./components/ui.md](./components/ui.md) for the full per-granularity
breakdown.

All four coverage metrics (statements, branches, functions, lines)
are above 80%. The root `vitest.config.ts` `coverage.exclude` list
uses `packages/`-prefixed globs to skip bin entries, command glue,
layer composition factories, and types-only modules that are not
separately testable.

---

## Test Patterns

### Pattern 1: Effect Test Layer Composition

Each Effect service test follows the state-container pattern. Live
layers swap `@effect/platform` `FileSystem` and
`@effect/sql-sqlite-node` `SqlClient` for in-memory mocks; the test
program runs against the test layer instead of the live layer.

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
`:memory:`) for assembler integration tests.

### Pattern 2: tRPC Caller Factory for MCP Tools

MCP tools are tested without starting the MCP server. The tRPC
router exposes `createCallerFactory`, which lets tests build a
caller bound to a mock context (carrying a test `ManagedRuntime`).

```typescript
import { createCallerFactory } from "@trpc/server";
import { appRouter } from "./router";

const factory = createCallerFactory(appRouter);
const mockCtx: McpContext = {
  runtime: ManagedRuntime.make(TestMcpLive),
  cwd: "/test/project",
};
const caller = factory(mockCtx);

const result = await caller.test_status({ project: "my-app" });
```

This avoids stdio transport, MCP SDK initialization, and process
boundaries -- procedures are tested as plain async functions.

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

### Pattern 5: Pure Function Tests for CLI Lib

CLI commands are not tested directly -- they are thin wrappers
around `@effect/cli` `Command` definitions. The testable formatting
logic lives in `packages/cli/src/lib/format-*.ts` and is exercised
as plain pure functions taking domain inputs (e.g. `AgentReport`,
`CoverageReport`) and returning rendered strings.

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

The `coverage.exclude` list targets the `packages/`-prefixed
layout. Excluded paths:

- Bin entries (`packages/{cli,mcp}/src/bin.ts`)
- Command glue (thin wrappers over lib functions)
- Layer composition factories that only merge other layers
- Types-only modules with no runtime behavior

`pool` is `forks` (not threads) for broader compatibility with
`better-sqlite3`'s native bindings. CI sets `CI=true` and enables
the v8 coverage provider via `pnpm run ci:test`.

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
- **CLI bin invocation** -- spawn the bin against a populated
  `data.db` and assert on stdout
- **MCP tool invocations** -- via tRPC caller factory against a
  populated test runtime (Pattern 2)

---

## Test Discovery

Project configuration is driven by `AgentPlugin.discover()`. For the full
algorithm, file classification rules, override system, and glob construction,
see [components/discover.md](./components/discover.md). The root
`vitest.config.ts` uses the canonical async-export pattern documented there.

Tests that need real SQLite databases use `:memory:` rather than
disk-backed DBs to avoid concurrent-test isolation issues.
