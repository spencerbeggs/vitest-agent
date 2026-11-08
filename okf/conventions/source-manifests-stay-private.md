---
type: Convention
title: Never set private to false in a source package.json
description: "Every publishable package's source package.json declares private:true; effected package build is what flips it to false, rewrites exports, and strips devDependencies in the emitted dist package.json."
tags: [release, bundle]
status: stable
stale_after: 2027-03-13T00:00:00Z
sources:
  - id: sdk-package-json
    resource: ../../packages/sdk/package.json
    title: "@vitest-agent/sdk source package.json (private: true, build script effected package build)"
  - id: sdk-effected-toml
    resource: ../../packages/sdk/effected.toml
    title: "@vitest-agent/sdk's optional per-package build config"
  - id: sdk-dist-package-json
    resource: ../../packages/sdk/dist/prod/npm/pkg/package.json
    title: Emitted package.json (private:false — build output, not committed source)
generated:
  by: okfit/claude-code
  at: 2026-11-08T20:00:07Z
integrity:
  generated:
    body: 3d148b64b310faec
---

# Never set private to false in a source package.json

Every one of this repository's publishable source `package.json` files
declares `"private": true` — for example
`packages/sdk/package.json`[^sdk-package-json]. This is intentional,
not an oversight to "fix" toward `false`: the build toolchain treats a
source manifest's `private: true` as a signal it rewrites on the way to
the emitted package, not as the final published state.

## The build transform is what flips it

Each package's `build` script is `effected package build` (the `effected`
bin from the root devDependency `@effected/plugin`), configured, when a
package needs options, by an optional `effected.toml` beside the
manifest[^sdk-effected-toml]. The build emits one target, the npm tree at
`dist/prod/npm/pkg/` — and part of what it writes into that output
`package.json` is `"private": false`, along with a rewritten `exports` map
(pointing at the built `.js` and `.d.ts` files instead of the source's
`src/*.ts`) and devDependencies stripped out.
`packages/sdk/dist/prod/npm/pkg/package.json`'s `private` field reads
`false`[^sdk-dist-package-json] even though the source manifest it was
built from reads `true` — confirming the transform is what performs the
flip, not a hand edit anywhere in source. Note that `dist/` is build
output, not tracked source; it is cited here only to show the transform's
effect.

## Never hand-set private to false in source

Setting `"private": false` directly in a source `package.json` skips
this transform entirely: the file would publish with its raw `exports`
map — which points at TypeScript source, since workspace links resolve
there — and with its devDependencies still declared, neither of which the
published package should carry. The source manifest's `private: true` is
what makes an accidental `npm publish` from an unbuilt tree fail closed
instead of shipping something that has never passed through the
toolchain's rewrite step.

See [Module: workspace](../modules/workspace.md) for the build pipeline
this convention is part of.

[^sdk-package-json]: ../../packages/sdk/package.json
[^sdk-effected-toml]: ../../packages/sdk/effected.toml
[^sdk-dist-package-json]: ../../packages/sdk/dist/prod/npm/pkg/package.json
