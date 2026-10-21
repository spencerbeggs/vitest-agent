---
type: Limitation
title: The reporter builds a fresh Effect layer on every onTestRunEnd call
description: "AgentReporter.onTestRunEnd calls Effect.runPromise with ReporterLive({ dbPath, env, logLevel, logFile }) constructed inline rather than reusing a ManagedRuntime, so every test run pays the SQLite client and service-graph construction cost from scratch."
bounds: ../modules/reporter.md
tags: [architecture, performance]
generated:
  by: okfit/claude-code
  at: 2026-10-21T16:41:41Z
sources:
  - id: reporter-layer
    resource: ../../packages/plugin/src/reporter.ts
integrity:
  generated:
    body: 8b1c640df496a2aa
---

# The reporter builds a fresh Effect layer on every onTestRunEnd call

`AgentReporter.onTestRunEnd`'s persist program runs via
`Effect.runPromise(persistProgram.pipe(Effect.provide(ReporterLive({
dbPath, env: process.env, logLevel, logFile }))))`, constructing
`ReporterLive` — the SQLite client, migrator, and every downstream
service it composes — inline, once per call.[^reporter-layer] Nothing
caches or reuses that layer across `onTestRunEnd` invocations, and there
is no `ManagedRuntime` holding it open between runs.

**Condition.** Every `vitest run` invocation with the plugin's Full mode
active (persistence enabled), and every reporter instance in a
multi-project config.

**Symptom.** Each `onTestRunEnd` call opens a SQLite connection, runs
`ensureMigrated`, and rebuilds the full `CoverageAnalyzerLive` service
graph before it can write a single row — work that a long-lived runtime
would only pay once. In a multi-project config this multiplies by the
number of `AgentReporter` instances (one per project), though
`ensureMigrated`'s `globalThis` promise cache still serializes the
migration step itself across those instances.

**Why this is acceptable.** `onTestRunEnd` fires at most a handful of
times per `vitest run` process — the layer construction cost (an SQLite
connection plus a handful of `Layer.succeed`/`Layer.effect` compositions)
is negligible next to the test run itself, which is measured in seconds.
Holding a `ManagedRuntime` open instead would add lifecycle concerns —
disposal on process exit, watch-mode rerun handling, leaked file handles
on an unclean shutdown — that this package has no mechanism for today;
only the MCP server, which is a genuinely long-lived process, uses
`ManagedRuntime`.

**What a fix would take.** Promoting the reporter to a `ManagedRuntime`
held for the lifetime of the Vitest process (constructed once in
`onInit`, disposed on process exit or watch-mode teardown) — the same
shape the MCP server already uses — plus deciding how a watch-mode
rerun's `onTestRunStart` should interact with an already-open runtime
rather than a fresh one per run.

[^reporter-layer]: `../../packages/plugin/src/reporter.ts:2648-2652`
