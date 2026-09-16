/**
 * Shared spawn helper for the cli subprocess e2e suites.
 *
 * `execFileSync` inherits the child's stderr and throws a bare
 * "Command failed" on a non-zero exit, so a CI-only failure shows the
 * exit code and nothing to diagnose (issue #383). `runBin` captures both
 * streams and puts the child's stderr in the thrown error's message.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/** The built dev bin; every suite spawns this one path. */
export const BIN = resolve(__dirname, "..", "..", "dist", "dev", "pkg", "bin", "vitest-agent.js");

export interface BinResult {
	readonly status: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

/** Error thrown by {@link runBin} on a non-zero exit; carries both streams. */
export class BinExitError extends Error {
	constructor(
		readonly args: ReadonlyArray<string>,
		readonly result: BinResult,
	) {
		super(
			`vitest-agent ${args.join(" ")} exited ${result.status ?? "null"}` +
				(result.stderr.trim().length > 0 ? `\n--- stderr ---\n${result.stderr.trimEnd()}` : "") +
				(result.stdout.trim().length > 0 ? `\n--- stdout ---\n${result.stdout.trimEnd()}` : ""),
		);
		this.name = "BinExitError";
	}
}

/**
 * Run the built bin with `args` and `env`, returning both streams.
 * Throws {@link BinExitError} — whose message includes the child's
 * stderr — on a non-zero exit or a spawn failure.
 */
export const runBin = (args: ReadonlyArray<string>, env: NodeJS.ProcessEnv): BinResult => {
	const child = spawnSync("node", [BIN, ...args], { env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
	const result: BinResult = { status: child.status, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
	if (child.error) {
		throw new BinExitError(args, { ...result, stderr: `${result.stderr}\n${child.error.message}` });
	}
	if (child.status !== 0) throw new BinExitError(args, result);
	return result;
};
