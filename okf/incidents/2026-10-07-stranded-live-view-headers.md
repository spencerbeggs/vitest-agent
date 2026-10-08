---
type: Incident
title: Stranded live-view headers from a test's git notices
description: "Duplicate Projects (N): header lines piled up in the stream live view. The cause was a test whose git worktree add inherited stderr, writing under the Ink frame, and not terminal width. The guard is a quiet, piped git helper plus the stray-output capture that now prints such lines above the frame."
status: draft
occurred: 2026-10-07
guard: ../../packages/plugin/__test__/stray-output.e2e.test.ts
tags: [observability, dx, testing]
generated:
  by: okfit/claude-code
  at: 2026-10-08T03:59:37Z
  body_sha256: a32c79d34307caa7346a0fd3326bccd22352b287761962799ffef2d3f0e6eb82
sources:
  - id: leaky-test
    resource: ../../packages/mcp/__test__/run-tests-project-root.test.ts
  - id: plugin-capture
    resource: ../../packages/plugin/src/utils/stray-output-capture.ts
  - id: plugin-e2e
    resource: ../../packages/plugin/__test__/stray-output.e2e.test.ts
  - id: owner-diagnosis
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-10-07T00:00:00Z
---

# Stranded live-view headers from a test's git notices

## What it looked like

A full `pnpm test` in a terminal (the `stream` console mode) left extra
copies of the live view's `Projects (N):` header line in scrollback above
the final frame. The frame itself finished correctly.

## The wrong conclusion

The strands were first put down to terminal width and the terminal emulator:
a wide frame wrapping and Ink losing count of its rows. That explanation did
not hold here, and it led nowhere, because nothing in the frame's own layout
was wrong.

## What was actually true

`packages/mcp/__test__/run-tests-project-root.test.ts` called
`execFileSync("git", ["worktree", "add", …])` with the default inherited
stdio.[^leaky-test] git's "Preparing worktree …" notice went to stderr, and
under the forks pool that byte stream is piped through the main process to
the terminal, below the Ink frame. Ink's next redraw erased one row too low,
so the first line of the old frame (the header) stayed behind. A raw byte
capture in a real iTerm2 window proved it: five strands matched five git
notices exactly.[^owner-diagnosis]

## The guard

- The test now creates worktrees through an `addWorktree` helper that passes
  `--quiet` and `stdio: "pipe"`.[^leaky-test]
- The plugin captures what test processes write past Vitest's console
  capture and, while the live view is drawn, prints each line above the
  frame instead of under it. The run ends with a note naming the count and
  the fix.[^plugin-capture] The design is [Decision 79 — Capture Stray Output
  at Vitest's Logger Streams](../decisions/79-capture-stray-output-at-vitest-logger-streams.md).
  `stray-output.e2e.test.ts` pins the reporting and routing end to end.[^plugin-e2e]
- With the leaky call temporarily restored, a full `pnpm test` in iTerm2 at
  120×40 printed the five notices above one clean `Projects (9):` frame,
  then the stray-output note.[^owner-diagnosis]

The guard does not cover a child spawned from a `threads` or `vmThreads`
worker, whose output bypasses the capture; see [Stray-output capture
gaps](../limitations/stray-output-capture-gaps.md).

[^leaky-test]: `../../packages/mcp/__test__/run-tests-project-root.test.ts` (`addWorktree`)
[^plugin-capture]: `../../packages/plugin/src/utils/stray-output-capture.ts`
[^plugin-e2e]: `../../packages/plugin/__test__/stray-output.e2e.test.ts`
[^owner-diagnosis]: conversation with the repository owner, 2026-10-07
