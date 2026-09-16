---
type: Runbook
title: Release a package (or the Claude Code plugin)
description: The changeset-to-publish pipeline for the independently versioned vitest-agent family, including the one ordering gate (engine before plugin) that a release must satisfy.
resource: ../../.github/workflows/release.yml
tags: [release, ci]
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
  body_sha256: c23dda493e793a89d11e7253bf59f7df98cebe627594fd093a17023d33041e8d
sources:
  - id: release-workflow
    resource: ../../.github/workflows/release.yml
  - id: deploy-docs-workflow
    resource: ../../.github/workflows/deploy-docs.yml
  - id: changeset-config
    resource: ../../.changeset/config.json
  - id: bins-packed-install-e2e
    resource: ../../packages/plugin/__test__/bins-packed-install.e2e.test.ts
  - id: plugin-package-json
    resource: ../../packages/plugin/package.json
---

# Release a package (or the Claude Code plugin)

## Trigger

One or more changeset files under `.changeset/*.md` have merged to `main`
naming a package whose changes are ready to ship.

## Steps

1. **Write a changeset naming every package the branch touches.**
   `.changeset/config.json` carries no `fixed`/`linked` grouping and sets
   `updateInternalDependencies: "patch"`, so a changeset only bumps the
   package(s) it names plus a patch ripple to direct workspace
   dependents — never a shared lockstep bump.[^changeset-config] A
   Claude Code plugin change (hooks, skills, agent prompts) is named as
   `@vitest-agent/claude-code-plugin`, never `@vitest-agent/plugin` — see
   [Convention: Commits and changesets](../conventions/commits-and-changesets.md).
2. **Merge to `main`.** The reusable release workflow
   (`spencerbeggs/.github/.github/workflows/release.yml`) runs on every
   push to `main` and on pull requests targeting `main` or
   `changeset-release/main`, opening or updating a changeset "Release PR"
   that batches the pending version bumps.[^release-workflow] Fork pull
   requests run under `pull_request_target`, gated behind the
   `fork-review` environment's required reviewer before any run touches
   secrets.[^release-workflow]
3. **Merge the release PR.** Merging it is what actually cuts versions:
   `.changeset/config.json`'s `privatePackages: { tag: true, version: true }`
   means every workspace package — including the private
   `@vitest-agent/claude-code-plugin` tracking package — gets a version
   bump, a git tag `@vitest-agent/<pkg>@<version>`, and a GitHub Release
   even when it never publishes to npm.[^changeset-config] `versionFiles`
   maps `@vitest-agent/claude-code-plugin`'s bump onto
   `plugins/claude-code/.claude-plugin/plugin.json`'s `$.version` field in
   the same step.[^changeset-config]
4. **Gate: engine must be tagged/published before the plugin.** The
   carrier (`@vitest-agent/plugin`) depends on `@vitest-agent/engine` (and
   `cli`, `mcp`, `reporter`, `sdk`) as regular `workspace:*` dependencies
   that publish exact-pinned;[^plugin-package-json] until engine has a
   real published version, a consumer resolving the plugin's manifest has
   nothing to pin to. `packages/plugin/__test__/bins-packed-install.e2e.test.ts`
   states this explicitly as the release gate its own tarball-override
   harness works around for local testing.[^bins-packed-install-e2e]
5. **npm publish with provenance.** Each publishable package (all eight
   under `packages/`, plus the four `sidecar-*` platform packages)
   publishes to npm with provenance attestations as part of the same
   release run; `@vitest-agent/claude-code-plugin` is tag-and-version-only
   and skips this step.[^changeset-config] The published `run.json` JSON
   Schema imposes no ordering here: its `$id` is a GitHub raw URL of the
   committed `schemas/5.0/run.json`, live the moment the file is on
   `main`, and `schemastore check` plus the sdk's schema-drift e2e test
   hold the document and `RUN_REPORT_FILE_SCHEMA_URL` together before
   merge (see
   [Interface: published-json-schemas](../interfaces/published-json-schemas.md)).
6. **Docs deploy fires off the plugin's GitHub Release.**
   `deploy-docs.yml` triggers on `release: types: [published]`, but only
   runs its job when the release name contains the literal substring
   `@vitest-agent/plugin`[^deploy-docs-workflow] — a release batch that
   bumps several packages at once still deploys the docs site exactly
   once, keyed on the one package name no other package's name
   contains. A `workflow_dispatch` also deploys, for a manual redeploy or
   the first test deployment.[^deploy-docs-workflow]
7. **The Claude Code plugin's release is tag-only.** A
   `@vitest-agent/claude-code-plugin@<version>` tag and GitHub Release are
   produced by the same batch (step 3) with no npm publish step — the
   package carries no `publishConfig` and no build output, by design (see
   [Decision 64](../decisions/64-claude-code-plugin-as-a-release-only-pnpm-workspace.md)).
   The Claude marketplace reads
   `plugins/claude-code/.claude-plugin/plugin.json` directly, so nothing
   about distribution changes beyond the version field bump.

## Observable end state

Every named package in the merged changesets has a new git tag
`@vitest-agent/<pkg>@<version>`, a matching GitHub Release with its own
changelog body and provenance assets, and — for a publishable package — a
new version live on the npm registry. If the release batch included
`@vitest-agent/plugin`, the docs site at `vitest-agent.dev` has redeployed
from that same commit.

## Related

- [Convention: Commits and changesets](../conventions/commits-and-changesets.md)
- [Interface: published-json-schemas](../interfaces/published-json-schemas.md)
- [Module: website](../modules/website.md)
- [Decision 36 — Independent Per-Package Release](../decisions/36-independent-per-package-release.md)
- [Decision 64 — Claude Code Plugin as a Release-Only pnpm Workspace](../decisions/64-claude-code-plugin-as-a-release-only-pnpm-workspace.md)
- [Decision 65 — Drop Vitest 4, Require vitest ^5.0.0](../decisions/65-drop-vitest-4-require-vitest-5.md)
- [Decision 70 — Carrier Pattern and Ranked Layering](../decisions/70-carrier-pattern-and-ranked-layering.md)

[^release-workflow]: `../../.github/workflows/release.yml:1-49`
[^deploy-docs-workflow]: `../../.github/workflows/deploy-docs.yml:17-53`
[^changeset-config]: `../../.changeset/config.json:1-27`
[^bins-packed-install-e2e]: `../../packages/plugin/__test__/bins-packed-install.e2e.test.ts`
[^plugin-package-json]: `../../packages/plugin/package.json`
