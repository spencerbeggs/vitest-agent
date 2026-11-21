---
type: Convention
title: Re-check the ported Vitest performance-hint helpers on every Vitest bump
description: "The plugin carries a verbatim port of Vitest's unexported performance-hint helpers (taken from 5.0.5, unchanged through 5.1.1) because it strips Vitest's BaseReporter; on every Vitest bump, diff the port against upstream and replace it with a public export once one exists."
tags: [compat, observability, deps]
status: draft
stale_after: 2027-04-26T00:00:00Z
sources:
  - id: vitest-diagnostics-port
    resource: ../../packages/plugin/src/utils/vitest-diagnostics.ts
  - id: collect-performance-hints
    resource: ../../packages/plugin/src/utils/collect-performance-hints.ts
  - id: upstream-diagnostics
    resource: https://github.com/vitest-dev/vitest/blob/v5.1.1/packages/vitest/src/node/reporters/diagnostics.ts
generated:
  by: okfit/claude-code
  at: 2026-11-21T02:20:33Z
integrity:
  generated:
    body: 772629838a4b7f99
---

# Re-check the ported Vitest performance-hint helpers on every Vitest bump

When Vitest is bumped, diff the plugin's ported performance-hint code
against the upstream source and carry any change over. Vitest prints its
performance hints (environment setup, slow imports, slow transforms, the
isolate suggestion) from `BaseReporter`, which `AgentPlugin` strips when it
owns stdout, and the helpers that compute them are not exported. The plugin
therefore ports them so the hints still reach `run.json`, the MCP
`run_tests` payload, and the console in `agent` and `stream` modes; see
[Module: @vitest-agent/plugin](../modules/plugin.md).

What is ported, and from where:

- `packages/plugin/src/utils/vitest-diagnostics.ts` copies the helpers from
  Vitest 5.0.5's `reporters/diagnostics.ts` (names, thresholds, arithmetic
  kept verbatim), the isolate computation extracted from
  `BaseReporter.reportIsolateDiagnostic`, and `formatTime`.[^vitest-diagnostics-port]
  Upstream `diagnostics.ts` is byte-identical at v5.1.1 (the same blob as
  v5.0.5 in the vendored `.repos/vitest`), so the port still matches the
  floor the family requires.[^upstream-diagnostics]
- `packages/plugin/src/utils/collect-performance-hints.ts` mirrors the input
  gathering, gating, and wording of `BaseReporter`'s `onFinished` and its
  four `report*Diagnostic` methods, minus ANSI and project labels.[^collect-performance-hints]

The re-check is manual: nothing fails when upstream changes a threshold or
a message. Diff `reporters/diagnostics.ts` between the two tags in
`.repos/vitest` for the helpers, and read the `BaseReporter` diff (`base.ts`)
for the gathering and wording `collect-performance-hints.ts` mirrors.
Between v5.0.5 and v5.1.1 that file changed only in its summary and failure
rendering (the `--last-failed` summary, grouped errors, a trace timeline);
the four `report*Diagnostic` methods and their call site were untouched. Replace the port with Vitest's own export the moment one exists.

[^vitest-diagnostics-port]: `../../packages/plugin/src/utils/vitest-diagnostics.ts`
[^collect-performance-hints]: `../../packages/plugin/src/utils/collect-performance-hints.ts`
[^upstream-diagnostics]: <https://github.com/vitest-dev/vitest/blob/v5.1.1/packages/vitest/src/node/reporters/diagnostics.ts>
