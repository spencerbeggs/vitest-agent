---
type: Convention
title: Import style — extensions, protocol, type-only, and static-only
description: "Relative imports carry an explicit extension, Node builtins use the node: protocol, type-only imports are separated, and dynamic import() is banned outside one documented exception."
tags: [dx]
status: stable
stale_after: 2027-03-13T00:00:00Z
sources:
  - id: biome-root-config
    resource: ../../biome.json
    title: Root Biome config (extends @savvy-web/silk/biome)
  - id: silk-biome-rules
    resource: "npm:@savvy-web/silk/biome"
    title: "@savvy-web/silk's Biome rule set (useImportExtensions, useImportType, useNodejsImportProtocol, noImportCycles)"
  - id: mcp-main-dynamic-imports
    resource: ../../packages/mcp/src/main.ts
    title: The one sanctioned dynamic-import call site
generated:
  by: okfit/claude-code
  at: 2026-09-25T23:18:00Z
  body_sha256: 249cf2a713167bde61e6998ee59a1543ca40a51495c1c782bc73e8de4164cca9
---

# Import style — extensions, protocol, type-only, and static-only

Four rules govern every import statement under `packages/*/src` and
`plugins/claude-code/**`. All four are enforced by Biome at commit time
through the shared `@savvy-web/silk/biome` config this repository's root
`biome.json` extends[^biome-root-config], so a violation blocks the commit
rather than waiting for review.

## Use an explicit extension on every relative import

Write `import { foo } from "./bar.js"`, never `"./bar"`. This is an ESM
requirement (Node's module resolver does not guess extensions for
`import`), and Biome's `useImportExtensions` rule enforces it at
`error` level with an explicit `extensionMappings` table so a `.ts`
source imports as `.js`, `.mts` as `.mjs`, and `.cts` as `.cjs` — never
the source extension itself[^silk-biome-rules]. Asset imports
(`.json`, `.css`) keep their real extension.

## Use the `node:` protocol for every Node.js builtin

Write `import fs from "node:fs"`, never `import fs from "fs"`. Biome's
`useNodejsImportProtocol` rule enforces this at `error`
level[^silk-biome-rules].

## Separate type-only imports

Write `import type { Foo } from "./bar.js"`, never
`import { type Foo } from "./bar.js"`. Biome's `useImportType` rule is
configured with `style: "separatedType"` at `error` level, so a mixed
value-and-type import statement fails even when the type portion is
correctly marked inline[^silk-biome-rules]. This convention pairs with
the `verbatimModuleSyntax` TypeScript compiler flag every package's
`tsconfig` enables, which makes a missing `type` keyword a compile
error, not merely a lint warning.

## Cross-package imports use the package name, never a relative path

A file in one workspace package that needs a symbol from another
imports it by package name — `import { DataStore } from
"@vitest-agent/engine"`, never a relative path that reaches across
`packages/*/src` boundaries. A relative import can only ever resolve
within the current package; reaching for one across a package boundary
would either fail to resolve at build time or silently bypass the
package's declared public surface (its `index.ts` barrel), which is
exactly the surface the family's rank rule and per-package boundary
tests are built to police.

## Static imports everywhere, with exactly one exception

Every import in this codebase is a static `import` declaration. Dynamic
`await import(...)` is not a house pattern to reach for casually — the
one sanctioned exception is `packages/mcp/src/main.ts`, where the whole
server graph (the engine's platform layers, the session module, the
server layer, and the version constant) is loaded through sequential
`await import(...)` calls inside the `load` callback it hands to
`@effected/mcp/guard`'s `McpGuard.run`[^mcp-main-dynamic-imports]. That
file's own header comment states why: the process-level
`unhandledRejection` / `uncaughtException` guards, which `McpGuard`
(itself free of static runtime imports) registers before calling `load`,
must exist *before* the server graph is evaluated at all, so a throw during module evaluation of that graph is
still reported to stderr instead of crashing the process silently. A
static import at the top of the module would evaluate the whole graph
during module load — before the guards exist — and defeat the design.
Introducing a second dynamic-import call site anywhere else in the
family reintroduces exactly the failure mode this one exception exists
to avoid, without the crash-guard ordering that justifies it.

[^biome-root-config]: ../../biome.json
[^silk-biome-rules]: npm:@savvy-web/silk/biome
[^mcp-main-dynamic-imports]: ../../packages/mcp/src/main.ts
