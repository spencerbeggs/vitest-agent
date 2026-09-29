---
type: Decision
status: stable
title: Serialize runScript Builds with a File-Based Advisory Lock
description: A pid-probed, nonce-gated file lock serializes concurrent AgentPlugin.runScript globalSetup builds instead of letting them race over one output directory.
tags: [architecture, performance]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 0c03cb11f16d85a26828b36c537c5708d7f495c902fec879f74dc191566c2d43
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
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

`packages/plugin/src/utils/run-script-lock.ts` implements a file-based
advisory lock keyed by a truncated SHA-256 hash of `(cwd, command)`
(`computeLockKey`, `run-script-lock.ts`) under
`resolveRunScriptLockDir()` (`run-script-lock.ts`, the same
`$XDG_DATA_HOME`/`~/.local/share/vitest-agent` convention `data.db`
resolution uses). `acquireRunScriptLock` (`run-script-lock.ts`)
uses `openSync(lockPath, "wx")` as the atomic acquire
(`run-script-lock.ts`); the winner writes a JSON owner record (pid,
nonce, timestamp) into the lock file and, on success, calls
`markRunScriptDone` (`run-script-lock.ts`) to stamp a `.done`
marker. A waiter that sees a marker fresher than
`DEFAULT_BUILT_RECENTLY_MS` (30s, `run-script-lock.ts`) skips its own
build rather than repeating work that just completed. The freshness
check (`isRecentlyBuilt`, `run-script-lock.ts`) runs at the top
of every poll iteration (`run-script-lock.ts`), not only on the
`EEXIST` branch, because the winner removes its lock file after writing
the marker and a waiter landing in that window would otherwise
re-acquire and re-run.

**Refinement: liveness decides takeover, not age.** An age-only takeover
rule is wrong in both directions: a lock file's mtime is never refreshed
during a build, so a long-but-healthy build is indistinguishable by age
alone from a dead one and would get its lock stolen and its command
double-run. Takeover is two-tier (`run-script-lock.ts`). Past
`staleMs` (default `DEFAULT_LOCK_STALE_MS`, 60s,
`run-script-lock.ts`) the recorded pid is probed with
`process.kill(pid, 0)` (`isProcessAlive`, `run-script-lock.ts`),
and a live owner keeps its lock however old it is — `EPERM` counts as
alive, since the process exists and merely belongs to another user.
Only a dead owner (`ESRCH`) or a lock file with no readable owner record
(mid-write, truncated, hand-edited — where age is the only signal left)
falls back to the age rule. Release is gated the same way
(`releaseRunScriptLock`, `run-script-lock.ts`): a random
per-acquisition nonce is stamped into the lock file at acquire time
(`ownerNonce`, `run-script-lock.ts`), and a releaser deletes the
lock file only while that nonce is still on disk. Without the gate, an
owner that had already lost its lock to a takeover would delete the
*takeover* owner's lock in its `finally` and admit a third process
mid-build — the release path re-creating the race the lock exists to
prevent. With the pid probe in front of it, age is no longer
load-bearing for correctness — it only decides the unreadable-record
case — so the stale window could be tuned down from an earlier five
minutes to sixty seconds without weakening the guarantee.

**Trade-offs accepted, both deliberate.** The stale takeover exists at
all because a process killed mid-build would otherwise hang every
future `vitest` invocation in that checkout forever. A waiter blocked
past `DEFAULT_LOCK_WAIT_TIMEOUT_MS` (10 minutes,
`run-script-lock.ts`) on a still-live lock gives up and returns
`{ acquired: false, recentlyBuilt: false }` (`run-script-lock.ts`),
so the caller builds **unserialized** — reproducing the original race
for that one pair of processes, accepted because an indefinitely hung
test run is worse than a rare duplicated build. The wait is a
synchronous thread block via `Atomics.wait` (`defaultSleep`,
`run-script-lock.ts`), not an async sleep, because `runScript`
is a synchronous Vitest `globalSetup` helper with no async story
available to it. The `VITEST_AGENT_RUNSCRIPT_*` timing overrides are
parsed strictly through `parseLockTimingOverride`
(`run-script-lock.ts`, whole-string integers only, bounded below)
rather than with `Number.parseInt`, because a test-only typo like
`"200ms"` or `"-1"` must degrade to the production default, not to an
instantly-stale lock or a spin loop.

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

- Two concurrent `vitest` invocations in one checkout never run the same
  `globalSetup` command twice at once; the second waits, then either
  skips (trusting a fresh done-marker) or serializes behind the first.
- A crashed owner's lock recovers within `DEFAULT_LOCK_STALE_MS` (60s)
  rather than hanging every future invocation forever.
- The escape valve (`waitTimeoutMs` exceeded → unserialized run) means
  serialization is best-effort by contract, not a hard guarantee; a
  test or CI environment relying on the lock for exclusivity beyond ten
  minutes needs a different mechanism.
- Tests tune the four timings through `VITEST_AGENT_RUNSCRIPT_*` env
  overrides rather than lowering the production defaults, keeping the
  concurrency e2e suite's timing independent of real-world build
  durations.

## Related

- [Decision 49 — Per-Invocation Coverage Directory for MCP Runs](./49-per-invocation-coverage-directory-for-mcp-runs.md)
