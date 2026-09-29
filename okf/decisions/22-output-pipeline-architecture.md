---
type: Decision
title: Output Pipeline Architecture
description: The output pipeline is five chained, independently testable Effect services rather than one function, so any stage's automatic selection can be short-circuited by an explicit override.
status: stable
tags:
  - architecture
  - effect
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 5e30615e0158a9e919b48508a8c09f458e0288fb86d52745171dcc0c2b4645e7
sources:
  - id: engine-environment-detector
    resource: ../../packages/engine/src/services/EnvironmentDetector.ts
  - id: engine-executor-resolver
    resource: ../../packages/engine/src/services/ExecutorResolver.ts
  - id: engine-format-selector
    resource: ../../packages/engine/src/services/FormatSelector.ts
  - id: engine-detail-resolver
    resource: ../../packages/engine/src/services/DetailResolver.ts
  - id: engine-output-renderer
    resource: ../../packages/engine/src/services/OutputRenderer.ts
  - id: engine-output-pipeline-live
    resource: ../../packages/engine/src/layers/OutputPipelineLive.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Output Pipeline Architecture

## Context

The same `AgentReport[]` has to render differently depending on where it
runs: a human terminal wants ANSI and OSC-8 hyperlinks, a CI job wants
GFM or workflow-command annotations, an MCP-driven agent wants JSON or
plain terminal text with no ANSI. Getting from "here is a completed test
run" to "here is the right rendering for this caller" is not one
decision — it is a chain of narrower decisions, each of which a caller
might want to override individually (an explicit `--format` flag should
win over automatic format selection without also overriding detail
level or environment detection).

## Decision

Five chained Effect services form the output pipeline, each a
`Context.Service` with a single-method interface:

1. **`EnvironmentDetector`** — `detect(): Effect.Effect<Environment>`,
   plus `isAgent` and `agentName` for the agent-shell probe. Answers
   "what environment are we in?" from the env map alone.[^engine-environment-detector]
2. **`ExecutorResolver`** — `resolve(env: Environment):
   Effect.Effect<Executor>`. Maps the detected environment to a role
   (`human`, `agent`, `ci`).[^engine-executor-resolver]
3. **`FormatSelector`** — `select(executor: Executor, explicitFormat?:
   OutputFormat, environment?: Environment): Effect.Effect<OutputFormat>`.
   The `explicitFormat` parameter is the short-circuit point: when a
   caller supplies one (a CLI `--format` flag, an MCP tool's `format`
   argument), it wins outright over whatever the executor role would
   otherwise select.[^engine-format-selector]
4. **`DetailResolver`** — resolves how much detail to show from the
   executor role and the run's health (pass/fail/timeout
   state).[^engine-detail-resolver]
5. **`OutputRenderer`** — `render(reports: ReadonlyArray<AgentReport>,
   format: OutputFormat, context: FormatterContext):
   Effect.Effect<ReadonlyArray<RenderedOutput>>`. Dispatches to the
   formatter matching the selected format and produces the final
   `RenderedOutput[]`.[^engine-output-renderer]

`OutputPipelineLive(env)` merges the five corresponding Live layers —
`EnvironmentDetectorLive(env)`, `ExecutorResolverLive`,
`FormatSelectorLive`, `DetailResolverLive`, `OutputRendererLive` — into
one composite that `PlatformLive` folds in alongside the data layer and
SQLite stack, so every consumer (CLI, MCP server, plugin) gets the same
detect → resolve executor → select format → resolve detail → render
chain from one shared assembly rather than five separately-wired
services per front end.[^engine-output-pipeline-live]

Each stage is a distinct service specifically so it is independently
testable: a test asserting "agent executor selects JSON format" needs
only `FormatSelector`, not the full chain from environment detection
through rendering. New formatters register with `OutputRenderer` without
touching any of the other four stages, and a new environment or executor
classification is a change to one service's Live layer, not a rewrite of
the chain's shape.

## Alternatives rejected

**One function performing detect → resolve → select → render inline.**
Would make testing any one policy (e.g., "does an explicit format
override win") require exercising the whole chain in the same test,
and would give an override no natural insertion point short of ad hoc
branching inside the one function — which is exactly what
`FormatSelector.select`'s `explicitFormat` parameter formalizes as a
first-class short-circuit instead.

**Three or four stages instead of five, folding adjacent concerns
together.** Considered implicitly by the shape of the split itself:
environment detection and executor resolution stay separate because
"what environment" and "what role" are different questions with
different answer spaces (four environments, three executor roles), and
folding format selection and detail resolution together would couple two
independently-overridable choices — a caller can want an explicit format
without an explicit detail level, or vice versa.

## Consequences

Adding a sixth environment or a new output format is a change local to
one service's Live layer and its test layer, not a chain-wide rewrite.
The five-service shape does mean a caller working with the pipeline
directly (rather than through `PlatformLive`) has to provide all five
services' dependencies even when only using one or two, though in
practice every consumer composes through `OutputPipelineLive`/
`PlatformLive` rather than wiring the five individually. See
[Decision 6](../decisions/6-effect-services-over-plain-functions.md) for
why this pipeline is Effect services rather than plain functions in the
first place, and [Module: engine](../modules/engine.md) for the full
service and layer inventory.

[^engine-environment-detector]: `../../packages/engine/src/services/EnvironmentDetector.ts`
[^engine-executor-resolver]: `../../packages/engine/src/services/ExecutorResolver.ts`
[^engine-format-selector]: `../../packages/engine/src/services/FormatSelector.ts`
[^engine-detail-resolver]: `../../packages/engine/src/services/DetailResolver.ts`
[^engine-output-renderer]: `../../packages/engine/src/services/OutputRenderer.ts`
[^engine-output-pipeline-live]: `../../packages/engine/src/layers/OutputPipelineLive.ts`
