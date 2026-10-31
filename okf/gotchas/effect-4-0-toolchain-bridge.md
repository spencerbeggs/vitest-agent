---
type: Gotcha
status: draft
title: The lockfile's effect@4.0.7 is a deliberate toolchain bridge, not drift
description: "The lockfile resolves effect@4.0.7 beside the catalog's 4.1.1 because the root .pnpmfile.cjs aliases the build toolchain and the 4.0.x kit it loads back to 4.0.7; it looks like a stray duplicate to dedupe, but deleting the hook makes those tools die at import on a missing Crypto export."
resource: ../../.pnpmfile.cjs
tags: [deps, compat, effect, dx]
stale_after: "2027-01-31T00:00:00Z"
sources:
  - id: pnpmfile
    resource: ../../.pnpmfile.cjs
    title: The readPackage hook that bridges the toolchain to effect 4.0.7
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
    title: configDependencies naming @effected/pnpm-plugin-effected
  - id: effected-pr-1168
    resource: https://github.com/spencerbeggs/effected/pull/1168
    title: The effected Effect 4.1 round the bridge is waiting on
generated:
  by: okfit/claude-code
  at: 2026-10-31T21:28:19Z
integrity:
  generated:
    body: 6c1a7ad30432b7ab
---

# The lockfile's effect@4.0.7 is a deliberate toolchain bridge, not drift

**What you see.** The catalog pins the Effect family to `~4.1.1`
([Convention: Effect v4
dependencies](../conventions/effect-v4-dependencies.md)), yet
`pnpm-lock.yaml` carries a second `effect@4.0.7` package entry, and
published build tools such as `@savvy-web/*`, `@okfit/*`, `@tsdoctor/*`,
and `pluginfinity` resolve `effect` through an `npm:effect@4.0.7` alias.
It reads as a duplicate a dedupe or an override would clean up, or as the
catalog failing to apply.

**What is actually true.** It is deliberate. The build toolchain still
ships on published `@effected/*` releases built on Effect 4.0.x, and those
import `Crypto` from the `effect` root, which Effect 4.1 removed, so on
4.1.1 they die at import. The root `.pnpmfile.cjs` adds a `readPackage`
hook that rewrites every 4.x effect-line edge (`effect`, `@effect/*`) of
those packages into an npm alias of 4.0.7[^pnpmfile]. An alias is what
gets past the catalog plugin's graph-wide 4.1.1 override[^pnpm-workspace].
The hook bridges a package when it is one of the listed toolchain scopes,
any published `@effected/*` package, or any package that depends on the
kit (`reachesKit`, which is how `rspress-plugin-api-extractor` is caught).
Private workspace packages are never touched.

**Where it differs from the upstream template.** The hook skips any
package that already declares an effect-line spec on 4.1 or later
(`builtOnNewEffect`). The new kit round peers on `~4.1.0`, so this
repository's own runtime kit dependencies (for example `@effected/mcp`
0.12.0 and `@effected/cli` 0.25.0) stay on 4.1.1 while the old kit the
tools load is bridged. The effected repository's version of this hook
bridges every `@effected/*` package, because that repository does not
consume the 4.1 kit at runtime. Copying the template over this file
would push the runtime kit back onto 4.0.7.

**When it goes away.** The bridge is temporary, tied to the effected 4.1
round[^effected-pr-1168]. Delete `.pnpmfile.cjs` once every tool this
repository builds with has republished on an `@effected` release built on
Effect 4.1, then reinstall. The removal is done when no `packages:` entry
in `pnpm-lock.yaml` names `effect@4.0.7`. Until then, removing the hook
early is the failure to watch for: a build, `okfit`, `tsdoctor`, or
`pluginfinity` run that throws on a missing `Crypto` export at import.

[^pnpmfile]: `../../.pnpmfile.cjs`
[^pnpm-workspace]: `../../pnpm-workspace.yaml`
[^effected-pr-1168]: <https://github.com/spencerbeggs/effected/pull/1168>
