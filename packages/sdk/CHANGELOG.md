# @vitest-agent/sdk

## 1.3.2

### Bug Fixes

* Completed the transitive Effect peer closure so no `@effect` peer resolution escapes to the consuming workspace's importer. Previously a consumer workspace that also contained an effect v4 beta project could have its package manager auto-install the v4 beta into the v3 stack, crashing at runtime with module-not-found errors.

### Dependencies

* | Dependency           | Type       | Action | From | To      |                                                                       |
  | -------------------- | ---------- | ------ | ---- | ------- | --------------------------------------------------------------------- |
  | @effect/experimental | dependency | added  | —    | ^0.60.0 |                                                                       |
  | @effect/workflow     | dependency | added  | —    | ^0.18.2 |                                                                       |
  | @effect/printer      | dependency | added  | —    | ^0.49.0 |                                                                       |
  | @effect/printer-ansi | dependency | added  | —    | ^0.49.0 |                                                                       |
  | @effect/typeclass    | dependency | added  | —    | ^0.40.0 | [#128][#128] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#128]: https://github.com/spencerbeggs/vitest-agent/pull/128

## 1.3.1

### Dependencies

* | Dependency        | Type       | Action  | From   | To     |                                                          |
  | ----------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------- |
  | workspaces-effect | dependency | updated | ^1.3.0 | ^2.0.2 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

## 1.3.0

### Features

* [`45529da`](https://github.com/spencerbeggs/vitest-agent/commit/45529da0b14ea7f828dce0fec941b166cac1bdb5) `TestHistory` schema and the `FlakyTest` / `PersistentFailure` interfaces gain a `modulePath` field
* Exported `historyKey` from `HistoryTracker` — builds the composite `(modulePath, fullName)` key so consumers can key their own lookup maps consistently
* `DataStore.writeHistory` gains a required `modulePath` parameter. Custom reporters or scripts that call `writeHistory` directly need to pass the test module's path:

```ts
// before
yield * store.writeHistory(project, fullName, runId, timestamp, state);

// after
yield *
  store.writeHistory(project, fullName, modulePath, runId, timestamp, state);
```

Pre-2.0 note: this changes the `test_history` table shape. Delete your local `data.db` after upgrading (standing pre-2.0 policy — no incremental migration was written).

### Bug Fixes

* [`45529da`](https://github.com/spencerbeggs/vitest-agent/commit/45529da0b14ea7f828dce0fec941b166cac1bdb5) Test history is now keyed by file, not just by test name. Previously `test_history` rows were identified by `(project, fullName, timestamp)`, so two test files that happened to share a `describe > it` name collided on write (`UNIQUE constraint failed: test_history`) and were conflated on read — flaky/persistent/recovered detection could merge two unrelated tests into one series, potentially hiding a real persistent failure behind a same-named passing test in another file.

- Added a `modulePath` column; history identity is now `(project, modulePath, fullName, timestamp)` end to end

### Dependencies

* [`45529da`](https://github.com/spencerbeggs/vitest-agent/commit/45529da0b14ea7f828dce0fec941b166cac1bdb5) | Dependency | Type | Action | From | To |
  \| ------------------ | ---------- | ------- | ------ | ------ |
  \| config-file-effect | dependency | updated | ^0.2.3 | ^0.3.0 |
  \| workspaces-effect | dependency | updated | ^1.2.0 | ^1.3.0 |
  \| xdg-effect | dependency | updated | ^2.0.1 | ^2.1.0 |

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
