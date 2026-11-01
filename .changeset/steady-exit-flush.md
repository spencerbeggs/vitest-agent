---
"@vitest-agent/cli": patch
---

## Bug Fixes

* Command handlers no longer call `process.exit`, so the `VITEST_REPORTER_LOG_FILE` sink keeps its tail when a hook call fails. Exit codes and stderr text are unchanged.
* `agent triage` and `agent wrapup` with `--format json` print through the shared JSON printer: same bytes, with `##[` escaped under GitHub Actions.
* Subcommand help now lists inherited flags.
