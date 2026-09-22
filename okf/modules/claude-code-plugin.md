---
type: Module
title: "vitest-agent (Claude Code plugin)"
description: The file-based Claude Code plugin at plugins/claude-code that turns the npm packages' persisted test data into agent behavior — hooks, a TDD orchestrator subagent, skill primitives, slash commands, and an MCP loader.
kind: plugin
resource: ../../plugins/claude-code
status: stable
tags:
  - architecture
  - tdd
  - dx
  - performance
sources:
  - id: plugin-manifest
    resource: ../../plugins/claude-code/.claude-plugin/plugin.json
  - id: start-mcp-sh
    resource: ../../plugins/claude-code/bin/start-mcp.sh
  - id: hooks-json
    resource: ../../plugins/claude-code/hooks/hooks.json
  - id: detect-pm-sh
    resource: ../../plugins/claude-code/hooks/lib/detect-pm.sh
  - id: hook-output-sh
    resource: ../../plugins/claude-code/hooks/lib/hook-output.sh
  - id: match-tdd-agent-sh
    resource: ../../plugins/claude-code/hooks/lib/match-tdd-agent.sh
  - id: session-start-sh
    resource: ../../plugins/claude-code/hooks/session/start.sh
  - id: end-record-sh
    resource: ../../plugins/claude-code/hooks/session/end-record.sh
  - id: end-record-worker-sh
    resource: ../../plugins/claude-code/hooks/session/end-record-worker.sh
  - id: start-tdd-sh
    resource: ../../plugins/claude-code/hooks/subagent/start-tdd.sh
  - id: stop-tdd-sh
    resource: ../../plugins/claude-code/hooks/subagent/stop-tdd.sh
  - id: bash-hook-sh
    resource: ../../plugins/claude-code/hooks/pre-tool-use/bash.sh
  - id: bash-tdd-sh
    resource: ../../plugins/claude-code/hooks/pre-tool-use/bash-tdd.sh
  - id: test-location-sh
    resource: ../../plugins/claude-code/hooks/pre-tool-use/test-location.sh
  - id: tdd-artifact-sh
    resource: ../../plugins/claude-code/hooks/post-tool-use/tdd-artifact.sh
  - id: tdd-task-agent
    resource: ../../plugins/claude-code/agents/tdd-task.md
  - id: tdd-command
    resource: ../../plugins/claude-code/commands/tdd.md
  - id: package-json
    resource: ../../plugins/claude-code/package.json
generated:
  by: okfit/claude-code
  at: 2026-09-16T20:35:27Z
  body_sha256: 3e818e3cc441d96c69d6618ed158096b548934ef00c0a8c02bdd608e79a565f8
---

# vitest-agent (Claude Code plugin)

## Purpose

`plugins/claude-code/` is the primary AI integration surface for the whole
vitest-agent system. The six npm packages are headless data infrastructure —
the reporter trims output, the SDK/engine persist runs and failures, the MCP
server exposes them — and none of that on its own changes how an agent
writes code. This plugin is what turns the persisted data into agent
behavior, through hook scripts, a TDD orchestrator subagent, skill
primitives, slash commands, and an MCP loader.

Claude Code reads the plugin manifest, spawns the MCP loader, registers
hook scripts, and exposes the TDD orchestrator agent and slash commands.
The plugin contributes nothing to the user's runtime — every script and
prompt is consumed by Claude Code itself, never imported by the user's
code.

## Boundary

The plugin is **file-based**: static files Claude Code discovers by
filesystem convention (`.claude-plugin/plugin.json`, `hooks/`, `agents/`,
`skills/`, `commands/`, `bin/`), with no compilation and no runtime of its
own[^plugin-manifest]. It IS a pnpm workspace member (`pnpm-workspace.yaml`
globs `plugins/*`) but never publishes to npm — `plugins/claude-code/package.json`
declares `@vitest-agent/claude-code-plugin`, `"private": true`, with no
`publishConfig` and no scripts, existing purely so changesets has a package
to version[^package-json]. It ships through the Claude marketplace as
`vitest-agent@spencerbeggs` and versions independently of the npm packages.

The plugin depends on nothing at the workspace-layering level — it is not
one of the ranked packages under `packages/`. Its only coupling to the rest
of the family is at runtime, through whatever `@vitest-agent/plugin` links
into a consumer's `node_modules` (see *Loader strategy* below) and through
the `vitest-agent` CLI every hook shells out to. Every hook script is Bash,
invoked as `bash <script>` by every `hooks.json` registration, and sources
shared helpers only from `hooks/lib/` — never a relative path outside its
own tree.

## Public surface

The manifest at `.claude-plugin/plugin.json` declares one `mcpServers`
entry (`mcp`, spawned via `bash ${CLAUDE_PLUGIN_ROOT}/bin/start-mcp.sh
--noop=1`), and Claude Code's own conventions pick up everything under
`hooks/hooks.json`, `agents/*.md`, `skills/*/SKILL.md`, and
`commands/*.md`[^plugin-manifest]. There is exactly one agent
(`agents/tdd-task.md`, invocation name `vitest-agent:tdd-task`), fifteen
skills, and three slash commands (`/setup`, `/configure`, `/tdd`).

## Key files

- `bin/start-mcp.sh` — the active MCP loader (POSIX `sh`); `bin/start-mcp.mjs`
  is a Node.js mirror kept for debugging, not referenced by the manifest.
- `hooks/hooks.json` — hook-event registrations and matchers.
- `hooks/lib/` — shared helpers: `detect-pm.sh`, `hook-output.sh`,
  `hook-debug.sh`, `match-tdd-agent.sh`, `source-session-env.sh`, and the
  `safe-mcp-vitest-agent-ops.txt` allowlist.
- `hooks/{session,user-prompt-submit,pre-tool-use,post-tool-use,subagent,stop,pre-compact,elicitation}/`
  — one directory per Claude Code lifecycle event.
- `agents/tdd-task.md` — the TDD orchestrator, `context: fork`.
- `skills/` — one directory per skill, each with its own `SKILL.md`.
- `commands/{setup,configure,tdd}.md` — slash commands.

## Loader strategy

`bin/start-mcp.sh` is a zero-dependency POSIX shell loader (`set -eu`, no
`jq`) that Claude Code spawns as a direct child process over stdio — it must
run before the user has installed anything[^start-mcp-sh]. It resolves
`ROOT` from `CLAUDE_PROJECT_DIR` (or `pwd`) and exports
`VITEST_AGENT_REPORTER_PROJECT_DIR=$ROOT`, because Claude Code does not
reliably propagate `CLAUDE_PROJECT_DIR` to MCP server subprocesses; the
server's `resolveProjectDir` reads that variable as its second-highest
precedence rung. If `$ROOT/node_modules/.bin/vitest-agent-mcp` is
executable it `exec`s that binary directly with the manifest's positional
args (`--noop=1`) passed through verbatim — the carrier's shim, present in
every consumer that installed `@vitest-agent/plugin` under npm, pnpm, yarn,
or bun. The `exec` is load-bearing: after startup Claude Code's direct
child is the MCP server process itself, with no shell wrapper left to
forward signals or buffer stdio, so a closed session pipe ends the server
via EOF with no orphan processes. Only when the local bin is missing does
the loader detect the package manager — the `packageManager` field first,
then a lockfile — solely to word an install line printed to **stderr**,
then falls back to `exec npx --yes @vitest-agent/mcp@4 "$@"` as a registry
fetch, pinned to the major so an unpinned fetch can never pull a future
major the hooks were not written for. The MCP server itself is never bundled with the plugin; bundling was
rejected because the engine's data layer binds a platform-specific SQLite
driver that must match the consumer's own Node version, so the server has
to resolve from the consumer's `node_modules` at spawn time.

Every hook that shells out to the CLI resolves it the same way through
`detect_vitest_agent_bin` in `hooks/lib/detect-pm.sh`[^detect-pm-sh]: (1)
`$VITEST_AGENT_CLI_CMD` verbatim when set — an operator/test override; (2)
the **relative** `node_modules/.bin/vitest-agent` when
`$cwd/node_modules/.bin/vitest-agent` is executable; (3) the
package-manager dispatch as the last rung. Rung 2 is deliberately relative:
call sites expand `$cli` unquoted, which is required for the multi-word
rungs 1 and 3, so an absolute path containing a space would word-split and
silently never run — every call therefore sits behind a load-bearing
`cd "$cwd" &&`.

## Hook architecture

Hooks fall into five functional categories, all Bash, all returning JSON
to Claude Code via stdout:

- **Recording hooks** capture session, prompt, tool-call, file-edit, and
  hook-fire turns into SQLite via `vitest-agent agent record`, unscoped —
  every turn in every session — with failures logged to `hook_error`
  rather than swallowed. `session/end-record.sh` is a fast foreground shim
  over `session/end-record-worker.sh`[^end-record-sh]: Claude Code runs
  `SessionEnd` hooks under an abortable timeout and cancels in-flight hooks
  unconditionally on interactive exit ("Hook cancelled"), which used to
  kill serial CLI spawns mid-run and leave rows half-written. On an
  exit-type end reason the shim detaches the worker (`nohup`, disowned,
  fds redirected to a per-session log, plus `3>&-` to close the fenced
  stdout descriptor) and returns a no-op within milliseconds, so the host
  has nothing left to abort; the worker finishes the session-end recording
  after Claude Code has already exited. On `clear` / `resume` the session
  continues, so the shim runs the worker synchronously and surfaces the
  wrap-up `systemMessage`.
- **Context-injection hooks** run on `SessionStart`, `UserPromptSubmit`,
  `Stop`, `SessionEnd`, and `PreCompact`, calling `agent triage` / `agent
  wrapup` and emitting the result as session context or `systemMessage`.
  `Stop`, `SessionEnd`, and `PreCompact` must use top-level `systemMessage`
  because Claude Code's hook schema only allows `additionalContext` on a
  subset of events.
- **Permission hooks** — `pre-tool-use/mcp.sh` reads `tool_name` against
  `hooks/lib/safe-mcp-vitest-agent-ops.txt` and auto-allows non-destructive
  MCP tools so the agent isn't prompted for every read. Destructive
  actions inside consolidated tools (`tdd_goal({ action: "delete" })`,
  `tdd_behavior({ action: "delete" })`) are gated separately, by presence
  on the allowlist plus a rejected `action` value at hook time rather than
  by allowlist absence.
- **TDD orchestrator gates** fire only when the `tdd-task` subagent is
  active, matched through `hooks/lib/match-tdd-agent.sh`'s `is_tdd_agent`
  function — the single place that checks Claude Code's hook-payload
  `agent_type` field against `"vitest-agent:tdd-task"`, the only form ever
  observed in practice[^match-tdd-agent-sh]. These hooks block
  production-code edits without a preceding test failure, deny dangerous
  Vitest flags (`--update`, `--bail`, `--testNamePattern`), reject
  test-weakening edits, and record evidence artifacts — the runtime
  enforcement layer for the iron-law TDD discipline; the orchestrator's
  `tools:` frontmatter array is documentation, not enforcement.
  `pre-tool-use/bash-tdd.sh` matches its forbidden-pattern list against the
  whole command string, so each pattern carries its own boundary — the
  snapshot guard requires a non-alphanumeric character or end-of-string
  after the `.snap` extension, rather than matching `.snap` as a bare
  substring, so a command merely naming a file like
  `cells.snapshot.test.ts` is not denied[^bash-tdd-sh].
  `post-tool-use/tdd-artifact.sh`'s test-run matcher also recognizes bats
  invocations alongside vitest/jest ones, passing `--suite bats` so the
  validator can bind bats-only cycles (see *Evidence binding*
  below)[^tdd-artifact-sh].
- **Layout enforcement** — `pre-tool-use/test-location.sh` fires on
  `Read`/`Write`/`Edit`/`MultiEdit` calls whose basename looks like a test
  file, then delegates the verdict to `vitest-agent agent
  check-test-path`, which shares `classifyTestPath`
  (`@vitest-agent/sdk`) with the discovery globs rather than re-deriving
  the rule in Bash[^test-location-sh]. Only the creation of a new test
  file at an `invalid` location is denied, with the suggested valid path;
  every other match gets advisory `additionalContext` instead, since an
  existing file's location can't be un-broken by refusing the edit. Any
  CLI failure fails open. The check honours
  `VITEST_AGENT_TEST_LOCATION_HOOK=off` as a total opt-out and no-ops when
  the workspace's Vitest config carries a custom `DiscoverStrategy` or
  cannot be read, since the hook only knows the default discovery layout.

Two shared helpers underpin all of the above. `hook-output.sh` centralizes
every JSON shape a hook may emit (`emit_noop`, `emit_allow`, `emit_deny`,
`emit_additional_context`, `emit_system_message`, plus `emit_raw` as the
escape hatch for a tool-specific payload like PreToolUse `updatedInput`)
and fences hook stdout at source time: `exec 3>&1 1>&2` behind a
`_VITEST_AGENT_HOOK_STDOUT_FENCED` guard moves the real hook stdout to fd
3, so a stray byte from the script or anything it spawns lands on stderr
instead of corrupting the one JSON object Claude Code expects on fd
1[^hook-output-sh]. `hook-debug.sh` provides `hook_error` (always logs)
and `hook_debug` (only under `VITEST_AGENT_HOOK_DEBUG=1`); recording and
artifact hooks capture CLI output, test the exit status, and call
`hook_error` on failure rather than silencing it with `|| true`.

## Evidence binding

The TDD enforcement loop depends on `tdd_artifacts` rows being written **by
hooks, not by the orchestrator** — the agent never writes evidence about
itself; hooks observe what the agent did and write the rows.
`post-tool-use/tdd-artifact.sh` fires on every tool result inside the
orchestrator subagent and detects test runs (by matching the Bash command
against a bats pattern checked first, then a vitest/jest/PM-script
pattern), file edits (by tool name — `*.test.*` paths produce
`test_written`, anything else `code_written`), and test-weakening edits
(via `post-tool-use/test-quality.sh` scanning for `it.skip`, `.todo`,
`.fails`, snapshot mutations)[^tdd-artifact-sh]. Before writing each
artifact, the hook backfills `test_cases.created_turn_id` via `agent
record test-case-turns`, binding the artifact to a test case authored in
the same session window — the load-bearing `test_case_authored_in_session`
invariant the phase-transition validator checks for a `red→green`
citation. Every `record tdd-artifact` call also appends
`--tdd-task-id $VITEST_AGENT_TDD_TASK_ID` when that variable is set in the
subagent's environment, the explicit escape hatch for a detached session
whose artifacts would otherwise land under a session the automatic task
lookup never reaches (see *Artifact-binding across `chat_id` rotation*
below).

## Agent architecture

The plugin ships one agent, `agents/tdd-task.md`, the TDD orchestrator. It
decomposes its `goal` argument into goals (slices testable as units), then
each goal into behaviors (one red-green-refactor cycle each) — the
three-tier hierarchy is the primary navigation axis for the channel events
the orchestrator streams back to the dispatching agent, and decomposition
is the LLM's job while the server stores what it's told and validates
referential integrity.

**`context: fork`.** The orchestrator runs in a forked conversation context
and does not inherit the dispatching agent's history — task prompts must
be self-contained[^tdd-task-agent]. This is correct both in production use
(the orchestrator should reason from its prompt, not the dispatcher's
accumulated state) and in dogfood use (the dispatcher's cheatsheet and
meta-goal must stay invisible to the agent under test).

**Dispatch contract: plain unnamed background subagent, never a named
teammate.** The orchestrator is spawned with `run_in_background: true`,
`subagent_type: "vitest-agent:tdd-task"`, and no `name`/team argument. An
unnamed background subagent fires `SubagentStart`, registering the run
under a parent-prefixed session key that shares the dispatching session's
`conversation_id` — so the subagent's test-run and edit artifacts funnel
back to the session the `tdd_task (action: start)` call opened, and
evidence-based phase gates pass. A named-teammate dispatch instead spawns a
detached session with its own `conversation_id` and no parent link: the
task opens under the dispatcher's session while artifacts land under the
detached one, and every phase-transition request denies with
`missing_artifact_evidence`. Two mitigations sit behind the contract
without replacing it — see [Decision D21](../decisions/d21-conversation-tree-fallback-and-task-id-escape-hatch.md).

**Task tools are optional; narration is primary.** The Task-panel tools
(`TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList`) and `TodoWrite` are
host-session-gated and may simply be absent; the agent frontmatter grants
them anyway so sessions that have them get the UI mirror, but plain-text
progress narration keyed to `tdd_progress_push` channel events is the
primary channel — those events are persisted server-side regardless of
whether any panel renders.

**Channel-event flow and the polling fallback.** On a lifecycle transition
the orchestrator calls `tdd_progress_push`; the MCP server validates the
payload, resolves `goalId`/`sessionId` server-side from `behaviorId` for
behavior-scoped events, and emits the enriched event as a standard MCP
`notifications/message` frame (logger `vitest-agent/channel`) rather than
the retired custom `notifications/claude/channel` method Effect's
`McpServer` cannot emit. A main agent whose host does not surface MCP
logging notifications, or that survives a `/reload-plugins` mid-run, falls
back to polling `tdd_task({ action: "get" })` for the full goal/behavior/phase
tree.

## Skills

The plugin ships skill primitives covering every step of the TDD cycle:
interpreting failures, naming and shaping tests, verifying test quality,
running and classifying results, recording hypotheses before fixes,
committing at green/refactor exit, reverting on extended red, and
decomposing goals into behaviors. All ten (the `tdd` workflow skill plus
nine primitives) are preloaded into the orchestrator via its `skills:`
frontmatter and are also published as standalone `SKILL.md` files for
non-orchestrator reuse — there is no separate inline copy. `test-discovery`
is path-triggered, auto-loading when Claude Code reads a file under
`__test__/`, `__fixtures__/`, or `__snapshots__/`. `configuration`,
`debugging`, `coverage-improvement`, and `operating-vitest-agent` are
standalone-only, loaded on demand by the main agent.

## Slash commands

`/setup` runs a deterministic seven-step flow that verifies Vitest 5.0+,
`@vitest-agent/plugin`, and a coverage provider, then emits the canonical
2.0 config shape (an `AgentPlugin.discover()` destructure, the five-field
options surface, split coverage) and migrates pre-2.0 option patterns.
`/configure` is display-only: it parses the config and renders a
five-field options table plus the Vitest coverage block, pointing the user
at the file for manual edits — it never mutates the config. `/tdd`
performs the pre-dispatch sequence (session lookup, a fresh `runId`) and
dispatches the orchestrator with the user's goal as the task prompt,
following the plain-unnamed-subagent dispatch contract[^tdd-command].

## Dogfood system

The plugin's behavior under load is verified by dispatching the
orchestrator against the `playground/` workspace (which contains
intentional defects) and auditing the result. A *chain* groups related
handoffs testing one aspect of the system; each handoff carries a `# Task
for the TDD orchestrator` section dispatched verbatim to the orchestrator
and a `# What the orchestrator MUST NOT know` section reserved for the
main agent's verification — the two are kept rigorously separate, since the
orchestrator receives only the task section, never the frontmatter or the
meta-goal. The answer key for `playground/`'s intentional defects is
invisible to the orchestrator; referencing it in a dispatch prompt would
invalidate the experiment. See [the playground module](playground.md) for
the sandbox itself.

## Agent-agnostic taxonomy hooks

Four lifecycle-event hooks wire the agent-attribution model end to end, all
shelling out to the CLI's `agent` sidecar subcommands rather than writing
to the database directly:

| Hook | Sidecar invocation | Purpose |
| --- | --- | --- |
| `session/start.sh` | `agent register-agent` then `agent sidecar-path` | Registers the main agent at session boot and writes the canonical `VITEST_AGENT_*` exports (see [the hook/env contract](../interfaces/hook-env-contract.md)) to two surfaces[^session-start-sh] |
| `subagent/start-tdd.sh` | `agent register-agent --agent-type claude-code-tdd-task --parent-host-session-id $session_id` | Registers the orchestrator subagent, pre-bootstraps the parent main row with `parent_session_id` always set, and writes a per-dispatch state file for pairing[^start-tdd-sh] |
| `session/end-record.sh` → worker | `agent end-agent --host-session-id $session_id` | Sets `agents.ended_at` and `session_map.ended_at` for the main agent, detached on exit-type end reasons[^end-record-sh] |
| `subagent/stop-tdd.sh` | `agent end-agent` (no `--host-session-id`) | Sets `agents.ended_at` for the subagent, resolved by state-file pairing; leaves the main agent's `session_map` row open by design[^stop-tdd-sh] |

`pre-tool-use/bash.sh` is the fifth taxonomy touchpoint but is described
separately below because it is the inner loop of agent latency, not a
one-shot lifecycle hook[^bash-hook-sh].

### The PreToolUse Bash hook: three-layer pipeline

`pre-tool-use/bash.sh` fires on every Bash tool call an agent makes. A
naive hook would shell out to the JS CLI's `inject-env` unconditionally,
paying full Node cold-start on every call even though the large majority of
Bash calls cannot invoke Vitest and main-agent Vitest invocations already
have correct attribution in their auto-sourced environment. Instead the
hook runs a three-layer pipeline that pays sidecar latency only on the
residual fraction of calls that genuinely need the rewrite — see
[Decision 42](../decisions/42-three-layer-sidecar-performance-fix.md).

- **Layer 0 — bash regex prefilter.** A POSIX-ERE regex matched against the
  raw command with bash's built-in `[[ =~ ]]` operator — no fork,
  sub-millisecond. A command containing no `vitest` token and no PM
  `test`-script shape emits a no-op and exits before any sidecar work.
- **Layer 1 — main-agent skip.** After the session env is sourced, the
  hook compares `VITEST_AGENT_AGENT_ID` against
  `VITEST_AGENT_MAIN_AGENT_ID`; equal means the active actor is the main
  agent, whose auto-sourced env is already correct, so the hook skips the
  sidecar. The check falls through conservatively (does not skip) when
  either var is unset.
- **Layer 2 — sidecar binary with JS fallback.** Only subagent-triggered
  Vitest invocations reach here. The hook reads `$VITEST_AGENT_SIDECAR_BIN`
  (set once per session by the SessionStart hook via `vitest-agent agent
  sidecar-path`) and execs it directly when non-empty and executable;
  otherwise it falls back to `vitest-agent agent inject-env` via
  `detect_vitest_agent_bin`. Both paths run the same pure `injectEnv` logic
  and produce byte-identical output. See [the sidecar module](sidecar.md)
  for the binary itself and [the sidecar hook-latency
  measurement](../measurements/sidecar-hook-latency.md) for the numbers
  this pipeline produces.

`@vitest-agent/sidecar` reaches a consumer's install transitively — a
regular `dependency` of `@vitest-agent/cli`, which is itself a regular
`dependency` of `@vitest-agent/plugin` — never a direct dependency of this
plugin.

### Session env exports, allowlist, and state-file pairing

The SessionStart hook writes eight canonical `VITEST_AGENT_*` exports (four
UUIDs plus `PROJECT_DIR`, `DATA_DIR`, `PLUGIN_ROOT`, and `SIDECAR_BIN`) to
two surfaces, and `hooks/lib/safe-mcp-vitest-agent-ops.txt` lists the
consolidated MCP tool surface the PreToolUse allowlist auto-permits.
`subagent/start-tdd.sh` / `subagent/stop-tdd.sh` pair a `SubagentStop`
payload (which carries `agent_type` but not the `agentId` minted at
`SubagentStart`) back to its start via a per-dispatch state file. The full
contract — exact variable names, write targets, allowlist contents, and
the state-file pairing mechanics — is the consumer-facing surface
documented in [the hook/env contract](../interfaces/hook-env-contract.md);
this module only names where it lives.

### Artifact-binding across `chat_id` rotation

Claude Code rotates `chat_id` on compaction, resume, and some network
reconnects, and a named-teammate dispatch (or any session row with no
`parent_session_id`) has nothing for a parent-session walk to follow. Two
mitigations close that gap: `DataReader.findSessionsByChatPrefix` and
`listTddTasksForSession({ walkParents, walkConversation })` walk the
`sessions.parent_session_id` chain and, when the parent walk yields no open
task, fall back to open tasks owned by other sessions sharing the same
non-null `conversation_id` (main-session tasks first); and the explicit
`VITEST_AGENT_TDD_TASK_ID` → `--tdd-task-id` escape hatch skips session
resolution altogether for the residual case where `conversation_id` was
never populated on one of the two sessions. See [Decision
D21](../decisions/d21-conversation-tree-fallback-and-task-id-escape-hatch.md)
for the full three-layer design and the trigger that populates
`sessions.conversation_id` in the first place.

## Choices absorbed here

**Why a file-based plugin, not a published npm package.** Plugins are how
Claude Code learns about agent-specific MCP servers, hooks, skills, and
commands; the npm packages can ship without this plugin (a consumer can
install `@vitest-agent/plugin` and use it as a vanilla Vitest reporter),
and distributing through the marketplace keeps this surface independent of
the npm release cadence — a choice absorbed into this Module rather than
kept as a separate Decision record.

**Why a private tracking package for something that never publishes.**
Before the move, the marketplace manifest's `$.version` was a
`versionFiles` entry on `@vitest-agent/plugin`, so a hook-only change
forced a build and npm publish of the Vitest plugin package. The tree now
lives at `plugins/claude-code/` with its own private, script-free
`@vitest-agent/claude-code-plugin` package as a release-only handle: a
changeset against it bumps the tracking `package.json` and the
marketplace manifest together and cuts a GitHub Release with no npm
publish. See [Decision
64](../decisions/64-claude-code-plugin-as-a-release-only-pnpm-workspace.md).

**Why hooks are shell, not Node.** Hooks fire dozens of times per session
and must start fast; a Node-based hook pays a 100–200 ms startup cost per
invocation that a shell hook does not. Shell scripts use `jq` for JSON
parsing and shell out to `vitest-agent` for any database write — the heavy
lifting stays in the CLI binary.

**Why the loader execs `node_modules/.bin` directly, not a package-manager
dispatch.** `@vitest-agent/plugin` is the carrier: it declares the
`vitest-agent-mcp` bin itself, so any consumer that installed the plugin
has it at a fixed, manager-independent path. Dispatching through the
package manager resolved bins differently per manager and, under pnpm,
only found a transitive bin because a pnpm plugin hoisted it. See
[Decision 30](../decisions/30-plugin-mcp-loader-execs-the-consumer-s-node-modules-bin.md).

**Why a sidecar CLI pattern rather than an `mcp_tool` hook for
hook→MCP communication.** The `mcp_tool` hook event's `input` field only
accepts `${path}` substitutions from the triggering event's own JSON
payload — it cannot carry caller-supplied or hook-computed values like a
generated `clientNonce` or captured git context. Every hook that needs to
register or update agent state instead shells out to `vitest-agent agent
<subcommand>`, which runs Node once, computes what it needs, and writes
through in a single process. See [Decision
D16](../decisions/d16-sidecar-cli-over-mcp-tool-hooks.md).

**Why `${CLAUDE_ENV_FILE}` auto-source plus a hook self-source bridge.**
Claude Code exports `${CLAUDE_ENV_FILE}` only to `SessionStart` (and
`Setup`/`CwdChanged`/`FileChanged`) hooks, and auto-sources the union of
all plugins' exports into Bash tool subprocesses and the MCP server child
— but not into other hook subprocesses. `hooks/lib/source-session-env.sh`
bridges that gap by walking a known per-session directory and sourcing
every file there, mirroring an already-battle-tested loader from a sibling
plugin. See [Decision
D17](../decisions/d17-claude-env-file-auto-source-and-hook-self-source-bridge.md).

**Why per-instance identity composes from `${CLAUDE_PLUGIN_DATA}` +
`session_id`.** Claude Code exports no per-instance directory env var of
its own; `${CLAUDE_PLUGIN_DATA}/sessions/${session_id}/` is the only
unambiguous, per-Claude-instance composition available from documented
surfaces, and it is the rule this plugin uses for any future
per-instance coordination state. See [Decision
D18](../decisions/d18-per-instance-identity-from-claude-plugin-data-and-session-id.md).

**Why an explicit `suite` marker for bats run-level artifacts, rather than
inferring one.** A bats invocation has no `test_cases` row, so its run
evidence is necessarily run-level with no `test_case_id` — but accepting
any null-`test_case_id` artifact would also accept a vitest whole-suite
failure, exactly the anchorless evidence the phase-transition validator
exists to reject. A stored, `CHECK`-constrained `suite` column set once at
the only write path (the hook, via the CLI) keeps the validator pure
instead of putting the hook's command-matching logic inside it. See
[Decision D22](../decisions/d22-explicit-suite-marker-for-bats-run-level-artifacts.md).

**Why the stdout fence lives in the library, not at each call site.**
Claude Code parses a hook's stdout as exactly one JSON object; a single
call site that forgets to redirect a spawned CLI's stdout corrupts the
whole payload and the host silently discards the entire hook response,
permission decision included. Moving the fence into `hook-output.sh` at
source time makes the failure class unrepresentable instead of relying on
per-call-site review discipline. See [Decision
D23](../decisions/d23-fence-hook-stdout-at-the-library-not-the-call-site.md).

[^plugin-manifest]: `plugins/claude-code/.claude-plugin/plugin.json`
[^package-json]: `plugins/claude-code/package.json`
[^start-mcp-sh]: `plugins/claude-code/bin/start-mcp.sh`
[^detect-pm-sh]: `plugins/claude-code/hooks/lib/detect-pm.sh:79` (`detect_vitest_agent_bin`)
[^hook-output-sh]: `plugins/claude-code/hooks/lib/hook-output.sh:55` (stdout fence), `plugins/claude-code/hooks/lib/hook-output.sh:62` (`emit_noop`)
[^match-tdd-agent-sh]: `plugins/claude-code/hooks/lib/match-tdd-agent.sh`
[^session-start-sh]: `plugins/claude-code/hooks/session/start.sh:118` (canonical exports), `plugins/claude-code/hooks/session/start.sh:161` (sidecar-path resolution)
[^end-record-sh]: `plugins/claude-code/hooks/session/end-record.sh`, `plugins/claude-code/hooks/session/end-record-worker.sh`
[^start-tdd-sh]: `plugins/claude-code/hooks/subagent/start-tdd.sh:136` (state-file write)
[^stop-tdd-sh]: `plugins/claude-code/hooks/subagent/stop-tdd.sh:43` (state-file pairing)
[^bash-hook-sh]: `plugins/claude-code/hooks/pre-tool-use/bash.sh`
[^bash-tdd-sh]: `plugins/claude-code/hooks/pre-tool-use/bash-tdd.sh`
[^test-location-sh]: `plugins/claude-code/hooks/pre-tool-use/test-location.sh`
[^tdd-artifact-sh]: `plugins/claude-code/hooks/post-tool-use/tdd-artifact.sh`
[^tdd-task-agent]: `plugins/claude-code/agents/tdd-task.md:61` (`context: fork`)
[^tdd-command]: `plugins/claude-code/commands/tdd.md`
