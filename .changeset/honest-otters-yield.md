---
"@vitest-agent/cli": patch
---

## Bug Fixes

- `agent check-test-path` now fails open — exits 1 with no verdict — when the workspace's Vitest or Vite config appears to configure a non-default `DiscoverStrategy`, or when the config file can't be found or read at all, instead of confidently rendering a verdict against a discovery layout it doesn't actually understand (#230).
