---
"@vitest-agent/mcp": patch
---

## Bug Fixes

Fixed `run_tests` collecting zero tests when the MCP server boots inside a monorepo package subtree. Vitest finds the config file by walking up from `root`, but resolves that config's relative `globalSetup` / `setupFiles` entries back down from `root` -- so a package-subtree boot dir loaded the repo-root config while resolving its relative `globalSetup` against the subtree, producing a nonexistent path and failing to load. `run_tests` now auto-anchors an unsupplied `projectRoot` at the directory of the vitest (or vite, as a fallback) config Vitest would load anyway, bounded at the git root, so `root` and the config's directory can no longer disagree. An explicitly supplied, validated `projectRoot` is unaffected and still used verbatim.

The served `run_tests` tool description and its `projectRoot` parameter description are updated to match -- they previously said the server's Vitest root was "frozen at boot"; they now describe the config-anchored default and confirm a supplied `projectRoot` is used verbatim.
