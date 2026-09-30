---
type: Decision
status: draft
title: The Walker Test Adapter Sits on memfs' Promises Port
description: "Tests hand the discovery walkers a WalkerFileSystem built on an @effected/memfs handle's node:fs/promises-shaped port, so the adapter makes the same readdir-with-file-types and stat calls nodeWalkerFs makes on disk, with the same literal dirents and link-following stat."
tags:
  - testing
  - deps
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-30T03:49:16Z
  body_sha256: 838d098ef98f887fa06fb4612e45fc1d5717c9218d1131ba0b4c16cd22a68c32
sources:
  - id: memfs-walker
    resource: ../../packages/plugin/__test__/utils/memfs-walker.ts
    title: memfsWalkerFs and seedMemfsWalker
  - id: walker-fs
    resource: ../../packages/plugin/src/utils/walker-fs.ts
    title: WalkerFileSystem and nodeWalkerFs
  - id: find-test-files-test
    resource: ../../packages/plugin/__test__/find-test-files.test.ts
    title: The two symlink-branch cases for findTestFiles
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
    title: The effected config dependency that pins @effected/memfs
---

# The Walker Test Adapter Sits on memfs' Promises Port

## Context

The four discovery walkers read the filesystem through the two-operation
`WalkerFileSystem` port, whose production binding `nodeWalkerFs` is
`readdir(dir, { withFileTypes: true })` plus a `stat` wrapped to answer
`null` on failure[^walker-fs]. Tests substitute a memfs-backed adapter.
The pre-bundle design notes (Decision 53, never migrated into this
bundle) built that adapter by hand over memfs' literal `Volume`
inspection view, deriving each dirent from `isDirectory` and `readLink`
and each stat from `mtime`, because the only link-resolving accessor
memfs then offered was the name-shaped `syncFileSystem` port.

That hand derivation carried a fidelity gap: its `statEntry` was literal,
so a symlink stat-ed as neither file nor directory, whereas `nodeWalkerFs`'s
`stat` follows the link. `@effected/memfs` 0.13.0 (adopted through
`@effected/pnpm-plugin-effect` 0.12.6[^pnpm-workspace]) exposes a handle
from `MemoryFileSystem.makeSync` whose `promises` member mirrors
`node:fs/promises`: `readdir` with `withFileTypes` returns literal dirents,
and `stat` follows links.

## Decision

`memfsWalkerFs` in `packages/plugin/__test__/utils/memfs-walker.ts` is a
field mapping over the handle's `promises` port: `readDirectory` is
`promises.readdir(dir, { withFileTypes: true })`, and `statEntry` is
`promises.stat` inside a try/catch that answers `null`[^memfs-walker].
Those are exactly the calls `nodeWalkerFs` makes against the real disk, so
the adapter inherits node's semantics rather than re-deriving them. A
symbolic link answers `false` to both `isFile` and `isDirectory` on its
dirent, so the walkers never recurse into a linked directory and never
collect a link whose own name matches a test-file glob. A `stat` on a link
reports its target, exactly as on disk. `seedMemfsWalker(root, seed)`
builds the handle with `MemoryFileSystem.makeSync(seed, { root })`, which
resolves relative seed keys against `root` itself.

## Consequences

- The adapter can no longer drift from `nodeWalkerFs` along the symlink
  axis, since there is no hand-written derivation left to get wrong; the
  literal-stat gap is closed.
- The two symlink cases in `find-test-files.test.ts` (never recurse into
  a linked directory; never collect a link named like a test file) still
  pin the dirent branch[^find-test-files-test].
- The rooted-seed and callback-scoped helpers are gone: a test describes
  its tree with paths relative to a root and passes the root to
  `makeSync`, and the shared helpers built on the same handle are
  synchronous.

## Alternatives rejected

- **Keep the hand-derived adapter over the `Volume` view.** It works, but
  it re-implements node's dirent and stat rules in test code and had
  already got `statEntry`'s link handling wrong.
- **Build the adapter on the sync port.** The sync port answers entry
  names, not typed dirents, which is the name-then-stat shape the walker
  port exists to avoid.

[^walker-fs]: `../../packages/plugin/src/utils/walker-fs.ts`
[^pnpm-workspace]: `../../pnpm-workspace.yaml`
[^memfs-walker]: `../../packages/plugin/__test__/utils/memfs-walker.ts`
[^find-test-files-test]: `../../packages/plugin/__test__/find-test-files.test.ts`
