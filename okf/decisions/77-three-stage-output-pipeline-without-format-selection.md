---
type: Decision
title: Three-Stage Output Pipeline without Format Selection
description: The output pipeline keeps three chained Effect services (environment, executor, detail) and drops FormatSelector and the OutputFormat type, because the console mode and the shape-tailored dispatcher already decide what a run prints and nothing read the selected format.
status: stable
supersedes: 22-output-pipeline-architecture.md
tags:
  - architecture
  - effect
generated:
  by: okfit/claude-code
  at: 2026-10-08T03:59:37Z
  body_sha256: 944c7e2623c4f6a03725a4e4fbda25f53056c61bdf2684854246724a2bfbccbf
sources:
  - id: engine-environment-detector
    resource: ../../packages/engine/src/services/EnvironmentDetector.ts
  - id: engine-executor-resolver
    resource: ../../packages/engine/src/services/ExecutorResolver.ts
  - id: engine-detail-resolver
    resource: ../../packages/engine/src/services/DetailResolver.ts
  - id: engine-output-pipeline-live
    resource: ../../packages/engine/src/layers/OutputPipelineLive.ts
  - id: engine-platform
    resource: ../../packages/engine/src/platform.ts
  - id: sdk-reporter-contract
    resource: ../../packages/sdk/src/contracts/reporter.ts
  - id: issue-558
    resource: https://github.com/spencerbeggs/vitest-agent/issues/558
    title: "Remove FormatSelector / OutputFormat"
verified:
  - by: human:spencer
    at: 2026-10-08T03:57:59Z
---

# Three-Stage Output Pipeline without Format Selection

## Context

[Decision 22](./22-output-pipeline-architecture.md) made the output
pipeline four chained services: `EnvironmentDetector`, `ExecutorResolver`,
`FormatSelector`, `DetailResolver`. `FormatSelector.select` mapped the
executor role, plus an optional explicit override, onto an `OutputFormat`
(`terminal`, `markdown`, `json`, `vitest-bypass`, `silent`,
`ci-annotations`), and the plugin carried the result into the reporter on
`ResolvedReporterConfig.format`.

By the time of issue #558 nothing decided anything from that value. What
a run prints is decided elsewhere: the per-executor console mode
(`AgentPluginOptions.console`, resolved to `ResolvedReporterConfig.consoleMode`)
chooses between the stream, final and silent paths, and the shape-tailored
dispatcher matrix in `@vitest-agent/ui` chooses the layout within a path
([Decision 78](./78-ink-half-behind-a-ui-subpath-and-lazy-reporter-views.md), which superseded Decision 41). The plugin even
derived `format` back from the console mode through a private
`resolveFormat` so that the field had a value. The CLI's and MCP server's
own `--format` / `format` arguments never went through `FormatSelector`.
The fourth stage was a computed value with no reader.

## Decision

The output pipeline is three chained Effect services, each still a
`Context.Service` with a narrow interface and its own Live layer:

1. **`EnvironmentDetector`** answers "what environment are we in?" from
   the env map alone.[^engine-environment-detector]
2. **`ExecutorResolver`** maps that environment to a role (`human`,
   `agent`, `ci`).[^engine-executor-resolver]
3. **`DetailResolver`** resolves how much detail to show from the role and
   the run's health.[^engine-detail-resolver]

`OutputPipelineLive(env)` merges `EnvironmentDetectorLive(env)`,
`ExecutorResolverLive` and `DetailResolverLive`, and `PlatformLive` folds
that composite in as before. `PlatformServices` no longer names a format
service.[^engine-output-pipeline-live][^engine-platform]

`FormatSelector`, `FormatSelectorLive`, the sdk `OutputFormat` schema and
type, `ResolvedReporterConfig.format`, the plugin's `resolveFormat`, and the
reporter package's `OutputFormat` re-export are all removed. A custom
reporter that wants to branch on output reads `consoleMode`, `executor`,
`environment` and `detail` from `ResolvedReporterConfig`.[^sdk-reporter-contract]

The reason for separate stages that Decision 22 gave still holds for the
three that remain: each is independently testable and independently
replaceable, and a new environment or role is a change to one Live layer.

## Alternatives rejected

**Keep `FormatSelector` as an extension point.** It had no reader inside
the family, and a custom reporter receives the console mode and executor,
which carry the same information. Keeping a public service and a public
schema that nothing consumes means keeping them correct across every later
change to console modes, for no caller.

**Keep `ResolvedReporterConfig.format` but derive it from the console mode.**
That is what the plugin already did through `resolveFormat`. It made the
field a second spelling of `consoleMode` that could drift from it, which is
the same kind of duplicate [Decision 40](./40-agentpluginoptions-is-exactly-five-fields.md)
removed from the options surface.

## Consequences

Removing `OutputFormat` from `@vitest-agent/sdk` and `@vitest-agent/reporter`
and `FormatSelector` from `@vitest-agent/engine` is a breaking change to
their public exports, so it ships with changesets that say so. A caller
composing the pipeline by hand provides three services instead of four.
[Decision 6](./6-effect-services-over-plain-functions.md) still describes
the pipeline as four services in its illustration of the service pattern;
this Decision is the current shape. See [Module: engine](../modules/engine.md)
for the service and layer inventory.

[^engine-environment-detector]: `../../packages/engine/src/services/EnvironmentDetector.ts`
[^engine-executor-resolver]: `../../packages/engine/src/services/ExecutorResolver.ts`
[^engine-detail-resolver]: `../../packages/engine/src/services/DetailResolver.ts`
[^engine-output-pipeline-live]: `../../packages/engine/src/layers/OutputPipelineLive.ts`
[^engine-platform]: `../../packages/engine/src/platform.ts`
[^sdk-reporter-contract]: `../../packages/sdk/src/contracts/reporter.ts`
