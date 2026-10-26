---
"@vitest-agent/mcp": minor
---

## Features

* `run_tests` accepts a hook-injected `_callerCwd`, the working directory of the agent that made the call. When it sits in a different working tree of the same repository than the resolved Vitest root, the call is refused with `{ kind: "error" }` naming both trees, so a worktree-isolated agent no longer gets results for the wrong tree. Pass `projectRoot` to run in your own worktree. A missing or indeterminate `_callerCwd` never refuses (#275)
