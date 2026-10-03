---
type: Limitation
title: Only stream mode renders progressively; every other console mode paints once at run end
description: "Agent, passthrough, and ci-annotations console modes assemble their final-frame string and any GitHub Step Summary payload inside onTestRunEnd, after the run finishes; only the stream console mode's live view paints anything before the run ends."
bounds: ../modules/reporter.md
tags: [architecture, observability]
generated:
  by: okfit/claude-code
  at: 2026-10-03T18:02:06Z
  body_sha256: 370222cbfca64ad86e13ad924a5e75a1f0b29c5c1de16bed6440acf4b713f2c6
sources:
  - id: plugin-reporter
    resource: ../../packages/plugin/src/reporter.ts
  - id: default-reporter
    resource: ../../packages/reporter/src/defaultReporter.ts
---

# Only stream mode renders progressively; every other console mode paints once at run end

`AgentReporter.onTestRunEnd` is where the plugin builds the render
program — the `ReporterRenderInput` handed to a `VitestAgentReporterFactory`'s
`render(input, kit)` call — and where `RenderedOutput[]` gets routed to
stdout, a GitHub Step Summary file, or a report file.[^plugin-reporter]
`DefaultVitestAgentReporter.render` only produces stdout content when
`consoleMode === "agent"`, and only appends a GFM summary when
`kit.config.githubActions` is true — both of those checks run inside the
same end-of-run `render` call, not during the run.[^default-reporter]

**Condition.** Any console mode other than `stream` — `agent`,
`passthrough`, `silent`, `ci-annotations`.

**Symptom.** For a long-running suite, nothing produced by this family
appears until the process is about to exit: the agent-flavored final
string and the GitHub Actions Step Summary write both happen inside
`onTestRunEnd`, after every test module has already finished. A consumer
watching stdout or the Step Summary during the run sees nothing from
`vitest-agent` — only Vitest's own native reporters (in `passthrough`)
produce interim output, and in `agent` or `ci-annotations` those are
stripped, so there is no interim signal at all until the single
end-of-run write.

`consoleMode: "stream"` is the one exception: `DefaultVitestAgentReporter`
subscribes a live view (the kit's `CliUi.live`) to the kit's run-event
`PubSub` channel at run start, and that view paints as each event
arrives — `render()` itself emits nothing in `stream` mode, because the
view already painted the run (or, when the run is not interactive,
prints the plain `renderAgent` report once per run through the live
view's `final` option).[^default-reporter]

**Why this is acceptable.** The other console modes are optimized for a
single final artifact (an agent-consumed markdown block, a CI summary, or
Vitest's own passthrough text), not for progressive UX; building
incremental output for each would mean maintaining N rendering paths
instead of one. `stream` is the mode that exists specifically for a human
watching a terminal, and it already renders progressively.

**What a fix would take.** Give `agent` and `ci-annotations` their own
incremental accumulation over the run-event channel (mirroring the
`stream` live view's reduce-and-repaint loop) instead of a single terminal
build inside `render()`. That means threading partial-state rendering
through `DefaultVitestAgentReporter`'s non-`stream` branches and deciding
how a partial markdown block or partial Step Summary write should look —
work nobody has scoped.

[^plugin-reporter]: `../../packages/plugin/src/reporter.ts:1448`
[^default-reporter]: `../../packages/reporter/src/defaultReporter.ts:436-439,441-458`
