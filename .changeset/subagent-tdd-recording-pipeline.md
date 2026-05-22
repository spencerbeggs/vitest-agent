---
"vitest-agent-sdk": patch
"vitest-agent-cli": patch
"vitest-agent-mcp": patch
---

## Bug Fixes

### Resolve recorded hypotheses to the running subagent session

`hypothesis (action: record)` trusted a caller-supplied `sessionId` verbatim, but the TDD orchestrator runs as a subagent whose own session id is awkward to obtain reliably — across runs the recorded `session_id` variously landed on the parent main session, the `tddTaskId`, or (only when the orchestrator happened to pass the right value) the subagent session, so an auditor querying hypotheses by the subagent session found nothing. The MCP server now resolves the binding session itself: it walks the recovered host chat id to the main session and, when an un-ended subagent child is running, attributes the hypothesis to that subagent session. A caller-supplied `sessionId` is honored only as a fallback when no host context is recovered. A new `DataReader.findActiveSubagentSession` backs the lookup, and the orchestrator prose was corrected to stop passing the `tddTaskId` under a `sessionId` key.

### Stop classifying clean red-green recoveries as flaky

The flaky-test bucket flagged any test with at least one pass and one fail in its history, ignoring order, so a test authored through a normal red-green TDD cycle — failing during the red phase, then passing after the fix — entered the flaky set on its first day. The classifier now requires a failure that occurs at or after the earliest pass (a genuine fail-after-pass oscillation); a monotonic recovery where every failure precedes every pass is reported as recovered, not flaky.

### Bind hook-driven recording to the canonical database

Hook-driven recording resolved `data.db` from the firing tool's working directory, so a subagent operating on a monorepo sub-package (one with its own `package.json` identity) wrote artifacts, turns, and session rows to a different per-project database than the one the MCP server uses. The open TDD task lived in one database while every PostToolUse hook looked in another, producing repeated "No open TDD task" failures and leaving phase evidence unbound. The CLI now resolves the database from `VITEST_AGENT_PROJECT_DIR` before falling back to `process.cwd()`, and the plugin's shared hook lib exports that anchor from `CLAUDE_PROJECT_DIR` so every hook-spawned CLI lands on the same database the MCP server reads. This extends the earlier reporter/sidecar project-key unification to the hook layer.

### Allow a subagent to register against its parent session's agent

`DataStore.registerAgent` required the parent agent to belong to the same session as the agent being registered, which rejected the normal subagent-to-parent link: a subagent has its own per-dispatch session whose `parent_session_id` points at the main session where the parent agent lives. The parent may now belong to the registering session or its parent session, so the subagent `agents` row is created with its `parent_agent_id` intact.
