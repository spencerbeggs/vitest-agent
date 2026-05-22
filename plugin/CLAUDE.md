# Claude Code Plugin — `plugin/`

This directory is a **file-based Claude Code plugin**. It is **not** a pnpm workspace and is **not** published to npm. It ships separately alongside the six npm packages and is distributed through the Claude marketplace.

## Identity and distribution

- **Marketplace org/bot:** `spencerbeggs` (bot name not in the enabledPlugins key)
- **Plugin name:** `vitest-agent`
- **Installed as:** `"enabledPlugins": { "vitest-agent@spencerbeggs": true }` in `.claude/settings.json`
- **Versioned independently** from the npm packages — the `version` field in `plugin/.claude-plugin/plugin.json` tracks plugin-specific releases. This independence is the source of the `[vitest-agent-<pkg>] version drift: …` stderr warning users may see when the marketplace plugin trails the npm release; see the root CLAUDE.md "Cross-package version drift" section.
- **This plugin is the primary AI integration surface for the entire vitest-agent system.** The npm packages collect and store data; the plugin is what turns that data into agent behavior.

## Directory layout

```text
plugin/
├── .claude-plugin/
│   └── plugin.json      # CC plugin manifest: mcpServers, hooks, skills, agents, commands
├── agents/
│   └── tdd-task.md      # tdd-task subagent (context:fork, drives red-green-refactor cycles)
├── bin/
│   ├── start-mcp.sh     # POSIX shell loader (preferred): exec-replaces itself with PM command
│   └── start-mcp.mjs    # Node.js loader (fallback): spawns PM via child_process, stays alive
├── commands/
│   ├── configure.md     # /configure slash command
│   ├── setup.md         # /setup slash command
│   └── tdd.md           # /tdd slash command
├── hooks/
│   ├── hooks.json            # Hook registrations (matchers, event bindings)
│   ├── fixtures/             # Synthetic JSON payloads for manual hook invocation (README inside)
│   ├── lib/                  # Shared helpers: detect-pm.sh, hook-debug.sh, hook-output.sh,
│   │                         #   match-tdd-agent.sh, source-session-env.sh,
│   │                         #   safe-mcp-vitest-agent-ops.txt (PreToolUse allowlist)
│   ├── __test__/             # BATS tests for hook scripts
│   │                         #   hook-output-project-dir.bats, sidecar-prefilter.bats,
│   │                         #   sidecar-layer2.bats, subagent-state-file.bats,
│   │                         #   cli-rename-cascade.bats
│   ├── session/              # SessionStart, SessionEnd
│   ├── user-prompt-submit/   # UserPromptSubmit
│   ├── pre-tool-use/         # PreToolUse (bash, bash-tdd, mcp, mcp-run-tests,
│   │                         #   record, tdd-restricted, vitest-config)
│   ├── post-tool-use/        # PostToolUse (git-commit, record, tdd-artifact,
│   │                         #   test-quality, test-run)
│   ├── subagent/             # SubagentStart, SubagentStop
│   ├── stop/                 # Stop
│   ├── pre-compact/          # PreCompact
│   └── elicitation/          # Elicitation, ElicitationResult
└── skills/              # Sub-skill primitives (one directory per skill, each with SKILL.md)
    ├── commit-cycle/
    ├── configuration/
    ├── coverage-improvement/
    ├── debugging/
    ├── decompose-goal-into-behaviors/
    ├── derive-test-name-from-behavior/
    ├── derive-test-shape-from-name/
    ├── interpret-test-failure/
    ├── record-hypothesis-before-fix/
    ├── revert-on-extended-red/
    ├── run-and-classify/
    ├── tdd/
    ├── verify-test-quality/
    └── vitest-context/
```

## MCP loader

Claude Code spawns `start-mcp.sh` as a direct child process over the stdio transport. The loader:

1. Detects the project's package manager from `packageManager` in `package.json` or lockfile presence (npm / pnpm / yarn / bun).
2. Resolves `projectDir` from `CLAUDE_PROJECT_DIR` (falling back to `process.cwd()`).
3. Spawns `vitest-agent-mcp` through that package manager with `VITEST_AGENT_REPORTER_PROJECT_DIR` set, so the MCP server uses the correct workspace root.
4. On failure, prints PM-specific install instructions and exits non-zero.

`start-mcp.sh` uses `exec` to replace itself — after startup, CC's direct child is the package manager with no shell wrapper. `start-mcp.mjs` stays alive as a wrapper (useful for debugging) and is not the active loader unless `plugin.json` is changed to reference it.

The MCP server communicates with CC over stdin/stdout. When CC closes its session, it closes the pipe; the MCP server exits via EOF. No orphan processes.

## Hooks

Hook scripts in `hooks/` are POSIX shell, grouped by hook event into subdirectories. All source shared helpers from `hooks/lib/` via `$(dirname "$0")/../lib/<helper>`. Key scripts:

| Script | Trigger | Behavior |
| --- | --- | --- |
| `session/start.sh` | `SessionStart` | Injects test status + MCP tool reference; calls `vitest-agent agent register-agent` for the main agent; writes the seven canonical `VITEST_AGENT_*` exports to two surfaces — `${CLAUDE_ENV_FILE}` (host auto-sources into Bash subprocs and the MCP child) and `~/.claude/session-env/${chat_id}/vitest-agent-hook.sh` (other hooks source it via `lib/source-session-env.sh`). Idempotent on resume via `grep -q` guard. Also resolves the sidecar binary path once per session via `vitest-agent agent sidecar-path` and appends `VITEST_AGENT_SIDECAR_BIN=<abs-path>` to both surfaces when the binary is resolvable. |
| `pre-tool-use/mcp.sh` | `PreToolUse` (MCP tools) | Auto-allows non-destructive MCP tools without per-call prompts (consult `safe-mcp-vitest-agent-ops.txt`) |
| `pre-tool-use/tdd-restricted.sh` | `PreToolUse` (tdd-task subagent) | Reads `tool_input.action` on the consolidated `tdd_goal` / `tdd_behavior` tools and denies `delete` (also blocks `tdd_artifact_record`) inside the orchestrator subagent |
| `pre-tool-use/bash-tdd.sh` | `PreToolUse` (Bash, tdd-task subagent) | Blocks `--update`, `--reporter=silent`, `--bail`, `--testNamePattern`; injects reminder to use `run_tests` MCP |
| `pre-tool-use/bash.sh` | `PreToolUse` (Bash, all agents) | Three-layer `inject-env` pipeline. Layer 0: bash regex prefilter skips the sidecar when the command cannot invoke Vitest. Layer 1: skips the sidecar when the active agent is the main agent. Layer 2: reads `$VITEST_AGENT_SIDECAR_BIN` (set once per session by `session/start.sh`); execs the binary directly when non-empty and executable, falls back to the `vitest-agent` JS CLI otherwise. On a rewrite, returns `updatedInput.command` with the `VITEST_AGENT_CONVERSATION_ID` / `_AGENT_ID` env prefix. Payload parsing is one `jq` call; `dirname` is computed once |
| `post-tool-use/test-run.sh` | `PostToolUse` (Bash) | Detects vitest invocations in the Bash command; on non-zero exit code (read from `.tool_response.exit_code`) injects `<test_failure_guidance>` pointing the agent at MCP tools |
| `post-tool-use/git-commit.sh` | `PostToolUse` (Bash) | Detects `git commit` invocations; records commit metadata into `commits` table |
| `post-tool-use/tdd-artifact.sh` | `PostToolUse` (Write/Edit/run_tests, tdd-task) | Records `test_written`, `test_failed_run`, `test_passed_run`, `code_written` artifacts into `tdd_artifacts` |
| `post-tool-use/test-quality.sh` | `PostToolUse` (Write/Edit, tdd-task) | Detects test-weakening edits (`it.skip`, `.todo`, snapshot mutations); records `test_weakened` artifact |
| `subagent/start-tdd.sh` | `SubagentStart` | Self-sources the session env, creates a synthetic subagent session row in `sessions` (key: `${chat_id}-subagent-<ts>-<pid>`), then calls `vitest-agent agent register-agent --parent-agent-id $VITEST_AGENT_MAIN_AGENT_ID` to record the subagent in `agents` |
| `subagent/stop-tdd.sh` | `SubagentStop` | Runs `vitest-agent agent wrapup --kind tdd_handoff`, records the handoff note on the parent session, then pairs the stop to a `SubagentStart` via the per-dispatch state file under `~/.claude/session-env/${chat_id}/active-subagents/` (oldest-start-with-oldest-stop on matching `agent_type`), reads the matched `agentId`, calls `vitest-agent agent end-agent --agent-id $agentId` to set `agents.ended_at`, and removes the state file |
| `session/end-record.sh` | `SessionEnd` | Records a `hook_fire` turn, records the session-end timestamp, emits the wrap-up prompt, then calls `vitest-agent agent end-agent --agent-id $VITEST_AGENT_MAIN_AGENT_ID --host-session-id $chat_id` to close both `agents.ended_at` and `session_map.ended_at` |
| `post-tool-use/record.sh` | `PostToolUse` (all) | Records tool-call turns for session analytics |
| `user-prompt-submit/record.sh` | `UserPromptSubmit` | Records user prompt turns |
| `pre-compact/record.sh` | `PreCompact` | Records pre-compaction turn for analytics |
| `stop/record.sh` | `Stop` | Records main-agent stop turn for analytics |
| `elicitation/session-id.sh` | `Elicitation` | Stamps session id into elicitation request |
| `elicitation/result-record.sh` | `ElicitationResult` | Records elicitation result turn (currently no-op) |

The allowlist for `pre-tool-use/mcp.sh` lives at `hooks/lib/safe-mcp-vitest-agent-ops.txt`. Add new non-destructive MCP tools here when they are deployed. Omit delete tools — those require explicit user confirmation from the main agent.

`match-tdd-agent.sh` (`hooks/lib/`) provides `is_tdd_agent()` which matches `"vitest-agent:tdd-task"` — the only form CC sends in hook payloads. The legacy `plugin:vitest-agent:tdd-task` and bare `tdd-task` forms were removed after being confirmed never observed in practice.

`hook-debug.sh` (`hooks/lib/`) provides two logging functions sourced by every hook: `hook_error` always writes to `/tmp/vitest-agent-hook-errors.log` (overrideable via `VITEST_AGENT_HOOK_ERROR_LOG`); `hook_debug` writes to `/tmp/vitest-agent-hook-debug.log` only when `VITEST_AGENT_HOOK_DEBUG=1` is set. Recording and artifact hooks use a capture-and-log pattern for CLI failures — `|| true` is no longer used to suppress errors silently.

`hook-output.sh` (`hooks/lib/`) centralizes every JSON shape a hook may emit: `emit_noop`, `emit_allow`, `emit_deny`, `emit_additional_context`, `emit_system_message`. All user strings flow through `jq -n --arg` to prevent embedded quotes or newlines from breaking the payload. It also sets `VITEST_AGENT_PROJECT_DIR` from `CLAUDE_PROJECT_DIR` at source time (only when not already set and then exports it), anchoring every `vitest-agent` CLI call in a hook to the same project root the MCP server uses. This is load-bearing for subagent TDD recording: without it, a hook running from a monorepo sub-package `cwd` would resolve a different `data.db` and silently split evidence across two databases. The BATS test `hooks/__test__/hook-output-project-dir.bats` covers the project-dir propagation contract.

## Agents

| Agent file | Invocation name | Description |
| --- | --- | --- |
| `agents/tdd-task.md` | `vitest-agent:tdd-task` | TDD orchestrator with `context:fork`. Drives red-green-refactor cycles with evidence-based phase transitions, three-tier goal/behavior hierarchy, mandatory MCP gates, and channel event push. Cannot write production code without a failing test first. |

`context: fork` gives the agent a clean conversation context — it does not inherit the dispatching agent's history. Task prompts must be self-contained. This is correct for dogfood dispatches (prevents cheatsheet leakage) and for production use (the agent should reason from its prompt, not accumulated conversation state).

## Skills

Skills are loaded into the dispatching agent's context via three mechanisms: explicit invocation through the `Skill` tool, preloading through an agent's `skills:` frontmatter, or path-triggered auto-loading when files matching the skill's `paths:` glob are read. The 15 skills below split into four groups by load mechanism.

**Preloaded into `tdd-task` on launch (10):** the `tdd` workflow skill plus the 9 primitives listed below. Listed in the agent's `skills:` frontmatter and injected into context at dispatch.

**Path-triggered (1):** `test-discovery` auto-loads via its `paths:` glob when Claude Code reads any file under `__test__/`, `__fixtures__/`, or `__snapshots__/`.

**Standalone-only (4):** `configuration`, `debugging`, `coverage-improvement`, `vitest-context` — load on demand via the `Skill` tool from any agent.

| Skill | Group | Purpose |
| --- | --- | --- |
| `tdd` | preloaded (tdd-task) | Main TDD workflow: session lifecycle, phase transitions, goal/behavior hierarchy, channel events |
| `interpret-test-failure` | preloaded primitive | Parse failure output, classify failure kind |
| `derive-test-name-from-behavior` | preloaded primitive | Name a test from a behavior description |
| `derive-test-shape-from-name` | preloaded primitive | Choose `it`, `describe/it`, parametric, etc. from test name |
| `verify-test-quality` | preloaded primitive | Check written test for escape hatches and weak assertions |
| `run-and-classify` | preloaded primitive | Run tests via MCP, classify result, record artifact |
| `record-hypothesis-before-fix` | preloaded primitive | Gate 2 — record hypothesis before any non-test file edit |
| `commit-cycle` | preloaded primitive | Commit at every accepted phase transition |
| `revert-on-extended-red` | preloaded primitive | Revert if stuck in red for >5 turns or >3 failed runs |
| `decompose-goal-into-behaviors` | preloaded primitive | Break a goal into atomic red-green-refactor behaviors |
| `test-discovery` | path-triggered | Test-file layout, naming conventions, src/ coverage derivation |
| `debugging` | standalone | Systematic failure diagnosis using `test_history`, `test_errors`, `failure_signature_get` |
| `coverage-improvement` | standalone | Coverage improvement using `file_coverage`, `test_trends` |
| `configuration` | standalone | `AgentPlugin` setup and option reference |
| `vitest-context` | standalone | Vitest-specific test context helpers |

## Commands

| Command | File | Description |
| --- | --- | --- |
| `/setup` | `commands/setup.md` | Verify Vitest 4.1+ and peer dependencies, then emit the canonical 2.0 `vitest.config.ts` |
| `/configure` | `commands/configure.md` | View the resolved reporter configuration — display-only |
| `/tdd` | `commands/tdd.md` | Launch a TDD session using the `tdd` skill |

## Hot-reload cost matrix

| What changed | Action required |
| --- | --- |
| Hook script body (`.sh`) | None — takes effect on the next hook invocation |
| Skill or agent markdown (`SKILL.md`, `tdd-task.md`) | None — takes effect on the next subagent dispatch |
| Plugin allowlist (`safe-mcp-vitest-agent-ops.txt`) | None — takes effect on the next tool call |
| `hooks.json` (new entry or matcher) | `/reload-plugins` — hook registrations reload with the plugin |
| `plugin.json` `mcpServers.<server>.args` | `/reload-plugins` — changing `args` restarts that MCP server |
| MCP server or SDK source (`packages/mcp/`, `packages/sdk/`) | `pnpm ci:build` + `/reload-plugins` |
| Database schema / migration | `pnpm ci:build` + delete `data.db` + `/reload-plugins` |
| `plugin.json` structural fields (new `mcpServers`, metadata) | Full CC restart — `/reload-plugins` is not sufficient |

### Hot-patching the MCP without a full restart

After rebuilding with `pnpm ci:build`, bump the `--noop` counter in `.claude-plugin/plugin.json` to force `/reload-plugins` to restart the MCP server:

```json
{
  "mcpServers": {
    "mcp": {
      "command": "bash",
      "args": ["${CLAUDE_PLUGIN_ROOT}/bin/start-mcp.sh", "--noop=2"]
    }
  }
}
```

The MCP binary ignores unknown flags, so `--noop` is a harmless signal for Claude Code only. `--noop=1` is the committed baseline and stays in the file permanently — changing the value is what cues Claude Code to boot a fresh MCP instance on `/reload-plugins`. After confirming the restart, revert the value back to `--noop=1` before pushing.

Confirm restart by checking that PIDs changed:

```bash
ps aux | grep -E "start-mcp|vitest-agent-mcp" | grep -v grep
```

## Dogfood system

The plugin's behavior under load is verified through the dogfood system — a controlled testing loop where the tdd-task agent is dispatched against the `playground/` workspace (which contains intentional defects) and its behavior is audited against expected outcomes.

- **Skill:** `.claude/skills/dogfood/SKILL.md` — the main agent's guide for running dogfood sessions. Invoke via `/dogfood` with `--start`, `--random`, `--lifecycle`, or `--from <path>`.
- **Chain records:** `docs/superpowers/dogfood/<chain-slug>/` — per-chain handoff files and `findings.md`. Local only (gitignored).
- **Playground:** `playground/` — sandbox workspace with intentional defects. The `playground/src/lifecycle.ts` file has a permanent deliberate bug (`return a + b + 1`) for lifecycle runs.
- **Cheatsheet:** `.claude/playground-cheatsheet.md` — the answer key for verification. Never shown to the tdd-task agent.

The dogfood system was the primary development driver for the hook and agent behaviors in this directory. Findings from past runs are in `docs/superpowers/dogfood/lifecycle-check/findings.md`.

## Design docs

- `@./.claude/design/vitest-agent/components/plugin-claude.md`
  The first-class design doc for this plugin. Load when working on hooks,
  the tdd-task agent, the MCP loader, the dogfood loop, or `context:fork`
  semantics.
- `@./.claude/design/vitest-agent/architecture.md`
  Load when you need an overview of how the plugin fits with the six npm
  packages and the MCP server.
- `@./.claude/design/vitest-agent/decisions.md`
  Load when you need the rationale behind hook design, evidence binding,
  or the loader strategy.

## Agent-agnostic taxonomy additions (Phases 2–4)

**SessionStart hook** (`session/start.sh`) calls `vitest-agent agent register-agent` after `vitest-agent agent record session-start`, then writes seven canonical exports to two surfaces:

```sh
export VITEST_AGENT_CHAT_ID="..."
export VITEST_AGENT_CONVERSATION_ID="..."
export VITEST_AGENT_MAIN_AGENT_ID="..."
export VITEST_AGENT_AGENT_ID="..."
export VITEST_AGENT_PROJECT_DIR="..."
export VITEST_AGENT_DATA_DIR="${CLAUDE_PLUGIN_DATA}"
export VITEST_AGENT_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
```

- **`${CLAUDE_ENV_FILE}`** — host auto-sources this into Bash-tool subprocesses and the MCP server child, but **NOT** into hook subprocesses. The filename here is host-controlled (typically `~/.claude/session-env/<session_id>/sessionstart-hook-N.sh` where `N` is the hook fire order); we cannot rely on a particular name and instead append via grep-guarded idempotent writes.
- **`~/.claude/session-env/${chat_id}/vitest-agent-hook.sh`** — written explicitly with a known filename so other plugin hooks can source it via `lib/source-session-env.sh`. The helper globs `*hook*.sh` in that dir, which also picks up the host's `sessionstart-hook-N.sh` files as a redundancy.

Values are quoted with `printf '%q'` to safely handle anything that might contain spaces, quotes, or newlines. Hooks that need these env vars call `source_session_env "$session_id"` at entry — the helper validates the session-id shape, then walks the per-session env dir.

**SubagentStart hook** (`subagent/start-tdd.sh`) self-sources the env dir to recover `VITEST_AGENT_MAIN_AGENT_ID`, then calls `vitest-agent agent register-agent` with `--parent-agent-id` set so the subagent gets its own row in `agents` with `parent_agent_id` linked to the main agent.

**SessionEnd hook** (`session/end-record.sh`) self-sources, then calls `vitest-agent agent end-agent --agent-id $VITEST_AGENT_MAIN_AGENT_ID --host-session-id $chat_id` to set `agents.ended_at` and `session_map.ended_at` together.

**SubagentStop end-agent integration** pairs stops to starts via a per-dispatch state file. `subagent/start-tdd.sh` writes `~/.claude/session-env/${chat_id}/active-subagents/<ts>-<pid>.json` (the file name is the synthetic-key tail with the `${chat_id}-subagent-` prefix stripped) holding `agentId`, `agentType`, `syntheticKey`, and `startedAt`. `subagent/stop-tdd.sh` pairs on `agent_type` (oldest-start-with-oldest-stop), reads the matched `agentId`, calls `vitest-agent agent end-agent --agent-id $agentId` — with no `--host-session-id`, so the subagent stop sets `agents.ended_at` but leaves the main agent's `session_map` row open — then removes the state file. `session/end-record.sh` removes the whole `active-subagents/` directory for the closing `chat_id` as janitorial cleanup against orphan files from crashed SubagentStop hooks. Pairing is deterministic for sequential same-type dispatches and approximate for concurrent same-type dispatches, but the total open-subagent count stays correct.

**PreToolUse Bash hook** (`pre-tool-use/bash.sh`) is a three-layer `inject-env` pipeline. Layer 0 is a bash regex prefilter that emits a no-op before any sidecar work when the command cannot invoke Vitest (~80–90% of Bash calls). Layer 1 self-sources the session env and skips the sidecar when the active agent is the main agent — the auto-sourced `VITEST_AGENT_*` env is already correct, so only subagent-triggered Bash needs the rewrite. Layer 2 reads `$VITEST_AGENT_SIDECAR_BIN` (an absolute path written once per session by `session/start.sh` via `vitest-agent agent sidecar-path`); when the var is non-empty and executable the binary is exec'd directly — no PATH lookup, no PM wrapper. When absent or non-executable it falls back to running `vitest-agent agent inject-env` through the detected package manager. The sidecar binary is not discoverable via `command -v` because pnpm/npm do not hoist transitive optional-dependency bins into `node_modules/.bin/`. The sidecar matches the command against the five Vitest invocation shapes (direct, runner, pm exec, pm script, node bin path); on match it returns the command prepended with `VITEST_AGENT_CONVERSATION_ID=<uuid> VITEST_AGENT_AGENT_ID=<uuid>` so the spawned Vitest process inherits attribution. Hook returns `hookSpecificOutput.updatedInput.command` per the PreToolUse contract. Payload parsing was consolidated to one `jq` call and one `dirname` lookup.

**TDD-restricted hook** (`pre-tool-use/tdd-restricted.sh`) reads `tool_input.action` and denies `delete` actions on the consolidated `tdd_goal` and `tdd_behavior` tools. Defense-in-depth on top of the `tdd-task` agent's frontmatter `tools:` list.

**Plugin allowlist** (`hooks/lib/safe-mcp-vitest-agent-ops.txt`) lists the consolidated tool names: `hypothesis`, `note`, `inventory`, `test`, `tdd_task`, `tdd_goal`, `tdd_behavior` plus `register_agent`. Removed: `get_current_session_id`, `set_current_session_id` (superseded by env-based recovery).

**Sidecar latency** — T9.2 shipped the fix for the slow `inject-env` shell-out. Phase 2 measured the inject-env sidecar process at p95 ≈ 505 ms, too slow for per-Bash-call use. The three-layer Bash hook plus the native `vitest-agent-sidecar` binary cut the hot path to p95 ≈ 16 ms (Layer 0/1 no-op), with the residual subagent-Vitest path at p95 ≈ 88 ms via the binary (~659 ms on the JS fallback when no platform binary is installed). Full profile at `.claude/notes/phase-3-sidecar-latency.md`; the pre-T9.2 baseline is at `.claude/notes/phase-2-sidecar-latency.md`.
