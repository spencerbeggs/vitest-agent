---
"@vitest-agent/sdk": minor
---

## Features

- New `detectNonDefaultDiscoverStrategy(source)` utility lexically detects whether a Vitest/Vite config's source text configures a non-default `DiscoverStrategy` — a custom `discoverStrategy` option, an `AgentPlugin.discover().addProject(...)` chain, or a class extending `DefaultDiscoverStrategy` / implementing `DiscoverStrategy` (#230).
