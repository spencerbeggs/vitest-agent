---
type: Module
title: "vitest-agent agent plugin (Claude Code and Copilot)"
description: The agent plugin at plugin/, one pluginfinity source built into a Claude Code plugin and a GitHub Copilot plugin, that turns the npm packages' persisted test data into agent behavior through hooks, a TDD orchestrator subagent, skills, and an MCP loader.
kind: plugin
resource: ../../plugin
status: draft
tags:
  - architecture
  - tdd
  - dx
  - performance
sources:
  - id: pluginfinity-config
    resource: ../../plugin/pluginfinity.config.ts
  - id: package-json
    resource: ../../plugin/package.json
  - id: plugin-claude-md
    resource: ../../plugin/CLAUDE.md
  - id: claude-manifest
    resource: ../../plugin/builds/claude/.claude-plugin/plugin.json
  - id: copilot-manifest
    resource: ../../plugin/builds/copilot/plugin.json
  - id: start-mcp-sh
    resource: ../../plugin/bin/start-mcp.sh
  - id: common-sh
    resource: ../../plugin/hooks/lib/vitest-agent/common.sh
  - id: safe-mcp-ops
    resource: ../../plugin/hooks/lib/vitest-agent/safe-mcp-ops.txt
  - id: session-start-sh
    resource: ../../plugin/hooks/session/start.sh
  - id: end-record-sh
    resource: ../../plugin/hooks/session/end-record.sh
  - id: start-tdd-sh
    resource: ../../plugin/hooks/subagent/start-tdd.sh
  - id: stop-tdd-sh
    resource: ../../plugin/hooks/subagent/stop-tdd.sh
  - id: bash-hook-sh
    resource: ../../plugin/hooks/pre-tool-use/bash.sh
  - id: bash-tdd-sh
    resource: ../../plugin/hooks/pre-tool-use/bash-tdd.sh
  - id: mcp-hook-sh
    resource: ../../plugin/hooks/pre-tool-use/mcp.sh
  - id: test-location-sh
    resource: ../../plugin/hooks/pre-tool-use/test-location.sh
  - id: tdd-artifact-sh
    resource: ../../plugin/hooks/post-tool-use/tdd-artifact.sh
  - id: tdd-task-agent
    resource: ../../plugin/agents/tdd-task.md
  - id: tdd-skill
    resource: ../../plugin/skills/tdd/SKILL.md
  - id: hook-output-bats
    resource: ../../plugin/__test__/hook-output.bats
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: a55e837c658925f4639cd8407da0364f79f79ba3a65810ad592a725e7ffbde36
---

# vitest-agent agent plugin (Claude Code and Copilot)

The concept id keeps its historical `claude-code-plugin` name so existing
links resolve. The module now covers both hosts.

## Purpose

`plugin/` is the primary AI integration surface for the whole vitest-agent
system. The npm packages are headless data infrastructure: the reporter
trims output, the SDK and engine persist runs and failures, and the MCP
server exposes them. None of that changes how an agent writes code on its
own. This plugin turns the persisted data into agent behavior, through
hook scripts, a TDD orchestrator subagent, skills, and an MCP loader. It
contributes nothing to the user's runtime: every script and prompt is
consumed by the host, never imported by the user's code.

## Boundary

The plugin is one host-neutral source that
[pluginfinity](https://github.com/spencerbeggs/pluginfinity) builds into
two plugins ([Decision
80](../decisions/80-build-the-agent-plugin-from-one-pluginfinity-source.md)):

- `plugin/builds/claude/`, the Claude Code plugin, installed as
  `vitest-agent@spencerbeggs`.[^claude-manifest]
- `plugin/builds/copilot/`, the GitHub Copilot plugin.[^copilot-manifest]

`pluginfinity.config.ts` declares the plugin's metadata, the session-env
values, every hook entry (in Claude Code's event names and matchers), the
MCP server, and the Copilot overrides.[^pluginfinity-config] Both builds
are generated and committed and never edited by hand; `pluginfinity build
--check` fails when one is stale. pluginfinity's hook, server, log, and
session-env libraries exist only in `builds/`.

`plugin/` is a pnpm workspace member whose `package.json` names the
private `@vitest-agent/ai-plugins` tracking package. It never publishes to
npm. It exists so changesets can version and tag the plugin, and its
`versionFiles` bump both built manifests ([Decision
81](../decisions/81-ai-plugins-as-a-release-only-pnpm-workspace.md)).[^package-json]
The root `layers.json` lists it under `tooling`, so it is not one of the
ranked packages under `packages/`. Its only coupling to the rest of the
family is at runtime, through the bins `@vitest-agent/plugin` links into a
consumer's `node_modules` and the `vitest-agent` CLI every hook shells out
to.

## Public surface

Each build declares one MCP server, `mcp`, started as `sh
${PLUGIN_ROOT}/bin/start-mcp.sh --noop=1`. It also ships one agent,
`agents/tdd-task.md` (`vitest-agent:tdd-task`), seventeen skills, and the
hook set below. There are no slash commands. The former `/tdd`, `/setup`,
and `/configure` commands are the skills `/vitest-agent:tdd <goal>`,
`/vitest-agent:setup`, and `/vitest-agent:configure`.[^plugin-claude-md]

## Key files

- `pluginfinity.config.ts`: metadata, session env, hook entries, the MCP
  server, per-host overrides.
- `bin/start-mcp.sh`: the MCP loader (POSIX `sh`, on pluginfinity's
  server library).
- `hooks/<event>/<name>.sh`: one script per hook, grouped by event.
- `hooks/lib/vitest-agent/`: this plugin's own helpers. `common.sh` holds
  `va_cli`, `va_is_tdd_agent`, `va_mcp_op`, and `va_state_dir`, and
  `safe-mcp-ops.txt` is the MCP auto-allow list.
- `agents/tdd-task.md`: the TDD orchestrator.
- `skills/<name>/SKILL.md`: one directory per skill.
- `__test__/`: bats suites, run against both builds.
- `builds/`: generated, committed, never edited.

## Loader strategy

`bin/start-mcp.sh` sources pluginfinity's `server.sh` and has no `jq`
dependency, so it runs before the user has installed
anything.[^start-mcp-sh] It asks `server_project_dir` for the project.
That is `CLAUDE_PROJECT_DIR` on Claude Code, which the loader exports as
`VITEST_AGENT_REPORTER_PROJECT_DIR`, because Claude Code does not reliably
propagate `CLAUDE_PROJECT_DIR` to MCP children. If
`<project>/node_modules/.bin/vitest-agent-mcp` is executable, the loader
`exec`s it with the positional args passed through. That bin is the
carrier's shim, present in every consumer that installed
`@vitest-agent/plugin`. The `exec` is load-bearing: the host's direct child
becomes the server itself, so a closed pipe ends it with no orphan. Only
when the bin is missing does the loader detect the package manager, to word
an install line on **stderr**. It then falls back to `exec npx --yes
@vitest-agent/mcp@5 "$@"`, pinned to the major the hooks were written for
([Decision
30](../decisions/30-plugin-mcp-loader-execs-the-consumer-s-node-modules-bin.md)).
It deliberately avoids the library's `server_exec_bin`, which would
dispatch through the package manager. The MCP server is never bundled with
the plugin, because the engine binds a platform-specific SQLite driver that
must match the consumer's Node.

A Copilot MCP server starts in the plugin root with no project, so the
loader falls back to its working directory and, in practice, to `npx`.
See [Limitation: The Copilot MCP server cannot locate the
project](../limitations/copilot-mcp-server-cannot-locate-the-project.md).

Every hook that shells out to the CLI resolves it through `va_cli` in
`common.sh`.[^common-sh] The order is: (1) `$VITEST_AGENT_CLI_CMD`
verbatim; (2) the **relative** `node_modules/.bin/vitest-agent` when it is
executable under the project; (3) `vitest-agent` on `PATH`; (4) otherwise
return `1`, and the call site answers `hook_noop`. Hooks never dispatch
through a package manager and never fall back to `npx`. Rung 2 is relative
because call sites expand the result unquoted, as rung 1 may be multi-word,
so every call sits behind a load-bearing `cd "<dir>" &&`.

## Hook architecture

Every hook sources pluginfinity's generated `hook.sh` and then
`common.sh`, reads its payload only through `hook_input`, and answers
exactly once with a library response function ([Decision
83](../decisions/83-hook-responses-through-the-pluginfinity-hook-library.md)).
The library writes the response to stdout, so each CLI call captures or
redirects its own output. `__test__/hook-output.bats` runs every hook
against a stdout-spamming CLI to catch a leak.[^hook-output-bats] Scripts
branch on `hook_supports <capability>`, never on the host. Failures go to
`hook_log`, and debug lines to `hook_debug` (on under `PLUGINFINITY_DEBUG=1`).
Both land in `${XDG_STATE_HOME:-~/.local/state}/pluginfinity/vitest-agent/`,
and `pnpm exec pluginfinity logs` reads them.

Hooks fall into five functional groups:

- **Recording hooks** write session, prompt, tool-call, file-edit, and
  hook-fire turns through `vitest-agent agent record`, for every turn in
  every session. `session/end-record.sh` is a fast foreground shim over
  `session/end-record-worker.sh`.[^end-record-sh] The host aborts in-flight
  `SessionEnd` hooks on interactive exit ("Hook cancelled"), so on an
  exit-type reason the shim detaches the worker (`nohup`, every descriptor
  redirected) and returns at once. On `clear` / `resume` it runs the worker
  synchronously. See [Gotcha: SessionEnd hook
  cancelled](../gotchas/sessionend-hook-cancelled.md).
- **Context-injection hooks** run `agent triage` / `agent wrapup` on
  `SessionStart`, `UserPromptSubmit`, and `Stop`, and surface the result as
  context or a system message where the host shows one. Copilot shows no
  `UserPromptSubmit` output and no system messages, so those scripts skip
  the work there.
- **Permission hooks.** `pre-tool-use/mcp.sh` auto-allows this plugin's MCP
  tools listed in `lib/vitest-agent/safe-mcp-ops.txt`, except a call whose
  `tool_input.action` is `delete`, which falls through to the permission
  prompt ([Decision D13](../decisions/d13-mcp-permits-agent-restricts.md)).[^mcp-hook-sh]
  `va_mcp_op` strips the plugin's MCP prefix on either host. Editing the
  allow list needs a rebuild before it takes effect.[^safe-mcp-ops]
- **TDD orchestrator gates** fire only inside the `tdd-task` subagent,
  matched by `va_is_tdd_agent` against the payload's `agent_type`
  (`vitest-agent:tdd-task`). They deny dangerous Vitest flags (`--update`,
  `-u`, `--bail`, `-t`, `--testNamePattern`, `--reporter=silent`, a
  boundary-anchored `.snap`) and signal-suppressing config
  edits.[^bash-tdd-sh] They also deny goal and behavior deletes and direct
  artifact records, and record evidence artifacts. This is the runtime
  enforcement layer of the TDD discipline; the agent's `tools:` list is
  documentation, not enforcement.
- **Layout enforcement.** `pre-tool-use/test-location.sh` runs a lexical
  prefilter, then `vitest-agent agent check-test-path`, which shares
  `classifyTestPath` with the discovery globs.[^test-location-sh] It
  denies only the creation of a new test file at an `invalid` location and
  advises otherwise (Claude Code only). It fails open, and
  `VITEST_AGENT_TEST_LOCATION_HOOK=off` disables it.

On Copilot the three MCP-scoped `PreToolUse` entries carry no matcher,
because how Copilot spells a plugin MCP tool in a hook payload is
unmeasured. The scripts filter with `va_mcp_op` instead. The two
`Elicitation` hooks are Claude Code only.

## Session values

The plugin's session ids and sidecar path are pluginfinity session-env
values set with `hook_env_set` in `session/start.sh`, which every later
hook reads as plain variables ([Decision
82](../decisions/82-session-values-through-pluginfinity-session-env.md)).
On Claude Code, `start.sh` also hand-writes
`~/.claude/session-env/<chat_id>/vitest-agent-hook.sh`. The published MCP
server reads that file to recover attribution after a boot race or
`/reload-plugins`.[^session-start-sh] The full contract is in
[Interface: hook environment contract](../interfaces/hook-env-contract.md).

## Evidence binding

The TDD loop depends on `tdd_artifacts` rows being written **by hooks, not
by the orchestrator**. The agent never writes evidence about itself.
`post-tool-use/tdd-artifact.sh` fires on every tool result inside the
orchestrator and detects three things.[^tdd-artifact-sh] Test runs are
Bash vitest, jest, or bats commands (bats with `--suite bats`), or
`run_tests` results. File edits produce `test_written` for `*.test.*`
paths and `code_written` otherwise. `post-tool-use/test-quality.sh`
records `test_weakened` on `it.skip`, `.todo`, `.fails`, `.skipIf`, and
similar. Before writing an artifact the hook backfills
`test_cases.created_turn_id` through `agent record test-case-turns`. That
is the `test_case_authored_in_session` binding the phase-transition
validator checks. Every `record tdd-artifact` call forwards
`--tdd-task-id $VITEST_AGENT_TDD_TASK_ID` when that variable is set ([Decision
D21](../decisions/d21-conversation-tree-fallback-and-task-id-escape-hatch.md)).

## Agent architecture

The plugin ships one agent, `agents/tdd-task.md`, the TDD
orchestrator.[^tdd-task-agent] It decomposes its goal into goals, and each
goal into behaviors (one red-green-refactor cycle each). It preloads the
`tdd` skill and nine primitives through `skills:`, and Copilot gets them
appended as a list. `model: sonnet` and `color` are Claude Code only.
Copilot also drops the Claude-only tools (`LSP`, `ReportFindings`,
`SendMessage`, the Task tools, `TodoWrite`, `ToolSearch`). The agent no
longer declares `context: fork`, which is a skill field, but a subagent
starts with a fresh context anyway, so task prompts must still be
self-contained.

**Dispatch contract: plain unnamed background subagent, never a named
teammate.** An unnamed background subagent fires `SubagentStart`, which
registers it under a parent-prefixed session key that shares the
dispatching session's `conversation_id`. Its artifacts then funnel back to
the session that opened the task. A named-teammate dispatch spawns a
detached session, and every phase-transition request denies with
`missing_artifact_evidence`. See [Decision
D21](../decisions/d21-conversation-tree-fallback-and-task-id-escape-hatch.md)
for the two mitigations behind the contract.

**Task tools are optional; narration is primary.** The Task-panel tools and
`TodoWrite` are host-gated and may be absent. Progress narration keyed to
`tdd_progress_push` channel events is the primary channel. Those events
ride `notifications/message` (logger `vitest-agent/channel`), and a main
agent that misses them falls back to polling `tdd_task({ action: "get" })`.

## Skills

Seventeen skills:

- `tdd`, the TDD workflow skill and the `/vitest-agent:tdd <goal>` entry
  point. It runs the pre-dispatch sequence and dispatches the orchestrator
  under the contract above.[^tdd-skill]
- Nine primitives preloaded into the orchestrator: interpret failures,
  name and shape tests, verify test quality, run and classify, record a
  hypothesis before a fix, commit at green or refactor exit, revert on
  extended red, and decompose goals into behaviors.
- `test-discovery`, path-triggered.
- Four standalone references, loaded on demand: `configuration`,
  `debugging`, `coverage-improvement`, and `operating-vitest-agent`.
- The user-invoked `setup` and `configure` (`disable-model-invocation:
  true`). `setup` verifies Vitest 5.0+, `@vitest-agent/plugin`, and a
  coverage provider, then emits the canonical config shape. `configure` is
  display-only.

## Agent-agnostic taxonomy hooks

| Hook | CLI invocation | Purpose |
| --- | --- | --- |
| `session/start.sh` | `agent register-agent`, then `agent sidecar-path` | Registers the main agent (only when the payload has a `transcript_path`, which only Claude Code sends) and sets the session values[^session-start-sh] |
| `subagent/start-tdd.sh` | `agent register-agent --parent-agent-id ...` | Registers the orchestrator, bootstraps the parent row, and writes a per-dispatch state file under `<plugin data>/active-subagents/<chat_id>/`[^start-tdd-sh] |
| `session/end-record.sh` → worker | `agent end-agent --host-session-id $session_id` | Ends the main agent, detached on exit-type reasons[^end-record-sh] |
| `subagent/stop-tdd.sh` | `agent end-agent` (no `--host-session-id`) | Ends the subagent found by state-file pairing[^stop-tdd-sh] |

On Copilot no agent is registered; see [Limitation: Copilot sessions carry
no agent
attribution](../limitations/copilot-sessions-carry-no-agent-attribution.md).

### The PreToolUse Bash hook: three-layer pipeline

`pre-tool-use/bash.sh` fires on every Bash call and rewrites Vitest
invocations with the `VITEST_AGENT_*` env prefix through `inject-env`
([Decision 42](../decisions/42-three-layer-sidecar-performance-fix.md)).[^bash-hook-sh]

- **Layer 0, bash regex prefilter.** A POSIX-ERE match with `[[ =~ ]]`,
  no fork. A command with no `vitest` token and no package-manager `test`
  script shape answers `hook_noop`.
- **Layer 1, main-agent skip.** Equal `VITEST_AGENT_AGENT_ID` and
  `VITEST_AGENT_MAIN_AGENT_ID` mean the main agent, whose environment is
  already correct. The hook falls through when either value is unset.
- **Layer 2, sidecar binary with JS fallback.** The hook execs
  `$VITEST_AGENT_SIDECAR_BIN` when it is executable, else `vitest-agent
  agent inject-env` through `va_cli`. Both run the same pure `injectEnv`.
  On a rewrite the hook allows the call with the whole `tool_input`
  carried over and `command` replaced.

Sourcing the hook library now costs about 50 ms before Layer 0 runs. That
pushes the skip path to 63.5 ms p95 against a 20 ms gate; see
[Measurement: pluginfinity hook latency,
2026-10-09](../measurements/pluginfinity-hook-latency-2026-10-09.md) and
the older [sidecar hook-latency
measurement](../measurements/sidecar-hook-latency.md).
`@vitest-agent/sidecar` reaches a consumer transitively through
`@vitest-agent/cli`, never as a dependency of this plugin; see [the
sidecar module](sidecar.md).

### Artifact-binding across `chat_id` rotation

Claude Code rotates `chat_id` on compaction, resume, and some reconnects.
`DataReader.findSessionsByChatPrefix` and `listTddTasksForSession({
walkParents, walkConversation })` walk the parent chain and fall back to
open tasks sharing the same `conversation_id`. The explicit
`VITEST_AGENT_TDD_TASK_ID` escape hatch covers the residual case. See
[Decision
D21](../decisions/d21-conversation-tree-fallback-and-task-id-escape-hatch.md).

## Dogfood system

The plugin is verified by dispatching the orchestrator against the
`playground/` workspace, which holds intentional defects, and auditing the
result. `pnpm claude` runs Claude Code with `plugin/builds/claude` loaded.
A dispatch prompt carries only the task; the answer key for the defects
stays invisible to the orchestrator. See [the playground
module](playground.md).

## Choices absorbed here

**Why a file-based plugin, not a published npm package.** Plugins are how a
host learns about agent-specific MCP servers, hooks, and skills. The npm
packages work without the plugin, and distributing through the marketplace
keeps this surface off the npm release cadence.

**Why hooks are shell, not Node.** Hooks fire dozens of times per session;
a Node hook pays 100 to 200 ms of startup per invocation. Shell scripts use
`jq` and shell out to `vitest-agent` for any database write.

**Why a sidecar CLI rather than an `mcp_tool` hook for hook-to-MCP
communication.** The `mcp_tool` hook's `input` only accepts substitutions
from the triggering payload, so it cannot carry hook-computed values. See
[Decision D16](../decisions/d16-sidecar-cli-over-mcp-tool-hooks.md).

**Why per-instance identity composes from the plugin data dir and
`session_id`.** See [Decision
D18](../decisions/d18-per-instance-identity-from-claude-plugin-data-and-session-id.md).

**Why an explicit `suite` marker for bats run-level artifacts.** See
[Decision
D22](../decisions/d22-explicit-suite-marker-for-bats-run-level-artifacts.md).

[^pluginfinity-config]: `../../plugin/pluginfinity.config.ts`
[^package-json]: `../../plugin/package.json`
[^plugin-claude-md]: `../../plugin/CLAUDE.md`
[^claude-manifest]: `../../plugin/builds/claude/.claude-plugin/plugin.json`
[^copilot-manifest]: `../../plugin/builds/copilot/plugin.json`
[^start-mcp-sh]: `../../plugin/bin/start-mcp.sh`
[^common-sh]: `../../plugin/hooks/lib/vitest-agent/common.sh` (`va_cli`)
[^safe-mcp-ops]: `../../plugin/hooks/lib/vitest-agent/safe-mcp-ops.txt`
[^session-start-sh]: `../../plugin/hooks/session/start.sh`
[^end-record-sh]: `../../plugin/hooks/session/end-record.sh`, `../../plugin/hooks/session/end-record-worker.sh`
[^start-tdd-sh]: `../../plugin/hooks/subagent/start-tdd.sh`
[^stop-tdd-sh]: `../../plugin/hooks/subagent/stop-tdd.sh`
[^bash-hook-sh]: `../../plugin/hooks/pre-tool-use/bash.sh`
[^bash-tdd-sh]: `../../plugin/hooks/pre-tool-use/bash-tdd.sh`
[^mcp-hook-sh]: `../../plugin/hooks/pre-tool-use/mcp.sh`
[^test-location-sh]: `../../plugin/hooks/pre-tool-use/test-location.sh`
[^tdd-artifact-sh]: `../../plugin/hooks/post-tool-use/tdd-artifact.sh`
[^tdd-task-agent]: `../../plugin/agents/tdd-task.md`
[^tdd-skill]: `../../plugin/skills/tdd/SKILL.md`
[^hook-output-bats]: `../../plugin/__test__/hook-output.bats`
