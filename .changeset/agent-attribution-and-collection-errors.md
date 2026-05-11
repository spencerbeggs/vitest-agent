---
"vitest-agent-sdk": patch
"vitest-agent-cli": patch
"vitest-agent-mcp": patch
"vitest-agent-plugin": patch
---

## Bug Fixes

### Unify project-key resolution between reporter and sidecar CLI

The reporter (via `resolveDataPath`) and the sidecar CLI's `_internal` subcommands previously derived different `projectKey` values for the same workspace, fragmenting writes across two `data.db` files under `$XDG_DATA_HOME/vitest-agent/`. A new SDK helper, `resolveProjectKeyFromCwd`, reads `package.json` directly: it prefers `repository.url` canonicalized to `host__path` and falls back to the normalized `name`. Both call sites now use the same helper, so a single `data.db` per workspace is produced.

### Pin `agents.agent_id` to `session_map.main_agent_id`

`DataStore.RegisterAgentInput` accepts an optional `agentId` field; the sidecar passes the `main_agent_id` returned from `PerClientSessionMapWriter.mapSession()` so the per-project `agents` row id matches the value the SessionStart hook exports as `VITEST_AGENT_MAIN_AGENT_ID` and `VITEST_AGENT_AGENT_ID`. `test_runs.agent_id` rows now join back to a real `agents` row instead of dangling.

### MCP `run_tests`: inject session attribution from a PreToolUse hook

A new PreToolUse hook, `pre-tool-use-mcp-run-tests.sh`, matches `mcp__plugin_vitest-agent_mcp__run_tests` and injects a `_sessionContext` object into the tool input by sourcing the per-session env-files dir. The MCP tool prefers `input._sessionContext` over its boot-time `SessionContextRef`, working around the fact that Claude Code does not auto-source `CLAUDE_ENV_FILE` into MCP server children. Test runs initiated from the MCP tool are now attributed to the active agent.

### Surface collection-failed test files in `run_tests` output

When a test file fails to import — missing module, syntax error, or `beforeAll` throw — Vitest produced a `TestModule` with `state() === 'failed'`, zero collected tests, and the load error in `errors()`. `buildAgentReport` previously dropped these modules silently because `moduleHasFailure` only flipped on a failed test case; the MCP markdown formatter then reported the run as `0 passed` with a misleading `✅` headline. The reporter now includes collection-failed modules in `failed[]`, and the formatter renders a `Module failed to load` block plus a `N failed to load` tally in the headline. The headline status flips to `❌` for any collection failure or unhandled error, keeping the post-tool-use TDD artifact hook from misclassifying these runs as passes.
