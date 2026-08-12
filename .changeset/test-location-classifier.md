---
"@vitest-agent/sdk": minor
---

## Features

New `test-location` module exports the canonical test-layout rule as a pure function:

* `classifyTestPath(workspaces, filePath)` — classifies a file path as `valid` (discoverable under a workspace's `src/` or `__test__/` directory), `excluded` (a `__test__/` helper directory — `fixtures/`, `snapshots/`, or `utils/`), or `invalid` (anywhere else), returning a `suggestedPath` for the invalid case. Returns `null` when no supplied workspace contains the path, so callers can fail open instead of treating "no verdict" as invalid.
* `SRC_DIR`, `TEST_DIR`, `TEST_HELPER_DIRS`, `TEST_FILE_GLOB_SUFFIX` — the constants the rule is built from, also consumed by `@vitest-agent/plugin`'s discovery globs and cache signature so the rule has exactly one implementation.

Powers the new `vitest-agent agent check-test-path` CLI subcommand and a PreToolUse hook that flags tests written to an invalid location before they ever silently go uncollected.
