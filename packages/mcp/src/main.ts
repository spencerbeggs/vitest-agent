/**
 * The assembled vitest-agent MCP server program over stdio. Owns the process.
 *
 * This module deliberately carries NO static imports of the server graph:
 * the `unhandledRejection` and `uncaughtException` guards are registered
 * before `NodeRuntime`, the engine platform and `ServerLayer` are ever
 * evaluated, so a throw during module evaluation is still reported on stderr
 * rather than crashing silently. Adding a static import here would defeat
 * that. `bin.ts` is the published bin shim; this module is also published as
 * the `./main` subpath so the carrier (`@vitest-agent/plugin`) can ship its
 * own `vitest-agent-mcp` bin over it.
 *
 * Every `process` read lives here, not in the server layer or the tools.
 *
 * @packageDocumentation
 */

import { shouldExitOnUncaughtException } from "./utils/crash-guards.js";

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
 * substitutes unknown `${...}` variables to literal text in some surfaces, so
 * a literal substitution is treated as absent rather than seeding garbage.
 *
 * @param argv - the raw `process.argv`
 * @returns the trimmed seed, or `null` when absent, empty, or a literal `${...}`
 */
const resolveInitialSessionId = (argv: ReadonlyArray<string>): string | null => {
	const first = argv[2];
	if (first === undefined) return null;
	const trimmed = first.trim();
	if (trimmed.length === 0) return null;
	if (trimmed.startsWith("${") && trimmed.endsWith("}")) return null;
	return trimmed;
};

/**
 * Run the vitest-agent MCP server over stdio. Owns the process: registers
 * the crash guards, resolves the project directory and `data.db` path,
 * recovers the host session context, and launches the server layer under
 * `NodeRuntime.runMain`.
 *
 * Not re-exported from `index.ts` — a library consumer's import graph must
 * not pull in the process-owning module.
 *
 * @public
 */
export const main = async (): Promise<void> => {
	// Issue #191, sub-item A. Every throw or rejection *inside* a tool call is
	// already caught by `registerStrictToolkit`; anything reaching these
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
		const { Cause, Effect, Exit, Layer, Logger, Runtime } = await import("effect");
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
		const initialSessionId = resolveInitialSessionId(process.argv);

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
			Layer.provide(NodeStdio.layer),
			// Defense in depth with `ServerLayer`: every log line must land on
			// stderr, because stdout is the JSON-RPC wire.
			Layer.provide(Layer.succeed(Logger.LogToStderr, true)),
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

		// `runMain` logs a layer-build failure's cause itself, outside `Main`
		// where `LogToStderr` is not yet in scope — provide it on the launched
		// effect too so that report can never land on the JSON-RPC wire.
		const program = Layer.launch(Connected).pipe(Effect.provideService(Logger.LogToStderr, true));

		NodeRuntime.runMain(program, {
			// `Runtime.defaultTeardown` reports 130 whenever the main fiber's cause
			// is interrupts-only — exactly what stdin EOF produces, since the stdio
			// protocol interrupts the fiber that built it when stdin ends. A client
			// disconnect is the ordinary end of every session, so map it to 0.
			teardown: (exit, onExit) =>
				Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause) ? onExit(0) : Runtime.defaultTeardown(exit, onExit),
		});
	} catch (err) {
		process.stderr.write(`vitest-agent-mcp: startup failed: ${formatFatal(err)}\n`);
		process.exit(1);
	}
};
