---
"@vitest-agent/cli": major
---

## Breaking Changes

### Internal programs moved to `@vitest-agent/engine`

`SidecarLive`, `RegisterAgentInput`, `RegisterAgentOutput`, and the `lib/*` hook programs are no longer exported from `@vitest-agent/cli`. They live in `@vitest-agent/engine` — import them from there. The package barrel now exports only `CURRENT_CLI_VERSION`.

### Environment contract

- The project directory is read from `VITEST_AGENT_PROJECT_DIR`, then `VITEST_AGENT_REPORTER_PROJECT_DIR`, then `CLAUDE_PROJECT_DIR`, falling back to the current working directory.
- Hook path resolution requires `HOME` (or `USERPROFILE` on Windows) to be present in the environment.

## Features

### `./main` entry point

`main()` now owns the process — it reads `process.env` and `process.cwd()`, builds the engine's `PlatformLive`, and runs the command tree. `bin.ts` is a shim over it, and the same entry is published at `@vitest-agent/cli/main` so `@vitest-agent/plugin` can ship an identical `vitest-agent` bin.

```ts
import { main } from "@vitest-agent/cli/main";
main();
```

## Bug Fixes

- `vitest-agent --version` reports the real package version instead of `0.0.0`.
