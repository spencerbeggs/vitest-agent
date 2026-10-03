---
type: Decision
status: stable
title: Package Split
description: Eight ranked workspaces under packages/ split platform-free core from platform services and front ends, with the plugin as carrier depending on cli, mcp, reporter, and engine.
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-10-03T03:37:35Z
  body_sha256: b9bc331c42c316b7c2d0de11145f90fce484af6ba49451a4a7f404974bacf00b
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Package Split

## Context

The dependency graph is a ranked DAG (see [Decision 70](./70-carrier-pattern-and-ranked-layering.md))
across eight publishable workspaces under `packages/` plus four
per-platform sidecar children. Two independent chains run through it: a
rendering chain (`plugin → reporter → ui → sdk`) and a data chain
(`plugin → {cli, mcp} → engine → sdk`). An earlier form of this split had
the root `package.json` declare `@vitest-agent/cli` and `@vitest-agent/mcp`
directly as devDependencies plus a `publicHoistPattern` in
`pnpm-workspace.yaml` so their bins landed in `node_modules/.bin`, with
published consumers relying on a separate pnpm plugin to hoist the same
bins publicly; the carrier pattern made both unnecessary.

## Decision

Eight workspaces live under `packages/`:

| Package | Role |
| --- | --- |
| `@vitest-agent/sdk` | platform-free core: schemas, contracts, errors, pure utils, the pure `./dispatch` entry, `./schemas/*.json` — no internal workspace deps, no `node:` imports |
| `@vitest-agent/engine` | platform half: services, Live layers, SQLite stack and migrations, `PlatformLive`, `resolveProjectDir`, hook programs, session recovery, `./testing`; depends on sdk |
| `@vitest-agent/plugin` | `AgentPlugin`, internal `AgentReporter`, `ReporterLive`, `CoverageAnalyzer`; the carrier — declares the `vitest-agent` and `vitest-agent-mcp` bins as shims over `@vitest-agent/cli/main` and `@vitest-agent/mcp/main`; depends on cli, mcp, reporter, engine and sdk, not ui |
| `@vitest-agent/reporter` | the default reporter package: `DefaultVitestAgentReporter` (owns the Ink live mount), contract re-exports, dispatch helpers; declares `react` and `ink` as full `dependencies`; depends on ui and sdk |
| `@vitest-agent/ui` | pure rendering-primitives library (reducer, shape-tailored dispatcher matrix, synthesizers); depends on sdk; `ink`/`react` are `peerDependencies` |
| `@vitest-agent/cli` | `vitest-agent` bin; depends on engine, sdk, and sidecar |
| `@vitest-agent/mcp` | `vitest-agent-mcp` bin; depends on engine and sdk |
| `@vitest-agent/sidecar` | per-Bash `inject-env` fast-path native binary resolver; the four `sidecar-*` platform children are its `optionalDependencies`; a regular `dependency` of `@vitest-agent/cli` |

`@vitest-agent/plugin`'s `dependencies` list `@vitest-agent/cli`,
`@vitest-agent/engine`, `@vitest-agent/mcp`, `@vitest-agent/reporter` and
`@vitest-agent/sdk` (`packages/plugin/package.json`) and no `ui`
entry — the plugin imports the default reporter from
`@vitest-agent/reporter` and touches no JSX itself.
`@vitest-agent/reporter`'s `dependencies` carry `ink` and `react` as full
runtime dependencies (`packages/reporter/package.json`), while
`@vitest-agent/ui` keeps the same two packages as `peerDependencies`
(`packages/ui/package.json`). `@vitest-agent/sdk`'s `exports` map
publishes a dedicated pure `./dispatch` entry
(`packages/sdk/package.json`) backed by `src/dispatch.ts`, which
re-exports `dispatch`, `injectEnv`, and `exitCodeForTag`
(`packages/sdk/src/dispatch.ts`) — the sidecar dispatch core the
per-platform `sidecar-*` children depend on, so there is no workspace
dependency cycle back through the CLI. `@vitest-agent/cli`'s
`dependencies` list `@vitest-agent/sidecar` alongside engine and sdk
(`packages/cli/package.json`); `@vitest-agent/sidecar`'s
`optionalDependencies` list the four platform children
(`packages/sidecar/package.json`).

The root `package.json` lists only `@vitest-agent/plugin` as a workspace
devDependency (`package.json`), and `pnpm-workspace.yaml` carries no
`publicHoistPattern` — the carrier declares the two bins directly
(Decision 70), so nothing needs hoisting for either the dogfood hooks or a
published consumer.

Every `@vitest-agent/*` package versions independently — changesets
carries no `fixed`/`linked` grouping, so a bump to one package does not
force the rest (see [Decision 36](./36-independent-per-package-release.md)).

**Why this split.** The core/engine boundary is "does it touch a
platform" — `node:*`, `@effect/platform-node`, SQLite, `@effected/*`,
`process` — enforced by per-package boundary tests, so the sidecar
binary, the `ui` package, and any schema consumer can depend on the core
without pulling in a data layer. The engine boundary is "what does more
than one front end need": services, layers, migrations, the one platform
assembly, and the hook programs both the CLI commands and the MCP tools
wrap. The CLI/MCP split is a module-boundary decision: the
`effect/cli` surface is the CLI's own concern and the
`effect/ai` `McpServer` surface is the MCP server's own concern,
so each keeps its dependency surface in its own package and neither
imports the other.

**Why regular deps for cli and mcp (vs required peers).** Every plugin
consumer needs both packages — for the bin invocations the reporter's
"Next steps" output suggests, and for the MCP server the Claude Code
plugin needs. They were previously required `peerDependencies` promoted
at build by a manifest transform, on the theory that only an
auto-installed peer lands its bin at the consumer's top level. That
promotion was removed because pnpm's `autoInstallPeers` resolution of the
plugin's cli/mcp peers forced wrong Effect versions into consuming
repositories. Both now publish as exact-pinned regular `dependencies` —
the default manifest transform rewrites the source `workspace:*` protocol
to the exact current version at publish. The changesets ripple is
unchanged: a cli/mcp release pushes the plugin's `workspace:*` dependency
range out of bounds and auto-PATCH-bumps the plugin via
`updateInternalDependencies: "patch"` (`.changeset/config.json`),
re-pinning the exact version (see Decision 36).

## Alternatives rejected

- **Root devDependencies on `@vitest-agent/cli`/`@vitest-agent/mcp` plus a
  `publicHoistPattern`, with a separate pnpm plugin publicly hoisting the
  same bins for consumers**: rejected because both were workarounds for
  pnpm's direct-dependency-only bin linking, and the carrier makes them
  unnecessary — `@vitest-agent/plugin` declares both bins itself, so
  installing the plugin is sufficient under npm, pnpm, yarn, and bun alike.
- **Required `peerDependencies` on cli/mcp, promoted from `workspace:*` at
  build time**: rejected because pnpm's `autoInstallPeers` resolution
  forced incompatible Effect versions into consuming repositories; regular
  exact-pinned `dependencies` avoid the peer-resolution step entirely.

## Consequences

- Every source `package.json` stays `private: true` — the bundler
  transforms each on publish — and consumers importing schemas do so from
  `@vitest-agent/sdk`, while consumers of the data layer or testing
  presets import from `@vitest-agent/engine` / `@vitest-agent/engine/testing`.
- A new dependency edge from a lower-ranked package to a higher-ranked one
  (e.g. `sdk` importing from `engine`) breaks the boundary tests before it
  reaches review; see [Invariant: Ranked Layering](../invariants/ranked-layering.md)
  and [Invariant: Package Boundaries](../invariants/package-boundaries.md).
- Because cli/mcp are regular dependencies rather than peers, a plugin
  install always drags in a working, exact-pinned CLI and MCP server —
  there is no scenario where a consumer's own peer resolution leaves
  either bin missing or mismatched.

## Related

- [Decision 70 — Carrier Pattern and Ranked Layering](./70-carrier-pattern-and-ranked-layering.md)
- [Decision 34 — Plugin/Reporter Split](./34-plugin-reporter-split.md)
- [Decision 36 — Independent Per-Package Release](./36-independent-per-package-release.md)
