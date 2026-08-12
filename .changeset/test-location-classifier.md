---
"@vitest-agent/sdk": minor
---

## Features

New `test-location` module exports the canonical test-layout rule as a pure function:

* `classifyTestPath(workspaces, filePath)` — classifies a file path as `valid` (discoverable under a workspace's `src/` or `__test__/` directory), `excluded` (a `__test__/` helper directory — `fixtures/`, `snapshots/`, or `utils/`), or `invalid` (anywhere else), returning a `suggestedPath` for the invalid case. Returns `null` when no supplied workspace contains the path and when the path crosses a directory discovery never walks into, so callers can fail open instead of treating "no verdict" as invalid.
* `findOwningWorkspace(workspaces, filePath)` — the deepest-containing-workspace attribution `classifyTestPath` uses, exported so callers that need to reason about a path relative to its owning package agree with the classifier about which package owns it.
* `isTestFileName(filePathOrName)` — the extension half of the rule as a predicate.
* `SRC_DIR`, `TEST_DIR`, `TEST_HELPER_DIRS`, `TEST_FILE_GLOB_SUFFIX`, `NON_DISCOVERABLE_DIRS` — the constants the rule is built from, also consumed by `@vitest-agent/plugin`'s discovery globs, tag-injection gate, test-file walker, and cache signature, so the layout rule has one implementation rather than one per surface.

The layout rule is single-sourced here; two things around it are deliberately not. A nested `package.json` marks an independent unit whose tests belong to a different discovery pass, and detecting one needs a filesystem probe, so it stays outside the pure classifier — `@vitest-agent/cli`'s `agent check-test-path` applies it in the caller. And the Claude Code plugin's PreToolUse hook keeps a lexical copy of the extension list in bash as a zero-cost prefilter before it spawns anything; it delegates every judgement about location to the CLI.

Powers the new `vitest-agent agent check-test-path` CLI subcommand and a PreToolUse hook that flags tests written to an invalid location before they ever silently go uncollected.
