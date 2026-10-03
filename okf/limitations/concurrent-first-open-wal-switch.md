---
type: Limitation
title: Concurrent first open of a new database can die at the WAL switch
description: "When many processes open a SQLite file that does not exist yet at the same moment, one can fail with 'database is locked' while the driver switches the file to WAL mode, as a defect rather than a typed error; only the first concurrent opens of a nonexistent file are exposed."
bounds: ../modules/engine.md
status: draft
stale_after: 2027-01-01T00:00:00Z
tags: [architecture, compat]
generated:
  by: okfit/claude-code
  at: 2026-10-03T18:02:06Z
  body_sha256: 3de59e355eeb2e8d274c4276e60f1bed6c6e14e100a0d9f818b56bb7dd66c92a
sources:
  - id: effected-store
    resource: "npm:@effected/store"
    title: The SQLite driver's per-connection WAL and busy-timeout setup
  - id: platform-sidecar
    resource: ../../packages/engine/src/programs/platform-sidecar.ts
  - id: fresh-install-trials
    resource: "feat/effected-app-layers branch: 80 fresh-install trials of the real hook path, reported with the change"
    last_modified: 2026-10-03T00:00:00Z
---

# Concurrent first open of a new database can die at the WAL switch

**Condition.** Several processes open the same SQLite file at the same
moment, and the file does not exist yet. All three databases are exposed:
a fresh `data.db`, `sessions.db`, or `registry.db`. Each one is opened as
an `@effected/store` store, and the driver switches every new connection
to WAL journal mode.[^effected-store]

**Symptom.** One of the racing processes fails with `database is locked`
during the WAL switch. The failure is a defect, not a typed `StoreError`,
so it does not surface through `PlatformLiveError` and no caller recovers
from it. The busy timeout does not absorb it. Once the file exists and is
in WAL mode, later opens are unaffected.

**Why this is acceptable.** It is not a regression. The previous
`SqliteClient` plus `SqliteMigrator` stack had the same exposure. In the
real hook path the race is rarely reached, because CLI boot staggers the
hook processes that `SidecarPlatformLive` serves[^platform-sidecar]: 0 of
80 fresh-install trials failed.[^fresh-install-trials] In-process
contention for `data.db` is already serialized by `ensureMigrated`'s
`globalThis` cache (see
[Decision 28](../decisions/28-process-level-migration-coordination-via-globalthis-cache.md)).

**What a fix would take.** The fix belongs upstream: the driver could
retry the journal-mode switch under the busy timeout, or map the failure to
a typed error a caller can retry. In this repository a workaround would
mean one retry around the first open of each store. Neither is scheduled.

[^effected-store]: `npm:@effected/store`
[^platform-sidecar]: `../../packages/engine/src/programs/platform-sidecar.ts`
[^fresh-install-trials]: feat/effected-app-layers branch, 80 fresh-install trials of the real hook path
