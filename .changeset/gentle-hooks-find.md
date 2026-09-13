---
"@vitest-agent/claude-code-plugin": patch
---

## Bug Fixes

### MCP loader prefers the project's installed server

`bin/start-mcp.sh` and `bin/start-mcp.mjs` exec the project's own `node_modules/.bin/vitest-agent-mcp` when it exists. When it does not, the loader prints a package-manager-specific install line to stderr and falls back to `npx --yes @vitest-agent/mcp`. The loader no longer needs `jq`.

### Hooks resolve the CLI locally first

Every lifecycle hook resolves the `vitest-agent` CLI through `detect_vitest_agent_bin`: the `VITEST_AGENT_CLI_CMD` override wins, then the project's relative `node_modules/.bin/vitest-agent`, then `<pm> exec vitest-agent`.
