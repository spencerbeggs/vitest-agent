---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-06-12
last-synced: 2026-06-12
completeness: 90
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ../schemas.md
dependencies: []
---

# Claude Code Plugin (`plugin/`)

The Claude Code plugin at `plugin/` is the primary AI integration surface for the
vitest-agent system. The six npm packages collect and store data; this plugin
turns that data into agent behavior — through hook scripts, a TDD orchestrator
subagent, sub-skill primitives, slash commands, and an MCP loader.

The plugin is a **file-based Claude Code plugin**, not a pnpm workspace and not
published to npm. It ships through the Claude marketplace as
`vitest-agent@spencerbeggs` and versions independently from the npm packages.
Child context for working in the tree lives at `plugin/CLAUDE.md`.

For decisions that shaped this design, see
[../decisions.md](../decisions.md): D20 (file-based plugin),
D30 (PM-detect spawn loader), D34 (plugin/reporter split),
D11 (TDD evidence binding), D12 (three-tier hierarchy), D13
(capability-vs-scoping doctrine).

---

## Overview

The plugin sits between Claude Code and the user's project. Claude Code reads
the plugin manifest, spawns the MCP loader, registers hook scripts, and exposes
the TDD orchestrator agent and slash commands. The plugin contributes nothing
to the user's runtime — every script and prompt is consumed by Claude Code
itself.

### Why this is the keystone

The npm packages are headless data infrastructure: the reporter trims output,
the SDK persists runs and failures, the MCP server exposes them. None of that
on its own changes how an agent writes code. This plugin is the integration
surface that turns the persisted data into agent behavior.

The TDD orchestrator (`agents/tdd-task.md`) is the core of that translation.
It runs red-green-refactor cycles against the user's tests with hard MCP gates
at every phase boundary, with phase-transition evidence binding (Decision D11)
that prevents the drift ungated agent TDD typically produces — citing the
wrong test, citing a test that was already failing on main, citing tests
authored in a previous session, claiming "green" without ever entering "red".
The three-tier Objective→Goal→Behavior hierarchy (Decision D12) gives the
orchestrator a stable navigation axis for decomposition and for the channel
events it streams back to the dispatching agent. Token reduction in the
reporter and persisted data in SQLite are necessary preconditions; this is
what makes them load-bearing.

```text
Claude Code session
   │
   ├── reads plugin.json   ──► registers MCP server, hooks, agents, skills, commands
   ├── spawns start-mcp.sh ──► PM-exec → vitest-agent-mcp (user's project deps)
   ├── fires hooks         ──► record turns, gate tools, inject context
   └── dispatches tdd-task ──► forked context, drives red-green-refactor
                              against the user's tests via MCP
```

## Current state

### Loader strategy

`bin/start-mcp.sh` is a POSIX shell loader that Claude Code spawns as a direct
child process over stdio. It is intentionally tiny and dependency-free: it must
run before the user has installed anything.

The loader has three responsibilities:

1. Resolve `projectDir` from `CLAUDE_PROJECT_DIR` (or `pwd`).
2. Detect the project's package manager — first the `packageManager` field in
   `package.json`, then lockfile presence (`pnpm-lock.yaml`, `yarn.lock`,
   `bun.lock`, defaulting to npm).
3. `exec` into `<pm exec> vitest-agent-mcp`, replacing itself.

The `exec` is load-bearing. After startup, Claude Code's direct child is the
package manager process — there is no shell wrapper hanging around to forward
signals or buffer stdio. When Claude Code closes the session pipe, the MCP
server exits via EOF. No orphan processes. A Node-based loader (`start-mcp.mjs`)
exists as a fallback for debugging but is not the active loader unless
`plugin.json` is changed to reference it.

`VITEST_AGENT_REPORTER_PROJECT_DIR` is exported into the spawned MCP server's
environment. This passthrough exists because Claude Code does not reliably
propagate `CLAUDE_PROJECT_DIR` to MCP server subprocesses; the MCP server reads
this env var as the highest-precedence source for `projectDir` resolution. The
SDK package and MCP server both share this contract — see D30 for the full
rationale.

The MCP server itself is **not bundled** with the plugin. It is a peer of
`vitest-agent-plugin` in the user's project and is resolved by the user's PM at
spawn time. Bundling was rejected because the SDK depends on `better-sqlite3`,
a native module that must match the user's platform and Node version. See
D29 (retired) for the dynamic-import approach this replaced.

The PM-walk is also load-bearing for the lockstep release invariant
(Decision 36). The MCP server must run from the consumer's installation
context so the version-pinned peer dep on `vitest-agent-mcp` resolves to
the same release as the `vitest-agent-plugin` that wired up the reporter.
A global `npx vitest-agent-mcp` invocation (or any spawn rooted outside
the user's package manager) would resolve against an arbitrary version
and silently drift from the plugin's expected SDK contract. The CLI is
directory-bound for the same reason.

### Hook architecture

Hooks register against Claude Code's lifecycle events through `hooks/hooks.json`.
Every hook script is POSIX shell, sources shared helpers from `hooks/lib/`, and
returns JSON to Claude Code via stdout. Hooks fall into four functional
categories:

- **Recording hooks.** Capture session, prompt, tool-call, file-edit, and
  hook-fire turns into the SQLite database via `vitest-agent agent record`. These
  drive session analytics and the wrap-up nudges. They run on every event,
  unscoped — every turn in every session is captured. `session/end-record.sh`
  additionally records a `hook_fire` turn (kind `SessionEnd`) **before** the
  session-end write so that `computeAcceptanceMetrics` metric 2 counts the
  event regardless of whether the wrap-up note was produced; hook errors are
  logged to `hook_error` rather than silently swallowed.
- **Context-injection hooks.** Run on `SessionStart`, `UserPromptSubmit`,
  `Stop`, `SessionEnd`, and `PreCompact`, calling the `agent triage` and `agent wrapup`
  CLIs and emitting their output back to Claude Code as session context or
  `systemMessage`. Per Claude Code's hook schema, `additionalContext` is only
  valid for a subset of events; `Stop`, `SessionEnd`, and `PreCompact` must
  use top-level `systemMessage` instead.
- **Permission hooks.** `pre-tool-use/mcp.sh` reads `tool_name` against the
  allowlist at `hooks/lib/safe-mcp-vitest-agent-ops.txt` and emits
  `permissionDecision: "allow"` for non-destructive MCP tools so the agent
  doesn't see a confirmation prompt for every read. Destructive
  actions inside the consolidated tools (`tdd_goal({ action: "delete"
  })`, `tdd_behavior({ action: "delete" })`) are gated by the
  TDD-restricted PreToolUse hook rather than by allowlist absence —
  the consolidated tools are listed but the destructive `action`
  values are rejected at hook time. `tdd_artifact_record` does not
  exist as an MCP tool (per D7, artifacts are hook-only writes via
  the `record tdd-artifact` CLI subcommand).
- **TDD orchestrator gates.** A subset of hooks fire only when the
  orchestrator subagent is active. They block production-code edits without
  preceding test failures, deny dangerous Vitest flags (`--update`,
  `--bail`, `--testNamePattern`), reject test-weakening edits, and record
  evidence artifacts. This is the runtime enforcement layer for the iron-law
  TDD discipline; the agent's `tools[]` array is documentation.

The match-tdd-agent helper at `hooks/lib/match-tdd-agent.sh` is the load-bearing
piece for orchestrator scoping. Claude Code emits the subagent identity in the
hook envelope's `agent_type` field — Claude Code currently sends the value
`"vitest-agent:tdd-task"`, and that is the only form matched. Legacy forms
(`"plugin:vitest-agent:tdd-task"`, bare `"tdd-task"`) were removed after they
were confirmed never observed in practice. All orchestrator-scoped hooks gate
through the shared `is_tdd_agent` function so the matching logic lives in one
place. If Claude Code's identity format changes, this is the only file that
needs updating.

Hook scripts source two shared helpers from `hooks/lib/`.

`hook-output.sh` centralizes every JSON shape a hook may emit — `emit_noop`, `emit_allow`, `emit_deny`, `emit_additional_context` and `emit_system_message`. All user-provided strings flow through `jq -n --arg` so embedded quotes, newlines and backslashes cannot break the output. The helper also propagates `VITEST_AGENT_PROJECT_DIR` at source time: it applies the assignment `VITEST_AGENT_PROJECT_DIR=${CLAUDE_PROJECT_DIR:-}` only when the var is not already set, then exports it. This anchors every `vitest-agent` CLI invocation spawned by a hook to the same project root the MCP server uses, which is load-bearing for subagent TDD recording: a `post-tool-use/tdd-artifact.sh` hook that runs from a monorepo sub-package `cwd` would otherwise resolve a different per-project `data.db` than the one the MCP server (and the open TDD task) lives in, silently splitting evidence and turn writes across two databases.

`hook-debug.sh` provides two logging functions. `hook_error` always appends to `/tmp/vitest-agent-hook-errors.log` (overrideable via `VITEST_AGENT_HOOK_ERROR_LOG`); CLI failures in recording and artifact hooks write here instead of being silently swallowed. `hook_debug` appends to `/tmp/vitest-agent-hook-debug.log` (overrideable via `VITEST_AGENT_HOOK_DEBUG_LOG`) but only when `VITEST_AGENT_HOOK_DEBUG=1` is set. Recording and artifact hooks use a structured capture-and-log pattern: CLI output is captured, exit status is tested, and failures call `hook_error` before the hook exits — the previous pattern of appending `|| true` to silence errors is gone.

The allowlist file at `hooks/lib/safe-mcp-vitest-agent-ops.txt` is plain text:
one operation suffix per line, blank lines and `#` comments stripped before
exact matching. New non-destructive MCP tools must be added here when
deployed; delete tools must remain absent. The file's comment header explains
this constraint to any agent editing it.

### Evidence binding

The TDD enforcement loop depends on `tdd_artifacts` rows being written
**by hooks, not by the orchestrator**. This is Decision D7's core constraint:
the agent never writes evidence about itself — hooks observe what the agent did
and write the artifact rows. `tdd_artifact_record` is intentionally not an MCP
tool.

`post-tool-use/tdd-artifact.sh` fires on every tool result inside the
orchestrator subagent. It detects:

- **Test runs** by matching the Bash command against
  `(vitest|jest)|(npm|pnpm|yarn|bun) (run )?(test|vitest)`. Exit code 0 yields
  a `test_passed_run` artifact; non-zero yields `test_failed_run`.
- **File edits** by tool name. Edits to `*.test.*` paths produce
  `test_written`; edits to anything else produce `code_written`.
- **Test-weakening edits** in a separate hook (`post-tool-use/test-quality.sh`)
  by scanning for escape-hatch tokens (`it.skip`, `.todo`, `.fails`, snapshot
  edits, etc.) and writing `test_weakened` artifacts.

Before writing each artifact, the hook calls `vitest-agent agent record
test-case-turns` to backfill `test_cases.created_turn_id` and capture the
latest `test_case_id` for the session. This binds every artifact to a test
case if one was authored in the same session window.

The `test_case_authored_in_session` constraint is the load-bearing invariant.
The phase-transition validator (Decision D11) requires that a cited test
artifact's test case was authored in the **current session** — not pulled from
historical runs, not authored by a different agent. Without this constraint,
an agent could cite any failing test from history to claim "I'm in red,"
defeating the iron law. The constraint is enforced at validation time
(`packages/sdk/src/utils/validate-phase-transition.ts`), but it relies on the
hook layer correctly stamping `test_case_authored_in_session = true` only when
the test was actually authored in the current session's window.

The file-filter approach — matching test runs by command shape rather than
process inspection — is a deliberate choice. PostToolUse fires after the Bash
result is already captured by Claude Code; there is no live process to
inspect. Pattern matching against the user's command string is the only signal
available, and it has to cover every package manager Vitest can be invoked
through.

For the channel event schema and `tdd_artifacts` row schema, see
[../schemas.md](../schemas.md) — channel event section and
SQLite table inventory respectively.

### Agent architecture

The plugin ships one agent: `agents/tdd-task.md`, the TDD orchestrator. Its job
is to drive red-green-refactor cycles against the user's tests, with hard MCP
gates at session start, before every non-test edit, and at every phase
boundary. The full prompt — iron law, eight-state state machine, three-tier
hierarchy, channel event table, restricted Bash list — is in the agent file.

**Three-tier hierarchy.** The orchestrator decomposes its `goal` argument into
goals (slices testable as units), then each goal into behaviors (one
red-green-refactor cycle each). This is the user-facing structure of TDD work
and is the primary navigation axis for the channel events the orchestrator
pushes back to the main agent. Goals and behaviors are first-class storage —
each has its own row, status lifecycle, and CRUD surface. Decomposition is the
LLM's job; the server stores what it's told and validates referential
integrity. See D12 for the full rationale on why server-side regex splitting
was retired.

**The `context: fork` decision.** The orchestrator runs in a forked
conversation context — it does not inherit the dispatching agent's history.
Task prompts must be self-contained. This is correct in two distinct usage
modes:

- **Production use.** The orchestrator should reason from its prompt, not from
  the dispatcher's accumulated state. A user asking the main agent to "fix the
  failing tests in module X" should produce a task prompt the orchestrator
  can execute against any clean context — the dispatcher's prior work shapes
  the prompt, but the orchestrator works against the prompt alone.
- **Dogfood use.** The dispatcher's context contains the cheatsheet and the
  meta-goal of the dogfood session — both invisible to the orchestrator. Fork
  prevents leakage. See "Dogfood system" below.

The trade-off is that the dispatcher must construct a complete task prompt
every time. There is no "remember what we discussed" path. Hook-injected
context (session-start triage, MCP tool reference) compensates for this by
giving every dispatch the same baseline awareness of the project's test
state.

**Pre-dispatch sequence.** Session-id lookup over MCP is no longer
required: the four canonical UUIDs
(`VITEST_AGENT_CHAT_ID`, `_CONVERSATION_ID`, `_MAIN_AGENT_ID`,
`_AGENT_ID`) are already exported into the main agent's shell by the
SessionStart hook, and the MCP server reads them from
`process.env` at boot via `SessionContextRef`. The legacy
`get_current_session_id` / `set_current_session_id` tools are
removed. Before spawning the orchestrator, the main agent generates a
fresh `runId` (`Date.now().toString(36)`) for each dispatch and
passes it to `tdd_task({ action: "start", runId, ... })`, where
`runId` becomes the idempotency key so retry dispatches with new
`runId` values are not collapsed to the cached session. The agent
then calls `TaskCreate` to create the parent
`TDD Session: <objective>` task and initializes the `goalById` and
`behaviorById` state maps before spawning.

**Hypothesis attribution to the running subagent.** The `hypothesis (action: record)` MCP tool resolves the binding session server-side rather than trusting a caller-supplied `sessionId`. The MCP server is one long-lived process whose recovered context always names the main agent's `chatId`; it cannot tell per-call that the caller is the `tdd-task` subagent. The fix: for every `record` call the server looks up the main session via `DataReader.getSessionByChatId`, then calls `DataReader.findActiveSubagentSession(mainSession.id)` — which returns the most-recently-started subagent session with `parent_session_id = mainSession.id` and `ended_at IS NULL`. When one is found, hypotheses are attributed to the subagent's session row; otherwise they fall back to the main session. A caller-supplied `sessionId` is honored only when no host context was recovered at all (dev and test paths). The `record-hypothesis-before-fix` skill therefore instructs the orchestrator not to pass `sessionId` — the server resolves it correctly.

**Channel-event flow.** When the orchestrator hits a lifecycle transition
(goal/behavior created, started, phase changed, completed, abandoned, blocked,
session complete), it calls `tdd_progress_push` with a typed payload. The MCP
server validates the payload against the `ChannelEvent` discriminated union,
**resolves `goalId` and `sessionId` server-side from `behaviorId`** for
behavior-scoped events, and forwards the event to the main agent through
Claude Code's notification channel. The main agent's `tdd` skill renders the
events as a flat task panel with `[G<n>.B<m>]` labels (Claude Code's
`TaskCreate` doesn't nest cleanly past one parent).

The server-side ID resolution exists so that a stale orchestrator context
cannot push the wrong tree coordinates — even if the orchestrator's mental
model of the goal/behavior hierarchy drifts, the MCP server resolves
coordinates from the database. Resolution is best-effort; malformed JSON or
DB read failures fall through with the original payload.

**`behaviors_ready` deferral.** When the main agent receives a `behaviors_ready`
channel event, it records each behavior's ordinals in `behaviorById` but does
**not** call `TaskCreate` yet. Task creation is deferred to `behavior_started`
so that abandoned sessions — which fire `behaviors_ready` but never
`behavior_started` — do not leave orphaned pending tasks in the task panel.
This is why the `tdd` skill's event-handler table specifies "No tasks yet" for
both `behaviors_ready` and `behavior_added`.

The `tools[]` enumeration on the orchestrator is documentation, not
enforcement. The runtime gate that prevents `tdd_goal({ action:
"delete" })` and `tdd_behavior({ action: "delete" })` calls inside
the orchestrator is `pre-tool-use/tdd-restricted.sh` — the hook
inspects `tool_input.action` on the consolidated tools and rejects
destructive variants. See D13 for the full "capability-vs-scoping"
doctrine: the MCP surface permits the operation; the agent layer
restricts who may call it.

### Skills

The plugin ships skill primitives covering every step of the TDD cycle:
interpreting failures, naming and shaping tests, verifying test quality,
running and classifying results, recording hypotheses before fixes,
committing at green and refactor exit, reverting on extended red, and
decomposing goals into behaviors. All primitives are also referenced by the
orchestrator's `skills:` frontmatter so they are preloaded on dispatch.

Higher-level skills (`tdd`, `debugging`, `coverage-improvement`,
`configuration`, `vitest-context`) are available standalone for the main agent
to load on demand. The `tdd` skill in particular owns the channel-event
handler — it is what renders the orchestrator's `tdd_progress_push` events
into the user-visible task panel.

Per D6, primitives are single-source-of-truth: the orchestrator agent
preloads them via frontmatter, and they are also published as standalone
`SKILL.md` files for non-orchestrator reuse. There is no separate copy of the
primitive content embedded inline.

### Slash commands

`/setup` and `/configure` are config helpers for `AgentPlugin` in a project's Vitest config. `/setup` runs a deterministic seven-step flow: verify Vitest 4.1+, `vitest-agent-plugin` and a coverage provider; detect and convert the config shape to async-arrow; emit the canonical 2.0 config (an `AgentPlugin.discover()` destructure, the five-field options surface with only `coverageTargets` emitted, and split coverage); and migrate pre-2.0 option patterns when upgrading. `/configure` is display-only — it parses the config and renders a five-field options table plus the Vitest coverage block, then points the user at the file for manual edits. It does not mutate the config. `/tdd` launches a TDD session by dispatching the orchestrator with the user's goal as the task prompt — the command does nothing beyond forwarding the goal; all the real work is in the agent.

### Dogfood system

The dogfood system is how the plugin's behavior under load is verified. The
contributor entry point is [`docs/dogfooding.md`](../../../../docs/dogfooding.md);
read that for the workflow steps. The mechanics that make the system
load-bearing for design integrity:

- **Chain structure.** A *chain* groups related handoffs that test one aspect
  of the system. Each handoff is one experiment dispatched against the
  `playground/` workspace (which contains intentional defects). Chains live at
  `docs/superpowers/dogfood/<chain-slug>/` and are gitignored — they are
  ephemeral working state.
- **Handoff format.** Each handoff is a markdown file with frontmatter
  carrying `prev_handoff`, `status`, and `what_were_testing` fields. The
  `# Task for the TDD orchestrator` section is what gets dispatched verbatim
  to the orchestrator. The `# What the orchestrator MUST NOT know` section is
  for the main agent's verification. The two are kept rigorously separate by
  the iron law: the orchestrator receives only the task section, never the
  frontmatter, never the meta-goal.
- **Cheatsheet.** `.claude/playground-cheatsheet.md` is the answer key for the
  intentional defects in `playground/`. The main agent reads it to verify
  orchestrator output. It is invisible to the orchestrator — referencing it
  in a dispatch prompt would invalidate the experiment. New playground
  defects must be documented in the cheatsheet.
- **Seven-step verification protocol.** After the orchestrator returns, the
  main agent runs a fixed seven-step audit against the database state, the
  channel events received, the artifacts written, and the test/code changes.
  The protocol lives in `.claude/skills/dogfood/SKILL.md` and is what makes
  dogfood actionable — without it, "the test passes" is the least
  interesting signal.

The dogfood system is the primary development driver for hook and agent
behaviors in this directory. Dogfood runs surfaced the defects that
motivated D11 (evidence binding gaps), D12 (three-tier hierarchy), and D13
(capability-vs-scoping). Findings are at
`docs/superpowers/dogfood/<chain-slug>/findings.md` while a chain is open;
once absorbed and any system fixes have landed, the chain folder is deleted.

**Reboot-table sync requirement.** The skill at `.claude/skills/dogfood/SKILL.md`
carries the canonical reboot table — what action is required when a given file
type changes (none / `/reload-plugins` / full Claude Code restart).
`docs/dogfooding.md` carries an abridged version of the same table for human
contributors. The two must agree. When either is updated, both must be
updated. The canonical version lives in the skill; the docs version is the
abridged sibling. This is a manual sync — there is no script — and it is the
single most likely place for the dogfood system to drift.

## Rationale

**Why a file-based plugin and not a published npm package.** Plugins are how
Claude Code learns about agent-specific MCP servers, hooks, skills, and
commands. The npm packages can ship without the plugin (a user can install
`vitest-agent-plugin` and use it as a vanilla Vitest reporter); the plugin
adds the AI integration on top. Distributing through the Claude marketplace
keeps the plugin surface independent of the npm release cadence. See D20.

**Why hooks in shell, not Node.** Hooks fire dozens of times per session and
must start fast. A Node-based hook pays a 100–200ms startup cost per
invocation; a POSIX shell hook is essentially instant. The shell scripts use
`jq` for JSON parsing and shell out to `vitest-agent` for any database
writes — the heavy lifting is in the CLI binary, not the hook itself.

**Why the orchestrator is one agent, not several.** A red-only agent, a
green-only agent, and a refactor-only agent would each need their own context
fork and their own MCP gate setup. Combining the cycle into one agent
preserves continuity within a behavior cycle and keeps the iron law (no
production code without a failing test first) enforceable in one place — the
agent's prompt and the hook layer that gates its tools. Per-phase
sub-orchestrators would multiply the number of `subagent-start` and
`subagent-stop` hooks for marginal isolation gain.

**Why the loader uses the user's package manager.** The MCP server is its own
npm package with its own bin entry. The user's PM already knows how to
resolve and execute project bins (hoisting rules, monorepo awareness, PnP
support). Re-implementing that resolution in the loader was the wrong layer
of abstraction. A missing peer dep now surfaces as a PM-level error with
PM-native install instructions, not a cryptic dynamic-import failure.
See D30.

## Agent-agnostic taxonomy hooks

Four lifecycle-event hooks wire the agent-attribution model end to end.
All four shell out to the CLI's `agent` sidecar subcommands (see
[./cli.md](./cli.md)) rather than performing database writes directly.

| Hook | Sidecar invocation | Purpose |
| --- | --- | --- |
| `session/start.sh` | `agent register-agent --host-kind claude-code --agent-type claude-code-main ...` then `agent sidecar-path` | Registers the main agent at session boot; parses the JSON result with `jq` and writes seven canonical `VITEST_AGENT_*` exports (the four UUIDs plus `PROJECT_DIR`, `DATA_DIR`, `PLUGIN_ROOT`) to two surfaces: `${CLAUDE_ENV_FILE}` (auto-sourced into Bash subprocs and the MCP child) and `~/.claude/session-env/${chat_id}/vitest-agent-hook.sh` (sourced by other hooks). Values are `printf '%q'` quoted; resumes are idempotent via grep guards. After writing those seven exports, calls `vitest-agent agent sidecar-path` once, captures stdout, and writes `VITEST_AGENT_SIDECAR_BIN=<abs-path>` to both surfaces using the same two-surface write pattern. Skips the export when the command returns empty or exits non-zero (unsupported platform). |
| `subagent/start-tdd.sh` | `agent register-agent --agent-type claude-code-tdd-task --parent-host-session-id $session_id ...` | Registers the orchestrator subagent at dispatch and pre-bootstraps the parent main row + always-set `parent_session_id` so artifact-binding works across `chat_id` rotation. Also writes a per-dispatch state file under `active-subagents/` so `subagent/stop-tdd.sh` can recover the subagent's `agentId` (see [State-file pairing for SubagentStop](#state-file-pairing-for-subagentstop)). |
| `session/end-record.sh` | `agent end-agent --host-session-id $session_id` | Sets `agents.ended_at` and `session_map.ended_at` for the main agent. |
| `subagent/stop-tdd.sh` | `agent end-agent` (no `--host-session-id`) | Sets `agents.ended_at` for the subagent. Resolves the subagent's `agentId` by pairing against the per-dispatch state file `subagent/start-tdd.sh` wrote (see [State-file pairing for SubagentStop](#state-file-pairing-for-subagentstop)); leaves the main agent's `session_map` row open by design. |
| `pre-tool-use/bash.sh` | sidecar binary `inject-env`, JS-CLI `agent inject-env` fallback | When the active actor is a subagent, rewrites `tool_input.command` to prepend the `VITEST_AGENT_AGENT_ID=...` env prefix. POSIX env-prefix scope is the immediately-following process only — main-agent env stays intact for subsequent calls. Gated behind a three-layer prefilter — see [The PreToolUse Bash hook: three-layer pipeline](#the-pretooluse-bash-hook-three-layer-pipeline). |

### The PreToolUse Bash hook: three-layer pipeline

`pre-tool-use/bash.sh` fires on every Bash tool call, so it is the inner loop of agent latency. A naive hook shells out to the JS CLI's `inject-env` unconditionally, paying full Node cold-start on every Bash call — most of it wasted, since the large majority of Bash calls cannot invoke Vitest and main-agent Vitest invocations already have correct attribution in their environment. The hook instead runs a three-layer pipeline that pays sidecar latency only on the small fraction of Bash calls that genuinely need the env-prefix rewrite. See [../decisions.md](../decisions.md) Decision 42.

- **Layer 0 — bash regex prefilter.** A POSIX-ERE regex (`SIDECAR_PREFILTER_RE`) is matched against the raw command with bash's built-in `[[ =~ ]]` operator — no fork, sub-millisecond. If the command contains no `vitest` token and no PM `test`-script shape, the hook emits a no-op and exits before any sidecar work. The regex is deliberately conservative: a false positive costs only the sidecar's latency, but a false negative would silently drop attribution, so all known PM script-indirection shapes are included.
- **Layer 1 — main-agent skip.** After Layer 0 passes and `source-session-env.sh` populates the canonical exports, the hook compares `VITEST_AGENT_AGENT_ID` against `VITEST_AGENT_MAIN_AGENT_ID`. They are equal when the active actor is the main agent, whose auto-sourced env is already correct for the spawned Vitest process — so the hook skips the sidecar. The check falls through conservatively (does NOT skip) when either var is unset. Layer 1 must run after the source call because hook subprocesses do not get auto-sourcing. Together Layers 0 and 1 eliminate the sidecar from ~98% of Bash calls.
- **Layer 2 — sidecar binary with JS fallback.** Only subagent-triggered Vitest invocations reach Layer 2. The hook reads `$VITEST_AGENT_SIDECAR_BIN` (set by the SessionStart hook once per session via `vitest-agent agent sidecar-path`), checks that it is non-empty and executable, and execs the binary directly when valid. Using the env var rather than `command -v vitest-agent-sidecar` is necessary because pnpm/npm never hoist transitive optional-dependency bins into `node_modules/.bin/`, so a `command -v` probe always misses. When `VITEST_AGENT_SIDECAR_BIN` is absent or non-executable — an unsupported platform, a skipped optional dependency, or a session that pre-dates the SessionStart resolution — the hook falls back to `vitest-agent agent inject-env` through the project's package manager. The two paths produce byte-identical rewritten output.

`vitest-agent-sidecar` is not a direct peer of `vitest-agent-plugin` — it is a regular `dependency` of `vitest-agent-cli`, which is itself a required peer of the plugin, so installing the plugin and its cli peer pulls the sidecar and its per-platform binaries in transitively. For the package's build, distribution and the `inject-env`-only scope, see [./sidecar.md](./sidecar.md).

The Layer 0 / Layer 1 hot path is roughly an order of magnitude faster than the unconditional JS shell-out, with the subagent-binary path in between. The hook's payload parsing collapses its `jq` and `dirname` forks to one each to keep the residual hot-path plumbing low. The benchmark harness is `scripts/bench-sidecar.sh`.

### Session env exports

The SessionStart hook writes these exports to two surfaces. The first seven come from the `register-agent` JSON result; the eighth is written separately after `agent sidecar-path` resolves:

```sh
export VITEST_AGENT_CHAT_ID="..."
export VITEST_AGENT_CONVERSATION_ID="..."
export VITEST_AGENT_MAIN_AGENT_ID="..."
export VITEST_AGENT_AGENT_ID="..."
export VITEST_AGENT_PROJECT_DIR="..."
export VITEST_AGENT_DATA_DIR="${CLAUDE_PLUGIN_DATA}"
export VITEST_AGENT_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
export VITEST_AGENT_SIDECAR_BIN="/abs/path/to/vitest-agent-sidecar"  # omitted when not resolvable
```

Values are `printf '%q'` quoted so spaces, quotes, and newlines do
not break downstream sourcing. The two write targets are:

- `${CLAUDE_ENV_FILE}` — host auto-sources into Bash subprocs and
  the MCP child. The filename here is host-controlled and
  fire-order-numbered (typically `sessionstart-hook-N.sh`); writes
  are grep-guarded so resumes do not duplicate exports.
- `~/.claude/session-env/${chat_id}/vitest-agent-hook.sh` —
  written with a known filename so other plugin hooks can source
  it via `plugin/hooks/lib/source-session-env.sh`. The helper
  globs `*hook*.sh` so it also picks up host-written entries as
  redundancy.

Non-SessionStart hooks (PreToolUse, SubagentStart, etc.) do NOT
receive auto-sourcing per Claude Code's documented behavior, so
they call `source_session_env "$session_id"` after sourcing
`plugin/hooks/lib/source-session-env.sh` at entry. The helper
validates the session-id shape (rejects path separators, dot-paths,
empty values, CR/LF/tab), then walks
`~/.claude/session-env/${session_id}/*hook*.sh`. It mirrors
`EnvLoader.loadSessionEnvFiles` from `claude-binary-plugin` — same
directory walk, same `*hook*.sh` filter.

`export` is mandatory in env files. Bare `KEY=VAL` lines are sourced
as shell-script locals and do not propagate to subprocesses.
Documented as a hook invariant.

### Allowlist contents

`hooks/lib/safe-mcp-vitest-agent-ops.txt` lists the consolidated tool
surface. The action-keyed tools (`tdd_task`, `tdd_goal`, `tdd_behavior`,
`note`, `hypothesis`, `inventory`, `test`) are on the allowlist, alongside
`register_agent` and `tdd_artifact_list`.

### State-file pairing for SubagentStop

Claude Code's `SubagentStop` payload carries `agent_type` but not the `agentId` minted at `SubagentStart`, so the stop hook cannot end the right agent row from its own input alone. The pairing bridges that gap with a per-dispatch state file.

`subagent/start-tdd.sh` writes one file per dispatch to `~/.claude/session-env/${chat_id}/active-subagents/<ts>-<pid>.json`. The file name is the synthetic-key tail with the `${chat_id}-subagent-` prefix stripped, which keeps the directory scannable by mtime. Each file holds `agentId`, `agentType`, `syntheticKey` and `startedAt`.

`subagent/stop-tdd.sh` pairs on `agentType`, matching the oldest unconsumed start with the current stop. It reads `agentId` from the matched file, calls `vitest-agent agent end-agent` (no `--host-session-id`) and removes the file. Pairing is deterministic for sequential same-type dispatches; for concurrent same-type dispatches it is approximate but the ended-agent count stays correct.

`session/end-record.sh` removes the whole `active-subagents/` directory for the closing `chat_id` as janitorial cleanup, so files orphaned by a crashed stop hook do not accumulate.

### Artifact-binding across `chat_id` rotation

Two related concerns shape the artifact-binding path:

1. **Rotated `chat_id` mid-window.** Claude Code rotates
   `chat_id` on compaction, resume, and some network
   reconnects. `DataReader.findSessionsByChatPrefix` and
   `DataReader.listTddTasksForSession({ walkParents })` both walk the
   `sessions.parent_session_id` chain so artifact queries find rows
   under either prefix.
2. **Orphaned subagent rows.** `subagent/start-tdd.sh`
   pre-bootstraps the parent main `sessions` row before registering
   the subagent and always sets `parent_session_id`. Combined with
   the `DataStore.upsertSession` idempotent insert, the subagent's
   artifact rows always land under the canonical `sessions.id`.

The shared `resolveSessionForRecording` helper in the CLI is the
consumer-side library for this. Every `record turn` /
`record tdd-artifact` / `test-case-turns` call goes through it.
