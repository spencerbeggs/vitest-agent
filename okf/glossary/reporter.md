---
type: Glossary
title: "Reporter"
description: >-
  Three unrelated senses of "reporter" collide in this codebase: the pre-2.0
  whole system, Vitest's own reporter-class API, and this repository's
  rendering-only `@vitest-agent/reporter` package.
tags: [dx, architecture]
generated:
  by: okfit/claude-code
  at: 2026-10-01T13:07:49Z
  body_sha256: d4acd7c90bbdf5e9f5bdfafc029bb711432bcaa11da96e5adc83c537f4dfeb27
sources:
  - id: agent-reporter-class
    resource: ../../packages/plugin/src/reporter.ts
  - id: reporter-factory-contract
    resource: ../../packages/sdk/src/contracts/reporter.ts
  - id: default-reporter
    resource: ../../packages/reporter/src/defaultReporter.ts
  - id: reporter-package-manifest
    resource: ../../packages/reporter/package.json
  - id: vitest-reporter-api
    resource: https://vitest.dev/api/advanced/reporters.html
---

# Reporter

"Reporter" names three different things in this repository, and prose that
does not say which one is easy to misread.

## 1. The pre-2.0 whole system

Before the #412 package split, the entire family shipped as one npm package
named `vitest-agent-reporter`. Any surviving prose that talks about "the
reporter" doing persistence, coverage analysis, or CLI/MCP work in that
whole-system sense is talking about what is now `@vitest-agent/plugin`
[Module plugin](../modules/plugin.md) — the plugin owns the Vitest lifecycle
hooks, persistence, and classification today. Text from that era describing
services, layers, or migrations living in the SDK describes what is now
`@vitest-agent/engine` instead.

## 2. Vitest's own reporter API

Vitest defines a reporter as a class (or object) matching its own
lifecycle-hook interface — `onInit`, `onTestRunEnd`, `onUserConsoleLog`, and
so on[^vitest-reporter-api]. This repository's internal `AgentReporter` class
is one such object: it wires every Vitest reporter hook and publishes a
`RunEvent` per callback, but it is not exported and is constructed only by
`AgentPlugin` (`packages/plugin/src/reporter.ts:540`). Vitest's own built-in
console reporters (`default`, `verbose`, `tree`, `dot`, `tap`, `agent`/
`minimal`, …) are a distinct, unrelated set that `strip-console-reporters.ts`
suppresses whenever the plugin takes over stdout
(`packages/plugin/src/utils/strip-console-reporters.ts:15`).

## 3. `@vitest-agent/reporter`, the rendering-only package

Post-split, `@vitest-agent/reporter` (`packages/reporter/package.json:2`)
owns only rendering: it ships `DefaultVitestAgentReporter`, a
`VitestAgentReporterFactory` implementation
(`packages/reporter/src/defaultReporter.ts:436`), and the `stream` live
view's lifetime (drawn by the kit's `CliUi.live`). It has no Vitest
lifecycle hooks of its own — `AgentReporter` (sense 2, inside the plugin)
is what feeds it a `RunEvent` stream, calls its `.render(input, kit)`
method, and calls its optional `.close()` at Vitest's close.

## The trap

`VitestAgentReporterFactory` (`packages/sdk/src/contracts/reporter.ts:203`)
is this repository's own reporter *contract* — a factory
`(kit: ReporterKit) => VitestAgentReporter | ReadonlyArray<VitestAgentReporter>`
that a custom reporter package implements and passes to `AgentPlugin({
reporter })`. It has nothing to do with Vitest's `Reporter` interface (sense
2) beyond the shared English word: implementing `VitestAgentReporterFactory`
never registers a Vitest-native reporter, and a class matching Vitest's
`Reporter` shape never satisfies this contract. Confusing the two leads to
wiring a custom reporter through the wrong option entirely.

See [Module reporter](../modules/reporter.md),
[Module plugin](../modules/plugin.md),
[Interface reporter-contract](../interfaces/reporter-contract.md), and
[Decision 34](../decisions/34-plugin-reporter-split.md).

[^vitest-reporter-api]: <https://vitest.dev/api/advanced/reporters.html>
