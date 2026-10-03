---
type: Gotcha
title: Effect.provide reuses the inherited layer memo map
description: "Providing a second layer inside a handler that already runs under a platform layer looks like it builds that second layer fresh, but a plain Effect.provide reuses the fiber's inherited MemoMap, so any shared module-level layer constant is a memo hit and the handler silently talks to the outer platform's service; pass { local: true }."
resource: ../../packages/cli/src/commands/agent.ts
status: draft
tags: [effect, architecture]
stale_after: "2027-04-03T00:00:00Z"
generated:
  by: okfit/claude-code
  at: 2026-10-03T19:28:10Z
  body_sha256: 79821382726a8e6881ba74ac1a704a4977b4cb4c275af0c4edc99d23294d57e9
sources:
  - id: agent-ts
    resource: ../../packages/cli/src/commands/agent.ts
  - id: platform-sidecar
    resource: ../../packages/engine/src/programs/platform-sidecar.ts
  - id: project-key-e2e
    resource: ../../packages/cli/__test__/agent-project-key.e2e.test.ts
---

# Effect.provide reuses the inherited layer memo map

## What you see

A command handler runs under a platform layer (for example a CLI root
platform that includes the engine's `DataStore`) and, inside the handler,
provides a different layer that builds the same service over a different
resource: `program.pipe(Effect.provide(SidecarPlatformLive(paths, env)))`,
where `paths` names the `--project-key` database. The command exits `0`,
and the rows are nowhere in the `--project-key` database.

## What you will wrongly conclude

That the inner layer was built and the write was lost, or that path
resolution picked the wrong file. Both look plausible, because the inner
layer constructs its own SQLite client over the right path.

## What is actually true

In Effect v4 a plain `Effect.provide(layer)` builds `layer` with the
running fiber's inherited `MemoMap`, not a fresh one. Layers are memoised
by object identity, and `SidecarPlatformLive` composes the engine's
module-level `DataStoreLive` / `DataReaderLive` constants over its own
`SqliteLayer`[^platform-sidecar]. When the outer platform has already built
those same constants, the inner build is a memo hit: the handler receives
the outer `DataStore`, bound to the outer, cwd-derived `data.db`, and the
new `SqliteLayer` is never consulted. This was issue 561: `agent
register-agent --project-key X` and `agent end-agent` wrote to the cwd
database instead of X's.

The fix is `Effect.provide(layer, { local: true })`, which builds the layer
with a fresh memo map[^agent-ts]. An e2e test spawns the bin and asserts
the rows land in the `--project-key` database[^project-key-e2e].

The CLI's root platform no longer carries a database at all (the project
database layer is attached only to the commands that use it; see [Module:
cli](../modules/cli.md)), so the original collision cannot recur there,
but `local: true` stays on both calls. Reach for it whenever a handler
provides a layer that shares a module-level constant with any layer
already built further out.

[^agent-ts]: `../../packages/cli/src/commands/agent.ts` (`registerAgentSubcommand`, `endAgentSubcommand`)
[^platform-sidecar]: `../../packages/engine/src/programs/platform-sidecar.ts` (`SidecarPlatformLive`)
[^project-key-e2e]: `../../packages/cli/__test__/agent-project-key.e2e.test.ts`
