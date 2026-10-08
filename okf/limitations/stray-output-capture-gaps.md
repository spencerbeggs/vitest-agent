---
type: Limitation
title: Stray-output capture misses thread-pool children, passthrough mode, and bytes outside the run window
description: "The stray-output capture sees only what reaches Vitest's Logger streams while the plugin owns the console and a run is open. A child process spawned from a threads or vmThreads worker writes straight to the terminal, passthrough mode installs no capture, and bytes written after the run-end snapshot or between watch-mode runs are passed through but not counted."
status: draft
bounds: ../modules/plugin.md
tags: [observability, testing, compat]
generated:
  by: okfit/claude-code
  at: 2026-10-08T03:59:37Z
  body_sha256: dc01226d6e9632e3c7a7460ea9c794cf155a10e4abc05a3139f7f1c2ae9983a0
sources:
  - id: plugin-capture
    resource: ../../packages/plugin/src/utils/stray-output-capture.ts
  - id: plugin-ts
    resource: ../../packages/plugin/src/plugin.ts
  - id: plugin-reporter
    resource: ../../packages/plugin/src/reporter.ts
  - id: vitest-threads-worker
    resource: https://github.com/vitest-dev/vitest/blob/v5.0.0/packages/vitest/src/node/pools/workers/threadsWorker.ts
---

# Stray-output capture misses thread-pool children, passthrough mode, and bytes outside the run window

The plugin records stray output by wrapping Vitest's
`logger.outputStream` and `errorStream`
([Decision 79](../decisions/79-capture-stray-output-at-vitest-logger-streams.md)).[^plugin-capture]
Anything that does not pass through those two streams while a run is open
is invisible to it. Four conditions fall outside.

**A child process spawned from a `threads` or `vmThreads` worker.** These
pools pipe a worker thread's JS-level `process.stdout` and `process.stderr`
writes into the Logger streams, but a child process started from a thread
inherits the main process's real fds 1 and 2.[^vitest-threads-worker]
*Symptom:* in the `stream` console mode, the child's output lands under
the live frame and can still strand a line of it, and the run's
`strayOutput` does not count it. The `forks` and `vmForks` pools (this
repository uses `forks`) do not have this gap. *Fix:* none at this layer.
The bytes never reach the main process's JavaScript, so catching them would
take fd-level redirection of the main process.

**The `passthrough` console mode.** The capture is installed only inside
`configureVitest`'s `ownsStdout(consoleMode)` branch. In `passthrough`,
Vitest's own reporters write the user's console output through the same
Logger streams, so wrapping them would count ordinary reporter output as
stray.[^plugin-ts] *Symptom:* no `strayOutput` on any report and no note,
whatever the tests write. *Acceptable* because passthrough leaves the
console to Vitest by design and draws no live frame for a stray line to
strand.

**Bytes after the run-end snapshot.** `AgentReporter` snapshots the
recorder at `onTestRunEnd`.[^plugin-reporter] A worker that is still
draining its pipe after that point has its bytes passed through, or printed
above the frame while routing is still on, but the reported count does not
include them.

**Watch-mode output between runs.** The recorder is reset at
`onTestRunStart`, so whatever a watch-mode idle period wrote is dropped
from the next run's count. The bytes themselves still reach the terminal.

[^plugin-capture]: `../../packages/plugin/src/utils/stray-output-capture.ts`
[^plugin-ts]: `../../packages/plugin/src/plugin.ts` (`configureVitest`)
[^plugin-reporter]: `../../packages/plugin/src/reporter.ts` (`onTestRunStart`, `onTestRunEnd`)
[^vitest-threads-worker]: <https://github.com/vitest-dev/vitest/blob/v5.0.0/packages/vitest/src/node/pools/workers/threadsWorker.ts>
