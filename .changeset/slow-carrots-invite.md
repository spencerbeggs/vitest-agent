---
"@vitest-agent/plugin": patch
---

## Bug Fixes

- An invalid `VITEST_AGENT_CONSOLE` override now lists the console modes actually accepted for the detected executor (`human` / `agent` / `ci`) in its stderr warning, instead of a generic message.
- Discovery warns once per package (stderr) when a package that looks test-shaped — a `__test__/` directory, or `src/` files matching the test-file naming convention — is declined by the discover strategy, and points at the `check-test-path` probe. Previously this was a silent skip (#229).

## Other

- `AgentPlugin.runScript` now takes a file-based advisory lock (under `$XDG_DATA_HOME/vitest-agent/runscript-locks/`, with stale-lock takeover and a recently-built short-circuit) so concurrent `vitest` invocations in the same checkout run a `globalSetup` build exactly once instead of racing (#191). Lock timings are tunable via `VITEST_AGENT_RUNSCRIPT_LOCK_*` env vars.
