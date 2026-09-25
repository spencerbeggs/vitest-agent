---
type: Decision
status: draft
title: Adopt the Effected Front-End Kit
description: "Moves the CLI, the MCP server, the workspace-layering check, the source-boundary scans and the packed-install e2e off hand-rolled local ports and onto @effected/cli, @effected/mcp, @effected/engine and @effected/workspaces/testing; the seven action-keyed MCP tools register as Tool.dynamic with raw object-rooted schemas."
tags:
  - architecture
  - mcp
  - effect
  - deps
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: 810d77cca291a4fdde544c3cf7a7229456628283b36d5b01d7891426d88fc6ff
sources:
  - id: mcp-server-ts
    resource: ../../packages/mcp/src/server.ts
  - id: mcp-toolkit-ts
    resource: ../../packages/mcp/src/toolkit.ts
  - id: mcp-union-schema-ts
    resource: ../../packages/mcp/src/tools/_union-schema.ts
  - id: mcp-tool-refusal-ts
    resource: ../../packages/mcp/src/tools/_tool-refusal.ts
  - id: mcp-server-protocols-test
    resource: ../../packages/mcp/__test__/server-protocols.test.ts
  - id: cli-main-ts
    resource: ../../packages/cli/src/main.ts
  - id: cli-version-formatter
    resource: ../../packages/cli/src/lib/version-formatter.ts
  - id: engine-project-dir
    resource: ../../packages/engine/src/project-dir.ts
  - id: layers-json
    resource: ../../layers.json
  - id: workspace-layering-test
    resource: ../../packages/plugin/__test__/workspace-layering.test.ts
  - id: packed-install-e2e
    resource: ../../packages/plugin/__test__/bins-packed-install.e2e.test.ts
---

# Adopt the Effected Front-End Kit

## Context

[Decision 71](71-effect-native-mcp-server.md) put the MCP server on
Effect's own `McpServer`, but only through a local strict registrar: a
line-for-line port of rc.116's `McpServer.registerToolkit` with six
enumerated deviations that had to be re-checked on every
release-candidate bump. The CLI carried its own failure rendering and
exit-code mapping over `Command.run`, the rank rule of [Decision
70](70-carrier-pattern-and-ranked-layering.md) was a hand-maintained
`LAYER_RANKS` table plus a topological sort in the plugin's test tree,
four `boundaries.test.ts` suites shared a copied comment-stripping
scanner, and the packed-install e2e hand-built its pack, install and
JSON-RPC probe. The same concerns — strict tool registration, stdio
launch and teardown, CLI exit codes and colour, a launching carrier's
identity, layer policy, source boundaries, packed installs — are now
shipped by the `@effected` kit, and Effect-TS/effect#8326 (rc.117) made
an object-rooted `outputSchema` expressible upstream.

## Decision

Every front end and every repo-level guardrail runs on the kit, with
`.repos/effect` pinned to rc.117.

- **MCP.** `ServerLayer` is `McpToolkit.layer(Kit)` (strict by default:
  every unknown key named with the accepted params in one
  `InvalidParams`) plus the prompts, provided by
  `McpStdio.layer`[^mcp-server-ts]; `main.ts` launches through
  `McpStdio.launch` / `McpStdio.teardown`. The local registrar and the
  `UnexpectedToolError` envelope are gone: an undeclared failure or
  defect reaches the agent as core's scrubbed "Tool execution failed due
  to an internal server error." text, logged on stderr. A failure the
  agent can act on is either an `ok: false` / `kind: "error"` success
  member or a declared `ToolRefusal` whose message folds in an
  `@effected/engine` `Remediation`[^mcp-tool-refusal-ts]. The remediation
  shape is `{ hint, suggestedTool?, suggestedArgs? }` everywhere.
- **Union tools are `Tool.dynamic`.** The seven action-keyed tools
  (`inventory`, `test`, `note`, `hypothesis`, `tdd_task`, `tdd_goal`,
  `tdd_behavior`) register through `strictUnionTool`: a raw input schema
  that is Effect's strict document for the union, made object-rooted by
  `ToolInputSchema.objectRooted` (`oneOf` plus `x-discriminator`), with
  the union decoded inside the handler by `decodeStrictUnion`, which
  runs the kit's `unknownKeys` walk first[^mcp-union-schema-ts]. Every
  success union is wrapped in `objectRootedUnion`, so every tool serves
  an `outputSchema` (issue 489).
- **CLI.** `main.ts` runs `Command.run` through `CliRuntime.main` with
  the platform layer inside failure reporting and `CliColor`'s
  formatter[^cli-main-ts]. `--version` reads `CurrentDistribution`, set by
  the carrier's bin shim, and appends `via @vitest-agent/plugin
  <version>`[^cli-version-formatter].
- **Engine.** `resolveProjectDir` delegates to
  `LaunchContext.projectDir`, which trims values and treats blank or
  unsubstituted `${...}` values as unset[^engine-project-dir].
- **Repo checks.** The committed root `layers.json` is the layer
  policy[^layers-json], checked by `WorkspaceLayering`[^workspace-layering-test];
  the boundary suites run `SourceBoundary.scan`; the packed-install e2e
  runs `PackedInstall.run` and `McpProbe.initialize`[^packed-install-e2e].

## Alternatives rejected

**Keep the hand-rolled port.** It worked and its deviations were
tested, but every rc bump needed a diff against `McpServer.ts`, and
the CLI, layering, boundary and packed-install code duplicated what
the kit now maintains and tests against its own fixtures. Keeping it
would have meant maintaining a private fork of upstream behaviour for
no behaviour the kit lacks.

**Reshape the union tools as flat structs.** A flat `Tool.make` struct
with every action's fields optional would register on the kit with no
special route. But it serves a schema that cannot say which fields
belong to which action, so a key from a sibling branch would be
accepted and ignored — the silent-widening class [Decision
50](50-strict-mcp-tool-inputs.md) forbids — and it would change every
served input schema, a breaking change for agents with no gain.
`Tool.dynamic` keeps the served input schemas byte-identical, because
core rejects a union `parameters` schema at registration and never
re-decodes a dynamic tool.

## Consequences

- `@vitest-agent/mcp` ships as a major: `registerStrictToolkit` is no
  longer exported, internal failures carry no `structuredContent`, and
  `humanHint` is renamed `hint`.
- On `2025-06-18`, invalid params to a `Tool.make` tool are still a
  JSON-RPC `-32602`, but a union tool returns an `isError` result,
  because `InvalidParams` is its declared failure[^mcp-server-protocols-test].
- `run_tests` returns refused arguments as `{ kind: "error" }` instead
  of throwing.
- `ping` returns `distribution`: the carrier that launched the bin, or
  `null`.
- CLI usage and parse errors exit `64` instead of `1`. A platform build
  failure prints one line on stderr and exits `1`.
- The layer policy checks runtime fields only (`dependencies`,
  `optionalDependencies`, `peerDependencies`). A separate assertion that
  the dependency graph has no cycles covers `devDependencies`.
- A new workspace package needs an entry in `layers.json`: a layer,
  `tooling`, or `unconstrained`.
- Kit bumps now arrive through the `catalog:effected` catalog. An
  upstream regression in `@effected/*` lands in every front end at once.

## Related

- [Decision 71: Effect-Native MCP Server](71-effect-native-mcp-server.md)
- [Decision 70: Carrier Pattern and Ranked Layering](70-carrier-pattern-and-ranked-layering.md)
- [Decision 50: Strict MCP Tool Inputs](50-strict-mcp-tool-inputs.md)
- [`@vitest-agent/mcp`](../modules/mcp.md)
- [`@vitest-agent/cli`](../modules/cli.md)
- [MCP Tool Surface](../interfaces/mcp-tools.md)
- [Invariant: Ranked Layering](../invariants/ranked-layering.md)

[^mcp-server-ts]: `../../packages/mcp/src/server.ts`
[^mcp-tool-refusal-ts]: `../../packages/mcp/src/tools/_tool-refusal.ts`
[^mcp-union-schema-ts]: `../../packages/mcp/src/tools/_union-schema.ts`
[^cli-main-ts]: `../../packages/cli/src/main.ts`
[^cli-version-formatter]: `../../packages/cli/src/lib/version-formatter.ts`
[^engine-project-dir]: `../../packages/engine/src/project-dir.ts`
[^layers-json]: `../../layers.json`
[^workspace-layering-test]: `../../packages/plugin/__test__/workspace-layering.test.ts`
[^packed-install-e2e]: `../../packages/plugin/__test__/bins-packed-install.e2e.test.ts`
[^mcp-server-protocols-test]: `../../packages/mcp/__test__/server-protocols.test.ts`
