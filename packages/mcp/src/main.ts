/**
 * The assembled vitest-agent MCP server program over stdio. Owns the process.
 *
 * This module deliberately carries NO static imports of the server graph:
 * the `unhandledRejection` and `uncaughtException` guards are registered
 * before `NodeRuntime`, the engine platform and `ServerLayer` are ever
 * evaluated, so a throw during module evaluation is still reported on stderr
 * rather than crashing silently. Adding a static import here would defeat
 * that; an `import type` is erased at build time and is fine. `bin.ts` is
 * the published bin shim; this module is also published as the `./main`
 * subpath so the carrier (`@vitest-agent/plugin`) can ship its own
 * `vitest-agent-mcp` bin over it, passing its identity as `distribution`.
 *
 * Every `process` read lives here, not in the server layer or the tools.
 *
 * @packageDocumentation
 */

import type { Distribution } from "@effected/engine";
import { shouldExitOnUncaughtException } from "./utils/crash-guards.js";

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
 * Whether the stdio transport is live for this process — set once the
 * whole server layer graph (the stdio protocol included) has been built.
 * Read by the `uncaughtException` guard via `shouldExitOnUncaughtException`;
 * see that function's doc comment for the judgment call this flag backs
 * (issue #191).
 */
let transportConnected = false;

/**
 * Formatter for the crash guards. Starts as a dependency-free fallback so a
 * throw during module evaluation of the server graph is still described,
 * and is swapped for the SDK's `safeFormatFatalError` once that import
 * has resolved.
 */
let formatFatal = (error: unknown): string => {
	try {
		return error instanceof Error ? (error.stack ?? error.message) : String(error);
	} catch {
		return "<unformattable error value>";
	}
};

/**
 * Test-only crash injection, gated by an env var so it can never fire in a
 * normal install. Exists so `__test__/bin-crash-resilience.e2e.test.ts` can
 * exercise the guards against a *real* child process. Fires exactly once,
 * on the next event-loop turn after the transport is known to be connected,
 * so ordering relative to `transportConnected` is deterministic regardless
 * of client-side handshake timing.
 */
const scheduleTestCrashInjection = (): void => {
	const kind = process.env.VITEST_AGENT_MCP_TEST_INJECT_CRASH;
	if (kind !== "unhandledRejection" && kind !== "uncaughtException") return;
	setImmediate(() => {
		if (kind === "unhandledRejection") {
			// Deliberately not awaited/caught — the exact shape of failure
			// issue #191 describes: a rejection with no handler anywhere.
			Promise.reject(new Error("[test-injected] unhandledRejection"));
		} else {
			throw new Error("[test-injected] uncaughtException");
		}
	});
};

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
 * the crash guards, resolves the project directory and `data.db` path,
 * recovers the host session context, and launches the server layer under
 * `NodeRuntime.runMain` with `McpStdio.launch` / `McpStdio.teardown`.
 *
 * Not re-exported from `index.ts` — a library consumer's import graph must
 * not pull in the process-owning module.
 *
 * @param options - the launching distribution, when a carrier shipped the bin
 * @public
 */
export const main = async (options: MainOptions = {}): Promise<void> => {
	// Issue #191, sub-item A. Every throw or rejection *inside* a tool call is
	// already caught by core's `registerToolkit` (a defect becomes a scrubbed
	// `isError` result, logged on stderr); anything reaching these
	// handlers originated outside a tool-call boundary and has no in-flight
	// caller waiting on it, so logging and continuing is safe.
	process.on("unhandledRejection", (reason) => {
		process.stderr.write(`vitest-agent-mcp: unhandledRejection: ${formatFatal(reason)}\n`);
	});
	// Node's guidance for `uncaughtException` is "do not resume"; this process
	// accepts that residual risk once the transport is connected (no
	// long-lived mutable state outside SQLite's own transactions, and silent
	// death mid-session is strictly worse). Before then it exits loudly.
	process.on("uncaughtException", (err, origin) => {
		process.stderr.write(`vitest-agent-mcp: uncaughtException (${origin}): ${formatFatal(err)}\n`);
		if (shouldExitOnUncaughtException(transportConnected)) {
			process.exitCode = 1;
			process.exit(1);
		}
	});

	// Anything that rejects before `runMain` owns the process — a dynamic
	// import failing to resolve, `resolveDataPath` failing, the layer
	// graph refusing to build — must exit non-zero with a diagnostic. Left
	// to the `unhandledRejection` guard above it would only be logged and
	// the event loop would drain to exit 0 with no server listening.
	try {
		// No static imports of the server graph above this line (`crash-guards`
		// is a dependency-free leaf and is the one exception).
		const { safeFormatFatalError } = await import("./utils/safe-format-fatal-error.js");
		formatFatal = safeFormatFatalError;
		const NodeRuntime = await import("@effect/platform-node/NodeRuntime");
		const NodeServices = await import("@effect/platform-node/NodeServices");
		const NodeStdio = await import("@effect/platform-node/NodeStdio");
		const { Effect, Layer, Option } = await import("effect");
		const { CurrentDistribution, LaunchContext } = await import("@effected/engine");
		const { McpStdio } = await import("@effected/mcp");
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

		// `Layer.launch(Main)` never resolves, so the "transport connected" flag
		// is set from a layer built strictly AFTER `Main`: `Layer.provide` builds
		// its dependency to completion before the dependent (`provideWith` is
		// `flatMap(that.build, self.build)`), and `Main`'s stdio protocol is
		// itself reached through `Layer.provide` chains, so by the time this
		// effect runs the server is reading stdin.
		const Connected = Layer.effectDiscard(
			Effect.sync(() => {
				transportConnected = true;
				scheduleTestCrashInjection();
			}),
		).pipe(Layer.provide(Main));

		// `McpStdio.launch` reports a launch failure on stderr itself (with
		// `LogToStderr` provided around the whole launch, PlatformLive's build
		// included) and hides it from `runMain`, whose own report would land on
		// the wire. `McpStdio.teardown` maps stdin EOF — an interrupt-only exit,
		// the ordinary end of every session — to 0 instead of 130.
		NodeRuntime.runMain(McpStdio.launch(Connected), { teardown: McpStdio.teardown });
	} catch (err) {
		process.stderr.write(`vitest-agent-mcp: startup failed: ${formatFatal(err)}\n`);
		process.exit(1);
	}
};
