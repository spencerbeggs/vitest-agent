---
type: Decision
title: Plugin MCP Loader Execs the Consumer's node_modules/.bin
description: The plugin's zero-deps shell loader execs the consumer's own linked vitest-agent-mcp bin directly, bypassing per-package-manager dispatch entirely, and falls back to npx only when that bin is absent.
status: draft
tags:
  - architecture
  - mcp
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: 2e2268977dd6e76e1b763dace4cd894b7967ee4b2a81a151224a6ceb7c9a6487
sources:
  - id: plugin-start-mcp-sh
    resource: ../../plugins/claude-code/bin/start-mcp.sh
  - id: engine-project-dir
    resource: ../../packages/engine/src/project-dir.ts
  - id: plugin-detect-pm-sh
    resource: ../../plugins/claude-code/hooks/lib/detect-pm.sh
---

# Plugin MCP Loader Execs the Consumer's node_modules/.bin

## Context

An earlier loader resolved the MCP server module by walking up from the
plugin directory through `node_modules` looking for a `./mcp` subpath
export, then dynamically importing it as a `file://` URL — a manual
reimplementation of Node's module resolution that broke under yarn berry
PnP and custom store directories and surfaced failures as an unhelpful
"couldn't find `./mcp` export" rather than "the package isn't installed". A
later PM-detect-and-exec form replaced the dynamic import with dispatch
through `pnpm exec` / `npx --no-install` / `yarn run` / `bun x`, but that
package-manager dispatch layer still resolved bins differently per manager
and, for pnpm, only found a transitive bin at all because a pnpm plugin
publicly hoisted it — both forms are retired.

## Decision

`plugins/claude-code/bin/start-mcp.sh` is the loader Claude Code spawns as a
direct child over stdio. It is a zero-dependency POSIX shell script
(`set -eu`, no `jq`):

1. Resolve `ROOT` from `CLAUDE_PROJECT_DIR` (or `pwd`) and export
   `VITEST_AGENT_REPORTER_PROJECT_DIR=$ROOT`.
2. If `$ROOT/node_modules/.bin/vitest-agent-mcp` is executable, `exec` it
   directly with the positional args passed through verbatim (e.g.
   `--noop=1` from `plugin.json`) — this is the entire happy path.
3. Otherwise detect the package manager (`packageManager` in `package.json`
   read via grep/sed, else the first lockfile present in the order
   `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `yarn.lock`,
   `package-lock.json`, defaulting to npm) **only** to pick which install
   command to print on stderr, then `exec npx --yes
   @vitest-agent/mcp@5 "$@"` as a network fallback, pinned to the
   major the hooks were written for.

`start-mcp.mjs` mirrors the same preference order for debugging
(`accessSync(localBin, X_OK)` then a direct spawn, else the same
not-installed message and PM dispatch fallback); `plugin.json` references
the shell loader as the one Claude Code actually spawns.

**Why `.bin`-first.** `@vitest-agent/plugin` is the carrier package (see
[Decision 70](./70-carrier-pattern-and-ranked-layering.md)): it declares
`vitest-agent-mcp` as its own bin, so every consumer that installs the
plugin — under npm, pnpm, yarn, or bun — already has that bin linked at
`node_modules/.bin/vitest-agent-mcp`. Exec'ing that path directly removes
the package-manager dispatch layer entirely rather than routing through
`pnpm exec` / `yarn run` / `bun x` / `npx --no-install`, each of which
resolves bins through a different algorithm and, for pnpm specifically, only
worked when a pnpm plugin had publicly hoisted the transitive bin.

**The `exec` is load-bearing**, not stylistic: once the script `exec`s the
resolved bin, Claude Code's direct child *is* the MCP server process
itself — there is no remaining shell wrapper to forward signals or buffer
stdio, and stdin EOF ends the session cleanly. A plain (non-`exec`) spawn
would leave the shell process as an intermediary that has to be kept alive
and whose exit path is a separate failure mode.

**`VITEST_AGENT_REPORTER_PROJECT_DIR` env passthrough**: the spawned MCP
server reads this variable as the second rung of `resolveProjectDir`
(`packages/engine/src/project-dir.ts:6-8`) — after the hook-driven
`VITEST_AGENT_PROJECT_DIR`, before `CLAUDE_PROJECT_DIR` and `cwd`. Claude
Code sets `CLAUDE_PROJECT_DIR` for hook scripts but does not reliably
propagate it to MCP server subprocesses, so the loader passes its own
resolved root through explicitly.

**The hooks use the same `.bin`-first preference.**
`plugins/claude-code/hooks/lib/detect-pm.sh`'s `detect_vitest_agent_bin`
returns `$VITEST_AGENT_CLI_CMD` when set, else the relative
`node_modules/.bin/vitest-agent` when present, else `vitest-agent` on
`PATH`, else fails with no output so the call site emits its own no-op
and exits 0 — hooks never dispatch through a package manager and never
fall back to `npx`, because a hook fires far more often than the server
starts; the relative form (not an absolute path) exists so an
unquoted `$cli` expansion still survives a `cwd` containing spaces, given
the call site's load-bearing `cd "$cwd" &&` before the expansion.

## Alternatives rejected

- **Dynamic `file://` import of a `./mcp` subpath export** (the original
  form): rejected — it duplicated Node's own module resolution algorithm,
  broke under yarn berry PnP and custom pnpm store layouts, and produced an
  opaque resolution error instead of an actionable "not installed" message.
- **Package-manager dispatch** (`pnpm exec` / `npx --no-install` / `yarn
  run` / `bun x`) as the primary resolution path (the retired Decision 29 →
  30 PM-exec form): rejected because each package manager's dispatch
  command resolves bins by a different algorithm, and pnpm in particular
  only found the bin transitively when a pnpm plugin had publicly hoisted
  it — an implicit, easy-to-lose precondition. Exec'ing the carrier's own
  linked bin directly needs no such precondition, since the carrier pattern
  itself guarantees the bin exists at a known relative path.

## Consequences

- The loader depends on `@vitest-agent/plugin` being the thing every
  consumer installs (the carrier pattern) — if a consumer somehow installed
  `@vitest-agent/mcp` directly without the plugin, `node_modules/.bin/
  vitest-agent-mcp` would not exist under their project root and the loader
  would fall through to the `npx` network fallback every time.
  `bin-preference.bats` exercises both the loader and the hooks' helper
  against this contract.
- The `npx --yes @vitest-agent/mcp@5` fallback fetches the published
  package from the registry on every invocation when the local bin is
  missing — acceptable UX for a consumer who has not yet installed the
  plugin, but it means this very repository's own dogfood setup depends on
  the carrier's built bin being linked at the workspace root (it is, via
  the root's single `@vitest-agent/plugin` devDependency).
- Because `exec` replaces the shell process, any change to `start-mcp.sh`
  that inserts logic *after* the `exec` call is dead code — nothing runs
  in that shell again once the exec succeeds.

## Related

- [Decision 70 — Carrier Pattern and Ranked Layering](./70-carrier-pattern-and-ranked-layering.md)
