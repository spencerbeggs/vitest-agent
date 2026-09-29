---
type: Decision
title: Migration 0002 Drops the Dead Table and ALTERs the Live Ones
description: 0002_test_artifacts.ts drops and recreates the never-written test_annotations table while widening test_artifacts and attachments with ALTER TABLE, because the post-2.0 ALTER-only rule protects data that a released version could actually have written.
status: stable
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: d0bfc7dc5a174ee393368f2850e39b2a63bbfd5fb8f579fd171eae9404964397
sources:
  - id: migration-0002
    resource: ../../packages/engine/src/migrations/0002_test_artifacts.ts
  - id: migrations-index
    resource: ../../packages/engine/src/migrations/index.ts
  - id: engine-platform
    resource: ../../packages/engine/src/platform.ts
  - id: ensure-migrated
    resource: ../../packages/engine/src/utils/ensure-migrated.ts
  - id: testing-layers
    resource: ../../packages/engine/src/testing/layers.ts
  - id: migration-0002-test
    resource: ../../packages/engine/__test__/migration-0002.test.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Migration 0002 Drops the Dead Table and ALTERs the Live Ones

## Context

`test_annotations`, `test_artifacts`, and `attachments` shipped inside the
frozen `0001_initial` migration with zero readers and zero writers. Giving
them writers exposed two shapes that were wrong for Vitest 5:
`test_annotations.type` carried a `CHECK (type IN ('notice','warning',
'error'))` constraint even though a Vitest annotation's `type` is an
arbitrary string, and the table carried three inline `attachment_*`
columns even though the sibling `attachments` table already models the
1:N relationship. `test_artifacts` had no column for an artifact's custom
fields, and `attachments` recorded neither a size (so a dangling
`.vitest/attachments` path became undescribable once the directory was
cleaned) nor an encoding (so an inline body could not be decoded back).

## Decision

`packages/engine/src/migrations/0002_test_artifacts.ts` drops the two
indexes and the `test_annotations` table outright, then recreates it with
`type TEXT NOT NULL` (no `CHECK` constraint) and no inline
`attachment_*` columns.[^migration-0002] `test_artifacts` gains a `data
TEXT` column and `attachments` gains `byte_size INTEGER` and
`body_encoding TEXT`, both added with plain `ALTER TABLE ADD COLUMN`
statements against the live tables.[^migration-0002] The migration is
registered once, as the `"0002_test_artifacts"` key on the
`PROJECT_MIGRATIONS` record,[^migrations-index] which is the single
default every migration-consuming call site shares:
`makeSqliteStack(filename, migrations = PROJECT_MIGRATIONS)` in
`platform.ts`,[^engine-platform] `ensureMigrated`'s call to
`makeSqliteStack(dbPath)`,[^ensure-migrated] and the engine's
`testing/layers.ts` test-layer factory[^testing-layers] all resolve the
same migration set through that one default rather than each hand-listing
migrations — there is one registry to update for a new migration, not
three call sites to keep in sync.

## Alternatives rejected

- **ALTER `test_annotations` column by column, including rebuilding it to
  drop the `CHECK` constraint** (SQLite has no `ALTER TABLE DROP
  CONSTRAINT`, so removing a `CHECK` requires a table rebuild regardless).
  Rejected because a table rebuild achieves the identical end state as a
  drop-and-recreate with strictly more moving parts and a worse-documented
  intent, for a table that had never been written to by any released
  version.
- **Apply the ALTER-and-backfill-only rule uniformly to all three tables**,
  treating `test_annotations` as if it might hold user data. Rejected
  because the post-2.0 incremental-migration rule exists to protect data a
  released version could have written; `test_annotations` had zero writers
  in any shipped release, so dropping it cannot destroy a row that exists.
- **Edit `0001_initial.ts` in place** to fix the three shapes at the
  source. Rejected outright — a published package's users may already
  hold a `data.db` created from `0001_initial` as shipped, so editing a
  frozen migration in place is never a legal move, regardless of whether
  the edited table ever had a writer.

## Consequences

Any registry or test layer that constructs a SQLite stack for this
project's schema must resolve migrations through `PROJECT_MIGRATIONS`
rather than hand-listing a subset — a call site that pins an older
migration set silently serves a stale schema. `packages/engine/__test__/migration-0002.test.ts`
pins the resulting table shapes so a future migration cannot regress
`test_annotations`, `test_artifacts`, or `attachments` without failing
that suite.[^migration-0002-test]

## Related

- [DataModel: sqlite-schema](../models/sqlite-schema.md)
- [Runbook: add-a-migration](../runbooks/add-a-migration.md)
- [Decision 68 — Cap Inline Attachment Bodies on Stored Bytes](./68-cap-inline-attachment-bodies-on-stored-bytes.md)

[^migration-0002]: `../../packages/engine/src/migrations/0002_test_artifacts.ts`
[^migrations-index]: `../../packages/engine/src/migrations/index.ts`
[^engine-platform]: `../../packages/engine/src/platform.ts`
[^ensure-migrated]: `../../packages/engine/src/utils/ensure-migrated.ts`
[^testing-layers]: `../../packages/engine/src/testing/layers.ts`
[^migration-0002-test]: `../../packages/engine/__test__/migration-0002.test.ts`
