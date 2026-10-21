---
type: Limitation
title: The RenderedOutput file target is a reserved no-op
description: "routeRenderedOutput dispatches stdout, github-summary, and report targets; a RenderedOutput with target 'file' is accepted by the RenderedOutput schema but silently dropped because no reporter today produces one and no path field convention has been settled."
bounds: ../interfaces/reporter-contract.md
tags: [architecture, observability]
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
sources:
  - id: route
    resource: ../../packages/plugin/src/utils/route-rendered-output.ts
integrity:
  generated:
    body: 0a2652c71c9ea729
---

# The RenderedOutput file target is a reserved no-op

`routeRenderedOutput` is the single place the plugin dispatches a
`RenderedOutput` returned from a `VitestAgentReporterFactory.render()`
call to its side effect: `stdout` writes to the process, `github-summary`
appends to the resolved Step Summary path, and `report` hands the
content to the plugin's `writeReport` sink.[^route] The `file` case in
that same switch does nothing — it returns immediately with no write, no
warning, and no error.[^route]

**Condition.** A custom `VitestAgentReporterFactory` returns a
`RenderedOutput` with `target: "file"`.

**Symptom.** The output is silently discarded. Nothing appears on disk,
nothing appears on stderr, and the reporter's own return value gives no
indication the write failed — from the reporter's point of view the call
succeeded. `DefaultVitestAgentReporter`, this family's own reference
implementation, never produces a `file`-targeted output, so this gap has
never surfaced against the shipped default and is theoretical until a
custom reporter author reaches for it.

**Why this is acceptable.** `file` accepts no path in the current
`RenderedOutput` shape — there is no field for a custom reporter to name
where the file should go — so implementing the target today would mean
guessing a convention (a `filename` field like `report` carries, an
absolute path, a path relative to `cwd`) without a second consumer to
validate the choice against. `report` already covers the one concrete
case this family needs (`.vitest/<scope>/run.json`).

**What a fix would take.** Extend the `RenderedOutput` union so the
`file` variant carries an explicit path field (mirroring `report`'s
`filename`), add a write branch in `routeRenderedOutput` guarded by
`mkdirSync`+`writeFileSync` the same way `github-summary` is, and decide
whether a failed write should throw, warn, or silently drop — consistent
with the best-effort contract the other two side-effecting targets
already follow.

[^route]: `../../packages/plugin/src/utils/route-rendered-output.ts:42-79`
