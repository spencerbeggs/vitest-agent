---
"@vitest-agent/engine": minor
---

## Features

- `ChangeKind` is now also a Schema (`Schema.Literals` of the five change kinds) beside its type, so a front end can decode changed-file input against the same set the database's `CHECK` constraint allows.

## Bug Fixes

- New migration `0005_scrub_ci_env_vars` deletes every stored `GITHUB_*` and `RUNNER_*` row in `settings_env_vars` except the run coordinates the plugin still records. Earlier plugin versions captured every variable under those prefixes under GitHub Actions, including any secret a workflow exported into the environment.

## Refactoring

- Timestamps the services and programs write (session, agent, discovery-registry, coverage-policy and manifest times) come from Effect's `Clock` / `DateTime` instead of the wall clock, so tests can drive them with `TestClock`. The stored formats are unchanged.
