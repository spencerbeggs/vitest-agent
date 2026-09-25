---
type: Interface
title: "The `vitest-agent` CLI command tree"
description: The stable command/flag/exit-code contract of the vitest-agent bin, as consumed by the Claude Code plugin's hook scripts and by humans on a terminal.
kind: cli
resource: ../../packages/cli/src/commands
tags: [dx, compat]
status: stable
sources:
  - id: db-ts
    resource: ../../packages/cli/src/commands/db.ts
  - id: agent-ts
    resource: ../../packages/cli/src/commands/agent.ts
  - id: record-ts
    resource: ../../packages/cli/src/commands/record.ts
  - id: triage-ts
    resource: ../../packages/cli/src/commands/triage.ts
  - id: wrapup-ts
    resource: ../../packages/cli/src/commands/wrapup.ts
  - id: doctor-ts
    resource: ../../packages/cli/src/commands/doctor.ts
  - id: main-ts
    resource: ../../packages/cli/src/main.ts
generated:
  by: okfit/claude-code
  at: 2026-09-25T23:18:00Z
  body_sha256: 9921d1fdd577d43f5d0faa9918dc27e41160a25cf503c195e4ea6669455dfcd7
---

# The `vitest-agent` CLI command tree

## What this contract covers

The `vitest-agent` bin (published by `@vitest-agent/cli`, re-shipped by the
`@vitest-agent/plugin` carrier — see [the CLI module](../modules/cli.md))
has two kinds of consumer: the Claude Code plugin's `*.sh` hook scripts,
which shell out to it dozens of times per session and parse its stdout/exit
code programmatically, and a human on a terminal running `doctor` or `db`
directly. This concept documents the promise from both consumers' side:
which commands exist, which flags they accept, what exit code means what,
and what a hook script may rely on staying stable across a minor release.
It does not document how a command is implemented — see
[the CLI module](../modules/cli.md) for that.

## The command tree

```text
vitest-agent
├── doctor                    [--format markdown|json]
├── db
│   ├── path
│   ├── prune                 [--keep-recent N]
│   ├── reset                 [--yes]
│   └── query <sql>           [--format table|json]
└── agent
    ├── triage                [--format markdown|json|silent] [--project] [--max-lines]
    ├── wrapup                [--row-id | --chat-id] [--kind] [--user-prompt-hint] [--format markdown|json]
    ├── record
    │   ├── turn               --chat-id [--occurred-at] [--project] [--cwd] <payload-json>
    │   ├── session-start       --chat-id --project --cwd [--agent-kind] [--agent-type] [--parent-chat-id] [--triage-was-non-empty] [--started-at]
    │   ├── session-end         --chat-id [--ended-at] [--end-reason]
    │   ├── tdd-artifact        (--chat-id | --tdd-task-id) [--project] [--cwd] --artifact-kind [--file-path] [--test-case-id] [--test-run-id] [--test-first-failure-run-id] [--diff-excerpt] [--recorded-at] [--suite vitest|bats]
    │   ├── run-trigger         --chat-id [--invocation-method bash|mcp|cli]
    │   ├── run-workspace-changes  --sha [--parent-sha] [--message] [--author] [--committed-at] [--branch] [--project] <files-json>
    │   └── test-case-turns     --chat-id
    ├── register-agent          --host-kind --agent-type --host-session-id --transcript-path --cwd [--parent-agent-id] [--client-nonce] [--project-key]
    ├── end-agent                --agent-id [--ended-at] [--host-session-id] [--cwd] [--project-key]
    ├── inject-env                --command [--cwd]
    ├── sidecar-path
    └── check-test-path <path>
```

Root-level `--version` prints `vitest-agent <CURRENT_CLI_VERSION>` (no
`v` prefix). When the bin was launched through the carrier's shim it
appends `via @vitest-agent/plugin <plugin version>`; that suffix is
provenance, not a version to compare, and it may be absent under npm,
yarn or bun, where the hoisted `@vitest-agent/cli` bin can take the
`.bin` slot[^main-ts]. The top-level
tree is exactly three children: `doctor`, `db`, `agent` — a consumer should
not expect a fourth top-level command to appear without a major.

## `--format`, scoped not universal

Only four commands carry a `--format` flag, and each has its own axis —
a consumer must not assume the values transfer between commands:

- `agent triage` and `agent wrapup` — `markdown | json | silent`
  (`triage`) or `markdown | json` (`wrapup`)[^triage-ts][^wrapup-ts].
  `silent` on `triage` suppresses stdout entirely (used when a hook only
  wants the side effect, not the text). Both emit `""` (nothing, not
  `"\n"`) when the underlying markdown is empty, so a hook checking for
  non-empty output can test raw string length.
- `db query` — `table | json`, default `table`[^db-ts].
- `doctor` — `markdown | json`, default `markdown`.
- Every other command emits plain stdout text or JSON by convention, with
  no `--format` flag at all. Do not add one without a design decision — see
  [the CLI module](../modules/cli.md) "Choices absorbed here".

## Exit-code contract

**Process-level codes**, from `@effected/cli`'s `CliRuntime.main`, apply
to every command before any family below: `0` success (a bare `--help`
included), `64` a usage error (a parse error, an unknown subcommand or
flag; help and the parse errors go to stderr and stdout stays empty, so
a hook piping stdout into `jq` sees nothing — an explicit `--help` prints
on stdout), `1` any other reported failure — a failure resolving the data
path, opening SQLite or running migrations prints one
`vitest-agent: <Tag>: <message>` line on stderr and exits `1`. A command
that calls `process.exit` with its own code, as the families below do,
keeps that code[^main-ts].

Two disjoint exit-code taxonomies exist under `agent`, and a hook consumer
must know which family a subcommand belongs to before interpreting a
non-zero code.

**The sidecar/hook family** (`register-agent`, `end-agent`, and — by
convention — anything that calls into `resolveHookPaths` /
`SidecarPlatformLive`): `0` success, `1` registration conflict, `2` sidecar
timeout, `3` database error, `4` project identity not resolvable, `5`
unexpected defect. Error detail lands on stderr in the shape `<exit_code>
<error_tag>: <message>`[^agent-ts].

**`db reset`** has its own gate-driven codes, evaluated in order: `0` on
success or on an aborted interactive prompt (`aborted` on stdout), `4` when
`VITEST_AGENT_AGENT_ID` is set in the environment ("agent context" — this is
the load-bearing agent-block, not a generic failure), `5` when stdout is not
a TTY and `--yes` was not passed[^db-ts].

**`db query`** has its own pair: `2` for empty / whitespace-only SQL, `3`
for any driver error — a SQL syntax error and a rejected write both surface
as exit `3`, because the read-only connection makes SQLite itself the
enforcement point rather than a parser in the CLI[^db-ts].

**`check-test-path` is explicitly outside every other family.** It exits
`1` with **no stdout** whenever it cannot stand behind a verdict — no
containing workspace, an unreadable or non-default-strategy Vitest/Vite
config, a `NON_DISCOVERABLE_DIRS` path segment, or a nested `package.json`
boundary — and exits `0` with a JSON verdict on stdout otherwise. A caller
must treat "exit 1, empty stdout" as "no opinion, proceed as if the check
was never run" — not as an error to surface to the user[^agent-ts].

**Every `record` subcommand and `sidecar-path`** exits `1` on any failure
(a decode error, a missing session, a resolution failure) with a
human-readable message on stderr prefixed by the subcommand name (e.g.
`record turn: …`), and `0` with a single line of JSON on stdout on
success[^record-ts]. `doctor` exits `1` when any of its five checks fails,
after still printing the full formatted report.

## stdout/stderr contract for hook consumers

- The sidecar subcommands (`register-agent`, `end-agent`, `sidecar-path`)
  and the `record` group print exactly one line of JSON (or plain text for
  `sidecar-path` / `inject-env`) to stdout on success and nothing else —
  hook scripts parse it with `jq -r`. Nothing informational is interleaved
  onto stdout; diagnostic and error text goes to stderr only.
- `agent register-agent` stdout: `{"agentId", "conversationId",
  "mainAgentId", "idempotencyKey", "idempotencyHit"}`[^agent-ts].
- `agent record test-case-turns` stdout: `{"updated": N,
  "latestTestCaseId": <id|null>}`[^record-ts].
- `agent inject-env` stdout: the (possibly rewritten) command line, always
  exactly one line, always exit `0` — it has no failure mode by design; an
  unrecognized command is echoed back unchanged.
- `agent check-test-path` stdout on success: `{"verdict", "workspace",
  "suggestedPath"}`; nothing on the fail-open exit-`1` path.
- `db path` prints the resolved absolute path with a trailing newline and
  always exits `0`, even when no `data.db` has been written yet — the path
  is a function of identity, not artifact presence.

## What stays stable vs. what a major may change

**Stable within a minor/patch** (a hook script may rely on these without
watching the changelog): the three top-level command names (`doctor`, `db`,
`agent`); the `agent` subcommand names and the `record` action names listed
in the tree above; the process-level `0` / `64` / `1` codes and the two
exit-code taxonomies described above and which
subcommands belong to which; the JSON key names in every documented stdout
payload; `--chat-id` / `--parent-chat-id` / `--tdd-task-id` as the
agent-facing id flags across `record` and `wrapup`; `db reset`'s
agent-blocking gate (`VITEST_AGENT_AGENT_ID` refusal, TTY/`--yes` prompt).

**A major may change:** adding a new flag to an existing subcommand (always
additive and optional, so this is typically not a break in practice, but a
required new flag would be); the exact wording of a stderr message (hooks
must not pattern-match message text, only the leading `<exit_code>
<error_tag>:` prefix on the sidecar family, or the exit code itself
elsewhere); the internal shape of `--suite`'s literal set if a third runner
is ever added (currently closed to `vitest | bats`); whether a currently
utility-only surface (`doctor`, `db`) grows a write path — today the CLI is
read-only except for the `agent` namespace, and that split is itself a
design choice recorded in [the CLI module](../modules/cli.md), not a
contractual guarantee to a consumer.

**Explicitly not part of this contract:** test-landscape queries (status,
overview, coverage, history, trends) — those never existed on the CLI in
the 2.0 shape and live behind the MCP server's tools instead; see
[the MCP tools interface](mcp-tools.md).

[^db-ts]: `../../packages/cli/src/commands/db.ts:192` (`db` parent), `../../packages/cli/src/commands/db.ts:52` (`reset` gates), `../../packages/cli/src/commands/db.ts:153` (`query` exit codes)
[^agent-ts]: `../../packages/cli/src/commands/agent.ts:14` (exit-code contract comment), `../../packages/cli/src/commands/agent.ts:97` (`register-agent` stdout shape), `../../packages/cli/src/commands/agent.ts:296` (`check-test-path`)
[^record-ts]: `../../packages/cli/src/commands/record.ts:303` (`recordCommand`), `../../packages/cli/src/commands/record.ts:204` (`test-case-turns` stdout shape)
[^triage-ts]: `../../packages/cli/src/commands/triage.ts:19`
[^wrapup-ts]: `../../packages/cli/src/commands/wrapup.ts:25`
[^main-ts]: `../../packages/cli/src/main.ts`
