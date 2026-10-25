---
type: Decision
title: Ranked Carrier Package Graph with Kit-Owned Environment Detection
description: "The workspace stays a rank-ordered dependency graph (sdk at rank 1 through the plugin carrier at rank 5) whose carrier declares both bins directly so pnpm's direct-dependency-only bin linking works without hoisting tricks; environment detection runs on @effected/env's RuntimeEnv and Audience from the injected env map rather than std-env's module-load reads, six packages carry boundary scans, and the packed-install e2e is replaced by a static import check."
status: draft
supersedes: 70-carrier-pattern-and-ranked-layering.md
tags:
  - architecture
  - deps
  - release
generated:
  by: okfit/claude-code
sources:
  - id: plugin-package-json
    resource: ../../packages/plugin/package.json
  - id: plugin-bin-shims
    resource: ../../packages/plugin/src/bin
  - id: workspace-layering-test
    resource: ../../packages/plugin/__test__/workspace-layering.test.ts
  - id: layers-json
    resource: ../../layers.json
  - id: undeclared-imports-test
    resource: ../../packages/plugin/__test__/undeclared-imports.test.ts
  - id: engine-environment-detector-live
    resource: ../../packages/engine/src/layers/EnvironmentDetectorLive.ts
  - id: engine-executor-resolver-live
    resource: ../../packages/engine/src/layers/ExecutorResolverLive.ts
  - id: engine-boundaries
    resource: ../../packages/engine/__test__/boundaries.test.ts
  - id: reporter-live-view
    resource: ../../packages/reporter/src/liveView.ts
  - id: mcp-main
    resource: ../../packages/mcp/src/main.ts
  - id: pr-539
    resource: https://github.com/spencerbeggs/vitest-agent/pull/539
    title: "feat!: adopt the @effected interactive CLI kit and Effect 4.0.0"
  - id: issue-550
    resource: https://github.com/spencerbeggs/vitest-agent/issues/550
---

# Ranked Carrier Package Graph with Kit-Owned Environment Detection

## Context

[Decision 70](70-carrier-pattern-and-ranked-layering.md) restructured the
family into a ranked graph with a carrier, and recorded the state of the
world at that split: the shared package had mixed pure schemas with
SQLite, `@effect/platform-node`, `@effected/xdg` and `std-env`, and one of
the follow-ups it filed was an `std-env` module-load environment read
that the boundary scanner could not see. Pull request 539 moved the family
onto the `@effected` kit and Effect 4.0.0, and with it environment
detection moved onto `@effected/env`: the engine no longer depends on
`std-env` at all, and the agent/CI/human split is the kit's `Audience`,
read from the injected env map.[^pr-539] Four boundary scans became six,
and the packed-install e2e that proved the carrier was retired for a
static check ([Decision 85](85-consumer-install-guard.md)). The graph,
the carrier, and the entry contract did not change. Decision 70 is a
human-verified record of the split as it was made, so rather than edit
it into the present, this Decision restates the choice with the current
facts and deprecates it.[^issue-550]

## Decision

The package graph is a carrier pattern: one platform-free core, one
platform half, two process-owning front ends with a fixed entry contract,
and a single top-of-graph carrier whose bins reach every consumer without
package-manager hoisting tricks.

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
a `tooling` entry for the agent plugin's tracking package
`@vitest-agent/ai-plugins` and an `unconstrained` list for the private
root, `docs` and `playground`), and
`packages/plugin/__test__/workspace-layering.test.ts` holds the live
package graph to it through `@effected/workspaces/testing`'s
`WorkspaceLayering`.[^layers-json][^workspace-layering-test] Every package
must be classified, and every `dependencies` / `optionalDependencies` /
`peerDependencies` edge must point to a strictly lower layer, never within
one, so the two front ends cannot depend on each other; `requiredEdges`
pins the edges the carrier pattern relies on, and a separate assertion
keeps the graph acyclic across all four fields. See [Invariant: Ranked
Layering](../invariants/ranked-layering.md). It lives in the carrier's
test tree because the carrier already depends on everything and
root-level tests are not discovered by the classifier.

**`@vitest-agent/sdk` keeps its name and is the core.** The package that
ships `./schemas/*.json` and `RUN_REPORT_FILE_SCHEMA_URL` kept its npm
name so every consumer's `from "@vitest-agent/sdk"` schema import stayed
valid — the *name* stays with the pure half and the platform half is the
newer package. The core holds the pure schemas, errors, formatters,
utils, the `./dispatch` entry and the JSON Schema documents; it has no
service, layer, SQL/migration, or platform util that reads `process` or
touches the filesystem.

**`@vitest-agent/engine` is the platform half.** It holds the services and
Live layers, the SQLite assembly, migrations, one `PlatformLive` factory
that both front ends build from, one `resolveProjectDir({ env, cwd })`
with a four-name precedence (`VITEST_AGENT_PROJECT_DIR` →
`VITEST_AGENT_REPORTER_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → `cwd`), the
hook programs, and the MCP server's session-env recovery, so both front
ends are thin command and transport wrappers.

**Environment detection is the kit's, from the injected map.**
`EnvironmentDetectorLive(env)` is built on `@effected/env`'s
`CurrentRuntimeEnv.layerFrom(env)`, a fresh snapshot per layer build taken
from the map the front end passes in (`process.env` at the entry point),
never from the ambient process and never at module load.
`classifyEnvironment(runtime: RuntimeEnv)` maps `Audience.detect` (agent
beats CI beats human) onto the four engine environments — `agent-shell`,
`ci-github`, `ci-generic`, `terminal` — refining CI through an exhaustive
table over `@effected/env`'s literal `CiName`, so a new vendor name fails
the type check instead of falling through.[^engine-environment-detector-live]
`ExecutorResolverLive` maps those four environments onto the kit's
three-way `AudienceKind` (`human` / `agent` / `ci`) through a
`Record<Environment, AudienceKind>`, so the executor union cannot drift
from the kit's audience union.[^engine-executor-resolver-live] The plugin,
the CLI and the MCP server all read the same layer, and the
`VITEST_AGENT_CONSOLE` override is read through the same package's
`EnvOverride` ([Decision 86](86-console-matrix-kit-live-view.md)). The
`std-env` follow-up Decision 70 filed is closed by construction: there is
no module-load env read left for a boundary scan to miss.

**Boundary tests, one per package, six packages.** Each of sdk, engine,
cli, mcp, ui and reporter carries `__test__/boundaries.test.ts` over
`@effected/workspaces/testing`'s `SourceBoundary.scan`: sdk may not
import `node:*`, `@effect/platform-node`, `@effect/sql-sqlite-node` or any
`@effected/*` package, and may not reference `process.`; engine may not
reference `process.` anywhere, with no allowlist, and may not import a
front end;[^engine-boundaries] cli and mcp read `process` only through
narrow allowlists (`main.ts`, plus `commands/**` for cli and
`tools/run-tests.ts` for mcp) and never import each other, and mcp keeps
stdout clean; ui imports `ink` and `react` only under `src/ink/`; reporter
imports them only in its two lazily loaded view modules. The single
exemption everywhere is the exact token `process.env.__PACKAGE_VERSION__`,
a compile-time literal the bundler substitutes, which a `forbidTokens`
rule confines to each package's `version.ts`. See [Invariant: Package
Boundaries](../invariants/package-boundaries.md).

**`./dispatch` stays in sdk and is pure.** `dispatch(argv, io)` takes
`io = { cwd, env, readFile }`, so the four sidecar bins and the CLI's
`agent inject-env` command pass the platform bindings in rather than the
core reading them itself. The sidecar SEA bundle therefore reaches
nothing platform-bound from the core.

**Front-end entry contract.** Each of `cli` and `mcp` ships three files:
`src/bin.ts` is a shebang shim that imports and calls `main` from
`./main.js`; `src/main.ts` owns the process (every `process` read, the
runtime entry, teardown) and is published as the `./main` subpath;
`src/index.ts` is a side-effect-free barrel that never imports `main.ts`,
so a library consumer's import graph never pulls in the process-owning
module. `src/version.ts` holds `CURRENT_<PKG>_VERSION`.
`packages/mcp/src/main.ts` follows the contract with a documented
deviation: it carries no static imports of the server graph at all (only
the dependency-free `@effected/mcp/guard`), because the crash guards
`McpGuard.run` registers must exist before anything that could throw
during module evaluation.[^mcp-main] See [Convention: Front-End Entry
Contract](../conventions/front-end-entry-contract.md).

**The carrier.** `@vitest-agent/plugin` declares both bins itself as
thin shims: `bin.vitest-agent` points at `src/bin/vitest-agent.ts`, which
imports `main` from `@vitest-agent/cli/main` and calls it with the
carrier's identity as `distribution`; `bin.vitest-agent-mcp` points at
`src/bin/vitest-agent-mcp.ts`, which does the same for
`@vitest-agent/mcp/main`.[^plugin-bin-shims][^plugin-package-json] A
consumer installs only the plugin, and because the plugin is a *direct*
dependency its bins land in `node_modules/.bin` under every package
manager — including pnpm, which links direct-dependency bins only. The
root `package.json` devDependencies hold the plugin (plus the lint/build
toolchain); there is no `publicHoistPattern` and no direct cli/mcp root
devDependency.

Under npm, yarn (node-modules linker) and bun, which hoist transitive
bins, `@vitest-agent/cli`'s own `vitest-agent` bin may win the `.bin`
slot and shadow the carrier's same-named shim. Both call the same
`main()`, so only the `via @vitest-agent/plugin <version>` suffix on
`--version` differs; under pnpm's isolated layout the carrier's shim is
the only candidate. Keeping the front ends' own bins is deliberate — see
[Decision 73](73-adoption-helpers-live-in-the-kit.md).

**Proven once by a packed install, guarded now statically.** When the
carrier was adopted, a packed-install e2e installed the carrier tarball
into a scratch consumer under npm, pnpm, yarn and bun and asserted the
bins existed, ran, named the carrier under pnpm, and passed an MCP
`initialize` probe. That suite was retired in issue 574 for
`packages/plugin/__test__/undeclared-imports.test.ts`, which runs
`ImportGraph.undeclared` over every workspace package's `src/` so a
runtime import of a devDependency or a root-only package is caught
without an install; [Decision 85](85-consumer-install-guard.md) records
why.[^undeclared-imports-test] The release gate that
`@vitest-agent/engine` must publish before `@vitest-agent/plugin` still
holds, because the carrier pins engine exactly.

**Dynamic `await import` is not a house pattern.** Static imports are
used everywhere else in the family; the sanctioned exceptions are mcp's
`main.ts` (crash guards must register before the server graph
evaluates), the `vitestLoader` seam in `tools/run-tests.ts` for the
consumer's `vitest/node` entry, and the reporter's two lazy view loads
(`liveView.ts` through `CliUi.lazyView`, and `defaultReporter.ts`'s
`humanReport.ts`), so importing the reporter never loads React or
Ink.[^reporter-live-view]

## Alternatives rejected

**Publicly hoisting the transitive cli/mcp packages via a pnpm plugin.**
This is what shipped before the carrier: `@savvy-web/pnpm-plugin-silk`
publicly hoisted `@vitest-agent/cli` and `@vitest-agent/mcp` so their
bins landed in `node_modules/.bin`, and the workspace root additionally
declared both as direct devDependencies with a matching
`publicHoistPattern` in `pnpm-workspace.yaml` purely so the dogfood hooks
could find them. Both were workarounds for the same underlying fact —
pnpm links only direct-dependency bins — and both depended on consumer
tooling a bare `pnpm install` does not carry. The carrier makes both
unnecessary.

**Package-manager-detect-and-exec loader.** An earlier plugin MCP loader
detected the consumer's package manager and re-executed itself as
`<pm-exec> vitest-agent-mcp`. That was only true because of the same
public-hoisting workaround, and each manager's dispatch resolved
differently. Once the carrier declares the bin itself,
`node_modules/.bin/vitest-agent-mcp` exists under every manager and the
loader execs it directly; package manager detection survives only to word
the install line in a not-installed message.

**Keep `std-env` for detection beside the kit.** Rejected because
`std-env` reads `process.env` when its module loads, which the
engine's source-scan boundary cannot see and which contradicts the rule
that every ambient input is a parameter; `@effected/env` takes the map as
an argument and the whole family already agrees on its `Audience`.

**Edit Decision 70 in place.** Rejected because it was human-verified
against a different detection library and a different proof of the
carrier; a verified record is deprecated and replaced, not rewritten.

## Consequences

`@vitest-agent/sdk` took a major version at the split for the removed
data-layer exports and the `dispatch(argv, io)` signature; `cli` and `mcp`
carry a `./main` subpath; the plugin carries two bins. The engine's
project-dir and path-resolution programs require `HOME` / `USERPROFILE` in
the passed-in env map, so every hook environment must carry `HOME`.
Environment detection changes with `@effected/env`: a new CI vendor the
kit learns to name is a compile error in `classifyEnvironment`'s table
until the engine maps it, which is the intended coupling. A new workspace
package needs a `layers.json` entry (a layer, `tooling`, or an
`unconstrained` glob) before the layering test passes. Decision 70 is
deprecated; everything here that is not about detection, the boundary
scan count, or the retired e2e is carried from it in substance.

## Related

- [Decision 70 — Carrier Pattern and Ranked Layering](70-carrier-pattern-and-ranked-layering.md) (superseded)
- [Ranked Layering](../invariants/ranked-layering.md)
- [Package Boundaries](../invariants/package-boundaries.md)
- [Declared Runtime Imports](../invariants/declared-runtime-imports.md)
- [Carrier](../glossary/carrier.md)
- [`@vitest-agent/plugin`](../modules/plugin.md)
- [`@vitest-agent/engine`](../modules/engine.md)
- [Front-End Entry Contract](../conventions/front-end-entry-contract.md)
- [Decision 73: Adoption Helpers Live in the Kit](73-adoption-helpers-live-in-the-kit.md)
- [Decision 85: Replace the Packed-Install E2E with a Static Undeclared-Import Check](85-consumer-install-guard.md)
- [Decision 86: Per-Executor Console Matrix with a Kit-Owned Live View](86-console-matrix-kit-live-view.md)
- [XDG Fallback Split](../gotchas/xdg-fallback-split.md)

[^plugin-package-json]: `../../packages/plugin/package.json`
[^plugin-bin-shims]: `../../packages/plugin/src/bin`
[^workspace-layering-test]: `../../packages/plugin/__test__/workspace-layering.test.ts`
[^layers-json]: `../../layers.json`
[^undeclared-imports-test]: `../../packages/plugin/__test__/undeclared-imports.test.ts`
[^engine-environment-detector-live]: `../../packages/engine/src/layers/EnvironmentDetectorLive.ts`
[^engine-executor-resolver-live]: `../../packages/engine/src/layers/ExecutorResolverLive.ts`
[^engine-boundaries]: `../../packages/engine/__test__/boundaries.test.ts`
[^reporter-live-view]: `../../packages/reporter/src/liveView.ts`
[^mcp-main]: `../../packages/mcp/src/main.ts`
[^pr-539]: <https://github.com/spencerbeggs/vitest-agent/pull/539>
[^issue-550]: <https://github.com/spencerbeggs/vitest-agent/issues/550>
