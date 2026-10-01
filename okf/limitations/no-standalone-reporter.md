---
type: Limitation
title: There is no standalone reporter usage outside the plugin
description: "The internal AgentReporter Vitest-API class is not exported from @vitest-agent/reporter or @vitest-agent/plugin; a consumer cannot wire vitest-agent's persistence and classification into vitest.config.ts's reporters array directly the way the pre-2.0 package allowed."
bounds: ../modules/reporter.md
tags: [architecture, compat]
generated:
  by: okfit/claude-code
  at: 2026-10-01T13:07:49Z
  body_sha256: 21fffef974eba7fcd48fd423926eb39e3609f802d9b8d8ced3283f1339692cf6
sources:
  - id: reporter-index
    resource: ../../packages/reporter/src/index.ts
---

# There is no standalone reporter usage outside the plugin

`@vitest-agent/reporter`'s public surface is exactly the reporter
*contract* types re-exported from the SDK, `DefaultVitestAgentReporter`
(a `VitestAgentReporterFactory`), the dispatch helpers, and a
version constant — nothing that implements Vitest's own `Reporter`
interface.[^reporter-index] The class that actually does (`AgentReporter`,
which wires every Vitest lifecycle hook, persists to SQLite, and drives
classification/baselines/trends) lives in `@vitest-agent/plugin` and is
never exported from that package's public surface either — it is
constructed internally by `AgentPlugin()`'s `configureVitest` hook.

**Condition.** A consumer wants vitest-agent's behavior — persistence,
classification, coverage policy, rendering — without adopting
`AgentPlugin()` as a Vite/Vitest plugin, the way the pre-2.0
`vitest-agent-reporter` package let a project add a reporter instance
directly to `test.reporters` in `vitest.config.ts`.

**Symptom.** There is no import path that produces a Vitest-API
`Reporter` instance from this family standalone. The only supported
integration point is `AgentPlugin()` in the `plugins` array; a
`VitestAgentReporterFactory` (the customization surface this family does
expose) controls *rendering* only and still requires the plugin to drive
the Vitest lifecycle, persistence, and classification underneath it.

**Why this is acceptable.** The plugin/reporter split (rendering
factored out of lifecycle ownership) was itself the point of the 2.0
redesign — `AgentReporter` needs services and layers from
`@vitest-agent/engine` (SQLite client, migrations, coverage analysis)
that a bare Vitest `Reporter` export would have to either bundle or
leave the consumer to wire by hand, reproducing most of what
`AgentPlugin()` already does. A thin plugin entry point is less surface
to keep stable than a standalone reporter class plus the services it
depends on.

**What a fix would take.** Exporting `AgentReporter` (or a factory that
constructs one) from `@vitest-agent/plugin` alongside the services it
needs (`PlatformLive`, `ReporterLive`, `ensureMigrated`) as a documented,
versioned surface — effectively promoting an internal implementation
class to a second public integration path that the workspace-layering
and boundary tests would then need to cover.

[^reporter-index]: `../../packages/reporter/src/index.ts:23-65`
