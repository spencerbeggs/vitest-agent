---
type: Limitation
title: The record hook subcommands have no built-and-spawned end-to-end test
description: "agent record session-start/session-end/turn are exercised at the program level against an in-memory SqliteClient, and the CLI bin has one spawnSync e2e for an unrelated flag, but no test builds the CLI bin and spawns it against a real database to prove the full session-start/turn/session-end path the hook scripts actually drive."
bounds: ../modules/cli.md
tags: [testing, ci]
generated:
  by: okfit/claude-code
  at: 2026-10-03T19:28:10Z
  body_sha256: 6f4c15af78a57aa80f3a6e1a673c6a9b867516229958f1f840b4a5e3577202f8
sources:
  - id: record-command
    resource: ../../packages/cli/src/commands/record.ts
  - id: suite-flag-e2e
    resource: ../../packages/cli/__test__/bin/record-tdd-artifact-suite-flag.e2e.test.ts
---

# The record hook subcommands have no built-and-spawned end-to-end test

`agent record`'s `session-start`, `session-end`, and `turn` subcommands
are thin `effect/cli` wrappers around `recordSessionStart`,
`recordSessionEnd`, and `recordTurnEffect` from
`@vitest-agent/engine`.[^record-command] Those three functions are
exercised at the program level, against an in-memory `SqliteClient`, by
`packages/engine/__test__/record-session.test.ts` and
`record-turn.test.ts`. Nothing builds `packages/cli`'s bin to disk and
spawns it via `spawnSync` to prove the CLI wiring around them — flag
parsing, `dbPath` resolution, the `ProjectDataLive` layer the `record`
group is given through `Command.provide` (which builds `PlatformLive`), and
the command dispatch in `main.ts` — actually reaches those programs and
writes to a real, on-disk database the way the Claude Code plugin's
SessionStart/SessionEnd/PostToolUse hooks do in production.

**Condition.** A regression in the CLI's own command-tree wiring for
`agent record` — an argument that stops parsing, a `dbPath` resolution
bug, or a broken hand-off from `main.ts` into the record programs — that
the unit-level program tests, which bypass the CLI entirely, cannot
catch.

**Symptom.** `pnpm run test` stays green even when the built
`vitest-agent` bin's `agent record session-start` / `session-end` /
`turn` path is broken end-to-end, because the only coverage of those
three subcommands runs against the underlying engine programs directly.
One narrow counter-example already exists in this area:
`record-tdd-artifact-suite-flag.e2e.test.ts` does build the dev bin and
spawn it via `spawnSync`, but only to assert that `agent record
tdd-artifact --help` advertises a `--suite` flag — it does not exercise
`session-start`, `session-end`, or `turn`, and it never opens a real
database.[^suite-flag-e2e] `agent-project-key.e2e.test.ts` and
`lazy-data-platform.e2e.test.ts` do spawn the bin against real on-disk
databases, but for `register-agent`, `end-agent`, `doctor`, `db path`,
and the hook hot-path commands, never the three `record` actions.

**Why this is acceptable.** A build-and-spawn suite over every `agent
record` subcommand would add the production build to the critical path
of `pnpm run test` and bring up a fresh Node process per case. The hook
scripts under `plugins/claude-code/hooks/` are these subcommands'
real-world callers, and they already exercise the built bin end-to-end
during normal Claude Code sessions — a more realistic integration
surface than a synthetic spawn test would add. The dominant risk —
`effect/cli`'s command tree silently breaking — is the same
risk `help-surface.e2e.test.ts` and `version.e2e.test.ts` already guard
against for the bin as a whole.

**What a fix would take.** A `.e2e.test.ts` under `packages/cli/__test__/bin/`
that builds `dist/dev`, spawns the bin with `agent record session-start`
against a scratch `data.db` (via a `--db-path`-equivalent override or a
temp `XDG_DATA_HOME`), and asserts the row lands — then repeats for
`turn` and `session-end` against the session it just opened.

[^record-command]: `../../packages/cli/src/commands/record.ts:70-121`
[^suite-flag-e2e]: `../../packages/cli/__test__/bin/record-tdd-artifact-suite-flag.e2e.test.ts:1-33`
