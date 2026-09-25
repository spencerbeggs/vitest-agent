---
type: Decision
title: Claude Code Plugin as a Release-Only pnpm Workspace
description: The Claude Code plugin lives at plugins/claude-code/ as an ordinary pnpm workspace member versioned through a private, script-free tracking package, so a hook or agent-prompt change no longer forces a npm publish of the Vitest plugin.
status: draft
tags:
  - architecture
  - release
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: 66e26c2730ee5ab4fdac1f9c7cc6127af8ac9f5b6ca044504bbc52bbf3af2fdf
sources:
  - id: pnpm-workspace-yaml
    resource: ../../pnpm-workspace.yaml
  - id: claude-code-plugin-package-json
    resource: ../../plugins/claude-code/package.json
  - id: changeset-config
    resource: ../../.changeset/config.json
  - id: claude-plugin-manifest
    resource: ../../plugins/claude-code/.claude-plugin/plugin.json
  - id: workspace-layering-test
    resource: ../../packages/plugin/__test__/workspace-layering.test.ts
---

# Claude Code Plugin as a Release-Only pnpm Workspace

## Context

The plugin used to sit outside the workspace set, coupled to
`@vitest-agent/plugin`'s own `.changeset/config.json` `versionFiles` entry
— bumping the Vitest plugin package also rewrote the marketplace
manifest's `$.version`. A change touching only a hook script or an agent
prompt therefore forced a version bump, a build, and an npm publish of
`@vitest-agent/plugin`, a published artifact churned for a change that
never reaches npm.

## Decision

`pnpm-workspace.yaml` globs `plugins/*`,[^pnpm-workspace-yaml] so the tree at
`plugins/claude-code/` is an ordinary pnpm workspace member. That
directory carries a `package.json` naming
`@vitest-agent/claude-code-plugin`, `"private": true`, with no
`publishConfig` and no scripts — its sole declared purpose, stated in its
own `description` field, is to exist so changesets has something to
version.[^claude-code-plugin-package-json] `.changeset/config.json` moves
its `versionFiles` entry onto that package, globbing
`plugins/claude-code/.claude-plugin/plugin.json` at `$.version`, with
`privatePackages: { tag: true, version: true }` set at the top
level.[^changeset-config] A changeset written against
`@vitest-agent/claude-code-plugin` therefore bumps the tracking
`package.json` and the marketplace manifest's version field in one step;
CI then cuts a `@vitest-agent/claude-code-plugin@<version>` git tag and
GitHub Release from that bump and stops there — no npm publish, because
the package carries no `publishConfig` and no build output. The
marketplace itself reads the manifest at
`plugins/claude-code/.claude-plugin/plugin.json` directly, so nothing
about how the plugin is distributed changes because of workspace
membership.[^claude-plugin-manifest]

Changesets versions packages, not arbitrary files, so giving the plugin
its own release cadence required giving it a package to version — a
private, script-free tracking package is the minimal shape that satisfies
that requirement without implying the tree has a build output or a
dependency graph of its own. `packages/plugin/__test__/workspace-layering.test.ts`
holds every workspace package, `plugins/*` included, to the root
`layers.json`, which classifies `@vitest-agent/claude-code-plugin` as
`tooling`: a package any layer may depend on that never depends on a
layer. That makes it an ordinary node in the checked graph rather than
a special case the layering rule has to carve out.[^workspace-layering-test]

## Alternatives rejected

- **Keep the manifest version coupled to `@vitest-agent/plugin`.** Rejected
  because a plugin-only change (a hook script, an agent prompt, a skill)
  has nothing to do with the Vitest plugin's own release cadence, and
  forcing a publish of a published npm artifact for a change that never
  reaches npm wastes a version and a build for no consumer-visible reason.
- **Give the plugin tree a real, buildable `package.json`** (scripts,
  dependencies, a `dist/`) so it looked like the other workspace packages.
  Rejected because the plugin ships as a file tree through the Claude
  marketplace, not as an npm module a consumer installs — a build step and
  a dependency graph would be machinery with no reader.
- **Track the plugin's version outside pnpm entirely** (a bespoke script
  bumping `plugin.json` directly). Rejected because it would duplicate
  what `.changeset/config.json`'s `versionFiles` mechanism already does
  for every other private-but-tagged package, for no benefit beyond
  avoiding one `package.json` file.

## Consequences

A changeset for the plugin must name `@vitest-agent/claude-code-plugin`;
naming any other package does nothing to the marketplace manifest and a
changeset naming `@vitest-agent/plugin` for a plugin-only change forces a
pointless npm build and publish. Because the plugin's `package.json`
carries no `publishConfig`, `privatePackages.tag` and `.version` are what
tell the release pipeline to tag and version this package without ever
attempting to publish it — flipping either flag off would either stop the
manifest from being bumped or attempt an npm publish of a package with no
build output. Relative path traversal inside the plugin tree is
independent of this decision and must be counted from
`plugins/claude-code/`, not from any historical location the tree lived
at before it became a workspace member.

## Related

- [Module: claude-code-plugin](../modules/claude-code-plugin.md)

[^pnpm-workspace-yaml]: `../../pnpm-workspace.yaml:4`
[^claude-code-plugin-package-json]: `../../plugins/claude-code/package.json:1-5`
[^changeset-config]: `../../.changeset/config.json:8-26`
[^claude-plugin-manifest]: `../../plugins/claude-code/.claude-plugin/plugin.json:1-9`
[^workspace-layering-test]: `../../packages/plugin/__test__/workspace-layering.test.ts`
