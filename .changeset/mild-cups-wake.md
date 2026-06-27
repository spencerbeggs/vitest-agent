---
"@vitest-agent/plugin": minor
---

## Features

### VITEST_AGENT_CONSOLE Env Var

Set `VITEST_AGENT_CONSOLE` to override the console mode that `AgentPlugin` resolves from the `console` option matrix for a single Vitest invocation. Accepted values mirror the per-executor slots:

- `human` executor: `passthrough`, `silent`, `stream`, `agent`
- `agent` executor: `passthrough`, `silent`, `agent`
- `ci` executor: `passthrough`, `silent`, `ci-annotations`

An invalid value for the detected executor is silently ignored and a diagnostic is written to stderr, leaving the config-derived mode in effect. This is an escape hatch for CI pipelines, local debugging sessions, and test setups where modifying `vitest.config.ts` is not practical.

## Bug Fixes

`CoverageOptions` is now exported from the `@vitest-agent/plugin` entry point. The interface appears in `CoverageAnalyzer`'s public method signatures and was reachable through type inference but not directly importable. The package now reports zero API Extractor errors with no new suppressions.
