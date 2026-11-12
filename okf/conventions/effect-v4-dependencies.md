---
type: Convention
title: Reach for effect/cli, effect/sql, and effect/ai, not a v3 @effect/* package
description: "Effect v4 collapsed the standalone @effect/cli, @effect/sql, and @effect/ai packages into the effect/cli, effect/sql, and effect/ai subpaths of the effect package itself; only @effect/platform-node and @effect/sql-sqlite-node remain separate. Every Effect-family and @effected kit dependency comes from the one effected catalog: catalog:effected:exact in a published package's dependencies and optionalDependencies, catalog:effected:peers in peerDependencies, catalog:effected in devDependencies."
tags: [effect, deps, compat]
status: stable
stale_after: 2027-03-13T00:00:00Z
sources:
  - id: pnpm-workspace-config-deps
    resource: ../../pnpm-workspace.yaml
    title: "pnpm-workspace.yaml configDependencies (the plugins that supply the effected and silk catalogs)"
  - id: cli-package-json
    resource: ../../packages/cli/package.json
  - id: cli-main-effect-cli
    resource: ../../packages/cli/src/main.ts
  - id: cli-db-effect-sql
    resource: ../../packages/cli/src/commands/db.ts
  - id: mcp-tdd-goal-effect-ai
    resource: ../../packages/mcp/src/tools/tdd-goal.ts
  - id: mcp-run-tests-platform-node-subpaths
    resource: ../../packages/mcp/src/tools/run-tests.ts
  - id: plugin-package-json
    resource: ../../packages/plugin/package.json
  - id: ui-package-json
    resource: ../../packages/ui/package.json
  - id: kit-closure-pins-test
    resource: ../../packages/plugin/__test__/kit-closure-pins.test.ts
    title: The kit-closure exact-pin guardrail (effected upgrade ledger entry 0011)
  - id: pnpm-plugin-effected
    resource: npm:@effected/pnpm-plugin-effected
    title: "@effected/pnpm-plugin-effected README (the effected, effected:peers, effected:build and effected:exact catalogs)"
generated:
  by: okfit/claude-code
  at: 2026-11-12T02:39:17Z
integrity:
  generated:
    body: 85faf8272d79507d
---

# Reach for effect/cli, effect/sql, and effect/ai, not a v3 @effect/* package

Effect v4 folded the standalone v3 packages `@effect/cli`, `@effect/sql`,
and `@effect/ai` into subpaths of the core `effect` package itself:
`effect/cli`, `effect/sql`, and `effect/ai` (and `effect/process` for
spawning). Reach for those subpaths, never a `@effect/cli`-shaped v3 package —
none of the three exists as an installable package on the v4 line, and a
v3 release of any of them peers on `effect ^3.x`, which is incompatible
with this repository's v4 pin. Nor reach for an `effect/unstable/*`
specifier: the pinned `effect` release exports no `unstable` subpath, so
an import copied from older Effect v4 material fails to resolve.

## What still ships separately

Exactly two packages remain outside the `effect` package on this line:
`@effect/platform-node` and `@effect/sql-sqlite-node`. Every workspace
package that touches the filesystem, spawns a process, or talks to
SQLite depends on one or both of these as ordinary npm packages, drawn
from the one `effected` catalog — for example
`packages/cli/package.json` declares `"@effect/platform-node":
"catalog:effected:exact"` and `"@effect/sql-sqlite-node":
"catalog:effected:exact"` alongside `"effect": "catalog:effected:exact"`
itself[^cli-package-json]. Every other Effect-shaped dependency in this
family, and every `@effected/*` kit package, comes from the same catalog;
`catalog:silk` is a distinct, older v3-era catalog and must never be used
for an Effect package.

Import `@effect/platform-node` through its module subpaths
(`@effect/platform-node/NodeFileSystem`, `@effect/platform-node/NodePath`,
and so on), never the package root[^mcp-run-tests-platform-node-subpaths].
The root re-exports `NodeRedis`, which imports the optional `redis` peer,
so a consumer whose package manager skips that peer crashes at startup
with a missing `redis` module.

## Where the catalog values come from

This repository does not declare a static `catalogs:` block in
`pnpm-workspace.yaml`. Instead, `pnpm-workspace.yaml`'s
`configDependencies` installs `@effected/pnpm-plugin-effected` and
`@savvy-web/pnpm-plugin-silk` before the workspace resolves, and those
plugins are what supply the `catalog:effected` and `catalog:silk` entries
every package's `dependencies` block resolves against[^pnpm-workspace-config-deps].
`@effected/pnpm-plugin-effected` serves one catalog family, `effected`,
covering both the Effect family (`effect`, `@effect/platform-node`,
`@effect/sql-sqlite-node`) and the `@effected` kit, in four
variants[^pnpm-plugin-effected]:

| Specifier | What it packs | Write it in |
| --- | --- | --- |
| `catalog:effected:exact` | Every entry as a plain exact version, operators stripped | A published package's `dependencies` and `optionalDependencies` on `effect`, `@effect/*`, `@effected/*` |
| `catalog:effected:peers` | `effect` floored to `~4.<minor>.0`, each `@effected/*` to `^0.<minor>.0` | `peerDependencies` |
| `catalog:effected` | `effect` and `@effect/*` exact, each `@effected/*` with a caret | `devDependencies`, and the private root and harness packages |
| `catalog:effected:build` / `catalog:effected:build:peers` | The build and UI toolchain (`typescript`, `@types/*`, `react`, `ink`) | `dependencies` or `devDependencies` / `peerDependencies` of a toolchain package |

There is no `catalog:effect` or `catalog:effect:peers`, and a specifier
naming one fails the install. A package that needs a new Effect-family or
kit dependency writes the catalog specifier for its field and lets the
plugin resolve the actual pinned version — never a literal version number
for one of these packages. `ink` comes from `catalog:effected:build`
(`catalog:effected:build:peers` for `@vitest-agent/ui`'s optional peer),
the same catalog as `react`, not from `catalog:silk`[^ui-package-json].

The catalog pins `effect` and every `@effect/*` package to one exact
version graph-wide, so a new Effect release never arrives through an
ordinary install or update. Moving to it means bumping
`@effected/pnpm-plugin-effected` in `configDependencies` to the release
that carries it, which arrives together with the kit's matching round of
releases. The build toolchain resolves the same Effect version; the
lockfile carries no second `effect` entry and the root needs no
`.pnpmfile.cjs` bridge.

## Pin the published closure exactly

In every published `@vitest-agent/*` package (`sdk`, `ui`, `engine`,
`reporter`, `sidecar`, `cli`, `mcp`, `plugin`), write each `dependencies`
or `optionalDependencies` entry on `effect`, `@effect/*` or `@effected/*`
as `catalog:effected:exact`, never `catalog:effected`; for example
`packages/plugin/package.json` writes `effect`, `@effect/platform-node`
and all six of its `@effected/*` runtime dependencies that
way[^plugin-package-json]. `catalog:effected` packs a caret on every
`@effected/*` entry, so a kit patch would reach an installed carrier
without a release of it. With exact pins, the installed
`@vitest-agent/plugin` keeps the Effect and kit copies its own release was
tested against, and installs beside an app on any other kit or Effect
release: the closure is tool code and shares no service, schema or brand
with the host app.

Keep `peerDependencies` on `catalog:effected:peers` (`@vitest-agent/ui`
and `@vitest-agent/reporter` peer on `@effected/cli-kit`, `env`, `glob`
and `walker`); the carrier declares exact copies of each, so those peers
resolve to the pinned versions. Keep `devDependencies` on
`catalog:effected`. Expect every kit release inside the closure to ripple
a patch release to the carrier.

`packages/plugin/__test__/kit-closure-pins.test.ts` fails on any other
specifier[^kit-closure-pins-test]; see [Invariant: kit closure
pins](../invariants/kit-closure-pins.md) for what it checks and what the
pins still cannot hold.

## Reach for the core subpaths, in practice

`packages/cli/src/main.ts` imports `Command` from
`"effect/cli"`[^cli-main-effect-cli] to build the CLI's
command tree; `packages/cli/src/commands/db.ts` imports `SqlClient`
from `"effect/sql/SqlClient"`[^cli-db-effect-sql] for the
`db query` command; `packages/mcp/src/tools/tdd-goal.ts` imports `Tool`
from `"effect/ai"`[^mcp-tdd-goal-effect-ai] to declare a tool
served by Effect's own `McpServer` rather than the MCP SDK. Every one
of these is a subpath of the single `effect` package pinned through the `effected` catalog — none is a separate
package requiring its own catalog entry or version pin.

See [Decision 46](../decisions/46-effect-v4-effected-kit-behavior-changes.md)
for the fuller rationale behind the v4 + `@effected` kit migration this
convention is downstream of.

[^pnpm-workspace-config-deps]: ../../pnpm-workspace.yaml
[^cli-package-json]: ../../packages/cli/package.json
[^cli-main-effect-cli]: ../../packages/cli/src/main.ts
[^cli-db-effect-sql]: ../../packages/cli/src/commands/db.ts
[^mcp-tdd-goal-effect-ai]: ../../packages/mcp/src/tools/tdd-goal.ts
[^mcp-run-tests-platform-node-subpaths]: ../../packages/mcp/src/tools/run-tests.ts
[^plugin-package-json]: ../../packages/plugin/package.json
[^ui-package-json]: ../../packages/ui/package.json
[^kit-closure-pins-test]: `../../packages/plugin/__test__/kit-closure-pins.test.ts`
[^pnpm-plugin-effected]: npm:@effected/pnpm-plugin-effected
