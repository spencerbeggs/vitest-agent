---
type: Runbook
title: Add an MCP tool
description: How to add a new tool to the vitest-agent-mcp server's Effect-native toolkit, from the Tool.make value through the strict-input test and the help listing.
resource: ../../packages/mcp/src/toolkit.ts
tags: [mcp, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-25T23:18:00Z
  body_sha256: 01d18db34db150ea02345ca98aa54de4c65ce44585694a42dce39791e2469db1
sources:
  - id: toolkit
    resource: ../../packages/mcp/src/toolkit.ts
  - id: ping-tool
    resource: ../../packages/mcp/src/tools/ping.ts
  - id: server
    resource: ../../packages/mcp/src/server.ts
  - id: tdd-goal-tool
    resource: ../../packages/mcp/src/tools/tdd-goal.ts
  - id: tdd-task-tool
    resource: ../../packages/mcp/src/tools/tdd-task.ts
  - id: idempotency
    resource: ../../packages/mcp/src/idempotency.ts
  - id: harness
    resource: ../../packages/mcp/__test__/utils/harness.ts
  - id: served-schema-strict-test
    resource: ../../packages/mcp/__test__/served-schema-strict.test.ts
  - id: served-enum-drift-test
    resource: ../../packages/mcp/__test__/served-enum-drift.test.ts
  - id: help-tool
    resource: ../../packages/mcp/src/tools/help.ts
  - id: allowlist
    resource: ../../plugins/claude-code/hooks/lib/safe-mcp-vitest-agent-ops.txt
---

# Add an MCP tool

## Trigger

A new capability needs to be exposed to an LLM agent over the
`vitest-agent-mcp` server's stdio transport, and no existing action-keyed
tool's discriminant covers it.

## Steps

1. **Create `packages/mcp/src/tools/<name>.ts`.** Define the parameters
   and success payload as Effect `Schema` values (a `Schema.Struct`
   annotated with `identifier`, `title`, and `description`), then build the
   tool with `Tool.make("<name>", { description, parameters, success,
   dependencies })`. Annotate `Tool.Title`, `Tool.Readonly`,
   `Tool.Destructive`, `Tool.OpenWorld`, and `Tool.Idempotent` — `ping.ts`
   is the minimal worked example (no parameters, a
   `Schema.Literal("pong")` success payload, all five
   annotations).[^ping-tool] Export the `handle<Name>` Effect alongside
   the tool value. A success union must be wrapped in
   `ToolOutputSchema.objectRooted(Schema.Union([...]))` (`@effected/mcp`)
   before `.annotate({ identifier })` so its `outputSchema` is served. A
   failure the agent can fix belongs in the success shape (`ok: false` /
   `kind: "error"`) or in `@effected/mcp`'s `ToolRefusal` — declared as the
   tool's `failure` and raised with `ToolRefusal.refuse(reason,
   remediation)` — never a defect: a defect reaches the agent only as a
   generic internal-error message. `tdd-task.ts` is the worked
   example.[^tdd-task-tool]
2. **If the tool is action-keyed** (a CRUD family collapsing into one
   tool, the pattern `tdd_task`, `tdd_goal`, `tdd_behavior`, `note`,
   `hypothesis`, `inventory`, and `test` already follow), export the
   discriminant tuple from the tool's core module (for example
   `TDD_TASK_ACTIONS`) and dispatch on it with
   `Match.discriminatorsExhaustive` inside the handler, so a served enum
   and the handler's branch coverage cannot drift from each other. A
   union `parameters` schema cannot be a `Tool.make`: build the tool with
   `McpToolkit.unionTool("<name>", { description, parameters, success,
   failure })` (declare services with `.addDependency`) and wrap its
   handler in `McpToolkit.unionHandler(tool, handler)` in `toolHandlers`;
   `tdd-goal.ts` is the worked example.[^tdd-goal-tool]
3. **Add the tool to `Kit` and its handler to `toolHandlers` in
   `toolkit.ts`.** `Kit = Toolkit.make(...)` is the single source of truth
   for the served tool list; `toolHandlers` is checked with `satisfies
   Toolkit.HandlersFrom<typeof Kit.tools>`, so a tool present in one but
   missing from the other is a compile error, not a runtime
   surprise.[^toolkit] `ServerLayer` registers `Kit` through
   `@effected/mcp`'s `McpToolkit.layer`, never `McpServer.toolkit`
   directly — that is what serves `additionalProperties: false` at every
   object level and rejects an unknown key instead of silently widening
   the query.[^server]
4. **Wrap a write handler that must tolerate a client retry in
   `withIdempotency("<name>", handler)`** and register its key spec in
   `idempotency.ts` — the currently registered paths are `hypothesis`
   (validate), `tdd_task` (start/end), `tdd_goal` (create), and
   `tdd_behavior` (create).[^idempotency] Read-only and purely
   informational tools skip this step.
5. **Write a harness test.** `__test__/utils/harness.ts` wraps
   `@effected/mcp/testing`'s `McpHarness` around the real `ServerLayer`
   over `Stdio.layerTest` queues — no child process — so a
   test sees the exact served JSON Schema and wire results a real client
   would.[^harness] Use `initialize`, `listTools`, and `callTool` to
   assert the tool is served, that a valid call succeeds, and that a call
   carrying an unrecognized key is rejected.
6. **Extend `served-schema-strict.test.ts`'s tool-count and case
   list.** The suite asserts the server lists an exact, pinned number of
   tools by name and walks every served `inputSchema` for
   `additionalProperties: false` at every object node — adding a tool
   without updating this list's expected name/count array fails the
   pinned-count assertion.[^served-schema-strict-test] If the tool is
   action-keyed, also extend `served-enum-drift.test.ts`, which asserts
   the served `oneOf` discriminant members match the tool core's exported
   action tuple.[^served-enum-drift-test]
7. **Update `tools/help.ts`.** The `help` tool's markdown table is the
   client-facing tool index; add a row (and, for an action-keyed tool, the
   per-action parameter shapes) so `help` stays a complete
   listing.[^help-tool]
8. **Update the Claude Code plugin's tool allowlist**, only if the tool
   should auto-run without a permission prompt: add its name to
   `plugins/claude-code/hooks/lib/safe-mcp-vitest-agent-ops.txt`. Omit a
   destructive tool from this list so it always prompts.[^allowlist]

## Observable end state

`pnpm vitest run packages/mcp` passes, including the extended
`served-schema-strict.test.ts` (and `served-enum-drift.test.ts` for an
action-keyed tool); the new tool appears in the markdown reference the
`help` tool returns in `structuredContent.helpText`; and `packages/mcp/__test__/utils/harness.ts`'s `listTools` returns
it with a strict `inputSchema`.

## Related

- [Interface: mcp-tools](../interfaces/mcp-tools.md)
- [Invariant: strict-tool-inputs](../invariants/strict-tool-inputs.md)
- [Module: mcp](../modules/mcp.md)
- [Convention: test-patterns](../conventions/test-patterns.md)
- [Decision 60 — Single-Source Served MCP Discriminants](../decisions/60-single-source-served-mcp-discriminants.md)
- [Decision 73 — Adoption helpers live in the kit](../decisions/73-adoption-helpers-live-in-the-kit.md)

[^toolkit]: `../../packages/mcp/src/toolkit.ts`
[^ping-tool]: `../../packages/mcp/src/tools/ping.ts`
[^server]: `../../packages/mcp/src/server.ts`
[^tdd-goal-tool]: `../../packages/mcp/src/tools/tdd-goal.ts`
[^tdd-task-tool]: `../../packages/mcp/src/tools/tdd-task.ts`
[^idempotency]: `../../packages/mcp/src/idempotency.ts:37`
[^harness]: `../../packages/mcp/__test__/utils/harness.ts`
[^served-schema-strict-test]: `../../packages/mcp/__test__/served-schema-strict.test.ts:1-9,44-60`
[^served-enum-drift-test]: `../../packages/mcp/__test__/served-enum-drift.test.ts`
[^help-tool]: `../../packages/mcp/src/tools/help.ts`
[^allowlist]: `../../plugins/claude-code/hooks/lib/safe-mcp-vitest-agent-ops.txt`
