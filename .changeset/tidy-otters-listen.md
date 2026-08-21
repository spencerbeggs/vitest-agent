---
"@vitest-agent/mcp": minor
---

## Features

`run_tests` accepts an optional `projectRoot` input parameter and now always echoes the Vitest root it actually used, on both the `ok` and `no-match` result shapes and in the rendered markdown ("Project root: ...").

Previously the tool's root was frozen at MCP-server boot, so a caller working inside a git worktree of the same repository could silently get results scoped to the *other* tree — a false green with no indication anything was off. A supplied `projectRoot` is validated to belong to the same repository as the server's boot-time root (via `git rev-parse --git-common-dir`, resolved through realpath on both sides); a path in a different repository or that does not exist is rejected with the tool's error envelope naming both paths, never silently falling back.

```ts
run_tests({ projectRoot: "/path/to/other-worktree" });
// -> { kind: "ok", projectRoot: "/path/to/other-worktree", ... }
```

The `projectRoot` field is echoed unconditionally, even when the caller supplies nothing — so a surprising root is always visible in the response.
