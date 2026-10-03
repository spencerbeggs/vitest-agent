---
type: Decision
title: MCP Permits, Agent Restricts (Capability vs Scoping)
description: The MCP server exposes tdd_goal and tdd_behavior's delete action to every caller; the tdd-task orchestrator is denied it at the Claude Code agent + hook layer instead, because the MCP server has no agent identity to gate on.
status: draft
tags:
  - tdd
  - mcp
  - security
generated:
  by: okfit/claude-code
  at: 2026-10-03T19:28:10Z
  body_sha256: 50f026f0a4073970ec2624ef5d7d6ea9bb94331426a28c915e0c2b01415f04e1
sources:
  - id: tdd-restricted-hook
    resource: ../../plugins/claude-code/hooks/pre-tool-use/tdd-restricted.sh
  - id: match-tdd-agent
    resource: ../../plugins/claude-code/hooks/lib/match-tdd-agent.sh
  - id: safe-mcp-allowlist
    resource: ../../plugins/claude-code/hooks/lib/safe-mcp-vitest-agent-ops.txt
  - id: tdd-task-agent
    resource: ../../plugins/claude-code/agents/tdd-task.md
  - id: mcp-hook
    resource: ../../plugins/claude-code/hooks/pre-tool-use/mcp.sh
  - id: mcp-allowlist-bats
    resource: ../../plugins/claude-code/__test__/mcp-allowlist.bats
---

# MCP Permits, Agent Restricts (Capability vs Scoping)

## Context

`tdd_goal` and `tdd_behavior` are consolidated MCP tools whose `action`
discriminator includes `delete`, a hard, cascading delete. The `tdd-task`
orchestrator subagent should never be able to invoke that action on its own
initiative, but the same tools' non-destructive actions (`create`, `update`,
`get`, `list`) must stay reachable for every caller, including the
orchestrator.

## Decision

Capability lives on the MCP surface; scoping lives at the Claude Code agent
and hook layer, in three parts:

1. The orchestrator's `tools:` frontmatter array in `agents/tdd-task.md`
   enumerates `mcp__plugin_vitest-agent_mcp__tdd_goal` and
   `…__tdd_behavior` among the tools it may call at all — the array
   documents which tools are reachable, not which actions within a tool are
   permitted, since the MCP surface has no separate tool name for a delete
   action.[^tdd-task-agent]
2. `pre-tool-use/tdd-restricted.sh` is the runtime gate: a `PreToolUse` hook
   scoped to the orchestrator subagent via `is_tdd_agent` in
   `lib/match-tdd-agent.sh`[^match-tdd-agent] (matching the `agent_type`
   string Claude Code sends in the hook payload) that reads
   `tool_input.action` off a
   `tdd_goal` or `tdd_behavior` call and emits `emit_deny` with a
   remediation hint (`status: 'abandoned'` instead of a delete) when the
   action is `delete`. The same hook also denies
   `tdd_artifact_record` outright for defense-in-depth, since that tool is
   reserved for hooks and the CLI, never the agent.[^tdd-restricted-hook]
3. The main agent's `PreToolUse` auto-allow hook, `pre-tool-use/mcp.sh`,
   never auto-allows a delete. Its allowlist,
   `hooks/lib/safe-mcp-vitest-agent-ops.txt`, is keyed by tool name and
   lists `tdd_goal`, `tdd_behavior`, and `note`[^safe-mcp-allowlist], so
   the hook reads `tool_input.action` before consulting the list and
   returns no permission decision when it is `delete`[^mcp-hook]. A
   main-agent call with `action: "delete"` on any listed tool therefore
   falls through to Claude Code's standard permission prompt, so a human
   sees a confirmation dialog before any cascade. A bats suite pins the
   delete fall-through for all three tools and the auto-allow for
   `tdd_goal` and `tdd_behavior`'s other actions[^mcp-allowlist-bats].

The split exists because the MCP server has no agent identity — it sees
stdio bytes, not "main agent" versus "orchestrator subagent". That identity
lives one layer up, in the Claude Code hook envelope's `agent_type` field,
so the scoping has to live where that field is visible rather than inside
the tool-routing layer.

## Alternatives rejected

- **Add the delete actions as restricted operations on the MCP server
  itself**, gated by caller identity. Rejected because the server would
  need agent-aware authentication built into a tool-routing layer just to
  answer a question ("is this the orchestrator?") that Claude Code already
  answers for free in the hook envelope — more surface than the problem
  warrants.
- **Rely on the `tools:` frontmatter array alone**, without the hook.
  Rejected as insufficient defense: if a future Claude Code update starts
  ignoring `tools:`, or a misconfigured fork re-adds the delete-capable
  calls, nothing else would deny the call. The hook is deliberately kept as
  a second, independent layer so a documentation-only control failing does
  not become a runtime failure.
- **Split `tdd_goal`/`tdd_behavior` into separate delete-specific tool
  names** so the MCP surface itself had a name to omit from the
  orchestrator's `tools:` array. Rejected because it would duplicate the
  action-keyed dispatch pattern used everywhere else on the MCP surface for
  one tool pair, for a distinction (destructive vs non-destructive) that
  the hook layer already expresses cleanly by reading `tool_input.action`.

## Consequences

A misconfigured orchestrator — a fork that both re-adds delete-capable
calls to its `tools:` array and disables or bypasses the hook — could still
call a delete. That is accepted because both independent gates would have
to fail at once for it to happen. The pattern here is related to but
distinct from the one that keeps `tdd_artifact_record` off the MCP surface
for every caller (hooks observe what the agent did; the agent never writes
evidence about itself): that decision hides a tool entirely, while this one
lets a tool exist for the main agent under user confirmation while denying
one of its actions to the orchestrator specifically. Together they describe
the repository's full "MCP permits, agent restricts" doctrine for
destructive TDD operations.

## Related

- [Module: mcp](../modules/mcp.md)
- [Module: claude-code-plugin](../modules/claude-code-plugin.md)
- [Decision: Three-Tier Objective→Goal→Behavior Hierarchy](d12-three-tier-objective-goal-behavior-hierarchy.md)

[^tdd-restricted-hook]: `../../plugins/claude-code/hooks/pre-tool-use/tdd-restricted.sh`
[^match-tdd-agent]: `../../plugins/claude-code/hooks/lib/match-tdd-agent.sh`
[^safe-mcp-allowlist]: `../../plugins/claude-code/hooks/lib/safe-mcp-vitest-agent-ops.txt`
[^tdd-task-agent]: `../../plugins/claude-code/agents/tdd-task.md`
[^mcp-hook]: `../../plugins/claude-code/hooks/pre-tool-use/mcp.sh`
[^mcp-allowlist-bats]: `../../plugins/claude-code/__test__/mcp-allowlist.bats`
