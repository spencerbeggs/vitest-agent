---
type: Convention
title: Root prepare stays husky-only — never a build step
description: "Root package.json's prepare script must remain \"husky\" alone; adding a build step there cross-compiles the four platform sidecar SEA binaries on every install, and the win32 target cannot be built on a non-Windows host, breaking a frozen-lockfile install after a cache clear."
tags: [ci, deps, dx]
status: stable
stale_after: 2027-03-13T00:00:00Z
sources:
  - id: root-package-json
    resource: ../../package.json
    title: Root package.json scripts.prepare
  - id: sidecar-win32-package-json
    resource: ../../packages/sidecar-win32-x64/package.json
    title: "sidecar-win32-x64's os/cpu restriction and its own build:dev/build:prod scripts"
  - id: sidecar-win32-build
    resource: ../../packages/sidecar-win32-x64/savvy.build.ts
    title: sidecar-win32-x64's exe-mode SEA build
  - id: owner-note
    resource: "conversation with the repository owner"
    author: "human:spencer@beg.gs"
    last_modified: 2026-09-13T00:00:00Z
    title: Why the build step was removed from root prepare
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
integrity:
  generated:
    body: 23d16dfe11748197
---

# Root prepare stays husky-only — never a build step

## `scripts.prepare` at the workspace root is `"husky"`, and only `"husky"`

Root `package.json`'s `prepare` script is `"husky"`[^root-package-json] —
nothing else. `prepare` runs on a plain local `pnpm install` with no
arguments, which is exactly the path a frozen-lockfile CI install and every
contributor's first checkout take. Keep it to the one line that installs the
Husky git hooks; do not fold a build step, a codegen step, or any other
workspace-wide command into it, even temporarily.

## Adding a build to `prepare` cross-compiles four platform-pinned SEA binaries on every install

Four workspace packages under `packages/sidecar-*` each build a
platform-restricted Node Single Executable Application binary: every one
declares a narrow `os` / `cpu` pair in its own `package.json` (for example,
`sidecar-win32-x64` declares `os: ["win32"], cpu: ["x64"]`[^sidecar-win32-package-json])
and builds that binary through `@savvy-web/bundler`'s `exe` mode in its own
`savvy.build.ts`[^sidecar-win32-build]. Running a workspace-wide `build:dev`
from the root `prepare` script means building all four of those SEA binaries
on whatever single host is running the install — including the three
platform/arch combinations that are not the host's own. `sidecar-win32-x64`'s
build has to obtain a Windows Node runtime archive to embed; on a Linux or
macOS host that step cannot complete, and a `prepare` failure aborts the
whole `pnpm install`. A frozen-lockfile install — the exact install a CI
runner or a fresh clone performs after its cache is cleared — fails outright
rather than merely being slow, because it has no cached build artifact to
fall back to and no interactive shell to work around the
failure[^owner-note].

## If a package needs its own dev build on install, that build stays scoped to that package

Do not solve "the sidecar binaries aren't built yet" by adding a build step
to the root `prepare`. A package that genuinely needs a fresh dev build the
moment its own dependencies resolve declares that in its own lifecycle
scripts, scoped to itself — not by making every install of the whole
workspace responsible for cross-compiling binaries for platforms the current
host cannot target. Verify a change to this rule against `jq .scripts.prepare
package.json` before assuming it holds; a build step landing back in the
root `prepare` script is the regression this convention exists to catch.

## Related concepts

- [modules/sidecar.md](../modules/sidecar.md) documents the sidecar module
  and its four platform sub-packages, including their build shape.
- [modules/workspace.md](../modules/workspace.md) documents the workspace
  root's own tooling and lifecycle scripts.

[^root-package-json]: ../../package.json
[^sidecar-win32-package-json]: ../../packages/sidecar-win32-x64/package.json
[^sidecar-win32-build]: ../../packages/sidecar-win32-x64/savvy.build.ts
[^owner-note]: conversation with the repository owner
