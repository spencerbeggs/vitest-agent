---
"@vitest-agent/plugin": patch
---

## Bug Fixes

- For the `agent` executor with coverage enabled, `configureVitest` now rewrites `coverage.reportsDirectory` to a per-process temp directory (removed on close), so two concurrent plain-CLI `vitest run` invocations in one checkout no longer clobber each other's `coverage/.tmp` files. `VITEST_AGENT_COVERAGE_DIR_ISOLATION=off` opts out and `VITEST_AGENT_COVERAGE_DIR=<path>` pins an explicit directory instead; human and CI executors are untouched (#194).
