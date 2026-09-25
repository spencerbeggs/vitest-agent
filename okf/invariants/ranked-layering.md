---
type: Invariant
title: Ranked layering — every workspace edge points strictly downward
description: "Every workspace package is classified in the root layers.json, every runtime dependency edge points to a strictly lower layer, packages in one layer (cli and mcp among them) never depend on each other, and the carrier is the only top-layer package — enforced by WorkspaceLayering, not by convention."
tags: [architecture]
resource: ../../packages/plugin/__test__/workspace-layering.test.ts
sources:
  - id: layering-test
    resource: ../../packages/plugin/__test__/workspace-layering.test.ts
  - id: layers-json
    resource: ../../layers.json
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: 1ce7e898f92a4097d94e04bbd81e24863b7bc023f848530e8d15a5c77f4e27d5
---

# Ranked layering — every workspace edge points strictly downward

## Property

Every workspace package is classified exactly once in the committed root
`layers.json`: in one of five layers, as `tooling`, or as
`unconstrained`[^layers-json]. Every runtime edge (`dependencies`,
`optionalDependencies`, `peerDependencies`) from a layered package must
point to a strictly lower layer. Packages in the same layer never depend
on each other, so the two front ends, `@vitest-agent/cli` and
`@vitest-agent/mcp`, cannot depend on each other.
`@vitest-agent/plugin` is alone in the top layer, so no other layered
package may depend on it[^layering-test]. The dependency graph is also
acyclic across all four fields, `devDependencies` included.

```text
5  @vitest-agent/plugin (the carrier)
4  @vitest-agent/cli, @vitest-agent/mcp
3  @vitest-agent/engine, @vitest-agent/reporter, @vitest-agent/sidecar
2  @vitest-agent/ui, @vitest-agent/sidecar-{darwin-arm64,linux-arm64,linux-x64,win32-x64}
1  @vitest-agent/sdk
tooling        @vitest-agent/claude-code-plugin
unconstrained  vitest-agent (root, dev-only), docs, playground
```

`layers.json` lists the layers top-down (the carrier first). The rank
numbers above are the convention used elsewhere in this bundle and
`CLAUDE.md`, with rank 1 at the bottom.

## Mechanism

`packages/plugin/__test__/workspace-layering.test.ts` makes three
assertions[^layering-test]:

1. **The live graph honours the policy.** `LayerPolicy.load` decodes
   `layers.json` strictly, so a misspelled key fails instead of being
   dropped. `WorkspaceLayering.checkWorkspace` then discovers every
   workspace package through `@effected/workspaces` and reports:
   - unclassified packages;
   - packages classified twice;
   - policy names the workspace does not contain;
   - offending edges: `upward`, `sameLayer`, `toolingReachesLayer`,
     `intoUnconstrained` or `intoUnclassified`;
   - cycles in the checked fields;
   - `requiredEdges` that are missing.

   The test expects no violations and a non-zero edge count. The
   `requiredEdges` list guards against the opposite failure: a
   discovery that silently drops real edges would otherwise report a
   clean graph.
2. **The graph has no cycles in any field.**
   `DependencyGraph.make` over every discovered package, with
   `devDependencies` included, must report `hasCycle: false`.
3. **A positive control.** A synthetic graph with an upward edge
   (`sdk -> engine`) and a same-layer edge (`cli -> mcp`) must report
   exactly those two offenders, as `upward` and `sameLayer`. This proves
   the check can fail.

The test lives in the carrier's test tree because root-level test files
are not discovered by `classifyTestPath` — see
[Invariant: Test-path classification](./test-path-classification.md).

It is distinct from the four `boundaries.test.ts` files. This test checks
the dependency graph between packages. The boundaries tests check what
each package's own source may import or read — see
[Invariant: Package boundaries](./package-boundaries.md).

## What a refactor would have to break

Each of these fails assertion 1:

- Adding a workspace package without an entry in `layers.json`
  (`unclassified`). No default layer exists.
- Adding a runtime dependency in the wrong direction, for example
  `@vitest-agent/sdk` on `@vitest-agent/ui` (`upward`). This fails as
  soon as the edge is in a `package.json`, whether or not the TypeScript
  import exists.
- Adding a runtime dependency between `@vitest-agent/cli` and
  `@vitest-agent/mcp`, in either direction (`sameLayer`).
- Removing an edge listed in `requiredEdges` from its manifest.

A dependency cycle fails assertion 2 even when it runs only through
`devDependencies`.

Two limits apply. The policy reads manifests, not imports, so it cannot
catch a source file that imports a package its manifest does not
declare. And `devDependencies` are checked for cycles but not for
direction. It is one half of the carrier's structural guarantee — see
[Decision 70: Carrier Pattern and Ranked Layering](../decisions/70-carrier-pattern-and-ranked-layering.md)
for why the graph is shaped this way, [Decision 72: Adopt the Effected
Front-End Kit](../decisions/72-adopt-the-effected-front-end-kit.md) for
why the rule moved to a committed `layers.json`, [Module:
workspace](../modules/workspace.md) for the repository layout the
layers apply to, and [Glossary: Carrier](../glossary/carrier.md) for why
`@vitest-agent/plugin`'s position in the top layer matters.

[^layering-test]: `../../packages/plugin/__test__/workspace-layering.test.ts`
[^layers-json]: `../../layers.json`
