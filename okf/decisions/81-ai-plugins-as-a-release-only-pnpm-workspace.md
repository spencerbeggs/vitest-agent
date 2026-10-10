---
type: Decision
title: "@vitest-agent/ai-plugins as a Release-Only pnpm Workspace"
description: The agent plugin at plugin/ is versioned through the private @vitest-agent/ai-plugins tracking package, whose changesets versionFiles bump both built manifests, so a plugin change cuts a GitHub release and never forces an npm publish.
status: stable
supersedes: 64-claude-code-plugin-as-a-release-only-pnpm-workspace.md
tags:
  - architecture
  - release
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: ed3f6dbb88f61c3b06dcb7e583a2207d49452af06c29b152c8365aec73c363e3
sources:
  - id: pnpm-workspace-yaml
    resource: ../../pnpm-workspace.yaml
  - id: ai-plugins-package-json
    resource: ../../plugin/package.json
  - id: changeset-config
    resource: ../../.changeset/config.json
  - id: layers-json
    resource: ../../layers.json
  - id: workspace-layering-test
    resource: ../../packages/plugin/__test__/workspace-layering.test.ts
verified:
  - by: human:spencer
    at: 2026-10-10T02:23:56Z
---

# @vitest-agent/ai-plugins as a Release-Only pnpm Workspace

## Context

[Decision 64](64-claude-code-plugin-as-a-release-only-pnpm-workspace.md)
gave the Claude Code plugin at `plugins/claude-code/` its own private
tracking package, `@vitest-agent/claude-code-plugin`, so a hook-only change
stopped forcing an npm publish of `@vitest-agent/plugin`. The pluginfinity
migration ([Decision 80](80-build-the-agent-plugin-from-one-pluginfinity-source.md))
moved the source to `plugin/` and made it build two manifests instead of
one, so the package name, its path, and its `versionFiles` all changed.
The choice itself (a release-only tracking package) still holds.

## Decision

`pnpm-workspace.yaml` lists `plugin`, so `plugin/` is an ordinary
workspace member.[^pnpm-workspace-yaml] Its `package.json` names
`@vitest-agent/ai-plugins`, is `"private": true`, and has no
`publishConfig`. Unlike its predecessor it carries scripts, because the
source now builds: `build:dev` / `build:prod` run `pluginfinity build`,
`build:check` runs `pluginfinity build --check`, plus `validate`,
`test:bats`, and `types:check`.[^ai-plugins-package-json]
`.changeset/config.json` maps the package's `versionFiles` onto both
built manifests at `$.version`, `plugin/builds/claude/.claude-plugin/plugin.json`
and `plugin/builds/copilot/plugin.json`, with
`privatePackages: { tag: true, version: true }` at the top
level.[^changeset-config] A changeset naming `@vitest-agent/ai-plugins`
bumps the tracking `package.json` and both manifests in one step, so
`pluginfinity build --check` stays clean after `changeset version`; CI
then cuts an `@vitest-agent/ai-plugins@<version>` git tag and GitHub
Release and stops there. The root `layers.json` lists the package under
`tooling`,[^layers-json] which `workspace-layering.test.ts` holds it
to.[^workspace-layering-test]

## Alternatives rejected

- **Keep the old package name.** Rejected: `claude-code-plugin` names one
  host, and the package now versions plugins for two.
- **Version only the Claude manifest and let pluginfinity copy the
  version.** Rejected: the Copilot manifest is a committed build output, so
  a version written only to the Claude manifest would leave the Copilot
  build stale and `pluginfinity build --check` failing after every
  release.
- The alternatives [Decision 64](64-claude-code-plugin-as-a-release-only-pnpm-workspace.md)
  rejected (coupling the manifest version to `@vitest-agent/plugin`, a
  bespoke version-bump script) stay rejected for the same reasons.

## Consequences

A changeset for any plugin-only change must name `@vitest-agent/ai-plugins`;
naming `@vitest-agent/plugin` forces a pointless npm build and publish. The
marketplace entries live in the separate `spencerbeggs/bot` repository and
must point at `plugin/builds/claude` (and a Copilot entry at
`plugin/builds/copilot`), and its re-pin automation must learn the new tag
prefix `@vitest-agent/ai-plugins@`; that repointing is outside this
repository.

## Related

- [Module: vitest-agent agent plugin](../modules/claude-code-plugin.md)
- [Runbook: Release](../runbooks/release.md)

[^pnpm-workspace-yaml]: `../../pnpm-workspace.yaml`
[^ai-plugins-package-json]: `../../plugin/package.json`
[^changeset-config]: `../../.changeset/config.json`
[^layers-json]: `../../layers.json`
[^workspace-layering-test]: `../../packages/plugin/__test__/workspace-layering.test.ts`
