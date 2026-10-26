---
"@vitest-agent/ai-plugins": minor
---

## Features

* The `run_tests` hook forwards the invoking agent's working directory as `_callerCwd`, so the MCP server can refuse a call from the wrong worktree (#275). It does so only when the project's `@vitest-agent/mcp` is 5.5.0 or later, which SessionStart resolves and records as `VITEST_AGENT_MCP_VERSION`; an older server would reject the extra key.

## Bug Fixes

* The `run_tests` hook now injects its context even when the session's attribution ids are missing, instead of skipping the call entirely
