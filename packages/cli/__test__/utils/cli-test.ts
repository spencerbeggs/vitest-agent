/**
 * Shared `CliTest` harness for the cli subprocess e2e suites: a hermetic
 * sandbox (fresh `HOME` + XDG dirs, `NO_COLOR=1`, nothing inherited from the
 * host environment — so no `FORCE_COLOR`, `CLAUDECODE` or
 * `CLAUDE_PROJECT_DIR` leaks into a child) and the built bin.
 */

import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { RunResult, Sandbox } from "@effected/cli-kit/testing";
import { CliTest } from "@effected/cli-kit/testing";
import { Effect, Exit, ManagedRuntime, Scope } from "effect";
import type { ChildProcessSpawner } from "effect/process";

/** The built output; `main.js` is the `./main` subpath the carrier imports. */
export const DIST = resolve(__dirname, "..", "..", "dist", "prod", "npm", "pkg");

/** The built bin. */
export const BIN = join(DIST, "bin", "vitest-agent.js");

/**
 * The built bin imports its workspace siblings, and those links resolve to
 * `src/`, so the child needs tsx. The sandbox environment is hermetic and the
 * child's cwd is a scratch directory, so name the loader by absolute URL.
 */
export const TSX_ENV = {
	NODE_OPTIONS: `--import=${pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href}`,
};

/** Run `body` against a fresh scoped sandbox, on the Node platform. */
export const inSandbox = <A, E>(
	body: (sandbox: Sandbox) => Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>,
): Promise<A> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
			return yield* body(sandbox);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

/** Run the built bin with `args` in a fresh sandbox. */
export const runCli = (
	args: ReadonlyArray<string>,
	options: {
		readonly env?: Readonly<Record<string, string>>;
		readonly setup?: (sandbox: Sandbox) => string | undefined;
	} = {},
): Promise<RunResult> =>
	inSandbox((sandbox) => {
		const cwd = options.setup?.(sandbox);
		return CliTest.run(BIN, args, { sandbox, execPath: process.execPath, cwd, env: { ...TSX_ENV, ...options.env } });
	});

/** Per-run options for {@link CliSession.run}. */
export interface CliSessionRunOptions {
	/** Extra variables merged over the sandbox environment. */
	readonly env?: Readonly<Record<string, string>> | undefined;
	/** The child's working directory; the sandbox root when omitted. */
	readonly cwd?: string | undefined;
	/**
	 * The exit code the run must end with. Any other ending rejects with the
	 * kit's `CliTestFailure`, whose message carries the child's stderr, so a
	 * CI-only failure shows it (issue #383). Omitted, a non-zero exit is data.
	 */
	readonly expectExit?: number | undefined;
}

/**
 * One sandbox held open across several bin runs, for suites whose tests
 * spawn the bin more than once against the same data directory. Open it in
 * `beforeEach`, close it in `afterEach`.
 */
export interface CliSession {
	readonly sandbox: Sandbox;
	/** Run the built bin; a non-zero exit is a result, unless `expectExit` says otherwise. */
	readonly run: (args: ReadonlyArray<string>, options?: CliSessionRunOptions) => Promise<RunResult>;
	/** Remove the sandbox and release the platform runtime. */
	readonly close: () => Promise<void>;
}

/** Open a {@link CliSession}. */
export const openSession = async (): Promise<CliSession> => {
	const runtime = ManagedRuntime.make(NodeServices.layer);
	const scope = await runtime.runPromise(Scope.make());
	const sandbox = await runtime.runPromise(Scope.provide(CliTest.sandbox({ path: process.env.PATH ?? "" }), scope));
	return {
		sandbox,
		run: (args, options = {}) =>
			runtime.runPromise(
				CliTest.run(BIN, args, {
					sandbox,
					execPath: process.execPath,
					cwd: options.cwd,
					env: { ...TSX_ENV, ...options.env },
					expectExit: options.expectExit,
				}),
			),
		close: async () => {
			await runtime.runPromise(Scope.close(scope, Exit.void));
			await runtime.dispose();
		},
	};
};
