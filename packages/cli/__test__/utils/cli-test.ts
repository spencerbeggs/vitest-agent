/**
 * Shared `CliTest` harness for the cli subprocess e2e suites: a hermetic
 * sandbox (fresh `HOME` + XDG dirs, `NO_COLOR=1`) and the built dev bin.
 */

import { join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { RunResult, Sandbox } from "@effected/cli/testing";
import { CliTest } from "@effected/cli/testing";
import { Effect } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";

/** The built dev output; `main.js` is the `./main` subpath the carrier imports. */
export const DIST = resolve(__dirname, "..", "..", "dist", "dev", "pkg");

/** The built dev bin. */
export const BIN = join(DIST, "bin", "vitest-agent.js");

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
		return CliTest.run(BIN, args, { sandbox, execPath: process.execPath, cwd, env: options.env });
	});
