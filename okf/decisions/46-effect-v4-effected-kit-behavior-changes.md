---
type: Decision
status: stable
title: Effect v4 + effected Kit Behavior Changes
description: The family runs on Effect v4 and the granular @effected/* kit directly, with several v3-to-v4 behavior changes pinned deliberately.
tags: [effect, compat, architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: f86293e9703063c0d1d5d5e0e2df21e07928f1471f0d81d50026cdb0f0d50fcb
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Effect v4 + effected Kit Behavior Changes

## Context

The whole family migrated off Effect v3 onto Effect v4 (the `catalog:effect`
pin) and adopted the granular `@effected/*` packages **directly**, not
through a higher-level app/store control-plane package. The data layer
stays direct on `@effect/sql-sqlite-node` plus `effect/sql` — that
alternative control-plane shape was considered and not taken; the shipped
implementation is direct-on-kit throughout.

## Decision

Adopt Effect v4 core plus the granular `@effected/*` kit, and pin the
following v3→v4 behavior changes as known, deliberate consequences rather
than latent bugs:

- **The CLI, SQL, and platform surfaces moved into core.** `effect/cli`
  supplies `Command`, `Flag` (formerly Options), `Argument` (formerly Args),
  `Primitive`, `Prompt`, and `CliError` (formerly ValidationError);
  `effect/sql` supplies `SqlClient`, `SqlError`, and `Statement`. Both lived
  under `effect/unstable/*` until `4.0.0-rc.118` promoted them.
  `@effect/sql-sqlite-node` stays a separate v4 driver but now runs on
  Node's built-in `node:sqlite` (`DatabaseSync`) — better-sqlite3 was
  removed entirely. `@effect/platform-node`'s `NodeContext` became
  `NodeServices` (`NodeServices.layer`), and the non-Node `FileSystem` /
  `Path` / `PlatformError` primitives collapsed into the core `effect`
  barrel.
- **Kit predecessors moved to `@effected/*`.** `xdg-effect` became
  `@effected/xdg` (`AppDirs.layer({ namespace })` plus `Xdg.layer`),
  `config-file-effect` became `@effected/config-file`
  (`ConfigFile.Service<Self, A>()(id)` plus `ConfigFile.layer`), and
  `workspaces-effect` became `@effected/workspaces`. The plugin's
  synchronous discovery path uses the bare `findWorkspaceRootSync` /
  `getWorkspacePackagesSync` consts with `nodeSyncOps` from
  `@effected/workspaces/node-sync` as the default rather than a hardcode.
- **Core renames throughout**, including `Effect.catchAll` → `Effect.catch`,
  `Effect.either` → `Effect.result`, `Effect.fork` → `Effect.forkChild`,
  `Context.Tag` → `Context.Service`, `Schema.decodeUnknown` →
  `Schema.decodeUnknownEffect`, `JSONSchema` → `JsonSchema`, variadic
  `Schema.Literal` / `Schema.Union` calls moved to array form, `.annotations`
  → `.annotate`, and `LogLevel` becoming a string union (`"Warn"`).
- **Stricter `isUUID`.** v4 validates the RFC version/variant nibbles, so
  placeholder fixtures such as `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` are
  rejected; fixtures that relied on lax UUIDs were regenerated to valid v4
  UUIDs.
- **`.git` is no longer a workspace-root boundary.** `@effected/workspaces`
  recognizes only `pnpm-workspace.yaml` or a `workspaces` field as a root
  marker; a bare-`.git` single-package consumer repo with no workspace
  manifest now fails discovery where the v3 `workspaces-effect` accepted
  it. This is a known open item, deferred rather than resolved: until the
  boundary policy is decided, `AgentPlugin.discover()` throws for such a
  repository, so a single-package consumer declares its Vitest projects
  without `discover()`. Data-path identity is unaffected, because
  `resolveDataPath` keys on the nearest `package.json` rather than a
  workspace root. See [Decision 31 — Deterministic XDG Path
  Resolution](./31-deterministic-xdg-path-resolution.md) for that
  identity-resolution precedence.
- **`node:sqlite` double-wraps driver errors.** The v4 `node:sqlite` driver
  nests two `cause` wrappers, so the real message sits at
  `cause.cause.message` rather than on the top-level `SqlError`.
  `extractSqlReason` (`packages/sdk/src/errors/DataStoreError.ts`) walks
  the full `cause` chain, with cycle guards, to the deepest useful message.
- **`Schema.withDecodingDefaultKey` is decode-only.** The default applies on
  `decode` but is `undefined` on the constructor / passthrough path, so
  code that reads a defaulted field off a freshly constructed (not decoded)
  value must not assume the default is present.

## Alternatives rejected

- **An app/store control-plane package over the granular `@effected/*`
  modules:** the migration initially considered this shape for the
  control plane; the shipped implementation went direct-on-kit instead —
  `@effected/xdg`, `@effected/config-file`, and `@effected/workspaces`
  used individually, with the data layer staying direct on
  `@effect/sql-sqlite-node` and `effect/sql` rather than behind an
  additional abstraction layer.
- **Accepting `.git` as a workspace-root boundary to preserve v3 behavior:**
  not pursued — `@effected/workspaces` draws the boundary at a workspace
  manifest, and reproducing the old `.git`-based boundary would mean
  forking or patching the kit's discovery logic rather than adopting it
  as shipped. The gap is tracked as an open item instead.

## Consequences

- Every `effect@3.x`-shaped API a contributor remembers from before this
  migration is stale by construction; new code must be checked against the
  v4 module a symbol now lives in rather than written from memory.
- A single-package (non-monorepo) consumer without a `pnpm-workspace.yaml`
  or `workspaces` field cannot rely on `.git` presence for workspace
  discovery and must declare its Vitest projects without
  `AgentPlugin.discover()` until the workspace-root boundary policy is
  revisited.
- Any code path that reads a `SqlError`'s message directly, rather than
  through `extractSqlReason`, risks surfacing an unhelpful wrapper message
  instead of the real `node:sqlite` failure text.
- A schema field with `Schema.withDecodingDefaultKey` must not be assumed
  populated on a value built via the constructor; only the decode path
  fills it in.
