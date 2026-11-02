---
type: Gotcha
status: deprecated
title: The lockfile's effect@4.0.7 was a deliberate toolchain bridge, not drift
description: "Retired: the build toolchain now runs on Effect 4.1, the root .pnpmfile.cjs that aliased it back to effect@4.0.7 is deleted, and the lockfile resolves one effect version; a second effect entry in pnpm-lock.yaml is no longer expected and is worth investigating."
resource: ../../pnpm-workspace.yaml
tags: [deps, compat, effect, dx]
stale_after: "2027-01-31T00:00:00Z"
sources:
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
    title: configDependencies naming @effected/pnpm-plugin-effected
  - id: pnpm-lock
    resource: ../../pnpm-lock.yaml
    title: The lockfile, which resolves a single effect version
  - id: effected-pr-1168
    resource: https://github.com/spencerbeggs/effected/pull/1168
    title: The effected Effect 4.1 round the bridge waited on
generated:
  by: okfit/claude-code
  at: 2026-11-02T19:18:11Z
integrity:
  generated:
    body: 713d3c5d6f7126fd
---

# The lockfile's effect@4.0.7 was a deliberate toolchain bridge, not drift

**Deprecated: this trap no longer exists.** The build toolchain
(`@savvy-web/*`, `okfit`, `pluginfinity`) now ships on an `@effected`
release built on Effect 4.1[^effected-pr-1168], so the root `.pnpmfile.cjs`
that aliased it back to `effect@4.0.7` has been deleted. Removing the hook
changed the resolved graph not at all: `pnpm-lock.yaml` resolves one
`effect` version, the one the `effected` catalog pins[^pnpm-lock], and
holds no `effect@4.0.7` entry. The catalog itself comes from
`@effected/pnpm-plugin-effected` in `configDependencies`[^pnpm-workspace];
its contract is [Convention: Effect v4
dependencies](../conventions/effect-v4-dependencies.md).

**What this means for a reader now.** A second `effect` version in the
lockfile is no longer an expected bridge. If one reappears, it is real
drift (a dependency pinning an older Effect line, or the catalog not
applying), not something to leave alone; do not restore a `readPackage`
hook to paper over it without a new Gotcha that says why.

[^effected-pr-1168]: <https://github.com/spencerbeggs/effected/pull/1168>
[^pnpm-lock]: `../../pnpm-lock.yaml`
[^pnpm-workspace]: `../../pnpm-workspace.yaml`
