# @vitest-agent/sdk

## 2.0.0

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

* | [`4b4f91e`](https://github.com/spencerbeggs/vitest-agent/commit/4b4f91ec09e713cec7ffbc3464c70cfac4637e94) | Dependency    | Type    | Action  | From    | To |
  | --------------------------------------------------------------------------------------------------------- | ------------- | ------- | ------- | ------- | -- |
  | @savvy-web/bundler                                                                                        | devDependency | updated | ^0.11.0 | ^0.11.1 |    |

## 1.0.1

## 1.0.0

### Features

* [`e509228`](https://github.com/spencerbeggs/vitest-agent/commit/e5092289c0f64446dddc8ad0abc25856d8d08e97) Initial stable release. Shared foundation for the family: Effect Schema data definitions, the SQLite data layer and Effect services, formatters, utilities, and the public reporter and dispatcher contracts. Schemas are re-exported for consumer use. No internal dependencies.
