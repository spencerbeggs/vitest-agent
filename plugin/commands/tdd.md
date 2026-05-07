---
name: TDD
description: Start a test-driven development session for a goal
trigger: /tdd
arguments:
  - name: goal
    description: What behavior to implement
    required: true
---

# TDD

I'll help you implement {{ goal }} using test-driven development.

Before spawning, complete three setup steps:

1. Call `session_list({ agentKind: "main", limit: 1 })` — capture the `cc_session_id` field from the first row as `ccSessionId`. Do **not** use `get_current_session_id()` — that in-memory ref can be stale if a prior subagent overwrote it.
2. Generate a `runId`: `Date.now().toString(36)`. Do **not** reuse a `runId` across dispatches — a fresh id per dispatch is the invariant.
3. Call `TaskCreate({ subject: "TDD Session: {{ goal }}", description: "Behavior tasks will appear as the orchestrator decomposes the goal." })` — capture the returned task ID as `parentTaskId`.

Then spawn `vitest-agent:tdd-task` **in the background** (`run_in_background: true`) with a prompt that includes:

- The goal: `{{ goal }}`
- The `ccSessionId` from step 1
- The `runId` from step 2
- The `parentTaskId` from step 3

Tell the user that behavior tasks will appear in the task panel as the orchestrator decomposes the goal, then return control.

The subagent will:

1. Open a TDD session for this goal.
2. Decompose the objective into goals via `tdd_goal_create`, then decompose each goal into behaviors via `tdd_behavior_create`. Goals and behaviors are queryable via `tdd_goal_list` / `tdd_behavior_list`.
3. Drive red → green → refactor cycles per behavior with evidence-based phase transitions.
4. Run with restricted Bash and restricted MCP tools (deletes denied at the hook layer; orchestrator must use `status: 'abandoned'` to drop work).
5. Push progress events via `tdd_progress_push` at each lifecycle point.

Channel-event handling (when Claude Code's channels are active) and the task-list rendering rules live in the `tdd` skill. If you are the main agent and channels are active, refer to `plugin/skills/tdd/SKILL.md` for the event handler table and the flat `[G<n>.B<m>]` label-encoding convention.

Starting orchestrator now...
