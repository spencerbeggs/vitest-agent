---
"@vitest-agent/engine": minor
---

## Breaking Changes

`classifyEnvironment` now takes a `RuntimeEnv` snapshot from `@effected/env` instead of an env record plus a separate agent-shell flag.

```typescript
import { RuntimeEnv } from "@effected/env";

// before
classifyEnvironment(process.env, isAgentShell);
// after
classifyEnvironment(RuntimeEnv.fromRecord(process.env));
```

Agent detection now comes from the same snapshot, so the separate flag is gone. Callers of the packaged `EnvironmentDetectorLive` layer are unaffected.

## Features

- `PlatformOptions` gains `logger?: boolean` (default `true`). Pass `false` when the host already owns the logger set, for example under `@effected/cli`'s `CliRuntime.main`; `logLevel` and `logFile` are then ignored.
- CI detection is broader: `CI=1`, `CONTINUOUS_INTEGRATION`, and `GITHUB_ACTIONS` are recognised, and `GITHUB_ACTIONS` wins even when `CI=false`.
- Under GitHub Actions the logger is neutralized so log lines cannot inject workflow commands.

## Bug Fixes

- Agent detection is now driven by the injected environment rather than `std-env`, so tests and embedders see consistent results. `std-env` is no longer a dependency.
- Log-file lines now match the NDJSON shape written to stderr, and file writes are asynchronous.
