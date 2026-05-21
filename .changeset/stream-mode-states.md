---
"vitest-agent-sdk": major
"vitest-agent-ui": major
"vitest-agent-plugin": major
---

## Features

### `stream` mode renders deliberate, agent-shaped human states

The `stream` console renderer is reworked from an improvised top-summary-plus-flat-list into an agent-mirrored layout: a `Projects (N):` / `Modules (N):` / file-path header, rows carrying four count columns — pass, fail, skip, timeout — plus a per-row tag-count suffix, a capped Failures section for aggregate shapes, and Coverage / Trend / Total lines. Sections scale by run shape: workspace and single-project carry every section, single-file keeps Total and shows Coverage / Trend when a run produced them, single-test is a single leaf line.

### Timeout becomes a tracked outcome

Vitest reports a timed-out test as `failed`. The plugin now detects timeout-flavored failures and splits them into a separate `timeoutCount`, surfaced as the `⧖` column. A new optional `timedOut` field rides `TestFinished`; `timeoutCount` rides `ModuleFinished`, `SuiteFinished`, and `RunFinished`; `ModuleRecord` and `RenderTotals` gain `timeoutCount`; `TestRecord.status` gains a `timed-out` render value. `ModuleFinished` and `ModuleRecord` also gain `tagCounts` so the renderer can show the per-row tag suffix. All additions are in-memory schemas — no database change.

### Trend reaches the live renderer

A new `TrendComputed` `RunEvent`, emitted at end-of-run alongside `CoverageReady`, carries the trend direction and run count into `RenderState.trend` so the live renderer can show a Trend line.
