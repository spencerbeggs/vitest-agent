---
type: Decision
status: stable
title: Serialize runScript Builds with a File-Based Advisory Lock
description: "A pid-probed, owner-gated file lock, @effected/commands' RunOnce, serializes concurrent AgentPlugin.runScript globalSetup builds instead of letting them race over one output directory."
tags: [architecture, performance]
generated:
  by: okfit/claude-code
  at: 2026-10-27T13:30:27Z
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
integrity:
  generated:
    body: 1dea7c3b4ff69cbc
---

# Serialize runScript Builds with a File-Based Advisory Lock

## Context

Two `vitest` invocations in one checkout can each run the `globalSetup`
build via `AgentPlugin.runScript`, and the two builds race over the same
output directory. Per-invocation isolation — the fix used for a
different shared-resource collision — does not transfer here: it is
meaningless for a build whose entire purpose is a shared output
directory. Serialization is the only available answer.

## Decision

`AgentPlugin.runScript` serializes on a file-based advisory lock, and the
lock protocol is `@effected/commands`' `RunOnce`: `runScript` calls
`RunOnce.commandSync(runScriptOptions(command, cwd, env), nodeRunOnceHost,
run)` (`packages/plugin/src/plugin.ts`). What stays in this repository is
the settings `packages/plugin/src/utils/run-script-lock.ts` derives: the
key `runScriptLockKey(root, command)`, a truncated SHA-256 over the
workspace root (`findWorkspaceRootSync`, else the cwd) plus the command,
so per-package runs in one monorepo serialize the same root build; the
directory `resolveRunScriptLockDir(env)`, the same
`$XDG_DATA_HOME`/`~/.local/share/vitest-agent` convention `data.db`
resolution uses; and the `VITEST_AGENT_RUNSCRIPT_*` timing overrides.

`RunOnce` acquires with an exclusive create and writes an owner record;
the winner runs the command and stamps a done marker. A waiter skips its
own run only when it watched that owner hold the lock and the owner
succeeded; a previous, sequential run is never trusted, so an edit
followed by a re-run always rebuilds, unless
`VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS` opts into trusting a marker
that young.

**Liveness decides takeover, not age.** A lock file's mtime is never
refreshed during a build, so a long-but-healthy build is
indistinguishable by age alone from a dead one. Past the stale window
(60 s by default) `RunOnce` probes the recorded owner's pid and host,
and a live owner keeps its lock however old it is; only a dead owner, or
a lock with no readable owner record, is broken. Release is owner-only:
a process that lost its lock to a takeover cannot delete the new owner's
lock in its own cleanup.

**Trade-offs accepted, both deliberate.** The stale takeover exists at
all because a process killed mid-build would otherwise hang every future
`vitest` invocation in that checkout forever. A waiter blocked past the
wait timeout (10 minutes by default), or a caller that cannot create the
lock at all, runs its command **unserialized** — reproducing the original
race for that one pair of processes, accepted because an indefinitely
hung test run is worse than a rare duplicated build. The wait is
synchronous, because `runScript` is a synchronous Vitest `globalSetup`
helper. The timing overrides are parsed strictly through
`parseLockTimingOverride` (whole-string integers only, bounded below)
rather than with `Number.parseInt`, because a typo like `"200ms"` or
`"-1"` must fall back to the `RunOnce` default, which also treats a
non-positive timing as a wiring defect and throws.

## Alternatives rejected

- **Per-invocation output isolation (as used elsewhere for a similar
  shared-resource collision):** does not transfer — the build's entire
  purpose is a shared output directory, so isolating each invocation's
  output defeats the build.
- **Age-only stale-lock takeover:** rejected because a lock file's mtime
  never refreshes during a build, making a slow-but-live build
  indistinguishable from a dead one; the pid-liveness probe is required
  to tell them apart.
- **Unconditional release on `finally`:** rejected because it lets an
  owner that lost its lock to a takeover delete the new owner's lock,
  admitting a third process mid-build; the per-acquisition nonce gate
  closes that hole.

## Consequences

- Two concurrent `vitest` invocations in one workspace never run the same
  `globalSetup` command twice at once; the second waits, then either
  skips (its watched owner succeeded) or serializes behind the first.
- A crashed owner's lock recovers once the stale window passes rather
  than hanging every future invocation forever.
- The escape valve (wait timeout exceeded → unserialized run) means
  serialization is best-effort by contract, not a hard guarantee; a test
  or CI environment relying on the lock for exclusivity beyond ten
  minutes needs a different mechanism.
- Tests tune the timings through the `VITEST_AGENT_RUNSCRIPT_*` env
  overrides rather than changing the defaults, keeping the concurrency
  e2e suite's timing independent of real-world build durations.
- The protocol's correctness lives in the kit, so a fix to takeover or
  release lands as an `@effected/commands` upgrade, not an edit here.

## Related

- [Decision 49 — Per-Invocation Coverage Directory for MCP Runs](./49-per-invocation-coverage-directory-for-mcp-runs.md)
