---
"@vitest-agent/plugin": patch
---

## Bug Fixes

- Under GitHub Actions, the reporter no longer stores every `GITHUB_*` and `RUNNER_*` environment variable with a run's settings. A workflow that exported a secret under either prefix, such as `GITHUB_TOKEN`, had it written to `data.db` and served back by the MCP `configure` tool. `captureEnvVars` now records only the run's coordinates (`GITHUB_ACTIONS`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_JOB`, `GITHUB_SHA`, `GITHUB_REF_NAME`, `RUNNER_OS`, `RUNNER_ARCH`), read through `@effected/env`'s `RuntimeEnv.ciRun`, under the same key names as before. Rows already stored are removed by `@vitest-agent/engine`'s `0005_scrub_ci_env_vars` migration.

## Refactoring

- The stderr failure summary strips every complete terminal escape sequence from a failure message's first line, not only color codes, so cursor and hyperlink sequences no longer leak into the summary.
- Module-to-package lookup and the coverage-provider install check run on the kit's directory ascent and module resolution instead of hand-written equivalents; results are unchanged.
