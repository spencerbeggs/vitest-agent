---
type: Convention
title: Reach for effect/cli, effect/sql, and effect/ai, not a v3 @effect/* package
description: "Effect v4 collapsed the standalone @effect/cli, @effect/sql, and @effect/ai packages into the effect/cli, effect/sql, and effect/ai subpaths of the effect package itself; only @effect/platform-node and @effect/sql-sqlite-node remain separate, and every dependency, Effect family and @effected kit alike, pins through the one catalog:effected catalog."
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
generated:
  by: okfit/claude-code
  at: 2026-10-31T21:28:19Z
integrity:
  generated:
    body: b6b9be52f013ee47
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
an import copied from older Effect v4 material fails to resolve. Property
test arbitraries come from the core `Arbitrary` export of `"effect"`.

## What still ships separately

Exactly two packages remain outside the `effect` package on this line:
`@effect/platform-node` and `@effect/sql-sqlite-node`. Every workspace
package that touches the filesystem, spawns a process, or talks to
SQLite depends on one or both of these as ordinary npm packages, pinned
through the one `catalog:effected` catalog — for example
`packages/cli/package.json` declares `"@effect/platform-node":
"catalog:effected"` and `"@effect/sql-sqlite-node": "catalog:effected"`
alongside `"effect": "catalog:effected"` itself[^cli-package-json]. Every
other Effect-shaped dependency in this family, and every `@effected/*`
kit package, pins through the same catalog; `catalog:silk` is a distinct,
older v3-era catalog and must never be used for an Effect package.

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
`@effected/pnpm-plugin-effected` serves exactly one catalog, `effected`,
covering both the Effect family (`effect`, `@effect/platform-node`,
`@effect/sql-sqlite-node`) and the `@effected` kit; there is no
`catalog:effect`, `catalog:effect:peers`, or `catalog:effected:peers`, and
a specifier naming one fails to resolve. A package that needs a new
Effect-family or kit dependency writes `"catalog:effected"` as the version
string and lets the plugin resolve the actual pinned version — never a
literal version number for one of these packages.

The catalog holds the Effect family to one minor (`~4.1.1`), not a caret,
so a new Effect minor never arrives through an ordinary install or update.
Moving to the next minor (4.2) means bumping
`@effected/pnpm-plugin-effected` in `configDependencies` to the release
that carries it, which arrives together with the kit's matching round of
releases. The build toolchain's older kit is bridged separately; see
[Gotcha: Effect 4.0 toolchain bridge](../gotchas/effect-4-0-toolchain-bridge.md).

## Reach for the core subpaths, in practice

`packages/cli/src/main.ts` imports `Command` from
`"effect/cli"`[^cli-main-effect-cli] to build the CLI's
command tree; `packages/cli/src/commands/db.ts` imports `SqlClient`
from `"effect/sql/SqlClient"`[^cli-db-effect-sql] for the
`db query` command; `packages/mcp/src/tools/tdd-goal.ts` imports `Tool`
from `"effect/ai"`[^mcp-tdd-goal-effect-ai] to declare a tool
served by Effect's own `McpServer` rather than the MCP SDK. Every one
of these is a subpath of the single `effect` package pinned via `catalog:effected` — none is a separate
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
