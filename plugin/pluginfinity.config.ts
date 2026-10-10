import type { PluginfinityConfigInput } from "pluginfinity";
import { defineConfig } from "pluginfinity";

type HookEntries = NonNullable<NonNullable<PluginfinityConfigInput["hooks"]>["PreToolUse"]>;

/**
 * This plugin's own MCP tools, in Claude Code's spelling. Claude Code names a
 * plugin server's tools `mcp__plugin_<plugin>_<server>__<tool>`; a user who
 * wires the server directly in settings.json gets `mcp__<server>__<tool>`.
 */
const MCP_TOOL = "mcp__(plugin_vitest-agent_mcp|vitest-agent_mcp)__";

/**
 * The PreToolUse entries scoped to this plugin's MCP tools. Their matchers are
 * written in Claude Code's terms. Copilot applies Claude matcher semantics to
 * Claude names for its native tools, but how it spells a plugin MCP tool in a
 * hook payload is unmeasured, so the Copilot build drops these matchers and
 * each script checks the tool name itself (va_mcp_op).
 */
const mcpPreToolUse = (withMatcher: boolean): HookEntries =>
	[
		{ matcher: `${MCP_TOOL}.*`, script: "hooks/pre-tool-use/mcp.sh", timeout: 5 },
		{ matcher: `${MCP_TOOL}run_tests`, script: "hooks/pre-tool-use/mcp-run-tests.sh", timeout: 5 },
		{
			matcher: `${MCP_TOOL}(tdd_goal|tdd_behavior|tdd_artifact_record)`,
			script: "hooks/pre-tool-use/tdd-restricted.sh",
			timeout: 5,
		},
	].map(({ matcher, ...entry }) => (withMatcher ? { matcher, ...entry } : entry));

const preToolUse = (withMcpMatchers: boolean): HookEntries => [
	...mcpPreToolUse(withMcpMatchers),
	{ script: "hooks/pre-tool-use/record.sh", timeout: 5 },
	{ matcher: "Bash|Edit|Write|MultiEdit", script: "hooks/pre-tool-use/bash-tdd.sh", timeout: 5 },
	{ matcher: "Read|Write|Edit|MultiEdit", script: "hooks/pre-tool-use/test-location.sh", timeout: 10 },
	{ matcher: "Bash", script: "hooks/pre-tool-use/bash.sh", timeout: 5 },
];

export default defineConfig({
	name: "vitest-agent",
	description:
		"Vitest test data, coverage analysis, TDD orchestration and notes for LLM coding agents, served by the vitest-agent MCP server and recorded by lifecycle hooks.",
	author: { name: "C. Spencer Beggs", url: "https://spencerbeg.gs" },
	homepage: "https://github.com/spencerbeggs/vitest-agent",
	repository: "https://github.com/spencerbeggs/vitest-agent.git",
	license: "MIT",
	keywords: ["vitest", "testing", "tdd", "coverage", "mcp"],
	env: {
		prefix: "VITEST_AGENT",
		vars: {
			VITEST_AGENT_CHAT_ID: {
				default: "",
				description: "The host session id; set by SessionStart once the main agent is registered",
			},
			VITEST_AGENT_CONVERSATION_ID: {
				default: "",
				description: "The canonical conversation UUID register-agent returns; set by SessionStart",
			},
			VITEST_AGENT_MAIN_AGENT_ID: {
				default: "",
				description: "The main agent's UUID register-agent returns; set by SessionStart",
			},
			VITEST_AGENT_AGENT_ID: {
				default: "",
				description:
					"The active agent's UUID; SessionStart sets it to the main agent, the Bash hook prefixes a subagent's own per command",
			},
			VITEST_AGENT_SIDECAR_BIN: {
				default: "",
				description: "Absolute path of the native inject-env sidecar, when one is installed; set by SessionStart",
			},
		},
	},
	hooks: {
		SessionStart: [{ script: "hooks/session/start.sh", timeout: 30 }],
		UserPromptSubmit: [{ script: "hooks/user-prompt-submit/record.sh", timeout: 5 }],
		PreToolUse: preToolUse(true),
		PostToolUse: [
			{ matcher: "Bash", script: "hooks/post-tool-use/test-run.sh", timeout: 10 },
			{ matcher: "Bash", script: "hooks/post-tool-use/git-commit.sh", timeout: 10 },
			{ script: "hooks/post-tool-use/record.sh", timeout: 10 },
			{ script: "hooks/post-tool-use/tdd-artifact.sh", timeout: 10 },
			{ script: "hooks/post-tool-use/test-quality.sh", timeout: 10 },
		],
		SessionEnd: [{ script: "hooks/session/end-record.sh", timeout: 10 }],
		Stop: [{ script: "hooks/stop/record.sh", timeout: 10 }],
		PreCompact: [{ script: "hooks/pre-compact/record.sh", timeout: 5 }],
		SubagentStart: [{ script: "hooks/subagent/start-tdd.sh", timeout: 10 }],
		SubagentStop: [{ script: "hooks/subagent/stop-tdd.sh", timeout: 10 }],
		// Claude Code only: Copilot has no elicitation events.
		Elicitation: [{ matcher: "*", script: "hooks/elicitation/session-id.sh", timeout: 5, fallback: "omit" }],
		ElicitationResult: [{ matcher: "*", script: "hooks/elicitation/result-record.sh", timeout: 5, fallback: "omit" }],
	},
	mcpServers: {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: pluginfinity placeholder
		mcp: { command: "sh", args: ["${PLUGIN_ROOT}/bin/start-mcp.sh", "--noop=1"] },
	},
	claude: true,
	copilot: {
		hooks: { PreToolUse: preToolUse(false) },
	},
});
