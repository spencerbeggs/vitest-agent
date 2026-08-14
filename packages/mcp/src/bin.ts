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
import { shouldExitOnUncaughtException } from "./utils/crash-guards.js";

/**
 * Whether `server.connect(transport)` has resolved for this process.
 * Read by the `uncaughtException` handler below via
 * {@link shouldExitOnUncaughtException} — see that function's doc
 * comment for the judgment call this flag backs (issue #191).
 */
let transportConnected = false;

/**
 * Issue #191, sub-item A: the MCP server used to be a bare
 * `main().catch(...)` with no process-level guards. Under Node >=15 an
 * unhandled promise rejection anywhere in the async chain — a
 * fire-and-forgotten Effect fiber, a background timer, anything that
 * never flows through a tool call's own await chain — crashes the
 * process by default, closing the stdio transport and silently
 * deregistering every tool from the client's perspective mid session,
 * with no recovery path. Register both guards at module scope, before
 * any async work in `main()` starts, so they also cover the dbPath
 * resolution / ManagedRuntime construction phase.
 *
 * Every throw or rejection *inside* a single tool call is already
 * caught by the MCP SDK's own `CallToolRequestSchema` handler (see
 * `server.ts`'s `registerTool` shadow for the structured-envelope
 * layer on top of that). Anything that reaches these handlers
 * therefore originated outside any tool-call boundary and, by
 * definition, has no in-flight caller waiting on it — logging and
 * continuing is safe because there is no request context to roll back
 * and no benefit to dropping every *other* in-flight and future tool
 * call over it.
 */
process.on("unhandledRejection", (reason) => {
	process.stderr.write(`vitest-agent-mcp: unhandledRejection: ${formatFatalError(reason)}\n`);
});

/**
 * Node's own guidance for `uncaughtException` is "do not resume normal
 * operation" — arbitrary in-process state may be corrupt. This process
 * accepts that residual risk once the transport is connected: see
 * `shouldExitOnUncaughtException`'s doc comment for the reasoning
 * (no long-lived mutable state outside SQLite's own transactions, and
 * silent process death mid-session is strictly worse). Before the
 * transport connects there is no client session to preserve by staying
 * alive, so this exits loudly instead.
 */
process.on("uncaughtException", (err, origin) => {
	process.stderr.write(`vitest-agent-mcp: uncaughtException (${origin}): ${formatFatalError(err)}\n`);
	if (shouldExitOnUncaughtException(transportConnected)) {
		process.exitCode = 1;
		process.exit(1);
	}
});

/**
 * Test-only crash injection, gated by an env var so it can never fire
 * in a normal install. Exists so `__test__/bin-crash-resilience.e2e.test.ts`
 * can exercise the guards above against a *real* child process (a
 * crash in the test's own process is not something a unit test can
 * safely simulate). Fires exactly once, on the next event-loop turn
 * after the transport is known to be connected, so ordering relative
 * to `transportConnected` is deterministic regardless of client-side
 * handshake timing.
 */
function scheduleTestCrashInjection(): void {
	const kind = process.env.VITEST_AGENT_MCP_TEST_INJECT_CRASH;
	if (kind !== "unhandledRejection" && kind !== "uncaughtException") return;
	setImmediate(() => {
		if (kind === "unhandledRejection") {
			// Deliberately not awaited/caught — this is the exact shape of
			// failure issue #191 describes: a rejection with no handler
			// anywhere in its chain.
			Promise.reject(new Error("[test-injected] unhandledRejection"));
		} else {
			throw new Error("[test-injected] uncaughtException");
		}
	});
}

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
	transportConnected = true;
	scheduleTestCrashInjection();
}

main().catch((err) => {
	process.stderr.write(`vitest-agent-mcp: ${formatFatalError(err)}\n`);
	process.exit(1);
});
