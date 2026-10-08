---
type: Measurement
title: Reporter and ui import module counts
description: How many modules Node loads to import @vitest-agent/reporter and the @vitest-agent/ui root, and how many of them are React or Ink, before and after the Ink half moved behind @vitest-agent/ui/ink and the reporter's two lazy view loads (issue 562).
justifies: ../decisions/78-ink-half-behind-a-ui-subpath-and-lazy-reporter-views.md
tags: [performance, bundle]
stale_after: 2027-04-07T00:00:00Z
status: draft
generated:
  by: okfit/claude-code
  at: 2026-10-08T03:59:37Z
  body_sha256: f0aa7d0981caf3da0b0e4bb75c4f7f4a6194fe260ddfb970135ddc6751a84e79
sources:
  - id: issue-562
    resource: https://github.com/spencerbeggs/vitest-agent/issues/562
  - id: reporter-live-view
    resource: ../../packages/reporter/src/liveView.ts
  - id: reporter-default-reporter
    resource: ../../packages/reporter/src/defaultReporter.ts
  - id: ui-ink-entry
    resource: ../../packages/ui/src/ink/index.ts
---

# Reporter and ui import module counts

## Inputs

What was measured is the cost of a bare `import` of two entry points. A
run that never draws an Ink frame pays this cost, which covers an agent
run, a CI run and a piped run:

- `@vitest-agent/reporter`, the package the plugin loads to get
  `DefaultVitestAgentReporter`.
- the `@vitest-agent/ui` package root, which `@vitest-agent/reporter`
  imports for the reducer, `renderAgent` and the agent dispatcher.

The **before** state is the single-entry `@vitest-agent/ui`. Every Ink
component and every cell's Ink half sat beside the pure modules, and the
reporter imported `ink` and `react` statically. The **after** state is the
issue 562 split described in
[Decision 78](../decisions/78-ink-half-behind-a-ui-subpath-and-lazy-reporter-views.md).
The Ink modules sit behind `@vitest-agent/ui/ink`, and the reporter reaches
them only through `CliUi.lazyView(() => import("./streamView.js"))` and
`await import("./humanReport.js")`.

## Method

A Node `module.registerHooks` load hook counted every module loaded while
the entry was imported, and separately counted the React and Ink modules
among them. The import ran against the built `dist/dev` output of each
package, so it measured what a consumer's `import` actually evaluates, not
the TypeScript sources. The numbers were taken on 2026-10-07 on the
`feat/ink-8` branch, with Ink 8.

## Results

| Entry | Before: modules | After: modules | After: React/Ink modules |
| ----- | --------------- | -------------- | ------------------------ |
| `@vitest-agent/reporter` | 1051 | 481 | 0 (was 76) |
| `@vitest-agent/ui` root | 1026 | 451 | 0 |

Issue 562, filed 2026-10-03, recorded the pre-split cost as about 1019
modules for the ui entry and about 1044 for the reporter. Those are earlier
readings of the same before state; the 1026 and 1051 in the table are the
figures this measurement reports as before. For comparison, the reporter
module recorded `@effected/cli/ui` on its own at about 333 modules.

## What the numbers rule in or out

- They rule in the split: importing the reporter now loads well under half
  the modules it did, and none of them are React or Ink. An agent or CI run
  never mounts the Ink live view, so that whole cost had been paid for
  nothing.
- They rule out the earlier reason for declining `CliUi.lazyView`. The
  reporter module had noted that a lazy view could not help while the ui
  package's single entry loaded Ink regardless. Once the Ink half moved to
  a subpath, the lazy view is what keeps it unloaded.
- They do not measure wall-clock import time. The claim is about module
  count and reachability only, and a time measurement would have to be
  taken separately before anyone cites one.

Re-measure when `@vitest-agent/ui`'s root or the reporter gains a
dependency, or when `@effected/cli` changes what its root entry loads.
