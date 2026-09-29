---
type: Interface
title: vitest-agent.config.toml
description: The optional workspace-root TOML file that overrides the default data-path resolution.
kind: config
resource: ../../packages/engine/src/layers/ConfigLive.ts
tags:
  - dx
  - compat
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:27Z
  body_sha256: 5b671e23be81f8819c58c192bbfcee39f3735ab7b8f41de97cab53fd0611120b
sources:
  - id: config-live
    resource: ../../packages/engine/src/layers/ConfigLive.ts
  - id: config-schema
    resource: ../../packages/sdk/src/schemas/Config.ts
  - id: resolve-data-path
    resource: ../../packages/engine/src/utils/resolve-data-path.ts
  - id: resolve-project-key-from-cwd
    resource: ../../packages/engine/src/utils/resolve-project-key-from-cwd.ts
---

# Interface: `vitest-agent.config.toml`

## What stays stable

An optional `vitest-agent.config.toml` at the workspace root lets a
consumer override the default data-path resolution without code changes.
Both fields are optional; an absent file, or a file present but empty,
behaves identically to `new VitestAgentConfig({})`.[^config-schema]

**Fields** (`packages/sdk/src/schemas/Config.ts`):

- `cacheDir?: string` — an absolute path overriding the entire data
  directory. Use this to relocate the SQLite database (for example, to a
  project-local `.vitest-agent/` directory) instead of the default XDG
  location.
- `projectKey?: string` — overrides the workspace-key segment normally
  derived from identity. Use this when two unrelated projects on the
  same machine would otherwise collide (both named `my-app`, or sharing
  no `repository` field), or when a key needs to stay stable across a
  `package.json` `name` rename.

**Where the file is found.** `ConfigLive(projectDir)` builds an
`@effected/config-file` `ConfigFile.layer` over the schema with a
`MergeStrategy.firstMatch()` chain of three resolvers tried in
order:[^config-live]

1. `ConfigResolver.workspaceRoot` — the pnpm/npm/yarn workspace root, when
   `projectDir` sits inside one.
2. `ConfigResolver.gitRoot` — the git repository root, when `projectDir`
   sits inside a git repo.
3. `ConfigResolver.upwardWalk` — walk upward from `projectDir` until a
   file is found or the walk is exhausted.

The first resolver to find a `vitest-agent.config.toml` wins; the others
are never consulted. When none finds a file, downstream callers use
`config.loadOrDefault(new VitestAgentConfig({}))` and get an empty
config — never an error from a missing file.

## Precedence against the programmatic option and workspace name

`resolveDataPath(projectDir, options)` in
`packages/engine/src/utils/resolve-data-path.ts` is the single place
these fields take effect, in this order:[^resolve-data-path]

1. `options.cacheDir` — the programmatic override (a reporter's
   `cacheDir` option or the plugin's own resolved option) wins over
   everything, including the TOML file.
2. The TOML file's `cacheDir` — used only when no programmatic
   `cacheDir` was supplied.
3. The TOML file's `projectKey`, normalized, as the XDG data-directory
   key segment — used only when neither `cacheDir` source applied.
4. The workspace-name-derived key, computed by
   `resolveProjectKeyFromCwdEffect(projectDir)` (the `FileSystem`-backed
   form of the synchronous `resolveProjectKeyFromCwd`; same rules): it
   walks upward from `projectDir` to the nearest `package.json`, prefers
   a canonicalized
   `repository` URL (`host__path` form) when present, and otherwise
   falls back to the normalized `name` field.[^resolve-project-key-from-cwd]

## Fail-loud vs. fallback: a live discrepancy

`resolveProjectKeyFromCwdEffect` — the function `resolveDataPath` actually
calls at precedence level 4, with error type `never` — never fails, and
neither does its synchronous twin `resolveProjectKeyFromCwd`: when
no `package.json` is reachable, or it is malformed, it falls back to
the `cwd`'s final path segment, and to the literal string
`"anonymous-project"` when even that is
empty.[^resolve-project-key-from-cwd] A separate resolver,
`resolveWorkspaceKey` (`packages/engine/src/utils/resolve-workspace-key.ts`),
fails with `WorkspaceRootNotFoundError` when `projectDir` sits in no
discoverable workspace at all — but as of this writing nothing in the
data-path resolution chain calls it; it is exported and consumed only by
`PathResolutionLive`'s doc comments and its own module. A caller
expecting `resolveDataPath` to fail loudly on an unresolvable identity is
reading a promise the current code does not keep — the actual behavior
is graceful degradation to a directory keyed on the current directory's
basename.

## The JSON Schema for this file

No JSON Schema document is generated or published for
`vitest-agent.config.toml` today — contrast with
[Interface: published-json-schemas](published-json-schemas.md), which
covers only the `run.json` report envelope. The TOML loader validates
directly against the `VitestAgentConfig` Effect Schema class at load
time; a consumer's editor gets no `$schema`-driven autocomplete for this
file until such a document is added.

[^config-live]: `../../packages/engine/src/layers/ConfigLive.ts`
[^config-schema]: `../../packages/sdk/src/schemas/Config.ts`
[^resolve-data-path]: `../../packages/engine/src/utils/resolve-data-path.ts`
[^resolve-project-key-from-cwd]: `../../packages/engine/src/utils/resolve-project-key-from-cwd.ts`
