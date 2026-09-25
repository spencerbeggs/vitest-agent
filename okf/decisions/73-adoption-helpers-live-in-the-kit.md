---
type: Decision
status: draft
title: Adoption Helpers Live in the Kit
description: "The union-tool, refusal, crash-guard, CLI help-routing, version-token and packed-install helpers vitest-agent hand-rolled while adopting the effected kit now come from @effected/mcp 0.2.0, @effected/cli 0.9.0 and @effected/workspaces 0.27.0; the front ends deliberately keep their own bins, so the packed-install e2e opts into allowSharedBins."
tags:
  - architecture
  - mcp
  - deps
  - testing
generated:
  by: okfit/claude-code
  at: 2026-09-25T23:18:00Z
  body_sha256: f89a45f053758c1df2c61593474a0b525cc8064254d1b35fc8082697821f76d3
sources:
  - id: mcp-toolkit-ts
    resource: ../../packages/mcp/src/toolkit.ts
  - id: mcp-main-ts
    resource: ../../packages/mcp/src/main.ts
  - id: union-tools-wire-test
    resource: ../../packages/mcp/__test__/union-tools-wire.test.ts
  - id: bin-crash-resilience-e2e
    resource: ../../packages/mcp/__test__/bin-crash-resilience.e2e.test.ts
  - id: cli-main-ts
    resource: ../../packages/cli/src/main.ts
  - id: help-surface-e2e
    resource: ../../packages/cli/__test__/bin/help-surface.e2e.test.ts
  - id: mcp-boundaries-test
    resource: ../../packages/mcp/__test__/boundaries.test.ts
  - id: packed-install-e2e
    resource: ../../packages/plugin/__test__/bins-packed-install.e2e.test.ts
  - id: start-mcp-sh
    resource: ../../plugins/claude-code/bin/start-mcp.sh
  - id: owner-shared-bins
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-09-25T00:00:00Z
---

# Adoption Helpers Live in the Kit

## Context

[Decision 72](72-adopt-the-effected-front-end-kit.md) moved every front
end onto the `@effected` kit, but the adoption left vitest-agent carrying
its own helpers for gaps the kit did not yet cover: `strictUnionTool`,
`decodeStrictUnion` and `objectRootedUnion` for the seven action-keyed
MCP tools, a local `ToolRefusal`, hand-written crash guards with a
connected flag, a tag-sniffing CLI failure renderer, hand-kept scans for
the build-time version token, and a packed-install e2e that sized its
own timeout. A dogfood loop with effected upstreamed each of these, and
they shipped in `@effected/mcp` 0.2.0, `@effected/cli` 0.9.0 and
`@effected/workspaces` 0.27.0.

## Decision

Delete the local helpers and use the kit's.

- **Union tools.** The seven action-keyed tools are built with
  `McpToolkit.unionTool` and their handlers wrapped in
  `McpToolkit.unionHandler`[^mcp-toolkit-ts]; success unions use
  `ToolOutputSchema.objectRooted`; refusals use the kit's `ToolRefusal`
  and `ToolRefusal.refuse`. The served input schemas stay byte-identical,
  pinned against the pre-kit pipeline[^union-tools-wire-test].
- **Crash guards.** `main.ts` is `McpGuard.run` from `@effected/mcp/guard`
  with policy `{ onUncaught: "exitBeforeConnect", onRejection: "log" }`,
  the policy [Decision 51](51-the-mcp-server-survives-post-connect-crashes.md)
  chose; the test-only crash injection maps to the guard's
  `injectCrash`[^mcp-main-ts], and the pre-connect exit is now proven
  against the built bin[^bin-crash-resilience-e2e].
- **CLI.** `CliRuntime` renders a failure by the kit's `details.isDefect`,
  and `helpOnUsageError: "stderr"` sends help plus the parse errors to
  stderr on a usage error, leaving stdout empty with exit 64; an explicit
  `--help` stays on stdout[^cli-main-ts][^help-surface-e2e].
- **Version token.** Each `boundaries.test.ts` confines
  `process.env.__PACKAGE_VERSION__` with a `forbidTokens` rule waived only
  for `version.ts`[^mcp-boundaries-test].
- **Packed install.** `PackedInstall.closure` and `timeoutBudget` share
  one options object with `PackedInstall.run`, with `workspaceOverrides:
  true`, and the carrier's own bins are run under every manager through
  `runCarrierBin` / `carrierCommand`[^packed-install-e2e].
- **Shared bins, deliberately.** `@vitest-agent/cli` and
  `@vitest-agent/mcp` keep their own `vitest-agent` / `vitest-agent-mcp`
  bins, so the packed-install run passes `allowSharedBins: true`. This is
  a permanent choice, not a stopgap[^owner-shared-bins]. Under npm and bun
  a front end can win the `.bin` slot by name sort; the program is the
  same, but provenance is lost there, with no `via @vitest-agent/plugin`
  suffix on `--version` and `distribution: null` from `ping`. Effected's
  own guidance is that carrier-only bins are recommended and required
  only when provenance must hold; vitest-agent does not need it to hold.

## Alternatives rejected

**Keep the local helpers.** They worked, but they were a private copy
of behaviour the kit now maintains and tests against its own fixtures,
and every kit bump would have needed a manual comparison.

**Carrier-only bins** (drop the front ends' `bin` fields so only the
carrier declares them, and run without `allowSharedBins`). Rejected
because it breaks direct front-end use: `npx @vitest-agent/mcp` and a
bare `@vitest-agent/cli` install would have no bin to run. The Claude
Code plugin's loader falls back to `npx --yes @vitest-agent/mcp@5` when a
project has no local bin[^start-mcp-sh]; without the front end's bin
that fallback would have to download the whole carrier — plugin,
reporter, UI and all — to start the MCP server.

## Consequences

- `tools/_union-schema.ts`, `tools/_tool-refusal.ts` and
  `utils/crash-guards.ts` no longer exist in `@vitest-agent/mcp`; the
  union-tool, refusal and guard behaviour moves with `catalog:effected`.
- On `2025-06-18`, invalid params to a union tool now answer JSON-RPC
  `-32602`, the same as every other tool; this reverses the
  union-tool `isError` consequence Decision 72 records.
- `VITEST_AGENT_MCP_TEST_INJECT_CRASH` takes `<at>:<kind>` (`at` is
  `load` or `connected`; a bare `<kind>` means `connected`), and the
  injected stderr message is prefixed `[injected]`.
- A hook that pipes `vitest-agent agent …` stdout into `jq` sees empty
  stdout on a usage error instead of help text.
- Under npm and bun, `vitest-agent --version` may lack the carrier
  suffix. The packed-install e2e accepts exactly that outcome and still
  proves the carrier's own shim under every manager.

## Related

- [Decision 72: Adopt the Effected Front-End Kit](72-adopt-the-effected-front-end-kit.md)
- [Decision 70: Carrier Pattern and Ranked Layering](70-carrier-pattern-and-ranked-layering.md)
- [Decision 71: Effect-Native MCP Server](71-effect-native-mcp-server.md)
- [Decision 51: The MCP Server Survives Post-Connect Crashes](51-the-mcp-server-survives-post-connect-crashes.md)
- [Decision 50: Strict MCP Tool Inputs](50-strict-mcp-tool-inputs.md)
- [Invariant: Strict Tool Inputs](../invariants/strict-tool-inputs.md)
- [`@vitest-agent/mcp`](../modules/mcp.md)

[^mcp-toolkit-ts]: `../../packages/mcp/src/toolkit.ts`
[^mcp-main-ts]: `../../packages/mcp/src/main.ts`
[^union-tools-wire-test]: `../../packages/mcp/__test__/union-tools-wire.test.ts`
[^bin-crash-resilience-e2e]: `../../packages/mcp/__test__/bin-crash-resilience.e2e.test.ts`
[^cli-main-ts]: `../../packages/cli/src/main.ts`
[^help-surface-e2e]: `../../packages/cli/__test__/bin/help-surface.e2e.test.ts`
[^mcp-boundaries-test]: `../../packages/mcp/__test__/boundaries.test.ts`
[^packed-install-e2e]: `../../packages/plugin/__test__/bins-packed-install.e2e.test.ts`
[^start-mcp-sh]: `../../plugins/claude-code/bin/start-mcp.sh`
[^owner-shared-bins]: conversation with the repository owner
