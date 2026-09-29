---
type: Decision
title: Effect Services over Plain Functions
description: Every I/O concern shared across the reporter, CLI, and MCP server is an Effect Context.Service with swappable Live/Test layers, not a plain function.
status: stable
tags:
  - architecture
  - effect
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 844a65e4aa85984cfd1a763400d99a3117982a7e19601f7670d0db6790815739
sources:
  - id: engine-data-store
    resource: ../../packages/engine/src/services/DataStore.ts
  - id: engine-data-reader
    resource: ../../packages/engine/src/services/DataReader.ts
  - id: engine-output-pipeline-live
    resource: ../../packages/engine/src/layers/OutputPipelineLive.ts
  - id: engine-environment-detector
    resource: ../../packages/engine/src/services/EnvironmentDetector.ts
  - id: engine-platform
    resource: ../../packages/engine/src/platform.ts
  - id: plugin-reporter
    resource: ../../packages/plugin/src/reporter.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Effect Services over Plain Functions

## Context

The reporter, CLI, and MCP server all need the same underlying
functionality — reading and writing the SQLite cache, resolving an
environment into an output format and detail level, classifying test
outcomes against history — but each front end needs it wired
differently: the reporter only ever writes, the CLI and MCP server only
ever read, and the MCP server additionally needs its I/O layer to stay
alive for the lifetime of a long-running stdio process rather than being
rebuilt per call. Plain functions taking their dependencies as arguments
would work for the logic itself, but testing them without touching real
SQLite or the real environment would mean hand-rolling a mocking layer
for every function, in every package that calls it, over and over.

## Decision

Every shared I/O concern is an Effect `Context.Service` — on Effect v4 the
service tag constructor, the v3 `Context.Tag` rename — with a typed
interface describing its methods as `Effect.Effect<Success, Error>`
values, and a separate Live layer providing the real implementation. Test
layers provide mock state containers instead. `DataStore` (writes) and
`DataReader` (reads) are the two halves of the data layer, each declared
as `Context.Service<DataStore, { ... }>()("vitest-agent/DataStore")` and
`Context.Service<DataReader, { ... }>()("vitest-agent/DataReader")`
respectively — the write/read split is itself deliberate: it lets the
reporter compose only `DataStoreLive` while the CLI and MCP server compose
only `DataReaderLive`, rather than every consumer depending on a single
service that can do both.[^engine-data-store][^engine-data-reader]

The output pipeline needed distinct, individually testable stages, so it
is five separate services rather than one function with five internal
steps: `EnvironmentDetector` (what environment is this?),
`ExecutorResolver` (what role does that environment imply?),
`FormatSelector` (what output format follows from that role, with an
explicit override able to short-circuit it), `DetailResolver` (how much
detail, given run health), and `OutputRenderer` (render through the
selected formatter). `OutputPipelineLive(env)` merges the five Live
layers into one composite; `PlatformLive`, the one platform assembly the
CLI, MCP server, and plugin all provide, folds that composite in
alongside the data layer and the SQLite stack.[^engine-output-pipeline-live][^engine-platform]

Live layers use the core `effect` `FileSystem` (absorbed from
`@effect/platform` on Effect v4) and `@effect/sql-sqlite-node` for actual
I/O; test layers swap in mock implementations that never touch a real
filesystem or database, so a test exercising `DataStore.writeRun` or
`EnvironmentDetector.detect` runs against an in-memory double rather
than a real SQLite file or `process.env`.[^engine-environment-detector]

Construction discipline differs by process shape rather than by
principle: the plugin's Vitest-instantiated reporter class builds a fresh
scoped layer per lifecycle hook and runs it with `Effect.runPromise`,
because the layer is lightweight (SQLite plus pure services) and Vitest
already owns construction of the reporter itself; the MCP server is a
long-running stdio process, so it launches one `PlatformLive` layer for
the whole process lifetime instead of rebuilding it per tool
call.[^plugin-reporter]

## Alternatives rejected

**Plain functions taking dependencies as explicit arguments.** Testable
without a framework, but every one of the three front ends would need to
hand-assemble the same dependency graph and its test doubles
independently, and the reporter/CLI/MCP asymmetry (write-only vs.
read-only vs. long-lived) would have no shared vocabulary to express —
each caller would invent its own convention for "give me the test
double instead."

**One combined read/write data-access service.** Rejected in favor of the
`DataStore`/`DataReader` split specifically because the reporter, CLI, and
MCP server compose different subsets of capability; a single service
would force every consumer to depend on write methods it never calls (the
CLI and MCP server) or read methods it never calls (the reporter),
widening each package's effective dependency surface for no benefit.

**A single monolithic output-formatting function.** Would have been
harder to test in isolation — asserting "given this environment, the
detail level is X" would require also exercising format selection and
rendering in the same test — and would not support an explicit
mid-pipeline override (such as a `--format` flag) without ad hoc branching
inside the one function.

## Consequences

A new consumer gets a working test double by providing the existing test
layer rather than writing one; a new I/O concern gets the same
Live/Test-layer shape as everything else, so the pattern does not need
to be relearned per service. The cost is more files per capability — a
service interface, a Live layer, and often a test layer, versus one
function — and a genuine on-ramp for anyone unfamiliar with Effect's
service/layer model, particularly the distinction between providing a
layer at construction time (the reporter, per hook) versus launching it
once for a process's lifetime (the MCP server). See
[Module: engine](../modules/engine.md) for the full service and layer
inventory this decision produced, and
[Decision 22](../decisions/22-output-pipeline-architecture.md) for the
output pipeline's own rationale in detail.

[^engine-data-store]: `../../packages/engine/src/services/DataStore.ts`
[^engine-data-reader]: `../../packages/engine/src/services/DataReader.ts`
[^engine-output-pipeline-live]: `../../packages/engine/src/layers/OutputPipelineLive.ts`
[^engine-environment-detector]: `../../packages/engine/src/services/EnvironmentDetector.ts`
[^engine-platform]: `../../packages/engine/src/platform.ts`
[^plugin-reporter]: `../../packages/plugin/src/reporter.ts`
