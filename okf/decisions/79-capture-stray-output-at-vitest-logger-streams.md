---
type: Decision
title: Capture Stray Output at Vitest's Logger Streams
description: "The plugin wraps the Vitest Logger's outputStream and errorStream to count and sample what test processes write past Vitest's console capture, reports it as strayOutput, and, while a live view is drawn, hands whole lines to the reporter through an optional printStrayLine seam so they print above the frame instead of under it."
status: stable
tags: [architecture, observability, dx, testing]
generated:
  by: okfit/claude-code
  at: 2026-10-08T03:59:37Z
  body_sha256: 5527f56cda37a8d9197f571890187391d94df9217ff47fbe9a291b62d49c63cd
sources:
  - id: plugin-capture
    resource: ../../packages/plugin/src/utils/stray-output-capture.ts
  - id: plugin-ts
    resource: ../../packages/plugin/src/plugin.ts
  - id: plugin-reporter
    resource: ../../packages/plugin/src/reporter.ts
  - id: sdk-contract
    resource: ../../packages/sdk/src/contracts/reporter.ts
  - id: sdk-stray-utils
    resource: ../../packages/sdk/src/utils/stray-output.ts
  - id: reporter-live-view
    resource: ../../packages/reporter/src/liveView.ts
  - id: mcp-run-tests
    resource: ../../packages/mcp/src/tools/run-tests.ts
  - id: vitest-forks-worker
    resource: https://github.com/vitest-dev/vitest/blob/v5.0.0/packages/vitest/src/node/pools/workers/forksWorker.ts
  - id: plugin-e2e
    resource: ../../packages/plugin/__test__/stray-output.e2e.test.ts
  - id: owner-iterm-check
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-10-07T00:00:00Z
verified:
  - by: human:spencer
    at: 2026-10-08T03:57:59Z
---

# Capture Stray Output at Vitest's Logger Streams

## Context

The `stream` console mode draws a live Ink frame that redraws in place. Bytes
written to the terminal by anything other than the frame land under it, and
the next redraw erases from the wrong row and leaves a stale copy of the
frame's first line in scrollback. The case that exposed it was a test whose
`execFileSync("git", ["worktree", "add", …])` inherited stderr: git's
"Preparing worktree" notices stranded duplicate `Projects (N):` headers
([Incident: stranded live-view headers from a test's git
notices](../incidents/2026-10-07-stranded-live-view-headers.md)).

Vitest 5's forks and vmForks pools fork each worker with `stdio: "pipe"` and
pipe its stdout and stderr into `vitest.logger.outputStream` and
`errorStream`, so a grandchild process that inherits the worker's fds also
flows through the main process.[^vitest-forks-worker] The threads and
vmThreads pools pipe only a worker thread's JS-level writes. A child process
spawned from a worker thread inherits the main process's real fds and never
passes through the Logger.

## Decision

**Capture at the Logger's two streams, in the plugin.** In
`configureVitest`, and only when the resolved console mode owns stdout (every
mode except `passthrough`), the plugin calls `installStrayOutputCapture` on
`vitest.logger`.[^plugin-ts] It replaces both streams with a pass-through
`Writable` that records every write into a bounded sdk recorder: line counts
per stream, a byte count, and the first five lines as samples of up to 160
characters each.[^sdk-stray-utils] A write made only of terminal escapes is
Vitest's own cursor or clear-screen write; it passes through unrecorded. The
wrapper copies `isTTY`, `columns`, `rows` and the colour helpers from the
original stream, so Vitest's own terminal handling still works. The capture
is installed once per Logger and published on it under
`Symbol.for("vitest-agent/stray-output")` (the sdk's `STRAY_OUTPUT_SOURCE`),
so MCP's `run_tests`, which cannot import the plugin, reads it with the sdk's
`readStrayOutput`.[^plugin-capture] [^mcp-run-tests]

**Report it as data.** `AgentReporter` resets the recorder at
`onTestRunStart` and snapshots it at `onTestRunEnd` onto `RunFinished` and
every project report as `strayOutput`.[^plugin-reporter] The renderers print
one note naming the count, the streams, the usual cause, and the fix
(`stdio: "pipe"`).

**Route lines only to a reporter that asks, and only on a real terminal.**
The reporter contract gains an optional `VitestAgentReporter.printStrayLine?(stream,
line): boolean`.[^sdk-contract] At `onInit` the plugin routes whole lines to
the first reporter that implements it. While a printer is routed, and only
for a stream whose original is the process's own `process.stdout` or
`process.stderr`, the capture line-buffers and hands each whole line over; a
`false` return, or a printer that throws, sends the line to the original
stream. Routing is cleared before reporters close, which flushes any held
partial line. The plugin never renders the line itself.
`DefaultVitestAgentReporter` implements the method only for the `stream`
live view, through the kit's `LiveHandle.logConsole`, which prints above the
frame. It declines before the handle resolves and after close.[^reporter-live-view]

The terminal-identity check is the routing gate because the kit's
`LiveHandle` has no query for whether a frame is mounted right now. Under
MCP the Logger's streams are the server's null sink, so routing never
applies there and nothing reaches the JSON-RPC stdout.

## Alternatives rejected

- **Patch `child_process` defaults so children never inherit stdio.**
  Changing the spawn semantics of the code under test would change what the
  tests prove and break tests that need inherited stdio on purpose. It would
  also not reach native addons or bytes written directly to fds 1 and 2.
- **A source-scan guard only** (fail a test that calls `execFileSync` or
  `spawn` without `stdio: "pipe"`). It fits this repository and nobody
  else's, misses indirect spawns through libraries, and tells a consumer
  nothing at run time. The scan was not built. The repository's own fix is
  the `addWorktree` helper in the test that leaked.
- **Route and render in the plugin.** The plugin knows nothing about the
  frame. Printing above it needs the live view's handle, which the reporter
  owns, and the plugin is not supposed to render
  ([Decision 34](./34-plugin-reporter-split.md)). The optional contract
  method keeps rendering in the reporter and leaves custom reporters free to
  ignore it.
- **Persist it to SQLite.** The signal is about one run's terminal, not test
  history. It rides the report and the event stream and is never persisted.

## Consequences

- One stream is shared by every project, so `strayOutput` is run-level:
  every project report of a run carries the same value, and nothing
  attributes a line to a project, file or test.
- The captured bytes still reach the terminal (above the frame, or passed
  through), so nothing a test prints is lost.
- The edges are recorded as limitations: [Stray-output capture
  gaps](../limitations/stray-output-capture-gaps.md) and [Stray output is
  not persisted or shown on CI surfaces](../limitations/stray-output-not-persisted-or-on-ci.md).
- Two `@effected/cli` kit gaps came out of this work. `LiveHandle` has no "is
  a frame mounted" query, which forced the terminal-identity gate.
  `CliUiTestLive` cannot simulate a raw foreign write under the frame, so
  the end-to-end proof is `stray-output.e2e.test.ts` plus a manual check.[^plugin-e2e]
- Verified by hand on 2026-10-07 in a real iTerm2 window at 120×40: with the
  leaky git call temporarily restored, a full `pnpm test` printed the five
  notices above one clean `Projects (9):` frame and ended with the
  stray-output note.[^owner-iterm-check]

## Related

- [Module: plugin](../modules/plugin.md), [Module: reporter](../modules/reporter.md),
  [Module: sdk](../modules/sdk.md)
- [Interface: reporter contract](../interfaces/reporter-contract.md)
- [Decision 57 — Partition the consoleLeaks signal by test
  outcome](./57-partition-the-consoleleaks-signal-by-test-outcome.md),
  the captured-console counterpart this signal sits beside.

[^plugin-capture]: `../../packages/plugin/src/utils/stray-output-capture.ts`
[^plugin-ts]: `../../packages/plugin/src/plugin.ts` (`configureVitest`, inside the `ownsStdout(consoleMode)` branch)
[^plugin-reporter]: `../../packages/plugin/src/reporter.ts` (`routeStrayOutput`, `onTestRunStart`, `onTestRunEnd`)
[^sdk-contract]: `../../packages/sdk/src/contracts/reporter.ts`
[^sdk-stray-utils]: `../../packages/sdk/src/utils/stray-output.ts`
[^reporter-live-view]: `../../packages/reporter/src/liveView.ts` (`printAbove`, `startLiveView`)
[^mcp-run-tests]: `../../packages/mcp/src/tools/run-tests.ts`
[^vitest-forks-worker]: <https://github.com/vitest-dev/vitest/blob/v5.0.0/packages/vitest/src/node/pools/workers/forksWorker.ts>
[^plugin-e2e]: `../../packages/plugin/__test__/stray-output.e2e.test.ts`
[^owner-iterm-check]: conversation with the repository owner, 2026-10-07
