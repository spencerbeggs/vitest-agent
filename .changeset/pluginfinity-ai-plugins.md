---
"@vitest-agent/ai-plugins": major
---

## Breaking Changes

- The agent plugin moved from `plugins/claude-code` to `plugin/` and is now built with pluginfinity from one host-neutral source; the Claude Code marketplace installs `plugin/builds/claude`. The tracking package is renamed from `@vitest-agent/claude-code-plugin` to `@vitest-agent/ai-plugins`.
- The `/tdd`, `/setup` and `/configure` commands are now the skills `/vitest-agent:tdd`, `/vitest-agent:setup` and `/vitest-agent:configure`.
- Hook logs moved to `$XDG_STATE_HOME/pluginfinity/vitest-agent/`, and `PLUGINFINITY_DEBUG=1` replaces `VITEST_AGENT_HOOK_DEBUG`.
- The SessionEnd and PreCompact wrap-up messages are removed; Claude Code never displayed them.

## Features

- A GitHub Copilot build (`plugin/builds/copilot`) ships the same hooks, skills, `tdd-task` agent and MCP server. On Copilot the MCP server cannot yet locate the project, so it falls back to `npx` with a non-project database.
