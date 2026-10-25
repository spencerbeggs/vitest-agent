---
"@vitest-agent/plugin": minor
---

## Features

### Explicit opt-out of SQLite persistence

Two spellings, for CI runners where nothing reads `data.db` back:

* `AgentPlugin({ persist: false })` in `vitest.config.ts`.
* `VITEST_AGENT_PERSIST=0` (also `false` / `off`; `1` / `true` / `on` turn it back on) for an operator who cannot edit the config. The env var wins over the option in either direction; an unrecognized value is ignored with one `[vitest-agent:plugin] ignoring VITEST_AGENT_PERSIST=…` stderr line.

The opt-out is never automatic — `CI=true` does not imply it, because some CI setups cache and query `data.db`. With persistence off the run still renders every console and report-file output, still emits every `RunEvent`, still analyzes and renders coverage, and Vitest still enforces `coverage.thresholds` itself; only the database writes are skipped (run rows, test cases, failure history, coverage rows, trends, baselines), and `data.db` is never resolved, created, or opened. Classifications are empty without history (no `stable` / `new-failure` / `persistent` / `flaky` / `recovered` labels), and coverage renders without a baseline delta or trend line. The resolved decision reaches custom reporters as `ResolvedReporterConfig.persist`.

`coverage.enabled: false` (UI-only mode) already skipped persistence and is unchanged; the UI-only run now shares the same DB-free path.
