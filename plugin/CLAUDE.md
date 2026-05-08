# Claude Code Plugin — `plugin/`

This directory is a **file-based Claude Code plugin**. It is **not** a pnpm workspace and is **not** published to npm. It ships separately alongside the five npm packages and is distributed through the Claude marketplace.

## Identity and distribution

- **Marketplace org/bot:** `spencerbeggs` (bot name not in the enabledPlugins key)
- **Plugin name:** `vitest-agent`
- **Installed as:** `"enabledPlugins": { "vitest-agent@spencerbeggs": true }` in `.claude/settings.json`
- **Versioned independently** from the npm packages — the `version` field in `plugin/.claude-plugin/plugin.json` tracks plugin-specific releases
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
│   ├── hooks.json       # Hook registrations (matchers, event bindings)
│   ├── fixtures/        # Synthetic JSON payloads for manual hook invocation (README inside)
│   ├── lib/             # Shared helpers: detect-pm.sh, hook-debug.sh, hook-output.sh,
│   │                    #   match-tdd-agent.sh, safe-mcp-vitest-agent-ops.txt (PreToolUse allowlist)
│   └── *.sh             # Hook scripts (see Hooks below)
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

Hook scripts in `hooks/` are POSIX shell. All source shared helpers from `hooks/lib/`. Key scripts:

| Script | Trigger | Behavior |
| --- | --- | --- |
| `session-start.sh` | `SessionStart` | Injects test status + MCP tool reference into session context |
| `pre-tool-use-mcp.sh` | `PreToolUse` (MCP tools) | Auto-allows non-destructive MCP tools without per-call prompts |
| `pre-tool-use-tdd-restricted.sh` | `PreToolUse` (tdd-task subagent) | Blocks `tdd_goal_delete`, `tdd_behavior_delete`, `tdd_artifact_record` inside the orchestrator subagent |
| `pre-tool-use-bash-tdd.sh` | `PreToolUse` (Bash, tdd-task subagent) | Blocks `--update`, `--reporter=silent`, `--bail`, `--testNamePattern`; injects reminder to use `run_tests` MCP |
| `post-tool-use-tdd-artifact.sh` | `PostToolUse` (Write/Edit/run_tests, tdd-task) | Records `test_written`, `test_failed_run`, `test_passed_run`, `code_written` artifacts into `tdd_artifacts` |
| `post-tool-use-test-quality.sh` | `PostToolUse` (Write/Edit, tdd-task) | Detects test-weakening edits (`it.skip`, `.todo`, snapshot mutations); records `test_weakened` artifact |
| `subagent-start-tdd.sh` | `SubagentStart` | Creates a synthetic subagent session row in `sessions` (key: `${cc_session_id}-subagent-<ts>-<pid>`) |
| `subagent-stop-tdd.sh` | `SubagentStop` | Runs `vitest-agent wrapup --kind tdd_handoff` and records the handoff note on the parent session |
| `session-end-record.sh` | `SessionEnd` | Records a `hook_fire` turn (so `computeAcceptanceMetrics` counts SessionEnd events), records the session-end timestamp, then emits the session-end wrap-up prompt |
| `post-tool-use-record.sh` | `PostToolUse` (all) | Records tool-call turns for session analytics |
| `user-prompt-submit-record.sh` | `UserPromptSubmit` | Records user prompt turns |

The allowlist for `pre-tool-use-mcp.sh` lives at `hooks/lib/safe-mcp-vitest-agent-ops.txt`. Add new non-destructive MCP tools here when they are deployed. Omit delete tools — those require explicit user confirmation from the main agent.

`match-tdd-agent.sh` (`hooks/lib/`) provides `is_tdd_agent()` which matches `"vitest-agent:tdd-task"` — the only form CC sends in hook payloads. The legacy `plugin:vitest-agent:tdd-task` and bare `tdd-task` forms were removed after being confirmed never observed in practice.

`hook-debug.sh` (`hooks/lib/`) provides two logging functions sourced by every hook: `hook_error` always writes to `/tmp/vitest-agent-hook-errors.log` (overrideable via `VITEST_AGENT_HOOK_ERROR_LOG`); `hook_debug` writes to `/tmp/vitest-agent-hook-debug.log` only when `VITEST_AGENT_HOOK_DEBUG=1` is set. Recording and artifact hooks use a capture-and-log pattern for CLI failures — `|| true` is no longer used to suppress errors silently.

## Agents

| Agent file | Invocation name | Description |
| --- | --- | --- |
| `agents/tdd-task.md` | `vitest-agent:tdd-task` | TDD orchestrator with `context:fork`. Drives red-green-refactor cycles with evidence-based phase transitions, three-tier goal/behavior hierarchy, mandatory MCP gates, and channel event push. Cannot write production code without a failing test first. |

`context: fork` gives the agent a clean conversation context — it does not inherit the dispatching agent's history. Task prompts must be self-contained. This is correct for dogfood dispatches (prevents cheatsheet leakage) and for production use (the agent should reason from its prompt, not accumulated conversation state).

## Skills

Skills are loaded into the dispatching agent's context when invoked via the `Skill` tool or the `skills:` frontmatter. All 14 sub-skill primitives below are preloaded into `tdd-task` on launch; they are also available standalone.

| Skill | Purpose |
| --- | --- |
| `tdd` | Main TDD workflow: session lifecycle, phase transitions, goal/behavior hierarchy, channel events |
| `debugging` | Systematic failure diagnosis using `test_history`, `test_errors`, `test_for_file` |
| `coverage-improvement` | Systematic coverage improvement using `file_coverage`, `test_trends` |
| `configuration` | `AgentPlugin` setup and option reference |
| `interpret-test-failure` | Primitive: parse failure output, classify failure kind |
| `derive-test-name-from-behavior` | Primitive: name a test from a behavior description |
| `derive-test-shape-from-name` | Primitive: choose `it`, `describe/it`, parametric, etc. from test name |
| `verify-test-quality` | Primitive: check written test for escape hatches and weak assertions |
| `run-and-classify` | Primitive: run tests via MCP, classify result, record artifact |
| `record-hypothesis-before-fix` | Primitive: Gate 2 — record hypothesis before any non-test file edit |
| `commit-cycle` | Primitive: commit at green and refactor phase exit |
| `revert-on-extended-red` | Primitive: revert if stuck in red for >5 turns or >3 failed runs |
| `decompose-goal-into-behaviors` | Primitive: break a goal into atomic red-green-refactor behaviors |
| `vitest-context` | Vitest-specific test context helpers |

## Commands

| Command | File | Description |
| --- | --- | --- |
| `/setup` | `commands/setup.md` | Add `AgentPlugin` to the current project's `vitest.config.ts` |
| `/configure` | `commands/configure.md` | View or modify reporter settings |
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
  Load when you need an overview of how the plugin fits with the five npm
  packages and the MCP server.
- `@./.claude/design/vitest-agent/decisions.md`
  Load when you need the rationale behind hook design, evidence binding,
  or the loader strategy.
