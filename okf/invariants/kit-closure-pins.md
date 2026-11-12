---
type: Invariant
title: Kit closure pins — every published runtime edge onto Effect and the kit is exact
description: "Every package in the ranked layers of layers.json writes its dependencies and optionalDependencies on effect, @effect/* and @effected/* as catalog:effected:exact, so the installed carrier keeps its own tested Effect and kit copies; pinned by kit-closure-pins.test.ts, which does not reach a consumer's graph-wide effect override or the carets inside the kit's own manifests."
tags: [deps, release, compat, testing]
resource: ../../packages/plugin/__test__/kit-closure-pins.test.ts
sources:
  - id: kit-closure-pins-test
    resource: ../../packages/plugin/__test__/kit-closure-pins.test.ts
  - id: layers-json
    resource: ../../layers.json
  - id: plugin-package-json
    resource: ../../packages/plugin/package.json
  - id: pnpm-plugin-effected
    resource: npm:@effected/pnpm-plugin-effected
    title: "@effected/pnpm-plugin-effected 0.26.2, which serves the effected:exact catalog"
status: draft
generated:
  by: okfit/claude-code
  at: 2026-11-12T02:39:17Z
integrity:
  generated:
    body: 1e7ee79f39e68f78
---

# Kit closure pins — every published runtime edge onto Effect and the kit is exact

## Property

Every published `@vitest-agent/*` package declares each `dependencies`
or `optionalDependencies` entry on `effect`, an `@effect/*` package or an
`@effected/*` package with exactly the specifier
`catalog:effected:exact`. That catalog is the `effected` catalog with its
range operators stripped[^pnpm-plugin-effected], so every such edge packs
as a plain version. The carrier, `@vitest-agent/plugin`, therefore
installs with the Effect and kit copies its own release was tested
against, and sits beside a host app on any other kit or Effect release
without either one moving the other[^plugin-package-json].

`peerDependencies` (`catalog:effected:peers`) and `devDependencies`
(`catalog:effected`) are outside the property: peers resolve from the
exact copies the carrier declares, and dev edges never reach a consumer.
The rule a contributor follows when adding a dependency is [Convention:
Effect v4 dependencies](../conventions/effect-v4-dependencies.md).

## Mechanism

`packages/plugin/__test__/kit-closure-pins.test.ts` makes two
assertions[^kit-closure-pins-test]:

1. **The live workspace is pinned.** It takes the published set to be
   exactly the packages named in the ranked `layers` of the root
   `layers.json`[^layers-json] (so `tooling` and `unconstrained` packages
   are excluded, and a new published package is covered as soon as it is
   ranked), reads each manifest through `@effected/workspaces`, and
   expects no runtime edge matching `effect`, `@effect/*` or
   `@effected/*` whose specifier is anything but `catalog:effected:exact`.
   Non-vacuity: the scan must include `@vitest-agent/plugin` and find more
   than 40 such edges, so a broken discovery cannot pass by checking
   nothing.
2. **Positive control.** A synthetic `WorkspacePackage` with a
   `catalog:effected` kit edge, a literal `4.1.4`, and a caret
   `optionalDependencies` entry is flagged on all three, while its exact
   edge, a non-kit package on `catalog:effected`, a `catalog:effected:peers`
   peer and a `catalog:effected` devDependency are spared.

For it to stop holding, a refactor would have to change the published set
(drop a package from the ranked layers of `layers.json`), widen the
specifier check, or delete the suite; any manifest edit back to
`catalog:effected` or a hand-written range fails the first assertion.

## What it does not hold

- **A consumer's graph-wide pin wins.** A consumer that pins `effect`
  across its whole graph, for example through the `effected` catalog
  plugin's own overrides, still replaces the carrier's copy; an exact
  dependency cannot outrank a package-manager override.
- **The kit's own regular dependencies still float.** Each `@effected/*`
  package inside the closure declares its own dependencies with carets,
  and those resolve by their own ranges. Sealing the closure completely
  would need the carrier to bundle it.
- **Every kit release ripples.** A new release of any kit package in the
  closure needs a patch release of the carrier to reach consumers; that is
  the cost of the pin, not a defect.

[^kit-closure-pins-test]: `../../packages/plugin/__test__/kit-closure-pins.test.ts`
[^layers-json]: `../../layers.json`
[^plugin-package-json]: `../../packages/plugin/package.json`
[^pnpm-plugin-effected]: npm:@effected/pnpm-plugin-effected
