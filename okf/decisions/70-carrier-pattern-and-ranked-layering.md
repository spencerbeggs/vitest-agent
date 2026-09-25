---
type: Decision
status: draft
title: Carrier Pattern and Ranked Layering
description: "Restructures the workspace into a rank-ordered dependency graph (sdk at rank 1 through the plugin carrier at rank 5) and has the carrier declare both bins directly so pnpm's direct-dependency-only bin linking works without hoisting tricks."
tags:
  - architecture
  - deps
  - release
generated:
  by: okfit/claude-code
  at: 2026-09-25T23:18:00Z
  body_sha256: 617305e01e4774e607f4c6f7cad7af2b2b92752b73541312144af0e6273525c7
sources:
  - id: plugin-package-json
    resource: ../../packages/plugin/package.json
  - id: plugin-bin-shims
    resource: ../../packages/plugin/src/bin
  - id: workspace-layering-test
    resource: ../../packages/plugin/__test__/workspace-layering.test.ts
  - id: layers-json
    resource: ../../layers.json
  - id: bins-packed-install-e2e
    resource: ../../packages/plugin/__test__/bins-packed-install.e2e.test.ts
---

# Carrier Pattern and Ranked Layering

## Context

Before this decision the shared `@vitest-agent/sdk` package mixed pure
schemas and formatters with SQLite, `@effect/platform-node`,
`@effected/xdg` and `std-env`, so a sidecar single-executable-application
build and the pure `./dispatch` entry had to tree-shake their way out of
the whole data layer, and `process.env` / `process.cwd()` reads were
scattered across layers, the CLI, and the MCP bin. Each front end also
assembled its own composite layer and its own `projectDir` precedence,
and the two drifted against each other. On the install side, the
`vitest-agent` and `vitest-agent-mcp` bins reached a consumer only
because a pnpm plugin publicly hoisted the transitive `cli` and `mcp`
packages — pnpm links only *direct*-dependency bins into
`node_modules/.bin`, so a bare `pnpm` consumer, or the Claude Code
plugin's hooks and loader, had no bin to call without that plugin. Two
retired predecessors describe pieces of that workaround: one had the
plugin loader detect the package manager and exec `<pm-exec>
vitest-agent-mcp`, relying on the same hoisting to make that resolvable;
the other had the workspace root declare `@vitest-agent/cli` and
`@vitest-agent/mcp` directly as devDependencies with a matching
`publicHoistPattern` in `pnpm-workspace.yaml`. Both were retired in favor
of the carrier declaring its own bins, and the `publicHoistPattern` entry
and the pnpm-plugin dependency were removed outright.

## Decision

The package graph is restructured on an okfit carrier pattern: one
platform-free core, one platform half, two process-owning front ends with
a fixed entry contract, and a single top-of-graph carrier whose bins
reach every consumer without package-manager hoisting tricks.

**Ranked layering.** Every workspace edge points to a strictly lower
rank; `cli` and `mcp` never import each other.

| Rank | Package | Runtime workspace deps |
| --- | --- | --- |
| 1 | `@vitest-agent/sdk` (core) | none |
| 2 | `@vitest-agent/ui` | sdk |
| 2 | `@vitest-agent/sidecar-{darwin-arm64,linux-arm64,linux-x64,win32-x64}` | sdk (build-time only; deleted from the published manifest) |
| 3 | `@vitest-agent/engine` | sdk |
| 3 | `@vitest-agent/reporter` | ui, sdk |
| 3 | `@vitest-agent/sidecar` | the four `sidecar-*` as `optionalDependencies` |
| 4 | `@vitest-agent/cli` | engine, sdk, sidecar |
| 4 | `@vitest-agent/mcp` | engine, sdk |
| 5 | `@vitest-agent/plugin` (carrier) | cli, mcp, reporter, engine, sdk |
| — | root `vitest-agent` (dev) | plugin only |

The ranks are committed in the root `layers.json` (top layer first, plus
a `tooling` entry for the Claude Code plugin tracking package and an
`unconstrained` list for the private root, `docs` and `playground`), and
`packages/plugin/__test__/workspace-layering.test.ts` holds the live
package graph to it through `@effected/workspaces/testing`'s
`WorkspaceLayering`. Every package must be classified, and every
`dependencies` / `optionalDependencies` / `peerDependencies` edge must
point to a strictly lower layer, never within one, so the two front ends
cannot depend on each other. A separate assertion keeps the graph
acyclic across all four fields. This replaced a hand-maintained rank
table in the test tree — see [Decision
72](72-adopt-the-effected-front-end-kit.md) and [Invariant: Ranked
Layering](../invariants/ranked-layering.md). It lives in
the carrier's test tree because the carrier already depends on
everything and root-level tests are not discovered by the classifier.

**`@vitest-agent/sdk` keeps its name and becomes the core.** The package
that ships `./schemas/*.json` and `RUN_REPORT_FILE_SCHEMA_URL` had to
keep its npm name so every consumer's `from "@vitest-agent/sdk"` schema
import stayed valid — the *name* stays with the pure half and the
platform half is the new package. The core keeps the pure schemas,
errors, formatters, utils, the `./dispatch` entry and the JSON Schema
documents; it lost every service, layer, SQL/migration, and platform
util that read `process` or touched the filesystem — a major version for
sdk.

**`@vitest-agent/engine` is new.** It received everything sdk lost, plus
one `PlatformLive` factory that both front ends build from, one
`resolveProjectDir({ env, cwd })` with a four-name precedence
(`VITEST_AGENT_PROJECT_DIR` → `VITEST_AGENT_REPORTER_PROJECT_DIR` →
`CLAUDE_PROJECT_DIR` → `cwd`), and the parametric env readers the two
front ends previously duplicated. The CLI's hook programs and the MCP
server's session-env recovery moved into engine programs, so both front
ends are now thin command and transport wrappers.

**Boundary tests, one per package.** Each of sdk, engine, cli and mcp
carries `__test__/boundaries.test.ts` over `@effected/workspaces/testing`'s
`SourceBoundary.scan`: sdk may not import `node:*`, `@effect/platform-node`,
`@effect/sql-sqlite-node` or any `@effected/*` package, and may not
reference `process.`; engine may not reference `process.` anywhere, with
no allowlist, and may not import a front end; cli and mcp read `process`
only through narrow allowlists (`bin.ts`, `main.ts`, `version.ts`, plus
`commands/**` for cli and `tools/run-tests.ts` for mcp) and never import
each other. The single exemption everywhere is the exact token
`process.env.__PACKAGE_VERSION__`, a compile-time literal the bundler
substitutes, which a `forbidTokens` rule confines to each package's
`version.ts`.

**`./dispatch` stays in sdk and is pure.** `dispatch(argv, io)` takes
`io = { cwd, env, readFile }`, so the four sidecar bins and the CLI's
`agent inject-env` command pass the platform bindings in rather than the
core reading them itself. The sidecar SEA bundle therefore reaches
nothing platform-bound from the core.

**Front-end entry contract.** Each of `cli` and `mcp` ships three files:
`src/bin.ts` is a shebang shim that imports and calls `main` from
`./main.js`; `src/main.ts` owns the process (every `process` read,
`NodeRuntime.runMain`, teardown) and is published as the `./main`
subpath; `src/index.ts` is a side-effect-free barrel that never imports
`main.ts`, so a library consumer's import graph never pulls in the
process-owning module. `src/version.ts` holds `CURRENT_<PKG>_VERSION`.
`packages/mcp/src/main.ts` follows the contract with a documented
deviation: it carries no static imports of the server graph at all (only
the dependency-free `@effected/mcp/guard`), because the crash guards
`McpGuard.run` registers must exist before anything that could throw
during module evaluation (`packages/mcp/src/main.ts`).

**The carrier.** `@vitest-agent/plugin` declares both bins itself as
thin shims: `bin.vitest-agent` points at
`src/bin/vitest-agent.ts`, which imports `main` from
`@vitest-agent/cli/main` and calls it with the carrier's identity as
`distribution` (`packages/plugin/src/bin/vitest-agent.ts`);
`bin.vitest-agent-mcp` points at `src/bin/vitest-agent-mcp.ts`, which
does the same for `@vitest-agent/mcp/main` with `void`
(`packages/plugin/src/bin/vitest-agent-mcp.ts`), matching the
`bin` field in `packages/plugin/package.json:27-30`. A consumer installs
only the plugin, and because the plugin is a *direct* dependency its bins
land in `node_modules/.bin` under every package manager — including
pnpm, which links direct-dependency bins only. The root `package.json`
devDependencies shrank to the plugin (plus the lint/build toolchain); the
`publicHoistPattern` entry and the direct cli/mcp root devDeps are gone.

Under npm, yarn (node-modules linker) and bun, which hoist transitive
bins, `@vitest-agent/cli`'s own `vitest-agent` bin may win the `.bin`
slot and shadow the carrier's same-named shim. Both call the same
`main()`, so only the `via @vitest-agent/plugin <version>` suffix on
`--version` differs; under pnpm's isolated layout the carrier's shim is
the only candidate. Keeping the front ends' own bins is deliberate — see
[Decision 73](73-adoption-helpers-live-in-the-kit.md).

**Packed-install e2e per package manager.**
`packages/plugin/__test__/bins-packed-install.e2e.test.ts` runs
`@effected/workspaces/testing`'s `PackedInstall.run`, which packs the
plugin and its runtime workspace closure from each package's
`dist/prod/npm/pkg` and installs the carrier tarball into a scratch
consumer under npm, pnpm, yarn and bun, with the closure overridden to
its tarballs. Per manager it asserts that `node_modules/.bin/vitest-agent`
and `vitest-agent-mcp` exist and are executable, that `vitest-agent
--version` exits 0 with a semver, that under pnpm it names the carrier
and `@vitest-agent/cli` is not linked at the consumer's top level, and that
`vitest-agent-mcp` passes `@effected/mcp/testing`'s
`McpProbe.initialize` with empty stderr and exit 0. The run passes
`allowSharedBins: true` and, under every manager, also runs the carrier's
own bins through its `bin` map (`consumer.runCarrierBin` /
`carrierCommand`), so the shim and its suffix are proven even where a
front end holds the `.bin` slot. This test needs `pnpm run build` (prod) and network, and is the proof
this pattern relies on rather than the dev workspace's own linked
`node_modules/.bin` — the release gate that follows from it is that
`@vitest-agent/engine` must publish before `@vitest-agent/plugin`, since
a consumer resolves it only via the tarball override until then.

**Dynamic `await import` is not a house pattern.** Static imports are
used everywhere else in the family; the sanctioned exceptions are mcp's
`main.ts` (crash guards must register before the server graph
evaluates), the pre-existing dynamic imports in
`tools/run-tests.ts` for `vitest/node`, and the reporter's lazy `ink`
load.

## Alternatives rejected

**Publicly hoisting the transitive cli/mcp packages via a pnpm plugin.**
This is what shipped before the carrier: `@savvy-web/pnpm-plugin-silk`
publicly hoisted `@vitest-agent/cli` and `@vitest-agent/mcp` so their
bins landed in `node_modules/.bin`, and the workspace root additionally
declared both as direct devDependencies with a matching
`publicHoistPattern` in `pnpm-workspace.yaml` purely so the dogfood hooks
could find them. Both were workarounds for the same underlying fact —
pnpm links only direct-dependency bins — and both depended on consumer
tooling (a pnpm plugin) that a bare `pnpm install` does not carry. The
carrier makes both unnecessary: once `@vitest-agent/plugin` declares the
bins itself as direct dependencies of the one package a consumer
installs, no hoist pattern or plugin is required under any package
manager, proven by the packed-install e2e suite across npm, pnpm, yarn
and bun.

**Package-manager-detect-and-exec loader.** An earlier plugin MCP loader
detected the consumer's package manager and re-executed itself as
`<pm-exec> vitest-agent-mcp` (`pnpm exec`, `npx --no-install`, `yarn
run`, `bun x`), on the theory that the package manager already knows how
to find and run project bins. That was only true because of the same
public-hoisting workaround; a bare pnpm consumer had no bin for `pnpm
exec` to find, and each manager's dispatch resolved differently. Once
the carrier declares the bin itself, `node_modules/.bin/vitest-agent-mcp`
exists under every manager and the loader execs it directly; package
manager detection survives only to word the install line in a
not-installed message.

## Consequences

`@vitest-agent/sdk` took a major version bump for the removed data-layer
exports and the `dispatch(argv, io)` / `FormatterContext.cwd` signature
changes; `@vitest-agent/engine` is new; `@vitest-agent/cli` and
`@vitest-agent/mcp` lost the re-exports that moved into engine and gained
a `./main` subpath; `@vitest-agent/plugin` gained two bins it did not
carry before. The engine's project-dir and path-resolution programs
require `HOME` / `USERPROFILE` in the passed-in env map where the
previous code read `os.homedir()` directly and could not fail the same
way, so every hook environment must carry `HOME`. Follow-ups from this
restructuring — the reporter/MCP-versus-hook XDG fallback split, an
`std-env` module-load env read the boundary scanner cannot see, a
Windows drive-letter gap in the terminal formatter's OSC-8 check, and a
`packages/ui/biome.json` schema-version notice — were filed as GitHub
issues rather than folded into this decision.

## Related

- [Ranked Layering](../invariants/ranked-layering.md)
- [Package Boundaries](../invariants/package-boundaries.md)
- [Carrier](../glossary/carrier.md)
- [`@vitest-agent/plugin`](../modules/plugin.md)
- [Front-End Entry Contract](../conventions/front-end-entry-contract.md)
- [Decision 72: Adopt the Effected Front-End Kit](72-adopt-the-effected-front-end-kit.md)
- [Decision 73: Adoption Helpers Live in the Kit](73-adoption-helpers-live-in-the-kit.md)
- [XDG Fallback Split](../gotchas/xdg-fallback-split.md)
