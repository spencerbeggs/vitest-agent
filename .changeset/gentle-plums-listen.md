---
"@vitest-agent/plugin": minor
---

## Features

### Injectable filesystem port for discovery

The four discovery walkers (`findTestFiles`, `isTestShapedPackage`, `discoverProjects`, and `DiscoverStrategy.buildProject`) now read through a small filesystem port instead of calling `node:fs` directly. Every call site still defaults to the real filesystem, so production behavior is unchanged — this only opens the door to testing discovery against a virtual volume instead of a real temporary directory.

```ts
import type { WalkerFileSystem } from "@vitest-agent/plugin";
import { findTestFiles } from "@vitest-agent/plugin";

const fs: WalkerFileSystem = {
  readDirectory: async (dir) => [],
  statEntry: async (path) => null,
};

await findTestFiles("/repo/packages/foo", ["**/*.test.ts"], fs);
```

New exports from the package index: the `WalkerFileSystem`, `WalkerEntry`, and `WalkerEntryStat` types, plus the `nodeWalkerFs` binding (the default used everywhere).

Three existing shapes gained optional opt-in points, each defaulting to previous behavior:

* `findTestFiles(dir, patterns, fs?)` — new trailing `fs` parameter
* `DiscoverProjectsOptions` — new `fs?` and `syncOps?` fields
* `DiscoverInput` (passed to `DiscoverStrategy.buildProject`) — new `fs?` field

Anyone implementing a custom `DiscoverStrategy`, or testing project discovery, can now hand in a virtual filesystem instead of building and tearing down a real temp directory.
