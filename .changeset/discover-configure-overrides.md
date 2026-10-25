---
"@vitest-agent/plugin": minor
---

## Features

### Per-project `test` overrides on `AgentPlugin.discover()`

`AgentPlugin.discover({ configure })` and `discoverProjects({ configure })` take a map from project name to Vitest `test` fields (`isolate`, `pool`, `environment`, ...) that is shallow-merged over the generated project after the strategy builds it. The discovered `name` is never replaced, a key naming no discovered project throws at config-load time listing the discovered names, and supplying the map bypasses the process-level discovery cache.

```ts
const { projects, tags } = await AgentPlugin.discover({
  configure: { "@acme/pure-lib": { isolate: false } },
});
```

The merge is exported as the pure `applyProjectOverrides(configs, overrides)` with the `ProjectTestOverrides` and `ProjectConfigureMap` types.

## Performance

* The repo's own suite runs the pure-tier projects (`sdk`, `engine`, `ui`, `reporter`) with `isolate: false`, cutting their wall time by up to about half; `mcp`, `cli`, `plugin`, `sidecar` and `playground` keep forks plus per-file isolation.
