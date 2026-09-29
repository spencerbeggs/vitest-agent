---
type: Decision
title: MCP Attachment Bodies Are Opt-In and Budgeted
description: The test tool's annotations and artifacts actions return attachment descriptors by default and only include inline bodies when the caller passes a cumulative maxBytes budget, because a per-attachment cap says nothing about the total size of one tool response.
status: stable
tags:
  - mcp
  - performance
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: f12b33cf3495f5103b550d09d141d586ac358125aafce08990a716104fbb3b20
sources:
  - id: mcp-test-tool
    resource: ../../packages/mcp/src/tools/test.ts
  - id: data-store-cap
    resource: ../../packages/engine/src/services/DataStore.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# MCP Attachment Bodies Are Opt-In and Budgeted

## Context

The `test` tool's `annotations` and `artifacts` actions return every
annotation or artifact recorded for one test in the latest run, each
carrying its own attachments. The 64 KiB persistence cap on an inline
attachment body is per attachment, so a test with many inline attachments
could still flood an agent's context window on a single tool call even
though no individual attachment exceeds the persistence cap.

## Decision

Both actions return attachment descriptors by default — `contentType`,
`path`, `byteSize` — with no `body` field.[^mcp-test-tool] An inline
`body` comes back only when the caller passes `maxBytes`, a non-negative
integer total byte budget for every body in the response, defaulting to
`0`.[^mcp-test-tool] `applyBodyBudget` walks the attachments in order and
charges each body the UTF-8 byte length of the string that will actually
be placed in the response, `Buffer.byteLength(body, "utf-8")`; a body
that would push the running total past the budget is dropped along with
its `bodyEncoding`, while the descriptor half — `contentType`, `path`,
`byteSize` — always survives regardless of budget.[^mcp-test-tool]

The budget meters the response, so it charges what the response carries.
The recorded `byteSize` is caller-reported, and for a base64 body it is
the decoded payload size, roughly three quarters of the string that
actually ships (issue 393); it cannot be trusted to bound a response.
`String.length` is not used either, because it counts UTF-16 code units
and undercounts a multibyte UTF-8 body.

## Alternatives rejected

- **A per-body cap on the response, mirroring the persistence-layer
  cap.** Rejected because a per-body cap bounds one attachment and says
  nothing about the response as a whole; the real constraint an agent
  cares about is the total size of the tool result it has to read, which
  only a cumulative budget expresses.
- **Return bodies by default up to some fixed response-wide ceiling with
  no caller control.** Rejected because a fixed default ceiling still
  charges every caller for bytes most calls never need — the count and
  descriptor list already tell an agent everything required to decide
  whether fetching bodies is worth the tokens, so paying for bytes should
  be a deliberate second step rather than baked into the default call.
- **Charge each body its recorded `byteSize`.** Rejected because
  `byteSize` is caller-reported and describes the decoded payload, not
  the bytes placed in the response. A base64 body's string is roughly
  4/3 its payload, so charging `byteSize` would under-count every base64
  body by about a quarter and let a response overrun the caller's
  budget; a caller that under-reports `byteSize` would widen the gap
  further. This is the same distrust of a self-reported size that makes
  the persistence cap check the stored string (Decision 68).

## Consequences

The count and the full descriptor list are identical no matter what
`maxBytes` is set to, so an agent can always see what exists before
deciding whether to pay for the bytes. Defaulting `maxBytes` to `0` means
the cheap call — descriptors only — is the default call, and every caller
that wants bodies has to say so explicitly with an explicit budget.

## Related

- [Decision 68 — Cap Inline Attachment Bodies on Stored Bytes](./68-cap-inline-attachment-bodies-on-stored-bytes.md)
- [Interface: mcp-tools](../interfaces/mcp-tools.md)

[^mcp-test-tool]: `../../packages/mcp/src/tools/test.ts`
