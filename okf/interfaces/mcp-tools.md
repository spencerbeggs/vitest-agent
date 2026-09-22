---
type: Interface
title: "MCP tool and prompt surface"
description: "The 30 action-keyed tools and six framing prompts @vitest-agent/mcp serves over stdio: families, discriminators, strictness, the TDD error envelope, and what stays stable across a minor."
kind: mcp
resource: ../../packages/mcp/src/tools
status: stable
tags:
  - mcp
  - tdd
  - compat
generated:
  by: okfit/claude-code
  at: 2026-09-22T19:35:29Z
  body_sha256: 25624a5a2854444d86b6829af0ce6f9b0d47182eab4ba41cf3be9dd58fe4c087
---

# MCP tool and prompt surface

## Contract, from the consumer's side

A client connects over stdio, speaks one of three protocol revisions —
the stateless `2026-07-28` (no `initialize`; `server/discover` plus a
per-request protocol `_meta`, every result wrapped in the stateless frame)
or the stateful `2025-11-25` / `2025-06-18` (opened with `initialize`) —
receives the same `instructions` orientation on either handshake, and sees
30 tools plus six prompts. Invalid params surface as a JSON-RPC `-32602`
error on `2025-06-18` and as an `isError` result on the two newer
revisions. Every served `inputSchema` is strict at every object
level: an unknown key anywhere in the payload — including inside a nested
object, an array element, or the branch an `action` / `kind` discriminator
selects — fails with `InvalidParams` naming the key's path and that level's
accepted params, rather than being silently dropped and the call running
wider than intended. A call with only its documented params is never
rejected at the parameter boundary. This is served-schema behavior a
client can rely on regardless of which tool it calls: the served JSON
Schema always sets `additionalProperties: false`, a top-level `action` /
`kind` union is always a `oneOf` with an `x-discriminator`, and `$ref`
roots are inlined so every top-level schema satisfies `type: "object"`.

Every tool's result carries two channels: `structuredContent` is the
result encoded through the tool's declared `success` schema (an undeclared
key never appears — it is stripped, not merely unused), and
`content[0].text` is the same encoded object as JSON. No tool sends a
markdown rendering in the text channel: Claude Code forwards only
`structuredContent` to the model when a result carries it, so a client
should read fields from `structuredContent`. A result field that happens
to hold markdown text — `triage_brief.markdown`, `wrapup_prompt.markdown`,
`help.helpText` — is data inside that object, not a rendering. A tool's declared `failure` channel is always
`Schema.Never` — no tool fails through the MCP protocol's own error
channel. What looks like a domain "error" — a TDD phase-transition denial,
an `AGENT_ALREADY_REGISTERED` registration conflict, a hard error inside
the five tagged TDD error types — is a member of the `success` union
instead, typically `{ ok: false, error: {...} }` or `{ accepted: false,
denialReason, remediation }`, so a client's tool-result handling never
special-cases a domain-level "no." An unexpected server-side defect is the
one thing that surfaces as `isError: true`, with a structured
`UnexpectedToolError` envelope (`{ _tag: "UnexpectedToolError", tool,
message, remediation }`) even then — never a bare error string.

## Tool families

The 30 tools group by shape, not by table:

- **Meta.** `ping`, `help` — `help` is the orientation surface listing
  every family and its discriminator values; a client should call it
  before assuming a shape from this document, since new variants land on
  the discriminant tuples between minors.
- **Read-only queries.** `test_status`,
  `test_overview`, `test_coverage`, `file_coverage`, `test_history`,
  `test_trends`, `test_errors`, `cache_health`, `settings_list`,
  `turn_search`, `failure_signature_get`, `acceptance_metrics`,
  `commit_changes`, `configure`.
- **Action-keyed consolidated tools.** Each per-CRUD family collapses to
  one tool discriminated on an `action` (or `kind`) literal:
  - `inventory` — `kind: project | module | suite | session | tag`.
  - `test` — `action: list | get | for_file | for_tag | annotations |
    artifacts`.
  - `note` — `action: create | list | get | update | delete | search`.
  - `hypothesis` — `action: record | validate | list`.
  - `tdd_task` — `action: start | end | get | resume` (the underlying
    tables retain the `tdd_tasks` naming).
  - `tdd_goal`, `tdd_behavior` — `action: create | update | delete | get |
    list`.
- **Standalone TDD tools.** `tdd_phase_transition_request` (the headline
  write — accept/deny is a deterministic function of artifact-log state at
  request time), `tdd_artifact_list` (read-only; every row carries `suite:
  "vitest" | "bats"` — its description disambiguates it from
  `test({ action: "artifacts" })`, which reads Vitest 5's own annotation /
  artifact surface, a different concept from a TDD artifact), and
  `tdd_progress_push`.
- **Agent registration.** `register_agent` — wraps `DataStore.registerAgent`;
  returns `{ ok: true, agentId, conversationId, idempotencyKey }` or
  `{ ok: false, error: { code, ... } }` with `code` one of
  `AGENT_ALREADY_REGISTERED` (carries `existingAgentId`),
  `PARENT_AGENT_NOT_FOUND`, `SESSION_NOT_FOUND`,
  `INVALID_AGENT_TYPE_PREFIX` (carries `expectedPrefix`).
- **Triage / wrapup.** `triage_brief`, `wrapup_prompt` — delegate to the
  same formatting code the CLI's `triage` / `wrapup` commands use, so
  outputs are byte-identical across the two front ends.
- **Mutation.** `run_tests` — the one tool on the `process` allowlist
  (mutates `process.env.VITEST_AGENT_*` so the in-process reporter
  attributes the run) and the one that blocks the server for its duration.
  See [Module: @vitest-agent/mcp](../modules/mcp.md) for the root
  resolution, timeout, coverage-directory, and tag-filter mechanics behind
  its input/output shape.

`set_current_session_id` and `get_current_session_id` are **removed** —
session attribution is recovered automatically at boot and per-call; a
client should not expect either name.

## Prompts

Six framing-only prompts, each emitting one or more templated user
messages and fetching nothing from the database: `triage`, `why-flaky`,
`regression-since-pass`, `explain-failure`, `tdd-resume`, `wrapup`.

| Name | Args | Required | Server-side default |
| --- | --- | --- | --- |
| `triage` | `project` | — | none |
| `why-flaky` | `test`, `project` | `test` | — |
| `regression-since-pass` | `test`, `project` | `test` | — |
| `explain-failure` | `signature` | `signature` | — |
| `tdd-resume` | `sessionId` | — | recovered host `chatId`, else the current session id, else "inferred from recovered SessionContext" wording |
| `wrapup` | `kind`, `since` | — | `kind` defaults to `user_prompt_nudge` |

Prompt arguments are strings on the wire regardless of the parameter's
logical type — `wrapup.kind` is served as a string literal enum, not a
typed discriminant. Every prompt serves a human-readable `title` for a
client's menu — `triage` "Triage Recent Failures", `why-flaky` "Diagnose
a Flaky Test", `regression-since-pass` "Find What Broke a Test",
`explain-failure` "Explain a Failure Class", `tdd-resume` "Resume TDD
Work", `wrapup` "Generate a Session Wrapup" — but the `name` is the
stable key; titles are display text. `tdd-resume`'s
session default is the only server-side input across all six; every other
prompt argument, required or not, is exactly what the caller supplied.

## Progress push wire format

`tdd_progress_push` does not reply with its payload on a bespoke channel.
It emits a standard MCP logging-message notification —
`notifications/message` with `level: "info"` and `logger:
"vitest-agent/channel"` — carrying the enriched event as `data`, broadcast
to every initialized client. A client that wants live TDD progress
narration subscribes to that logger name on the standard notification
channel rather than a custom method; nothing else on the wire carries this
data; a client that misses the notification can always recover the same
information by polling `tdd_task({ action: "get" })`, since every pushed
event is also persisted.

## TDD error envelope shape

The five tagged TDD errors (from `@vitest-agent/sdk`'s `TddErrors`) never
reach a client as a JSON-RPC error. They surface as a success-shape
response with a fixed remediation shape:

```json
{
  "ok": false,
  "error": {
    "_tag": "<TddErrorTag>",
    "...": "error-specific fields",
    "remediation": {
      "suggestedTool": "<tool name>",
      "suggestedArgs": { "...": "..." },
      "humanHint": "<prose>"
    }
  }
}
```

`tdd_phase_transition_request` uses the sibling shape `{ accepted: false,
denialReason, remediation }` for the same reason: a denial is data about
what to try next, not a protocol-level failure. A client integrating
against this surface should treat `remediation.suggestedTool` /
`suggestedArgs` as machine-actionable — re-issuing that exact call is the
documented recovery path for every denial and every tagged error this
surface produces.

## What stays stable across a minor

- The `Schema.Never` failure channel and the `UnexpectedToolError` /
  domain-error-in-success-channel split.
- `additionalProperties: false` at every object level of every served
  input schema, and the unknown-key rejection message format
  (`Unrecognized parameter(s): <path>. Accepted params: <list>`).
- The `notifications/message` / `vitest-agent/channel` wire method for
  progress push.
- The six prompt names and their required-argument sets.
- A tool's discriminant literal, once shipped, is never removed or
  renamed within a major — only added to. New variants are additive:
  `served-enum-drift.test.ts` pins every discriminant tuple
  (`TEST_ACTIONS`, `INVENTORY_KINDS`, `NOTE_ACTIONS`, `HYPOTHESIS_ACTIONS`,
  `TDD_TASK_ACTIONS`, `TDD_GOAL_ACTIONS`, `TDD_BEHAVIOR_ACTIONS`) against
  the served schema, so a client's existing discriminant checks keep
  matching after an upgrade.

What is **not** guaranteed stable: exact tool *description* text (the
model-facing prose Effect serves alongside each parameter — see [Module:
@vitest-agent/mcp](../modules/mcp.md) *Hypothesis session binding* for an
example where description wording was itself the fix for a steering bug),
and any field explicitly documented as best-effort (`discoveryLastScannedAt`,
the progress-push resolution of `goalId` / `sessionId`).

## Source files, by family

- `tools/ping.ts`, `tools/help.ts` — meta.
- `tools/status.ts`, `tools/overview.ts`, `tools/coverage.ts`,
  `tools/file-coverage.ts`, `tools/history.ts`, `tools/trends.ts`,
  `tools/errors.ts`, `tools/cache-health.ts`, `tools/settings-list.ts`,
  `tools/turn-search.ts`, `tools/failure-signature-get.ts`,
  `tools/acceptance-metrics.ts`, `tools/commit-changes.ts`,
  `tools/configure.ts` — read-only queries.
- `tools/inventory.ts`, `tools/test.ts`, `tools/note.ts`,
  `tools/hypothesis.ts`, `tools/tdd-task.ts`, `tools/tdd-goal.ts`,
  `tools/tdd-behavior.ts` — action-keyed consolidated tools.
- `tools/tdd-phase-transition-request.ts`, `tools/tdd-artifact.ts`,
  `tools/tdd-progress-push.ts` — standalone TDD tools.
- `tools/register-agent.ts` — agent registration.
- `tools/triage-brief.ts`, `tools/wrapup-prompt.ts` — triage / wrapup.
- `tools/run-tests.ts` — the mutation tool.
- `tools/_tdd-error-envelope.ts`, `tools/_project-groups.ts` — private
  shared helpers, not served tools.
- `prompts/layer.ts` plus `prompts/triage.ts`, `prompts/why-flaky.ts`,
  `prompts/regression-since-pass.ts`, `prompts/explain-failure.ts`,
  `prompts/tdd-resume.ts`, `prompts/wrapup.ts` — the six prompts.

## `TagFilter`

The structured tag filter accepted on `run_tests` and echoed on its
output, and mirrored in variant form on `inventory` (`kind: "tag"`) and
`test` (`action: "for_tag"`), is `{ all?: string[], any?: string[], none?:
string[] }`. All three sub-arrays AND together with each other and with
`project` / `files`: `all` requires every listed tag on a test, `any`
requires at least one, `none` excludes any test carrying a listed tag —
there is no separate negated form of `all` or `any`, `none` is the one
negation axis. `run_tests`'s `no-match` output variant and its `ok`
variant's `scope` field both echo the filter that was actually used,
including the composed Vitest tag expression, so a client can tell a
correctly scoped run from one where a filter silently widened.
