---
"@vitest-agent/plugin": patch
---

## Bug Fixes

Fixes `isPartialRun` missing CLI run-scoping filters, which caused Vitest's native coverage thresholds to be enforced against the whole-workspace denominator on a scoped run (spurious exit 1).

* `isPartialRun` now treats any recognized CLI/programmatic scope filter as a partial run: --project, --tags-filter, --changed, --related, --shard, and -t/--testNamePattern
* The reporter now reads --project, --tags-filter, --changed, --related, and --shard from the stashed Vitest instance's config.cliOptions, so a plain `vitest run --project name` run is correctly detected as partial
* A per-run test-name filter (CLI -t or a watch-mode t change) is partial, while a testNamePattern set in vitest.config.ts is the project's own scope and stays a full run
