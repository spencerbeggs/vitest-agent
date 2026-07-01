# @vitest-agent/sdk

## 1.2.0

### Features

* [`813cf45`](https://github.com/spencerbeggs/vitest-agent/commit/813cf45cb9a8809c1766640d5e20669f1b77a251) Adds phase-transition support for triangulation batches, where a single implementation satisfies several behaviors and only the first produces its own failing run (#115).

- `requiredArtifactForTransition` now requires a `test_failed_run` for `red.triangulate→green` (previously accepted with no evidence at all) — a triangulation batch must still point at a real failing run, just not necessarily the requested behavior's own.
- `validatePhaseTransition` relaxes the phase-window and behavior-match binding rules specifically for `red.triangulate→green`, so a batch's shared failing run can serve as evidence for a later behavior in the same batch.
- New export `transitionEnforcesBehaviorMatch(from, to)` reports whether D2 binding rule 2 (behavior-match) applies to a transition. It is `true` only for `red→green` and `green→refactor`, and `false` for `red.triangulate→green` and `refactor→red` — letting `refactor→red` cross a behavior boundary in one step without a rebind dance.

```ts
import { transitionEnforcesBehaviorMatch } from "@vitest-agent/sdk";

transitionEnforcesBehaviorMatch("red", "green"); // true
transitionEnforcesBehaviorMatch("red.triangulate", "green"); // false
```

## 1.1.0

### Features

* [`4b4f91e`](https://github.com/spencerbeggs/vitest-agent/commit/4b4f91ec09e713cec7ffbc3464c70cfac4637e94) ### Console Leak Detection API

New public types and utilities for collecting and aggregating stray console output from a Vitest run into a structured signal.

`ConsoleLeaks` and `ConsoleLeakFile` are Effect Schema types:

```ts
import { ConsoleLeaks, ConsoleLeakFile } from "@vitest-agent/sdk";
// ConsoleLeaks: { total: number; byFile: ConsoleLeakFile[]; truncated?: boolean }
// ConsoleLeakFile: { file: string; stdout: number; stderr: number; tests?: string[]; sample?: string }
```

`buildConsoleLeaks(entries)` aggregates a `ConsoleLeakEntry[]` into a `ConsoleLeaks` signal — bucketing by file, splitting stdout/stderr counts, capturing a truncated first-line sample per file, and sorting by total writes descending. The file list is capped at 25 entries with a `truncated` flag when more are present. Returns `undefined` on a clean run so a report carries no signal when no stray console calls occurred.

`collectConsoleLeakEntries(files)` walks a `ConsoleLeakTask[]` tree (the shape returned by `vitest.state.getFiles()`) into flat `ConsoleLeakEntry` values, attributing each captured write to its enclosing file and test name.

`AgentReport` gains an optional `consoleLeaks` field typed as `ConsoleLeaks | undefined`, populated by the `run_tests` MCP tool when stray writes are detected during the run.

### Bug Fixes

* [`4b4f91e`](https://github.com/spencerbeggs/vitest-agent/commit/4b4f91ec09e713cec7ffbc3464c70cfac4637e94) `@vitest-agent/sdk/testing` now exports the 79 constituent types that appear in `DataStore` and `DataReader` method signatures — errors, schemas, and identity types that API Extractor flagged as forgotten exports from the testing entry point. Both the value and type sides of each Effect Schema const+type pair are covered. The entry point is now complete with zero new suppressions.

### Dependencies

* [`3e0cfe3`](https://github.com/spencerbeggs/vitest-agent/commit/3e0cfe38157ef21bfe1d817f557914ce79a43885) | Dependency | Type | Action | From | To |
  \| ------------------ | ------------- | ------- | ------- | ------ |
  \| @savvy-web/bundler | devDependency | updated | ^0.11.1 | ^1.0.1 |

## 1.0.1

## 1.0.0

### Features

* [`e509228`](https://github.com/spencerbeggs/vitest-agent/commit/e5092289c0f64446dddc8ad0abc25856d8d08e97) Initial stable release. Shared foundation for the family: Effect Schema data definitions, the SQLite data layer and Effect services, formatters, utilities, and the public reporter and dispatcher contracts. Schemas are re-exported for consumer use. No internal dependencies.
