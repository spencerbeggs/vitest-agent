---
type: Decision
status: draft
title: Discovery Walks Run on @effected/walker's Sync Descent
description: "Every plugin discovery walk is @effected/walker's descendSync or descendEntriesSync over a caller-supplied WalkerSyncOps, following symlinked directories under the walker's cycle guard like the engine's ProjectDiscoveryLive, and tests hand it a memfs handle's sync port through memfsWalkerOps."
supersedes: 74-walker-test-adapter-sits-on-memfs-promises-port.md
tags:
  - testing
  - deps
  - dx
generated:
  by: okfit/claude-code
  at: 2026-10-27T13:30:27Z
sources:
  - id: find-test-files
    resource: ../../packages/plugin/src/utils/find-test-files.ts
    title: findTestFiles, directorySignature and the shared walk rules
  - id: walker-fs
    resource: ../../packages/plugin/src/utils/walker-fs.ts
    title: statOrNull, the one read outside a walk
  - id: memfs-walker
    resource: ../../packages/plugin/__test__/utils/memfs-walker.ts
    title: memfsWalkerOps and seedMemfsWalker
  - id: find-test-files-test
    resource: ../../packages/plugin/__test__/find-test-files.test.ts
    title: The symlink cases for findTestFiles
  - id: project-discovery-live
    resource: ../../packages/engine/src/layers/ProjectDiscoveryLive.ts
    title: The engine's discovery walk over the same walker
integrity:
  generated:
    body: b300e195fed9a999
---

# Discovery Walks Run on @effected/walker's Sync Descent

## Context

The plugin's four discovery walks (`findTestFiles`, `isTestShapedPackage`,
`detectSetupFile`, and the cache-signature walk) read the filesystem
through a two-operation port of their own, with a hand-written recursion
that never followed a symlinked directory. The engine's
`ProjectDiscoveryLive` walked separately and, once moved onto
`@effected/walker`, followed links, so the plugin and the engine could
disagree about which test files a tree holds. [Decision
74](74-walker-test-adapter-sits-on-memfs-promises-port.md) built the test
adapter over memfs' promises port to keep that hand-written port faithful;
the port itself is now gone.

## Decision

Every walk is `@effected/walker`'s `descendSync` (expanding a compiled
`GlobPattern` with `{ dot: true }`) or `descendEntriesSync` (the
signature walk's path-plus-`mtimeMs` entries), over a `WalkerSyncOps`
the caller supplies and that defaults to `nodeWalkerSyncOps`[^find-test-files].
The walks share one rule set: `NON_DISCOVERABLE_DIRS` is pruned before
descending, symlinked directories are followed under the walker's
ancestor-chain cycle guard, and an unreadable directory is skipped. The
engine's `ProjectDiscoveryLive` follows links the same way, so both see
one tree[^project-discovery-live]. A single stat outside a walk goes
through `statOrNull`, which answers `null` instead of throwing[^walker-fs].
The plugin re-exports `WalkerSyncOps` as a type for custom strategies.

Tests pass `memfsWalkerOps(handle)`, which is `{ fileSystem: handle.sync,
path }` over an `@effected/memfs` handle; `seedMemfsWalker(root, seed)`
builds the handle with `MemoryFileSystem.makeSync(seed, { root })`[^memfs-walker].
The handle's sync port answers the same `readdirSync` / `statSync` /
`lstatSync` / `realpathSync` calls `nodeWalkerSyncOps` makes on disk.

## Consequences

- A link into another directory is walked; a pruned name is still pruned
  when it is a link, so a `node_modules` symlinked into the pnpm store
  never leaks in; a link loop terminates with each real file found once.
  `find-test-files.test.ts` pins all three, plus a link whose own name
  matches a test-file glob being collected[^find-test-files-test].
- There is no test adapter to keep faithful: the walker's own sync
  contract is the only filesystem surface, in production and in tests.
- `WalkerFileSystem`, `WalkerEntry`, `WalkerEntryStat` and `nodeWalkerFs`
  were removed from the plugin's public surface, a breaking change for a
  custom strategy that imported them.

## Alternatives rejected

- **Keep the plugin's own port and recursion.** It duplicated what the
  walker ships and kept the plugin's symlink rule at odds with the
  engine's.
- **Follow no links in either walk.** A workspace that links a source
  directory in would hide that directory's tests from discovery, and the
  engine's walk already followed links.

[^find-test-files]: `../../packages/plugin/src/utils/find-test-files.ts`
[^project-discovery-live]: `../../packages/engine/src/layers/ProjectDiscoveryLive.ts`
[^walker-fs]: `../../packages/plugin/src/utils/walker-fs.ts`
[^memfs-walker]: `../../packages/plugin/__test__/utils/memfs-walker.ts`
[^find-test-files-test]: `../../packages/plugin/__test__/find-test-files.test.ts`
