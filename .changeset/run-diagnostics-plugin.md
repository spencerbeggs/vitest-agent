---
"@vitest-agent/plugin": minor
---

## Features

### Run diagnostics survive the agent reporter

`AgentPlugin` strips Vitest's own reporter when it owns stdout, which silently dropped Vitest's performance hints. The plugin now ports those hints and reports them itself (#544).

* Performance hints (environment, import, transform, isolate) are computed in every console mode and flow into `run.json` and `run_tests`; they are suppressed in watch mode, blob merges, and when Vitest's diagnostics flag turns them off
* Hints are printed to the console as suggested actions only in agent mode and in stream mode (after the live view closes); in ci-annotations mode they reach only run.json and run_tests, and in passthrough mode Vitest prints its own
* In multi-project runs, only the primary (coverage-owning) reporter publishes run-level diagnostics
* Post-run timing (persist, coverage scan, total) is always recorded in the report and shown on the console only when the run was slow
* A failed persistence is recorded in the report so it can be surfaced as an action instead of failing silently

### Failure summary on stderr

When a run fails or is interrupted in `agent`, `stream`, or `ci-annotations` mode, the plugin writes a short plain-text failure summary to stderr (at most 15 lines, with a "... N more" tail). Because it is the plugin's last stderr write, Vitest's own `vitest doctor` now reports the real cause of a failing trial run instead of "no error output". In stream mode the summary prints above the live view. In agent mode it repeats the stdout failure list on stderr, a deliberate trade so callers that discard stdout still see the cause. A `silent` console config still produces no output.
