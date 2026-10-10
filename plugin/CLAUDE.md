# CLAUDE.md — `plugin/`

This directory is the **vitest-agent agent plugin**, written once and built by [pluginfinity](https://github.com/spencerbeggs/pluginfinity) into a Claude Code plugin and a GitHub Copilot plugin. It is the primary AI integration surface for the whole vitest-agent system: the npm packages collect and store data; the plugin turns that data into agent behavior.

It IS a pnpm workspace member (`pnpm-workspace.yaml` lists `plugin`) but is **not** published to npm. Load the `pluginfinity`, `hook-authoring`, `plugin-scripts` and `hook-events` skills before touching anything here.

## Identity and distribution

- **Plugin name:** `vitest-agent` on both hosts. Claude Code installs it as `vitest-agent@spencerbeggs` (`.claude/settings.json` `enabledPlugins`); the marketplace lives in the separate `spencerbeggs/bot` repository and must point at `plugin/builds/claude` (and, for Copilot, `plugin/builds/copilot`).
- **Tracking package:** `@vitest-agent/ai-plugins` (`package.json`, `"private": true`, no `publishConfig`). It exists so changesets can version and tag the plugin: `.changeset/config.json` keeps it in `privatePackages: { tag: true, version: true }` and maps its `versionFiles` to both built manifests (`builds/claude/.claude-plugin/plugin.json` and `builds/copilot/plugin.json`, `$.version`). CI bumps `package.json` and both manifests together, then cuts a git tag and GitHub Release with no npm publish. **Write plugin changesets against `@vitest-agent/ai-plugins`**; naming `@vitest-agent/plugin` (the Vitest plugin in `packages/plugin/`) forces a pointless npm publish.
- **Layering:** `layers.json` lists the package under `tooling`.

## Layout

```text
plugin/
├── package.json               # @vitest-agent/ai-plugins (private, GitHub-release tracking only)
├── pluginfinity.config.ts     # name, metadata, session env, every hook entry, the MCP server, per-host overrides
├── tsconfig.json / turbo.json # types:check for the config; build:dev/build:prod run `pluginfinity build`
├── agents/tdd-task.md         # the TDD orchestrator subagent
├── skills/<name>/SKILL.md     # 17 skills (setup and configure were slash commands before pluginfinity)
├── hooks/                     # one script per hook, grouped by event; ships whole to both hosts
│   └── lib/vitest-agent/      # the plugin's own helpers: common.sh, safe-mcp-ops.txt (MCP auto-allow list)
├── bin/start-mcp.sh           # MCP launcher (POSIX sh, on pluginfinity's server library)
├── __test__/                  # bats suites, run against builds/ on both targets; fixtures/
└── builds/                    # GENERATED and committed — never edit
    ├── claude/                #   Claude Code plugin (.claude-plugin/plugin.json, hooks/hooks.json, ...)
    └── copilot/               #   Copilot plugin (plugin.json, mcp.json, com.github.copilot/{agents,hooks}/)
```

`hooks/lib/pluginfinity/` and `lib/pluginfinity/` exist only in `builds/`: pluginfinity writes the hook, server, log and session-env libraries there. Never vendor them into the source.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm --filter @vitest-agent/ai-plugins build:dev` | `pluginfinity build` — regenerate `builds/` (also part of `pnpm run build`) |
| `pnpm --filter @vitest-agent/ai-plugins build:check` | `pluginfinity build --check` — fail when `builds/` is stale |
| `pnpm --filter @vitest-agent/ai-plugins validate` | `pluginfinity validate` — each host's own manifest check |
| `pnpm --filter @vitest-agent/ai-plugins test:bats` | `bats --recursive __test__` (also `pnpm test:bats` at the root) |
| `pnpm claude` / `pnpm copilot` | Run a host with the local build loaded (`--plugin-dir plugin/builds/<host>`) |
| `pnpm exec pluginfinity logs [--debug]` | Read the hook/server/script logs (`error.log`, `debug.log`) |

Rebuild after every source change and commit `builds/` with it. `builds/**` is excluded from Biome and markdownlint so no formatter rewrites it. Logs live in `${XDG_STATE_HOME:-~/.local/state}/pluginfinity/vitest-agent/`; `PLUGINFINITY_DEBUG=1` is the one debug switch (it replaced `VITEST_AGENT_HOOK_DEBUG` and the `/tmp/vitest-agent-hook-*.log` files).

## MCP loader

Both hosts start `sh ${PLUGIN_ROOT}/bin/start-mcp.sh --noop=1`. The launcher sources pluginfinity's `server.sh` and:

1. Resolves the project with `server_project_dir` — `CLAUDE_PROJECT_DIR` on Claude Code — and exports `VITEST_AGENT_REPORTER_PROJECT_DIR` so the server keys the right `data.db`. A Copilot MCP server starts in the plugin root and cannot learn the project at all (measured by pluginfinity on Copilot CLI 1.0.92); the launcher logs that and falls back to its working directory.
2. Execs `<project>/node_modules/.bin/vitest-agent-mcp` when it is executable — the bin the `@vitest-agent/plugin` carrier links into every consumer (issue #412). Arguments pass through verbatim.
3. Otherwise prints a not-installed block with the package-manager-specific install line on **stderr** (`packageManager` field via grep/sed, no `jq`; then `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `yarn.lock`; default npm) and `exec npx --yes @vitest-agent/mcp@5 "$@"` — pinned to the major the hooks were written for (Decision 30). It deliberately does not use the library's `server_exec_bin`, which would dispatch through the detected package manager.

Nothing but the server may write to stdout. Bumping `--noop=N` in `pluginfinity.config.ts` (then rebuilding) is how to make `/reload-plugins` restart the server after `pnpm ci:build`; revert it before committing.

## Hooks

Every hook is a `script` entry in `pluginfinity.config.ts`, written in Claude Code's event names and matchers; pluginfinity writes `hooks/hooks.json` for Claude Code and `com.github.copilot/hooks/hooks.json` for Copilot. Each script starts:

```bash
set -euo pipefail
. "$(dirname "$0")/../lib/pluginfinity/hook.sh"        # generated library: input, response, logging, session env
. "$(dirname "$0")/../lib/vitest-agent/common.sh"      # this plugin's helpers
hook_require_input
```

Rules that bite here:

- **Read input only with `hook_input`** (it also reads Copilot's camelCase payloads and tool_input key aliases). **Answer once** with `hook_noop`, `hook_context`, `hook_deny`, `hook_allow "" '<json>'`, `hook_system_message`, `hook_raw`. Never `exit 2`, never your own `trap … EXIT`.
- **No stdout fence any more.** The library writes the response to stdout, so every CLI call must capture (`$(...)`) or redirect (`>/dev/null 2>&1`) its output. `__test__/hook-output.bats` runs every hook against a CLI that spams stdout and fails if anything leaks (issue #373).
- **Never fold stderr into a jq-parsed capture** (`2>&1`): pnpm's config WARN on stderr corrupts the JSON (`__test__/sidecar-env-warn.bats`).
- **Branch on `hook_supports`, never on the host.** Copilot has no PreToolUse context, no UserPromptSubmit output and no system messages; scripts skip work whose result neither host can show.
- **CLI resolution** is `va_cli` (`common.sh`): `VITEST_AGENT_CLI_CMD` → `<dir>/node_modules/.bin/vitest-agent` (printed RELATIVE; call sites `cd` first and expand it unquoted) → `vitest-agent` on `PATH` → fail, and every call site falls back to `hook_noop`. Hooks never dispatch through a package manager and never `npx`.
- `common.sh` also anchors `VITEST_AGENT_PROJECT_DIR` to `hook_session_dir` (an explicit value wins; it is deliberately not a session-env name) and unsets every empty session-env name, so the CLI and sidecar see "unset" rather than "". `va_mcp_op` strips this plugin's MCP prefix on either host (`mcp__plugin_vitest-agent_mcp__`, `mcp-`, or the settings.json `mcp__vitest-agent_mcp__`). `va_state_dir` is the plugin data dir.

### Session env

`pluginfinity.config.ts` declares `VITEST_AGENT_CHAT_ID`, `_CONVERSATION_ID`, `_MAIN_AGENT_ID`, `_AGENT_ID` and `_SIDECAR_BIN` (all default `""`). `session/start.sh` sets them with `hook_env_set` after `register-agent` (and `agent sidecar-path`); every later hook reads them as plain variables, and on Claude Code the model's Bash tool sees them too (pluginfinity appends them to `CLAUDE_ENV_FILE`). This replaced the hand-written `~/.claude/session-env/<id>/vitest-agent-hook.sh` + `source_session_env` bridge for hooks.

**One hand-written file stays:** `start.sh` still writes `~/.claude/session-env/<chat_id>/vitest-agent-hook.sh`, because the published MCP server reads it (`recoverSessionContextFromSessionEnv` in `@vitest-agent/engine`) to recover attribution after a boot race or `/reload-plugins`. It is an interface of the server, written only where `hook_supports server-project` (Claude Code). Retire it once the engine reads pluginfinity's session values.

`VITEST_AGENT_TDD_TASK_ID` (issue #144 escape hatch), `VITEST_AGENT_CLI_CMD` and `VITEST_AGENT_TEST_LOCATION_HOOK` stay ambient-only overrides.

### Hook table

| Script | Event (matcher) | Behavior |
| --- | --- | --- |
| `session/start.sh` | `SessionStart` (all sources, 30 s) | Triage brief + imperative preamble as context; `record session-start`; `register-agent` (needs a transcript path, which only Claude Code sends); session-env ids and sidecar path; MCP recovery file |
| `user-prompt-submit/record.sh` | `UserPromptSubmit` | Records the prompt turn; on Claude Code adds the failure-related nudge (`wrapup --kind user_prompt_nudge`) |
| `pre-tool-use/mcp.sh` | `PreToolUse` (this plugin's MCP tools) | Auto-allows tools in `lib/vitest-agent/safe-mcp-ops.txt`, except `action: "delete"`, which falls through to the permission prompt (issue #526) |
| `pre-tool-use/mcp-run-tests.sh` | `PreToolUse` (`run_tests`) | Allows with `_sessionContext` added from the session env, so the in-process reporter attributes the run |
| `pre-tool-use/tdd-restricted.sh` | `PreToolUse` (`tdd_goal`/`tdd_behavior`/`tdd_artifact_record`) | Inside `vitest-agent:tdd-task`: denies goal/behavior deletes and direct artifact records |
| `pre-tool-use/record.sh` | `PreToolUse` (all) | Records the tool_call turn |
| `pre-tool-use/bash-tdd.sh` | `PreToolUse` (`Bash\|Edit\|Write\|MultiEdit`) | Inside tdd-task: denies `--update`, `-u`, `--reporter=silent`, `--bail`, `-t`, `--testNamePattern`, `.snap` (boundary-anchored, issue #247) and signal-suppressing config edits; nudges toward `run_tests` (context, Claude Code only) |
| `pre-tool-use/test-location.sh` | `PreToolUse` (`Read\|Write\|Edit\|MultiEdit`) | Lexical prefilter, then `agent check-test-path`; denies creating a test at an invalid location, advises otherwise (Claude Code only); fails open; `VITEST_AGENT_TEST_LOCATION_HOOK=off\|0\|false` disables it |
| `pre-tool-use/bash.sh` | `PreToolUse` (`Bash`) | `inject-env` pipeline: Layer 0 regex prefilter, Layer 1 main-agent skip, Layer 2 sidecar (`VITEST_AGENT_SIDECAR_BIN`) or JS CLI; on a rewrite, allows with the whole tool input carried over and `command` replaced |
| `post-tool-use/test-run.sh` | `PostToolUse` (`Bash`) | Records run-trigger and test-case turns for vitest runs; failure guidance as context |
| `post-tool-use/git-commit.sh` | `PostToolUse` (`Bash`) | Records commit metadata (`record run-workspace-changes`) |
| `post-tool-use/record.sh` | `PostToolUse` (all) | Records tool_result and file_edit turns |
| `post-tool-use/tdd-artifact.sh` | `PostToolUse` (all; tdd-task only) | Records `test_written` / `code_written` / `test_passed_run` / `test_failed_run` (Bash vitest/jest/bats with `--suite bats`, issue #360/#363; `run_tests` by header or `report.reason`); forwards `VITEST_AGENT_TDD_TASK_ID` |
| `post-tool-use/test-quality.sh` | `PostToolUse` (all; tdd-task only) | Records `test_weakened` on `it.skip`/`.todo`/`.fails`/`.skipIf`/… in test files |
| `stop/record.sh` | `Stop` | Records the firing; on Claude Code shows the stop wrap-up as a system message |
| `pre-compact/record.sh` | `PreCompact` | Records the firing (neither host shows PreCompact output) |
| `subagent/start-tdd.sh` | `SubagentStart` (tdd-task only) | Parent bootstrap + synthetic subagent session row; `register-agent --parent-agent-id`; per-dispatch state file at `<data>/active-subagents/<chat_id>/<ts>-<pid>.json` |
| `subagent/stop-tdd.sh` | `SubagentStop` (tdd-task only) | Pairs oldest state file by agent type → `end-agent` (no `--host-session-id`); records the `tdd_handoff` wrap-up on the parent session |
| `session/end-record.sh` | `SessionEnd` | Fast shim over `end-record-worker.sh`: on true exits detaches it (`nohup … &`, every fd redirected) so the host's teardown abort cannot cancel persistence; on `clear`/`resume` runs it synchronously. The worker records the turn and session end, `end-agent` for the main agent, and removes the session's active-subagents state |
| `elicitation/session-id.sh`, `elicitation/result-record.sh` | `Elicitation`, `ElicitationResult` | Claude Code only (`fallback: "omit"`): answers the server's session-id elicitation |

On Copilot the three MCP-scoped PreToolUse entries carry no matcher (how Copilot spells a plugin MCP tool in a hook payload is unmeasured); the scripts filter with `va_mcp_op`. Copilot applies Claude matcher semantics to Claude tool names for its native tools, so the other matchers stay.

## Agent and skills

`agents/tdd-task.md` (`vitest-agent:tdd-task`) drives red-green-refactor with evidence-bound phase transitions. It preloads the `tdd` skill and nine primitives (`skills:`); Copilot gets them appended as a list. `model: sonnet` is Claude Code only (`targets.copilot.model: inherit`); Copilot drops `color` and the Claude-only tools (`LSP`, `ReportFindings`, `SendMessage`, the Task tools, `TodoWrite`, `ToolSearch`). `context: fork` was dropped in the migration: it is a skill field, not an agent field, and a subagent always starts with a fresh context. Dispatch it as an unnamed background subagent (a named teammate splits the task from its artifacts).

Seventeen skills: `tdd` (also the `/vitest-agent:tdd <goal>` entry point that replaced the `/tdd` command), the nine preloaded primitives, `test-discovery` (path-triggered), `configuration`, `debugging`, `coverage-improvement`, `operating-vitest-agent`, and the user-invoked `setup` and `configure` (formerly commands; `disable-model-invocation: true`). Name tools, skills and agents in bodies with pluginfinity tokens (`{{skill configure}}`) where the spelling differs per host.

## Hot-reload cost matrix

| What changed | Action required |
| --- | --- |
| Hook script, skill or agent markdown | `pluginfinity build`; then nothing (next invocation) |
| `safe-mcp-ops.txt` | `pluginfinity build`; next tool call |
| `pluginfinity.config.ts` hooks | `pluginfinity build` + `/reload-plugins` |
| MCP server args (`--noop`) | `pluginfinity build` + `/reload-plugins` restarts the server |
| MCP server, engine or SDK source | `pnpm ci:build` + `/reload-plugins` |
| Database schema / migration | `pnpm ci:build` + delete `data.db` (and `-wal`/`-shm`) + `/reload-plugins` |
| Manifest metadata, new servers | Full host restart |

## Dogfood

The plugin is verified by dispatching the tdd-task agent against `playground/` (intentional defects; `playground/src/lifecycle.ts` keeps `return a + b + 1`). Guide: `.claude/skills/dogfood/SKILL.md`. `pnpm claude` loads `plugin/builds/claude`.

## Design docs

- [`../okf/modules/claude-code-plugin.md`](../okf/modules/claude-code-plugin.md) — the plugin Module concept (still describes the pre-pluginfinity layout until the okf pass lands).
- [`../okf/decisions/d16-sidecar-cli-over-mcp-tool-hooks.md`](../okf/decisions/d16-sidecar-cli-over-mcp-tool-hooks.md), [`../okf/decisions/d17-claude-env-file-auto-source-and-hook-self-source-bridge.md`](../okf/decisions/d17-claude-env-file-auto-source-and-hook-self-source-bridge.md), [`../okf/decisions/d21-conversation-tree-fallback-and-task-id-escape-hatch.md`](../okf/decisions/d21-conversation-tree-fallback-and-task-id-escape-hatch.md), [`../okf/decisions/30-plugin-mcp-loader-execs-the-consumer-s-node-modules-bin.md`](../okf/decisions/30-plugin-mcp-loader-execs-the-consumer-s-node-modules-bin.md) — the rationale behind hook design, evidence binding and the loader.
