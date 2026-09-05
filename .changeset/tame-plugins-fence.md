---
"@vitest-agent/claude-code-plugin": patch
---

## Bug Fixes

* Fixed a hook stdout corruption bug (issue #373): Claude Code parses a hook's stdout as a single JSON object, so any stray byte written to fd 1 — including stdout leaked from a spawned `vitest-agent` CLI call that only redirected stderr — corrupted the payload. `hook-output.sh` now fences the real hook stdout onto fd 3 and points fd 1 at stderr, so only its `emit_*` helpers can reach the host.
* Added an `emit_raw` helper for hand-rolled JSON payloads that don't fit the existing `emit_*` shapes (in practice, PreToolUse `updatedInput`). `pre-tool-use/bash.sh`'s Vitest command rewrite and `pre-tool-use/mcp-run-tests.sh`'s `run_tests` `_sessionContext` injection now pipe their payloads through `emit_raw` — without it, the new stdout fence would have silently diverted both payloads to stderr and disabled the rewrite and the injection.
* `session/end-record.sh`'s detached background worker now closes the fenced descriptor (`3>&-`) so it no longer holds open a handle on the host's real stdout pipe, which would have defeated the SessionEnd detach.

## Maintenance

* The plugin moved from `plugin/` to `plugins/claude-code/` and is now versioned through its own private tracking package, `@vitest-agent/claude-code-plugin`. Plugin-only releases no longer bump `@vitest-agent/plugin`, so they no longer trigger an npm build and publish of the Vitest plugin package. Write changesets naming `@vitest-agent/claude-code-plugin` for plugin changes from now on.
