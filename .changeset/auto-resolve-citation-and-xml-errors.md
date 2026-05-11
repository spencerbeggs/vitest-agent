---
"vitest-agent-sdk": patch
"vitest-agent-mcp": patch
"vitest-agent-plugin": patch
---

## Features

### `tdd_phase_transition_request` auto-resolves the cited artifact

`citedArtifactId` is now optional. When the caller omits it, the tool resolves the most recent matching artifact for the session, with the kind drawn from one of three sources (priority order):

1. An explicit `citedArtifactKind` argument.
2. The kind required by the transition itself (per `requiredArtifactForTransition`: `test_failed_run` for `red→green`, `test_passed_run` for `green→refactor` and `refactor→red`).
3. None — for transitions like `spike→red` that the validator accepts without an artifact, the citation step is skipped entirely.

When the auto-resolve can't find a matching artifact, the tool returns the existing `missing_artifact_evidence` denial with a remediation pointing at `run_tests`. The accepted response now also echoes `citedArtifactId` and `citedArtifactSource` (`explicit-id` | `explicit-kind` | `transition-derived` | `none`) so callers can confirm which row was used.

This removes the per-transition `tdd_artifact_list` lookup that the orchestrator was making before every phase transition — the most common round-trip in the TDD loop.

The SDK helper `requiredArtifactForTransition` is now exported from `vitest-agent-sdk` so the MCP tool (and any future tool surface) can pre-compute the expected kind without duplicating the validator's rule table.

### `test_errors` surfaces cite-able IDs and gains an XML output mode

The `test_errors` tool now returns `test_errors.id` and the top stack frame's `stack_frames.id` (`topStackFrameId`) alongside each error. These are the values `hypothesis (action: record)` requires as `citedTestErrorId` and `citedStackFrameId`; the previous markdown output omitted them, forcing the orchestrator to hand-wave the citation.

A new `format` argument accepts `"markdown"` (default, with `[testErrorId=N topStackFrameId=N]` heading tokens plus a dedicated "Cite-able IDs" block) or `"xml"` (a `<test_errors>` document with one `<error id="..." topStackFrameId="...">` element per error). XML is recommended when the agent is going to extract IDs programmatically — Anthropic's prompt-engineering guidance is that Claude parses XML-tagged regions more reliably than ad-hoc markdown.

The XML formatter strips XML 1.0 illegal control chars (everything below 0x20 except tab/CR/LF) before escaping the five metacharacters, so the output is always well-formed regardless of what the test error message contains.

The SDK's `TestError` row type gains `id: number` and `topStackFrameId: number | null` fields; `DataReader.getErrors` joins `stack_frames` at `ordinal = 0` to surface the latter.

## Documentation

### `tdd-task` subagent prompt updated

The data-lookup table in `plugin/agents/tdd-task.md` now points at `test_errors({ project, format: "xml" })` for ID extraction. The "Phase transition" section explains that `citedArtifactId` is optional and how to use `citedArtifactKind` when explicit kind selection is desired. The RED→GREEN step in the workflow no longer prescribes a hard-coded `citedArtifactId: <the test_failed_run id>` value.
