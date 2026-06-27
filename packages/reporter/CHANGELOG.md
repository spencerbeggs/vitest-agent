# @vitest-agent/reporter

## 2.0.0

### Dependencies

* | [`4b4f91e`](https://github.com/spencerbeggs/vitest-agent/commit/4b4f91ec09e713cec7ffbc3464c70cfac4637e94) | Dependency    | Type    | Action  | From    | To |
  | --------------------------------------------------------------------------------------------------------- | ------------- | ------- | ------- | ------- | -- |
  | @savvy-web/bundler                                                                                        | devDependency | updated | ^0.11.0 | ^0.11.1 |    |
  | Dependency                                                                                                | Type          | Action  | From    | To      |    |
  | -----------------                                                                                         | ----------    | ------- | -----   | -----   |    |
  | @vitest-agent/sdk                                                                                         | dependency    | updated | 1.0.1   | 2.0.0   |    |
  | @vitest-agent/ui                                                                                          | dependency    | updated | 1.0.1   | 2.0.0   |    |

## 1.0.1

### Bug Fixes

* [`3cfd166`](https://github.com/spencerbeggs/vitest-agent/commit/3cfd166de45227d28aa77d16f7b4237053509e27) Fixes `MaxPerformanceEntryBufferExceededWarning` on long test runs. React 19's development reconciler emits a `performance.measure()` per component render and nothing drained the global user-timing buffer; the live renderer now clears it after each render cycle.
  | Dependency        | Type       | Action  | From  | To    |
  | ----------------- | ---------- | ------- | ----- | ----- |
  | @vitest-agent/sdk | dependency | updated | 1.0.0 | 1.0.1 |
  | @vitest-agent/ui  | dependency | updated | 1.0.0 | 1.0.1 |

## 1.0.0

### Features

* [`e509228`](https://github.com/spencerbeggs/vitest-agent/commit/e5092289c0f64446dddc8ad0abc25856d8d08e97) Initial stable release. Ships `DefaultVitestAgentReporter` and owns the Ink live-mount lifecycle end to end. Doubles as the reference package for custom-reporter authors, re-exporting the `VitestAgentReporterFactory` contract and the dispatch helpers.

### Patch Changes

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 0.0.0 | 1.0.0 |
| @vitest-agent/ui  | dependency | updated | 0.0.0 | 1.0.0 |
