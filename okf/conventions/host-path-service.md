---
type: Convention
title: Never provide core Path.layer in package source — leave Path in R for the host's Node Path
description: "Code under packages/*/src never provides effect's core Path.layer, which is POSIX-only; it keeps Path.Path in its requirements, builds every path with the ambient path.join, and lets the front end supply the host's Node Path through the platform layer, so the same code is right on Windows."
tags: [compat, effect]
status: draft
stale_after: 2027-01-29T00:00:00Z
sources:
  - id: core-path
    resource: ../../.repos/effect/packages/effect/src/Path.ts
    title: "effect's Path module: `layer` is `Layer.succeed(Path)(posixImpl)`"
  - id: project-key
    resource: ../../packages/engine/src/utils/resolve-project-key-from-cwd.ts
    title: resolveProjectKeyFromCwdEffect and its runSync twin over NodeSyncFileSystem.layerWithPath
  - id: project-discovery
    resource: ../../packages/engine/src/layers/ProjectDiscoveryLive.ts
    title: ProjectDiscoveryLive joining walk results with the ambient Path
  - id: win32-test
    resource: ../../packages/engine/__test__/win32-paths.test.ts
    title: The win32 path suite
  - id: win32-volume
    resource: ../../packages/engine/__test__/utils/win32-volume.ts
    title: win32Volume — NodePath.layerWin32 over a memfs volume
generated:
  by: okfit/claude-code
  at: 2026-11-05T23:25:05Z
integrity:
  generated:
    body: 04882450437ca64f
---

# Never provide core Path.layer in package source

**Rule.** Under `packages/*/src`, never write `Effect.provide(Path.layer)` or
`Layer.provide(Path.layer)` with `effect`'s core `Path.layer`. Keep
`Path.Path` in the Effect's requirements and let the front end supply the
host's Node `Path` (`NodePath.layer` from `@effect/platform-node`, which
`NodePlatformLayer` / `PlatformLive` already carry). Build every path with
the ambient service's `path.join` / `path.basename` / `path.resolve`, never
a `` `${dir}/x` `` template or a `"/"` split. Where a synchronous entry point
has to run an Effect to completion itself, provide the host's implementation,
not the core one: `NodePath.layer`, or
`@effected/memfs/node-sync`'s `NodeSyncFileSystem.layerWithPath`, whose
`Path` is built from `node:path`.

**Why.** Core `Path.layer` is `Layer.succeed(Path)(posixImpl)`, a POSIX
implementation on every host[^core-path]. A program that provides it
internally ignores the platform the front end chose, so on Windows it joins
with `/`, treats `C:\` as relative, and walks the wrong ancestor chain. The
engine runs on win32 — a win32 sidecar ships, and the CLI and MCP server
run under Node on Windows — so a provided core `Path` there builds wrong
project-key walks and test-file paths. `resolveProjectKeyFromCwdEffect`[^project-key]
and `ProjectDiscoveryLive`[^project-discovery] now require `Path.Path`
instead of providing it, which widens the `R` of everything that reaches
them (`resolveDataPath`, `resolveSessionForRecording`, `recordTurnEffect`,
`recordTddArtifactEffect`). The synchronous `resolveProjectKeyFromCwd`
runs the Effect form under `Effect.runSync` over
`NodeSyncFileSystem.layerWithPath`.

**Tests are exempt.** A test may provide core `Path.layer` beside an
`@effected/memfs` volume when the code under test is not about separators.
To pin that code is separator-correct, use the engine's
`win32Volume(seed)`[^win32-volume]: Node's win32 `Path`
(`NodePath.layerWin32`) over a memfs volume that accepts drive-rooted
spellings, so a POSIX-spelled path leaking out of the code misses the seed
and reads as absent. `win32-paths.test.ts`[^win32-test] covers the project
key walk, discovery, and session resolution this way.

**How to check.** `grep -rn "Path\.layer" packages/*/src` should match only
`NodePath.layer`.

[^core-path]: `../../.repos/effect/packages/effect/src/Path.ts`
[^project-key]: `../../packages/engine/src/utils/resolve-project-key-from-cwd.ts`
[^project-discovery]: `../../packages/engine/src/layers/ProjectDiscoveryLive.ts`
[^win32-volume]: `../../packages/engine/__test__/utils/win32-volume.ts`
[^win32-test]: `../../packages/engine/__test__/win32-paths.test.ts`
