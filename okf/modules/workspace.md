---
type: Module
title: workspace
description: The pnpm/Turbo monorepo root — workspace glob, build pipeline, tooling, and hooks shared by every package.
kind: workspace
resource: ../..
status: draft
generated:
  by: okfit/claude-code
  at: 2026-11-12T02:39:17Z
tags:
  - architecture
  - dx
  - ci
  - release
  - deps
integrity:
  generated:
    body: d81e5ad1ce996792
---

# workspace

## Purpose

The repository root: a pnpm workspace orchestrated by Turborepo, holding
every publishable package, the agent plugin, the docs site, and the
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

`pnpm-workspace.yaml`'s `packages` list globs four workspace groups:

| Glob | Contents |
| --- | --- |
| `packages/*` | The eight publishable `@vitest-agent/*` packages plus the four `sidecar-*` platform sub-packages |
| `plugin` | `@vitest-agent/ai-plugins`: the agent plugin, one pluginfinity source built into `plugin/builds/claude` and `plugin/builds/copilot`, private and released on GitHub only |
| `playground` | Dogfooding sandbox — intentionally imperfect code for agent demos, never published |
| `website` | The `docs` package: an RSPress 2.0 documentation site deployed to `vitest-agent.dev`, private, versioned independently, importing nothing from the runtime packages |

`pnpm-workspace.yaml` sets `autoInstallPeers: true`; pins two
config-dependencies by exact version (`@effected/pnpm-plugin-effected`
`0.26.2`, which serves the `effected` catalog for the Effect family and
the `@effected` kit in its `exact`, `peers` and `build` variants, and
`@savvy-web/pnpm-plugin-silk`); sets
`linkWorkspacePackages: deep`; and sets `nodeOptions: --import=tsx`. The
last one exists because workspace links resolve to each package's
TypeScript source (see the build pipeline below): every process pnpm starts
loads tsx so a sibling's `src/*.ts` imports run. The `website` scripts
clear it again with a leading `NODE_OPTIONS=`, because the tsx loader
breaks rspress's static-site generation. The catalog contract is
[Convention: Effect v4 dependencies](../conventions/effect-v4-dependencies.md):
published packages write their runtime Effect and kit edges
`catalog:effected:exact`, pinned by
`packages/plugin/__test__/kit-closure-pins.test.ts` (see [Invariant: kit
closure pins](../invariants/kit-closure-pins.md)).

The workspace has no root `.pnpmfile.cjs`: the build toolchain runs on the
same Effect 4.1 line as the runtime packages, and the lockfile resolves one
`effect` version. A second `effect` version in the lockfile is drift to
investigate.

## Layering

Every workspace package is classified in the committed root `layers.json`
— in one of five layers (top first), as `tooling`
(`@vitest-agent/ai-plugins`), or as `unconstrained` (the private
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

Each package builds with `effected package build`, its one `build` script.
The `effected` bin comes from the root devDependency `@effected/plugin`
(`catalog:effected`); no package carries a build script file of its own.
Per-package options, when a package needs any, live in an optional
`packages/<pkg>/effected.toml`:

| Package(s) | `effected.toml` |
| --- | --- |
| `cli`, `engine`, `mcp`, `plugin`, `sidecar`, `sdk`, `ui`, `reporter` | `[package.build.meta] localPaths` pointing at `website/lib/models/<pkg>` (the docs site's API model) |
| `sdk` | also `[package.build] copy = ["../../schemas"]`, which copies the published JSON Schema documents into the emitted package |
| `ui`, `reporter` | also `[package.build] bundledPackages` (`@vitest-agent/sdk` for ui; sdk and ui for reporter) |
| the four `sidecar-*` | `meta = false`, `[package.build.manifest] drop = ["dependencies"]`, and `[package.build.exe] fileName = "vitest-agent-sidecar"` |

There is one target. Its output lands under `dist/prod/`: the published
tree at `dist/prod/npm/pkg/` (with `meta/` and `declarations/` beside it
under `dist/prod/npm/`), plus `dist/prod/issues.json` and
`dist/prod/targets.json`. There is no development build tree, and no
package's `publishConfig` names a `directory` or `linkDirectory`, so a
workspace link resolves to the package's source: each source
`package.json`'s `exports` point at `src/*.ts` (for example
`packages/sdk/package.json`'s `".": "./src/index.ts"`). That is why the
workspace runs every pnpm-started process under tsx (above), and why each
`tsconfig.json` extends `@effected/plugin/tsconfig/ecma.json`. A process
pnpm did not start loads tsx itself: the carrier bins
`packages/plugin/src/bin/vitest-agent.ts` and `vitest-agent-mcp.ts`
register tsx through a dynamic import when they run from `.ts` source, and
the e2e harnesses that spawn bins (`packages/cli/__test__/utils/cli-test.ts`,
`packages/mcp/__test__/utils/mcp-process.ts`) pass an absolute `--import`
URL for tsx. Because tsx applies one tsconfig per process, every
`packages/ui/src/ink/*.tsx` file opens with a `/** @jsxRuntime automatic */`
pragma rather than relying on its own package's `jsx` setting.

Each source `package.json` is marked `"private": true` — intentional: the
build rewrites `exports` and flips `private` to `false` in the emitted
manifest. `packages/sdk/dist/prod/npm/pkg/package.json` carries
`"private": false` where the source tree carries `"private": true`; never
hand-set `"private": false` in a source `package.json`.

Turbo (`turbo.json`) orders two tasks: `types:check` (depending on
`^types:check` of its workspace dependencies) and `build`, which depends
on `types:check`. `ui` and `reporter`, the two packages that set
`bundledPackages`, add `^build`; sdk's `build` also depends on `schema:build`, and each
package whose `effected.toml` sets `localPaths` declares that
`website/lib/models/<pkg>` directory as an extra build output. The `build`
task's cache `inputs` include `effected.toml` (package and root) and
`.changeset/**`, and exclude `__test__/**`, `CHANGELOG.md`, `CLAUDE.md`, and
`CLAUDE.local.md`.

## Commands

Root `package.json` scripts:

```bash
pnpm run build              # turbo run build --filter=!docs (grouped output)
pnpm run build:docs         # turbo run build --filter=docs
pnpm run ci:build           # turbo run build --filter=!docs, with CI=true
pnpm run lint                # biome check --max-diagnostics=none
pnpm run lint:fix            # biome check --write --max-diagnostics=none
pnpm run lint:fix:unsafe      # biome check --write --unsafe --max-diagnostics=none
pnpm run lint:md             # markdownlint-cli2 over **/*.{md,mdx}
pnpm run lint:md:fix         # markdownlint-cli2 --fix
pnpm run typecheck           # turbo run types:check
pnpm run test                # vitest run
pnpm run test:watch          # vitest --watch
pnpm run test:coverage       # vitest run (coverage config lives in vitest.config.ts)
pnpm run test:bats           # bats --recursive plugin/__test__, with every VITEST_AGENT_* var unset
```

Scope any Turbo-backed command to one package with a filter:
`turbo run build --filter='./packages/sdk'`.

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
Root `package.json` names pnpm in
`devEngines.packageManager` (`12.17.0`, `onFail: "download"`) rather than in
a `packageManager` field. Two independent
implementations of this same order exist — one importable from
`@vitest-agent/sdk` for the CLI, one as a zero-dependency shell copy for the
agent plugin's MCP loader, because the loader must run before the
consumer's own npm packages are guaranteed to be installed — so the two
copies are kept in the same detection order rather than sharing code. See
[Module: vitest-agent agent plugin](claude-code-plugin.md) for the loader side.

## Choices absorbed here

- **Versioning is per-package, not lockstep.** `.changeset/config.json` sets
  `updateInternalDependencies: "patch"` (not a `fixed` group) and
  `privatePackages: { tag: true, version: true }`, so a change bumps only
  the package it touches plus a patch ripple to its workspace dependents;
  `.changeset/config.json`'s `changelog` entry additionally maps
  `@vitest-agent/ai-plugins`'s `versionFiles` to the `$.version` of both
  built manifests (`plugin/builds/claude/.claude-plugin/plugin.json` and
  `plugin/builds/copilot/plugin.json`), so a changeset naming that package
  keeps both manifests' versions in step without an npm publish.
- **`.changeset/config.json` ignores `playground` and `docs`** (its
  `ignore` array) — neither package versions through changesets at all.
