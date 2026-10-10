---
type: Convention
title: Import style — extensions, protocol, type-only, and static-only
description: "Relative imports carry an explicit extension, Node builtins use the node: protocol, type-only imports are separated, and dynamic import() is banned outside three documented call sites: mcp's main.ts and the reporter's two lazy Ink view loads."
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
    title: The crash-guard dynamic imports
  - id: reporter-live-view
    resource: ../../packages/reporter/src/liveView.ts
    title: The lazy stream-view load
  - id: reporter-default-reporter
    resource: ../../packages/reporter/src/defaultReporter.ts
    title: The lazy report-time human render load
  - id: reporter-boundaries
    resource: ../../packages/reporter/__test__/boundaries.test.ts
    title: The source scan that pins the reporter's two dynamic imports
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: e122c11a3182313c833d21c0e27c8cc3c1eda3a6375f2e4929010b35736fca8a
---

# Import style — extensions, protocol, type-only, and static-only

Four rules govern every import statement under `packages/*/src` and
`plugin/**` (the generated `plugin/builds/**` is excluded from Biome). All four are enforced by Biome at commit time
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

## Static imports everywhere, with three sanctioned exceptions

Every import in this codebase is a static `import` declaration. Dynamic
`await import(...)` is not a house pattern to reach for casually. There are
three sanctioned call sites, each with a reason a static import would
defeat.

The first is `packages/mcp/src/main.ts`, where the whole
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
The other two are in `@vitest-agent/reporter`, and both exist to keep
React and Ink off the import path of runs that never draw an Ink frame
(issue 562). `liveView.ts` hands the kit
`CliUi.lazyView(() => import("./streamView.js"))`, so the `stream` live
view's drawing loads when a run first mounts it[^reporter-live-view].
`defaultReporter.ts`'s `renderHumanStringForReport` does
`await import("./humanReport.js")`, so the report-time `renderToString`
loads only when a human report is rendered[^reporter-default-reporter]. A
static import of either view module would put every React and Ink module
back on every agent and CI run. The reporter's boundary test pins these
two call sites: only `liveView.ts` and `defaultReporter.ts` may contain
`import(`, and nothing imports either view module
statically[^reporter-boundaries]. [Decision
78](../decisions/78-ink-half-behind-a-ui-subpath-and-lazy-reporter-views.md)
records why.

Do not add a fourth call site to save a few modules. Add one only when a
static import would break an ordering or a reachability guarantee in the
same way, and widen the owning package's boundary-test allowlist in the
same change.

[^biome-root-config]: ../../biome.json
[^silk-biome-rules]: npm:@savvy-web/silk/biome
[^mcp-main-dynamic-imports]: ../../packages/mcp/src/main.ts
[^reporter-live-view]: ../../packages/reporter/src/liveView.ts
[^reporter-default-reporter]: ../../packages/reporter/src/defaultReporter.ts
[^reporter-boundaries]: ../../packages/reporter/__test__/boundaries.test.ts
