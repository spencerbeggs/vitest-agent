---
type: Decision
status: stable
title: Replace the Packed-Install E2E with a Static Undeclared-Import Check
description: "Retires bins-packed-install.e2e.test.ts, which packed the carrier and installed it under npm, pnpm, yarn and bun, in favour of undeclared-imports.test.ts, which runs ImportGraph.undeclared over every workspace package's src/; manifest rewriting is the bundler's to test, bin linking was proven at adoption, CI never ran the e2e, and the one gap it closed that nothing else did (a runtime import of a devDependency or a root-only package) is now caught statically in about 150 ms."
tags:
  - testing
  - deps
  - release
  - performance
generated:
  by: okfit/claude-code
  at: 2026-10-21T17:08:23Z
sources:
  - id: undeclared-imports-test
    resource: ../../packages/plugin/__test__/undeclared-imports.test.ts
  - id: plugin-package-json
    resource: ../../packages/plugin/package.json
  - id: effected-workspaces-testing
    resource: npm:@effected/workspaces
    title: ImportGraph.undeclared in @effected/workspaces/testing 0.35.0, whose docs name PackedInstall as the only proof for computed dynamic specifiers
  - id: issue-574
    resource: https://github.com/spencerbeggs/vitest-agent/issues/574
  - id: ci-run-39613628730
    resource: https://github.com/spencerbeggs/vitest-agent/actions/runs/39613628730
    title: CI test job reporting "bins-packed-install.e2e.test.ts (1 test | 1 skipped)"
  - id: owner-probes
    resource: probes run on branch perf/ci-test-speed and reported by the team-lead session
    last_modified: 2026-10-21T00:00:00Z
integrity:
  generated:
    body: 051ab1f7a08a4205
  verified:
    by: human:spencer
    at: 2026-10-27T15:50:37Z
    content: c1110cbba05cc19f
verified:
  - by: human:spencer
    at: 2026-10-27T15:50:37Z
---

# Replace the Packed-Install E2E with a Static Undeclared-Import Check

## Context

`packages/plugin/__test__/bins-packed-install.e2e.test.ts` ran
`@effected/workspaces/testing`'s `PackedInstall.run` and
`@effected/mcp/testing`'s `McpProbe.initialize`. It packed the carrier and
its runtime workspace closure from each package's `dist/prod/npm/pkg`,
installed the carrier into a scratch consumer under npm, pnpm, yarn and
bun, and then probed both bins. That one suite covered four things:

1. **The published manifest.** The `exports` rewrite, the stripping of
   `workspace:`, `catalog:` and `file:` specifiers, and the dropped
   `devDependencies`.
2. **Undeclared runtime dependencies.** An import that resolves inside the
   workspace but not in a consumer's install.
3. **Carrier bin linking under four package managers.** This was
   [Decision 70](70-carrier-pattern-and-ranked-layering.md)'s proof.
4. **The installed bins starting.** `--version` and the MCP `initialize`
   handshake.

Issue 574[^issue-574] measured its cost and found it high for what it
added. It took about 38 s of every local `pnpm test` whenever a prod
build existed[^owner-probes]. CI never ran it. The CI test job builds only
`dist/dev`, so the suite always skipped there: run 39613628730 reports
`bins-packed-install.e2e.test.ts (1 test | 1 skipped)`[^ci-run-39613628730].

Each item had to be weighed separately:

- **Manifest rewriting belongs to `@savvy-web/bundler`.** The bundler
  rewrites `exports`, strips the workspace specifiers and drops
  `devDependencies`, and its own test suite owns that behaviour. This
  repository consumes it.
- **`tsc` already catches most undeclared imports.** A probe confirmed it:
  pnpm's isolated layout makes `tsc` fail with TS2307 on an import of a
  package the importing package never declared[^owner-probes]. Biome's
  `noUndeclaredDependencies` does not help, because it is effectively off
  here.
- **One gap was left.** A runtime import of a package that is only a
  `devDependency`, or that only the workspace root declares, passes both
  `tsc` and every e2e test. `dist/dev/pkg/package.json` lists no
  `devDependencies`, but Node's resolution ignores the manifest. It walks
  up to `packages/<pkg>/node_modules`, where pnpm installed the
  `devDependencies`. A probe showed this: from `packages/cli/dist/dev/pkg`,
  `require.resolve('vitest/package.json')` succeeds, though `vitest` is
  only a `devDependency` of `@vitest-agent/cli`[^owner-probes]. Only a
  consumer's install breaks.
- **Bin linking only changes when the bins change.** Under the four
  package managers it is package-manager behaviour. It changes only when
  the carrier's `bin` map or its shims change, so it is not an everyday
  regression risk. The packed-install suite proved it when Decision 70
  adopted the carrier.

## Decision

1. **Delete `bins-packed-install.e2e.test.ts`.**
2. **Add `packages/plugin/__test__/undeclared-imports.test.ts`.** It runs
   `ImportGraph.undeclared({ builtins: builtinModules })` from
   `@effected/workspaces/testing` over every workspace package's
   `src/**`[^undeclared-imports-test]. The check compares each package's
   literal runtime specifiers against that package's own `dependencies`,
   `peerDependencies` and `optionalDependencies`, and expects no
   violations. Test files kept under `src/` are filtered out, because the
   playground keeps its tests there.
3. **Make the check prove it can fail.** It asserts that the scan read the
   carrier and more than 100 files. A memfs positive control must flag a
   runtime import of a `devDependency` and spare a declared import, a
   `node:` built-in, a type-only import and a test file. As a mutation
   check, a `@vitest-agent/cli` source file importing its `devDependency`
   `typescript` failed the suite as expected[^owner-probes].
4. **Drop `@effected/mcp` from the plugin's `devDependencies`.** Only the
   deleted suite used it, for `McpProbe`[^plugin-package-json].

The check is the [declared runtime imports
invariant](../invariants/declared-runtime-imports.md). It runs in about
150 ms as an ordinary unit test, so CI runs it too.

## Alternatives rejected

**Keep the packed-install e2e and build prod in CI.** This would have made
the suite run in CI at last, at the cost of a prod build and four real
installs on every run. Most of what it proved is owned elsewhere: by the
bundler, by `tsc`, or by a one-off proof at adoption. The remaining gap
does not need a real install to find.

**Keep it as a local-only suite.** That was the state before this
Decision: about 38 s on every local run that had a prod build, and no
protection in CI. A guard that runs only on some machines is not a release
gate.

**Rely on `tsc` alone.** `tsc` cannot see the `devDependency` case,
because the import resolves through `packages/<pkg>/node_modules`.

## Consequences

- **A computed dynamic specifier is invisible.** The check reads static
  imports, re-exports, and `import()` or `require()` calls whose argument
  is one string literal. The kit's own documentation says only
  `PackedInstall` proves a computed specifier such as
  `import("./ui/" + name)`[^effected-workspaces-testing]. This repository
  accepts that limit. Every sanctioned dynamic import in the family's
  sources has one string-literal specifier, so the check reads them all:
  the reporter's two lazy view loads are relative paths, and mcp's
  `main.ts` loads relative modules and declared packages
  (`effect`, `@effect/platform-node`, `@effected/engine`,
  `@vitest-agent/engine`).
- **Nothing proves bin linking per package manager now.** The carrier's
  bins are part of its published manifest. They are guarded by this check
  and by [ranked layering](../invariants/ranked-layering.md) holding the
  carrier's dependency edges. A change to the carrier's `bin` map or its
  shims should be proven again by hand, with `PackedInstall`, before it
  ships.
- **The engine-before-plugin release gate stands.** Decision 70 derived it
  from the tarball-override harness. It follows from the carrier's
  exact-pinned dependencies, not from the test; see the [release
  runbook](../runbooks/release.md).

## Related

- [Decision 70: Carrier Pattern and Ranked Layering](70-carrier-pattern-and-ranked-layering.md)
- [Decision 72: Adopt the Effected Front-End Kit](72-adopt-the-effected-front-end-kit.md)
- [Decision 73: Adoption Helpers Live in the Kit](73-adoption-helpers-live-in-the-kit.md)
- [Invariant: declared runtime imports](../invariants/declared-runtime-imports.md)
- [Module: @vitest-agent/plugin](../modules/plugin.md)

[^undeclared-imports-test]: `../../packages/plugin/__test__/undeclared-imports.test.ts`
[^plugin-package-json]: `../../packages/plugin/package.json`
[^effected-workspaces-testing]: `npm:@effected/workspaces` (`ImportGraph` in `@effected/workspaces/testing`)
[^issue-574]: <https://github.com/spencerbeggs/vitest-agent/issues/574>
[^ci-run-39613628730]: <https://github.com/spencerbeggs/vitest-agent/actions/runs/39613628730>
[^owner-probes]: probes run on branch perf/ci-test-speed and reported by the team-lead session
