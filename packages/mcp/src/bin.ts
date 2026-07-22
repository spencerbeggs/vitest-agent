#!/usr/bin/env node
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
	PathResolutionLive,
	formatFatalError,
	resolveDataPath,
	resolveLogFile,
	resolveLogLevel,
} from "@vitest-agent/sdk";
import { Effect, ManagedRuntime } from "effect";
import type { McpContext } from "./context.js";
import { createCurrentSessionIdRef, createSessionContextRef, sessionContextFromEnv } from "./context.js";
import { McpLive } from "./layers/McpLive.js";
import { startMcpServer } from "./server.js";
import { recoverSessionContextFromSessionEnv } from "./session-env.js";

/**
 * Resolve the user's project directory.
 *
 * Precedence (most explicit wins):
 *
 * 1. `VITEST_AGENT_REPORTER_PROJECT_DIR` — set by the Claude Code plugin
 *    loader (`plugin/bin/mcp-server.mjs`) to the resolved project root.
 *    The loader controls this end-to-end so the value is reliable when
 *    set.
 * 2. `CLAUDE_PROJECT_DIR` — exported by Claude Code for hook scripts and
 *    (per docs hints) MCP server subprocesses. Used when the loader is
 *    bypassed (e.g. someone wires the MCP binary up manually).
 * 3. `process.cwd()` — fall-through for direct invocation outside Claude
 *    Code, where the user is presumably running from their project root.
 */
function resolveProjectDir(): string {
	return process.env.VITEST_AGENT_REPORTER_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
}

/**
 * Optional first positional argument: an initial Claude Code chat UUID
 * (the host's `chatId`) to seed the MCP server's session association.
 *
 * The plugin manifest (`plugin/.claude-plugin/plugin.json`) can pass this
 * via Claude Code variable substitution if such a variable exists for
 * sessions (the documented substitutions are `${CLAUDE_PLUGIN_ROOT}` and
 * `${CLAUDE_PLUGIN_DATA}`; testing whether `${CLAUDE_SESSION_ID}` or a
 * similar name is honored in `mcpServers.args` is part of the reason
 * this seed path exists). When the seed is empty the agent is expected
 * to recover the chat id at boot. The legacy `set_current_session_id`
 * MCP tool was removed in Phase 3.
 */
function resolveInitialSessionId(): string | null {
	const argv = process.argv[2];
	if (argv === undefined) return null;
	const trimmed = argv.trim();
	if (trimmed.length === 0) return null;
	// Claude Code substitutes unknown ${...} variables to literal text in
	// some surfaces (e.g. ${UNKNOWN_VAR} -> "${UNKNOWN_VAR}"); guard against
	// a literal substitution arriving here so we don't seed garbage.
	if (trimmed.startsWith("${") && trimmed.endsWith("}")) return null;
	return trimmed;
}

async function main() {
	const projectDir = resolveProjectDir();
	const initialSessionId = resolveInitialSessionId();

	const dbPath = await Effect.runPromise(
		resolveDataPath(projectDir).pipe(
			Effect.provide(PathResolutionLive(projectDir)),
			Effect.provide(NodeServices.layer),
		),
	);

	const logLevel = resolveLogLevel();
	const logFile = resolveLogFile();

	const runtime = ManagedRuntime.make(McpLive(dbPath, logLevel, logFile));

	// Recover the canonical agent attribution context. SessionStart wrote
	// VITEST_AGENT_CHAT_ID, _CONVERSATION_ID, and _MAIN_AGENT_ID to
	// CLAUDE_ENV_FILE, which Claude Code auto-sources into this MCP child's
	// process.env (per Spike 5). Falls back to null in dev / test where
	// the env vars aren't set; tools handle that gracefully.
	const recoveredContext = sessionContextFromEnv(process.env);

	const ctx: McpContext = {
		runtime: runtime as unknown as McpContext["runtime"],
		cwd: projectDir,
		currentSessionId: createCurrentSessionIdRef(initialSessionId ?? recoveredContext?.chatId ?? null),
		// Boot-time env recovery races the SessionStart hook (fresh launch)
		// and is empty entirely after /reload-plugins. The lazy recover
		// thunk re-reads the hook's session-env surface at the first tool
		// call that needs context, when the file is reliably on disk.
		sessionContext: createSessionContextRef(recoveredContext, () =>
			recoverSessionContextFromSessionEnv({ projectDir }),
		),
	};

	// Diagnostic logs report presence only; the full UUIDs are
	// attribution metadata sourced from CLAUDE_ENV_FILE and should not
	// be echoed to stderr verbatim (CodeQL js/clear-text-logging).
	const chatIdResolved = initialSessionId ?? recoveredContext?.chatId ?? null;
	console.error("[vitest-agent-mcp] Starting...");
	console.error(`[vitest-agent-mcp] Project: ${projectDir}`);
	console.error(`[vitest-agent-mcp] Database: ${dbPath}`);
	console.error(
		`[vitest-agent-mcp] Initial chat id: ${chatIdResolved !== null ? "(set)" : "(none — SessionStart hook had not written CLAUDE_ENV_FILE yet)"}`,
	);
	if (recoveredContext !== null) {
		console.error("[vitest-agent-mcp] Recovered session context: agent=(set) conversation=(set)");
	}

	await startMcpServer(ctx);
}

main().catch((err) => {
	process.stderr.write(`vitest-agent-mcp: ${formatFatalError(err)}\n`);
	process.exit(1);
});
