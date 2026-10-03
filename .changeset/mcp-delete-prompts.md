---
"@vitest-agent/claude-code-plugin": patch
---

## Bug Fixes

* The MCP PreToolUse hook no longer auto-allows a `delete` action on the consolidated `tdd_goal`, `tdd_behavior` and `note` tools. A main-agent delete now reaches Claude Code's standard permission prompt, as Decision d13 promises. Goal and behavior deletes cascade to phase and artifact history.
