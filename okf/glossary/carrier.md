---
type: Glossary
title: Carrier
description: >-
  The repository-specific term for @vitest-agent/plugin's role as the one
  package a consumer installs and the sole declarer of both family bins.
tags: [dx, architecture, release]
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: d870d215d3377887f0a49a3796abcade8e14338023eb2534a414fec5ade9a7de
sources:
  - id: plugin-manifest
    resource: ../../packages/plugin/package.json
  - id: bin-vitest-agent
    resource: ../../packages/plugin/src/bin/vitest-agent.ts
  - id: bin-vitest-agent-mcp
    resource: ../../packages/plugin/src/bin/vitest-agent-mcp.ts
---

# Carrier

"Carrier" is this repository's name for `@vitest-agent/plugin`'s packaging
role, not a term from the pnpm or npm vocabulary: it is the one package a
consumer actually installs (`AgentPlugin()` in their `vitest.config.ts`), and
the only package in the family that declares either family binary.

## What makes it the carrier

`@vitest-agent/plugin`'s manifest declares both bins directly —
`vitest-agent` and `vitest-agent-mcp`
— pointing at shims of a few lines that pass the carrier's own identity
down as `distribution`:

```ts
// packages/plugin/src/bin/vitest-agent.ts
import { main } from "@vitest-agent/cli/main";
import { CURRENT_PLUGIN_VERSION } from "../version.js";

main({ distribution: { name: "@vitest-agent/plugin", version: CURRENT_PLUGIN_VERSION } });
```

and the equivalent for `vitest-agent-mcp` over `@vitest-agent/mcp/main`
(`packages/plugin/src/bin/vitest-agent-mcp.ts`). The plugin depends on
`@vitest-agent/cli` and `@vitest-agent/mcp` as regular `workspace:*`
dependencies (exact-pinned on publish) purely to have something for the
shims to import — it does not otherwise use either package's exports.

## Why the shims exist at all

pnpm links only a package's *direct* dependencies' bins into
`node_modules/.bin`. If `@vitest-agent/cli` and `@vitest-agent/mcp` were the
only packages declaring `bin.vitest-agent` / `bin.vitest-agent-mcp`, a
consumer who installs only `@vitest-agent/plugin` (a transitive dependent of
cli/mcp, not a direct one) would get no bins in their `node_modules/.bin` at
all under pnpm's default linking, and inconsistent behavior across npm,
yarn, and bun. Declaring the same bin names again in the carrier's own
manifest, pointed at trivial re-export shims, sidesteps that without
`publicHoistPattern`, a pnpm plugin, or any manual consumer-side step.

## The trap

"Carrier" is not a synonym for "the package a bin lives in" in any general
sense — `cli` and `mcp` each still declare and own their bin as their
primary export path; the carrier is specifically the *second*, redundant
declaration that exists only to satisfy pnpm's linking rule for indirect
installers. Removing the plugin's own `bin` field (thinking it merely
duplicates cli/mcp) breaks every consumer who installs only the plugin,
which is the documented, intended install shape for this family.

See [Decision 70](../decisions/70-carrier-pattern-and-ranked-layering.md),
[Invariant ranked-layering](../invariants/ranked-layering.md), and
[Module plugin](../modules/plugin.md).
