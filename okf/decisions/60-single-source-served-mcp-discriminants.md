---
type: Decision
status: stable
title: Single-Source Served MCP Discriminants
description: Why each consolidated MCP tool's action/kind literal tuple lives next to its Effect Schema union instead of a hand-synced projection, and how a compile-time assertion and a runtime test pin them together.
tags: [architecture, mcp]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 1d2e20f0cd44414827cc8d5f026555a421e6e0c47a4a5fc3204b3df7e6baedc1
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Single-Source Served MCP Discriminants

## Context

When every tool input was declared twice — an Effect `Schema.Union` in `tools/<name>.ts` plus a hand-synced projection of its discriminant literals in the server registration layer — a forgotten literal shipped silently: the `test` tool's served enum listed `list`/`get`/`for_file` while the union also handled `for_tag`, and `inventory`'s served `kind` omitted `tag`. Router-level tests exercised both variants happily; a real MCP client got a rejection. The earlier form of this projection was a hand-written zod enum kept in step with the Effect union by hand; that coupling is what produced the drift, and the zod-enum approach itself is retired now that the MCP server has no zod dependency at all.

## Decision

The discriminant tuple lives with the union. Each consolidated tool core exports its literal tuple immediately after its `Schema.Union` — `TEST_ACTIONS` (`packages/mcp/src/tools/test.ts`), `INVENTORY_KINDS` (`packages/mcp/src/tools/inventory.ts`), `NOTE_ACTIONS` (`packages/mcp/src/tools/note.ts`), `HYPOTHESIS_ACTIONS` (`packages/mcp/src/tools/hypothesis.ts`), `TDD_TASK_ACTIONS` (`packages/mcp/src/tools/tdd-task.ts`), `TDD_GOAL_ACTIONS` (`packages/mcp/src/tools/tdd-goal.ts`), and `TDD_BEHAVIOR_ACTIONS` (`packages/mcp/src/tools/tdd-behavior.ts`) — and a two-way conditional-type assertion (`Action extends Tuple[number]` and `Tuple[number] extends Action`, e.g. `packages/mcp/src/tools/test.ts`) pins the tuple to the union's `action`/`kind` type at compile time.

The served enum is no longer a projection anyone writes by hand: `@effected/mcp`'s `McpToolkit.unionTool` generates the union's strict JSON Schema and reshapes it into the served `oneOf` plus `x-discriminator` ([Decision 73](73-adoption-helpers-live-in-the-kit.md)), so the Effect `Schema.Union` is the single source on both sides of the wire.

## Alternatives rejected

Keeping a hand-synced zod `inputSchema` alongside the Effect union — the retired predecessor — required a human to notice every time a variant was added to the union and update the projection identically; the #335 drift is exactly the failure mode of relying on that discipline. Generating the served schema from the union but dropping the exported tuple was also considered and rejected: without a named tuple, `served-enum-drift.test.ts` (`packages/mcp/__test__/served-enum-drift.test.ts`) would have nothing concrete to assert the served `oneOf` members against, and the compile-time assertion would have no left-hand side to check.

## Consequences

The tuple costs six lines per tool but is what the compile-time assertion and `served-enum-drift.test.ts` both anchor on: the runtime test fails the build at exactly the moment a variant is added to the union without extending its tuple, which is the failure mode that actually occurred. The tuple is exported from the tool core rather than declared in `toolkit.ts` because the union is the authority on what the handler handles; putting the tuple next to it keeps the assertion in the same file as the thing it asserts about, so a reviewer editing a tool's input type sees the paired tuple three lines below it. Adding a new tool variant now requires touching exactly one file's union and tuple together, with both the compiler and the drift test catching an omission on either side.
