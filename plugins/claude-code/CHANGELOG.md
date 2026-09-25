# @vitest-agent/claude-code-plugin

## 2.7.0

### Features

- Hook CLI resolution (`detect_vitest_agent_bin`) no longer falls back to `<pm> exec vitest-agent`. The order is now: `VITEST_AGENT_CLI_CMD` override → relative `node_modules/.bin/vitest-agent` → `PATH` → fail open.
- The MCP loader's `npx` fallback is now pinned to `@vitest-agent/mcp@5`, matching the major version shipped by this release.

### Documentation

- Updated remediation documentation to reflect the engine's `hint` field (renamed from `humanHint`) and added guidance to read `structuredContent` only from MCP tool results. [#502][#502]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#502]: https://github.com/spencerbeggs/vitest-agent/pull/502

## 2.6.3

### Bug Fixes

- The `tdd-task` agent no longer tells the model to call `test_errors` with a `format: "xml"` argument. The tool never accepted that argument, and strict input validation rejected the call. The agent now reads the cite-able `id` and `topStackFrameId` values from `structuredContent.errors[]`.
- The `operating-vitest-agent` skill now points agents at `report.consoleLeaks` and `scopedNote` in `structuredContent` instead of a markdown summary line that `@vitest-agent/mcp` no longer emits.
- The `tdd-artifact` PostToolUse hook documents that `run_tests` results arrive as JSON. It still accepts the markdown headline older servers send.

### Documentation

- The plugin README now gives the correct tool count (30) and says tool results are JSON, not markdown. [#488][#488]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#488]: https://github.com/spencerbeggs/vitest-agent/pull/488

## 2.6.2

### Bug Fixes

#### MCP loader prefers the project's installed server

- `bin/start-mcp.sh` and `bin/start-mcp.mjs` exec the project's own `node_modules/.bin/vitest-agent-mcp` when it exists. When it does not, the loader prints a package-manager-specific install line to stderr and falls back to `npx --yes @vitest-agent/mcp`. The loader no longer needs `jq`.

#### Hooks resolve the CLI locally first

- Every lifecycle hook resolves the `vitest-agent` CLI through `detect_vitest_agent_bin`: the `VITEST_AGENT_CLI_CMD` override wins, then the project's relative `node_modules/.bin/vitest-agent`, then `<pm> exec vitest-agent`. [#420][#420]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#420]: https://github.com/spencerbeggs/vitest-agent/pull/420

## 2.6.1

### Documentation

- README instructions for invoking a hook manually now point at `__test__/fixtures/` [#402][#402]

### Refactoring

- Moves the BATS suites and their fixtures to the package root, matching the test layout the rest of the repo follows and the plugin's own `test-discovery` skill prescribes.

- `hooks/__test__/*.bats` and `render-fixture.sh` now live in `__test__/`

- `hooks/fixtures/` now lives in `__test__/fixtures/`

- The suites are unchanged and still run under `bats --recursive plugins` via `pnpm test:bats`. Relative traversal inside them was rewritten to match the new depth: the repo-root walk is one level shallower, hook-script and shared-lib resolution reaches back down through `../hooks`, and fixtures resolve from each test file's own directory.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#402]: https://github.com/spencerbeggs/vitest-agent/pull/402

## 2.6.0

### Documentation

- `/setup` command now checks for Vitest 5.0 or newer instead of 4.1, matching the plugin's new Vitest 5 floor
- `configuration` skill documents that inline projects inherit the root config (and `AgentPlugin`) by default under Vitest 5, and that `extends: false` opts a project out of both
- `CLAUDE.md`'s command table row for `/setup` now says "Verify Vitest 5.0+" instead of "4.1+" [#380][#380]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#380]: https://github.com/spencerbeggs/vitest-agent/pull/380

## 2.5.6

### Bug Fixes

- Fixed a hook stdout corruption bug (issue #373): Claude Code parses a hook's stdout as a single JSON object, so any stray byte written to fd 1 — including stdout leaked from a spawned `vitest-agent` CLI call that only redirected stderr — corrupted the payload. `hook-output.sh` now fences the real hook stdout onto fd 3 and points fd 1 at stderr, so only its `emit_*` helpers can reach the host.
- Added an `emit_raw` helper for hand-rolled JSON payloads that don't fit the existing `emit_*` shapes (in practice, PreToolUse `updatedInput`). `pre-tool-use/bash.sh`'s Vitest command rewrite and `pre-tool-use/mcp-run-tests.sh`'s `run_tests` `_sessionContext` injection now pipe their payloads through `emit_raw` — without it, the new stdout fence would have silently diverted both payloads to stderr and disabled the rewrite and the injection.
- `session/end-record.sh`'s detached background worker now closes the fenced descriptor (`3>&-`) so it no longer holds open a handle on the host's real stdout pipe, which would have defeated the SessionEnd detach.

### Maintenance

- The plugin moved from `plugin/` to `plugins/claude-code/` and is now versioned through its own private tracking package, `@vitest-agent/claude-code-plugin`. Plugin-only releases no longer bump `@vitest-agent/plugin`, so they no longer trigger an npm build and publish of the Vitest plugin package. Write changesets naming `@vitest-agent/claude-code-plugin` for plugin changes from now on. [#375][#375]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#375]: https://github.com/spencerbeggs/vitest-agent/pull/375
