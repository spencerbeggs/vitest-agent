---
type: Module
title: "@vitest-agent/sidecar"
description: A detached SEA binary spawned by the Claude Code hooks to remove Node cold-start from the per-Bash-call inject-env hot path, plus its four per-platform optionalDependencies children.
kind: worker
layer: L3
resource: ../../packages/sidecar
tags: [performance, bundle, deps, ci]
status: stable
sources:
  - id: sidecar-index
    resource: ../../packages/sidecar/src/index.ts
  - id: sidecar-resolver
    resource: ../../packages/sidecar/src/resolve-sidecar-binary-path.ts
  - id: sidecar-package-json
    resource: ../../packages/sidecar/package.json
  - id: sidecar-child-package-json
    resource: ../../packages/sidecar-darwin-arm64/package.json
  - id: sidecar-child-bin
    resource: ../../packages/sidecar-darwin-arm64/src/bin.ts
  - id: sidecar-child-build
    resource: ../../packages/sidecar-darwin-arm64/savvy.build.ts
  - id: sidecar-hook
    resource: ../../plugin/hooks/pre-tool-use/bash.sh
  - id: sidecar-session-start-hook
    resource: ../../plugin/hooks/session/start.sh
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: 8dc24cd1f142175150d7c5b6270aa9653cc748ca10819d59c434dd7ffa16462c
---

# @vitest-agent/sidecar

## Purpose

`@vitest-agent/sidecar` exists to remove Node module-graph cold-start from
one specific hot path: the Claude Code PreToolUse Bash hook's `inject-env`
check, which fires on every Bash tool call an agent makes. Kind is `worker`,
not `package`, on purpose — the SEA binary this package resolves is a
detached runtime unit the hooks spawn with its own process lifecycle, not a
library another package imports and links against[^sidecar-index].

## Scope: `inject-env` only

The binary handles `inject-env` and nothing else. `register-agent` stays on
the JS CLI path because it pulls in the engine's data-layer graph
(`@effect/sql-sqlite-node` over Node's built-in `node:sqlite`) that the
trimmed `inject-env` bundle deliberately excludes — the binary reaches only
the platform-free dispatch core. `register-agent` also fires once per
session, off the per-turn critical path, so a JS cold-start there is
tolerable.

## Boundary

The parent `packages/sidecar/` carries no runtime workspace dependency at
all[^sidecar-package-json]. `@vitest-agent/cli` depends on
`@vitest-agent/sidecar` (never the reverse) to consume its resolver; the four
`@vitest-agent/sidecar-<platform>` children each declare
`@vitest-agent/sdk` as their sole workspace dependency, bundled into the SEA
at build time rather than shipped as a runtime dependency of the published
child package.

## Rank-2 platform children

`@vitest-agent/sidecar-{darwin-arm64,linux-arm64,linux-x64,win32-x64}` sit
one rank below the parent in the workspace layering. Each child's only
content is a bin plus a manifest[^sidecar-child-package-json]:

- `src/bin.ts` — a thin process-plumbing shim. It imports `dispatch` from
  the pure `@vitest-agent/sdk/dispatch` entry point, calls
  `dispatch(process.argv.slice(2), { cwd, env, readFile })`, and flushes the
  returned `{ stdout, stderr, code }` to the real process streams. `process`
  is read only here[^sidecar-child-bin].
- `package.json` — declares `os` / `cpu` so npm/pnpm installs only the
  matching platform, and its own `bin` entry pointing at the built SEA
  binary.

## Why the resolver must live in the parent

`packages/sidecar/src/resolve-sidecar-binary-path.ts` exports
`resolveSidecarBinaryPath`, which resolves the installed platform binary's
absolute path via `createRequire(import.meta.url).resolve` against one of
the four platform package names[^sidecar-resolver]. This resolution
mechanism, not a `PATH` lookup, is required because pnpm and npm only hoist
*direct*-dependency bins into `node_modules/.bin/` — a transitive
`optionalDependencies` bin is never placed there. `require.resolve` only
finds an optional dependency when its module anchor
(`import.meta.url`) sits inside the package that declares it as an
`optionalDependencies` entry, which is `@vitest-agent/sidecar` itself. The
resolver therefore cannot move to `@vitest-agent/cli` or any other
consumer without breaking resolution — the anchor has to stay put. It
returns `null` when the platform/arch combination has no matching package,
or when the matching optional dependency was not installed
(`MODULE_NOT_FOUND`).

## Build: the `exe` SEA bundler mode

Each per-platform child owns a `savvy.build.ts` that calls
`@savvy-web/bundler`'s `build()` with an `exe: { fileName:
"vitest-agent-sidecar" }` option, which drives Node's Single Executable
Application generation over a single-file bundle and produces one
self-contained binary per child[^sidecar-child-build]. The build's
`transform` callback deletes the manifest's `dependencies` field before
`defaultManifestTransform` runs, so the published child carries none — the
`@vitest-agent/sdk` workspace dependency is fully bundled into the SEA
rather than left as an installable dependency. The parent
`packages/sidecar/` builds through the ordinary rslib-builder path (like the
six lockstep packages) rather than the `exe` bundler mode, for a specific
reason: rslib-builder emits a `dist/dev/package.json` with `workspace:*` and
`catalog:` references resolved, and `publishConfig.linkDirectory: true`
makes pnpm symlink `node_modules/@vitest-agent/sidecar` at that directory —
a consumer declaring `@vitest-agent/sidecar` as a `workspace:*` dependency
(`@vitest-agent/cli`) needs a real `package.json` there, which the `exe`
mode does not emit[^sidecar-index].

## Distribution: per-platform optionalDependencies

Distribution follows the esbuild / sharp model: `@vitest-agent/sidecar`
declares the four platform packages as `optionalDependencies`, each carrying
`os` / `cpu` fields so npm/pnpm installs only the matching one. darwin-x64
(Intel macOS) has no package — Intel-Mac installs fall back to the JS CLI,
the same fallback an unsupported platform or a skipped optional dependency
triggers.

## Hook integration

`resolveSidecarBinaryPath()`'s result reaches the hooks through the CLI, not
directly: `vitest-agent agent sidecar-path` is a CLI subcommand backed by the
resolver. The SessionStart hook runs it once per session and sets
`VITEST_AGENT_SIDECAR_BIN=<abs-path>` as a pluginfinity session value with
`hook_env_set`, which every later hook reads as a plain
variable[^sidecar-session-start-hook]. The PreToolUse Bash hook
checks that variable is non-empty and executable, and execs it directly when
valid, falling back to the JS CLI otherwise[^sidecar-hook]. This package
reaches a consumer's install transitively rather than as a direct plugin
dependency: it is a regular `dependency` of `@vitest-agent/cli`, and
`@vitest-agent/cli` is a regular `dependency` of `@vitest-agent/plugin`, so
installing the plugin pulls the sidecar and its four `optionalDependencies`
automatically. See [the agent plugin module](claude-code-plugin.md)
for the three-layer hook design this binary is Layer 2 of, and
[the sdk-dispatch interface](../interfaces/sdk-dispatch.md) for the pure
dispatch core the bin shims call.

## CI

As of this writing there is no dedicated cross-compile CI workflow for the
sidecar packages under `.github/workflows/` — the four platform children
build and test through the repository's standard Turbo pipeline
(`turbo run build:dev build:prod`) like every other workspace, and publish
through the shared release workflow the rest of the family uses. This
repository's CI does not currently run a platform-native smoke test against
each built SEA binary.

## Measured outcome

See [the sidecar hook-latency measurement](../measurements/sidecar-hook-latency.md)
for the numbers and [Decision 42](../decisions/42-three-layer-sidecar-performance-fix.md)
for why the layered fix was chosen over a persistent daemon.

## Choices absorbed here

**Why `inject-env` only, with `register-agent` staying JS**, and **why a
persistent daemon was rejected** in favor of this binary plus the two
cheaper prefilter layers ahead of it, are covered above and in
[Decision 42](../decisions/42-three-layer-sidecar-performance-fix.md), which
this module is one leg of.

[^sidecar-index]: `packages/sidecar/src/index.ts`
[^sidecar-resolver]: `packages/sidecar/src/resolve-sidecar-binary-path.ts`
[^sidecar-package-json]: `packages/sidecar/package.json`
[^sidecar-child-package-json]: `packages/sidecar-darwin-arm64/package.json`
[^sidecar-child-bin]: `packages/sidecar-darwin-arm64/src/bin.ts`
[^sidecar-child-build]: `packages/sidecar-darwin-arm64/savvy.build.ts`
[^sidecar-hook]: `plugin/hooks/pre-tool-use/bash.sh`
[^sidecar-session-start-hook]: `plugin/hooks/session/start.sh`
