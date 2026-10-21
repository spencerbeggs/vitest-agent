---
type: Invariant
title: Declared runtime imports — every runtime import is in its own package's manifest
description: "Every literal import in a workspace package's src/ names a Node built-in, a relative path, or a package listed in that package's own dependencies, peerDependencies or optionalDependencies — pinned by undeclared-imports.test.ts through ImportGraph.undeclared, which catches the devDependency and root-only imports that tsc and every in-workspace e2e test resolve but a consumer's install does not."
tags: [deps, testing, release]
resource: ../../packages/plugin/__test__/undeclared-imports.test.ts
sources:
  - id: undeclared-imports-test
    resource: ../../packages/plugin/__test__/undeclared-imports.test.ts
  - id: effected-workspaces-testing
    resource: npm:@effected/workspaces
    title: ImportGraph.undeclared in @effected/workspaces/testing
status: draft
generated:
  by: okfit/claude-code
  at: 2026-10-21T17:08:23Z
integrity:
  generated:
    body: a03f386e9fc7dd4a
---

# Declared runtime imports — every runtime import is in its own package's manifest

## Property

Every runtime import in a workspace package's `src/**` names one of
three things: a Node built-in, a relative path, or a package listed in
that package's own `dependencies`, `peerDependencies` or
`optionalDependencies`. A package that is only a `devDependency`, or that
only the workspace root declares, is never imported at runtime. Type-only
imports are erased at build, so they are exempt, and so are test files
kept under `src/`.

This matters because the workspace hides the failure. `tsc` rejects an
import of a package that is declared nowhere: under pnpm's isolated
layout it fails with TS2307. A `devDependency` is different. Node's
resolution walks up from `dist/dev/pkg` to `packages/<pkg>/node_modules`,
where pnpm installed the `devDependencies`, so the import resolves and
every e2e test passes. The published manifest has no `devDependencies`,
so the import breaks only in a consumer's install. See [Decision
85](../decisions/85-consumer-install-guard.md).

## Mechanism

`packages/plugin/__test__/undeclared-imports.test.ts` runs
`ImportGraph.undeclared({ builtins: builtinModules })` from
`@effected/workspaces/testing` against the live workspace[^undeclared-imports-test].
The kit discovers every workspace package, lexes each `src/**` file with
the `SourceBoundary` lexer, and compares each literal specifier against
the importing package's own manifest[^effected-workspaces-testing]. A
file under a nested package is checked only against its innermost
package. The suite makes two kinds of assertion:

1. **The live tree is clean.** No violation remains once test files are
   filtered out. The scan must have read `@vitest-agent/plugin` and more
   than 100 files, so a scan that read nothing cannot pass.
2. **A positive control.** A memfs fixture package must report exactly
   one violation: a runtime import of its `devDependency` `zod`. Its
   declared `effect` import, its `node:fs` import, its type-only `zod`
   import and its test file's `vitest` import are all spared.

The suite lives in the carrier's test tree for the same reason the
layering test does: root-level test files are not discovered — see
[Invariant: Test-path classification](./test-path-classification.md).

## What a refactor would have to break

Each of these fails assertion 1:

- Importing a `devDependency` from a package's runtime source, for
  example `typescript` from a `@vitest-agent/cli` source file.
- Importing a package only the workspace root declares.
- Importing a bare Node built-in that is missing from `builtinModules`.
- Moving a dependency from `dependencies` to `devDependencies` while a
  runtime import of it remains.

Two limits apply. The check reads literal specifiers only: static
imports, re-exports, and `import()` or `require()` calls with one string
literal. A computed specifier such as `import("./ui/" + name)` is
invisible; the kit names `PackedInstall` as the proof for that case. And
it says nothing about whether the manifest the bundler publishes is
correct, or whether the carrier's bins link: those belong to
`@savvy-web/bundler` and to [Decision
70](../decisions/70-carrier-pattern-and-ranked-layering.md)'s proof at
adoption.

It complements [Invariant: Ranked layering](./ranked-layering.md), which
checks the edges the manifests declare but not what the source imports,
and [Invariant: Package boundaries](./package-boundaries.md), which
checks what each package's own source may import by rule.

[^undeclared-imports-test]: `../../packages/plugin/__test__/undeclared-imports.test.ts`
[^effected-workspaces-testing]: `npm:@effected/workspaces` (`ImportGraph` in `@effected/workspaces/testing`)
