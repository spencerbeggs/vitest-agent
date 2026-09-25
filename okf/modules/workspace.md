---
type: Module
title: workspace
description: The pnpm/Turbo monorepo root — workspace glob, build pipeline, tooling, and hooks shared by every package.
kind: workspace
resource: ../..
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: f1e71434f2471c6808989e7c92b8b5d46014988ea050a6d197f9031778da17fb
tags:
  - architecture
  - dx
  - ci
  - release
  - deps
---

# workspace

## Purpose

The repository root: a pnpm workspace orchestrated by Turborepo, holding
every publishable package, the Claude Code plugin, the docs site, and the
playground harness, plus the root-level build, lint, and release tooling
every one of them shares.

## Boundary

Owns workspace membership (`pnpm-workspace.yaml`), cross-package task
orchestration (`turbo.json`), and repo-root tooling config
(`biome.json`, `lib/configs/*`, `.husky/*`, `.changeset/config.json`). Does
not own any package's runtime behavior — that belongs to the individual
[Module](../modules/index.md) entries — and does not itself publish to npm
(`package.json` is `"private": true`).

## The workspace table

`pnpm-workspace.yaml:1-5` globs four workspace groups:

| Glob | Contents |
| --- | --- |
| `packages/*` | The eight publishable `@vitest-agent/*` packages plus the four `sidecar-*` platform sub-packages |
| `plugins/*` | `@vitest-agent/claude-code-plugin` at `plugins/claude-code/` — the container is plural because a second agent-host plugin is anticipated, but only `claude-code/` exists today |
| `playground` | Dogfooding sandbox — intentionally imperfect code for agent demos, never published |
| `website` | The `docs` package: an RSPress 2.0 documentation site deployed to `vitest-agent.dev`, private, versioned independently, importing nothing from the runtime packages |

`pnpm-workspace.yaml:6` sets `autoInstallPeers: true`; `:7-9` pins two
config-dependencies (`@effected/pnpm-plugin-effect`,
`@savvy-web/pnpm-plugin-silk`) by exact version and integrity hash;
`:10` sets `linkWorkspacePackages: deep`; `:11` disables
`verifyDepsBeforeRun`.

## Layering

Every workspace package is classified in the committed root `layers.json`
— in one of five layers (top first), as `tooling`
(`@vitest-agent/claude-code-plugin`), or as `unconstrained` (the private
root, `docs`, `playground`) — and every runtime dependency edge
(`dependencies` / `optionalDependencies` / `peerDependencies`) must point
to a strictly lower layer, never within one. That rules out an edge
between the two front ends, `@vitest-agent/cli` and `@vitest-agent/mcp`.
`packages/plugin/__test__/workspace-layering.test.ts` enforces it through
`@effected/workspaces/testing`'s `WorkspaceLayering`, and separately fails
on a dependency cycle in any field, `devDependencies` included. A new
workspace package needs an entry in `layers.json`, by package name.
See [Invariant ranked-layering](../invariants/ranked-layering.md) for the
full rank table and enforcement detail.

## Build pipeline

Each package builds through `@savvy-web/bundler` (`packages/sdk/package.json`
declares it at `^2.3.7`; `packages/sdk/savvy.build.ts` calls `build({ meta })`
from it), invoked via two npm scripts every package defines identically:
`build:dev` (`node savvy.build.ts --target dev`) and `build:prod`
(`node savvy.build.ts --target prod`). The two targets land in separate
directory trees under `dist/`:

| Output | Directory (observed under `packages/sdk/dist/`) | Purpose |
| --- | --- | --- |
| Development | `dist/dev/pkg/` | Local development build with declaration maps, unminified |
| Production | `dist/prod/npm/pkg/` (plus `meta/`, `declarations/`) | The tree published to npm |

Each source `package.json` is marked `"private": true` (for example
`packages/sdk/package.json:4`) — intentional: the bundler's `build()` step
rewrites `exports` and flips `private` to `false` in the emitted manifest.
`packages/sdk/dist/prod/npm/pkg/package.json` carries `"private": false`
where the source tree carries `"private": true`; never hand-set `"private":
false` in a source `package.json`. `packages/sdk/savvy.build.ts:23-34` also
shows the pattern for copying a generated, non-exports asset (the published
JSON Schema documents under `schemas/`) into every emitted package
directory after the bundler's own build finishes, since the bundler's
exports graph never sees files that are not source modules.

Turbo (`turbo.json`) orders three tasks: `types:check` runs first
(`turbo.json:64-87`, depending on `^build:dev` of its workspace
dependencies), then both `build:dev` and `build:prod` depend on it
(`turbo.json:5-63`; `build:prod` additionally depends on the sibling
`build:dev`). Every task's cache `inputs` list explicitly excludes
`*.md`, `.changeset/**` is included only for `build:prod` (so a changeset
addition can invalidate a production build without needing to touch
source), and both build tasks exclude `__test__/**`, `CLAUDE.md`, and
`CLAUDE.local.md` from their cache key.

## Commands

Root `package.json` scripts (`package.json:18-37`):

```bash
pnpm run build              # turbo run build:dev build:prod (grouped output)
pnpm run ci:build           # same, with CI=true
pnpm run lint                # biome check --max-diagnostics=none
pnpm run lint:fix            # biome check --write --max-diagnostics=none
pnpm run lint:fix:unsafe      # biome check --write --unsafe --max-diagnostics=none
pnpm run lint:md             # markdownlint-cli2 over **/*.{md,mdx}
pnpm run lint:md:fix         # markdownlint-cli2 --fix
pnpm run typecheck           # turbo run types:check
pnpm run test                # vitest run
pnpm run test:watch          # vitest --watch
pnpm run test:coverage       # vitest run (coverage config lives in vitest.config.ts)
pnpm run test:bats           # bats --recursive plugins, re-exporting VITEST_AGENT_* env
```

Scope any Turbo-backed command to one package with a filter:
`turbo run build:dev build:prod --filter='./packages/sdk'`.

## Code quality and hooks

Biome (`biome.json`) lints and formats every `.ts`/`.js`/`.json`-family file;
`lib/configs/commitlint.config.ts` re-exports
`CommitlintConfig.silk()` from `@savvy-web/silk/commitlint`, and
`lib/configs/lint-staged.config.ts` re-exports `Preset.silk()` from
`@savvy-web/silk/lint`. Husky wires four hooks around them:

- `.husky/pre-commit` runs `lint-staged --config
  lib/configs/lint-staged.config.ts` (skipped in CI via an `in_ci` guard) —
  this autofixes staged files and re-stages the result.
- `.husky/commit-msg` runs `commitlint --config
  lib/configs/commitlint.config.ts --edit "$1"`, enforcing conventional
  commit format plus DCO signoff.
- `.husky/post-checkout` and `.husky/post-merge` run package-manager setup
  (each is a 104-line script).
- Root `package.json`'s `prepare` script is exactly `"husky"` — it installs
  the git hooks and does not build anything, so a frozen-lockfile install
  never has to cross-compile the sidecar's per-platform Node SEA binaries.

## Package manager detection

Canonical package-manager detection for the CLI and the Claude Code
plugin's shell loader both check the same order: the `packageManager`
field in root `package.json`, then lockfile presence (`pnpm-lock.yaml`,
`bun.lock`/`bun.lockb`, `yarn.lock`, `package-lock.json`), then a default.
Root `package.json:44` pins
`packageManager: "pnpm@11.27.0+sha512-…"`. Two independent
implementations of this same order exist — one importable from
`@vitest-agent/sdk` for the CLI, one as a zero-dependency shell copy for the
Claude Code plugin's loader, because the loader must run before the
consumer's own npm packages are guaranteed to be installed — so the two
copies are kept in the same detection order rather than sharing code. See
[Module claude-code-plugin](claude-code-plugin.md) for the loader side.

## Choices absorbed here

- **Versioning is per-package, not lockstep.** `.changeset/config.json` sets
  `updateInternalDependencies: "patch"` (not a `fixed` group) and
  `privatePackages: { tag: true, version: true }`, so a change bumps only
  the package it touches plus a patch ripple to its workspace dependents;
  `.changeset/config.json`'s `changelog` entry additionally maps
  `@vitest-agent/claude-code-plugin`'s `versionFiles` to
  `plugins/claude-code/.claude-plugin/plugin.json`'s `$.version`, so a
  changeset naming that package keeps the marketplace manifest's version in
  step without an npm publish.
- **`.changeset/config.json` ignores `playground` and `docs`** (its
  `ignore` array) — neither package versions through changesets at all.
