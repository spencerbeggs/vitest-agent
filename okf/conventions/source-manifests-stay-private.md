---
type: Convention
title: Never set private to false in a source package.json
description: "Every publishable package's source package.json declares private:true; the @savvy-web/bundler build transform is what flips it to false and strips devDependencies in the emitted dist package.json."
tags: [release, bundle]
status: stable
stale_after: 2027-03-13T00:00:00Z
sources:
  - id: sdk-package-json
    resource: ../../packages/sdk/package.json
    title: "@vitest-agent/sdk source package.json (private: true)"
  - id: sdk-savvy-build
    resource: ../../packages/sdk/savvy.build.ts
    title: "@vitest-agent/sdk's savvy.build.ts (calls @savvy-web/bundler's build())"
  - id: sdk-dist-dev-package-json
    resource: ../../packages/sdk/dist/dev/pkg/package.json
    title: Emitted dev package.json (private:false — build output, not committed source)
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
integrity:
  generated:
    body: 84008800a0f39f02
---

# Never set private to false in a source package.json

Every one of this repository's publishable source `package.json` files
declares `"private": true` — for example
`packages/sdk/package.json:4`[^sdk-package-json]. This is intentional,
not an oversight to "fix" toward `false`: the build toolchain treats a
source manifest's `private: true` as a signal it rewrites on the way to
the emitted package, not as the final published state.

## The build transform is what flips it

Each package's `savvy.build.ts` calls `@savvy-web/bundler`'s `build()`
function[^sdk-savvy-build]. That call is what produces the dual dev/prod
output directories (`dist/dev/pkg/`, `dist/prod/<target>/pkg/`) — and
part of what it emits into each output `package.json` is `"private":
false`, along with a rewritten `exports` map and devDependencies
stripped out. `packages/sdk/dist/dev/pkg/package.json`'s `private` field
reads `false`[^sdk-dist-dev-package-json] even though the source
manifest it was built from reads `true` — confirming the transform is
what performs the flip, not a hand edit anywhere in source. Note that
`dist/` is build output, not tracked source; it is cited here only to
show the transform's effect, and the toolchain that produces it is
`@savvy-web/bundler`, invoked directly from each package's
`savvy.build.ts` — not `rslib-builder`, which no longer does this work
in this repository.

## Never hand-set private to false in source

Setting `"private": false` directly in a source `package.json` skips
this transform entirely: the file would publish with its raw `exports`
map (rather than the rewritten one the build produces) and with its
devDependencies still declared, neither of which the published package
should carry. The source manifest's `private: true` is what makes an
accidental `npm publish` from an unbuilt tree fail closed instead of
shipping something that has never passed through the toolchain's
rewrite step.

See [Module: workspace](../modules/workspace.md) for the build pipeline
this convention is part of.

[^sdk-package-json]: ../../packages/sdk/package.json
[^sdk-savvy-build]: ../../packages/sdk/savvy.build.ts
[^sdk-dist-dev-package-json]: ../../packages/sdk/dist/dev/pkg/package.json
