---
type: Convention
title: Re-check the ported Vitest performance-hint helpers on every Vitest bump
description: "The plugin carries a verbatim port of Vitest 5.0.5's unexported performance-hint helpers because it strips Vitest's BaseReporter; on every Vitest bump, diff the port against upstream and replace it with a public export once one exists."
tags: [compat, observability, deps]
status: draft
stale_after: 2027-04-26T00:00:00Z
sources:
  - id: vitest-diagnostics-port
    resource: ../../packages/plugin/src/utils/vitest-diagnostics.ts
  - id: collect-performance-hints
    resource: ../../packages/plugin/src/utils/collect-performance-hints.ts
generated:
  by: okfit/claude-code
  at: 2026-10-26T18:35:41Z
integrity:
  generated:
    body: 0f920d167baedffa
---

# Re-check the ported Vitest performance-hint helpers on every Vitest bump

When Vitest is bumped, diff the plugin's ported performance-hint code
against the upstream source and carry any change over. Vitest prints its
performance hints (environment setup, slow imports, slow transforms, the
isolate suggestion) from `BaseReporter`, which `AgentPlugin` strips when it
owns stdout, and the helpers that compute them are not exported. The plugin
therefore ports them so the hints still reach `run.json`, the MCP
`run_tests` payload, and the console where the plugin owns stdout; see
[Module: @vitest-agent/plugin](../modules/plugin.md).

What is ported, and from where:

- `packages/plugin/src/utils/vitest-diagnostics.ts` copies the helpers from
  Vitest 5.0.5's `reporters/diagnostics.ts` (names, thresholds, arithmetic
  kept verbatim), the isolate computation extracted from
  `BaseReporter.reportIsolateDiagnostic`, and `formatTime`.[^vitest-diagnostics-port]
- `packages/plugin/src/utils/collect-performance-hints.ts` mirrors the input
  gathering, gating, and wording of `BaseReporter`'s `onFinished` and its
  four `report*Diagnostic` methods, minus ANSI and project labels.[^collect-performance-hints]

The re-check is manual: nothing fails when upstream changes a threshold or
a message. Replace the port with Vitest's own export the moment one exists.

[^vitest-diagnostics-port]: `../../packages/plugin/src/utils/vitest-diagnostics.ts`
[^collect-performance-hints]: `../../packages/plugin/src/utils/collect-performance-hints.ts`
