---
"@vitest-agent/cli": patch
---

## Bug Fixes

`vitest-agent agent check-test-path` now fails open (exit 1, empty stdout) when the workspace's `pnpm-workspace.yaml` or `package.json` workspace patterns cannot be read, parsed or compiled. `@effected/workspaces` 0.46 throws a typed error in that case where it used to return no packages, which would have crashed the hook with a stack trace on stderr instead of rendering no verdict.
