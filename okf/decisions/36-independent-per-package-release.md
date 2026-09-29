---
type: Decision
status: stable
title: Independent Per-Package Release
description: Changesets carries no fixed or linked grouping across @vitest-agent/* packages, so each releases and tags independently with patch ripples only through dependency-range bumps.
tags: [architecture, release]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: d86c85edd480855ffc0697a17bc2449be8d556dabfe820866f4ef6733c8526ec
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Independent Per-Package Release

## Context

An earlier lockstep form pinned all six runtime packages to one shared
version — a bump to any one bumped all six — and ran three init-time
checks asserting exact version equality across the family at runtime,
each emitting a stderr warning on mismatch. Once packages are allowed to
move independently, that equality assertion becomes a false positive on
every ordinary consumer install: a plugin on one minor legitimately
running an mcp on a later compatible minor is not drift. The lockstep
grouping and the runtime drift check were removed together.

## Decision

Every `@vitest-agent/*` package versions independently.
`.changeset/config.json` carries no `fixed` or `linked` grouping
(`.changeset/config.json`); `updateInternalDependencies` is set to
`"patch"` (`.changeset/config.json`), so a release of one package never
forces a version bump on an unrelated sibling.

Each runtime package still exports a `CURRENT_<PKG>_VERSION` constant,
inlined from `process.env.__PACKAGE_VERSION__` at build time —
`CURRENT_SDK_VERSION` (`packages/sdk/src/version.ts`),
`CURRENT_ENGINE_VERSION` (`packages/engine/src/version.ts`),
`CURRENT_CLI_VERSION` (`packages/cli/src/version.ts`), and
`CURRENT_MCP_VERSION` (`packages/mcp/src/version.ts`), with matching
constants in `plugin` and `reporter`. These remain part of the public API
— a consumer or a package's own test can read its release version — but
nothing compares them across packages at init any more.

**The ripple mechanism.** The plugin declares `@vitest-agent/cli` and
`@vitest-agent/mcp` as regular `workspace:*` dependencies in source
(they publish as exact-pinned regular dependencies — see
[Decision 33](./33-package-split.md)). Any cli/mcp release pushes the
plugin's dependency range out of bounds, so `updateInternalDependencies:
"patch"` auto-PATCH-bumps the plugin and re-pins the exact version. The
earlier form declared them as `workspace:^` required peers promoted at
build time; that shape existed to dodge changesets' changed-peer-range
forces-a-major rule and became moot once the peer promotion itself was
removed.

**Release artifacts.** A release produces, per package, a git tag
`@vitest-agent/<pkg>@<version>` (changesets' scoped-package tag format)
and one GitHub Release titled with that same tag, each carrying that
package's own changelog body, its own provenance assets (npm tarball,
SBOM, API report, meta), and a per-package publish summary. The docs
deploy workflow keys its trigger on the plugin Release name containing
`@vitest-agent/plugin`
(`.github/workflows/deploy-docs.yml`) — unchanged by this decision.
`@vitest-agent/claude-code-plugin` releases through the same scheme minus
the npm publish step (`privatePackages: { tag: true, version: true }`,
`.changeset/config.json`), with `versionFiles` mapping its version
bump onto `plugins/claude-code/.claude-plugin/plugin.json`'s `$.version`
field (`.changeset/config.json`).

**Why independent (vs lockstep).** The lockstep form bumped all six
runtime packages on the smallest change to any one and asserted exact
version equality across the family at runtime. Once the packages are
allowed to move independently, that equality assertion is a false
positive on every ordinary consumer install, so the shared release train
and the drift check were removed together. The package-boundary
contracts at the SDK layer (see Decision 33 and
[Decision 34](./34-plugin-reporter-split.md)) are enforced by dependency
ranges and TypeScript, not by a runtime string compare.

**Why the Claude Code plugin and sidecar were already independent.** Both
versioned on their own before this change — the marketplace plugin is a
file-based distribution with its own cadence, and `@vitest-agent/sidecar`
ships per-platform binaries that rev separately. Independent versioning
generalizes that posture to the whole family.

## Alternatives rejected

- **Keep the lockstep `fixed`/`linked` grouping and the runtime drift
  check**: rejected because independent minor versions across the family
  are a legitimate, common consumer state, and a runtime equality
  assertion against that state produces false-positive warnings on every
  ordinary install rather than catching a real incompatibility.
- **Keep cli/mcp as required `peerDependencies` to dodge changesets'
  changed-peer-range-forces-a-major rule**: rejected once the peer
  promotion itself was removed (see Decision 33) — the rule the peer
  shape was dodging no longer applies to a regular dependency.

## Consequences

- A release of `@vitest-agent/cli` or `@vitest-agent/mcp` alone
  auto-bumps `@vitest-agent/plugin` by a patch to re-pin the exact
  dependency version, even when nothing in the plugin's own source
  changed — a reviewer seeing a patch-only plugin changelog entry should
  expect this rather than treat it as an error.
- Nothing in the running process ever asserts that sibling package
  versions match; a version-skew bug between two packages must be caught
  by their type contracts or an integration test, not by a runtime
  string compare.
- The docs deploy trigger is coupled to the literal substring
  `@vitest-agent/plugin` in a Release name — renaming that package or
  changing the tag format would silently break the deploy trigger unless
  the workflow condition is updated in the same change.

## Related

- [Decision 33 — Package Split](./33-package-split.md)
- [Decision 30 — Plugin MCP Loader Execs the Consumer's node_modules/.bin](./30-plugin-mcp-loader-execs-the-consumer-s-node-modules-bin.md)
