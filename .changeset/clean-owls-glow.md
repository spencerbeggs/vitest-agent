---
"@vitest-agent/sdk": minor
---

## Features

### Console Leak Detection API

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

## Bug Fixes

`@vitest-agent/sdk/testing` now exports the 79 constituent types that appear in `DataStore` and `DataReader` method signatures — errors, schemas, and identity types that API Extractor flagged as forgotten exports from the testing entry point. Both the value and type sides of each Effect Schema const+type pair are covered. The entry point is now complete with zero new suppressions.
