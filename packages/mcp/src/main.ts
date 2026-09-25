/**
 * The assembled vitest-agent MCP server program over stdio. Owns the process.
 *
 * This module deliberately carries NO static imports of the server graph:
 * `McpGuard` (`@effected/mcp/guard`, itself free of static runtime imports)
 * registers the `unhandledRejection` and `uncaughtException` guards before
 * `load` imports `effect`, `NodeRuntime`, the engine platform and
 * `ServerLayer`, so a throw during module evaluation is still reported on
 * stderr rather than crashing silently. Adding a static import here would
 * defeat that; an `import type` is erased at build time and is fine. `bin.ts` is
 * the published bin shim; this module is also published as the `./main`
 * subpath so the carrier (`@vitest-agent/plugin`) can ship its own
 * `vitest-agent-mcp` bin over it, passing its identity as `distribution`.
 *
 * Every `process` read lives here, not in the server layer or the tools.
 *
 * @packageDocumentation
 */

import type { Distribution } from "@effected/engine";
import { McpGuard } from "@effected/mcp/guard";

/**
 * Options for {@link main}.
 *
 * @public
 */
export interface MainOptions {
	/**
	 * The package whose bin launched the server — the carrier
	 * (`@vitest-agent/plugin`) passes its own name and version. Omitted for a
	 * direct `@vitest-agent/mcp` install. Surfaced as `ping`'s `distribution`.
	 */
	readonly distribution?: Distribution | undefined;
}

/**
 * Optional first positional argument: an initial Claude Code chat UUID (the
 * host's `chatId`) to seed the MCP server's session association. Claude Code
 * passes unknown `${...}` variables through as literal text in some surfaces,
 * so an unsubstituted placeholder is treated as absent rather than seeding
 * garbage.
 *
 * @param argv - the raw `process.argv`
 * @param isUnsubstituted - `LaunchContext.isUnsubstituted`, passed in because
 *   this module may not statically import the server graph
 * @returns the trimmed seed, or `null` when absent, empty, or a placeholder
 */
const resolveInitialSessionId = (
	argv: ReadonlyArray<string>,
	isUnsubstituted: (value: string) => boolean,
): string | null => {
	const trimmed = argv[2]?.trim();
	if (trimmed === undefined || trimmed.length === 0 || isUnsubstituted(trimmed)) return null;
	return trimmed;
};

/**
 * Run the vitest-agent MCP server over stdio. Owns the process: registers
 * the crash guards through `McpGuard.run`, resolves the project directory and `data.db` path,
 * recovers the host session context, and launches the server layer under
 * `NodeRuntime.runMain` with `McpStdio.launch` / `McpStdio.teardown`.
 *
 * Not re-exported from `index.ts` — a library consumer's import graph must
 * not pull in the process-owning module.
 *
 * @param options - the launching distribution, when a carrier shipped the bin
 * @public
 */
export const main = (options: MainOptions = {}): Promise<void> =>
	// Issue #191. `McpGuard` registers the `uncaughtException` /
	// `unhandledRejection` guards before `load` evaluates the server graph.
	// Every throw inside a tool call is already caught by core (a scrubbed
	// `isError` result, cause logged on stderr), so anything reaching a guard
	// has no in-flight caller: a rejection is logged and the server keeps
	// serving; an uncaught exception exits 1 until the server is serving,
	// then is logged too (a process that dies mid-session deregisters every
	// tool). A `load` rejection — a dynamic import failing, `resolveDataPath`
	// failing — is `startup failed` and exit 1 whatever the policy.
	McpGuard.run({
		label: "vitest-agent-mcp",
		host: process,
		policy: { onUncaught: "exitBeforeConnect", onRejection: "log" },
		// Test-only: `bin-crash-resilience.e2e.test.ts` sets it to
		// `uncaughtException` / `unhandledRejection` to raise one right after
		// the server is serving. Never set in a normal install.
		injectCrashAfterConnect: process.env.VITEST_AGENT_MCP_TEST_INJECT_CRASH,
		load: async () => {
			// No static imports of the server graph above this line.
			const { safeFormatFatalError } = await import("./utils/safe-format-fatal-error.js");
			const NodeRuntime = await import("@effect/platform-node/NodeRuntime");
			const NodeServices = await import("@effect/platform-node/NodeServices");
			const NodeStdio = await import("@effect/platform-node/NodeStdio");
			const { Effect, Layer, Option } = await import("effect");
			const { CurrentDistribution, LaunchContext } = await import("@effected/engine");
			const {
				PathResolutionLive,
				PlatformLive,
				recoverSessionContextFromSessionEnv,
				resolveDataPath,
				resolveLogFile,
				resolveLogLevel,
				resolveProjectDir,
			} = await import("@vitest-agent/engine");
			const { McpSession, sessionContextFromEnv } = await import("./session.js");
			const { ServerLayer } = await import("./server.js");
			const { CURRENT_MCP_VERSION } = await import("./version.js");

			const env = process.env;
			// `VITEST_AGENT_PROJECT_DIR`, then `VITEST_AGENT_REPORTER_PROJECT_DIR`
			// (the Claude Code plugin loader), then `CLAUDE_PROJECT_DIR`, then cwd.
			const projectDir = resolveProjectDir({ env, cwd: process.cwd() });
			const initialSessionId = resolveInitialSessionId(process.argv, LaunchContext.isUnsubstituted);

			const dbPath = await Effect.runPromise(
				resolveDataPath(projectDir).pipe(
					Effect.provide(PathResolutionLive(projectDir)),
					Effect.provide(NodeServices.layer),
				),
			);

			// Boot-time recovery from the env SessionStart wrote to `CLAUDE_ENV_FILE`.
			// It races the hook on a fresh launch and is empty after /reload-plugins,
			// so the session also carries a lazy recover thunk that re-reads the
			// hook's session-env surface at the first tool call that needs context.
			const recovered = sessionContextFromEnv(env);
			const homeDir = env.HOME ?? env.USERPROFILE ?? "";
			const Session = McpSession.layer({
				cwd: projectDir,
				initialSessionId: initialSessionId ?? recovered?.chatId ?? null,
				initialContext: recovered,
				recover: () => recoverSessionContextFromSessionEnv({ projectDir, homeDir }),
			});

			const Main = ServerLayer({ version: CURRENT_MCP_VERSION }).pipe(
				Layer.provide(Session),
				Layer.provide(PlatformLive({ dbPath, env, logLevel: resolveLogLevel(env), logFile: resolveLogFile(env) })),
				// Read by `ping`; a direct install leaves the reference at its `none` default.
				Layer.provide(Layer.succeed(CurrentDistribution, Option.fromNullishOr(options.distribution))),
				Layer.provide(NodeStdio.layer),
			);

			// `McpGuard` launches `Main` with `McpStdio.launch` (a launch failure
			// reported on stderr, never on the wire) under `runMain` with
			// `McpStdio.teardown` (stdin EOF, the ordinary end of every session,
			// exits 0 instead of 130).
			return { layer: Main, runMain: NodeRuntime.runMain, format: safeFormatFatalError };
		},
	});
