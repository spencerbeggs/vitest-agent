# Effect Schemas

All data structures in `vitest-agent-sdk` are defined as
[Effect Schema](https://effect.website/docs/schema/introduction)
definitions. TypeScript types are derived via `typeof Schema.Type`.
JSON encode/decode uses `Schema.decodeUnknownSync` and
`Schema.encodeUnknownSync`.

## Available Schemas

| Schema | Description |
| --- | --- |
| `AgentReport` | Complete per-project test report |
| `ReportSummary` | Aggregate test run statistics |
| `ModuleReport` | Test module (file) and its test cases |
| `TestReport` | Individual test case result |
| `ReportError` | Error with message, stack, and diff |
| `CoverageReport` | Coverage report with totals and low-coverage files |
| `CoverageTotals` | Aggregate coverage percentages |
| `FileCoverageReport` | Per-file coverage with uncovered line ranges |
| `CacheManifest` | Root manifest indexing all project reports |
| `CacheManifestEntry` | Single project entry in the manifest |
| `HistoryRecord` | Per-project failure history across runs |
| `TestHistory` | Single test's pass/fail history |
| `TestRun` | Single run outcome (passed or failed) |
| `TestClassification` | Failure classification literal |
| `CoverageLevel` | Named coverage preset class with `lines`, `branches`, `functions`, `statements` fields and `.withPerFile()` / `.extend({})` methods |
| `MetricThresholds` | Per-metric threshold values (lines, functions, branches, statements) |
| `PatternThresholds` | A glob pattern paired with metric thresholds |
| `ResolvedThresholds` | Fully resolved thresholds with global, perFile, and patterns |
| `CoverageBaselines` | Auto-ratcheting high-water marks stored in database |
| `TrendEntry` | Single coverage trend data point |
| `TrendRecord` | Per-project trend sliding window (50 entries) |
| `AgentReporterOptions` | Reporter configuration options |
| `AgentPluginOptions` | Plugin configuration options |
| `Environment` | Runtime environment literal (`agent-shell`, `terminal`, `ci-github`, `ci-generic`) |
| `Executor` | Executor type literal (`human`, `agent`, `ci`) |
| `OutputFormat` | Output format literal (`markdown`, `json`, `vitest-bypass`, `silent`) |
| `DetailLevel` | Detail level literal (`minimal`, `neutral`, `standard`, `verbose`) |
| `ConsoleStrategy` | Plugin console strategy literal (`own`, `complement`) |

## Type Inference

All TypeScript types are derived from schemas. Import them as types:

```typescript
import type {
  AgentReportType,
  ModuleReportType,
  TestReportType,
  ReportErrorType,
} from "vitest-agent-sdk";
```

Or derive types directly from schemas:

```typescript
import { AgentReport } from "vitest-agent-sdk";

type AgentReportType = typeof AgentReport.Type;
```

## Programmatic Database Access

For consumers who want to read data via Effect services, the package
re-exports `DataReader` / `DataReaderLive` (and `DataStore` /
`DataStoreLive`) from `vitest-agent-sdk`:

```typescript
import {
  DataReader,
  DataReaderLive,
  DataStoreError,
} from "vitest-agent-sdk";
import { Effect, Layer } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { NodeContext } from "@effect/platform-node";

const SqliteLayer = SqliteClient.layer({
  filename: "/path/to/data.db",
});

const live = DataReaderLive.pipe(
  Layer.provide(SqliteLayer),
  Layer.provideMerge(NodeContext.layer),
);

const program = Effect.gen(function* () {
  const reader = yield* DataReader;
  const runs = yield* reader.getRunsByProject();
  // ... process project run summaries
});

await Effect.runPromise(Effect.provide(program, live));
```

`DataReaderLive` and `DataStoreLive` require `SqlClient` (from
`@effect/sql-sqlite-node`). The reporter, CLI, and MCP server each
build a private composition layer that adds the SQLite client, the
migrator, and `NodeContext`; programmatic consumers need to do the
same. To resolve the right database file, use `resolveDataPath` from
`vitest-agent-sdk` or read it from
`vitest-agent cache path`.

For write operations, swap `DataReader`/`DataReaderLive` for
`DataStore`/`DataStoreLive` (same `SqlClient` requirement).

## Output Pipeline

The output pipeline services are exported for custom rendering workflows:

```typescript
import {
  OutputRenderer,
  OutputPipelineLive,
  EnvironmentDetector,
} from "vitest-agent-sdk";
import type {
  Formatter,
  FormatterContext,
  RenderedOutput,
} from "vitest-agent-sdk";
```

## Schema Reference

### AgentReport

The top-level report written per project:

```typescript
{
  timestamp: string;          // ISO 8601
  project?: string;           // project name (monorepo)
  reason: "passed" | "failed" | "interrupted";
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;         // wall-clock milliseconds
  };
  failed: ModuleReport[];     // only modules with failures
  unhandledErrors: ReportError[];
  failedFiles: string[];      // quick index of relative paths
  coverage?: CoverageReport;  // present when coverage enabled
}
```

### ModuleReport

A test file and its contained tests:

```typescript
{
  file: string;              // project-relative path
  state: "passed" | "failed" | "skipped" | "pending";
  duration?: number;
  errors?: ReportError[];    // module-level errors (syntax, top-level)
  tests: TestReport[];
}
```

### TestReport

An individual test case:

```typescript
{
  name: string;              // test name
  fullName: string;          // "Suite > nested > test name"
  state: "passed" | "failed" | "skipped" | "pending";
  duration?: number;
  flaky?: boolean;           // passed after retry
  slow?: boolean;            // exceeded slowTestThreshold
  errors?: ReportError[];
  classification?: TestClassification;
}
```

### ReportError

```typescript
{
  message: string;
  stack?: string;            // Vitest internals stripped
  diff?: string;             // expected/received comparison
}
```

### CoverageReport

```typescript
{
  totals: {
    statements: number;      // percentage 0-100
    branches: number;
    functions: number;
    lines: number;
  };
  thresholds: {
    global: MetricThresholds;
    patterns?: PatternThresholds[];
  };
  targets?: {                // aspirational goals (when configured)
    global: MetricThresholds;
    patterns?: PatternThresholds[];
  };
  baselines?: {              // auto-ratcheted high-water marks
    global: MetricThresholds;
    patterns?: PatternThresholds[];
  };
  scoped?: boolean;          // true when filtered to tested files
  scopedFiles?: string[];    // files in scope (when scoped)
  lowCoverage: FileCoverageReport[];  // files below threshold
  lowCoverageFiles: string[];         // quick index of paths
}
```

### FileCoverageReport

```typescript
{
  file: string;
  summary: {
    statements: number;
    branches: number;
    functions: number;
    lines: number;
  };
  uncoveredLines: string;    // compressed range: "1-3,5,10-12"
}
```

### CacheManifest

```typescript
{
  updatedAt: string;         // ISO 8601
  cacheDir: string;
  projects: CacheManifestEntry[];
}
```

### CacheManifestEntry

```typescript
{
  project: string;           // project name
  reportFile: string;        // relative path (legacy compat)
  historyFile?: string;      // relative path (legacy compat)
  lastRun: string | null;    // ISO 8601 or null before first run
  lastResult: "passed" | "failed" | "interrupted" | null;
}
```

### HistoryRecord

```typescript
{
  project: string;
  updatedAt: string;         // ISO 8601
  tests: TestHistory[];
}
```

### TestHistory

```typescript
{
  fullName: string;          // matches TestReport.fullName
  runs: TestRun[];           // sliding window, most recent first, max 10
}
```

### TestRun

```typescript
{
  timestamp: string;         // ISO 8601
  state: "passed" | "failed";
}
```

### TestClassification

```typescript
"stable" | "new-failure" | "persistent" | "flaky" | "recovered"
```

### MetricThresholds

```typescript
{
  lines?: number;
  functions?: number;
  branches?: number;
  statements?: number;
}
```

### PatternThresholds

A tuple of glob pattern and metric thresholds:

```typescript
[string, MetricThresholds]
// e.g. ["src/utils/**", { lines: 90 }]
```

### ResolvedThresholds

```typescript
{
  global: MetricThresholds;
  perFile: boolean;            // default: false
  patterns: PatternThresholds[];
}
```

### CoverageBaselines

```typescript
{
  updatedAt: string;           // ISO 8601
  global: MetricThresholds;
  patterns: PatternThresholds[];
}
```

### TrendEntry

```typescript
{
  timestamp: string;           // ISO 8601
  coverage: CoverageTotals;
  delta: CoverageTotals;      // change from previous entry
  direction: "improving" | "regressing" | "stable";
  targetsHash?: string;       // hash of targets config (detect changes)
}
```

### TrendRecord

```typescript
{
  entries: TrendEntry[];       // sliding window, max 50
}
```

### Environment

```typescript
"agent-shell" | "terminal" | "ci-github" | "ci-generic"
```

### Executor

```typescript
"human" | "agent" | "ci"
```

### OutputFormat

```typescript
"markdown" | "json" | "vitest-bypass" | "silent"
```

### DetailLevel

```typescript
"minimal" | "neutral" | "standard" | "verbose"
```

### CoverageLevel

A class providing named coverage threshold presets. Import from `vitest-agent-sdk`:

```typescript
import { CoverageLevel } from "vitest-agent-sdk";
```

Each preset has `lines`, `branches`, `functions`, and `statements` numeric fields:

| Preset | lines | branches | functions | statements |
| --- | --- | --- | --- | --- |
| `none` | 0 | 0 | 0 | 0 |
| `basic` | 50 | 50 | 50 | 50 |
| `standard` | 80 | 75 | 80 | 80 |
| `strict` | 90 | 85 | 90 | 90 |
| `full` | 100 | 100 | 100 | 100 |

Methods:

- `.withPerFile()` — returns a new `CoverageLevel` with `perFile: true`, applying thresholds per file rather than in aggregate.
- `.extend({ lines?, branches?, functions?, statements? })` — returns a new `CoverageLevel` with the specified fields overridden.

Pass a preset name string to `coverageThresholds` or `coverageTargets` on `AgentPlugin`, or use the `AgentPlugin.COVERAGE_LEVELS` / `AgentPlugin.COVERAGE_LEVELS_PER_FILE` namespace constants directly.
